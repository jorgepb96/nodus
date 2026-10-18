export type ResearchPremiseType = 'fact' | 'attribution' | 'absence' | 'relation' | 'inference';
export interface ResearchClaimPremise { text: string; type: ResearchPremiseType; entailed: boolean }
export interface ResearchClaimRecord {
  sentence: string;
  kind: 'fact' | 'attributed' | 'inference' | 'nonfactual';
  status: 'supported' | 'removed' | 'unverified';
  evidence: Array<{ id: string; quote: string; originalQuote?: string }>;
  reason: string;
  /** Deterministic cause of a removal. The judge's prose reason is diagnostic
   * only and never decides acceptance. */
  failure?: ResearchClaimFailure;
  premises?: ResearchClaimPremise[];
}
export type ResearchClaimFailure = 'judge_rejected' | 'no_premises' | 'premise_not_entailed' | 'premise_without_literal_evidence'
  | 'inference_without_supported_premises' | 'unqualified_inference' | 'unsupported_parts' | 'inconsistent_verdict'
  | 'nonfactual_with_content' | 'restates_rejected_claim' | 'internal_contradiction';
export interface ResearchProseAudit { markdown: string; claims: ResearchClaimRecord[] }
export interface ResearchAuditSource { id: string; text: string; label: string; citation: string }

/** Request-local routing labels avoid asking a judge to reproduce long opaque
 * storage identities. Only an exact supplied alias is expanded; unknown IDs,
 * quotes, verdicts and all other content are left for the normal validators. */
export function researchAuditSourceTransport(sources: readonly ResearchAuditSource[]) {
  const originalIds = new Set(sources.map(source => source.id));
  let prefix = 'source-';
  while (sources.some((_source, index) => originalIds.has(`${prefix}${index + 1}`))) prefix = `_${prefix}`;
  const aliases = new Map(sources.map((source, index) => [`${prefix}${index + 1}`, source.id]));
  const restoreEvidence = (evidence: unknown) => {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return evidence;
    const row = evidence as Record<string, unknown>;
    return typeof row.id === 'string' && aliases.has(row.id) ? { ...row, id: aliases.get(row.id)! } : evidence;
  };
  return {
    sources: sources.map((source, index) => ({ ...source, id: `${prefix}${index + 1}` })),
    bindings: [...aliases].map(([alias, sourceId]) => ({ alias, sourceId })),
    restore<T extends { claims: unknown[] }>(input: T): T {
      return { ...input, claims: input.claims.map(claim => {
        if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return claim;
        const row = claim as Record<string, unknown>;
        return { ...row, ...(Array.isArray(row.premises) ? { premises: row.premises.map(premise => {
          if (!premise || typeof premise !== 'object' || Array.isArray(premise)) return premise;
          const atom = premise as Record<string, unknown>;
          return { ...atom, ...(Array.isArray(atom.evidence) ? { evidence: atom.evidence.map(restoreEvidence) } : {}) };
        }) } : {}) };
      }) };
    },
  };
}
interface Premise { text: string; type: ResearchPremiseType; entailed: boolean; evidence: Array<{ id: string; quote: string; originalQuote?: string }>; from: number[] }
interface Verdict {
  index: number; kind: ResearchClaimRecord['kind']; premises: Premise[]; unsupportedParts: string[];
  explicitInference: boolean; supported: boolean; reason: string;
}
export interface ResearchProseVerdicts { claims: Verdict[] }
export const RESEARCH_AUDIT_BATCH = 8;
const PREMISE_TYPES: ResearchPremiseType[] = ['fact', 'attribution', 'absence', 'relation', 'inference'];
const validEvidence = (evidence: unknown): evidence is { id: string; quote: string } => !!evidence && typeof evidence === 'object'
  && typeof (evidence as { id: unknown }).id === 'string' && (evidence as { id: string }).id.length <= 512
  && typeof (evidence as { quote: unknown }).quote === 'string' && (evidence as { quote: string }).quote.length >= 12 && (evidence as { quote: string }).quote.length <= 1500;
function validPremise(premise: unknown, position: number): premise is Premise {
  if (!premise || typeof premise !== 'object') return false;
  const item = premise as Premise;
  return typeof item.text === 'string' && item.text.length > 0 && item.text.length <= 500 && PREMISE_TYPES.includes(item.type)
    && typeof item.entailed === 'boolean' && Array.isArray(item.evidence) && item.evidence.length <= 6 && item.evidence.every(validEvidence)
    // Inferences may only rest on earlier premises: no cycles, no self-support.
    && Array.isArray(item.from) && item.from.length <= 10 && item.from.every(index => Number.isInteger(index) && index >= 0 && index < position);
}
/** Batch envelope only; each claim is validated separately so one malformed item
 * leaves its own sentence unverified (and removed) instead of the whole batch. */
export function validResearchProseVerdicts(input: unknown): input is { claims: unknown[] } {
  return !!input && typeof input === 'object' && Array.isArray((input as { claims?: unknown }).claims) && (input as { claims: unknown[] }).claims.length <= RESEARCH_AUDIT_BATCH;
}
function validClaim(item: unknown): item is Verdict {
  if (!item || typeof item !== 'object') return false;
  const claim = item as Verdict;
  return Number.isInteger(claim.index) && claim.index >= 0 && claim.index < RESEARCH_AUDIT_BATCH && ['fact', 'attributed', 'inference', 'nonfactual'].includes(claim.kind)
    && typeof claim.supported === 'boolean' && typeof claim.explicitInference === 'boolean' && typeof claim.reason === 'string'
    && Array.isArray(claim.premises) && claim.premises.length <= 12 && claim.premises.every((premise, position) => validPremise(premise, position))
    && Array.isArray(claim.unsupportedParts) && claim.unsupportedParts.length <= 12 && claim.unsupportedParts.every(part => typeof part === 'string');
}
/** Sanitizing may only make acceptance harder: over-short quotes are dropped (so a
 * premise may lose its evidence), a missing `from` becomes empty (an inference
 * then fails; other premise types never read it), a missing explicitInference
 * becomes false, long diagnostics are clipped. Any other malformed claim, or an
 * index claimed twice, yields no verdict; `malformed` says why, for review. */
function isSafeSentencePeriod(text: string, index: number): boolean {
  let next = index + 1;
  if (text[index] === '.' && /\d/u.test(text[index - 1] ?? '') && /\d/u.test(text[next] ?? '')) return false;
  if (!/[.!?。！？]/u.test(text[index])) return false;
  while (/["'”’»)]/u.test(text[next] ?? '')) next++;
  if (next < text.length && !/\s/u.test(text[next])) return false;
  if (text[index] === '.') {
    const prefix = text.slice(0, index + 1);
    const token = /(?:^|\s)([\p{L}.]+\.)$/u.exec(prefix)?.[1]?.toLowerCase();
    if (token && (token.length === 2 || /^(?:mr|mrs|ms|dr|prof|sr|sra|jr|st|vs|etc|e\.g|i\.e)\.$/u.test(token))) return false;
    const after = text.slice(next).trimStart();
    if (after && !/[\p{Lu}¿¡“«([]/u.test(after[0])) return false;
  }
  return true;
}

/** Short evidence is expanded only inside its uniquely matching authorized
 * excerpt and only when a complete, safely bounded source sentence can be copied. */
function expandShortEvidence(evidence: unknown, sources: readonly ResearchAuditSource[]): unknown {
  if (!evidence || typeof evidence !== 'object') return evidence;
  const candidate = evidence as { id?: unknown; quote?: unknown; [key: string]: unknown };
  // Never honor model-supplied trace metadata.
  const clean = { ...candidate };
  delete clean.originalQuote;
  if (typeof candidate.id !== 'string' || typeof candidate.quote !== 'string'
      || candidate.quote.length < 8 || candidate.quote.length >= 12) return clean;
  const normalizeText = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const quote = normalizeText(candidate.quote);
  if (quote.length < 8 || !/\p{L}/u.test(quote)) return clean;
  const matches = sources.filter(source => source.id === candidate.id);
  if (matches.length !== 1) return clean;
  const marker = 'Verbatim excerpt:\n';
  const markerAt = matches[0].text.lastIndexOf(marker);
  if (markerAt < 0) return clean;
  const excerpt = normalizeText(matches[0].text.slice(markerAt + marker.length));
  const start = excerpt.indexOf(quote);
  if (start < 0 || excerpt.indexOf(quote, start + quote.length) >= 0) return clean;
  const word = (character: string | undefined) => Boolean(character && /[\p{L}\p{N}_]/u.test(character));
  if ((word(excerpt[start - 1]) && word(quote[0]))
      || (word(excerpt[start + quote.length]) && word(quote.at(-1)))) return clean;
  let left = 0;
  for (let index = start - 1; index >= 0; index--) {
    if (isSafeSentencePeriod(excerpt, index)) { left = index + 1; break; }
  }
  // An excerpt start is usable only when it visibly starts a sentence, rather
  // than an ellipsis or a lower-case mid-sentence fragment.
  const first = excerpt.slice(left).trimStart()[0];
  if (left === 0 && first && !/[\p{Lu}¿¡“«"']/u.test(first)) return clean;
  let right = -1;
  for (let index = start + quote.length; index < excerpt.length; index++) {
    if (isSafeSentencePeriod(excerpt, index)) { right = index + 1; break; }
  }
  if (right < 0) return clean;
  const expanded = excerpt.slice(left, right).trim();
  if (expanded.length < 12 || expanded.length > 400 || !expanded.includes(quote)) return clean;
  return { ...clean, quote: expanded, originalQuote: candidate.quote };
}

export function normalizeResearchProseVerdicts(input: { claims: unknown[] }, size: number,
  sources: readonly ResearchAuditSource[] = []): Array<Verdict | undefined> & { malformed?: Map<number, string> } {
  const verdicts: Array<Verdict | undefined> & { malformed?: Map<number, string> } = [];
  const malformed = new Map<number, string>();
  const seen = new Map<number, number>();
  for (const raw of input.claims) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Verdict;
    const premises = Array.isArray(item.premises) ? item.premises.map(premise => premise && typeof premise === 'object' ? {
      ...premise, from: premise.from === undefined ? [] : premise.from,
      evidence: premise.evidence === undefined ? [] : Array.isArray(premise.evidence) ? premise.evidence
        .map(evidence => expandShortEvidence(evidence, sources))
        .filter(evidence => !evidence || typeof evidence !== 'object'
          || typeof (evidence as { quote?: unknown }).quote !== 'string'
          || ((evidence as { quote: string }).quote.length >= 12)) as Premise['evidence'] : premise.evidence,
    } : premise) : item.premises;
    const claim = { ...item, premises, explicitInference: item.explicitInference ?? false, reason: typeof item.reason === 'string' ? item.reason.slice(0, 600) : item.reason };
    if (Number.isInteger(item.index)) seen.set(item.index, (seen.get(item.index) ?? 0) + 1);
    if (validClaim(claim) && claim.index < size) verdicts[claim.index] = claim;
    else if (Number.isInteger(item.index) && item.index >= 0 && item.index < size) malformed.set(item.index, malformedField(claim));
  }
  for (const [index, count] of seen) if (count > 1) { verdicts[index] = undefined; malformed.set(index, 'duplicate_index'); }
  verdicts.malformed = malformed;
  return verdicts;
}
function malformedField(claim: Partial<Verdict>): string {
  if (!['fact', 'attributed', 'inference', 'nonfactual'].includes(claim.kind as string)) return `kind:${String(claim.kind).slice(0, 40)}`;
  if (typeof claim.supported !== 'boolean') return 'supported';
  if (typeof claim.reason !== 'string') return 'reason';
  if (!Array.isArray(claim.unsupportedParts)) return 'unsupportedParts';
  if (!Array.isArray(claim.premises)) return 'premises';
  const position = claim.premises.findIndex((premise, index) => !validPremise(premise, index));
  if (position < 0) return 'unknown';
  const premise = claim.premises[position] as Partial<Premise>;
  if (!PREMISE_TYPES.includes(premise?.type as ResearchPremiseType)) return `premise_type:${String(premise?.type).slice(0, 40)}`;
  if (!Array.isArray(premise.from) || premise.from.some(index => !Number.isInteger(index) || index < 0 || index >= position)) return 'premise_from';
  return 'premise';
}
const CITATION = /\[[^\]]*\]\(nodus:\/\/[^)]+\)/gu;
const PARENTHESIZED_CITATIONS = new RegExp(`[ \\t]*\\(\\s*(?:${CITATION.source})(?:\\s*[,;]?\\s*(?:${CITATION.source}))*\\s*\\)`, 'gu');
/** Same-length masking protects author initials and URL punctuation. A sentence
 * boundary may sit after citations appended to the sentence's final punctuation,
 * so audited prose can be segmented again exactly like freshly written prose.
 * The look-back is a linear scan: a nested-quantifier lookbehind over citation
 * masks backtracked exponentially and froze the main process in a live run. */
export function researchProseSpans(markdown: string): Array<{ start: number; end: number; text: string }> {
  const spans: Array<{ start: number; end: number; text: string }> = [];
  const masked = markdown.replace(CITATION, match => '·'.repeat(match.length));
  const boundaries: Array<{ index: number; length: number }> = [];
  // A direct quotation may contain several sentences; never split inside one.
  const open = new Set(['«', '“', '„']), close = new Set(['»', '”']);
  const depth: number[] = [];
  for (let index = 0, level = 0; index < masked.length; index++) {
    if (masked[index] === '\n') level = 0;
    else if (open.has(masked[index])) level++;
    else if (close.has(masked[index])) level = Math.max(0, level - 1);
    depth[index] = level;
  }
  for (const match of masked.matchAll(/\n+|[ \t]+(?=[\p{Lu}¿¡“«])/gu)) {
    if (match[0].startsWith('\n')) { boundaries.push({ index: match.index!, length: match[0].length }); continue; }
    if (depth[match.index!] > 0) continue;
    // "1. Check the temperature" is one sentence: the ordinal is a list marker, and a marker
    // cut off as a sentence of its own is removed with the sentences the audit rejects.
    const lineStart = masked.lastIndexOf('\n', match.index! - 1) + 1;
    if (/^[ \t]*\d{1,3}[.)]$/u.test(masked.slice(lineStart, match.index!))) continue;
    let before = match.index! - 1;
    while (before >= 0 && (masked[before] === '·' || masked[before] === ' ' || masked[before] === '\t')) before--;
    if (before >= 0 && '.!?。！？'.includes(masked[before])) boundaries.push({ index: match.index!, length: match[0].length });
  }
  let start = 0;
  for (const boundary of [...boundaries, { index: masked.length, length: 0 }]) {
    const text = markdown.slice(start, boundary.index);
    if (text.trim()) spans.push({ start, end: boundary.index, text });
    start = boundary.index + boundary.length;
  }
  return spans;
}
const normalize = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
/** Prose without citation links or the empty wrappers they leave. */
export function researchPlainSentence(text: string): string {
  return normalize(text.replace(PARENTHESIZED_CITATIONS, '').replace(CITATION, '').replace(EMPTY_WRAPPER, '').replace(/^#{1,6}\s+/u, '').replace(/^\s*[-*+]\s+/u, ''));
}
const tokens = (text: string) => new Set(researchPlainSentence(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .match(/[\p{L}\p{N}]+/gu)?.filter(token => token.length >= 3 || /\p{N}/u.test(token)) ?? []);
export const researchSentenceKey = (text: string) => [...tokens(text)].join(' ');
/** Language-neutral backstop for the judge's own rejected-claim instruction: a
 * sentence that carries nearly every content token of a rejected sentence restates
 * it, whatever connective or citation was added. Short transitions are exempt
 * because they carry too little content to identify a proposition. */
export function restatesRejectedClaim(sentence: string, rejected: readonly string[]): boolean {
  const own = tokens(sentence);
  if (!own.size) return false;
  return rejected.some(item => {
    const other = tokens(item);
    if (other.size < 5) return false;
    let shared = 0;
    for (const token of other) if (own.has(token)) shared++;
    return shared / other.size >= 0.8 && shared / own.size >= 0.6;
  });
}
/** Parentheses left holding only brackets or punctuation after citation removal,
 * including writer output such as `([label](link)])`. */
const EMPTY_WRAPPER = /[ \t]*\([\s[\],;.]*\)/gu;
function tidy(markdown: string): string {
  return markdown.replace(EMPTY_WRAPPER, '').replace(/(?<=\S)[ \t]{2,}(?=\S)/gu, ' ').replace(/[ \t]+$/gmu, '')
    .replace(/^[ \t]+(?=[^\s\-*+>|\d])/gmu, '').replace(/\n{3,}/g, '\n\n').trim();
}
/** Removes whole sentences (with the citations attached to them). */
export function dropResearchSentences(markdown: string, drop: (plain: string) => boolean): { markdown: string; dropped: string[] } {
  const dropped: string[] = [];
  let result = markdown;
  for (const span of researchProseSpans(markdown).reverse()) {
    const plain = researchPlainSentence(span.text);
    if (!plain || !drop(plain)) continue;
    dropped.push(plain);
    result = result.slice(0, span.start) + result.slice(span.end);
  }
  return { markdown: tidy(result), dropped: dropped.reverse() };
}
const HAS_CONTENT_MARKER = /\p{N}|nodus:\/\//u;
/** The acceptance decision is derived here from the judge's atomic premises. Its
 * `supported` boolean, its unsupported parts and its premises must all agree:
 * a verdict whose parts disagree is not a reliable approval and fails closed. */
export function decideResearchVerdict(span: string, verdict: Verdict, sources: ResearchAuditSource[]): {
  valid: boolean; failure?: ResearchClaimFailure; evidence: Array<{ id: string; quote: string }>;
} {
  const literal = (evidence: { id: string; quote: string }) => sources.some(source => source.id === evidence.id && normalize(source.text).includes(normalize(evidence.quote)));
  if (verdict.kind === 'nonfactual') {
    if (verdict.premises.length || verdict.unsupportedParts.length || HAS_CONTENT_MARKER.test(span)) return { valid: false, failure: 'nonfactual_with_content', evidence: [] };
    return verdict.supported ? { valid: true, evidence: [] } : { valid: false, failure: 'judge_rejected', evidence: [] };
  }
  if (!verdict.premises.length) return { valid: false, failure: 'no_premises', evidence: [] };
  const premiseValid: boolean[] = [];
  let failure: ResearchClaimFailure | undefined;
  for (const premise of verdict.premises) {
    let ok = premise.entailed;
    if (!ok) failure ??= 'premise_not_entailed';
    else if (premise.type === 'inference') {
      ok = premise.from.length > 0 && premise.from.every(index => premiseValid[index]);
      if (!ok) failure ??= 'inference_without_supported_premises';
    } else {
      // An absence, like any fact, needs a source that states it: silence is not a quote.
      ok = premise.evidence.length > 0 && premise.evidence.every(literal);
      if (!ok) failure ??= 'premise_without_literal_evidence';
    }
    premiseValid.push(ok);
  }
  const inferred = verdict.premises.some(premise => premise.type === 'inference');
  if (!failure && inferred && (verdict.kind !== 'inference' || !verdict.explicitInference)) failure = 'unqualified_inference';
  if (!failure && verdict.kind === 'inference' && !verdict.explicitInference) failure = 'unqualified_inference';
  if (!failure && verdict.unsupportedParts.some(part => part.trim())) failure = 'unsupported_parts';
  const derived = !failure;
  if (derived !== verdict.supported) failure = derived ? 'inconsistent_verdict' : failure;
  if (failure) return { valid: false, failure: !verdict.supported && failure === 'inconsistent_verdict' ? 'judge_rejected' : failure, evidence: [] };
  const seen = new Set<string>();
  const evidence = verdict.premises.flatMap(premise => premise.evidence).filter(item => {
    const key = `${item.id}\u0000${normalize(item.quote)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(item => item.originalQuote === undefined ? { id: item.id, quote: item.quote }
    : { id: item.id, quote: item.quote, originalQuote: item.originalQuote });
  return { valid: true, evidence };
}
/** Existence of an evidence ID and literal supporting text are separate gates
 * from the semantic judgement. Neither gate alone constitutes quality acceptance. */
export function applyResearchProseVerdicts(markdown: string, sources: ResearchAuditSource[], verdicts: Array<Verdict | undefined> & { malformed?: Map<number, string> }, rejected: readonly string[] = []): ResearchProseAudit {
  const spans = researchProseSpans(markdown);
  const claims: ResearchClaimRecord[] = [];
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index], verdict = verdicts[index];
    if (!verdict) {
      const malformed = verdicts.malformed?.get(index);
      claims.push({ sentence: span.text, kind: 'fact', status: 'unverified', evidence: [], reason: malformed ? `malformed_verdict:${malformed}` : 'verification_unavailable' });
      edits.push({ ...span, text: '' });
      continue;
    }
    let decision = decideResearchVerdict(span.text, verdict, sources);
    if (decision.valid && verdict.kind !== 'nonfactual' && restatesRejectedClaim(span.text, rejected)) decision = { valid: false, failure: 'restates_rejected_claim', evidence: [] };
    claims.push({ sentence: span.text, kind: verdict.kind, status: decision.valid ? 'supported' : 'removed', evidence: decision.evidence, reason: verdict.reason,
      ...(decision.failure ? { failure: decision.failure } : {}),
      premises: verdict.premises.map(premise => ({ text: premise.text, type: premise.type, entailed: premise.entailed })) });
    if (!decision.valid) { edits.push({ ...span, text: '' }); continue; }
    if (verdict.kind === 'nonfactual') continue;
    // A source-less factual sentence may be repaired only with verified literal
    // anchors to authorized evidence. Existing unsupported citation links go away.
    const sourceIds = new Set(decision.evidence.map(evidence => evidence.id));
    const cited = sources.filter(source => sourceIds.has(source.id));
    const text = span.text.replace(PARENTHESIZED_CITATIONS, '').replace(CITATION, '').trimEnd();
    // Headings keep their evidence in the ledger; links would make them body text.
    const links = /^\s*#{1,6}\s/u.test(span.text) ? '' : cited.map(source => `[${source.label.replace(/[[\]\\]/g, '')}](${source.citation})`).join(' ');
    edits.push({ ...span, text: links ? `${text} ${links}` : text });
  }
  let result = markdown;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return { markdown: tidy(result), claims };
}

export interface ResearchReportParts { sections: string[]; abstract: string; limitations: string[]; nextSteps: string[] }
export interface ResearchConflict { a: number; b: number; incompatible: boolean; quoteA: string; quoteB: string; reason: string }
export function validResearchConflicts(input: unknown): input is { conflicts: ResearchConflict[] } {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { conflicts?: unknown }).conflicts)) return false;
  return (input as { conflicts: unknown[] }).conflicts.length <= 40 && (input as { conflicts: ResearchConflict[] }).conflicts.every(item => item
    && Number.isInteger(item.a) && Number.isInteger(item.b) && item.a >= 0 && item.b >= 0 && item.a !== item.b && typeof item.incompatible === 'boolean'
    && typeof item.quoteA === 'string' && typeof item.quoteB === 'string' && typeof item.reason === 'string');
}
/**
 * Whole-report reconciliation after every part has been audited separately.
 * 1. A proposition rejected anywhere cannot survive elsewhere: the removal wins
 *    over a later or earlier favourable verdict on a restatement.
 * 2. Statements that cannot both hold (including asserting what another statement
 *    says cannot be established) are removed together, leaving a shorter coherent
 *    answer rather than choosing one side without evidence.
 */
export async function reconcileResearchReport(parts: ResearchReportParts, ledger: ResearchClaimRecord[],
  findConflicts?: (statements: string[]) => Promise<ResearchConflict[]>): Promise<{ parts: ResearchReportParts; removed: number; conflicts: number; consistencyChecked: boolean; pruned: number; conflictPairs: Array<{ a: string; b: string; reason: string }> }> {
  const bearsContent = (claim: ResearchClaimRecord) => claim.kind !== 'nonfactual' || claim.failure === 'nonfactual_with_content';
  const rejected = ledger.filter(claim => claim.status !== 'supported' && bearsContent(claim)).map(claim => claim.sentence);
  const byKey = new Map<string, ResearchClaimRecord[]>();
  for (const claim of ledger) {
    const key = researchSentenceKey(claim.sentence);
    byKey.set(key, [...(byKey.get(key) ?? []), claim]);
  }
  const retire = (plain: string, failure: ResearchClaimFailure) => {
    for (const claim of byKey.get(researchSentenceKey(plain)) ?? []) if (claim.status === 'supported') { claim.status = 'removed'; claim.failure = failure; claim.evidence = []; }
  };
  let removed = 0, pruned = 0;
  let conflictPairs: Array<{ a: string; b: string; reason: string }> = [];
  // Structure left behind by removals. Neither step removes a factual claim:
  // a repeated body sentence keeps its first occurrence, and an organizational
  // transition must still introduce a claim in its own paragraph.
  const transition = (plain: string) => (byKey.get(researchSentenceKey(plain)) ?? []).some(claim => claim.kind === 'nonfactual' && claim.status === 'supported');
  const heading = (text: string) => /^\s*#{1,6}\s/u.test(text);
  const prune = (text: string, seen: Set<string> | null) => {
    for (;;) {
      const spans = researchProseSpans(text);
      const drop = new Set<number>();
      const keys = new Set<string>();
      spans.forEach((span, index) => {
        const plain = researchPlainSentence(span.text);
        if (!plain || heading(span.text)) return;
        const key = researchSentenceKey(plain);
        if (seen && tokens(plain).size >= 5 && (seen.has(key) || keys.has(key))) { drop.add(index); return; }
        keys.add(key);
        if (!transition(plain)) return;
        const next = spans[index + 1];
        const introduces = next && !/\n[ \t]*\n/u.test(text.slice(span.end, next.start)) && !heading(next.text) && !transition(researchPlainSentence(next.text));
        if (!introduces) drop.add(index);
      });
      if (!drop.size) { keys.forEach(key => seen?.add(key)); return text; }
      pruned += drop.size;
      for (const index of [...drop].sort((a, b) => b - a)) text = text.slice(0, spans[index].start) + text.slice(spans[index].end);
      text = tidy(text);
    }
  };
  const finish = (conflicts: number, consistencyChecked: boolean) => {
    const seen = new Set<string>();
    parts = { ...parts, sections: parts.sections.map(text => prune(text, seen)), abstract: prune(parts.abstract, null) };
    return { parts, removed, conflicts, consistencyChecked, pruned, conflictPairs };
  };
  const map = (drop: (plain: string) => boolean, failure: ResearchClaimFailure) => {
    const apply = (text: string) => {
      const result = dropResearchSentences(text, drop);
      result.dropped.forEach(plain => { removed++; retire(plain, failure); });
      return result.markdown;
    };
    parts = { sections: parts.sections.map(apply), abstract: apply(parts.abstract),
      limitations: parts.limitations.map(apply).filter(Boolean), nextSteps: parts.nextSteps.map(apply).filter(Boolean) };
  };
  map(plain => {
    const own = byKey.get(researchSentenceKey(plain));
    // The same sentence judged both ways: the unfavourable verdict wins.
    if (own?.some(claim => claim.status !== 'supported' && bearsContent(claim))) return true;
    return restatesRejectedClaim(plain, rejected.filter(sentence => researchSentenceKey(sentence) !== researchSentenceKey(plain)));
  }, 'restates_rejected_claim');
  if (!findConflicts) return finish(0, false);
  const statements: string[] = [];
  const seen = new Set<string>();
  for (const text of [...parts.sections, parts.abstract, ...parts.limitations, ...parts.nextSteps]) {
    for (const span of researchProseSpans(text)) {
      const plain = researchPlainSentence(span.text), key = researchSentenceKey(plain);
      if (tokens(plain).size < 3 || seen.has(key)) continue;
      seen.add(key); statements.push(plain);
    }
  }
  if (statements.length < 2) return finish(0, true);
  let conflicts: ResearchConflict[];
  // A listed pair the judge itself calls compatible is not a finding; any other
  // listed pair is removed even when its quotes are imperfect (fail closed).
  try { conflicts = (await findConflicts(statements.slice(0, 160))).filter(item => item.a < statements.length && item.b < statements.length && item.incompatible); }
  catch { return finish(0, false); }
  // Kept for manual review: an over-eager consistency judge must be visible.
  conflictPairs = conflicts.slice(0, 20).map(item => ({ a: statements[item.a].slice(0, 400), b: statements[item.b].slice(0, 400), reason: item.reason.slice(0, 400) }));
  const conflicting = new Set(conflicts.flatMap(item => [researchSentenceKey(statements[item.a]), researchSentenceKey(statements[item.b])]));
  if (conflicting.size) map(plain => conflicting.has(researchSentenceKey(plain)), 'internal_contradiction');
  return finish(conflicts.length, true);
}
