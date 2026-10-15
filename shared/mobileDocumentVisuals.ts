import {canonicalJson} from './canonicalJson';
import {researchVisualFields} from './documentVisualContent';
import type {DocumentVisualManifest,DocumentSkillPolicy} from './documentSkills';
import type {DurableMobileCompletionJournal,MobileDeepResearchVisuals} from './mobileDeepResearch';
import type {ModelRef,WritingWorkshopDraft} from './types';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
export interface DocumentVisualCapture {
 version:1;vaultId:string;target:{kind:'deep-research';id:string};contentHash:string;
 manifest:DocumentVisualManifest|null;
 assets:Array<{id:string;figureId:string;owner:string;mimeType:string;byteCount:number;sha256:string}>;
}
export interface MobileDocumentVisualSource {
 version:1;vaultId:string;target:{kind:'deep-research';id:string};draft:WritingWorkshopDraft;
 contentHash:string;expectedRevision:string|null;origin:'desktop-capture'|'authored-mobile';
 capture:DocumentVisualCapture;captureCanonical:string;captureHash:string;
 /** A genuine initial report publication, never an invented receipt. */
 publicationDependency?:{recordId:string;generationId:string};
 originalReceipts?:unknown[];
}
export interface MobileDocumentVisualCheckpoint extends DurableMobileCompletionJournal {
 version:1;kind:'documentVisuals';id:string;entityKey:string;target:MobileDocumentVisualSource['target'];
 source:MobileDocumentVisualSource;createdAt:string;updatedAt:string;
 state:'capturing'|'ready'|'running'|'pending'|'available'|'failed'|'cancelled'|'blocked';
 manifest:DocumentVisualManifest|null;assets:MobileDeepResearchVisuals['assets'];
 policy:DocumentSkillPolicy;model?:ModelRef;imageModel?:ModelRef;
 previous?:{manifest:DocumentVisualManifest|null;assets:MobileDeepResearchVisuals['assets']};
 commands:Array<{id:string;expectedRevision:string|null;visuals:MobileDeepResearchVisuals|null;state:'pending'|'available'|'blocked';error?:string}>;
 recoveryReviewRequired?:boolean;error?:string;
}
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/;
export const documentVisualCaptureHash=(canonical:string)=>bytesToHex(sha256(new TextEncoder().encode(canonical)));
/** Trust only the exact captured source. The duplicate canonical string is small
 * metadata and binds bytes identically across JS and Swift encoders. */
export function validateMobileDocumentVisualSource(raw:unknown,vaultId:string,reportId:string):MobileDocumentVisualSource {
 const source=raw as MobileDocumentVisualSource;
 if(!source||source.version!==1||source.vaultId!==vaultId||source.target?.kind!=='deep-research'||source.target.id!==reportId||!uuid.test(reportId)||!source.draft||source.draft.brief?.kind!=='deep_research'||!hash.test(source.contentHash)||!['desktop-capture','authored-mobile'].includes(source.origin)||typeof source.captureCanonical!=='string'||!hash.test(source.captureHash)||documentVisualCaptureHash(source.captureCanonical)!==source.captureHash)throw new Error('invalid_document_visual_source');
 const capture=JSON.parse(source.captureCanonical) as DocumentVisualCapture;
 if(bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(researchVisualFields(source.draft)))))!==source.contentHash)throw new Error('document_visual_source_content_conflict');
 if(canonicalJson(capture)!==canonicalJson(source.capture)||capture.version!==1||capture.vaultId!==vaultId||capture.target.kind!=='deep-research'||capture.target.id!==reportId||capture.contentHash!==source.contentHash||!Array.isArray(capture.assets)||source.expectedRevision!==(capture.manifest?.revision??null))throw new Error('invalid_document_visual_capture');
 if(capture.manifest&&(capture.manifest.vaultId!==vaultId||capture.manifest.target.id!==reportId||capture.manifest.target.kind!=='deep-research'||capture.manifest.contentHash!==source.contentHash))throw new Error('document_visual_capture_owner_conflict');
 for(const asset of capture.assets){if(!uuid.test(asset.id)||!uuid.test(asset.figureId)||!hash.test(asset.owner)||!hash.test(asset.sha256)||!Number.isSafeInteger(asset.byteCount)||asset.byteCount<1||asset.byteCount>8*1024*1024||!['image/png','image/jpeg','image/webp'].includes(asset.mimeType)||!capture.manifest?.figures.some(figure=>figure.id===asset.figureId&&figure.owner===asset.owner))throw new Error('invalid_document_visual_capture_asset');}
 return structuredClone(source);
}
