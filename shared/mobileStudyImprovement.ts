import type {PromptLanguage} from './types';
import type {StudyImproveRequest, StudyImproveResult, StudyStyle} from './studyImprove';

export interface MobileStudyImprovementContext {
  revision: string;
  style: StudyStyle;
  promptLanguage: PromptLanguage;
  uiLanguage: PromptLanguage;
  maxOutputTokens: number;
}
export interface MobileStudyImprovementSave {
  request: StudyImproveRequest;
  revision: string;
  raw: string;
  requestId: string;
}
export type MobileStudyImprovementResult = StudyImproveResult;
