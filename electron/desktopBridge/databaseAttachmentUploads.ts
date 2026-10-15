import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {withOwningVault} from '../vaults/vaultRegistry';
import {getDb,withVaultDatabase} from '../db/database';
import {getColumn,getRow,getAttachment,addAttachment} from '../db/databasesRepo';
import {withMobileOperation} from './executionBoundary';
import {canonicalJson} from '../../shared/canonicalJson';
import {invalidateLiveCorpus} from './liveCorpus';

export const MOBILE_DATABASE_FILE_CHUNK_BYTES=512*1024;
const ttl=7*24*60*60*1000;
export class DatabaseFileUploadError extends Error {
  constructor(readonly status:number,readonly code:string,readonly description:string){super(code);}
}
function fail(code:string,description='El archivo sigue conservado en el dispositivo. Revisa el cambio antes de volver a enviarlo.',status=409):never{throw new DatabaseFileUploadError(status,code,description);}
function uuid(value:unknown,prefix=''):string {if(typeof value!=='string'||!new RegExp(`^${prefix}[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`,'i').test(value))fail('invalid_database_file_identity');return value;}
function text(value:unknown,max=1024):string{if(typeof value!=='string'||!value||value.length>max)fail('invalid_database_file_input');return value;}
function hash(bytes:Buffer){return createHash('sha256').update(bytes).digest('hex');}
export type DatabaseUploadedFileManifest={version:1;id:string;rowId:string;columnId:string;fileName:string;mimeType:string;size:number;sha256:string;chunkCount:number;expectedRowRevision:number;expectedColumnRevision:number};
type Manifest=DatabaseUploadedFileManifest;
type Stage={manifest:Manifest;received:Record<string,string>;updatedAt:number;result?:Record<string,unknown>};
function root(){return path.join(app.getPath('userData'),'desktop-bridge-database-file-uploads');}
function folder(vault:string,grant:string,id:string){return path.join(root(),hash(Buffer.from(canonicalJson([vault,grant]))),uuid(id));}
function save(directory:string,state:Stage){fs.mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,'manifest.json');fs.writeFileSync(file+'.tmp',JSON.stringify(state),{mode:0o600});fs.renameSync(file+'.tmp',file);fs.chmodSync(file,0o600);}
function load(directory:string):Stage {try{return JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));}catch{fail('database_file_upload_unavailable','La transferencia ya no está disponible en Nodus. Puedes reanudarla desde el archivo guardado en este dispositivo.',404);}}
function descriptor(state:Stage){return {version:1,id:state.manifest.id,chunkBytes:MOBILE_DATABASE_FILE_CHUNK_BYTES,state:state.result?'available':'pending',received:Object.entries(state.received).map(([index,sha256])=>({index:Number(index),sha256})),result:state.result??null};}
function manifest(raw:unknown,id:string):Manifest {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('invalid_database_file_input');const value=raw as Record<string,unknown>;
  const size=value.size;if(!Number.isSafeInteger(size)||typeof size!=='number'||size<0)fail('invalid_database_file_size');
  if(typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(value.sha256))fail('invalid_database_file_hash');
  const fileName=text(value.fileName);if(path.basename(fileName)!==fileName||fileName==='.'||fileName==='..'||fileName.includes('\\'))fail('invalid_database_file_name');
  const rowId=text(value.rowId),columnId=text(value.columnId),mimeType=text(value.mimeType,256);
  if(!Number.isSafeInteger(value.expectedRowRevision)||!Number.isSafeInteger(value.expectedColumnRevision))fail('invalid_database_file_precondition');
  return {version:1,id:uuid(id),rowId,columnId,fileName,mimeType,size,sha256:value.sha256.toLowerCase(),chunkCount:Math.ceil(size/MOBILE_DATABASE_FILE_CHUNK_BYTES),expectedRowRevision:value.expectedRowRevision as number,expectedColumnRevision:value.expectedColumnRevision as number};
}
function context(spec:Manifest){const column=getColumn(spec.columnId),row=getRow(spec.rowId);if(!column||!row||row.databaseId!==column.databaseId||!['files','attachment','ai_image'].includes(column.type))fail('database_file_parent_unavailable');return {column,row};}
function resultMetadata(spec:Manifest,id:string):Record<string,unknown> {
  const attachment=getDb().prepare('SELECT id,database_id,row_id,column_id,file_name,mime_type,bytes,content_hash,revision,position,created_at,updated_at,created_by,updated_by FROM db_attachments WHERE id=? AND row_id=? AND column_id=?').get(id,spec.rowId,spec.columnId);
  const row=getDb().prepare('SELECT * FROM db_rows WHERE id=?').get(spec.rowId);
  return {attachment,row};
}
function knownResult(spec:Manifest):Record<string,unknown>|undefined {
  const id='datt_'+spec.id,existing=getAttachment(id);if(!existing)return undefined;
  if(existing.rowId!==spec.rowId||existing.columnId!==spec.columnId||existing.contentHash!==spec.sha256||existing.bytes!==spec.size||existing.fileName!==spec.fileName||existing.mimeType!==spec.mimeType)fail('database_file_identity_conflict');
  return {id:existing.id,rowId:existing.rowId,columnId:existing.columnId,fileName:existing.fileName,mimeType:existing.mimeType,bytes:existing.bytes,sha256:existing.contentHash,...resultMetadata(spec,existing.id)};
}
function preconditions(spec:Manifest){context(spec);const db=getDb(),row=db.prepare('SELECT revision FROM db_rows WHERE id=?').get(spec.rowId) as {revision:number},column=db.prepare('SELECT revision FROM db_columns WHERE id=?').get(spec.columnId) as {revision:number};if(row.revision!==spec.expectedRowRevision||column.revision!==spec.expectedColumnRevision)fail('database_file_revision_conflict','La fila o la propiedad cambió en Nodus. El archivo se conserva en el dispositivo para revisar su destino.');}
function maxFileBytes(){const options=getDb().pragma('compile_options') as Array<{compile_options:string}>;const configured=options.map(value=>/^MAX_LENGTH=(\d+)$/.exec(value.compile_options)).find(Boolean);return configured?Number(configured[1]):1_000_000_000;}
function cleanup(){if(!fs.existsSync(root()))return;for(const scope of fs.readdirSync(root())){if(!/^[a-f0-9]{64}$/.test(scope))continue;const directory=path.join(root(),scope);for(const id of fs.readdirSync(directory)){if(!/^[a-f0-9-]{36}$/i.test(id))continue;const selected=path.join(directory,id);try{const state=load(selected);if(Date.now()-state.updatedAt>ttl)fs.rmSync(selected,{recursive:true,force:true});}catch{/* Unknown state is retained rather than deleting another writer's data. */}}}}
export async function mobileDatabaseFileUpload(vaultId:string,grantId:string,id:string,action:string,input:Record<string,unknown>,authorize:()=>boolean):Promise<unknown>{
  return withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>withMobileOperation(()=>{
    if(!authorize())fail('permission_denied','Este enlace ya no autoriza la transferencia.',403);
    cleanup();const directory=folder(vaultId,grantId,id);
    if(action==='begin'){
      const spec=manifest(input,id);context(spec);const result=knownResult(spec);
      if(result)return descriptor({manifest:spec,received:{},updatedAt:Date.now(),result});
      if(spec.size>=maxFileBytes())fail('database_file_storage_limit','El archivo supera la capacidad de almacenamiento de la base de datos de Nodus. El original sigue guardado.',413);
      preconditions(spec);let state:Stage;
      if(fs.existsSync(path.join(directory,'manifest.json'))){state=load(directory);if(canonicalJson(state.manifest)!==canonicalJson(spec))fail('database_file_upload_identity_conflict');state.updatedAt=Date.now();}
      else state={manifest:spec,received:{},updatedAt:Date.now()};save(directory,state);return descriptor(state);
    }
    const state=load(directory);context(state.manifest);
    if(action==='status')return descriptor(state);
    if(action==='cancel'){if(!state.result)fs.rmSync(directory,{recursive:true,force:true});return {version:1,id,state:'cancelled'};}
    if(state.result)return descriptor(state);
    preconditions(state.manifest);
    if(action==='chunk'){
      const index=input.index;if(!Number.isSafeInteger(index)||typeof index!=='number'||index<0||index>=state.manifest.chunkCount)fail('invalid_database_file_chunk');
      if(typeof input.bytes!=='string'||input.bytes.length>Math.ceil(MOBILE_DATABASE_FILE_CHUNK_BYTES/3)*4+4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.bytes))fail('invalid_database_file_chunk');
      const bytes=Buffer.from(input.bytes,'base64'),expected=Math.min(MOBILE_DATABASE_FILE_CHUNK_BYTES,state.manifest.size-index*MOBILE_DATABASE_FILE_CHUNK_BYTES),checksum=hash(bytes);
      if(bytes.length!==expected||input.sha256!==checksum)fail('database_file_chunk_hash_mismatch');
      const file=path.join(directory,`chunk-${index}`);
      if(state.received[String(index)]&&state.received[String(index)]!==checksum)fail('database_file_chunk_conflict');
      if(fs.existsSync(file)){if(hash(fs.readFileSync(file))!==checksum)fail('database_file_chunk_conflict');}
      else{fs.writeFileSync(file+'.tmp',bytes,{mode:0o600});fs.renameSync(file+'.tmp',file);}
      state.received[String(index)]=checksum;state.updatedAt=Date.now();save(directory,state);return descriptor(state);
    }
    if(action!=='commit')fail('invalid_database_file_operation');
    const existing=knownResult(state.manifest);if(existing){state.result=existing;save(directory,state);return descriptor(state);}
    const {bytes}=readMobileDatabaseUploadedBlob(vaultId,grantId,id);
    const attachment=getDb().transaction(()=>addAttachment({rowId:state.manifest.rowId,columnId:state.manifest.columnId,fileName:state.manifest.fileName,mimeType:state.manifest.mimeType,bytes:bytes.length,blob:bytes,contentHash:state.manifest.sha256,identity:'datt_'+state.manifest.id,extractedText:null,thumb:null}))();
    state.result={id:attachment.id,rowId:attachment.rowId,columnId:attachment.columnId,fileName:attachment.fileName,mimeType:attachment.mimeType,bytes:attachment.bytes,sha256:attachment.contentHash,...resultMetadata(state.manifest,attachment.id)};state.updatedAt=Date.now();save(directory,state);
    for(let index=0;index<state.manifest.chunkCount;index++)fs.rmSync(path.join(directory,`chunk-${index}`),{force:true});invalidateLiveCorpus(vaultId);return descriptor(state);
  },['corpus','writing'])));
}

/** Called only within the authenticated owning-vault execution boundary. */
export function readMobileDatabaseUploadedBlob(vaultId:string,grantId:string,id:string):{manifest:DatabaseUploadedFileManifest;bytes:Buffer} {
  const directory=folder(vaultId,grantId,id),state=load(directory);
  if(state.result)fail('database_file_already_consumed');
  const spec=manifest(state.manifest,id);preconditions(spec);
  if(spec.size>=maxFileBytes())fail('database_file_storage_limit',undefined,413);
  // SQLite is the canonical Desktop blob store; only the final Desktop allocation
  // is contiguous. The phone and network transfer remain bounded chunks.
  const bytes=Buffer.alloc(spec.size),digest=createHash('sha256');let offset=0;
  for(let index=0;index<spec.chunkCount;index++) {
    const file=path.join(directory,`chunk-${index}`),expected=Math.min(MOBILE_DATABASE_FILE_CHUNK_BYTES,spec.size-offset);
    if(!state.received[String(index)]||!fs.existsSync(file))fail('database_file_chunks_missing');
    const chunk=fs.readFileSync(file);
    if(chunk.length!==expected||hash(chunk)!==state.received[String(index)])fail('database_file_chunk_hash_mismatch');
    chunk.copy(bytes,offset);offset+=chunk.length;digest.update(chunk);
  }
  if(offset!==spec.size||digest.digest('hex')!==spec.sha256)fail('database_file_hash_mismatch');
  return {manifest:spec,bytes};
}
/** Run after the canonical publication AND its receipt have committed. */
export function completeMobileDatabaseUploadedBlob(vaultId:string,grantId:string,id:string,result:Record<string,unknown>):void {
  const directory=folder(vaultId,grantId,id),state=load(directory);
  if(state.result&&canonicalJson(state.result)!==canonicalJson(result))fail('database_file_result_conflict');
  state.result=result;state.updatedAt=Date.now();save(directory,state);
  for(let index=0;index<state.manifest.chunkCount;index++)fs.rmSync(path.join(directory,`chunk-${index}`),{force:true});
}
/** Local Mac generation uses the identical staging contract without HTTP/base64. */
export function stageMobileDatabaseImageBytes(vaultId:string,grantId:string,id:string,input:Omit<DatabaseUploadedFileManifest,'version'|'id'|'size'|'sha256'|'chunkCount'>,bytes:Buffer):{blobUploadId:string;sha256:string;mimeType:string} {
  const spec=manifest({...input,size:bytes.length,sha256:hash(bytes)},id);
  preconditions(spec);if(bytes.length>=maxFileBytes())fail('database_file_storage_limit',undefined,413);
  const directory=folder(vaultId,grantId,id);
  let state:Stage={manifest:spec,received:{},updatedAt:Date.now()};
  if(fs.existsSync(path.join(directory,'manifest.json'))) {
    state=load(directory);if(canonicalJson(state.manifest)!==canonicalJson(spec))fail('database_file_upload_identity_conflict');
    if(state.result)return {blobUploadId:id,sha256:spec.sha256,mimeType:spec.mimeType};
  }
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  for(let index=0;index<spec.chunkCount;index++) {
    const chunk=bytes.subarray(index*MOBILE_DATABASE_FILE_CHUNK_BYTES,(index+1)*MOBILE_DATABASE_FILE_CHUNK_BYTES),file=path.join(directory,`chunk-${index}`),checksum=hash(chunk);
    if(fs.existsSync(file)&&hash(fs.readFileSync(file))!==checksum)fail('database_file_chunk_conflict');
    if(!fs.existsSync(file)){fs.writeFileSync(file+'.tmp',chunk,{mode:0o600});fs.renameSync(file+'.tmp',file);}
    state.received[String(index)]=checksum;
  }
  save(directory,state);return {blobUploadId:id,sha256:spec.sha256,mimeType:spec.mimeType};
}
