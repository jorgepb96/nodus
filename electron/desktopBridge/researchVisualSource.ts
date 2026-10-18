import {getDocumentVisuals} from '../ai/documentVisuals';
import type {WritingWorkshopDraft} from '../../shared/types';
import {canonicalJson} from '../../shared/canonicalJson';
import type {DocumentVisualCapture} from '../../shared/mobileDocumentVisuals';
import {createHash} from 'node:crypto';
import {getDb} from '../db/database';
import {getActiveVault} from '../vaults/vaultRegistry';
import {getWritingWorkshopDraft} from '../db/writingDraftsRepo';
import {readDocumentVisuals} from '../capabilities/documentStore';
import {getChatImage,getCapabilityFile} from '../chatAssets';
import {researchVisualFields} from '../../shared/documentVisualContent';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
interface CapturedAsset {id:string;figureId:string;owner:string;mimeType:string;byteCount:number;sha256:string}
function hasAttachment(nodes:unknown,id:string):boolean{return Array.isArray(nodes)&&nodes.some(node=>node&&typeof node==='object'&&((node as {attachmentId?:unknown}).attachmentId===id||hasAttachment((node as {children?:unknown}).children,id)));}
/** Corpus readers carry the persisted draft; Desktop readers carry its current
 * citation-label projection. Both must match an exact current source, never an
 * arbitrary relabelled caller payload. Keep manifest/asset revision checks separate. */
export function matchesResearchVisualReadDraft(reportId:string, expected:WritingWorkshopDraft, current:WritingWorkshopDraft):boolean {
 const same=(draft:WritingWorkshopDraft)=>draft.title===expected.title&&canonicalJson(researchVisualFields(draft))===canonicalJson(researchVisualFields(expected));
 if(same(current))return true;
 const row=getDb().prepare('SELECT draft_json FROM writing_saved_drafts WHERE id = ?').get(reportId) as {draft_json:string}|undefined;
 if(!row)return false;
 const persisted=JSON.parse(row.draft_json) as WritingWorkshopDraft;
 return same(persisted);
}
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
 const capture:DocumentVisualCapture={version:1,vaultId,target,contentHash,manifest,assets},captureCanonical=JSON.stringify(capture),captureHash=createHash('sha256').update(captureCanonical).digest('hex');
 const db=getDb();db.exec('CREATE TABLE IF NOT EXISTS mobile_research_visual_captures(report_id TEXT NOT NULL,capture_hash TEXT NOT NULL,capture_json TEXT NOT NULL,PRIMARY KEY(report_id,capture_hash))');db.prepare('INSERT OR IGNORE INTO mobile_research_visual_captures VALUES(?,?,?)').run(input.reportId,captureHash,captureCanonical);
 return {version:1,vaultId,target,draft:saved.draft,contentHash,expectedRevision:manifest?.revision??null,origin:'desktop-capture',capture,captureCanonical,captureHash};
}
/** Re-resolve the actual source for every bounded read: removed/replaced figures
 * cannot continue to disclose files under a stale source proof. */
export function readMobileDeepResearchVisualAsset(raw:unknown){
 const source=raw as {action?:string;reportId?:string;expectedDraft?:WritingWorkshopDraft};
 if(source?.action==='context'){
  if(typeof source.reportId!=='string'||!uuid.test(source.reportId)||!source.expectedDraft||typeof source.expectedDraft.draftMarkdown!=='string'||typeof source.expectedDraft.abstract!=='string')throw new Error('invalid_research_visual_context');
  const saved=getWritingWorkshopDraft(source.reportId);
  if(!saved||saved.draft.brief.kind!=='deep_research'||!matchesResearchVisualReadDraft(source.reportId,source.expectedDraft,saved.draft))throw new Error('research_visual_source_revision_conflict');
  const target={kind:'deep-research' as const,id:source.reportId};return {version:1,vaultId:getActiveVault().id,target,manifest:getDocumentVisuals(target)};
 }
 const input=raw as {reportId:string;captureHash?:string;expected?:{contentHash:string;revision:string|null;manifestHash?:string};expectedManifest?:unknown;source?:string;assetId:string;owner:string;offset:number;count:number};
 if(!input||!uuid.test(input.reportId)||!uuid.test(input.assetId)||!/^([a-f0-9]{64})$/.test(input.owner)||!Number.isSafeInteger(input.offset)||input.offset<0||!Number.isSafeInteger(input.count)||input.count<1||input.count>524288)throw new Error('invalid_research_visual_asset_read');
 const saved=getWritingWorkshopDraft(input.reportId),manifest=readDocumentVisuals(getActiveVault().id,{kind:'deep-research',id:input.reportId});
 if(!saved||saved.draft.brief.kind!=='deep_research')throw new Error('research_visual_document_missing');
 const contentHash=createHash('sha256').update(JSON.stringify(researchVisualFields(saved.draft))).digest('hex');
 let asset:CapturedAsset|undefined;
 if(input.expected){
  const expected={contentHash,revision:manifest?.revision??null,manifestHash:createHash('sha256').update(canonicalJson(manifest)).digest('hex')};
  if(input.expected.contentHash!==contentHash||input.expected.revision!==expected.revision||(input.expected.manifestHash?input.expected.manifestHash!==expected.manifestHash:canonicalJson(input.expectedManifest)!==canonicalJson(manifest)))throw new Error('research_visual_source_revision_conflict');
  const imageSource=`nodus-image://chat/${input.owner}/${input.assetId}`,fileSource=`nodus-capability://chat/${input.owner}/${input.assetId}`;if(input.source&&input.source!==imageSource&&input.source!==fileSource)throw new Error('invalid_research_visual_asset_read');
  const figure=manifest?.figures.find(item=>item.owner===input.owner&&(input.source===imageSource?item.poster===imageSource:input.source===fileSource?hasAttachment(item.view?.nodes,input.assetId):item.poster===imageSource||hasAttachment(item.view?.nodes,input.assetId)));
  if(!figure)throw new Error('research_visual_asset_not_captured');
  const image=input.source?.startsWith('nodus-capability://')?null:getChatImage(`${input.owner}/${input.assetId}`),file=image?null:getCapabilityFile(`nodus-capability://chat/${input.owner}/${input.assetId}`),bytes=image?.blob??file?.blob,mimeType=image?.mime??file?.mimeType;
  if(!bytes||!mimeType||!['image/png','image/jpeg','image/webp'].includes(mimeType)||bytes.length>8*1024*1024)throw new Error('research_visual_asset_unavailable');
  asset={id:input.assetId,figureId:figure.id,owner:input.owner,mimeType,byteCount:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 }else{
  const capture=input.captureHash?capturedResearchVisualProof(input.reportId,input.captureHash):null;
  if(!capture||capture.contentHash!==contentHash||canonicalJson(manifest)!==canonicalJson(capture.manifest))throw new Error('research_visual_source_revision_conflict');
  asset=capture.assets.find(item=>item.id===input.assetId&&item.owner===input.owner);
 }
 if(!asset||input.offset>asset.byteCount)throw new Error('research_visual_asset_not_captured');
 const image=input.source?.startsWith('nodus-capability://')?null:getChatImage(`${asset.owner}/${asset.id}`),file=image?null:getCapabilityFile(`nodus-capability://chat/${asset.owner}/${asset.id}`),bytes=image?.blob??file?.blob;
 if(!bytes||bytes.length!==asset.byteCount||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw new Error('research_visual_asset_changed');
 return {version:1,assetId:asset.id,offset:input.offset,byteCount:asset.byteCount,mimeType:asset.mimeType,sha256:asset.sha256,base64:bytes.subarray(input.offset,Math.min(input.offset+input.count,bytes.length)).toString('base64')};
}

/** Only captures actually made from this owning vault can authorize legacy
 * assets after later visual revisions. No caller-supplied proof is trusted. */
export function capturedResearchVisualProof(reportId:string,captureHash:string){
 getDb().exec('CREATE TABLE IF NOT EXISTS mobile_research_visual_captures(report_id TEXT NOT NULL,capture_hash TEXT NOT NULL,capture_json TEXT NOT NULL,PRIMARY KEY(report_id,capture_hash))');
 const row=getDb().prepare('SELECT capture_json FROM mobile_research_visual_captures WHERE report_id=? AND capture_hash=?').get(reportId,captureHash) as {capture_json:string}|undefined;
 if(!row)return null;const value=JSON.parse(row.capture_json) as ReturnType<typeof getMobileDeepResearchVisualSource>['capture'];
 return value.vaultId===getActiveVault().id?value:null;
}
