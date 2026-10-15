import type { AcademicInterfaceProfile, AppSettings, ModelRef } from './types';
import { MODEL_SETTINGS_VERSION } from './modelSettings';

export const LEARNING_VERSION = 1;
export const LESSON_IDS = ['first-answer', 'first-idea', 'research-question', 'overview', 'hypothesis', 'reading', 'deep-research', 'scriptor', 'authors', 'argument-map', 'dictionary', 'interface'] as const;
export type AcademicLessonId = typeof LESSON_IDS[number];
export type LearningPhase = 'explanation' | 'action' | 'wait' | 'verification' | 'recovery' | 'complete';
export interface AcademicLessonProgress { demoCompleted?: boolean; demoStep?: number; practiceCompleted?: boolean; invitations?: boolean }
export interface AcademicLearningProgress {
  version: number;
  /** Only a new installation opts into invitations; upgrading never opts in. */
  invitationsEligible: boolean;
  realSetupStarted?: boolean;
  welcomeComplete?: boolean;
  freshIntroductionPending?: boolean;
  lessons: Partial<Record<AcademicLessonId, AcademicLessonProgress>>;
}
export interface AcademicPracticeSession {
  version: number; id: string; vaultId: string; lessonId: AcademicLessonId;
  step: number; phase: LearningPhase; paused: boolean;
  documentId?: string; documentRevision?: string; conversationId?: string; messageId?: string;
  citationIds?: string[]; ideaId?: string; artifactId?: string; taskId?: string;
  checkpoints?: Partial<Record<AcademicLessonId, Omit<AcademicPracticeSession, 'checkpoints'>>>;
  recovery?: 'missing-source' | 'model' | 'source' | 'partial' | 'paused' | 'cancelled' | 'provider' | 'no-citation' | 'no-ideas' | 'graph';
}
export const ACADEMIC_LESSONS = [
  { id: 'first-answer', profile: 'simple', destination: 'library', steps: ['choose', 'prepare', 'ask', 'citation'], goal: 'firstAnswer' },
  { id: 'first-idea', profile: 'intermediate', destination: 'library', steps: ['choose', 'extract', 'ideas', 'ideaEvidence', 'graph'], goal: 'firstIdea' },
  { id: 'research-question', profile: 'advanced', destination: 'researchChat', steps: ['question', 'citation'], goal: 'researchQuestion' },
  { id: 'overview', profile: 'advanced', destination: 'research', steps: ['overview', 'evidence'], goal: 'overview' },
  { id: 'hypothesis', profile: 'advanced', destination: 'hypothesis', steps: ['hypothesis', 'evidence'], goal: 'hypothesis' },
  { id: 'reading', profile: 'advanced', destination: 'reading', steps: ['reading', 'source'], goal: 'reading' },
  { id: 'deep-research', profile: 'advanced', destination: 'deepResearch', steps: ['deepResearch', 'evidence'], goal: 'deepResearch' },
  { id: 'scriptor', profile: 'advanced', destination: 'workspace', steps: ['scriptor', 'draft'], goal: 'scriptor' },
  { id: 'authors', profile: 'intermediate', destination: 'authors', steps: ['authors', 'evidence'], goal: 'authors' },
  { id: 'argument-map', profile: 'intermediate', destination: 'argument', steps: ['argumentMap', 'evidence'], goal: 'argumentMap' },
  { id: 'dictionary', profile: 'intermediate', destination: 'dictionary', steps: ['dictionary', 'definition'], goal: 'dictionary' },
  { id: 'interface', profile: 'custom', destination: 'settings', steps: ['profiles', 'theme', 'languages', 'nodi'], goal: 'interface' },
] as const;
export function lessonForProfile(profile?: AcademicInterfaceProfile): AcademicLessonId {
  return profile === 'intermediate' ? 'first-idea' : profile === 'advanced' ? 'research-question' : profile === 'custom' ? 'interface' : 'first-answer';
}
export function learningProgress(value?: AcademicLearningProgress): AcademicLearningProgress {
  return value ?? { version: LEARNING_VERSION, invitationsEligible: false, lessons: {} };
}
/** Apply the caller's changes without replacing newer checkpoints from another lesson. */
export function mergeLearningProgressChange(current: AcademicLearningProgress, before: AcademicLearningProgress, requested: AcademicLearningProgress): AcademicLearningProgress {
  const result={...current,lessons:{...current.lessons}};
  for(const field of ['invitationsEligible','realSetupStarted','welcomeComplete','freshIntroductionPending'] as const) {
    if(Object.prototype.hasOwnProperty.call(requested,field)&&requested[field]!==before[field])Object.assign(result,{[field]:requested[field]});
  }
  for(const id of LESSON_IDS) {
    const next=requested.lessons[id];if(!next)continue;
    const lesson={...current.lessons[id]};
    for(const field of ['demoCompleted','practiceCompleted','invitations','demoStep'] as const) {
      if(Object.prototype.hasOwnProperty.call(next,field)&&next[field]!==before.lessons[id]?.[field]) {
        Object.assign(lesson,{[field]:next[field]});
      }
    }
    result.lessons[id]=lesson;
  }
  return result;
}
export function learningInvitationPreference(progress:AcademicLearningProgress,lessonId:AcademicLessonId,enabled:boolean):AcademicLearningProgress {
  const lessons=progress.invitationsEligible ? {...progress.lessons} : Object.fromEntries(LESSON_IDS.map(id=>[id,{...progress.lessons[id],invitations:false}]));
  return {...progress,invitationsEligible:progress.invitationsEligible||enabled,lessons:{...lessons,[lessonId]:{...lessons[lessonId],invitations:enabled}}};
}
export function newPractice(vaultId: string, lessonId: AcademicLessonId, id: string): AcademicPracticeSession {
  return { version: LEARNING_VERSION, id, vaultId, lessonId, step: 0, phase: 'action', paused: false };
}
export interface LearningObservation {
  sessionId: string; vaultId: string; epoch?: number;
  kind: 'source' | 'prepared' | 'answer' | 'citation' | 'extraction' | 'ideas' | 'idea-evidence' | 'graph' | 'artifact' | 'artifact-evidence' | 'explanation' | 'recovery';
  documentId?: string; documentRevision?: string; conversationId?: string; messageId?: string; citationIds?: string[];
  ideaId?: string; artifactId?: string; taskId?: string;
  valid?: boolean; recovery?: AcademicPracticeSession['recovery'];
}
/** The chat's citation contract can reject an uncited turn before it returns. */
export function learningChatRecovery(error: unknown, stopped = false): AcademicPracticeSession['recovery'] {
  if (stopped) return 'cancelled';
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('research_answer_no_citation') || message.includes('ninguna cita verificable del contexto') ? 'no-citation' : 'provider';
}
/** Checkpoints represent observed outcomes. A generic Next cannot complete a practical step. */
export function observeLearning(session: AcademicPracticeSession, event: LearningObservation): AcademicPracticeSession {
  if (session.paused || session.phase === 'complete' || event.sessionId !== session.id || event.vaultId !== session.vaultId) return session;
  if (event.documentId && session.documentId && event.documentId !== session.documentId) return session;
  if (event.kind === 'recovery' && session.phase === 'recovery' && session.recovery === event.recovery) return session;
  if (event.kind === 'recovery') return { ...session, ...(event.conversationId?{conversationId:event.conversationId}:{}), ...(event.messageId?{messageId:event.messageId}:{}), ...(event.recovery==='no-citation' && ['first-answer','research-question'].includes(session.lessonId)?{step:session.lessonId==='first-answer'?2:0,citationIds:undefined}:{}), phase: 'recovery', recovery: event.recovery ?? 'provider' };
  const lesson = ACADEMIC_LESSONS.find(l => l.id === session.lessonId)!;
  let advance = false;
  let patch: Partial<AcademicPracticeSession> = {};
  if (session.lessonId === 'first-answer') {
    if (session.step === 0 && event.kind === 'source' && event.documentId) { advance = true; patch.documentId = event.documentId; }
    if (session.step === 1 && event.kind === 'prepared' && event.valid) { advance = true; patch.documentRevision=event.documentRevision; }
    if (session.step === 2 && event.kind === 'answer' && event.valid && event.citationIds?.length) {
      advance = true; patch = { conversationId: event.conversationId, messageId: event.messageId, citationIds: event.citationIds };
    }
    if (session.step === 3 && event.kind === 'citation' && event.messageId === session.messageId && event.conversationId === session.conversationId && event.valid && event.citationIds?.some(id => session.citationIds?.includes(id))) advance = true;
  } else if (session.lessonId === 'first-idea') {
    if (session.step === 0 && event.kind === 'source' && event.documentId) { advance = true; patch.documentId = event.documentId; }
    if (session.step === 1 && event.kind === 'extraction') { advance = true; patch.taskId = event.taskId; }
    if(session.step>=2 && event.kind==='extraction') return {...session,step:2,phase:'wait',taskId:event.taskId,ideaId:undefined,recovery:undefined};
    if (session.step === 2 && event.kind === 'ideas' && event.valid && event.ideaId) { advance = true; patch.ideaId = event.ideaId; }
    if (session.step === 3 && event.kind === 'idea-evidence' && event.valid && event.ideaId === session.ideaId) advance = true;
    if (session.step === 4 && event.kind === 'graph' && event.valid && event.ideaId === session.ideaId) advance = true;
  } else if (session.lessonId === 'research-question') {
    if (session.step === 0 && event.kind === 'answer' && event.valid && event.citationIds?.length) { advance = true; patch = { documentId: event.documentId, conversationId: event.conversationId, messageId: event.messageId, citationIds: event.citationIds }; }
    if (session.step === 1 && event.kind === 'citation' && event.messageId === session.messageId && event.conversationId === session.conversationId && event.valid && event.citationIds?.some(id => session.citationIds?.includes(id))) advance = true;
  } else if (session.lessonId === 'interface') advance = event.kind === 'explanation';
  else {
    if (event.kind === 'artifact' && event.valid && event.artifactId) { advance = session.step === 0; patch = {artifactId:event.artifactId,citationIds:event.citationIds}; if (!advance && session.artifactId !== event.artifactId) return {...session,...patch}; }
    if (session.step === 1 && event.kind === 'artifact-evidence' && event.valid && event.artifactId === session.artifactId && event.citationIds?.some(id=>session.citationIds?.includes(id))) advance = true;
  }
  if (!advance) return session;
  const step = session.step + 1;
  return { ...session, ...patch, step, phase: step >= lesson.steps.length ? 'complete' : (session.lessonId === 'first-idea' && step === 2 ? 'wait' : 'action'), recovery: undefined };
}

/** Chat-only setup must bypass legacy basic-mode fan-out and its one-time migration. */
export function learningModelPatch(settings: AppSettings, purpose: 'chat' | 'analysis', model: ModelRef, embedding?: ModelRef | null): Partial<AppSettings> {
  return {
    modelSettingsMode: 'advanced', modelSettingsVersion: MODEL_SETTINGS_VERSION,
    ...(purpose === 'chat' ? { chatModel: model } : {
      extractionModel: model,
      // A new analysis setup uses one choice for its pipeline, without replacing
      // any task selections the user already configured.
      ...(settings.modelSettingsMode==='basic' || !settings.fusionModel && !settings.synthesisModel ? { fusionModel: model } : {}),
      ...(settings.modelSettingsMode==='basic' || !settings.relationModel && !settings.synthesisModel ? { relationModel: model } : {}),
      ...(settings.modelSettingsMode==='basic' || !settings.summaryModel && !settings.synthesisModel ? { summaryModel: model } : {}),
    }),
    ...(embedding ? { embeddingProvider: embedding.provider as AppSettings['embeddingProvider'], embeddingModel: embedding.model } : {}),
  };
}

export function sanitizeLearningProgress(value: unknown): AcademicLearningProgress | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as AcademicLearningProgress;
  if (input.version !== LEARNING_VERSION) return undefined;
  const lessons: AcademicLearningProgress['lessons'] = {};
  for (const id of LESSON_IDS) {
    const p = input.lessons?.[id]; if (!p || typeof p !== 'object') continue;
    lessons[id] = { demoCompleted: p.demoCompleted === true, practiceCompleted: p.practiceCompleted === true, invitations: p.invitations !== false, ...(Number.isInteger(p.demoStep) && p.demoStep! >= 0 && p.demoStep! <= 6 ? {demoStep:p.demoStep} : {}) };
  }
  return { version: LEARNING_VERSION, invitationsEligible: input.invitationsEligible === true, realSetupStarted: input.realSetupStarted === true, welcomeComplete: input.welcomeComplete === true, freshIntroductionPending: input.freshIntroductionPending === true, lessons };
}
export function sanitizePracticeSession(value: unknown): AcademicPracticeSession | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const s = value as AcademicPracticeSession;
  const lesson = ACADEMIC_LESSONS.find(l => l.id === s.lessonId);
  if (s.version !== LEARNING_VERSION || !lesson || typeof s.id !== 'string' || !s.id || typeof s.vaultId !== 'string' || !s.vaultId || !Number.isInteger(s.step) || s.step < 0 || s.step > lesson.steps.length) return undefined;
  const clean = newPractice(String(s.vaultId).slice(0, 256), s.lessonId, String(s.id).slice(0, 256));
  clean.step = s.step; clean.paused = s.paused === true;
  clean.phase = ['explanation', 'action', 'wait', 'verification', 'recovery', 'complete'].includes(s.phase) ? s.phase : 'action';
  for (const key of ['documentId', 'documentRevision', 'conversationId', 'messageId', 'ideaId', 'artifactId', 'taskId'] as const) if (typeof s[key] === 'string') clean[key] = s[key]!.slice(0, 256);
  clean.citationIds = Array.isArray(s.citationIds) ? s.citationIds.filter(id => typeof id === 'string').slice(0, 64).map(id => id.slice(0, 256)) : undefined;
  if(s.checkpoints && typeof s.checkpoints==='object') {
    clean.checkpoints={};
    for(const id of LESSON_IDS) { const saved=s.checkpoints[id]; if(!saved)continue; const checkpoint=sanitizePracticeSession({...saved,checkpoints:undefined}); if(checkpoint && checkpoint.vaultId===clean.vaultId && checkpoint.lessonId===id)clean.checkpoints[id]=checkpoint; }
  }
  if (['missing-source', 'model', 'source', 'partial', 'paused', 'cancelled', 'provider', 'no-citation', 'no-ideas', 'graph'].includes(s.recovery ?? '')) clean.recovery = s.recovery;
  // A restored checkpoint must still contain the references that proved it.
  // Repair an incomplete backup to a usable action rather than a false success.
  let checkpoint = clean.step;
  if (['first-answer', 'first-idea'].includes(clean.lessonId) && !clean.documentId) checkpoint = 0;
  else if (clean.lessonId === 'first-answer' && clean.step >= 3 && (!clean.conversationId || !clean.messageId || !clean.citationIds?.length)) checkpoint = 2;
  else if (clean.lessonId === 'first-idea' && clean.step >= 3 && !clean.ideaId) checkpoint = 2;
  else if (clean.lessonId === 'research-question' && clean.step >= 1 && (!clean.conversationId || !clean.messageId || !clean.citationIds?.length)) checkpoint = 0;
  else if (!['first-answer', 'first-idea', 'research-question', 'interface'].includes(clean.lessonId) && clean.step >= 1 && (!clean.artifactId || !clean.citationIds?.length)) checkpoint = 0;
  if (checkpoint !== clean.step || clean.phase === 'complete' && checkpoint !== lesson.steps.length) {
    clean.step = checkpoint; clean.phase = 'action'; clean.recovery = undefined;
  }
  return clean;
}
