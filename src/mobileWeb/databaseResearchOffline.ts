import {autoConfigureDatabaseDeepResearch,normalizeDatabaseDeepResearchJobInput,normalizeDatabaseDeepResearchReportType,getDatabaseDeepResearchEligibility,getDatabaseDeepResearchAnalysisRequirements,DATABASE_DEEP_RESEARCH_REPORT_TYPES,estimateDatabaseDeepResearchCost,type DatabaseDeepResearchJobInput} from '@shared/databaseDeepResearch';
import {buildDatabaseDeepResearchPreviewSections} from '@shared/databaseDeepResearchPrompts';
import {mobileDatabaseSources,type MobileDatabaseSourcePack} from '@shared/mobileDatabaseResearch';

export const databaseOfflineComposerMethods=new Set(['listDatabases','getDatabaseDetail','listDatabaseRows','listDatabaseViews','previewDatabaseDeepResearch']);
export async function databaseOfflineComposer(call:(method:string,...args:any[])=>Promise<any>,method:string,args:any[]) {
  if(method==='previewDatabaseDeepResearch') {
    const input=normalizeDatabaseDeepResearchJobInput(args[0] as DatabaseDeepResearchJobInput),copy=await call('getDatabaseResearchOfflineSource',{databaseIds:input.databaseIds});
    if(copy?.version!==1||!Array.isArray(copy.packs))throw new Error('invalid_database_source_copy');
    const sources=mobileDatabaseSources(copy.packs as MobileDatabaseSourcePack[],input.databaseIds);
    const schema=sources.flatMap(source=>source.columns.map(column=>({...column,profile:source.profiles?.[column.id]})));
    const requested=input.requestedReportType??input.reportType??'general';
    const configuration=input.autoConfigure?autoConfigureDatabaseDeepResearch(requested,{columns:schema,roles:input.roles,databaseCount:sources.length,objective:input.objective},input.roles):{requestedReportType:requested,reportType:normalizeDatabaseDeepResearchReportType(input.reportType),roles:input.roles,confidence:1,warnings:[],limitations:[],partial:false};
    const available=DATABASE_DEEP_RESEARCH_REPORT_TYPES.map(type=>getDatabaseDeepResearchEligibility(type,{columns:schema,roles:configuration.roles,databaseCount:sources.length}));
    const eligibility=available.find(item=>item.reportType===configuration.reportType),analyses=getDatabaseDeepResearchAnalysisRequirements(configuration.reportType);
    const rowCount=sources.reduce((sum,source)=>sum+source.snapshot.rowCount,0),estimate=estimateDatabaseDeepResearchCost(rowCount,sources.length,input.depth);
    const evidence=sources.flatMap(source=>source.snapshot.rows.slice(0,8).map((_,index)=>({id:`${source.snapshot.databaseId}:sample:${index}`,label:'Muestra redactada',excerpt:'Valores de celdas omitidos por privacidad; solo se muestra evidencia agregada tras ejecutar la investigación.',databaseName:source.snapshot.databaseName})));
    return {requestedReportType:requested,reportType:configuration.reportType,resolvedReportType:configuration.reportType,suggestedRoles:configuration.roles,confidence:configuration.confidence,warnings:configuration.warnings,limitations:configuration.limitations,preflight:{ok:Boolean(eligibility?.applicable),partial:configuration.partial,warnings:configuration.warnings},eligibility,availableReportTypes:available,rowCount,sourceCount:sources.length,...estimate,requiredAnalyses:analyses.required,optionalAnalyses:analyses.optional,sections:buildDatabaseDeepResearchPreviewSections(input.language??'en',configuration.reportType,input.objective,evidence.length),evidence};
  }
  const catalogue=await call('getDatabaseResearchOfflineCatalogue');if(!Array.isArray(catalogue))throw new Error('invalid_database_offline_catalogue');
  if(method==='listDatabases')return catalogue.map(source=>source.database);
  const source=catalogue.find(value=>value.database?.id===args[0]);if(!source)throw new Error('Esta base de datos no está descargada para investigar.');
  if(method==='getDatabaseDetail')return {database:source.database,columns:source.columns};
  if(method==='listDatabaseViews')return source.views;
  const copy=await call('getDatabaseResearchOfflineSource',{databaseIds:[args[0]]});
  return mobileDatabaseSources(copy.packs,[args[0]])[0].snapshot.rows.slice(0,Math.max(1,Math.min(500,Number(args[1]?.limit??120))));
}
