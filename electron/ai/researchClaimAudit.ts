import {portableResearchClaimAudit} from '@shared/portableResearchClaimAudit';
import {AiError,completeJson} from './aiClient';
import {currentJobThinkingEffort} from './thinkingEffort';
/** Provider credentials stay in the host; the complete audit algorithm is shared. */
export const {createResearchProseAuditor,auditResearchProse,findResearchConflicts} = portableResearchClaimAudit({
 completeJson,currentJobThinkingEffort,isOutputTruncated:error=>error instanceof AiError&&error.code==='output_truncated',
});
