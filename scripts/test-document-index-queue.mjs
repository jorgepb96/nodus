import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-document-queue-'));
const outfile = path.join(root, 'queue.mjs');
globalThis.__documentQueue = {
  storage: new AsyncLocalStorage(),
  vaults: [
    { id:'v1',name:'Uno',type:'academic',origin:'local',remote:null },
    { id:'v2',name:'Dos',type:'academic',origin:'local',remote:null },
  ],
  works: new Map([['v1',[{nodus_id:'v1-w',title:'Obra V1'}]],['v2',[{nodus_id:'v2-w',title:'Obra V2'}]]]),
  data: new Map(), runs: [], seq: 0, continuousEnabled: false, failWorks: new Set(),
  logs: [],
  blockWorks: new Set(), abortedWorks: [], configWorks: new Set(), sourceChangedWorks: new Set(), sourceResetProgress: [],
  failVaultOpen: new Set(),
};
const state = (id) => {
  if (!globalThis.__documentQueue.data.has(id)) globalThis.__documentQueue.data.set(id,{campaigns:[],jobs:[],profiles:new Map()});
  return globalThis.__documentQueue.data.get(id);
};
state('v1');state('v2');

await build({
  entryPoints:[path.join(repoRoot,'electron/pipeline/documentIndexQueue.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node20',
  plugins:[{name:'queue-stubs',setup(api){
    const stub=(filter,name,contents)=>{api.onResolve({filter},()=>({path:name,namespace:'stub'}));api.onLoad({filter:new RegExp(`^${name}$`),namespace:'stub'},()=>({contents,loader:'js'}));};
    stub(/\.\.\/db\/database$/,'db',`
      export async function withVaultDatabase(id,fn){if(globalThis.__documentQueue.failVaultOpen.delete(id))throw new Error('database unavailable');return globalThis.__documentQueue.storage.run(id,fn)}
      export function getDb(){const id=globalThis.__documentQueue.storage.getStore();return {prepare(sql){return {
        all(){if(sql.includes('SELECT nodus_id FROM works')||sql.includes('SELECT w.nodus_id FROM works')){const works=globalThis.__documentQueue.works.get(id)||[];if(sql.includes('COALESCE')){const profiles=globalThis.__documentQueue.data.get(id).profiles;return works.filter(work=>['missing','stale'].includes(profiles.get(work.nodus_id)||'missing'))}return works}return []},
        get(nodusId){if(sql.includes('SELECT * FROM works'))return (globalThis.__documentQueue.works.get(id)||[]).find(w=>w.nodus_id===nodusId);return null}
      }}}}
    `);
    stub(/\.\.\/db\/settingsRepo$/,'settings',`export function getSettings(){return {documentIndexingEnabled:globalThis.__documentQueue.continuousEnabled,documentIndexIncludeArchived:false,documentIndexConcurrency:2,documentProfileModel:null,documentAuditModel:null,summaryModel:null,synthesisModel:null}}`);
    stub(/\.\.\/db\/documentProfilesRepo$/,'repo',`
      const current=()=>globalThis.__documentQueue.storage.getStore();const data=()=>globalThis.__documentQueue.data.get(current());
      const now=()=>new Date().toISOString();
      export function recoverInterruptedDocumentJobs(){return 0}
      export function createDocumentIndexCampaign(input){const c={campaignId:'c'+(++globalThis.__documentQueue.seq),vaultId:input.vaultId,mode:input.mode,status:'queued',includeArchived:input.includeArchived,totalJobs:0,completedJobs:0,failedJobs:0,estimatedUnits:0,completedUnits:0,inputTokens:0,outputTokens:0,estimatedCostUsd:null,error:null,createdAt:now(),updatedAt:now()};data().campaigns.push(c);return c}
      export function listDocumentIndexCampaigns(){return data().campaigns}
      export function listDocumentIndexJobs(){return data().jobs}
      export function documentProfileStatuses(ids){return ids.map(id=>({nodusId:id,status:data().profiles.get(id)||'missing',currentVersionId:null,sourceFingerprint:null,staleReason:null,error:null}))}
      export function enqueueDocumentIndexJob(input){let j=data().jobs.find(x=>x.nodusId===input.nodusId&&['queued','running','paused'].includes(x.status));if(j){j.priority=Math.max(j.priority,input.priority||0);return j}j={jobId:'j'+(++globalThis.__documentQueue.seq),campaignId:input.campaignId||null,vaultId:input.vaultId,nodusId:input.nodusId,title:(globalThis.__documentQueue.works.get(current())||[]).find(w=>w.nodus_id===input.nodusId)?.title,priority:input.priority||0,reason:input.reason,status:'queued',phase:'queued',progress:0,sourceFingerprint:null,generatorModel:input.generatorModel,auditorModel:input.auditorModel,attempts:0,maxAttempts:5,error:null,createdAt:now(),updatedAt:now()};data().jobs.push(j);data().profiles.set(input.nodusId,'queued');return j}
      export function setDocumentCampaignStatus(id,status){const c=data().campaigns.find(x=>x.campaignId===id);if(c)c.status=status;for(const j of data().jobs.filter(x=>x.campaignId===id)){if(status==='paused'&&['queued','running'].includes(j.status)){j.status='paused';j.phase='paused';data().profiles.set(j.nodusId,'paused')}if(status==='running'&&j.status==='paused'){j.status='queued';j.phase='queued';data().profiles.set(j.nodusId,'queued')}if(status==='cancelled'&&['queued','running','paused'].includes(j.status)){j.status='cancelled';j.phase='done';data().profiles.set(j.nodusId,'missing')}}}
      export function claimNextDocumentIndexJob(){const j=data().jobs.find(x=>x.status==='queued'&&(!x.campaignId||['queued','running'].includes(data().campaigns.find(c=>c.campaignId===x.campaignId)?.status)));if(!j)return null;j.status='running';j.attempts++;data().profiles.set(j.nodusId,'structuring');return {...j}}
      export function updateDocumentIndexJob(id,patch){const j=data().jobs.find(x=>x.jobId===id);Object.assign(j,patch,{updatedAt:now()});if(j.status==='completed')data().profiles.set(j.nodusId,'current');const c=data().campaigns.find(x=>x.campaignId===j.campaignId);if(c&&!data().jobs.some(x=>x.campaignId===c.campaignId&&['queued','running'].includes(x.status)))c.status='completed';return j}
      export function requeueDocumentIndexJobForSourceChange(id){const j=data().jobs.find(x=>x.jobId===id);j.status='queued';j.phase='queued';j.progress=0;j.error='La obra cambió';globalThis.__documentQueue.sourceResetProgress.push(j.progress);data().profiles.set(j.nodusId,'queued');return 'queued'}
      export function cancelDocumentIndexJob(id){const job=updateDocumentIndexJob(id,{status:'cancelled',error:'Cancelado por el usuario.'});if(job)data().profiles.set(job.nodusId,'missing');return job}
      export function setDocumentProfileState(id,status){data().profiles.set(id,status)}
    `);
    stub(/\.\.\/db\/worksRepo$/,'works',`export function clearResolvedDocumentaryDeepErrors(){return 0}`);
    stub(/\.\.\/vaults\/vaultRegistry$/,'vaults',`export function listVaults(){return globalThis.__documentQueue.vaults}export function getVault(id){return globalThis.__documentQueue.vaults.find(v=>v.id===id)||null}`);
    stub(/\.\.\/ai\/documentProfile$/,'scan',`export async function runDocumentProfileScan(work,options){const vault=globalThis.__documentQueue.storage.getStore();globalThis.__documentQueue.runs.push({vault,work:work.nodus_id});options?.onProgress?.({phase:'analyzing_sections',progress:.4,message:'working'});if(globalThis.__documentQueue.blockWorks.has(work.nodus_id)){await new Promise((resolve,reject)=>{const stop=()=>{globalThis.__documentQueue.blockWorks.delete(work.nodus_id);globalThis.__documentQueue.abortedWorks.push(work.nodus_id);reject(new Error('aborted'))};if(options.signal?.aborted)stop();else options.signal?.addEventListener('abort',stop,{once:true})})}await new Promise(r=>setTimeout(r,5));if(globalThis.__documentQueue.sourceChangedWorks.delete(work.nodus_id))throw new Error('DOCUMENT_SOURCE_CHANGED');if(globalThis.__documentQueue.configWorks.has(work.nodus_id))throw new globalThis.__documentQueue.AiError('Clave inválida',false,true);if(globalThis.__documentQueue.failWorks.has(work.nodus_id))throw new Error('provider rejected this document');return 'version'}`);
    stub(/\.\.\/ai\/aiClient$/,'ai',`export class AiError extends Error{constructor(message,retriable=false,config=false){super(message);this.retriable=retriable;this.config=config}}globalThis.__documentQueue.AiError=AiError`);
    stub(/\.\.\/util\/coalesce$/,'coalesce',`export function coalesce(fn){return {schedule:fn}}`);
    // The processing log, recorded instead of written. The scope is pushed so the assertions
    // can prove the attribution (vault + document + job) reaches every line.
    stub(/\.\.\/logging\/pipelineLogCore$/,'log',`
      export function withPipelineLogScope(context,work){globalThis.__documentQueue.logs.push({kind:'scope',context});return work()}
      export function logPipelineSuccess(input){globalThis.__documentQueue.logs.push({kind:'success',...input})}
      export function logPipelineWarning(input){globalThis.__documentQueue.logs.push({kind:'warning',...input})}
      export function logPipelineFailure(input){globalThis.__documentQueue.logs.push({kind:'failure',...input})}
      export function logPipelineEvent(input){globalThis.__documentQueue.logs.push({kind:'event',...input})}
    `);
  }}]
});

const {documentIndexQueue}=await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
test.after(async()=>{documentIndexQueue.stop();delete globalThis.__documentQueue;await rm(root,{recursive:true,force:true})});

test('persistent scheduler processes two vaults without using an active-vault singleton',async()=>{
  await documentIndexQueue.startVaultCampaign('v1',{mode:'manual'});
  await documentIndexQueue.startVaultCampaign('v2',{mode:'manual'});
  const deadline=Date.now()+2000;
  let snapshot;
  do{await new Promise(r=>setTimeout(r,20));snapshot=await documentIndexQueue.snapshot();}while((snapshot.active||snapshot.queued)&&Date.now()<deadline);
  assert.equal(snapshot.active,0);assert.equal(snapshot.queued,0);
  assert.deepEqual(new Set(globalThis.__documentQueue.runs.map(run=>run.vault)),new Set(['v1','v2']));
  assert.ok(globalThis.__documentQueue.runs.some(run=>run.work==='v1-w'));
  assert.ok(globalThis.__documentQueue.runs.some(run=>run.work==='v2-w'));
  assert.equal(snapshot.campaigns.filter(c=>c.status==='completed').length,2);
});

test('continuous mode stays disabled until the beta policy is reopened',async()=>{
  globalThis.__documentQueue.continuousEnabled=true;
  await documentIndexQueue.configureContinuous('v1',true);
  globalThis.__documentQueue.works.get('v1').push({nodus_id:'v1-new',title:'Obra recién importada'});
  await documentIndexQueue.refreshVault('v1');
  await new Promise(r=>setTimeout(r,60));
  assert.equal(globalThis.__documentQueue.data.get('v1').profiles.get('v1-new'),undefined);
  assert.ok(!globalThis.__documentQueue.runs.some(run=>run.vault==='v1'&&run.work==='v1-new'));
  assert.ok(!globalThis.__documentQueue.runs.some(run=>run.vault==='v2'&&run.work==='v1-new'));
});

test('deliberate research may continue when one optional profile fails',async()=>{
  globalThis.__documentQueue.works.get('v1').push({nodus_id:'v1-fail',title:'Obra no preparable'});
  globalThis.__documentQueue.failWorks.add('v1-fail');
  await documentIndexQueue.ensureProfiles('v1',['v1-fail'],'research',{allowUnavailable:true,allowFailed:true});
  assert.equal(globalThis.__documentQueue.data.get('v1').profiles.get('v1-fail'),'failed');
});

test('a paused profile terminates the research barrier instead of polling forever',async()=>{
  globalThis.__documentQueue.works.get('v1').push({nodus_id:'v1-paused-barrier',title:'Obra pausada'});
  globalThis.__documentQueue.blockWorks.add('v1-paused-barrier');
  const campaign=await documentIndexQueue.startVaultCampaign('v1',{mode:'manual',nodusIds:['v1-paused-barrier']});
  const deadline=Date.now()+2000;
  let job;
  do{await new Promise(r=>setTimeout(r,10));job=globalThis.__documentQueue.data.get('v1').jobs.find(x=>x.nodusId==='v1-paused-barrier')}while(job?.status!=='running'&&Date.now()<deadline);
  assert.equal(job.status,'running');
  await documentIndexQueue.setCampaignStatus('v1',campaign.campaignId,'paused');
  do{await new Promise(r=>setTimeout(r,10));}while(job.status!=='paused'&&Date.now()<deadline);
  await assert.rejects(
    Promise.race([
      documentIndexQueue.ensureProfiles('v1',['v1-paused-barrier'],'research',{allowUnavailable:true,allowFailed:true}),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('barrier timed out')),500)),
    ]),
    /quedaron en pausa/,
  );
  await documentIndexQueue.setCampaignStatus('v1',campaign.campaignId,'cancelled');
});

test('pause aborts the active provider call, is vault-scoped, and resumes the same persisted job',async()=>{
  globalThis.__documentQueue.works.get('v2').push({nodus_id:'v2-pause',title:'Obra bloqueable'});
  globalThis.__documentQueue.blockWorks.add('v2-pause');
  const campaign=await documentIndexQueue.startVaultCampaign('v2',{mode:'manual',nodusIds:['v2-pause']});
  const deadline=Date.now()+2000;
  let job;
  do{await new Promise(r=>setTimeout(r,10));job=globalThis.__documentQueue.data.get('v2').jobs.find(x=>x.nodusId==='v2-pause')}while(job?.status!=='running'&&Date.now()<deadline);
  assert.equal(job.status,'running');
  const originalJobId=job.jobId;
  await documentIndexQueue.setCampaignStatus('v2',campaign.campaignId,'paused');
  do{await new Promise(r=>setTimeout(r,10));}while(!globalThis.__documentQueue.abortedWorks.includes('v2-pause')&&Date.now()<deadline);
  assert.ok(globalThis.__documentQueue.abortedWorks.includes('v2-pause'),'pause actively aborts the in-flight provider operation');
  assert.equal(job.status,'paused');
  assert.equal(globalThis.__documentQueue.data.get('v2').profiles.get('v2-pause'),'paused');
  assert.ok(!globalThis.__documentQueue.data.get('v1').jobs.some(x=>x.nodusId==='v2-pause'),'cross-vault control never touches the active/other vault');
  await documentIndexQueue.setCampaignStatus('v2',campaign.campaignId,'running');
  do{await new Promise(r=>setTimeout(r,10));}while(globalThis.__documentQueue.data.get('v2').profiles.get('v2-pause')!=='current'&&Date.now()<deadline);
  assert.equal(globalThis.__documentQueue.data.get('v2').profiles.get('v2-pause'),'current');
  assert.equal(job.jobId,originalJobId,'resume retains the same job/checkpoint identity');
});

test('stop aborts active work and never resurrects cancelled jobs',async()=>{
  globalThis.__documentQueue.works.get('v1').push({nodus_id:'v1-stop',title:'Obra detenible'});
  globalThis.__documentQueue.blockWorks.add('v1-stop');
  const campaign=await documentIndexQueue.startVaultCampaign('v1',{mode:'manual',nodusIds:['v1-stop']});
  const deadline=Date.now()+2000;
  let job;
  do{await new Promise(r=>setTimeout(r,10));job=globalThis.__documentQueue.data.get('v1').jobs.find(x=>x.nodusId==='v1-stop')}while(job?.status!=='running'&&Date.now()<deadline);
  assert.equal(job.status,'running');
  await documentIndexQueue.setCampaignStatus('v1',campaign.campaignId,'cancelled');
  do{await new Promise(r=>setTimeout(r,10));}while(!globalThis.__documentQueue.abortedWorks.includes('v1-stop')&&Date.now()<deadline);
  assert.ok(globalThis.__documentQueue.abortedWorks.includes('v1-stop'));
  assert.equal(job.status,'cancelled');
  assert.equal(globalThis.__documentQueue.data.get('v1').profiles.get('v1-stop'),'missing');
  await new Promise(r=>setTimeout(r,40));
  assert.equal(globalThis.__documentQueue.runs.filter(run=>run.work==='v1-stop').length,1,'a cancelled job is never claimed again');
});

test('cancelling one active job aborts its provider call without stopping its vault',async()=>{
  globalThis.__documentQueue.works.get('v2').push({nodus_id:'v2-job-stop',title:'Obra detenible individualmente'});
  globalThis.__documentQueue.blockWorks.add('v2-job-stop');
  const job=await documentIndexQueue.enqueueWork('v2','v2-job-stop',500,'manual');
  const deadline=Date.now()+2000;
  do{await new Promise(r=>setTimeout(r,10));}while(job.status!=='running'&&Date.now()<deadline);
  assert.equal(job.status,'running');
  await documentIndexQueue.cancelJob('v2',job.jobId);
  do{await new Promise(r=>setTimeout(r,10));}while(!globalThis.__documentQueue.abortedWorks.includes('v2-job-stop')&&Date.now()<deadline);
  assert.ok(globalThis.__documentQueue.abortedWorks.includes('v2-job-stop'));
  assert.equal(job.status,'cancelled');
  assert.equal(globalThis.__documentQueue.data.get('v2').profiles.get('v2-job-stop'),'missing');

  globalThis.__documentQueue.works.get('v2').push({nodus_id:'v2-after-job-stop',title:'Obra posterior'});
  await documentIndexQueue.enqueueWork('v2','v2-after-job-stop',500,'manual');
  do{await new Promise(r=>setTimeout(r,10));}while(globalThis.__documentQueue.data.get('v2').profiles.get('v2-after-job-stop')!=='current'&&Date.now()<deadline);
  assert.equal(globalThis.__documentQueue.data.get('v2').profiles.get('v2-after-job-stop'),'current');
});

test('a source change at publication is retried with the fresh document',async()=>{
  globalThis.__documentQueue.works.get('v1').push({nodus_id:'v1-source-race',title:'Obra que cambia'});
  globalThis.__documentQueue.sourceChangedWorks.add('v1-source-race');
  await documentIndexQueue.enqueueWork('v1','v1-source-race',500,'manual');
  const deadline=Date.now()+2000;
  do{await new Promise(r=>setTimeout(r,10));}while(globalThis.__documentQueue.data.get('v1').profiles.get('v1-source-race')!=='current'&&Date.now()<deadline);
  assert.equal(globalThis.__documentQueue.data.get('v1').profiles.get('v1-source-race'),'current');
  assert.equal(globalThis.__documentQueue.runs.filter(run=>run.work==='v1-source-race').length,2);
  assert.equal(globalThis.__documentQueue.sourceResetProgress.at(-1),0,'a new source revision restarts visible progress');
});

test('double start reuses the same live campaign instead of creating a ghost campaign',async()=>{
  globalThis.__documentQueue.works.get('v2').push({nodus_id:'v2-double-start',title:'Obra una sola vez'});
  globalThis.__documentQueue.blockWorks.add('v2-double-start');
  const [first,second]=await Promise.all([
    documentIndexQueue.startVaultCampaign('v2',{mode:'manual',nodusIds:['v2-double-start']}),
    documentIndexQueue.startVaultCampaign('v2',{mode:'manual',nodusIds:['v2-double-start']}),
  ]);
  assert.equal(second.campaignId,first.campaignId);
  assert.equal(globalThis.__documentQueue.data.get('v2').campaigns.filter(c=>c.campaignId===first.campaignId).length,1);
  globalThis.__documentQueue.works.get('v2').push({nodus_id:'v2-merged-scope',title:'Obra añadida al alcance'});
  const merged=await documentIndexQueue.startVaultCampaign('v2',{mode:'manual',nodusIds:['v2-merged-scope']});
  assert.equal(merged.campaignId,first.campaignId,'a live campaign is reused');
  assert.equal(
    globalThis.__documentQueue.data.get('v2').jobs.find(job=>job.nodusId==='v2-merged-scope')?.campaignId,
    first.campaignId,
    'reusing a campaign reconciles the newly requested scope instead of silently dropping it',
  );
  await documentIndexQueue.setCampaignStatus('v2',first.campaignId,'cancelled');
});

test('vault maintenance aborts and drains its worker before database replacement',async()=>{
  globalThis.__documentQueue.works.get('v1').push({nodus_id:'v1-maintenance',title:'Obra durante mantenimiento'});
  globalThis.__documentQueue.blockWorks.add('v1-maintenance');
  const job=await documentIndexQueue.enqueueWork('v1','v1-maintenance',500,'manual');
  const deadline=Date.now()+2000;
  do{await new Promise(r=>setTimeout(r,10));}while(job.status!=='running'&&Date.now()<deadline);
  await documentIndexQueue.pauseVaultAndDrain('v1');
  assert.equal(job.status,'paused');
  assert.ok(globalThis.__documentQueue.abortedWorks.includes('v1-maintenance'));
  await assert.rejects(documentIndexQueue.enqueueWork('v1','v1-maintenance',500,'manual'),/mantenimiento/);
  await documentIndexQueue.cancelJob('v1',job.jobId);
  await documentIndexQueue.resumeVaultAfterMaintenance('v1');
});

test('failed maintenance acquisition releases the vault lock',async()=>{
  globalThis.__documentQueue.failVaultOpen.add('v1');
  await assert.rejects(documentIndexQueue.pauseVaultAndDrain('v1'),/database unavailable/);
  globalThis.__documentQueue.works.get('v1').push({nodus_id:'v1-after-maintenance-error',title:'Obra tras error'});
  const job=await documentIndexQueue.enqueueWork('v1','v1-after-maintenance-error',500,'manual');
  assert.ok(job,'the transient database error cannot leave indexing permanently locked');
});

test('global maintenance drains every vault and rejects new work until restore completes',async()=>{
  globalThis.__documentQueue.works.get('v1').push({nodus_id:'v1-global-maintenance',title:'Obra global uno'});
  globalThis.__documentQueue.works.get('v2').push({nodus_id:'v2-global-maintenance',title:'Obra global dos'});
  globalThis.__documentQueue.blockWorks.add('v1-global-maintenance');
  globalThis.__documentQueue.blockWorks.add('v2-global-maintenance');
  const [first,second]=await Promise.all([
    documentIndexQueue.enqueueWork('v1','v1-global-maintenance',500,'manual'),
    documentIndexQueue.enqueueWork('v2','v2-global-maintenance',500,'manual'),
  ]);
  const deadline=Date.now()+2000;
  do{await new Promise(r=>setTimeout(r,10));}while((first.status!=='running'||second.status!=='running')&&Date.now()<deadline);
  assert.equal(first.status,'running');
  assert.equal(second.status,'running');
  const pausedVaults=await documentIndexQueue.pauseAllAndDrain();
  assert.deepEqual(new Set(pausedVaults),new Set(['v1','v2']));
  assert.equal(first.status,'paused');
  assert.equal(second.status,'paused');
  assert.ok(globalThis.__documentQueue.abortedWorks.includes('v1-global-maintenance'));
  assert.ok(globalThis.__documentQueue.abortedWorks.includes('v2-global-maintenance'));
  await assert.rejects(documentIndexQueue.enqueueWork('v1','v1-global-maintenance',500,'manual'),/mantenimiento/);
  await assert.rejects(documentIndexQueue.startVaultCampaign('v2',{mode:'manual'}),/mantenimiento/);
  await documentIndexQueue.resumeAllAfterMaintenance(pausedVaults);
  do{await new Promise(r=>setTimeout(r,10));}while((first.status!=='completed'||second.status!=='completed')&&Date.now()<deadline);
  assert.equal(first.status,'completed');
  assert.equal(second.status,'completed');
});

test('configuration errors pause a resumable job with an actionable cause',async()=>{
  globalThis.__documentQueue.works.get('v1').push({nodus_id:'v1-config',title:'Obra con clave inválida'});
  globalThis.__documentQueue.configWorks.add('v1-config');
  const campaign=await documentIndexQueue.startVaultCampaign('v1',{mode:'manual',nodusIds:['v1-config']});
  const deadline=Date.now()+2000;
  let job;
  do{await new Promise(r=>setTimeout(r,10));job=globalThis.__documentQueue.data.get('v1').jobs.find(x=>x.nodusId==='v1-config')}while(job?.status!=='paused'&&Date.now()<deadline);
  assert.equal(job.status,'paused');
  assert.match(job.error,/Clave inválida/);
  assert.equal(globalThis.__documentQueue.data.get('v1').campaigns.find(c=>c.campaignId===campaign.campaignId).status,'paused');
  globalThis.__documentQueue.configWorks.delete('v1-config');
  await documentIndexQueue.setCampaignStatus('v1',campaign.campaignId,'running');
  do{await new Promise(r=>setTimeout(r,10));}while(globalThis.__documentQueue.data.get('v1').profiles.get('v1-config')!=='current'&&Date.now()<deadline);
  assert.equal(globalThis.__documentQueue.data.get('v1').profiles.get('v1-config'),'current');
});

test('progress snapshots bound historical campaign metadata',async()=>{
  const data=globalThis.__documentQueue.data.get('v1');
  const now=new Date().toISOString();
  for(let index=0;index<160;index++)data.campaigns.push({campaignId:`history-${index}`,vaultId:'v1',mode:'manual',status:'completed',includeArchived:false,totalJobs:1,completedJobs:1,failedJobs:0,estimatedUnits:1,completedUnits:1,inputTokens:0,outputTokens:0,estimatedCostUsd:null,error:null,createdAt:now,updatedAt:now});
  const snapshot=await documentIndexQueue.snapshot();
  assert.ok(snapshot.campaigns.filter(c=>c.vaultId==='v1'&&c.status==='completed').length<=100);
});

test('every job outcome reaches the processing log, attributed to its vault and document',async()=>{
  const drain=async(campaignId)=>{const deadline=Date.now()+3000;let jobs;
    do{await new Promise(r=>setTimeout(r,10));jobs=globalThis.__documentQueue.data.get('v1').jobs.filter(j=>!campaignId||j.campaignId===campaignId)}while(jobs.some(j=>['queued','running'].includes(j.status))&&Date.now()<deadline)};

  // 1) a provider failure: an error line with the pipeline's own code.
  globalThis.__documentQueue.logs.length=0;
  globalThis.__documentQueue.works.get('v1').push({nodus_id:'v1-log-fail',title:'Obra que falla'});
  globalThis.__documentQueue.failWorks.add('v1-log-fail');
  const failed=await documentIndexQueue.startVaultCampaign('v1',{mode:'manual',nodusIds:['v1-log-fail']});
  await drain(failed.campaignId);
  const failure=globalThis.__documentQueue.logs.find(entry=>entry.kind==='failure'&&entry.code==='index_failed');
  assert.ok(failure,'a failed document must be recorded');
  assert.equal(failure.subject,'subjectIndexing');
  assert.match(failure.detail,/provider rejected this document/,'the cause is kept verbatim');
  const scope=globalThis.__documentQueue.logs.find(entry=>entry.kind==='scope'&&entry.context.documentTitle==='Obra que falla');
  assert.ok(scope,'the failing document must open a log scope');
  assert.equal(scope.context.vaultId,'v1','the line must be attributed to its vault');
  assert.equal(scope.context.nodusId,'v1-log-fail','…and to its document');
  assert.ok(scope.context.jobId,'…and to its job');
  assert.equal(scope.context.model,null,'a job with no per-job model must not invent one');

  // 2) a source change is a warning that says the job was requeued, not a failure.
  globalThis.__documentQueue.logs.length=0;
  globalThis.__documentQueue.works.get('v1').push({nodus_id:'v1-log-source',title:'Obra cambiada'});
  globalThis.__documentQueue.sourceChangedWorks.add('v1-log-source');
  await documentIndexQueue.startVaultCampaign('v1',{mode:'manual',nodusIds:['v1-log-source']});
  await drain();
  assert.ok(globalThis.__documentQueue.logs.some(entry=>entry.kind==='warning'&&entry.code==='source_changed'));

  // 3) a job that fails also settles its campaign, and that summary is the line that answers
  //    "how much of the corpus made it?" — written once, not once per settling job.
  const summary=globalThis.__documentQueue.logs.find(entry=>entry.message?.id==='campaignFinished');
  assert.ok(summary,'a settled campaign must leave its totals in the log');
  assert.ok(summary.message.params,'the summary must carry the counts');
  assert.ok(['success','warning'].includes(summary.kind));
  const before=globalThis.__documentQueue.logs.filter(entry=>entry.message?.id==='campaignFinished').length;
  await drain(failed.campaignId);
  assert.equal(globalThis.__documentQueue.logs.filter(entry=>entry.message?.id==='campaignFinished').length,before,
    'the campaign summary is written once, not on every subsequent settle');

  // 4) a configuration error pauses the queue once, and that pause is in the log.
  globalThis.__documentQueue.logs.length=0;
  globalThis.__documentQueue.works.get('v1').push({nodus_id:'v1-log-config',title:'Obra sin clave'});
  globalThis.__documentQueue.configWorks.add('v1-log-config');
  const paused=await documentIndexQueue.startVaultCampaign('v1',{mode:'manual',nodusIds:['v1-log-config']});
  await drain(paused.campaignId);
  assert.ok(globalThis.__documentQueue.logs.some(entry=>entry.kind==='failure'&&entry.code==='queue_paused'));
  globalThis.__documentQueue.configWorks.delete('v1-log-config');
});
