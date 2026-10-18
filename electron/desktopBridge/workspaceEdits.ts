import {validWorkspaceNoteSource,WORKSPACE_NOTE_KINDS} from '../../shared/mobileWorkspaceNoteCreation';
import type {NoteKind,NoteSource} from '../../shared/types';
import { parseMobileAnnotationCommand, type MobileAnnotationCommand } from './mobileAnnotationEdits';
import {applyWorkspaceOrganization} from './workspaceOrganizationEdits';
import { createHash } from 'node:crypto';
import { getDb, withVaultDatabase } from '../db/database';
import { withOwningVault } from '../vaults/vaultRegistry';
import { createNoteWithIdentity, getNote, trashNotes } from '../db/notesRepo';
import { createManualIdeaWithIdentity } from '../db/manualIdeasRepo';
import { getIdea } from '../db/ideasRepo';
import { getWorkspaceNoteEditorData, updateWorkspaceNote, createWorkspaceAnnotationWithIdentity, updateWorkspaceAnnotation, deleteWorkspaceAnnotation, duplicateWorkspaceNoteWithIdentity } from '../db/workspaceRepo';
import { canonicalJson } from '../../shared/canonicalJson';
import { MOBILE_WORKSPACE_EDIT_MAX_BYTES } from '../../shared/mobileWorkspace';
import type { StudyDocUpdateInput, StudyAnnotationInput } from '../../shared/studyEditor';
import { withMobileOperation } from './executionBoundary';
import { invalidateLiveCorpus } from './liveCorpus';

export class WorkspaceEditFailure extends Error {
  constructor(public readonly code: string, public readonly remote?: unknown) { super(code); }
}

const fields = new Set(['academicMetadata', 'nativeDocument', 'schemaVersion', 'expectedRevision', 'title', 'contentMarkdown', 'style', 'spellcheckLanguage', 'customDictionary', 'reason']);

/** Content is covered by the editor revision; placements, tags and provenance
 * have their own strict fingerprint, including the actual folder ancestry. */
export function mobileWorkspaceCommandSource(noteId: string) {
  const document = getNote(noteId);
  if (!document) throw new WorkspaceEditFailure('document_unavailable');
  const folders: unknown[] = [], visited = new Set<string>();
  let id = document.folderId;
  while (id) {
    if (visited.has(id) || visited.size >= 1000) throw new WorkspaceEditFailure('placement_unavailable');
    visited.add(id);
    const row = getDb().prepare('SELECT id,parent_id,name,order_idx,summary FROM note_folders WHERE id=?').get(id) as {parent_id:string|null}|undefined;
    if (!row) throw new WorkspaceEditFailure('placement_unavailable');
    folders.push(row); id = row.parent_id;
  }
  const metadata = {kind:document.kind,folderId:document.folderId,tags:document.tags,source:document.source,orderIdx:document.orderIdx,trashedAt:document.trashedAt};
  return {version:1,document,placements:[],fingerprint:createHash('sha256').update(canonicalJson({metadata,folders})).digest('hex')};
}
export function mobileWorkspaceEditorData(noteId: string) {
  const editor = getWorkspaceNoteEditorData(noteId);
  try { return {...editor, mobileCommandSource: mobileWorkspaceCommandSource(noteId)}; }
  catch (error) {
    // A broken organization path disables metadata-sensitive commands, not the
    // existing editor read/save contract or consultation of its complete body.
    if (error instanceof WorkspaceEditFailure && error.code === 'placement_unavailable') return {...editor, mobileCommandSource:null, mobileCommandSourceIssue:error.code};
    throw error;
  }
}

/** A complete editor save and its acknowledgement commit together in the owning
 * vault. Replaying a lost acknowledgement must not create another Yjs revision. */
export async function applyWorkspaceEdit(vaultId: string, grantId: string, raw: unknown): Promise<unknown> {
  if ((raw as {command?:{action?:unknown}} | null)?.command?.action === 'workspaceOrganization') return applyWorkspaceOrganization(vaultId, grantId, raw);
  if (Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8') > MOBILE_WORKSPACE_EDIT_MAX_BYTES) throw new WorkspaceEditFailure('workspace_edit_too_large');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WorkspaceEditFailure('invalid_workspace_edit');
  const { id, noteId, input, creation, command } = raw as { id?: unknown; noteId?: unknown; input?: unknown; creation?: unknown; command?: unknown };
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
      typeof noteId !== 'string' || !noteId || noteId.length > 128 ||
      !input || typeof input !== 'object' || Array.isArray(input)) throw new WorkspaceEditFailure('invalid_workspace_edit');
  const value = input as StudyDocUpdateInput;
  if (Object.keys(value).some(key => !fields.has(key)) || typeof value.title !== 'string' || value.title.length > 4096 ||
      typeof value.contentMarkdown !== 'string' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision! < 0)
    throw new WorkspaceEditFailure('invalid_workspace_edit');
  const create = creation as { kind: NoteKind; folderId: string | null; tags: string[]; globalId?: string; source?: NoteSource|null } | undefined;
  if (creation !== undefined && (!create || typeof create !== 'object' || Array.isArray(create) ||
      Object.keys(create).some(key => !['kind', 'folderId', 'tags', 'globalId','source'].includes(key)) ||
      !WORKSPACE_NOTE_KINDS.includes(create.kind) || !validWorkspaceNoteSource(create.source) ||
      (create.globalId !== undefined && (create.kind !== 'idea' || typeof create.globalId !== 'string' || !/^manual-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(create.globalId) || create.tags?.length !== 0 || create.source !== undefined)) ||
      (create.folderId !== null && (typeof create.folderId !== 'string' || !create.folderId || create.folderId.length > 128)) ||
      !Array.isArray(create.tags) || create.tags.length > 100 || create.tags.some(tag => typeof tag !== 'string' || tag.length > 80) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(noteId) ||
      value.expectedRevision !== 0 || !Array.isArray(value.nativeDocument) || value.schemaVersion !== 2))
    throw new WorkspaceEditFailure('invalid_workspace_creation');
  let annotation: MobileAnnotationCommand | undefined;
  let action: {action:'duplicate'|'trash';targetId?:string;sourceFingerprint:string}|undefined;
  if (command !== undefined) {
    const rawAction = command as Record<string,unknown>|undefined;
    if (rawAction && ['duplicate','trash'].includes(String(rawAction.action))) {
      if (create || typeof rawAction !== 'object' || Array.isArray(rawAction) || Object.keys(rawAction).some(key => !['action','targetId','sourceFingerprint'].includes(key)) ||
          typeof rawAction.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(rawAction.sourceFingerprint) ||
          (rawAction.action === 'duplicate' ? typeof rawAction.targetId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(rawAction.targetId) || rawAction.targetId === noteId : rawAction.targetId !== undefined)) throw new WorkspaceEditFailure('invalid_workspace_command');
      action = rawAction as typeof action;
    } else {
      if (create) throw new WorkspaceEditFailure('invalid_workspace_annotation');
      try { annotation = parseMobileAnnotationCommand(command); } catch { throw new WorkspaceEditFailure('invalid_workspace_annotation'); }
    }
  }
  const payload = createHash('sha256').update(canonicalJson({ noteId, input: value, ...(create ? { creation: create } : {}), ...(annotation ? {command: annotation} : action ? {command:action} : {}) })).digest('hex');
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
        if (note || (create.globalId !== undefined && getIdea(create.globalId))) throw new WorkspaceEditFailure('identity_conflict');
        note = withMobileOperation(() => create.globalId !== undefined
          ? createManualIdeaWithIdentity({ title: value.title, folderId: create.folderId }, noteId, create.globalId!).note
          : createNoteWithIdentity({ title: value.title, content: '', kind: create.kind, folderId: create.folderId, tags: create.tags, source: create.source }, noteId));
      }
      if (!note || note.trashedAt) throw new WorkspaceEditFailure('document_unavailable');
      const current = withMobileOperation(() => mobileWorkspaceEditorData(noteId));
      if (!create && current.revision !== value.expectedRevision) throw new WorkspaceEditFailure('revision_conflict', current);
      if (action && current.mobileCommandSource?.fingerprint !== action.sourceFingerprint) throw new WorkspaceEditFailure(current.mobileCommandSource ? 'source_conflict' : 'placement_unavailable', current);
      let annotationResult: unknown;
      if (annotation) {
        const existing = current.annotations.find(item => item.id === annotation.annotationId) ?? null;
        if (canonicalJson(existing) !== canonicalJson(annotation.expectedAnnotation)) throw new WorkspaceEditFailure('annotation_conflict', current);
        const owner = db.prepare('SELECT note_id FROM note_annotations WHERE id=?').get(annotation.annotationId) as {note_id:string}|undefined;
        if (owner && owner.note_id !== noteId) throw new WorkspaceEditFailure('annotation_unavailable');
        if (annotation.action === 'annotationCreate') annotationResult = withMobileOperation(() => createWorkspaceAnnotationWithIdentity(noteId, annotation.patch as StudyAnnotationInput, annotation.annotationId));
        else if (annotation.action === 'annotationUpdate') annotationResult = withMobileOperation(() => updateWorkspaceAnnotation(annotation.annotationId, annotation.patch!));
        else { withMobileOperation(() => deleteWorkspaceAnnotation(annotation.annotationId)); annotationResult = null; }
      }
      const saved = annotation ? {...getNote(noteId)!, editorRevision: current.revision} : withMobileOperation(() => updateWorkspaceNote(noteId, { ...value, expectedRevision: current.revision }));
      let commandResult: unknown;
      if (action?.action === 'duplicate') {
        if (getNote(action.targetId!)) throw new WorkspaceEditFailure('identity_conflict');
        const copy = withMobileOperation(() => duplicateWorkspaceNoteWithIdentity(noteId, action.targetId!));
        commandResult = {document:copy,editorData:withMobileOperation(() => mobileWorkspaceEditorData(copy.id))};
      } else if (action?.action === 'trash') withMobileOperation(() => trashNotes([noteId]));
      const editorData = withMobileOperation(() => mobileWorkspaceEditorData(noteId));
      const committed = { id, note: action?.action === 'trash' ? getNote(noteId)! : saved, editorData, ...(annotation ? {commandResult: annotationResult} : action ? {commandResult:commandResult ?? {document:getNote(noteId)!}} : {}) };
      db.prepare('INSERT INTO desktop_workspace_edit_receipts VALUES(?,?,?,?,?)').run(grantId, id, payload, JSON.stringify(committed), new Date().toISOString());
      return committed;
    })();
  }));
  invalidateLiveCorpus(vaultId);
  return result;
}
