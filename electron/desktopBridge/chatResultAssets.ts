import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {getCapabilityFile,getChatImageMetadata} from '../chatAssets';
import {withOwningVault} from '../vaults/vaultRegistry';
import {activeVaultDir} from '../vaults/vaultRegistry';
import {researchAttachmentOriginal} from '../researchAttachments';
import {withVaultDatabase} from '../db/database';
import {mobileChatAssetOwner,MobileChatFailure} from './chatHistory';
import {mobileDomainAllowed} from './executionBoundary';
import {renderStoredCapabilityArtifact,renderStoredLegacyResult} from '../ipc/capabilities';
import {capabilityRegistry} from '../capabilities/registry';
import {fetchCapabilityTile} from '../capabilities/tileProxy';
import {splitChatVisuals} from '../../shared/chatSkills';
import {validateViewDocument,type ViewDocumentV1} from '../../packages/capability-api/src/views';

export interface MobileChatAssetRequest {kind:string;conversationId:string;source:string}
export function validateChatAssetRequest(raw:unknown,domains:readonly string[],scheme:'nodus-capability'|'nodus-artifact'|'nodus-image'|'nodus-attachment') {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new MobileChatFailure(400,'invalid_chat_asset');
  const value=raw as Record<string,unknown>;
  if(Object.keys(value).some(key=>!['kind','conversationId','source'].includes(key))||typeof value.kind!=='string'||typeof value.conversationId!=='string'||typeof value.source!=='string'||value.source.length>512)throw new MobileChatFailure(400,'invalid_chat_asset');
  const owned=mobileChatAssetOwner(value.kind,value.conversationId,domains);
  const match=new RegExp(`^${scheme}://chat/([a-f0-9]{64})/(${scheme==='nodus-attachment'?'[a-zA-Z0-9_-]{1,100}':'[a-f0-9-]{36}'})$`).exec(value.source);
  if(!match||match[1]!==owned.owner)throw new MobileChatFailure(403,'chat_asset_owner_forbidden');
  return {request:value as unknown as MobileChatAssetRequest,...owned};
}
function originalTexts(data:Record<string,unknown>):string[] {
  return Array.isArray(data.messages)?data.messages.flatMap(message=>{
    if(!message||typeof message!=='object')return [];
    const fields=message as Record<string,unknown>,texts=typeof fields.content==='string'?[fields.content]:[];
    const council=fields.concilium as {members?:Array<{answer?:unknown}>}|undefined;
    if(Array.isArray(council?.members))for(const member of council.members)if(typeof member.answer==='string')texts.push(member.answer);
    return texts;
  }):[];
}
export async function getMobileChatResultArtifact(raw:unknown,locale='en') {
  const domains=['corpus','study-recordings'].filter(mobileDomainAllowed);
  const {request,data,requiredDomains}=validateChatAssetRequest(raw,domains,'nodus-artifact');
  if(!originalTexts(data).some(text=>text.includes(request.source)))throw new MobileChatFailure(403,'chat_artifact_not_referenced');
  if(typeof locale!=='string'||locale.length>16)throw new MobileChatFailure(400,'invalid_chat_asset_locale');
  return bounded({...await renderStoredCapabilityArtifact(request.source,locale),requiredDomains});
}
function bounded<T>(value:T):T {
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>12*1024*1024)throw new MobileChatFailure(413,'chat_result_too_large');return value;
}
const viewCopies=new Map<string,{expires:number;views:Array<{capabilityId:string;view:ViewDocumentV1}>}>();
export async function getMobileChatReadResource(raw:unknown,locale='en') {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new MobileChatFailure(400,'invalid_chat_read_resource');
  const value=raw as Record<string,unknown>;
  if(Object.keys(value).some(key=>!['kind','conversationId','action','fence','payload','capabilityId','service','path','source'].includes(key))||typeof value.kind!=='string'||typeof value.conversationId!=='string'||typeof locale!=='string'||locale.length>16)throw new MobileChatFailure(400,'invalid_chat_read_resource');
  const {owner,data,requiredDomains}=mobileChatAssetOwner(value.kind,value.conversationId,['corpus','study-recordings'].filter(mobileDomainAllowed));
  const legacyFences=[...capabilityRegistry().fences].filter(([,claim])=>claim.kind==='legacy').map(([fence])=>fence);
  if(value.action==='metadata')return bounded({owner,legacyFences,requiredDomains});
  const messages=Array.isArray(data.messages)?data.messages:[];
  if(value.action==='imageMetadata') {
    const {request}=validateChatAssetRequest({kind:value.kind,conversationId:value.conversationId,source:value.source},['corpus','study-recordings'].filter(mobileDomainAllowed),'nodus-image');
    if(!originalTexts(data).some(text=>text.includes(request.source)))throw new MobileChatFailure(403,'chat_result_not_referenced');
    const metadata=getChatImageMetadata(request.source);if(!metadata)throw new MobileChatFailure(404,'chat_image_unavailable');return bounded({metadata,requiredDomains});
  }
  const parts=originalTexts(data).flatMap(text=>splitChatVisuals(text,new Set(),new Set(legacyFences)));
  if(value.action==='legacy') {
    if(typeof value.fence!=='string'||typeof value.payload!=='string'||value.payload.length>256*1024||!parts.some(part=>part.kind==='capability-legacy'&&part.complete&&part.fence===value.fence&&part.content===value.payload))throw new MobileChatFailure(403,'chat_result_not_referenced');
    for(const match of value.payload.matchAll(/nodus-[a-z0-9-]+:\/\/chat\/([a-f0-9]{64})\//g))if(match[1]!==owner)throw new MobileChatFailure(403,'chat_asset_owner_forbidden');
    return bounded({...await renderStoredLegacyResult(value.fence,value.payload,locale),requiredDomains});
  }
  if(value.action!=='tile'||typeof value.capabilityId!=='string'||typeof value.service!=='string'||typeof value.path!=='string')throw new MobileChatFailure(400,'invalid_chat_read_resource');
  const key=createHash('sha256').update(JSON.stringify([owner,data,locale,legacyFences])).digest('hex');
  const copy=viewCopies.get(key);let views=copy&&copy.expires>Date.now()?copy.views:undefined;
  if(!views) {
    views=[];
    const visual=parts.filter(part=>part.complete&&['capability-view','capability-artifact','capability-legacy'].includes(part.kind));
    if(visual.length>128)throw new MobileChatFailure(413,'chat_result_too_large');
    for(const part of visual) {
      let result:any;
      if(part.kind==='capability-view') {try{result=JSON.parse(part.content);}catch{continue;}if(result.owner&&result.owner!==owner)throw new MobileChatFailure(403,'chat_asset_owner_forbidden');}
      else if(part.kind==='capability-artifact') {let ref:any;try{ref=JSON.parse(part.content);}catch{continue;}if(typeof ref.source!=='string')continue;validateChatAssetRequest({kind:value.kind,conversationId:value.conversationId,source:ref.source},['corpus','study-recordings'].filter(mobileDomainAllowed),'nodus-artifact');result=await renderStoredCapabilityArtifact(ref.source,locale);if(!result.available)continue;result={...result,capabilityId:result.sidecar.capabilityId};}
      else {for(const match of part.content.matchAll(/nodus-[a-z0-9-]+:\/\/chat\/([a-f0-9]{64})\//g))if(match[1]!==owner)throw new MobileChatFailure(403,'chat_asset_owner_forbidden');result=await renderStoredLegacyResult(part.fence!,part.content,locale);if(!result.available)continue;}
      if(typeof result.capabilityId==='string')views.push({capabilityId:result.capabilityId,view:validateViewDocument(result.view)});
    }
    bounded(views);if(viewCopies.size>=20)viewCopies.delete(viewCopies.keys().next().value!);viewCopies.set(key,{views,expires:Date.now()+5*60*1000});
  }
  function declared(nodes:ViewDocumentV1['nodes']):boolean {return nodes.some(node=>node.kind==='imageTiles'&&node.service===value.service||node.kind==='details'&&declared(node.children));}
  if(!views.some(item=>item.capabilityId===value.capabilityId&&declared(item.view.nodes)))throw new MobileChatFailure(403,'chat_tile_not_referenced');
  const tile=await fetchCapabilityTile({capabilityId:value.capabilityId,service:value.service,path:value.path});
  return bounded({data:tile.bytes.toString('base64'),mimeType:tile.mimeType,requiredDomains});
}
/** Opaque conversation/source identities resolve original files. There is no
 * URL fetch, filesystem path, provider call or tool invocation in this lane. */
export async function serveChatCapabilityFile(request:IncomingMessage,response:ServerResponse,url:URL,vaultId:string,domains:readonly string[],id:string,action:string) {
  const json=(status:number,value:unknown)=>{response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(request.method==='HEAD'?undefined:JSON.stringify(value));};
  await withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>{
    try {
      if(id.length>2048)throw new MobileChatFailure(400,'invalid_chat_asset');
      let raw:unknown;try{raw=JSON.parse(id);}catch{throw new MobileChatFailure(400,'invalid_chat_asset');}
      const attachment=typeof (raw as MobileChatAssetRequest)?.source==='string'&&(raw as MobileChatAssetRequest).source.startsWith('nodus-attachment://');
      const {request:asset,requiredDomains,data}=validateChatAssetRequest(raw,domains,attachment?'nodus-attachment':'nodus-capability');
      let file:{blob:Buffer;mimeType:string;name:string}|null;
      if(attachment) {
        const attachmentId=asset.source.split('/').pop()!;
        if(!Array.isArray(data.messages)||!data.messages.some(message=>message&&typeof message==='object'&&'attachments' in message&&Array.isArray(message.attachments)&&message.attachments.some(value=>value&&typeof value==='object'&&value.id===attachmentId)))throw new MobileChatFailure(403,'chat_attachment_not_referenced');
        try {
          const original=researchAttachmentOriginal({surface:asset.kind as 'research'|'world'|'database'|'study',conversationId:asset.conversationId},attachmentId),stat=fs.lstatSync(original.path);
          const vault=fs.realpathSync(activeVaultDir()),resolved=fs.realpathSync(original.path);
          if(!stat.isFile()||stat.isSymbolicLink()||stat.size>50*1024*1024||!resolved.startsWith(vault+path.sep))throw new MobileChatFailure(422,'chat_asset_unreadable');
          file={blob:fs.readFileSync(resolved),mimeType:'application/octet-stream',name:original.name};
        } catch(error){if(error instanceof MobileChatFailure)throw error;throw new MobileChatFailure(404,'chat_asset_unavailable');}
      } else file=getCapabilityFile(asset.source);
      if(!file)throw new MobileChatFailure(404,'chat_asset_unavailable');
      if((!attachment&&!file.blob.length)||file.blob.length>64*1024*1024||!file.name||file.name.length>160||/[\\/\0]/.test(file.name)||!/^[\w.+-]+\/[\w.+-]+$/i.test(file.mimeType))throw new MobileChatFailure(422,'chat_asset_unreadable');
      const hash=createHash('sha256').update(file.blob).digest('hex'),chunkSize=4*1024*1024;
      if(action==='descriptor'){json(200,{kind:'chatCapability',id,filename:file.name,mime:file.mimeType,byteSize:file.blob.length,sha256:hash,chunkSize,requiredDomains});return;}
      const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??chunkSize);
      if(!Number.isSafeInteger(offset)||offset<0||offset>file.blob.length||!Number.isSafeInteger(limit)||limit<1||limit>chunkSize)throw new MobileChatFailure(416,'invalid_file_range');
      const chunk=file.blob.subarray(offset,Math.min(offset+limit,file.blob.length));
      response.writeHead(200,{'content-type':file.mimeType,'content-length':String(chunk.length),'cache-control':'no-store','x-content-sha256':hash,'x-content-type-options':'nosniff','x-nodus-file-offset':String(offset),'x-nodus-file-size':String(file.blob.length)});response.end(request.method==='HEAD'?undefined:chunk);
    } catch(error){if(error instanceof MobileChatFailure){json(error.status,{error:error.code});return;}throw error;}
  }));
}
