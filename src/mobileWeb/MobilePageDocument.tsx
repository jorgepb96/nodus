import {useCallback,useEffect,useRef,useState} from 'react';
import {PageBlockEditor,SyncedBlockPreview} from '../components/pages/PageBlockEditor';
import {BlockNoteCanvas,type BlockNoteCanvasHandle} from '../components/editor/BlockNoteCanvas';
import {blockNoteToPageBlocks,type BlockNoteDocument} from '@shared/blockNoteDocument';
import type {PageDocument,SavePageDocumentInput} from '@shared/pages';
import {COMPANION_CONTENT_CHANGED} from '../companionEvents';
import {t} from '../i18n';
import {LinkedDatabaseViewBlock} from '../components/pages/LinkedDatabaseViewBlock';
import {pageCompatibilityDependency} from '@shared/mobilePageDependencies';
type MobileDocument=PageDocument & {mobileSyncState?:string;mobileSyncIssue?:string;mobileConflictRemote?:PageDocument};
type Input=SavePageDocumentInput & {title?:string};

export function MobilePageDocument({id,onOpen}:{id:string;onOpen:(id:string)=>void}){
  const [document,setDocument]=useState<MobileDocument|null>(null),[issue,setIssue]=useState<string|null>(null),[attempt,setAttempt]=useState(0);
  const loading=useRef(0);
  const load=useCallback(async()=>{
    const serial=++loading.current;
    try{const next=await window.nodus.getPageDocument(id);if(serial===loading.current){if(!next)throw new Error(t('No se encontró la página.'));setDocument(next);setIssue(null);}}
    catch(error){if(serial===loading.current)setIssue(error instanceof Error?error.message:String(error));}
  },[id]);
  useEffect(()=>{setDocument(null);void load();return()=>{loading.current++;};},[load,attempt]);
  useEffect(()=>{const changed=()=>{void load();};window.addEventListener(COMPANION_CONTENT_CHANGED,changed);window.addEventListener('nodus:mobile-pages-changed',changed);return()=>{window.removeEventListener(COMPANION_CONTENT_CHANGED,changed);window.removeEventListener('nodus:mobile-pages-changed',changed);};},[load]);
  const resolve=async(keep:boolean)=>{
    try{await (window as any).nodusMobileCall('resolveMobilePageConflict',id,keep);setAttempt(value=>value+1);}
    catch(error){setIssue(error instanceof Error?error.message:String(error));}
  };
  return <div className="mobile-page-document">
    {issue&&<div role="alert" className="mobile-page-notice"><p>{issue}</p><button onClick={()=>void load()}>{t('Reintentar')}</button></div>}
    {document?.mobileSyncState&&<div role={document.mobileSyncState==='conflict'||document.mobileSyncState==='blocked'?'alert':'status'} className="mobile-page-notice">
      <p>{document.mobileSyncState==='conflict'?t('Hay cambios simultáneos en esta página. Tu borrador se conserva en el móvil.'):document.mobileSyncState==='blocked'?t('La página necesita revisión antes de sincronizar.'):t('Guardado en el móvil · pendiente de sincronizar')}</p>
      {document.mobileSyncIssue&&<p>{document.mobileSyncIssue}</p>}
      {document.mobileSyncState==='conflict'&&<div><button onClick={()=>void resolve(true)}>{t('Conservar mi versión')}</button><button onClick={()=>void resolve(false)}>{t('Usar la versión de Nodus')}</button></div>}
    </div>}
    {!document&&!issue&&<div role="status">{t('Cargando página…')}</div>}
    {document&&(document.nativeDocument
      ? <NativePage key={`${id}:${attempt}`} initial={document} onDocument={setDocument} onOpen={onOpen}/>
      : <PageBlockEditor key={`${id}:${attempt}`} pageId={id} mobileLocalAssets onDocumentChange={setDocument} onNavigatePage={onOpen}/>)}
  </div>;
}
function NativePage({initial,onDocument,onOpen}:{initial:MobileDocument;onDocument:(document:MobileDocument)=>void;onOpen:(id:string)=>void}){
  const canvas=useRef<BlockNoteCanvasHandle>(null),current=useRef(initial),draft=useRef({title:initial.page.title,native:initial.nativeDocument!,markdown:initial.markdown}),serial=useRef(0),saving=useRef(false);
  const [title,setTitle]=useState(initial.page.title),[issue,setIssue]=useState<string|null>(null),[history,setHistory]=useState({canUndo:false,canRedo:false});
  const persist=async()=>{
    if(saving.current||initial.page.locked)return;saving.current=true;const owned=serial.current;
    try{
      const input:Input={pageId:initial.page.id,title:draft.current.title,expectedRevision:current.current.revision,blocks:blockNoteToPageBlocks(draft.current.native),nativeDocument:draft.current.native,schemaVersion:2,academicMetadata:current.current.academicMetadata,reason:'mobile-editor'};
      const saved=await window.nodus.savePageDocument(input);
      if(!saved.ok)throw new Error(t('La página cambió en Nodus. Revisa el conflicto antes de continuar.'));
      current.current=saved.document;onDocument(saved.document);setIssue(null);
    }catch(error){setIssue(error instanceof Error?error.message:String(error));}
    finally{saving.current=false;if(owned!==serial.current)void persist();}
  };
  const change=(markdown:string,native:BlockNoteDocument)=>{draft.current={title,native,markdown};serial.current++;void persist();};
  return <section className="mobile-native-page">
    <input aria-label={t('Título de la página')} className="mobile-page-title" value={title} readOnly={initial.page.locked} onChange={event=>{setTitle(event.target.value);draft.current.title=event.target.value;serial.current++;void persist();}}/>
    <div className="mobile-page-tools"><button aria-label={t('Deshacer')} disabled={!history.canUndo||initial.page.locked} onClick={()=>canvas.current?.undo()}>{t('Deshacer')}</button><button aria-label={t('Rehacer')} disabled={!history.canRedo||initial.page.locked} onClick={()=>canvas.current?.redo()}>{t('Rehacer')}</button></div>
    {issue&&<div role="alert" className="mobile-page-notice"><p>{issue}</p><button onClick={()=>void persist()}>{t('Reintentar')}</button></div>}
    <BlockNoteCanvas ref={canvas} documentId={initial.page.id} value={initial.markdown} nativeDocument={initial.nativeDocument} academicMetadata={initial.academicMetadata} editable={!initial.page.locked} onHistoryChange={setHistory} onChange={change}
      renderCompatibility={markdown=>{const dependency=pageCompatibilityDependency(markdown);if(!dependency)return null;if(dependency.kind==='syncedBlock')return <SyncedBlockPreview blockId={dependency.id} onNavigatePage={onOpen}/>;return <LinkedDatabaseViewBlock content={{viewId:dependency.viewId,localFilter:dependency.localFilter}} onContent={()=>{}} readOnly onNavigatePage={onOpen} onOpenRow={id=>void (window as any).nodusMobileCall('openMobileDatabaseRow',id)}/>;}}
      resolveFileUrl={async source=>{const blob=/^nodus-blob:\/\/([a-f0-9]{64})$/i.exec(source);if(!blob)return source;const file=await (window as any).nodusMobileCall('getPageAsset',blob[1]);return `data:${file.mime};base64,${file.base64}`;}}
      onDownloadFile={(source,name)=>(window as any).nodusMobileCall('openPageResource',{source,name})}
      onNavigateLink={href=>{const page=/^nodus:\/\/page\/([^?]+)$/.exec(href);if(page)onOpen(decodeURIComponent(page[1]));else (window as any).nodusMobileCall('openPageResource',{source:href,name:'archivo'});}}/>
  </section>;
}
