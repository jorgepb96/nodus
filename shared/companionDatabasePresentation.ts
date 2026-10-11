import type {DatabaseColumn,DatabaseRow,DatabaseSummary} from './databases';
import {operatorsForColumn,type DatabaseSavedView,type SortRule} from './databaseFilters';
import {comparableType} from './databaseFormula';
import {assertFilterNode,type FilterNode,type DatabaseRowQuery} from './databaseQuery';
import {decodeDatabaseDate} from './databaseProperties';
import {expandDatabaseDateOccurrences,type DatabaseTemporalEvent,type DatabaseTemporalQuery} from './databaseTemporal';
import type {DatabaseChartPoint,DatabaseChartQuery,DatabaseMapQuery,DatabaseMapMarker,DatabaseFeedItem,DatabaseFeedQuery} from './databaseVisualization';
import {canonicalJson} from './canonicalJson';
import {computeFormulas} from './databaseFormulaEval';

/** Complete selected data, never a first-page sample. Row values are the actual
 * Desktop query projection, including derived and metadata properties. */
export interface CompanionDatabasePresentationSource {
  version:1;vaultId:string;databaseId:string;database:DatabaseSummary;columns:DatabaseColumn[];views:DatabaseSavedView[];
  revision:number;rows:DatabaseRow[];
  pages:Record<string,{id:string;title:string;updatedAt:string}>;
  dependencies:Record<string,Record<string,string[]>>;
  localChanges?:boolean;
  localRevision?:string;
  columnRevisions?:Record<string,number>;
}
function filtered(source:CompanionDatabasePresentationSource,filter?:FilterNode|null){
  if(filter)assertFilterNode(filter);
  const columns=new Map(source.columns.map(column=>[column.id,column]));
  const validate=(node:FilterNode):void=>{
    if(node.type==='group'){node.children.forEach(validate);return;}
    const column=columns.get(node.columnId);if(!column||!operatorsForColumn(column).includes(node.op))throw new Error('El filtro no corresponde a una propiedad de esta vista.');
  };if(filter)validate(filter);
  const active=(node:FilterNode):boolean=>node.type==='condition'||node.children.some(active);
  const matches=(row:DatabaseRow,node:FilterNode):boolean=>{
    if(node.type==='group'){
      const children=node.children.filter(active);return !children.length||(node.operator==='and'?children.every(child=>matches(row,child)):children.some(child=>matches(row,child)));
    }
    const column=columns.get(node.columnId);if(!column)throw new Error('La propiedad del filtro ya no existe.');
    if(!operatorsForColumn(column).includes(node.op))throw new Error('El filtro no corresponde a esta propiedad.');
    return sqliteCondition(column,row,node);
  };
  return filter?source.rows.filter(row=>matches(row,filter)):source.rows.slice();
}
function column(source:CompanionDatabasePresentationSource,id:string|null|undefined,type?:string){
  const value=source.columns.find(column=>column.id===id);
  if(!value||(type&&value.type!==type))throw new Error('La vista hace referencia a una propiedad que ya no existe.');return value;
}
function limit(value:number|undefined,maximum:number){
  if(value!=null&&(!Number.isFinite(value)||value<1))throw new Error('Límite de consulta no válido.');
  return Math.max(1,Math.min(maximum,Math.floor(value??maximum)));
}
// Match SQLite CAST AS REAL, including historical text in numeric properties.
function number(raw:string|null|undefined):number|null{
  if(raw==null)return null;
  const prefix=raw.trimStart().match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);return prefix?Number(prefix[0]):0;
}
function label(column:DatabaseColumn,raw:string){
  if(!raw)return 'Sin valor';
  if(['select','status'].includes(column.type))return column.options.find(option=>option.id===raw)?.label??raw;
  if(column.type==='checkbox')return raw==='1'||raw==='true'?'Sí':'No';
  if(column.type==='date')return decodeDatabaseDate(raw)?.start??raw;return raw;
}
function drilldown(column:DatabaseColumn,raw:string):FilterNode{
  if(!raw)return {type:'condition',columnId:column.id,op:'isEmpty',value:null};
  const operators=operatorsForColumn(column);
  if(operators.includes('isAnyOf'))return {type:'condition',columnId:column.id,op:'isAnyOf',value:[raw]};
  if(operators.includes('equals'))return {type:'condition',columnId:column.id,op:'equals',value:raw};
  if(operators.includes('isChecked'))return {type:'condition',columnId:column.id,op:raw==='1'||raw==='true'?'isChecked':'isUnchecked',value:null};
  return {type:'condition',columnId:column.id,op:'notEmpty',value:null};
}
const binary=(left:string,right:string)=>{
  const a=Array.from(left),b=Array.from(right);for(let index=0;index<Math.min(a.length,b.length);index++){const difference=a[index].codePointAt(0)!-b[index].codePointAt(0)!;if(difference)return difference;}return a.length-b.length;
};
const sqliteLower=(value:string)=>value.replace(/[A-Z]/g,letter=>letter.toLowerCase());
function sqliteCondition(column:DatabaseColumn,row:DatabaseRow,node:Extract<FilterNode,{type:'condition'}>):boolean{
  const raw=row.cells[column.id]??null,type=comparableType(column),empty=raw==null||raw==='';
  const metadata=['created_time','last_edited_time','created_by','last_edited_by','unique_id'].includes(column.type);
  if(type==='attachment'||type==='relation'){
    const count=type==='attachment'?row.attachments?.[column.id]?.length??0:row.relationCounts?.[column.id]??0;return node.op==='isEmpty'?count===0:count>0;
  }
  if(node.op==='isEmpty')return empty;if(node.op==='notEmpty')return !empty;
  if(type==='title'||type==='text'||type==='ai'){
    const target=String(node.value??'').toLocaleLowerCase(),haystack=raw==null?null:sqliteLower(raw);
    const match=haystack!=null&&(node.op==='contains'||node.op==='notContains'?haystack.includes(target):haystack===target);
    return node.op==='notContains'||node.op==='notEquals'?metadata?haystack!=null&&!match:!match:match;
  }
  if(type==='number'){
    const value=number(raw),target=Number(node.value);if(value==null||!Number.isFinite(target))return false;
    switch(node.op){case 'equals':return value===target;case 'notEquals':return value!==target;case 'gt':return value>target;case 'gte':return value>=target;case 'lt':return value<target;case 'lte':return value<=target;default:return false;}
  }
  if(type==='date'||type==='time'){
    let value=raw;if(!metadata&&raw){try{const json=JSON.parse(raw);value=typeof json?.start==='string'?json.start:null;}catch{/* legacy plain date */}}
    if(value==null)return false;const compare=binary(value,String(node.value??''));return node.op==='before'?compare<0:node.op==='after'?compare>0:compare===0;
  }
  if(type==='checkbox'){const checked=raw!=null&&Math.trunc(number(raw)??0)===1;return node.op==='isUnchecked'?!checked:checked;}
  const values=(Array.isArray(node.value)?node.value:node.value==null?[]:[node.value]).map(String);
  if(type==='select'){const match=raw!=null&&values.includes(raw);return node.op==='isNoneOf'?!match:match;}
  if(type==='multi_select'){
    let json:any=[];try{json=JSON.parse(raw??'[]');}catch{/* invalid historical multi select */}
    const items=(Array.isArray(json)?json:json&&typeof json==='object'?Object.values(json):[json]).map(value=>typeof value==='boolean'?value?'1':'0':value==null?'':typeof value==='object'?JSON.stringify(value):String(value));
    const match=values.some(value=>items.includes(value));return node.op==='hasAllOf'?values.every(value=>items.includes(value)):node.op==='isNoneOf'?!match:match;
  }
  return true;
}
function sqliteRowsOrder(source:CompanionDatabasePresentationSource,rows:DatabaseRow[],rules:SortRule[],rowSort:DatabaseRowQuery['rowSort'],omitPosition:boolean){
  const resolved=rules.map(rule=>({...rule,column:column(source,rule.columnId)}));
  function key(column:DatabaseColumn,row:DatabaseRow):string|number{
    const raw=row.cells[column.id]??'',type=comparableType(column);
    if(column.type==='unique_id')return row.uniqueSequence??0;
    if(type==='number')return number(raw)??0;if(type==='checkbox')return Math.trunc(number(raw)??0);
    if(type==='select')return column.options.find(option=>option.id===raw)?.position??2147483647;
    if(type==='date'||type==='time'){try{const json=JSON.parse(raw);return typeof json?.start==='string'?json.start:'';}catch{return raw;}}
    return sqliteLower(raw);
  }
  return rows.sort((a,b)=>{
    for(const rule of resolved){
      const left=a.cells[rule.column.id],right=b.cells[rule.column.id],emptyLeft=left==null||left==='',emptyRight=right==null||right==='';
      if(emptyLeft!==emptyRight)return emptyLeft?1:-1;
      const x=key(rule.column,a),y=key(rule.column,b),difference=typeof x==='number'&&typeof y==='number'?x-y:binary(String(x),String(y));if(difference)return rule.dir==='desc'?-difference:difference;
    }
    if(!rules.length&&rowSort&&rowSort!=='position'){
      const difference=rowSort==='createdAsc'?binary(a.createdAt,b.createdAt):rowSort==='createdDesc'?binary(b.createdAt,a.createdAt):binary(b.updatedAt,a.updatedAt);if(difference)return difference;
    }else if(!omitPosition&&a.position!==b.position)return a.position-b.position;
    return binary(a.id,b.id);
  });
}
function title(source:CompanionDatabasePresentationSource,row:DatabaseRow){
  const id=source.columns.find(column=>column.type==='title')?.id;return (id?row.cells[id]:null)||'Sin título';
}
function chart(source:CompanionDatabasePresentationSource,input:DatabaseChartQuery){
  const x=column(source,input.xColumnId),y=input.yColumnId?column(source,input.yColumnId):null,series=input.seriesColumnId?column(source,input.seriesColumnId):null;
  if(input.aggregation!=='count'&&!y)throw new Error('Esta agregación necesita un eje Y.');
  const groups=new Map<string,{x:string;series:string;count:number;ys:number[];xs:number[]}>();
  for(const row of filtered(source,input.filter)){
    const key=row.cells[x.id]??'',seriesKey=series?row.cells[series.id]??'':'',identity=JSON.stringify([key,seriesKey]);
    const group=groups.get(identity)??{x:key,series:seriesKey,count:0,ys:[],xs:[]};group.count++;
    const yValue=y?number(row.cells[y.id]):null,xValue=number(row.cells[x.id]);if(yValue!=null)group.ys.push(yValue);if(xValue!=null)group.xs.push(xValue);groups.set(identity,group);
  }
  const average=(values:number[])=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
  let points:DatabaseChartPoint[]=[...groups.values()].map(group=>{
    const clauses=[drilldown(x,group.x),...(series?[drilldown(series,group.series)]:[])];
    const value=input.aggregation==='count'?group.count:input.aggregation==='sum'?group.ys.reduce((a,b)=>a+b,0):input.aggregation==='average'?average(group.ys)??0:input.aggregation==='min'?group.ys.length?group.ys.reduce((a,b)=>Math.min(a,b)):0:group.ys.length?group.ys.reduce((a,b)=>Math.max(a,b)):0;
    return {key:group.x,label:label(x,group.x),seriesKey:group.series,seriesLabel:series?label(series,group.series):'',value,rowCount:group.count,xNumber:average(group.xs),yNumber:average(group.ys),drilldownFilter:clauses.length===1?clauses[0]:{type:'group',operator:'and',children:clauses}};
  });
  const ordered=['line','area','scatter'].includes(input.type);points.sort((a,b)=>(ordered?0:b.value-a.value)||binary(a.key,b.key)||binary(a.seriesKey,b.seriesKey));
  const maximum=limit(input.limit,200),totalGroups=points.length;points=points.slice(0,maximum);
  return {points,totalGroups,truncated:totalGroups>maximum,revision:source.revision,nullRows:points.filter(point=>point.key==='').reduce((sum,point)=>sum+point.rowCount,0)};
}
function map(source:CompanionDatabasePresentationSource,input:DatabaseMapQuery){
  const location=column(source,input.locationColumnId,'location');
  const candidates=filtered(source,input.filter).sort((a,b)=>a.position-b.position||binary(a.id,b.id));
  const markers:DatabaseMapMarker[]=[];
  for(const row of candidates){
    let value:any;try{value=JSON.parse(row.cells[location.id]??'null');}catch{continue;}
    if(!value||typeof value.latitude!=='number'||typeof value.longitude!=='number'||!Number.isFinite(value.latitude)||!Number.isFinite(value.longitude)||Math.abs(value.latitude)>90||Math.abs(value.longitude)>180)continue;
    const rowTitle=title(source,row);markers.push({id:`marker:${row.id}`,rowId:row.id,title:rowTitle,name:value.name||rowTitle||'Ubicación',latitude:value.latitude,longitude:value.longitude});
  }
  const maximum=limit(input.limit,500);return {markers:markers.slice(0,maximum),totalCount:markers.length,truncated:markers.length>maximum,revision:source.revision};
}
function feed(source:CompanionDatabasePresentationSource,input:DatabaseFeedQuery){
  const date=input.dateColumnId?column(source,input.dateColumnId,'date'):null;
  const items:DatabaseFeedItem[]=[];
  for(const row of filtered(source,input.filter)){
    const page=source.pages[row.id],raw=date?row.cells[date.id]??'':null;
    let occurredAt=raw??(input.includePageChanges===false?row.createdAt:page?.updatedAt??row.updatedAt);
    if(date&&raw){try{const json=JSON.parse(raw);occurredAt=typeof json?.start==='string'?json.start:'';}catch{occurredAt=raw;}}
    if(!occurredAt)continue;
    const kind:DatabaseFeedItem['kind']=date?'date':(page?.updatedAt??row.updatedAt)===row.createdAt?'created':'edited';
    const titleId=source.columns.find(column=>column.type==='title')?.id;
    const rowTitle=(titleId?row.cells[titleId]:null)??page?.title;
    items.push({id:`feed:${kind}:${row.id}:${occurredAt}`,rowId:row.id,pageId:page?.id??null,title:rowTitle||'Sin título',occurredAt,kind,actor:row.updatedBy??'',summary:kind==='date'?'Fecha de la página':kind==='created'?'Página creada':'Página actualizada'});
  }
  items.sort((a,b)=>binary(b.occurredAt,a.occurredAt)||binary(a.rowId,b.rowId));const maximum=limit(input.limit,200);
  return {items:items.slice(0,maximum),totalCount:items.length>maximum?maximum+1:items.length,truncated:items.length>maximum,revision:source.revision};
}
function temporal(source:CompanionDatabasePresentationSource,input:DatabaseTemporalQuery){
  const start=column(source,input.startColumnId,'date'),end=input.endColumnId?column(source,input.endColumnId,'date'):null;
  if(input.dependencyColumnId)column(source,input.dependencyColumnId,'relation');
  const from=Date.parse(input.windowStart),to=Date.parse(input.windowEnd);if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)throw new Error('Ventana temporal no válida.');
  const coarseStart=new Date(from-2*86400000).toISOString().slice(0,19),coarseEnd=new Date(to+2*86400000).toISOString().slice(0,19);
  const candidates=filtered(source,input.filter).flatMap(row=>{
    const value=decodeDatabaseDate(row.cells[start.id]??null);if(!value)return [];
    if(end)value.end=decodeDatabaseDate(row.cells[end.id]??null)?.start??value.end;
    return value.start<coarseEnd&&(value.recurrence||(value.end??value.start)>=coarseStart)?[{row,value}]:[];
  }).sort((a,b)=>binary(a.value.start,b.value.start)||binary(a.row.id,b.row.id));
  const maximum=limit(input.limit,500),sourceLimit=Math.max(2000,maximum*4),occurrenceLimit=Math.min(maximum+1,Math.max(2,Math.ceil((to-from)/86400000)+3));
  const events:DatabaseTemporalEvent[]=[];let truncated=candidates.length>sourceLimit;
  const order=(a:DatabaseTemporalEvent,b:DatabaseTemporalEvent)=>Date.parse(a.startUtc)-Date.parse(b.startUtc)||Date.parse(a.endUtc)-Date.parse(b.endUtc)||a.sourceRowId.localeCompare(b.sourceRowId);
  for(const {row,value} of candidates.slice(0,sourceLimit)){
    try{
      for(const occurrence of expandDatabaseDateOccurrences(value,input.windowStart,input.windowEnd,input.timeZone,occurrenceLimit))events.push({id:`${row.id}:${occurrence.occurrence}`,sourceRowId:row.id,title:title(source,row).trim()||'Sin título',start:occurrence.start,end:occurrence.end,startUtc:occurrence.startUtc,endUtc:occurrence.endUtc,includeTime:Boolean(value.includeTime),timeZone:value.timeZone||input.timeZone||'UTC',recurrence:value.recurrence??null,occurrence:occurrence.occurrence,dstAdjustment:occurrence.dstAdjustment,dependencies:input.dependencyColumnId?source.dependencies[row.id]?.[input.dependencyColumnId]??[]:[],rowRevision:row.revision!});
    }catch{/* Historical malformed dates remain editable in the native inspector. */}
    if(events.length>maximum){truncated=true;events.sort(order);events.splice(maximum);}
  }
  events.sort(order);return {events,revision:source.revision,truncated,sourceRowsScanned:Math.min(candidates.length,sourceLimit),windowStart:input.windowStart,windowEnd:input.windowEnd};
}
async function rows(source:CompanionDatabasePresentationSource,input:DatabaseRowQuery){
  const view=input.viewId?source.views.find(view=>view.id===input.viewId):null;if(input.viewId&&!view)throw new Error('La vista guardada ya no existe.');
  const filter=input.filter===undefined?view?.config.filter:input.filter,sorts=input.sorts??view?.config.sorts??[];
  const identity={databaseId:source.databaseId,revision:source.revision,localRevision:source.localRevision??null,filter:filter??null,sorts,groups:input.groups??view?.config.groups??[],rowSort:input.rowSort??'position'};
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(identity)));const queryHash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  const rules:SortRule[]=identity.groups.map(group=>({columnId:group.columnId,dir:group.dir??'asc'}));for(const sort of sorts)if(!rules.some(rule=>rule.columnId===sort.columnId))rules.push(sort);
  const condition=filter?.type==='condition'?filter:filter?.type==='group'&&filter.operator==='and'&&filter.children.length===1&&filter.children[0].type==='condition'?filter.children[0]:null;
  const fast=condition&&source.columns.find(column=>column.id===condition.columnId)?.type==='number'&&['equals','notEquals','gt','gte','lt','lte'].includes(condition.op)&&Number.isFinite(Number(condition.value))&&identity.groups.length===0&&rules.length===1&&rules[0].columnId===condition.columnId;
  const ordered=sqliteRowsOrder(source,filtered(source,filter),rules,input.rowSort,Boolean(fast));
  const maximum=limit(input.limit,500);let offset=0;
  if(input.cursor){let decoded:any;try{decoded=JSON.parse(atob(input.cursor));}catch{throw new Error('Cursor descargado no válido.');}if(decoded.v!==1||decoded.queryHash!==queryHash||!Number.isSafeInteger(decoded.offset)||decoded.offset<0||decoded.offset>ordered.length)throw new Error('La consulta descargada ha cambiado.');offset=decoded.offset;}
  if(input.direction==='backward')offset=Math.max(0,offset-maximum);
  const cursor=(offset:number)=>btoa(JSON.stringify({v:1,queryHash,offset}));
  const part=ordered.slice(offset,offset+maximum),hasMore=offset+part.length<ordered.length;
  return {rows:part,nextCursor:hasMore?cursor(offset+part.length):null,previousCursor:offset>0?cursor(offset):null,totalCount:ordered.length,revision:source.revision,queryHash,hasMore};
}
export async function queryCompanionDatabasePresentation(source:CompanionDatabasePresentationSource,action:string,input:Record<string,any>){
  if(source.version!==1||source.databaseId!==input.databaseId||source.database.id!==source.databaseId)throw new Error('La copia no pertenece a esta base de datos.');
  if(source.localChanges){
    source={...source,rows:source.rows.map(row=>({...row,cells:{...row.cells}}))};
    for(const row of source.rows)for(const column of source.columns){
      if(column.type==='created_time')row.cells[column.id]=row.createdAt;
      if(column.type==='last_edited_time')row.cells[column.id]=row.updatedAt;
      if(column.type==='created_by')row.cells[column.id]=row.createdBy??'';
      if(column.type==='last_edited_by')row.cells[column.id]=row.updatedBy??'';
      if(column.type==='unique_id')row.cells[column.id]=String(column.config.uniqueIdPrefix??'').slice(0,24)+String(row.uniqueSequence??0).padStart(Math.min(12,Math.max(1,Math.trunc(Number(column.config.uniqueIdPadding??4)))),'0');
    }
    computeFormulas(source.rows,source.columns);
  }
  switch(action){
    case 'metadata':return {database:source.database,columns:source.columns,views:source.views,revision:source.revision,columnRevisions:source.columnRevisions??{}};
    case 'rows':return rows(source,input as DatabaseRowQuery);
    case 'chart':return chart(source,input as DatabaseChartQuery);
    case 'map':return map(source,input as DatabaseMapQuery);
    case 'feed':return feed(source,input as DatabaseFeedQuery);
    case 'temporal':return temporal(source,input as DatabaseTemporalQuery);
    default:throw new Error('Consulta de base de datos no disponible.');
  }
}
