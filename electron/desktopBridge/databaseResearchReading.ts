import {createHash} from 'node:crypto';
import {BrowserWindow} from 'electron';
import {getDb,withVaultDatabase} from '../db/database';
import {getVault,withOwningVault} from '../vaults/vaultRegistry';
import {getDatabaseResearchReport,getDatabaseResearchRunDetail,listDatabaseDeepResearchReportAnnotations} from '../db/databaseDeepResearchRepo';
import {canonicalJson} from '../../shared/canonicalJson';
import {invalidateLiveCorpus} from './liveCorpus';
import type {DatabaseDeepResearchReportAnnotation} from '../../shared/databaseDeepResearch';

export class DatabaseReadingFailure extends Error {
  constructor(readonly status:number,readonly code:string,readonly remote?:unknown) { super(code); }
}
const digest=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const stamp=(value:unknown)=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
const text=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max;
export function mobileDatabaseResearchReader(id:string) {
  const report=getDatabaseResearchReport(id);
  if(!report||report.id!==id) throw new DatabaseReadingFailure(404,'database_report_not_found');
  const stored=getDb().prepare('SELECT metadata_json,structured_json,quality_json,provenance_json,bibliography_json FROM database_research_reports WHERE id=?').get(id) as Record<string,unknown>;
  for(const value of Object.values(stored)) {
    if(typeof value!=='string') throw new DatabaseReadingFailure(400,'invalid_database_report');
    try { JSON.parse(value); } catch { throw new DatabaseReadingFailure(400,'invalid_database_report'); }
  }
  const {updatedAt:_updated,readAt:_read,...source}=report;
  const detail=getDatabaseResearchRunDetail(report.runId);
  if(!detail)throw new DatabaseReadingFailure(400,'database_report_run_unavailable');
  const {report:_report,...exportDetail}=detail;
  return {version:1,report,sourceRevision:digest(source),exportDetail};
}
function snapshot(id:string) {
  const source=mobileDatabaseResearchReader(id);
  const reading={readAt:source.report.readAt??null,annotations:listDatabaseDeepResearchReportAnnotations(id)};
  if((getDb().prepare('SELECT COUNT(*) AS n FROM database_research_report_annotations WHERE report_id=?').get(id) as {n:number}).n!==reading.annotations.length) throw new DatabaseReadingFailure(400,'invalid_database_annotation');
  return {version:1,reportId:id,reportTitle:source.report.title,sourceRevision:source.sourceRevision,readingRevision:digest(reading),reading};
}
function validateReading(raw:unknown,id:string,current:ReturnType<typeof snapshot>['reading']) {
  const value=raw as typeof current;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['readAt','annotations'].includes(key))||
      value.readAt!==null&&!stamp(value.readAt)||!Array.isArray(value.annotations)||value.annotations.length>10_000) throw new DatabaseReadingFailure(400,'invalid_database_reading');
  const seen=new Set<string>(),existing=new Map(current.annotations.map(item=>[item.id,item]));
  for(const item of value.annotations) {
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['id','reportId','scope','kind','color','startOffset','endOffset','selectedText','prefix','suffix','comment','createdAt','updatedAt'].includes(key))||
        !text(item.id,256)||!item.id||seen.has(item.id)||item.reportId!==id||!text(item.scope,180)||!item.scope||!['highlight','comment','bookmark'].includes(item.kind)||
        !Number.isSafeInteger(item.startOffset)||item.startOffset<0||!Number.isSafeInteger(item.endOffset)||item.endOffset<=item.startOffset||
        !text(item.selectedText,20_000)||!item.selectedText.trim()||item.selectedText.length!==item.endOffset-item.startOffset||
        !text(item.prefix,64)||!text(item.suffix,64)||!stamp(item.createdAt)||!stamp(item.updatedAt)||
        (item.kind==='highlight'? !['yellow','rose','blue','mint','lavender','peach'].includes(item.color??''):item.color!==null)||
        (item.kind==='comment'? !text(item.comment,20_000)||!item.comment?.trim():item.comment!==null)) throw new DatabaseReadingFailure(400,'invalid_database_annotation');
    if(item.kind==='bookmark'&&item.id!==`database-research-bookmark:${id}:${item.scope}`) throw new DatabaseReadingFailure(400,'invalid_database_annotation');
    const old=existing.get(item.id);
    if(!old&&getDb().prepare('SELECT 1 FROM database_research_report_annotations WHERE id=? AND report_id<>?').get(item.id,id)) throw new DatabaseReadingFailure(403,'permission_denied');
    const immutable=item.kind==='bookmark'?['reportId','scope','kind','createdAt']:['reportId','scope','kind','color','startOffset','endOffset','selectedText','prefix','suffix','createdAt'];
    if(old&&immutable.some(key=>old[key as keyof typeof old]!==item[key as keyof typeof item])) throw new DatabaseReadingFailure(409,'database_annotation_changed');
    seen.add(item.id);
  }
  return value;
}
export async function readMobileDatabaseReading(vaultId:string,id:string) {
  if(!getVault(vaultId)) throw new DatabaseReadingFailure(404,'vault_not_found');
  return withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>snapshot(id)));
}
export async function saveMobileDatabaseReading(vaultId:string,grantId:string,id:string,raw:unknown) {
  const value=raw as {version:number;id:string;sourceRevision:string;expectedReadingRevision:string;reading:{readAt:string|null;annotations:DatabaseDeepResearchReportAnnotation[]}};
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||
      Object.keys(value).some(key=>!['version','id','sourceRevision','expectedReadingRevision','reading'].includes(key))||
      typeof value.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id)||
      !hash(value.sourceRevision)||!hash(value.expectedReadingRevision)) throw new DatabaseReadingFailure(400,'invalid_database_reading');
  if(!getVault(vaultId)) throw new DatabaseReadingFailure(404,'vault_not_found');
  const payload=digest({reportId:id,...value});
  const result=await withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>{
    const db=getDb();
    db.exec('CREATE TABLE IF NOT EXISTS desktop_database_reading_receipts (grant_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, result_json TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY(grant_id,request_id))');
    return db.transaction(()=>{
      const receipt=db.prepare('SELECT payload_hash,result_json FROM desktop_database_reading_receipts WHERE grant_id=? AND request_id=?').get(grantId,value.id) as {payload_hash:string;result_json:string}|undefined;
      if(receipt) { if(receipt.payload_hash!==payload) throw new DatabaseReadingFailure(409,'idempotency_conflict'); return JSON.parse(receipt.result_json); }
      const current=snapshot(id);
      if(value.sourceRevision!==current.sourceRevision) throw new DatabaseReadingFailure(409,'database_report_changed',current);
      if(value.expectedReadingRevision!==current.readingRevision) throw new DatabaseReadingFailure(409,'database_reading_conflict',current);
      const reading=validateReading(value.reading,id,current.reading);
      db.prepare('DELETE FROM database_research_report_annotations WHERE report_id=?').run(id);
      const insert=db.prepare('INSERT INTO database_research_report_annotations(id,report_id,scope,kind,color,start_offset,end_offset,selected_text,prefix,suffix,comment_text,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for(const annotation of reading.annotations) insert.run(annotation.id,id,annotation.scope,annotation.kind,annotation.color,annotation.startOffset,annotation.endOffset,annotation.selectedText,annotation.prefix,annotation.suffix,annotation.comment,annotation.createdAt,annotation.updatedAt);
      db.prepare('UPDATE database_research_reports SET read_at=?,updated_at=? WHERE id=?').run(reading.readAt,new Date().toISOString(),id);
      const committed={id:value.id,snapshot:snapshot(id)};
      db.prepare('INSERT INTO desktop_database_reading_receipts VALUES(?,?,?,?,?)').run(grantId,value.id,payload,JSON.stringify(committed),new Date().toISOString());
      return committed;
    })();
  }));
  invalidateLiveCorpus(vaultId);
  for(const window of BrowserWindow.getAllWindows()) {
    if(!window.isDestroyed()&&!window.webContents.isDestroyed()) window.webContents.send('db:deepResearch:report:annotations:changed',id);
  }
  return result;
}
