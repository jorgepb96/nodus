import { assertAcademicAutomation } from './academicMode';
import { createHash, randomUUID } from 'node:crypto';
import type {
  DocumentIdeaLink,
  DocumentProfileAudit,
  DocumentProfileConfidenceSource,
  DocumentProfileFallbackMode,
  DocumentProfileFieldKind,
  DocumentProfileSupport,
  DocumentSection,
  ModelRef,
  PromptLanguage,
  Work,
} from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import {
  advanceRunningDocumentIndexJob,
  clearDocumentCheckpoints,
  clearWorkDocumentCheckpoints,
  publishDocumentProfile,
  readDocumentCheckpoint,
  saveDocumentCheckpoint,
  setDocumentProfileState,
  updateDocumentIndexJob,
} from '../db/documentProfilesRepo';
import { cosineSimilarity, currentEmbeddingConfig, decodeEmbedding } from '../db/ideasRepo';
import { prepareLegacyDocumentaryPassages, type PreparedLegacyPassages } from './documentaryLegacyPreparation';
import { waitForPassageWork } from './passageEmbeddingActivity';
import { resolveWorkText, resolvedTextStateFromDoc } from '../extraction/textExtractor';
import { setResolvedTextState } from '../db/worksRepo';
import { analysisFingerprint, analysisModelFingerprint, upsertLibraryAnalysisProvenance } from '../db/libraryAnalysisProvenance';
import { getItem, LOCAL_USER_ID } from '../zotero/zoteroClient';
import { AiError, completeJson, embedMany, estimateLocalTokens, localModelContextWindow, resolveModelRef } from './aiClient';
import { mapOrderedPool } from './orderedPool';
import { modelRefSupportsCapability } from '@shared/localAiModels';
import type { PerfContext } from '../perf';
import { documentProfilePromptPack } from '@shared/academicPromptPacks';
import { logPipelineSuccess } from '../logging/pipelineLogCore';

export const DOCUMENT_PROFILE_PIPELINE_VERSION = 'document-profile/5';
export const DOCUMENT_PROFILE_SCHEMA_VERSION = 2;
const ANALYSIS_WORDS = 2_500;
const MIN_SECTION_WORDS = 80;
const DIRECT_SUPPORT_CONFIDENCE_FLOOR = 0.8;
/**
 * Minimum semantic score the auditor must report for a synthesis to publish with no
 * caveat. It is a different decision from the direct-support floor above even though
 * both values are 0.8: the floor says what a literally supported field is worth, this
 * says how much the auditor must like the prose. Sharing one constant made a rejected
 * synthesis and a perfect one report the same number, and made "0.8" look like a score.
 */
const SEMANTIC_ACCEPTANCE_SCORE = 0.8;
const CENTRAL_FIELD_KINDS = new Set<DocumentProfileFieldKind>([
  'problem', 'question', 'hypothesis', 'thesis', 'method', 'finding', 'conclusion', 'contribution',
]);

export interface DerivedDocumentSection extends DocumentSection {
  body: string;
}

interface RawClaim { text: string; support_quote: string; page: string | null; confidence: number }
/** `degraded` marks an analysis that fell back to literal source text because no model
 *  synthesis survived its own section audit. Absent means synthesised; it is not persisted
 *  as such, but the scan counts it so a published profile can say how much of it is
 *  quotation. */
interface SectionAnalysis { title: string; summary: string; role: string; concepts: string[]; claims: RawClaim[]; degraded?: boolean }
interface RawProfileField {
  kind: DocumentProfileFieldKind;
  text: string;
  confidence: number;
  centrality: number;
  support_quote: string;
  page: string | null;
  /** Set when the published confidence is the deterministic floor rather than a
   *  value the provider measured (see `retainLiterallySupportedFields`). */
  confidenceSource?: DocumentProfileConfidenceSource;
}
interface ProfileSynthesis { source_language: string; overview: string; fields: RawProfileField[] }
interface AuditResponse {
  passed: boolean;
  /** null when the provider reported no usable score: "no reading", not "scored zero". */
  score: number | null;
  issues: string[];
  field_fixes: Array<{ index: number; text: string; support_quote: string }>;
  overview: string;
}
interface SectionAuditResponse { passed: boolean; issues: string[]; analysis: SectionAnalysis | null }
type PreparedPassages = PreparedLegacyPassages;

function isSectionAuditResponse(value: unknown): value is SectionAuditResponse {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export interface DocumentProfileScanProgress {
  phase: 'waiting_source' | 'structuring' | 'analyzing_sections' | 'synthesizing' | 'auditing' | 'repairing' | 'embedding' | 'aligning' | 'publishing';
  progress: number;
  message: string;
  currentUnit?: number;
  totalUnits?: number;
}

export interface RunDocumentProfileOptions {
  jobId: string;
  generatorModel: ModelRef | null;
  auditorModel: ModelRef | null;
  signal?: AbortSignal;
  onProgress?: (progress: DocumentProfileScanProgress) => void;
  /** Audit-only timing context; never contains document text. */
  perf?: PerfContext;
  language?: PromptLanguage;
  /** Prompt budget in tokens for the model that will read it, or null for a cloud model
   *  whose window is managed server-side. Local servers load a small fixed window and
   *  reject a prompt that does not fit, so every prompt this pipeline builds is sized
   *  against it instead of discovering the limit through a failed request. */
  promptTokenBudget?: number | null;
  /** The same budget for the auditor model, which is usually a different one. */
  auditorTokenBudget?: number | null;
}

const clean = (value: unknown, max = 20_000): string => typeof value === 'string'
  ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const strings = (value: unknown, max = 24): string[] => Array.isArray(value)
  ? value.map((item) => clean(item, 500)).filter(Boolean).slice(0, max) : [];
const number01 = (value: unknown): number => Math.max(0, Math.min(1, Number(value) || 0));

/**
 * Read a provider verdict. The schema asks for a JSON boolean, but providers —
 * especially small and local models — answer with the affirmatives of their own
 * language and with 1/0, and a JSON `1` is not a JSON `true`. Reading those as a
 * rejection used to discard an entire audited synthesis, so anything explicit and
 * positive counts as an approval; an unrecognised or absent value stays false,
 * because a missing verdict must never be promoted to passed.
 */
function verdictPassed(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase().replace(/[.!。]$/, '');
  return [
    'true', '1', 'yes', 'y', 'sí', 'si', 'verdadero', 'verdadera', 'correcto', 'aprobado',
    'oui', 'ja', 'sim', 'vero', 'doğru', 'evet',
    'да', 'так', '예', '네', 'はい', '是', '对', '對', 'đúng',
  ].includes(normalized);
}

/**
 * Read a provider score as a 0-1 fraction. Providers report `0.85`, `"0.85"`,
 * `"85%"`, `"0,85"` and `85` for the same judgement, and `number01` turned the
 * last three into a zero, which failed the acceptance gate on a formatting quirk.
 * Returns null when nothing usable was reported, so a missing score is never read
 * as "scored zero" — callers distinguish "no reading" from "a low reading".
 */
function scoreFraction(value: unknown): number | null {
  const raw = typeof value === 'number' ? value
    : typeof value === 'string' ? Number(value.trim().replace(/\s*%\s*$/, '').replace(',', '.'))
    : Number.NaN;
  if (!Number.isFinite(raw)) return null;
  // A value above 1 cannot be a 0-1 fraction, so it is a percentage out of a hundred.
  const fraction = raw > 1 && raw <= 100 ? raw / 100 : raw;
  return Math.max(0, Math.min(1, fraction));
}
const page = (value: unknown): string | null => {
  const match = clean(value, 30).match(/(?:p\.?|page|página)\s*(\d+)/i);
  return match ? `p. ${match[1]}` : null;
};
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const sha1 = (value: string): string => createHash('sha1').update(value).digest('hex');

function isSectionAnalysis(value: unknown): value is SectionAnalysis {
  // Providers commonly omit optional empty arrays or wrap the requested object.
  // Accept only an object here and let the conservative normalizer plus literal
  // quote matching and the independent audit reject unsupported content.
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function normalizeSectionAnalysis(value: unknown, fallbackTitle: string): SectionAnalysis {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const nested = [root.section_analysis, root.analysis].find(
    (candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate),
  ) as Record<string, unknown> | undefined;
  const item = nested ?? root;
  return {
    title: clean(item.title, 300) || fallbackTitle,
    summary: clean(item.summary, 4_000),
    role: clean(item.role, 300),
    concepts: strings(item.concepts),
    claims: (Array.isArray(item.claims) ? item.claims : []).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const claim = entry as unknown as Record<string, unknown>;
      const text = clean(claim.text, 1_500);
      const quote = clean(claim.support_quote, 1_200);
      return text && quote ? [{ text, support_quote: quote, page: page(claim.page), confidence: number01(claim.confidence) }] : [];
    }).slice(0, 16),
  };
}

function normalizeDirectSupportConfidence(analysis: SectionAnalysis): SectionAnalysis {
  return {
    ...analysis,
    claims: analysis.claims.map((claim) => ({
      ...claim,
      // Confidence is evidence metadata, not an unchecked model opinion. Once a
      // claim has survived literal matching and the independent section audit,
      // zero is internally contradictory and makes the document auditor reject
      // otherwise valid evidence at random.
      confidence: Math.max(DIRECT_SUPPORT_CONFIDENCE_FLOOR, claim.confidence),
    })),
  };
}

function normalizeSectionAuditResponse(value: unknown, fallbackTitle: string): SectionAuditResponse {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const nested = root.section_audit && typeof root.section_audit === 'object' && !Array.isArray(root.section_audit)
    ? root.section_audit as Record<string, unknown>
    : null;
  const item = nested ?? root;
  const rawPassed = item.passed;
  const passed = verdictPassed(rawPassed);
  const rawIssues = Array.isArray(item.issues) ? item.issues : item.issues == null ? [] : [item.issues];
  const candidate = item.analysis ?? item.corrected_analysis;
  const analysis = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? normalizeSectionAnalysis(candidate as SectionAnalysis, fallbackTitle)
    : null;
  return { passed, issues: rawIssues.map((issue) => clean(issue, 1_000)).filter(Boolean).slice(0, 30), analysis };
}

function isProfileSynthesis(value: unknown): value is ProfileSynthesis {
  // The synthesis/repair pass is followed by stricter deterministic checks. Let
  // those checks reject an incomplete profile with a useful quality error instead
  // of failing early because a provider omitted an empty array or wrapped the
  // requested object in `profile`.
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const FIELD_KINDS = new Set<DocumentProfileFieldKind>([
  'object','problem','question','hypothesis','thesis','argument','method','sources','concept','temporal_scope',
  'geographic_scope','disciplinary_scope','structure','finding','conclusion','contribution','limitation',
  'genre','audience','positioning','original_abstract',
]);

function normalizeProfile(value: unknown): ProfileSynthesis {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const nested = root.profile && typeof root.profile === 'object' && !Array.isArray(root.profile)
    ? root.profile as Record<string, unknown>
    : null;
  const item = nested ?? root;
  return {
    source_language: clean(item.source_language, 20) || 'und',
    overview: clean(item.overview, 5_000),
    fields: (Array.isArray(item.fields) ? item.fields : []).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const field = entry as unknown as Record<string, unknown>;
      const kind = clean(field.kind, 40) as DocumentProfileFieldKind;
      const text = clean(field.text, 3_000);
      const support = clean(field.support_quote, 1_200);
      if (!FIELD_KINDS.has(kind) || !text || !support) return [];
      return [{ kind, text, support_quote: support, page: page(field.page), confidence: number01(field.confidence), centrality: number01(field.centrality), confidenceSource: 'model' as const }];
    }).slice(0, 80),
  };
}

function isAuditResponse(value: unknown): value is AuditResponse {
  // Gemini Flash Lite occasionally returns a structurally useful audit with a
  // numeric string, a single issue string or an omitted optional repair list.
  // Rejecting that whole object turns an ordinary "repair this profile" verdict
  // into a terminal schema error. The normalizer below remains conservative:
  // absent/unknown verdicts become failed, never passed.
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Normalize provider JSON without ever promoting an ambiguous audit to passed. */
export function normalizeDocumentProfileAuditResponse(value: unknown): AuditResponse {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const nested = root.audit && typeof root.audit === 'object' && !Array.isArray(root.audit)
    ? root.audit as Record<string, unknown>
    : null;
  const item = nested ?? root;
  const rawPassed = item.passed;
  const passed = verdictPassed(rawPassed);
  const rawIssues = Array.isArray(item.issues) ? item.issues : item.issues == null ? [] : [item.issues];
  const rawFixes = Array.isArray(item.field_fixes) ? item.field_fixes : [];
  return {
    passed,
    score: scoreFraction(item.score),
    issues: rawIssues.map((issue) => clean(issue, 1_000)).filter(Boolean).slice(0, 50),
    field_fixes: rawFixes.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const fix = entry as Record<string, unknown>;
      const index = Math.trunc(Number(fix.index));
      if (!Number.isFinite(index) || index < 0) return [];
      return [{ index, text: clean(fix.text, 3_000), support_quote: clean(fix.support_quote, 1_200) }];
    }).slice(0, 80),
    overview: clean(item.overview, 5_000),
  };
}

/**
 * The diagnostics of a refused profile, appended to its audit issues.
 *
 * The tags are deliberately language-neutral: this sentence is stored as the profile's error,
 * printed verbatim in the processing log and pasted into a GitHub issue, so it is read by
 * someone whose interface language is unknown and is never translated. Spanish keys inside an
 * English log were exactly the kind of fragment the log is supposed to avoid.
 */
function auditFailureMessage(audit: DocumentProfileAudit): string {
  const details = [
    ...audit.issues,
    `verdict=${audit.passed ? 'approved' : 'rejected'}`,
    `score=${audit.score == null ? 'none' : audit.score.toFixed(2)}`,
    `support=${audit.supportCoverage.toFixed(2)}`,
    `structure=${audit.structureCoverage.toFixed(2)}`,
  ];
  return details.join(' · ');
}

/** A synthesis publishes without a caveat only when the auditor approved it and its
 *  score cleared the acceptance bar. A missing score is not a zero: the verdict is
 *  then decided by `passed` alone, and the profile is published with its own mode. */
function semanticApproved(verdict: AuditResponse | null): boolean {
  if (!verdict?.passed) return false;
  return verdict.score == null || verdict.score >= SEMANTIC_ACCEPTANCE_SCORE;
}

interface SourceLocation {
  label: string | null;
  sourceRef: string | null;
  pageNumber: number | null;
}

function parseSourceLocationAt(text: string, offset: number, sourceMap: Record<string, string> = {}): SourceLocation {
  let found: RegExpExecArray | null = null;
  const pattern = /\[\[(?:src:(s\d+)(?:\s+p\.\s*(\d+))?|p\.\s*(\d+))\]\]/gi;
  for (const match of text.matchAll(pattern)) {
    if ((match.index ?? 0) > offset) break;
    found = match as RegExpExecArray;
  }
  if (!found) return { label: null, sourceRef: null, pageNumber: null };
  const marker = found[1] ?? null;
  const pageNumber = Number(found[2] ?? found[3]) || null;
  return {
    label: pageNumber == null ? null : `p. ${pageNumber}`,
    sourceRef: marker == null ? null : sourceMap[marker] ?? marker,
    pageNumber,
  };
}

/**
 * Where a range that starts at `start` ends, without leaving the start's source. The
 * last marker before `end` can belong to the next attachment when a section runs past
 * a source boundary; its page number then counts pages of a different file (a section
 * "p. 1099–12"). Walk back to the last marker still inside the start's source instead;
 * page-only markers inherit the source of the marker before them.
 */
function rangeEndLocation(text: string, start: SourceLocation, end: number, sourceMap: Record<string, string> = {}): SourceLocation {
  const raw = parseSourceLocationAt(text, end, sourceMap);
  if (!start.sourceRef || !raw.sourceRef || raw.sourceRef === start.sourceRef) return raw;
  let current: string | null = null;
  let last: SourceLocation | null = null;
  const pattern = /\[\[(?:src:(s\d+)(?:\s+p\.\s*(\d+))?|p\.\s*(\d+))\]\]/gi;
  for (const match of text.matchAll(pattern)) {
    if ((match.index ?? 0) > end) break;
    if (match[1]) current = sourceMap[match[1]] ?? match[1];
    if (current !== start.sourceRef) continue;
    const pageNumber = Number(match[2] ?? match[3]) || null;
    last = { label: pageNumber == null ? null : `p. ${pageNumber}`, sourceRef: current, pageNumber };
  }
  return last ?? start;
}

function headingMatches(text: string, sourceMap: Record<string, string>): Array<{ index: number; end: number; level: number; title: string; location: SourceLocation }> {
  const result: Array<{ index: number; end: number; level: number; title: string; location: SourceLocation }> = [];
  const pattern = /^(#{1,6})[ \t]+([^\n]+)$/gm;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    result.push({ index, end: index + match[0].length, level: match[1].length, title: clean(match[2], 300), location: parseSourceLocationAt(text, index, sourceMap) });
  }
  return result;
}

function chunksWithOffsets(text: string, wordsPerChunk = 3_500): Array<{ start: number; end: number; body: string }> {
  const words = [...text.matchAll(/\S+/g)];
  if (!words.length) return [];
  const chunks: Array<{ start: number; end: number; body: string }> = [];
  for (let startWord = 0; startWord < words.length; startWord += wordsPerChunk) {
    const endWord = Math.min(words.length, startWord + wordsPerChunk);
    const start = words[startWord].index ?? 0;
    const last = words[endWord - 1];
    const end = (last.index ?? 0) + last[0].length;
    chunks.push({ start, end, body: text.slice(start, end) });
  }
  return chunks;
}

/**
 * Fold chunks too short to be a section into their neighbour.
 *
 * A PDF that publishes without Markdown headings is chunked by size, and the first thing a
 * journal PDF prints is a cover: the masthead, the issue, the ISSN, the authors' affiliations.
 * That page and the block of footnote definitions at the end were becoming sections of their
 * own — a hundred and fifty characters, sometimes thirty-six — and no model can synthesise a
 * section out of them, so their analyses degraded, their summaries were published as literal
 * extracts and the whole profile fell back to the extractive mode. The text is not dropped:
 * a short chunk joins its neighbour, so the sections still tile the document exactly and
 * nothing changes for a document whose chunks are all substantial.
 */
function mergeUndersizedChunks(
  text: string,
  chunks: Array<{ start: number; end: number; body: string }>,
): Array<{ start: number; end: number; body: string }> {
  const substantial = (body: string): boolean => body.split(/\s+/).filter(Boolean).length >= MIN_SECTION_WORDS;
  if (chunks.length <= 1 || chunks.every((chunk) => substantial(chunk.body))) return chunks;
  const merged: Array<{ start: number; end: number; body: string }> = [];
  let pendingStart: number | null = null;
  for (const chunk of chunks) {
    if (pendingStart != null) {
      // A short leading chunk waits for the first substantial one to absorb it.
      if (!substantial(chunk.body)) continue;
      merged.push({ start: pendingStart, end: chunk.end, body: text.slice(pendingStart, chunk.end) });
      pendingStart = null;
      continue;
    }
    const previous = merged[merged.length - 1];
    if (!substantial(chunk.body) && previous) {
      merged[merged.length - 1] = { start: previous.start, end: chunk.end, body: text.slice(previous.start, chunk.end) };
      continue;
    }
    if (!substantial(chunk.body) && !previous) {
      pendingStart = chunk.start;
      continue;
    }
    merged.push(chunk);
  }
  // Everything was short — a stub document, not a structure to merge. Keep the tiling as it
  // came, and the profile's own gates decide what can be published from it.
  if (pendingStart != null) merged.push({ start: pendingStart, end: text.length, body: text.slice(pendingStart) });
  return merged.length ? merged : chunks;
}

/** Pure, stable structural pass reused by tests and the scanner. */
export function deriveDocumentStructure(text: string, fallbackTitle: string, sourceMap: Record<string, string> = {}): DerivedDocumentSection[] {
  const headings = headingMatches(text, sourceMap);
  if (headings.length === 0) {
    return mergeUndersizedChunks(text, chunksWithOffsets(text)).map((chunk, ordinal) => {
      const start = parseSourceLocationAt(text, chunk.start, sourceMap);
      const end = rangeEndLocation(text, start, chunk.end, sourceMap);
      return ({
      sectionId: `section-${sha256(`${fallbackTitle}|${ordinal}|${sha256(chunk.body)}`).slice(0, 24)}`,
      parentSectionId: null, level: 1, ordinal, title: ordinal === 0 ? fallbackTitle : '',
      role: null, summary: '', concepts: [], claims: [], pageStart: start.label,
      pageEnd: end.label, sourceRef: start.sourceRef ?? end.sourceRef,
      pageStartNumber: start.pageNumber, pageEndNumber: end.pageNumber,
      charStart: chunk.start, charEnd: chunk.end,
      contentHash: sha256(chunk.body), body: chunk.body,
      });
    });
  }
  const sections: DerivedDocumentSection[] = [];
  const parents: Array<{ level: number; id: string }> = [];
  const preamble = headings[0].index > 0 ? text.slice(0, headings[0].index) : '';
  const keepsPreambleSection = headings[0].index > 0 && preamble.split(/\s+/).length >= MIN_SECTION_WORDS;
  if (keepsPreambleSection) {
    const body = preamble;
    sections.push({
      sectionId: `section-${sha256(`${fallbackTitle}|front|${sha256(body)}`).slice(0, 24)}`,
      parentSectionId: null, level: 1, ordinal: 0, title: fallbackTitle, role: null, summary: '',
      concepts: [], claims: [], pageStart: parseSourceLocationAt(text, 0, sourceMap).label,
      pageEnd: parseSourceLocationAt(text, headings[0].index, sourceMap).label,
      sourceRef: parseSourceLocationAt(text, headings[0].index, sourceMap).sourceRef,
      pageStartNumber: parseSourceLocationAt(text, 0, sourceMap).pageNumber,
      pageEndNumber: parseSourceLocationAt(text, headings[0].index, sourceMap).pageNumber,
      charStart: 0, charEnd: headings[0].index, contentHash: sha256(body), body,
    });
  }
  // A short preamble (a title block, an author list) is not worth a section of its
  // own, but it still belongs to the document. Leaving it out of every section left
  // a hole that structure coverage counted as missing text, so an otherwise perfect
  // profile was rejected — and the literal fallback with it — for a reason no model
  // can influence. The first section absorbs it instead: every character of the
  // document stays inside exactly one section, whichever branch runs.
  const absorbPreamble = headings[0].index > 0 && !keepsPreambleSection && preamble.trim().length > 0;
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const end = headings[index + 1]?.index ?? text.length;
    const absorb = index === 0 && absorbPreamble;
    // A section covers its heading too: skip only the heading's own characters when
    // slicing the body, never when recording the range.
    const body = text.slice(absorb ? 0 : heading.end, end).trim();
    if (!body) continue;
    while (parents.length && parents.at(-1)!.level >= heading.level) parents.pop();
    const startLocation = absorb ? parseSourceLocationAt(text, 0, sourceMap) : heading.location;
    const endLocation = rangeEndLocation(text, startLocation, end, sourceMap);
    const sectionId = `section-${sha256(`${heading.level}|${heading.title}|${startLocation.label ?? ''}|${index}|${sha256(body)}`).slice(0, 24)}`;
    sections.push({
      sectionId, parentSectionId: parents.at(-1)?.id ?? null, level: heading.level,
      ordinal: sections.length, title: heading.title, role: null, summary: '', concepts: [], claims: [],
      pageStart: startLocation.label, pageEnd: endLocation.label,
      sourceRef: startLocation.sourceRef ?? endLocation.sourceRef,
      pageStartNumber: startLocation.pageNumber, pageEndNumber: endLocation.pageNumber,
      charStart: absorb ? 0 : heading.index, charEnd: end,
      contentHash: sha256(body), body,
    });
    parents.push({ level: heading.level, id: sectionId });
  }
  return sections;
}

/**
 * How many tokens one background request may spend on its prompt before the model's own
 * window is at risk. Cloud models return null and keep their current sizing. The 60 %
 * leaves room for the answer, which for these calls is a JSON document of the same order
 * as the request.
 */
async function localPromptTokenBudget(model: ModelRef | null): Promise<number | null> {
  try {
    // The pipeline passes an override or null for "the configured model", and it is that
    // model whose window has to be respected.
    const window = await localModelContextWindow(model ?? resolveModelRef(null));
    if (!window) return null;
    return Math.max(1_000, Math.floor(window * 0.6));
  } catch {
    // A provider that cannot be interrogated is treated as a cloud model: the previous
    // behaviour, rather than a guess that could shrink every request.
    return null;
  }
}

/** Prompt cost of one request, system pack included. Measuring only the payload would
 *  leave the instruction pack — the larger half for the smallest windows — uncounted. */
function promptTokens(system: string, body: unknown): number {
  return estimateLocalTokens(system) + estimateLocalTokens(typeof body === 'string' ? body : JSON.stringify(body));
}

function promptFits(system: string, body: unknown, budget: number | null | undefined): boolean {
  return budget == null || promptTokens(system, body) <= budget;
}

function splitAnalysisParts(body: string, tokenBudget?: number | null): string[] {
  let wordsPerChunk = ANALYSIS_WORDS;
  // A local model with a small window would otherwise get a 2,500-word fragment it
  // cannot hold. Scale the fragment to the window using the text's own density.
  if (tokenBudget != null) {
    const words = body.split(/\s+/).filter(Boolean).length;
    const tokens = estimateLocalTokens(body);
    if (words > 0 && tokens > tokenBudget) {
      wordsPerChunk = Math.max(120, Math.min(ANALYSIS_WORDS, Math.floor((words * tokenBudget) / tokens)));
    }
  }
  return chunksWithOffsets(body, wordsPerChunk).map((chunk) => chunk.body);
}

function providerShapeFailure(error: unknown): boolean {
  return (error instanceof AiError && !error.retriable && !error.config
      && (error.code === 'invalid_json' || /json|esquema/i.test(error.message)))
    || error instanceof SyntaxError;
}

function structuredOutputFailure(error: unknown): boolean {
  return providerShapeFailure(error)
    || (error instanceof AiError && error.code === 'output_truncated');
}

/** A prompt the model could not hold. It is a sizing problem rather than a bad answer, so
 *  every stage here can answer it by shrinking (a smaller fragment, a compact audit) or by
 *  degrading locally — never by failing a whole work because its model loaded a small window. */
function contextOverflow(error: unknown): boolean {
  if (!(error instanceof AiError)) return false;
  return error.code === 'context_overflow'
    || /not enough context|context length|context window|n_ctx|tokens to keep|maximum context|suficiente contexto/i.test(error.message);
}

function recoverablePromptFailure(error: unknown): boolean {
  return structuredOutputFailure(error) || contextOverflow(error);
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mergeSectionAnalyses(values: SectionAnalysis[], fallbackTitle: string): SectionAnalysis {
  const claims = new Map<string, RawClaim>();
  for (const claim of values.flatMap((value) => value.claims)) {
    const existing = claims.get(claim.support_quote);
    if (!existing || existing.confidence < claim.confidence) claims.set(claim.support_quote, claim);
  }
  return {
    title: values.find((value) => value.title.trim())?.title ?? fallbackTitle,
    summary: clean(values.map((value) => value.summary).filter(Boolean).join(' '), 4_000),
    role: clean(values.map((value) => value.role).find(Boolean), 300),
    concepts: [...new Set(values.flatMap((value) => value.concepts).filter(Boolean))].slice(0, 24),
    claims: [...claims.values()].slice(0, 16),
    // Only a merge with no synthesised part at all is a quotation list.
    degraded: values.length > 0 && values.every((value) => value.degraded),
  };
}

function literalSectionFallback(evidence: string, title: string): SectionAnalysis {
  const quote = clean(evidence, 900);
  const claims: RawClaim[] = quote ? [{
    text: quote,
    support_quote: quote,
    page: null,
    confidence: DIRECT_SUPPORT_CONFIDENCE_FLOOR,
  }] : [];
  return { title, summary: quote, role: '', concepts: [], claims, degraded: true };
}

async function auditSectionAnalysis(
  evidence: string,
  candidate: SectionAnalysis,
  fallbackTitle: string,
  options: RunDocumentProfileOptions,
  splitDepth = 0,
): Promise<SectionAnalysis> {
  let current = { ...candidate, claims: candidate.claims.filter((claim) => quoteOffset(evidence, claim.support_quote) >= 0) };
  const literalClaims = new Map(current.claims.map((claim) => [claim.support_quote, claim]));
  let issues: string[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let response: SectionAuditResponse;
    try {
      response = normalizeSectionAuditResponse(await completeJson<SectionAuditResponse>({
        system: documentProfilePromptPack(options.language ?? getSettings().promptLanguage ?? 'es').sectionAudit,
        user: JSON.stringify({ fragment: evidence, analysis: current, prior_issues: issues }),
        temperature: 0, maxTokens: 5_000, signal: options.signal,
        requestClass: 'background', jobId: `${options.jobId}:section-audit`,
        perf: options.perf,
      }, isSectionAuditResponse, options.auditorModel), fallbackTitle);
    } catch (error) {
      if (recoverablePromptFailure(error) && current.claims.length > 1 && splitDepth < 4) {
        const middle = Math.ceil(current.claims.length / 2);
        const audited = await mapOrderedPool(
          [current.claims.slice(0, middle), current.claims.slice(middle)],
          2,
          (claims, _index, poolSignal) => auditSectionAnalysis(
            evidence,
            { ...current, claims },
            fallbackTitle,
            { ...options, signal: poolSignal },
            splitDepth + 1,
          ),
          options.signal,
        );
        return mergeSectionAnalyses(audited, fallbackTitle);
      }
      if (!recoverablePromptFailure(error)) throw error;
      break;
    }
    issues = response.issues;
    if (response.passed) return normalizeDirectSupportConfidence(current);
    if (!response.analysis) break;
    current = {
      ...response.analysis,
      claims: response.analysis.claims.filter((claim) => quoteOffset(evidence, claim.support_quote) >= 0),
    };
    for (const claim of current.claims) literalClaims.set(claim.support_quote, claim);
  }
  // A provider verdict must never force us to publish a disputed paraphrase, but
  // it also should not make a readable document permanently unindexable. Fall
  // back to an extractive representation whose prose is itself literal evidence;
  // the independent document-level audit still decides whether the resulting
  // macro profile is complete enough to publish.
  const sourceClaims = literalClaims.size
    ? [...literalClaims.values()]
    : literalSectionFallback(evidence, fallbackTitle).claims;
  const claims = sourceClaims.slice(0, 12).map((claim) => ({
    ...claim,
    text: claim.support_quote,
    confidence: DIRECT_SUPPORT_CONFIDENCE_FLOOR,
  }));
  return {
    title: fallbackTitle,
    summary: claims.slice(0, 3).map((claim) => claim.support_quote).join(' '),
    role: '',
    concepts: [],
    claims,
    degraded: true,
  };
}

async function analyzeSectionPart(
  evidence: string,
  key: string,
  title: string,
  pageStart: string | null,
  options: RunDocumentProfileOptions,
  depth = 0,
): Promise<SectionAnalysis> {
  const hash = checkpointHash(options, evidence);
  const cached = readDocumentCheckpoint<SectionAnalysis>(options.jobId, key, hash);
  if (cached) return cached;
  let candidate: SectionAnalysis;
  try {
    candidate = normalizeSectionAnalysis(await completeJson<SectionAnalysis>({
      system: documentProfilePromptPack(options.language ?? getSettings().promptLanguage ?? 'es').section,
      user: JSON.stringify({ section_title: title, page_start: pageStart, fragment: evidence }),
      temperature: 0, maxTokens: 4_000, signal: options.signal,
      requestClass: 'background', jobId: `${options.jobId}:${key}`,
      perf: options.perf,
    }, isSectionAnalysis, options.generatorModel), title);
  } catch (error) {
    const words = evidence.split(/\s+/).filter(Boolean).length;
    if (recoverablePromptFailure(error) && words >= 400 && depth < 4) {
      const childWords = Math.max(120, Math.ceil(words / 2));
      const children = chunksWithOffsets(evidence, childWords).map((chunk) => chunk.body);
      if (children.length >= 2) {
        const values = await mapOrderedPool(
          children,
          Math.min(2, children.length),
          (child, index, poolSignal) => analyzeSectionPart(
            child,
            `${key}:split:${depth}:${index}`,
            title,
            pageStart,
            { ...options, signal: poolSignal },
            depth + 1,
          ),
          options.signal,
        );
        const merged = mergeSectionAnalyses(values, title);
        saveDocumentCheckpoint(options.jobId, key, hash, merged);
        return merged;
      }
    }
    if (!recoverablePromptFailure(error)) throw error;
    candidate = literalSectionFallback(evidence, title);
  }
  const literal = { ...candidate, claims: candidate.claims.filter((claim) => quoteOffset(evidence, claim.support_quote) >= 0) };
  const value = await auditSectionAnalysis(evidence, literal, title, options);
  saveDocumentCheckpoint(options.jobId, key, hash, value);
  return value;
}

/**
 * A checkpoint belongs to the models that wrote it, not only to its input. Keyed by the
 * evidence alone, a job resumed with another generator or auditor (the same-campaign
 * resume switches models in place) reused the previous models' sections.
 */
function checkpointHash(options: Pick<RunDocumentProfileOptions, 'generatorModel' | 'auditorModel'>, content: string): string {
  return sha256(JSON.stringify([options.generatorModel, options.auditorModel, content]));
}

async function analyzeSection(section: DerivedDocumentSection, options: RunDocumentProfileOptions): Promise<SectionAnalysis> {
  const sectionPack = documentProfilePromptPack(options.language ?? getSettings().promptLanguage ?? 'es').section;
  // The section audit sends the fragment AND the analysis of it, so the fragment may only
  // spend part of what is left after the pack; otherwise the audit prompt is the one that
  // no longer fits.
  const evidenceBudget = options.promptTokenBudget == null
    ? null
    : Math.max(120, Math.floor((options.promptTokenBudget - estimateLocalTokens(sectionPack)) * 0.8));
  const parts = splitAnalysisParts(section.body, evidenceBudget);
  const settings = getSettings();
  const poolSize = settings.aiConcurrencyMode === 'automatic' ? 8 : Math.max(1, Math.min(8, settings.concurrency));
  const analyses = await mapOrderedPool(parts, poolSize, async (part, index, poolSignal) => {
    const key = `section:${section.sectionId}:part:${index}`;
    return analyzeSectionPart(part, key, section.title, section.pageStart, { ...options, signal: poolSignal });
  }, options.signal);
  if (analyses.length === 1) return analyses[0];
  const reduceHash = checkpointHash(options, JSON.stringify(analyses));
  const cached = readDocumentCheckpoint<SectionAnalysis>(options.jobId, `section:${section.sectionId}:reduced`, reduceHash);
  if (cached) return cached;
  let candidate: SectionAnalysis;
  try {
    candidate = normalizeSectionAnalysis(await completeJson<SectionAnalysis>({
      system: documentProfilePromptPack(options.language ?? getSettings().promptLanguage ?? 'es').reduce, user: JSON.stringify({ title: section.title, analyses }),
      temperature: 0, maxTokens: 5_000, signal: options.signal,
      requestClass: 'background', jobId: `${options.jobId}:section:${section.sectionId}:reduce`,
      perf: options.perf,
    }, isSectionAnalysis, options.generatorModel), section.title);
  } catch (error) {
    // A merge the model cannot hold is not a reason to fail: the parts were analysed and
    // audited individually, so merging them here is the smaller, deterministic answer.
    if (!recoverablePromptFailure(error)) throw error;
    candidate = mergeSectionAnalyses(analyses, section.title);
  }
  const literal = { ...candidate, claims: candidate.claims.filter((claim) => quoteOffset(section.body, claim.support_quote) >= 0) };
  // Auditing the merged analysis against the whole section body is the largest prompt this
  // pipeline builds, and there is nothing to shrink: the evidence is the section, not a
  // fragment. When the model's window cannot hold it, the merged summary is left to the
  // document-level audit — which receives every section summary with its claims — instead of
  // failing the work or degrading a section whose parts each passed their own audit.
  if (!promptFits(sectionPack, { fragment: section.body, analysis: literal }, options.promptTokenBudget)) {
    saveDocumentCheckpoint(options.jobId, `section:${section.sectionId}:reduced`, reduceHash, literal);
    return literal;
  }
  const reduced = await auditSectionAnalysis(section.body, literal, section.title, options);
  saveDocumentCheckpoint(options.jobId, `section:${section.sectionId}:reduced`, reduceHash, reduced);
  return reduced;
}

function collapsedLiteralText(value: string): { text: string; offsets: number[] } {
  let text = '';
  const offsets: number[] = [];
  let inWhitespace = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (/\s/u.test(character)) {
      if (!inWhitespace) {
        text += ' ';
        offsets.push(index);
        inWhitespace = true;
      }
      continue;
    }
    const normalized = character.normalize('NFKC').toLocaleLowerCase();
    text += normalized;
    for (let emitted = 0; emitted < normalized.length; emitted += 1) offsets.push(index);
    inWhitespace = false;
  }
  return { text, offsets };
}

function quoteOffset(text: string, quote: string): number {
  const direct = text.toLocaleLowerCase().indexOf(quote.toLocaleLowerCase());
  if (direct >= 0) return direct;
  const haystack = collapsedLiteralText(text);
  const needle = collapsedLiteralText(quote).text.trim();
  if (!needle) return -1;
  const normalizedOffset = haystack.text.indexOf(needle);
  return normalizedOffset >= 0 ? (haystack.offsets[normalizedOffset] ?? -1) : -1;
}

/** Collapsed prefixes of a quote, longest first. A quote can run past the end of its
 * chunk; one shorter than the floor (a running head: "Index I:15") is matched whole. */
function quoteNeedles(quote: string): string[] {
  const collapsedQuote = collapsedLiteralText(quote).text.trim();
  const needles: string[] = [];
  for (const length of [60, 40, 24]) {
    const needle = collapsedQuote.slice(0, length).trim();
    if (needle.length < Math.min(12, collapsedQuote.length)) break;
    needles.push(needle);
  }
  return needles;
}

/** How much of a quote's opening a passage holds: the longest of quoteNeedles it contains,
 * 0 for none. Short prefixes can match inside unrelated words ("regla adición" holds "la
 * adición"), so passages are compared by this length, longest first, as passageForQuote does. */
/** The most of a quote's opening any passage can hold: its longest needle's length. A passage
 * already holding that much cannot be bettered by another. */
export function fullQuoteMatchLength(quote: string): number {
  return quoteNeedles(quote)[0]?.length ?? 0;
}

export function quoteMatchLength(text: string, quote: string): number {
  const haystack = collapsedLiteralText(text).text;
  return quoteNeedles(quote).find((needle) => haystack.includes(needle))?.length ?? 0;
}

/**
 * The passage a support's citation jump opens. The quote's literal offset already fixed
 * its source and page, so the passage must agree with them: first a passage of that
 * source that literally contains the start of the quote (nearest page at or before the
 * quote's), and only then the best word overlap among that source's passages that start
 * at or before the quote's page. Choosing by overlap across the whole document picked a
 * passage elsewhere that happened to share the quote's words.
 */
/** A passage's collapsed literal text, computed once per row object: resolving many quotes of
 *  one work (the support repair) would otherwise re-normalise the whole work for each. */
const collapsedPassageTexts = new WeakMap<object, string>();
function collapsedPassageText(row: { text: string }): string {
  let text = collapsedPassageTexts.get(row);
  if (text === undefined) {
    text = collapsedLiteralText(row.text).text;
    collapsedPassageTexts.set(row, text);
  }
  return text;
}

/** A work's stored passages, as passageForQuote reads them. */
export type StoredPassageRow = { passage_id: string; text: string; source_ref: string | null; page_number: number | null };

export function passageForQuote(
  nodusId: string,
  quote: string,
  location: SourceLocation,
  candidate: PreparedPassages | null,
  /** The work's stored passages, already read: a caller resolving many quotes of one work
   *  reads them once instead of once per quote. */
  stored?: StoredPassageRow[],
): string | null {
  const all = stored ?? (candidate
    ? candidate.rows.map((row, index) => ({
      passage_id: `${nodusId}#${index}`, text: row.text, source_ref: row.sourceRef ?? null, page_number: row.pageNumber ?? null,
    }))
    : getDb().prepare('SELECT passage_id,text,source_ref,page_number FROM passages WHERE nodus_id=? ORDER BY chunk_index')
      .all(nodusId) as StoredPassageRow[]);
  const sameSource = location.sourceRef ? all.filter((row) => row.source_ref === location.sourceRef) : [];
  const rows = sameSource.length ? sameSource : all.filter((row) => row.source_ref == null || !location.sourceRef);
  const startsBefore = (row: { page_number: number | null }) =>
    location.pageNumber == null || row.page_number == null || row.page_number <= location.pageNumber;
  const distance = (row: { page_number: number | null }) =>
    location.pageNumber == null || row.page_number == null ? 0 : location.pageNumber - row.page_number;
  const nearest = <T extends { page_number: number | null }>(list: T[]): T | null =>
    list.reduce<T | null>((best, row) => (best == null || distance(row) < distance(best) ? row : best), null);

  // A quote can run past the end of its chunk, so try shorter prefixes before giving up.
  const haystacks = rows.map(collapsedPassageText);
  for (const needle of quoteNeedles(quote)) {
    const containing = rows.filter((_, index) => haystacks[index].includes(needle));
    const chosen = nearest(containing.filter(startsBefore)) ?? nearest(containing);
    if (chosen) return chosen.passage_id;
  }

  const terms = quote.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 4).slice(0, 8);
  if (!terms.length) return null;
  let best: { id: string; score: number; distance: number } | null = null;
  for (const row of rows.filter(startsBefore)) {
    const haystack = row.text.toLocaleLowerCase();
    const score = terms.filter((term) => haystack.includes(term)).length / terms.length;
    const rowDistance = distance(row);
    if (!best || score > best.score || (score === best.score && rowDistance < best.distance)) {
      best = { id: row.passage_id, score, distance: rowDistance };
    }
  }
  return best && best.score >= 0.45 ? best.id : null;
}

function supportForQuote(input: {
  nodusId: string; text: string; quote: string; targetKind: 'field' | 'section'; targetId: string;
  sections: DerivedDocumentSection[]; confidence: number;
  candidatePassages: PreparedPassages | null;
  sourceMap: Record<string, string>;
}): DocumentProfileSupport | null {
  const offset = quoteOffset(input.text, input.quote);
  if (offset < 0) return null;
  const section = input.sections.find((candidate) =>
    candidate.charStart != null && candidate.charEnd != null && offset >= candidate.charStart && offset <= candidate.charEnd
  ) ?? null;
  const location = parseSourceLocationAt(input.text, offset, input.sourceMap);
  return {
    supportId: randomUUID(), targetKind: input.targetKind, targetId: input.targetId,
    sectionId: section?.sectionId ?? null, passageId: passageForQuote(input.nodusId, input.quote, location, input.candidatePassages),
    // A provider-supplied page label is never sufficient provenance. The quote's
    // literal offset must resolve against an extracted marker or the page stays null.
    pageStart: location.label, pageEnd: location.label,
    sourceRef: location.sourceRef, pageStartNumber: location.pageNumber, pageEndNumber: location.pageNumber,
    quote: input.quote, supportKind: 'direct', confidence: input.confidence, validationStatus: 'valid',
  };
}

async function preparePassages(
  work: Work,
  text: string,
  options: RunDocumentProfileOptions,
  sourceMap: Record<string, string> = {},
): Promise<PreparedPassages | null> {
  return prepareLegacyDocumentaryPassages(work.nodus_id, text, sourceMap, 'fulltext', options.signal);
}

function synthesisPayload(
  work: Work,
  sections: DerivedDocumentSection[],
  analyses: Map<string, SectionAnalysis>,
  abstract: string | null
): Record<string, unknown> {
  return {
    metadata: {
      title: work.title, authors: (() => { try { return JSON.parse(work.authors_json || '[]'); } catch { return []; } })(),
      year: work.year, item_type: work.item_type, original_abstract: abstract,
    },
    sections: sections.map((section) => ({
      id: section.sectionId, title: section.title, level: section.level, role: section.role,
      summary: section.summary, concepts: section.concepts,
      claims: analyses.get(section.sectionId)?.claims ?? section.claims.map((text) => ({ text })),
      page_start: section.pageStart, page_end: section.pageEnd,
    })),
  };
}

function mergeProfileSyntheses(profiles: ProfileSynthesis[]): ProfileSynthesis {
  const fields = new Map<string, RawProfileField>();
  for (const field of profiles.flatMap((profile) => profile.fields)) {
    const key = `${field.kind}\0${field.support_quote}`;
    const existing = fields.get(key);
    if (!existing || existing.confidence < field.confidence) fields.set(key, field);
  }
  return {
    source_language: profiles.find((profile) => profile.source_language !== 'und')?.source_language ?? 'und',
    overview: clean(profiles.map((profile) => profile.overview).filter(Boolean).join(' '), 5_000),
    fields: [...fields.values()].slice(0, 80),
  };
}

async function synthesizeProfileAdaptive(
  input: Record<string, unknown>,
  options: RunDocumentProfileOptions,
  splitPath = 'root',
  splitDepth = 0,
): Promise<ProfileSynthesis> {
  const inputHash = checkpointHash(options, JSON.stringify(input));
  const checkpointType = splitPath === 'root' ? 'profile:synthesis' : `profile:synthesis:${splitPath}`;
  const checkpoint = readDocumentCheckpoint<ProfileSynthesis>(options.jobId, checkpointType, inputHash);
  if (checkpoint) return checkpoint;
  const inputSections = Array.isArray(input.sections) ? input.sections : [];
  const synthesisPack = documentProfilePromptPack(options.language ?? getSettings().promptLanguage ?? 'es').profile;
  const splitInput = async (): Promise<ProfileSynthesis> => {
    const middle = Math.ceil(inputSections.length / 2);
    const halves = [inputSections.slice(0, middle), inputSections.slice(middle)];
    const profiles = await mapOrderedPool(
      halves,
      2,
      (sections, index, poolSignal) => synthesizeProfileAdaptive(
        { ...input, sections },
        { ...options, signal: poolSignal },
        `${splitPath}.${index}`,
        splitDepth + 1,
      ),
      options.signal,
    );
    const merged = mergeProfileSyntheses(profiles);
    saveDocumentCheckpoint(options.jobId, checkpointType, inputHash, merged);
    return merged;
  };
  // Proactive: a payload that cannot fit the loaded window is split before the request is
  // sent, rather than after the provider refuses it or truncates its answer.
  if (!promptFits(synthesisPack, input, options.promptTokenBudget) && inputSections.length >= 2 && splitDepth < 6) return splitInput();
  try {
    const profile = normalizeProfile(await completeJson<ProfileSynthesis>({
      system: documentProfilePromptPack(options.language ?? getSettings().promptLanguage ?? 'es').profile,
      user: JSON.stringify(input),
      temperature: 0,
      maxTokens: 8_000,
      signal: options.signal,
      requestClass: 'background',
      jobId: `${options.jobId}:profile:synthesis:${splitPath}`,
      perf: options.perf,
    }, isProfileSynthesis, options.generatorModel));
    saveDocumentCheckpoint(options.jobId, checkpointType, inputHash, profile);
    return profile;
  } catch (error) {
    if (!recoverablePromptFailure(error) || inputSections.length < 2 || splitDepth >= 6) throw error;
    return splitInput();
  }
}

/** A copy of the audit payload small enough for a provider whose answer to the full one
 *  ran out of output budget. The response has to echo the corrections it proposes
 *  (`field_fixes`, `overview`), so it can only be as large as what it was given:
 *  compacting the request is what makes the answer fit, and it keeps every field and
 *  section present so the verdict still covers the whole profile. */
function compactAuditPayload(profile: ProfileSynthesis, sections: unknown): { profile: unknown; sections: unknown[] } {
  const claim = (value: unknown): unknown => {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return { text: clean(record.text, 200), support_quote: clean(record.support_quote, 120) };
  };
  return {
    profile: {
      ...profile,
      overview: clean(profile.overview, 800),
      fields: profile.fields.map((field) => ({
        ...field, text: clean(field.text, 400), support_quote: clean(field.support_quote, 200),
      })),
    },
    sections: (Array.isArray(sections) ? sections : []).map((value: unknown) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      return {
        id: record.id, title: clean(record.title, 200), role: record.role,
        summary: clean(record.summary, 600), page_start: record.page_start, page_end: record.page_end,
        claims: (Array.isArray(record.claims) ? record.claims : []).slice(0, 4).map(claim),
      };
    }),
  };
}

function deterministicAudit(text: string, sections: DerivedDocumentSection[], profile: ProfileSynthesis): {
  supportCoverage: number; structureCoverage: number; supportedFields: RawProfileField[];
} {
  const supportedFields = profile.fields.filter((field) => quoteOffset(text, field.support_quote) >= 0);
  const covered = sections.reduce((total, section) => total + Math.max(0, (section.charEnd ?? 0) - (section.charStart ?? 0)), 0);
  return {
    supportCoverage: profile.fields.length ? supportedFields.length / profile.fields.length : 0,
    structureCoverage: text.length ? Math.min(1, covered / text.length) : 0,
    supportedFields,
  };
}

/** Keeps only fields whose support is literal in the source and records whether the
 *  published confidence was measured. Exported for unit testing. */
export function retainLiterallySupportedFields(text: string, profile: ProfileSynthesis): ProfileSynthesis {
  return {
    ...profile,
    fields: profile.fields
      .filter((field) => quoteOffset(text, field.support_quote) >= 0)
      .map((field) => ({
        ...field,
        // The floor is a publication contract (a literal support cannot be worth
        // nothing), not a measurement. When it replaces what the provider actually
        // reported, say so: the UI shows a bare percentage otherwise and every
        // field of a weak profile ends up reading "80 %" as if it had been scored.
        // This runs again after every audit and repair pass, so an existing floor
        // mark is sticky: the original reading is already gone from `confidence`.
        confidenceSource: field.confidenceSource === 'floor' || field.confidence < DIRECT_SUPPORT_CONFIDENCE_FLOOR ? 'floor' : 'model',
        confidence: Math.max(DIRECT_SUPPORT_CONFIDENCE_FLOOR, field.confidence),
      })),
  };
}

function evenlySample<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  return Array.from({ length: limit }, (_, index) => values[Math.floor((index * values.length) / limit)]);
}

/**
 * Last-resort profile for a readable work whose semantic synthesis remains
 * disputed after repair. It deliberately makes every field equal to literal
 * source text. This is less expressive than a thesis/method synthesis, but it
 * is safe for routing and prevents a large background campaign from acquiring
 * permanent holes because an auditor dislikes a paraphrase or a date boundary.
 */
function buildExtractiveProfileFallback(
  work: Work,
  sections: DerivedDocumentSection[],
  analyses: Map<string, SectionAnalysis>,
  sourceLanguage: string,
): ProfileSynthesis {
  const representatives: Array<{ quote: string; page: string | null }> = [];
  for (const section of sections) {
    const previous = analyses.get(section.sectionId);
    let claims = (previous?.claims ?? [])
      .filter((claim) => quoteOffset(section.body, claim.support_quote) >= 0)
      .map((claim) => ({
        ...claim,
        text: claim.support_quote,
        confidence: DIRECT_SUPPORT_CONFIDENCE_FLOOR,
      }));
    if (!claims.length) {
      const literal = clean(section.body, 900);
      if (literal) claims = [{
        text: literal,
        support_quote: literal,
        page: section.pageStart,
        confidence: DIRECT_SUPPORT_CONFIDENCE_FLOOR,
      }];
    }
    const safe = claims.slice(0, 3);
    const summary = safe.slice(0, 2).map((claim) => claim.support_quote).join(' ');
    analyses.set(section.sectionId, {
      title: section.title,
      summary,
      role: '',
      concepts: [],
      claims: safe,
      degraded: true,
    });
    section.role = null;
    section.summary = summary;
    section.concepts = [];
    section.claims = safe.map((claim) => claim.text);
    if (safe[0]) representatives.push({ quote: safe[0].support_quote, page: safe[0].page ?? section.pageStart });
  }
  const sampled = evenlySample(representatives, 12);
  if (!sampled.length) throw new Error('El documento no contiene ningún fragmento literal utilizable.');
  return {
    source_language: sourceLanguage || 'und',
    overview: clean(`${work.title}. ${sampled.slice(0, 4).map((item) => item.quote).join(' ')}`, 5_000),
    fields: sampled.map((item, index) => ({
      kind: 'argument',
      text: item.quote,
      // No provider measured this field: it *is* a quote, so the floor is the value.
      confidence: DIRECT_SUPPORT_CONFIDENCE_FLOOR,
      confidenceSource: 'floor' as const,
      centrality: index === 0 ? 0.7 : 0.6,
      support_quote: item.quote,
      page: item.page,
    })),
  };
}

function alignIdeas(nodusId: string, vectors: Array<{ sourceId: string; kind: string; embedding: number[] | null }>): DocumentIdeaLink[] {
  const ideas = getDb().prepare(
    `SELECT i.global_id,i.embedding FROM ideas i JOIN idea_occurrences io ON io.global_id=i.global_id
      WHERE io.nodus_id=? AND i.embedding IS NOT NULL`
  ).all(nodusId) as { global_id: string; embedding: Buffer }[];
  const links: DocumentIdeaLink[] = [];
  for (const idea of ideas) {
    const ideaVector = decodeEmbedding(idea.embedding);
    let best: { target: typeof vectors[number]; score: number } | null = null;
    for (const vector of vectors) {
      if (!vector.embedding?.length) continue;
      const score = cosineSimilarity(ideaVector, vector.embedding);
      if (!best || score > best.score) best = { target: vector, score };
    }
    if (best && best.score >= 0.34) links.push({
      globalId: idea.global_id,
      targetKind: best.target.kind === 'section' ? 'section' : 'field',
      targetId: best.target.sourceId,
      role: best.score >= 0.62 ? 'principal' : best.score >= 0.48 ? 'supporting' : 'development',
      score: best.score,
    });
  }
  return links;
}

function emit(
  options: RunDocumentProfileOptions,
  phase: DocumentProfileScanProgress['phase'],
  progress: number,
  message: string,
  unit?: { current: number; total: number },
): void {
  options.onProgress?.({
    phase,
    progress,
    message,
    currentUnit: unit?.current,
    totalUnits: unit?.total,
  });
  const state = phase === 'analyzing_sections' ? 'analyzing'
    : phase === 'synthesizing' ? 'synthesizing'
    : phase === 'auditing' || phase === 'repairing' ? 'auditing'
    : phase === 'embedding' ? 'embedding'
    : phase === 'aligning' ? 'aligning'
    : phase === 'structuring' ? 'structuring'
    : phase === 'waiting_source' ? 'waiting_source' : null;
  if (!advanceRunningDocumentIndexJob(options.jobId, phase, progress, state, {
    message,
    currentUnit: unit?.current ?? null,
    totalUnits: unit?.total ?? null,
  })) {
    throw new Error('DOCUMENT_INDEX_CANCELLED');
  }
}

/** Full-text, hierarchical, audited document scan. */
export async function runDocumentProfileScan(work: Work, options: RunDocumentProfileOptions): Promise<string> {
  assertAcademicAutomation();
  const scanStartedAt = Date.now();
  options = { ...options, perf: options.perf ?? { nodusId: work.nodus_id, title: work.title } };
  // The profile pipeline's prompts scale with the document, and a local server rejects a
  // prompt that does not fit the window it loaded. Asking each model up front lets every
  // request below be sized to it, instead of paying for a failed call first — or, for a
  // provider that truncates silently, for a plausible-looking answer built on half a prompt.
  options = {
    ...options,
    promptTokenBudget: options.promptTokenBudget ?? await localPromptTokenBudget(options.generatorModel),
    auditorTokenBudget: options.auditorTokenBudget ?? await localPromptTokenBudget(options.auditorModel),
  };
  options.signal?.throwIfAborted();
  if (!modelRefSupportsCapability(options.generatorModel, 'documentProfile')
    || !modelRefSupportsCapability(options.auditorModel, 'documentProfile')) {
    throw new AiError('El modelo local seleccionado no está certificado para perfiles documentales; no se inició la inferencia.', false, true);
  }
  const settings = getSettings();
  const userId = settings.zoteroUserId || LOCAL_USER_ID;
  emit(options, 'waiting_source', 0.01, 'Resolviendo el texto completo…');
  // Nodus-owned Library references already point at a materialized, clean local
  // document. Asking Zotero about that synthetic key first is both unnecessary
  // and harmful when Zotero's local server accepts the connection but never
  // answers: a manual Documentary Index then appears frozen at waiting_source.
  const item = work.zotero_key.startsWith('nodus-library:')
    ? null
    : await getItem(userId, work.zotero_key).catch(() => null);
  const document = await resolveWorkText(
    userId, work.zotero_key, settings.zoteroStoragePath, item?.abstract ?? null, work.doi,
    {
      unpaywallEmail: settings.unpaywallEmail,
      preferZoteroFulltext: settings.preferZoteroFulltext,
      allowExternalRetrieval: false,
      ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
      signal: options.signal,
    },
    work.item_type
  );
  setResolvedTextState(work.nodus_id, resolvedTextStateFromDoc(document));
  options.signal?.throwIfAborted();
  if (!document.text.trim() || document.sourceType === 'none' || document.sourceType === 'abstract_only') {
    setDocumentProfileState(work.nodus_id, 'unavailable', { error: document.notes ?? 'No hay texto completo legible' });
    throw new Error(document.notes ?? 'No hay texto completo legible');
  }
  const sourceFingerprint = sha256(document.text);
  const sourceContentHash = sha1(document.text);
  const sourceMap = Object.fromEntries((document.segments ?? []).map((segment) => [segment.marker, segment.sourceRef]));
  // deep_hash may come from a pre-inventory deep scan whose corpus did not carry
  // durable source markers. It is therefore not comparable with this resolved-text
  // hash. Real races are guarded below by a second read plus the atomic revision check.
  updateDocumentIndexJob(options.jobId, { sourceFingerprint });
  emit(options, 'structuring', 0.04, 'Reconstruyendo la estructura…');
  const sections = deriveDocumentStructure(document.text, work.title, sourceMap);
  if (!sections.length) throw new Error('El documento no contiene texto estructurable.');

  emit(options, 'embedding', 0.05, 'Indexando los pasajes del texto completo…');
  // A passage run that has this work queued would fence these passages while the sections are
  // analysed and void the index at publication; let it finish first (passageEmbeddingActivity.ts).
  await waitForPassageWork(work.nodus_id, options.signal);
  const preparedPassages = await preparePassages(
    work,
    document.text,
    options,
    sourceMap,
  );
  const sectionPool = settings.aiConcurrencyMode === 'automatic' ? 8 : Math.max(1, Math.min(8, settings.concurrency));
  const orderedAnalyses = await mapOrderedPool(sections, sectionPool, async (section, index, poolSignal) => {
    emit(
      options,
      'analyzing_sections',
      0.08 + (index / sections.length) * 0.54,
      `Analizando sección ${index + 1} de ${sections.length}…`,
      { current: index + 1, total: sections.length },
    );
    return analyzeSection(section, { ...options, signal: poolSignal });
  }, options.signal);
  const sectionAnalyses = new Map<string, SectionAnalysis>();
  for (let index = 0; index < sections.length; index += 1) {
    const analysis = orderedAnalyses[index];
    sectionAnalyses.set(sections[index].sectionId, analysis);
    sections[index] = {
      // A chunk of a document without headings has no real title. It is kept empty
      // on purpose: anything stored here becomes user-visible data, is fed back as
      // `section_title` for the model to echo, and would ship in whatever language
      // the placeholder was written in. The UI localizes an untitled section.
      ...sections[index], title: sections[index].title || analysis.title,
      role: analysis.role || null, summary: analysis.summary, concepts: analysis.concepts,
      claims: analysis.claims.map((claim) => claim.text),
    };
  }

  const synthesisInput = synthesisPayload(work, sections, sectionAnalyses, item?.abstract ?? null);
  emit(options, 'synthesizing', 0.64, 'Sintetizando la obra completa…');
  let profile: ProfileSynthesis;
  let extractiveFallback = false;
  let repaired = false;
  try {
    profile = await synthesizeProfileAdaptive(synthesisInput, options);
  } catch (error) {
    if (!recoverablePromptFailure(error)) throw error;
    profile = buildExtractiveProfileFallback(work, sections, sectionAnalyses, 'und');
    extractiveFallback = true;
    repaired = true;
  }
  if (!profile.overview || !profile.fields.length) {
    profile = buildExtractiveProfileFallback(work, sections, sectionAnalyses, profile.source_language);
    extractiveFallback = true;
    repaired = true;
  }
  const initialFieldCount = profile.fields.length;
  profile = retainLiterallySupportedFields(document.text, profile);
  if (!profile.fields.length) {
    profile = buildExtractiveProfileFallback(work, sections, sectionAnalyses, profile.source_language);
    extractiveFallback = true;
    repaired = true;
  }
  repaired = repaired || profile.fields.length !== initialFieldCount;

  let auditor: AuditResponse | null = null;
  let compactAudit = false;
  // Why no verdict could be obtained, when that is what happened. It travels with the
  // audit issues so the user learns the model could not hold the profile instead of
  // getting a work that simply failed.
  let auditFailureNote: string | null = null;
  let deterministic = deterministicAudit(document.text, sections, profile);
  const auditPack = documentProfilePromptPack(options.language ?? getSettings().promptLanguage ?? 'es').audit;
  const requestAudit = async (compact: boolean, attempt: number): Promise<AuditResponse> => {
    const sections = Array.isArray(synthesisInput.sections) ? synthesisInput.sections : [];
    const withDeterministic = (body: { profile: unknown; sections: unknown[] }) => ({ ...body, deterministic: {
      support_coverage: deterministic.supportCoverage, structure_coverage: deterministic.structureCoverage,
    } });
    const full = withDeterministic({ profile, sections });
    // A prompt that cannot fit the loaded window fails before it can be truncated, so the
    // compact projection is used from the start when the full one is too large for it. Its
    // smaller echo is also what keeps the answer inside the output ceiling.
    const useCompact = compact || !promptFits(auditPack, full, options.auditorTokenBudget);
    const body = useCompact ? withDeterministic(compactAuditPayload(profile, sections)) : full;
    return normalizeDocumentProfileAuditResponse(await completeJson<AuditResponse>({
      system: auditPack,
      user: JSON.stringify(body),
      temperature: 0, maxTokens: 5_000, signal: options.signal,
      requestClass: 'background', jobId: `${options.jobId}:profile:audit:${attempt}:${useCompact ? 'compact' : 'full'}`,
      perf: options.perf,
    }, isAuditResponse, options.auditorModel));
  };
  for (let attempt = 0; !extractiveFallback && attempt < 3; attempt += 1) {
    emit(options, attempt === 0 ? 'auditing' : 'repairing', 0.7 + attempt * 0.05,
      attempt === 0 ? 'Auditando la ficha contra el texto…' : `Reparando la ficha (${attempt}/2)…`);
    try {
      auditor = await requestAudit(compactAudit, attempt);
    } catch (error) {
      if (!recoverablePromptFailure(error)) throw error;
      // A response that ran out of output budget is not a verdict. Replaying the same
      // request reproduces it, so retry once with the compact payload instead: one
      // truncated audit used to end the loop here and hand the whole synthesis to the
      // extractive fallback. Once the full payload has overflowed it is not tried
      // again for this profile, which would truncate the same way.
      if (compactAudit) { auditFailureNote = describeFailure(error); break; }
      compactAudit = true;
      try {
        auditor = await requestAudit(true, attempt);
      } catch (retryError) {
        if (!recoverablePromptFailure(retryError)) throw retryError;
        auditFailureNote = describeFailure(retryError);
        break;
      }
    }
    // Corrections are actionable whether or not the verdict was positive: an auditor
    // that rejects the profile and says exactly which field is wrong and how to fix it
    // was previously ignored, which forced a full re-synthesis instead of applying the
    // fix — and often ended in the literal fallback with the fix unused.
    if (auditor.field_fixes?.length) {
      for (const fix of auditor.field_fixes) {
        const target = profile.fields[Math.trunc(Number(fix.index))];
        if (!target) continue;
        const fixedText = clean(fix.text, 3_000);
        const fixedQuote = clean(fix.support_quote, 1_200);
        if (fixedQuote && quoteOffset(document.text, fixedQuote) < 0) continue;
        if (fixedText) target.text = fixedText;
        // A semantic auditor may suggest a polished/paraphrased quote even when
        // its verdict is positive. Never let such a suggestion cross the
        // deterministic literal-support boundary.
        if (fixedQuote) target.support_quote = fixedQuote;
      }
      if (clean(auditor.overview, 5_000)) profile.overview = clean(auditor.overview, 5_000);
      profile = retainLiterallySupportedFields(document.text, profile);
      repaired = true;
      deterministic = deterministicAudit(document.text, sections, profile);
    }
    if (semanticApproved(auditor) && deterministic.supportCoverage >= 0.95 && deterministic.structureCoverage >= 0.95) break;
    if (attempt >= 2) break;
    try {
      profile = normalizeProfile(await completeJson<ProfileSynthesis>({
        system: documentProfilePromptPack(options.language ?? getSettings().promptLanguage ?? 'es').repair,
        user: JSON.stringify({ profile, audit: auditor, sections: synthesisInput.sections }),
        temperature: 0, maxTokens: 8_000, signal: options.signal,
        requestClass: 'background', jobId: `${options.jobId}:profile:repair:${attempt}`,
        perf: options.perf,
      }, isProfileSynthesis, options.generatorModel));
    } catch (error) {
      if (!recoverablePromptFailure(error)) throw error;
      break;
    }
    const repairedFieldCount = profile.fields.length;
    profile = retainLiterallySupportedFields(document.text, profile);
    repaired = true;
    if (!profile.fields.length) break;
    if (profile.fields.length !== repairedFieldCount) repaired = true;
    deterministic = deterministicAudit(document.text, sections, profile);
  }
  const deterministicComplete = deterministic.supportCoverage === 1 && deterministic.structureCoverage >= 0.95;
  const approved = semanticApproved(auditor);
  // The synthesis is kept whenever the deterministic evidence contract holds, because
  // retention has already left every published field carrying a literal support: a low
  // semantic score says the auditor disliked the prose, not that the evidence is
  // unsupported. Discarding the whole synthesis over a hundredth of a point replaced an
  // audited profile with a list of raw quotations, which orients retrieval worse.
  let mode: DocumentProfileFallbackMode | null = null;
  let publishable = false;
  let auditPassed = false;
  if (approved && deterministicComplete) {
    publishable = true;
    auditPassed = true;
  } else if (!extractiveFallback && deterministicComplete && profile.fields.length > 0) {
    mode = 'partial';
    publishable = true;
    repaired = true;
  } else {
    // Last resort for a synthesis that produced nothing usable: rebuild the profile from
    // literal quotes. This is deliberately conservative content, not a failed profile.
    // A profile that already IS that fallback (the synthesis never produced fields) is
    // left as it is: rebuilding it would produce exactly the same quotes again.
    if (!extractiveFallback) {
      profile = buildExtractiveProfileFallback(work, sections, sectionAnalyses, profile.source_language);
      deterministic = deterministicAudit(document.text, sections, profile);
      extractiveFallback = true;
      repaired = true;
    }
    mode = 'extractive';
    // A literal profile is fully supported by construction, so it satisfies the
    // deterministic contract; `fallback` is what tells consumers it is not a synthesis.
    publishable = deterministic.supportCoverage === 1 && deterministic.structureCoverage >= 0.95;
    auditPassed = publishable;
    // The marker travels with the audit whichever way the fallback was reached, so a
    // degraded profile stays identifiable in the stored record and not only through
    // the `fallback` field.
    auditor = {
      passed: auditPassed,
      // The semantic verdict is kept as it was reported. Replacing it with the
      // direct-support floor made a rejected synthesis and a perfect one report the
      // same number, which is how an extractive fallback came to read "80 %".
      score: auditor?.score ?? null,
      issues: ['fallback_extractivo_determinista', ...strings(auditor?.issues, 20)],
      field_fixes: [],
      overview: profile.overview,
    };
  }
  // How much of the published profile is quotation rather than synthesis. A profile can
  // be approved as a whole while individual sections were degraded, and nothing else in
  // the record would say so.
  const sectionsDegraded = [...sectionAnalyses.values()].filter((analysis) => analysis.degraded).length;
  const audit: DocumentProfileAudit = {
    passed: auditPassed, score: auditor?.score ?? null, supportCoverage: deterministic.supportCoverage,
    structureCoverage: deterministic.structureCoverage,
    issues: [...strings(auditor?.issues, 50), ...(auditFailureNote ? [auditFailureNote] : [])],
    repaired: repaired || Boolean(auditor && (auditor.field_fixes?.length || auditor.overview)),
    fallback: mode, sectionsDegraded,
  };
  if (!publishable) {
    const error = auditFailureMessage(audit);
    setDocumentProfileState(work.nodus_id, 'failed', { sourceFingerprint, pipelineVersion: DOCUMENT_PROFILE_PIPELINE_VERSION, error });
    throw new Error(error);
  }

  const fields = deterministic.supportedFields.map((field, index) => ({
    fieldId: `field-${sha256(`${sourceFingerprint}|${field.kind}|${index}|${field.text}`).slice(0, 24)}`,
    kind: field.kind, ordinal: deterministic.supportedFields.slice(0, index).filter((prior) => prior.kind === field.kind).length,
    text: field.text, confidence: field.confidence, centrality: CENTRAL_FIELD_KINDS.has(field.kind) ? Math.max(0.75, field.centrality) : field.centrality,
    confidenceSource: field.confidenceSource ?? ('model' as DocumentProfileConfidenceSource),
  }));
  const supports: DocumentProfileSupport[] = [];
  deterministic.supportedFields.forEach((field, index) => {
    const support = supportForQuote({
      nodusId: work.nodus_id, text: document.text, quote: field.support_quote, targetKind: 'field',
      targetId: fields[index].fieldId, sections, confidence: field.confidence,
      candidatePassages: preparedPassages, sourceMap,
    });
    if (support) supports.push(support);
  });
  for (const section of sections) {
    const analysis = sectionAnalyses.get(section.sectionId);
    const quote = analysis?.claims?.[0]?.support_quote;
    if (!quote) continue;
    const support = supportForQuote({
      nodusId: work.nodus_id, text: document.text, quote, targetKind: 'section', targetId: section.sectionId,
      sections, confidence: analysis.claims[0].confidence,
      candidatePassages: preparedPassages, sourceMap,
    });
    if (support) supports.push(support);
  }

  emit(options, 'embedding', 0.87, 'Creando los vectores documentales…');
  const vectorSources = [
    { kind: 'overview', sourceId: 'overview', text: profile.overview, weight: 1 },
    ...fields.map((field) => ({ kind: field.kind, sourceId: field.fieldId, text: field.text, weight: field.centrality || 0.5 })),
    ...sections.map((section) => ({ kind: 'section', sourceId: section.sectionId, text: `${section.title}\n${section.summary}`, weight: 0.75 })),
  ].filter((source) => source.text.trim());
  const vectorEmbeddingConfig = currentEmbeddingConfig();
  const embeddings = await embedMany(vectorSources.map((source) => source.text), options.signal, {
    role: 'document', title: work.title,
    perf: options.perf,
    jobId: `${options.jobId}:profile-embeddings`,
  });
  options.signal?.throwIfAborted();
  const vectors = vectorSources.map((source, index) => ({
    ...source,
    embedding: embeddings[index]?.length ? embeddings[index] : null,
    embeddingProvider: vectorEmbeddingConfig.provider,
    embeddingModel: vectorEmbeddingConfig.model,
  }));

  emit(options, 'aligning', 0.94, 'Alineando la estructura con las ideas…');
  const ideaLinks: DocumentIdeaLink[] = alignIdeas(work.nodus_id, vectors);
  emit(options, 'publishing', 0.98, 'Publicando la versión auditada…');
  options.signal?.throwIfAborted();
  // Re-resolve the source at the publication boundary. Database revision guards
  // catch normal Zotero/sync changes; this additionally catches a file replaced
  // externally while a long analysis is running, even before deep_hash changes.
  const latestDocument = await resolveWorkText(
    userId, work.zotero_key, settings.zoteroStoragePath, item?.abstract ?? null, work.doi,
    {
      unpaywallEmail: settings.unpaywallEmail,
      preferZoteroFulltext: settings.preferZoteroFulltext,
      allowExternalRetrieval: false,
      ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
      signal: options.signal,
    },
    work.item_type,
  );
  options.signal?.throwIfAborted();
  if (latestDocument.sourceType === 'none'
    || latestDocument.sourceType === 'abstract_only'
    || sha256(latestDocument.text) !== sourceFingerprint) {
    throw new Error('DOCUMENT_SOURCE_CHANGED');
  }
  const versionId = publishDocumentProfile({
    nodusId: work.nodus_id, sourceFingerprint, pipelineVersion: DOCUMENT_PROFILE_PIPELINE_VERSION,
    schemaVersion: DOCUMENT_PROFILE_SCHEMA_VERSION, sourceLanguage: profile.source_language,
    presentationLanguage: settings.promptLanguage, overview: profile.overview,
    profile: { ...profile, metadata: synthesisInput.metadata, fallbackMode: mode }, fields,
    sections: sections.map(({ body: _body, ...section }) => section), supports, ideaLinks,
    vectors, generatorModel: options.generatorModel, auditorModel: options.auditorModel,
    promptHash: sha256(JSON.stringify(documentProfilePromptPack(options.language ?? settings.promptLanguage ?? 'es'))), audit,
    // Quality is the lowest of the readings, and only exists when the auditor actually
    // produced one. Without a semantic reading the deterministic coverages are all the
    // gate requires (so they would read as a perfect score) and the profile already
    // says it was not approved; reporting "100 %" beside that caveat would be worse
    // than reporting nothing.
    qualityScore: audit.score == null ? null : Math.min(audit.score, audit.supportCoverage, audit.structureCoverage),
    expectedWorkRevision: {
      zoteroKey: work.zotero_key,
      zoteroVersion: work.zotero_version,
      title: work.title,
      authorsJson: work.authors_json,
      year: work.year,
      itemType: work.item_type,
      doi: work.doi,
      deepHash: work.deep_hash,
      resolvedTextHash: sourceContentHash,
    },
    passages: preparedPassages,
  });
  // The one green line per indexed document. It carries the numbers a reader cannot get
  // back afterwards — how many sections were extracted and how many vectors were published
  // — and inherits vault/document/job from the queue's log scope.
  logPipelineSuccess({
    subject: 'subjectIndexing',
    message: {
      id: 'documentIndexed',
      params: { title: work.title, sections: sections.length, vectors: vectors.length },
    },
    durationMs: Date.now() - scanStartedAt,
  });
  upsertLibraryAnalysisProvenance({
    workId: work.nodus_id,
    component: 'documentProfile',
    documentFingerprint: sourceContentHash,
    libraryItemId: null,
    libraryRevisionFingerprint: null,
    pipelineVersion: DOCUMENT_PROFILE_PIPELINE_VERSION,
    modelFingerprint: analysisModelFingerprint('documentProfile', settings),
    outputFingerprint: analysisFingerprint({ versionId, sourceFingerprint, audit, overview: profile.overview }),
    sourceVaultId: null,
    sourceWorkId: null,
    updatedAt: new Date().toISOString(),
  });
  clearDocumentCheckpoints(options.jobId);
  clearWorkDocumentCheckpoints(work.nodus_id);
  return versionId;
}
