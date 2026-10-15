import crypto from 'node:crypto';
import type {
  StudyGradingAnnotation,
  StudyGradingResult,
  StudyGradingRun,
  StudyGradingSeverity,
  StudyGradingSource,
  StudyRubric,
  StudyRubricInput,
} from '@shared/studyGrading';
import { normalizeStudyRubricCriteria } from '@shared/studyGrading';
import type { ModelRef } from '@shared/types';
import { createStudyShortId, normalizeStudyName } from '@shared/studyOrg';
import { getDb } from './database';
import { getStudyAttemptAnswerContext } from './studyAssessmentsRepo';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const bool = (value: unknown) => Number(value) === 1;
const json = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value)) as T; } catch { return fallback; } };
function ids(prefix: string) { const id = crypto.randomUUID(); return { id, shortId: createStudyShortId(prefix, id) }; }

const BUILT_INS: StudyRubricInput[] = [
  { name: 'Respuesta de desarrollo', description: 'Evalúa dominio, argumentación, evidencia y claridad.', locked: true, criteria: [
    { id: 'accuracy', label: 'Dominio conceptual', description: 'Exactitud y comprensión de los conceptos solicitados.', weight: 0.4 },
    { id: 'argument', label: 'Argumentación', description: 'Coherencia de la tesis, relaciones y justificación.', weight: 0.25 },
    { id: 'evidence', label: 'Uso de fuentes', description: 'Uso fiel y pertinente de la evidencia disponible.', weight: 0.2 },
    { id: 'clarity', label: 'Claridad', description: 'Estructura, precisión expresiva y legibilidad.', weight: 0.15 },
  ] },
  { name: 'Comentario de texto', description: 'Prioriza contextualización y análisis crítico del fragmento.', locked: true, criteria: [
    { id: 'context', label: 'Contextualización', description: 'Sitúa correctamente el fragmento sin añadir datos no respaldados.', weight: 0.25 },
    { id: 'analysis', label: 'Análisis', description: 'Identifica y explica las ideas relevantes del fragmento.', weight: 0.35 },
    { id: 'argument', label: 'Valoración razonada', description: 'Construye una interpretación justificada.', weight: 0.25 },
    { id: 'clarity', label: 'Claridad', description: 'Organización y precisión de la respuesta.', weight: 0.15 },
  ] },
];

function toRubric(row: Row): StudyRubric {
  return { id: String(row.id), shortId: String(row.short_id), name: String(row.name), description: String(row.description ?? ''), criteria: json(row.criteria_json, []), builtIn: bool(row.built_in), favorite: bool(row.favorite), locked: bool(row.locked), archivedAt: row.archived_at ? String(row.archived_at) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function ensureBuiltIns() {
  const db = getDb(); const timestamp = now(); const insert = db.prepare(`INSERT INTO study_rubrics (id, short_id, name, description, criteria_json, built_in, locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`);
  for (const input of BUILT_INS) if (!db.prepare('SELECT 1 FROM study_rubrics WHERE name=? AND built_in=1').get(input.name)) { const key = ids('RUB'); insert.run(key.id, key.shortId, input.name, input.description, JSON.stringify(normalizeStudyRubricCriteria(input.criteria)), timestamp, timestamp); }
}

export function listStudyRubrics(includeArchived = false): StudyRubric[] {
  ensureBuiltIns(); return (getDb().prepare(`SELECT * FROM study_rubrics ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY favorite DESC, built_in DESC, name`).all() as Row[]).map(toRubric);
}

export function getStoredStudyRubric(id: string): StudyRubric | null { const row = getDb().prepare('SELECT * FROM study_rubrics WHERE id=?').get(id) as Row | undefined; return row ? toRubric(row) : null; }
export function getStudyRubric(id: string): StudyRubric | null { ensureBuiltIns(); return getStoredStudyRubric(id); }

export function createStudyRubric(input: StudyRubricInput, builtIn = false): StudyRubric {
  const key = ids('RUB'); const timestamp = now(); const criteria = normalizeStudyRubricCriteria(input.criteria); const name = normalizeStudyName(input.name);
  if (!name) throw new Error('Escribe un nombre para la rúbrica.');
  getDb().prepare(`INSERT INTO study_rubrics (id, short_id, name, description, criteria_json, built_in, favorite, locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(key.id, key.shortId, name, input.description?.trim() ?? '', JSON.stringify(criteria), builtIn ? 1 : 0, input.favorite ? 1 : 0, input.locked ? 1 : 0, timestamp, timestamp);
  return getStudyRubric(key.id)!;
}

export function updateStudyRubric(id: string, patch: Partial<StudyRubricInput> & { archived?: boolean }): StudyRubric {
  const current = getStudyRubric(id); if (!current) throw new Error('Rúbrica no encontrada.');
  if ((current.builtIn || current.locked) && (patch.name || patch.description || patch.criteria)) throw new Error('Duplica la rúbrica protegida antes de editarla.');
  const timestamp = now(); const criteria = patch.criteria ? normalizeStudyRubricCriteria(patch.criteria) : current.criteria;
  getDb().prepare('UPDATE study_rubrics SET name=?, description=?, criteria_json=?, favorite=?, locked=?, archived_at=?, updated_at=? WHERE id=?').run(patch.name == null ? current.name : normalizeStudyName(patch.name), patch.description ?? current.description, JSON.stringify(criteria), patch.favorite === undefined ? (current.favorite ? 1 : 0) : (patch.favorite ? 1 : 0), patch.locked === undefined ? (current.locked ? 1 : 0) : (patch.locked ? 1 : 0), patch.archived === undefined ? current.archivedAt : (patch.archived ? timestamp : null), timestamp, id);
  return getStudyRubric(id)!;
}

export function duplicateStudyRubric(id: string): StudyRubric { const current = getStudyRubric(id); if (!current) throw new Error('Rúbrica no encontrada.'); return createStudyRubric({ name: `${current.name} · copia`, description: current.description, criteria: current.criteria }); }
export function deleteStudyRubric(id: string): void { const current = getStudyRubric(id); if (!current) return; if (current.builtIn) throw new Error('Las rúbricas integradas no se pueden eliminar.'); getDb().prepare('DELETE FROM study_rubrics WHERE id=?').run(id); }

function toAnnotation(row: Row): StudyGradingAnnotation {
  return { id: String(row.id), shortId: String(row.short_id), gradingRunId: String(row.grading_run_id), from: Number(row.from_pos), to: Number(row.to_pos), kind: String(row.kind) as StudyGradingAnnotation['kind'], severity: String(row.severity) as StudyGradingAnnotation['severity'], message: String(row.message), suggestion: row.suggestion ? String(row.suggestion) : undefined, createdAt: String(row.created_at) };
}

function toRun(row: Row): StudyGradingRun {
  return { id: String(row.id), shortId: String(row.short_id), attemptAnswerId: String(row.attempt_answer_id), rubricId: row.rubric_id ? String(row.rubric_id) : null, severity: String(row.severity) as StudyGradingSeverity, model: { provider: String(row.model_provider), model: String(row.model_name) } as ModelRef, sources: json(row.sources_json, []), result: json(row.result_json, {} as StudyGradingResult), estimatedScore: row.estimated_score == null ? null : Number(row.estimated_score), manualScore: row.manual_score == null ? null : Number(row.manual_score), manualComment: String(row.manual_comment ?? ''), annotations: (getDb().prepare('SELECT * FROM study_grading_annotations WHERE grading_run_id=? ORDER BY from_pos').all(String(row.id)) as Row[]).map(toAnnotation), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function saveStudyGradingRun(input: { attemptAnswerId: string; rubricId: string | null; severity: StudyGradingSeverity; model: ModelRef; sources: StudyGradingSource[]; result: StudyGradingResult }): StudyGradingRun {
  const context = getStudyAttemptAnswerContext(input.attemptAnswerId); if (!context) throw new Error('Respuesta no encontrada.');
  const key = ids('GRD'); const timestamp = now(); const db = getDb();
  db.transaction(() => {
    db.prepare(`INSERT INTO study_grading_runs (id, short_id, attempt_answer_id, rubric_id, severity, model_provider, model_name, sources_json, result_json, estimated_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(key.id, key.shortId, input.attemptAnswerId, input.rubricId, input.severity, input.model.provider, input.model.model, JSON.stringify(input.sources), JSON.stringify(input.result), input.result.estimatedScore, timestamp, timestamp);
    const insert = db.prepare(`INSERT INTO study_grading_annotations (id, short_id, grading_run_id, from_pos, to_pos, kind, severity, message, suggestion, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const annotation of input.result.annotations) { const annotationId = ids('GAN'); insert.run(annotationId.id, annotationId.shortId, key.id, annotation.from, annotation.to, annotation.kind, annotation.severity, annotation.message, annotation.suggestion ?? null, timestamp); }
    db.prepare('UPDATE study_questions SET last_score=?, last_max_score=?, last_feedback=?, last_answered_at=?, updated_at=? WHERE id=?')
      .run(input.result.estimatedScore, input.result.maxScore, input.result.generalFeedback, timestamp, timestamp, context.question.id);
  })();
  return getStudyGradingRun(key.id)!;
}

export function getStudyGradingRun(id: string): StudyGradingRun | null { const row = getDb().prepare('SELECT * FROM study_grading_runs WHERE id=?').get(id) as Row | undefined; return row ? toRun(row) : null; }
export function listStudyGradingRuns(attemptAnswerId?: string): StudyGradingRun[] { const rows = (attemptAnswerId ? getDb().prepare('SELECT * FROM study_grading_runs WHERE attempt_answer_id=? ORDER BY created_at DESC').all(attemptAnswerId) : getDb().prepare('SELECT * FROM study_grading_runs ORDER BY created_at DESC LIMIT 200').all()) as Row[]; return rows.map(toRun); }

export function setStudyGradingManualScore(id: string, score: number, comment = ''): StudyGradingRun {
  const run = getStudyGradingRun(id); if (!run) throw new Error('Corrección no encontrada.'); const context = getStudyAttemptAnswerContext(run.attemptAnswerId); if (!context) throw new Error('Respuesta no encontrada.');
  const clean = Math.min(context.item.points, Math.max(0, Number(score))); const timestamp = now(); const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE study_grading_runs SET manual_score=?, manual_comment=?, updated_at=? WHERE id=?').run(clean, comment.trim(), timestamp, id);
    db.prepare('UPDATE study_attempt_answers SET points_awarded=?, feedback_json=?, updated_at=? WHERE id=?').run(clean, JSON.stringify({ ...context.answer.feedback, gradingRunId: id, manualScore: clean, manualComment: comment.trim() }), timestamp, context.answer.id);
    const total = Number((db.prepare('SELECT COALESCE(SUM(points_awarded), 0) AS value FROM study_attempt_answers WHERE attempt_id=?').get(context.attempt.id) as Row).value);
    db.prepare('UPDATE study_attempts SET score=?, updated_at=? WHERE id=?').run(total, timestamp, context.attempt.id);
  })();
  return getStudyGradingRun(id)!;
}
