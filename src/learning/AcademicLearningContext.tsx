import { createContext, useCallback, useContext } from 'react';
import type { AcademicPracticeSession, LearningObservation } from '@shared/academicLearning';
export interface AcademicLearningContextValue {
 vaultId: string; epoch: number; workspace?:boolean;session: AcademicPracticeSession | null;
 observe: (event: LearningObservation) => void;
 requestExtraction: (documentIds: string[]) => boolean;
 requireModels: (purpose: 'chat'|'analysis') => boolean;
 prepareAddition: () => Promise<boolean>;
}
export const AcademicLearningContext = createContext<AcademicLearningContextValue | null>(null);
export function useAcademicLearning() {
 const scope = useContext(AcademicLearningContext);
 const epoch = scope?.epoch, sessionId = scope?.session?.id, vaultId = scope?.vaultId, observe = scope?.observe;
 const emit = useCallback((event: Omit<LearningObservation, 'sessionId' | 'vaultId'>) => {
  if (sessionId && vaultId) observe?.({ ...event, sessionId, vaultId, epoch });
 }, [sessionId, vaultId, epoch, observe]);
 return { session: scope?.session ?? null, vaultId, workspace:scope?.workspace??false,emit, requestExtraction: scope?.requestExtraction, requireModels: scope?.requireModels, prepareAddition: scope?.prepareAddition };
}
export function openAcademicLearning(lessonId: AcademicPracticeSession['lessonId'], mode: 'invite'|'guide'|'demo'|'practice'|'resume' = 'invite') {
 window.dispatchEvent(new CustomEvent('nodus:academic-learning', { detail: { lessonId, mode } }));
}
