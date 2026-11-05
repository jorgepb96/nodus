import '../index.css';
import './chatRead.css';
import {Component,useEffect,useState,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {Markdown} from '../components/Markdown';
import {CapabilityView} from '../components/CapabilityView';
import {ChatCapabilityResult} from '../components/ChatCapabilityResult';
import {ChartFromSpec} from '../components/DatabaseChart';
import {ChatVisual} from '../components/ChatVisual';
import {parseChatSegments} from '@shared/chartSpec';
import {splitChatVisuals,type ChatVisualPart} from '@shared/chatSkills';
import {sanitizeChatSvg} from '@shared/chatSvg';
import {validateViewDocument} from '../../packages/capability-api/src/views';
import {validateMediaAsset} from '../../packages/capability-api/src/media';
import {validateModelAsset} from '../../packages/capability-api/src/models';
import {buildTestimonyLink} from '@shared/testimonyDeepLinks';
import {setActiveLang} from '../i18n';
import type {AppSettings} from '@shared/types';

interface Input {content:string;language:AppSettings['uiLanguage'];dark:boolean;accent:string;textScale:number;owner:string;legacyFences:string[];desktopRecord?:{attachments?:Array<{id:string;name:string;size:number;warning?:string}>;skills?:Array<{name:string}>;concilium?:{status:string;chairman:number;members:Array<{model:{model:string;label?:string};status:string;answer:string;reasoning?:string;error?:string}>}}}
const native=window as unknown as {webkit:{messageHandlers:{chatRead:{postMessage(value:unknown):void}}};nodusChatReadReply(id:string,result:unknown,error:string|null):void;nodusChatReadRender(input:Input):void;nodusChatReadDownload():Promise<{sources:string[]}>};
let sequence=0;
const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
function call(method:string,...args:unknown[]):Promise<any> {
  return new Promise((resolve,reject)=>{if(pending.size>=256){reject(new Error('Hay demasiados recursos cargándose. Reintenta la lectura.'));return;}const id=String(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(new Error('El recurso no ha respondido. Reintenta la lectura.'));},90000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});native.webkit.messageHandlers.chatRead.postMessage({id,method,args});});
}
native.nodusChatReadReply=(id,result,error)=>{const item=pending.get(id);if(!item)return;pending.delete(id);if(error)item.reject(new Error(error));else item.resolve(result);};
function bytes(value:{data:string;mimeType:string}) {const raw=atob(value.data);return {...value,bytes:Uint8Array.from(raw,character=>character.charCodeAt(0))};}
let inputOwner='';
let documentContent='',documentLegacyFences:string[]=[],originalRecord:Input['desktopRecord'];
const downloadSources=new Set<string>();
function registerView(value:unknown,owner:string|undefined) {
  const view=validateViewDocument(value);
  if(owner&&owner!==inputOwner)throw new Error('El resultado pertenece a otra conversación.');
  function walk(value:unknown):void {
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach(walk);return;}
    const fields=value as Record<string,unknown>;
    if(typeof fields.attachmentId==='string'&&owner)downloadSources.add(`nodus-capability://chat/${owner}/${fields.attachmentId}`);
    Object.values(fields).forEach(walk);
  }
  walk(view);return view;
}
const allowed=new Set(['readCapabilityMedia','readCapabilityModel','fetchCapabilityTile','downloadCapabilityFile','openExternal','getChatImageMetadata','copyChatImage','downloadOriginalImage','copyText']);
// The read surface has no generic operation dispatcher. Imported Desktop
// components can request only existing bytes or explicit native presentation.
window.nodus=new Proxy({}, {get:(_,method:string)=>{
  if(!allowed.has(method))return ()=>Promise.reject(new Error('Esta acción no está disponible en la vista de lectura.'));
  return async(...args:unknown[])=>{const result=await call(method,...args);if(!['readCapabilityMedia','readCapabilityModel','fetchCapabilityTile'].includes(method))return result;const asset=bytes(result);return method==='fetchCapabilityTile'?asset:{...asset,info:method==='readCapabilityModel'?validateModelAsset(asset.bytes,asset.mimeType):validateMediaAsset(asset.bytes,asset.mimeType)};};
}}) as typeof window.nodus;
const open=(source:string)=>void call('openCitation',source).catch(error=>void call('readError',String(error.message)));
async function encoded(blob:Blob) {
  if(blob.size>8*1024*1024)throw new Error('La imagen supera el tamaño disponible para compartir.');
  const data=new Uint8Array(await blob.arrayBuffer());let value='';for(let index=0;index<data.length;index+=8192)value+=String.fromCharCode(...data.subarray(index,index+8192));return btoa(value);
}
// Desktop copy controls use the browser clipboard. This isolated document routes
// them to the native clipboard and retains no browser permissions or paste data.
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:(text:string)=>call('copyText',text),write:async(items:ClipboardItem[])=>{
  const item=items[0];if(!item?.types.includes('image/png'))throw new Error('Formato de imagen no compatible para copiar.');const blob=await item.getType('image/png');await call('copyRenderedImage',await encoded(blob),'image/png');
}}});
if(typeof ClipboardItem==='undefined')Object.defineProperty(window,'ClipboardItem',{value:class {types:string[];constructor(private values:Record<string,Blob>){this.types=Object.keys(values);}async getType(type:string){return this.values[type];}}});
const generatedSVGs=new Map<string,Blob>(),createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=createURL(blob);if(blob instanceof Blob&&blob.type==='image/svg+xml'&&blob.size<=8*1024*1024){if(generatedSVGs.size>=8)generatedSVGs.delete(generatedSVGs.keys().next().value!);generatedSVGs.set(url,blob);}return url;};
URL.revokeObjectURL=url=>{generatedSVGs.delete(url);revokeURL(url);};
const internal=(host:string,kind:string,id:string,query?:Record<string,string|number|null|undefined>)=>{
  const url=new URL(`nodus://${host}/${kind?kind+'/':''}${encodeURIComponent(id)}`);
  for(const [key,value] of Object.entries(query??{}))if(value!=null)url.searchParams.set(key,String(value));return url.href;
};
function Prose({content}:{content:string}) {
  return <Markdown content={content} verify={false} allowDataImages chatVisuals
    onCitation={ref=>open(internal(ref.kind,'',ref.id))}
    onWorldEntry={(kind,id)=>open(internal('world',kind,id))}
    onStudyEvidence={id=>open(internal('study','evidence',id))}
    onStudyDocument={(id,location)=>open(internal('study','doc',id,{from:location?.from}))}
    onStudyMaterial={(id,location)=>open(internal('study','material',id,{page:location?.pageNumber,slide:location?.slideNumber}))}
    onStudyRecording={(id,time)=>open(internal('study','recording',id,{t:time}))}
    onReaderCitation={ref=>open(`nodus://reader/${encodeURIComponent(ref.documentId)}${ref.sectionId?`/section/${encodeURIComponent(ref.sectionId)}`:ref.page!=null?`/page/${ref.page}`:''}`)}
    onTestimonyLink={ref=>open(buildTestimonyLink(ref))}/>;
}
class ReadBoundary extends Component<{children:ReactNode},{issue:string|null}> {
  state={issue:null as string|null};
  static getDerivedStateFromError(error:Error){return {issue:error.message};}
  render(){return this.state.issue?<p role="alert" className="chat-read-issue">No se ha podido dibujar este resultado: {this.state.issue}</p>:this.props.children;}
}
function StoredArtifact({source}:{source:string}) {
  const [result,setResult]=useState<any>(),[issue,setIssue]=useState<string>(),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let current=true;setIssue(undefined);setResult(undefined);void call('readStoredArtifact',source).then(value=>{if(current)setResult(value);}).catch(error=>{if(current)setIssue(error.message);});return()=>{current=false;};},[source,attempt]);
  if(issue)return <div role="alert" className="chat-read-issue">{issue}<button onClick={()=>setAttempt(value=>value+1)}>Reintentar</button></div>;
  if(!result)return <p role="status">Cargando resultado guardado…</p>;
  if(!result.available)return <p role="alert">{result.sidecar?.summary??'Resultado guardado'} · {result.reason==='no-provider'?'Su lector debe estar disponible en Nodus Desktop.':result.reason==='unreadable'?'El archivo del resultado no se puede leer.':'El resultado ya no está disponible.'}</p>;
  const owner=/^nodus-artifact:\/\/chat\/([a-f0-9]{64})\//.exec(source)?.[1];
  return <CapabilityView view={registerView(result.view,owner)} owner={owner} capabilityId={result.sidecar.capabilityId} presentation="document"/>;
}
function LegacyResult({fence,payload}:{fence:string;payload:string}) {
  const [result,setResult]=useState<any>(),[issue,setIssue]=useState<string>();
  useEffect(()=>{let active=true;void call('readLegacyResult',fence,payload).then(result=>{if(active)setResult(result);}).catch(error=>{if(active)setIssue(error.message);});return()=>{active=false;};},[fence,payload]);
  if(issue)return <p role="alert">{issue}</p>;
  if(!result)return <p role="status">Cargando resultado guardado…</p>;
  if(!result.available)return <p role="alert">El lector de este resultado debe estar disponible en Nodus Desktop.</p>;
  return <CapabilityView view={registerView(result.view,inputOwner)} owner={inputOwner} capabilityId={result.capabilityId} presentation="document"/>;
}
function Part({part}:{part:ChatVisualPart}) {
  if(part.kind==='markdown')return <Prose content={part.content}/>;
  if(!part.complete)return <p role="note">Este bloque no llegó a completarse. El texto recibido se conserva en la conversación.</p>;
  if(part.kind==='svg') {const clean=sanitizeChatSvg(part.content);return clean?<ChatVisual svg={clean.svg} alt={clean.title??'Visual de la respuesta'} kindLabel="Visual"/>:<p role="alert">El visual no contiene un SVG compatible.</p>;}
  if(part.kind==='capability-view') {
    const value=JSON.parse(part.content);return <CapabilityView view={registerView(value.view,value.owner)} owner={value.owner} capabilityId={value.capabilityId} presentation="document"/>;
  }
  if(part.kind==='capability-artifact') {const value=JSON.parse(part.content);if(typeof value.source!=='string')throw new Error('Referencia de resultado no válida.');return <StoredArtifact source={value.source}/>;}
  if(part.kind==='capability-result')return <ChatCapabilityResult source={part.content}/>;
  if(part.kind==='capability-legacy')return <LegacyResult fence={part.fence!} payload={part.content}/>;
  if(part.kind==='image-error') {let message='La generación de la imagen falló.';try{message=JSON.parse(part.content).message??message;}catch{}return <p role="alert">{message}</p>;}
  return <p role="note">La conversación conserva esta solicitud; no contiene un resultado guardado para consultar.</p>;
}
function Sections({content,legacyFences}:{content:string;legacyFences:string[]}) {
  return <>{parseChatSegments(content).map((segment,index)=>segment.kind==='chart'?<ReadBoundary key={index}><ChartFromSpec spec={segment.spec}/></ReadBoundary>:splitChatVisuals(segment.text,new Set(),new Set(legacyFences)).map((part,partIndex,parts)=>{
    if(part.kind==='capability-artifact'&&parts.slice(partIndex+1).find(next=>next.kind!=='markdown'||next.content.trim())?.kind==='capability-view')return null;
    return <ReadBoundary key={`${index}:${partIndex}`}><Part part={part}/></ReadBoundary>;
  }))}</>;
}
function Answer({input}:{input:Input}) {
  const record=input.desktopRecord;
  return <main className="chat-read-document">
    <Sections content={input.content} legacyFences={input.legacyFences}/>
    {!!record?.attachments?.length&&<section aria-label="Adjuntos"><h3>Adjuntos originales</h3>{record.attachments.map(file=>{
      if(!/^[A-Za-z0-9_-]{1,100}$/.test(file.id))throw new Error('Identidad del adjunto no válida.');
      const source=`nodus-attachment://chat/${input.owner}/${file.id}`;downloadSources.add(source);
      return <p key={file.id}><button onClick={()=>void call('downloadCapabilityFile',source).catch(error=>void call('readError',error.message))}>{file.name} · {(file.size/1024).toFixed(1)} KB</button>{file.warning&&<span role="note">{file.warning}</span>}</p>;
    })}</section>}
    {!!record?.skills?.length&&<p className="chat-read-skills" aria-label="Skills usadas">{record.skills.map((skill,index)=><span key={index}>{skill.name}</span>)}</p>}
    {record?.concilium&&<section aria-label="Concilium"><h3>Concilium</h3>{record.concilium.members.map((member,index)=><details key={index}><summary>{member.model.label??member.model.model}{index===record.concilium?.chairman?' · Síntesis':''} · {member.status}</summary>{member.error&&<p role="alert">{member.error}</p>}{member.reasoning&&<details><summary>Razonamiento guardado</summary><Prose content={member.reasoning}/></details>}<Sections content={member.answer} legacyFences={input.legacyFences}/></details>)}</section>}
  </main>;
}
const root=createRoot(document.getElementById('root')!);
native.nodusChatReadRender=input=>{
  if(!input||typeof input.content!=='string'||new TextEncoder().encode(input.content).length>20*1024*1024)throw new Error('La respuesta supera el tamaño disponible para esta vista.');
  inputOwner=input.owner;documentContent=input.content;documentLegacyFences=input.legacyFences;originalRecord=input.desktopRecord;downloadSources.clear();
  setActiveLang(input.language);document.documentElement.classList.toggle('dark',input.dark);
  document.documentElement.dataset.theme=input.dark?'dark':'light';
  document.documentElement.style.setProperty('--chat-read-accent',/^#[a-f\d]{6}$/i.test(input.accent)?input.accent:'#6366f1');
  document.documentElement.style.setProperty('--chat-read-scale',String(Math.min(2.5,Math.max(0.8,input.textScale))));
  root.render(<ReadBoundary><Answer input={input}/></ReadBoundary>);
};
// Remote illustrations are loaded by the same bounded native reader as the
// report. The document itself cannot fetch URLs or inherit provider credentials.
const hydrated=new WeakSet<HTMLImageElement>();
new MutationObserver(()=>{
  for(const table of document.querySelectorAll<HTMLTableElement>('table')) {
    const headers=Array.from(table.tHead?.rows[0]?.cells??[]).map(cell=>cell.textContent??'');
    if(headers.length>3){table.dataset.mobileColumns=String(headers.length);for(const row of Array.from(table.tBodies).flatMap(body=>Array.from(body.rows)))Array.from(row.cells).forEach((cell,index)=>{cell.dataset.columnLabel=headers[index]??`Columna ${index+1}`;});}
  }
  for(const element of document.querySelectorAll<HTMLImageElement>('img')) {
    const source=element.getAttribute('src')??'';
    if(!/^https:\/\//i.test(source)||hydrated.has(element))continue;
    hydrated.add(element);downloadSources.add(source);element.removeAttribute('src');
    void call('readImage',source).then(result=>{const asset=bytes(result);const url=URL.createObjectURL(new Blob([asset.bytes],{type:asset.mimeType}));element.src=url;element.addEventListener('load',()=>URL.revokeObjectURL(url),{once:true});}).catch(error=>{element.alt=`${element.alt||'Imagen'} · ${error.message}`;void call('readError',error.message);});
  }
}).observe(document.getElementById('root')!,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
native.nodusChatReadDownload=async()=>{
  // Parse first, so assets in collapsed sections are included as well. A result
  // that cannot be rendered stops the download instead of advertising a partial copy.
  const texts=[documentContent,...(originalRecord?.concilium?.members??[]).map(member=>member.answer)];
  for(const part of texts.flatMap(text=>splitChatVisuals(text,new Set(),new Set(documentLegacyFences)))) {
    if(!part.complete&&part.kind!=='markdown')throw new Error('La respuesta contiene un resultado incompleto.');
    if(part.kind==='capability-artifact'){const {source}=JSON.parse(part.content);const result=await call('readStoredArtifact',source);if(!result.available)throw new Error('Un resultado guardado no está disponible.');registerView(result.view,inputOwner);}
    if(part.kind==='capability-view'){const result=JSON.parse(part.content);registerView(result.view,result.owner);}
    if(part.kind==='capability-legacy'){const result=await call('readLegacyResult',part.fence,part.content);if(!result.available)throw new Error('El lector de un resultado guardado no está disponible.');registerView(result.view,inputOwner);}
  }
  for(const text of texts)for(const match of text.matchAll(/nodus-(?:capability|image|library|archive):\/\/[^\s<>"')\]`]+/g))downloadSources.add(match[0]);
  return {sources:[...downloadSources]};
};
document.addEventListener('click',event=>{
  const anchor=(event.target as Element)?.closest?.('a[href]');if(!anchor)return;
  const href=anchor.getAttribute('href')??'';
  if(href.startsWith('#'))return;
  event.preventDefault();if(href.startsWith('nodus://'))open(href);else if(/^https?:\/\//i.test(href))void call('openExternal',href);
  else if((anchor as HTMLAnchorElement).download&&generatedSVGs.has(href)) {
    const blob=generatedSVGs.get(href)!;
    void encoded(blob).then(data=>call('shareRenderedImage',data,blob.type,(anchor as HTMLAnchorElement).download)).catch(error=>void call('readError',error.message));
  }
  else if((anchor as HTMLAnchorElement).download&&href.startsWith('data:image/svg+xml;base64,'))void call('shareRenderedImage',href.slice('data:image/svg+xml;base64,'.length),'image/svg+xml',(anchor as HTMLAnchorElement).download);
},true);
window.addEventListener('error',event=>void call('readError',event.message));
window.addEventListener('unhandledrejection',event=>void call('readError',String(event.reason?.message??event.reason)));
