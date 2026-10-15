import {portableResearchSectionCoverage} from '@shared/portableResearchSectionCoverage';
import {completeJson,completeText} from './aiClient';
import {withResearchValidationThinking} from './thinkingEffort';
export const {createResearchSectionCoverage}=portableResearchSectionCoverage({completeJson:(...args)=>completeJson(...args),completeText:(...args)=>completeText(...args),withResearchValidationThinking});
