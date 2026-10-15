import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, VaultSummary, QueueProgress } from '@shared/types';
import type { ResearchPreparationInventory, ResearchPreparationPolicy, ResearchPreparationProgress } from '@shared/researchCorpus';
import { ACADEMIC_LESSONS, LESSON_IDS, learningProgress, mergeLearningProgressChange, lessonForProfile, newPractice, observeLearning, type AcademicLessonId, type AcademicPracticeSession, type LearningObservation } from '@shared/academicLearning';
import type { AcademicLearningContextValue } from './AcademicLearningContext';
import type { View } from '../navigation';
import type {LearningWorkspaceInfo} from '@shared/learningWorkspace';
import { notifyDataChanged } from '../hooks';

function readSkipped():AcademicLessonId[]{try{const value=JSON.parse(sessionStorage.getItem('nodus.learning.skipped')??'[]');return Array.isArray(value)?value.filter(id=>LESSON_IDS.includes(id)):[];}catch{return[];}}
const skippedThisRun = new Set<AcademicLessonId>(readSkipped());
function markSkipped(id:AcademicLessonId){skippedThisRun.add(id);sessionStorage.setItem('nodus.learning.skipped',JSON.stringify([...skippedThisRun]));}
type Entry = { lessonId: AcademicLessonId; mode: 'invite'|'upgrade' } | null;
export function useAcademicLearningController({ settings, vault, enabled, blocked, progress, queue, workWaiting=false,extractionVersion, onSettings, navigate, view }: {
 settings: AppSettings | null; vault: VaultSummary | null; enabled: boolean; blocked: boolean;
 progress?: ResearchPreparationProgress; queue?: QueueProgress|null; workWaiting?:boolean;extractionVersion?: string; view:View; onSettings: (settings: AppSettings) => void; navigate: (view: View) => void;
}) {
 const [session, setSession] = useState<AcademicPracticeSession | null>(null);
 const [entry, setEntry] = useState<Entry>(null);
 const [modelsPurpose, setModelsPurpose] = useState<'chat'|'analysis'|null>(null);
 const [inventory, setInventory] = useState<ResearchPreparationInventory | null>(null);
 const [policy, setPolicy] = useState<ResearchPreparationPolicy | null>(null);
 const [ideaCount, setIdeaCount] = useState(0);
 const [error, setError] = useState('');
 const [workspace,setWorkspace]=useState<LearningWorkspaceInfo|null>(null);
 const workspaceBootstrapped=useRef(false);
 const epoch = useRef(0);
 const scope = useRef({ settings, vault, enabled, session, blocked, epoch:0 });
 if(scope.current.vault?.id!==vault?.id)epoch.current++;
 scope.current = { settings, vault, enabled, session, blocked, epoch:epoch.current };
 const writes = useRef<Promise<unknown>>(Promise.resolve());
 const save = useCallback((patch: Pick<Partial<AppSettings>, 'academicLearningProgress'|'academicPracticeSession'>) => {
  const vaultId = scope.current.vault?.id;
  if (!vaultId) return Promise.resolve();
  const before=learningProgress(scope.current.settings?.academicLearningProgress);
  writes.current = writes.current.catch(() => {}).then(async () => {
   const fresh=patch.academicLearningProgress ? await window.nodus.getSettings() : null;
   const next = await window.nodus.updateAcademicLearning(vaultId, {...patch,...(patch.academicLearningProgress?{academicLearningProgress:mergeLearningProgressChange(learningProgress(fresh?.academicLearningProgress),before,patch.academicLearningProgress)}:{})});
   if (next && scope.current.vault?.id === vaultId) { onSettings(next); setError(''); }
  }).catch(cause => { if (scope.current.vault?.id === vaultId) setError(cause instanceof Error ? cause.message : String(cause)); });
  return writes.current;
 }, [onSettings]);
 const commitSession = useCallback((next: AcademicPracticeSession) => {
  scope.current.session = next; setSession(next);
  const user = learningProgress(scope.current.settings?.academicLearningProgress);
  void save({ academicPracticeSession: next, ...(next.phase === 'complete' ? { academicLearningProgress: { ...user, lessons: { ...user.lessons, [next.lessonId]: { ...user.lessons[next.lessonId], practiceCompleted: true } } } } : {}) });
 }, [save]);
 const observe = useCallback((event: LearningObservation) => {
  const current = scope.current.session;
  if (!current || !scope.current.enabled || current.vaultId !== scope.current.vault?.id || event.epoch !== undefined && event.epoch!==scope.current.epoch) return;
  if(event.kind==='source'&&event.documentId&&event.documentId!==current.documentId&&event.sessionId===current.id&&event.vaultId===current.vaultId&&!current.paused&&current.recovery==='missing-source') {
   const replacement={...newPractice(current.vaultId,current.lessonId,crypto.randomUUID()),checkpoints:current.checkpoints};
   commitSession(observeLearning(replacement,{...event,sessionId:replacement.id})); return;
  }
  const next = observeLearning(current, event);
  if (next !== current) commitSession(next);
 }, [commitSession]);
 useEffect(() => {
  const next = settings?.academicPracticeSession;
  const current = scope.current.session;
  if (!enabled || !next || next.vaultId !== vault?.id) { setSession(null); scope.current.session = null; }
  else if (!current || current.id !== next.id || current.vaultId !== vault?.id) { setSession(next); scope.current.session = next; }
 }, [vault?.id, enabled, settings?.academicPracticeSession?.id]);
 useEffect(() => { setEntry(null); setModelsPurpose(null); setInventory(null); setPolicy(null); setIdeaCount(0); setError(''); }, [vault?.id]);
 const pause = useCallback(() => { const current = scope.current.session; if (current) commitSession({ ...current, paused: true }); }, [commitSession]);
 const startPractice = useCallback(async (lessonId: AcademicLessonId, resume = false) => {
  const { vault, settings, enabled } = scope.current;
  if (!enabled || !vault || !settings) return;
  setEntry(null); markSkipped(lessonId);
  const previous = scope.current.session ?? settings.academicPracticeSession;
  const checkpoint = previous?.lessonId === lessonId ? previous : previous?.checkpoints?.[lessonId];
  const next = resume && checkpoint?.lessonId === lessonId && checkpoint.vaultId === vault.id && checkpoint.phase !== 'complete'
   ? { ...checkpoint, paused: false } : newPractice(vault.id, lessonId, crypto.randomUUID());
  const { checkpoints: _oldCheckpoints, ...oldCheckpoint } = previous ?? {};
  next.checkpoints = {...previous?.checkpoints,...(previous ? {[previous.lessonId]:oldCheckpoint}: {})};
  commitSession(next);
  navigate(ACADEMIC_LESSONS.find(l => l.id === lessonId)!.destination as View);
 }, [commitSession, save, navigate]);
 const open = useCallback((lessonId: AcademicLessonId, mode: 'invite'|'guide'|'demo'|'practice'|'resume' = 'invite') => {
  if (!scope.current.enabled || !LESSON_IDS.includes(lessonId)) return;
  markSkipped(lessonId);
  // Old demo links now start the real in-app guide; no simulated workspace exists.
  if (mode === 'guide' || mode === 'demo' || mode === 'practice' || mode === 'resume') { void startPractice(lessonId, mode === 'resume'); return; }
  pause(); setModelsPurpose(null); setEntry({ lessonId, mode });
 }, [pause, startPractice]);
 useEffect(() => {
  const listener = (event: Event) => { const detail = (event as CustomEvent<{ lessonId: AcademicLessonId; mode?: 'invite'|'guide'|'demo'|'practice'|'resume' }>).detail; if (detail) open(detail.lessonId, detail.mode); };
  window.addEventListener('nodus:academic-learning', listener);
  if (sessionStorage.getItem('nodus.learning.skip-first') === '1') { markSkipped('first-answer'); sessionStorage.removeItem('nodus.learning.skip-first'); }
  const pending = sessionStorage.getItem('nodus.learning.open');
  if (pending && enabled) {
   try { const value = JSON.parse(pending); if (value.vaultId === vault?.id) { sessionStorage.removeItem('nodus.learning.open'); open(value.lessonId, value.mode); } } catch { sessionStorage.removeItem('nodus.learning.open'); }
  }
  return () => window.removeEventListener('nodus:academic-learning', listener);
 }, [open, enabled, vault?.id, settings?.onboardingComplete, settings?.academicLearningProgress?.welcomeComplete]);
 useEffect(() => {
  if (!enabled || blocked || !settings?.onboardingComplete || entry || modelsPurpose || (session && !session.paused)) return;
  const user = settings.academicLearningProgress;
  const baseLesson=lessonForProfile(settings.academicInterfaceProfile);
  const baseProgress=user?.lessons[baseLesson];
  const contextual=(baseProgress?.demoCompleted||baseProgress?.practiceCompleted) ? ACADEMIC_LESSONS.find(l=>l.destination===view && !['first-answer','first-idea','interface','research-question'].includes(l.id))?.id : undefined;
  const lessonId=contextual??baseLesson;
  const p = user?.lessons[lessonId];
  if (settings.academicInterfaceProfile === 'custom' || !user?.invitationsEligible || skippedThisRun.has(lessonId) || p?.invitations === false || p?.demoCompleted || p?.practiceCompleted) return;
  markSkipped(lessonId); setEntry({ lessonId, mode: 'invite' });
 }, [enabled, blocked, settings, entry, modelsPurpose, session, view]);
 const requestExtraction = useCallback((_ids: string[]) => {
  const { settings, enabled } = scope.current;
  if (!enabled || settings?.academicMode === 'manual') return false;
  if (settings?.academicInterfaceProfile === 'simple') { pause(); setEntry({ lessonId: 'first-idea', mode: 'upgrade' }); return true; }
  if (!settings?.extractionModel && !settings?.synthesisModel) { setModelsPurpose('analysis'); return true; }
  return false;
 }, [pause]);
 const requireModels = useCallback((purpose:'chat'|'analysis') => {
  const current=scope.current.settings;
  if (!current || !scope.current.enabled) return false;
  if(current.academicLearningProgress?.invitationsEligible&&!current.academicLearningProgress.realSetupStarted)void save({academicLearningProgress:{...current.academicLearningProgress,realSetupStarted:true}});
  if (purpose==='chat' ? !current.chatModel && !current.synthesisModel : !current.extractionModel && !current.synthesisModel) {
   setModelsPurpose(purpose); return true;
  }
  return false;
 },[save]);
 const prepareAddition = useCallback(async () => {
  const current=scope.current;
  if(current.vault?.learningWorkspace||!current.enabled||!current.session||current.session.paused||!current.settings?.academicLearningProgress?.invitationsEligible)return false;
  const status=await window.nodus.getRecoveryStatus();
  if(!status.needsSetup)return false;
  await save({academicLearningProgress:{...current.settings.academicLearningProgress,realSetupStarted:true}});
  return true;
 },[save]);
 const refresh = useCallback(async () => {
  const captured = scope.current.session;
  if (!captured || captured.paused || captured.phase === 'complete' || !scope.current.enabled || !scope.current.settings?.onboardingComplete || modelsPurpose) return;
  const vaultId = captured.vaultId, capturedEpoch=scope.current.epoch;
  try {
   const [data, preparationPolicy] = await Promise.all([window.nodus.getResearchPreparationInventory(), window.nodus.getResearchPreparationPolicy()]);
   if (scope.current.epoch!==capturedEpoch || scope.current.vault?.id !== vaultId || scope.current.session?.id !== captured.id) return;
   setInventory(data); setPolicy(preparationPolicy);
   if (!captured.documentId) return;
   const doc = data.documents.find(d => d.workId === captured.documentId || d.id === captured.documentId);
   const event = (value: Omit<LearningObservation,'sessionId'|'vaultId'|'documentId'>) => observe({ ...value, sessionId: captured.id, vaultId, epoch:capturedEpoch, documentId: captured.documentId });
   if (!doc) { event({ kind: 'recovery', recovery: 'missing-source' }); return; }
   if(captured.lessonId==='first-answer' && captured.step>=2 && captured.documentRevision && doc.revision!==captured.documentRevision){commitSession({...captured,step:1,phase:'recovery',recovery:'partial',documentRevision:undefined,messageId:undefined,citationIds:undefined});return;}
   if (captured.lessonId === 'first-answer' && captured.step === 1) {
    const state = doc.preparation;
    if (state.text === 'available' && doc.coverage === 'fulltext' && state.lexical === 'ready' && (state.embeddings === 'ready' || scope.current.settings?.academicMode==='manual') && !state.unpreparedAttachmentIds?.length && (state.status === 'ready' || scope.current.settings?.academicMode==='manual')) event({ kind: 'prepared', valid: true, documentRevision:doc.revision });
    else if (state.reason === 'no_model') event({ kind: 'recovery', recovery: 'model' });
    else if (state.status === 'paused') event({ kind: 'recovery', recovery: 'paused' });
    else if (state.status === 'cancelled') event({ kind: 'recovery', recovery: 'cancelled' });
    else if (state.text === 'abstract' || state.embeddings === 'partial') event({ kind: 'recovery', recovery: 'partial' });
    else if (state.status === 'failed') event({ kind: 'recovery', recovery: state.reason === 'provider_failed' ? 'provider' : 'source' });
    else if (state.status === 'blocked' && ['no_attachment','not_downloaded','inaccessible','extraction_failed','ocr_required'].includes(state.reason ?? '')) event({ kind: 'recovery', recovery: 'source' });
    else if (captured.phase === 'recovery' && ['queued','running'].includes(state.status)) commitSession({ ...captured, phase: 'wait', recovery: undefined });
   }
   if (captured.lessonId === 'first-idea' && captured.step >= 1 && captured.step <= 2) {
    if(captured.step===2 && scope.current.settings?.academicMode!=='manual') {
      const queue=await window.nodus.getQueue(); const task=queue.items.find(item=>item.id===captured.taskId);
      if(task && task.nodus_id===captured.documentId) {
        if(task.state==='paused'||(queue.paused&&['running','queued'].includes(task.state))){event({kind:'recovery',recovery:'paused'});return;}
        if(task.state==='failed'||task.state==='cancelled'){event({kind:'recovery',recovery:task.state==='cancelled'?'cancelled':'provider'});return;}
        if(['queued','running'].includes(task.state)){if(captured.phase==='recovery')commitSession({...captured,phase:'wait',recovery:undefined});return;}
      }
      if(queue.maintenanceError){event({kind:'recovery',recovery:'partial'});return;}
      const work=(await window.nodus.listWorks()).find(w=>w.nodus_id===captured.documentId);
      if(work?.deep_status!=='done')return;
    }
    const page = await window.nodus.getIdeasByWork(doc.workId!, 50, 0);
    if (scope.current.epoch!==capturedEpoch || scope.current.session?.id !== captured.id || scope.current.vault?.id !== vaultId) return;
    setIdeaCount(page.total);
    // Existing/manual ideas are available results too; opening one still checks its evidence.
    if (page.total && (captured.step === 2 || scope.current.settings?.academicMode === 'manual')) {
     if (captured.step === 1) event({ kind: 'extraction' });
     const details = await Promise.all(page.ideas.map(i => window.nodus.getIdeaDetail(i.global_id)));
     if (scope.current.epoch!==capturedEpoch || scope.current.session?.id !== captured.id || scope.current.vault?.id !== vaultId) return;
     const idea = details.find(d => d?.evidence.some(e => e.nodus_id === captured.documentId && e.quote.trim()));
     if (idea) event({ kind: 'ideas', valid: true, ideaId: idea.idea.global_id });
     else event({ kind: 'recovery', recovery: 'no-ideas' });
    } else if (captured.step === 2) {
     const work = (await window.nodus.listWorks()).find(w => w.nodus_id === captured.documentId);
     if (work?.deep_status === 'done') event({ kind: 'recovery', recovery: 'no-ideas' });
     else if (work?.deep_status === 'failed') event({ kind: 'recovery', recovery: 'provider' });
    }
   }
  } catch (cause) { if (scope.current.epoch===capturedEpoch && scope.current.vault?.id === vaultId) setError(cause instanceof Error ? cause.message : String(cause)); }
 }, [entry?.mode, modelsPurpose, observe, commitSession]);
 const refreshRef=useRef(refresh);refreshRef.current=refresh;
 const alive=useRef(true);
 const refreshBusy=useRef(false),refreshAgain=useRef(false),refreshTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const requestRefresh=useCallback(()=>{
  if(!alive.current||refreshTimer.current)return;
  refreshTimer.current=setTimeout(()=>{
   refreshTimer.current=null;
   if(refreshBusy.current){refreshAgain.current=true;return;}
   refreshBusy.current=true;
   void refreshRef.current().finally(()=>{refreshBusy.current=false;if(alive.current&&refreshAgain.current){refreshAgain.current=false;requestRefresh();}});
  },150);
 },[]);
 useEffect(()=>{requestRefresh();const onChange=()=>requestRefresh();window.addEventListener('nodus:data-changed',onChange);return()=>window.removeEventListener('nodus:data-changed',onChange);},[requestRefresh,session?.id,session?.step,session?.paused,blocked,modelsPurpose]);
 useEffect(()=>{requestRefresh();},[requestRefresh,progress,queue,extractionVersion]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(refreshTimer.current)clearTimeout(refreshTimer.current);refreshTimer.current=null;refreshAgain.current=false;};},[]);
 const dismiss = (never = false) => {
  const lessonId = entry?.lessonId ?? session?.lessonId;
  if (lessonId) markSkipped(lessonId);
  if (never && lessonId) { const user = learningProgress(settings?.academicLearningProgress); void save({ academicLearningProgress: { ...user, lessons: { ...user.lessons, [lessonId]: { ...user.lessons[lessonId], invitations: false } } } }); }
  setEntry(null); pause();
 };
 const selectSource = (documentId: string) => {
  const current = scope.current.session; if (!current) return;
  const selected=current.documentId && current.documentId!==documentId ? {...newPractice(current.vaultId,current.lessonId,crypto.randomUUID()),checkpoints:current.checkpoints}:current;
  if(selected!==current)commitSession(selected);
  observe({ sessionId: selected.id, vaultId: selected.vaultId, kind: 'source', documentId });
 };
 const importSample = async () => {
  const captured = scope.current.session;
  if (!captured || !vault) return;
  const capturedEpoch=scope.current.epoch;
  try {
   if(!vault.learningWorkspace) {
    await window.nodus.openAcademicLearningWorkspace(captured.lessonId);pause();return;
   }
   if(await prepareAddition())return;
   const report = await window.nodus.importAcademicLearningSample(vault.id);
   if (scope.current.epoch!==capturedEpoch || scope.current.vault?.id !== vault.id || scope.current.session?.id !== captured.id) return;
   const itemId=report.itemIds[0]??report.existingItemIds?.[0];
   if (itemId) { const sources = await window.nodus.getResearchCorpusSources(); const source = sources.documents.find(d => d.libraryItemId === itemId || d.workId === itemId || d.id === itemId); if (scope.current.epoch===capturedEpoch && scope.current.vault?.id === vault.id && scope.current.session?.id === captured.id) selectSource(source?.workId ?? itemId); }
   notifyDataChanged(); await refresh();
  } catch (cause) { if(scope.current.epoch===capturedEpoch)setError(cause instanceof Error ? cause.message : String(cause)); }
 };
 useEffect(()=>{
  if(!enabled || !vault?.learningWorkspace || !settings?.onboardingComplete || workspaceBootstrapped.current)return;
  workspaceBootstrapped.current=true;
  void (async()=>{
   const info=await window.nodus.getAcademicLearningWorkspace();if(!info)return;
   setWorkspace(info);
   await startPractice(info.lessonId,info.resume);
   await window.nodus.academicLearningWorkspaceReady();
   if(info.importExample && ['first-answer','first-idea'].includes(info.lessonId) && !scope.current.session?.documentId)await importSample();
  })().catch(cause=>setError(cause instanceof Error?cause.message:String(cause)));
 },[enabled,vault?.learningWorkspace,settings?.onboardingComplete,startPractice,importSample]);
 const returnToWork=async(discard=false)=>{
  pause();await writes.current;
  if(vault?.learningWorkspace)await window.nodus.closeAcademicLearningWorkspace(discard);
 };
 const context: AcademicLearningContextValue | null = enabled && vault ? { vaultId: vault.id, workspace:!!vault.learningWorkspace,epoch:epoch.current, session: session?.vaultId === vault.id ? session : null, observe, requestExtraction, requireModels, prepareAddition } : null;
 return { context, session, entry, modelsPurpose, setModelsPurpose, inventory, policy, ideaCount, error, progress, queue, workWaiting,workspace,returnToWork,open, startPractice, dismiss, selectSource, importSample, refresh, observe, save, pause, requireModels, view };
}
export type AcademicLearningController = ReturnType<typeof useAcademicLearningController>;
