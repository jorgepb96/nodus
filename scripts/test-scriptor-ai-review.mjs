import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = path.resolve(new URL('..', import.meta.url).pathname), require = createRequire(import.meta.url);
const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-review-'));
try {
  const file = path.join(dir, 'review.cjs');
  await build({ entryPoints:[path.join(root,'shared/editorAiReview.ts')], outfile:file, bundle:true, platform:'node', format:'cjs' });
  const { editorReviewDiff, normalizeImageFavorites, savedEditorImageModels } = require(file);
  test('complete diffs reconstruct the exact original and proposal including punctuation, unicode and whitespace', () => {
    for (const [a,b] of [['La memoria del paisaje','La memoria documentada del paisaje'], ['Árbol 🌿\nSegundo párrafo.','Árbol 🌿\nOtra frase.'], ['a  b\n','a b\n\n'], ['', 'nuevo'], ['original',''], ['igual','igual']]) {
      const pieces=editorReviewDiff(a,b,true);
      assert.equal(pieces.filter(p=>p.kind!=='added').map(p=>p.value).join(''),a);
      assert.equal(pieces.filter(p=>p.kind!=='removed').map(p=>p.value).join(''),b);
    }
  });
  test('streaming is a provisional replacement, with exact source and progressively received text', () => {
    assert.deepEqual(editorReviewDiff('Original.','Nueva',false),[{value:'Original.',kind:'removed'},{value:'Nueva',kind:'added'}]);
  });
  test('image favorites are normalized independently of text models and filter by exact provider pair', () => {
    const favorites=normalizeImageFavorites([{provider:'codex',model:'a'}, {provider:'codex',model:'a'}, {provider:'openai',model:'image'}, {provider:'ollama',model:'text'}, {}, null]);
    assert.deepEqual(favorites,[{provider:'codex',model:'a'},{provider:'openai',model:'image'}]);
    const catalog=[{provider:'codex',id:'a'},{provider:'openai',id:'image'},{provider:'google',id:'default'},{provider:'google',id:'a'}];
    assert.deepEqual(savedEditorImageModels(catalog,favorites,{provider:'google',model:'default'}),catalog.slice(0,3));
  });
  const pmFile=path.join(dir,'pm.cjs');
  await build({stdin:{resolveDir:root,contents:`export * from './src/components/editor/editorAiDecorations'; export {Schema} from '@tiptap/pm/model'; export {EditorState} from '@tiptap/pm/state';`},outfile:pmFile,bundle:true,platform:'node',format:'cjs'});
  const { Schema, EditorState, createEditorReviewPlugin, editorReviewKey, reviewTextMap }=require(pmFile);
  test('native review decorations never mutate content, and clearing preserves the exact document',()=>{
    const schema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'text*',group:'block'},text:{group:'inline'}}});
    const doc=schema.node('doc',null,[schema.node('paragraph',null,schema.text('Primero.')),schema.node('paragraph',null,schema.text('Segundo.'))]);
    const range={from:1,to:19};
    assert.equal(reviewTextMap(doc,range).text,'Primero.\nSegundo.');
    let state=EditorState.create({doc,plugins:[createEditorReviewPlugin()]}); const before=state.doc.toJSON();
    for(const proposed of ['Nuevo', 'Nuevo texto.']) {
      const tr=state.tr.setMeta(editorReviewKey,{range,original:'Primero.\nSegundo.',proposed,complete:false});
      assert.equal(tr.docChanged,false); state=state.apply(tr); assert.deepEqual(state.doc.toJSON(),before); assert.ok(editorReviewKey.getState(state).find().length);
    }
    state=state.apply(state.tr.setMeta(editorReviewKey,null));assert.equal(editorReviewKey.getState(state).find().length,0);assert.deepEqual(state.doc.toJSON(),before);
  });
} finally { await rm(dir,{recursive:true,force:true}); }
