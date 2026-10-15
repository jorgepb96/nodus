import {previewCompleteGuideSnapshot,type CompleteGuidePreviewRequest} from './completeGuide/preview';
import {resolveCompleteGuideSelection} from './completeGuide/selection';
import {buildCompleteGuideSnapshot,type CompleteGuideSourceText} from './completeGuide/snapshot';
import {canonicalJson} from './canonicalJson';
import {normalizeCompleteGuideConfig,type CompleteGuideSelection} from './completeGuide/types';
import type {CompleteGuideFrozenSource} from './completeGuide/report';
import type {CompleteGuideCatalog} from './completeGuide/preview';
import type {CompleteGuideFigure} from './completeGuide/figures';
import type {MobileDeepResearchProof} from './mobileDeepResearch';
export interface MobileCompleteGuideSource {
 version:1;kind:'completeGuide';context:MobileDeepResearchProof;
 selection:CompleteGuideSelection;frozen:CompleteGuideFrozenSource;catalog:CompleteGuideCatalog;
 /** Prepared images are consulted source data, not generated model output. */
 texts?:CompleteGuideSourceText[];
 figures:Record<string,CompleteGuideFigure>;
}
export function completeGuideFigureKey(materialId:string,page:number|null,slide:number|null):string{return canonicalJson([materialId,page,slide]);}
export function completeGuideSelectionKey(selection:CompleteGuideSelection):string {
 const normalized=normalizeCompleteGuideConfig({version:1,runId:'mobile-selection',selection});
 return canonicalJson({nodes:[...normalized.selection.nodes].sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))),excludedSourceKeys:[...normalized.selection.excludedSourceKeys].sort()});
}
export function assertMobileCompleteGuideSource(value:MobileCompleteGuideSource,selection:CompleteGuideSelection):void {
 if(value?.version!==1||value.kind!=='completeGuide'||value.context?.version!==1||!value.context.vaultId||value.context.vaultType!=='estudio'||!['linked_corpus','device_downloads'].includes(value.context.sourceScope)||!/^[a-f0-9]{64}$/.test(value.context.revision)||!value.frozen?.snapshot?.totals?.readablePassages||!Array.isArray(value.frozen.snapshot.sources)||!Array.isArray(value.frozen.snapshot.passages)||!value.catalog||!value.figures||typeof value.figures!=='object'||Array.isArray(value.figures)||completeGuideSelectionKey(value.selection)!==completeGuideSelectionKey(selection))throw new Error('invalid_complete_guide_source');
 const sources=new Set(value.frozen.snapshot.sources.map(source=>source.sourceKey));
 if(sources.size!==value.frozen.snapshot.sources.length||value.frozen.snapshot.passages.some(passage=>!sources.has(passage.sourceKey)||typeof passage.text!=='string'))throw new Error('invalid_complete_guide_source');
 if(new TextEncoder().encode(JSON.stringify(value)).length>16_000_000)throw new Error('deep_research_source_too_large');
}

/** Rebuild the exact chosen reading set with canonical selection/snapshot code.
 * Catalogue visibility alone never makes an undownloaded source available. */
export function selectMobileCompleteGuideSources(copies:MobileCompleteGuideSource[],selection:CompleteGuideSelection):MobileCompleteGuideSource {
 if(!copies.length)throw new Error('complete_guide_not_downloaded');
 const first=copies[0];
 const catalog=new Map<string,MobileCompleteGuideSource['catalog']['sources'][number]>();
 const groups=new Map<string,Map<string,unknown>>();
 for(const copy of copies){
  assertMobileCompleteGuideSource(copy,copy.selection);
  if(copy.context.vaultId!==first.context.vaultId||copy.context.vaultType!==first.context.vaultType||copy.context.sourceScope!==first.context.sourceScope)throw new Error('complete_guide_source_scope_conflict');
  for(const source of copy.catalog.sources)catalog.set(source.sourceKey,source);
  for(const [group,rows] of Object.entries(copy.catalog.organization)){const values=groups.get(group)??new Map();for(const row of rows)values.set(row.id,row);groups.set(group,values);}
 }
 const organization=Object.fromEntries(['courses','subjects','folders','topics'].map(group=>[group,[...(groups.get(group)?.values()??[])]])) as unknown as MobileCompleteGuideSource['catalog']['organization'];
 const resolved=resolveCompleteGuideSelection(selection,[...catalog.values()],organization);
 if(resolved.unavailable.length||!resolved.sources.length)throw new Error('complete_guide_not_downloaded');
 const texts:CompleteGuideSourceText[]=[],figures:MobileCompleteGuideSource['figures']={};
 let revision:string|undefined;
 for(const wanted of resolved.sources){
  const matching=copies.filter(copy=>copy.texts?.some(text=>text.source.sourceKey===wanted.sourceKey));
  if(new Set(matching.map(copy=>copy.context.revision)).size>1)throw new Error('complete_guide_source_revision_conflict');
  const copy=matching[0],text=copy?.texts?.find(text=>text.source.sourceKey===wanted.sourceKey);
  if(!copy||!text)throw new Error('complete_guide_not_downloaded');
  if(revision&&revision!==copy.context.revision)throw new Error('complete_guide_source_revision_conflict');
  revision=copy.context.revision;texts.push({...text,source:wanted});
  for(const [key,figure] of Object.entries(copy.figures))if(JSON.parse(key)[0]===wanted.sourceId)figures[key]=figure;
 }
 const snapshot=buildCompleteGuideSnapshot(texts,organization);
 const value:MobileCompleteGuideSource={version:1,kind:'completeGuide',context:{...first.context,revision:revision!},selection,frozen:{snapshot,organization,snapshotAt:first.frozen.snapshotAt},catalog:{sources:resolved.sources,organization},figures};
 assertMobileCompleteGuideSource(value,selection);return value;
}

export function previewMobileCompleteGuide(copies:MobileCompleteGuideSource[],request:CompleteGuidePreviewRequest) {
 const config=normalizeCompleteGuideConfig(request.completeGuide),source=selectMobileCompleteGuideSources(copies,config.selection);
 return previewCompleteGuideSnapshot(request,config,resolveCompleteGuideSelection(config.selection,source.catalog.sources,source.catalog.organization),source.frozen.snapshot);
}
export type MobileResearchSourceScope='linked_corpus'|'device_downloads';
export interface MobileCompleteGuideActions {
 catalog(scope:MobileResearchSourceScope):Promise<CompleteGuideCatalog>;
 preview(scope:MobileResearchSourceScope,request:CompleteGuidePreviewRequest):Promise<ReturnType<typeof previewMobileCompleteGuide>>;
 download(request:import('./types').DeepResearchRequest,days:7|30):Promise<void>;
 downloadGenealogy?(request:import('./types').DeepResearchRequest,days:7|30):Promise<void>;
 downloadAcademic?(request:import('./types').DeepResearchRequest,days:7|30):Promise<void>;
 academicDownloads?():Promise<Array<{recordId:string;notebookId:string|null;title:string;settings:import('./researchCorpus').RetrievalSettings}>>;
}
