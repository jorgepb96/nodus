import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import * as pages from '../db/pagesRepo';
import type { IncomingMutation, ExternalMutationDecision } from './mutationInbox';
import { serverFetchWithTimeout as request } from './serverNetwork';
const SHARED_BLOB_CHUNK_BYTES = 1024 * 1024;
const normalizeUrl = (value: string) => value.replace(/\/+$/, '');

export async function hydrateBinaryMutations(db: Database.Database, mutations: IncomingMutation[], base: string, spaceId: string, token: string, cloudflare = false): Promise<void> {
    for (const mutation of mutations) {
      if (mutation.table !== 'page_document_updates' || mutation.kind !== 'upsert') continue;
      const hash = String(mutation.documentHash ?? mutation.row?.update_hash ?? '');
      if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('El servidor entregó una actualización Yjs sin hash válido.');
      const binary = await request(
        `${normalizeUrl(base)}/api/v1/spaces/${encodeURIComponent(spaceId)}/document-updates/${hash}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!binary.ok) throw new Error(`No se pudo descargar la actualización Yjs ${hash.slice(0, 12)} (HTTP ${binary.status}).`);
      const announced = Number(binary.headers.get('content-length') || 0);
      if (announced > 8 * 1024 * 1024) throw new Error('La actualización Yjs supera 8 MiB.');
      const bytes = Buffer.from(await binary.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024) throw new Error('La actualización Yjs supera 8 MiB.');
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Una actualización Yjs no coincide con su hash.');
      mutation.row = { ...(mutation.row ?? {}), update_blob: bytes, update_hash: hash };
    }
    for (const mutation of mutations) {
      if (mutation.table !== 'db_attachments' || mutation.kind !== 'upsert') continue;
      const hash = String(mutation.blobHash ?? mutation.row?.blob_hash ?? '');
      if (!hash) continue;
      if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('El servidor entregó un adjunto sin hash válido.');
      if (db.prepare('SELECT 1 FROM db_blobs WHERE hash = ?').get(hash)) continue;
      const expected = Number(mutation.row?.bytes ?? 0);
      if (!Number.isSafeInteger(expected) || expected < 1 || expected > (cloudflare ? 32 : 128) * 1024 * 1024) throw new Error('El adjunto supera el tamaño permitido.');
      const chunks: Buffer[] = [];
      for (let start = 0; start < expected; start += SHARED_BLOB_CHUNK_BYTES) {
        const end = Math.min(expected - 1, start + SHARED_BLOB_CHUNK_BYTES - 1);
        const part = await request(
          `${normalizeUrl(base)}/api/v1/spaces/${encodeURIComponent(spaceId)}/blobs/${hash}`,
          { headers: { authorization: `Bearer ${token}`, range: `bytes=${start}-${end}` } },
        );
        if (part.status !== 206 && !(start === 0 && part.status === 200)) throw new Error(`No se pudo reanudar el adjunto ${hash.slice(0, 12)}.`);
        const chunk = Buffer.from(await part.arrayBuffer());
        if (chunk.length !== end-start+1) throw new Error('El servidor devolvió un rango de adjunto incorrecto.');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length !== expected || createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Un adjunto descargado no coincide con su checksum.');
      const timestamp = new Date().toISOString();
      db.prepare(
        `INSERT OR IGNORE INTO db_blobs
          (hash, bytes, mime_type, data, revision, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      ).run(hash, bytes.length, mutation.row?.mime_type ?? null, bytes, mutation.actorId || 'remote', mutation.actorId || 'remote', timestamp, timestamp);
    }
}

export function applyBinaryMutation(db: Database.Database, mutation: IncomingMutation): ExternalMutationDecision | null {
        if (mutation.table === 'page_revisions' && mutation.kind === 'upsert') {
          const pageId = String(mutation.row?.page_id ?? '');
          const revision = Number(mutation.row?.revision ?? 0);
          if (pageId && revision > 0 && db.prepare('SELECT 1 FROM page_revisions WHERE page_id = ? AND revision = ?').get(pageId, revision)) {
            return { outcome: 'keptLocal', entityKind: 'page_revision' };
          }
        }
        if (mutation.table !== 'page_document_updates' || mutation.kind !== 'upsert') return null;
        const hash = String(mutation.documentHash ?? mutation.row?.update_hash ?? '');
        const pageId = String(mutation.row?.page_id ?? '');
        const bytes = mutation.row?.update_blob;
        if (!pageId || !Buffer.isBuffer(bytes)) throw new Error('La actualización Yjs está incompleta.');
        if (db.prepare('SELECT 1 FROM page_document_update_receipts WHERE update_hash = ?').get(hash)
          || db.prepare('SELECT 1 FROM page_document_updates WHERE page_id = ? AND update_hash = ?').get(pageId, hash)) {
          db.prepare(
            'INSERT OR IGNORE INTO page_document_update_receipts (update_hash, page_id, operation_id, applied_at) VALUES (?, ?, ?, ?)',
          ).run(hash, pageId, mutation.id, new Date().toISOString());
          return { outcome: 'keptLocal' };
        }
        const current = pages.getPageDocument(pageId);
        if (!current) throw new Error('La página de la actualización Yjs no existe todavía.');
        const applied = pages.applyPageDocumentUpdate(pageId, new Uint8Array(bytes), current.revision, mutation.actorId || 'remote');
        if (!applied.ok) throw new Error('La página cambió mientras se aplicaba su actualización Yjs.');
        db.prepare(
          'INSERT OR IGNORE INTO page_document_update_receipts (update_hash, page_id, operation_id, applied_at) VALUES (?, ?, ?, ?)',
        ).run(hash, pageId, mutation.id, new Date().toISOString());
        return { outcome: 'applied', entityKind: 'page_update', title: applied.document.page.title };
}
