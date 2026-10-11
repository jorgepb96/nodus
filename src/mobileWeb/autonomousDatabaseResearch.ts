import {processDatabaseResearchRun,sha256Snapshot,type DatabaseResearchHost} from '@shared/databaseResearchEngine';
import {mobileDatabaseSources,mobileDatabaseResearchHost,MobileDatabaseResearchRepository,createMobileDatabaseResearchDetail,validateMobileDatabaseSourcePack,type MobileDatabaseSourcePack} from '@shared/mobileDatabaseResearch';
import {databaseResearchCompletionInput} from '@shared/databaseResearchCompletion';
import {isDatabaseDeepResearchPlannerOutput,isDatabaseDeepResearchCriticOutput,isDatabaseDeepResearchVerifierOutput,isDatabaseDeepResearchNarrativeOutput} from '@shared/databaseDeepResearchPrompts';
import {normalizeDatabaseDeepResearchJobInput,type DatabaseDeepResearchJobInput,type DatabaseResearchRunDetail,type DatabaseResearchReport,type DatabaseResearchProgress} from '@shared/databaseDeepResearch';
import {structuredPrompt} from './structuredPrompt';
import type {DatabaseResearchReportSummary} from '../views/DatabaseDeepResearchView';
import {normalizeDatabaseDeepResearchReportType} from '@shared/databaseDeepResearch';

type Call=(method:string,...args:any[])=>Promise<any>;
export interface DatabaseResearchCheckpoint {
  id:string;entityKey:string;request:DatabaseDeepResearchJobInput;state:'accepted'|'running'|'saved'|'available'|'failed'|'cancelled';
  context?:{revision:string;packs:MobileDatabaseSourcePack[]};detail?:DatabaseResearchRunDetail;result?:DatabaseResearchReport;error?:string;publicationPending?:boolean;
  reader?:{version:1;report:DatabaseResearchReport;sourceRevision:string};reading?:unknown;
}
const active=new Map<string,{checkpoint:DatabaseResearchCheckpoint;controller:AbortController;task:Promise<void>}>();
export async function databaseResearchCheckpoints(call:Call):Promise<DatabaseResearchCheckpoint[]> {
  const values=await call('mobileDatabaseResearchCheckpoints');if(!Array.isArray(values))throw new Error('invalid_database_checkpoints');return values;
}
function analysisWorker(controller:AbortController):DatabaseResearchHost['analyze'] {
  return async(request,deps)=>{
    controller.signal.throwIfAborted();
    const snapshot=deps.readSnapshot!(request.databaseId,request.budget?.maxRows??500_000),columns=deps.readColumns!(request.databaseId);
    const worker=new Worker(new URL('./databaseResearchWorker.ts',import.meta.url),{type:'module'});
    return new Promise((resolve,reject)=>{
      const close=()=>{controller.signal.removeEventListener('abort',abort);worker.terminate();};
      const abort=()=>{close();reject(new DOMException('Investigación cancelada.','AbortError'));};
      controller.signal.addEventListener('abort',abort,{once:true});
      worker.onerror=event=>{close();reject(new Error(event.message||'No se pudo ejecutar el cálculo local.'));};
      worker.onmessage=event=>{if(event.data.progress)return;close();event.data.error?reject(new Error(event.data.error)):resolve(event.data.result);};
      worker.postMessage({request,snapshot,columns});
    });
  };
}
export async function enqueueAutonomousDatabaseResearch(call:Call,raw:DatabaseDeepResearchJobInput,notify:(progress:DatabaseResearchProgress)=>void):Promise<'accepted'> {
  const request=normalizeDatabaseDeepResearchJobInput(raw),entityKey=sha256Snapshot(request);
  if(active.has(entityKey))return 'accepted';
  const previous=await call('mobileGenerationCheckpoint','load','database',entityKey) as DatabaseResearchCheckpoint|null;
  const checkpoint:DatabaseResearchCheckpoint=previous&&!['available','cancelled'].includes(previous.state)?previous:{id:crypto.randomUUID(),entityKey,request,state:'accepted'};
  if(!checkpoint.request.model)throw new Error('Elige el modelo y configura su proveedor en los ajustes del móvil.');
  await call('mobileGenerationCheckpoint','save','database',entityKey,checkpoint);
  const controller=new AbortController();
  const task=execute(call,checkpoint,controller,notify).finally(()=>active.delete(entityKey));
  active.set(entityKey,{checkpoint,controller,task});void task.catch(()=>{});return 'accepted';
}
async function execute(call:Call,checkpoint:DatabaseResearchCheckpoint,controller:AbortController,notify:(progress:DatabaseResearchProgress)=>void) {
  const save=()=>call('mobileGenerationCheckpoint','save','database',checkpoint.entityKey,checkpoint);
  let writes=Promise.resolve();
  const persist=()=>{const snapshot=structuredClone(checkpoint);writes=writes.then(()=>call('mobileGenerationCheckpoint','save','database',checkpoint.entityKey,snapshot)).then(()=>{});return writes;};
  try {
    if(checkpoint.state==='saved'&&checkpoint.detail?.report) {await publish();return;}
    if(!checkpoint.context) {
      let packs:MobileDatabaseSourcePack[];
      try {packs=[await call('getMobileDatabaseResearchSourcePack',{databaseIds:checkpoint.request.databaseIds})];}
      catch(error) {if((error as {code?:string})?.code!=='offline')throw error;const copy=await call('getDatabaseResearchOfflineSource',{databaseIds:checkpoint.request.databaseIds});if(copy?.version!==1||!Array.isArray(copy.packs))throw new Error('invalid_database_source_copy');packs=copy.packs;}
      packs.forEach(validateMobileDatabaseSourcePack);
      if(new TextEncoder().encode(JSON.stringify(packs)).length>16_000_000)throw new Error('La selección es demasiado grande para investigarla en el móvil. Selecciona menos bases.');
      checkpoint.context={packs,revision:sha256Snapshot(packs.map(pack=>pack.id))};await save();
    }
    const sources=mobileDatabaseSources(checkpoint.context.packs,checkpoint.request.databaseIds);
    checkpoint.detail??=createMobileDatabaseResearchDetail(`dbr_mobile_${checkpoint.id}`,checkpoint.request,sources);
    if(checkpoint.detail.run.status==='failed') {checkpoint.detail.run.status='queued';checkpoint.detail.run.error=null;}
    const repository=new MobileDatabaseResearchRepository(checkpoint.detail);
    checkpoint.state='running';delete checkpoint.error;await save();
    await processDatabaseResearchRun(repository.detail.run.id,{onProgress:progress=>{controller.signal.throwIfAborted();notify(progress);void persist().catch(()=>controller.abort());},complete:async input=>{
      controller.signal.throwIfAborted();await writes;
      const prompt=databaseResearchCompletionInput(input);
      const raw=await call('mobileStructuredCompletion',{...structuredPrompt(prompt,checkpoint.request.model!,checkpoint.request.thinkingEffort),generationId:checkpoint.id});
      const value=typeof raw==='string'?JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,'')):raw;
      const valid=input.role==='planner'?isDatabaseDeepResearchPlannerOutput:input.role==='critic'?isDatabaseDeepResearchCriticOutput:input.role==='verifier'?isDatabaseDeepResearchVerifierOutput:isDatabaseDeepResearchNarrativeOutput;
      if(!valid(value))throw new Error('El modelo no devolvió la estructura requerida para la investigación de datos.');return JSON.stringify(value);
    }},mobileDatabaseResearchHost(repository,sources,analysisWorker(controller)));
    await writes;controller.signal.throwIfAborted();
    const report=checkpoint.detail.report!;
    const {updatedAt:_updated,readAt:_read,...source}=report;
    checkpoint.reader={version:1,report,sourceRevision:sha256Snapshot(source)};
    const reading={readAt:null,annotations:[]};
    checkpoint.reading={version:1,reportId:report.id,reportTitle:report.title,sourceRevision:checkpoint.reader.sourceRevision,readingRevision:sha256Snapshot(reading),reading};
    checkpoint.state='saved';await save();await publish();
  } catch(error) {
    await writes.catch(()=>{});
    if(checkpoint.state==='saved') {checkpoint.publicationPending=true;checkpoint.error=String(error);await save();return;}
    checkpoint.state=controller.signal.aborted?'cancelled':'failed';checkpoint.error=String(error);
    if(checkpoint.detail) {checkpoint.detail.run.status=controller.signal.aborted?'cancelled':'failed';checkpoint.detail.run.error=checkpoint.error;}
    await save();if(checkpoint.detail)notify({runId:checkpoint.detail.run.id,status:checkpoint.detail.run.status,progress:checkpoint.detail.run.progress,phase:checkpoint.detail.run.phase,step:checkpoint.detail.run.currentStep,message:checkpoint.error,error:checkpoint.error});
    throw error;
  }
  async function publish() {
    checkpoint.result=await call('saveMobileDatabaseResearchReport',{request:checkpoint.request,sourcePacks:checkpoint.context!.packs,detail:checkpoint.detail,requestId:checkpoint.id});
    checkpoint.state='available';delete checkpoint.context;delete checkpoint.error;delete checkpoint.publicationPending;await save();
  }
}
export async function localDatabaseResearchJobs(call:Call) {
  return (await databaseResearchCheckpoints(call)).filter(item=>item.detail).map(item=>({...item.detail!.run,
    status:['accepted','running'].includes(item.state)&&!active.has(item.entityKey)?'stale':item.detail!.run.status,
    error:['accepted','running'].includes(item.state)&&!active.has(item.entityKey)?'Investigación pausada en este dispositivo. Vuelve a iniciar la misma solicitud para continuar.':item.error??item.detail!.run.error,
    reportId:item.result?.id??item.detail!.report?.id??null}));
}
export async function cancelLocalDatabaseResearch(call:Call,runId:string):Promise<boolean> {
  const run=[...active.values()].find(item=>item.checkpoint.detail?.run.id===runId);if(!run)return false;
  run.controller.abort();await call('cancelAutonomousGeneration',run.checkpoint.id);await run.task.catch(()=>{});return true;
}
export async function localDatabaseResearchReports(call:Call):Promise<DatabaseResearchReportSummary[]> {
  return (await databaseResearchCheckpoints(call)).flatMap(item=>{
    const report=item.result??item.detail?.report;if(!report)return [];
    return [{id:report.id,runId:report.runId,title:report.title,summary:report.summary??'',createdAt:report.createdAt,readAt:report.readAt,reportType:normalizeDatabaseDeepResearchReportType(report.reportType),qualityStatus:String(report.quality?.status??''),costUsd:Number(report.metadata?.estimatedCostUsd??0)}];
  });
}
