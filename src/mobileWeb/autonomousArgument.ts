import type {ArgumentMap,ArgumentMapRequest,ModelRef} from '@shared/types';
import {finishArgumentGeneration,type ArgumentGenerationSource} from '@shared/argumentGeneration';
import {structuredPrompt} from './structuredPrompt';
import {preservePendingPublication} from './publicationRecovery';
import {resumeAcademicGeneration} from './academicRecovery';

type Call=(method:string,...args:unknown[])=>Promise<any>;
type Request={kind:'argument';seedIdeaId:string;language:ArgumentMapRequest['language']};
type Checkpoint={id:string;entityKey:string;request:{source:Request;model:ModelRef};context?:{source:{version:1;request:Request;revision:string;source:ArgumentGenerationSource};revision:string};raw?:string;generatedAt?:string;preview?:ArgumentMap;result?:ArgumentMap;state:string;error?:string;publicationPending?:boolean};
const running=new Map<string,Promise<ArgumentMap>>();
const controls=new Map<string,{seedIdeaId:string;checkpoint?:Checkpoint;cancelled:boolean}>();
export async function cancelAutonomousArgument(call:Call,seedIdeaId:string):Promise<boolean>{
  let found=false;
  for(const control of controls.values())if(control.seedIdeaId===seedIdeaId){
    found=true;
    control.cancelled=true;
    if(control.checkpoint){
      await call('cancelAutonomousGeneration',control.checkpoint.id);
      const checkpoint=control.checkpoint;
      if(checkpoint.preview&&checkpoint.context&&checkpoint.raw&&checkpoint.state!=='available')await call('cancelLiveJob',checkpoint.id,'saveMobileAcademicResult',[
        {request:checkpoint.request.source,revision:checkpoint.context.revision,raw:checkpoint.raw,model:checkpoint.request.model,requestId:checkpoint.id,generatedAt:checkpoint.generatedAt}
      ]);
    }
  }
  return found;
}
export async function autonomousArgument(call:Call,input:ArgumentMapRequest):Promise<ArgumentMap>{
  const settings=await call('getSettings'),model=input.model??settings.argumentMapModel;
  if(!model)throw new Error('Elige un modelo de mapas de argumentos en los ajustes del móvil.');
  const source:Request={kind:'argument',seedIdeaId:input.seedIdeaId,language:input.language??settings.promptLanguage??'es'},request={source,model};
  const entityKey=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(request)))),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(running.has(entityKey))return running.get(entityKey)!;
  const control={seedIdeaId:input.seedIdeaId,cancelled:false,checkpoint:undefined as Checkpoint|undefined};controls.set(entityKey,control);
  const check=()=>{if(control.cancelled)throw new DOMException('Generación cancelada','AbortError');};
  const execute=async()=>{
    const previous=await call('mobileGenerationCheckpoint','load','academic',entityKey) as Checkpoint|null;
    const checkpoint:Checkpoint=resumeAcademicGeneration(previous,request)?previous!:{id:crypto.randomUUID(),entityKey,request,state:'accepted'};
    control.checkpoint=checkpoint;
    const save=()=>call('mobileGenerationCheckpoint','save','academic',entityKey,checkpoint);
    try{
      check();await save();check();
      if(!checkpoint.context){const source=await call('mobileAcademicSource',checkpoint.request.source);checkpoint.context={source,revision:source.revision};await save();}
      const captured=checkpoint.context.source;
      check();
      if(!checkpoint.raw){
        checkpoint.state='running';delete checkpoint.error;await save();
        checkpoint.raw=captured.source.noMaterial?'{}':String(await call('mobileStructuredCompletion',{...structuredPrompt(captured.source.prompt,checkpoint.request.model,'standard'),format:'json',generationId:checkpoint.id}));
        checkpoint.generatedAt=new Date().toISOString();await save();
      }
      check();
      const text=checkpoint.raw.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');
      checkpoint.preview=finishArgumentGeneration(captured.source,JSON.parse(text),checkpoint.generatedAt,checkpoint.id);
      checkpoint.state='saved';await save();check();
      checkpoint.result=await call('saveMobileAcademicResult',{request:checkpoint.request.source,revision:captured.revision,raw:checkpoint.raw,model:checkpoint.request.model,requestId:checkpoint.id,generatedAt:checkpoint.generatedAt});
      checkpoint.state='available';delete checkpoint.error;delete checkpoint.publicationPending;await save();return checkpoint.result!;
    }catch(error){
      if(checkpoint.preview&&preservePendingPublication(checkpoint,error)){
        await save();return checkpoint.preview;
      }
      checkpoint.state=String(error).toLowerCase().includes('cancel')?'cancelled':'failed';checkpoint.error=String(error);await save();throw error;
    }
  };
  const promise=execute();running.set(entityKey,promise);try{return await promise;}finally{running.delete(entityKey);controls.delete(entityKey);}
}
