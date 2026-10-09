import { researchActivityStep } from '../ai/researchActivity';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ResolvedResearchScope, ZoteroMcpStatus } from '@shared/researchCorpus';
import { ManagedZoteroConnection, type ManagedZoteroScopeManifest, type ManagedZoteroTool } from './managedZotero';
import { registerNotebookRun, resolveResearchNotebook, resolveAcademicResearchScope } from '../ai/researchNotebookService';
import { researchCorpusInventory } from '../ai/researchCorpusInventory';
import { assertResearchDocument, documentsById } from '../ai/researchCorpusScope';
import { itemChildren, attachmentFilePath, ZOTERO_API_BASE } from '../zotero/zoteroClient';
import { getGlobalLibraryItem } from '../library/libraryService';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getWork } from '../db/worksRepo';
import { documentaryStore } from '../ai/documentaryPreparation';

const runtimePath = () => app.isPackaged ? path.join(process.resourcesPath, 'zotero-mcp') : path.join(app.getAppPath(), 'build/zotero-mcp');
interface Session {
  id: string; scope: ResolvedResearchScope; connection: ManagedZoteroConnection; root: string | null;
  closing?: Promise<void>; controller: AbortController; release: () => void; manifest?: ManagedZoteroScopeManifest; manual: boolean;
}
const sessions = new Map<string, Session>();
function externalChoice(scope: Pick<ResolvedResearchScope, 'vaultId' | 'notebookId'>): string | undefined {
  return (documentaryStore().db.prepare('SELECT endpoint FROM documentary_mcp_choices WHERE vault_id=? AND notebook_id=?').get(scope.vaultId, scope.notebookId ?? '') as { endpoint: string } | undefined)?.endpoint;
}
function setExternalChoice(scope: Pick<ResolvedResearchScope, 'vaultId' | 'notebookId'>, endpoint?: string): void {
  if (endpoint) documentaryStore().db.prepare('INSERT INTO documentary_mcp_choices VALUES(?,?,?) ON CONFLICT(vault_id,notebook_id) DO UPDATE SET endpoint=excluded.endpoint').run(scope.vaultId, scope.notebookId ?? '', endpoint);
  else documentaryStore().db.prepare('DELETE FROM documentary_mcp_choices WHERE vault_id=? AND notebook_id=?').run(scope.vaultId, scope.notebookId ?? '');
}
const stopped: ZoteroMcpStatus = { installed: false, mode: 'managed', state: 'stopped', version: null, transport: 'stdio', error: null };
let diagnostic: ZoteroMcpStatus = { ...stopped };
const enabled = () => documentaryStore().preference('managed-zotero-disabled') !== true;
export function getResearchZoteroStatus(notebookId?: string | null): ZoteroMcpStatus {
  const session = [...sessions.values()].at(-1);
  const externalUrl = externalChoice({ vaultId: getActiveVault().id, notebookId: notebookId ?? null });
  return { ...(session?.connection.status ?? diagnostic), installed: fs.existsSync(path.join(runtimePath(), 'runtime.json')),
    externalUrl: externalUrl ?? null,
    automatic: enabled(), sessionId: session?.id ?? null, activeSessions: sessions.size,
    ...(!enabled() && !session ? { state: 'disabled' as const } : {}), notebookId: session?.scope.notebookId ?? null, scopeId: session?.scope.id ?? null };
}
function closeSession(session: Session): Promise<void> {
  return session.closing ??= Promise.resolve().then(async () => {
    session.controller.abort(); session.release();
    try { await session.connection.close(); }
    finally {
      if (session.root) await fs.promises.rm(session.root, { recursive: true, force: true });
      if (sessions.get(session.id) === session) sessions.delete(session.id);
      if (!sessions.size && diagnostic.state === 'connected') diagnostic = { ...diagnostic, state: 'stopped' };
    }
  });
}
/** App shutdown closes only processes created by this module. */
export async function closeResearchZotero(): Promise<void> { await Promise.all([...sessions.values()].map(closeSession)); }
/** Compatibility disconnect affects the manual diagnostic connection, not live runs. */
export async function disconnectResearchZotero(notebookId?: string | null): Promise<void> {
  const manual = [...sessions.values()].filter(session => session.manual && (notebookId === undefined || session.scope.notebookId === notebookId));
  for (const session of manual) setExternalChoice(session.scope);
  if (notebookId !== undefined) setExternalChoice({ vaultId: getActiveVault().id, notebookId });
  await Promise.all(manual.map(closeSession));
}
export async function setResearchZoteroAutomatic(value: boolean): Promise<ZoteroMcpStatus> {
  if (typeof value !== 'boolean') throw new Error('research_invalid_mcp_setting');
  documentaryStore().setPreference('managed-zotero-disabled', !value);
  if (!value) await Promise.all([...sessions.values()].filter(session => !session.manual && session.connection.status.mode === 'managed').map(closeSession));
  return getResearchZoteroStatus();
}
async function metadata(endpoint: string, libraryType: 'user' | 'group', libraryId: string, key: string, serverId?: string, signal?: AbortSignal) {
  if (!/^\d+$/.test(libraryId) || !/^[A-Z0-9]{8}$/.test(key)) throw new Error('research_invalid_zotero_identity');
  const response = await fetch(`${endpoint}/${libraryType === 'user' ? 'users' : 'groups'}/${libraryId}/items/${key}`, {
    redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), headers: { 'Zotero-API-Version': '3', 'Zotero-Allowed-Request': '1', ...(serverId ? { 'Zotero-Server-ID': serverId } : {}) },
  });
  const identity = response.headers.get('Zotero-Server-ID');
  if (!response.ok || !identity || (serverId && serverId !== identity)) throw new Error('research_zotero_endpoint_identity_mismatch');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('research_zotero_metadata_invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 8 * 1024 * 1024) throw new Error('research_zotero_metadata_too_large');
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { key: string; version: number; data?: { parentItem?: string } };
  if (value.key !== key || !Number.isSafeInteger(value.version)) throw new Error('research_zotero_metadata_invalid');
  return { ...value, serverId: identity };
}

function validateScope(expected: ResolvedResearchScope): void {
  if (getActiveVault().id !== expected.vaultId) throw new Error('research_scope_changed');
  const inventory = researchCorpusInventory();
  const notebook = expected.notebookId ? resolveResearchNotebook(expected.notebookId) : null;
  if (notebook && notebook.notebookRevision !== expected.notebookRevision) throw new Error('research_scope_changed');
  // Indexed once: a linear find per scope document is quadratic in the library. A failed automatic
  // read checks the whole scope, and on a 14,000-work library that one check took 1.7 s of the main
  // thread (profile of a real chat turn, 2026-10-09).
  const current = documentsById(inventory.documents);
  for (const document of expected.documents) assertResearchDocument(expected, document.id, current.get(document.id));
}
export type ZoteroOriginalPins = Map<string, { serverId: string; attachments: Record<string, number> } | null>;
export async function pinZoteroOriginals(scope: ResolvedResearchScope, signal?: AbortSignal): Promise<ZoteroOriginalPins> {
  const pins: ZoteroOriginalPins = new Map();
  for (const document of scope.documents) {
    if (document.origin.kind !== 'zotero') continue;
    pins.set(document.id, null);
    if (!enabled()) continue;
    try {
      validateScope(scope); signal?.throwIfAborted();
      const origin = document.origin;
      const parent = await metadata(ZOTERO_API_BASE, origin.libraryType, origin.libraryId, origin.itemKey, undefined, signal);
      const item = document.libraryItemId ? getGlobalLibraryItem(document.libraryItemId) : null;
      const work = document.workId ? getWork(document.workId) : null;
      if ((item?.sourceVersion ?? work?.zotero_version) !== parent.version) continue;
      const key = origin.libraryType === 'group' ? `groups:${origin.libraryId}:${origin.itemKey}` : origin.itemKey;
      const children = await itemChildren(origin.libraryId, key, signal);
      const attachments: Record<string, number> = {};
      for (const child of children) {
        const childKey = child.key.replace(/^groups:[^:]+:/, '');
        if (item && !item.attachments.some(attachment => attachment.sourceKey === childKey)) continue;
        const childMetadata = await metadata(ZOTERO_API_BASE, origin.libraryType, origin.libraryId, childKey, parent.serverId, signal);
        if (childMetadata.data?.parentItem !== origin.itemKey) throw new Error('research_attachment_not_authorized');
        attachments[childKey] = childMetadata.version;
      }
      validateScope(scope); pins.set(document.id, { serverId: parent.serverId, attachments });
    } catch { signal?.throwIfAborted(); validateScope(scope); }
  }
  return pins;
}
async function createSession(resolved: ResolvedResearchScope, mode: 'managed' | 'external', externalUrl: string | undefined, manual: boolean, signal?: AbortSignal, pins?: ZoteroOriginalPins): Promise<Session> {
  signal?.throwIfAborted(); validateScope(resolved);
  if (!manual && mode === 'managed' && !enabled()) throw new Error('research_mcp_disabled');
  // Reserve before the first await. Two overlapping starts cannot claim one slot.
  if (sessions.size >= 2) throw new Error('research_mcp_session_limit');
  const session: Session = { id: randomUUID(), scope: structuredClone(resolved), connection: new ManagedZoteroConnection(), root: null,
    controller: new AbortController(), release: () => {}, manual };
  sessions.set(session.id, session);
  session.controller.signal.addEventListener('abort', () => { void closeSession(session); }, { once: true });
  const abort = () => { session.controller.abort(); void session.connection.close(); };
  signal?.addEventListener('abort', abort, { once: true });
  const releaseNotebook = resolved.notebookId ? registerNotebookRun(resolved.notebookId, session.controller) : () => {};
  session.release = () => { releaseNotebook(); signal?.removeEventListener('abort', abort); };
  const check = () => { session.controller.signal.throwIfAborted(); validateScope(resolved); };
  try {
    const endpoint = new URL(ZOTERO_API_BASE);
    if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname) || !endpoint.port || endpoint.pathname !== '/api'
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('research_zotero_endpoint_invalid');
    const parent = path.join(app.getPath('userData'), 'mcp', 'zotero');
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    if (fs.realpathSync(parent) !== parent) throw new Error('research_mcp_profile_symlink');
    session.root = fs.mkdtempSync(path.join(parent, 'session-'));
    const items: ManagedZoteroScopeManifest['items'] = [];
    let serverId = '';
    for (const document of resolved.documents) {
      check();
      if (document.origin.kind !== 'zotero') continue;
      const { libraryType, libraryId, itemKey } = document.origin;
      const pin = pins?.get(document.id);
      if (pins && !pin) throw new Error('research_original_revision_unavailable');
      const current = await metadata(endpoint.href, libraryType, libraryId, itemKey, serverId || undefined, session.controller.signal);
      check(); serverId = current.serverId;
      if (pin && pin.serverId !== serverId) throw new Error('research_source_revision_changed');
      const libraryItem = document.libraryItemId ? getGlobalLibraryItem(document.libraryItemId) : null;
      const work = document.workId ? getWork(document.workId) : null;
      const version = libraryItem?.sourceVersion ?? work?.zotero_version;
      if (version == null || version !== current.version) throw new Error('research_source_revision_changed');
      const canonicalKey = libraryType === 'group' ? `groups:${libraryId}:${itemKey}` : itemKey;
      const children = await itemChildren(libraryId, canonicalKey, session.controller.signal);
      check();
      const selectedKeys = libraryItem ? new Set(libraryItem.attachments.map(item => item.sourceKey).filter(Boolean)) : null;
      const attachments: ManagedZoteroScopeManifest['items'][number]['attachments'] = [];
      for (const child of children) {
        const key = child.key.replace(/^groups:[^:]+:/, '');
        if (selectedKeys && !selectedKeys.has(key)) continue;
        if (pin && !(key in pin.attachments)) continue;
        const attachment = await metadata(endpoint.href, libraryType, libraryId, key, serverId, session.controller.signal);
        check();
        if (pin && pin.attachments[key] !== attachment.version) throw new Error('research_source_revision_changed');
        if (attachment.data?.parentItem !== itemKey) throw new Error('research_attachment_not_authorized');
        const known = libraryItem?.attachments.find(item => item.sourceKey === key);
        if (known?.sourceVersion != null && known.sourceVersion !== attachment.version) throw new Error('research_source_revision_changed');
        const entry: typeof attachments[number] = { key, version: attachment.version };
        // The Python reader sees only a bounded, hashed, private copy. No path
        // supplied by the model or an external server is ever opened by Nodus.
        if (child.contentType === 'application/pdf') {
          const source = await attachmentFilePath(libraryId, child.key, child.library, session.controller.signal);
          check();
          if (source) {
            if ((await fs.promises.stat(source)).size > 256 * 1024 * 1024) throw new Error('documentary_attachment_too_large');
            const bytes = await fs.promises.readFile(source);
            entry.sha256 = createHash('sha256').update(bytes).digest('hex');
            if (known?.sha256 && known.sha256 !== entry.sha256) throw new Error('research_source_revision_changed');
            entry.path = path.join(session.root, `${key}.pdf`);
            await fs.promises.writeFile(entry.path, bytes, { flag: 'wx', mode: 0o600 });
            await metadata(endpoint.href, libraryType, libraryId, key, serverId, session.controller.signal).then(after => { if (after.version !== entry.version) throw new Error('research_source_revision_changed'); });
          }
        }
        attachments.push(entry);
      }
      items.push({ libraryType, libraryId, itemKey, revision: document.revision, version: current.version, attachments });
    }
    check(); if (!serverId) throw new Error('research_no_zotero_sources');
    session.manifest = { format: 'nodus.zotero-mcp-scope/1', root: session.root, endpoint: endpoint.href, serverId, items };
    await (mode === 'managed' ? session.connection.connectManaged(runtimePath(), session.manifest) : session.connection.connectExternal(externalUrl ?? '', session.manifest));
    check(); diagnostic = { ...session.connection.status }; return session;
  } catch (error) {
    diagnostic = { ...stopped, state: 'zotero_unavailable', error: error instanceof Error && /^research_|^managed_/.test(error.message) ? error.message : 'research_zotero_unavailable' };
    await closeSession(session); throw error;
  }
}
type ConnectionInput = { notebookId?: string | null; mode: 'managed' | 'external'; externalUrl?: string };
export async function connectResearchZotero(input: ConnectionInput) {
  if (!input || !['managed', 'external'].includes(input.mode)) throw new Error('research_invalid_mcp_mode');
  if (input.mode === 'external') {
    const endpoint = new URL(input.externalUrl ?? '');
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('external_zotero_endpoint_invalid');
  }
  await Promise.all([...sessions.values()].filter(session => session.manual).map(closeSession));
  const scope = input.notebookId ? resolveResearchNotebook(input.notebookId) : resolveAcademicResearchScope();
  await createSession(scope, input.mode, input.externalUrl, true);
  setExternalChoice(scope, input.mode === 'external' ? input.externalUrl : undefined);
  return getResearchZoteroStatus(scope.notebookId);
}
async function readSession(session: Session, input: { documentId: string; operation: 'metadata' | 'fulltext' | 'pages'; attachmentKey?: string; from?: number; to?: number }, observe = true): Promise<unknown> {
  session.controller.signal.throwIfAborted(); validateScope(session.scope);
  const document = session.scope.documents.find(item => item.id === input.documentId);
  if (!document || document.origin.kind !== 'zotero') throw new Error('research_source_not_authorized');
  const origin = document.origin;
  const tool: ManagedZoteroTool = input.operation === 'metadata' ? 'zotero_get_item_metadata' : input.operation === 'fulltext' ? 'zotero_get_item_fulltext' : input.operation === 'pages' ? 'zotero_read_pdf_pages' : (() => { throw new Error('research_invalid_mcp_operation'); })();
  const available = session.manifest?.items.find(item => item.itemKey === origin.itemKey && item.libraryId === origin.libraryId && item.libraryType === origin.libraryType)?.attachments ?? [];
  const key = input.attachmentKey ?? (available.length === 1 ? available[0].key : undefined);
  if (input.operation !== 'metadata' && !key) throw new Error('research_attachment_selection_required');
  const call = () => session.connection.call(tool, {
    library_type: origin.libraryType, library_id: origin.libraryId, item_key: origin.itemKey,
    ...(input.operation !== 'metadata' ? { attachment_key: key } : {}),
    ...(input.operation === 'pages' ? { start_page: input.from, end_page: input.to ?? input.from } : {}),
  }, session.controller.signal);
  const result = await (observe ? researchActivityStep('zotero', input.operation, call, document.title) : call());
  session.controller.signal.throwIfAborted(); validateScope(session.scope);
  return result;
}
export async function readResearchZotero(input: { notebookId?: string | null; documentId: string; operation: 'metadata' | 'fulltext'; attachmentKey?: string }) {
  const session = [...sessions.values()].find(item => item.manual && item.scope.notebookId === (input.notebookId ?? null));
  if (!session || session.controller.signal.aborted) throw new Error('research_mcp_scope_mismatch');
  return readSession(session, input);
}
/** Lazy managed original access; a run owns the immutable scope and this lease.
 * Closing/cancelling it cannot close another run's connection or an external MCP. */
export async function readAutomaticResearchZotero(scope: ResolvedResearchScope, input: { documentId: string; from: number; to?: number; attachmentKey?: string }, signal?: AbortSignal, pins?: ZoteroOriginalPins): Promise<unknown> {
  const document = scope.documents.find(item => item.id === input.documentId);
  if (!document) throw new Error('research_source_not_authorized');
  // Startup can fail before a tool is called. Observe the whole attempt so a
  // missing runtime or unavailable Zotero appears as an error, never as idle.
  return researchActivityStep('zotero', 'pages', async () => {
    const external = externalChoice(scope);
    for (let attempt = 0; ; attempt++) {
      let session: Session | undefined;
      try {
        session = await createSession(external ? scope : { ...scope, documents: [document] }, external ? 'external' : 'managed', external, false, signal, pins);
        return await readSession(session, { ...input, operation: 'pages' }, false);
      } catch (error) {
        signal?.throwIfAborted(); validateScope(scope);
        // One fresh managed process may recover a dead transport. Identity,
        // permission, revision and capability failures are never retried.
        if (external || attempt > 0 || !/Connection closed|EPIPE|ECONNRESET|managed_zotero_unavailable/.test(error instanceof Error ? error.message : '')) throw error;
      } finally { if (session) await closeSession(session); }
    }
  }, document.title);
}
