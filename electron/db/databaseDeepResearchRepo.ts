import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import {
  normalizeDatabaseResearchRequest,
  isDatabaseResearchRunStatus,
  type DatabaseResearchClaim,
  type DatabaseResearchProgress,
  type DatabaseResearchReport,
  type DatabaseResearchRequest,
  type DatabaseResearchRun,
  type DatabaseResearchRunDetail,
  type DatabaseResearchRunQuery,
  type DatabaseResearchStep,
  type DatabaseResearchStepKind,
  type DatabaseResearchStepStatus,
  type DatabaseDeepResearchJob,
  type DatabaseDeepResearchReportType,
  type DatabaseResearchReportQuery,
  normalizeDatabaseDeepResearchReportType,
  isDatabaseDeepResearchReportType,
  type DatabaseDeepResearchReportAnnotation,
  type DatabaseDeepResearchReportAnnotationInput,
  type DatabaseDeepResearchReportAnnotationColor,
} from '@shared/databaseDeepResearch';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const MAX_JSON_BYTES = 1_000_000;
const MAX_MARKDOWN_BYTES = 2_000_000;
const MAX_TEXT_LENGTH = 20_000;
const MAX_ARRAY_ITEMS = 1_000;

function boundedJson(value: unknown, label: string, maxBytes = MAX_JSON_BYTES): string {
  let encoded: string;
  try {
    encoded = JSON.stringify(value ?? {}) ?? '{}';
  } catch {
    throw new Error(`${label} no es serializable.`);
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) throw new Error(`${label} supera el límite permitido.`);
  return encoded;
}

function boundedText(value: unknown, label: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') throw new Error(`${label} debe ser texto.`);
  const text = value;
  if (text.length > maxLength) throw new Error(`${label} supera el límite permitido.`);
  return text;
}

function boundedArray(value: unknown, label: string, maxItems = MAX_ARRAY_ITEMS): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} debe ser una lista.`);
  if (value.length > maxItems) throw new Error(`${label} supera el límite permitido.`);
  return value;
}

const canTransition = (from: string, to: string): boolean => {
  if (from === to) return true;
  if (from === 'queued') return to === 'running' || to === 'cancelled';
  if (from === 'stale') return to === 'running';
  if (from === 'running') return ['cancelling', 'completed', 'partial', 'failed', 'stale'].includes(to);
  if (from === 'cancelling') return to === 'cancelled';
  return false;
};

const json = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};
const bounded = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
};
function model(value: unknown): { provider: string; model: string } | null {
  const parsed = json<unknown>(value, null);
  if (!parsed || typeof parsed !== 'object') return null;
  const item = parsed as Record<string, unknown>;
  return typeof item.provider === 'string' && typeof item.model === 'string'
    ? { provider: item.provider, model: item.model } : null;
}

function requireDatabase(databaseId: string): void {
  if (!getDb().prepare('SELECT 1 FROM db_databases WHERE id = ?').get(databaseId)) {
    throw new Error('Base de datos no encontrada.');
  }
}

function runFromRow(row: Row): DatabaseResearchRun {
  const status = String(row.status);
  return {
    id: String(row.id), databaseId: String(row.database_id), objective: String(row.objective),
    title: row.title == null ? null : String(row.title), language: row.language == null ? null : String(row.language),
    reportType: normalizeDatabaseDeepResearchReportType(row.report_type ?? json<Record<string, unknown>>(row.request_json, {}).reportType),
    model: model(row.model_json), options: json(row.options_json, {}),
    request: json(row.request_json, {}), plan: json(row.plan_json, {}),
    snapshotManifest: json(row.snapshot_manifest_json, {}),
    snapshotFingerprint: row.snapshot_fingerprint == null ? null : String(row.snapshot_fingerprint),
    provider: row.provider == null ? null : String(row.provider), budget: json(row.budget_json, {}),
    revision: Number(row.revision) || 1,
    status: isDatabaseResearchRunStatus(status) ? status : 'failed', progress: Number(row.progress) || 0,
    phase: row.phase == null ? null : String(row.phase) as DatabaseResearchRun['phase'],
    currentStep: row.current_step == null ? null : String(row.current_step) as DatabaseResearchStepKind,
    error: row.error == null ? null : String(row.error), reportId: row.report_id == null ? null : String(row.report_id),
    createdAt: String(row.created_at), startedAt: row.started_at == null ? null : String(row.started_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at), updatedAt: String(row.updated_at),
  };
}

function stepFromRow(row: Row): DatabaseResearchStep {
  return {
    id: String(row.id), runId: String(row.run_id), kind: String(row.kind) as DatabaseResearchStepKind,
    ordinal: Number(row.ordinal), status: String(row.status) as DatabaseResearchStepStatus,
    progress: Number(row.progress) || 0, message: row.message == null ? null : String(row.message),
    input: json(row.input_json, {}), output: json(row.result_json ?? row.output_json, {}), error: row.error == null ? null : String(row.error),
    task: row.task == null ? null : String(row.task), agent: row.agent == null ? null : String(row.agent),
    params: json(row.params_json, {}), resultHash: row.result_hash == null ? null : String(row.result_hash),
    seed: row.seed == null ? null : Number(row.seed), durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    startedAt: row.started_at == null ? null : String(row.started_at), completedAt: row.completed_at == null ? null : String(row.completed_at),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function claimFromRow(row: Row): DatabaseResearchClaim {
  const confidence = row.confidence == null ? null : Number(row.confidence);
  const effect = row.effect == null ? null : Number(row.effect);
  const pValue = row.p_value == null ? null : Number(row.p_value);
  const qValue = row.q_value == null ? null : Number(row.q_value);
  const rawInterval = json<unknown>(row.interval_json, null);
  const interval = rawInterval && typeof rawInterval === 'object' &&
    typeof (rawInterval as Record<string, unknown>).low === 'number' &&
    typeof (rawInterval as Record<string, unknown>).high === 'number'
    ? {
        low: Number((rawInterval as Record<string, unknown>).low),
        high: Number((rawInterval as Record<string, unknown>).high),
        level: typeof (rawInterval as Record<string, unknown>).level === 'number'
          ? Number((rawInterval as Record<string, unknown>).level) : 0.95,
      } : null;
  return {
    id: String(row.id), runId: String(row.run_id), text: String(row.text),
    claimType: row.claim_type == null ? null : String(row.claim_type),
    status: ['verified', 'sensitive', 'exploratory', 'unverifiable'].includes(String(row.claim_status))
      ? String(row.claim_status) as DatabaseResearchClaim['status'] : 'exploratory',
    confidence: confidence != null && Number.isFinite(confidence) ? confidence : null,
    sourceRowIds: json(row.source_row_ids_json, []), evidence: json(row.evidence_json, {}), artifactRefs: json(row.artifact_refs_json, []),
    effect: effect != null && Number.isFinite(effect) ? effect : null,
    interval,
    pValue: pValue != null && Number.isFinite(pValue) ? pValue : null,
    qValue: qValue != null && Number.isFinite(qValue) ? qValue : null,
    sensitivity: json(row.sensitivity_json, {}),
    limitations: json(row.limitations_json, []),
    ordinal: Number(row.ordinal), createdAt: String(row.created_at),
  };
}

function reportFromRow(row: Row): DatabaseResearchReport {
  return {
    id: String(row.id), runId: String(row.run_id), title: String(row.title), markdown: String(row.markdown),
    reportType: normalizeDatabaseDeepResearchReportType(row.report_type ?? json<Record<string, unknown>>(row.metadata_json, {}).reportType),
    summary: row.summary == null ? null : String(row.summary), bibliography: json(row.bibliography_json, []),
    metadata: json(row.metadata_json, {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    readAt: row.read_at == null ? null : String(row.read_at),
    structured: json(row.structured_json, {}), quality: json(row.quality_json, {}), provenance: json(row.provenance_json, {}),
  };
}

interface DatabaseResearchReportAnnotationRow {
  id: string; report_id: string; scope: string; kind: string; color: string | null;
  start_offset: number; end_offset: number; selected_text: string; prefix: string; suffix: string;
  comment_text: string | null; created_at: string; updated_at: string;
}
const ANNOTATION_COLORS = new Set<DatabaseDeepResearchReportAnnotationColor>(['yellow', 'rose', 'blue', 'mint', 'lavender', 'peach']);
function annotationFromRow(row: DatabaseResearchReportAnnotationRow): DatabaseDeepResearchReportAnnotation | null {
  if (!['highlight', 'comment', 'bookmark'].includes(row.kind)) return null;
  if (row.color !== null && !ANNOTATION_COLORS.has(row.color as DatabaseDeepResearchReportAnnotationColor)) return null;
  if (!Number.isInteger(row.start_offset) || !Number.isInteger(row.end_offset) || row.start_offset < 0 || row.end_offset <= row.start_offset) return null;
  return { id: row.id, reportId: row.report_id, scope: row.scope, kind: row.kind as DatabaseDeepResearchReportAnnotation['kind'], color: row.color as DatabaseDeepResearchReportAnnotationColor | null,
    startOffset: row.start_offset, endOffset: row.end_offset, selectedText: row.selected_text, prefix: row.prefix, suffix: row.suffix,
    comment: row.comment_text, createdAt: row.created_at, updatedAt: row.updated_at };
}
function resolveReportId(reportId: string): string | null {
  const value = String(reportId ?? '').trim();
  if (!value) return null;
  const row = getDb().prepare('SELECT id FROM database_research_reports WHERE id = ? OR run_id = ?').get(value, value) as { id: string } | undefined;
  return row?.id ?? null;
}
export function setDatabaseDeepResearchReportRead(id: string, read: boolean): DatabaseResearchReport | null {
  const reportId = resolveReportId(id); if (!reportId) return null;
  getDb().prepare('UPDATE database_research_reports SET read_at = ?, updated_at = ? WHERE id = ?').run(read ? now() : null, now(), reportId);
  const row = getDb().prepare('SELECT * FROM database_research_reports WHERE id = ?').get(reportId) as Row | undefined;
  return row ? reportFromRow(row) : null;
}
export function listDatabaseDeepResearchReportAnnotations(reportId: string): DatabaseDeepResearchReportAnnotation[] {
  const id = resolveReportId(reportId); if (!id) return [];
  const rows = getDb().prepare('SELECT * FROM database_research_report_annotations WHERE report_id = ? ORDER BY scope, start_offset, created_at').all(id) as DatabaseResearchReportAnnotationRow[];
  return rows.map(annotationFromRow).filter((item): item is DatabaseDeepResearchReportAnnotation => item !== null);
}
function normalizeReportAnnotation(input: DatabaseDeepResearchReportAnnotationInput) {
  const reportId = resolveReportId(input.reportId); if (!reportId) throw new Error('El informe anotado ya no existe.');
  const scope = String(input.scope ?? 'source').trim() || 'source';
  const selectedText = String(input.selectedText ?? '');
  const startOffset = Math.trunc(Number(input.startOffset)); const endOffset = Math.trunc(Number(input.endOffset));
  if (scope.length > 180 || startOffset < 0 || endOffset <= startOffset || !Number.isInteger(startOffset) || !Number.isInteger(endOffset)) throw new Error('El fragmento seleccionado no es válido.');
  if (!selectedText.trim() || selectedText.length !== endOffset - startOffset) throw new Error('El texto seleccionado no coincide con su posición.');
  if (!['highlight', 'comment', 'bookmark'].includes(input.kind)) throw new Error('El tipo de anotación no es válido.');
  if (input.kind === 'highlight' && (!input.color || !ANNOTATION_COLORS.has(input.color))) throw new Error('El color del subrayado no es válido.');
  const comment = input.kind === 'comment' ? String(input.comment ?? '').trim() : null;
  if (input.kind === 'comment' && !comment) throw new Error('Escribe el comentario antes de guardarlo.');
  return { reportId, scope, kind: input.kind, color: input.kind === 'highlight' ? input.color! : null, startOffset, endOffset, selectedText,
    prefix: String(input.prefix ?? '').slice(-64), suffix: String(input.suffix ?? '').slice(0, 64), comment };
}
export function createDatabaseDeepResearchReportAnnotation(input: DatabaseDeepResearchReportAnnotationInput): DatabaseDeepResearchReportAnnotation {
  const value = normalizeReportAnnotation(input); const id = value.kind === 'bookmark' ? `database-research-bookmark:${value.reportId}:${value.scope}` : randomUUID(); const timestamp = now(); const db = getDb();
  db.prepare(`INSERT INTO database_research_report_annotations (id, report_id, scope, kind, color, start_offset, end_offset, selected_text, prefix, suffix, comment_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope, kind=excluded.kind, color=excluded.color, start_offset=excluded.start_offset, end_offset=excluded.end_offset, selected_text=excluded.selected_text, prefix=excluded.prefix, suffix=excluded.suffix, comment_text=excluded.comment_text, updated_at=excluded.updated_at`)
    .run(id, value.reportId, value.scope, value.kind, value.color, value.startOffset, value.endOffset, value.selectedText, value.prefix, value.suffix, value.comment, timestamp, timestamp);
  const row = db.prepare('SELECT * FROM database_research_report_annotations WHERE id = ?').get(id) as DatabaseResearchReportAnnotationRow;
  const annotation = annotationFromRow(row); if (!annotation) throw new Error('No se pudo guardar la anotación.'); return annotation;
}
export function updateDatabaseDeepResearchReportComment(id: string, comment: string): DatabaseDeepResearchReportAnnotation | null {
  const value = String(comment ?? '').trim(); if (!value) throw new Error('Escribe el comentario antes de guardarlo.'); const db = getDb();
  const changed = db.prepare("UPDATE database_research_report_annotations SET comment_text = ?, updated_at = ? WHERE id = ? AND kind = 'comment'").run(value, now(), id);
  if (!changed.changes) return null; return annotationFromRow(db.prepare('SELECT * FROM database_research_report_annotations WHERE id = ?').get(id) as DatabaseResearchReportAnnotationRow);
}
export function deleteDatabaseDeepResearchReportAnnotation(id: string): string | null {
  const db = getDb(); const row = db.prepare('SELECT report_id FROM database_research_report_annotations WHERE id = ?').get(id) as { report_id: string } | undefined; if (!row) return null;
  db.prepare('DELETE FROM database_research_report_annotations WHERE id = ?').run(id); return row.report_id;
}

function assertRun(runId: string): Row {
  const row = getDb().prepare('SELECT * FROM database_research_runs WHERE id = ?').get(runId) as Row | undefined;
  if (!row) throw new Error('Ejecución de investigación no encontrada.');
  return row;
}

export function getDatabaseResearchRun(id: string): DatabaseResearchRun | null {
  const row = getDb().prepare('SELECT * FROM database_research_runs WHERE id = ?').get(id) as Row | undefined;
  return row ? runFromRow(row) : null;
}

export function listDatabaseResearchRuns(query: DatabaseResearchRunQuery = {}): DatabaseResearchRun[] {
  const db = getDb();
  const where: string[] = [];
  const args: unknown[] = [];
  if (query.databaseId) { where.push('database_id = ?'); args.push(query.databaseId); }
  if (query.status && query.status !== 'all') { where.push('status = ?'); args.push(query.status); }
  if (query.reportType && isDatabaseDeepResearchReportType(query.reportType)) { where.push('report_type = ?'); args.push(query.reportType); }
  const limit = bounded(query.limit, 1, 500, 100);
  const offset = bounded(query.offset, 0, 10_000_000, 0);
  const rows = db.prepare(`SELECT * FROM database_research_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as Row[];
  return rows.map(runFromRow);
}

export function databaseResearchJob(run: DatabaseResearchRun): DatabaseDeepResearchJob {
  return {
    id: run.id, reportType: run.reportType, title: run.title || run.objective.slice(0, 120), status: run.status,
    progress: run.progress, phase: run.currentStep || (run.status === 'queued' ? 'queued' : 'preparing'),
    createdAt: run.createdAt, error: run.error,
  };
}

export function listDatabaseResearchJobs(): DatabaseDeepResearchJob[] {
  return listDatabaseResearchRuns({ limit: 500 }).map(databaseResearchJob);
}

export function getDatabaseResearchJob(id: string): DatabaseDeepResearchJob | null {
  const run = getDatabaseResearchRun(id);
  return run ? databaseResearchJob(run) : null;
}
/** Retain the host's stable receipt even if a terminal run is later cleared. */
export function findMobileDatabaseResearchRun(bridgeJobId:string): DatabaseResearchRun | null {
  const db=getDb();
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='desktop_database_research_jobs'").get()) return null;
  const row=db.prepare('SELECT run_id FROM desktop_database_research_jobs WHERE bridge_job_id=?').get(bridgeJobId) as {run_id:string}|undefined;
  if(!row) return null;
  const run=getDatabaseResearchRun(row.run_id);if(!run) throw new Error('mobile_database_research_run_unavailable');return run;
}
export function rememberMobileDatabaseResearchRun(bridgeJobId:string,runId:string): void {
  const db=getDb();db.exec('CREATE TABLE IF NOT EXISTS desktop_database_research_jobs (bridge_job_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,created_at TEXT NOT NULL)');
  db.prepare('INSERT INTO desktop_database_research_jobs VALUES(?,?,?)').run(bridgeJobId,runId,now());
}
export function mobileDatabaseResearchTransaction<T>(run:()=>T): T { return getDb().transaction(run)(); }

/** Clear terminal queue records that do not own a completed report. Reports are
 * deliberately retained in the gallery when a queue is cleared. */
export function clearFinishedDatabaseResearchJobs(): number {
  return getDb().prepare("DELETE FROM database_research_runs WHERE status IN ('failed','cancelled','stale') AND NOT EXISTS (SELECT 1 FROM database_research_reports r WHERE r.run_id=database_research_runs.id)").run().changes;
}

export function listDatabaseResearchReports(query: DatabaseResearchReportQuery & { reportType?: DatabaseDeepResearchReportType } = {}): DatabaseResearchReport[] {
  const limit = bounded(query.limit, 1, 500, 100); const offset = bounded(query.offset, 0, 10_000_000, 0);
  const search = typeof query.query === 'string' && query.query.trim() ? `%${query.query.trim()}%` : null;
  const reportType = isDatabaseDeepResearchReportType(query.reportType) ? query.reportType : null;
  return (getDb().prepare(
    `SELECT report.* FROM database_research_reports report
       JOIN database_research_runs run ON run.id = report.run_id
      WHERE run.status IN ('completed','partial')
        AND (? IS NULL OR report.title LIKE ? OR report.summary LIKE ?)
       AND (? IS NULL OR report.report_type = ? OR run.report_type = ?)
      ORDER BY report.updated_at DESC LIMIT ? OFFSET ?`,
  ).all(search, search, search, reportType, reportType, reportType, limit, offset) as Row[]).map(reportFromRow);
}

export function getDatabaseResearchReport(id: string): DatabaseResearchReport | null {
  const row = getDb().prepare('SELECT * FROM database_research_reports WHERE id = ? OR run_id = ?').get(id, id) as Row | undefined;
  return row ? reportFromRow(row) : null;
}

export function deleteDatabaseResearchReport(id: string): boolean {
  const db = getDb();
  const result = db.transaction(() => {
    const report = db.prepare('SELECT run_id FROM database_research_reports WHERE id = ?').get(id) as { run_id: string } | undefined;
    if (!report) return 0;
    db.prepare('DELETE FROM database_research_reports WHERE id = ?').run(id);
    db.prepare('UPDATE database_research_runs SET report_id=NULL, updated_at=?, revision=revision+1 WHERE id=?').run(now(), report.run_id);
    return 1;
  })();
  return result > 0;
}

export function getDatabaseResearchRunDetail(id: string): DatabaseResearchRunDetail | null {
  const run = getDatabaseResearchRun(id);
  if (!run) return null;
  const db = getDb();
  const steps = (db.prepare('SELECT * FROM database_research_steps WHERE run_id = ? ORDER BY ordinal ASC').all(id) as Row[]).map(stepFromRow);
  const claims = (db.prepare('SELECT * FROM database_research_claims WHERE run_id = ? ORDER BY ordinal ASC, created_at ASC').all(id) as Row[]).map(claimFromRow);
  const reportRow = db.prepare('SELECT * FROM database_research_reports WHERE run_id = ?').get(id) as Row | undefined;
  return { run, steps, claims, report: reportRow ? reportFromRow(reportRow) : null };
}

export function createDatabaseResearchRun(input: DatabaseResearchRequest): DatabaseResearchRun {
  const request = normalizeDatabaseResearchRequest(input);
  requireDatabase(request.databaseId);
  const optionsJson = boundedJson(request.options ?? {}, 'Las opciones de investigación');
  const requestJson = boundedJson(request, 'La petición de investigación');
  const budgetJson = boundedJson(request.options?.budget ?? {}, 'El presupuesto de investigación');
  const id = `dbr_${randomUUID()}`;
  const timestamp = now();
  getDb().prepare(
    `INSERT INTO database_research_runs
      (id, database_id, objective, title, language, report_type, model_json, options_json, request_json, provider, budget_json, phase, status, progress, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'snapshot', 'queued', 0, ?, ?)`,
  ).run(id, request.databaseId, request.objective, request.title, request.language,
    request.reportType ?? 'general', request.model ? boundedJson(request.model, 'El modelo de investigación') : null, optionsJson, requestJson,
    request.model?.provider ?? null, budgetJson, timestamp, timestamp);
  return getDatabaseResearchRun(id)!;
}

export function startDatabaseResearchRun(id: string): DatabaseResearchProgress {
  const db = getDb();
  const row = assertRun(id); const status = String(row.status);
  if (status === 'running') return progressFromRun(runFromRow(row), null);
  if (!['queued', 'stale'].includes(status)) {
    throw new Error(`No se puede iniciar una ejecución en estado ${status}.`);
  }
  const revision = Number(row.revision);
  const timestamp = now();
  const result = db.prepare(
    "UPDATE database_research_runs SET status='running', phase=COALESCE(phase, 'snapshot'), started_at=?, completed_at=NULL, error=NULL, updated_at=?, revision=revision+1 WHERE id=? AND revision=? AND status=?",
  ).run(timestamp, timestamp, id, revision, status);
  if (result.changes === 0) {
    const current = assertRun(id);
    if (String(current.status) === 'running') return progressFromRun(runFromRow(current), null);
    throw new Error(`Conflicto al iniciar la ejecución ${id}.`);
  }
  return progressFromRun(getDatabaseResearchRun(id)!, null);
}

/** Mark an abandoned worker run stale without reviving any terminal state. */
export function markDatabaseResearchRunStale(id: string, reason = 'La ejecución no ha informado progreso.'): boolean {
  const db = getDb();
  const row = assertRun(id); if (String(row.status) !== 'running') return false;
  const revision = Number(row.revision);
  const result = db.prepare(
    "UPDATE database_research_runs SET status='stale', error=?, updated_at=?, revision=revision+1 WHERE id=? AND revision=? AND status='running'",
  ).run(boundedText(reason, 'El motivo de stale'), now(), id, revision);
  return result.changes > 0;
}

export interface DatabaseResearchRunPatch {
  expectedRevision?: number;
  request?: Record<string, unknown>; plan?: Record<string, unknown>;
  snapshotManifest?: Record<string, unknown>; snapshotFingerprint?: string | null;
  provider?: string | null; model?: { provider: string; model: string } | null;
  budget?: Record<string, unknown>; revisions?: unknown[]; phase?: DatabaseResearchStepKind | 'done' | null;
  progressDetails?: Record<string, unknown>;
  reportType?: DatabaseDeepResearchReportType;
}

/** Persist planner/snapshot provenance without allowing the database identity or
 * objective to drift after a run has been queued. Every patch is a new revision. */
export function updateDatabaseResearchRun(id: string, patch: DatabaseResearchRunPatch): DatabaseResearchRun {
  assertRun(id);
  if (patch.expectedRevision != null && (!Number.isSafeInteger(patch.expectedRevision) || patch.expectedRevision < 1)) {
    throw new Error(`La revisión esperada de ${id} no es válida.`);
  }
  const db = getDb(); const timestamp = now();
  const fields: string[] = ['revision = revision + 1', 'updated_at = ?']; const args: unknown[] = [timestamp];
  const add = (column: string, value: unknown) => { fields.push(`${column} = ?`); args.push(value); };
  if (patch.request !== undefined) add('request_json', boundedJson(patch.request, 'La petición de investigación'));
  if (patch.plan !== undefined) add('plan_json', boundedJson(patch.plan, 'El plan de investigación'));
  if (patch.snapshotManifest !== undefined) add('snapshot_manifest_json', boundedJson(patch.snapshotManifest, 'El manifiesto de snapshot'));
  if (patch.snapshotFingerprint !== undefined) add('snapshot_fingerprint', patch.snapshotFingerprint == null ? null : boundedText(patch.snapshotFingerprint, 'La huella del snapshot', 500));
  if (patch.provider !== undefined) add('provider', patch.provider == null ? null : boundedText(patch.provider, 'El proveedor', 100));
  if (patch.model !== undefined) add('model_json', patch.model ? boundedJson(patch.model, 'El modelo de investigación') : null);
  if (patch.budget !== undefined) add('budget_json', boundedJson(patch.budget, 'El presupuesto de investigación'));
  if (patch.revisions !== undefined) add('revisions_json', boundedJson(patch.revisions, 'Las revisiones'));
  if (patch.phase !== undefined) add('phase', patch.phase);
  if (patch.progressDetails !== undefined) add('progress_json', boundedJson(patch.progressDetails, 'El progreso de investigación'));
  if (patch.reportType !== undefined) add('report_type', normalizeDatabaseDeepResearchReportType(patch.reportType));
  args.push(id);
  if (patch.expectedRevision != null) args.push(patch.expectedRevision);
  const result = db.prepare(`UPDATE database_research_runs SET ${fields.join(', ')} WHERE id = ?${patch.expectedRevision != null ? ' AND revision = ?' : ''}`).run(...args);
  if (result.changes === 0) throw new Error(`Conflicto al actualizar la ejecución ${id}.`);
  return getDatabaseResearchRun(id)!;
}

export const enqueueDatabaseResearchRun = createDatabaseResearchRun;

export function updateDatabaseResearchProgress(id: string, progress: Partial<Omit<DatabaseResearchProgress, 'runId'>>): DatabaseResearchProgress {
  const row = assertRun(id);
  const currentStatus = String(row.status);
  if (currentStatus === 'cancelled' || currentStatus === 'cancelling') return progressFromRun(runFromRow(row), null);
  const value = Math.min(1, Math.max(0, Number(progress.progress ?? row.progress) || 0));
  const status = progress.status && isDatabaseResearchRunStatus(progress.status) ? progress.status : currentStatus;
  if (!canTransition(currentStatus, status)) throw new Error(`Transición de ejecución no válida: ${currentStatus} → ${status}.`);
  const timestamp = now();
  const phase = progress.phase ?? progress.step ?? row.phase ?? row.current_step ?? null;
  const result = getDb().prepare('UPDATE database_research_runs SET status=?, progress=?, current_step=?, phase=?, error=?, updated_at=?, revision=revision+1 WHERE id=? AND revision=? AND status=?')
    .run(status, value, progress.step ?? row.current_step ?? null, phase, progress.error ?? row.error ?? null, timestamp, id, Number(row.revision), currentStatus);
  if (result.changes === 0) {
    const current = getDatabaseResearchRun(id);
    if (!current) throw new Error('Ejecución de investigación no encontrada.');
    return progressFromRun(current, null);
  }
  return progressFromRun(getDatabaseResearchRun(id)!, progress.message ?? null);
}

function progressFromRun(run: DatabaseResearchRun, message: string | null): DatabaseResearchProgress {
  return { runId: run.id, status: run.status, progress: run.progress, step: run.currentStep,
    phase: run.phase ?? (run.status === 'completed' ? 'done' : run.currentStep), message, error: run.error };
}

export function cancelDatabaseResearchRun(id: string): boolean {
  const row = assertRun(id);
  const status = String(row.status);
  if (['completed', 'partial', 'failed', 'stale', 'cancelled'].includes(status)) return false;
  if (status === 'cancelling') return true;
  const timestamp = now();
  const nextStatus = status === 'queued' ? 'cancelled' : 'cancelling';
  const result = getDb().prepare(`UPDATE database_research_runs SET status='${nextStatus}', completed_at=?, updated_at=?, revision=revision+1 WHERE id=? AND revision=? AND status=?`)
    .run(nextStatus === 'cancelled' ? timestamp : null, timestamp, id, Number(row.revision), status);
  return result.changes > 0;
}

/** Complete a cooperative cancellation after the worker has observed cancelling. */
export function finalizeDatabaseResearchCancellation(id: string): boolean {
  const row = assertRun(id); if (String(row.status) !== 'cancelling') return false;
  const timestamp = now();
  return getDb().prepare("UPDATE database_research_runs SET status='cancelled', completed_at=?, updated_at=?, revision=revision+1 WHERE id=? AND revision=? AND status='cancelling'")
    .run(timestamp, timestamp, id, Number(row.revision)).changes > 0;
}

export function failDatabaseResearchRun(id: string, error: string): DatabaseResearchRun {
  const row = assertRun(id); const status = String(row.status);
  if (status === 'cancelling') {
    finalizeDatabaseResearchCancellation(id);
    return getDatabaseResearchRun(id)!;
  }
  if (!['queued', 'running'].includes(status)) return runFromRow(row);
  const timestamp = now();
  getDb().prepare("UPDATE database_research_runs SET status='failed', error=?, completed_at=?, updated_at=?, revision=revision+1 WHERE id=? AND revision=? AND status=?")
    .run(boundedText(error, 'El error de investigación'), timestamp, timestamp, id, Number(row.revision), status);
  return getDatabaseResearchRun(id)!;
}

export function upsertDatabaseResearchStep(input: {
  id?: string; runId: string; kind: DatabaseResearchStepKind; ordinal: number; status?: DatabaseResearchStepStatus;
  progress?: number; message?: string | null; input?: Record<string, unknown>; output?: Record<string, unknown>;
  error?: string | null; startedAt?: string | null; completedAt?: string | null;
  task?: string | null; agent?: string | null; params?: Record<string, unknown>; resultHash?: string | null;
  seed?: number | null; durationMs?: number | null;
}): DatabaseResearchStep {
  assertRun(input.runId);
  if (!Number.isInteger(input.ordinal) || input.ordinal < 0) throw new Error('El orden del paso no es válido.');
  if (input.id != null) boundedText(input.id, 'El identificador del paso', 300);
  if (input.status != null && !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(input.status)) throw new Error('Estado del paso no válido.');
  if (input.progress != null && (!Number.isFinite(input.progress) || input.progress < 0 || input.progress > 1)) throw new Error('El progreso del paso no es válido.');
  if (input.task != null) boundedText(input.task, 'La tarea del paso');
  if (input.agent != null) boundedText(input.agent, 'El agente del paso', 500);
  if (input.message != null) boundedText(input.message, 'El mensaje del paso');
  if (input.error != null) boundedText(input.error, 'El error del paso');
  if (input.resultHash != null) boundedText(input.resultHash, 'El hash del resultado', 500);
  if (input.seed != null && (!Number.isSafeInteger(input.seed))) throw new Error('La semilla del paso no es válida.');
  if (input.durationMs != null && (!Number.isFinite(input.durationMs) || input.durationMs < 0)) throw new Error('La duración del paso no es válida.');
  const paramsJson = boundedJson(input.params ?? {}, 'Los parámetros del paso');
  const resultJson = boundedJson(input.output ?? {}, 'El resultado del paso');
  const inputJson = boundedJson(input.input ?? {}, 'La entrada del paso');
  const db = getDb(); const timestamp = now(); const id = input.id ?? `dbrs_${randomUUID()}`;
  db.prepare(
    `INSERT INTO database_research_steps
      (id, run_id, kind, ordinal, task, agent, params_json, result_json, result_hash, seed, duration_ms, status, progress, message, input_json, output_json, error, started_at, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, ordinal) DO UPDATE SET kind=excluded.kind, task=excluded.task, agent=excluded.agent,
       params_json=excluded.params_json, result_json=excluded.result_json, result_hash=excluded.result_hash, seed=excluded.seed, duration_ms=excluded.duration_ms,
       status=excluded.status, progress=excluded.progress,
       message=excluded.message, input_json=excluded.input_json, output_json=excluded.output_json, error=excluded.error,
       started_at=excluded.started_at, completed_at=excluded.completed_at, updated_at=excluded.updated_at`,
  ).run(id, input.runId, input.kind, input.ordinal, input.task ?? null, input.agent ?? null, paramsJson, resultJson,
    input.resultHash ?? null, input.seed ?? null, input.durationMs ?? null, input.status ?? 'queued', Math.min(1, Math.max(0, input.progress ?? 0)),
    input.message ?? null, inputJson, resultJson, input.error ?? null,
    input.startedAt ?? null, input.completedAt ?? null, timestamp, timestamp);
  return stepFromRow(db.prepare('SELECT * FROM database_research_steps WHERE run_id=? AND ordinal=?').get(input.runId, input.ordinal) as Row);
}

export const createDatabaseResearchStep = upsertDatabaseResearchStep;

export type DatabaseResearchFinalStatus = 'completed' | 'partial';
export type DatabaseResearchReportInput = Omit<DatabaseResearchReport, 'createdAt' | 'updatedAt' | 'readAt'> & { finalStatus?: DatabaseResearchFinalStatus };

export function saveDatabaseResearchReport(input: DatabaseResearchReportInput): DatabaseResearchReport {
  const row = assertRun(input.runId); const currentStatus = String(row.status);
  const finalStatus = input.finalStatus ?? 'completed';
  if (finalStatus !== 'completed' && finalStatus !== 'partial') throw new Error('Estado final del informe no válido.');
  if (currentStatus === 'completed' && finalStatus === 'partial') throw new Error('No se puede degradar un informe completado a parcial.');
  if (['cancelled', 'cancelling', 'failed', 'stale'].includes(currentStatus)) throw new Error('La ejecución no admite un informe en su estado actual.');
  const title = boundedText(input.title, 'El título del informe', 2_000).trim();
  const markdown = boundedText(input.markdown, 'El contenido del informe', MAX_MARKDOWN_BYTES).trim();
  if (!title || !markdown) throw new Error('El informe necesita título y contenido.');
  const summary = input.summary == null ? null : boundedText(input.summary, 'El resumen del informe');
  const bibliographyJson = boundedJson(input.bibliography ?? [], 'La bibliografía');
  const metadataJson = boundedJson(input.metadata ?? {}, 'Los metadatos del informe');
  const structuredJson = boundedJson(input.structured ?? {}, 'El informe estructurado');
  const qualityJson = boundedJson(input.quality ?? {}, 'La calidad del informe');
  const provenanceJson = boundedJson(input.provenance ?? {}, 'La procedencia del informe');
  const reportType = normalizeDatabaseDeepResearchReportType(
    input.reportType ?? row.report_type ?? json<Record<string, unknown>>(row.request_json, {}).reportType ?? json<Record<string, unknown>>(input.metadata ?? {}, {}).reportType,
  );
  boundedArray(input.bibliography ?? [], 'La bibliografía');
  const db = getDb(); const timestamp = now();
  const transaction = db.transaction(() => {
    const latest = db.prepare('SELECT status, revision FROM database_research_runs WHERE id=?').get(input.runId) as { status: string; revision: number } | undefined;
    if (!latest) throw new Error('Ejecución de investigación no encontrada.');
    if (['cancelled', 'cancelling', 'failed', 'stale'].includes(latest.status)) throw new Error('La ejecución no admite un informe en su estado actual.');
    if (latest.status === 'completed' && finalStatus === 'partial') throw new Error('No se puede degradar un informe completado a parcial.');
    db.prepare(
      `INSERT INTO database_research_reports (id, run_id, report_type, title, markdown, summary, bibliography_json, metadata_json, structured_json, quality_json, provenance_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET report_type=excluded.report_type, title=excluded.title, markdown=excluded.markdown, summary=excluded.summary,
         bibliography_json=excluded.bibliography_json, metadata_json=excluded.metadata_json, structured_json=excluded.structured_json,
         quality_json=excluded.quality_json, provenance_json=excluded.provenance_json, updated_at=excluded.updated_at`,
    ).run(input.id, input.runId, reportType, title, markdown, summary,
      bibliographyJson, metadataJson, structuredJson, qualityJson, provenanceJson, timestamp, timestamp);
    const updated = db.prepare("UPDATE database_research_runs SET report_id=(SELECT id FROM database_research_reports WHERE run_id=?), status=?, progress=1, phase='done', completed_at=?, updated_at=?, revision=revision+1 WHERE id=? AND revision=?")
      .run(input.runId, finalStatus, timestamp, timestamp, input.runId, latest.revision);
    if (updated.changes === 0) throw new Error('Conflicto al fijar el estado final del informe.');
  });
  transaction();
  const report = db.prepare('SELECT * FROM database_research_reports WHERE run_id=?').get(input.runId) as Row | undefined;
  if (!report) throw new Error('No se pudo guardar el informe.');
  return reportFromRow(report);
}

export const createDatabaseResearchReport = saveDatabaseResearchReport;

export function saveDatabaseResearchClaim(input: Omit<DatabaseResearchClaim, 'createdAt'>): DatabaseResearchClaim {
  assertRun(input.runId); const db = getDb(); const timestamp = now();
  if (input.id != null) boundedText(input.id, 'El identificador de la afirmación', 300);
  const text = boundedText(input.text, 'El texto de la afirmación').trim();
  if (!text) throw new Error('Una afirmación no puede estar vacía.');
  if (!['verified', 'sensitive', 'exploratory', 'unverifiable'].includes(input.status)) throw new Error('Estado de afirmación no válido.');
  if (!Number.isInteger(input.ordinal) || input.ordinal < 0) throw new Error('El orden de la afirmación no es válido.');
  if (input.claimType != null) boundedText(input.claimType, 'El tipo de afirmación', 500);
  if (input.confidence != null && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) throw new Error('La confianza de la afirmación no es válida.');
  if (input.effect != null && !Number.isFinite(input.effect)) throw new Error('El efecto de la afirmación no es válido.');
  if (input.pValue != null && (!Number.isFinite(input.pValue) || input.pValue < 0 || input.pValue > 1)) throw new Error('El p-value de la afirmación no es válido.');
  if (input.qValue != null && (!Number.isFinite(input.qValue) || input.qValue < 0 || input.qValue > 1)) throw new Error('El q-value de la afirmación no es válido.');
  if (input.interval != null) {
    if (!Number.isFinite(input.interval.low) || !Number.isFinite(input.interval.high) || !Number.isFinite(input.interval.level) || input.interval.level <= 0 || input.interval.level > 1) {
      throw new Error('El intervalo de la afirmación no es válido.');
    }
  }
  boundedArray(input.sourceRowIds ?? [], 'Las filas fuente');
  boundedArray(input.artifactRefs ?? [], 'Las referencias de artifacts');
  boundedArray(input.limitations ?? [], 'Las limitaciones de la afirmación');
  const sourceRowIds = (input.sourceRowIds ?? []).map((value) => boundedText(value, 'El identificador de fila', 300));
  const artifactRefs = (input.artifactRefs ?? []).map((value) => boundedText(value, 'La referencia de artifact', 500));
  const evidenceJson = boundedJson(input.evidence ?? {}, 'La evidencia de la afirmación');
  const intervalJson = input.interval == null ? null : boundedJson(input.interval, 'El intervalo de la afirmación');
  const sensitivityJson = boundedJson(input.sensitivity ?? {}, 'La sensibilidad de la afirmación');
  const limitations = (input.limitations ?? []).map((value) => boundedText(value, 'La limitación de la afirmación', 2_000));
  db.prepare(
    `INSERT INTO database_research_claims (id, run_id, text, claim_type, claim_status, confidence, effect, interval_json, p_value, q_value, sensitivity_json, limitations_json, source_row_ids_json, evidence_json, artifact_refs_json, ordinal, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET text=excluded.text, claim_type=excluded.claim_type, claim_status=excluded.claim_status, confidence=excluded.confidence,
       effect=excluded.effect, interval_json=excluded.interval_json, p_value=excluded.p_value, q_value=excluded.q_value,
       sensitivity_json=excluded.sensitivity_json, limitations_json=excluded.limitations_json,
       source_row_ids_json=excluded.source_row_ids_json, evidence_json=excluded.evidence_json, artifact_refs_json=excluded.artifact_refs_json, ordinal=excluded.ordinal`,
  ).run(input.id, input.runId, text, input.claimType ?? null, input.status, input.confidence ?? null,
    input.effect ?? null, intervalJson, input.pValue ?? null, input.qValue ?? null, sensitivityJson,
    boundedJson(limitations, 'Las limitaciones de la afirmación'), boundedJson(sourceRowIds, 'Las filas fuente'), evidenceJson,
    boundedJson(artifactRefs, 'Las referencias de artifacts'), input.ordinal, timestamp);
  return claimFromRow(db.prepare('SELECT * FROM database_research_claims WHERE id=?').get(input.id) as Row);
}

export const createDatabaseResearchClaim = saveDatabaseResearchClaim;
