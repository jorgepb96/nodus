import {getDb} from '../db/database';
import {createDatabase,createColumn,createRow,setCell} from '../db/databasesRepo';
import {COLUMN_TYPES,normalizeCellValue,type DatabaseColumnType} from '../../shared/databases';
import {databaseCellRaw} from '../../shared/databaseCellStorage';
import {isReadOnlyDatabaseProperty} from '../../shared/databaseProperties';

export const mobileDatabaseMutationTables=['db_databases','db_columns','db_rows','db_cells'] as const;
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
/** Mobile content controls invoke canonical repository operations. Raw SQL
 * replication would skip page creation, typed values, formula and rollup hooks. */
export function applyMobileDatabaseMutation(raw:Mutation){
  if(!mobileDatabaseMutationTables.includes(raw.table as typeof mobileDatabaseMutationTables[number]))return false;
  if(raw.kind!=='upsert'||!raw.row||typeof raw.row!=='object'||Array.isArray(raw.row))fail('unsupported_database_operation');
  const db=getDb(),row=raw.row;
  if(raw.table==='db_cells'){
    if(raw.key.length!==2)fail('invalid_database_cell');
    const rowId=identity(raw.key[0]),columnId=identity(raw.key[1]);
    if(row.row_id!==rowId||row.column_id!==columnId)fail('invalid_database_cell');
    const parent=db.prepare('SELECT database_id FROM db_rows WHERE id=?').get(rowId) as {database_id:string}|undefined;
    const column=db.prepare('SELECT database_id,type FROM db_columns WHERE id=?').get(columnId) as {database_id:string;type:string}|undefined;
    if(!parent||!column||parent.database_id!==column.database_id||row.database_id!==parent.database_id)fail('database_cell_parent_unavailable');
    if(isReadOnlyDatabaseProperty(column.type))fail('database_property_is_read_only');
    const current=db.prepare('SELECT * FROM db_cells WHERE row_id=? AND column_id=?').get(rowId,columnId) as ({revision:number}&Parameters<typeof databaseCellRaw>[0])|undefined;
    if(!Number.isSafeInteger(row._mobileExpectedRevision)||row._mobileExpectedRevision!==(current?.revision??0))fail('database_cell_revision_conflict');
    if(typeof row._mobileExpectedValue!=='string'||normalizeCellValue(column.type as DatabaseColumnType,row._mobileExpectedValue)!==(current?databaseCellRaw(current):null))fail('database_cell_revision_conflict');
    if(typeof row.value_text!=='string'||row.value_text.length>1_000_000)fail('invalid_database_cell_value');
    setCell(rowId,columnId,row.value_text||null);return true;
  }
  if(raw.key.length!==1||row.id!==raw.key[0])fail('invalid_database_identity');
  const id=createdId(raw.key[0],raw.table==='db_databases'?'db':raw.table==='db_columns'?'dcol':'drow');
  if(db.prepare(`SELECT 1 FROM ${raw.table} WHERE id=?`).get(id))fail('database_creation_identity_conflict');
  if(raw.table==='db_databases'){
    if(row.icon!=null&&(typeof row.icon!=='string'||row.icon.length>256))fail('invalid_database_icon');
    createDatabase(title(row.name),row.icon as string|null??null,id);return true;
  }
  const databaseId=identity(row.database_id);
  if(!db.prepare('SELECT 1 FROM db_databases WHERE id=?').get(databaseId))fail('database_parent_unavailable');
  if(raw.table==='db_rows'){createRow(databaseId,id);return true;}
  if(typeof row.type!=='string'||!COLUMN_TYPES.some(type=>type.id===row.type)||['formula','rollup','comparison'].includes(row.type))fail('unsupported_database_property');
  let config:unknown;
  try{config=JSON.parse(typeof row.config_json==='string'?row.config_json:'{}');}catch{fail('invalid_database_property_config');}
  if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).length!==0)fail('unsupported_database_property_config');
  if(row.type==='title'&&db.prepare("SELECT 1 FROM db_columns WHERE database_id=? AND type='title'").get(databaseId))fail('database_primary_title_exists');
  createColumn(databaseId,title(row.name),row.type as DatabaseColumnType,{},id);return true;
}
