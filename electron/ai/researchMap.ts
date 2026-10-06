import type {
  ModelRef,
  PromptLanguage,
  ResearchQuestionDetail,
  RqCoverageLink,
  RqCoverageStatus,
  RqDecomposeRequest,
  RqMapProgress,
  RqMapRequest,
} from '@shared/types';
import { getDb } from '../db/database';
import { findSimilarIdeas } from '../db/ideasRepo';
import { completeJson, embedQuery } from './aiClient';
import { coreStructuredPrompt } from './prompts';
import { getSettings } from '../db/settingsRepo';
import * as repo from '../db/researchMapRepo';

const SEM_THRESHOLD = 0.3;
const MAX_CANDIDATES = 14;
const MAX_WORKS_PER_IDEA = 5;

// ─── helpers (lightweight lexical fallback when no embeddings are available) ──

const STOP_WORDS = new Set([
  'para','con','los','las','del','una','uno','que','como','por','sobre','entre','este','esta',
  'estos','estas','cual','cuales','tiene','tienen','ser','son','the','and','for','with','that',
  'this','from','into','about','what','which','have','has','been','their','your','sus','más','muy',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3 && !STOP_WORDS.has(token))
  );
}

function relevance(tokens: Set<string>, text: string): number {
  if (tokens.size === 0) return 0;
  const hay = tokenize(text);
  let hits = 0;
  for (const token of tokens) if (hay.has(token)) hits += 1;
  return hits / Math.max(4, tokens.size);
}

function clip(value: string, max: number): string {
  const clean = (value || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

function parseAuthors(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

function authorYear(authors: string[], year: number | null, language: PromptLanguage = 'es'): string {
  const raw = authors[0]?.replace(/\s+/g, ' ').trim();
  const surname = raw ? (raw.includes(',') ? raw.slice(0, raw.indexOf(',')) : raw.split(' ').slice(-1)[0]).trim() : ({ es: 'Autor', en: 'Author', fr: 'Auteur', de: 'Autor', pt: 'Autor', 'pt-BR': 'Autor', it: 'Autore', tr: 'Yazar', 'zh-Hans': '作者', 'zh-Hant': '作者', vi: 'Tác giả', ja: '著者', ru: 'Автор', uk: 'Автор', ko: '저자' } as Record<PromptLanguage, string>)[language];
  return year ? `${surname}, ${year}` : surname;
}

// ─── candidate retrieval ─────────────────────────────────────────────────────

interface IdeaWorkInfo {
  nodus_id: string;
  title: string;
  authors: string[];
  year: number | null;
  read: boolean;
}

interface IdeaCandidate {
  id: string;
  label: string;
  statement: string;
  themes: string[];
  works: IdeaWorkInfo[];
  evidenceSample: string | null;
  read: boolean;
  score: number;
}

interface IdeaLexRow {
  global_id: string;
  label: string;
  statement: string;
}

function ideaContext(globalId: string, score: number): IdeaCandidate | null {
  const db = getDb();
  const idea = db
    .prepare('SELECT global_id, label, statement FROM ideas WHERE global_id = ?')
    .get(globalId) as IdeaLexRow | undefined;
  if (!idea) return null;

  const themeRows = db
    .prepare(
      'SELECT t.label AS label FROM idea_theme_links l JOIN themes t ON t.theme_id = l.theme_id WHERE l.global_id = ?'
    )
    .all(globalId) as { label: string }[];

  const workRows = db
    .prepare(
      `SELECT w.nodus_id, w.title, w.authors_json, w.year, w.read_tag, w.deep_status
         FROM idea_occurrences io
         JOIN works w ON w.nodus_id = io.nodus_id
        WHERE io.global_id = ?
        ORDER BY io.role = 'principal' DESC, io.confidence DESC, w.year DESC
        LIMIT ?`
    )
    .all(globalId, MAX_WORKS_PER_IDEA) as {
    nodus_id: string;
    title: string;
    authors_json: string;
    year: number | null;
    read_tag: number;
    deep_status: string;
  }[];

  const works: IdeaWorkInfo[] = workRows.map((w) => ({
    nodus_id: w.nodus_id,
    title: w.title,
    authors: parseAuthors(w.authors_json),
    year: w.year,
    read: w.read_tag === 1 || w.deep_status === 'done',
  }));

  const evidence = db
    .prepare('SELECT quote FROM evidence WHERE global_id = ? LIMIT 1')
    .get(globalId) as { quote: string } | undefined;

  return {
    id: idea.global_id,
    label: idea.label,
    statement: idea.statement,
    themes: themeRows.map((t) => t.label),
    works,
    evidenceSample: evidence ? clip(evidence.quote, 240) : null,
    read: works.some((w) => w.read),
    score,
  };
}

/** Top candidate ideas for a sub-question: semantic if embeddings exist, else lexical. */
async function retrieveCandidates(text: string, lexRows: IdeaLexRow[]): Promise<IdeaCandidate[]> {
  const emb = await embedQuery(text);
  if (emb) {
    const hits = findSimilarIdeas(emb, SEM_THRESHOLD, MAX_CANDIDATES);
    if (hits.length > 0) {
      return hits
        .map((h) => ideaContext(h.global_id, h.similarity))
        .filter((c): c is IdeaCandidate => c !== null);
    }
  }
  const tokens = tokenize(text);
  return lexRows
    .map((row) => ({ row, score: relevance(tokens, `${row.label} ${row.statement}`) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map((r) => ideaContext(r.row.global_id, r.score))
    .filter((c): c is IdeaCandidate => c !== null);
}

interface DisputeEdge {
  edgeId: string;
  fromId: string;
  toId: string;
  label: string;
}

function disputesAmong(ids: string[], language: PromptLanguage = 'es'): DisputeEdge[] {
  if (ids.length < 2) return [];
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, from_id, to_id, type FROM visible_edges
        WHERE type IN ('contradicts','refutes')
          AND from_id IN (${placeholders}) AND to_id IN (${placeholders})`
    )
    .all(...ids, ...ids) as { id: string; from_id: string; to_id: string; type: string }[];
  return rows.map((r) => ({
    edgeId: r.id,
    fromId: r.from_id,
    toId: r.to_id,
    label: r.type === 'refutes'
      ? ({ es: 'refutación', en: 'refutation', fr: 'réfutation', de: 'Widerlegung', pt: 'refutação', 'pt-BR': 'refutação', it: 'confutazione', tr: 'çürütme', 'zh-Hans': '反驳', 'zh-Hant': '反駁', vi: 'phản bác', ja: '反証', ru: 'опровержение', uk: 'спростування', ko: '반박' } as Record<PromptLanguage, string>)[language]
      : ({ es: 'contradicción', en: 'contradiction', fr: 'contradiction', de: 'Widerspruch', pt: 'contradição', 'pt-BR': 'contradição', it: 'contraddizione', tr: 'çelişki', 'zh-Hans': '矛盾', 'zh-Hant': '矛盾', vi: 'mâu thuẫn', ja: '矛盾', ru: 'противоречие', uk: 'суперечність', ko: '모순' } as Record<PromptLanguage, string>)[language],
  }));
}

// ─── AI calls ────────────────────────────────────────────────────────────────

interface AiDecomposition {
  subQuestions: { text: string; rationale?: string }[];
}
function isAiDecomposition(value: unknown): value is AiDecomposition {
  if (!value || typeof value !== 'object') return false;
  const arr = (value as AiDecomposition).subQuestions;
  return Array.isArray(arr) && arr.every((s) => s && typeof s.text === 'string');
}

interface AiCoverage {
  status: RqCoverageStatus;
  justification: string;
  ideaIds: string[];
}
function isAiCoverage(value: unknown): value is AiCoverage {
  if (!value || typeof value !== 'object') return false;
  const v = value as AiCoverage;
  return (
    ['covered', 'partial', 'uncovered', 'disputed'].includes(v.status) &&
    typeof v.justification === 'string' &&
    Array.isArray(v.ideaIds) &&
    v.ideaIds.every((id) => typeof id === 'string')
  );
}

export async function decomposeQuestion(request: RqDecomposeRequest): Promise<ResearchQuestionDetail> {
  const rq = repo.getResearchQuestion(request.rqId);
  const language = getSettings().promptLanguage ?? 'es';
  if (!rq) throw new Error(localizedMapText(language, { es: 'No se encontró la pregunta de investigación.', en: 'The research question was not found.', fr: 'La question de recherche est introuvable.', de: 'Die Forschungsfrage wurde nicht gefunden.', pt: 'A pergunta de investigação não foi encontrada.', 'pt-BR': 'A pergunta de pesquisa não foi encontrada.', it: 'La domanda di ricerca non è stata trovata.', tr: 'Araştırma sorusu bulunamadı.', 'zh-Hans': '未找到研究问题。', 'zh-Hant': '找不到研究問題。', vi: 'Không tìm thấy câu hỏi nghiên cứu.', ja: '研究課題が見つかりませんでした。', ru: 'Исследовательский вопрос не найден.', uk: 'Дослідницьке питання не знайдено.', ko: '연구 질문을 찾을 수 없습니다.' }));

  const user = JSON.stringify({ pregunta: rq.question, notas: rq.notes ?? '' }, null, 2);
  const ai = await completeJson<AiDecomposition>(
    { system: coreStructuredPrompt('rqDecompose', getSettings().promptLanguage ?? 'es'), user, temperature: 0.2, maxTokens: 1600 },
    isAiDecomposition,
    request.model
  );

  repo.replaceSubQuestions(
    request.rqId,
    ai.subQuestions
      .map((s) => ({ text: s.text.trim(), rationale: s.rationale?.trim() || null }))
      .filter((s) => s.text.length > 0)
  );
  repo.updateRqModel(request.rqId, request.model ?? null);
  repo.setRqStatus(request.rqId, 'decomposed');
  return repo.getResearchQuestionDetail(request.rqId)!;
}

export async function mapCoverage(
  request: RqMapRequest,
  onProgress?: (p: RqMapProgress) => void
): Promise<ResearchQuestionDetail> {
  const rq = repo.getResearchQuestion(request.rqId);
  const language = getSettings().promptLanguage ?? 'es';
  if (!rq) throw new Error(localizedMapText(language, { es: 'No se encontró la pregunta de investigación.', en: 'The research question was not found.', fr: 'La question de recherche est introuvable.', de: 'Die Forschungsfrage wurde nicht gefunden.', pt: 'A pergunta de investigação não foi encontrada.', 'pt-BR': 'A pergunta de pesquisa não foi encontrada.', it: 'La domanda di ricerca non è stata trovata.', tr: 'Araştırma sorusu bulunamadı.', 'zh-Hans': '未找到研究问题。', 'zh-Hant': '找不到研究問題。', vi: 'Không tìm thấy câu hỏi nghiên cứu.', ja: '研究課題が見つかりませんでした。', ru: 'Исследовательский вопрос не найден.', uk: 'Дослідницьке питання не знайдено.', ko: '연구 질문을 찾을 수 없습니다.' }));
  const subs = repo.getSubQuestionRows(request.rqId);

  // Load lightweight idea rows once for the lexical fallback path.
  const lexRows = getDb()
    .prepare('SELECT global_id, label, statement FROM ideas')
    .all() as IdeaLexRow[];

  const total = subs.length;
  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i];
    onProgress?.({ index: i, total, phase: 'retrieving', subQuestion: sub.text });

    const candidates = await retrieveCandidates(sub.text, lexRows);
    const candidateById = new Map(candidates.map((c) => [c.id, c]));

    onProgress?.({ index: i, total, phase: 'classifying', subQuestion: sub.text });

    let coverage: AiCoverage;
    if (candidates.length === 0) {
      coverage = { status: 'uncovered', justification: localizedMapText(language, { es: 'La biblioteca no contiene ideas que aborden esta sub-pregunta.', en: 'The library contains no ideas that address this sub-question.', fr: 'La bibliothèque ne contient aucune idée répondant à cette sous-question.', de: 'Die Bibliothek enthält keine Ideen, die diese Unterfrage behandeln.', pt: 'A biblioteca não contém ideias que abordem esta subquestão.', 'pt-BR': 'A biblioteca não contém ideias que abordem esta subpergunta.', it: 'La biblioteca non contiene idee che affrontino questa sotto-domanda.', tr: 'Kütüphanede bu alt soruyu ele alan fikir bulunmuyor.', 'zh-Hans': '文献库中没有涉及该子问题的观点。', 'zh-Hant': '文獻庫中沒有涉及此子問題的觀點。', vi: 'Thư viện không có ý tưởng nào giải quyết tiểu câu hỏi này.', ja: 'ライブラリには、この小問に取り組むアイデアが含まれていません。', ru: 'Библиотека не содержит идей, отвечающих на этот подвопрос.', uk: 'Бібліотека не містить ідей, які відповідають на це підпитання.', ko: '라이브러리에 이 하위 질문을 다루는 아이디어가 없습니다.' }), ideaIds: [] };
    } else {
      const disputesAll = disputesAmong(candidates.map((c) => c.id), language);
      const payload = {
        subPregunta: sub.text,
        ideasCandidatas: candidates.map((c) => ({
          id: c.id,
          etiqueta: c.label,
          enunciado: clip(c.statement, 400),
          temas: c.themes,
          numObras: c.works.length,
          soporteEnObrasLeidas: c.read,
          citaMuestra: c.evidenceSample,
        })),
        paresEnContradiccion: disputesAll.map((d) => ({ a: d.fromId, b: d.toId })),
      };
      try {
        coverage = await completeJson<AiCoverage>(
          { system: coreStructuredPrompt('rqCoverage', getSettings().promptLanguage ?? 'es'), user: JSON.stringify(payload, null, 2), temperature: 0.15, maxTokens: 900 },
          isAiCoverage,
          request.model
        );
      } catch {
        // Fall back to a conservative data-only verdict if the model call fails.
        coverage = {
          status: candidates.length >= 2 ? 'partial' : 'uncovered',
          justification: localizedMapText(language, { es: 'Clasificación automática no disponible; veredicto provisional por recuperación.', en: 'Automatic classification unavailable; provisional verdict based on retrieval.', fr: 'Classification automatique indisponible ; verdict provisoire fondé sur la récupération.', de: 'Automatische Klassifizierung nicht verfügbar; vorläufiges Urteil auf Grundlage des Abrufs.', pt: 'Classificação automática indisponível; veredito provisório baseado na recuperação.', 'pt-BR': 'Classificação automática indisponível; veredito provisório baseado na recuperação.', it: 'Classificazione automatica non disponibile; verdetto provvisorio basato sul recupero.', tr: 'Otomatik sınıflandırma kullanılamıyor; getirmeye dayalı geçici karar.', 'zh-Hans': '自动分类不可用；基于检索的临时判定。', 'zh-Hant': '自動分類無法使用；依據檢索的暫定判定。', vi: 'Phân loại tự động không khả dụng; phán quyết tạm thời dựa trên truy xuất.', ja: '自動分類は利用できません。検索結果に基づく暫定的な判定です。', ru: 'Автоматическая классификация недоступна; предварительное заключение на основе поиска.', uk: 'Автоматична класифікація недоступна; попередній висновок на основі пошуку.', ko: '자동 분류를 사용할 수 없습니다. 검색 결과에 기반한 잠정 판정입니다.' }),
          ideaIds: candidates.slice(0, 4).map((c) => c.id),
        };
      }
    }

    // Enforce the closed set: drop any hallucinated ids.
    const chosenIds = coverage.ideaIds.filter((id) => candidateById.has(id));
    let status = chosenIds.length === 0 ? 'uncovered' : coverage.status;

    // Build links from real data.
    const links: Omit<RqCoverageLink, 'id'>[] = [];
    const seenWorks = new Set<string>();
    for (const id of chosenIds) {
      const c = candidateById.get(id)!;
      links.push({
        kind: 'idea',
        refId: id,
        label: clip(c.label, 90),
        score: Number(c.score.toFixed(3)),
        readState: c.read ? 'read' : 'unread',
      });
      for (const w of c.works) {
        if (seenWorks.has(w.nodus_id)) continue;
        seenWorks.add(w.nodus_id);
        links.push({
          kind: 'work',
          refId: w.nodus_id,
        label: `${authorYear(w.authors, w.year, language)} — ${clip(w.title, 80)}`,
          score: null,
          readState: w.read ? 'read' : 'unread',
        });
      }
    }

    // Data-driven dispute cross-link: if chosen ideas contradict each other, surface it.
    const disputes = disputesAmong(chosenIds, language);
    for (const d of disputes) {
      links.push({ kind: 'debate', refId: d.edgeId, label: d.label, score: null, readState: null });
    }
    if (disputes.length > 0 && (status === 'covered' || status === 'partial')) {
      status = 'disputed';
    }

    repo.setSubQuestionCoverage(sub.id, status as RqCoverageStatus, coverage.justification.trim(), links);
    onProgress?.({ index: i, total, phase: 'done', subQuestion: sub.text });
  }

  repo.setRqMapped(request.rqId);
  repo.updateRqModel(request.rqId, request.model ?? (rq.model as ModelRef | null) ?? null);
  return repo.getResearchQuestionDetail(request.rqId)!;
}

function localizedMapText(language: PromptLanguage, values: Record<PromptLanguage, string>): string {
  return values[language] ?? values.es;
}
