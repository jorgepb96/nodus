import {createHash} from 'node:crypto';
import {canonicalJson} from '../../shared/canonicalJson';
import { mobileDatabaseActionRequest, compileMobileDatabaseButton, type MobileButtonContext } from '../../shared/mobileDatabaseActions';
import {aiColumnSystem,buildAiCellPrompt,buildAiImagePrompt,buildAiRowContext} from '../../shared/databaseAi';
import {attachmentKind} from '../../shared/databases';
import {isVisionMime} from '../../shared/imageAnalysis';
import {getDb} from '../db/database';
import {portablePageDocument} from './pageDocuments';
import {getSettings} from '../db/settingsRepo';
import {getColumn,getDatabaseDetail,getRow,listAttachments,getAttachmentBlob,setCell,addAttachment,deleteAttachment,getColumns,listRelations,createRow} from '../db/databasesRepo';
import {getPageDocumentForRow,savePageDocument} from '../db/pagesRepo';
import {listAutomationRules,runDatabaseButtonAutomation} from '../db/databaseAutomationsRepo';
import {readMobileDatabaseUploadedBlob,completeMobileDatabaseUploadedBlob,stageMobileDatabaseImageBytes} from './databaseAttachmentUploads';

function buttonContext(rowId:string,databaseId:string):MobileButtonContext {
  const context:MobileButtonContext={rows:[],columns:[],rules:[],relations:[]},databases=new Set<string>(),rowIds=new Set<string>(),pendingDatabases=[databaseId],pendingRows=[rowId];
  for(let iteration=0;pendingDatabases.length||pendingRows.length;iteration++) {
    if(iteration>500||databases.size>32||context.rows.length>500||context.rules.length>128)throw new Error('database_action_context_limit');
    while(pendingDatabases.length) {
      const id=pendingDatabases.shift()!;if(databases.has(id))continue;databases.add(id);const columns=getColumns(id);if(!columns.length)throw new Error('database_action_context_incomplete');context.columns.push(...columns);
      const rules=listAutomationRules(id);context.rules.push(...rules);
      for(const rule of rules)for(const action of rule.actions)if(action.type==='create_page'&&action.databaseId&&!databases.has(action.databaseId))pendingDatabases.push(action.databaseId);
    }
    const id=pendingRows.shift();if(!id||rowIds.has(id))continue;rowIds.add(id);const row=getRow(id);if(!row)throw new Error('database_action_context_incomplete');context.rows.push(row);if(!databases.has(row.databaseId))pendingDatabases.push(row.databaseId);
    for(const column of getColumns(row.databaseId).filter(column=>column.type==='relation')) {
      const relations=listRelations(row.id,column.id);context.relations.push(...relations);
      for(const relation of relations)if(relation.targetKind==='db_row'&&!relation.broken&&!rowIds.has(relation.targetId))pendingRows.push(relation.targetId);
    }
  }
  if(Buffer.byteLength(canonicalJson(context))>2_000_000)throw new Error('database_action_context_limit');
  return context;
}
function material(raw:unknown,requireRevision=false) {
  const request=mobileDatabaseActionRequest(raw,requireRevision),column=getColumn(request.columnId),row=getRow(request.rowId);
  if(!column||!row||row.databaseId!==column.databaseId||column.type!==({text:'ai',image:'ai_image',button:'button'} as const)[request.kind])throw new Error('database_action_parent_unavailable');
  const detail=getDatabaseDetail(column.databaseId);if(!detail)throw new Error('database_action_parent_unavailable');
  const columnRevision=(getDb().prepare('SELECT revision FROM db_columns WHERE id=?').get(column.id) as {revision:number}).revision;
  const settings=getSettings(),language=settings.promptLanguage??'es';
  const instruction=String(column.config.aiPrompt??'').trim();
  if(request.kind!=='button'&&!instruction)throw new Error('database_action_prompt_missing');
  const context=buildAiRowContext(detail.columns,row,{excludeColumnId:column.id,language});
  const images=request.kind==='text'&&column.config.aiSourceColumnId?listAttachments(row.id,String(column.config.aiSourceColumnId)).filter(a=>attachmentKind(a.mimeType)==='image'&&isVisionMime(a.mimeType)).filter(a=>getAttachmentBlob(a.id)).slice(0,2).map(image=>({...image,sourceSha256:createHash('sha256').update(getAttachmentBlob(image.id)!).digest('hex')})):[];
  const rules=request.kind==='button'?listAutomationRules(column.databaseId).filter(rule=>rule.enabled&&rule.trigger.type==='button'&&rule.trigger.columnId===column.id):[];
  const automationContext=request.kind==='button'?buttonContext(row.id,column.databaseId):null;
  const plan=automationContext?compileMobileDatabaseButton(automationContext,row.id,column.id):null;
  const revision=createHash('sha256').update(canonicalJson({row,columnRevision,columns:detail.columns,images,rules,automationContext,plan,language,models:request.kind==='text'?{chat:settings.chatModel,synthesis:settings.synthesisModel,vision:settings.visionModel,extraction:settings.extractionModel}:request.kind==='image'?{imageProvider:settings.imageProvider,imageModel:settings.imageModel}:null})).digest('hex');
  if(request.revision&&request.revision!==revision)throw new Error('database_action_source_conflict');
  return {request,column,row,context,images,rules,automationContext,plan,revision,columnRevision,language,settings,instruction};
}
export function getMobileDatabaseActionSource(raw:unknown) {
  return getDb().transaction(()=>{
    const source=material(raw);
    return {version:1,rowId:source.row.id,columnId:source.column.id,databaseId:source.column.databaseId,kind:source.request.kind,revision:source.revision,rowRevision:source.row.revision,columnRevision:source.columnRevision,title:source.column.name,
      system:source.request.kind==='text'?aiColumnSystem(source.language):null,
      prompt:source.request.kind==='text'?buildAiCellPrompt(source.instruction,source.context,source.language):source.request.kind==='image'?buildAiImagePrompt(source.instruction,source.context,source.language):null,
      model:source.request.kind==='image'?source.column.config.aiImageModel??{provider:source.settings.imageProvider,model:source.settings.imageModel}:source.column.config.aiModel??source.settings.chatModel??source.settings.synthesisModel??null,
      columnModel:source.request.kind==='image'?source.column.config.aiImageModel??null:source.column.config.aiModel??null,
      visionModel:source.column.config.aiModel??source.settings.visionModel??source.settings.extractionModel??source.settings.synthesisModel??source.settings.chatModel??null,
      images:source.images.map(image=>({id:image.id,mimeType:image.mimeType,bytes:image.bytes,contentHash:image.contentHash,sha256:image.sourceSha256})),rules:source.rules,automationContext:source.automationContext,plan:source.plan};
  })();
}
function receipts() {getDb().exec('CREATE TABLE IF NOT EXISTS mobile_database_action_receipts (request_id TEXT NOT NULL,device_grant TEXT NOT NULL,fingerprint TEXT NOT NULL,stage TEXT NOT NULL,result_json TEXT,error TEXT,PRIMARY KEY(request_id,device_grant))');}
function identity(id:string,grant:string,raw:unknown,allowReceived=false) {
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)||!grant)throw new Error('invalid_database_action_identity');
  receipts();const fingerprint=createHash('sha256').update(canonicalJson(raw)).digest('hex');
  const prior=getDb().prepare('SELECT * FROM mobile_database_action_receipts WHERE request_id=? AND device_grant=?').get(id,grant) as {fingerprint:string;stage:string;result_json:string|null}|undefined;
  if(prior&&prior.fingerprint!==fingerprint)throw new Error('database_action_identity_conflict');
  if(prior?.stage==='completed')return {fingerprint,result:JSON.parse(prior.result_json!)};
  if(prior?.stage==='received'&&allowReceived)return {fingerprint,result:undefined,publication:JSON.parse(prior.result_json!)};
  if(prior)throw new Error('database_action_interrupted_review_required');
  return {fingerprint,result:undefined};
}
export function saveMobileDatabaseGeneratedCell(raw:unknown,grant:string,vaultId:string) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_database_publication');
  const value=raw as Record<string,unknown>;
  if(Object.keys(value).some(key=>!['requestId','request','model','text','bytes','mime','blobUploadId','sha256'].includes(key))||typeof value.requestId!=='string'||!value.model||typeof value.model!=='object')throw new Error('invalid_database_publication');
  const request=mobileDatabaseActionRequest(value.request,true);if(request.kind==='button')throw new Error('invalid_database_publication');
  const prior=identity(value.requestId,grant,raw);if(prior.result!==undefined)return prior.result;
  const model=value.model as Record<string,unknown>;
  if(Object.keys(model).some(key=>!['provider','model'].includes(key))||typeof model.provider!=='string'||typeof model.model!=='string'||!model.model||model.model.length>256)throw new Error('invalid_database_publication');
  let bytes:Buffer|undefined,uploadId:string|undefined;
  if(request.kind==='text') {if(typeof value.text!=='string'||value.text.length>100_000||value.bytes!==undefined||value.mime!==undefined||value.blobUploadId!==undefined||value.sha256!==undefined)throw new Error('invalid_database_publication');}
  else {
    if(!['image/png','image/jpeg','image/webp'].includes(String(value.mime))||value.text!==undefined)throw new Error('invalid_database_publication');
    if(typeof value.blobUploadId==='string') {
      if(value.bytes!==undefined||typeof value.sha256!=='string')throw new Error('invalid_database_publication');
      const uploaded=readMobileDatabaseUploadedBlob(vaultId,grant,value.blobUploadId);
      if(uploaded.manifest.rowId!==request.rowId||uploaded.manifest.columnId!==request.columnId||uploaded.manifest.sha256!==value.sha256||uploaded.manifest.mimeType!==value.mime)throw new Error('database_image_upload_parent_conflict');
      bytes=uploaded.bytes;uploadId=value.blobUploadId;
    }else{
      if(typeof value.bytes!=='string'||value.bytes.length>28_000_000||value.sha256!==undefined)throw new Error('invalid_database_publication');
      bytes=Buffer.from(value.bytes,'base64');if(!bytes.length||bytes.length>20_000_000||bytes.toString('base64')!==value.bytes)throw new Error('invalid_database_publication');
    }
  }
  const saved=getDb().transaction(()=>{
    const source=material(request,true);let result:Record<string,unknown>;
    if(request.kind==='text')result={row:setCell(request.rowId,request.columnId,(value.text as string).trim()||null),text:(value.text as string).trim()};
    else {
      for(const old of listAttachments(request.rowId,request.columnId))deleteAttachment(old.id);
      const extension=value.mime==='image/png'?'png':value.mime==='image/webp'?'webp':'jpg';
      const attachment=addAttachment({rowId:request.rowId,columnId:request.columnId,fileName:`${source.column.name.replace(/[^\p{L}\p{N}._-]+/gu,'_').slice(0,40)}.${extension}`,mimeType:value.mime as string,bytes:bytes!.length,blob:bytes!,aiGenerated:true,aiPrompt:buildAiImagePrompt(source.instruction,source.context,source.language)});
      result={attachment,row:getRow(request.rowId)};
    }
    getDb().prepare('INSERT INTO mobile_database_action_receipts(request_id,device_grant,fingerprint,stage,result_json) VALUES(?,?,?,\'completed\',?)').run(value.requestId,grant,prior.fingerprint,JSON.stringify(result));return result;
  })();
  if(uploadId)completeMobileDatabaseUploadedBlob(vaultId,grant,uploadId,saved);
  return saved;
}
export async function generateMobileDatabase(raw:unknown,id:string,grant:string,progress:(phase:string)=>void,signal?:AbortSignal,vaultId?:string,deps?:{text?:(input:unknown,model:unknown)=>Promise<string>;image?:(provider:unknown,model:unknown,prompt:string)=>Promise<{bytes:Buffer;mimeType:string}>}) {
  const request=mobileDatabaseActionRequest(raw,true);if(request.kind==='button')throw new Error('invalid_database_action');
  const previous=identity(id,grant,raw,true);if(previous.result!==undefined)return previous.result;
  if('publication' in previous){const result=saveMobileDatabaseGeneratedCell(previous.publication,`${grant}:publication`,vaultId!);getDb().prepare('UPDATE mobile_database_action_receipts SET stage=\'completed\',result_json=? WHERE request_id=? AND device_grant=?').run(JSON.stringify(result),id,grant);return result;}
  const source=material(request,true);signal?.throwIfAborted();
  getDb().prepare('INSERT INTO mobile_database_action_receipts(request_id,device_grant,fingerprint,stage) VALUES(?,?,?,\'started\')').run(id,grant,previous.fingerprint);
  try {
    progress('provider');let publication:Record<string,unknown>;
    if(request.kind==='text') {
      const model=source.images.length?source.column.config.aiModel??source.settings.visionModel??source.settings.extractionModel??source.settings.synthesisModel??source.settings.chatModel:source.column.config.aiModel??source.settings.chatModel??source.settings.synthesisModel;
      if(!model)throw new Error('database_action_model_missing');
      const completeText=deps?.text??(await import('../ai/aiClient')).completeText;
      const text=await completeText({system:aiColumnSystem(source.language),user:buildAiCellPrompt(source.instruction,source.context,source.language),images:source.images.map(image=>({base64:getAttachmentBlob(image.id)!.toString('base64'),mediaType:image.mimeType!})),plainContext:true,temperature:0.2,maxTokens:1200},model);
      publication={requestId:id,request,model,text};
    } else {
      const model=source.column.config.aiImageModel??{provider:source.settings.imageProvider,model:source.settings.imageModel};
      if(!model.provider||!model.model)throw new Error('database_action_model_missing');
      const callImageProvider=deps?.image??(await import('../ai/decorativeImages')).callImageProvider;const image=await callImageProvider(model.provider,model.model,buildAiImagePrompt(source.instruction,source.context,source.language));
      publication={requestId:id,request,model,bytes:image.bytes.toString('base64'),mime:image.mimeType};
    }
    // Store the paid output before any conflict/publication check. Retrying an
    // interrupted request never calls a provider again.
    getDb().prepare('UPDATE mobile_database_action_receipts SET stage=\'received\',result_json=? WHERE request_id=? AND device_grant=?').run(JSON.stringify(publication),id,grant);
    progress('saving');signal?.throwIfAborted();
    // Provider-free publication uses a separate receipt identity; retain the
    // original request identity and the exact captured source revision.
    if(request.kind==='image' && typeof publication.bytes==='string' && publication.bytes.length>3_600_000) {
      if(!vaultId)throw new Error('database_action_owner_missing');
      const staged=stageMobileDatabaseImageBytes(vaultId,`${grant}:publication`,id,{rowId:request.rowId,columnId:request.columnId,fileName:'generated.png',mimeType:publication.mime as string,expectedRowRevision:source.row.revision!,expectedColumnRevision:source.columnRevision},Buffer.from(publication.bytes,'base64'));
      publication={requestId:id,request,model:publication.model,blobUploadId:staged.blobUploadId,sha256:staged.sha256,mime:staged.mimeType};
      getDb().prepare('UPDATE mobile_database_action_receipts SET result_json=? WHERE request_id=? AND device_grant=?').run(JSON.stringify(publication),id,grant);
    }
    const result=saveMobileDatabaseGeneratedCell(publication,`${grant}:publication`,vaultId!);
    getDb().prepare('UPDATE mobile_database_action_receipts SET stage=\'completed\',result_json=? WHERE request_id=? AND device_grant=?').run(JSON.stringify(result),id,grant);return result;
  }catch(error){getDb().prepare('UPDATE mobile_database_action_receipts SET stage=CASE WHEN stage=\'received\' THEN stage ELSE \'interrupted\' END,error=? WHERE request_id=? AND device_grant=?').run(error instanceof Error?error.message:String(error),id,grant);throw error;}
}
export async function runMobileDatabaseButton(raw:unknown,id:string,grant:string) {
  const request=mobileDatabaseActionRequest(raw,true);if(request.kind!=='button')throw new Error('invalid_database_action');
  const prior=identity(id,grant,raw);if(prior.result!==undefined)return prior.result;material(request,true);
  getDb().prepare('INSERT INTO mobile_database_action_receipts(request_id,device_grant,fingerprint,stage) VALUES(?,?,?,\'started\')').run(id,grant,prior.fingerprint);
  try {const runs=await runDatabaseButtonAutomation(request.columnId,request.rowId),result={runs,row:getRow(request.rowId)};
    getDb().prepare('UPDATE mobile_database_action_receipts SET stage=\'completed\',result_json=? WHERE request_id=? AND device_grant=?').run(JSON.stringify(result),id,grant);return result;
  }catch(error){getDb().prepare('UPDATE mobile_database_action_receipts SET stage=\'interrupted\',error=? WHERE request_id=? AND device_grant=?').run(error instanceof Error?error.message:String(error),id,grant);throw error;}
}
export function generateMobileDatabaseText(raw:unknown,id:string,grant:string,progress:(phase:string)=>void,signal?:AbortSignal,vaultId?:string){if(mobileDatabaseActionRequest(raw,true).kind!=='text')throw new Error('invalid_database_action');return generateMobileDatabase(raw,id,grant,progress,signal,vaultId);}
export function generateMobileDatabaseImage(raw:unknown,id:string,grant:string,progress:(phase:string)=>void,signal?:AbortSignal,vaultId?:string){if(mobileDatabaseActionRequest(raw,true).kind!=='image')throw new Error('invalid_database_action');return generateMobileDatabase(raw,id,grant,progress,signal,vaultId);}
/** Explicit failed-job recovery is provider-free even when its response was
 * lost. Unknown started work is reviewable and never retried as a new purchase. */
export async function recoverMobileDatabaseAction(raw:unknown,grant:string,vaultId:string,progress:(phase:string)=>void,signal?:AbortSignal) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_database_action_recovery');
  const value=raw as Record<string,unknown>;if(Object.keys(value).some(key=>!['requestId','request'].includes(key))||typeof value.requestId!=='string')throw new Error('invalid_database_action_recovery');
  const request=mobileDatabaseActionRequest(value.request,true),previous=identity(value.requestId,grant,request,true);
  if(previous.result!==undefined)return previous.result;
  if(!('publication' in previous))throw new Error('database_action_result_unavailable');
  if(request.kind==='button')throw new Error('database_action_interrupted_review_required');
  return generateMobileDatabase(request,value.requestId,grant,progress,signal,vaultId);
}
function actionIdentity(requestId:string,prefix:string,index:string) {
  const hex=createHash('sha256').update(`${requestId}:${prefix}:${index}`).digest('hex').slice(0,32);
  return `${prefix}_${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function instantiateMobileDatabaseButtonPlan(plan:unknown,requestId:string,clickedAt:string):unknown {
  if(typeof plan==='string')return plan.replace(/NODUS_ACTION_ID:(drow|arun|anote|pblk):(\d+)/g,(_all,prefix:string,index:string)=>actionIdentity(requestId,prefix,index)).replaceAll('NODUS_ACTION_CLICK_TIME',clickedAt);
  if(Array.isArray(plan))return plan.map(value=>instantiateMobileDatabaseButtonPlan(value,requestId,clickedAt));
  if(plan&&typeof plan==='object')return Object.fromEntries(Object.entries(plan).map(([key,value])=>[key,instantiateMobileDatabaseButtonPlan(value,requestId,clickedAt)]));return plan;
}
/** The device has already executed external actions. Publishing the captured
 * ordered prefix applies only canonical local writes and recorded receipts. */
export function saveMobileDatabaseButtonResult(raw:unknown,grant:string) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_database_button_publication');
  const value=raw as Record<string,unknown>;
  if(Object.keys(value).some(key=>!['requestId','request','result'].includes(key))||typeof value.requestId!=='string'||!value.result||typeof value.result!=='object'||Array.isArray(value.result))throw new Error('invalid_database_button_publication');
  const request=mobileDatabaseActionRequest(value.request,true);if(request.kind!=='button')throw new Error('invalid_database_button_publication');
  const prior=identity(value.requestId,grant,raw);if(prior.result!==undefined)return prior.result;
  const result=value.result as Record<string,unknown>,clickedAt=result.clickedAt,finishedAt=result.finishedAt;
  if(Object.keys(result).some(key=>!['clickedAt','finishedAt','completedSteps','failedStep','webhooks','interruptedStep','resolution','interruptedExecution'].includes(key))||typeof clickedAt!=='string'||!Number.isFinite(Date.parse(clickedAt))||typeof finishedAt!=='string'||!Number.isFinite(Date.parse(finishedAt))||typeof result.completedSteps!=='number'||!Number.isSafeInteger(result.completedSteps)||result.completedSteps<1||!result.webhooks||typeof result.webhooks!=='object'||Array.isArray(result.webhooks))throw new Error('invalid_database_button_publication');
  return getDb().transaction(()=>{
    const source=material(request,true),plan=instantiateMobileDatabaseButtonPlan(source.plan,value.requestId as string,clickedAt) as ReturnType<typeof compileMobileDatabaseButton>,completed=result.completedSteps as number,failed=result.failedStep,interrupted=result.interruptedStep;
    if(interrupted!=null){const original=result.interruptedExecution as Record<string,unknown>|undefined;if(result.resolution!=='publishConfirmedPrefix'||failed!=null||!Number.isSafeInteger(interrupted)||interrupted!==completed||plan.operations[completed]?.type!=='webhook'||!original||original.pendingWebhook!==completed||original.completedSteps!==completed||original.clickedAt!==clickedAt||original.finishedAt!=null||original.failedStep!=null||canonicalJson(Object.fromEntries(Object.entries((original.webhooks??{}) as Record<string,unknown>).filter(([key])=>key!==String(completed))))!==canonicalJson(result.webhooks)||Object.keys(original).some(key=>!['clickedAt','completedSteps','webhooks','pendingWebhook'].includes(key)))throw new Error('invalid_database_button_resolution');}
    else if(result.resolution!=null||result.interruptedExecution!=null)throw new Error('invalid_database_button_resolution');
    if(completed>plan.operations.length||failed!=null&&(typeof failed!=='number'||!Number.isSafeInteger(failed)||failed!==completed-1||plan.operations[failed]?.type!=='webhook')||failed==null&&interrupted==null&&completed!==plan.operations.length)throw new Error('invalid_database_button_progress');
    const webhooks=result.webhooks as Record<string,{status:string;httpStatus:number;attempt:number}>;
    const executedWebhooks=plan.operations.slice(0,completed).flatMap((op,index)=>op.type==='webhook'?[String(index)]:[]);
    if(Object.keys(webhooks).some(key=>!executedWebhooks.includes(key)))throw new Error('invalid_database_webhook_receipt');
    for(const key of executedWebhooks){const receipt=webhooks[key],op=plan.operations[Number(key)];if(!receipt||!['succeeded','failed'].includes(receipt.status)||!Number.isInteger(receipt.httpStatus)||receipt.httpStatus<100||receipt.httpStatus>599||!Number.isInteger(receipt.attempt)||receipt.attempt<1||receipt.attempt>Number(op.maxAttempts)||receipt.status!==(Number(key)===failed?'failed':'succeeded')||receipt.status==='succeeded'&&(receipt.httpStatus<200||receipt.httpStatus>299))throw new Error('invalid_database_webhook_receipt');}
    const createdPages:ReturnType<typeof portablePageDocument>[]=[];
    const insertedRuns=new Set<string>();
    const ensureRun=(id:string)=>{if(insertedRuns.has(id))return;const run=plan.runs.find(run=>run.id===id);if(!run)throw new Error('invalid_database_automation_run');getDb().prepare(`INSERT INTO automation_runs(id,rule_id,database_id,row_id,event_key,status,depth,attempt,actions_completed,output_json,error,started_at) VALUES(?,?,?,?,?,'running',?,1,0,'null',NULL,?)`).run(run.id,run.ruleId,run.databaseId,run.rowId,`mobile-button:${value.requestId}:${run.id}`,run.depth,clickedAt);insertedRuns.add(id);};
    for(const op of plan.operations.slice(0,completed)) {
      if(op.type==='button_click')setCell(op.rowId as string,op.columnId as string,JSON.stringify({clicks:op.clicks,lastClickedAt:clickedAt,lastClickedBy:'local'}));
      else if(op.type==='set_property')setCell(op.rowId as string,op.columnId as string,op.value as string|null);
      else if(op.type==='create_page') {
        const created=createRow(op.databaseId as string,op.rowId as string),document=getPageDocumentForRow(created.id);
        if(!document)throw new Error('database_action_page_missing');
        const blocks=op.blocks as Parameters<typeof savePageDocument>[0]['blocks'];
        if(blocks.length){const saved=savePageDocument({pageId:document.page.id,expectedRevision:document.revision,blocks,reason:'automation'});if(!saved.ok)throw new Error('database_action_page_conflict');}
        const committed=getPageDocumentForRow(created.id);if(!committed)throw new Error('database_action_page_missing');createdPages.push(portablePageDocument(committed));
      }else if(op.type==='notify'){ensureRun(op.runId as string);getDb().prepare('INSERT INTO automation_notifications(id,rule_id,run_id,database_id,row_id,title,body,is_read,created_at) VALUES(?,?,?,?,?,?,?,0,?)').run(op.id,op.ruleId,op.runId,op.databaseId,op.rowId,op.title,op.body,clickedAt);}
      // A webhook receipt is persisted in the action receipt, never sent here.
    }
    for(const run of plan.runs) {
      if(failed!=null&&Number(run.startedStep)>Number(failed)||interrupted!=null&&Number(run.startedStep)>Number(interrupted)||failed==null&&interrupted==null&&Number(run.startedStep)>=completed&&completed<plan.operations.length)continue;
      const actionEnds=run.actionEnds as number[],limit=failed==null?completed:Number(failed),done=actionEnds.filter(end=>end<=limit).length;
      const status=run.status==='skipped'?'skipped':Number(run.finishedStep)<=completed&&(failed==null||Number(run.finishedStep)<=Number(failed))?'succeeded':'failed';
      ensureRun(run.id as string);getDb().prepare('UPDATE automation_runs SET status=?,attempt=?,actions_completed=?,output_json=?,error=?,finished_at=? WHERE id=?').run(status,failed==null?1:webhooks[String(failed)]?.attempt??1,done,JSON.stringify({device:true,completedSteps:completed,webhooks,...(interrupted!=null?{interruptedStep:interrupted,resolution:result.resolution,interruptedExecution:result.interruptedExecution}:{})}),status==='failed'?(interrupted!=null?'La acción externa no tiene respuesta confirmada; el usuario conservó únicamente los pasos confirmados.':'La acción externa falló en el dispositivo.'):null,finishedAt,run.id);
    }
    const published={row:getRow(request.rowId),result,runs:[...insertedRuns],createdPages};
    getDb().prepare('INSERT INTO mobile_database_action_receipts(request_id,device_grant,fingerprint,stage,result_json) VALUES(?,?,?,\'completed\',?)').run(value.requestId,grant,prior.fingerprint,JSON.stringify(published));return published;
  })();
}
