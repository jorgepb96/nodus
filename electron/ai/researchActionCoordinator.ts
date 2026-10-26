import {researchDecisionContext} from './researchDecisionContext';
import {portableResearchActionCoordinator} from '@shared/portableResearchActionCoordinator';
import {AiError,completeJson,researchStepTimeoutMs,researchModelContextWindow} from './aiClient';
import {researchActivityStep} from './researchActivity';
export const {deepenResearch}=portableResearchActionCoordinator({researchDecisionContext,researchModelContextWindow,isSchemaError:error=>error instanceof AiError&&['schema_mismatch','invalid_json','output_truncated'].includes(error.code??''),completeJson:(...args)=>completeJson(...args),researchStepTimeoutMs,researchActivityStep});
