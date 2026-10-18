import {createHash} from 'node:crypto';
import {importDocumentFigureAsset} from '../chatAssets';
import {canonicalJson} from '../../shared/canonicalJson';
import {asDocumentVisualModel} from '../../shared/documentVisualEnrich';
import type {DocumentSkillPolicy,DocumentVisualManifest,DocumentVisualTarget} from '../../shared/documentSkills';
import {getDb} from '../db/database';
import {getActiveVault} from '../vaults/vaultRegistry';
import {enrichDocumentVisuals,isDocumentVisualRunning,getDocumentVisuals,removeDocumentFigure,undoVisualEnrichment,visualDocumentInput,type DocumentVisualRuntime} from '../ai/documentVisuals';
import {writeDocumentVisuals,visualContentHash} from '../capabilities/documentStore';
export type LiveVisualMethod='enrichDocumentVisuals'|'undoDocumentVisuals'|'removeDocumentFigure';
export interface LiveVisualCommand {version:1;requestId:string;target:DocumentVisualTarget;expected:{contentHash:string;revision:string|null;manifestHash:string};policy?:DocumentSkillPolicy;model?:unknown;retry?:boolean;figureId?:string;continueRequestId?:string}
const digest=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex'),uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export class LiveVisualFailure extends Error {constructor(readonly code:string,readonly details:Record<string,unknown>={}){super(code);}}
function fail(code:string,details:Record<string,unknown>={}):never{throw new LiveVisualFailure(code,details);}
export function liveVisualExpected(target:DocumentVisualTarget){const input=visualDocumentInput(target),manifest=getDocumentVisuals(target);return {contentHash:visualContentHash(input.fields),revision:manifest?.revision??null,manifestHash:digest(manifest)};}
function tables(){getDb().exec('CREATE TABLE IF NOT EXISTS mobile_live_visual_commands(device_grant TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,target_id TEXT NOT NULL,content_hash TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT,error TEXT,PRIMARY KEY(device_grant,request_id)); CREATE TABLE IF NOT EXISTS mobile_live_visual_answers(device_grant TEXT NOT NULL,request_id TEXT NOT NULL,input_hash TEXT NOT NULL,state TEXT NOT NULL,output_json TEXT,input_json TEXT,PRIMARY KEY(device_grant,request_id,input_hash))');if(!(getDb().prepare('PRAGMA table_info(mobile_live_visual_answers)').all() as {name:string}[]).some(column=>column.name==='input_json'))getDb().exec('ALTER TABLE mobile_live_visual_answers ADD COLUMN input_json TEXT');}
/** One canonical Mac invocation, fenced to its actual report and grant. Replays of
 * completed receipts cannot buy another answer or apply undo a second time. */
export async function runLiveDocumentVisuals(method:LiveVisualMethod,raw:unknown,grant:string,domains:readonly string[],emit:(value:unknown)=>void,signal?:AbortSignal){
 const value=raw as LiveVisualCommand;
 if(!value||value.version!==1||!uuid(value.requestId)||value.target?.kind!=='deep-research'||!uuid(value.target.id)||!value.expected||!grant||Buffer.byteLength(JSON.stringify(value))>1024*1024)fail('invalid_live_visual_command');
 if(!domains.includes('corpus')||!domains.includes('writing')||(method==='enrichDocumentVisuals'&&!domains.includes('research-generation')))fail('permission_denied');
 if(method==='removeDocumentFigure'&&!uuid(value.figureId))fail('invalid_live_visual_figure');
 if(value.model!=null&&!asDocumentVisualModel(value.model))fail('invalid_live_visual_model');
 tables();const db=getDb(),hash=digest({method,value}),known=db.prepare('SELECT * FROM mobile_live_visual_commands WHERE device_grant=? AND request_id=?').get(grant,value.requestId) as {payload_hash:string;state:string;result_json:string|null;error:string|null}|undefined;
 if(known){if(known.payload_hash!==hash)fail('idempotency_conflict');if(known.state==='available')return JSON.parse(known.result_json!);fail(known.error??'live_visual_request_interrupted',{responsePreserved:Boolean(known.result_json)});}
 if(isDocumentVisualRunning(value.target))fail('live_visual_target_busy');
 const vaultId=getActiveVault().id;
 if(canonicalJson(liveVisualExpected(value.target))!==canonicalJson(value.expected))fail('live_visual_source_conflict');
 if(value.continueRequestId){if(method!=='enrichDocumentVisuals'||!uuid(value.continueRequestId)||!value.retry)fail('invalid_live_visual_continuation');const prior=db.prepare('SELECT target_id,content_hash,state FROM mobile_live_visual_commands WHERE device_grant=? AND request_id=?').get(grant,value.continueRequestId) as {target_id:string;content_hash:string;state:string}|undefined;if(!prior||prior.target_id!==value.target.id||prior.content_hash!==value.expected.contentHash||prior.state==='available')fail('live_visual_continuation_conflict');if(db.prepare("SELECT 1 FROM mobile_live_visual_answers WHERE device_grant=? AND request_id=? AND state='started' LIMIT 1").get(grant,value.continueRequestId))fail('live_visual_paid_response_uncertain');}
 db.prepare('INSERT INTO mobile_live_visual_commands VALUES(?,?,?,?,?,\'started\',NULL,NULL)').run(grant,value.requestId,hash,value.target.id,value.expected.contentHash);
 const runtime=liveVisualCompletionJournal(grant,value.requestId,value.continueRequestId);
 runtime.snapshot=async(view,owner,invoke)=>persistLiveVisualPoster(owner,await invoke(),view.title??'Figure');
 let result:DocumentVisualManifest|null=null;
 const progress=()=>{try{const manifest=getDocumentVisuals(value.target);emit({target:value.target,state:manifest?.state??'pending',revision:manifest?.revision??null,ready:manifest?.figures.filter(figure=>figure.state==='ready').length??0,failed:manifest?.figures.filter(figure=>figure.state==='failed').length??0});}catch{/* The final fenced result retains an explicit failure. */}};
 const timer=method==='enrichDocumentVisuals'?setInterval(progress,750):null;
 try{
  signal?.throwIfAborted();
  if(value.continueRequestId)restoreAnsweredResources(grant,value.continueRequestId,value.target);
  if(method==='enrichDocumentVisuals'){if(!value.policy)fail('invalid_document_skills');result=await enrichDocumentVisuals(value.target,value.policy,{retry:value.retry===true,model:asDocumentVisualModel(value.model),signal},runtime);}
  else if(method==='undoDocumentVisuals')result=undoVisualEnrichment(value.target);
  else result=removeDocumentFigure(value.target,value.figureId!);
  const stale=getActiveVault().id!==vaultId||visualContentHash(visualDocumentInput(value.target).fields)!==value.expected.contentHash||canonicalJson(getDocumentVisuals(value.target))!==canonicalJson(result);
  if(stale||signal?.aborted){db.prepare('UPDATE mobile_live_visual_commands SET state=\'interrupted\',result_json=?,error=? WHERE device_grant=? AND request_id=?').run(JSON.stringify({manifest:result}),stale?'live_visual_source_conflict':'live_visual_cancelled',grant,value.requestId);fail(stale?'live_visual_source_conflict':'live_visual_cancelled',{responsePreserved:true});}
  const ack={version:1,requestId:value.requestId,target:value.target,state:'available',manifest:result,expected:liveVisualExpected(value.target)};
  db.prepare('UPDATE mobile_live_visual_commands SET state=\'available\',result_json=? WHERE device_grant=? AND request_id=?').run(JSON.stringify(ack),grant,value.requestId);progress();return ack;
 }catch(error){db.prepare('UPDATE mobile_live_visual_commands SET state=\'interrupted\',error=? WHERE device_grant=? AND request_id=? AND state=\'started\'').run(error instanceof Error?error.message:String(error),grant,value.requestId);throw error;}finally{if(timer)clearInterval(timer);}
}

/** Trusted runtime seam, also used by isolated persistence tests; no IPC export. */
export function liveVisualCompletionJournal(grant:string,requestId:string,continueRequestId?:string):DocumentVisualRuntime {
 tables();const db=getDb();
 return {completion:async(kind,input,invoke)=>{const inputHash=digest({kind,input});let saved=db.prepare('SELECT state,output_json FROM mobile_live_visual_answers WHERE device_grant=? AND request_id=? AND input_hash=?').get(grant,requestId,inputHash) as {state:string;output_json:string|null}|undefined;
  if(!saved&&continueRequestId)saved=db.prepare('SELECT state,output_json FROM mobile_live_visual_answers WHERE device_grant=? AND request_id=? AND input_hash=?').get(grant,continueRequestId,inputHash) as typeof saved;
  if(saved){if(saved.state!=='answered')fail('live_visual_paid_response_uncertain');return JSON.parse(saved.output_json!);}
  db.prepare('INSERT INTO mobile_live_visual_answers(device_grant,request_id,input_hash,state,output_json,input_json) VALUES(?,?,?,\'started\',NULL,?)').run(grant,requestId,inputHash,JSON.stringify({kind,input}));
  const answer=await invoke();db.prepare('UPDATE mobile_live_visual_answers SET state=\'answered\',output_json=? WHERE device_grant=? AND request_id=? AND input_hash=?').run(JSON.stringify(answer),grant,requestId,inputHash);return answer;
 }};
}

/** A resource answer can outlive the figure-view write. Restore its original
 * owner-bound view before canonical retry, which then only renders its poster. */
export function restoreAnsweredResources(grant:string,requestId:string,target:DocumentVisualTarget){
 const rows=getDb().prepare("SELECT input_json,output_json FROM mobile_live_visual_answers WHERE device_grant=? AND request_id=? AND state='answered'").all(grant,requestId) as {input_json:string|null;output_json:string}[];
 const manifest=getDocumentVisuals(target);let changed=false;
 for(const row of rows){
  if(!row.input_json)fail('live_visual_response_review_required');
  const call=JSON.parse(row.input_json);if(call.kind!=='resources')continue;
  const scope=JSON.parse(call.input.options.user),figure=manifest?.figures.find(item=>item.owner===scope.owner);
  if(!figure)fail('live_visual_resource_scope_conflict',{responsePreserved:true});
  if(figure.view)continue;
  const result=JSON.parse(row.output_json);if(!result.view||!Array.isArray(result.artifactSources))fail('live_visual_response_review_required');
  figure.view=result.view;figure.artifactSources=result.artifactSources;figure.state='failed';changed=true;
 }
 if(changed&&manifest)writeDocumentVisuals(manifest);
}

/** Keep fresh LIVE acknowledgements small: actual renderer pixels become a
 * canonical owner-scoped file before its URI enters the manifest. */
export function persistLiveVisualPoster(owner:string,dataURL:string,title:string){
 if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataURL))fail('invalid_live_visual_poster');
 const bytes=Buffer.from(dataURL.slice(dataURL.indexOf(',')+1),'base64');
 const identity=digest({owner,sha256:createHash('sha256').update(bytes).digest('hex')}),hex=identity.slice(0,32);
 const id=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 importDocumentFigureAsset(owner,id,{bytes,mimeType:'image/png'},{title});
 return `nodus-image://chat/${owner}/${id}`;
}
