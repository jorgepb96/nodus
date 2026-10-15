import type {DocumentSkillPolicy,DocumentVisualManifest} from '@shared/documentSkills';
import type {WritingWorkshopDraft} from '@shared/types';
import {canonicalJson} from '@shared/canonicalJson';
import {researchVisualFields} from '@shared/documentVisualContent';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
type Call=(method:string,...args:any[])=>Promise<any>;
const hash=(text:string)=>bytesToHex(sha256(new TextEncoder().encode(text)));
export function liveVisualIssue(error:unknown){const text=String(error);for(const [code,message] of Object.entries({live_visual_source_conflict:'El informe o sus figuras cambiaron en el Mac. Actualiza la fuente antes de continuar; el trabajo conservado no se volverá a generar automáticamente.',live_visual_target_busy:'El Mac ya está preparando recursos para este informe. Esta sesión no cancelará otra tarea.',live_visual_paid_response_uncertain:'La petición se interrumpió sin una respuesta confirmada. No se volverá a ejecutar automáticamente.',live_visual_request_interrupted:'La petición está interrumpida. Consulta su estado antes de continuar.',live_visual_resource_scope_conflict:'El recurso conservado pertenece a una versión anterior de las figuras. Revisa el trabajo antes de continuar.'}))if(text.includes(code))return message;return text;}
/** Mac-only controls. Loading never resumes a job or calls a phone provider. */
export class LiveDocumentVisuals {
 readonly target:{kind:'deep-research';id:string};
 draft:WritingWorkshopDraft|null=null;manifest:DocumentVisualManifest|null=null;
 jobs:any[]=[];active?:{method:string;input:any};error='';
 constructor(private call:Call,id:string,private changed:()=>void){this.target={kind:'deep-research',id};}
 expected(){if(!this.draft)throw new Error('Informe no disponible en el Mac. Sincroniza el informe o elige explícitamente el modo autónomo.');return {contentHash:hash(JSON.stringify(researchVisualFields(this.draft))),revision:this.manifest?.revision??null,manifestHash:hash(canonicalJson(this.manifest))};}
 async load(){const saved=await this.call('getWritingWorkshopDraft',this.target.id);if(!saved?.draft)throw new Error('Este informe aún no está disponible en el Mac. Sincronízalo o elige explícitamente el modo autónomo.');this.draft=saved.draft;this.manifest=await this.call('getDocumentVisuals',this.target);this.jobs=await this.call('mobileLiveVisualJobs',this.target.id);this.changed();}
 async run(method:string,extra:Record<string,unknown>={}){const prior=this.jobs.find(job=>job.method===method&&['failed','interrupted','cancelled'].includes(job.state));const input={version:1,requestId:crypto.randomUUID(),target:this.target,expected:this.expected(),...extra,...(extra.retry&&prior?{continueRequestId:prior.id}:{})};return this.submit(method,input);}
 async submit(method:string,input:any){this.active={method,input};this.error='';this.changed();try{const ack=await this.call(method,input);this.manifest=ack.manifest;return ack.manifest;}catch(error){this.error=liveVisualIssue(error);throw error;}finally{this.active=undefined;await this.load().catch(()=>{});this.changed();}}
 enrich(policy:DocumentSkillPolicy,options:any){return this.run('enrichDocumentVisuals',{policy,retry:options?.retry===true,model:options?.model});}
 undo(){return this.run('undoDocumentVisuals');}
 remove(figureId:string){return this.run('removeDocumentFigure',{figureId});}
 get cancellableJob(){return this.jobs.find(job=>job.method==='enrichDocumentVisuals'&&['pending','accepted','running'].includes(job.state));}
 async cancel(){const active=this.active??(this.cancellableJob?{method:this.cancellableJob.method,input:this.cancellableJob.args[0]}:undefined);if(!active)throw new Error('Esta sesión no tiene una petición propia que se pueda cancelar.');await this.call('cancelLiveJob',active.input.requestId,active.method,[active.input]);}
 async recover(job:any){return this.submit(job.method,job.args[0]);}
 async bytes(source:string){const match=/^nodus-(?:image|capability):\/\/chat\/([a-f0-9]{64})\/([a-f0-9-]{36})$/.exec(source);if(!match)throw new Error('Referencia de figura inválida.');let offset=0,total=1,mime='',expectedSha='',bytes:Uint8Array|undefined;while(offset<total){const part=await this.call('readMobileDeepResearchVisualAsset',{reportId:this.target.id,expected:this.expected(),owner:match[1],assetId:match[2],offset,count:524288});if(!Number.isSafeInteger(part.byteCount)||part.byteCount<1||part.byteCount>8388608||part.offset!==offset)throw new Error('Respuesta de imagen inválida.');if(!bytes){total=part.byteCount;bytes=new Uint8Array(total);mime=part.mimeType;expectedSha=part.sha256;}if(part.byteCount!==total||part.sha256!==expectedSha||part.mimeType!==mime)throw new Error('La figura cambió durante la consulta.');const chunk=Uint8Array.from(atob(part.base64),c=>c.charCodeAt(0));if(!chunk.length||offset+chunk.length>total)throw new Error('Fragmento de imagen inválido.');bytes.set(chunk,offset);offset+=chunk.length;}if(!bytes||bytesToHex(sha256(bytes))!==expectedSha)throw new Error('La figura no coincide con su huella.');return {bytes,mimeType:mime};}
 async media(source:string){const {bytes,mimeType}=await this.bytes(source);return URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:mimeType}));}
 export(input:Record<string,unknown>){return this.call('mobileLiveVisualExport',{reportId:this.target.id,expected:this.expected(),...input});}
 open(source:string){return this.call('mobileDocumentVisualOpenSource',source);}
}
