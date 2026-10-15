import { assertAcademicAutomation } from './academicMode';
import crypto from 'node:crypto';
import { completeJson, embedMany, AiError } from './aiClient';
import { modelRefSupportsExtraction } from '@shared/localAiModels';
import { deepScanPrompt } from './prompts';
import { applyFusionLink, applyFusionPlan, resolveIdeaFusion, ExtractedIdea, FusionDecision, FusionPlan } from './fusion';
import {
  upsertOccurrence,
  addEvidence,
  addEdge,
  purgeDeepData,
  embeddingTextForIdea,
  assertDeepDataIntegrity,
} from '../db/ideasRepo';
import { addGap, addExternalRef } from '../db/gapsRepo';
import { canonicalKeyFromDisplay, linkZoteroAuthors, recomputeAuthorRelations } from '../db/authorsRepo';
import { setDeepResult } from '../db/worksRepo';
import {
  getWorkThemeLabels,
  listThemeLabels,
  normalizeThemeLabel,
  pruneOrphanThemes,
  setIdeaThemeLinks,
  unionWorkThemes,
} from '../db/themesRepo';
import { loadCheckpoints, saveCheckpoint, clearCheckpoints } from '../db/scanCheckpointRepo';
import { getSettings } from '../db/settingsRepo';
import type { Work, IdeaType, EdgeType, EdgeBasis, EvidenceKind, GapKind, ModelRef } from '@shared/types';
import { planTextChunks, ExtractedDoc } from '../extraction/textExtractor';
import { perfLog, startPerf } from '../perf';
import { recordLinkedLibraryAnalysis } from '../library/libraryVaultProvenance';
import {
  analysisFingerprint,
  analysisModelFingerprint,
  isLocalAnalysisCurrent,
  recordLocalAnalysisProvenance,
} from '../db/libraryAnalysisProvenance';
import { getDb } from '../db/database';
import { mapOrderedPool } from './orderedPool';
import { OrderedPublicationBarrier } from './orderedPublicationBarrier';

// Fusion decisions depend on the current global graph. Serialize only that phase so
// concurrent scans can still extract chunks in parallel without planning against a
// graph that changes before their atomic commit.
const publicationBarrier = new OrderedPublicationBarrier();

/** Reserve publication order before a queued paper starts metadata/PDF extraction. */
export function issueDeepScanPublicationOrdinal(): number {
  return publicationBarrier.issue();
}

/** Mark a paper terminal when it fails before `runDeepScan` can reach the barrier. */
export function finishDeepScanPublicationOrdinal(ticket: number): void {
  publicationBarrier.finish(ticket);
}

async function withFusionLock<T>(ticket: number, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return publicationBarrier.publish(ticket, fn, signal);
}

// ── Prompt 1 output shapes ────────────────────────────────────────────────────

interface EvidenceObj {
  quote: string;
  location: string | null;
  source_ref: string | null;
  page_number: number | null;
  kind: EvidenceKind;
}
interface DeepIdea {
  id: string;
  type: IdeaType;
  label: string;
  statement: string;
  role: 'principal' | 'secondary';
  development: string;
  evidence: EvidenceObj[];
  theme_labels?: string[];
  confidence: number;
  uncertainty_reason: string | null;
}
interface DeepTheme {
  id: string;
  label: string;
  statement: string;
  role: 'primary' | 'secondary';
  evidence: EvidenceObj[];
  confidence: number;
}
interface DeepResult {
  document: { processing_status: string; type: string; language: string; notes: string | null };
  theme_nodes?: DeepTheme[];
  ideas: DeepIdea[];
  internal_relations: { from: string; to: string; type: EdgeType; basis: EdgeBasis; evidence: EvidenceObj; confidence: number }[];
  external_references: { from: string; cited_work: string; type: EdgeType; basis: EdgeBasis; evidence: EvidenceObj; confidence: number }[];
  gaps: { kind: GapKind; statement: string; related_idea: string | null; evidence: EvidenceObj; confidence: number }[];
  authors_detail: { name: string; affiliation: string | null; stance_notes: string | null }[];
}

function themeScore(theme: DeepTheme): number {
  return theme.confidence + (theme.role === 'primary' ? 0.5 : 0) + Math.min(0.3, (theme.evidence?.length ?? 0) * 0.05);
}

export interface DeepScanProgress {
  detail: string;
  pct: number | null;
}

/**
 * Share of a deep scan's own progress that fragment extraction owns; fusion takes the
 * rest. Fusion cannot start before the last fragment lands, so the two phases share one
 * scale instead of each restarting from zero — which is what made the bar's percentage
 * fall back to 0% when the analysis moved on from 92%.
 */
const FRAGMENT_PHASE_SHARE = 0.9;

function isRawDeepResult(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const raw = v as Record<string, unknown>;
  return Array.isArray(raw.ideas) && typeof raw.document === 'object' && raw.document !== null;
}

export function isDeepResult(v: unknown): v is DeepResult {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return Boolean(o.document && typeof o.document === 'object')
    && Array.isArray(o.ideas)
    && o.ideas.every((idea) => Boolean(idea && typeof idea === 'object' && typeof (idea as Record<string, unknown>).label === 'string' && (idea as Record<string, unknown>).label))
    && Array.isArray(o.internal_relations)
    && Array.isArray(o.external_references)
    && Array.isArray(o.gaps)
    && Array.isArray(o.authors_detail);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function cleanNullableString(value: unknown): string | null {
  return cleanString(value) || null;
}

function clampConfidence(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

function derivedLabel(...values: unknown[]): string {
  const text = values.map(cleanString).find(Boolean) ?? '';
  return text.split(/(?<=[.!?;:])\s+/u)[0].slice(0, 96).trim();
}

function normalizeEvidence(
  value: unknown,
  sourceMap: Map<string, string>,
  defaultSourceAlias: string | null,
  citationCorpus?: Map<string, Map<number | null, string>>,
): EvidenceObj | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const quote = cleanString(raw.quote);
  const rawLocation = cleanNullableString(raw.location);
  const rawSource = cleanString(raw.source_ref ?? raw.source ?? raw.attachment ?? raw.marker);
  const locationSource = rawLocation?.match(/(?:^|\b)(s\d+)(?:\b|\s)/i)?.[1] ?? '';
  const alias = rawSource || locationSource || defaultSourceAlias || '';
  const sourceRef = alias ? sourceMap.get(alias.replace(/^src:/i, '')) ?? (alias.startsWith('zotero:') ? alias : null) : null;
  const explicitPage = Number(raw.page_number ?? raw.page);
  const locationPage = rawLocation?.match(/(?:p(?:ág(?:ina)?)?\.?\s*)(\d+)/i)?.[1];
  let pageNumber = Number.isInteger(explicitPage) && explicitPage > 0
    ? explicitPage
    : locationPage ? Number(locationPage) : null;
  let kind: EvidenceKind = raw.kind === 'explicit' ? 'explicit' : 'paraphrased';
  if (!quote && !rawLocation) return null;
  const pages = sourceRef ? citationCorpus?.get(sourceRef) : null;
  // A page locator is durable only when that exact source/page was extracted.
  // Fulltext fallbacks without page markers deliberately cannot carry a page.
  if (pageNumber != null && !pages?.has(pageNumber)) pageNumber = null;
  if (kind === 'explicit' && quote) {
    const haystack = pageNumber != null ? pages?.get(pageNumber) : pages?.get(null);
    const normalize = (text: string) => text.normalize('NFKC').replace(/\p{L}-\s+(?=\p{Ll})/gu, (match) => match[0]).replace(/-\s+(?=\p{Ll})/gu, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    if (!haystack || !normalize(haystack).includes(normalize(quote))) {
      const matches = [...(pages?.entries() ?? [])]
        .filter(([page, text]) => page != null && normalize(text).includes(normalize(quote)));
      if (matches.length === 1) pageNumber = matches[0][0];
      else {
        kind = 'paraphrased';
        pageNumber = null;
      }
    }
  }
  const nonPageLocation = rawLocation && !/(?:p(?:ág(?:ina)?)?\.?\s*)\d+/i.test(rawLocation) ? rawLocation : null;
  return {
    quote,
    location: pageNumber ? `p. ${pageNumber}` : nonPageLocation,
    source_ref: sourceRef,
    page_number: pageNumber,
    kind,
  };
}

export function normalizeDeepResult(
  value: unknown,
  sourceMap: Map<string, string>,
  defaultSourceAlias: string | null,
  citationCorpus?: Map<string, Map<number | null, string>>,
): DeepResult {
  const root = asRecord(value) ?? {};
  const rawDocument = asRecord(root.document) ?? {};
  const normalizeEvidenceList = (input: unknown): EvidenceObj[] => (Array.isArray(input) ? input : [])
    .map((item) => normalizeEvidence(item, sourceMap, defaultSourceAlias, citationCorpus))
    .filter((item): item is EvidenceObj => Boolean(item));
  const ideaTypes = new Set<IdeaType>(['claim', 'finding', 'construct', 'method', 'framework']);
  const edgeTypes = new Set<EdgeType>(['extends', 'contradicts', 'applies_to', 'shares_method', 'precondition_of', 'measures_same', 'supports', 'refutes', 'variant_of', 'refines', 'contains']);
  const gapKinds = new Set<GapKind>(['future_work', 'limitation', 'open_question', 'unresolved_contradiction']);

  const ideas: DeepIdea[] = [];
  for (const [index, candidate] of (Array.isArray(root.ideas) ? root.ideas : []).entries()) {
    const raw = asRecord(candidate);
    if (!raw) continue;
    const evidence = normalizeEvidenceList(raw.evidence);
    const statement = cleanString(raw.statement ?? raw.development);
    const label = cleanString(raw.label) || derivedLabel(statement, evidence[0]?.quote);
    if (!label || !statement) continue;
    const type = ideaTypes.has(raw.type as IdeaType) ? raw.type as IdeaType : 'claim';
    ideas.push({
      id: cleanString(raw.id) || `idea-${index + 1}`,
      type,
      label,
      statement,
      role: raw.role === 'principal' ? 'principal' : 'secondary',
      development: cleanString(raw.development) || statement,
      evidence,
      theme_labels: (Array.isArray(raw.theme_labels) ? raw.theme_labels : []).map(cleanString).filter(Boolean),
      confidence: clampConfidence(raw.confidence),
      uncertainty_reason: cleanNullableString(raw.uncertainty_reason),
    });
  }

  const theme_nodes: DeepTheme[] = [];
  for (const [index, candidate] of (Array.isArray(root.theme_nodes) ? root.theme_nodes : []).entries()) {
    const raw = asRecord(candidate);
    if (!raw) continue;
    const evidence = normalizeEvidenceList(raw.evidence);
    const statement = cleanString(raw.statement);
    const label = cleanString(raw.label) || derivedLabel(statement, evidence[0]?.quote);
    if (!label) continue;
    theme_nodes.push({
      id: cleanString(raw.id) || `theme-${index + 1}`,
      label,
      statement: statement || label,
      role: raw.role === 'primary' ? 'primary' : 'secondary',
      evidence,
      confidence: clampConfidence(raw.confidence),
    });
  }

  const internal_relations: DeepResult['internal_relations'] = [];
  for (const candidate of Array.isArray(root.internal_relations) ? root.internal_relations : []) {
    const raw = asRecord(candidate);
    const from = cleanString(raw?.from);
    const to = cleanString(raw?.to);
    if (!raw || !from || !to || !edgeTypes.has(raw.type as EdgeType)) continue;
    internal_relations.push({
      from,
      to,
      type: raw.type as EdgeType,
      basis: raw.basis === 'explicit' ? 'explicit' : 'inferred',
      evidence: normalizeEvidence(raw.evidence, sourceMap, defaultSourceAlias, citationCorpus) ?? { quote: '', location: null, source_ref: null, page_number: null, kind: 'paraphrased' },
      confidence: clampConfidence(raw.confidence),
    });
  }

  const external_references: DeepResult['external_references'] = [];
  for (const candidate of Array.isArray(root.external_references) ? root.external_references : []) {
    const raw = asRecord(candidate);
    const from = cleanString(raw?.from);
    const citedWork = cleanString(raw?.cited_work);
    if (!raw || !from || !citedWork || !edgeTypes.has(raw.type as EdgeType)) continue;
    external_references.push({
      from,
      cited_work: citedWork,
      type: raw.type as EdgeType,
      basis: raw.basis === 'explicit' ? 'explicit' : 'inferred',
      evidence: normalizeEvidence(raw.evidence, sourceMap, defaultSourceAlias, citationCorpus) ?? { quote: '', location: null, source_ref: null, page_number: null, kind: 'paraphrased' },
      confidence: clampConfidence(raw.confidence),
    });
  }

  const gaps: DeepResult['gaps'] = [];
  for (const candidate of Array.isArray(root.gaps) ? root.gaps : []) {
    const raw = asRecord(candidate);
    const statement = cleanString(raw?.statement);
    if (!raw || !statement || !gapKinds.has(raw.kind as GapKind)) continue;
    gaps.push({
      kind: raw.kind as GapKind,
      statement,
      related_idea: cleanNullableString(raw.related_idea),
      evidence: normalizeEvidence(raw.evidence, sourceMap, defaultSourceAlias, citationCorpus) ?? { quote: '', location: null, source_ref: null, page_number: null, kind: 'paraphrased' },
      confidence: clampConfidence(raw.confidence),
    });
  }

  const authors_detail = (Array.isArray(root.authors_detail) ? root.authors_detail : [])
    .map(asRecord)
    .filter((raw): raw is Record<string, unknown> => Boolean(raw && cleanString(raw.name)))
    .map((raw) => ({ name: cleanString(raw.name), affiliation: cleanNullableString(raw.affiliation), stance_notes: cleanNullableString(raw.stance_notes) }));

  return {
    document: {
      processing_status: cleanString(rawDocument.processing_status) || 'processed',
      type: cleanString(rawDocument.type) || 'unknown',
      language: cleanString(rawDocument.language) || 'unknown',
      notes: cleanNullableString(rawDocument.notes),
    },
    theme_nodes,
    ideas,
    internal_relations,
    external_references,
    gaps,
    authors_detail,
  };
}

/** Merge ideas sharing the same canonical label across chunks of the same work. */
/**
 * A checkpointed chunk result that is safe to reuse, or null to analyse the chunk again.
 *
 * normalizeDeepResult is TOTAL: it turns any input at all — `{}`, a number, a string, an
 * old schema — into a well-formed DeepResult. Feeding it a checkpoint the resume path had
 * only tested for truthiness therefore produced an EMPTY result that sailed through the
 * strict guard: the chunk was skipped, its ideas were lost, the emptied result was written
 * back over the checkpoint, and the work still finished as 'done' with no error anywhere.
 * So the RAW row is checked first: a checkpoint already shaped like a deep result is worth
 * repairing (that is how label-less ideas from older runs are rescued), and anything else
 * is not a result at all and must be re-analysed.
 */
export function usableCheckpoint(
  saved: unknown,
  sourceMap: Map<string, string>,
  defaultSourceAlias: string | null,
  citationCorpus?: Map<string, Map<number | null, string>>,
): DeepResult | null {
  if (!saved || !isRawDeepResult(saved)) return null;
  const normalized = normalizeDeepResult(saved, sourceMap, defaultSourceAlias, citationCorpus);
  return isDeepResult(normalized) ? normalized : null;
}

export function mergeByLabel(results: DeepResult[]): {
  ideas: Map<string, DeepIdea>;
  themes: Map<string, DeepTheme>;
  internal: DeepResult['internal_relations'];
  external: DeepResult['external_references'];
  gaps: DeepResult['gaps'];
  authors: DeepResult['authors_detail'];
} {
  const ideas = new Map<string, DeepIdea>();
  const themes = new Map<string, DeepTheme>();
  const internal: DeepResult['internal_relations'] = [];
  const external: DeepResult['external_references'] = [];
  const gaps: DeepResult['gaps'] = [];
  const authors: DeepResult['authors_detail'] = [];

  for (const r of results) {
    // Local ids are scoped to one model response. Providers routinely reuse i1,
    // i2, … in every chunk, so resolve endpoints before adding that chunk to the
    // aggregate instead of keeping one cross-chunk map that later entries overwrite.
    const localToLabel = new Map<string, string>();
    for (const theme of r.theme_nodes ?? []) {
      const key = theme.label.trim().toLowerCase();
      if (!key) continue;
      const existing = themes.get(key);
      if (existing) {
        existing.evidence.push(...(theme.evidence ?? []));
        if (theme.role === 'primary') existing.role = 'primary';
        existing.confidence = Math.max(existing.confidence, theme.confidence);
      } else {
        themes.set(key, { ...theme, label: key, evidence: [...(theme.evidence ?? [])] });
      }
    }
    for (const idea of r.ideas) {
      const key = idea.label.trim().toLowerCase();
      localToLabel.set(idea.id, key);
      const existing = ideas.get(key);
      if (existing) {
        existing.evidence.push(...idea.evidence);
        existing.theme_labels = mergeThemeLabels(existing.theme_labels, idea.theme_labels);
        if (idea.role === 'principal') existing.role = 'principal';
        existing.confidence = Math.max(existing.confidence, idea.confidence);
      } else {
        ideas.set(key, { ...idea, evidence: [...idea.evidence], theme_labels: [...(idea.theme_labels ?? [])] });
      }
    }
    const remap = (id: string) => localToLabel.get(id) ?? id;
    internal.push(...(r.internal_relations ?? []).map((relation) => ({
      ...relation, from: remap(relation.from), to: remap(relation.to),
    })));
    external.push(...(r.external_references ?? []).map((reference) => ({
      ...reference, from: remap(reference.from),
    })));
    gaps.push(...(r.gaps ?? []).map((gap) => ({
      ...gap, related_idea: gap.related_idea ? remap(gap.related_idea) : gap.related_idea,
    })));
    authors.push(...(r.authors_detail ?? []));
  }

  return { ideas, themes, internal, external, gaps, authors };
}

function mergeThemeLabels(a: string[] | undefined, b: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const label of [...(a ?? []), ...(b ?? [])]) {
    const norm = normalizeThemeLabel(label);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(label);
  }
  return out;
}

function combineDeepResults(results: DeepResult[]): DeepResult {
  const first = results[0];
  return {
    document: first?.document ?? { processing_status: 'processed', type: 'unknown', language: 'unknown', notes: null },
    theme_nodes: results.flatMap((result) => result.theme_nodes ?? []),
    ideas: results.flatMap((result) => result.ideas),
    internal_relations: results.flatMap((result) => result.internal_relations),
    external_references: results.flatMap((result) => result.external_references),
    gaps: results.flatMap((result) => result.gaps),
    authors_detail: results.flatMap((result) => result.authors_detail),
  };
}

function citationCorpusFor(doc: ExtractedDoc): Map<string, Map<number | null, string>> {
  const corpus = new Map<string, Map<number | null, string>>();
  for (const segment of doc.segments ?? []) {
    const pages = new Map<number | null, string>();
    const matches = [...segment.text.matchAll(/\[\[p\.\s*(\d+)\]\]/gi)];
    if (matches.length === 0) {
      pages.set(null, segment.text);
    } else {
      for (let index = 0; index < matches.length; index++) {
        const page = Number(matches[index][1]);
        const start = (matches[index].index ?? 0) + matches[index][0].length;
        const end = matches[index + 1]?.index ?? segment.text.length;
        pages.set(page, segment.text.slice(start, end));
      }
    }
    corpus.set(segment.sourceRef, pages);
  }
  return corpus;
}

/**
 * Deep scan: extract ideas per chunk, merge within the work, fuse against the
 * global graph, and persist all derived data with traceable evidence.
 */
export async function runDeepScan(
  work: Work,
  doc: ExtractedDoc,
  model?: ModelRef | null,
  onProgress?: (p: DeepScanProgress) => void,
  publicationOrdinal?: number,
  options: { force?: boolean } = {},
): Promise<void> {
  assertAcademicAutomation();
  // Queue callers reserve this before PDF extraction. Direct scans still receive a
  // safe ordinal here, preserving a single ordering domain for graph publication.
  const publishOrdinal = publicationOrdinal ?? publicationBarrier.issue();
  let publicationAdvanced = false;
  const perf = { nodusId: work.nodus_id, title: work.title };
  const totalDone = startPerf('deep pipeline', perf, { sourceType: doc.sourceType, chars: doc.text.length });
  const text = doc.text;
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  const settings = getSettings();
  const extractionModel = model ?? settings.extractionModel ?? settings.synthesisModel ?? null;
  const fusionModel = model ?? settings.fusionModel ?? settings.synthesisModel ?? null;
  const effectiveSettings = { ...settings, extractionModel, fusionModel };
  const deepModelFingerprint = analysisModelFingerprint('deep', effectiveSettings);
  const ideasModelFingerprint = analysisModelFingerprint('ideas', effectiveSettings);

  try {
    if (!options.force && work.deep_hash === hash && work.source_type === doc.sourceType
      && isLocalAnalysisCurrent(work.nodus_id, 'deep', hash, deepModelFingerprint)) {
      // Queueing marks the row pending before this function reads it. Restore the
      // committed status explicitly when the resolved corpus is byte-identical.
      setDeepResult(work.nodus_id, 'done', hash, work.source_type, work.notes);
      totalDone({ status: 'unchanged' });
      return;
    }

    if (!text.trim()) {
      // Zotero was unreachable, so we do not know whether full text exists. Never
      // persist `skipped_no_text` for this: it would present a transient outage as a
      // permanent "no PDF". Fail retriably so the queue backs off and tries again.
      if (doc.blockReason === 'zotero_unavailable') {
        throw new AiError(
          'Zotero no está disponible: no se pudo comprobar si la obra tiene texto completo. Vuelve a analizarla cuando Zotero esté abierto.',
          true,
        );
      }
      setDeepResult(work.nodus_id, 'skipped_no_text', hash, doc.sourceType, doc.notes ?? 'Sin texto disponible.');
      totalDone({ status: 'skipped_no_text' });
      return;
    }

    // A vision-only local model (Qwen3.5-0.8B, LFM2.5) loops inside the JSON and returns 0 ideas.
    // The UI blocks picking one for this role, but a value set before that guard existed could still
    // reach here — fail once with an actionable message (config error → the queue pauses) instead of
    // burning minutes per work to produce nothing.
    if (!modelRefSupportsExtraction(extractionModel)) {
      throw new AiError(
        `El modelo «${extractionModel?.model}» es de visión y no puede extraer ideas. Elige Gemma 4 E2B u otro modelo mayor como modelo de extracción en Ajustes → Modelos de IA.`,
        false,
        true,
      );
    }
    // Fusion runs many small dedup/relate calls; let it use a dedicated (often faster)
    // model, falling back to the synthesis model to preserve prior behavior.
    const chunkPlan = planTextChunks(text, {
      mode: settings.deepContextMode,
      standardChunkWords: settings.deepStandardChunkWords,
      longChunkWords: settings.deepLongChunkWords,
    });
    const chunks = chunkPlan.chunks;
    const checkpointHash = analysisFingerprint({
      document: hash,
      model: deepModelFingerprint,
      prompt: deepScanPrompt(settings.promptLanguage ?? 'es'),
      chunkPlan,
      localTokenPolicy: 1,
    });
    if (options.force) {
      clearCheckpoints(work.nodus_id, checkpointHash, 'deep_chunk');
      clearCheckpoints(work.nodus_id, checkpointHash, 'deep_fusion');
    }
    perfLog('chunking', 0, perf, {
      mode: chunkPlan.mode,
      words: chunkPlan.wordCount,
      chunks: chunks.length,
      chunkWords: chunkPlan.chunkWords,
      overlapWords: chunkPlan.overlapWords,
      maxIdeas: chunkPlan.maxIdeasPerChunk,
    });
    const authors: string[] = JSON.parse(work.authors_json || '[]');
    const existingThemeLabels = getWorkThemeLabels(work.nodus_id);
    const sourceMap = new Map((doc.segments ?? []).map((segment) => [segment.marker, segment.sourceRef]));
    const citationCorpus = citationCorpusFor(doc);

    // Load any previously checkpointed chunk results so we can resume after a failure.
    const checkpoints = loadCheckpoints(work.nodus_id, checkpointHash, 'deep_chunk');

    const llmDone = startPerf('deep LLM extraction', perf, { chunks: chunks.length, mode: chunkPlan.mode });
    const extractionPool = settings.aiConcurrencyMode === 'automatic'
      ? 8
      : Math.max(1, Math.min(8, settings.concurrency));

    /** One fragment: a checkpointed result, or the model call that produces it. */
    const extractFragment = async (i: number, poolSignal: AbortSignal): Promise<DeepResult> => {
      // Resume from checkpoint if available.
      const defaultSourceAlias = chunks[i].match(/\[\[src:([^\]\s]+)/i)?.[1] ?? null;
      const reusable = usableCheckpoint(checkpoints.get(i), sourceMap, defaultSourceAlias, citationCorpus);
      if (reusable) {
        // Upgrade legacy checkpoints in place so every later resume is strict.
        saveCheckpoint(work.nodus_id, checkpointHash, 'deep_chunk', i, reusable);
        return reusable;
      }
      const chunkWordCount = chunks[i].split(/\s+/).filter(Boolean).length;
      const input = {
        zotero_key: work.zotero_key,
        title: work.title,
        authors,
        year: work.year,
        container: null,
        item_type: work.item_type,
        has_fulltext: doc.sourceType !== 'abstract_only',
        language_hint: 'unknown',
        available_theme_labels: existingThemeLabels,
        available_sources: (doc.segments ?? []).map((segment) => ({
          marker: segment.marker,
          source_ref: segment.sourceRef,
          title: segment.displayName,
          has_page_markers: segment.hasPageMarkers,
        })),
        context_mode: chunkPlan.mode,
        analysis_limits: {
          max_ideas: chunkPlan.maxIdeasPerChunk,
          max_internal_relations: chunkPlan.maxRelationsPerChunk,
          max_gaps: chunkPlan.maxGapsPerChunk,
          target_chunk_words: chunkPlan.chunkWords,
          overlap_words: chunkPlan.overlapWords,
        },
        format_note: 'El texto usa marcadores [[src:sN p.N]]. Copia sN en source y N en page. Si el marcador no incluye página, no inventes page ni location.',
        chunk: { index: i, total: chunks.length, word_count: chunkWordCount, text: chunks[i] },
      };
      const chunkDone = startPerf('deep LLM chunk', perf, {
        chunk: `${i + 1}/${chunks.length}`,
        words: chunkWordCount,
        maxIdeas: chunkPlan.maxIdeasPerChunk,
      });
      try {
        // Deep JSON routinely needs more than 8K once a local reasoning model accounts
        // for its private trace. The adaptive planner owns the context window; this is
        // the independent, proven output allowance for both standard and long chunks.
        const baseMaxTokens = 16000;
        const adaptive = { leaves: 0 };
        const completeAdaptive = async (chunkText: string, depth: number, maxTokens: number): Promise<DeepResult> => {
          const adaptiveWordCount = chunkText.split(/\s+/).filter(Boolean).length;
          const adaptiveIdeas = Math.max(1, Math.min(chunkPlan.maxIdeasPerChunk, Math.ceil(adaptiveWordCount / 450)));
          const requestInput = {
            ...input,
            analysis_limits: {
              ...input.analysis_limits,
              max_ideas: adaptiveIdeas,
              max_internal_relations: Math.max(1, Math.min(chunkPlan.maxRelationsPerChunk, Math.ceil(adaptiveIdeas * 1.5))),
              max_gaps: Math.max(1, Math.min(chunkPlan.maxGapsPerChunk, adaptiveIdeas >= 3 ? 2 : 1)),
            },
            chunk: {
              ...input.chunk,
              word_count: adaptiveWordCount,
              text: chunkText,
            },
          };
          try {
            const rawResult = await completeJson<Record<string, unknown>>(
              {
                system: deepScanPrompt(getSettings().promptLanguage ?? 'es'),
                user: JSON.stringify(requestInput),
                temperature: 0.15,
                maxTokens,
                task: 'deep-extraction',
                splitDepth: depth,
                perf,
                signal: poolSignal,
                requestClass: 'background',
                deterministic: true,
                jobId: `${work.nodus_id}:deep:${i}:${depth}:${crypto.createHash('sha1').update(chunkText).digest('hex').slice(0, 12)}`,
              },
              isRawDeepResult,
              extractionModel
            );
            const alias = chunkText.match(/\[\[src:([^\]\s]+)/i)?.[1] ?? defaultSourceAlias;
            const normalized = normalizeDeepResult(rawResult, sourceMap, alias, citationCorpus);
            if (!isDeepResult(normalized)) throw new AiError('La respuesta normalizada no cumple el esquema profundo.', false);
            adaptive.leaves += 1;
            return normalized;
          } catch (error) {
            const aiError = error instanceof AiError ? error : null;
            const recoverableJson = aiError?.code === 'output_truncated'
              || aiError?.code === 'context_overflow'
              || /context|json|esquema|truncad|límite de salida/i.test(error instanceof Error ? error.message : String(error));
            // A chunk that ran out of time is recoverable the same way a clipped one is —
            // by asking for less — and until now it wasn't: the whole deep pass died on the
            // first slow chunk, which is what a local model did to every long work. It gets
            // ONE split rather than four, because each failed attempt here costs the full
            // transport budget on the user's own machine, and a halved chunk that still
            // times out is telling us the model is too slow for this work, not this chunk.
            const timedOut = aiError?.code === 'timeout';
            const maxDepth = timedOut ? 1 : 4;
            const words = chunkText.split(/\s+/).filter(Boolean).length;
            if ((!recoverableJson && !timedOut) || depth >= maxDepth || words < 400 || adaptive.leaves >= 16) throw error;

            // First use any output headroom. If the provider still clips the object,
            // split on the marker-aware chunker and merge only strict child results.
            // Headroom is the answer to truncation only: raising the ceiling after a
            // timeout just buys a slow model more rope to run out of time with.
            if (!timedOut && aiError?.code !== 'context_overflow' && depth === 0 && maxTokens < 16000) {
              try {
                return await completeAdaptive(chunkText, depth + 1, Math.min(16000, maxTokens * 2));
              } catch (expandedError) {
                const expandedAi = expandedError instanceof AiError ? expandedError : null;
                if (expandedAi?.code !== 'output_truncated' && !/json|esquema|truncad|límite de salida/i.test(expandedError instanceof Error ? expandedError.message : String(expandedError))) throw expandedError;
              }
            }
            const childWords = Math.max(500, Math.min(5000, Math.ceil(words / 2)));
            const children = planTextChunks(chunkText, { mode: 'standard', standardChunkWords: childWords }).chunks;
            if (children.length < 2 || adaptive.leaves + children.length > 16) throw error;
            const childResults = await mapOrderedPool(
              children,
              Math.min(children.length, extractionPool),
              (child) => completeAdaptive(child, depth + 1, baseMaxTokens),
              poolSignal,
            );
            return combineDeepResults(childResults);
          }
        };
        const result = await completeAdaptive(chunks[i], 0, baseMaxTokens);
        chunkDone({ ideas: result.ideas.length, themes: result.theme_nodes?.length ?? 0 });
        // Checkpoint this chunk so a later failure doesn't lose the work.
        saveCheckpoint(work.nodus_id, checkpointHash, 'deep_chunk', i, result);
        return result;
      } catch (e) {
        chunkDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
        llmDone({ status: 'error', chunk: i + 1 });
        throw e;
      }
    }

    // Fragments are extracted in parallel, so the line belongs to the phase and not to
    // each worker: a per-worker writer let the counter, the percentage and the seconds
    // jump between fragments that had started at different times (fragment 3/3 at one
    // second, fragment 9/12 at ninety) every time the last worker to tick was another
    // one. The counter names the oldest fragment still in flight, the percentage counts
    // fragments finished and the seconds measure the phase, so all three only advance.
    let fragmentsDone = 0;
    const fragmentPhaseStart = Date.now();
    const reportFragmentPhase = () => {
      const seconds = Math.round((Date.now() - fragmentPhaseStart) / 1000);
      const current = Math.min(fragmentsDone + 1, chunks.length);
      onProgress?.({
        detail: seconds > 0
          ? `Analizando fragmento ${current}/${chunks.length} con IA… (${seconds}s)`
          : `Analizando fragmento ${current}/${chunks.length} con IA…`,
        pct: FRAGMENT_PHASE_SHARE * (fragmentsDone / chunks.length),
      });
    };
    const fragmentHeartbeat = setInterval(reportFragmentPhase, 1000);
    let results: DeepResult[];
    try {
      reportFragmentPhase();
      results = await mapOrderedPool(chunks, extractionPool, async (_chunk, i, poolSignal) => {
        try {
          return await extractFragment(i, poolSignal);
        } finally {
          fragmentsDone += 1;
          reportFragmentPhase();
        }
      });
    } finally {
      clearInterval(fragmentHeartbeat);
    }

    llmDone({ results: results.length });

    const merged = mergeByLabel(results);
    // Keep only a small number of well-supported deep families. The prompt runs per
    // chunk, so accepting every family it mentions turns sections into graph hubs.
    let deepThemeLabels = Array.from(merged.themes.values())
      .filter((t) => t.confidence >= 0.65)
      .sort((a, b) => themeScore(b) - themeScore(a))
      .slice(0, 2)
      .map((t) => t.label);
    if (getSettings().themesLocked) {
      // Locked main themes: never coin new families; keep only matches of the curated set.
      const allowed = new Map(listThemeLabels().map((label) => [normalizeThemeLabel(label), label]));
      deepThemeLabels = deepThemeLabels
        .map((label) => allowed.get(normalizeThemeLabel(label)))
        .filter((label): label is string => Boolean(label));
    }
    const existingDeepThemeLabels = getWorkThemeLabels(work.nodus_id);
    const plannedThemeLabels: string[] = [];
    const plannedThemeKeys = new Set<string>();
    for (const label of [...deepThemeLabels, ...existingDeepThemeLabels]) {
      const key = normalizeThemeLabel(label);
      if (!key || plannedThemeKeys.has(key)) continue;
      plannedThemeKeys.add(key);
      plannedThemeLabels.push(label);
      if (plannedThemeLabels.length >= 4) break;
    }
    const allowedThemeLabels = new Map(plannedThemeLabels.map((label) => [normalizeThemeLabel(label), label]));

    // Resolve each merged idea against the global graph (Prompt 2 / fusion).
    const labelToGlobal = new Map<string, string>();
    const ideaEntries = Array.from(merged.ideas);
    const preparedIdeas = ideaEntries.map(([labelKey, idea]) => {
      const ideaThemeLabels = mergeThemeLabels(idea.theme_labels, [])
        .map((label) => allowedThemeLabels.get(normalizeThemeLabel(label)))
        .filter((label): label is string => Boolean(label))
        .slice(0, 3);
      const embeddingText = embeddingTextForIdea({
        type: idea.type,
        label: idea.label,
        statement: idea.statement,
        themes: ideaThemeLabels,
      });
      return { labelKey, idea, ideaThemeLabels, embeddingText };
    });
    const fusionDone = startPerf('embeddings/fusion', perf, { ideas: ideaEntries.length });
    const embeddingDone = startPerf('embedding', perf, { mode: 'batch', ideas: ideaEntries.length });
    try {
      const embeddings = await embedMany(
        preparedIdeas.map((entry) => entry.embeddingText),
        undefined,
        { role: 'document', perf, jobId: `${work.nodus_id}:fusion-embeddings` },
      );
      embeddingDone({ available: embeddings.filter(Boolean).length });
      await withFusionLock(publishOrdinal, async () => {
        publicationAdvanced = true;
        // Fusion decisions are checkpointed per idea. A transient model failure
        // (invalid JSON or a provider hang) therefore costs a retry of only the
        // ideas that failed, not the whole work — the caller throws a retriable
        // error and the queue resumes from these checkpoints later.
        const fusionCheckpoints = loadCheckpoints(work.nodus_id, checkpointHash, 'deep_fusion');
        const failedFusion: number[] = [];
        // Same contract as the fragment phase: ideas are resolved in parallel, so the
        // line is written once per completion instead of once per worker, and the
        // percentage continues the fragment phase's scale rather than starting over.
        let ideasDone = 0;
        const reportFusionPhase = () => {
          const current = Math.min(ideasDone + 1, ideaEntries.length);
          onProgress?.({
            detail: `Fusionando idea ${current}/${ideaEntries.length}…`,
            pct: FRAGMENT_PHASE_SHARE + (1 - FRAGMENT_PHASE_SHARE) * (ideasDone / ideaEntries.length),
          });
        };
        if (ideaEntries.length > 0) reportFusionPhase();
        const plans = await mapOrderedPool(preparedIdeas, extractionPool, async (prepared, i) => {
          const { labelKey, idea, ideaThemeLabels, embeddingText } = prepared;
          const ext: ExtractedIdea = {
            localId: labelKey,
            type: idea.type,
            label: idea.label,
            statement: idea.statement,
          };
          try {
            const outcome = await resolveIdeaFusion(ext, {
              model: fusionModel,
              perf,
              embedding: embeddings[i] ?? null,
              embeddingText,
              themes: ideaThemeLabels,
            }, (fusionCheckpoints.get(i) as FusionDecision | undefined) ?? null);
            if (outcome.decision) saveCheckpoint(work.nodus_id, checkpointHash, 'deep_fusion', i, outcome.decision);
            return outcome.plan;
          } catch (error) {
            // A misconfiguration (missing model / bad key) is not a hiccup: it would
            // fail identically for every idea. Rethrow so the queue pauses and
            // surfaces it once, exactly as it did when planIdeaFusion ran unguarded.
            if (error instanceof AiError && error.config) throw error;
            // Do not abort the pass: every other decision still makes progress and
            // gets checkpointed, so the retry only redoes the ideas collected here.
            failedFusion.push(i);
            return null;
          } finally {
            ideasDone += 1;
            reportFusionPhase();
          }
        });
        if (failedFusion.length > 0) {
          throw new AiError(
            `No se pudieron fusionar ${failedFusion.length} de ${preparedIdeas.length} ideas (respuesta JSON inválida o tiempo de espera). Se reintentará más tarde reanudando solo esas.`,
            true,
          );
        }

        // No user-visible deep row is changed until every model/embedding decision is
        // ready. A write error rolls the whole replacement back to the previous result.
        const resolvedPlans = plans as FusionPlan[];
        getDb().transaction(() => {
          purgeDeepData(work.nodus_id);
          unionWorkThemes(work.nodus_id, deepThemeLabels, 4);
          // Plans are resolved in parallel before this commit, so two chunks of the same
          // scan that extracted the same idea both planned a *new* idea — neither could
          // be the other's fusion candidate. Collapse identical new statements here.
          const createdInScan = new Map<string, string>();
          const globalIds: string[] = [];
          for (let i = 0; i < preparedIdeas.length; i++) {
            const { labelKey, idea, ideaThemeLabels } = preparedIdeas[i];
            const plan = resolvedPlans[i];
            const statementKey = typeof idea.statement === 'string'
              ? `${idea.type}|${idea.statement.replace(/\s+/g, ' ').trim().toLocaleLowerCase()}`
              : null;
            const duplicateOf = plan.existingId || !statementKey ? undefined : createdInScan.get(statementKey);
            const globalId = duplicateOf ?? applyFusionPlan(plan);
            if (!plan.existingId && !duplicateOf && statementKey) createdInScan.set(statementKey, globalId);
            globalIds.push(globalId);
            labelToGlobal.set(labelKey, globalId);
            setIdeaThemeLinks(work.nodus_id, globalId, ideaThemeLabels, idea.confidence, 'explicit');
            upsertOccurrence(globalId, work.nodus_id, idea.role, idea.development, idea.confidence);
            for (const ev of idea.evidence) {
              addEvidence(globalId, work.nodus_id, ev.quote, ev.location, ev.kind, { sourceRef: ev.source_ref, pageNumber: ev.page_number });
            }
          }
          // Links go in once every idea of this pass has its occurrence: a target that
          // another idea here merges into is active by now, one no work holds is dropped.
          for (let i = 0; i < preparedIdeas.length; i++) {
            applyFusionLink(resolvedPlans[i], globalIds[i], work.nodus_id);
          }
          // Theme cleanup waits until this work's idea links are rewritten, so it only
          // drops themes that nothing references once the replacement is complete.
          pruneOrphanThemes();

          for (const rel of merged.internal) {
            const from = labelToGlobal.get(rel.from);
            const to = labelToGlobal.get(rel.to);
            // Fusion can map both labels onto one existing idea; that is not a relation.
            if (!from || !to || from === to) continue;
            addEdge({
              from_id: from,
              to_id: to,
              type: rel.type,
              basis: rel.basis,
              confidence: rel.confidence,
              source_work: work.nodus_id,
              trace: {
                method: 'deep',
                model: extractionModel,
                rationale: rel.evidence?.quote ? `Relación extraída con evidencia: "${rel.evidence.quote}"` : null,
              },
            });
          }

          for (const ref of merged.external) {
            const from = labelToGlobal.get(ref.from);
            if (!from) continue;
            const evId = ref.evidence?.quote
              ? addEvidence(from, work.nodus_id, ref.evidence.quote, ref.evidence.location, ref.evidence.kind, { sourceRef: ref.evidence.source_ref, pageNumber: ref.evidence.page_number })
              : null;
            addExternalRef(work.nodus_id, from, ref.cited_work, ref.type, ref.basis, ref.confidence, evId);
          }

          for (const g of merged.gaps) {
            const related = g.related_idea ? labelToGlobal.get(g.related_idea) ?? null : null;
            const evidenceIdea = related ?? labelToGlobal.values().next().value ?? null;
            const evId = g.evidence?.quote && evidenceIdea
              ? addEvidence(evidenceIdea, work.nodus_id, g.evidence.quote, g.evidence.location, g.evidence.kind, { sourceRef: g.evidence.source_ref, pageNumber: g.evidence.page_number })
              : null;
            addGap(work.nodus_id, g.kind, g.statement, related, g.confidence, evId);
          }

          const affiliationByKey = new Map<string, string | null>();
          for (const author of merged.authors) {
            const key = canonicalKeyFromDisplay(author.name);
            if (key && author.affiliation && !affiliationByKey.get(key)) affiliationByKey.set(key, author.affiliation);
          }
          linkZoteroAuthors(work.nodus_id, { createIfMissing: true, affiliationByKey });
          setDeepResult(work.nodus_id, 'done', hash, doc.sourceType, merged.ideas.size === 0 ? doc.notes ?? null : null);
          recordLocalAnalysisProvenance({
            workId: work.nodus_id,
            components: ['deep', 'ideas', 'embeddings'],
            documentFingerprint: hash,
            modelFingerprints: {
              deep: deepModelFingerprint,
              ideas: ideasModelFingerprint,
            },
          });
          recomputeAuthorRelations();
          clearCheckpoints(work.nodus_id, checkpointHash, 'deep_chunk');
          clearCheckpoints(work.nodus_id, checkpointHash, 'deep_fusion');
          assertDeepDataIntegrity(work.nodus_id);
        })();
      });
      fusionDone({ mapped: labelToGlobal.size });
      try {
        recordLinkedLibraryAnalysis({
          workId: work.nodus_id,
          components: ['deep', 'ideas', 'embeddings'],
          documentFingerprint: hash,
        });
      } catch (error) {
        console.warn(`[deepScan] análisis guardado; procedencia externa diferida para ${work.nodus_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (e) {
      embeddingDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      fusionDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      throw e;
    }

    totalDone({ status: 'done', ideas: merged.ideas.size });
  } catch (e) {
    totalDone({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    // A skipped/failed work is terminal for ordering purposes and cannot strand every
    // later publication behind an ordinal that will never reach the fusion barrier.
    if (!publicationAdvanced) publicationBarrier.finish(publishOrdinal);
  }
}
