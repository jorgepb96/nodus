import {selectPassageEvidence} from '@shared/selectPassageEvidence';
import {portableResearchCorpusRun,type ResearchCorpusRunHost} from '@shared/portableResearchCorpusRun';
import {portableResearchActionCoordinator} from '@shared/portableResearchActionCoordinator';
import {portableResearchClaimAudit} from '@shared/portableResearchClaimAudit';
import {portableResearchSectionCoverage} from '@shared/portableResearchSectionCoverage';
import {portableAcademicDeepResearch} from '@shared/portableAcademicDeepResearch';
import {portableDeepResearchAI,type DeepResearchCompletionHost} from '@shared/portableDeepResearchAI';
import {bindPreparedResearchCorpus} from '@shared/portableResearchCorpusBinding';
import {capturedAcademicRetrieval} from '@shared/capturedAcademicRetrieval';
import {validateMobileAcademicResearchSource,type MobileAcademicResearchSource} from '@shared/mobileAcademicResearch';
import {documentsById,assertResearchDocument,assertResearchDocumentPermission} from '@shared/researchCorpusScopeChecks';
import {planApproachRetrieval} from '@shared/portableDeepResearchApproaches';
import {normalizeDeepResearchApproach} from '@shared/deepResearchApproaches';
import {durableDeepResearchCall,type MobileDeepResearchCheckpoint} from '@shared/mobileDeepResearch';
import {sha256Snapshot} from '@shared/databaseResearchEngine';
import {documentedContextWindow} from '@shared/providerContextWindows';
import {researchPromptUpperBound} from '@shared/researchRetrievalBudget';
import {parseDeepResearchRequestVersion} from '@shared/deepResearchVersions';
import {orchestrateDeepResearch} from '../../electron/ai/deepResearchCore';
import {extractCitationRefs} from '../../electron/ai/citationSanitize';
import {structuredPrompt} from './structuredPrompt';
import type {DeepResearchProgress} from '@shared/types';
import type {ResearchEffort} from '@shared/researchReasoning';
type Call=(method:string,...args:any[])=>Promise<any>;
export async function autonomousAcademicResearch(call:Call,checkpoint:MobileDeepResearchCheckpoint,persist:()=>Promise<void>,controller:AbortController,notify:(progress:DeepResearchProgress)=>void){
 const {request}=checkpoint,model=request.model!,signal=controller.signal;
 let source=checkpoint.calls['source:academic']?.output as MobileAcademicResearchSource|undefined;
 if(!source){source=await call('mobileAcademicResearchSource',request);validateMobileAcademicResearchSource(source!);const prior=checkpoint.context,current=source!.context;if(prior&&(prior.vaultId!==current.vaultId||prior.vaultType!==current.vaultType||prior.revision!==current.revision||prior.sourceScope!==current.sourceScope))throw new Error('mobile_academic_source_revision_changed');checkpoint.context={...current};checkpoint.calls['source:academic']={input:JSON.stringify({notebookId:request.notebookId??null,sourceHash:source!.sourceHash}),output:source};await persist();}
 validateMobileAcademicResearchSource(source!);const copied=source!;
 if((request.notebookId??null)!==copied.scope.notebookId)throw new Error('academic_research_notebook_conflict');
 let effort:ResearchEffort=request.thinkingEffort??'standard',windowLimit:number|undefined,overflow:(()=>void)|undefined;
 const complete=async(opts:Parameters<DeepResearchCompletionHost['completeText']>[0],chosen:Parameters<DeepResearchCompletionHost['completeText']>[1],format:'json'|'text',attempt=0)=>{
  signal.throwIfAborted();if(chosen&&(chosen.provider!==model.provider||chosen.model!==model.model))throw new Error('mobile_model_fallback_forbidden');
  const input={...structuredPrompt({system:opts.system,user:opts.user,maxTokens:opts.maxTokens??8000,temperature:opts.temperature??0.2},model,opts.researchEffort??effort),format,generationId:checkpoint.id,completionKey:`academic:${sha256Snapshot([format,opts.system,opts.user])}:${attempt}`};
  if(windowLimit!==undefined&&researchPromptUpperBound(input.system,input.user,input.maxTokens+input.thinkingAllowance)>windowLimit){overflow?.();throw new Error('research_request_budget_exceeded');}
  try{const value=await durableDeepResearchCall(checkpoint,`local:academic:${sha256Snapshot(input)}`,input,()=>call('mobileStructuredCompletion',input),persist,{paid:true,request:input,recover:async()=>{const value=await call('mobileSavedStructuredCompletion',checkpoint.inflight?.request??input);return value===null?undefined:value;}});if(typeof value!=='string')throw new Error('invalid_mobile_academic_completion');return value;}catch(error){controller.abort(error);throw error;}
 };
 const text:DeepResearchCompletionHost['completeText']=(opts,chosen)=>complete(opts,chosen,'text');
 const json:DeepResearchCompletionHost['completeJson']=async(opts,guard,chosen)=>{let failure:unknown;for(let attempt=0;attempt<(opts.noRetry?1:3);attempt++){const raw=await complete(opts,chosen,'json',attempt);try{const value=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));if(guard(value))return value;throw new Error('invalid_academic_model_response');}catch(error){failure=error;}}throw failure;};
 const withResearchValidationThinking=async<T>(_chosen:unknown,work:()=>Promise<T>):Promise<T>=>{const prior=effort;effort='standard';try{return await work();}finally{effort=prior;}};
 const supervisor=portableResearchActionCoordinator({completeJson:json,researchStepTimeoutMs:()=>undefined,researchActivityStep:(_kind,_stage,work)=>work()});
 const unavailable=()=>{throw new Error('desktop_preparation_required');};
 const retrieval=capturedAcademicRetrieval(copied);
 const repository:ResearchCorpusRunHost={
  getActiveVault:()=>({id:copied.context.vaultId}),getResearchNotebook:id=>id===copied.scope.notebookId?{revision:copied.scope.notebookRevision!}:null,researchCorpusInventory:()=>({documents:copied.scope.documents}),assertResearchDocument,assertResearchDocumentPermission,documentsById,researchFingerprint:sha256Snapshot,
  resolveResearchSourceScope:()=>({ideaIds:new Set(copied.ideas.map(idea=>idea.id))}),manualIdeaIds:()=>null,
  getResearchPreparationInventory:()=>({documents:copied.scope.documents.map(document=>({...document,preparation:copied.preparation.find(state=>state.documentId===document.id)!}))}),
  retrieveSharedDocumentaryEvidence:retrieval,retrieveHierarchical:async(query,options={})=>{const terms=[...new Set(query.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[])];return {ideas:[],passages:copied.legacyPassages.filter(item=>!options.nodusIds||options.nodusIds.includes(item.hit.nodus_id)).map(item=>({...item.hit,similarity:terms.reduce((score,term)=>score+Number(item.hit.text.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase().includes(term)),0)})).filter(hit=>hit.similarity>0).sort((a,b)=>b.similarity-a.similarity||a.passage_id.localeCompare(b.passage_id)).slice(0,options.passageLimit??copied.settings.candidates),documents:[],embeddingAvailable:false,routedWorkIds:[]};},scopedIdeaEvidencePassages:()=>[],selectPassageEvidence,embed:async()=>null,embedMany:async texts=>texts.map(()=>[]),
  lexicalIdeas:ids=>copied.ideas.filter(idea=>ids.includes(idea.id)).map(idea=>({global_id:idea.id,type:idea.type,label:idea.label,statement:idea.statement??idea.summary})),ideaWorkIds:id=>copied.ideas.find(idea=>idea.id===id)?.works.map(work=>({nodus_id:work.nodus_id}))??[],
  insertScopedReceipts:()=>{},recordScopedSourcePassage:unavailable,recordScopedLegacyPassage:(scope,id)=>{if(scope.id!==copied.scope.id)throw new Error('research_source_not_authorized');return copied.legacyPassages.find(item=>item.hit.passage_id===id)?.receipt??null;},getSettings:()=>({ocrLanguages:''}),readAutomaticResearchZotero:unavailable,pinZoteroOriginals:unavailable,getGlobalLibraryItem:()=>null,globalLibraryAttachmentPath:unavailable,readResearchOriginalInWorker:unavailable,getDocumentaryPassageDetail:()=>null,getScopedLegacyPassageDetail:id=>copied.legacyPassages.find(item=>item.receipt.passage_id===id)?.receipt??null,extractCitationRefs,
  researchActivityStep:async(_kind,_step,work)=>work(),startResearchActivity:()=>()=>{},deepenResearch:(run,query,chosen)=>supervisor.deepenResearch(run,query,chosen),
  graph:(_scope,_workIds,_ideaIds,budget)=>({gaps:copied.graph.gaps.filter(row=>budget.accept(`gap:${row.id}`,row.summary)),contradictions:copied.graph.contradictions.filter(row=>budget.accept(`contradiction:${row.id}`,row.summary)),themes:copied.graph.themes.filter(row=>budget.accept(`theme:${row.id}`,row.label))}),
 };
 const run=new (portableResearchCorpusRun(repository).ResearchCorpusRun)(copied.scope,copied.settings,signal);
 run.readOriginal=async()=>{run.budget.partial=true;run.limitations.add('research_read_unavailable');throw new Error('desktop_preparation_required');};
 const ai=portableDeepResearchAI({documentaryEvidence:true,completeText:text,completeJson:json});
 const builders=portableAcademicDeepResearch({ai,experimentalProse:false,buildHistoricalWritingWorkshopSnapshot:async brief=>run.snapshotFromEvidence(brief),buildIdeaFirstWritingWorkshopSnapshot:async brief=>run.snapshotFromEvidence(brief),retrieveSectionMaterial:input=>run.section(input),retrieveSectionMaterialLegacy:input=>run.section(input),prepareRelevantDocumentProfiles:unavailable,academicRelationshipContext:snapshot=>copied.relationships.filter(edge=>snapshot.ideas.some(idea=>idea.label===edge.from||idea.label===edge.to)),planApproachRetrieval:input=>planApproachRetrieval(input,json)});
 const approach=normalizeDeepResearchApproach(request.approach),version=parseDeepResearchRequestVersion(request.deepResearchVersion),base=version==='v1'?(approach==='general'?builders.legacyAcademicDeps(model,signal):builders.legacySpecializedAcademicDeps(model,approach,request,signal)):(approach==='general'?builders.realDeps(model,signal):builders.specializedAcademicDeps(model,approach,request,signal));
 const auditor=portableResearchClaimAudit({completeJson:json,currentJobThinkingEffort:()=>effort,isOutputTruncated:error=>(error as {code?:string})?.code==='output_truncated'}),coverage=portableResearchSectionCoverage({completeJson:json,completeText:text,withResearchValidationThinking});
 const deps=bindPreparedResearchCorpus(base,run,model,{...auditor,...coverage,withResearchValidationThinking,contextWindow:async chosen=>{const tokens=documentedContextWindow(chosen.provider,chosen.model);return {tokens:tokens??32768,known:tokens!==null};},withResearchRequestBudget:async(tokens,onPartial,work)=>{const previous=windowLimit,priorOverflow=overflow;windowLimit=tokens;overflow=onPartial;try{return await work();}finally{windowLimit=previous;overflow=priorOverflow;}}},signal);
 const report=await orchestrateDeepResearch({...request,studyMode:false,unitMode:false,documentSkills:undefined},deps,notify,signal);signal.throwIfAborted();
 report.draft={...report.draft,generationModel:model,deepResearchApproach:approach,deepResearchVersion:version,deepResearchSectionLength:request.sectionLength};Object.assign(report.meta,{mobileRetrieval:{mode:'lexical',sourceScope:copied.context.sourceScope,preparedSourcesOnly:true,sourceHash:copied.sourceHash}});return report;
}
