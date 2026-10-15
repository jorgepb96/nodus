import {DEFAULT_CHAT_SKILLS,skillHasCapability} from '@shared/chatSkills';
import {documentSkillCatalog,type DocumentSkillOption} from '@shared/documentSkills';
import {researchVisualFields} from '@shared/documentVisualContent';
import {enrichPortableDocumentVisuals,preparePortableDocumentVisualHints,documentVisualPlanningText,type PortableDocumentVisualHost} from '@shared/portableDocumentVisuals';
import {durableDeepResearchCall,type MobileDeepResearchCheckpoint,type MobileDeepResearchReport,type MobileDeepResearchVisuals,type DurableMobileCompletionJournal} from '@shared/mobileDeepResearch';
import {sha256Snapshot} from '@shared/databaseResearchEngine';
import type {ImageProvider,ModelRef,WritingWorkshopDraft} from '@shared/types';
import {structuredPrompt} from './structuredPrompt';
import {autonomousDocumentResources,type DocumentResourceAsset} from './autonomousDocumentResources';
type Call=(method:string,...args:any[])=>Promise<any>;
type Receipt={id:string;vaultId:string;parentRecordId:string;generationId:string;figureId:string;owner:string;ownerRevision:string;targetId:string;figureKey:string;mimeType:string;byteCount:number;sha256:string};
export type MobileResearchVisuals=MobileDeepResearchVisuals;
const visualReport=(checkpoint:MobileDeepResearchCheckpoint)=>checkpoint.report as MobileDeepResearchReport&{mobileVisuals?:MobileResearchVisuals};
export async function autonomousDocumentSkillCatalog(call:Call):Promise<DocumentSkillOption[]>{
 let image:ModelRef|null=null;try{image=await call('mobileImageConfiguration');}catch{/* No configured image model is an unavailable image capability, not a text fallback. */}
 return DEFAULT_CHAT_SKILLS.filter(skill=>skillHasCapability(skill,'nodus:svg')||skillHasCapability(skill,'nodus:image')).map(skill=>({skill,billing:skillHasCapability(skill,'nodus:image')?'per-call':'none',available:!skillHasCapability(skill,'nodus:image')||!!image, ...(!image&&skillHasCapability(skill,'nodus:image')?{reason:'Configura un modelo de imagen del móvil en Proveedores.'}:{})}));
}
function completions(call:Call,checkpoint:MobileDeepResearchCheckpoint,persist:()=>Promise<void>,controller:AbortController){
 return visualCompletions(call,checkpoint,checkpoint.id,checkpoint.request.model!,checkpoint.request.thinkingEffort,persist,controller);
}
function visualCompletions(call:Call,journal:DurableMobileCompletionJournal,generationId:string,model:ModelRef,thinkingEffort:MobileDeepResearchCheckpoint['request']['thinkingEffort'],persist:()=>Promise<void>,controller:AbortController){
 const text:PortableDocumentVisualHost<{id:string},null>['completeText']=async(options,chosen)=>{
  controller.signal.throwIfAborted();if(chosen&&(chosen.provider!==model.provider||chosen.model!==model.model))throw new Error('mobile_model_fallback_forbidden');
  const input={...structuredPrompt({...options,temperature:options.temperature??0.2},model,thinkingEffort),format:'text',generationId,completionKey:`visual:${sha256Snapshot([options.system,options.user])}`};
  try{const result=await durableDeepResearchCall(journal,`local:visual:${sha256Snapshot(input)}`,input,()=>call('mobileStructuredCompletion',input),persist,{paid:true,request:input,recover:async()=>{const value=await call('mobileSavedStructuredCompletion',journal.inflight?.request??input);return value===null?undefined:value;}});if(typeof result!=='string')throw new Error('invalid_visual_completion');return result;}catch(error){controller.abort(error);throw error;}
 };
 const json:PortableDocumentVisualHost<{id:string},null>['completeJson']=async(options,guard,chosen)=>{const raw=await text(options,chosen);const parsed=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));if(!guard(parsed))throw new Error('invalid_visual_model_response');return parsed;};return {completeText:text,completeJson:json};
}
export function autonomousResearchPlanningPrompt(checkpoint:MobileDeepResearchCheckpoint,system:string):string {
 const value=checkpoint.calls['local:visual-planning']?.output as {text?:unknown}|undefined;return typeof value?.text==='string'&&value.text?`${system}\n\n${value.text}`:system;
}
export async function prepareAutonomousResearchVisuals(call:Call,checkpoint:MobileDeepResearchCheckpoint,persist:()=>Promise<void>,controller:AbortController){
 if(checkpoint.context?.vaultType==='academic'||!checkpoint.request.documentSkills?.enabled||checkpoint.calls['local:visual-planning'])return;
 const options=await autonomousDocumentSkillCatalog(call),host=completions(call,checkpoint,persist,controller);
 const hints=await preparePortableDocumentVisualHints({...host,catalog:()=>options,flushPersist:persist},checkpoint.request.documentSkills,checkpoint.request.objective,checkpoint.request.model,controller.signal);controller.signal.throwIfAborted();
 checkpoint.calls['local:visual-planning']={input:JSON.stringify(checkpoint.request.documentSkills),output:{hints,text:documentVisualPlanningText(documentSkillCatalog(options,checkpoint.request.documentSkills),hints)}};await persist();
}
export interface AutonomousVisualExecution {
 generationId:string;entityKey:string;targetId:string;vaultId:string;parentKind:'deepResearch'|'documentVisuals';
 draft:WritingWorkshopDraft;policy:NonNullable<MobileDeepResearchCheckpoint['request']['documentSkills']>;
 model:ModelRef;thinkingEffort?:MobileDeepResearchCheckpoint['request']['thinkingEffort'];language?:string;journal:DurableMobileCompletionJournal;
 imageModel?:ModelRef;setImageModel:(model:ModelRef)=>void;
 visuals?:MobileResearchVisuals;setVisuals:(visuals:MobileResearchVisuals)=>void;
}
export async function enrichAutonomousResearchVisuals(call:Call,checkpoint:MobileDeepResearchCheckpoint,persist:()=>Promise<void>,controller:AbortController){
 const policy=checkpoint.request.documentSkills,report=visualReport(checkpoint);if(checkpoint.context?.vaultType==='academic'||!policy?.enabled||!report)return;
 if(report.mobileVisuals?.manifest.state==='ready')return;checkpoint.visualAssetsPublished=false;
 await runAutonomousDocumentVisuals(call,{generationId:checkpoint.id,entityKey:checkpoint.entityKey,targetId:checkpoint.id,vaultId:checkpoint.context!.vaultId,parentKind:'deepResearch',draft:report.draft,policy,model:checkpoint.request.model!,thinkingEffort:checkpoint.request.thinkingEffort,language:checkpoint.request.language,journal:checkpoint,imageModel:checkpoint.imageModel,setImageModel:model=>{checkpoint.imageModel=model;},visuals:report.mobileVisuals,setVisuals:visuals=>{report.mobileVisuals=visuals;}},persist,controller);
}
/** Exact canonical enrichment shared by prose generation and explicit figure-only
 * sessions. The real report target and the paid visual session remain distinct. */
export async function runAutonomousDocumentVisuals(call:Call,execution:AutonomousVisualExecution,persist:()=>Promise<void>,controller:AbortController){
 const {policy,model,vaultId,journal}=execution;
 let visuals=execution.visuals,imageModel=execution.imageModel;
 const previous=visuals?.manifest;
 const options=await autonomousDocumentSkillCatalog(call),scope={generationId:execution.generationId,entityKey:execution.entityKey,parentKind:execution.parentKind};
 if(policy.skills.some(item=>item.enabled&&item.skillId==='builtin-image')&&!imageModel){imageModel=await call('mobileImageConfiguration');execution.setImageModel(imageModel!);await persist();}
 const input={title:execution.draft.title,language:execution.draft.brief.language??execution.language??'en',model,fields:researchVisualFields(execution.draft)},contentHash=sha256Snapshot(input.fields),assets=visuals?.assets??[],adapters=new Map<string,ReturnType<typeof autonomousDocumentResources>>(),rawByHash=new Map<string,string>();
 const complete=visualCompletions(call,journal,execution.generationId,model,execution.thinkingEffort,persist,controller);
 const figureFor=(owner:string)=>{const figure=visuals?.manifest.figures.find(item=>item.owner===owner);if(!figure)throw new Error('document_figure_owner_missing');return figure;};
 const remember=(receipt:Receipt)=>{const value={id:receipt.id.toLowerCase(),owner:receipt.owner,ownerRevision:receipt.ownerRevision,generationId:receipt.targetId,figureId:receipt.figureKey,mimeType:receipt.mimeType,byteCount:receipt.byteCount,sha256:receipt.sha256};if(!assets.some(asset=>asset.id===value.id))assets.push(value);};
 const store=async(owner:string,base64:string,mimeType:string,kind:'image'|'file',name:string,metadata:Record<string,string>)=>{
  const figure=figureFor(owner),digest=sha256Snapshot(base64),value=await call('documentFigureStoreAsset',{...scope,figureId:figure.id,owner,base64,mimeType,kind,name,metadata,sourceCompletionRecordId:rawByHash.get(digest)});if(!value?.receipt)throw new Error('invalid_document_figure_asset_receipt');remember(value.receipt);journal.calls[`local:asset:${value.attachmentId}`]={input:JSON.stringify({owner,kind,name,metadata}),output:{receipt:value.receipt,source:value.source}};await persist();return value;
 };
 const adapter=async(owner:string,version:number)=>{
  let cached=adapters.get(owner);if(cached)return cached;adapters.clear();const figure=figureFor(owner),receipts=await call('documentFigureAssetReceipts',{...scope,figureId:figure.id,owner}) as Receipt[];
  const referenced=new Set<string>();const visit=(nodes:any[])=>{for(const node of nodes){if(node.attachmentId)referenced.add(node.attachmentId);if(node.kind==='details')visit(node.children);}};if(figure.view)visit(figure.view.nodes);
  const existing:DocumentResourceAsset[]=[];for(const receipt of receipts){if(figure.view&&!referenced.has(receipt.id.toLowerCase()))continue;const data=await call('documentFigureReadAsset',{...scope,receipt});existing.push({source:`nodus-capability://chat/${owner}/${receipt.id.toLowerCase()}`,attachmentId:receipt.id.toLowerCase(),owner,sha256:receipt.sha256,byteCount:receipt.byteCount,base64:data.base64,mimeType:data.mimeType});remember(receipt);}
  cached=autonomousDocumentResources({generationId:execution.generationId,owner,version,imageProvider:(imageModel?.provider==='gemini'?'google':imageModel?.provider??null) as ImageProvider|null,imageModel:imageModel?.model??null,completeText:complete.completeText,resolveModelRef:chosen=>{if(chosen&&(chosen.provider!==model.provider||chosen.model!==model.model))throw new Error('mobile_model_fallback_forbidden');return model;},evaluate:script=>call('documentSvgEvaluate',{script}),existingAssets:existing,
   generateImage:async(prompt,aspectRatio)=>{if(!imageModel)throw new Error('mobile_image_configuration_missing');const request={model:imageModel,system:'',user:prompt,maxTokens:1,format:'image',responseMode:'receipt',figureOwner:owner,generationId:execution.generationId,completionKey:`figure:${figure.id}:image:${sha256Snapshot([prompt,aspectRatio])}`,...(aspectRatio?{aspectRatio}:{})};try{let original=request;
    for(const [key,saved] of Object.entries(journal.calls)){if(!key.startsWith('local:visual-image:'))continue;const prior=JSON.parse(saved.input) as typeof request;if(prior.generationId===request.generationId&&prior.completionKey===request.completionKey&&prior.user===request.user&&JSON.stringify(prior.model)===JSON.stringify(request.model)&&prior.aspectRatio===request.aspectRatio){original=prior;break;}}
    if(original===request)await durableDeepResearchCall(journal,`local:visual-image:${sha256Snapshot(request)}`,request,()=>call('mobileStructuredCompletion',request),persist,{paid:true,request,recover:async()=>{const value=await call('mobileSavedStructuredCompletion',journal.inflight?.request??request);return value===null?undefined:value;}});const image=await call('mobileReadStructuredImage',original);if(original.figureOwner===owner)rawByHash.set(sha256Snapshot(image.base64),image.sourceCompletionRecordId);return image;}catch(error){controller.abort(error);throw error;}},
   storeAsset:request=>store(owner,request.base64,request.mimeType,request.kind,request.name,request.metadata)});adapters.set(owner,cached);return cached;
 };
 const host:PortableDocumentVisualHost<{id:string},null>={...complete,input,vaultId,model,catalog:()=>options,previous:previous??null,usage:structuredClone(previous?.usage??{}),registryPins:()=>({registry:{providers:new Map(),fences:new Map(),chatOrder:[],problems:[],revision:1},pins:null}),contentHash:sha256Snapshot,current:()=>!controller.signal.aborted&&sha256Snapshot(researchVisualFields(execution.draft))===contentHash,persist:manifest=>{visuals={manifest,assets};execution.setVisuals(visuals);},flushPersist:persist,retainPrevious:()=>{},notify:()=>{},owner:(surface,conversation,vault)=>sha256Snapshot([surface,vault,conversation]),assetVersion:()=>0,clock:()=>new Date().toISOString(),id:()=>crypto.randomUUID(),logPipelineInfo:()=>{},logPipelineWarning:()=>{},logPipelineFailure:()=>{},
  executeResources:async(answer,execution,signal)=>{try{return await (await adapter(execution.owner,execution.version)).executeResources(answer,execution,signal);}catch(error){adapters.delete(execution.owner);throw error;}},
  snapshot:async(view,owner)=>{try{const resource=await adapter(owner,0),png=await call('documentFigureSnapshot',{view,owner,assets:resource.assets()});if(typeof png!=='string'||!png.startsWith('data:image/png;base64,'))throw new Error('invalid_document_figure_snapshot');return (await store(owner,png.slice('data:image/png;base64,'.length),'image/png','image','figure.png',{})).source;}finally{adapters.delete(owner);}}
 };
 const planning=journal.calls['local:visual-planning']?.output as {hints?:string[]}|undefined;
 await enrichPortableDocumentVisuals({kind:'deep-research',id:execution.targetId},policy,host,{model,hints:planning?.hints,retry:!!previous,signal:controller.signal});controller.signal.throwIfAborted();await persist();
}

export async function publishAutonomousResearchVisualAssets(call:Call,checkpoint:MobileDeepResearchCheckpoint,persist:()=>Promise<void>){
 const visuals=visualReport(checkpoint)?.mobileVisuals;if(!visuals)return;
 const used=new Set<string>();for(const figure of visuals.manifest.figures){if(figure.poster){const match=/^nodus-image:\/\/chat\/[a-f0-9]{64}\/([a-f0-9-]{36})$/.exec(figure.poster);if(match)used.add(match[1]);}const visit=(nodes:any[])=>{for(const node of nodes){if(node.attachmentId)used.add(node.attachmentId);if(node.kind==='details')visit(node.children);}};if(figure.view)visit(figure.view.nodes);}
 visuals.assets=visuals.assets.filter(asset=>used.has(asset.id));await persist();
 const assets=visuals.assets.map(asset=>{const saved=checkpoint.calls[`local:asset:${asset.id}`];let metadata:Record<string,string>={};if(saved){try{metadata=JSON.parse(saved.input).metadata??{};}catch{throw new Error('invalid_document_figure_asset_metadata');}}return {...asset,metadata};});
 await call('documentFigurePublishAssets',{entityKey:checkpoint.entityKey,generationId:checkpoint.id,assets});checkpoint.visualAssetsPublished=true;await persist();
}
