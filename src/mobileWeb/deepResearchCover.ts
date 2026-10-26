import {decorativeImageContextCall,cleanDecorativeImageContext} from '@shared/decorativeImageContext';
import {buildDecorativeImagePrompt} from '@shared/imageStyles';
import {vaultTypeImagePrompt} from '@shared/vaultTypes';
import {durableDeepResearchCall,type MobileDeepResearchCheckpoint,type MobileDeepResearchCover} from '@shared/mobileDeepResearch';
import {sha256Snapshot} from '@shared/databaseResearchEngine';
import {structuredPrompt} from './structuredPrompt';
type Call=(method:string,...args:any[])=>Promise<any>;
export async function mobileDeepResearchCover(call:Call,checkpoint:MobileDeepResearchCheckpoint,persist:()=>Promise<void>,signal:AbortSignal):Promise<MobileDeepResearchCover> {
 if(!checkpoint.imageModel||!checkpoint.report||!checkpoint.request.decorativeImage?.enabled)throw new Error('mobile_image_configuration_missing');
 const paid=async(input:unknown)=>{signal.throwIfAborted();return durableDeepResearchCall(checkpoint,`local:cover:${sha256Snapshot(input)}`,input,()=>call('mobileStructuredCompletion',input),persist,{paid:true,request:input,recover:async()=>{const value=await call('mobileSavedStructuredCompletion',checkpoint.inflight?.request??input);return value===null?undefined:value;}});};
 const {request,report}=checkpoint;
 const source={title:report.draft.title,content:[report.draft.brief.objective,report.draft.abstract,report.draft.draftMarkdown].filter(Boolean).join('\n').slice(0,2400)};
 const prompt=decorativeImageContextCall(source,request.language??'es');
 const raw=await paid({...structuredPrompt(prompt,request.model!,'standard'),format:'text',generationId:checkpoint.id,completionKey:'cover:context'});
 if(typeof raw!=='string')throw new Error('invalid_mobile_cover_context');
 const context=cleanDecorativeImageContext(raw);
 const imagePrompt=buildDecorativeImagePrompt(request.decorativeImage!.style,context,vaultTypeImagePrompt(checkpoint.context!.vaultType));
 const encoded=await paid({model:checkpoint.imageModel,system:'',user:imagePrompt,maxTokens:1,format:'image',generationId:checkpoint.id,completionKey:'cover:image'});
 const image=typeof encoded==='string'?JSON.parse(encoded):encoded;
 if(!image||typeof image.bytes!=='string'||!image.bytes||image.bytes.length>7_000_000||image.mime!=='image/jpeg')throw new Error('invalid_mobile_cover_response');
 signal.throwIfAborted();return {model:checkpoint.imageModel,style:request.decorativeImage!.style,context,prompt:imagePrompt,...image};
}
