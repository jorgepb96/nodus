import type { AppSettings } from './types';
import type { AcademicLessonId, AcademicPracticeSession } from './academicLearning';

export interface LearningWorkspaceInfo {
  originVaultName: string;
  lessonId: AcademicLessonId;
  resume: boolean;
  importExample: boolean;
}

/** Copy configuration, never a corpus, registry, recovery folder, or integration. */
export function learningWorkspaceSettings(source: AppSettings): Partial<AppSettings> {
  const keys = ['uiLanguage','promptLanguage','theme','appTheme','customThemes','interfaceScale','accessibleFont','highContrast','reduceMotion','localProviders','customProvider','favorites','providerFreeTier','chatModel','embeddingProvider','embeddingModel','extractionModel','summaryModel','fusionModel','relationModel','synthesisModel','modelSettingsVersion','modelSettingsMode','academicMode','concurrency','aiConcurrencyMode'] as const;
  const selected = Object.fromEntries(keys.map(key => [key,source[key]]));
  return {...selected, academicInterfaceProfile:'simple',onboardingComplete:true,basicsTutorialVersion:9999,firstVaultVersion:1,tourComplete:true,advancedTourComplete:true,recoverySetupVersion:9999,mascotEnabled:false,mascotStyleChosen:true,announcementsEnabled:false,autoBackupEnabled:false,autoResumeQueue:false,syncMode:'manual',researchWebSearch:'off',autoBridgeAfterQueue:false,autoSummaryAfterDeep:false,
    academicLearningProgress:{version:1,invitationsEligible:false,welcomeComplete:true,lessons:{}}};
}

/** Waiting is observable work, not an instruction to click a highlighted control. */
export function learningRequiresInteraction(session: AcademicPracticeSession, waiting: boolean): boolean {
  return session.phase !== 'complete' && session.phase !== 'wait' && !waiting;
}
