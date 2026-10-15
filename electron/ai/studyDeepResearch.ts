import {completeJson,completeText} from './aiClient';
import {retrieveStudyAssistantEntries} from './studySearch';
import {listStudyIdeasForSources} from '../db/studyKnowledgeRepo';
import {portableStudyDeepResearch} from '@shared/portableStudyDeepResearch';
export {normalizeStudyDeepResearchAudience} from '@shared/portableStudyDeepResearch';
export type {ResolvedStudySection} from '@shared/portableStudyDeepResearch';
export const {MAX_UNIT_SECTIONS,STUDY_DEEP_RESEARCH_PROMPTS,TEACHING_UNIT_PROMPTS,studyDeepResearchPromptPack,mergeStudyApproachEntries,normalizeUnitOutline,assembleStudyDraftBody,resolveStudySections,generateStudyDeepResearchReport}=portableStudyDeepResearch({completeJson,completeText,retrieveStudyAssistantEntries,listStudyIdeasForSources});
