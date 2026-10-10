import {translateMarkdownWith} from '@shared/translationGeneration';
import type {ContentTranslationSummary, GenerateTranslationRequest} from '@shared/types';
import type {MobileTranslationContext} from '@shared/mobileTranslation';
import {structuredPrompt} from './structuredPrompt';

type Call = (method:string,...args:unknown[])=>Promise<any>;
type Checkpoint = {id:string;entityKey:string;request:GenerateTranslationRequest;state:'accepted'|'running'|'saved'|'available'|'failed';context?:MobileTranslationContext;markdown?:string;result?:ContentTranslationSummary;error?:string;done?:number;total?:number};
const active = new Map<string,Promise<ContentTranslationSummary>>();
export async function autonomousTranslation(call:Call,request:GenerateTranslationRequest,notify:()=>void):Promise<ContentTranslationSummary> {
  const settings = await call('getSettings');
  // The reader passes the model that originally wrote the report. Autonomous
  // translations use the phone's configured translation model instead.
  request = {...request,model:settings.translationModel ?? settings.deepResearchModel ?? settings.chatModel ?? null};
  if (!request.model) throw new Error('Elige un modelo y configura su proveedor en los ajustes del móvil.');
  const entity = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(request)))),x=>x.toString(16).padStart(2,'0')).join('');
  if (active.has(entity)) return active.get(entity)!;
  const run = execute(call,entity,request,notify).finally(()=>active.delete(entity)); active.set(entity,run); return run;
}
async function execute(call:Call,entityKey:string,request:GenerateTranslationRequest,notify:()=>void) {
  const previous = await call('mobileGenerationCheckpoint','load','translation',entityKey) as Checkpoint|null;
  // A completed translation can be regenerated intentionally; an interrupted
  // request resumes the same chunks and idempotent save instead.
  const checkpoint:Checkpoint = previous && previous.state !== 'available' ? previous : {id:crypto.randomUUID(),entityKey,request,state:'accepted'};
  request = checkpoint.request;
  const save = ()=>call('mobileGenerationCheckpoint','save','translation',entityKey,checkpoint);
  await save();
  try {
    checkpoint.context ??= await call('getContentTranslationGenerationContext',request);
    await call('beginContentTranslationOnMobile',request); notify();
    checkpoint.state='running'; await save();
    if (!checkpoint.markdown) {
      checkpoint.markdown = await translateMarkdownWith({markdown:request.sourceMarkdown,language:checkpoint.context!.language,model:request.model,
        onProgress:(done,total)=>{checkpoint.done=done;checkpoint.total=total;}
      },async prompt=>{
        const answer = await call('mobileStructuredCompletion',{...structuredPrompt(prompt,request.model!,'off'),format:'text',generationId:checkpoint.id});
        await save(); return String(answer);
      });
      checkpoint.state='saved'; await save();
    }
    checkpoint.result = await call('saveContentTranslationFromMobile',{request,revision:checkpoint.context!.revision,markdown:checkpoint.markdown,requestId:checkpoint.id});
    checkpoint.state='available'; await save(); notify(); return checkpoint.result!;
  } catch(error) {
    checkpoint.state='failed';checkpoint.error=String(error);await save();
    try {await call('failContentTranslationOnMobile',request,String(error));} catch { /* Preserve the local result when the Mac is offline. */ }
    notify();throw error;
  }
}
