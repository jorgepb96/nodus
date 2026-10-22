import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime,repoRoot} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-tts-download-cancel'))process.exit(0);
const root=await mkdtemp(path.join(os.tmpdir(),'nodus-tts-download-cancel-'));
const require=createRequire(import.meta.url);installRuntimeHooks(root);
const {TtsModelStore}=require(path.join(repoRoot,'electron/tts/models.ts'));
const bytes=Buffer.alloc(2*1024*1024,71);const ranges=[];
const server=http.createServer((req,res)=>{
 const start=Number(/bytes=(\d+)-/.exec(req.headers.range||'')?.[1]||0);ranges.push(start);
 res.writeHead(start?206:200,{'content-length':bytes.length-start,...(start?{'content-range':`bytes ${start}-${bytes.length-1}/${bytes.length}`}:{})});
 let offset=start;const timer=setInterval(()=>{const end=Math.min(offset+32768,bytes.length);res.write(bytes.subarray(offset,end));offset=end;if(offset===bytes.length){clearInterval(timer);res.end();}},3);
 res.on('close',()=>clearInterval(timer));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const store=new TtsModelStore(path.join(root,'models'));
 const model={id:'cancel-fixture',assets:[{file:'weights.bin',url:`http://127.0.0.1:${server.address().port}/weights`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]};
 let cancelled=false;
 await assert.rejects(store.download(model,status=>{if(status.downloadedBytes>0&&!cancelled){cancelled=true;store.cancel(model.id);}}),/cancel/i);
 assert.equal(await store.isReady(model),false);
 await store.download(model);
 assert.equal(await store.isReady(model),true);
 assert.deepEqual(await readFile(path.join(store.dir(model.id),'weights.bin')),bytes);
 assert.ok(ranges[1]>0,'the retry resumes the durable partial file');
 console.log('PASS cancellation with pending disk writes, HTTP Range resume and SHA-256 verification');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
