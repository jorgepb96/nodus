import {getDb} from '../db/database';
import {getSyncedBlockSource} from '../db/pagesRepo';
import {getDatabaseContainer,queryDatabaseContainerRows} from '../db/databasesRepo';
import type {DatabaseContainerRowQuery} from '../../shared/databaseSources';

export function mobileSyncedBlockSource(vaultId:string,id:unknown){
  if(typeof id!=='string'||!id||id.length>1024)throw new Error('invalid_arguments');
  return {version:1,vaultId,source:getSyncedBlockSource(id)};
}
/** The actual Desktop filter, keyset cursor and multi-source mapping, with
 * consultation explicitly excluding source initialisation and formula writes. */
export function mobileLinkedDatabaseRead(vaultId:string,raw:unknown){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Buffer.byteLength(JSON.stringify(raw),'utf8')>1024*1024)throw new Error('invalid_arguments');
  const {action,input}=raw as {action:unknown;input:unknown};
  if(Object.keys(raw).some(key=>!['action','input'].includes(key))||!['definition','rows'].includes(String(action)))throw new Error('invalid_arguments');
  let data;
  if(action==='definition'){
    if(typeof input!=='string'||!input||input.length>1024)throw new Error('invalid_arguments');
    data=getDb().transaction(()=>getDatabaseContainer(input,true))();
  }else{
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('invalid_arguments');
    const query=input as DatabaseContainerRowQuery;
    if(Object.keys(query).some(key=>!['viewId','sourceId','localFilter','cursor','limit'].includes(key))||typeof query.viewId!=='string'||!query.viewId||query.viewId.length>1024||query.sourceId!=null&&(typeof query.sourceId!=='string'||query.sourceId.length>2048)||query.cursor!=null&&(typeof query.cursor!=='string'||query.cursor.length>16384)||!Number.isSafeInteger(query.limit)||query.limit!<1||query.limit!>500)throw new Error('invalid_arguments');
    data=getDb().transaction(()=>queryDatabaseContainerRows(query,{readOnly:true}))();
  }
  const result={version:1,vaultId,action,data};
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>16*1024*1024)throw new Error('page_dependency_too_large');
  return result;
}
