import type {DatabaseSummary} from './databases';
import {validateDatabaseResearchSources} from './databaseResearchSourceValidation';
import type {DatabaseSavedView} from './databaseFilters';
import {
  normalizeDatabaseDeepResearchJobInput,autoConfigureDatabaseDeepResearch,normalizeDatabaseDeepResearchReportType,estimateDatabaseDeepResearchCost,
  type DatabaseDeepResearchJobInput,type DatabaseResearchRunDetail,type DatabaseResearchReport,
} from './databaseDeepResearch';
import {rehashDatabaseResearchSnapshot,sha256Snapshot,type DatabaseResearchRepository,type DatabaseResearchHost,type DatabaseResearchSource} from './databaseResearchEngine';

export interface MobileDatabaseSourcePack {
  version:1; vaultId:string; capturedAt:string; id:string; signature:string;
  databases:Array<DatabaseResearchSource & {database:DatabaseSummary;views:DatabaseSavedView[];viewRows:Record<string,string[]>;profiles?:Record<string,{filled?:number;fillRate?:number;distinct?:number;valueType?:string}>}>;
}
export function databaseSourcePackPayload(pack:MobileDatabaseSourcePack) {
  return {version:pack.version,vaultId:pack.vaultId,capturedAt:pack.capturedAt,databases:pack.databases};
}
/** Hashes detect damaged downloads. Authenticity is verified by the owning Mac
 * against its signing key when a device result is published. */
export function validateMobileDatabaseSourcePack(pack:MobileDatabaseSourcePack):void {
  if(!pack||pack.version!==1||!pack.vaultId||!Number.isFinite(Date.parse(pack.capturedAt))||!Array.isArray(pack.databases)||!pack.databases.length||pack.databases.length>30||!/^[a-f0-9]{64}$/.test(pack.signature)||pack.id!==sha256Snapshot(databaseSourcePackPayload(pack))) throw new Error('invalid_database_source_pack');
  const seen=new Set<string>();
  for(const source of pack.databases) {
    const snapshot=source.snapshot;if(!snapshot||!snapshot.databaseId||seen.has(snapshot.databaseId)||!Array.isArray(source.columns)||!Array.isArray(source.views)||source.viewId!==null||source.viewRevision!==null||snapshot.truncated||snapshot.rowCount!==snapshot.totalRowCount||snapshot.rowCount!==snapshot.rows?.length||snapshot.rowCount>500_000||snapshot.hash!==rehashDatabaseResearchSnapshot(snapshot)) throw new Error('incomplete_database_source_pack');
    if(source.database?.id!==snapshot.databaseId||source.database.rowCount!==snapshot.rowCount)throw new Error('invalid_database_source_metadata');
    seen.add(snapshot.databaseId);
    const rows=new Set<string>(),columns=new Set<string>();
    for(const column of source.columns) {if(!column.id||column.databaseId!==snapshot.databaseId||columns.has(column.id))throw new Error('invalid_database_source_columns');columns.add(column.id);}
    for(const row of snapshot.rows) {if(!row.id||row.databaseId!==snapshot.databaseId||rows.has(row.id)||!row.cells||Object.keys(row.cells).some(id=>!columns.has(id)))throw new Error('invalid_database_source_rows');rows.add(row.id);}
    const views=new Set<string>();
    for(const view of source.views) {
      const selected=source.viewRows?.[view.id];
      if(view.databaseId!==snapshot.databaseId||views.has(view.id)||!Array.isArray(selected)||new Set(selected).size!==selected.length||selected.some(id=>!rows.has(id)))throw new Error('invalid_database_source_view');
      views.add(view.id);
    }
    if(!source.viewRows||Object.keys(source.viewRows).some(id=>!views.has(id)))throw new Error('invalid_database_source_view');
    for(const edge of snapshot.relationEdges) if(!rows.has(edge.source)||!columns.has(edge.columnId)||typeof edge.targetExists!=='boolean')throw new Error('invalid_database_source_relation');
  }
  if(new TextEncoder().encode(JSON.stringify(pack)).length>16_000_000)throw new Error('database_source_pack_too_large');
}
export function mobileDatabaseSources(packs:MobileDatabaseSourcePack[],databaseIds:string[]) {
  const sources=new Map<string,MobileDatabaseSourcePack['databases'][number]>();
  for(const pack of packs) {validateMobileDatabaseSourcePack(pack);for(const source of pack.databases) if(!sources.has(source.snapshot.databaseId))sources.set(source.snapshot.databaseId,source);}
  return databaseIds.map(id=>{const source=sources.get(id);if(!source)throw new Error(`La base ${id} no está descargada para investigar.`);return structuredClone(source);});
}
export function mobileDatabaseResearchHost(repository:DatabaseResearchRepository,sources:ReturnType<typeof mobileDatabaseSources>,analyze:DatabaseResearchHost['analyze']):DatabaseResearchHost {
  const source=(id:string)=>{const value=sources.find(item=>item.snapshot.databaseId===id);if(!value)throw new Error('database_source_unavailable');return value;};
  const edges:DatabaseResearchHost['relationEdges']=(id,rows,columnId,allowed)=>{
    const owners=new Set(rows.map(row=>row.id)),targets=allowed??owners;
    return source(id).snapshot.relationEdges.filter(edge=>owners.has(edge.source)&&(!columnId||edge.columnId===columnId)).map(edge=>({...edge,targetInScope:targets.has(edge.target)}));
  };
  return {repository,probeKind:'device-downloads',readColumns:id=>source(id).columns,listViews:id=>source(id).views,relationEdges:edges,
    immutable:(ids,capture)=>({rowCounts:Object.fromEntries(ids.map(id=>[id,source(id).snapshot.totalRowCount])),value:capture()}),
    captureSnapshot:(id,budget,_deps,scope)=>{
      const value=source(id),view=scope.viewId?value.views.find(item=>item.id===scope.viewId):null;if(scope.viewId&&!view)throw new Error('database_view_unavailable');
      const query=String(scope.query??'').trim().toLocaleLowerCase(),search=new Set(scope.columnIds?.length?scope.columnIds:value.columns.map(column=>column.id));
      // SQLite owns saved-view filtering, grouping and ordering. Signed row
      // identities retain that exact result, including ties and empty values.
      const byId=new Map(value.snapshot.rows.map(row=>[row.id,row]));
      const selected=view?value.viewRows[view.id].map(id=>byId.get(id)!):value.snapshot.rows;
      const matching=selected.filter(row=>!query||[...search].some(id=>String(row.cells[id]??'').toLocaleLowerCase().includes(query)));
      const rows=structuredClone(matching.slice(0,Math.max(1,Math.min(500_000,Math.floor(budget.maxRows??500_000)))));
      const snapshot={...value.snapshot,rows,totalRowCount:matching.length,rowCount:rows.length,truncated:rows.length<matching.length,relationEdges:edges(id,rows)};
      snapshot.hash=rehashDatabaseResearchSnapshot(snapshot);return snapshot;
    },
    prepareAnalysis:items=>({input:index=>({readSnapshot:()=>items[index].snapshot,readColumns:()=>items[index].columns}),close:()=>{}}),analyze};
}

/** Durable hosts persist this complete detail between provider/worker stages. */
export class MobileDatabaseResearchRepository implements DatabaseResearchRepository {
  constructor(public detail:DatabaseResearchRunDetail,private now:()=>string=()=>new Date().toISOString()){}
  private own(id:string){if(this.detail.run.id!==id)throw new Error('database_run_unavailable');return this.detail.run;}
  getDatabaseResearchRun:DatabaseResearchRepository['getDatabaseResearchRun']=id=>id===this.detail.run.id?this.detail.run:null;
  getDatabaseResearchRunDetail:DatabaseResearchRepository['getDatabaseResearchRunDetail']=id=>id===this.detail.run.id?this.detail:null;
  updateDatabaseResearchRun:DatabaseResearchRepository['updateDatabaseResearchRun']=(id,patch)=>{
    const run=this.own(id);if(patch.expectedRevision!=null&&patch.expectedRevision!==run.revision)throw new Error('database_run_conflict');
    const {expectedRevision,...values}=patch;Object.assign(run,values,{revision:run.revision+1,updatedAt:this.now()});return run;
  };
  updateDatabaseResearchProgress:DatabaseResearchRepository['updateDatabaseResearchProgress']=(id,patch)=>{
    const run=this.own(id);if(!['cancelled','cancelling'].includes(run.status))Object.assign(run,{status:patch.status??run.status,phase:patch.phase??patch.step??run.phase,currentStep:patch.step??run.currentStep,progress:Math.max(0,Math.min(1,patch.progress??run.progress)),error:patch.error??run.error,updatedAt:this.now(),revision:run.revision+1});
    return {runId:id,status:run.status,phase:run.phase,step:run.currentStep,progress:run.progress,message:patch.message??null,error:run.error};
  };
  finalizeDatabaseResearchCancellation:DatabaseResearchRepository['finalizeDatabaseResearchCancellation']=id=>{const run=this.own(id);if(run.status!=='cancelling')return false;Object.assign(run,{status:'cancelled',completedAt:this.now(),updatedAt:this.now(),revision:run.revision+1});return true;};
  markDatabaseResearchRunStale:DatabaseResearchRepository['markDatabaseResearchRunStale']=(id,reason)=>{const run=this.own(id);if(run.status!=='running')return false;Object.assign(run,{status:'stale',error:reason??'La ejecución no ha informado progreso.',revision:run.revision+1,updatedAt:this.now()});return true;};
  failDatabaseResearchRun:DatabaseResearchRepository['failDatabaseResearchRun']=(id,error)=>{const run=this.own(id);if(run.status==='cancelling')this.finalizeDatabaseResearchCancellation(id);else if(['queued','running'].includes(run.status))Object.assign(run,{status:'failed',error,completedAt:this.now(),updatedAt:this.now(),revision:run.revision+1});return run;};
  upsertDatabaseResearchStep:DatabaseResearchRepository['upsertDatabaseResearchStep']=input=>{
    this.own(input.runId);const existing=this.detail.steps.find(step=>step.kind===input.kind&&step.ordinal===input.ordinal),timestamp=this.now();
    const value={id:input.id??existing?.id??`${input.runId}:${input.kind}:${input.ordinal}`,runId:input.runId,kind:input.kind,ordinal:input.ordinal,status:input.status??'queued',progress:input.progress??0,message:input.message??null,input:input.input??{},output:input.output??{},task:input.task??null,agent:input.agent??null,params:input.params??{},resultHash:input.resultHash??null,seed:input.seed??null,durationMs:input.durationMs??null,error:input.error??null,startedAt:input.startedAt??null,completedAt:input.completedAt??null,createdAt:existing?.createdAt??timestamp,updatedAt:timestamp};
    if(existing)Object.assign(existing,value);else this.detail.steps.push(value);return existing??value;
  };
  saveDatabaseResearchClaim:DatabaseResearchRepository['saveDatabaseResearchClaim']=input=>{this.own(input.runId);const existing=this.detail.claims.find(item=>item.id===input.id),claim={...input,createdAt:existing?.createdAt??this.now()};if(existing)Object.assign(existing,claim);else this.detail.claims.push(claim);return existing??claim;};
  saveDatabaseResearchReport:DatabaseResearchRepository['saveDatabaseResearchReport']=input=>{
    const run=this.own(input.runId);if(['cancelled','cancelling','failed','stale'].includes(run.status))throw new Error('database_run_terminal');
    const {finalStatus,...content}=input,stamp=this.now();const report:DatabaseResearchReport={...content,reportType:run.reportType,readAt:this.detail.report?.readAt??null,createdAt:this.detail.report?.createdAt??stamp,updatedAt:stamp};
    this.detail.report=report;Object.assign(run,{status:finalStatus??'completed',progress:1,phase:'done',reportId:report.id,completedAt:stamp,updatedAt:stamp,revision:run.revision+1});return report;
  };
}
export function createMobileDatabaseResearchDetail(id:string,raw:DatabaseDeepResearchJobInput,sources:ReturnType<typeof mobileDatabaseSources>,stamp=new Date().toISOString()):DatabaseResearchRunDetail {
  const input=normalizeDatabaseDeepResearchJobInput(raw);if(!input.model)throw new Error('Selecciona un modelo del móvil.');
  if(input.databaseIds.length!==sources.length||input.databaseIds.some(id=>!sources.some(source=>source.snapshot.databaseId===id)))throw new Error('invalid_database_source_selection');
  const knownColumns=new Set(sources.flatMap(source=>source.columns.map(column=>column.id))),knownViews=new Set(sources.flatMap(source=>source.views.map(view=>view.id)));
  if(input.viewIds.some(id=>!knownViews.has(id))||input.filters.columnIds.some(id=>!knownColumns.has(id))||Object.values(input.roles).flatMap(value=>Array.isArray(value)?value:value?[value]:[]).some(id=>!knownColumns.has(id))||sources.some(source=>source.views.filter(view=>input.viewIds.includes(view.id)).length>1))throw new Error('invalid_database_research_roles_or_views');
  const columns=sources.flatMap(source=>source.columns),schema=columns.map(column=>({...column,profile:sources.find(source=>source.snapshot.databaseId===column.databaseId)?.profiles?.[column.id]}));
  const configuration=input.autoConfigure?autoConfigureDatabaseDeepResearch(input.requestedReportType??input.reportType??'general',{columns:schema,roles:input.roles,databaseCount:sources.length,objective:input.objective},input.roles):{requestedReportType:input.requestedReportType??input.reportType??'general',reportType:normalizeDatabaseDeepResearchReportType(input.reportType),roles:input.roles,confidence:1,warnings:[],limitations:[],partial:false};
  validateDatabaseResearchSources({...input,reportType:configuration.reportType,roles:configuration.roles},sources.map(source=>({id:source.database.id,columns:source.columns,views:source.views})));
  const estimate=estimateDatabaseDeepResearchCost(sources.reduce((sum,source)=>sum+source.snapshot.rowCount,0),sources.length,input.depth);
  if(input.budget?.maxCostUsd!=null&&estimate.estimatedCostUsd>input.budget.maxCostUsd)throw new Error('El coste estimado supera el límite configurado.');
  const budget={maxRows:input.budget?.maxRows,maxSteps:input.budget?.maxTasks,maxBootstrapIterations:input.budget?.resamples,maxPermutationIterations:input.budget?.resamples,rounds:input.budget?.rounds,depth:input.depth,seed:input.budget?.seed,maxCostUsd:input.budget?.maxCostUsd,estimatedCostUsd:estimate.estimatedCostUsd};
  const options={...input,reportType:configuration.reportType,roles:configuration.roles,autoConfiguration:configuration,budget};
  return {run:{id,databaseId:input.databaseIds[0],objective:input.objective,title:input.objective.slice(0,120),language:input.language??'es',model:input.model,provider:input.model.provider,reportType:configuration.reportType,options,request:{...input},plan:{},snapshotManifest:{},snapshotFingerprint:null,budget,revision:1,status:'queued',progress:0,phase:null,currentStep:null,error:null,reportId:null,createdAt:stamp,startedAt:null,completedAt:null,updatedAt:stamp},steps:[],claims:[],report:null};
}
