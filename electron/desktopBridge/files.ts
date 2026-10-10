import { createHash } from 'node:crypto';
import {open, realpath} from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDb, withVaultDatabase } from '../db/database';
import {activeVaultDir} from '../vaults/vaultRegistry';
import {withOwningVault} from '../vaults/vaultRegistry';
import {listGlobalLibraryVaultLinks} from '../library/libraryService';
import {getLibraryReaderDocument, libraryReaderOriginalPath, libraryReaderAttachmentPath} from '../libraryReader/libraryReaderStore';
import {registeredAudioClip} from '../audio/audioService';

/** Saved narration uses an opaque clip ID and bounded, verified file chunks. */
async function serveAudioClip(request: IncomingMessage, response: ServerResponse, url: URL,
  vaultId: string, domains: readonly string[], id: string, action: string): Promise<void> {
  const json = (status: number, value: unknown) => {
    response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'});
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(value));
  };
  await withOwningVault(vaultId, () => withVaultDatabase(vaultId, async () => {
    const clip = registeredAudioClip(id);
    if (!clip) { json(404, {error: 'file_not_found'}); return; }
    if (clip.entityKind === 'study_transcript' && !domains.includes('study-recordings')) { json(403, {error:'permission_denied'}); return; }
    let handle: FileHandle | undefined;
    try {
      const vaultRoot = await realpath(activeVaultDir());
      const folder = await realpath(path.join(vaultRoot, 'audio'));
      const folderRelative = path.relative(vaultRoot, folder);
      if (folderRelative.startsWith('..') || path.isAbsolute(folderRelative)) { json(403, {error:'invalid_registered_file_path'}); return; }
      if (!clip.fileName || clip.fileName !== path.basename(clip.fileName) || clip.fileName.includes('\\')) { json(403, {error:'invalid_registered_file_path'}); return; }
      const file = await realpath(path.join(folder, clip.fileName)), relative = path.relative(folder, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) { json(403, {error:'invalid_registered_file_path'}); return; }
      handle = await open(file, 'r');
      const stat = await handle.stat(), size = stat.size, chunkSize = 4 * 1024 * 1024;
      if (!stat.isFile() || !Number.isSafeInteger(size)) { json(410, {error:'file_content_unavailable'}); return; }
      const stamp = `${size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      const read = async (offset: number, length: number) => {
        const bytes = Buffer.alloc(length); let received = 0;
        while (received < length) {
          const part = await handle!.read(bytes, received, length - received, offset + received);
          if (!part.bytesRead) throw new Error('file_changed'); received += part.bytesRead;
        }
        const current = await handle!.stat();
        if (stamp !== `${current.size}:${current.mtimeMs}:${current.ctimeMs}`) throw new Error('file_changed');
        return bytes;
      };
      if (action === 'descriptor') {
        const digest = createHash('sha256');
        for (let offset = 0; offset < size; offset += chunkSize) digest.update(await read(offset, Math.min(chunkSize, size - offset)));
        json(200, {kind:'audioClip', id, filename:clip.fileName, mime:'audio/wav', byteSize:size, sha256:digest.digest('hex'), chunkSize}); return;
      }
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? chunkSize);
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || offset < 0 || offset > size || limit < 1 || limit > chunkSize) { json(416, {error:'invalid_file_range'}); return; }
      const length = Math.min(limit, size - offset), bytes = request.method === 'HEAD' ? undefined : await read(offset, length);
      response.writeHead(200, {'content-type':'audio/wav', 'content-length':String(length), 'cache-control':'no-store',
        'x-nodus-file-offset':String(offset), 'x-nodus-file-size':String(size)}); response.end(bytes);
    } catch (error) {
      json((error as Error).message === 'file_changed' ? 409 : 410, {error:(error as Error).message === 'file_changed' ? 'file_changed' : 'file_content_unavailable'});
    } finally { await handle?.close(); }
  }));
}

// Callers select an opaque record identity, never a filesystem path or SQL column.
export const BRIDGE_FILE_KINDS = {
  studyMaterial: { domain: 'corpus', table: 'study_materials', id: 'id', blob: 'content_blob', name: 'file_name', deleted: 'deleted_at', path: 'file_path' },
  studyMaterialVersion: { domain: 'corpus', table: 'study_material_versions', id: 'id', blob: 'content_blob', name: 'file_name' },
  studyRecording: { domain: 'study-recordings', table: 'study_recordings', id: 'id', blob: 'audio_blob', name: 'file_name', deleted: 'deleted_at', path: 'file_path' },
  testimonyMedia: { domain: 'testimonies', table: 'testimony_media', id: 'id', blob: 'content_blob', name: 'file_name', deleted: 'deleted_at' },
  archiveItem: { domain: 'primary-source-files', table: 'archive_items', id: 'item_id', blob: 'blob', name: 'file_name' },
  archiveFile: { domain: 'primary-source-files', table: 'archive_item_files', id: 'file_id', blob: 'content_blob', name: 'original_file_name', path: 'external_path' },
} as const;

/** Reader files are resolved by Desktop from a granted document identity. An
 * attachment identity is a JSON pair, never a path supplied by the device. */
async function serveReaderFile(request: IncomingMessage, response: ServerResponse, url: URL,
  vaultId: string, kind: string, id: string, action: string): Promise<void> {
  const json = (status: number, value: unknown) => {
    response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'});
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(value));
  };
  let documentId = id, attachmentId: string | null = null;
  if (kind === 'libraryAttachment') {
    try {
      const identity = JSON.parse(id);
      if (!Array.isArray(identity) || identity.length !== 2 || identity.some(value => typeof value !== 'string' || !value)) throw new Error();
      [documentId, attachmentId] = identity;
    } catch { json(400, {error: 'invalid_file_identity'}); return; }
  }
  await withOwningVault(vaultId, () => withVaultDatabase(vaultId, async () => {
    const work = getDb().prepare('SELECT 1 FROM works WHERE nodus_id=?').get(documentId);
    if (!work && !listGlobalLibraryVaultLinks(documentId).some(link => link.vaultId === vaultId)) {
      json(403, {error: 'permission_denied'}); return;
    }
    const document = getLibraryReaderDocument(documentId);
    const attachment = attachmentId ? document?.attachments.find(value => value.id === attachmentId) : null;
    const file = attachmentId ? libraryReaderAttachmentPath(documentId, attachmentId) : libraryReaderOriginalPath(documentId);
    if (!document || !file || (attachmentId && !attachment?.available)) { json(404, {error: 'file_not_found'}); return; }
    let handle: FileHandle | undefined;
    try {
      handle = await open(await realpath(file), 'r');
      const stat = await handle.stat(), size = stat.size, chunkSize = 4 * 1024 * 1024;
      if (!stat.isFile() || !Number.isSafeInteger(size)) { json(410, {error: 'file_content_unavailable'}); return; }
      const stamp = `${size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      const read = async (offset: number, length: number) => {
        const bytes = Buffer.alloc(length); let received = 0;
        while (received < length) {
          const part = await handle!.read(bytes, received, length - received, offset + received);
          if (!part.bytesRead) throw new Error('file_changed'); received += part.bytesRead;
        }
        const current = await handle!.stat();
        if (stamp !== `${current.size}:${current.mtimeMs}:${current.ctimeMs}`) throw new Error('file_changed');
        return bytes;
      };
      const mime = attachment?.mimeType ?? document.originalMimeType ?? 'application/octet-stream';
      if (action === 'descriptor') {
        const digest = createHash('sha256');
        for (let offset = 0; offset < size; offset += chunkSize) digest.update(await read(offset, Math.min(chunkSize, size - offset)));
        json(200, {kind, id, filename: path.basename(attachment?.fileName ?? document.originalFileName ?? file),
          mime, byteSize: size, sha256: digest.digest('hex'), chunkSize}); return;
      }
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? chunkSize);
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || offset < 0 || offset > size || limit < 1 || limit > chunkSize) {
        json(416, {error: 'invalid_file_range'}); return;
      }
      const length = Math.min(limit, size - offset), bytes = request.method === 'HEAD' ? undefined : await read(offset, length);
      response.writeHead(200, {'content-type': mime, 'content-length': String(length), 'cache-control': 'no-store',
        'x-nodus-file-offset': String(offset), 'x-nodus-file-size': String(size)});
      response.end(bytes);
    } catch (error) {
      json((error as Error).message === 'file_changed' ? 409 : 410, {error: (error as Error).message === 'file_changed' ? 'file_changed' : 'file_content_unavailable'});
    } finally { await handle?.close(); }
  }));
}

export async function serveBridgeFile(request: IncomingMessage, response: ServerResponse, url: URL,
  vaultId: string, domains: readonly string[], kind: string, id: string, action: string): Promise<void> {
  const spec = BRIDGE_FILE_KINDS[kind as keyof typeof BRIDGE_FILE_KINDS];
  const json = (status: number, value: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(value));
  };
  const reader = ['libraryOriginal', 'libraryAttachment'].includes(kind);
  const audio = kind === 'audioClip';
  if ((!spec && !reader && !audio) || !domains.includes(reader || audio ? 'corpus' : spec.domain)) { json(403, { error: 'permission_denied' }); return; }
  if (!['descriptor', 'content'].includes(action)) { json(404, { error: 'not_found' }); return; }
  if (reader) { await serveReaderFile(request, response, url, vaultId, kind, id, action); return; }
  if (audio) { await serveAudioClip(request, response, url, vaultId, domains, id, action); return; }
  await withVaultDatabase(vaultId, async () => {
    const db = getDb();
    const deleted = 'deleted' in spec ? ` AND ${spec.deleted} IS NULL` : '';
    const predicate = `${spec.id} = ?${deleted}`;
    const fileColumn = 'path' in spec ? spec.path : 'NULL';
    const row = db.prepare(`SELECT ${spec.name} AS filename, mime_type AS mime, length(${spec.blob}) AS size, ${fileColumn} AS registeredPath FROM ${spec.table} WHERE ${predicate}`).get(id) as { filename: string | null; mime: string | null; size: number | null; registeredPath: string | null } | undefined;
    if (!row) { json(404, { error: 'file_not_found' }); return; }
    let handle: FileHandle | undefined;
    let fileStamp: string | undefined;
    let size = row.size;
    if (size == null && row.registeredPath) {
      // Only the path already registered by Desktop for this opaque record is
      // eligible. No request field can select or replace a filesystem path.
      try {
        let registered = row.registeredPath.startsWith('file:') ? fileURLToPath(row.registeredPath) : row.registeredPath;
        if (!path.isAbsolute(registered)) {
          const vaultRoot = activeVaultDir();
          registered = path.resolve(vaultRoot, registered);
          if (path.relative(vaultRoot,registered).startsWith('..')) { json(403,{error:'invalid_registered_file_path'}); return; }
        }
        handle = await open(await realpath(registered),'r');
        const stat = await handle.stat();
        if (!stat.isFile() || !Number.isSafeInteger(stat.size)) { await handle.close(); handle=undefined; json(410,{error:'file_content_unavailable'}); return; }
        size = stat.size; fileStamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      } catch {
        await handle?.close(); json(410,{error:'file_content_unavailable'}); return;
      }
    }
    if (size == null) { json(410, { error: 'file_content_unavailable' }); return; }
    const chunkSize = 4 * 1024 * 1024;
    const read = db.prepare(`SELECT substr(${spec.blob}, ?, ?) AS bytes FROM ${spec.table} WHERE ${predicate}`);
    const readBytes = async (offset:number,length:number):Promise<Buffer> => {
      if (!handle) return (read.get(offset+1,length,id) as {bytes:Buffer}).bytes;
      const bytes=Buffer.alloc(length);let received=0;
      while(received<length) {
        const result=await handle.read(bytes,received,length-received,offset+received);
        if(!result.bytesRead)throw new Error('file_changed');received+=result.bytesRead;
      }
      return bytes;
    };
    try {
    if (action === 'descriptor') {
      const digest = createHash('sha256');
      for (let offset = 0; offset < size; offset += chunkSize) {
        digest.update(await readBytes(offset, Math.min(chunkSize, size-offset)));
      }
      if (handle) { const stat=await handle.stat(); if(fileStamp !== `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`) { json(409,{error:'file_changed'}); return; } }
      json(200, { kind, id, filename: (row.filename || id).split(/[\\/]/).at(-1), mime: row.mime || 'application/octet-stream', byteSize: size, sha256: digest.digest('hex'), chunkSize });
      return;
    }
    const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? chunkSize);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || offset < 0 || offset > size || limit < 1 || limit > chunkSize) {
      json(416, { error: 'invalid_file_range' }); return;
    }
    const end = Math.min(offset + limit, size);
    const bytes = request.method === 'HEAD' ? Buffer.alloc(0) : await readBytes(offset,end-offset);
    response.writeHead(200, { 'content-type': row.mime || 'application/octet-stream', 'content-length': String(end-offset), 'cache-control': 'no-store', 'x-nodus-file-offset': String(offset), 'x-nodus-file-size': String(size) });
    response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { json(409,{error:'file_changed'}); }
    finally { await handle?.close(); }
  });
}
