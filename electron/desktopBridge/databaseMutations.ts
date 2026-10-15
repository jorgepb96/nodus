import {resolveEntityLabel} from '../db/crossVault';
import type {RelationTargetKind} from '../../shared/databases';
import {getDb} from '../db/database';
import {createDatabase,createColumn,createRow,setCell,getColumn,getColumns,updateColumn,addOption,updateOption,deleteOption,addRelation,removeRelation,deleteAttachment} from '../db/databasesRepo';
import {COLUMN_TYPES,normalizeCellValue,type DatabaseColumnType} from '../../shared/databases';
import {databaseCellRaw} from '../../shared/databaseCellStorage';
import {isReadOnlyDatabaseProperty} from '../../shared/databaseProperties';
import {canonicalJson} from '../../shared/canonicalJson';
import {validateFormula,type FormulaSpec} from '../../shared/databaseFormula';
import {parseFormulaExpression} from '../../shared/databaseFormulaExpression';
import {orderFormulaColumns} from '../../shared/databaseFormulaEval';
import type {DatabaseColumnConfig} from '../../shared/databases';

export const mobileDatabaseMutationTables=['db_databases','db_columns','db_rows','db_cells','db_select_options','db_relations','db_attachments'] as const;
export class MobileDatabaseMutationError extends Error {
  get description(){return this.message==='database_cell_revision_conflict'
    ? 'La celda cambió en Nodus. Tu cambio se conserva en la cola de este dispositivo. Revisa ambas versiones antes de volver a guardarlo.'
    : this.message==='database_parent_unavailable'?'La base de datos todavía no está disponible en Nodus. Sincroniza su creación antes de enviar sus propiedades o filas.'
    : 'Nodus no pudo aplicar este cambio de base de datos. Se conserva en la cola del dispositivo para su revisión.';}
}
type Mutation={table:string;kind:string;key:unknown[];row?:Record<string,unknown>};
function fail(message:string):never {throw new MobileDatabaseMutationError(message);}
function identity(value:unknown){if(typeof value!=='string'||!value||value.length>1024)fail('invalid_database_identity');return value as string;}
function title(value:unknown){if(typeof value!=='string'||value.length>4096||!value.trim())fail('invalid_database_title');return (value as string).trim();}
function createdId(value:unknown,prefix:string){const id=identity(value);if(!new RegExp(`^${prefix}_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`,'i').test(id))fail('invalid_database_creation_identity');return id;}
const configKeys=new Set(['numberFormat','numberCurrency','numberDecimals','progressMaximum','dateIncludeTime','dateTimeZone','uniqueIdPrefix','uniqueIdPadding','buttonLabel','buttonColor','width','fitContent','aiPrompt','aiAuto','aiSourceColumnId','aiModel','aiImageModel','relationTargetKind','relationTargetDatabaseId','relationCardinality','relationInverseColumnId','rollupRelationColumnId','rollupTargetColumnId','rollupFunction','formula','formulaColors','formulaDecimals','comparisonSourceColumnIds']);
function propertyConfig(raw:unknown,existing:DatabaseColumnConfig={}):DatabaseColumnConfig {
  if(typeof raw!=='string'||raw.length>100_000)fail('invalid_database_property_config');
  let config:DatabaseColumnConfig;try{config=JSON.parse(raw);}catch{fail('invalid_database_property_config');}
  if(!config||typeof config!=='object'||Array.isArray(config))fail('invalid_database_property_config');
  for(const [key,value] of Object.entries(config)) {
    if(Object.prototype.hasOwnProperty.call(existing,key)&&canonicalJson(value)===canonicalJson(existing[key]))continue;
    if(!configKeys.has(key)) {if(canonicalJson(value)!==canonicalJson(existing[key]))fail('unsupported_database_property_config');continue;}
    if(['numberDecimals','formulaDecimals','uniqueIdPadding','width','progressMaximum'].includes(key)&&(typeof value!=='number'||!Number.isFinite(value)||value<0))fail('invalid_database_property_config');
    if(['numberDecimals','formulaDecimals'].includes(key)&&(typeof value!=='number'||!Number.isInteger(value)||value>8))fail('invalid_database_property_config');
    if(key==='uniqueIdPadding'&&(typeof value!=='number'||!Number.isInteger(value)||value<1||value>12))fail('invalid_database_property_config');
    if(key==='progressMaximum'&&(typeof value!=='number'||value<=0))fail('invalid_database_property_config');
    if(['aiAuto','dateIncludeTime','fitContent'].includes(key)&&typeof value!=='boolean')fail('invalid_database_property_config');
    if(['aiPrompt','numberCurrency','dateTimeZone','uniqueIdPrefix','buttonLabel','buttonColor','aiSourceColumnId','relationTargetDatabaseId','relationInverseColumnId','rollupRelationColumnId','rollupTargetColumnId'].includes(key)&&typeof value!=='string')fail('invalid_database_property_config');
    const enums:Record<string,string[]>={numberFormat:['plain','integer','decimal','currency','percent','progress'],relationTargetKind:['db_row','work','idea','gap','author','person'],relationCardinality:['one','many'],rollupFunction:['show','show_unique','count','count_values','count_empty','count_unique','percent_empty','percent_not_empty','sum','average','median','min','max','range','earliest_date','latest_date','date_range','checked','unchecked','percent_checked','percent_unchecked']};
    if(enums[key]&&!enums[key].includes(String(value)))fail('invalid_database_property_config');
    if(['aiModel','aiImageModel'].includes(key)&&value!==null) {
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['provider','model'].includes(k))||typeof (value as Record<string,unknown>).provider!=='string'||typeof (value as Record<string,unknown>).model!=='string')fail('invalid_database_property_model');
    }
    if(key==='formulaColors'&&(!Array.isArray(value)||value.some(rule=>!rule||typeof rule!=='object'||typeof rule.id!=='string'||typeof rule.color!=='string'||typeof rule.op!=='string')))fail('invalid_database_property_config');
    if(key==='formula'&&(!value||typeof value!=='object'||Array.isArray(value)||!['arithmetic','columnStat','ifThen','concat','expression'].includes(String((value as {kind?:unknown}).kind))))fail('invalid_database_formula');
    if(key==='comparisonSourceColumnIds'&&(!Array.isArray(value)||value.some(id=>typeof id!=='string')))fail('invalid_database_property_config');
  }
  if(config.formula?.kind==='expression')try{config.formula={...config.formula,ast:parseFormulaExpression(config.formula.source)};}catch{fail('invalid_database_formula');}
  return {...existing,...config};
}
function validateColumnConfig(databaseId:string,id:string,type:DatabaseColumnType,config:DatabaseColumnConfig) {
  const existing=getColumns(databaseId),prospective=existing.filter(c=>c.id!==id);
  prospective.push({id,databaseId,name:'Property',type,position:existing.length,config,options:[]});
  if(type==='formula'&&config.formula){try{if(validateFormula(config.formula as FormulaSpec,prospective)||orderFormulaColumns(prospective).circular.size)fail('invalid_database_formula');}catch{fail('invalid_database_formula');}}
  if(type==='comparison'&&config.comparisonSourceColumnIds&&config.comparisonSourceColumnIds.some(source=>source===id||!existing.some(c=>c.id===source)))fail('invalid_database_comparison');
  if(type==='relation'&&config.relationTargetKind==='db_row'&&config.relationTargetDatabaseId&&!getDb().prepare('SELECT 1 FROM db_databases WHERE id=?').get(config.relationTargetDatabaseId))fail('database_relation_target_unavailable');
  if(type==='rollup'&&config.rollupRelationColumnId){const relation=existing.find(c=>c.id===config.rollupRelationColumnId);if(!relation||relation.type!=='relation'||relation.config.relationTargetKind!=='db_row')fail('invalid_database_rollup');}
}
/** Mobile content controls invoke canonical repository operations. Raw SQL
 * replication would skip page creation, typed values, formula and rollup hooks. */
export function applyMobileDatabaseMutation(raw:Mutation,authorizedVaultIds:readonly string[]=[],owningVaultId?:string){
  if(!mobileDatabaseMutationTables.includes(raw.table as typeof mobileDatabaseMutationTables[number]))return false;
  if(!['upsert','delete'].includes(raw.kind)||!raw.row||typeof raw.row!=='object'||Array.isArray(raw.row))fail('unsupported_database_operation');
  const db=getDb(),row=raw.row;
  if(raw.table==='db_relations'||raw.table==='db_attachments') {
    if(raw.key.length!==1||row.id!==raw.key[0])fail('invalid_database_identity');
    const id=identity(raw.key[0]),rowId=identity(row.row_id),columnId=identity(row.column_id),column=getColumn(columnId);
    const parent=db.prepare('SELECT database_id FROM db_rows WHERE id=?').get(rowId) as {database_id:string}|undefined;
    if(!parent||!column||parent.database_id!==column.databaseId||row.database_id!==parent.database_id)fail('database_cell_parent_unavailable');
    const revision=(db.prepare('SELECT revision FROM db_columns WHERE id=?').get(columnId) as {revision:number}).revision;
    if(row._mobileExpectedColumnRevision!==revision)fail('database_column_revision_conflict');
    if(raw.table==='db_attachments') {
      if(raw.kind!=='delete'||!['files','attachment','ai_image'].includes(column.type))fail('unsupported_database_operation');
      const existing=db.prepare('SELECT row_id,column_id,revision,content_hash FROM db_attachments WHERE id=?').get(id) as {row_id:string;column_id:string;revision:number;content_hash:string}|undefined;
      if(!existing||existing.row_id!==rowId||existing.column_id!==columnId)fail('database_attachment_parent_unavailable');
      if(existing.revision!==row._mobileExpectedRevision||existing.content_hash!==row._mobileExpectedContentHash)fail('database_attachment_revision_conflict');
      deleteAttachment(id);return true;
    }
    if(column.type!=='relation')fail('database_relation_parent_unavailable');
    const current=db.prepare("SELECT id,target_kind,target_id,COALESCE(target_vault_id,'') AS target_vault_id FROM db_relations WHERE row_id=? AND column_id=? ORDER BY id").all(rowId,columnId);
    let expected:unknown;try{expected=typeof row._mobileExpectedRelationsJSON==='string'?JSON.parse(row._mobileExpectedRelationsJSON):null;}catch{fail('database_relation_revision_conflict');}
    if(canonicalJson(current)!==canonicalJson(expected))fail('database_relation_revision_conflict');
    if(raw.kind==='delete') {
      if(!(current as Array<{id:string}>).some(value=>value.id===id))fail('database_relation_parent_unavailable');
      removeRelation(id);return true;
    }
    const kind=row.target_kind;
    if(typeof kind!=='string'||!['db_row','work','idea','gap','author','person'].includes(kind))fail('database_relation_target_unavailable');
    const targetId=identity(row.target_id),targetVault=row.target_vault_id==null?null:identity(row.target_vault_id);
    if(kind==='db_row') {
      if(targetVault!==null&&targetVault!==owningVaultId)fail('database_relation_target_not_authorized');
    } else {
      const actualVault=targetVault??owningVaultId;
      if(!actualVault||!authorizedVaultIds.includes(actualVault))fail('database_relation_target_not_authorized');
      if(resolveEntityLabel(kind as Exclude<RelationTargetKind,'db_row'>,targetId,actualVault).broken)fail('database_relation_target_unavailable');
    }
    try{addRelation(rowId,columnId,kind as RelationTargetKind,targetId,kind==='db_row'?null:targetVault??owningVaultId??null,createdId(id,'drel'));}catch{fail('database_relation_target_unavailable');}
    return true;
  }
  if(raw.table==='db_select_options') {
    if(raw.key.length!==1||row.id!==raw.key[0])fail('invalid_database_identity');
    const id=identity(raw.key[0]),column=getColumn(identity(row.column_id));
    if(!column||row.database_id!==column.databaseId||!['select','status','multi_select'].includes(column.type))fail('database_option_parent_unavailable');
    const existing=db.prepare('SELECT * FROM db_select_options WHERE id=?').get(id) as {column_id:string;revision:number}|undefined;
    if(existing&&existing.column_id!==column.id)fail('database_option_parent_unavailable');
    if(row._mobileExpectedRevision!==(existing?.revision??0))fail('database_option_revision_conflict');
    if(raw.kind==='delete'){if(!existing)fail('database_option_unavailable');deleteOption(id);return true;}
    const label=title(row.label),color=row.color==null?null:identity(row.color),group=row.group_key==null?null:row.group_key;
    if(group!==null&&!['pending','in_progress','complete'].includes(String(group)))fail('invalid_database_option_group');
    if(existing)updateOption(id,{label,color,group:group as 'pending'|'in_progress'|'complete'|null});
    else addOption(column.id,label,color,group as 'pending'|'in_progress'|'complete'|null,createdId(id,'dopt'));
    return true;
  }
  if(raw.kind!=='upsert')fail('unsupported_database_operation');
  if(raw.table==='db_cells'){
    if(raw.key.length!==2)fail('invalid_database_cell');
    const rowId=identity(raw.key[0]),columnId=identity(raw.key[1]);
    if(row.row_id!==rowId||row.column_id!==columnId)fail('invalid_database_cell');
    const parent=db.prepare('SELECT database_id FROM db_rows WHERE id=?').get(rowId) as {database_id:string}|undefined;
    const column=db.prepare('SELECT database_id,type FROM db_columns WHERE id=?').get(columnId) as {database_id:string;type:string}|undefined;
    if(!parent||!column||parent.database_id!==column.database_id||row.database_id!==parent.database_id)fail('database_cell_parent_unavailable');
    if(isReadOnlyDatabaseProperty(column.type)||['formula','rollup','comparison'].includes(column.type))fail('database_property_is_read_only');
    const current=db.prepare('SELECT * FROM db_cells WHERE row_id=? AND column_id=?').get(rowId,columnId) as ({revision:number}&Parameters<typeof databaseCellRaw>[0])|undefined;
    if(!Number.isSafeInteger(row._mobileExpectedRevision)||row._mobileExpectedRevision!==(current?.revision??0))fail('database_cell_revision_conflict');
    if(typeof row._mobileExpectedValue!=='string'||normalizeCellValue(column.type as DatabaseColumnType,row._mobileExpectedValue)!==(current?databaseCellRaw(current):null))fail('database_cell_revision_conflict');
    if(typeof row.value_text!=='string'||row.value_text.length>1_000_000)fail('invalid_database_cell_value');
    setCell(rowId,columnId,row.value_text||null);return true;
  }
  if(raw.key.length!==1||row.id!==raw.key[0])fail('invalid_database_identity');
  if(raw.table==='db_columns') {
    const id=identity(raw.key[0]),existing=getColumn(id);
    if(existing) {
      if(row.database_id!==existing.databaseId||row._mobileExpectedRevision!==(db.prepare('SELECT revision FROM db_columns WHERE id=?').get(id) as {revision:number}).revision)fail('database_column_revision_conflict');
      let baseline:unknown;try{baseline=typeof row._mobileExpectedConfigJSON==='string'?JSON.parse(row._mobileExpectedConfigJSON):undefined;}catch{fail('database_column_revision_conflict');}
      if(canonicalJson(baseline)!==canonicalJson(existing.config))fail('database_column_revision_conflict');
      if(typeof row.type!=='string'||!COLUMN_TYPES.some(type=>type.id===row.type))fail('unsupported_database_property');
      if(row.type==='title'&&existing.type!=='title'&&db.prepare("SELECT 1 FROM db_columns WHERE database_id=? AND type='title' AND id<>?").get(existing.databaseId,id))fail('database_primary_title_exists');
      const config=propertyConfig(row.config_json,existing.config);validateColumnConfig(existing.databaseId,id,row.type as DatabaseColumnType,config);
      try{updateColumn(id,{name:title(row.name),type:row.type as DatabaseColumnType,config});}catch{fail('invalid_database_property_config');}
      return true;
    }
  }
  const id=createdId(raw.key[0],raw.table==='db_databases'?'db':raw.table==='db_columns'?'dcol':'drow');
  if(db.prepare(`SELECT 1 FROM ${raw.table} WHERE id=?`).get(id))fail('database_creation_identity_conflict');
  if(raw.table==='db_databases'){
    if(row.icon!=null&&(typeof row.icon!=='string'||row.icon.length>256))fail('invalid_database_icon');
    createDatabase(title(row.name),row.icon as string|null??null,id);return true;
  }
  const databaseId=identity(row.database_id);
  if(!db.prepare('SELECT 1 FROM db_databases WHERE id=?').get(databaseId))fail('database_parent_unavailable');
  if(raw.table==='db_rows'){createRow(databaseId,id);return true;}
  if(typeof row.type!=='string'||!COLUMN_TYPES.some(type=>type.id===row.type))fail('unsupported_database_property');
  const config=propertyConfig(typeof row.config_json==='string'?row.config_json:'{}');
  validateColumnConfig(databaseId,id,row.type as DatabaseColumnType,config);
  if(row.type==='title'&&db.prepare("SELECT 1 FROM db_columns WHERE database_id=? AND type='title'").get(databaseId))fail('database_primary_title_exists');
  createColumn(databaseId,title(row.name),row.type as DatabaseColumnType,config,id);if(Object.keys(config).length)updateColumn(id,{config});return true;
}
