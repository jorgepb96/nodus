import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LibraryAttachmentRecord, LibraryCollectionRecord, LibraryItemRecord, LibrarySavedSearchRecord, LibraryViewPreferences } from '@shared/libraryTypes';
import {
  enqueueLibraryExtraction,
  getGlobalLibrarySyncSnapshot,
  globalLibrarySyncAttachmentPath,
  importGlobalLibraryFiles,
  mergeGlobalLibraryItems,
  mergeGlobalLibrarySyncRecord,
  mergeGlobalLibrarySyncTombstone,
  normalizeZoteroImportSelection,
  startZoteroLibraryImport,
} from '../library/libraryService';
import { getNodusServerTokenFor } from '../secrets/secretStore';
import { fetchWithTimeout, normalizeUrl, type VaultServerConfig } from './serverSyncShared';
import { advancingCloudflareCursor, CLOUDFLARE_MAX_PAGES_PER_PASS } from './cloudflareSyncSafety';

type SyncPreferences = LibraryViewPreferences & {
  format: 'nodus.library-view-preferences'; formatVersion: 1; id: string; updatedAt: string;
};
type SyncRecord = LibraryItemRecord | LibraryCollectionRecord | LibrarySavedSearchRecord | SyncPreferences;
type SentRecord = { contentHash: string; versionId: string };
interface SyncState { format: 'nodus.account-library-sync'; formatVersion: 1; cursor: number; sent: Record<string, SentRecord> }
interface CloudVersion {
  sequence: number; recordId: string; versionId: string; baseVersionId: string | null;
  hlc: string; payload: unknown; deleted: boolean; winner: boolean; conflicted: boolean;
}

const EMPTY_STATE: SyncState = { format: 'nodus.account-library-sync', formatVersion: 1, cursor: 0, sent: {} };
let running = false;

function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function contentHash(record: SyncRecord): string {
  return 'clock' in record && record.clock.contentHash ? record.clock.contentHash : digest(JSON.stringify(record));
}
function stateFile(root: string, accountId: string): string {
  return path.join(root, '.nodus', 'account-sync', `${digest(accountId).slice(0, 32)}.json`);
}
function readState(file: string): SyncState {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as SyncState;
    if (value.format === EMPTY_STATE.format && value.formatVersion === 1 && Number.isSafeInteger(value.cursor) && value.sent) return value;
  } catch { /* first run or interrupted temporary file */ }
  return structuredClone(EMPTY_STATE);
}
function writeState(file: string, state: SyncState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
  fs.renameSync(temporary, file);
}
function versionId(record: SyncRecord): string {
  const identity = 'clock' in record ? `${record.clock.deviceId}\0${record.clock.revision}` : record.updatedAt;
  return `libv_${digest(`${record.id}\0${identity}\0${contentHash(record)}`)}`;
}
function hlc(record: SyncRecord): string {
  const timestamp = 'clock' in record ? record.clock.updatedAt : record.updatedAt;
  const millis = Number.isFinite(Date.parse(timestamp)) ? Date.parse(timestamp) : Date.now();
  const counter = 'clock' in record ? Math.max(0, record.clock.revision % 1_000_000) : 0;
  const rawDevice = 'clock' in record ? record.clock.deviceId : 'desktop-global';
  const device = rawDevice.replace(/[^A-Za-z0-9._:~-]/g, '-').slice(0, 128) || 'desktop';
  return `${String(millis).padStart(13, '0')}-${String(counter).padStart(6, '0')}-${device}`;
}

/** A last defensive boundary before global records leave Desktop. Library records contain only
 * relative managed-file names; any future field that accidentally carries an absolute/local
 * path or credential is removed here and covered by the transport privacy test. */
function publicPayload(record: SyncRecord): Record<string, unknown> {
  const forbidden = new Set(['path', 'localPath', 'absolutePath', 'root', 'token', 'credential', 'credentials', 'apiKey', 'providerKey']);
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !forbidden.has(key))
      .map(([key, entry]) => [key, visit(entry)]));
  };
  return visit(record) as Record<string, unknown>;
}

async function identifyAccount(base: string, token: string): Promise<string | null> {
  const response = await fetchWithTimeout(`${base}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const value = await response.json() as { user?: { id?: string } };
  return typeof value.user?.id === 'string' ? value.user.id : null;
}

async function uploadObjects(base: string, token: string, record: SyncRecord): Promise<void> {
  if (record.format !== 'nodus.library-item') return;
  for (const attachment of record.attachments) {
    if (!/^[0-9a-f]{64}$/i.test(attachment.sha256)) continue;
    const file = globalLibrarySyncAttachmentPath(record.id, attachment.id);
    if (!file || !fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    if (digest(bytes) !== attachment.sha256) continue;
    const response = await fetchWithTimeout(`${base}/api/v1/library/objects/${attachment.sha256}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': attachment.mimeType || 'application/octet-stream' },
      body: bytes,
    });
    if (!response.ok) throw new Error(`library_object_put_${response.status}`);
  }
}

async function pushLocal(base: string, token: string, state: SyncState, checkpoint: () => void): Promise<void> {
  const snapshot = getGlobalLibrarySyncSnapshot();
  if (!snapshot) return;
  const current = [...snapshot.collections, ...snapshot.items, ...snapshot.savedSearches, snapshot.preferences];
  const changed = current.filter((record) => state.sent[record.id]?.contentHash !== contentHash(record));
  const missingSearches = Object.keys(state.sent).filter((id) => (id.startsWith('saved-search:') || id.startsWith('nodus:saved-search:'))
    && !snapshot.savedSearches.some((record) => record.id === id));
  for (let offset = 0; offset < Math.min(changed.length, 12 * CLOUDFLARE_MAX_PAGES_PER_PASS); offset += 12) {
    const records = changed.slice(offset, offset + 12);
    for (const record of records) await uploadObjects(base, token, record);
    const versions = records.map((record) => ({
      recordId: record.id,
      versionId: versionId(record),
      baseVersionId: state.sent[record.id]?.versionId ?? null,
      hlc: hlc(record),
      deviceId: snapshot.deviceId,
      payload: 'deletedAt' in record && record.deletedAt ? null : publicPayload(record),
      deleted: Boolean('deletedAt' in record && record.deletedAt),
    }));
    const response = await fetchWithTimeout(`${base}/api/v1/library/records/batch`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ records: versions }),
    });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`library_records_post_${response.status}`);
    const receipt = await response.json() as { accepted?: string[]; duplicate?: string[]; conflicts?: Array<{ versionId: string }> };
    const committed = new Set([...(receipt.accepted ?? []), ...(receipt.duplicate ?? []), ...(receipt.conflicts ?? []).map((value) => value.versionId)]);
    for (let index = 0; index < records.length; index += 1) {
      if (committed.has(versions[index].versionId)) state.sent[records[index].id] = { contentHash: contentHash(records[index]), versionId: versions[index].versionId };
    }
    checkpoint();
    if (records.some((_, index) => !committed.has(versions[index].versionId))) throw new Error('Cloudflare no confirmó todas las versiones de la biblioteca.');
  }
  for (const recordId of missingSearches.slice(0, 12 * CLOUDFLARE_MAX_PAGES_PER_PASS)) {
    const sent = state.sent[recordId];
    const tombstoneId = `libv_${digest(`${recordId}\0deleted\0${sent.versionId}`)}`;
    const response = await fetchWithTimeout(`${base}/api/v1/library/records/batch`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ records: [{ recordId, versionId: tombstoneId, baseVersionId: sent.versionId,
        hlc: `${String(Date.now()).padStart(13, '0')}-000000-desktop-global`, deviceId: snapshot.deviceId, payload: null, deleted: true }] }),
    });
    if (!response.ok) throw new Error(`library_records_post_${response.status}`);
    delete state.sent[recordId];
    checkpoint();
  }
}

async function downloadAttachment(base: string, token: string, item: LibraryItemRecord, attachment: LibraryAttachmentRecord): Promise<void> {
  if (!/^[0-9a-f]{64}$/i.test(attachment.sha256)) return;
  const destination = globalLibrarySyncAttachmentPath(item.id, attachment.id);
  if (!destination || fs.existsSync(destination)) return;
  const response = await fetchWithTimeout(`${base}/api/v1/library/objects/${attachment.sha256}`, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`library_object_get_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== attachment.sha256) throw new Error('library_object_hash_mismatch');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, destination);
}

async function pullRemote(base: string, token: string, state: SyncState, checkpoint: () => void): Promise<boolean> {
  for (let pageIndex = 0; pageIndex < CLOUDFLARE_MAX_PAGES_PER_PASS; pageIndex += 1) {
    const response = await fetchWithTimeout(`${base}/api/v1/library/changes?cursor=${state.cursor}&limit=100`, { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 404) return true;
    if (!response.ok) throw new Error(`library_changes_get_${response.status}`);
    const page = await response.json() as { changes?: CloudVersion[]; cursor?: number; hasMore?: boolean };
    const nextCursor = advancingCloudflareCursor(state.cursor, page.cursor, Boolean(page.hasMore));
    for (const change of page.changes ?? []) {
      if (!change.winner) continue;
      if (change.deleted) mergeGlobalLibrarySyncTombstone(change.recordId);
      else if (change.payload && mergeGlobalLibrarySyncRecord(change.payload)) {
        const item = change.payload as LibraryItemRecord;
        if (item.format === 'nodus.library-item' && Array.isArray(item.attachments)) {
          for (const attachment of item.attachments) await downloadAttachment(base, token, item, attachment);
        }
      }
      const snapshot = getGlobalLibrarySyncSnapshot();
      const record = snapshot && [...snapshot.items, ...snapshot.collections, ...snapshot.savedSearches, snapshot.preferences].find((entry) => entry.id === change.recordId);
      if (record) state.sent[record.id] = { contentHash: contentHash(record), versionId: change.versionId };
    }
    state.cursor = nextCursor;
    checkpoint();
    if (!page.hasMore) return true;
  }
  return false;
}

async function reportCommand(base: string, token: string, id: string, status: string, extra: Record<string, unknown> = {}): Promise<void> {
  await fetchWithTimeout(`${base}/api/v1/library/commands/${encodeURIComponent(id)}/status`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status, ...extra }),
  });
}

async function executeCommand(base: string, token: string, command: { id: string; kind: string; payload: Record<string, unknown> }): Promise<unknown> {
  const payload = command.payload;
  if (command.kind === 'extract') {
    const itemIds = Array.isArray(payload.itemIds) ? payload.itemIds.filter((value): value is string => typeof value === 'string') : [];
    return enqueueLibraryExtraction(itemIds, {}, 100);
  }
  if (command.kind === 'merge') {
    const itemIds = Array.isArray(payload.itemIds) ? payload.itemIds.filter((value): value is string => typeof value === 'string') : [];
    if (itemIds.length < 2) throw new Error('merge_requires_two_items');
    return mergeGlobalLibraryItems(itemIds[0], itemIds.slice(1));
  }
  if (command.kind === 'zoteroSync') {
    const report = await startZoteroLibraryImport(command.id, normalizeZoteroImportSelection(payload.selection), () => undefined);
    if (report.partial || report.verification?.status === 'blocked' || report.canceled) {
      throw new Error('zotero_import_verification_failed');
    }
    return report;
  }
  if (command.kind === 'import') {
    const objects = Array.isArray(payload.objects) ? payload.objects : [];
    const snapshot = getGlobalLibrarySyncSnapshot();
    if (!snapshot) throw new Error('library_not_configured');
    const staged: string[] = [];
    for (const raw of objects) {
      const entry = raw as { hash?: unknown; fileName?: unknown };
      const hash = String(entry.hash ?? ''); if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('bad_object_hash');
      const response = await fetchWithTimeout(`${base}/api/v1/library/objects/${hash}`, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`library_object_get_${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer()); if (digest(bytes) !== hash) throw new Error('library_object_hash_mismatch');
      const file = path.join(snapshot.root, '.nodus', 'incoming', `${randomUUID()}-${path.basename(String(entry.fileName ?? hash))}`);
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); staged.push(file);
    }
    try { return await importGlobalLibraryFiles(staged, typeof payload.collectionId === 'string' ? payload.collectionId : null); }
    finally { for (const file of staged) fs.rmSync(file, { force: true }); }
  }
  throw new Error('library_command_handler_not_enabled');
}

async function drainCommand(base: string, token: string): Promise<void> {
  const response = await fetchWithTimeout(`${base}/api/v1/library/commands/claim`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
  });
  if (response.status === 404 || response.status === 403 || !response.ok) return;
  const value = await response.json() as { command?: { id: string; kind: string; payload: Record<string, unknown> } | null };
  if (!value.command) return;
  await reportCommand(base, token, value.command.id, 'running');
  try { await reportCommand(base, token, value.command.id, 'applied', { result: await executeCommand(base, token, value.command) }); }
  catch (error) { await reportCommand(base, token, value.command.id, 'failed', { errorCode: error instanceof Error ? error.message.slice(0, 128) : 'library_command_failed' }); }
}

/** One bounded two-way pass. Called by the existing thirty-second Desktop inbox lane so global
 * Library work remains sequential and never creates a second background scheduler. */
export async function drainAccountLibrary(config: VaultServerConfig): Promise<void> {
  if (running || config.kind !== 'cloudflare' || !config.configured || !config.enabled) return;
  const token = getNodusServerTokenFor(config.vaultId); if (!token) return;
  const snapshot = getGlobalLibrarySyncSnapshot(); if (!snapshot) return;
  const base = normalizeUrl(config.url);
  running = true;
  try {
    const accountId = await identifyAccount(base, token); if (!accountId) return;
    const file = stateFile(snapshot.root, accountId); const state = readState(file);
    // Pull first so a mobile edit becomes the base for any Desktop write observed this tick.
    if (!await pullRemote(base, token, state, () => writeState(file, state))) return;
    await pushLocal(base, token, state, () => writeState(file, state));
    await drainCommand(base, token);
    writeState(file, state);
  } finally { running = false; }
}

export const ACCOUNT_LIBRARY_COMMAND_KINDS = Object.freeze(['import', 'extract', 'zoteroSync', 'merge']);
