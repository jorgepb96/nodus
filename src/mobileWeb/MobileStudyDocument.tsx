import {useEffect, useMemo, useRef, useState} from 'react';
import type {AppSettings} from '@shared/types';
import type {StudyDocEditorData} from '@shared/studyEditor';
import {StudyEditor} from '../components/editor/StudyEditor';
import {studyDocumentPort, type EditorDocument} from '../components/editor/documentPort';
import {t} from '../i18n';

type Call = (method:string, ...args:unknown[])=>Promise<any>;
export function MobileStudyDocument({id,settings,draftScope,call,onOpen}: {
  id:string;settings:AppSettings;draftScope:string;call:Call;onOpen:(kind:string,id:string)=>void;
}) {
  const [activeId,setActiveId]=useState(id);
  const [document,setDocument]=useState<EditorDocument|null>(null);
  const [issue,setIssue]=useState('');
  const [retry,setRetry]=useState(0);
  const flush=useRef<()=>Promise<boolean>>(async()=>true);
  const port=useMemo(()=>({...studyDocumentPort,
    dragType:`application/x-nodus-mobile-study-${draftScope}`,
    resolveMobileConflict:(documentId:string,keepMobile:boolean)=>call('resolveMobileStudyConflict',documentId,keepMobile),
  }),[call,draftScope]);
  useEffect(()=>{
    let mounted=true;setIssue('');setDocument(null);
    void call('getStudyDocEditorData',activeId).then((value:StudyDocEditorData)=>{
      if(typeof value.documentTitle!=='string'||typeof value.contentMarkdown!=='string'||typeof value.revision!=='number'||!Number.isInteger(value.revision))throw new Error(t('El documento recibido no tiene un formato válido.'));
      if(mounted)setDocument({id:activeId,title:value.documentTitle,contentMarkdown:value.contentMarkdown,favorite:false,editorRevision:value.revision});
    }).catch(error=>{if(mounted)setIssue(error instanceof Error?error.message:String(error));});
    return()=>{mounted=false;};
  },[activeId,call,retry]);
  if(issue)return <div role="alert" className="p-4">{issue}<button className="btn mt-3" onClick={()=>setRetry(value=>value+1)}>{t('Reintentar')}</button></div>;
  if(!document)return <div role="status" className="p-4">{t('Cargando editor…')}</div>;
  return <StudyEditor settings={settings} documents={[document]} activeId={document.id} port={port}
    showTabs={false} documentIcon="doc.text" onRegisterFlush={value=>{flush.current=value;}}
    onActivate={setActiveId} onClose={()=>onOpen('studyDocument',document.id)}
    onSaved={saved=>setDocument(current=>current?{...current,title:saved.title,contentMarkdown:saved.contentMarkdown,editorRevision:saved.editorRevision}:current)}
    onDuplicate={async()=>{if(!await flush.current())return;const copy=await call('duplicateMobileStudyDocument',document.id) as EditorDocument;setActiveId(copy.id);}}
    onTrash={async()=>{if(!await flush.current())return;await call('trashMobileStudyDocument',document.id);setIssue(t('El documento se ha movido a la papelera.'));}}
    onOpenLinkedDocument={setActiveId} onOpenRecording={(recording,timestamp)=>onOpen('citation',`nodus://study/recording/${encodeURIComponent(recording)}${timestamp==null?'':`?t=${timestamp}`}`)}
    onNavigateLink={href=>{if(!href.startsWith('nodus://'))return false;onOpen('citation',href);return true;}}
  />;
}
