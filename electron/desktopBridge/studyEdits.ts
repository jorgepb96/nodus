import { parseMobileAnnotationCommand } from './mobileAnnotationEdits';
import { createHash } from 'node:crypto';
import { getDb, withVaultDatabase } from '../db/database';
import { withOwningVault } from '../vaults/vaultRegistry';
import { getStudyDocEditorData, updateStudyDoc, createStudyAnnotationWithIdentity, updateStudyAnnotation, deleteStudyAnnotation } from '../db/studyEditorRepo';
import { createStudyDocumentWithIdentity, resolveStudyMoveDestination, duplicateStudyDocumentWithIdentity, getStudyEntity, setStudyLifecycle } from '../db/studyOrgRepo';
import { STUDY_DOCUMENT_KINDS, type CreateStudyDocumentInput } from '../../shared/studyOrg';
import { canonicalJson } from '../../shared/canonicalJson';
import { MOBILE_WORKSPACE_EDIT_MAX_BYTES } from '../../shared/mobileWorkspace';
import type { StudyDocUpdateInput, StudyAnnotationInput } from '../../shared/studyEditor';
import { withMobileOperation } from './executionBoundary';
import { invalidateLiveCorpus } from './liveCorpus';

export class StudyEditFailure extends Error {
  constructor(public readonly code: string, public readonly remote?: unknown) { super(code); }
}
const fields = new Set(['academicMetadata', 'nativeDocument', 'schemaVersion', 'expectedRevision', 'title', 'contentMarkdown', 'style', 'spellcheckLanguage', 'customDictionary', 'reason']);

/** Editor revision covers content; this separate fingerprint covers the complete
 * organization metadata and every placement, excluding update timestamps. */
export function mobileStudyCommandSource(documentId: string) {
  const db = getDb();
  const document = getStudyEntity('document', documentId);
  if (!document) throw new StudyEditFailure('document_unavailable');
  const placements = db.prepare('SELECT id,document_id,course_id,subject_id,topic_id,folder_id,position,deleted_at FROM study_placements WHERE document_id=? ORDER BY id').all(documentId);
  const source = document as unknown as Record<string, unknown>;
  const metadata = Object.fromEntries(['kind','description','color','icon','emoji','imageData','year','archivedAt','deletedAt'].map(key => [key,source[key] ?? null]));
  const destinations: Record<string, unknown[]> = {};
  for (const [column, table] of [['course_id','study_courses'],['subject_id','study_subjects'],['topic_id','study_topics'],['folder_id','study_folders']]) {
    const ids = [...new Set((placements as Array<Record<string, unknown>>).map(row => row[column]).filter(id => typeof id === 'string'))].sort();
    destinations[table] = ids.map(id => db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) ?? {id,missing:true});
  }
  const fingerprint = createHash('sha256').update(canonicalJson({metadata,placements,destinations})).digest('hex');
  return {version: 1, document, placements, fingerprint};
}

export function mobileStudyEditorData(documentId: string) {
  return {...getStudyDocEditorData(documentId), mobileCommandSource: mobileStudyCommandSource(documentId)};
}

/** Saves the complete document in its owning vault. The receipt and editor
 * revision share a transaction, so a lost acknowledgement cannot duplicate a
 * version or silently replace a newer Mac edit. No extraction is requested. */
export async function applyStudyEdit(vaultId: string, grantId: string, raw: unknown): Promise<unknown> {
  if (Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8') > MOBILE_WORKSPACE_EDIT_MAX_BYTES) throw new StudyEditFailure('study_edit_too_large');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['id', 'documentId', 'input', 'creation', 'command'].includes(key))) throw new StudyEditFailure('invalid_study_edit');
  const { id, documentId, input, creation, command } = raw as { id?: unknown; documentId?: unknown; input?: unknown; creation?: unknown; command?: unknown };
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
      typeof documentId !== 'string' || !documentId || documentId.length > 128 ||
      !input || typeof input !== 'object' || Array.isArray(input)) throw new StudyEditFailure('invalid_study_edit');
  const value = input as StudyDocUpdateInput;
  if (Object.keys(value).some(key => !fields.has(key)) || typeof value.title !== 'string' || value.title.length > 4096 ||
      typeof value.contentMarkdown !== 'string' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision! < 0) throw new StudyEditFailure('invalid_study_edit');
  const create = creation as Omit<CreateStudyDocumentInput, 'title' | 'contentMarkdown'> | undefined;
  if (creation !== undefined) {
    if (!create || typeof create !== 'object' || Array.isArray(create) ||
        Object.keys(create).some(key => !['kind', 'description', 'color', 'icon', 'emoji', 'imageData', 'year', 'placement'].includes(key)) ||
        !STUDY_DOCUMENT_KINDS.includes(create.kind!) || value.expectedRevision !== 0 ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(documentId)) throw new StudyEditFailure('invalid_study_creation');
    for (const key of ['description', 'color', 'icon', 'emoji', 'imageData'] as const) {
      const text = create[key];
      if (text !== undefined && text !== null && (typeof text !== 'string' || text.length > (key === 'imageData' ? 16 * 1024 * 1024 : key === 'description' ? 65_536 : 128))) throw new StudyEditFailure('invalid_study_creation');
    }
    if (create.year !== undefined && create.year !== null && !Number.isSafeInteger(create.year)) throw new StudyEditFailure('invalid_study_creation');
    if (create.placement != null && (typeof create.placement !== 'object' || Array.isArray(create.placement) ||
        Object.keys(create.placement).some(key => !['courseId', 'subjectId', 'topicId', 'folderId', 'position'].includes(key)) ||
        ['courseId', 'subjectId', 'topicId', 'folderId'].some(key => {
          const parent = (create.placement as Record<string, unknown>)[key];
          return parent != null && (typeof parent !== 'string' || !parent || parent.length > 128);
        }) || (create.placement.position !== undefined && !Number.isSafeInteger(create.placement.position)))) throw new StudyEditFailure('invalid_study_creation');
  }
  const action = command as {action?: unknown; targetId?: unknown; sourceFingerprint?: unknown; annotationId?: unknown; expectedAnnotation?: unknown; patch?: unknown} | undefined;
  const annotationAction = action && ['annotationCreate','annotationUpdate','annotationDelete'].includes(String(action.action));
  if (annotationAction) {
    if (create) throw new StudyEditFailure('invalid_study_annotation');
    try { parseMobileAnnotationCommand(action); } catch { throw new StudyEditFailure('invalid_study_annotation'); }
  } else if (command !== undefined && (!action || typeof action !== 'object' || Array.isArray(action) || create ||
      Object.keys(action).some(key => !['action','targetId','sourceFingerprint'].includes(key)) ||
      !['duplicate','trash'].includes(String(action.action)) || typeof action.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(action.sourceFingerprint) ||
      (action.action === 'duplicate' ? typeof action.targetId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(action.targetId) || action.targetId === documentId : action.targetId !== undefined))) throw new StudyEditFailure('invalid_study_command');
  const payload = createHash('sha256').update(canonicalJson({ documentId, input: value, ...(create ? { creation: create } : {}), ...(action ? {command: action} : {}) })).digest('hex');
  const result = await withOwningVault(vaultId, () => withVaultDatabase(vaultId, () => {
    const db = getDb();
    db.exec('CREATE TABLE IF NOT EXISTS desktop_study_edit_receipts (grant_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, result_json TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY(grant_id,request_id))');
    return db.transaction(() => {
      const receipt = db.prepare('SELECT payload_hash,result_json FROM desktop_study_edit_receipts WHERE grant_id=? AND request_id=?').get(grantId, id) as { payload_hash: string; result_json: string } | undefined;
      if (receipt) {
        if (receipt.payload_hash !== payload) throw new StudyEditFailure('idempotency_conflict');
        return JSON.parse(receipt.result_json);
      }
      if (create) {
        if (db.prepare('SELECT id FROM study_docs WHERE id=?').get(documentId)) throw new StudyEditFailure('identity_conflict');
        let placement = create.placement ?? null;
        if (placement) {
          try {
            placement = { ...placement, ...resolveStudyMoveDestination(placement) };
            if (![placement.courseId, placement.subjectId, placement.topicId, placement.folderId].some(Boolean)) throw new Error('empty_destination');
          } catch { throw new StudyEditFailure('placement_unavailable'); }
        }
        withMobileOperation(() => createStudyDocumentWithIdentity({ ...create, placement, title: value.title, contentMarkdown: '' }, documentId));
      }
      if (!db.prepare('SELECT id FROM study_docs WHERE id=? AND deleted_at IS NULL').get(documentId)) throw new StudyEditFailure('document_unavailable');
      const current = withMobileOperation(() => mobileStudyEditorData(documentId));
      if (current.revision !== value.expectedRevision) throw new StudyEditFailure('revision_conflict', current);
      if (action && !annotationAction && current.mobileCommandSource.fingerprint !== action.sourceFingerprint) throw new StudyEditFailure('source_conflict', current);
      let commandResult: unknown;
      if (annotationAction) {
        const annotationId = action!.annotationId as string;
        const existing = current.annotations.find(item => item.id === annotationId) ?? null;
        if (canonicalJson(existing) !== canonicalJson(action!.expectedAnnotation)) throw new StudyEditFailure('annotation_conflict', current);
        const owner = db.prepare('SELECT document_id FROM study_annotations WHERE id=?').get(annotationId) as {document_id:string} | undefined;
        if (owner && owner.document_id !== documentId) throw new StudyEditFailure('annotation_unavailable');
        if (action!.action === 'annotationCreate') commandResult = withMobileOperation(() => createStudyAnnotationWithIdentity(documentId, action!.patch as StudyAnnotationInput, annotationId));
        else if (action!.action === 'annotationUpdate') commandResult = withMobileOperation(() => updateStudyAnnotation(annotationId, action!.patch as Partial<StudyAnnotationInput> & {resolved?: boolean}));
        else { withMobileOperation(() => deleteStudyAnnotation(annotationId)); commandResult = null; }
      } else withMobileOperation(() => updateStudyDoc(documentId, value));
      if (action?.action === 'duplicate') {
        if (db.prepare('SELECT id FROM study_docs WHERE id=?').get(action.targetId)) throw new StudyEditFailure('identity_conflict');
        const duplicate = withMobileOperation(() => duplicateStudyDocumentWithIdentity(documentId, action.targetId as string));
        commandResult = {document: duplicate, editorData: withMobileOperation(() => mobileStudyEditorData(duplicate.id))};
      } else if (action?.action === 'trash') withMobileOperation(() => setStudyLifecycle('document', documentId, 'trash'));
      const document = withMobileOperation(() => getStudyEntity('document', documentId));
      const editorData = withMobileOperation(() => mobileStudyEditorData(documentId));
      const committed = { id, document, editorData, ...(action ? {commandResult: annotationAction ? commandResult : commandResult ?? {document}} : {}) };
      db.prepare('INSERT INTO desktop_study_edit_receipts VALUES(?,?,?,?,?)').run(grantId, id, payload, JSON.stringify(committed), new Date().toISOString());
      return committed;
    })();
  }));
  invalidateLiveCorpus(vaultId);
  return result;
}
