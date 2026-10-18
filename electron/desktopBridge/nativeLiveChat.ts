import {createHash} from 'node:crypto';
import type {MobileLiveChatRequest,MobileLiveChatResult} from '../../shared/mobileLiveChat';
import type {MobileChatDocument,MobileChatEdit} from '../../shared/mobileChatHistory';
import {MOBILE_CHAT_MAX_BYTES} from '../../shared/mobileChatHistory';
import type {ResearchChatRequest,WorldChatRequest,DatabaseChatRequest,WorldChatSelection} from '../../shared/types';
import type {StudyAssistantRequest} from '../../shared/studyAssistant';
import {isResearchEffort} from '../../shared/researchReasoning';
import {validateConcilium} from '../../shared/researchConcilium';
import {DEFAULT_RESEARCH_CHAT_SELECTION} from '../../shared/researchChatDefaults';
import {researchContextLayers,researchContextWeb,withResearchContextLayers} from '../../shared/researchContextLayers';
import {validateRetrievalSettings} from '../../shared/researchCorpus';
import {PROVIDER_LABELS,AI_PROVIDERS} from '../../shared/providers';
import type {ModelRef} from '../../shared/types';
import {researchEffortFor,researchReasoningProfile,researchEffortChoices} from '../../shared/researchReasoning';
import {getSettings} from '../db/settingsRepo';
import {getModelCatalog} from '../ai/modelCatalog';
import {listChatSkills,enabledChatSkills,invokedChatSkills} from '../chatSkills';
import {getResearchSystemPrompts,selectResearchSystemPrompt} from '../db/researchSystemPromptsRepo';
import {chatAssetOwner,retainChatAssets,reconcileChatAssets} from '../chatAssets';
import {normalizeMobileStudyChatOptions} from '../../shared/mobileStudyChat';
import {getActiveVault} from '../vaults/vaultRegistry';
import {mobileDomainAllowed} from './executionBoundary';
import {MobileChatFailure,readMobileChat,saveMobileChat,saveMacGeneratedChatReply,saveMacStoredQuestionAttachments} from './chatHistory';
import {streamResearchChat} from '../ai/researchAssistant';
import {streamWorldChat} from '../ai/worldChat';
import {streamDatabaseChat} from '../ai/databaseChat';
import {streamStudyAssistant} from '../ai/studyAssistant';

export interface MobileChatJobIdentity {jobId:string;deviceGrant:string;idempotencyKey:string}
type Emit=(channel:string,...args:unknown[])=>void;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function modelRef(value:unknown):value is ModelRef {
  return object(value)&&typeof value.provider==='string'&&Object.hasOwn(PROVIDER_LABELS,value.provider)&&typeof value.model==='string'&&!!value.model.trim()&&value.model.length<=1024&&(value.pending===undefined||typeof value.pending==='boolean')&&(value.reasoningEffort===undefined||typeof value.reasoningEffort==='string'&&value.reasoningEffort.length<=64)&&!Object.keys(value).some(key=>!['provider','model','pending','reasoningEffort'].includes(key));
}
export async function mobileLiveChatConfiguration(kind:string,selected?:ModelRef|null) {
  if(!['research','world','database','study'].includes(kind)||selected!=null&&!modelRef(selected))throw new MobileChatFailure(400,'invalid_live_chat_model');
  const settings=getSettings(),model=selected??(kind==='study'?settings.studyModel:null)??settings.chatModel??settings.synthesisModel??null;
  const catalog=model?await getModelCatalog(model.provider):undefined;
  const info=catalog?.status==='read'?catalog.models?.find(info=>info.id===model?.model):undefined;
  const profile=researchReasoningProfile(model,info);
  return {version:1,vaultId:getActiveVault().id,kind,model,providers:AI_PROVIDERS.map(id=>({id,name:PROVIDER_LABELS[id]})),favorites:settings.favorites,
    selection:structuredClone(DEFAULT_RESEARCH_CHAT_SELECTION),webSearch:settings.researchWebSearch,
    researchAnswerVerification:settings.researchAnswerVerification??'off',
    thinkingEffort:researchEffortFor(settings.researchEffortByModel,model,info),efforts:researchEffortChoices(profile),
    catalogueStatus:catalog?.status??'unreadable',skills:listChatSkills().map(skill=>({id:skill.id,name:skill.name}))};
}
function receipt(jobId:string,reply:unknown):string {
  const bytes=createHash('sha256').update(JSON.stringify([jobId,reply])).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;
  const value=bytes.toString('hex');return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}
function validate(raw:unknown,identity:MobileChatJobIdentity):MobileLiveChatRequest {
  if(!object(raw)||Object.keys(raw).some(key=>!['version','requestId','kind','answerId','edit','generation'].includes(key))||raw.version!==1||!uuid(raw.requestId)||raw.requestId!==identity.idempotencyKey||!uuid(raw.answerId)||!['research','world','database','study'].includes(String(raw.kind))||!object(raw.edit)||raw.edit.id!==raw.requestId||raw.edit.action!=='save'||!object(raw.generation))throw new MobileChatFailure(400,'invalid_live_chat_request');
  if(Buffer.byteLength(JSON.stringify(raw),'utf8')>MOBILE_CHAT_MAX_BYTES+64*1024)throw new MobileChatFailure(413,'live_chat_too_large');
  const generation=raw.generation;
  if(Object.keys(generation).some(key=>!['model','systemPromptId','thinkingEffort','attachmentIds','selection','webSearch','skillIds','concilium'].includes(key))||generation.thinkingEffort!==undefined&&!isResearchEffort(generation.thinkingEffort)||generation.webSearch!==undefined&&!['auto','off'].includes(String(generation.webSearch)))throw new MobileChatFailure(400,'invalid_live_chat_options');
  if(generation.model!=null&&!modelRef(generation.model))throw new MobileChatFailure(400,'invalid_live_chat_model');
  if(generation.systemPromptId!=null&&(typeof generation.systemPromptId!=='string'||generation.systemPromptId.length>256))throw new MobileChatFailure(400,'invalid_live_chat_prompt');
  for(const key of ['attachmentIds','skillIds'])if(generation[key]!==undefined&&(!Array.isArray(generation[key])||generation[key].length>100||generation[key].some(value=>typeof value!=='string'||!value||value.length>256)))throw new MobileChatFailure(400,'invalid_live_chat_options');
  if(raw.kind!=='research'&&(generation.selection!==undefined||generation.webSearch!==undefined||generation.skillIds!==undefined||generation.concilium!==undefined))throw new MobileChatFailure(400,'invalid_live_chat_options');
  if(generation.concilium!=null) {
    if(!object(generation.concilium)||Object.keys(generation.concilium).some(key=>!['models','chairman'].includes(key))||!Array.isArray(generation.concilium.models)||!generation.concilium.models.every(modelRef))throw new MobileChatFailure(400,'invalid_live_chat_model');
    validateConcilium(generation.concilium as unknown as Parameters<typeof validateConcilium>[0]);
  }
  if(generation.selection!==undefined) {
    const s=generation.selection,flags=['ideas','themes','contradictions','gaps','readingPath','authors','documents','passages','graph'];
    if(!object(s)||Object.keys(s).some(key=>![...flags,'graphParts','layers','retrieval','sourceFilter','notebookId'].includes(key))||flags.some(key=>typeof s[key]!=='boolean')||!object(s.graphParts)||Object.keys(s.graphParts).some(key=>!['ideaNodes','themeNodes','ideaEdges','authorGraph'].includes(key))||['ideaNodes','themeNodes','ideaEdges','authorGraph'].some(key=>typeof (s.graphParts as Record<string,unknown>)[key]!=='boolean'))throw new MobileChatFailure(400,'invalid_live_chat_selection');
    if(s.layers!==undefined) {
      const layers=s.layers;
      if(!object(layers)||Object.keys(layers).some(key=>!['ideas','documents','indexed','web','indexedOnly'].includes(key))
        ||['ideas','documents','indexed','web','indexedOnly'].some(key=>layers[key]!==undefined&&typeof layers[key]!=='boolean')
        ||(layers.indexedOnly!==true&&(typeof layers.ideas!=='boolean'||typeof layers.documents!=='boolean')))throw new MobileChatFailure(400,'invalid_live_chat_selection');
    }
    if(s.notebookId!=null&&(typeof s.notebookId!=='string'||!s.notebookId||s.notebookId.length>256))throw new MobileChatFailure(400,'invalid_live_chat_selection');
    if(s.sourceFilter!==undefined) {
      const f=s.sourceFilter;
      if(!object(f)||Object.keys(f).some(key=>!['enabled','authorIds','workIds'].includes(key))||typeof f.enabled!=='boolean'||['authorIds','workIds'].some(key=>!Array.isArray(f[key])||(f[key] as unknown[]).length>10000||(f[key] as unknown[]).some(id=>typeof id!=='string'||!id||id.length>256)))throw new MobileChatFailure(400,'invalid_live_chat_selection');
    }
    if(s.retrieval!==undefined)validateRetrievalSettings(s.retrieval as Parameters<typeof validateRetrievalSettings>[0]);
  }
  const request=raw as unknown as MobileLiveChatRequest,messages=request.edit.draft?.messages;
  if(!Array.isArray(messages)||messages.some(message=>!object(message)))throw new MobileChatFailure(400,'invalid_live_chat_question');
  const question=messages.at(-1);
  if(!question||question.role!=='user'||!uuid(question.id)||typeof question.content!=='string'||!question.content.trim()||messages!.some(message=>message.id===request.answerId))throw new MobileChatFailure(400,'invalid_live_chat_question');
  if(request.kind==='research'&&request.generation.selection) {
    const selection=request.generation.selection;
    const layers=researchContextLayers(selection,getActiveVault().type==='academic');
    const savedWeb=selection.layers?.web;
    const legacyIndexedOnly=selection.layers?.indexedOnly===true;
    return {...request,generation:{...request.generation,selection:withResearchContextLayers(selection,layers),
      ...(savedWeb!==undefined||legacyIndexedOnly?{webSearch:researchContextWeb(selection,request.generation.webSearch!=='off')?'auto':'off'}:{})}};
  }
  return request;
}

/** Closed host-only adapter. The durable job supplies the device identity; none
 * of these host fields comes from a native question or a public edit endpoint. */
export async function streamMobileCompanionChat(raw:unknown,identity:MobileChatJobIdentity,emit:Emit,signal?:AbortSignal):Promise<MobileLiveChatResult> {
  if(!identity.jobId||!identity.deviceGrant||!identity.idempotencyKey)throw new MobileChatFailure(403,'live_chat_job_required');
  const request=validate(raw,identity),vaultId=getActiveVault().id;
  const domains=['corpus','writing','research-generation','study-recordings'].filter(mobileDomainAllowed);
  if(!['corpus','writing','research-generation'].every(domain=>domains.includes(domain)))throw new MobileChatFailure(403,'permission_denied');
  const accepted=await saveMobileChat(vaultId,identity.deviceGrant,request.kind,request.edit,domains);
  if(!accepted.snapshot)throw new MobileChatFailure(500,'live_chat_question_not_saved');
  let latest:MobileChatDocument=accepted.snapshot,text='',fatal:unknown;
  if(request.generation.attachmentIds?.length) {
    const attached=await saveMacStoredQuestionAttachments(vaultId,identity.deviceGrant,request.kind,{...request.edit,id:receipt(identity.jobId,['attachments',latest.revision]),expectedRevision:latest.revision,draft:{...request.edit.draft!,messages:latest.data.messages as Array<Record<string,unknown>>}},domains,String((latest.data.messages as Array<Record<string,unknown>>).at(-1)!.id),request.generation.attachmentIds);
    if(!attached.snapshot)throw new MobileChatFailure(500,'live_chat_question_not_saved');latest=attached.snapshot;
  }
  const baseMessages=latest.data.messages as Array<Record<string,unknown>>,createdAt=new Date().toISOString(),controller=new AbortController();
  let resolvedWorld=request.edit.draft?.world;
  const executionSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  let writes=Promise.resolve(),timer:ReturnType<typeof setTimeout>|undefined;
  function checkpoint(delivery:'streaming'|'completed'|'cancelled'|'failed',extra:Record<string,unknown>={}) {
    const reply={id:request.answerId,role:'assistant',content:text,createdAt,...extra};
    const originalCompanion=latest.companion??{},nativeMessages=Array.isArray(originalCompanion.messages)?originalCompanion.messages:[];
    const companion={...originalCompanion,messages:[...nativeMessages.filter(message=>!object(message)||message.id!==request.answerId),{id:request.answerId,role:'assistant',text,citations:[],delivery,createdAt:createdAt.replace(/\.\d{3}Z$/,'Z')}]};
    writes=writes.then(async()=>{
      if(fatal)return;
      const edit:MobileChatEdit={...request.edit,id:receipt(identity.jobId,[reply,delivery,resolvedWorld,latest.revision]),expectedRevision:latest.revision,companion,draft:{...request.edit.draft!,...(resolvedWorld?{world:resolvedWorld}:{}),messages:[...baseMessages,reply]}};
      const saved=await saveMacGeneratedChatReply(vaultId,identity.deviceGrant,request.kind,edit,domains,request.answerId,{...(request.generation.model?{model:request.generation.model}:{}),...(request.kind==='research'?{selection:request.generation.selection??structuredClone(DEFAULT_RESEARCH_CHAT_SELECTION)}:{})});
      if(!saved.snapshot)throw new MobileChatFailure(500,'live_chat_reply_not_saved');latest=saved.snapshot;
      emit('mobile:chat:checkpoint',request.requestId,{revision:latest.revision,delivery});
    }).catch(error=>{fatal=error;controller.abort();});return writes;
  }
  function schedule() { if(timer)return;timer=setTimeout(()=>{timer=undefined;void checkpoint('streaming');},1000); }
  function delta(value:string,kind?:'content'|'reasoning'|'replace') {
    if(kind==='reasoning'){emit('mobile:chat:reasoning',request.requestId,value);return;}
    text=kind==='replace'?value:text+value;emit(kind==='replace'?'mobile:chat:replace':'mobile:chat:delta',request.requestId,value);schedule();
  }
  const generation=request.generation;
  const messages:ResearchChatRequest['messages']=baseMessages.map(message=>{
    if((message.role!=='user'&&message.role!=='assistant')||typeof message.content!=='string')throw new MobileChatFailure(422,'invalid_live_chat_history');
    return {...message,role:message.role,content:message.content};
  });
  const promptKey=`${request.kind}:${latest.id}`;
  const common={model:generation.model,systemPromptId:generation.systemPromptId===undefined?getResearchSystemPrompts(promptKey).selectedId:generation.systemPromptId,thinkingEffort:generation.thinkingEffort,attachmentIds:generation.attachmentIds,conversationId:latest.id};
  const owner=chatAssetOwner({research:'assistant',world:'world-assistant',database:'database',study:'study'}[request.kind],latest.id,vaultId),releaseAssets=retainChatAssets(owner);
  try {
    if(generation.systemPromptId!==undefined)selectResearchSystemPrompt(promptKey,generation.systemPromptId);
    emit('mobile:chat:questionSaved',request.requestId,{conversationId:latest.id,revision:latest.revision,answerId:request.answerId});
    let result:Record<string,unknown>;
    if(request.kind==='research')result=await streamResearchChat({...common,messages,selection:generation.selection??structuredClone(DEFAULT_RESEARCH_CHAT_SELECTION),webSearch:generation.webSearch,skillIds:generation.skillIds,concilium:generation.concilium},delta,executionSignal,value=>emit('mobile:chat:concilium',request.requestId,value),activity=>emit('mobile:chat:activity',request.requestId,activity)) as unknown as Record<string,unknown>;
    else if(request.kind==='world') {
      const world=request.edit.draft?.world;
      const focusKeys=world?.selection.scope==='manual'?world.selection.entryKeys:world?.selection.keepFocus?world.focus.map(ref=>`${ref.kind}:${ref.id}`):undefined;
      result=await streamWorldChat({...common,question:String(baseMessages.at(-1)!.content),history:messages.slice(0,-1),focusKeys} as WorldChatRequest,delta,executionSignal) as unknown as Record<string,unknown>;
    } else if(request.kind==='database')result=await streamDatabaseChat({...common,question:String(baseMessages.at(-1)!.content),history:messages.slice(0,-1),databaseIds:request.edit.draft?.databaseIds??[]} as DatabaseChatRequest,delta,executionSignal) as unknown as Record<string,unknown>;
    else {
      const data=latest.data;
      const options=request.edit.draft?.study??normalizeMobileStudyChatOptions({selection:data.selection,task:data.task,level:data.level,tone:data.tone,language:data.language,allowExternalKnowledge:data.allowExternalKnowledge} as Parameters<typeof normalizeMobileStudyChatOptions>[0]);
      result=await streamStudyAssistant({...common,...options,messages} as StudyAssistantRequest,delta,executionSignal) as unknown as Record<string,unknown>;
    }
    if(timer){clearTimeout(timer);timer=undefined;}await writes;if(fatal)throw fatal;
    const answer=request.kind==='world'||request.kind==='database'?result.text:result.answer;
    if(typeof answer!=='string')throw new MobileChatFailure(422,'invalid_live_chat_result');
    text=result.noMaterial===true&&!answer ? 'No he encontrado material para esta pregunta. Elige el foco o nombra un personaje, lugar, escena o regla de este mundo.':answer;
    emit('mobile:chat:replace',request.requestId,text);
    const interrupted=executionSignal.aborted||result.aborted===true||result.interrupted===true;
    if(request.kind==='world'&&Array.isArray(result.focus))resolvedWorld={selection:resolvedWorld?.selection??latest.data.selection as WorldChatSelection,focus:result.focus as NonNullable<NonNullable<MobileChatEdit['draft']>['world']>['focus']};
    const activeSkills=[...(request.kind==='research'&&getActiveVault().type==='academic'?[]:enabledChatSkills('assistant')),...(request.kind==='research'?invokedChatSkills(request.generation.skillIds??[]):[])];
    const skills=[...new Map(activeSkills.map(skill=>[skill.id,{id:skill.id,name:skill.name}])).values()];
    const extra={...(request.kind==='study'?{citations:result.citations,stats:result.stats,interrupted}:request.kind==='research'?{stats:result.stats,...(result.concilium?{concilium:result.concilium}:{}),...(interrupted?{error:true}:{})}:{}),...(skills.length?{skills}:{}),...(result.noMaterial===true?{noMaterial:true}:{})};
    await checkpoint(interrupted?'cancelled':'completed',extra);if(fatal)throw fatal;
    const document=await readMobileChat(vaultId,request.kind,latest.id,domains);
    return {version:1,requestId:request.requestId,kind:request.kind,document,interrupted};
  } catch(error) {
    if(timer){clearTimeout(timer);timer=undefined;}await writes;
    if(!fatal)await checkpoint(executionSignal.aborted?'cancelled':'failed',{error:true});
    // The job event journal and last acknowledged partial remain queryable.
    // A transport retry recovers this job; it cannot invoke another provider.
    throw fatal??error;
  } finally {
    if(timer)clearTimeout(timer);releaseAssets();
    try {
      const actual=await readMobileChat(vaultId,request.kind,latest.id,domains);
      reconcileChatAssets(owner,actual.data.messages as Array<{content:string;concilium?:unknown}>);
    } catch { /* A later real history save can collect orphaned files. Never discard a live result on cleanup failure. */ }
  }
}
