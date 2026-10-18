import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime,repoRoot} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--dictionary-harness'))process.exit(0);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-dictionary-harness-'));installRuntimeHooks(scratch);const require=createRequire(import.meta.url),load=file=>require(path.join(repoRoot,file));
globalThis.fetch=()=>{throw Error('Network forbidden in Dictionary harness fixtures');};
try{
 const db=load('electron/db/database.ts').getDb(),repo=load('electron/db/dictionaryRepo.ts'),passages=load('electron/db/passagesRepo.ts');
 for(const [id,author,text]of[['dict-a','Alpha','Memory emerges from shared social practices and collective interpretation.'],['dict-b','Beta','Memory changes as generations reinterpret their inherited accounts.'],['forbidden','Gamma','Memory is an unrelated forbidden account.']]){
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type) VALUES(?,?,?,?, 'book','text')").run(id,id,'Memory '+author,JSON.stringify([author]));
  passages.replaceWorkPassages(id,'hash-'+id,[{text,pageLabel:'2',embedding:null}]);
 }
 const client=load('electron/ai/aiClient.ts');client.resolveModelRef=()=>null;client.embedQuery=async()=>null;client.embedMany=async queries=>queries.map(()=>null);
 let searches=0,writers=0,verifications=0,pauseWriter=false,pauseVerification=false,deleteWriter=false,pausedId;
 const preparation=load('electron/ai/documentaryPreparation.ts');preparation.retrieveSharedDocumentaryEvidence=async()=>({evidence:[],traversal:{rounds:1,candidates:0,partial:false}});
 const runtime=load('electron/ai/researchHarnessRuntime.ts'),runs=load('electron/db/researchRunsRepo.ts');
 client.completeJson=async(options,guard)=>{
  const authors={authorSummaries:[]};let value;
  let payload;try{payload=JSON.parse(options.user);}catch{}
  if(payload?.conversation){value={goal:'Research the definition of Memory from the authorized library',queries:['Memory'],authors:[],titles:[],kind:'definition',needsSources:true,explicitLibrary:true,answerMode:'documentary',exploration:[]};}
  else if(options.system.includes('You are Nodus Research Harness')){searches++;assert.equal(payload.context.mode,'dictionary');assert.equal(payload.context.capabilities.web,false);assert.ok(payload.sources.every(s=>!s.title.includes('Gamma')));value={action:'finish',reason:'diminishing_returns',coverage:payload.agenda.map(q=>({question:q.question,status:'partial',evidenceIds:payload.evidence.slice(0,2).map(e=>e.id)}))};}
  else if(guard(authors)){value=authors;}
  else{
   writers++;if(deleteWriter){deleteWriter=false;pausedId=runtime.currentResearchHarness().record.summary.id;repo.deleteDictionaryEntries([runtime.currentResearchHarness().record.context.entryId]);runtime.currentResearchHarness().validate();}if(pauseWriter){pauseWriter=false;pausedId=runtime.currentResearchHarness().record.summary.id;runtime.interruptResearchRun(pausedId);runtime.currentResearchHarness().signal.throwIfAborted();}
   const start=options.user.lastIndexOf('\n[');assert.ok(start>=0,'Writer receives actual evidence');const evidence=JSON.parse(options.user.slice(start+1));
   value={paragraphs:[{claims:evidence.map(item=>({text:item.text.trim().replace(/[.!?]?$/,'.'),evidence:[{kind:item.type,id:item.id}]}))}]};
  }
  assert.ok(guard(value),'The real output contract accepts fixture output');return value;
 };
 load('electron/ai/deepResearch.ts').aiVerifyCitations=async claims=>{verifications++;if(pauseVerification){pauseVerification=false;pausedId=runtime.currentResearchHarness().record.summary.id;runtime.interruptResearchRun(pausedId);runtime.currentResearchHarness().signal.throwIfAborted();}return claims.map(()=>'supports');};
 const dictionary=load('electron/ai/dictionary.ts');
 const makeEntry=name=>repo.createDictionaryEntry({name,aliases:[],focusPrompt:'Explain the concept from these sources.',scope:{kind:'works',workIds:['dict-a','dict-b']},outputLanguage:'en',detailLevel:'concise',tags:[]});
 const entry=makeEntry('Memory'),request={entryId:entry.id,mode:'creation',harnessVersion:'v1',webSearch:'off',language:'en'};
 const result=await dictionary.generateDictionaryEntry(request);
 assert.ok(searches>0,'Dictionary actually enters the shared coordinator rather than exhausting its old decision allowance first');
 assert.equal(result.outcome,'synthesis');assert.equal(result.researchRun.mode,'dictionary');assert.equal(result.researchRun.entryId,entry.id);assert.ok(result.contentMarkdown.includes('nodus://passage/'));
 assert.equal(verifications,1,'The harness adds no second verification chain');assert.equal(repo.listDictionaryVersions(entry.id).length,1);assert.ok(result.researchRun.tasks.length);
 const stored=runs.getResearchRun(result.researchRun.id);assert.equal(stored.artifactId,result.id);assert.equal(stored.context.capabilities.restricted,true);
 assert.equal(runs.listResearchRuns(undefined,entry.id).length,1);
 const beforeWriters=writers;const replay=await dictionary.generateDictionaryEntry({...request,runId:stored.summary.id});assert.equal(replay.id,result.id);assert.equal(writers,beforeWriters);
 const other=makeEntry('Memory alternative');await assert.rejects(()=>dictionary.generateDictionaryEntry({...request,entryId:other.id,runId:stored.summary.id}),/not_authorized/);
 pauseWriter=true;await assert.rejects(()=>dictionary.generateDictionaryEntry({...request,entryId:other.id}),/research_run_paused/);assert.ok(pausedId);const paused=runs.getResearchRun(pausedId);assert.equal(paused.summary.status,'paused');const beforeSearches=searches;
 const {resumeResearchRun}=load('electron/ai/researchHarnessControls.ts');const resumed=await resumeResearchRun(pausedId);assert.equal(resumed.mode,'dictionary');assert.equal(searches,beforeSearches,'Completed retrieval is reused on continuation');assert.equal(repo.listDictionaryVersions(other.id).length,1);assert.equal(runs.getResearchRun(pausedId).summary.status,'completed');
 const saved=runs.getResearchRun(pausedId);saved.summary.status='paused';delete saved.result;runs.saveResearchRun(saved);const beforeSavedReplay=writers;await resumeResearchRun(pausedId);assert.equal(writers,beforeSavedReplay,'A saved artifact is reused after a pause before run settlement');assert.equal(repo.listDictionaryVersions(other.id).length,1);
 const interruptedReview=makeEntry('Memory review');pauseVerification=true;await assert.rejects(()=>dictionary.generateDictionaryEntry({...request,entryId:interruptedReview.id}),/paused/);const reviewId=pausedId,beforeReviewResume=writers;const narrowed=runs.getResearchRun(reviewId);narrowed.checkpoint.corpus.budget.decisionLimit=50000;runs.saveResearchRun(narrowed);await resumeResearchRun(reviewId);assert.equal(writers,beforeReviewResume,'A completed definition is not regenerated after pausing its existing verification');assert.equal(runs.getResearchRun(reviewId).checkpoint.corpus.budget.decisionLimit,50000,'Dictionary continuation cannot replenish a narrowed decision allowance');
 const changedEntry=makeEntry('Memory edited');pauseWriter=true;await assert.rejects(()=>dictionary.generateDictionaryEntry({...request,entryId:changedEntry.id}),/paused/);const changedId=pausedId;const current=repo.getDictionaryEntry(changedEntry.id);repo.updateDictionaryEntry(changedEntry.id,{focusPrompt:'A different editorial purpose'},current.updatedAt);const beforeRejectedResume=repo.listDictionaryVersions(changedEntry.id).length;await assert.rejects(()=>resumeResearchRun(changedId),/context_changed/);assert.equal(repo.listDictionaryVersions(changedEntry.id).length,beforeRejectedResume,'Edited editorial context cannot publish the previous definition');
 const scanEntry=makeEntry('Memory scan');await dictionary.retrieveDictionaryResearchEvidence(scanEntry.id,'scan',{harnessVersion:'v1',webSearch:'off'});const scan=runs.listResearchRuns(undefined,scanEntry.id)[0];assert.equal(runs.getResearchRun(scan.id).request.researchOperation,'scan');assert.equal(repo.listDictionaryVersions(scanEntry.id).length,0,'Explicit scans do not create definitions');
 const scanStored=runs.getResearchRun(scan.id);scanStored.summary.status='paused';delete scanStored.result;runs.saveResearchRun(scanStored);await resumeResearchRun(scan.id);assert.equal(repo.listDictionaryVersions(scanEntry.id).length,0);
 const deletedActive=makeEntry('Memory removed');deleteWriter=true;await assert.rejects(()=>dictionary.generateDictionaryEntry({...request,entryId:deletedActive.id}),/not_authorized/);assert.equal(runs.getResearchRun(pausedId),null,'A late stopped worker cannot resurrect a deleted checkpoint');
 repo.deleteDictionaryEntries([entry.id]);assert.equal(runs.getResearchRun(stored.summary.id),null,'Deleting an entry removes its research checkpoints');assert.ok(runs.getResearchRun(reviewId),'Another entry retains its own execution');
 console.log('Dictionary harness: actual generation, shared coordinator, restricted scope, unchanged verification, pause/resume, artifact reuse, scan continuation and owner deletion passed.');
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
