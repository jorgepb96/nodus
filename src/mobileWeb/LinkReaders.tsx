import {useEffect, useRef, useState, type ReactNode} from 'react';
import type {DictionaryEntryDetail, DictionaryEntrySummary, DictionaryEvidenceItem, DictionaryFacets, DictionaryVersion} from '@shared/dictionary';
import type {WritingWorkshopSavedDraft} from '@shared/types';
import {readDictionaryCatalogue, readDictionaryEvidence} from '@shared/dictionaryPagination';
import {Markdown} from '../components/Markdown';
import {t} from '../i18n';

type Navigate = (kind:string,id:string,location?:string,quote?:string)=>void;
function Failure({message,retry}:{message:string;retry:()=>void}) {
  return <div role="alert" className="link-reader-issue"><p>{message}</p><button onClick={retry}>{t('Reintentar')}</button></div>;
}
function Prose({text,navigate}:{text:string;navigate:Navigate}) {
  return <Markdown content={text} onCitation={citation=>navigate('citation',`nodus://${citation.kind}/${encodeURIComponent(citation.id)}`)}
    onReaderCitation={citation=>navigate('work',citation.documentId,citation.page?String(citation.page):undefined)}/>;
}

/** Header actions as icons in one compact group, like a native toolbar: the
 * labels stay available to VoiceOver and as tooltips. */
const iconProps={width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,'aria-hidden':true};
function BackIcon(){return <svg {...iconProps}><path d="M15 18l-6-6 6-6"/></svg>;}
function RefreshIcon(){return <svg {...iconProps}><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>;}
function FilterIcon(){return <svg {...iconProps}><path d="M3 5h18"/><path d="M6 12h12"/><path d="M10 19h4"/></svg>;}
function HistoryIcon(){return <svg {...iconProps}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></svg>;}

function IconAction({label,onClick,disabled,busy,children}:{label:string;onClick:()=>void;disabled?:boolean;busy?:boolean;children:ReactNode}) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} aria-busy={busy||undefined} onClick={onClick}>{children}</button>;
}

/** A filter icon that opens a popover anchored under the header actions. The
 * dot marks that some filter is narrowing the list while the popover is shut. */
function FilterPopover({active,onReset,children}:{active:number;onReset:()=>void;children:ReactNode}) {
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  const label=active?`${t('Filtros')} (${active})`:t('Filtros');
  return <div className="link-reader-popover-anchor" ref={root}>
    <button type="button" aria-label={label} title={label} aria-expanded={open} aria-haspopup="dialog"
      className={active?'link-reader-action-active':undefined} onClick={()=>setOpen(value=>!value)}>
      <FilterIcon/>{active>0&&<span className="link-reader-action-dot" aria-hidden/>}
    </button>
    {open&&<div className="link-reader-popover" role="dialog" aria-label={t('Filtros')}>
      <div className="link-reader-filters">{children}</div>
      {active>0&&<button type="button" className="link-reader-popover-reset" onClick={onReset}>{t('Limpiar filtros')}</button>}
    </div>}
  </div>;
}

function ReaderHeader({title,busy,onRefresh,onBack,backLabel,children}:{title:string;busy:boolean;onRefresh:()=>void;onBack?:()=>void;backLabel?:string;children?:ReactNode}) {
  return <header className="link-reader-header"><h1>{title}</h1>
    <div className="link-reader-actions" role="toolbar" aria-label={t('Acciones')}>
      {onBack&&<IconAction label={backLabel??''} onClick={onBack}><BackIcon/></IconAction>}
      {children}
      <IconAction label={t('Actualizar')} disabled={busy} busy={busy} onClick={onRefresh}><RefreshIcon/></IconAction>
    </div></header>;
}

/** The catalogue's index letter: accents folded so "Á" files under "A". */
const indexLetter=(name:string)=>{
  const first=name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').charAt(0).toLocaleUpperCase();
  return /[A-Z]/.test(first)?first:'#';
};
const ALPHABET=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ','#'];

/** iOS-style section index on the trailing edge. Tapping or sliding along it
 * scrolls the catalogue to the first entry at or after that letter. */
function AlphabetIndex({present,onLetter}:{present:Set<string>;onLetter:(letter:string)=>void}) {
  const last=useRef('');
  const pick=(x:number,y:number)=>{
    const letter=(document.elementFromPoint(x,y) as HTMLElement|null)?.closest<HTMLElement>('[data-index-letter]')?.dataset.indexLetter;
    if(!letter||letter===last.current)return;
    last.current=letter;
    const target=ALPHABET.slice(ALPHABET.indexOf(letter)).find(value=>present.has(value))
      ??[...ALPHABET].reverse().find(value=>present.has(value));
    if(target)onLetter(target);
  };
  return <nav className="link-reader-index" aria-label={t('Letra')} style={{touchAction:'none'}}
    onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);last.current='';pick(event.clientX,event.clientY);}}
    onPointerMove={event=>{if(event.buttons||event.pointerType==='touch')pick(event.clientX,event.clientY);}}>
    {ALPHABET.filter(letter=>letter!=='#'||present.has('#')).map(letter=>
      <span key={letter} data-index-letter={letter} className={present.has(letter)?undefined:'link-reader-index-empty'}
        role="button" aria-label={letter} aria-disabled={!present.has(letter)||undefined}>{letter}</span>)}
  </nav>;
}

/** Consultation-only presentation; the complete Desktop authoring workspace stays intact. */
export function LinkDictionary({navigate}:{navigate:Navigate}) {
  const [entries,setEntries]=useState<DictionaryEntrySummary[]>([]);
  const [facets,setFacets]=useState<DictionaryFacets|null>(null);
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState('');
  const [tag,setTag]=useState('');
  const [author,setAuthor]=useState('');
  const [work,setWork]=useState('');
  const [letter,setLetter]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [detail,setDetail]=useState<DictionaryEntryDetail|null>(null);
  const [evidence,setEvidence]=useState<DictionaryEvidenceItem[]>([]);
  const [versions,setVersions]=useState<DictionaryVersion[]>([]);
  const [expandedVersion,setExpandedVersion]=useState<string|null>(null);
  const [tab,setTab]=useState('overview');
  const [busy,setBusy]=useState(true);
  const [issue,setIssue]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true;setBusy(true);setIssue('');setDetail(null);
    if(selected) {
      void Promise.all([window.nodus.getDictionaryEntry(selected),
        readDictionaryEvidence(request=>window.nodus.listDictionaryEvidence(request),{entryId:selected}),
        window.nodus.listDictionaryVersions(selected)]).then(([value,proof,history])=>{
          if(!active)return;if(!value)throw new Error(t('Esta entrada ya no está disponible.'));
          setDetail(value);setEvidence(proof.items);setVersions(history);
        }).catch(error=>{if(active)setIssue(String(error));}).finally(()=>{if(active)setBusy(false);});
    } else {
      void Promise.all([readDictionaryCatalogue(request=>window.nodus.listDictionaryEntries(request),{
        query,statuses:status?[status as DictionaryEntrySummary['status']]:undefined,
        tags:tag?[tag]:undefined,authorIds:author?[author]:undefined,workIds:work?[work]:undefined,
        letter:letter||undefined,sort:{key:'name',dir:'asc'}}),window.nodus.listDictionaryFacets()])
        .then(([page,nextFacets])=>{if(active){setEntries(page.items);setFacets(nextFacets);}})
        .catch(error=>{if(active)setIssue(String(error));}).finally(()=>{if(active)setBusy(false);});
    }
    return()=>{active=false;};
  },[selected,query,status,tag,author,work,letter,revision]);
  const open=(id:string)=>{setTab('overview');setSelected(id);};
  const activeFilters=[status,tag,author,work,letter].filter(Boolean).length;
  const resetFilters=()=>{setStatus('');setTag('');setAuthor('');setWork('');setLetter('');};
  const firstByLetter=new Map<string,string>();
  for(const entry of entries){const key=indexLetter(entry.name);if(!firstByLetter.has(key))firstByLetter.set(key,entry.id);}
  const jumpTo=(letter:string)=>{const id=firstByLetter.get(letter);if(id)document.getElementById(`link-dictionary-${id}`)?.scrollIntoView({block:'start'});};
  return <section className="link-reader" data-testid="link-dictionary">
    <ReaderHeader title={t('Diccionario')} busy={busy} onRefresh={()=>setRevision(value=>value+1)}
      onBack={selected?()=>setSelected(null):undefined} backLabel={t('Volver al diccionario')}>
      {!selected&&<FilterPopover active={activeFilters} onReset={resetFilters}>
        <select aria-label={t('Estado')} value={status} onChange={event=>setStatus(event.target.value)}><option value="">{t('Todos los estados')}</option>{['draft','active','archived'].map(value=><option key={value} value={value}>{t(value==='draft'?'Borrador':value==='active'?'Activo':'Archivado')}</option>)}</select>
        <select aria-label={t('Etiqueta')} value={tag} onChange={event=>setTag(event.target.value)}><option value="">{t('Todas las etiquetas')}</option>{facets?.tags.map(item=><option key={item.label} value={item.label}>{item.label}</option>)}</select>
        <select aria-label={t('Autores')} value={author} onChange={event=>setAuthor(event.target.value)}><option value="">{t('Todos los autores')}</option>{facets?.authors.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label={t('Obras')} value={work} onChange={event=>setWork(event.target.value)}><option value="">{t('Todas las obras')}</option>{facets?.works.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select>
        <select aria-label={t('Letra')} value={letter} onChange={event=>setLetter(event.target.value)}><option value="">{t('Todas las letras')}</option>{facets?.letters.map(value=><option key={value}>{value}</option>)}</select>
      </FilterPopover>}
    </ReaderHeader>
    {!selected&&<input type="search" aria-label={t('Buscar concepto')} placeholder={t('Buscar concepto…')} value={query} onChange={event=>setQuery(event.target.value)}/>}
    {issue&&<Failure message={issue} retry={()=>setRevision(value=>value+1)}/>}
    {busy?<p role="status">{t('Cargando…')}</p>:!issue&&!selected?<>
      <p>{entries.length} {t('entradas')}</p>
      {entries.length>1&&<AlphabetIndex present={new Set(firstByLetter.keys())} onLetter={jumpTo}/>}
      <ul className="link-reader-catalogue link-reader-catalogue-indexed">{entries.map(entry=><li key={entry.id} id={`link-dictionary-${entry.id}`}><button onClick={()=>open(entry.id)}>
        <strong>{entry.name}</strong><span className="link-reader-description">{entry.shortDescription}</span>
        <small>{entry.authorCount} {t('Autores')} · {entry.workCount} {t('Obras')} · {entry.evidenceCount} {t('Evidencia')}</small>
        <span className="link-reader-badge">{t(entry.status==='active'?'Activo':entry.status==='draft'?'Borrador':'Archivado')}</span>
      </button></li>)}</ul>{!entries.length&&<p>{t('No hay entradas con estos filtros.')}</p>}
    </>:!issue&&detail?<article>
      <h2>{detail.entry.name}</h2>
      <nav className="link-reader-tabs" aria-label={t('Contenido de la entrada')}>{[
        ['overview','Definición'],['evidence','Evidencia'],['authors','Autores'],['works','Obras'],['versions','Versiones'],['relations','Relaciones']
      ].map(([key,label])=><button key={key} aria-current={tab===key?'page':undefined} onClick={()=>setTab(key)}>{t(label)}</button>)}</nav>
      {tab==='overview'&&<><Prose text={detail.entry.contentMarkdown||t('Esta entrada todavía no tiene una definición guardada.')} navigate={navigate}/>{detail.entry.notes&&<details><summary>{t('Notas')}</summary><Prose text={detail.entry.notes} navigate={navigate}/></details>}</>}
      {tab==='evidence'&&<><p>{evidence.length} {t('Evidencias')}</p>{evidence.map(item=><section className="link-reader-card" key={`${item.kind}:${item.id}`}><h3>{item.label}</h3><Prose text={item.text} navigate={navigate}/><small>{item.workTitle} {item.pageLabel} · {item.decision}</small><button onClick={()=>navigate('citation',`nodus://${item.kind}/${encodeURIComponent(item.id)}`)}>{t('Ver fuente')}</button></section>)}</>}
      {tab==='authors'&&detail.authors.map(item=><section key={item.id}><button onClick={()=>navigate('author',item.id)}>{item.name}</button><Prose text={item.summaryMarkdown} navigate={navigate}/></section>)}
      {tab==='works'&&detail.works.map(item=><button className="link-reader-row" key={item.id} onClick={()=>navigate('work',item.id)}>{item.title} · {item.authors.join(', ')}</button>)}
      {tab==='versions'&&versions.map((item,index)=><section className="link-reader-card" key={item.id}>
        <button className="link-reader-row" aria-label={`${t('Versión')} ${index+1}: ${item.generatedAt}`} aria-expanded={expandedVersion===item.id}
          onClick={()=>setExpandedVersion(value=>value===item.id?null:item.id)}>{item.generatedAt} · {item.state} · {item.model?.model??''}</button>
        {expandedVersion===item.id&&<Prose text={item.contentMarkdown} navigate={navigate}/>}</section>)}
      {tab==='relations'&&(detail.relations?.length?detail.relations.map(item=><button className="link-reader-row" key={item.id} onClick={()=>open(item.entry.id)}>{item.entry.name} · {item.type}</button>):<p>{t('No hay relaciones guardadas.')}</p>)}
    </article>:null}
  </section>;
}

export function LinkReports({navigate}:{navigate:Navigate}) {
  const [items,setItems]=useState<WritingWorkshopSavedDraft[]>([]);
  const [query,setQuery]=useState('');const [language,setLanguage]=useState('');
  const [busy,setBusy]=useState(true);const [issue,setIssue]=useState('');const [revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;setBusy(true);setIssue('');
    void window.nodus.listWritingWorkshopDrafts().then(value=>{if(active)setItems(value.filter(item=>item.brief.kind==='deep_research'));})
      .catch(error=>{if(active)setIssue(String(error));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};
  },[revision]);
  const filtered=items.filter(item=>(!language||item.brief.language===language)&&(!query||(item.title+' '+item.brief.objective).toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  return <section className="link-reader" data-testid="link-reports">
    <ReaderHeader title="Deep Research" busy={busy} onRefresh={()=>setRevision(value=>value+1)}>
      <FilterPopover active={language?1:0} onReset={()=>setLanguage('')}>
        <select aria-label={t('Idioma')} value={language} onChange={event=>setLanguage(event.target.value)}><option value="">{t('Todos los idiomas')}</option>{[...new Set(items.map(item=>item.brief.language))].map(value=><option key={value}>{value}</option>)}</select>
      </FilterPopover>
      <IconAction label={t('Informes de versiones anteriores')} onClick={()=>navigate('legacyResearchReports','all')}><HistoryIcon/></IconAction>
    </ReaderHeader>
    <input type="search" aria-label={t('Buscar informe')} placeholder={t('Buscar informe…')} value={query} onChange={event=>setQuery(event.target.value)}/>
    {issue&&<Failure message={issue} retry={()=>setRevision(value=>value+1)}/>}
    {busy?<p role="status">{t('Cargando…')}</p>:!issue?<><p>{filtered.length} {t('informes')}</p><ul className="link-reader-catalogue">{filtered.map(item=><li key={item.id}><button onClick={()=>navigate('deepResearchReport',item.id)}><strong>{item.title}</strong><span className="link-reader-description">{item.brief.objective}</span><small>{item.createdAt.slice(0,10)} · {item.brief.language} · {item.model?.model??''}</small></button></li>)}</ul>{!filtered.length&&<p>{t('No hay informes con estos filtros.')}</p>}</>:null}
  </section>;
}
