import {recordEmbeddingTrace} from '../qa/embeddingTrace';
import {portableResearchClaimAudit} from '@shared/portableResearchClaimAudit';
import {AiError,completeJson,type CallOpts} from './aiClient';
import type {ModelRef} from '@shared/types';
import {currentJobThinkingEffort} from './thinkingEffort';
/** Provider credentials stay in the host; the complete audit algorithm is shared. */
export const {createResearchProseAuditor,auditResearchProse,findResearchConflicts} = portableResearchClaimAudit({
 recordEmbeddingTrace:event=>recordEmbeddingTrace(event),
 completeJson:<T>(opts:CallOpts,guard:(value:unknown)=>value is T,model?:ModelRef|null)=>completeJson<T>(opts,guard,model),
 currentJobThinkingEffort:model=>currentJobThinkingEffort(model),
 isOutputTruncated:error=>error instanceof AiError&&error.code==='output_truncated',
});
