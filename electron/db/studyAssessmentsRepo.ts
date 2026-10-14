import crypto from 'node:crypto';
import type { AppLanguage } from '@shared/types';
import type {
  StudyAssessment,
  StudyAssessmentInput,
  StudyAssessmentItem,
  StudyAttempt,
  StudyAttemptAnswer,
  StudyAttemptAnswerInput,
  StudyAttemptStartInput,
} from '@shared/studyAssessments';
import {
  DEFAULT_STUDY_ASSESSMENT_CONFIG,
  evaluateStudyQuestionResponse,
  seededShuffle,
} from '@shared/studyAssessments';
import { createStudyShortId, normalizeStudyName } from '@shared/studyOrg';
import { getDb } from './database';
import { getStudyQuestion } from './studyQuestionsRepo';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const bool = (value: unknown) => Number(value) === 1;
const json = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value)) as T; } catch { return fallback; } };
function ids(prefix: string) { const id = crypto.randomUUID(); return { id, shortId: createStudyShortId(prefix, id) }; }

function toItem(row: Row): StudyAssessmentItem | null {
  const question = getStudyQuestion(String(row.question_id));
  if (!question) return null;
  return {
    id: String(row.id), shortId: String(row.short_id), assessmentId: String(row.assessment_id), questionId: String(row.question_id),
    points: Number(row.points), required: bool(row.required), position: Number(row.position), question, createdAt: String(row.created_at),
  };
}

function listItems(assessmentId: string): StudyAssessmentItem[] {
  return (getDb().prepare('SELECT * FROM study_assessment_items WHERE assessment_id=? ORDER BY position').all(assessmentId) as Row[]).flatMap((row) => {
    const item = toItem(row); return item ? [item] : [];
  });
}

function toAssessment(row: Row): StudyAssessment {
  return {
    id: String(row.id), shortId: String(row.short_id), kind: String(row.kind) as StudyAssessment['kind'], title: String(row.title),
    description: String(row.description ?? ''), courseId: row.course_id ? String(row.course_id) : null, subjectId: row.subject_id ? String(row.subject_id) : null,
    topicId: row.topic_id ? String(row.topic_id) : null, config: { ...DEFAULT_STUDY_ASSESSMENT_CONFIG, ...json(row.config_json, {}) },
    rubricId: row.rubric_id ? String(row.rubric_id) : null, availableAt: row.available_at ? String(row.available_at) : null,
    durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes), maxAttempts: row.max_attempts == null ? null : Number(row.max_attempts),
    favorite: bool(row.favorite), archivedAt: row.archived_at ? String(row.archived_at) : null, items: listItems(String(row.id)),
    attemptCount: Number(row.attempt_count ?? 0), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function listStudyAssessments(kind: StudyAssessment['kind'] = 'test', includeArchived = false): StudyAssessment[] {
  const rows = getDb().prepare(`SELECT a.*, COUNT(t.id) AS attempt_count FROM study_assessments a LEFT JOIN study_attempts t ON t.assessment_id=a.id
    WHERE a.deleted_at IS NULL AND a.kind=? ${includeArchived ? '' : 'AND a.archived_at IS NULL'} GROUP BY a.id ORDER BY a.favorite DESC, a.updated_at DESC`).all(kind) as Row[];
  return rows.map(toAssessment);
}

export function getStudyAssessment(id: string): StudyAssessment | null {
  const row = getDb().prepare(`SELECT a.*, COUNT(t.id) AS attempt_count FROM study_assessments a LEFT JOIN study_attempts t ON t.assessment_id=a.id
    WHERE a.id=? AND a.deleted_at IS NULL GROUP BY a.id`).get(id) as Row | undefined;
  return row ? toAssessment(row) : null;
}

export function createStudyAssessment(input: StudyAssessmentInput): StudyAssessment {
  const questionIds = [...new Set(input.questionIds)];
  if (!questionIds.length) throw new Error('El test necesita al menos una pregunta.');
  const questions = questionIds.map((id) => getStudyQuestion(id));
  if (questions.some((question) => !question)) throw new Error('Alguna pregunta ya no está disponible.');
  const title = normalizeStudyName(input.title);
  if (!title) throw new Error('Escribe un título para el test.');
  const key = ids(input.kind === 'exam' ? 'EXA' : 'TST'); const timestamp = now(); const db = getDb();
  const config = { ...DEFAULT_STUDY_ASSESSMENT_CONFIG, ...input.config };
  db.transaction(() => {
    db.prepare(`INSERT INTO study_assessments (id, short_id, kind, title, description, course_id, subject_id, topic_id, config_json,
      duration_minutes, max_attempts, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      key.id, key.shortId, input.kind ?? 'test', title, input.description?.trim() ?? '', input.courseId ?? null, input.subjectId ?? null,
      input.topicId ?? null, JSON.stringify(config), input.durationMinutes ?? null, input.maxAttempts ?? null, input.favorite ? 1 : 0, timestamp, timestamp,
    );
    const insert = db.prepare(`INSERT INTO study_assessment_items (id, short_id, assessment_id, question_id, points, required, position, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`);
    questionIds.forEach((questionId, position) => { const item = ids('AIT'); insert.run(item.id, item.shortId, key.id, questionId, Math.max(0, input.points?.[questionId] ?? 1), position, timestamp); });
  })();
  return getStudyAssessment(key.id)!;
}

export function updateStudyAssessment(id: string, patch: Partial<Omit<StudyAssessmentInput, 'questionIds'>> & { archived?: boolean }): StudyAssessment {
  const current = getStudyAssessment(id); if (!current) throw new Error('Test no encontrado.');
  const timestamp = now(); const config = { ...current.config, ...(patch.config ?? {}) };
  getDb().prepare(`UPDATE study_assessments SET title=?, description=?, course_id=?, subject_id=?, topic_id=?, config_json=?, duration_minutes=?,
    max_attempts=?, favorite=?, archived_at=?, updated_at=? WHERE id=?`).run(
    patch.title == null ? current.title : normalizeStudyName(patch.title), patch.description ?? current.description, patch.courseId === undefined ? current.courseId : patch.courseId,
    patch.subjectId === undefined ? current.subjectId : patch.subjectId, patch.topicId === undefined ? current.topicId : patch.topicId, JSON.stringify(config),
    patch.durationMinutes === undefined ? current.durationMinutes : patch.durationMinutes, patch.maxAttempts === undefined ? current.maxAttempts : patch.maxAttempts,
    patch.favorite === undefined ? (current.favorite ? 1 : 0) : (patch.favorite ? 1 : 0), patch.archived === undefined ? current.archivedAt : (patch.archived ? timestamp : null), timestamp, id,
  );
  return getStudyAssessment(id)!;
}

export function deleteStudyAssessment(id: string): void { getDb().prepare('UPDATE study_assessments SET deleted_at=?, updated_at=? WHERE id=?').run(now(), now(), id); }

function toAnswer(row: Row): StudyAttemptAnswer {
  return {
    id: String(row.id), shortId: String(row.short_id), attemptId: String(row.attempt_id), assessmentItemId: String(row.assessment_item_id),
    questionId: String(row.question_id), response: json(row.response_json, {}), isCorrect: row.is_correct == null ? null : bool(row.is_correct),
    pointsAwarded: row.points_awarded == null ? null : Number(row.points_awarded), responseMs: Number(row.response_ms), flagged: bool(row.flagged),
    confidence: row.confidence == null ? null : Number(row.confidence), feedback: json(row.feedback_json, {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function toAttempt(row: Row, withAssessment = true): StudyAttempt {
  const attempt: StudyAttempt = {
    id: String(row.id), shortId: String(row.short_id), assessmentId: String(row.assessment_id), mode: String(row.mode) as StudyAttempt['mode'],
    status: String(row.status) as StudyAttempt['status'], score: row.score == null ? null : Number(row.score), maxScore: row.max_score == null ? null : Number(row.max_score),
    correctCount: Number(row.correct_count), incorrectCount: Number(row.incorrect_count), omittedCount: Number(row.omitted_count),
    durationSeconds: Number(row.duration_seconds), startedAt: String(row.started_at), submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    config: json(row.config_json, { questionOrder: [], optionOrder: {} }),
    answers: (getDb().prepare('SELECT * FROM study_attempt_answers WHERE attempt_id=? ORDER BY created_at').all(String(row.id)) as Row[]).map(toAnswer),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
  if (withAssessment) attempt.assessment = getStudyAssessment(attempt.assessmentId) ?? undefined;
  return attempt;
}

export function getStudyAttempt(id: string): StudyAttempt | null {
  const row = getDb().prepare('SELECT * FROM study_attempts WHERE id=?').get(id) as Row | undefined; return row ? toAttempt(row) : null;
}

export function getStudyAttemptAnswerContext(answerId: string) {
  const row = getDb().prepare('SELECT * FROM study_attempt_answers WHERE id=?').get(answerId) as Row | undefined;
  if (!row) return null;
  const answer = toAnswer(row); const attempt = getStudyAttempt(answer.attemptId);
  const item = attempt?.assessment?.items.find((candidate) => candidate.id === answer.assessmentItemId);
  return attempt && item ? { answer, attempt, assessment: attempt.assessment!, item, question: item.question } : null;
}

export function listStudyAttempts(assessmentId?: string): StudyAttempt[] {
  const rows = (assessmentId
    ? getDb().prepare('SELECT * FROM study_attempts WHERE assessment_id=? ORDER BY started_at DESC').all(assessmentId)
    : getDb().prepare('SELECT * FROM study_attempts ORDER BY started_at DESC LIMIT 200').all()) as Row[];
  return rows.map((row) => toAttempt(row));
}

export function startStudyAttempt(input: StudyAttemptStartInput): StudyAttempt {
  const assessment = getStudyAssessment(input.assessmentId); if (!assessment) throw new Error('Test no encontrado.');
  const attempts = listStudyAttempts(assessment.id);
  if (assessment.maxAttempts && attempts.filter((attempt) => attempt.status === 'submitted').length >= assessment.maxAttempts) throw new Error('Has alcanzado el máximo de intentos.');
  let items = [...assessment.items];
  const source = input.sourceAttemptId ? getStudyAttempt(input.sourceAttemptId) : null;
  if (source && input.retryKind === 'errors') {
    const ids = source.answers.filter((answer) => answer.isCorrect === false).map((answer) => answer.questionId); items = items.filter((item) => ids.includes(item.questionId));
  } else if (source && input.retryKind === 'flagged') {
    const ids = source.answers.filter((answer) => answer.flagged).map((answer) => answer.questionId); items = items.filter((item) => ids.includes(item.questionId));
  }
  if (!items.length) throw new Error('No hay preguntas para este reintento.');
  const seed = assessment.config.seed ?? Date.now();
  if (assessment.config.randomizeQuestions) items = seededShuffle(items, seed);
  const optionOrder: Record<string, string[]> = {};
  for (const item of items) optionOrder[item.id] = assessment.config.randomizeOptions ? seededShuffle(item.question.options.map((option) => option.id), seed + item.position + 1) : item.question.options.map((option) => option.id);
  const key = ids('ATT'); const timestamp = now();
  getDb().prepare(`INSERT INTO study_attempts (id, short_id, assessment_id, mode, status, started_at, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?, ?)`).run(key.id, key.shortId, assessment.id, input.mode, timestamp, JSON.stringify({ questionOrder: items.map((item) => item.id), optionOrder, retryKind: input.retryKind, sourceAttemptId: input.sourceAttemptId }), timestamp, timestamp);
  return getStudyAttempt(key.id)!;
}

export function saveStudyAttemptAnswer(attemptId: string, input: StudyAttemptAnswerInput): StudyAttemptAnswer {
  const attempt = getStudyAttempt(attemptId); if (!attempt || attempt.status !== 'in_progress') throw new Error('El intento ya no admite respuestas.');
  const item = attempt.assessment?.items.find((candidate) => candidate.id === input.assessmentItemId); if (!item) throw new Error('Pregunta no encontrada en el test.');
  const evaluation = evaluateStudyQuestionResponse(item.question, input.response, item.points, attempt.assessment!.config);
  const revealEvaluation = attempt.assessment!.config.correctionMode === 'immediate' && attempt.mode === 'practice';
  const timestamp = now(); const existing = attempt.answers.find((answer) => answer.assessmentItemId === item.id);
  if (existing) {
    getDb().prepare(`UPDATE study_attempt_answers SET response_json=?, response_ms=?, flagged=?, confidence=?, is_correct=?, points_awarded=?, feedback_json=?, updated_at=? WHERE id=?`).run(
      JSON.stringify(input.response), Math.max(0, input.responseMs ?? existing.responseMs), input.flagged ?? existing.flagged ? 1 : 0, input.confidence ?? existing.confidence,
      !revealEvaluation || evaluation.correct == null ? null : (evaluation.correct ? 1 : 0), revealEvaluation ? evaluation.pointsAwarded : null, JSON.stringify(revealEvaluation ? evaluation : {}), timestamp, existing.id,
    );
    getDb().prepare('UPDATE study_questions SET last_response=?, last_answered_at=?, updated_at=? WHERE id=?').run(String(input.response.text ?? ''), timestamp, timestamp, item.questionId);
    return toAnswer(getDb().prepare('SELECT * FROM study_attempt_answers WHERE id=?').get(existing.id) as Row);
  }
  const key = ids('ANS');
  getDb().prepare(`INSERT INTO study_attempt_answers (id, short_id, attempt_id, assessment_item_id, question_id, response_json, is_correct, points_awarded,
    response_ms, flagged, confidence, feedback_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    key.id, key.shortId, attempt.id, item.id, item.questionId, JSON.stringify(input.response), !revealEvaluation || evaluation.correct == null ? null : (evaluation.correct ? 1 : 0),
    revealEvaluation ? evaluation.pointsAwarded : null, Math.max(0, input.responseMs ?? 0), input.flagged ? 1 : 0, input.confidence ?? null, JSON.stringify(revealEvaluation ? evaluation : {}), timestamp, timestamp,
  );
  getDb().prepare('UPDATE study_questions SET last_response=?, last_answered_at=?, updated_at=? WHERE id=?').run(String(input.response.text ?? ''), timestamp, timestamp, item.questionId);
  return toAnswer(getDb().prepare('SELECT * FROM study_attempt_answers WHERE id=?').get(key.id) as Row);
}

export function submitStudyAttempt(id: string, expired = false): StudyAttempt {
  const attempt = getStudyAttempt(id); if (!attempt) throw new Error('Intento no encontrado.');
  if (attempt.status !== 'in_progress') return attempt;
  const assessment = attempt.assessment!; const answersByItem = new Map(attempt.answers.map((answer) => [answer.assessmentItemId, answer]));
  let score = 0; let maxScore = 0; let correct = 0; let incorrect = 0; let omitted = 0; const timestamp = now(); const db = getDb();
  db.transaction(() => {
    for (const itemId of attempt.config.questionOrder) {
      const item = assessment.items.find((candidate) => candidate.id === itemId); if (!item) continue;
      let answer = answersByItem.get(item.id);
      if (!answer) answer = saveStudyAttemptAnswer(id, { assessmentItemId: item.id, response: {} });
      const evaluation = evaluateStudyQuestionResponse(item.question, answer.response, item.points, assessment.config);
      const pointsAwarded = evaluation.gradable ? evaluation.pointsAwarded : answer.pointsAwarded;
      const feedback = evaluation.gradable ? evaluation : answer.feedback;
      maxScore += item.points; if (pointsAwarded != null) score += pointsAwarded;
      if (evaluation.omitted) omitted += 1; else if (evaluation.correct === true) correct += 1; else if (evaluation.correct === false) incorrect += 1;
      db.prepare('UPDATE study_attempt_answers SET is_correct=?, points_awarded=?, feedback_json=?, updated_at=? WHERE id=?').run(
        evaluation.correct == null ? null : (evaluation.correct ? 1 : 0), pointsAwarded, JSON.stringify(feedback), timestamp, answer.id,
      );
      db.prepare(`UPDATE study_questions SET usage_count=usage_count+1, correct_count=correct_count+?, incorrect_count=incorrect_count+?, omitted_count=omitted_count+?,
        total_response_ms=total_response_ms+?, updated_at=? WHERE id=?`).run(evaluation.correct === true ? 1 : 0, !evaluation.omitted && evaluation.correct === false ? 1 : 0, evaluation.omitted ? 1 : 0, answer.responseMs, timestamp, item.questionId);
    }
    const duration = Math.max(0, Math.round((Date.parse(timestamp) - Date.parse(attempt.startedAt)) / 1000));
    db.prepare(`UPDATE study_attempts SET status=?, score=?, max_score=?, correct_count=?, incorrect_count=?, omitted_count=?, duration_seconds=?, submitted_at=?, updated_at=? WHERE id=?`).run(
      expired ? 'expired' : 'submitted', score, maxScore, correct, incorrect, omitted, duration, timestamp, timestamp, id,
    );
  })();
  return getStudyAttempt(id)!;
}

export function abandonStudyAttempt(id: string): StudyAttempt {
  getDb().prepare("UPDATE study_attempts SET status='abandoned', updated_at=? WHERE id=? AND status='in_progress'").run(now(), id); return getStudyAttempt(id)!;
}

/** Headings of an exported test, in the interface language of whoever exports it. */
const ASSESSMENT_EXPORT_LABELS: Record<AppLanguage, { duration: string; noLimit: string; answer: string; source: string }> = {
  es: { duration: 'Duración', noLimit: 'sin límite', answer: 'Respuesta', source: 'Fuente' },
  en: { duration: 'Duration', noLimit: 'no limit', answer: 'Answer', source: 'Source' },
  fr: { duration: 'Durée', noLimit: 'sans limite', answer: 'Réponse', source: 'Source' },
  de: { duration: 'Dauer', noLimit: 'unbegrenzt', answer: 'Antwort', source: 'Quelle' },
  pt: { duration: 'Duração', noLimit: 'sem limite', answer: 'Resposta', source: 'Fonte' },
  'pt-BR': { duration: 'Duração', noLimit: 'sem limite', answer: 'Resposta', source: 'Fonte' },
  it: { duration: 'Durata', noLimit: 'senza limite', answer: 'Risposta', source: 'Fonte' },
  tr: { duration: 'Süre', noLimit: 'sınırsız', answer: 'Yanıt', source: 'Kaynak' },
  'zh-CN': { duration: '时长', noLimit: '不限时', answer: '答案', source: '来源' },
  'zh-TW': { duration: '時長', noLimit: '不限時', answer: '答案', source: '來源' },
  ja: { duration: '所要時間', noLimit: '制限なし', answer: '解答', source: '出典' },
  ko: { duration: '시간', noLimit: '제한 없음', answer: '정답', source: '출처' },
};

export function renderStudyAssessmentMarkdown(assessment: StudyAssessment, includeAnswers = false, language: AppLanguage = 'es'): string {
  const labels = ASSESSMENT_EXPORT_LABELS[language] ?? ASSESSMENT_EXPORT_LABELS.en;
  const lines = [`# ${assessment.title}`, '', assessment.description, '', `${labels.duration}: ${assessment.durationMinutes ?? labels.noLimit} min`, ''];
  assessment.items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.question.prompt} (${item.points} pt)`, '');
    if (item.question.options.length) item.question.options.forEach((option) => lines.push(`- [ ] ${option.text}`));
    else lines.push('________________________________________________________________');
    lines.push('');
    if (includeAnswers) lines.push(`**${labels.answer}:** ${item.question.answer.text ?? String(item.question.answer.value ?? '')}`, `**${labels.source}:** ${item.question.source.title} — ${item.question.source.excerpt}`, '');
  });
  return lines.join('\n');
}
