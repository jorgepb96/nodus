import type {StudyImproveRequest, StudyImproveResult} from '@shared/studyImprove';
import type {MobileStudyImprovementContext} from '@shared/mobileStudyImprovement';
import type {ModelRef} from '@shared/types';
import {prepareStudyImprovement, finishStudyImprovement} from '@shared/studyImprovementGeneration';
import {structuredPrompt} from './structuredPrompt';

type Call = (method:string,...args:unknown[])=>Promise<any>;
type Checkpoint = {id:string;entityKey:string;request:StudyImproveRequest;context?:MobileStudyImprovementContext;raw?:string;
  result?:StudyImproveResult;state:'accepted'|'running'|'saved'|'available'|'failed'|'cancelled';error?:string};
type Running = {promise?:Promise<StudyImproveResult>;checkpoint?:Checkpoint;cancelled:boolean};
const active = new Map<string,Running>();

export async function cancelAutonomousWriting(call:Call):Promise<void> {
  for (const running of active.values()) {
    running.cancelled=true;
    if (running.checkpoint) await call('cancelAutonomousGeneration',running.checkpoint.id);
  }
}
export async function autonomousWriting(call:Call,request:StudyImproveRequest,onDelta:(text:string)=>void):Promise<StudyImproveResult> {
  const settings = await call('getSettings');
  request={...request,model:settings.improveModel ?? settings.writingModel ?? settings.studyModel ?? null};
  if (!request.model) throw new Error('Elige un modelo de escritura y configura su proveedor en los ajustes del móvil.');
  const entityKey=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(request)))),x=>x.toString(16).padStart(2,'0')).join('');
  if (active.has(entityKey)) return active.get(entityKey)!.promise!;
  const running:Running={cancelled:false};
  active.set(entityKey,running);
  const execute=async()=>{
    const previous=await call('mobileGenerationCheckpoint','load','writing',entityKey) as Checkpoint|null;
    const checkpoint:Checkpoint=previous && !['available','cancelled'].includes(previous.state) ? previous : {id:crypto.randomUUID(),entityKey,request,state:'accepted'};
    running.checkpoint=checkpoint;request=checkpoint.request;
    const save=()=>call('mobileGenerationCheckpoint','save','writing',entityKey,checkpoint);
    const check=()=>{if(running.cancelled)throw new Error('Generación cancelada. El original no se ha modificado.');};
    try {
      check();await save();
      checkpoint.context ??= await call('getStudyImprovementGenerationContext',request);
      check();checkpoint.state='running';await save();
      const context=checkpoint.context!;
      if (!checkpoint.raw) {
        const prepared=prepareStudyImprovement(request,context.style,context.promptLanguage);
        const prompt={...prepared.prompt,temperature:request.mode === 'free' ? Math.max(context.style.temperature,context.style.creativity) : Math.min(context.style.temperature,0.45),maxTokens:context.maxOutputTokens};
        checkpoint.raw=String(await call('mobileStructuredCompletion',{...structuredPrompt(prompt,request.model! as ModelRef,'off'),format:'text',generationId:checkpoint.id}));
        check();checkpoint.state='saved';await save();
      }
      check();
      // The same preservation check runs here and again on the Mac before the
      // preview is recorded. A complete protected result is emitted once.
      const preview=finishStudyImprovement(request,context.style,checkpoint.raw,context.promptLanguage,context.uiLanguage);
      checkpoint.result=await call('saveStudyImprovementFromMobile',{request,revision:context.revision,raw:checkpoint.raw,requestId:checkpoint.id});
      check();checkpoint.state='available';await save();onDelta(preview.text);return checkpoint.result!;
    } catch(error) {
      checkpoint.state=running.cancelled?'cancelled':'failed';checkpoint.error=String(error);await save();throw error;
    }
  };
  running.promise=execute().finally(()=>active.delete(entityKey));return running.promise;
}
