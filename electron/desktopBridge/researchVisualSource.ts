import {createHash} from 'node:crypto';
import {getActiveVault} from '../vaults/vaultRegistry';
import {getWritingWorkshopDraft} from '../db/writingDraftsRepo';
import {readDocumentVisuals} from '../capabilities/documentStore';
import {getChatImage,getCapabilityFile} from '../chatAssets';
import {researchVisualFields} from '../../shared/documentVisualContent';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
interface CapturedAsset {id:string;figureId:string;owner:string;mimeType:string;byteCount:number;sha256:string}
/** An explicit source for figure editing, never a prose generation or publication. */
export function getMobileDeepResearchVisualSource(raw:unknown){
 const input=raw as {reportId?:string};if(!input||typeof input.reportId!=='string'||!uuid.test(input.reportId))throw new Error('invalid_research_visual_source');
 const vaultId=getActiveVault().id,target={kind:'deep-research' as const,id:input.reportId},saved=getWritingWorkshopDraft(input.reportId);
 if(!saved||saved.draft.brief.kind!=='deep_research')throw new Error('research_visual_document_missing');
 const manifest=readDocumentVisuals(vaultId,target),assets:CapturedAsset[]=[];
 for(const figure of manifest?.figures??[]){
  const references=new Map<string,'image'|'file'>();
  if(figure.poster?.startsWith('nodus-image://'))references.set(figure.poster,'image');
  const visit=(nodes:unknown)=>{if(!Array.isArray(nodes))return;for(const node of nodes){if(!node||typeof node!=='object')continue;const value=node as {attachmentId?:unknown;children?:unknown};if(typeof value.attachmentId==='string')references.set(`nodus-capability://chat/${figure.owner}/${value.attachmentId}`,'file');visit(value.children);}};visit(figure.view?.nodes);
  for(const [source,kind] of references){const match=/^nodus-(?:image|capability):\/\/chat\/([a-f0-9]{64})\/([a-f0-9-]{36})$/.exec(source);if(!match||match[1]!==figure.owner||!uuid.test(match[2]))throw new Error('research_visual_asset_owner_mismatch');
   const image=kind==='image'?getChatImage(`${match[1]}/${match[2]}`):null,file=kind==='file'?getCapabilityFile(source):null;
   const bytes=image?.blob??file?.blob,mimeType=image?.mime??file?.mimeType;if(!bytes||!mimeType||!['image/png','image/jpeg','image/webp'].includes(mimeType)||bytes.length>8*1024*1024)throw new Error('research_visual_asset_unavailable');
   const descriptor={id:match[2],figureId:figure.id,owner:match[1],mimeType,byteCount:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
   const existing=assets.find(asset=>asset.id===descriptor.id&&asset.owner===descriptor.owner);if(existing){if(JSON.stringify(existing)!==JSON.stringify(descriptor))throw new Error('research_visual_asset_identity_conflict');}else assets.push(descriptor);
  }
 }
 const contentHash=createHash('sha256').update(JSON.stringify(researchVisualFields(saved.draft))).digest('hex');
 if(manifest&&manifest.contentHash!==contentHash)throw new Error('research_visual_source_content_conflict');
 const capture={version:1,vaultId,target,contentHash,manifest,assets},captureCanonical=JSON.stringify(capture),captureHash=createHash('sha256').update(captureCanonical).digest('hex');
 return {version:1,vaultId,target,draft:saved.draft,contentHash,expectedRevision:manifest?.revision??null,origin:'desktop-capture',capture,captureCanonical,captureHash};
}
/** Re-resolve the actual source for every bounded read: removed/replaced figures
 * cannot continue to disclose files under a stale source proof. */
export function readMobileDeepResearchVisualAsset(raw:unknown){
 const input=raw as {reportId:string;captureHash:string;assetId:string;owner:string;offset:number;count:number};
 if(!input||!Number.isSafeInteger(input.offset)||input.offset<0||!Number.isSafeInteger(input.count)||input.count<1||input.count>524288)throw new Error('invalid_research_visual_asset_read');
 const source=getMobileDeepResearchVisualSource({reportId:input.reportId});if(source.captureHash!==input.captureHash)throw new Error('research_visual_source_revision_conflict');
 const asset=source.capture.assets.find(item=>item.id===input.assetId&&item.owner===input.owner);if(!asset||input.offset>asset.byteCount)throw new Error('research_visual_asset_not_captured');
 const image=getChatImage(`${asset.owner}/${asset.id}`),file=image?null:getCapabilityFile(`nodus-capability://chat/${asset.owner}/${asset.id}`),bytes=image?.blob??file?.blob;
 if(!bytes||bytes.length!==asset.byteCount||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw new Error('research_visual_asset_changed');
 return {version:1,assetId:asset.id,offset:input.offset,byteCount:asset.byteCount,base64:bytes.subarray(input.offset,Math.min(input.offset+input.count,bytes.length)).toString('base64')};
}
