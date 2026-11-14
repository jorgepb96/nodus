import {getDatabase,getColumns,queryDatabaseRows} from './databasesRepo';
import type {DatabaseRow} from '../../shared/types';
import {captureDatabaseChatSource} from '../../shared/databaseChatSources';

function queryAllRows(databaseId: string): DatabaseRow[] {
  const rows: DatabaseRow[] = [];
  let cursor: string | null = null;
  do {
    const page = queryDatabaseRows({ databaseId, cursor, limit: 500 });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}

export function captureDatabaseChatContextSource(id:string) {
  const database=getDatabase(id);
  if(!database)throw new Error('database_chat_source_unavailable');
  return captureDatabaseChatSource(id,database.name,getColumns(id),queryAllRows(id));
}
