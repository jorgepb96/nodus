import {useEffect,useMemo,useState} from 'react';
import type {DatabaseColumn,DatabaseSummary} from '@shared/databases';
import type {DatabaseSavedView} from '@shared/databaseFilters';
import {defaultDatabaseViewConfig,withViewProperties,type DatabaseViewConfig,type DatabaseViewLayout} from '@shared/databaseViewConfig';
import type {FilterNode} from '@shared/databaseQuery';
import {queryCompanionDatabasePresentation,type CompanionDatabasePresentationSource} from '@shared/companionDatabasePresentation';
import {DatabaseChartView,DatabaseMapView,DatabaseFeedView,DatabaseDashboardView} from '../components/DatabaseVisualizationViews';
import {DatabaseCalendarView,DatabaseTimelineView} from '../components/DatabaseTemporalViews';
import {t} from '../i18n';

type Call=(method:string,...args:unknown[])=>Promise<any>;
export type MobileDatabasePresentationTarget={databaseId:string;viewId:string|null;layout:DatabaseViewLayout};
const actions:Record<string,string>={queryDatabaseRows:'rows',queryDatabaseChart:'chart',queryDatabaseMap:'map',queryDatabaseFeed:'feed',queryDatabaseTemporalEvents:'temporal'};
export function databasePresentationAction(method:string){return actions[method];}
export async function readMobileDatabasePresentation(call:Call,action:string,input:Record<string,any>,downloadedOnly:boolean){
  if(!downloadedOnly){
    try{return await call('mobileDatabasePresentationRead',{action,input});}
    catch(error){if((error as {code?:string})?.code!=='offline')throw error;}
  }
  const source=await call('mobileDatabasePresentationSource',input.databaseId) as CompanionDatabasePresentationSource;
  return queryCompanionDatabasePresentation(source,action,input);
}
export async function exportMobileDatabaseChart(call:Call,input:{databaseId:string;format:'svg'|'png';svg:string}){
  if(!['svg','png'].includes(input.format)||typeof input.svg!=='string'||input.svg.length>2_000_000)throw new Error('Gráfico no válido.');
  let bytes:Uint8Array;
  if(input.format==='svg')bytes=new TextEncoder().encode(input.svg);
  else{
    const url=URL.createObjectURL(new Blob([input.svg],{type:'image/svg+xml'}));
    try{
      const image=new Image();image.src=url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
      const context=canvas.getContext('2d');if(!context)throw new Error('No se pudo exportar el gráfico.');context.drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('No se pudo exportar el gráfico.')),'image/png'));
      bytes=new Uint8Array(await blob.arrayBuffer());
    }finally{URL.revokeObjectURL(url);}
  }
  let binary='';for(let index=0;index<bytes.length;index+=16384)binary+=String.fromCharCode(...bytes.subarray(index,index+16384));
  const digest=await crypto.subtle.digest('SHA-256',bytes as BufferSource),sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return call('mobileDatabaseChartExport',{databaseId:input.databaseId,format:input.format,base64:btoa(binary),sha256});
}

export function MobileDatabasePresentation({target,call,downloadedOnly,phone,onOpen}:{target:MobileDatabasePresentationTarget;call:Call;downloadedOnly:boolean;phone:boolean;onOpen:(id:string)=>void}){
  const [metadata,setMetadata]=useState<{database:DatabaseSummary;columns:DatabaseColumn[];views:DatabaseSavedView[];revision:number}|null>(null);
  const [error,setError]=useState<string|null>(null),[attempt,setAttempt]=useState(0),[query,setQuery]=useState(''),[temporalScale,setTemporalScale]=useState<string|null>(null);
  useEffect(()=>{
    let cancelled=false;setMetadata(null);setError(null);
    void readMobileDatabasePresentation(call,'metadata',{databaseId:target.databaseId},downloadedOnly).then(value=>{
      if(value?.database?.id!==target.databaseId||!Array.isArray(value.columns)||!Array.isArray(value.views))throw new Error('La vista no tiene datos compatibles.');
      if(!cancelled)setMetadata(value);
    }).catch(error=>{if(!cancelled)setError(String(error.message??error));});return()=>{cancelled=true;};
  },[attempt,call,downloadedOnly,target.databaseId]);
  const config=useMemo(()=>{
    if(!metadata)return null;
    const view=target.viewId?metadata.views.find(view=>view.id===target.viewId):null;
    if(target.viewId&&!view)return null;
    const saved=withViewProperties(view?.config??defaultDatabaseViewConfig(target.layout),metadata.columns.map(column=>column.id));
    const search:FilterNode|null=query.trim()?{type:'group',operator:'or',children:metadata.columns.filter(column=>['title','text','rich_text','ai'].includes(column.type)).map(column=>({type:'condition',columnId:column.id,op:'contains',value:query.trim()}))}:null;
    const filter=saved.filter&&search?{type:'group' as const,operator:'and' as const,children:[saved.filter,search]}:saved.filter??search;
    const configured={...saved,filter};
    if(temporalScale&&['calendar','timeline'].includes(configured.layout))return {...configured,scale:temporalScale} as DatabaseViewConfig;
    return configured;
  },[metadata,query,target.layout,target.viewId,temporalScale]);
  if(error)return <div role="alert" className="mobile-database-issue"><p>{error}</p><button className="btn" onClick={()=>setAttempt(value=>value+1)}>{t('Reintentar')}</button></div>;
  if(!metadata)return <div role="status" className="mobile-loading">{t('Cargando vista…')}</div>;
  if(!config)return <div role="alert" className="mobile-database-issue">{t('La vista guardada ya no existe. Vuelve a elegir una vista.')}</div>;
  const props={databaseId:target.databaseId,columns:metadata.columns,onOpen};
  return <section className="mobile-database-presentation" data-layout={config.layout}>
    <div className="mobile-database-controls"><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('Buscar en esta vista')} aria-label={t('Buscar en esta vista')}/>
      {['calendar','timeline'].includes(config.layout)&&<select value={temporalScale??('scale' in config?config.scale:'month')} aria-label={t('Escala temporal')} onChange={event=>setTemporalScale(event.target.value)}>
        {(config.layout==='calendar'?['month','week','day']:['hours','days','weeks','months','quarters','years']).map(scale=><option key={scale} value={scale}>{t(scale)}</option>)}
      </select>}
    </div>
    {config.layout==='chart'?<DatabaseChartView {...props} config={config}/>
      :config.layout==='map'?<DatabaseMapView {...props} config={config}/>
      :config.layout==='feed'?<DatabaseFeedView {...props} config={config}/>
      :config.layout==='dashboard'?<DatabaseDashboardView {...props} config={config} views={metadata.views}/>
      :config.layout==='calendar'?<DatabaseCalendarView {...props} config={config} mobile={phone} readOnly onChanged={()=>setAttempt(value=>value+1)}/>
      :config.layout==='timeline'?<DatabaseTimelineView {...props} config={config} mobile={phone} readOnly onChanged={()=>setAttempt(value=>value+1)}/>
      :<div role="alert">{t('La presentación seleccionada no está disponible.')}</div>}
  </section>;
}
