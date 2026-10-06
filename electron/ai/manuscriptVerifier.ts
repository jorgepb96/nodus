import type {
  PromptLanguage,
  ApplyManuscriptCitationRequest,
  ApplyManuscriptCitationResult,
  ManuscriptClaimCheck,
  ManuscriptClaimSeverity,
  ManuscriptClaimStatus,
  ManuscriptEvidenceCandidate,
  ManuscriptVerificationRequest,
  ManuscriptVerificationResult,
} from '@shared/types';
import {
  classifyClaimLocally,
  extractManuscriptClaims,
  insertCitationIntoDraft,
  summarizeChecks,
  tokenizeForMatch,
  type ExtractedManuscriptClaim,
} from '../../shared/manuscriptVerifier';
import { completeJson, embedQuery } from './aiClient';
import { manuscriptVerifierPrompt } from '@shared/manuscriptVerifierPromptPacks';
import { normalizePromptLanguage } from '@shared/promptLanguageOptions';
import { getSettings } from '../db/settingsRepo';
import { allIdeaCandidates, findSimilarIdeas } from '../db/ideasRepo';
import { findSimilarPassages } from '../db/passagesRepo';
import { getChapter, updateChapterMarkdown } from '../db/projectsRepo';

const DEFAULT_MAX_CLAIMS = 80;
const SEMANTIC_IDEA_THRESHOLD = 0.3;
const SEMANTIC_PASSAGE_THRESHOLD = 0.28;
const LEXICAL_IDEA_THRESHOLD = 0.18;
const MAX_EVIDENCE_PER_CLAIM = 6;
const AI_BATCH_SIZE = 8;

interface IndexedIdeaCandidate {
  global_id: string;
  type: string;
  label: string;
  statement: string;
  tokens: Set<string>;
}

interface AiClaimReview {
  id?: string;
  status?: string;
  severity?: string;
  rationale?: string;
  evidenceIds?: string[];
  replacementHint?: string | null;
}

interface AiReviewResponse {
  claims: AiClaimReview[];
}

function isAiReviewResponse(value: unknown): value is AiReviewResponse {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as AiReviewResponse).claims));
}

export async function verifyManuscriptCitations(
  request: ManuscriptVerificationRequest
): Promise<ManuscriptVerificationResult> {
  const chapter = getChapter(request.chapterId);
  const generatedAt = new Date().toISOString();
  const language = request.language ?? getSettings().uiLanguage ?? 'es';
  // The local rationales and warning copy are UI copy; the verifier prompt pack and the
  // warning table are keyed by prompt language, so zh-CN normalizes to zh-Hans there.
  const promptLanguage = normalizePromptLanguage(language);
  const warnings: string[] = [];
  if (!chapter?.currentMarkdown.trim()) {
    return {
      chapterId: request.chapterId,
      generatedAt,
      available: false,
      aiReviewed: false,
      summary: summarizeChecks([], 0),
      claims: [],
      warnings: [warn(promptLanguage, 'empty')],
    };
  }

  const maxClaims = Math.max(1, Math.min(160, request.maxClaims ?? DEFAULT_MAX_CLAIMS));
  const claims = extractManuscriptClaims(chapter.currentMarkdown, maxClaims);
  if (claims.length === 0) {
    return {
      chapterId: request.chapterId,
      generatedAt,
      available: false,
      aiReviewed: false,
      summary: summarizeChecks([], 0),
      claims: [],
      warnings: [warn(promptLanguage, 'noClaims')],
    };
  }

  const ideas = allIdeaCandidates();
  if (ideas.length === 0) warnings.push(warn(promptLanguage, 'noIdeas'));
  const indexedIdeas = ideas.map((idea) => ({
    ...idea,
    tokens: new Set(tokenizeForMatch(`${idea.label} ${idea.statement}`)),
  }));

  const checks: ManuscriptClaimCheck[] = [];
  let embeddingsUsed = false;
  for (const claim of claims) {
    const evidence = await gatherEvidence(claim, indexedIdeas);
    if (evidence.embeddingUsed) embeddingsUsed = true;
    checks.push(classifyClaimLocally({ claim, evidence: evidence.candidates, language }));
  }

  if (!embeddingsUsed) warnings.push(warn(promptLanguage, 'noEmbeddings'));

  const refined = await refineWithAi(checks, request, promptLanguage, warnings);
  const finalChecks = sortChecks(refined.checks);
  return {
    chapterId: request.chapterId,
    generatedAt,
    available: ideas.length > 0 || finalChecks.some((claim) => claim.suggestedCitations.length > 0),
    aiReviewed: refined.aiReviewed,
    summary: summarizeChecks(finalChecks, claims.length),
    claims: finalChecks,
    warnings,
  };
}

export function applyManuscriptCitation(request: ApplyManuscriptCitationRequest): ApplyManuscriptCitationResult {
  const chapter = getChapter(request.chapterId);
  if (!chapter) return { applied: false, chapter: null };
  const result = insertCitationIntoDraft(chapter.currentMarkdown, request.excerpt, request.citationMarkdown);
  if (!result.applied || result.markdown === chapter.currentMarkdown) {
    return { applied: false, chapter };
  }
  const updated = updateChapterMarkdown(request.chapterId, result.markdown, { versionLabel: 'Antes de aplicar cita' });
  return { applied: Boolean(updated), chapter: updated };
}

async function gatherEvidence(
  claim: ExtractedManuscriptClaim,
  indexedIdeas: IndexedIdeaCandidate[]
): Promise<{ candidates: ManuscriptEvidenceCandidate[]; embeddingUsed: boolean }> {
  const candidates = new Map<string, ManuscriptEvidenceCandidate>();
  let embeddingUsed = false;
  const vector = await embedQuery(claim.excerpt);
  if (vector) {
    embeddingUsed = true;
    for (const hit of findSimilarIdeas(vector, SEMANTIC_IDEA_THRESHOLD, 5)) {
      upsertCandidate(candidates, {
        kind: 'idea',
        refId: hit.global_id,
        label: hit.label,
        citation: `nodus://idea/${encodeURIComponent(hit.global_id)}`,
        snippet: hit.statement,
        score: clampScore(hit.similarity),
      });
    }
    for (const hit of findSimilarPassages(vector, SEMANTIC_PASSAGE_THRESHOLD, 4)) {
      upsertCandidate(candidates, {
        kind: 'passage',
        refId: hit.passage_id,
        label: hit.title,
        citation: `nodus://passage/${encodeURIComponent(hit.passage_id)}`,
        snippet: hit.text,
        score: clampScore(hit.similarity),
        workTitle: hit.title,
        pageLabel: hit.page_label,
      });
    }
  }

  for (const hit of lexicalIdeaMatches(claim.excerpt, indexedIdeas, 4)) {
    upsertCandidate(candidates, {
      kind: 'idea',
      refId: hit.global_id,
      label: hit.label,
      citation: `nodus://idea/${encodeURIComponent(hit.global_id)}`,
      snippet: hit.statement,
      score: hit.score,
    });
  }

  return {
    candidates: [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, MAX_EVIDENCE_PER_CLAIM),
    embeddingUsed,
  };
}

function lexicalIdeaMatches(excerpt: string, ideas: IndexedIdeaCandidate[], limit: number) {
  const queryTokens = new Set(tokenizeForMatch(excerpt));
  if (queryTokens.size === 0) return [];
  return ideas
    .map((idea) => ({ ...idea, score: scoreTokenSets(queryTokens, idea.tokens) }))
    .filter((idea) => idea.score >= LEXICAL_IDEA_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function scoreTokenSets(queryTokens: Set<string>, targetTokens: Set<string>): number {
  if (queryTokens.size === 0 || targetTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) overlap += 1;
  }
  if (overlap === 0) return 0;
  const cosineLike = overlap / Math.sqrt(queryTokens.size * targetTokens.size);
  const queryCoverage = overlap / queryTokens.size;
  return Number(Math.min(1, cosineLike * 0.7 + queryCoverage * 0.3).toFixed(4));
}

function upsertCandidate(map: Map<string, ManuscriptEvidenceCandidate>, candidate: ManuscriptEvidenceCandidate): void {
  const key = `${candidate.kind}:${candidate.refId}`;
  const existing = map.get(key);
  if (!existing || candidate.score > existing.score) {
    map.set(key, { ...candidate, score: clampScore(candidate.score), snippet: clip(candidate.snippet, 700) });
  }
}

async function refineWithAi(
  checks: ManuscriptClaimCheck[],
  request: ManuscriptVerificationRequest,
  language: PromptLanguage,
  warnings: string[]
): Promise<{ checks: ManuscriptClaimCheck[]; aiReviewed: boolean }> {
  const reviewable = checks.filter((check) => check.suggestedCitations.length > 0 || check.status === 'missing_citation');
  if (reviewable.length === 0) return { checks, aiReviewed: false };

  const byId = new Map(checks.map((check) => [check.id, check]));
  let reviewed = false;
  for (let i = 0; i < reviewable.length; i += AI_BATCH_SIZE) {
    const batch = reviewable.slice(i, i + AI_BATCH_SIZE);
    try {
      const response = await completeJson<AiReviewResponse>(
        {
          system: manuscriptVerifierPrompt(language),
          user: JSON.stringify(
            {
              claims: batch.map((check) => ({
                id: check.id,
                excerpt: clip(check.excerpt, 700),
                hasCitation: check.hasCitation,
                existingCitations: check.existingCitations,
                localStatus: check.status,
                localRationale: check.rationale,
                candidates: check.suggestedCitations.map((candidate) => ({
                  evidenceId: `${candidate.kind}:${candidate.refId}`,
                  kind: candidate.kind,
                  label: candidate.label,
                  citation: candidate.citation,
                  score: candidate.score,
                  snippet: clip(candidate.snippet, 450),
                })),
              })),
            },
            null,
            2
          ),
          temperature: 0.05,
          maxTokens: 3500,
        },
        isAiReviewResponse,
        request.model ?? null
      );
      for (const review of response.claims) {
        const current = review.id ? byId.get(review.id) : null;
        if (!current) continue;
        byId.set(current.id, applyAiReview(current, review));
      }
      reviewed = true;
    } catch {
      // Keep the deterministic result; verifier remains useful without an LLM.
    }
  }

  if (!reviewed) warnings.push(warn(language, 'noAi'));
  return { checks: checks.map((check) => byId.get(check.id) ?? check), aiReviewed: reviewed };
}

function applyAiReview(check: ManuscriptClaimCheck, review: AiClaimReview): ManuscriptClaimCheck {
  let status = normalizeStatus(review.status) ?? check.status;
  if (check.hasCitation && status === 'missing_citation') status = 'covered';
  const allowedEvidence = new Set(check.suggestedCitations.map((candidate) => `${candidate.kind}:${candidate.refId}`));
  const endorsedIds = new Set((review.evidenceIds ?? []).filter((id) => allowedEvidence.has(id)));
  const endorsed = check.suggestedCitations
    .filter((candidate) => endorsedIds.has(`${candidate.kind}:${candidate.refId}`))
    .map((candidate) => ({ ...candidate, aiEndorsed: true }));
  const others = check.suggestedCitations
    .filter((candidate) => !endorsedIds.has(`${candidate.kind}:${candidate.refId}`))
    .map((candidate) => ({ ...candidate, aiEndorsed: false }));
  // When the AI explicitly names the supporting sources for a claim that needs (or
  // weakly has) a citation, drop the rest: those are the off-topic matches the user
  // sees as "super distant". Otherwise keep the ranked list but float endorsed first.
  const prunes = status === 'missing_citation' || status === 'weak_match';
  const suggestedCitations = (
    prunes && endorsed.length > 0 ? endorsed : [...endorsed, ...others]
  ).sort((a, b) => b.score - a.score);
  const severity = normalizeSeverity(review.severity) ?? severityForStatus(status, { ...check, suggestedCitations });

  return {
    ...check,
    status,
    severity,
    rationale: typeof review.rationale === 'string' && review.rationale.trim() ? clip(review.rationale, 500) : check.rationale,
    replacementHint:
      typeof review.replacementHint === 'string' && review.replacementHint.trim()
        ? clip(review.replacementHint, 300)
        : check.replacementHint,
    suggestedCitations,
  };
}

function normalizeStatus(value: unknown): ManuscriptClaimStatus | null {
  const raw = String(value ?? '').trim();
  if (raw === 'missing_citation' || raw === 'covered' || raw === 'own_argument' || raw === 'weak_match') return raw;
  return null;
}

function normalizeSeverity(value: unknown): ManuscriptClaimSeverity | null {
  const raw = String(value ?? '').trim();
  if (raw === 'high' || raw === 'medium' || raw === 'low' || raw === 'info') return raw;
  return null;
}

function severityForStatus(status: ManuscriptClaimStatus, check: ManuscriptClaimCheck): ManuscriptClaimSeverity {
  if (status === 'missing_citation') return check.suggestedCitations[0]?.score >= 0.42 ? 'high' : 'medium';
  if (status === 'weak_match') return 'low';
  return 'info';
}

function sortChecks(checks: ManuscriptClaimCheck[]): ManuscriptClaimCheck[] {
  const rank: Record<ManuscriptClaimStatus, number> = {
    missing_citation: 0,
    weak_match: 1,
    covered: 2,
    own_argument: 3,
  };
  return checks.slice().sort((a, b) => {
    const statusDelta = rank[a.status] - rank[b.status];
    if (statusDelta !== 0) return statusDelta;
    const scoreDelta = (b.suggestedCitations[0]?.score ?? 0) - (a.suggestedCitations[0]?.score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return a.paragraphIndex - b.paragraphIndex || a.sentenceIndex - b.sentenceIndex;
  });
}

function warn(language: PromptLanguage, kind: 'empty' | 'noClaims' | 'noIdeas' | 'noEmbeddings' | 'noAi'): string {
  const copy: Record<PromptLanguage, Record<typeof kind, string>> = {
    es: { empty: 'El capitulo seleccionado no tiene texto que verificar.', noClaims: 'No se detectaron afirmaciones academicas verificables en este capitulo.', noIdeas: 'No hay ideas listadas del corpus contra las que comparar.', noEmbeddings: 'No hay embeddings disponibles; el verificador uso solo ideas listadas.', noAi: 'La revision con IA no estuvo disponible; se muestran resultados deterministas.' },
    en: { empty: 'The selected chapter has no text to verify.', noClaims: 'No citation-worthy academic claims were detected in this chapter.', noIdeas: 'There are no listed corpus ideas to compare against.', noEmbeddings: 'Embeddings are unavailable, so the verifier used listed ideas only.', noAi: 'AI review was unavailable, so deterministic retrieval results are shown.' },
    fr: { empty: 'Le chapitre sélectionné ne contient aucun texte à vérifier.', noClaims: 'Aucune affirmation universitaire nécessitant une citation n’a été détectée dans ce chapitre.', noIdeas: 'Aucune idée listée du corpus ne permet une comparaison.', noEmbeddings: 'Les embeddings sont indisponibles ; le vérificateur a utilisé uniquement les idées listées.', noAi: 'La vérification par IA est indisponible ; les résultats de récupération déterministes sont affichés.' },
    de: { empty: 'Das ausgewählte Kapitel enthält keinen zu prüfenden Text.', noClaims: 'In diesem Kapitel wurden keine belegpflichtigen wissenschaftlichen Aussagen erkannt.', noIdeas: 'Es gibt keine aufgelisteten Korpusideen zum Vergleich.', noEmbeddings: 'Embeddings sind nicht verfügbar; der Prüfer verwendete nur aufgelistete Ideen.', noAi: 'Die KI-Prüfung war nicht verfügbar; deterministische Abrufresultate werden angezeigt.' },
    pt: { empty: 'O capítulo selecionado não contém texto para verificar.', noClaims: 'Não foram detetadas afirmações académicas que exijam citação neste capítulo.', noIdeas: 'Não há ideias listadas do corpus para comparação.', noEmbeddings: 'Os embeddings não estão disponíveis; o verificador usou apenas as ideias listadas.', noAi: 'A revisão por IA não está disponível; são apresentados resultados determinísticos de recuperação.' },
    'pt-BR': { empty: 'O capítulo selecionado não contém texto para verificar.', noClaims: 'Nenhuma afirmação acadêmica que exija citação foi detectada neste capítulo.', noIdeas: 'Não há ideias listadas do corpus para comparação.', noEmbeddings: 'Os embeddings não estão disponíveis; o verificador usou apenas as ideias listadas.', noAi: 'A revisão por IA não está disponível; resultados determinísticos de recuperação são exibidos.' },
    it: { empty: 'Il capitolo selezionato non contiene testo da verificare.', noClaims: 'In questo capitolo non sono state rilevate affermazioni accademiche che richiedano una citazione.', noIdeas: 'Non ci sono idee del corpus elencate con cui confrontarsi.', noEmbeddings: 'Gli embedding non sono disponibili; il verificatore ha usato solo le idee elencate.', noAi: 'La revisione tramite IA non è disponibile; vengono mostrati risultati di recupero deterministici.' },
    tr: { empty: 'Seçilen bölümde doğrulanacak metin yok.', noClaims: 'Bu bölümde alıntı gerektiren akademik bir iddia tespit edilmedi.', noIdeas: 'Karşılaştırılacak listelenmiş derlem fikri yok.', noEmbeddings: 'Embedding’ler kullanılamıyor; doğrulayıcı yalnızca listelenen fikirleri kullandı.', noAi: 'Yapay zekâ incelemesi kullanılamadı; deterministik getirme sonuçları gösteriliyor.' },
    'zh-Hans': { empty: '所选章节没有可验证的文本。', noClaims: '本章未检测到需要引用出处的学术论断。', noIdeas: '没有可供比对的已列出语料库想法。', noEmbeddings: '没有可用的嵌入向量；验证器仅使用了已列出的想法。', noAi: 'AI 审查不可用；现显示确定性检索结果。' },
    'zh-Hant': { empty: '所選章節沒有可驗證的文字。', noClaims: '本章未偵測到需要引用出處的學術論斷。', noIdeas: '沒有可供比對的已列出語料庫想法。', noEmbeddings: '沒有可用的嵌入向量；驗證器僅使用了已列出的想法。', noAi: 'AI 審查不可用；現顯示確定性檢索結果。' },
    vi: { empty: 'Chương được chọn không có văn bản để xác minh.', noClaims: 'Không phát hiện luận điểm học thuật nào cần trích dẫn trong chương này.', noIdeas: 'Không có ý tưởng nào của kho ngữ liệu được liệt kê để đối chiếu.', noEmbeddings: 'Không có embedding khả dụng; trình xác minh chỉ dùng các ý tưởng được liệt kê.', noAi: 'Không có đánh giá bằng AI; kết quả truy xuất tất định được hiển thị.' },
    ja: { empty: '選択した章には検証するテキストがありません。', noClaims: 'この章には引用が必要な学術的主張は検出されませんでした。', noIdeas: '比較対象となるコーパスのアイデアが登録されていません。', noEmbeddings: '埋め込みを利用できないため、検証ツールは登録済みのアイデアのみを使用しました。', noAi: 'AI によるレビューを利用できないため、決定的な検索結果を表示しています。' },
    ru: { empty: 'В выбранной главе нет текста для проверки.', noClaims: 'В этой главе не обнаружено академических утверждений, требующих ссылки.', noIdeas: 'Нет перечисленных идей корпуса для сравнения.', noEmbeddings: 'Эмбеддинги недоступны; средство проверки использовало только перечисленные идеи.', noAi: 'Проверка с помощью ИИ недоступна; показаны детерминированные результаты поиска.' },
    uk: { empty: 'У вибраній главі немає тексту для перевірки.', noClaims: 'У цій главі не виявлено академічних тверджень, що потребують посилання.', noIdeas: 'Немає перелічених ідей корпусу для порівняння.', noEmbeddings: 'Ембедінги недоступні; засіб перевірки використав лише перелічені ідеї.', noAi: 'Перевірка ШІ недоступна; показано детерміновані результати пошуку.' },
    ko: { empty: '선택한 장에는 검증할 텍스트가 없습니다.', noClaims: '이 장에서 인용이 필요한 학술적 주장이 감지되지 않았습니다.', noIdeas: '비교할 말뭉치 아이디어가 나열되어 있지 않습니다.', noEmbeddings: '임베딩을 사용할 수 없어 검증기가 나열된 아이디어만 사용했습니다.', noAi: 'AI 검토를 사용할 수 없어 결정적 검색 결과를 표시합니다.' },
  };
  return copy[language]?.[kind] ?? copy.es[kind];
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}...`;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
