import { createHash, randomUUID } from 'node:crypto';
import type {
  DocumentIdeaLink,
  DocumentIndexCampaign,
  DocumentIndexJob,
  DocumentIndexJobPhase,
  DocumentIndexJobStatus,
  DocumentProfile,
  DocumentProfileAudit,
  DocumentProfileField,
  DocumentProfileFieldKind,
  DocumentProfileOverride,
  DocumentProfileSupport,
  DocumentSearchHit,
  DocumentSection,
  DocumentUnderstandingState,
  ModelRef,
} from '@shared/types';
import { getDb } from './database';
import { assertPassagePublication, type PassagePublication } from './passagePublications';
import { currentEmbeddingConfig, embeddingTextHash, encodeEmbedding } from './ideasRepo';
import type { PassageInsert, SimilarPassage } from './passagesRepo';
import { scanSimilar } from './vectorScan';

const json = <T>(value: unknown, fallback: T): T => {
  try { return value == null ? fallback : JSON.parse(String(value)) as T; } catch { return fallback; }
};
const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

interface ProfileVersionRow {
  version_id: string;
  nodus_id: string;
  source_fingerprint: string;
  pipeline_version: string;
  source_language: string | null;
  presentation_language: string;
  overview: string;
  profile_json: string;
  generator_model_json: string | null;
  auditor_model_json: string | null;
  audit_json: string | null;
  quality_score: number | null;
  created_at: string;
  published_at: string | null;
  status: DocumentUnderstandingState;
  stale_reason: string | null;
}

export interface PublishDocumentProfileInput {
  nodusId: string;
  versionId?: string;
  sourceFingerprint: string;
  pipelineVersion: string;
  schemaVersion: number;
  sourceLanguage: string | null;
  presentationLanguage: string;
  overview: string;
  profile: Record<string, unknown>;
  fields: Array<Omit<DocumentProfileField, 'fieldId'> & { fieldId?: string }>;
  sections: DocumentSection[];
  supports: DocumentProfileSupport[];
  ideaLinks?: DocumentIdeaLink[];
  vectors: Array<{
    vectorId?: string;
    kind: string;
    sourceId: string | null;
    text: string;
    weight: number;
    embedding: number[] | null;
    embeddingProvider?: string;
    embeddingModel?: string;
  }>;
  generatorModel: ModelRef | null;
  auditorModel: ModelRef | null;
  promptHash: string;
  audit: DocumentProfileAudit;
  qualityScore: number | null;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number | null;
  /** Source metadata captured before candidate generation. Publication is rejected
   * if either the library row or resolved corpus changed while it was being generated. */
  expectedWorkRevision?: {
    zoteroKey: string;
    zoteroVersion: number | null;
    title: string;
    authorsJson: string;
    year: number | null;
    itemType: string;
    doi: string | null;
    deepHash: string | null;
    resolvedTextHash: string | null;
  };
  /** Passage replacement staged in memory and committed with the profile. */
  passages?: {
    publication?: PassagePublication;
    contentHash: string;
    rows: PassageInsert[];
    embeddingProvider?: string;
    embeddingModel?: string;
  } | null;
}

function fieldRow(row: Record<string, unknown>): DocumentProfileField {
  return {
    fieldId: String(row.field_id),
    kind: String(row.kind) as DocumentProfileFieldKind,
    ordinal: Number(row.ordinal),
    text: String(row.text),
    confidence: Number(row.confidence),
    centrality: Number(row.centrality),
    confidenceSource: row.confidence_source === 'floor' ? 'floor' : 'model',
  };
}

function sectionRow(row: Record<string, unknown>): DocumentSection {
  return {
    sectionId: String(row.section_id),
    parentSectionId: row.parent_section_id == null ? null : String(row.parent_section_id),
    level: Number(row.level),
    ordinal: Number(row.ordinal),
    title: String(row.title),
    role: row.role == null ? null : String(row.role),
    summary: String(row.summary),
    concepts: json<string[]>(row.concepts_json, []),
    claims: json<string[]>(row.claims_json, []),
    pageStart: row.page_start == null ? null : String(row.page_start),
    pageEnd: row.page_end == null ? null : String(row.page_end),
    sourceRef: row.source_ref == null ? null : String(row.source_ref),
    pageStartNumber: row.page_start_number == null ? null : Number(row.page_start_number),
    pageEndNumber: row.page_end_number == null ? null : Number(row.page_end_number),
    charStart: row.char_start == null ? null : Number(row.char_start),
    charEnd: row.char_end == null ? null : Number(row.char_end),
    contentHash: String(row.content_hash),
  };
}

function supportRow(row: Record<string, unknown>): DocumentProfileSupport {
  return {
    supportId: String(row.support_id),
    targetKind: String(row.target_kind) as DocumentProfileSupport['targetKind'],
    targetId: String(row.target_id),
    sectionId: row.section_id == null ? null : String(row.section_id),
    passageId: row.passage_id == null ? null : String(row.passage_id),
    pageStart: row.page_start == null ? null : String(row.page_start),
    pageEnd: row.page_end == null ? null : String(row.page_end),
    sourceRef: row.source_ref == null ? null : String(row.source_ref),
    pageStartNumber: row.page_start_number == null ? null : Number(row.page_start_number),
    pageEndNumber: row.page_end_number == null ? null : Number(row.page_end_number),
    quote: String(row.quote),
    supportKind: String(row.support_kind),
    confidence: Number(row.confidence),
    validationStatus: String(row.validation_status) as DocumentProfileSupport['validationStatus'],
  };
}

function overrideRow(row: Record<string, unknown>): DocumentProfileOverride {
  return {
    overrideId: String(row.override_id),
    nodusId: String(row.nodus_id),
    fieldPath: String(row.field_path),
    baseVersionId: row.base_version_id == null ? null : String(row.base_version_id),
    generatedValue: json(row.generated_value_json, null),
    value: json(row.value_json, null),
    verified: Boolean(row.verified),
    conflict: Boolean(row.conflict),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function ensureDocumentProfileState(nodusId: string): void {
  const now = new Date().toISOString();
  getDb().prepare(
    `INSERT INTO document_profile_state(nodus_id, status, updated_at)
     VALUES (?, 'missing', ?) ON CONFLICT(nodus_id) DO NOTHING`
  ).run(nodusId, now);
}

export function setDocumentProfileState(
  nodusId: string,
  status: DocumentUnderstandingState,
  patch: { sourceFingerprint?: string | null; pipelineVersion?: string | null; staleReason?: string | null; error?: string | null } = {}
): void {
  ensureDocumentProfileState(nodusId);
  getDb().prepare(
    `UPDATE document_profile_state SET
       status=?,
       source_fingerprint=CASE WHEN ? THEN ? ELSE source_fingerprint END,
       pipeline_version=CASE WHEN ? THEN ? ELSE pipeline_version END,
       stale_reason=CASE WHEN ? THEN ? ELSE stale_reason END,
       error=CASE WHEN ? THEN ? ELSE error END,
       updated_at=?
     WHERE nodus_id=?`
  ).run(
    status,
    Object.hasOwn(patch, 'sourceFingerprint') ? 1 : 0, patch.sourceFingerprint ?? null,
    Object.hasOwn(patch, 'pipelineVersion') ? 1 : 0, patch.pipelineVersion ?? null,
    Object.hasOwn(patch, 'staleReason') ? 1 : 0, patch.staleReason ?? null,
    Object.hasOwn(patch, 'error') ? 1 : 0, patch.error ?? null,
    new Date().toISOString(),
    nodusId
  );
}

function restoreDocumentProfileStateAfterCancellation(nodusId: string): void {
  getDb().prepare(
    `UPDATE document_profile_state SET
       status=CASE
         WHEN current_version_id IS NULL THEN 'missing'
         WHEN stale_reason IS NOT NULL THEN 'stale'
         ELSE 'current'
       END,
       error=NULL,
       updated_at=?
     WHERE nodus_id=?`
  ).run(new Date().toISOString(), nodusId);
}

export function getDocumentProfile(nodusId: string): DocumentProfile | null {
  const row = getDb().prepare(
    `SELECT v.*, s.status, s.stale_reason
       FROM document_profile_state s
       JOIN document_profile_versions v ON v.version_id=s.current_version_id
      WHERE s.nodus_id=?`
  ).get(nodusId) as ProfileVersionRow | undefined;
  if (!row) return null;
  const fields = (getDb().prepare(
    'SELECT * FROM document_profile_fields WHERE version_id=? ORDER BY kind, ordinal'
  ).all(row.version_id) as Record<string, unknown>[]).map(fieldRow);
  const sections = (getDb().prepare(
    'SELECT * FROM document_sections WHERE version_id=? ORDER BY ordinal'
  ).all(row.version_id) as Record<string, unknown>[]).map(sectionRow);
  const supports = (getDb().prepare(
    'SELECT * FROM document_profile_support WHERE version_id=? ORDER BY target_kind, target_id, confidence DESC'
  ).all(row.version_id) as Record<string, unknown>[]).map(supportRow);
  const ideaLinks = (getDb().prepare(
    `SELECT global_id, target_kind, target_id, role, score
       FROM document_idea_links WHERE version_id=? ORDER BY score DESC`
  ).all(row.version_id) as Record<string, unknown>[]).map((link) => ({
    globalId: String(link.global_id),
    targetKind: String(link.target_kind) as DocumentIdeaLink['targetKind'],
    targetId: String(link.target_id),
    role: String(link.role) as DocumentIdeaLink['role'],
    score: Number(link.score),
  }));
  const overrides = listDocumentProfileOverrides(nodusId);
  const overrideByPath = new Map(overrides.map((item) => [item.fieldPath, item]));
  const overviewOverride = overrideByPath.get('overview');
  for (const field of fields) {
    const override = overrideByPath.get(`fields.${field.kind}.${field.ordinal}`);
    if (override && typeof override.value === 'string') {
      field.generatedText = field.text;
      field.text = override.value;
      field.overridden = true;
      field.overrideId = override.overrideId;
      field.verified = override.verified;
      field.conflict = override.conflict;
    }
  }
  return {
    nodusId,
    versionId: row.version_id,
    status: row.status,
    sourceFingerprint: row.source_fingerprint,
    pipelineVersion: row.pipeline_version,
    sourceLanguage: row.source_language,
    presentationLanguage: row.presentation_language,
    overview: overviewOverride && typeof overviewOverride.value === 'string' ? overviewOverride.value : row.overview,
    generatedOverview: overviewOverride ? row.overview : undefined,
    overviewOverridden: Boolean(overviewOverride),
    overviewOverrideId: overviewOverride?.overrideId,
    overviewVerified: overviewOverride?.verified,
    overviewConflict: overviewOverride?.conflict,
    fields,
    sections,
    supports,
    ideaLinks,
    audit: json<DocumentProfileAudit | null>(row.audit_json, null),
    qualityScore: row.quality_score,
    generatorModel: json<ModelRef | null>(row.generator_model_json, null),
    auditorModel: json<ModelRef | null>(row.auditor_model_json, null),
    createdAt: row.created_at,
    publishedAt: row.published_at,
    staleReason: row.stale_reason,
  };
}

export function listDocumentSections(nodusId: string): DocumentSection[] {
  const version = getDb().prepare(
    'SELECT current_version_id FROM document_profile_state WHERE nodus_id=?'
  ).get(nodusId) as { current_version_id: string | null } | undefined;
  if (!version?.current_version_id) return [];
  return (getDb().prepare(
    'SELECT * FROM document_sections WHERE version_id=? ORDER BY ordinal'
  ).all(version.current_version_id) as Record<string, unknown>[]).map(sectionRow);
}

export function getDocumentSupport(supportId: string): DocumentProfileSupport | null {
  const row = getDb().prepare('SELECT * FROM document_profile_support WHERE support_id=?').get(supportId) as Record<string, unknown> | undefined;
  return row ? supportRow(row) : null;
}

export function listDocumentProfileOverrides(nodusId: string): DocumentProfileOverride[] {
  return (getDb().prepare(
    'SELECT * FROM document_profile_overrides WHERE nodus_id=? ORDER BY field_path'
  ).all(nodusId) as Record<string, unknown>[]).map(overrideRow);
}

export function upsertDocumentProfileOverride(input: {
  nodusId: string;
  fieldPath: string;
  value: unknown;
  generatedValue?: unknown;
  baseVersionId?: string | null;
  verified?: boolean;
}): DocumentProfileOverride {
  const value = typeof input.value === 'string' ? input.value.trim() : '';
  if (!value || value.length > 30_000) throw new Error('La corrección debe contener entre 1 y 30.000 caracteres.');
  if (input.fieldPath !== 'overview' && !/^fields\.[a-z_]+\.\d+$/.test(input.fieldPath)) {
    throw new Error('Ruta de corrección documental no válida.');
  }
  const work = getDb().prepare('SELECT 1 FROM works WHERE nodus_id=?').get(input.nodusId);
  if (!work) throw new Error('La obra no existe.');
  const now = new Date().toISOString();
  const existing = getDb().prepare(
    'SELECT override_id, created_at FROM document_profile_overrides WHERE nodus_id=? AND field_path=?'
  ).get(input.nodusId, input.fieldPath) as { override_id: string; created_at: string } | undefined;
  const overrideId = existing?.override_id ?? randomUUID();
  getDb().prepare(
    `INSERT INTO document_profile_overrides(
       override_id,nodus_id,field_path,base_version_id,generated_value_json,value_json,
       verified,conflict,created_at,updated_at
     ) VALUES(?,?,?,?,?,?,?,0,?,?)
     ON CONFLICT(nodus_id,field_path) DO UPDATE SET
       base_version_id=excluded.base_version_id,
       generated_value_json=excluded.generated_value_json,
       value_json=excluded.value_json,
       verified=excluded.verified, conflict=0, updated_at=excluded.updated_at`
  ).run(
    overrideId, input.nodusId, input.fieldPath, input.baseVersionId ?? null,
    JSON.stringify(input.generatedValue ?? null), JSON.stringify(value),
    input.verified ? 1 : 0, existing?.created_at ?? now, now
  );
  refreshDocumentProfileFts(input.nodusId);
  return overrideRow(getDb().prepare('SELECT * FROM document_profile_overrides WHERE override_id=?').get(overrideId) as Record<string, unknown>);
}

export function deleteDocumentProfileOverride(overrideId: string): void {
  const row = getDb().prepare('SELECT nodus_id FROM document_profile_overrides WHERE override_id=?').get(overrideId) as { nodus_id: string } | undefined;
  getDb().prepare('DELETE FROM document_profile_overrides WHERE override_id=?').run(overrideId);
  if (row) refreshDocumentProfileFts(row.nodus_id);
}

function refreshDocumentProfileFts(nodusId: string): void {
  const db = getDb();
  const profile = getDocumentProfile(nodusId);
  if (!profile) return;
  const title = (db.prepare('SELECT title FROM works WHERE nodus_id=?').get(nodusId) as { title: string } | undefined)?.title ?? '';
  db.prepare('DELETE FROM document_profiles_fts WHERE nodus_id=?').run(nodusId);
  db.prepare('INSERT INTO document_profiles_fts(nodus_id,version_id,title,overview,fields) VALUES(?,?,?,?,?)')
    .run(nodusId, profile.versionId, title, profile.overview, profile.fields.map((field) => field.text).join('\n'));
}

/** Publish a complete candidate in one transaction; nothing partial becomes readable. */
export function publishDocumentProfile(input: PublishDocumentProfileInput): string {
  // The verdict and the mode say different things. `passed: false` means the semantic auditor
  // disliked the synthesis, and a profile declaring `partial` or `extractive` is precisely the
  // outcome the acceptance gate chose to keep: its fields all carry literal support, and the
  // mode is what tells consumers it was not approved. Refusing it here discarded every profile
  // the gate had just decided to publish, so a run whose auditor never approved a synthesis
  // failed as a whole with a sentence that only existed in Spanish. What is still refused is an
  // undeclared failure — no verdict and no mode — which no caller can reach by accident.
  if (!input.audit.passed && !input.audit.fallback) throw new Error('No se puede publicar una ficha que no superó la auditoría.');
  const db = getDb();
  if (input.expectedWorkRevision) {
    const work = db.prepare(
      `SELECT zotero_key,zotero_version,title,authors_json,year,item_type,doi,deep_hash,resolved_text_hash
         FROM works WHERE nodus_id=?`
    ).get(input.nodusId) as {
      zotero_key: string; zotero_version: number | null; title: string; authors_json: string;
      year: number | null; item_type: string; doi: string | null; deep_hash: string | null;
      resolved_text_hash: string | null;
    } | undefined;
    const expected = input.expectedWorkRevision;
    if (!work
      || work.zotero_key !== expected.zoteroKey
      || work.zotero_version !== expected.zoteroVersion
      || work.title !== expected.title
      || work.authors_json !== expected.authorsJson
      || work.year !== expected.year
      || work.item_type !== expected.itemType
      || work.doi !== expected.doi
      || work.deep_hash !== expected.deepHash
      || work.resolved_text_hash !== expected.resolvedTextHash) {
      throw new Error('DOCUMENT_SOURCE_CHANGED');
    }
  }
  const profileFingerprint = createHash('sha256').update(JSON.stringify(input.profile)).digest('hex');
  const current = db.prepare(
    `SELECT s.current_version_id,s.source_fingerprint,s.pipeline_version,s.profile_fingerprint,
            v.prompt_hash,v.generator_model_json,v.auditor_model_json
       FROM document_profile_state s
       LEFT JOIN document_profile_versions v ON v.version_id=s.current_version_id
      WHERE s.nodus_id=?`
  ).get(input.nodusId) as {
    current_version_id: string | null;
    source_fingerprint: string | null;
    pipeline_version: string | null;
    profile_fingerprint: string | null;
    prompt_hash: string | null;
    generator_model_json: string | null;
    auditor_model_json: string | null;
  } | undefined;
  const sameModel = (stored: string | null, model: ModelRef | null): boolean =>
    stored === (model ? JSON.stringify(model) : null);
  if (
    current?.current_version_id
    && current.source_fingerprint === input.sourceFingerprint
    && current.pipeline_version === input.pipelineVersion
    && current.profile_fingerprint === profileFingerprint
    && current.prompt_hash === input.promptHash
    && sameModel(current.generator_model_json, input.generatorModel)
    && sameModel(current.auditor_model_json, input.auditorModel)
  ) {
    // Crash replay after the atomic publication but before the queue acknowledgement:
    // return the already-current version instead of manufacturing a superseded twin.
    setDocumentProfileState(input.nodusId, 'current', {
      sourceFingerprint: input.sourceFingerprint,
      pipelineVersion: input.pipelineVersion,
      staleReason: null,
      error: null,
    });
    return current.current_version_id;
  }
  const versionId = input.versionId ?? randomUUID();
  const now = new Date().toISOString();
  const config = input.vectors.some((vector) => vector.embedding) ? currentEmbeddingConfig() : null;
  // Child ids are derived from the CONTENT (a section is `section-<hash of body>`, a field is
  // `field-<hash of kind+text>`, a support is `<hash of target+quote>`, a vector names the
  // source it summarises), and every one of those tables keys on the id alone. Publishing a
  // second version of a document whose text did not change therefore recomputed the same ids
  // and the insert died on `UNIQUE constraint failed: document_sections.section_id` — which is
  // to say no work could ever be re-indexed: not a stale one, not one whose summary the reader
  // corrected, not one re-run with another model. Superseded versions stay in the database for
  // history, so the ids are scoped to the version that owns them and every reference to them is
  // rewritten with the same map, in the same transaction.
  const scoped = (id: string | null | undefined): string | null => (id == null ? null : `${versionId}:${id}`);
  const sectionIds = new Map(input.sections.map((section) => [section.sectionId, `${versionId}:${section.sectionId}`]));
  const fieldIds = new Map(input.fields.map((field, index) => [field.fieldId ?? '', `${versionId}:${field.fieldId ?? `field-${index}`}`]));
  const fieldIdFor = (field: PublishDocumentProfileInput['fields'][number], index: number): string =>
    field.fieldId ? fieldIds.get(field.fieldId) ?? `${versionId}:${field.fieldId}` : `${versionId}:field-${index}`;
  // A reference is rewritten only when it names a row this publication created. `overview` is a
  // sentinel source, not an id, and must survive as it is; anything else that is not in the maps
  // was not produced by this publication and is left alone rather than guessed at.
  const scopedSourceId = (id: string): string =>
    sectionIds.get(id) ?? fieldIds.get(id) ?? id;  db.transaction(() => {
    ensureDocumentProfileState(input.nodusId);
    const previous = db.prepare(
      'SELECT current_version_id FROM document_profile_state WHERE nodus_id=?'
    ).get(input.nodusId) as { current_version_id: string | null };
    db.prepare(
      `INSERT INTO document_profile_versions(
         version_id,nodus_id,state,source_fingerprint,pipeline_version,schema_version,
         source_language,presentation_language,overview,profile_json,generator_model_json,
         auditor_model_json,prompt_hash,audit_json,quality_score,input_tokens,output_tokens,
         estimated_cost_usd,created_at,published_at
       ) VALUES(?,?,'current',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      versionId, input.nodusId, input.sourceFingerprint, input.pipelineVersion, input.schemaVersion,
      input.sourceLanguage, input.presentationLanguage, input.overview, JSON.stringify(input.profile),
      input.generatorModel ? JSON.stringify(input.generatorModel) : null,
      input.auditorModel ? JSON.stringify(input.auditorModel) : null,
      input.promptHash, JSON.stringify(input.audit), input.qualityScore == null ? null : clamp01(input.qualityScore),
      input.inputTokens ?? 0, input.outputTokens ?? 0, input.estimatedCostUsd ?? null, now, now
    );
    const insertField = db.prepare(
      `INSERT INTO document_profile_fields(field_id,version_id,nodus_id,kind,ordinal,text,confidence,centrality,confidence_source,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`
    );
    for (const [index, field] of input.fields.entries()) insertField.run(
      fieldIdFor(field, index), versionId, input.nodusId, field.kind, field.ordinal,
      field.text, clamp01(field.confidence), clamp01(field.centrality), field.confidenceSource ?? 'model', now
    );
    const insertSection = db.prepare(
      `INSERT INTO document_sections(
         section_id,version_id,nodus_id,parent_section_id,level,ordinal,title,role,summary,
         concepts_json,claims_json,page_start,page_end,source_ref,page_start_number,page_end_number,
         char_start,char_end,content_hash,created_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const section of input.sections) insertSection.run(
      sectionIds.get(section.sectionId) ?? section.sectionId, versionId, input.nodusId,
      section.parentSectionId ? sectionIds.get(section.parentSectionId) ?? section.parentSectionId : null,
      section.level,
      section.ordinal, section.title, section.role, section.summary, JSON.stringify(section.concepts),
      JSON.stringify(section.claims), section.pageStart, section.pageEnd, section.sourceRef ?? null,
      section.pageStartNumber ?? null, section.pageEndNumber ?? null, section.charStart,
      section.charEnd, section.contentHash, now
    );
    if (input.passages) {
      if (input.passages.publication) assertPassagePublication(input.nodusId, input.passages.publication);
      const passageConfig = currentEmbeddingConfig();
      const insertPassage = db.prepare(
        `INSERT INTO passages(
           passage_id,nodus_id,chunk_index,text,page_label,source_ref,page_number,char_len,content_hash,
           embedding,embedding_provider,embedding_model,embedding_dim,embedding_text_hash,created_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      );
      db.prepare('DELETE FROM passages WHERE nodus_id=?').run(input.nodusId);
      input.passages.rows.forEach((row, chunkIndex) => {
        insertPassage.run(
          `${input.nodusId}#${chunkIndex}`, input.nodusId, chunkIndex, row.text, row.pageLabel,
          row.sourceRef ?? null, row.pageNumber ?? null,
          row.text.length, input.passages!.contentHash,
          row.embedding ? encodeEmbedding(row.embedding) : null,
          row.embedding ? (input.passages!.embeddingProvider ?? passageConfig.provider) : null,
          row.embedding ? (input.passages!.embeddingModel ?? passageConfig.model) : null,
          row.embedding?.length ?? null,
          row.embedding ? embeddingTextHash(row.text) : null,
          now,
        );
      });
    }
    const insertSupport = db.prepare(
      `INSERT INTO document_profile_support(
         support_id,version_id,nodus_id,target_kind,target_id,section_id,passage_id,page_start,
         page_end,source_ref,page_start_number,page_end_number,char_start,char_end,quote,quote_hash,
         support_kind,confidence,validation_status,created_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const support of input.supports) insertSupport.run(
      scoped(support.supportId), versionId, input.nodusId, support.targetKind, scopedSourceId(support.targetId),
      support.sectionId ? scopedSourceId(support.sectionId) : null, support.passageId,
      support.pageStart, support.pageEnd, support.sourceRef ?? null,
      support.pageStartNumber ?? null, support.pageEndNumber ?? null, null, null,
      support.quote, createHash('sha256').update(support.quote).digest('hex'), support.supportKind,
      clamp01(support.confidence), support.validationStatus, now
    );
    const insertVector = db.prepare(
      `INSERT INTO document_vectors(
         vector_id,nodus_id,version_id,kind,source_id,text,text_hash,weight,embedding,
         embedding_provider,embedding_model,embedding_dim,created_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const vector of input.vectors) insertVector.run(
      scoped(vector.vectorId ?? randomUUID()) ?? randomUUID(), input.nodusId, versionId, vector.kind,
      vector.sourceId == null ? null : scopedSourceId(vector.sourceId),
      vector.text, createHash('sha256').update(vector.text).digest('hex'), vector.weight,
      vector.embedding ? encodeEmbedding(vector.embedding) : null,
      vector.embedding ? (vector.embeddingProvider ?? config?.provider) : null,
      vector.embedding ? (vector.embeddingModel ?? config?.model) : null,
      vector.embedding?.length ?? null, now
    );
    const insertLink = db.prepare(
      `INSERT INTO document_idea_links(version_id,nodus_id,global_id,target_kind,target_id,role,score,created_at)
       VALUES(?,?,?,?,?,?,?,?)`
    );
    for (const link of input.ideaLinks ?? []) insertLink.run(
      versionId, input.nodusId, link.globalId, link.targetKind, scopedSourceId(link.targetId), link.role, clamp01(link.score), now
    );
    const generatedByPath = new Map<string, unknown>([
      ['overview', input.overview],
      ...input.fields.map((field) => [`fields.${field.kind}.${field.ordinal}`, field.text] as [string, unknown]),
    ]);
    const existingOverrides = db.prepare(
      'SELECT override_id, field_path, generated_value_json, base_version_id FROM document_profile_overrides WHERE nodus_id=?'
    ).all(input.nodusId) as Array<{
      override_id: string; field_path: string; generated_value_json: string | null; base_version_id: string | null;
    }>;
    const markConflict = db.prepare('UPDATE document_profile_overrides SET conflict=?, updated_at=? WHERE override_id=?');
    for (const override of existingOverrides) {
      const nextGenerated = generatedByPath.get(override.field_path);
      const previousGenerated = json(override.generated_value_json, null);
      const conflict = nextGenerated !== undefined
        && override.base_version_id !== versionId
        && JSON.stringify(previousGenerated) !== JSON.stringify(nextGenerated);
      markConflict.run(conflict ? 1 : 0, now, override.override_id);
    }
    if (previous?.current_version_id) db.prepare(
      `UPDATE document_profile_versions SET state='superseded'
        WHERE version_id=? AND version_id<>?`
    ).run(previous.current_version_id, versionId);
    db.prepare(
      `UPDATE document_profile_state SET current_version_id=?,status='current',source_fingerprint=?,
       profile_fingerprint=?,pipeline_version=?,stale_reason=NULL,error=NULL,updated_at=? WHERE nodus_id=?`
    ).run(
      versionId, input.sourceFingerprint,
      profileFingerprint,
      input.pipelineVersion, now, input.nodusId
    );
    db.prepare('DELETE FROM document_profiles_fts WHERE nodus_id=?').run(input.nodusId);
    const title = (db.prepare('SELECT title FROM works WHERE nodus_id=?').get(input.nodusId) as { title: string } | undefined)?.title ?? '';
    db.prepare(
      'INSERT INTO document_profiles_fts(nodus_id,version_id,title,overview,fields) VALUES(?,?,?,?,?)'
    ).run(input.nodusId, versionId, title, input.overview, input.fields.map((field) => field.text).join('\n'));
    db.prepare('DELETE FROM document_sections_fts WHERE nodus_id=?').run(input.nodusId);
    const ftsSection = db.prepare(
      'INSERT INTO document_sections_fts(section_id,nodus_id,title,summary,concepts) VALUES(?,?,?,?,?)'
    );
    for (const section of input.sections) ftsSection.run(
      sectionIds.get(section.sectionId) ?? section.sectionId, input.nodusId, section.title, section.summary, section.concepts.join(' ')
    );
  })();
  refreshDocumentProfileFts(input.nodusId);
  return versionId;
}

export function documentProfileStatuses(nodusIds?: string[]): Array<{
  nodusId: string; status: DocumentUnderstandingState; currentVersionId: string | null;
  sourceFingerprint: string | null; staleReason: string | null; error: string | null;
}> {
  const ids = [...new Set(nodusIds ?? [])];
  const where = ids.length ? `WHERE w.nodus_id IN (${ids.map(() => '?').join(',')})` : '';
  return (getDb().prepare(
    `SELECT w.nodus_id, COALESCE(s.status,'missing') status, s.current_version_id,
            s.source_fingerprint, s.stale_reason, s.error
       FROM works w LEFT JOIN document_profile_state s ON s.nodus_id=w.nodus_id ${where}
      ORDER BY w.title COLLATE NOCASE`
  ).all(...ids) as Record<string, unknown>[]).map((row) => ({
    nodusId: String(row.nodus_id),
    status: String(row.status) as DocumentUnderstandingState,
    currentVersionId: row.current_version_id == null ? null : String(row.current_version_id),
    sourceFingerprint: row.source_fingerprint == null ? null : String(row.source_fingerprint),
    staleReason: row.stale_reason == null ? null : String(row.stale_reason),
    error: row.error == null ? null : String(row.error),
  }));
}

export async function findSimilarDocuments(
  queryEmbedding: number[], threshold = 0.24, limit = 20, opts: { nodusIds?: string[] } = {}
): Promise<DocumentSearchHit[]> {
  if (opts.nodusIds?.length === 0) return [];
  const scoped = opts.nodusIds ? ' AND dv.nodus_id IN (SELECT value FROM json_each(?))' : '';
  const config = currentEmbeddingConfig();
  // Join state by its indexed work key as well as version: a version-only
  // join scans every profile state for each candidate vector.
  const ranked = await scanSimilar<{ vector_id: string; rid: number; similarity: number }>({
    table: 'document_vectors',
    sql: `SELECT dv.vector_id, dv.rowid rid, vec_scan(dv.embedding) similarity
            FROM embedding_read_document_vectors dv
            JOIN document_profile_state dps ON dps.nodus_id=dv.nodus_id AND dps.current_version_id=dv.version_id
            JOIN works w ON w.nodus_id=dv.nodus_id
           WHERE dv.rowid>? AND dv.rowid<=? AND dv.embedding IS NOT NULL
             AND w.archived=0 AND dv.embedding_provider=? AND dv.embedding_model=?
             AND dv.embedding_dim=?${scoped}`,
    params: [config.provider, config.model, queryEmbedding.length, ...(opts.nodusIds ? [JSON.stringify(opts.nodusIds)] : [])],
    query: queryEmbedding,
    threshold,
    limit: Math.max(limit * 3, limit),
  });
  if (!ranked.length) return [];
  const scores = new Map(ranked.map((item) => [item.vector_id, item.similarity]));
  const rows = getDb().prepare(
    `SELECT dv.vector_id,dv.nodus_id,dv.version_id,dv.kind,dv.source_id,dv.text,dv.weight,
            w.title,w.authors_json,w.year,dps.status
       FROM document_vectors dv JOIN works w ON w.nodus_id=dv.nodus_id
       JOIN document_profile_state dps ON dps.nodus_id=dv.nodus_id AND dps.current_version_id=dv.version_id
      WHERE dv.vector_id IN (${ranked.map(() => '?').join(',')})`
  ).all(...ranked.map((item) => item.vector_id)) as Record<string, unknown>[];
  const bestBySource = new Map<string, DocumentSearchHit>();
  for (const row of rows) {
    const similarity = (scores.get(String(row.vector_id)) ?? 0) * Number(row.weight ?? 1);
    const sourceId = String(row.source_id ?? row.vector_id);
    const key = `${row.nodus_id}:${sourceId}`;
    const hit: DocumentSearchHit = {
      kind: String(row.kind) === 'section' ? 'section' : 'document',
      nodusId: String(row.nodus_id), title: String(row.title),
      authors: json<string[]>(row.authors_json, []), year: row.year == null ? null : Number(row.year),
      versionId: String(row.version_id), sourceId, fieldKind: String(row.kind), text: String(row.text),
      similarity, centrality: Number(row.weight ?? 1),
      explanation: `Coincidencia en ${String(row.kind).replaceAll('_', ' ')}`,
      stale: String(row.status) === 'stale',
    };
    if (!bestBySource.has(key) || (bestBySource.get(key)?.similarity ?? 0) < similarity) bestBySource.set(key, hit);
  }
  return [...bestBySource.values()].sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

export function lexicalDocumentSearch(query: string, limit = 20, opts: { nodusIds?: string[] } = {}): DocumentSearchHit[] {
  if (opts.nodusIds?.length === 0) return [];
  const scoped = opts.nodusIds ? ' AND f.nodus_id IN (SELECT value FROM json_each(?))' : '';
  // Never pass user punctuation/operators directly to FTS5. Quoted lexical
  // tokens make natural-language questions safe while preserving broad recall.
  const terms = query.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const unique = [...new Set(terms.filter((term) => term.length >= 3 || /^\d+$/u.test(term)))].slice(0, 24);
  const ftsQuery = unique.map((term) => `"${term}"`).join(' OR ');
  if (!ftsQuery) return [];
  const rows = getDb().prepare(
    `SELECT f.nodus_id,f.version_id,f.title,f.overview,bm25(document_profiles_fts) rank,
            w.authors_json,w.year,s.status
       FROM document_profiles_fts f JOIN works w ON w.nodus_id=f.nodus_id
       JOIN document_profile_state s ON s.current_version_id=f.version_id
      WHERE document_profiles_fts MATCH ? AND w.archived=0${scoped} ORDER BY rank LIMIT ?`
  ).all(ftsQuery, ...(opts.nodusIds ? [JSON.stringify(opts.nodusIds)] : []), limit) as Record<string, unknown>[];
  return rows.map((row) => ({
    kind: 'document', nodusId: String(row.nodus_id), title: String(row.title),
    authors: json<string[]>(row.authors_json, []), year: row.year == null ? null : Number(row.year),
    versionId: String(row.version_id), sourceId: String(row.version_id), fieldKind: 'lexical',
    text: String(row.overview), similarity: 0, lexicalScore: -Number(row.rank), centrality: 1,
    explanation: 'Coincidencia léxica en la ficha documental', stale: String(row.status) === 'stale',
  }));
}

/**
 * Follow the exact evidence edge behind a matched profile field/section. These
 * passages were validated when the profile was published, so the document lane
 * can route to original text instead of asking a second similarity search to
 * rediscover the support by chance. Overview/lexical hits have no exact target
 * and therefore contribute nothing here.
 */
export function findDocumentSupportPassages(
  hits: DocumentSearchHit[], limit = 20, perHit = 2
): SimilarPassage[] {
  if (limit <= 0 || perHit <= 0) return [];
  const exactHits = hits.filter((hit) => hit.sourceId && !['overview', 'lexical'].includes(hit.fieldKind));
  if (exactHits.length === 0) return [];
  const statement = getDb().prepare(
    `SELECT p.passage_id,p.nodus_id,p.text,p.page_label,
            w.title,w.authors_json,w.year,w.zotero_key,s.confidence
       FROM document_profile_support s
       JOIN passages p ON p.passage_id=s.passage_id AND p.nodus_id=s.nodus_id
       JOIN works w ON w.nodus_id=s.nodus_id
      WHERE s.version_id=? AND s.target_id=? AND s.validation_status='valid'
        AND s.passage_id IS NOT NULL AND w.archived=0
        AND ((w.resolved_text_hash IS NOT NULL AND p.content_hash=w.resolved_text_hash)
          OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash=w.deep_hash)))
      ORDER BY s.confidence DESC,s.support_id
      LIMIT ?`
  );
  const passages = new Map<string, SimilarPassage>();
  for (const hit of exactHits) {
    const rows = statement.all(hit.versionId, hit.sourceId, perHit) as Array<Omit<SimilarPassage, 'similarity'> & { confidence: number }>;
    for (const row of rows) {
      const similarity = clamp01(Math.max(0, hit.similarity) * clamp01(row.confidence));
      const previous = passages.get(row.passage_id);
      if (!previous || previous.similarity < similarity) {
        const { confidence: _confidence, ...passage } = row;
        passages.set(row.passage_id, { ...passage, similarity });
      }
      if (passages.size >= limit) return [...passages.values()];
    }
  }
  return [...passages.values()];
}

function campaignRow(row: Record<string, unknown>): DocumentIndexCampaign {
  return {
    campaignId: String(row.campaign_id), vaultId: String(row.vault_id),
    mode: String(row.mode) as DocumentIndexCampaign['mode'], status: String(row.status) as DocumentIndexCampaign['status'],
    includeArchived: Boolean(row.include_archived), totalJobs: Number(row.total_jobs),
    completedJobs: Number(row.completed_jobs), failedJobs: Number(row.failed_jobs),
    runningJobs: Number(row.running_jobs ?? 0), queuedJobs: Number(row.queued_jobs ?? 0),
    pausedJobs: Number(row.paused_jobs ?? 0),
    estimatedUnits: Number(row.estimated_units), completedUnits: Number(row.completed_units),
    inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens),
    estimatedCostUsd: row.estimated_cost_usd == null ? null : Number(row.estimated_cost_usd),
    error: row.error == null ? null : String(row.error), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function jobRow(row: Record<string, unknown>): DocumentIndexJob {
  return {
    jobId: String(row.job_id), campaignId: row.campaign_id == null ? null : String(row.campaign_id),
    vaultId: String(row.vault_id), nodusId: String(row.nodus_id),
    title: row.title == null ? undefined : String(row.title), priority: Number(row.priority), reason: String(row.reason),
    status: String(row.status) as DocumentIndexJobStatus, phase: String(row.phase) as DocumentIndexJobPhase,
    progress: Number(row.progress), sourceFingerprint: row.source_fingerprint == null ? null : String(row.source_fingerprint),
    progressMessage: row.progress_message == null ? null : String(row.progress_message),
    currentUnit: row.current_unit == null ? null : Number(row.current_unit),
    totalUnits: row.total_units == null ? null : Number(row.total_units),
    generatorModel: json<ModelRef | null>(row.generator_model_json, null), auditorModel: json<ModelRef | null>(row.auditor_model_json, null),
    attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts),
    error: row.error == null ? null : String(row.error), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function createDocumentIndexCampaign(input: {
  vaultId: string; mode: DocumentIndexCampaign['mode']; includeArchived: boolean;
  generatorModel: ModelRef | null; auditorModel: ModelRef | null;
}): DocumentIndexCampaign {
  const campaignId = randomUUID();
  const now = new Date().toISOString();
  getDb().prepare(
    `INSERT INTO document_index_campaigns(
       campaign_id,vault_id,mode,status,include_archived,generator_model_json,auditor_model_json,created_at,updated_at
     ) VALUES(?,?,?,'queued',?,?,?,?,?)`
  ).run(
    campaignId, input.vaultId, input.mode, input.includeArchived ? 1 : 0,
    input.generatorModel ? JSON.stringify(input.generatorModel) : null,
    input.auditorModel ? JSON.stringify(input.auditorModel) : null, now, now
  );
  return campaignRow(getDb().prepare('SELECT * FROM document_index_campaigns WHERE campaign_id=?').get(campaignId) as Record<string, unknown>);
}

export function enqueueDocumentIndexJob(input: {
  vaultId: string; nodusId: string; campaignId?: string | null; priority?: number; reason: string;
  generatorModel: ModelRef | null; auditorModel: ModelRef | null;
}): DocumentIndexJob {
  const active = getDb().prepare(
    `SELECT j.*,w.title FROM document_index_jobs j JOIN works w ON w.nodus_id=j.nodus_id
      WHERE j.vault_id=? AND j.nodus_id=? AND j.status IN ('queued','running','paused') LIMIT 1`
  ).get(input.vaultId, input.nodusId) as Record<string, unknown> | undefined;
  if (active) {
    if ((input.priority ?? 0) > Number(active.priority)) getDb().prepare(
      'UPDATE document_index_jobs SET priority=?,updated_at=? WHERE job_id=?'
    ).run(input.priority ?? 0, new Date().toISOString(), active.job_id);
    return jobRow({ ...active, priority: Math.max(Number(active.priority), input.priority ?? 0) });
  }
  // Only an interrupted attempt that nothing has superseded is resumable: once a later
  // job completed, the failed one's partial work describes an older profile.
  const resumable = getDb().prepare(
    `SELECT j.job_id,j.campaign_id,j.generator_model_json FROM document_index_jobs j
      WHERE j.vault_id=? AND j.nodus_id=? AND j.status IN ('cancelled','failed')
        AND NOT EXISTS (SELECT 1 FROM document_index_jobs k
                         WHERE k.vault_id=j.vault_id AND k.nodus_id=j.nodus_id
                           AND k.status='completed' AND k.updated_at>j.updated_at)
      ORDER BY j.updated_at DESC LIMIT 1`
  ).get(input.vaultId, input.nodusId) as { job_id: string; campaign_id: string | null; generator_model_json: string | null } | undefined;
  // Checkpoint keys hash the evidence text only, not the model, so partial results carry
  // over only to a job that runs with the same generator.
  const newGenerator = input.generatorModel ? JSON.stringify(input.generatorModel) : null;
  const inheritsCheckpoints = resumable != null && resumable.generator_model_json === newGenerator;
  ensureDocumentProfileState(input.nodusId);
  if (resumable && resumable.campaign_id && resumable.campaign_id === (input.campaignId ?? null)) {
    const now = new Date().toISOString();
    getDb().transaction(() => {
      getDb().prepare(
        `UPDATE document_index_jobs SET status='queued',phase='queued',error=NULL,attempts=0,
           priority=?,reason=?,generator_model_json=?,auditor_model_json=?,updated_at=? WHERE job_id=?`
      ).run(
        input.priority ?? 0,
        input.reason,
        input.generatorModel ? JSON.stringify(input.generatorModel) : null,
        input.auditorModel ? JSON.stringify(input.auditorModel) : null,
        now,
        resumable.job_id,
      );
      setDocumentProfileState(input.nodusId, 'queued');
    })();
    refreshCampaign(input.campaignId ?? null);
    return jobRow(getDb().prepare(
      `SELECT j.*,w.title FROM document_index_jobs j JOIN works w ON w.nodus_id=j.nodus_id WHERE j.job_id=?`
    ).get(resumable.job_id) as Record<string, unknown>);
  }
  const jobId = randomUUID();
  const now = new Date().toISOString();
  getDb().transaction(() => {
    getDb().prepare(
      `INSERT INTO document_index_jobs(
         job_id,campaign_id,vault_id,nodus_id,priority,reason,status,phase,progress,
         generator_model_json,auditor_model_json,attempts,max_attempts,created_at,updated_at
       ) VALUES(?,?,?,?,?,?,'queued','queued',0,?,?,0,5,?,?)`
    ).run(
      jobId, input.campaignId ?? null, input.vaultId, input.nodusId, input.priority ?? 0,
      input.reason, input.generatorModel ? JSON.stringify(input.generatorModel) : null,
      input.auditorModel ? JSON.stringify(input.auditorModel) : null, now, now
    );
    if (resumable && inheritsCheckpoints) getDb().prepare(
      `INSERT OR IGNORE INTO document_index_checkpoints(job_id,checkpoint_key,content_hash,payload_json,updated_at)
       SELECT ?,checkpoint_key,content_hash,payload_json,? FROM document_index_checkpoints WHERE job_id=?`
    ).run(jobId, now, resumable.job_id);
    setDocumentProfileState(input.nodusId, 'queued');
  })();
  refreshCampaign(input.campaignId ?? null);
  return jobRow(getDb().prepare(
    `SELECT j.*,w.title FROM document_index_jobs j JOIN works w ON w.nodus_id=j.nodus_id WHERE j.job_id=?`
  ).get(jobId) as Record<string, unknown>);
}

export function listDocumentIndexCampaigns(): DocumentIndexCampaign[] {
  return (getDb().prepare('SELECT * FROM document_index_campaigns ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(campaignRow);
}

export function listDocumentIndexJobs(status?: DocumentIndexJobStatus): DocumentIndexJob[] {
  const rows = status
    ? getDb().prepare(`SELECT j.*,w.title FROM document_index_jobs j JOIN works w ON w.nodus_id=j.nodus_id WHERE j.status=? ORDER BY j.priority DESC,j.created_at`).all(status)
    : getDb().prepare(`SELECT j.*,w.title FROM document_index_jobs j JOIN works w ON w.nodus_id=j.nodus_id
        ORDER BY CASE j.status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END,
          j.priority DESC,
          CASE WHEN j.status IN ('running','paused','queued') THEN j.created_at END ASC,
          CASE WHEN j.status NOT IN ('running','paused','queued') THEN j.updated_at END DESC,
          j.job_id`).all();
  return (rows as Record<string, unknown>[]).map(jobRow);
}

export function claimNextDocumentIndexJob(): DocumentIndexJob | null {
  return getDb().transaction(() => {
    const row = getDb().prepare(
      `SELECT j.*,w.title FROM document_index_jobs j JOIN works w ON w.nodus_id=j.nodus_id
         LEFT JOIN document_index_campaigns c ON c.campaign_id=j.campaign_id
        WHERE j.status='queued'
          AND (j.campaign_id IS NULL OR c.status IN ('queued','running'))
        ORDER BY j.priority DESC,j.created_at LIMIT 1`
    ).get() as Record<string, unknown> | undefined;
    if (!row) return null;
    const now = new Date().toISOString();
    getDb().prepare(
      `UPDATE document_index_jobs SET status='running',attempts=attempts+1,error=NULL,updated_at=? WHERE job_id=? AND status='queued'`
    ).run(now, row.job_id);
    getDb().prepare(
      `UPDATE document_index_campaigns SET status='running',updated_at=? WHERE campaign_id=? AND status='queued'`
    ).run(now, row.campaign_id);
    setDocumentProfileState(String(row.nodus_id), 'structuring');
    return jobRow({ ...row, status: 'running', attempts: Number(row.attempts) + 1, updated_at: now });
  })();
}

export function updateDocumentIndexJob(jobId: string, patch: {
  status?: DocumentIndexJobStatus; phase?: DocumentIndexJobPhase; progress?: number;
  sourceFingerprint?: string | null; error?: string | null;
  progressMessage?: string | null; currentUnit?: number | null; totalUnits?: number | null;
}): DocumentIndexJob | null {
  const current = getDb().prepare('SELECT * FROM document_index_jobs WHERE job_id=?').get(jobId) as Record<string, unknown> | undefined;
  if (!current) return null;
  const nextStatus = patch.status ?? String(current.status) as DocumentIndexJobStatus;
  const nextPhase = patch.phase ?? String(current.phase) as DocumentIndexJobPhase;
  const now = new Date().toISOString();
  getDb().prepare(
    `UPDATE document_index_jobs SET status=?,phase=?,progress=?,source_fingerprint=?,error=?,
       progress_message=?,current_unit=?,total_units=?,updated_at=? WHERE job_id=?`
  ).run(
    nextStatus, nextPhase, clamp01(Math.max(Number(current.progress), patch.progress ?? Number(current.progress))),
    patch.sourceFingerprint === undefined ? current.source_fingerprint : patch.sourceFingerprint,
    patch.error === undefined ? current.error : patch.error,
    patch.progressMessage === undefined ? current.progress_message : patch.progressMessage,
    patch.currentUnit === undefined ? current.current_unit : patch.currentUnit,
    patch.totalUnits === undefined ? current.total_units : patch.totalUnits,
    now, jobId
  );
  const campaignId = current.campaign_id == null ? null : String(current.campaign_id);
  refreshCampaign(campaignId);
  const result = getDb().prepare(
    `SELECT j.*,w.title FROM document_index_jobs j JOIN works w ON w.nodus_id=j.nodus_id WHERE j.job_id=?`
  ).get(jobId) as Record<string, unknown>;
  return jobRow(result);
}

/** Advance a running job and its public work state as one guarded operation.
 * A pause/cancel that won the race can therefore never be overwritten by a
 * late progress callback from the provider. */
export function advanceRunningDocumentIndexJob(
  jobId: string,
  phase: DocumentIndexJobPhase,
  progress: number,
  profileState: DocumentUnderstandingState | null,
  detail?: { message?: string | null; currentUnit?: number | null; totalUnits?: number | null },
): boolean {
  return getDb().transaction(() => {
    const current = getDb().prepare(
      `SELECT nodus_id,progress,campaign_id FROM document_index_jobs
        WHERE job_id=? AND status='running'`
    ).get(jobId) as { nodus_id: string; progress: number; campaign_id: string | null } | undefined;
    if (!current) return false;
    const now = new Date().toISOString();
    const changed = getDb().prepare(
      `UPDATE document_index_jobs SET phase=?,progress=?,progress_message=?,current_unit=?,total_units=?,updated_at=?
        WHERE job_id=? AND status='running'`
    ).run(
      phase,
      clamp01(Math.max(Number(current.progress), progress)),
      detail?.message ?? null,
      detail?.currentUnit ?? null,
      detail?.totalUnits ?? null,
      now,
      jobId,
    );
    if (!changed.changes) return false;
    if (profileState) setDocumentProfileState(current.nodus_id, profileState);
    refreshCampaign(current.campaign_id);
    return true;
  })();
}

/** Restart from zero for a genuinely new source revision. Normal pause/resume
 * remains monotonic; only this explicit revision boundary resets the bar. */
export function requeueDocumentIndexJobForSourceChange(jobId: string): 'queued' | 'paused' | null {
  return getDb().transaction(() => {
    const job = getDb().prepare(
      'SELECT nodus_id,campaign_id,attempts,max_attempts FROM document_index_jobs WHERE job_id=?'
    ).get(jobId) as {
      nodus_id: string; campaign_id: string | null; attempts: number; max_attempts: number;
    } | undefined;
    if (!job) return null;
    const exhausted = Number(job.attempts) >= Number(job.max_attempts);
    const status = exhausted ? 'paused' : 'queued';
    const now = new Date().toISOString();
    getDb().prepare(
      `UPDATE document_index_jobs SET status=?,phase=?,progress=0,source_fingerprint=NULL,error=?,updated_at=?
        WHERE job_id=?`
    ).run(
      status,
      exhausted ? 'paused' : 'queued',
      exhausted
        ? 'La fuente cambió repetidamente durante el análisis. La campaña se ha pausado para evitar reintentos indefinidos.'
        : 'La obra cambió durante el análisis; se recalculará con el texto nuevo.',
      now,
      jobId,
    );
    setDocumentProfileState(job.nodus_id, exhausted ? 'paused' : 'queued', {
      staleReason: 'source_changed_during_analysis',
      error: exhausted ? 'La fuente sigue cambiando. Reanuda cuando la sincronización haya terminado.' : null,
    });
    if (exhausted && job.campaign_id) setDocumentCampaignStatus(job.campaign_id, 'paused');
    else refreshCampaign(job.campaign_id);
    return status;
  })();
}

export function cancelDocumentIndexJob(jobId: string): DocumentIndexJob | null {
  const result = getDb().transaction(() => {
    const job = updateDocumentIndexJob(jobId, {
      status: 'cancelled',
      error: 'Cancelado por el usuario.',
    });
    if (job) restoreDocumentProfileStateAfterCancellation(job.nodusId);
    return job;
  })();
  return result;
}

export function recoverInterruptedDocumentJobs(): number {
  return getDb().transaction(() => {
    const interrupted = getDb().prepare(
      `SELECT j.job_id,j.nodus_id,COALESCE(c.status,'running') campaign_status
         FROM document_index_jobs j
         LEFT JOIN document_index_campaigns c ON c.campaign_id=j.campaign_id
        WHERE j.status='running'`
    ).all() as Array<{ job_id: string; nodus_id: string; campaign_status: string }>;
    const now = new Date().toISOString();
    const update = getDb().prepare(
      `UPDATE document_index_jobs SET status=?,phase=?,error=NULL,updated_at=? WHERE job_id=?`
    );
    for (const job of interrupted) {
      const paused = job.campaign_status === 'paused';
      const cancelled = job.campaign_status === 'cancelled';
      const status = cancelled ? 'cancelled' : paused ? 'paused' : 'queued';
      update.run(status, paused ? 'paused' : cancelled ? 'done' : 'queued', now, job.job_id);
      if (cancelled) restoreDocumentProfileStateAfterCancellation(job.nodus_id);
      else setDocumentProfileState(job.nodus_id, paused ? 'paused' : 'queued');
    }
    return interrupted.length;
  })();
}

export function saveDocumentCheckpoint(jobId: string, key: string, contentHash: string, payload: unknown): void {
  getDb().prepare(
    `INSERT INTO document_index_checkpoints(job_id,checkpoint_key,content_hash,payload_json,updated_at)
     VALUES(?,?,?,?,?) ON CONFLICT(job_id,checkpoint_key) DO UPDATE SET
       content_hash=excluded.content_hash,payload_json=excluded.payload_json,updated_at=excluded.updated_at`
  ).run(jobId, key, contentHash, JSON.stringify(payload), new Date().toISOString());
}

export function readDocumentCheckpoint<T>(jobId: string, key: string, contentHash: string): T | null {
  const row = getDb().prepare(
    'SELECT payload_json,content_hash FROM document_index_checkpoints WHERE job_id=? AND checkpoint_key=?'
  ).get(jobId, key) as { payload_json: string; content_hash: string } | undefined;
  return row?.content_hash === contentHash ? json<T | null>(row.payload_json, null) : null;
}

export function clearDocumentCheckpoints(jobId: string): void {
  getDb().prepare('DELETE FROM document_index_checkpoints WHERE job_id=?').run(jobId);
}

/**
 * A published profile makes every earlier job's checkpoints for the work obsolete.
 * Clearing only the finishing job left a failed predecessor's checkpoints behind, and
 * the next enqueue copied them into a fresh job.
 */
export function clearWorkDocumentCheckpoints(nodusId: string): void {
  getDb().prepare(
    'DELETE FROM document_index_checkpoints WHERE job_id IN (SELECT job_id FROM document_index_jobs WHERE nodus_id=?)'
  ).run(nodusId);
}

export function setDocumentCampaignStatus(campaignId: string, status: DocumentIndexCampaign['status']): void {
  const now = new Date().toISOString();
  getDb().transaction(() => {
    const affected = getDb().prepare(
      `SELECT DISTINCT nodus_id FROM document_index_jobs
        WHERE campaign_id=? AND status IN ('queued','paused','running')`
    ).all(campaignId) as Array<{ nodus_id: string }>;
    getDb().prepare('UPDATE document_index_campaigns SET status=?,updated_at=? WHERE campaign_id=?').run(status, now, campaignId);
    if (status === 'paused') getDb().prepare(
      `UPDATE document_index_jobs SET status='paused',phase='paused',updated_at=?
        WHERE campaign_id=? AND status IN ('queued','running')`
    ).run(now, campaignId);
    if (status === 'running') getDb().prepare(
      `UPDATE document_index_jobs SET status='queued',phase='queued',updated_at=? WHERE campaign_id=? AND status='paused'`
    ).run(now, campaignId);
    if (status === 'paused') for (const row of affected) setDocumentProfileState(row.nodus_id, 'paused');
    if (status === 'running') for (const row of affected) setDocumentProfileState(row.nodus_id, 'queued');
    if (status === 'cancelled') {
      getDb().prepare(
        `UPDATE document_index_jobs SET status='cancelled',error='Cancelado por el usuario.',updated_at=? WHERE campaign_id=? AND status IN ('queued','paused','running')`
      ).run(now, campaignId);
      for (const row of affected) restoreDocumentProfileStateAfterCancellation(row.nodus_id);
    }
  })();
  refreshCampaign(campaignId);
}

function refreshCampaign(campaignId: string | null): void {
  if (!campaignId) return;
  const counts = getDb().prepare(
    `SELECT COUNT(*) total,
            COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) completed,
            COALESCE(SUM(CASE WHEN status IN ('failed','unavailable') THEN 1 ELSE 0 END),0) failed,
            COALESCE(SUM(CASE WHEN status='running' THEN 1 ELSE 0 END),0) running,
            COALESCE(SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END),0) queued,
            COALESCE(SUM(CASE WHEN status='paused' THEN 1 ELSE 0 END),0) paused,
            COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE progress END),0) units,
            COALESCE(SUM(CASE WHEN status IN ('queued','running','paused') THEN 1 ELSE 0 END),0) active
       FROM document_index_jobs WHERE campaign_id=?`
  ).get(campaignId) as {
    total: number; completed: number; failed: number; running: number;
    queued: number; paused: number; units: number; active: number;
  };
  const campaign = getDb().prepare('SELECT status FROM document_index_campaigns WHERE campaign_id=?').get(campaignId) as { status: string } | undefined;
  if (!campaign) return;
  const terminal = counts.active === 0;
  const status = terminal && !['cancelled','failed'].includes(campaign.status)
    ? (counts.failed > 0 ? 'failed' : 'completed') : campaign.status;
  getDb().prepare(
    `UPDATE document_index_campaigns SET total_jobs=?,completed_jobs=?,failed_jobs=?,
       running_jobs=?,queued_jobs=?,paused_jobs=?,estimated_units=?,completed_units=?,status=?,updated_at=?
       WHERE campaign_id=?`
  ).run(
    counts.total, counts.completed, counts.failed, counts.running, counts.queued, counts.paused, counts.total,
    Number(counts.units ?? 0), status, new Date().toISOString(), campaignId
  );
}

export function deleteDocumentProfile(nodusId: string): void {
  getDb().transaction(() => {
    getDb().prepare('DELETE FROM document_profiles_fts WHERE nodus_id=?').run(nodusId);
    getDb().prepare('DELETE FROM document_sections_fts WHERE nodus_id=?').run(nodusId);
    getDb().prepare('DELETE FROM document_profile_state WHERE nodus_id=?').run(nodusId);
    getDb().prepare('DELETE FROM document_profile_versions WHERE nodus_id=?').run(nodusId);
  })();
}
