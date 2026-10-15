import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/mobileWeb/readerResourceQueue.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {ReaderResourceQueue}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const queue=new ReaderResourceQueue(4),controller=new AbortController(),release=[];let active=0,maximum=0,started=0;
const results=Array.from({length:600},(_,id)=>queue.run(async()=>{
  started++;active++;maximum=Math.max(maximum,active);
  await new Promise(resolve=>release.push(resolve));active--;return id;
},controller.signal));
await tick();assert.equal(started,4);assert.equal(maximum,4);
while(started<600||release.length){release.splice(0).forEach(resolve=>resolve());await tick();}
assert.deepEqual(await Promise.all(results),Array.from({length:600},(_,id)=>id));assert.equal(maximum,4);

// A document replacement cancels queued reads before transport and aborts the
// four live loads. A fresh document can take those slots without stale replies.
const old=new AbortController();let oldStarts=0;
const cancelled=Array.from({length:300},()=>queue.run(()=>{
  oldStarts++;return new Promise((_,reject)=>old.signal.addEventListener('abort',()=>reject(old.signal.reason),{once:true}));
},old.signal).then(()=>false,error=>error.name==='AbortError'));
await tick();old.abort();assert.equal(oldStarts,4);assert.ok((await Promise.all(cancelled)).every(Boolean));
await tick();assert.equal(await queue.run(async()=> 'new document',new AbortController().signal),'new document');
assert.equal(oldStarts,4);
console.log('Reader resource queue: bounded 600-image document and document cancellation passed.');
