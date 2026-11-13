import {useEffect, useState} from 'react';
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
  return <section className="link-reader" data-testid="link-dictionary">
    <header><h1>{t('Diccionario')}</h1><button onClick={()=>setRevision(value=>value+1)} disabled={busy}>{t('Actualizar')}</button></header>
    {selected?<button onClick={()=>setSelected(null)}>{t('Volver al diccionario')}</button>:<>
      <input type="search" aria-label={t('Buscar concepto')} placeholder={t('Buscar concepto…')} value={query} onChange={event=>setQuery(event.target.value)}/>
      <details><summary>{t('Filtros')}</summary><div className="link-reader-filters">
        <select aria-label={t('Estado')} value={status} onChange={event=>setStatus(event.target.value)}><option value="">{t('Todos los estados')}</option>{['draft','active','archived'].map(value=><option key={value} value={value}>{t(value==='draft'?'Borrador':value==='active'?'Activo':'Archivado')}</option>)}</select>
        <select aria-label={t('Etiqueta')} value={tag} onChange={event=>setTag(event.target.value)}><option value="">{t('Todas las etiquetas')}</option>{facets?.tags.map(item=><option key={item.label} value={item.label}>{item.label}</option>)}</select>
        <select aria-label={t('Autores')} value={author} onChange={event=>setAuthor(event.target.value)}><option value="">{t('Todos los autores')}</option>{facets?.authors.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label={t('Obras')} value={work} onChange={event=>setWork(event.target.value)}><option value="">{t('Todas las obras')}</option>{facets?.works.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select>
        <select aria-label={t('Letra')} value={letter} onChange={event=>setLetter(event.target.value)}><option value="">{t('Todas las letras')}</option>{facets?.letters.map(value=><option key={value}>{value}</option>)}</select>
      </div></details>
    </>}
    {issue&&<Failure message={issue} retry={()=>setRevision(value=>value+1)}/>}
    {busy?<p role="status">{t('Cargando…')}</p>:!issue&&!selected?<>
      <p>{entries.length} {t('entradas')}</p>
      <ul className="link-reader-catalogue">{entries.map(entry=><li key={entry.id}><button onClick={()=>open(entry.id)}>
        <strong>{entry.name}</strong><span>{entry.shortDescription}</span>
        <small>{entry.authorCount} {t('Autores')} · {entry.workCount} {t('Obras')} · {entry.evidenceCount} {t('Evidencia')}</small>
        <span className="link-reader-badge">{t(entry.status==='active'?'Activo':entry.status==='draft'?'Borrador':'Archivado')}</span>
      </button></li>)}</ul>{!entries.length&&<p>{t('No hay entradas con estos filtros.')}</p>}
    </>:!issue&&detail?<article>
      <h2>{detail.entry.name}</h2>
      <nav className="link-reader-tabs" aria-label={t('Contenido de la entrada')}>{[
        ['overview','Definición'],['evidence','Evidencia'],['authors','Autores'],['works','Obras'],['versions','Versiones'],['relations','Relaciones']
      ].map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{t(label)}</button>)}</nav>
      {tab==='overview'&&<><Prose text={detail.entry.contentMarkdown||t('Esta entrada todavía no tiene una definición guardada.')} navigate={navigate}/>{detail.entry.notes&&<details><summary>{t('Notas')}</summary><Prose text={detail.entry.notes} navigate={navigate}/></details>}</>}
      {tab==='evidence'&&<><p>{evidence.length} {t('Evidencias')}</p>{evidence.map(item=><section className="link-reader-card" key={`${item.kind}:${item.id}`}><h3>{item.label}</h3><Prose text={item.text} navigate={navigate}/><small>{item.workTitle} {item.pageLabel} · {item.decision}</small><button onClick={()=>navigate('citation',`nodus://${item.kind}/${encodeURIComponent(item.id)}`)}>{t('Ver fuente')}</button></section>)}</>}
      {tab==='authors'&&detail.authors.map(item=><section key={item.id}><button onClick={()=>navigate('author',item.id)}>{item.name}</button><Prose text={item.summaryMarkdown} navigate={navigate}/></section>)}
      {tab==='works'&&detail.works.map(item=><button className="link-reader-row" key={item.id} onClick={()=>navigate('work',item.id)}>{item.title} · {item.authors.join(', ')}</button>)}
      {tab==='versions'&&versions.map(item=><details key={item.id}><summary>{item.generatedAt} · {item.state} · {item.model?.model??''}</summary><Prose text={item.contentMarkdown} navigate={navigate}/></details>)}
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
    <header><h1>Deep Research</h1><button disabled={busy} onClick={()=>setRevision(value=>value+1)}>{t('Actualizar')}</button></header>
    <input type="search" aria-label={t('Buscar informe')} placeholder={t('Buscar informe…')} value={query} onChange={event=>setQuery(event.target.value)}/>
    <select aria-label={t('Idioma')} value={language} onChange={event=>setLanguage(event.target.value)}><option value="">{t('Todos los idiomas')}</option>{[...new Set(items.map(item=>item.brief.language))].map(value=><option key={value}>{value}</option>)}</select>
    <button onClick={()=>navigate('legacyResearchReports','all')}>{t('Informes de versiones anteriores')}</button>
    {issue&&<Failure message={issue} retry={()=>setRevision(value=>value+1)}/>}
    {busy?<p role="status">{t('Cargando…')}</p>:!issue?<><p>{filtered.length} {t('informes')}</p><ul className="link-reader-catalogue">{filtered.map(item=><li key={item.id}><button onClick={()=>navigate('deepResearchReport',item.id)}><strong>{item.title}</strong><span>{item.brief.objective}</span><small>{item.createdAt.slice(0,10)} · {item.brief.language} · {item.model?.model??''}</small></button></li>)}</ul>{!filtered.length&&<p>{t('No hay informes con estos filtros.')}</p>}</>:null}
  </section>;
}
