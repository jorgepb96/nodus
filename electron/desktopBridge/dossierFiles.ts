import {getDb} from '../db/database';
import {listGlobalLibraryVaultLinks} from '../library/libraryService';
import {getLibraryReaderDocument} from '../libraryReader/libraryReaderStore';
import {getPageDocumentReadOnly} from '../db/pagesRepo';
import {pageDocumentAssets} from './pageDocuments';

/** Private, provider-free catalogue. Only registered opaque file identities
 * leave the Mac; paths, blobs, credentials and extraction are never exposed. */
export function mobileDossierFiles(vaultId: string, domains: readonly string[], input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_arguments');
  const {collection, id} = input as {collection?: unknown; id?: unknown};
  if (Object.keys(input).some(key => !['collection','id'].includes(key)) || typeof id !== 'string' || !id || id.length > 1024) throw new Error('invalid_arguments');
  const db = getDb();
  const exists = (table: string, column: string) => Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(id));
  type File = {kind: string; id: string; title: string; available: boolean;mime?:string|null};
  let files: File[] = [], reader: ReturnType<typeof getLibraryReaderDocument> | undefined;
  if (collection === 'works') {
    if (!exists('works','nodus_id') && !listGlobalLibraryVaultLinks(id).some(link => link.vaultId === vaultId)) throw new Error('permission_denied');
    reader = getLibraryReaderDocument(id);
    if (reader?.originalAvailable) files.push({kind:'libraryOriginal',id,title:reader.title,available:true});
    for (const attachment of reader?.attachments ?? []) files.push({kind:'libraryAttachment',id:JSON.stringify([id,attachment.id]),title:attachment.title || attachment.fileName,available:attachment.available});
  } else if (collection === 'archive-items') {
    if (!domains.includes('primary-source-files')) throw new Error('permission_denied');
    if (!exists('archive_items','item_id')) throw new Error('record_not_found');
    const original = db.prepare('SELECT file_name, blob IS NOT NULL AS available FROM archive_items WHERE item_id=?').get(id) as {file_name?: string; available: number};
    if (original.available) files.push({kind:'archiveItem',id,title:original.file_name || 'Original',available:true});
    files.push(...(db.prepare(`SELECT file_id AS id, original_file_name AS title,
      (content_blob IS NOT NULL OR NULLIF(external_path,'') IS NOT NULL) AS available
      FROM archive_item_files WHERE item_id=? ORDER BY sequence_no, version_no, file_id`).all(id) as Array<{id:string;title:string|null;available:number}>)
      .map(row => ({kind:'archiveFile',id:row.id,title:row.title || 'Original',available:Boolean(row.available)})));
  } else if (collection === 'study-materials') {
    if (!exists('study_materials','id')) throw new Error('record_not_found');
    const material = db.prepare(`SELECT file_name AS title, (content_blob IS NOT NULL OR NULLIF(file_path,'') IS NOT NULL) AS available,
      deleted_at FROM study_materials WHERE id=?`).get(id) as {title:string;available:number;deleted_at:string|null};
    if (material.deleted_at) throw new Error('record_not_found');
    files.push({kind:'studyMaterial',id,title:material.title || 'Original',available:Boolean(material.available)});
    files.push(...(db.prepare(`SELECT id, file_name AS title, content_blob IS NOT NULL AS available
      FROM study_material_versions WHERE material_id=? ORDER BY version_no DESC, id`).all(id) as Array<{id:string;title:string;available:number}>)
      .map(row => ({kind:'studyMaterialVersion',id:row.id,title:row.title || 'Versión',available:Boolean(row.available)})));
  } else if (collection === 'databases') {
    if (!exists('db_databases','id')) throw new Error('record_not_found');
    files = (db.prepare(`SELECT attachment.id, attachment.file_name AS title,attachment.mime_type AS mime,
      COALESCE(attachment.blob,blob.data) IS NOT NULL AS available FROM db_attachments AS attachment
      JOIN db_rows AS row ON row.id=attachment.row_id LEFT JOIN db_blobs AS blob ON blob.hash=attachment.blob_hash
      WHERE row.database_id=? ORDER BY row.id, attachment.position, attachment.id`).all(id) as Array<{id:string;title:string;mime:string|null;available:number}>)
      .map(row => ({kind:'databaseAttachment',id:row.id,title:row.title || 'Archivo',mime:row.mime,available:Boolean(row.available)}));
  } else if(collection==='pages'){
    const document=getPageDocumentReadOnly(id);if(!document)throw new Error('record_not_found');
    files=pageDocumentAssets(document);
  } else throw new Error('invalid_arguments');
  if (files.length > 20_000) throw new Error('dossier_files_too_large');
  return {version:1,collection,id,files,...(reader !== undefined ? {reader} : {})};
}
