import {getDb} from '../db/database';

/** Locate a granted row without hydrating it, materialising formulas, reading
 * another vault or returning private file bytes. The normal dossier provides
 * the complete native row reader and its scoped original-file identities. */
export function mobileDatabaseRowLocation(vaultId: string, rowId: unknown) {
  if (typeof rowId !== 'string' || !rowId || rowId.length > 1024) throw new Error('invalid_arguments');
  const row = getDb().prepare(`SELECT row.id, row.database_id FROM db_rows AS row
    JOIN db_databases AS database ON database.id=row.database_id WHERE row.id=?`).get(rowId) as {id:string;database_id:string}|undefined;
  if (!row) throw new Error('record_not_found');
  return {version:1,vaultId,rowId:row.id,databaseId:row.database_id};
}
