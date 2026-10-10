import { createHash } from 'node:crypto';
import { getDb, withVaultDatabase } from '../db/database';
import { withOwningVault } from '../vaults/vaultRegistry';
import { createNoteWithIdentity, getNote } from '../db/notesRepo';
import { getWorkspaceNoteEditorData, updateWorkspaceNote } from '../db/workspaceRepo';
import { canonicalJson } from '../../shared/canonicalJson';
import type { StudyDocUpdateInput } from '../../shared/studyEditor';
import { withMobileOperation } from './executionBoundary';
import { invalidateLiveCorpus } from './liveCorpus';

export class WorkspaceEditFailure extends Error {
  constructor(public readonly code: string, public readonly remote?: unknown) { super(code); }
}

const fields = new Set(['academicMetadata', 'nativeDocument', 'schemaVersion', 'expectedRevision', 'title', 'contentMarkdown', 'style', 'spellcheckLanguage', 'customDictionary', 'reason']);

/** A complete editor save and its acknowledgement commit together in the owning
 * vault. Replaying a lost acknowledgement must not create another Yjs revision. */
export async function applyWorkspaceEdit(vaultId: string, grantId: string, raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WorkspaceEditFailure('invalid_workspace_edit');
  const { id, noteId, input, creation } = raw as { id?: unknown; noteId?: unknown; input?: unknown; creation?: unknown };
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
      typeof noteId !== 'string' || !noteId || noteId.length > 128 ||
      !input || typeof input !== 'object' || Array.isArray(input)) throw new WorkspaceEditFailure('invalid_workspace_edit');
  const value = input as StudyDocUpdateInput;
  if (Object.keys(value).some(key => !fields.has(key)) || typeof value.title !== 'string' || value.title.length > 4096 ||
      typeof value.contentMarkdown !== 'string' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision! < 0)
    throw new WorkspaceEditFailure('invalid_workspace_edit');
  const create = creation as { kind: 'markdown'; folderId: string | null; tags: string[] } | undefined;
  if (creation !== undefined && (!create || typeof create !== 'object' || Array.isArray(create) ||
      Object.keys(create).some(key => !['kind', 'folderId', 'tags'].includes(key)) ||
      create.kind !== 'markdown' || (create.folderId !== null && (typeof create.folderId !== 'string' || !create.folderId || create.folderId.length > 128)) ||
      !Array.isArray(create.tags) || create.tags.length > 100 || create.tags.some(tag => typeof tag !== 'string' || tag.length > 80) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(noteId) ||
      value.expectedRevision !== 0 || !Array.isArray(value.nativeDocument) || value.schemaVersion !== 2))
    throw new WorkspaceEditFailure('invalid_workspace_creation');
  const payload = createHash('sha256').update(canonicalJson({ noteId, input: value, ...(create ? { creation: create } : {}) })).digest('hex');
  const result = await withOwningVault(vaultId, () => withVaultDatabase(vaultId, () => {
    const db = getDb();
    db.exec('CREATE TABLE IF NOT EXISTS desktop_workspace_edit_receipts (grant_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, result_json TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY(grant_id,request_id))');
    return db.transaction(() => {
      const receipt = db.prepare('SELECT payload_hash,result_json FROM desktop_workspace_edit_receipts WHERE grant_id=? AND request_id=?').get(grantId, id) as { payload_hash: string; result_json: string } | undefined;
      if (receipt) {
        if (receipt.payload_hash !== payload) throw new WorkspaceEditFailure('idempotency_conflict');
        return JSON.parse(receipt.result_json);
      }
      let note = getNote(noteId);
      if (create) {
        if (note) throw new WorkspaceEditFailure('identity_conflict');
        note = withMobileOperation(() => createNoteWithIdentity({ title: value.title, content: '', kind: 'markdown', folderId: create.folderId, tags: create.tags }, noteId));
      }
      if (!note || note.trashedAt) throw new WorkspaceEditFailure('document_unavailable');
      const current = withMobileOperation(() => getWorkspaceNoteEditorData(noteId));
      if (!create && current.revision !== value.expectedRevision) throw new WorkspaceEditFailure('revision_conflict', current);
      const saved = withMobileOperation(() => updateWorkspaceNote(noteId, { ...value, expectedRevision: current.revision }));
      const editorData = withMobileOperation(() => getWorkspaceNoteEditorData(noteId));
      const committed = { id, note: saved, editorData };
      db.prepare('INSERT INTO desktop_workspace_edit_receipts VALUES(?,?,?,?,?)').run(grantId, id, payload, JSON.stringify(committed), new Date().toISOString());
      return committed;
    })();
  }));
  invalidateLiveCorpus(vaultId);
  return result;
}
