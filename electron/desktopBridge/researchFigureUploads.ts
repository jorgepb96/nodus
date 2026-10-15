import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../../shared/canonicalJson';
import {getDb,withVaultDatabase} from '../db/database';
import {withOwningVault} from '../vaults/vaultRegistry';
import {withMobileOperation} from './executionBoundary';
import {chatAssetOwner,importDocumentFigureAsset,getChatImage,getCapabilityFile} from '../chatAssets';
import {validateMediaAsset} from '../../packages/capability-api/src/media';
export const RESEARCH_FIGURE_CHUNK_BYTES=512*1024;
export class ResearchFigureUploadError extends Error {constructor(readonly status:number,readonly code:string){super(code);}}
function fail(code:string,status=409):never{throw new ResearchFigureUploadError(status,code);}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const uuid=(value:unknown):string=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)?value:fail('invalid_research_figure_identity',400);
export interface ResearchFigureUploadManifest {version:1;id:string;vaultId:string;generationId:string;figureId:string;ownerRevision:string;owner:string;mimeType:string;byteCount:number;sha256:string;metadata:Record<string,string>}
function validate(raw:unknown,vaultId:string,id:string):ResearchFigureUploadManifest {
 const value=raw as ResearchFigureUploadManifest;if(!value||value.version!==1||value.id!==id||value.vaultId!==vaultId||!Number.isSafeInteger(value.byteCount)||value.byteCount<1||value.byteCount>8*1024*1024||!['image/png','image/jpeg','image/webp'].includes(value.mimeType)||!/^([a-f0-9]{64})$/.test(value.sha256)||!value.metadata||Array.isArray(value.metadata)||Object.entries(value.metadata).some(([k,v])=>k.length>100||typeof v!=='string'||v.length>10000))fail('invalid_research_figure_manifest',400);
 uuid(value.id);uuid(value.generationId);uuid(value.figureId);uuid(value.ownerRevision);
 if(value.owner!==chatAssetOwner('document-figure',`deep-research:${value.generationId}:${value.ownerRevision}:${value.figureId}`,vaultId))fail('research_figure_owner_conflict');
 return value;
}
interface Stage {manifest:ResearchFigureUploadManifest;received:Record<string,string>}
function directory(vault:string,grant:string,id:string){return path.join(app.getPath('userData'),'desktop-bridge-research-figure-uploads',hash(Buffer.from(canonicalJson([vault,grant]))),uuid(id).toLowerCase());}
function save(dir:string,state:Stage){fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,'manifest.tmp'),JSON.stringify(state),{mode:0o600});fs.renameSync(path.join(dir,'manifest.tmp'),path.join(dir,'manifest.json'));}
function table(){getDb().exec('CREATE TABLE IF NOT EXISTS mobile_research_figure_receipts(device_grant TEXT NOT NULL,asset_id TEXT NOT NULL,manifest_json TEXT NOT NULL,PRIMARY KEY(device_grant,asset_id))');}
export function researchFigureReceipt(grant:string,id:string):ResearchFigureUploadManifest|null {table();const row=getDb().prepare('SELECT manifest_json FROM mobile_research_figure_receipts WHERE device_grant=? AND asset_id=?').get(grant,id.toLowerCase()) as {manifest_json:string}|undefined;return row?JSON.parse(row.manifest_json):null;}
export async function mobileResearchFigureUpload(vaultId:string,grant:string,id:string,action:string,raw:unknown,authorized:()=>boolean){
 uuid(id);if(!grant||!authorized())fail('permission_denied',403);
 return withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>withMobileOperation(()=>{
  if(!authorized())fail('permission_denied',403);table();const input=raw as Record<string,unknown>,dir=directory(vaultId,grant,id),known=researchFigureReceipt(grant,id);
  const existing=known?getChatImage(`${known.owner}/${known.id.toLowerCase()}`):null,capability=known?getCapabilityFile(`nodus-capability://chat/${known.owner}/${known.id.toLowerCase()}`):null;
  const receipt=known&&existing&&capability&&existing.mime===known.mimeType&&hash(existing.blob)===known.sha256&&capability.mimeType===known.mimeType&&hash(capability.blob)===known.sha256?known:null;
  const descriptor=(state:Stage)=>({version:1,id,chunkBytes:RESEARCH_FIGURE_CHUNK_BYTES,state:receipt?'available':'pending',received:Object.entries(state.received).map(([index,sha256])=>({index:Number(index),sha256})),receipt});
  if(action==='begin'){const manifest=validate(input?.manifest,vaultId,id);if(known&&canonicalJson(known)!==canonicalJson(manifest))fail('research_figure_identity_conflict');if(receipt){if(canonicalJson(receipt)!==canonicalJson(manifest))fail('research_figure_identity_conflict');return descriptor({manifest,received:{}});}let state:Stage={manifest,received:{}};if(fs.existsSync(path.join(dir,'manifest.json'))){state=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));if(canonicalJson(state.manifest)!==canonicalJson(manifest))fail('research_figure_identity_conflict');}state.received=Object.fromEntries(Object.entries(state.received).filter(([index,digest])=>{const file=path.join(dir,`chunk-${index}`);return fs.existsSync(file)&&hash(fs.readFileSync(file))===digest;}));save(dir,state);return descriptor(state);}
  if(receipt)return descriptor({manifest:receipt,received:{}});
  if(!fs.existsSync(path.join(dir,'manifest.json')))fail('research_figure_upload_missing',404);const state=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')) as Stage,spec=validate(state.manifest,vaultId,id);
  if(action==='status')return descriptor(state);
  if(action==='cancel'){fs.rmSync(dir,{recursive:true,force:true});return {version:1,id,state:'cancelled'};}
  const count=Math.ceil(spec.byteCount/RESEARCH_FIGURE_CHUNK_BYTES);
  if(action==='chunk'){const index=input.index;if(typeof index!=='number'||!Number.isSafeInteger(index)||index<0||index>=count||typeof input.bytes!=='string'||input.bytes.length>700000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.bytes))fail('invalid_research_figure_chunk',400);const bytes=Buffer.from(input.bytes,'base64'),digest=hash(bytes);if(bytes.length!==Math.min(RESEARCH_FIGURE_CHUNK_BYTES,spec.byteCount-index*RESEARCH_FIGURE_CHUNK_BYTES)||digest!==input.sha256)fail('research_figure_chunk_hash_mismatch');const file=path.join(dir,`chunk-${index}`);if(fs.existsSync(file)&&hash(fs.readFileSync(file))!==digest)fail('research_figure_chunk_conflict');if(!fs.existsSync(file)){fs.writeFileSync(file+'.tmp',bytes,{mode:0o600});fs.renameSync(file+'.tmp',file);}state.received[String(index)]=digest;save(dir,state);return descriptor(state);}
  if(action!=='commit')fail('invalid_research_figure_action',400);
  const bytes=Buffer.alloc(spec.byteCount);for(let index=0;index<count;index++){const file=path.join(dir,`chunk-${index}`);if(!state.received[String(index)]||!fs.existsSync(file))fail('research_figure_chunks_missing');const chunk=fs.readFileSync(file);if(hash(chunk)!==state.received[String(index)]||chunk.length!==Math.min(RESEARCH_FIGURE_CHUNK_BYTES,spec.byteCount-index*RESEARCH_FIGURE_CHUNK_BYTES))fail('research_figure_chunk_hash_mismatch');chunk.copy(bytes,index*RESEARCH_FIGURE_CHUNK_BYTES);}if(hash(bytes)!==spec.sha256)fail('research_figure_hash_mismatch');validateMediaAsset(new Uint8Array(bytes),spec.mimeType,'image');
  if(!authorized())fail('permission_denied',403);importDocumentFigureAsset(spec.owner,spec.id.toLowerCase(),{bytes,mimeType:spec.mimeType},spec.metadata);
  getDb().prepare('INSERT OR IGNORE INTO mobile_research_figure_receipts VALUES(?,?,?)').run(grant,id.toLowerCase(),JSON.stringify(spec));for(let index=0;index<count;index++)fs.rmSync(path.join(dir,`chunk-${index}`),{force:true});return {...descriptor(state),state:'available',receipt:spec};
 },['corpus','writing'])));
}
