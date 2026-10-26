import type {DeepResearchRequest,ModelRef} from './types';
import {MAX_COVERAGE_QUESTIONS} from '../electron/ai/deepResearchCore';
/** Exact v2 Study/Teaching/Genealogy preflight shared by Desktop and device. */
export async function prepareDeepResearchVariantRequest(request:DeepResearchRequest,model:ModelRef|null,decompose:(objective:string,language:string|undefined,model:ModelRef|null)=>Promise<string[]>,signal?:AbortSignal):Promise<DeepResearchRequest> {
 signal?.throwIfAborted();
 if(request.coverageQuestions?.length)return {...request,coverageQuestions:request.coverageQuestions.slice(0,MAX_COVERAGE_QUESTIONS)};
 const coverageQuestions=await decompose(request.objective,request.language,model);
 signal?.throwIfAborted();return {...request,coverageQuestions};
}
