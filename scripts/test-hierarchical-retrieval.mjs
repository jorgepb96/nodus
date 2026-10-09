import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-hierarchical-retrieval-'));
const outfile = path.join(root, 'retrieval.mjs');
globalThis.__hierarchical = { passageCalls: [] };

await build({
  entryPoints: [path.join(repoRoot, 'electron/ai/hierarchicalRetrieval.ts')],
  outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  plugins: [{
    name: 'hierarchical-stubs',
    setup(api) {
      const stub = (filter, name, contents) => {
        api.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
        api.onLoad({ filter: new RegExp(`^${name}$`), namespace: 'stub' }, () => ({ contents, loader: 'js' }));
      };
      stub(/\.\.\/db\/ideasRepo$/, 'ideas', `export async function findSimilarIdeasPaged(){return [
        {global_id:'idea-global',type:'claim',label:'Idea global',statement:'No depende del router documental.',similarity:.81}
      ]}`);
      stub(/\.\.\/db\/passagesRepo$/, 'passages', `export async function findSimilarPassagesPaged(vector,threshold,limit,opts={}){
        globalThis.__hierarchical.passageCalls.push(opts.nodusIds||[]);
        if(opts.nodusIds?.length && globalThis.__hierarchical.routedGate) await globalThis.__hierarchical.routedGate;
        if(opts.nodusIds?.length)return [{passage_id:'p-routed',nodus_id:'work-doc',text:'Evidencia dentro de la obra orientada.',page_label:'8',similarity:.72,title:'Obra documental',authors_json:'["A"]',year:2020,zotero_key:'Z1'}];
        return [{passage_id:'p-global',nodus_id:'work-other',text:'Evidencia global independiente.',page_label:'3',similarity:.91,title:'Otra obra',authors_json:'["B"]',year:2021,zotero_key:'Z2'}];
      }
      export function lexicalPassageSearch(){return [{passage_id:'p-lexical',nodus_id:'work-literal',text:'Procedimiento literal exacto.',page_label:'11',similarity:0,title:'Obra literal',authors_json:'["C"]',year:2019,zotero_key:'Z3'}]}`);
      stub(/\.\.\/db\/documentProfilesRepo$/, 'documents', `
        const base={authors:['A'],year:2020,versionId:'v1',fieldKind:'thesis',centrality:1,stale:false};
        export async function findSimilarDocuments(){return [
          {...base,kind:'document',nodusId:'work-doc',title:'Obra documental',sourceId:'overview',text:'Tesis macro',similarity:.84,explanation:'semántica'},
          {...base,kind:'section',nodusId:'work-doc',title:'Obra documental',sourceId:'section-1',text:'Otra sección de la misma obra',similarity:.83,explanation:'semántica'},
          {...base,kind:'document',nodusId:'work-second',title:'Segunda obra',sourceId:'overview',text:'Otra tesis',similarity:.82,explanation:'semántica'}
        ]}
        export function findDocumentSupportPassages(){return [
          {passage_id:'p-support',nodus_id:'work-doc',text:'Soporte validado del campo coincidente.',page_label:'5',similarity:.8,title:'Obra documental',authors_json:'["A"]',year:2020,zotero_key:'Z1'}
        ]}
        export function lexicalDocumentSearch(){return [{...base,kind:'document',nodusId:'work-doc',title:'Obra documental',sourceId:'overview',text:'Tesis macro',similarity:0,lexicalScore:4,explanation:'léxica'}]}
      `);
      stub(/\.\/aiClient$/, 'ai', `export async function embedQuery(){return [1,0,0]}`);
    },
  }],
});

const retrieval = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
test.after(async () => { delete globalThis.__hierarchical; await rm(root, { recursive: true, force: true }); });

test('document routing is additive and preserves independent idea/evidence quotas', async () => {
  const result = await retrieval.retrieveHierarchical('consulta', {
    documentLimit: 5, ideaLimit: 5, passageLimit: 5, routedPassageLimit: 5,
  });
  assert.deepEqual(result.ideas.map((hit) => hit.global_id), ['idea-global']);
  assert.ok(result.passages.some((hit) => hit.passage_id === 'p-global' && hit.lanes.includes('global')));
  assert.ok(result.passages.some((hit) => hit.passage_id === 'p-support' && hit.lanes.includes('support')));
  assert.ok(result.passages.some((hit) => hit.passage_id === 'p-lexical' && hit.lanes.includes('lexical')));
  assert.ok(result.passages.some((hit) => hit.passage_id === 'p-routed' && hit.lanes.includes('document')));
  assert.deepEqual(result.passages.map((hit) => hit.passage_id), ['p-global', 'p-support', 'p-lexical', 'p-routed'], 'global evidence stays first while exact, lexical and routed lanes remain additive');
  assert.deepEqual(
    retrieval.selectPassageEvidence(result.passages, 4).map((hit) => hit.passage_id),
    ['p-global', 'p-lexical', 'p-support', 'p-routed'],
    'a small evidence menu rotates across all independent retrieval lanes',
  );
  assert.deepEqual(result.routedWorkIds, ['work-doc', 'work-second']);
  assert.deepEqual(result.documents[0].channels, ['semantic', 'lexical']);
  assert.deepEqual(result.documents.map((hit) => hit.nodusId), ['work-doc', 'work-second'], 'a verbose profile occupies one work slot');
  assert.ok(globalThis.__hierarchical.passageCalls.some((ids) => ids.includes('work-doc')));
});

test('rank fusion rewards agreement without adding incompatible raw scores', () => {
  const fused = retrieval.reciprocalRankFusion([
    [{ key: 'both', value: { id: 'both' } }, { key: 'semantic', value: { id: 'semantic' } }],
    [{ key: 'both', value: { id: 'both' } }, { key: 'lexical', value: { id: 'lexical' } }],
  ]);
  assert.equal(fused[0].id, 'both');
  assert.ok(fused[0].retrievalScore > fused[1].retrievalScore);
});

test('deep-research evidence selection spends its first slots on independent works when available', () => {
  const hit = (passage_id, nodus_id, lanes) => ({
    passage_id, nodus_id, lanes, text: passage_id, page_label: null, similarity: 0.8,
    title: nodus_id, authors_json: '[]', year: null, zotero_key: null,
  });
  const selected = retrieval.selectPassageEvidence([
    hit('g-a1', 'work-a', ['global']),
    hit('g-a2', 'work-a', ['global']),
    hit('g-b', 'work-b', ['global']),
    hit('l-a', 'work-a', ['lexical']),
    hit('l-c', 'work-c', ['lexical']),
  ], 4, { preferLexical: true, preferSourceDiversity: true });
  assert.equal(new Set(selected.slice(0, 3).map((item) => item.nodus_id)).size, 3, 'three evidence slots cover three works before repeating one');
  assert.ok(selected.some((item) => item.passage_id === 'g-a1' || item.passage_id === 'g-a2'), 'source diversity does not ban additional evidence from a relevant work');
});


test('routed retrieval remains pending while its asynchronous lane yields to the event loop', async () => {
  let release;
  globalThis.__hierarchical.routedGate = new Promise(resolve => { release = resolve; });
  let settled = false;
  const pending = retrieval.retrieveHierarchical('consulta', { passageLimit: 5, routedPassageLimit: 5 }).then(result => { settled = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'the hierarchy must await routed evidence while allowing another event-loop turn');
  release();
  try { assert.ok((await pending).passages.some(hit => hit.passage_id === 'p-routed')); }
  finally { delete globalThis.__hierarchical.routedGate; }
});
