import {portableResearchActionCoordinator} from '@shared/portableResearchActionCoordinator';
import {completeJson,researchStepTimeoutMs} from './aiClient';
import {researchActivityStep} from './researchActivity';
export const {deepenResearch}=portableResearchActionCoordinator({completeJson:(...args)=>completeJson(...args),researchStepTimeoutMs,researchActivityStep});
