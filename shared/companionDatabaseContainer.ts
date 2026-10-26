import {combinedDatabaseContainerFilter,type DatabaseContainerDefinition,type DatabaseContainerRow} from './databaseSources';
import {queryCompanionDatabasePresentation,type CompanionDatabasePresentationSource} from './companionDatabasePresentation';
import {assertFilterNode,type FilterNode} from './databaseQuery';
import {canonicalJson} from './canonicalJson';
export {prepareCompanionDatabaseDerived} from './companionDatabaseDerived';

export async function queryCompanionDatabaseContainer(input:{version:1;vaultId:string;viewId:string;definition:DatabaseContainerDefinition;
  sources:Record<string,CompanionDatabasePresentationSource>;sourceId?:string|null;localFilter?:FilterNode|null}) {
  if(input.version!==1||!input.vaultId||!input.viewId||input.definition.viewId!==input.viewId)throw new Error('La copia no corresponde a esta vista.');
  if(input.localFilter)assertFilterNode(input.localFilter);
  const definition=input.definition,primary=definition.sources.find(source=>source.primary)??definition.sources[0];
  if(!primary)throw new Error('Esta vista no tiene una fuente primaria.');
  const view=input.sources[primary.databaseId]?.views.find(view=>view.id===input.viewId);
  if(!view)throw new Error('La configuración guardada no está incluida en la copia. Actualiza la descarga.');
  if(view.databaseId!==primary.databaseId||definition.revision!==view.revision+definition.sources.reduce((sum,source)=>sum+source.revision,0))throw new Error('La vista cambió durante la descarga. Actualiza la copia completa.');
  const inverse=new Map(Object.entries(primary.propertyMap).map(([canonical,column])=>[column,canonical]));
  const sources=input.sourceId?definition.sources.filter(source=>source.sourceId===input.sourceId):definition.sources;
  if(input.sourceId&&!sources.length)throw new Error('La fuente no pertenece a esta vista.');
  const rows:DatabaseContainerRow[]=[];const revisions:unknown[]=[];
  for(const source of sources) {
    const captured=input.sources[source.databaseId];
    if(!captured||captured.vaultId!==input.vaultId||captured.databaseId!==source.databaseId)throw new Error('Falta una fuente vinculada en la copia. Descarga de nuevo la vista completa.');
    const columns=new Set(captured.columns.map(column=>column.id));
    if(Object.values(source.propertyMap).some(column=>!columns.has(column)))throw new Error('Las propiedades vinculadas cambiaron durante la descarga. Actualiza la copia completa.');
    const translated=combinedDatabaseContainerFilter(view.config.filter,input.localFilter,source,inverse);
    revisions.push([source.sourceId,source.revision,captured.revision,captured.localRevision??null]);
    if(translated.kind==='false')continue;
    const sorts=view.config.sorts.flatMap(sort=>{const canonical=inverse.get(sort.columnId)??sort.columnId,columnId=source.propertyMap[canonical];return columnId?[{columnId,dir:sort.dir}]:[];});
    const page=await queryCompanionDatabasePresentation(captured,'allRows',{databaseId:source.databaseId,filter:translated.kind==='node'?translated.node:null,sorts});
    if(!('rows' in page))throw new Error('Respuesta de filas no válida.');
    for(const row of page.rows) {
      const cells:Record<string,string|null>={},formulaErrors:Record<string,string>={},formulaColors:Record<string,string>={};
      for(const [canonical,columnId] of Object.entries(source.propertyMap)){
        cells[canonical]=row.cells[columnId]??row.rollups?.[columnId]??null;
        if(row.formulaErrors?.[columnId])formulaErrors[canonical]=row.formulaErrors[columnId];
        if(row.formulaColors?.[columnId])formulaColors[canonical]=row.formulaColors[columnId];
      }
      rows.push({id:`${source.sourceId}:${row.id}`,sourceId:source.sourceId,databaseId:source.databaseId,rowId:row.id,sourceName:source.alias,cells,
        formulaErrors,formulaColors,
        createdAt:row.createdAt,updatedAt:row.updatedAt,revision:row.revision??1});
    }
  }
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson({definition,revisions,sourceId:input.sourceId??null,localFilter:input.localFilter??null})));
  const revision='offline:'+Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
  return {version:1,vaultId:input.vaultId,viewId:input.viewId,definition,rows,revision};
}
