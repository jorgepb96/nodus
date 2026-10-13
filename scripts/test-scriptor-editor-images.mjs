import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createCanvas } from '@napi-rs/canvas';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const dir=await mkdtemp(path.join(root,'node_modules/.nodus-editor-images-'));
try {
 const file=path.join(dir,'images.mjs');
 await build({entryPoints:[path.join(root,'electron/ai/editorImages.ts')],outfile:file,bundle:true,format:'esm',platform:'node',external:['@napi-rs/canvas'],plugins:[{name:'controlled-image-provider',setup(builder){
  builder.onResolve({filter:/^\.\/decorativeImages$/},args=>args.importer.endsWith('editorImages.ts')?{path:'provider',namespace:'qa'}:null);
  builder.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:`import {prepareImageStorage} from ${JSON.stringify(path.join(root,'electron/imageStorage.ts'))}; export const prepareGeneratedImage=generated=>prepareImageStorage(generated.bytes,generated.mimeType); export const callImageProvider=()=>{throw new Error('No live provider allowed');};`,resolveDir:root}));
  builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'electron-stub'}));builder.onLoad({filter:/.*/,namespace:'electron-stub'},()=>({contents:'export const nativeImage=undefined;'}));
 }}]});
 const {generateEditorImage}=await import(pathToFileURL(file).href);
 const canvas=createCanvas(160,100),ctx=canvas.getContext('2d');ctx.fillStyle='#695fa7';ctx.fillRect(0,0,160,100);const bytes=canvas.toBuffer('image/png');
 const request={requestId:'qa-request',prompt:' Un paisaje. ',model:{provider:'openai',model:'gpt-image-2'}};
 test('editor image preview preserves source bytes, dimensions and the explicit engine',async()=>{
  let received;const result=await generateEditorImage(request,new AbortController().signal,async(...args)=>{received=args;return{bytes,mimeType:'image/png'};});
  assert.deepEqual(received.slice(0,3),['openai','gpt-image-2','Un paisaje.']);assert.equal(result.width,160);assert.equal(result.height,100);assert.equal(result.provider,'openai');assert.deepEqual(Buffer.from(result.dataUrl.split(',')[1],'base64'),bytes);
 });
 test('invalid requests fail before invoking a provider',async()=>{
  let calls=0;const provider=async()=>{calls++;return{bytes,mimeType:'image/png'};};
  for(const invalid of [{...request,prompt:''},{...request,prompt:'x'.repeat(8001)},{...request,requestId:''},{...request,model:{provider:'ollama',model:'text'}}])await assert.rejects(generateEditorImage(invalid,new AbortController().signal,provider));assert.equal(calls,0);
 });
 test('cancellation suppresses late output even for a non-abortable provider',async()=>{
  const controller=new AbortController();await assert.rejects(generateEditorImage(request,controller.signal,async()=>{controller.abort();return{bytes,mimeType:'image/png'};}),{name:'AbortError'});
  await assert.rejects(generateEditorImage(request,controller.signal,async()=>{throw new Error('must not run');}),{name:'AbortError'});
 });
 test('oversized image previews are rejected before storage',async()=>{
  await assert.rejects(generateEditorImage(request,new AbortController().signal,async()=>({bytes:Buffer.alloc(20_000_001),mimeType:'image/png'})),/20 MB/);
 });
} finally {await rm(dir,{recursive:true,force:true});}
