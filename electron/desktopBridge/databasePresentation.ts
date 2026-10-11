import {getDb} from '../db/database';
import {getDatabaseDetail,listViews,queryDatabaseRows,queryDatabaseChart,queryDatabaseMap,queryDatabaseFeed,queryDatabaseTemporalEvents} from '../db/databasesRepo';
import {assertFilterNode,type DatabaseRowQuery} from '../../shared/databaseQuery';
import type {DatabaseChartQuery,DatabaseMapQuery,DatabaseFeedQuery} from '../../shared/databaseVisualization';
import type {DatabaseTemporalQuery} from '../../shared/databaseTemporal';
import {companionDerivedDatabaseIds} from '../../shared/companionDatabaseDerived';

const fields:Record<string,readonly string[]>={
  metadata:['databaseId'],
  sourceRows:['databaseId','cursor','limit'],
  rows:['databaseId','viewId','filter','sorts','groups','cursor','limit','direction','rowSort'],
  chart:['databaseId','xColumnId','yColumnId','seriesColumnId','aggregation','type','filter','limit'],
  map:['databaseId','locationColumnId','filter','limit'],
  feed:['databaseId','dateColumnId','includePageChanges','filter','limit'],
  temporal:['databaseId','startColumnId','endColumnId','dependencyColumnId','windowStart','windowEnd','timeZone','filter','limit'],
};
/** This read lane calls the same typed repositories as Desktop, under the
 * actual owning vault. It never grants the WebView arbitrary IPC or SQL. */
export function mobileDatabasePresentationRead(vaultId:string,raw:unknown){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_database_presentation');
  const request=raw as Record<string,unknown>;
  if(Object.keys(request).some(key=>!['action','input'].includes(key))||typeof request.action!=='string'||!Object.hasOwn(fields,request.action))throw new Error('invalid_database_presentation');
  const action=request.action,input=request.input as Record<string,unknown>;
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!fields[action].includes(key)))throw new Error('invalid_database_presentation');
  if(typeof input.databaseId!=='string'||!input.databaseId||input.databaseId.length>1024)throw new Error('invalid_database_identity');
  if(Buffer.byteLength(JSON.stringify(raw),'utf8')>256*1024)throw new Error('request_too_large');
  for(const key of ['viewId','xColumnId','yColumnId','seriesColumnId','locationColumnId','dateColumnId','startColumnId','endColumnId','dependencyColumnId','cursor','windowStart','windowEnd','timeZone']){
    if(input[key]!=null&&(typeof input[key]!=='string'||(input[key] as string).length>8192))throw new Error('invalid_database_presentation');
  }
  if(input.limit!=null&&(typeof input.limit!=='number'||!Number.isFinite(input.limit)||input.limit<1||input.limit>500))throw new Error('invalid_database_limit');
  if(input.filter!=null)assertFilterNode(input.filter);
  if(input.includePageChanges!=null&&typeof input.includePageChanges!=='boolean')throw new Error('invalid_database_presentation');
  if(action==='chart'&&(!['count','sum','average','min','max'].includes(String(input.aggregation))||!['bar','line','area','donut','scatter'].includes(String(input.type))))throw new Error('invalid_database_chart');
  if(action==='rows'){
    for(const key of ['sorts','groups'])if(input[key]!=null){
      if(!Array.isArray(input[key])||input[key].length>64)throw new Error('invalid_database_sort');
      for(const rule of input[key] as unknown[]){
        if(!rule||typeof rule!=='object'||Array.isArray(rule)||Object.keys(rule).some(key=>!['columnId','dir'].includes(key)))throw new Error('invalid_database_sort');
        const row=rule as {columnId?:unknown;dir?:unknown};if(typeof row.columnId!=='string'||!row.columnId||row.columnId.length>1024||(row.dir!=null&&!['asc','desc'].includes(String(row.dir))))throw new Error('invalid_database_sort');
      }
    }
    if(input.direction!=null&&!['forward','backward'].includes(String(input.direction)))throw new Error('invalid_database_direction');
    if(input.rowSort!=null&&!['position','createdAsc','createdDesc','updatedDesc'].includes(String(input.rowSort)))throw new Error('invalid_database_sort');
  }
  const databaseId=input.databaseId;
  const detail=getDatabaseDetail(databaseId);if(!detail)throw new Error('database_not_found');
  let data:unknown;
  switch(action){
    case 'metadata': {
      const {revision}=getDb().prepare('SELECT revision FROM db_databases WHERE id=?').get(databaseId) as {revision:number};
      const columnRevisions=Object.fromEntries((getDb().prepare('SELECT id,revision FROM db_columns WHERE database_id=?').all(databaseId) as Array<{id:string;revision:number}>).map(column=>[column.id,column.revision]));
      data={...detail,views:listViews(databaseId),revision,columnRevisions,derivedDatabaseIds:companionDerivedDatabaseIds(detail.columns)};break;
    }
    case 'sourceRows': {
      const page=queryDatabaseRows({databaseId,cursor:input.cursor as string|null|undefined,limit:input.limit as number|undefined},{readOnly:true});
      const ids=page.rows.map(row=>row.id),pages:Record<string,unknown>={},dependencies:Record<string,Record<string,string[]>>={};
      if(ids.length){
        const placeholders=ids.map(()=>'?').join(',');
        for(const row of getDb().prepare(`SELECT id,row_id,title,updated_at FROM pages WHERE state='active' AND row_id IN (${placeholders}) ORDER BY id`).all(...ids) as Array<{id:string;row_id:string;title:string;updated_at:string}>){
          pages[row.row_id]={id:row.id,title:row.title,updatedAt:row.updated_at};
        }
        for(const row of getDb().prepare(`SELECT row_id,column_id,target_id FROM db_relations WHERE target_kind='db_row' AND row_id IN (${placeholders}) ORDER BY position,id`).all(...ids) as Array<{row_id:string;column_id:string;target_id:string}>){
          const columns=dependencies[row.row_id]??={};(columns[row.column_id]??=[]).push(row.target_id);
        }
      }
      const relations=ids.length?getDb().prepare(`SELECT id,row_id,column_id,target_kind,target_id,position,created_at FROM db_relations WHERE row_id IN (${ids.map(()=>'?').join(',')}) ORDER BY row_id,position,id`).all(...ids):[];
      data={...page,pages,dependencies,relations};break;
    }
    case 'rows':data=queryDatabaseRows(input as unknown as DatabaseRowQuery,{readOnly:true});break;
    case 'chart':data=queryDatabaseChart(input as unknown as DatabaseChartQuery);break;
    case 'map':data=queryDatabaseMap(input as unknown as DatabaseMapQuery);break;
    case 'feed':data=queryDatabaseFeed(input as unknown as DatabaseFeedQuery);break;
    case 'temporal':data=queryDatabaseTemporalEvents(input as unknown as DatabaseTemporalQuery);break;
  }
  return {version:1,vaultId,databaseId,action,data};
}
