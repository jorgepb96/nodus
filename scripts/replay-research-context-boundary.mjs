/** Replay exact recorded search decisions through isolated Electron, then stop before new generation. Dry-run by default. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createResearchApp } from './lib/research-app-harness.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg=name=>process.argv.find(value=>value.startsWith('--'+name+'='))?.slice(name.length+3);
const read=file=>{
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024*1024)throw new Error('Unsafe or oversized replay input');
  return fs.readFileSync(file);
};
if(!arg('clone-receipt')||!arg('campaign')||!/^R\d{3}$/u.test(arg('case-id')??'')) throw new Error('Usage: node scripts/replay-research-context-boundary.mjs --clone-receipt=FILE --campaign=FILE --case-id=R009 [--run]');
const cloneFile=path.resolve(arg('clone-receipt'));
const clone=JSON.parse(read(cloneFile));
if(clone.format!=='nodus.prepared-research-clone/1'||clone.cloneSafety?.noSymlinks!==true||clone.cloneSafety?.independentSQLiteFiles!==true)throw new Error('Expected a prepared disposable profile clone receipt');
const root=fs.realpathSync(clone.root), source=fs.realpathSync(clone.sourceRoot);
if(root!==clone.root||root===source)throw new Error('Replay needs its own disposable profile');
const caseId=arg('case-id');
const marker=JSON.parse(read(root+'/isolation.json'));
assert.equal(marker.root,root); assert.equal(marker.format,'nodus.isolated-research-profile/1');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const campaignFile=path.resolve(arg('campaign'));
if(!campaignFile.startsWith(source+'/artifacts/'))throw new Error('Campaign must belong to the marked clone source');
const sourceMarker=JSON.parse(read(source+'/isolation.json'));
assert.equal(sourceMarker.root,source);assert.equal(sourceMarker.format,'nodus.isolated-research-profile/1');
const original=JSON.parse(read(campaignFile));
assert.equal(original.root,source);
const caseRow=original.answers.find(x=>x.caseId===caseId); assert.ok(caseRow);
assert.ok(Array.isArray(caseRow.bridgeRequestIds)&&caseRow.bridgeRequestIds.length<=200);
const requests=caseRow.bridgeRequestIds.map(id=>{
  assert.match(id,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
  const p=source+'/artifacts/requests/'+id+'.json', bytes=read(p);
  return {id,path:p,body:JSON.parse(bytes).request,sha256:digest(bytes)};
});
const boundary=requests.findIndex(x=>x.body.messages[0].content.startsWith('Plan a documentary answer'));
assert.ok(boundary>=0,'Recorded documentary boundary is missing');
const prior=requests.slice(0,boundary).map(x=>{const p=source+'/artifacts/raw-completions/'+x.id+'.txt',bytes=read(p);return {...x,completionPath:p,completion:bytes.toString('utf8'),completionSha256:digest(bytes)};});
if(!process.argv.includes('--run')){console.log(JSON.stringify({mode:'dry-run',caseId,root,source,recordedDecisions:prior.length,newModelGenerations:0,paidApiCalls:0}));process.exit(0);}
const out=root+'/artifacts/context-boundary-replay';fs.mkdirSync(out,{mode:0o700});
const calls=[];let cursor=0,captured=null,divergence=null;
const server=http.createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'codex-luna-qa',context_length:128000}]}));return;}
  if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
  try{
    const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>1000000)throw new Error('oversize');chunks.push(c);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8')); const n=calls.length;
    fs.writeFileSync(`${out}/request-${String(n).padStart(2,'0')}.json`,JSON.stringify(body,null,2)+'\n');
    const system=body.messages.find(m=>m.role==='system')?.content??'';
    const user=body.messages.findLast(m=>m.role==='user')?.content??'';
    const call={ordinal:n,systemSha256:digest(system),userSha256:digest(user),kind:system.slice(0,80)};calls.push(call);
    if(divergence||captured){res.writeHead(400).end(JSON.stringify({error:{message:'Diagnostic replay stopped at recorded boundary'}}));return;}
    if(system.startsWith('Plan a documentary answer')){
      assert.equal(cursor,prior.length);captured={requestFile:`${out}/request-${String(n).padStart(2,'0')}.json`,user:JSON.parse(user)};
      call.boundaryCaptured=true;res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{message:'Intentional diagnostic boundary stop; no new generation'}}));return;
    }
    const expected=prior[cursor];
    assert.ok(expected,'No unrecorded model decision may be replayed');
    assert.equal(body.model,expected.body.model);
    assert.equal(system,expected.body.messages.find(m=>m.role==='system').content,'System prompt differs from closed baseline');
    assert.ok(same(JSON.parse(user),JSON.parse(expected.body.messages.findLast(m=>m.role==='user').content)),'Decision input differs from closed baseline');
    call.replayedRequestId=expected.id;call.rawCompletionSha256=expected.completionSha256;cursor++;
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:`recorded-replay-${n}`,object:'chat.completion',model:body.model,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:expected.completion}}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}));
  }catch(e){divergence=String(e.message);res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{message:'Recorded-input mismatch; diagnostic halted'}}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const keys=root+'/fixtures/empty-provider-keys.json';fs.writeFileSync(keys,'{}\n',{mode:0o600});
const traceFile=root+'/profile/embedding-trace.jsonl';
const traceOffset=fs.existsSync(traceFile)?fs.statSync(traceFile).size:0;
let harness,error=null;
try{
  harness=await createResearchApp({root,extraPorts:[port],extraEnv:{NODUS_HARNESS_KEYS_FILE:keys,NODUS_EMBEDDING_QA_TRACE:'1'}});
  const {app,page}=await harness.launch();await app.evaluate(({app,BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.hide();app.dock?.hide();});
  const model={provider:'custom',model:'codex-luna-qa'};
  await page.evaluate(async({url,model,language})=>{await window.nodus.updateSettings({customProvider:{baseUrl:url,models:[model.model]},chatModel:model,synthesisModel:model,researchWebSearch:'off',researchAnswerVerification:'structured',promptLanguage:language});await window.nodus.getModelCatalog('custom');},{url:`http://127.0.0.1:${port}/v1`,model,language:caseRow.language});
  const notebookId=JSON.parse(fs.readFileSync(path.join(path.dirname(campaignFile),'manifest.json'))).notebookId;
  const selection={notebookId,layers:{ideas:false,documents:true},retrieval:{preset:'deep',candidates:120,passagesPerRound:24,evidenceTokens:16000,rounds:8,autoExpand:true,threshold:{mode:'automatic'}},ideas:false,themes:false,contradictions:false,gaps:false,readingPath:false,authors:false,documents:true,passages:true,graph:false,graphParts:{ideaNodes:false,themeNodes:false,ideaEdges:false,authorGraph:false}};
  await page.evaluate(async({question,model,selection})=>window.nodus.researchChat({messages:[{role:'user',content:question}],selection,model,webSearch:'off'}),{question:caseRow.question,model,selection});
}catch(e){error=String(e.message).slice(0,1000);}finally{await harness?.close();await new Promise(r=>server.close(r));}
const traces=fs.existsSync(traceFile)?fs.readFileSync(traceFile).subarray(traceOffset).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const report={format:'nodus.recorded-context-boundary-replay/1',at:new Date().toISOString(),root,source,caseId,mode:'Recorded decisions; real isolated Electron and local embeddings; stop before new documentary generation. No answer-quality credit.',sourceCampaignSha256:digest(read(campaignFile)),cloneReceiptSha256:digest(read(cloneFile)),replayScriptSha256:digest(fs.readFileSync(fileURLToPath(import.meta.url))),isolation:harness?.proof??null,paidApiCalls:0,newModelGenerations:0,expectedRecordedDecisions:prior.length,replayedDecisions:cursor,calls,captured,divergence,error,traces:traces.filter(x=>x.type?.startsWith('research-context-')||x.type==='research-evidence-selection'),sourceFiles:Object.fromEntries(['electron/ai/researchAssistant.ts','electron/ai/researchContextFit.ts','electron/ai/researchCorpusRun.ts'].map(p=>[p,digest(fs.readFileSync(path.join(repo,p)))]))};
fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({root,report:out+'/report.json',replayed:cursor,captured:!!captured,divergence}));
if(!captured||divergence)process.exitCode=1;
