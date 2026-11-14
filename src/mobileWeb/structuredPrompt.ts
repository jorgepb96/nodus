import type {ModelRef} from '@shared/types';
import {researchReasoningBody,researchReasoningProfile,researchOmitsTemperature,type ResearchEffort} from '@shared/researchReasoning';
import {thinkingOutputAllowance} from '@shared/researchOutputBudget';

/** Exactly the Desktop job policy; Swift supplies the device-owned credential. */
export function structuredPrompt(prompt:{system:string;user:string;temperature:number;maxTokens:number},model:ModelRef,effort:ResearchEffort='standard') {
  const allowance=thinkingOutputAllowance(model,effort);
  return {...prompt,model,thinkingAllowance:allowance,researchParameters:researchReasoningBody(model,effort,prompt.maxTokens+allowance),temperature:researchOmitsTemperature(model,effort)?null:prompt.temperature};
}
export function mobileModelInformation(provider:ModelRef['provider'],items:Array<{id:string;[key:string]:unknown}>) {
  return items.map(info=>({...info,researchReasoningLevels:researchReasoningProfile({provider,model:info.id}).levels}));
}
