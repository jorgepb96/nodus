import {createHash} from 'node:crypto';
import type {DocumentVisualManifest} from '../../shared/documentSkills';
import {documentBlocks} from '../../shared/documentSkills';
import {researchVisualFields} from '../../shared/documentVisualContent';
import type {DeepResearchRequest,WritingWorkshopDraft} from '../../shared/types';
import {canonicalJson} from '../../shared/canonicalJson';
import {validateViewDocument} from '../../packages/capability-api/src/views';
import {chatAssetOwner,getChatImage,getCapabilityFile} from '../chatAssets';
import {researchFigureReceipt} from './researchFigureUploads';
import {writeDocumentVisuals} from '../capabilities/documentStore';
export interface MobileResearchVisuals {manifest:DocumentVisualManifest;assets:Array<{id:string;owner:string;ownerRevision:string;generationId:string;figureId:string;mimeType:string;byteCount:number;sha256:string}>}
function fail():never{throw new Error('invalid_mobile_research_visuals');}
/** Validate every immutable receipt before the report's SQLite receipt is committed.
 * Images stay separate files, and the report contains only scoped references. */
export function validateMobileResearchVisuals(raw:unknown,request:DeepResearchRequest,draft:WritingWorkshopDraft,vaultId:string,generationId:string,grant:string):DocumentVisualManifest|null {
 if(raw===undefined)return null;const input=raw as MobileResearchVisuals,manifest=input?.manifest;
 if(!manifest||manifest.schemaVersion!==1||manifest.target.kind!=='deep-research'||manifest.target.id!==generationId||manifest.vaultId!==vaultId||!request.documentSkills||canonicalJson(manifest.policy)!==canonicalJson(request.documentSkills)||!Array.isArray(manifest.figures)||!Array.isArray(manifest.blocks)||!Array.isArray(input.assets)||!['ready','partial','cancelled','failed'].includes(manifest.state))fail();
 const fields=researchVisualFields(draft);if(manifest.contentHash!==createHash('sha256').update(JSON.stringify(fields)).digest('hex')||canonicalJson(manifest.blocks)!==canonicalJson(documentBlocks(fields)))fail();
 const assets=new Map<string,MobileResearchVisuals['assets'][number]>();for(const asset of input.assets){if(!asset||assets.has(asset.id))fail();const actual=researchFigureReceipt(grant,asset.id);if(!actual||actual.vaultId!==vaultId||actual.generationId!==generationId||['id','owner','ownerRevision','generationId','figureId','mimeType','byteCount','sha256'].some(key=>actual[key as keyof typeof actual]!==asset[key as keyof typeof asset]))fail();const image=getChatImage(`${asset.owner}/${asset.id}`);if(!image||image.mime!==asset.mimeType||image.blob.length!==asset.byteCount||createHash('sha256').update(image.blob).digest('hex')!==asset.sha256)fail();assets.set(asset.id,asset);}
 const used=new Set<string>();const requireAsset=(id:string,figure:DocumentVisualManifest['figures'][number])=>{const asset=assets.get(id);if(!asset||asset.owner!==figure.owner||asset.ownerRevision!==figure.ownerRevision||asset.figureId!==figure.id)fail();used.add(id);return asset;};
 for(const figure of manifest.figures){if(!manifest.blocks.some(block=>block.id===figure.blockId)||!Array.isArray(figure.sources))fail();if(!figure.owner){if(figure.state==='ready'||figure.view||figure.poster)fail();continue;}if(!figure.ownerRevision||figure.owner!==chatAssetOwner('document-figure',`deep-research:${generationId}:${figure.ownerRevision}:${figure.id}`,vaultId))fail();
  if(figure.view){const view=validateViewDocument(figure.view);const visit=(nodes:typeof view.nodes)=>{for(const node of nodes){if(node.kind==='details')visit(node.children);if('attachmentId' in node){requireAsset(node.attachmentId,figure);if(!getCapabilityFile(`nodus-capability://chat/${figure.owner}/${node.attachmentId}`))fail();}}};visit(view.nodes);}
  if(figure.poster){const prefix=`nodus-image://chat/${figure.owner}/`;if(!figure.poster.startsWith(prefix))fail();const poster=requireAsset(figure.poster.slice(prefix.length),figure);if(poster.mimeType!=='image/png')fail();}else if(figure.state==='ready')fail();
 }
 if(used.size!==assets.size)fail();return structuredClone(manifest);
}
export function publishMobileResearchVisuals(manifest:DocumentVisualManifest|null){if(manifest)writeDocumentVisuals(manifest);}
