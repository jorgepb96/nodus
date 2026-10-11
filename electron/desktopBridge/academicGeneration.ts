import {createHash} from 'node:crypto';
import {getDb} from '../db/database';
import {generationSignal} from '../ai/generationSignal';
import {prepareAuthorDossierSynthesis,saveAuthorDossierSynthesisResponse} from '../ai/authorDossier';
import {prepareMatrixCellSynthesis,saveMatrixCellSynthesisResponse} from '../ai/synthesisMatrix';
import {prepareWorldProseReview,finishWorldProseReview} from '../ai/worldProseReview';
import {prepareArgumentMapGeneration} from '../ai/argumentMap';
import {finishArgumentGeneration,type ArgumentGenerationSource} from '../../shared/argumentGeneration';
import {PROMPT_LANGUAGES,type PromptLanguage,type ModelRef} from '../../shared/types';
import {mobileDomainAllowed} from './executionBoundary';
import {applyProseDraft,validateProseDraft,proseDraftRevisionInput,type CompanionProseDraft} from '../../shared/companionProseDraft';

type Request={kind:'author'|'matrix'|'prose'|'argument';authorId?:string;themeId?:string;sceneId?:string;seedIdeaId?:string;language:PromptLanguage;draft?:CompanionProseDraft};
function request(raw:unknown):Request{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_academic_source');
  const value=raw as Request,fields=value.kind==='author'?['kind','authorId','language']:value.kind==='matrix'?['kind','authorId','themeId','language']:value.kind==='prose'?['kind','sceneId','language']:value.kind==='argument'?['kind','seedIdeaId','language']:[];
  if(!fields.length||Object.keys(value).some(key=>!fields.includes(key)&&!(value.kind==='prose'&&key==='draft'))||!(PROMPT_LANGUAGES as readonly unknown[]).includes(value.language))throw new Error('invalid_academic_source');
  for(const field of fields.filter(field=>!['kind','language'].includes(field))){const id=(value as unknown as Record<string,unknown>)[field];if(typeof id!=='string'||!id||id.length>256)throw new Error('invalid_academic_source');}
  return Object.hasOwn(value,'draft')?{...value,draft:validateProseDraft(value.draft)}:value;
}
function hash(value:unknown):string{
  const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
/** Capturing sources never starts a model or materialises a scene manuscript. */
export function mobileAcademicSource(raw:unknown){
  if(!mobileDomainAllowed('corpus'))throw new Error('permission_denied');
  const input=request(raw);
  const source=input.kind==='author'?prepareAuthorDossierSynthesis(input.authorId!,input.language):input.kind==='matrix'?prepareMatrixCellSynthesis(input.authorId!,input.themeId!,input.language):input.kind==='argument'?prepareArgumentMapGeneration({seedIdeaId:input.seedIdeaId!,language:input.language,mode:'ai'}):prepareWorldProseReview(input.sceneId!,input.language);
  const {draft,...baseRequest}=input;
  const baseline={version:1,request:baseRequest,source,...(input.kind==='prose'?{emptyPreview:finishWorldProseReview(source as ReturnType<typeof prepareWorldProseReview>,'')}: {})};
  const adapted=draft?applyProseDraft(source as ReturnType<typeof prepareWorldProseReview>,draft):null;
  const value=adapted?{...baseline,request:input,source:adapted,emptyPreview:finishWorldProseReview(adapted,'')}:baseline;
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>2*1024*1024)throw new Error('academic_source_too_large');
  return {...value,revision:draft?createHash('sha256').update(proseDraftRevisionInput(hash(baseline),draft)).digest('hex'):hash(value)};
}
/** Atomic publication receipt and canonical content, with no provider call. A
 * changed source is a visible conflict; it never overwrites an unrelated synthesis. */
export function saveMobileAcademicResult(raw:unknown){
  if(!mobileDomainAllowed('corpus')||!mobileDomainAllowed('writing'))throw new Error('permission_denied');
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Buffer.byteLength(JSON.stringify(raw),'utf8')>2*1024*1024)throw new Error('invalid_academic_result');
  const input=raw as {request:Request;revision:string;raw:string;model:ModelRef;requestId:string;generatedAt:string};
  if(Object.keys(input).some(key=>!['request','revision','raw','model','requestId','generatedAt'].includes(key))||typeof input.raw!=='string'||!input.raw.trim()||typeof input.revision!=='string'||!/^[a-f0-9]{64}$/.test(input.revision)||typeof input.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.requestId)||!Number.isFinite(Date.parse(input.generatedAt)))throw new Error('invalid_academic_result');
  request(input.request);
  if(!input.model||typeof input.model.provider!=='string'||input.model.provider.length>64||typeof input.model.model!=='string'||!input.model.model||input.model.model.length>512||Object.keys(input.model).some(key=>!['provider','model','pending','reasoningEffort'].includes(key)))throw new Error('invalid_academic_model');
  const db=getDb(),payload=hash(input);
  db.exec('CREATE TABLE IF NOT EXISTS mobile_academic_publications(request_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL)');
  return db.transaction(()=>{
    const receipt=db.prepare('SELECT payload_hash,result_json FROM mobile_academic_publications WHERE request_id=?').get(input.requestId) as {payload_hash:string;result_json:string}|undefined;
    if(receipt){if(receipt.payload_hash!==payload)throw new Error('idempotency_conflict');return JSON.parse(receipt.result_json);}
    generationSignal()?.throwIfAborted();
    const current=mobileAcademicSource(input.request);
    if(current.revision!==input.revision)throw new Error('academic_source_conflict');
    let result:unknown;
    if(input.request.kind==='prose')result=finishWorldProseReview(current.source as ReturnType<typeof prepareWorldProseReview>,input.raw);
    else {
      let response:unknown;try{response=JSON.parse(input.raw.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,''));}catch{throw new Error('invalid_academic_response');}
      if(input.request.kind==='argument')result=finishArgumentGeneration(current.source as ArgumentGenerationSource,response,input.generatedAt,input.requestId);
      else if(input.request.kind==='author')result=saveAuthorDossierSynthesisResponse(input.request.authorId!,response,input.model,(current.source as ReturnType<typeof prepareAuthorDossierSynthesis>).fingerprint,input.generatedAt);
      else {
        const source=current.source as ReturnType<typeof prepareMatrixCellSynthesis>;
        result=source.ideas.length?saveMatrixCellSynthesisResponse(input.request.authorId!,input.request.themeId!,response,input.model,source.fingerprint,input.generatedAt):{authorId:input.request.authorId,themeId:input.request.themeId,ideaCount:0,ideas:[],stance:null};
      }
    }
    db.prepare('INSERT INTO mobile_academic_publications VALUES(?,?,?)').run(input.requestId,payload,JSON.stringify(result));return result;
  })();
}

/** The Mac and companion can consult the same completed device maps. Reading
 * this catalogue never creates a table, runs a model, or changes a map. */
export function listSavedCompanionArgumentMaps(cursor:string|null=null,limit=20){
  if(cursor!=null&&(typeof cursor!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(cursor))||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('invalid_argument_cursor');
  const db=getDb();
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mobile_academic_publications'").get())return {items:[],cursor:null,hasMore:false,revision:hash([])};
  const epoch=db.prepare("SELECT request_id,payload_hash FROM mobile_academic_publications WHERE json_type(result_json,'$.root')='object' ORDER BY request_id").all();
  const rows=db.prepare("SELECT request_id,result_json FROM mobile_academic_publications WHERE request_id>? AND json_type(result_json,'$.root')='object' ORDER BY request_id LIMIT ?").all(cursor??'',limit+1) as Array<{request_id:string;result_json:string}>;
  return {items:rows.slice(0,limit).map(row=>({id:row.request_id,map:JSON.parse(row.result_json)})),cursor:rows.length>limit?rows[limit-1].request_id:null,hasMore:rows.length>limit,revision:hash(epoch)};
}

/** Only the Bridge's actual Mac generation lane calls this helper. Keeping its
 * receipt before job availability also recovers a completed model response
 * after the Mac exits between SQLite commit and job acknowledgement. */
export function savedCompanionLiveArgumentMap(id:string){
  const db=getDb();
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mobile_academic_publications'").get())return null;
  const row=db.prepare("SELECT result_json FROM mobile_academic_publications WHERE request_id=? AND json_type(result_json,'$.root')='object'").get(id) as {result_json:string}|undefined;
  return row?JSON.parse(row.result_json):null;
}
export function saveCompanionLiveArgumentMap(id:string,args:unknown[],map:unknown){
  if(!mobileDomainAllowed('writing'))throw new Error('permission_denied');
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw new Error('invalid_argument_receipt');
  const db=getDb(),fingerprint=hash({lane:'mac-argument',args});
  db.exec('CREATE TABLE IF NOT EXISTS mobile_academic_publications(request_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL)');
  return db.transaction(()=>{
    const existing=db.prepare('SELECT payload_hash,result_json FROM mobile_academic_publications WHERE request_id=?').get(id) as {payload_hash:string;result_json:string}|undefined;
    if(existing){if(existing.payload_hash!==fingerprint)throw new Error('idempotency_conflict');return JSON.parse(existing.result_json);}
    db.prepare('INSERT INTO mobile_academic_publications VALUES(?,?,?)').run(id,fingerprint,JSON.stringify(map));return map;
  })();
}
