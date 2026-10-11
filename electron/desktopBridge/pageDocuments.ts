import {createHash} from 'node:crypto';
import {getDb,withVaultDatabase} from '../db/database';
import {withOwningVault} from '../vaults/vaultRegistry';
import {getPageDocumentReadOnly,savePageDocument,updatePage} from '../db/pagesRepo';
import {canonicalJson} from '../../shared/canonicalJson';
import {MOBILE_WORKSPACE_EDIT_MAX_BYTES} from '../../shared/mobileWorkspace';
import type {PageDocument,SavePageDocumentInput} from '../../shared/pages';
import {withMobileOperation} from './executionBoundary';
import {invalidateLiveCorpus} from './liveCorpus';
import {mobilePageDependencies} from '../../shared/mobilePageDependencies';

export class PageDocumentFailure extends Error {
  constructor(public readonly status:number,public readonly code:string,public readonly remote?:unknown){super(code);}
}
export function portablePageDocument(document:PageDocument){
  const {yjsState:_,stateVector:__,...value}=document;
  return value;
}
export function pageDocumentAssets(document:PageDocument){
  const identities=new Map<string,string>();
  const visit=(value:unknown)=>{
    if(typeof value==='string'){for(const match of value.matchAll(/nodus-blob:\/\/([a-f0-9]{64})(?![a-f0-9])/gi))if(!identities.has(match[1]))identities.set(match[1],'Archivo');return;}
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(!value||typeof value!=='object')return;
    const object=value as Record<string,unknown>;
    if(typeof object.blobHash==='string'&&/^[a-f0-9]{64}$/i.test(object.blobHash))identities.set(object.blobHash,typeof object.name==='string'&&object.name?object.name:'Archivo');
    Object.values(object).forEach(visit);
  };
  visit(document.blocks);visit(document.nativeDocument);
  if(document.page.coverBlobHash)identities.set(document.page.coverBlobHash,'Portada');
  if(identities.size>20000)throw new PageDocumentFailure(413,'page_assets_too_large');
  return [...identities].map(([id,title])=>{
    const blob=getDb().prepare('SELECT mime_type,bytes,data IS NOT NULL AS available FROM db_blobs WHERE hash=?').get(id) as {mime_type:string|null;bytes:number;available:number}|undefined;
    return {kind:'pageAsset',id,title,available:Boolean(blob?.available),mime:blob?.mime_type??null,bytes:blob?.bytes??null};
  });
}
export function mobilePageDocument(vaultId:string,id:unknown){
  if(typeof id!=='string'||!id||id.length>1024)throw new PageDocumentFailure(400,'invalid_page_identity');
  const document=getDb().transaction(()=>getPageDocumentReadOnly(id))();
  if(!document)throw new PageDocumentFailure(404,'page_unavailable');
  const source={version:1,vaultId,document:portablePageDocument(document),assets:pageDocumentAssets(document),dependencies:mobilePageDependencies(document)};
  if(Buffer.byteLength(JSON.stringify(source),'utf8')>MOBILE_WORKSPACE_EDIT_MAX_BYTES-65536)throw new PageDocumentFailure(413,'page_document_too_large');
  return source;
}
const fields=new Set(['pageId','expectedRevision','expectedPageRevision','title','blocks','nativeDocument','schemaVersion','academicMetadata','reason']);
/** A whole page and the receipt are one canonical transaction. Never send
 * individual normalised blocks around the page's Yjs document. */
export async function saveMobilePageDocument(vaultId:string,grantId:string,raw:unknown){
  if(Buffer.byteLength(JSON.stringify(raw)??'','utf8')>MOBILE_WORKSPACE_EDIT_MAX_BYTES)throw new PageDocumentFailure(413,'page_document_too_large');
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new PageDocumentFailure(400,'invalid_page_edit');
  const request=raw as {id?:unknown;input?:unknown};
  if(Object.keys(raw).some(key=>!['id','input'].includes(key))||typeof request.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(request.id)||!request.input||typeof request.input!=='object'||Array.isArray(request.input))throw new PageDocumentFailure(400,'invalid_page_edit');
  const input=request.input as SavePageDocumentInput & {expectedPageRevision?:number;title?:string};
  if(Object.keys(input).some(key=>!fields.has(key))||typeof input.pageId!=='string'||!input.pageId||input.pageId.length>1024||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!Array.isArray(input.blocks)||input.blocks.length>100000||input.reason!==undefined&&typeof input.reason!=='string')throw new PageDocumentFailure(400,'invalid_page_edit');
  if(!Number.isSafeInteger(input.expectedPageRevision)||input.expectedPageRevision!<1||input.title!==undefined&&(typeof input.title!=='string'||input.title.length>4096))throw new PageDocumentFailure(400,'invalid_page_metadata');
  const payload=createHash('sha256').update(canonicalJson(input)).digest('hex');
  const value=await withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>{
    const db=getDb();
    db.exec('CREATE TABLE IF NOT EXISTS desktop_page_edit_receipts (grant_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY(grant_id,request_id))');
    return db.transaction(()=>{
      const receipt=db.prepare('SELECT payload_hash,result_json FROM desktop_page_edit_receipts WHERE grant_id=? AND request_id=?').get(grantId,request.id) as {payload_hash:string;result_json:string}|undefined;
      if(receipt){if(receipt.payload_hash!==payload)throw new PageDocumentFailure(409,'idempotency_conflict');return JSON.parse(receipt.result_json);}
      const before=getPageDocumentReadOnly(input.pageId);
      if(!before||before.page.state!=='active')throw new PageDocumentFailure(404,'page_unavailable');
      if(before.page.locked)throw new PageDocumentFailure(423,'page_locked');
      if(before.revision!==input.expectedRevision||before.page.revision!==input.expectedPageRevision)throw new PageDocumentFailure(409,'page_revision_conflict',portablePageDocument(before));
      const saved=withMobileOperation(()=>savePageDocument({...input,actorId:grantId}));
      if(!saved.ok)throw new PageDocumentFailure(409,'page_revision_conflict',portablePageDocument(saved.conflict.current));
      if(input.title!==undefined&&input.title!==saved.document.page.title)updatePage(input.pageId,{title:input.title},saved.document.page.revision,grantId);
      const committed=getPageDocumentReadOnly(input.pageId)!;
      const result={id:request.id,document:portablePageDocument(committed),assets:pageDocumentAssets(committed),dependencies:mobilePageDependencies(committed)};
      db.prepare('INSERT INTO desktop_page_edit_receipts VALUES(?,?,?,?)').run(grantId,request.id,payload,JSON.stringify(result));return result;
    })();
  }));
  invalidateLiveCorpus(vaultId);return value;
}
