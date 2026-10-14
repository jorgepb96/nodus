import { useEffect, useState } from 'react';
import type { AppSettings, ModelRef } from '@shared/types';
import { ACADEMIC_LESSONS, learningModelPatch, learningProgress, learningInvitationPreference } from '@shared/academicLearning';
import { learningText, type LearningCopyKey } from '@shared/academicLearningCopy';
import { getNodusLocalModel, modelRefSupportsExtraction } from '@shared/localAiModels';
import type { AcademicLearningController } from './useAcademicLearning';
import { LearningDialog } from './LearningDialog';
import { AcademicLearningSpotlight } from './AcademicLearningSpotlight';
import { academicGuideActions, academicGuideStep, GUIDE_INTERFACE_TABS } from './academicLearningTargets';
import { OnboardingModelStep } from '../components/OnboardingModelStep';
import { Icon } from '../components/ui';
import type { View } from '../navigation';
import { openResearchPreparation, openResearchPreparationQueue } from '../components/ResearchPreparationWelcome';
import { openAcademicLearning,useAcademicLearning } from './AcademicLearningContext';
import { t } from '../i18n';
import {learningRequiresInteraction} from '@shared/learningWorkspace';

export function AcademicLearningDialogs({ controller: c, settings, blocked, onActivateIntermediate, onSettings }: { controller: AcademicLearningController; settings: AppSettings; blocked: boolean; onActivateIntermediate: () => Promise<void>; onSettings: (s: AppSettings) => void }) {
 const copy = (key: LearningCopyKey) => learningText(key, settings.uiLanguage);
 if (blocked) return null;
 if (c.modelsPurpose) return <LearningModels purpose={c.modelsPurpose} settings={settings} onClose={() => c.setModelsPurpose(null)} onSaved={next => { onSettings(next); c.setModelsPurpose(null); void c.refresh(); }}/>;
 const entry = c.entry; if (!entry) return null;
 const lesson = ACADEMIC_LESSONS.find(l => l.id === entry.lessonId)!;
 return <AcademicLearningSpotlight label={copy(lesson.goal)} targets={entry.mode==='upgrade'?['[data-testid="library-extract-ideas"]','.academic-secondary-menu > button']:['[data-testid="academic-interface-trigger"]',`[data-tour="nav-${lesson.destination}"]`]} stepKey={`invite:${entry.lessonId}`} onPause={()=>c.dismiss()} testId="academic-learning-invitation">
  <div className="learning-coach-head"><div><span className="learning-eyebrow">{copy('guideLabel')}</span><h2>{copy(lesson.goal)}</h2></div><button type="button" className="btn btn-ghost" aria-label={t('Cerrar')} onClick={()=>c.dismiss()}><Icon name="x" size={14}/></button></div>
  <p>{copy(entry.mode === 'upgrade' ? 'upgradeBody' : 'guideIntro')}</p>
  <div className="learning-coach-actions">{entry.mode==='upgrade'?<button className="btn btn-primary" data-testid="learning-activate-intermediate" onClick={()=>void onActivateIntermediate().then(()=>c.startPractice('first-idea'))}>{copy('activate')}</button>:<button className="btn btn-primary" data-testid="learning-start-guide" onClick={()=>void c.startPractice(entry.lessonId)}>{copy('guide')}</button>}
   {(settings.academicPracticeSession?.lessonId===entry.lessonId&&settings.academicPracticeSession.phase!=='complete'||settings.academicPracticeSession?.checkpoints?.[entry.lessonId]?.phase!=='complete'&&settings.academicPracticeSession?.checkpoints?.[entry.lessonId])&&<button className="btn btn-ghost" onClick={()=>void c.startPractice(entry.lessonId,true)}>{copy('resume')}</button>}
   <button className="btn btn-ghost" data-testid="learning-skip" onClick={()=>c.dismiss()}>{copy('skip')}</button>
  </div><button className="learning-dismiss-link" data-testid="learning-never" onClick={()=>c.dismiss(true)}>{copy('never')}</button>
 </AcademicLearningSpotlight>;
}

export function AcademicLearningCoach({ controller: c, settings, blocked, navigate, openIdea, openGraph, prepareQuestion }: { controller: AcademicLearningController; settings: AppSettings; blocked: boolean; navigate: (view: View) => void; openIdea: (id:string) => void; openGraph: (id:string) => void; prepareQuestion: (documentId?:string) => void }) {
 const s=c.session;
 const [interfaceViewed,setInterfaceViewed]=useState(false);
 const [chatBusy,setChatBusy]=useState(false);
 const [controlBusy,setControlBusy]=useState(false);
 useEffect(()=>{
  const read=()=>{setChatBusy(!!document.querySelector('.research-composer-stop'));setControlBusy(!!document.querySelector('[data-testid="hypothesis-generate"]:disabled,[data-testid="reading-refresh"]:disabled,[data-testid="coverage-catalog"][aria-busy="true"],[data-testid="source-citation-loading"]'));};
  read();const observer=new MutationObserver(read);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','aria-busy']});return()=>observer.disconnect();
 },[s?.id,c.view]);
 useEffect(()=>{
  if(s?.lessonId!=='interface'||s.paused)return;
  const read=()=>setInterfaceViewed(!!document.querySelector(`[data-testid="academic-interface-picker"][open] #interface-tab-${GUIDE_INTERFACE_TABS[Math.min(s.step,3)]}[aria-selected="true"]`));
  read();const observer=new MutationObserver(read);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','aria-selected']});return()=>observer.disconnect();
 },[s?.lessonId,s?.step,s?.paused]);
 if(!s||s.paused||blocked||c.entry||c.modelsPurpose)return null;
 const copy=(key:LearningCopyKey,vars?:Record<string,string|number>)=>learningText(key,settings.uiLanguage,vars);
 const lesson=ACADEMIC_LESSONS.find(l=>l.id===s.lessonId)!;
 const doc=c.inventory?.documents.find(d=>d.workId===s.documentId||d.id===s.documentId);
 const preparing=['queued','running'].includes(doc?.preparation.status??'')||s.phase==='wait';
 const guidance=academicGuideStep(s,c.view,!!c.inventory?.documents.some(d=>d.workId&&!d.noteId&&!d.conversationAttachment),preparing,settings.academicMode==='manual');
 const ready=s.phase==='complete',recovery=s.recovery;
 const recoverKey:Record<NonNullable<typeof recovery>,LearningCopyKey>={'missing-source':'missingSource',model:'twoRoles',source:'sourceError',partial:'partial',paused:'paused',cancelled:'cancelled',provider:'providerError','no-citation':'noCitation','no-ideas':'noIdeas',graph:'graphError'};
 const manual=settings.academicMode==='manual';
 const modelsNeeded=s.lessonId==='first-answer'&&s.step>=1&&(!manual||s.step>=2)&&!settings.chatModel&&!settings.synthesisModel;
 const body=ready?'nextPossibility':recovery?recoverKey[recovery]:chatBusy&&(s.lessonId==='first-answer'&&s.step===2||s.lessonId==='research-question'&&s.step===0)?'guideAnswerWaiting':modelsNeeded?'twoRoles':manual&&s.lessonId==='first-idea'&&s.step===1?'manualBody':manual&&s.lessonId==='first-answer'&&s.step===1?'manualPrepare':guidance.body;
 const step=lesson.steps[Math.min(s.step,lesson.steps.length-1)] as LearningCopyKey;
 const sourceSelection=s.step===0&&['first-answer','first-idea'].includes(s.lessonId);
 const interfaceTab=(index:number)=>window.dispatchEvent(new CustomEvent('nodus:interface-tab',{detail:{tab:GUIDE_INTERFACE_TABS[index]}}));
 const prepare=()=>{if(manual||!c.requireModels('chat'))openResearchPreparation([s.documentId!]);};
 const waiting=preparing||chatBusy||controlBusy||c.workWaiting;
 return <AcademicLearningSpotlight guided={learningRequiresInteraction(s,waiting)} allowedTargets={['[data-testid="learning-workspace-bar"]',...(guidance.wrongView?[]:academicGuideActions(s))]} label={copy(lesson.goal)} targets={waiting?[]:recovery==='missing-source'?['[data-testid^="vault-library-item-"] input[type="checkbox"]','[data-testid="library-vault-add-files"]']:ready?['[data-testid="source-citation-content"]',...guidance.targets]:guidance.targets} stepKey={`${s.id}:${s.step}:${s.phase}:${c.view}`} onPause={c.pause}>
  <div className="learning-coach-head"><div><span className="learning-eyebrow">{copy('guideLabel')} · {copy('progress',{step:Math.min(s.step+1,lesson.steps.length),total:lesson.steps.length})}</span><h2 aria-live="polite">{ready?copy(s.lessonId==='first-idea'?'ideaVerified':['first-answer','research-question'].includes(s.lessonId)?'verified':'completed'):copy(step)}</h2></div><button className="btn btn-ghost" data-testid="learning-pause" aria-label={copy('pause')} onClick={c.pause}><Icon name="x" size={14}/></button></div>
  <p>{copy(body)}</p>
  {sourceSelection&&!c.workspace&&<p>{copy('sampleIsolation')}</p>}
  {doc&&<p className="learning-current-source" title={doc.title}>{doc.title}</p>}
  {s.lessonId==='first-answer'&&s.step===1&&doc&&doc.preparation.passages>0&&<p>{copy('prepared',{ready:doc.preparation.embedded,total:doc.preparation.passages})}</p>}
  {s.lessonId==='first-idea'&&c.ideaCount>0&&<p>{copy('count',{n:c.ideaCount})}</p>}
  {recovery&&<p>{copy('preserved')}</p>}{c.error&&<p role="alert">{c.error}</p>}
  <div className="learning-coach-actions">
   {!ready&&guidance.wrongView&&<button className="btn btn-primary" data-testid="learning-return-step" onClick={()=>navigate(guidance.destination)}>{copy('returnStep')}</button>}
   {!ready&&(sourceSelection||recovery==='missing-source')&&<button className="btn btn-ghost border border-neutral-700" data-testid="learning-import-sample" onClick={()=>void c.importSample()}>{copy('sample')}</button>}
   {!ready&&recovery!=='missing-source'&&s.lessonId==='first-answer'&&s.step===1&&s.documentId&&<><button className="btn btn-primary" data-testid="learning-prepare-selected" onClick={prepare}>{copy(modelsNeeded?'configure':'prepare')}</button><button className="btn btn-ghost" data-testid="learning-open-queue" onClick={openResearchPreparationQueue}>{copy('queue')}</button></>}
   {!ready&&['model','provider'].includes(recovery??'')&&<button className="btn btn-ghost" onClick={()=>c.setModelsPurpose(s.lessonId==='first-idea'?'analysis':'chat')}>{copy('configure')}</button>}
   {!ready&&s.lessonId==='first-idea'&&s.step<=2&&s.step>0&&<><button className="btn btn-ghost" data-testid="learning-open-queue" onClick={openResearchPreparationQueue}>{copy('queue')}</button>{!manual&&!settings.extractionModel&&!settings.synthesisModel&&<button className="btn btn-primary" onClick={()=>c.requireModels('analysis')}>{copy('configure')}</button>}{manual&&s.step===1&&<button className="btn btn-primary" onClick={()=>navigate('ideas')}>{t('Ideas')}</button>}</>}
   {!ready&&(s.lessonId==='first-answer'&&s.step>=2||s.lessonId==='research-question')&&<button className="btn btn-primary" data-testid="learning-suggest-question" onClick={()=>{if(!c.requireModels('chat'))prepareQuestion(s.documentId);}}>{copy('suggest')}</button>}
   {!ready&&s.lessonId==='first-idea'&&s.ideaId&&s.step===3&&<button className="btn btn-primary" data-testid="learning-open-idea" onClick={()=>openIdea(s.ideaId!)}>{copy('ideaEvidence')}</button>}
   {!ready&&s.lessonId==='first-idea'&&s.ideaId&&s.step===4&&<button className="btn btn-primary" data-testid="learning-open-graph" onClick={()=>openGraph(s.ideaId!)}>{copy('graph')}</button>}
   {!ready&&s.lessonId==='interface'&&<button className="btn btn-primary" data-testid="learning-interface-next" onClick={()=>{if(!interfaceViewed){interfaceTab(Math.min(s.step,3));return;}c.observe({sessionId:s.id,vaultId:s.vaultId,kind:'explanation'});if(s.step<3)interfaceTab(s.step+1);}}>{copy(!interfaceViewed?'continue':s.step===3?'finishGuide':'continue')}</button>}
   {ready&&<><button className="btn btn-primary" data-testid="learning-return-work" onClick={()=>void c.returnToWork()}>{copy('backWork')}</button><button className="btn btn-ghost" onClick={()=>{c.pause();localStorage.setItem('nodus.settingsTarget','tutorials');window.dispatchEvent(new Event('nodus:settings-target'));navigate('settings');}}>{copy('learn')}</button></>}
  </div><button className="learning-dismiss-link" onClick={()=>c.dismiss(true)}>{copy('never')}</button>
 </AcademicLearningSpotlight>;
}
export function LearningWorkspaceBar({controller:c,settings}:{controller:AcademicLearningController;settings:AppSettings}) {
 const [confirm,setConfirm]=useState(false);
 const copy=(key:LearningCopyKey)=>learningText(key,settings.uiLanguage);
 if(!c.workspace)return null;
 return <><div data-testid="learning-workspace-bar" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2 text-xs">
  <strong>{copy('workspace')}</strong><span className="flex-1">{learningText('workspaceOrigin',settings.uiLanguage,{name:c.workspace.originVaultName})}</span>
  <button className="btn btn-ghost" data-testid="learning-workspace-return" onClick={()=>void c.returnToWork()}>{copy('backWork')}</button>
  <button className="btn btn-ghost" data-testid="learning-workspace-discard" onClick={()=>setConfirm(true)}>{copy('workspaceDiscard')}</button>
 </div>{confirm&&<LearningDialog compact title={copy('workspaceDiscard')} testId="learning-workspace-discard-dialog" onClose={()=>setConfirm(false)}><div className="learning-invitation"><p className="text-sm leading-6">{copy('workspaceDiscardBody')}</p><div className="flex gap-2 mt-4"><button className="btn btn-primary" data-testid="learning-workspace-discard-confirm" onClick={()=>void c.returnToWork(true)}>{copy('workspaceDiscard')}</button><button className="btn btn-ghost" onClick={()=>setConfirm(false)}>{t('Cancelar')}</button></div></div></LearningDialog>}</>;
}
function LearningModels({ purpose, settings, onClose, onSaved }: { purpose:'chat'|'analysis'; settings:AppSettings; onClose:()=>void; onSaved:(settings:AppSettings)=>void }) {
 const copy = (key:LearningCopyKey)=>learningText(key,settings.uiLanguage);
 const needsEmbeddings=purpose==='chat'&&settings.academicMode!=='manual';
 const [model,setModel]=useState<ModelRef|null>(purpose==='chat' ? settings.chatModel ?? settings.synthesisModel : settings.extractionModel ?? settings.synthesisModel);
 const [embedding,setEmbedding]=useState<ModelRef|null>(settings.chatModel || settings.synthesisModel ? {provider:settings.embeddingProvider,model:settings.embeddingModel}:null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[download,setDownload]=useState('');
 const save=async()=>{
  if(!model || needsEmbeddings && !embedding) return;
  setBusy(true);setError('');
  try {
   const definitions=[...new Set([model,...(needsEmbeddings?[embedding]:[])].filter(m=>m?.provider==='nodus').map(m=>m!.model))].map(id=>getNodusLocalModel(id));
   if(definitions.length){
    const status=await window.nodus.getNodusLocalAiStatus();
    if(definitions.some(d=>d?.runtime==='llama_cpp')&&!status.runtime.ready){setDownload(copy('prepare'));await window.nodus.installNodusLocalRuntime(()=>{});}
    for(const d of definitions)if(d&&!status.models.some(m=>m.id===d.id&&m.downloaded)){setDownload(d.label);await window.nodus.downloadNodusLocalModel(d.id,()=>{});}
   }
   const fresh=await window.nodus.getSettings();
   const next=await window.nodus.updateSettings({...learningModelPatch(fresh,purpose,model,needsEmbeddings?embedding:null),favorites:fresh.favorites.some(m=>m.model===model.model&&m.provider===model.provider)?fresh.favorites:[...fresh.favorites,model]});
   onSaved(next);
  }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);setDownload('');}
 };
 return <LearningDialog title={copy('configure')} testId="learning-model-setup" onClose={()=>{if(!busy)onClose();}}><div className="learning-invitation"><p>{copy(purpose==='chat'?(needsEmbeddings?'twoRoles':'manualPrepare'):'cloud')}</p><p className="learning-muted">{copy('cost')}</p>
  {purpose==='analysis'&&settings.chatModel&&modelRefSupportsExtraction(settings.chatModel)&&<button className="btn btn-ghost border border-neutral-700" onClick={()=>setModel(settings.chatModel)}>{copy('reuseChat')}</button>}
  <OnboardingModelStep purpose={purpose} cloudFirst showEmbeddings={needsEmbeddings} providerKeys={settings.providerKeys} aiModel={model} embeddingModel={embedding} onAiChange={setModel} onEmbeddingChange={setEmbedding} disabled={busy}/>
  {error&&<p role="alert">{error}</p>}{download&&<p role="status">{download}</p>}
  <div className="flex gap-2"><button className="btn btn-primary" data-testid="learning-model-save" onClick={()=>void save()} disabled={busy||!model||needsEmbeddings&&!embedding}>{busy?copy('prepare'):copy('continue')}</button><button className="btn btn-ghost" disabled={busy} onClick={onClose}>{copy('later')}</button></div>
 </div></LearningDialog>;
}
export function AcademicLearningCatalog({ settings, onPatch }: { settings:AppSettings; onPatch:(patch:Partial<AppSettings>)=>Promise<unknown> }) {
 const {workspace}=useAcademicLearning();
 const [workspaceError,setWorkspaceError]=useState('');
 const user=learningProgress(settings.academicLearningProgress);
 const copy=(key:LearningCopyKey)=>learningText(key,settings.uiLanguage);
 return <div data-testid="academic-learning-catalog"><h2 className="font-semibold">{copy('learn')}</h2><p className="mt-2 text-xs text-neutral-500">{copy('guideIntro')}</p><div className="learning-catalog">{ACADEMIC_LESSONS.map(lesson=>{
  const checkpoint=settings.academicPracticeSession?.lessonId===lesson.id?settings.academicPracticeSession:settings.academicPracticeSession?.checkpoints?.[lesson.id];
  const resumable=!!checkpoint&&checkpoint.phase!=='complete';
  return <article key={lesson.id} data-testid={`learning-lesson-${lesson.id}`}><h3>{copy(lesson.goal)}</h3>{user.lessons[lesson.id]?.practiceCompleted&&<p className="learning-achievement"><Icon name="check" size={12}/>{copy('completed')}</p>}<div className="learning-catalog-actions"><button className="btn btn-primary" onClick={()=>openAcademicLearning(lesson.id,resumable?'resume':'guide')}>{copy(resumable?'resume':user.lessons[lesson.id]?.practiceCompleted?'repeatGuide':'guide')}</button>{resumable&&<button className="btn btn-ghost" onClick={()=>openAcademicLearning(lesson.id,'guide')}>{copy('repeatGuide')}</button>}{!workspace&&<button className="btn btn-ghost" data-testid="learning-workspace-lesson" onClick={()=>void window.nodus.openAcademicLearningWorkspace(lesson.id).catch(cause=>setWorkspaceError(cause instanceof Error?cause.message:String(cause)))}>{copy('workspace')}</button>}</div><label className="flex gap-2 items-start"><input type="checkbox" checked={user.invitationsEligible&&user.lessons[lesson.id]?.invitations!==false} onChange={e=>void onPatch({academicLearningProgress:learningInvitationPreference(user,lesson.id,e.target.checked)})}/>{copy('invite')}</label></article>;
 })}</div>{workspaceError&&<p role="alert">{workspaceError}</p>}<p className="mb-4 text-xs text-neutral-500">{copy('interfaceBody')}</p></div>;
}
