import {serializeChatVisualPart,splitChatVisuals,skillHasCapability,type ChatImageAspectRatio} from '../../shared/chatSkills';
import type {ImageProvider,ModelRef} from '../../shared/types';
import {portableChatSvgQuality,type PortableChatSvgQualityHost} from '../../shared/portableChatSvgQuality';
import {portableImageRequest} from '../../shared/portableImageRequest';
import {portableResourceExecution} from '../../shared/portableResourceExecution';
import type {PortableDocumentVisualExecution} from '../../shared/portableDocumentVisuals';

export interface DocumentResourceAsset {
 source:string;attachmentId:string;sha256:string;byteCount:number;base64:string;mimeType:string;owner:string;
}
export interface AutonomousDocumentResourceHost {
 generationId:string;owner:string;version:number;
 imageProvider:ImageProvider|null;imageModel:string|null;
 completeText:PortableChatSvgQualityHost['completeText'];
 resolveModelRef(model?:ModelRef|null):ModelRef;
 evaluate<T>(script:string):Promise<T>;
 generateImage(prompt:string,aspectRatio:ChatImageAspectRatio|undefined,signal?:AbortSignal):Promise<{base64:string;mimeType:string}>;
 storeAsset(input:{generationId:string;owner:string;base64:string;mimeType:string;name:string;kind:'image'|'file';metadata:Record<string,string>}):Promise<Omit<DocumentResourceAsset,'base64'|'mimeType'|'owner'>>;
 existingAssets?:DocumentResourceAsset[];
}
/** Only the two portable built-ins execute here. All effects use the caller's
 * durable provider/asset host, never a Desktop proxy or an implicit provider. */
export function autonomousDocumentResources(host:AutonomousDocumentResourceHost) {
 if (!host.generationId || !/^[a-f0-9]{64}$/.test(host.owner)) throw new Error('A saved generation and its canonical asset owner are required.');
 const stored=new Map<string,DocumentResourceAsset>();
 const bytes=(base64:string)=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
 const digest=async(base64:string)=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes(base64))),v=>v.toString(16).padStart(2,'0')).join('');
 const remember=(asset:DocumentResourceAsset)=>{
  if(asset.owner!==host.owner || !/^[a-f0-9-]{36}$/.test(asset.attachmentId) || !/^[a-f0-9]{64}$/.test(asset.sha256)
   || !['image/png','image/jpeg','image/webp'].includes(asset.mimeType)
   || asset.byteCount!==bytes(asset.base64).length
   || ![`nodus-image://chat/${host.owner}/${asset.attachmentId}`,`nodus-capability://chat/${host.owner}/${asset.attachmentId}`].includes(asset.source)) throw new Error('The asset receipt does not belong to this generation.');
  stored.set(asset.source,asset);
 };
 for(const asset of host.existingAssets??[]) remember(asset);
 async function save(base64:string,mimeType:string,name:string,kind:'image'|'file',metadata:Record<string,string>) {
  const receipt=await host.storeAsset({generationId:host.generationId,owner:host.owner,base64,mimeType,name,kind,metadata});
  const asset={...receipt,base64,mimeType,owner:host.owner};
  if(await digest(base64)!==asset.sha256)throw new Error('The stored asset does not match its receipt.');remember(asset);
  return asset.source;
 }
 async function executeResources<Provider extends {id:string},Pins>(answer:string,execution:PortableDocumentVisualExecution<Provider,Pins>,signal?:AbortSignal) {
  if(execution.owner!==host.owner || execution.version!==host.version) throw new Error('The resource generation owner or version changed.');
  const current=()=>{signal?.throwIfAborted();if(!execution.isCurrent())throw new DOMException('The generation changed.','AbortError');};
  const flush=async()=>{await execution.flushPersist();current();};
  // Capability envelopes and tool requests are not portable built-ins. Fail before
  // any paid work; never interpret model-authored results as generated assets.
  if(/```nodus-tool\b/.test(answer) || splitChatVisuals(answer).some(p=>p.kind.startsWith('capability-'))) throw new Error('This resource requires Desktop. Select SVG Studio or Image Atelier for autonomous generation.');
  if(execution.skills.some(s=>!skillHasCapability(s,'nodus:svg')&&!skillHasCapability(s,'nodus:image'))) throw new Error('A selected resource requires Desktop.');
  const quality=portableChatSvgQuality({resolveModelRef:host.resolveModelRef,evaluateInSvgSandbox:host.evaluate,
   completeText:async(opts,model)=>{await flush();return host.completeText(opts,model);}});
  const image=portableImageRequest({getSettings:()=>({imageProvider:host.imageProvider,imageModel:host.imageModel}),chatAssetVersion:()=>host.version,
   callImageProvider:async(_provider,_model,prompt,imageSignal,aspect)=>{await flush();return host.generateImage(prompt,aspect,imageSignal);},
   prepareGeneratedImage:(result:{base64:string;mimeType:string})=>({image:result.base64,mimeType:result.mimeType}),
   storeChatImage:async(owner,input,metadata)=>{if(owner!==host.owner)throw new Error('Asset owner changed.');return save(input.bytes,input.mimeType,'figure', 'image',metadata);}});
  const collector=portableResourceExecution({
   evaluateInSvgSandbox:host.evaluate,parseArtifactReference:()=>null,readCapabilityArtifact:()=>null,
   getChatImage:(id:string)=>{const asset=stored.get(`nodus-image://chat/${id}`);return asset?{blob:bytes(asset.base64),mime:asset.mimeType}:null;},
   storeCapabilityFile:async(owner:string,input:{bytes:Uint8Array;mimeType:string;name:string})=>{
    if(owner!==host.owner)throw new Error('Asset owner changed.');
    const original=Array.from(stored.values()).find(a=>a.mimeType===input.mimeType&&a.byteCount===input.bytes.length&&a.base64===btoa(Array.from(input.bytes,c=>String.fromCharCode(c)).join('')));
    if(!original)throw new Error('No durable image receipt exists.');
    return save(original.base64,input.mimeType,input.name,'file',{});
   },
   executeRegisteredChatSkills:async(text,run,runSignal)=>{
    current();
    const refined=await quality.refineChatSvg(text,{question:run.question??'',skills:run.skills,model:run.model,signal:runSignal,beforeRepair:run.beforeRepair,maxRepairs:run.maxSvgRepairs});
    let imageRequested=false;const result:string[]=[];
    for(const part of splitChatVisuals(refined)) {
     if(part.kind==='image-request') {
      if(imageRequested)result.push('\n\n```nodus-image-error\n{"message":"Only one image can be generated per reply. Send another message to create a variation."}\n```\n\n');
      else {imageRequested=true;result.push(await image.executeImageRequest(part.content,part.complete,run,runSignal));}
     } else result.push(serializeChatVisualPart(part));
    }
    current();return result.join('');
   },
  });
  for(const asset of stored.values())if(await digest(asset.base64)!==asset.sha256)throw new Error('A saved asset does not match its receipt.');
  current();return collector.executeSkillResources(answer,execution,signal);
 }
 return {executeResources,assets:()=>Object.fromEntries(Array.from(stored.values(),a=>[a.attachmentId,{base64:a.base64,mimeType:a.mimeType}]))};
}
