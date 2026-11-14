import {redactDatabaseResearchMarkdown,type DatabaseDeepResearchExportOptions,type DatabaseResearchRunDetail,type DatabaseResearchReport} from '@shared/databaseDeepResearch';
import {databaseResearchArchiveFiles,databaseResearchReportDocument} from '@shared/databaseResearchExport';
import {renderProfessionalReportHtml} from '@shared/professionalReport';
import {mobileDatabaseSources,mobileDatabaseResearchHost,MobileDatabaseResearchRepository,type MobileDatabaseSourcePack} from '@shared/mobileDatabaseResearch';
import {rehashDatabaseResearchSnapshot} from '@shared/databaseResearchEngine';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {Zippable} from 'fflate';

type Call=(method:string,...args:any[])=>Promise<any>;
function base64(bytes:Uint8Array) {
  if(bytes.byteLength>20_000_000)throw new Error('La exportación supera el límite temporal del móvil.');
  let text='';for(let offset=0;offset<bytes.length;offset+=32768)text+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(text);
}
export async function exportDeviceDatabaseResearch(call:Call,id:string,options:DatabaseDeepResearchExportOptions) {
  if(!options||!['markdown','pdf','docx','zip'].includes(options.format)||options.includeSnapshot&&options.format!=='zip')throw new Error('Formato de exportación no válido.');
  const source=await call('getDatabaseResearchExportSource',id) as {version:number;report:DatabaseResearchReport;exportDetail?:Omit<DatabaseResearchRunDetail,'report'>;sourcePacks?:MobileDatabaseSourcePack[]};
  if(source?.version!==1||source.report?.id!==id)throw new Error('No se pudo abrir el informe que quieres exportar.');
  const report=source.report,extension=options.format==='markdown'?'md':options.format;
  const filename=`${report.title.replace(/[^\w\-. ]+/g,'').trim().slice(0,150)||'database-research'}.${extension}`;
  if(options.format==='pdf')return call('surfaceExportPDF',{reportId:id,filename,html:renderProfessionalReportHtml(databaseResearchReportDocument(report))});
  let bytes:Uint8Array;
  if(options.format==='markdown')bytes=new TextEncoder().encode(redactDatabaseResearchMarkdown(report.markdown));
  else if(options.format==='docx')bytes=await (await import('@shared/markdownDocx')).markdownToDocxBytes(redactDatabaseResearchMarkdown(report.markdown));
  else {
    if(!source.exportDetail)throw new Error('Esta copia no conserva el archivo reproducible. Descarga de nuevo el informe mientras el Mac esté conectado.');
    const detail:DatabaseResearchRunDetail={...source.exportDetail,report};
    if(detail.run.id!==report.runId)throw new Error('El archivo reproducible no pertenece a este informe.');
    let snapshots;
    if(options.includeSnapshot) {
      const ids=Array.isArray(detail.run.options.databaseIds)?detail.run.options.databaseIds.map(String):[detail.run.databaseId];
      let packs=source.sourcePacks;
      if(!packs) {
        try {packs=[await call('getMobileDatabaseResearchSourcePack',{databaseIds:ids})];}
        catch(error) {if((error as {code?:string})?.code!=='offline')throw error;const copy=await call('getDatabaseResearchOfflineSource',{databaseIds:ids});if(copy?.version!==1||!Array.isArray(copy.packs))throw new Error('invalid_database_source_copy');packs=copy.packs;}
      }
      const sources=mobileDatabaseSources(packs!,ids),views=new Set(Array.isArray(detail.run.options.viewIds)?detail.run.options.viewIds.map(String):[]);
      const filters=detail.run.options.filters as {query?:string;columnIds?:string[]}|undefined;
      const host=mobileDatabaseResearchHost(new MobileDatabaseResearchRepository(detail),sources,async()=>{throw new Error('Export does not execute an analysis');});
      snapshots=sources.map(item=>host.captureSnapshot(item.database.id,{maxRows:Number(detail.run.budget.maxRows??500_000)},undefined,{viewId:item.views.find(view=>views.has(view.id))?.id??null,query:filters?.query??'',columnIds:filters?.columnIds?.filter(id=>item.columns.some(column=>column.id===id))??[]}));
      if(snapshots.length>1) {
        const targets=new Set(snapshots.flatMap(snapshot=>snapshot.rows.map(row=>row.id)));
        for(const snapshot of snapshots) {snapshot.relationEdges=host.relationEdges(snapshot.databaseId,snapshot.rows,undefined,targets);snapshot.hash=rehashDatabaseResearchSnapshot(snapshot);}
      }
    }
    const {zip,strToU8}=await import('fflate');
    const files=databaseResearchArchiveFiles(report,detail,options,snapshots);
    const entries:Zippable={};let total=0;
    for(const [name,text] of Object.entries(files)) {
      const data=strToU8(text);total+=data.byteLength;
      if(total>20_000_000)throw new Error('El archivo reproducible supera el límite temporal del móvil.');
      entries[name]=[data,{mtime:new Date('1980-01-01T00:00:00Z')}];
    }
    bytes=await new Promise<Uint8Array>((resolve,reject)=>zip(entries,{level:6},(error,data)=>error?reject(error):resolve(data)));
  }
  return call('surfaceExportFile',{reportId:id,filename,base64:base64(bytes),sha256:bytesToHex(sha256(bytes))});
}
