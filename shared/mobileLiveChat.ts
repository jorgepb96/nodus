import type {MobileChatEdit,MobileChatKind,MobileChatDocument} from './mobileChatHistory';
import type {ModelRef,ResearchContextSelection,ResearchWebSearchMode} from './types';
import type {ResearchEffort} from './researchReasoning';
import type {ConciliumConfig} from './researchConcilium';

/** A frozen native question is acknowledged before a Mac provider starts.
 * Results are stored under the same conversation and reply identity. */
export interface MobileLiveChatRequest {
  version:1;requestId:string;kind:MobileChatKind;answerId:string;
  edit:MobileChatEdit;
  generation:{model?:ModelRef|null;systemPromptId?:string|null;thinkingEffort?:ResearchEffort;
    attachmentIds?:string[];selection?:ResearchContextSelection;webSearch?:ResearchWebSearchMode;skillIds?:string[];concilium?:ConciliumConfig};
}
export interface MobileLiveChatResult {version:1;requestId:string;kind:MobileChatKind;document:MobileChatDocument;interrupted:boolean}
