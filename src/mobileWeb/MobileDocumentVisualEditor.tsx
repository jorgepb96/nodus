import type {MobileDocumentVisualCheckpoint} from '@shared/mobileDocumentVisuals';
import {useEffect,useRef,useState} from 'react';
import {DocumentFigureContext} from '../components/DocumentFigures';
import {DocumentVisualActions} from '../components/DocumentVisualScope';
import {Markdown} from '../components/Markdown';
import {ReaderResourceQueue} from './readerResourceQueue';
import {researchVisualFields} from '@shared/documentVisualContent';
import type {AutonomousDocumentVisuals} from './autonomousDocumentVisuals';
type Call=(method:string,...args:any[])=>Promise<any>;
export function MobileDocumentVisualEditor({controller,call,canGenerate}:{controller:AutonomousDocumentVisuals;call:Call;canGenerate:boolean}){
 const [,render]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[review,setReview]=useState(false),[archives,setArchives]=useState<any[]>([]),[archive,setArchive]=useState<MobileDocumentVisualCheckpoint|null>(null),root=useRef<HTMLDivElement>(null);
 const act=async(work:()=>Promise<unknown>)=>{setError('');setBusy(true);try{await work();}catch(cause){setError(String(cause));}finally{setBusy(false);render(value=>value+1);if(controller.checkpoint)void call('mobileDocumentVisualArchives',controller.checkpoint.target.id).then(setArchives).catch(cause=>setError(String(cause)));}};
 useEffect(()=>{const off=window.nodus.onDocumentVisualsChanged(()=>render(value=>value+1));void act(()=>controller.load());return()=>{off();controller.cancel();};},[controller]);
 const checkpoint=archive??controller.checkpoint;
 // Hydrate only visible posters. Bytes leave the DOM when they leave the
 // viewport; the authoring checkpoint always retains metadata, never data URLs.
 useEffect(()=>{
  const host=root.current;if(!host)return;const original=new Map<HTMLImageElement,string>(),pending=new Map<HTMLImageElement,number>();const queue=new ReaderResourceQueue(4),cancel=new AbortController();let revision=0,closed=false;
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){const image=entry.target as HTMLImageElement,source=original.get(image);if(!source)continue;const ticket=++revision;pending.set(image,ticket);if(!entry.isIntersecting){image.removeAttribute('src');continue;}void queue.run(()=>call('mobileDocumentVisualImage',checkpoint?.target.id,source,checkpoint?.id),cancel.signal).then(value=>{if(!closed&&pending.get(image)===ticket&&image.isConnected)image.src=`data:${value.mimeType};base64,${value.base64}`;}).catch(cause=>{if(!closed)setError(String(cause));});}},{rootMargin:'100px'});
  const scan=()=>{for(const image of host.querySelectorAll<HTMLImageElement>('img')){if(original.has(image))continue;const source=image.getAttribute('src');if(source?.startsWith('nodus-image://')){original.set(image,source);image.removeAttribute('src');observer.observe(image);}}};scan();const mutations=new MutationObserver(scan);mutations.observe(host,{childList:true,subtree:true});
  return()=>{closed=true;cancel.abort();mutations.disconnect();observer.disconnect();for(const image of original.keys())image.removeAttribute('src');};
 },[checkpoint?.id,checkpoint?.manifest,checkpoint?.state,call]);
 if(!checkpoint)return <section className="p-4"><h2>Recursos visuales del informe</h2>{error?<p role="alert">{error}</p>:<p>Abriendo la fuente conservada…</p>}<button onClick={()=>void act(()=>controller.load())} disabled={busy}>Reintentar</button></section>;
 const status={capturing:'Descargando la fuente visual',ready:'Fuente conservada en este dispositivo',running:'Preparando recursos visuales',pending:'Pendiente de sincronización con el Mac',available:'Versión confirmada en el Mac',failed:'El trabajo necesita revisión',cancelled:'Generación detenida; trabajo conservado',blocked:'Conflicto: el trabajo local permanece conservado'}[checkpoint.state];
 return <DocumentFigureContext.Provider value={{manifest:checkpoint.manifest,target:checkpoint.target,canUndo:!archive&&!!controller.checkpoint?.previous,openSource:source=>{void call('mobileDocumentVisualOpenSource',source).catch(cause=>setError(String(cause)));},refresh:()=>render(value=>value+1),removeFigure:archive||!canGenerate?undefined:id=>void act(()=>controller.remove(id)),downloadPoster:figure=>void act(()=>call('mobileDocumentVisualExport',checkpoint.target.id,{source:figure.poster,generationId:checkpoint.id})),downloadOriginal:(figure,node)=>void act(()=>call('mobileDocumentVisualExport',checkpoint.target.id,node.kind==='svg'?{figureId:figure.id,svg:node.svg,generationId:checkpoint.id}:'attachmentId' in node?{source:`nodus-capability://chat/${figure.owner}/${node.attachmentId}`,generationId:checkpoint.id}:{}) )}}>
  <section ref={root} className="p-4 space-y-4">
   <header><h2>{checkpoint.source.draft.title}</h2><p role="status">{status}</p><p>Edición de figuras sobre la fuente conservada del informe. El texto original mantiene su identidad.</p>{!archive&&canGenerate&&<DocumentVisualActions/>}{!archive&&!canGenerate&&<p>Consulta de la fuente propia. Para generar nuevas figuras, elige explícitamente el modo autónomo.</p>}</header>
   {(error||checkpoint.error)&&<p role="alert">{error||checkpoint.error}</p>}
   {checkpoint.recoveryReviewRequired&&<p role="alert">Este trabajo se recuperó tras cambiar el enlace. Puedes consultar y exportar su fuente y sus figuras. Esta sesión no volverá a ejecutar proveedores ni publicará cambios con el nuevo enlace.</p>}
   {!archive&&<div className="flex flex-wrap gap-2"><button disabled={busy||checkpoint.state==='running'} onClick={()=>void act(()=>controller.synchronize())}>Sincronizar figuras</button>{checkpoint.state==='capturing'||checkpoint.state==='failed'?<button disabled={busy} onClick={()=>void act(()=>controller.capture())}>Completar descarga de fuentes</button>:null}<button disabled={!canGenerate||busy||checkpoint.state==='running'} onClick={()=>setReview(true)}>Revisar cambio de fuente</button></div>}
   {review&&<section role="dialog" aria-label="Revisar fuente del informe"><p>Consultar una nueva versión del Mac inicia otra sesión visual. El trabajo anterior se conserva completo para su consulta y revisión; no se vuelve a generar el informe.</p><button onClick={()=>{setReview(false);void act(()=>controller.replaceSource());}} disabled={busy}>Conservar trabajo y consultar nueva fuente</button><button onClick={()=>setReview(false)}>Cancelar</button></section>}
   {archive&&<div><p role="status">Trabajo anterior conservado · consulta de su fuente y figuras propias. No es una nueva publicación del informe.</p><button onClick={()=>setArchive(null)}>Volver a la sesión actual</button></div>}
   {archives.length>0&&<details><summary>Trabajo anterior conservado</summary>{archives.map(item=><button className="block" key={item.id} onClick={()=>void act(async()=>{setArchive(await call('mobileDocumentVisualArchives',controller.checkpoint?.target.id,item.id));})}>{item.title||'Informe'} · {item.createdAt} · {item.state}</button>)}</details>}
   <Markdown content={researchVisualFields(checkpoint.source.draft).body}/>
  </section>
 </DocumentFigureContext.Provider>;
}
