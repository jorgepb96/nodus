import { decideResearchVerdict, normalizeResearchProseVerdicts, researchAuditSourceTransport, researchProseSpans, researchPlainSentence, researchEditorialHeading, type ResearchAuditSource, type ResearchClaimRecord, type ResearchClaimFailure } from './researchClaimAudit';
import { researchChatCalculations, researchChatLiteralQuotes, researchQuotedSpans } from './researchChatGrounding';

export const RESEARCH_ANSWER_REVIEW_POLICY = { version: 'coherent-v36', stage: 'coherent-answer-review-v36' } as const;

/** Presentation follows an explicit user request, not a model's preferred template. */
export function researchChatHeadingsRequested(question: string): boolean {
  if (/(?:sin|no\s+(?:uses?|incluyas?)|without|no)\s+(?:epígrafes|encabezados|headings|subheadings|apartados|secciones)/iu.test(question)) return false;
  return /(?:usa|usar|utiliza|utilizar|incluye|incluir|añade|añadir|use|include)\s+(?:\w+\s+){0,2}(?:epígrafes|encabezados|headings|subheadings)\b|(?:divide|dividir|organiza|organizar|estructura|estructurar|organize|structure|divide)\b[^.!?\n]{0,70}\b(?:apartados|secciones|epígrafes|encabezados|sections|headings)\b|(?:respuesta|resumen|texto|explicación|síntesis|answer|response|summary)\b[^.!?\n]{0,35}\b(?:con|en|por|with)\s+(?:\w+\s+){0,2}(?:apartados|secciones|epígrafes|encabezados|sections|headings)\b|^\s*(?:con|en|por|with)\s+(?:\w+\s+){0,2}(?:apartados|secciones|epígrafes|encabezados|sections|headings)\b/iu.test(question);
}
export function researchChatPresentationInstruction(question: string): string {
  const limits = researchAnswerRequestedBudgets(question);
  const budget = [limits.maxWords === undefined ? '' : `Aim for approximately ${limits.maxWords} prose words; this is guidance, not a correctness gate. Omit optional detail, not requested facets.`,
    limits.maxExplanationWords === undefined ? '' : `Aim for approximately ${limits.maxExplanationWords} explanation words; the literal excerpt is separate. This is guidance, not a correctness gate.`,
    limits.singleLiteral ? 'Use one literal source excerpt only. Paraphrase other statements and use italics for technical terms.' : ''].filter(Boolean).join(' ');
  return (researchChatHeadingsRequested(question)
    ? 'Use the headings explicitly requested by the user, with substantive paragraphs under each. Preserve inline Nodus citations with author, year and page labels.'
    : 'Write a cohesive answer in connected paragraphs, with clear transitions and inline Nodus citations (author, year and page). Keep substantive qualifications next to their assertions; omit routine operational/source-coverage disclaimers. Necessary source-coverage notes belong in a separate paragraph for the optional source-note control. Do not divide the answer into headings, numbered sections or standalone bold section labels unless the user explicitly requests them. Avoid a report template or an unsolicited catalogue of sources. Preserve Nodus visual/artifact blocks when requested.') + (budget ? ` ${budget}` : '');
}
export interface ResearchAnswerReview { accepted: boolean; claims: ResearchClaimRecord[]; issues: string[]; notes?: string[] }
export interface ResearchAnswerVerdicts { claims: unknown[]; coherent: boolean; relevant: boolean; complete: boolean; issues: string[] }
/** Proofs use the answer's actual citations and backend records. Keep the full
 * set only for a draft without citations, so missing links can still be repaired.
 * Source aliases remain unchanged; this cannot grant or invent a new source. */
export function researchAnswerProofSources<T extends { citation?: string }>(text: string, sources: readonly T[]): T[] {
  const cited = sources.filter(source => source.citation && text.includes(`](${source.citation})`));
  return cited.length ? sources.filter(source => !source.citation || cited.includes(source)) : [...sources];
}
/** Other retrieved material can refute an evidence-gap or expose a missing facet,
 * but cannot support a clause attached to a different citation. */
export function researchAnswerReviewSourceGroups<T extends { citation?: string }>(text: string, sources: readonly T[]) {
  const cited = sources.filter(source => source.citation && text.includes(`](${source.citation})`));
  return { cited, sources: sources.filter(source => !source.citation || cited.includes(source)),
    coverageSources: sources.filter(source => source.citation && !cited.includes(source)) };
}
/** A positive catalogue answer should let the reader open its actual records.
 * Zero-result queries and unknown/ambiguous titles never require invented links. */
export function researchAnswerCatalogueCitationIssues(text: string, sources: readonly ResearchAuditSource[]): string[] {
  const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const records = sources.filter(source => source.id.startsWith('record:') && source.title && /^nodus:\/\/work\//u.test(source.citation));
  const prose = normalize(text);
  const named = records.filter(record => {
    const title = normalize(record.title!);
    const linked = text.includes(`](${record.citation})`) || Boolean(record.workId && sources.some(source => source.workId === record.workId && text.includes(`](${source.citation})`)));
    return !linked && title.length >= 12 && prose.includes(title) && records.filter(other => normalize(other.title!) === title).length === 1;
  });
  return named.length ? [`positive_catalogue_examples_missing_nodus_citations: use the supplied work links for ${named.slice(0, 3).map(record => `${record.title}: ${record.citation}`).join('; ')}`] : [];
}

/** Default prose may paraphrase; it must never dress a translation or invented
 * wording as verbatim source text. Removing unrequested quotation marks does
 * NOT approve the assertion: the entire result still needs literal premises and
 * semantic entailment. Explicit literal requests keep the strict quote gate. */
export function canonicalResearchUnrequestedQuotes(text: string, sources: readonly ResearchAuditSource[], question: string): string {
  if (/\b(?:copia(?:r)?|literal(?:es|mente)?|textual(?:es|mente)?|quotes?|quotation|verbatim|littéral(?:ement)?|copi(?:ez|er)|wörtlich|zitat)\b/iu.test(question)) return text;
  const normalize = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const units = researchAnswerProofUnits(text);
  const literalInBoundSource = (span: { start: number; end: number; text: string }) => {
    const unit = units.find(unit => unit.start <= span.start && unit.end >= span.end);
    const cited = unit ? sources.filter(source => source.citation && unit.text.includes(`](${source.citation})`)) : [];
    return (cited.length ? cited : sources).some(source => normalize(source.text).includes(normalize(span.text)));
  };
  const spans = researchQuotedSpans(text).spans.filter(span => span.text.length >= 12
    && !literalInBoundSource(span)
    && !/(?:traducci[oó]n|translation|traduction)\s*:\s*$/iu.test(text.slice(Math.max(0, span.start - 40), span.start)));
  for (const span of spans.reverse()) text = text.slice(0, span.start) + span.text + text.slice(span.end);
  return text;
}
export function validResearchAnswerVerdicts(value: unknown): value is ResearchAnswerVerdicts {
  if (!value || typeof value !== 'object') return false;
  const row = value as ResearchAnswerVerdicts;
  return Array.isArray(row.claims) && row.claims.length <= 64 && typeof row.coherent === 'boolean'
    && typeof row.relevant === 'boolean' && typeof row.complete === 'boolean' && Array.isArray(row.issues)
    && row.issues.length <= 20 && row.issues.every(issue => typeof issue === 'string' && issue.length <= 1500);
}
/** Structural provider errors may be retried; unsupported content is never repaired
 * by coercing a positive verdict. Quote aliases are checked against sources later. */
export function validResearchAnswerCoverage(value: unknown, count: number, sourceIds?: ReadonlySet<string>, start = 0, envelopeOnly = false): value is ResearchAnswerVerdicts {
  if (!validResearchAnswerVerdicts(value) || value.claims.length !== count) return false;
  const seen = new Set<number>();
  return value.claims.every(raw => {
    if (!raw || typeof raw !== 'object') return false;
    const row = raw as Record<string, unknown>;
    const index = row.index as number;
    if (!Number.isInteger(index) || index < start || index >= start + count || seen.has(index)) return false;
    seen.add(index);
    if (envelopeOnly) return true; // Each malformed proof remains negative in the source-bound normalizer.
    return typeof row.supported === 'boolean' && typeof row.reason === 'string'
      && Array.isArray(row.premises) && row.premises.length <= 12
      && row.premises.every((rawPremise, position) => {
        if (!rawPremise || typeof rawPremise !== 'object') return false;
        const premise = rawPremise as Record<string, unknown>;
        return typeof premise.text === 'string' && premise.text.length > 0 && premise.text.length <= 500
          && ['fact', 'attribution', 'absence', 'relation', 'inference'].includes(premise.type as string)
          && typeof premise.entailed === 'boolean' && Array.isArray(premise.evidence) && premise.evidence.length <= 6
          && premise.evidence.every(rawProof => {
            if (!rawProof || typeof rawProof !== 'object') return false;
            const proof = rawProof as Record<string, unknown>;
            return typeof proof.id === 'string' && proof.id.length <= 512 && (!sourceIds || sourceIds.has(proof.id))
              && typeof proof.quote === 'string' && proof.quote.length > 0 && proof.quote.length <= 1500;
          })
          && (premise.from === undefined || Array.isArray(premise.from) && premise.from.length <= 10 && premise.from.every(parent => Number.isInteger(parent) && parent >= 0 && parent < position))
          && (premise.fromParagraphs === undefined || (Array.isArray(premise.fromParagraphs) && premise.fromParagraphs.length <= 10
            && new Set(premise.fromParagraphs).size === premise.fromParagraphs.length && premise.fromParagraphs.every(parent => Number.isInteger(parent) && parent >= 0 && parent < index)));
      })
      && Array.isArray(row.unsupportedParts) && row.unsupportedParts.length <= 12 && row.unsupportedParts.every(part => typeof part === 'string');
  });
}

/** Long answers use bounded proof batches proactively, with stable global unit
 * identities. Cross-batch dependencies still pass the full backend proof gate. */
export async function researchAnswerVerdictsWithFallback(paragraphs: string[],
  check: (paragraphs: Array<{ index: number; text: string }>, independent: boolean) => Promise<ResearchAnswerVerdicts>, signal?: AbortSignal,
  recheck?: typeof check): Promise<ResearchAnswerVerdicts> {
  const indexed = paragraphs.map((text, index) => ({ index, text }));
  const structural = (error: unknown) => ['schema_mismatch', 'invalid_json', 'output_truncated'].includes(String(error && typeof error === 'object' && 'code' in error ? error.code : undefined));
  const once = async (units: typeof indexed, independent: boolean) => {
    try { return await check(units, independent); }
    catch (error) {
      signal?.throwIfAborted();
      if (!structural(error) || !recheck) throw error;
      return recheck(units, independent);
    }
  };
  const batches = async (size: number) => {
    const parts: ResearchAnswerVerdicts[] = [];
    for (let start = 0; start < paragraphs.length; start += size) {
      signal?.throwIfAborted();
      const batch = indexed.slice(start, start + size);
      const result = await once(batch, true);
      if (!validResearchAnswerCoverage(result, batch.length, undefined, start, true)) throw Object.assign(new Error('Invalid proof batch'), { code: 'schema_mismatch' });
      parts.push(result);
    }
    return { claims: parts.flatMap(part => part.claims), coherent: parts.every(part => part.coherent), relevant: parts.every(part => part.relevant), complete: parts.every(part => part.complete),
      issues: [...new Set(parts.flatMap(part => part.issues))] };
  };
  if (paragraphs.length > 12 && paragraphs.length <= 64) return batches(4);
  try { return await once(indexed, false); }
  catch (error) {
    signal?.throwIfAborted();
    if (!structural(error) || paragraphs.length < 2 || paragraphs.length > 64) throw error;
    return batches(1);
  }
}

/** Reject a proof that names an alias absent from its actual model input. This
 * creates a negative diagnosis for revision, never a positive verdict or a new
 * source grant. An invalid evidence binding is not a provider outage. */
export function rejectUnprovidedResearchProofs(value: ResearchAnswerVerdicts, sourceIds: ReadonlySet<string>): ResearchAnswerVerdicts {
  return { ...value, claims: value.claims.map(raw => {
    const claim = raw as { premises?: Array<{ evidence?: Array<{ id: string }> }>; unsupportedParts?: string[] };
    if (!Array.isArray(claim.premises)) return raw;
    return claim.premises.some(premise => Array.isArray(premise?.evidence) && premise.evidence.some(proof => !sourceIds.has(proof?.id)))
      ? { ...claim, supported: false, unsupportedParts: [...(Array.isArray(claim.unsupportedParts) ? claim.unsupportedParts.slice(0, 11) : []), 'source_not_supplied_to_this_proof'] } : raw;
  }) };
}

/** Bibliographic names are identities, not verbatim quotations from a work.
 * Only a unique match with identical words can be replaced by its known title. */
export function canonicalResearchTitles(text: string, titles: readonly string[]): string {
  const key = (value: string) => value.normalize('NFC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return text.replace(/«([^»\n]+)»|“([^”\n]+)”|"([^"\n]+)"/gu, (match, a: string, b: string, c: string) => {
    const value = key(a ?? b ?? c);
    const matches = [...new Set(titles)].filter(title => value.length >= 12 && key(title) === value);
    return matches.length === 1 ? `*${matches[0].replace(/[*_]/gu, '\\$&')}*` : match;
  });
}
/** Visible citation identity comes from backend metadata, before the full review.
 * A unique literal quote immediately before a link can narrow its page range;
 * otherwise retain the actual passage locator rather than guessed precision. */
export function canonicalResearchCitationLabels(text: string, sources: readonly ResearchAuditSource[]): string {
  const quotes = researchQuotedSpans(text).spans;
  return text.replace(/\[([^\]\n]*)\]\((nodus:\/\/[^)\s]+)\)/gu, (full, _label: string, citation: string, offset: number) => {
    if (quotes.some(quote => quote.start <= offset && offset < quote.end)) return full;
    const matches = sources.filter(source => source.citation === citation && source.citationLabel);
    if (!matches.length || new Set(matches.map(source => source.citationLabel)).size !== 1) return full;
    const source = matches[0]; let label = source.citationLabel!;
    const adjacent = quotes.filter(quote => quote.end <= offset && /^[\s(,;:]*$/u.test(text.slice(quote.end, offset))).at(-1);
    if (source.locator && adjacent && adjacent.text.length >= 12) {
      const markers = [...source.text.matchAll(/\[p\.\s*([0-9]+|[ivxlcdm]+)\]/giu)];
      const pages = markers.flatMap((marker, index) => {
        const page = source.text.slice(marker.index! + marker[0].length, markers[index + 1]?.index ?? source.text.length);
        return page.includes(adjacent.text) ? [marker[1]] : [];
      });
      if (new Set(pages).size === 1 && label.endsWith(source.locator)) label = label.slice(0, -source.locator.length) + `p. ${pages[0]}`;
    }
    return `[${label.replace(/[[\]\\\r\n]/gu, ' ')}](${citation})`;
  });
}
/** Correct a bibliographic kind only when a unique full title and its author
 * identify the record. Never modify a literal quotation or guess a document type. */
export function canonicalResearchDocumentTypes(text: string, records: readonly { title: string; authors: string[]; documentType: string | null }[]): string {
  const key = (value: string) => value.normalize('NFC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const kinds: Record<string, { noun: string; feminine: boolean }> = {
    thesis: { noun: 'tesis', feminine: true }, journalArticle: { noun: 'artículo', feminine: false },
    book: { noun: 'libro', feminine: false }, bookSection: { noun: 'capítulo', feminine: false }, report: { noun: 'informe', feminine: false },
  };
  return researchAnswerParagraphs(text).map(paragraph => {
    const visible = paragraph.replace(/«[^»]*»|“[^”]*”|"[^"\n]*"/gu, match => ' '.repeat(match.length));
    const namedTitles = [...visible.matchAll(/\*([^*\n]+)\*/gu)].map(match => key(match[1]));
    const matches = records.filter(record => record.documentType && kinds[record.documentType] && key(record.title).length >= 12 && namedTitles.includes(key(record.title)));
    if (matches.length !== 1) return paragraph;
    const record = matches[0], kind = kinds[record.documentType!];
    const changes: Array<{ start: number; end: number; text: string }> = [];
    for (const name of [...new Set(record.authors.map(author => author.split(',')[0].trim()))].sort((a, b) => b.length - a.length)) {
      if (name.length < 4) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const pattern = new RegExp(`\\b(el|la|un|una)\\s+(artículo|tesis|libro|capítulo|informe)\\s+de\\s+${escaped}(?=[,\\s]|$)`, 'giu');
      for (const match of visible.matchAll(pattern)) {
        if (changes.some(change => match.index! < change.end && match.index! + match[0].length > change.start)) continue;
        const indefinite = /^un/iu.test(match[1]);
        let determiner = indefinite ? kind.feminine ? 'una' : 'un' : kind.feminine ? 'la' : 'el';
        if (match[1][0] === match[1][0].toUpperCase()) determiner = determiner[0].toUpperCase() + determiner.slice(1);
        changes.push({ start: match.index!, end: match.index! + match[0].length, text: match[0].replace(/^(?:el|la|un|una)\s+(?:artículo|tesis|libro|capítulo|informe)/iu, `${determiner} ${kind.noun}`) });
      }
    }
    for (const change of changes.sort((a, b) => b.start - a.start)) paragraph = paragraph.slice(0, change.start) + change.text + paragraph.slice(change.end);
    return paragraph;
  }).join('\n\n');
}
/** Route evidence by closed aliases instead of asking a model to retype OCR.
 * The selected text is always copied from the frozen source, never generated. */
export function researchAnswerEvidenceTransport(sources: readonly ResearchAuditSource[]) {
  const routing = researchAuditSourceTransport(sources);
  const quotes = new Map<string, Map<string, string>>();
  return {
    sources: routing.sources.map(({ text, ...source }) => {
      const entries: Array<{ key: string; text: string }> = [];
      for (let start = 0; start < text.length;) {
        let end = Math.min(start + 1200, text.length);
        if (end < text.length) {
          const boundary = text.lastIndexOf(' ', end);
          if (boundary > start + 600) end = boundary;
        }
        entries.push({ key: `q${entries.length + 1}`, text: text.slice(start, end) });
        start = end;
      }
      quotes.set(source.id, new Map(entries.map(entry => [entry.key, entry.text])));
      return { ...source, quotes: entries };
    }),
    restore<T extends { claims: unknown[] }>(value: T): T {
      const restored = { ...value, claims: value.claims.map(claim => {
        if (!claim || typeof claim !== 'object') return claim;
        const row = claim as { premises?: unknown[] };
        return { ...row, ...(Array.isArray(row.premises) ? { premises: row.premises.map(premise => {
          if (!premise || typeof premise !== 'object') return premise;
          const atom = premise as { evidence?: unknown[] };
          return { ...atom, ...(Array.isArray(atom.evidence) ? { evidence: atom.evidence.map(evidence => {
            if (!evidence || typeof evidence !== 'object') return evidence;
            const proof = evidence as { id?: string; quote?: string };
            const literal = quotes.get(proof.id ?? '')?.get(proof.quote ?? '');
            return literal === undefined ? evidence : { ...proof, quote: literal };
          }) } : {}) };
        }) } : {}) };
      }) } as T;
      return routing.restore(restored);
    },
  };
}
/** Citation-only parentheses have no prose to preserve. Rebuild their separators,
 * leaving mixed prose, literal quotations and the citation targets untouched. */
export function canonicalResearchCitationGroups(text: string): string {
  return text.replace(/«[^»]*»|“[^”]*”|"[^"\n]*"|[ \t]*\((?:\[[^\]\n]*\]\(nodus:\/\/[^)\s]+\)|[^()\n])*\)/gu, match => {
    const group = match.trimStart();
    if (!group.startsWith('(')) return match;
    const links = [...group.matchAll(/\[[^\]\n]*\]\(nodus:\/\/[^)\s]+\)/gu)].map(match => match[0]);
    const residue = group.slice(1, -1).replace(/\[[^\]\n]*\]\(nodus:\/\/[^)\s]+\)/gu, '');
    if (!/^[\s,;]*$/u.test(residue)) return match;
    return links.length ? match.slice(0, match.length - group.length) + `(${[...new Set(links)].join('; ')})` : '';
  });
}
/** Restore only typography variants of a unique contiguous literal span. The
 * replacement is copied from an authorized excerpt; words, accents, case, OCR,
 * omissions and editorial insertions are never repaired by similarity. */
export function canonicalResearchLiteralQuotes(text: string, sources: readonly ResearchAuditSource[]): string {
  const excerpts = sources.filter(source => !source.id.startsWith('record:') && source.id !== 'run-operations')
    .map(source => source.text.includes('Verbatim excerpt:\n') ? source.text.split('Verbatim excerpt:\n').slice(1).join('Verbatim excerpt:\n') : source.text);
  for (const span of researchQuotedSpans(text).spans.reverse()) {
    if (span.text.length < 12 || excerpts.some(excerpt => excerpt.includes(span.text))) continue;
    const quote = span.text.replace(/\\(["'«»“”])/gu, '$1').replace(/\s+/gu, ' ');
    const pattern = [...quote].map(character => /['’]/u.test(character) ? "['’]" : /["“”«»]/u.test(character) ? '["“”«»]'
      : /\s/u.test(character) ? '\\s+' : character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('');
    const hits = new Set(excerpts.flatMap(excerpt => [...excerpt.matchAll(new RegExp(pattern, 'gu'))].map(hit => hit[0])));
    if (hits.size !== 1) continue;
    text = text.slice(0, span.start + 1) + [...hits][0] + text.slice(span.end - 1);
  }
  return text;
}
/** An explicitly requested paraphrase can use short technical terms in italics.
 * Long quotations still need rewriting and the whole answer is checked again. */
export function canonicalResearchParaphraseStyle(text: string, question: string): string {
  if (!/paráfrasis.*en lugar.*citas|sin citas literales|no (?:uses|incluyas) citas literales/iu.test(question)) return text;
  for (const span of researchQuotedSpans(text).spans.reverse()) {
    if (span.text.length > 80 || span.text.split(/\s+/u).length > 8 || /\n/u.test(span.text)) continue;
    text = text.slice(0, span.start) + `*${span.text.replace(/[*_]/gu, '\\$&')}*` + text.slice(span.end);
  }
  return text;
}
/** Paragraphs retain the antecedents and qualifications that sentence pruning lost. */
export const researchAnswerParagraphs = (text: string): string[] => text.trim().split(/\n\s*\n/u).filter(part => part.trim());
/** Only a backend citation repair may reuse a proof, and only when the prose
 * projection is identical. New links still undergo citation and semantic checks. */
export function researchAnswerCitationProjection(text: string): string {
  return canonicalResearchCitationGroups(text.replace(/\[[^\]\n]*\]\(nodus:\/\/[^)\s]+\)/gu, '')).trim();
}
/** Review every paragraph, prioritizing framing, counts and credit roles. Even a
 * single-source paragraph can conflate terms or bind a clause to the wrong citation. */
/** Sentence-sized proof units retain offsets into the original prose. Citation
 * labels/URLs and literal quotations are opaque to sentence segmentation. */
export function researchAnswerProofUnits(text: string): Array<{ text: string; start: number; end: number }> {
  const units: Array<{ text: string; start: number; end: number }> = [];
  let cursor = 0;
  for (const paragraph of researchAnswerParagraphs(text)) {
    const base = text.indexOf(paragraph, cursor); cursor = base + paragraph.length;
    let masked = paragraph.replace(/\[[^\]\n]*\]\([^)]+\)/gu, match => 'x'.repeat(match.length));
    let depth = 0, opened = 0;
    for (let i = 0; i < masked.length; i++) {
      if (masked[i] === '(') { if (depth++ === 0) opened = i; }
      else if (masked[i] === ')' && depth > 0 && --depth === 0) masked = masked.slice(0, opened) + 'x'.repeat(i - opened + 1) + masked.slice(i + 1);
    }
    masked = masked.replace(/\b(?:pp?|págs?|pags?|vol|núm|eds?|coords?)\.\s*(?=\d)/giu, match => match.replace('.', 'x'));
    masked = masked.replace(/^(\s*(?:#{1,6}\s*)?(?:\*\*|__)?\d{1,2})\.(?=\s|[*_])/gmu, match => match.replace('.', 'x'));
    for (const span of researchQuotedSpans(paragraph).spans.reverse()) masked = masked.slice(0, span.start) + 'x'.repeat(span.end - span.start) + masked.slice(span.end);
    for (const segment of new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(masked)) {
      const raw = paragraph.slice(segment.index, segment.index + segment.segment.length);
      const content = raw.trim();
      if (!content) continue;
      const start = base + segment.index + raw.indexOf(content);
      units.push({ text: content, start, end: start + content.length });
    }
  }
  return units;
}

export function researchAnswerSemanticFocus(text: string, collectiveCredits = false, question = '', sentenceUnits = false): Array<{ index: number; text: string }> {
  const priority = (paragraph: { text: string }) => Number(collectiveCredits
    || new Set([...paragraph.text.matchAll(/\[[^\]\n]*\]\((nodus:\/\/[^)\s]+)\)/gu)].map(match => match[1])).size >= 2
    || /no (?:propongas|incluyas|añadas|ofrezcas)|una sola (?:oración|cita)|paráfrasis.*en lugar.*citas|sin citas literales/iu.test(question)
    || /jerar|hierarch|incluy|includes|contains|en tensión|frente a|en cambio|a diferencia|por contraste|discrep|contradic|consenso|unánim|continuidad|influenc|demostr|empíric|causal|\bcaus[aoó]|\b(?:dos|tres|cuatro|cinco|\d+)\s+(?:obras|fuentes)|disagree|contradict|consensus|causal|continuity|metadatos|catálogo/iu.test(paragraph.text));
  return (sentenceUnits ? researchAnswerProofUnits(text).map(unit => unit.text) : researchAnswerParagraphs(text)).map((text, index) => ({ index, text })).sort((a, b) => priority(b) - priority(a) || a.index - b.index);
}
/** A few high-risk claims need their scope in the same sentence. A source's
 * own literal wording is still checked separately; never infer a whole work's
 * absence from a retrieved subset. This is independent of the judge's approval. */
export function researchAnswerScopeIssues(text: string): string[] {
  return researchProseSpans(text).flatMap(({ text: sentence }) => {
    const body = sentence.replace(/«[^»]*»|“[^”]*”|"[^"\n]*"/gu, '')
      .replace(/\b(?:no|not)\s+(?:solo|solamente|únicamente|only)\b/giu, '')
      .replace(/\b(?:no es|no era|is not|isn't|not)\s+(?:la\s+|the\s+)?(?:únic[ao]|only|sole)\s+(?:obra|publicación|trabajo|work|paper)\b/giu, '');
    const exclusive = /(?<![\p{L}\p{N}_])(?:solo|solamente|únicamente)\s+(?:aparece|figura|consta)\b(?!\s+que\b)|(?<![\p{L}\p{N}_])(?:únic[ao]|only|sole)\s+(?:obra|publicación|trabajo|work|paper)\b|\bonly\s+appears\b/iu.test(body);
    const bounded = /no (?:puedo|podemos) (?:afirmar|establecer|concluir)|cannot (?:establish|conclude)|\b(?:recuperad[oa]s?|consultad[oa]s?|retrieved|consulted|query results)\b|\b(?:provided|available|these)\s+excerpts?\b|\b(?:en|con|entre|según)\s+(?:estos?|los?|esos?)\s+(?:fragmentos?|pasajes?|resultados?)\b/iu.test(body);
    const corpusAbsence = /\b(?:la|tu|mi|esta)\s+biblioteca\s+(?:no\s+(?:demuestra|contiene|ofrece|documenta)|carece)|\b(?:the|your)\s+library\s+(?:does not|doesn't|contains no|lacks)/iu.test(body);
    const excerptScope = /\b(?:fragmentos?|pasajes?|extractos?|excerpts?)\b/iu.test(body);
    return [...(exclusive && !bounded && !excerptScope ? ['unbounded_source_exclusivity'] : []), ...(corpusAbsence && !bounded ? ['unbounded_corpus_absence'] : [])];
  });
}
export function researchAnswerRequestedBudgets(question: string) {
  const global = /(?:máximo|maximum|at most|no más de)\s+(\d{1,4})\s+(?:palabras|words)/iu.exec(question);
  const beforeLimit = global ? question.slice(Math.max(0, question.lastIndexOf('.', global.index - 1) + 1), global.index) : '';
  const perPart = /\b(?:cada|each|por autor|per author)\b/iu.test(beforeLimit) && !/en total|in total/iu.test(question.slice(global?.index ?? 0));
  const explanation = /explicación\s+(?:de\s+)?(?:hasta|máximo)\s+(\d{1,4})\s+palabras/iu.exec(question);
  const single = /(?:una sola|una única|solo una|exactamente una) (?:oración|frase|cita)|(?:exactly one|a single|only one) (?:verbatim |literal )?(?:quote|quotation|sentence)/iu.test(question);
  return { maxWords: global && !perPart ? Number(global[1]) : undefined, maxExplanationWords: explanation ? Number(explanation[1]) : undefined, singleLiteral: single };
}
/** A short prose request must not reserve a book-sized visible answer. Thinking
 * allowance is added separately by the caller, after this visible-output cap. */
export function researchChatRequestedOutputTokens(question: string, maximum: number): number {
  const limits = researchAnswerRequestedBudgets(question);
  const words = limits.maxWords ?? (/cita breve|short (?:quote|quotation)/iu.test(question) ? limits.maxExplanationWords : undefined);
  return words === undefined ? maximum : Math.min(maximum, Math.max(4096, words * 4 + 2048));
}
/** Numeric answer targets are advisory; an explicit quotation request still controls form. */
export function researchAnswerRequestedBudgetIssues(text: string, question: string): string[] {
  const { singleLiteral } = researchAnswerRequestedBudgets(question);
  const plain = text.replace(/\[[^\]\n]*\]\([^)]+\)/gu, '');
  const quotes = researchQuotedSpans(plain).spans;
  const issues: string[] = [];
  if (singleLiteral && quotes.filter(span => span.text.length >= 12).length > 1) issues.push('requested_single_literal_excerpt: keep one source quotation; paraphrase or italicize other terms');
  return issues;
}
export function researchAnswerStructureIssues(text: string, question: string, chat = true): string[] {
  const issues: string[] = [];
  if (!text.trim()) issues.push('empty_answer');
  if (chat) issues.push(...researchAnswerScopeIssues(text), ...researchAnswerRequestedBudgetIssues(text, question));
  if (researchAnswerParagraphs(text).length > 64) issues.push('too_many_paragraphs');
  if (chat && !researchChatHeadingsRequested(question)
    && /^\s*(?:#{1,6}\s+.+|(?:\*\*|__)[^\n]+(?:\*\*|__)\s*:?|\d+[.)]\s+(?:\*\*|__)[^\n]+(?:\*\*|__))\s*$/mu.test(text)) issues.push('unrequested_headings');
  const lines = text.split('\n').filter(line => line.trim());
  for (let index = 0; index < lines.length; index++) {
    if (/^\s*#{1,6}\s/u.test(lines[index]) && (!lines[index + 1] || /^\s*#{1,6}\s/u.test(lines[index + 1]))) issues.push('empty_heading');
    if (/^\s*\|?[\s:|-]+\|\s*$/u.test(lines[index]) && /---/u.test(lines[index])) {
      const columns = (line: string) => line.trim().replace(/^\||\|$/gu, '').split('|').length;
      if (!lines[index - 1]?.includes('|') || !lines[index + 1]?.includes('|')
        || columns(lines[index - 1]) !== columns(lines[index + 1])) issues.push('broken_table');
    }
  }
  return [...new Set(issues)];
}
type ParagraphVerdict = NonNullable<ReturnType<typeof normalizeResearchProseVerdicts>[number]>;

/** Prior paragraphs are lemmas only after their evidence, literal quotations,
 * citations and calculations pass. No self/future references or unverified draft
 * text can become evidence. Local and paragraph dependencies must all hold. */
function decideParagraphProof(paragraph: string, verdict: ParagraphVerdict, rawPremises: unknown[], sources: ResearchAuditSource[], previous: ResearchClaimRecord[]) {
  if (!verdict.premises.length) return decideResearchVerdict(paragraph, verdict, sources);
  const valid: boolean[] = [];
  const evidence: ResearchClaimRecord['evidence'] = [];
  let failure: ResearchClaimFailure | undefined;
  const normalize = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  for (const [index, premise] of verdict.premises.entries()) {
    const raw = rawPremises[index] as { fromParagraphs?: unknown } | undefined;
    const refs = raw?.fromParagraphs ?? [];
    const wellFormed = Array.isArray(refs) && refs.length <= 10 && new Set(refs).size === refs.length
      && refs.every(ref => Number.isInteger(ref) && ref >= 0 && ref < previous.length);
    if (!wellFormed) { valid.push(false); failure ??= 'inference_without_supported_premises'; continue; }
    if (premise.type === 'inference') {
      const literal = premise.evidence.every(proof => sources.some(source => source.id === proof.id && normalize(source.text).includes(normalize(proof.quote))));
      const supported = premise.entailed && literal && (premise.from.length > 0 || refs.length > 0)
        && premise.from.every(parent => valid[parent])
        && refs.every(ref => previous[ref].status === 'supported' && previous[ref].kind !== 'nonfactual' && previous[ref].evidence.length > 0);
      valid.push(supported);
      if (!supported) failure ??= !premise.entailed ? 'premise_not_entailed' : !literal ? 'premise_without_literal_evidence' : 'inference_without_supported_premises';
      else evidence.push(...refs.flatMap(ref => previous[ref].evidence));
    } else {
      const decision = decideResearchVerdict(paragraph, { ...verdict, kind: premise.type === 'attribution' ? 'attributed' : 'fact',
        explicitInference: false, supported: true, unsupportedParts: [], premises: [{ ...premise, from: [] }] }, sources);
      valid.push(decision.valid && refs.length === 0);
      if (!decision.valid) failure ??= decision.failure;
      if (refs.length) failure ??= 'inference_without_supported_premises';
      if (decision.valid && !refs.length) evidence.push(...decision.evidence);
    }
  }
  if (verdict.unsupportedParts.some(part => part.trim())) failure ??= 'unsupported_parts';
  if (!verdict.supported) failure ??= 'judge_rejected';
  const unique = [...new Map(evidence.map(proof => [`${proof.id}\u0000${normalize(proof.quote)}`, proof])).values()];
  const failed = valid.flatMap((ok, index) => ok ? [] : [`Premise ${index}: ${verdict.premises[index].text} (type=${verdict.premises[index].type}, entailed=${verdict.premises[index].entailed}); verify the source alias/quote key, and use attribution for idea notes.`]);
  return { valid: !failure, failure, evidence: failure ? [] : unique, diagnosis: failed.join(' ') };
}
/** Diagnostics only. Never return the sentence-deleted Markdown of the old audit. */
export function assessResearchAnswer(text: string, sources: ResearchAuditSource[], raw: ResearchAnswerVerdicts,
  question: string, chat = true, proofUnits?: string[]): ResearchAnswerReview {
  const paragraphs = proofUnits ?? researchAnswerParagraphs(text);
  const issues = researchAnswerStructureIssues(text, question, chat);
  if (chat && issues.some(issue => issue.startsWith('unbounded_'))) {
    for (const span of researchProseSpans(text)) if (researchAnswerScopeIssues(span.text).length) issues.push(`Qualify this claim to the actual queried scope: ${researchPlainSentence(span.text).slice(0, 600)}`);
  }
  if (!raw.coherent) issues.push('incoherent_answer');
  if (!raw.relevant) issues.push('irrelevant_content');
  if (!raw.complete) issues.push('unanswered_requested_facets');
  // Free-form diagnostics can describe a correctly acknowledged limitation.
  // Semantic blockers have explicit flags; factual support has strict gates below.
  if (!raw.coherent || !raw.relevant || !raw.complete) issues.push(...raw.issues.filter(issue => issue.trim()));
  if (raw.claims.length !== paragraphs.length || raw.claims.some(claim => !claim || typeof claim !== 'object'
    || !Number.isInteger((claim as { index: number }).index) || (claim as { index: number }).index < 0
    || (claim as { index: number }).index >= paragraphs.length)) issues.push('invalid_paragraph_coverage');
  const claims: ResearchClaimRecord[] = [];
  for (const [index, paragraph] of paragraphs.entries()) {
    const matches = raw.claims.filter(claim => !!claim && typeof claim === 'object' && (claim as { index: number }).index === index);
    // A paragraph mixes attributions and deductions. Its display kind is derived
    // from its premises, not a second, contradictory classification by the judge.
    // Necessary, evidence-backed deductions do not need a ritual "I infer" label.
    // Their truth still requires every premise, literal proof and dependency below.
    const normalized = normalizeResearchProseVerdicts({ claims: matches.map(claim => {
      const row = claim as Record<string, unknown>;
      const inferred = Array.isArray(row.premises) && row.premises.some(premise => premise?.type === 'inference');
      return { ...row, index: 0, ...(Array.isArray(row.premises) && row.premises.length ? { kind: inferred ? 'inference' : row.kind === 'attributed' ? 'attributed' : 'fact', explicitInference: inferred } : {}) };
    }) }, 1, sources);
    const verdict = normalized[0];
    if (!verdict) { claims.push({ sentence: paragraph, kind: 'fact', status: 'unverified', evidence: [], reason: normalized.malformed?.get(0) ?? 'missing_paragraph_verdict' }); continue; }
    const rawPremises = (matches[0] as { premises: unknown[] }).premises;
    const decision = decideParagraphProof(paragraph, verdict, rawPremises, sources, claims);
    const cited = [...paragraph.matchAll(/\[[^\]\n]*\]\((nodus:\/\/[^)\s]+)\)/gu)].map(match => match[1]);
    const supportingIds = new Set(decision.evidence.map(evidence => evidence.id));
    const substantive = !decision.evidence.some(proof => sources.some(source => source.id === proof.id && source.proseSupport === false));
    const editorial = verdict.kind === 'nonfactual' && researchEditorialHeading(paragraph);
    const authorized = cited.every(citation => sources.some(source => source.citation === citation && (editorial || supportingIds.has(source.id))));
    const citationEvidenceIds = [...new Set(verdict.premises.flatMap(premise => premise.evidence.map(proof => proof.id)))];
    const needsCitation = sources.some(source => Boolean(source.citation) && citationEvidenceIds.includes(source.id));
    const hasCitation = !needsCitation || (proofUnits
      ? sources.filter(source => source.citation && citationEvidenceIds.includes(source.id)).every(source => cited.includes(source.citation))
      : cited.length > 0);
    const claim: ResearchClaimRecord = { sentence: paragraph, kind: verdict.kind, status: decision.valid && substantive && authorized && hasCitation ? 'supported' : 'removed', evidence: decision.evidence, citationEvidenceIds,
      reason: !substantive ? 'non_substantive_source_fragment' : decision.failure ? `${decision.failure}: ${'diagnosis' in decision ? decision.diagnosis : verdict.reason}` : !authorized ? 'citation_without_verified_support' : !hasCitation ? 'missing_documentary_citation' : verdict.reason,
      ...(decision.failure ? { failure: decision.failure } : {}), premises: verdict.premises.map(({ text, type, entailed }) => ({ text, type, entailed })) };
    claims.push(researchChatCalculations(researchChatLiteralQuotes({ markdown: paragraph, claims: [claim] }, sources)).claims[0]);
  }
  return { accepted: issues.length === 0 && claims.length > 0 && claims.every(claim => claim.status === 'supported'), claims, issues: [...new Set(issues)], notes: raw.issues };
}

/** Recover presentation from already checked evidence, never from a guessed ID.
 * The caller must review this whole result again before it can be published. */
export function bindResearchAnswerCitations(text: string, review: ResearchAnswerReview, sources: ResearchAuditSource[], units?: Array<{ text: string; start: number; end: number }>): string | null {
  const paragraphs = units?.map(unit => unit.text) ?? researchAnswerParagraphs(text);
  if (units?.some((unit, i) => text.slice(unit.start, unit.end) !== unit.text || i > 0 && unit.start < units[i - 1].end)) return null;
  if (review.issues.length || paragraphs.length !== review.claims.length || !review.claims.some(claim => claim.reason === 'missing_documentary_citation' || (claim.reason === 'citation_without_verified_support' && !claim.failure))) return null;
  let changed = false;
  const result = paragraphs.map((paragraph, index) => {
    const claim = review.claims[index];
    if (claim.sentence !== paragraph || (claim.reason !== 'missing_documentary_citation' && !(claim.reason === 'citation_without_verified_support' && !claim.failure)) || !claim.evidence.length) return paragraph;
    const normalize = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (!claim.evidence.every(proof => sources.some(source => source.id === proof.id && normalize(source.text).includes(normalize(proof.quote))))) return paragraph;
    const ids = new Set(claim.evidence.map(proof => proof.id));
    const direct = new Set(claim.citationEvidenceIds ?? ids);
    if ([...direct].some(id => !ids.has(id))) return paragraph;
    const authorized = new Set(sources.filter(source => ids.has(source.id)).map(source => source.citation));
    const cleaned = canonicalResearchCitationGroups(paragraph.replace(/[ \t]*\[[^\]\n]*\]\((nodus:\/\/[^)\s]+)\)/gu, (match, url: string) => authorized.has(url) ? match : '')).trim();
    const links = [...new Map(sources.filter(source => direct.has(source.id) && !cleaned.includes(`](${source.citation})`) && /^nodus:\/\/(?:passage|idea|work)\//u.test(source.citation))
      .map(source => [source.citation, `[${(source.citationLabel ?? source.label).replace(/[[\]\\\r\n]/gu, ' ')}](${source.citation})`])).values()];
    if (!links.length && cleaned === paragraph) return paragraph;
    changed = true;
    if (!links.length) return cleaned;
    const ending = /[.!?]$/u.exec(cleaned)?.[0] ?? '';
    return `${ending ? cleaned.slice(0, -1) : cleaned} (${links.join('; ')})${ending}`;
  });
  if (!changed) return null;
  if (!units) return result.join('\n\n');
  let restored = text;
  for (let i = units.length - 1; i >= 0; i--) restored = restored.slice(0, units[i].start) + result[i] + restored.slice(units[i].end);
  return restored;
}
/** A failed review is not evidence that the library lacks the requested facts. */
export function researchAnswerReviewLimitation(language: string): string {
  if (language.startsWith('es')) return 'No he podido completar la comprobación de una respuesta suficientemente respaldada. No puedo presentar el borrador como una conclusión verificada; este límite de comprobación no demuestra que la información no exista en tu biblioteca.';
  return 'I could not complete verification of a sufficiently supported answer. I cannot present the draft as a verified conclusion; this verification limit does not establish that the information is absent from your library.';
}
/** Two changed revisions, one retry for no progress and three citation repairs
 * have separate bounds. Every changed candidate is checked again; no unchecked final repair. */
export async function reviewAndReviseResearchAnswer(draft: string, review: (text: string) => Promise<ResearchAnswerReview>,
  revise: (text: string, diagnosis: ResearchAnswerReview, attempt: number) => Promise<string>, language: string, signal?: AbortSignal,
  format?: (text: string, diagnosis: ResearchAnswerReview) => string | null) {
  const attempts: ResearchAnswerReview[] = [];
  let answer = draft, contentRevisions = 0, citationRepairs = 0, rewriteAttempts = 0, unchangedRevisions = 0, lastRevisionUnchanged = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    signal?.throwIfAborted();
    try { attempts.push(await review(answer)); }
    catch (error) {
      signal?.throwIfAborted();
      if (error instanceof Error && /research_run_(?:not_authorized|context_changed|closed)|scope.*changed|permission/iu.test(error.message)) throw error;
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : error instanceof Error ? error.name : 'unknown';
      attempts.push({ accepted: false, claims: [], issues: ['verification_unavailable'], notes: [code] });
    }
    signal?.throwIfAborted();
    const diagnosis = attempts.at(-1)!;
    if (diagnosis.accepted) return { answer, status: 'verified' as const, attempts, contentRevisions, citationRepairs, rewriteAttempts };
    if (attempt === 5 || diagnosis.issues.includes('verification_unavailable')) break;
    const formatted = citationRepairs < 3 ? format?.(answer, diagnosis) : null;
    if (formatted && formatted !== answer) { answer = formatted; citationRepairs++; continue; }
    if (contentRevisions >= 2 || rewriteAttempts >= 3 || unchangedRevisions >= 2) break;
    try {
      const revised = await revise(answer, lastRevisionUnchanged ? { ...diagnosis, issues: ['previous_revision_made_no_change: build a fresh answer that resolves the concrete defects', ...diagnosis.issues] } : diagnosis, ++rewriteAttempts);
      lastRevisionUnchanged = revised.trim() === answer.trim();
      if (lastRevisionUnchanged) unchangedRevisions++;
      else contentRevisions++;
      answer = revised;
    }
    catch (error) {
      signal?.throwIfAborted();
      if (error instanceof Error && /research_run_(?:not_authorized|context_changed|closed)|scope.*changed|permission/iu.test(error.message)) throw error;
      break;
    }
  }
  // One last coherent reconstruction is useful only when real evidence-backed
  // units survived. Never publish the units by deleting failed sentences, retry a
  // technical outage, or treat the reconstruction as approved without review.
  const core = attempts.at(-1);
  if (core && !core.issues.includes('verification_unavailable') && core.claims.some(claim => claim.status === 'supported' && claim.evidence.length)) {
    signal?.throwIfAborted();
    try {
      let candidate = await revise('', { ...core, issues: ['verified_core_reconstruction: rebuild from the useful supported core, resolving all remaining objections', ...core.issues] }, ++rewriteAttempts);
      if (candidate.trim() !== answer.trim()) {
        contentRevisions++;
        let checked = await review(candidate); attempts.push(checked);
        signal?.throwIfAborted();
        if (checked.accepted) return { answer: candidate, status: 'verified' as const, attempts, contentRevisions, citationRepairs, rewriteAttempts, verifiedCoreReconstruction: true };
        // A reconstruction is a fresh candidate too. Bind a missing citation
        // only to its own already proved source, then run the complete review.
        // Formatting is never a positive verdict or permission to change a fact.
        const bound = !checked.issues.length && citationRepairs < 3 ? format?.(candidate, checked) : null;
        if (bound && bound !== candidate) {
          citationRepairs++;
          const boundCheck = await review(bound); attempts.push(boundCheck);
          signal?.throwIfAborted();
          if (boundCheck.accepted) return { answer: bound, status: 'verified' as const, attempts, contentRevisions, citationRepairs, rewriteAttempts, verifiedCoreReconstruction: true };
          candidate = bound; checked = boundCheck;
        }
        // One narrow final correction can repair a source locator or an accidental
        // nonliteral quotation. Dependent synthesis is checked again too; no
        // unsupported fact, semantic objection or technical outage qualifies.
        const rejected = checked.claims.filter(claim => claim.status !== 'supported');
        const quoteFailure = rejected.some(claim => /^The direct quotation does not match/u.test(claim.reason ?? ''));
        if (!checked.issues.length && quoteFailure && rejected.every(claim =>
          /^The direct quotation does not match|^inference_without_supported_premises/u.test(claim.reason ?? ''))) {
          const repaired = await revise(candidate, { ...checked, issues: ['literal_source_repair: resolve the exact quotation/source-locator diagnostic with an attributed paraphrase or the actual cited source; preserve every requested facet'] }, ++rewriteAttempts);
          if (repaired.trim() !== candidate.trim()) {
            contentRevisions++;
            const finalCheck = await review(repaired); attempts.push(finalCheck);
            signal?.throwIfAborted();
            if (finalCheck.accepted) return { answer: repaired, status: 'verified' as const, attempts, contentRevisions, citationRepairs, rewriteAttempts, verifiedCoreReconstruction: true };
          }
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof Error && /research_run_(?:not_authorized|context_changed|closed)|scope.*changed|permission/iu.test(error.message)) throw error;
    }
  }
  return { answer: researchAnswerReviewLimitation(language), status: 'limited' as const, attempts, contentRevisions, citationRepairs, rewriteAttempts };
}


/** Real excerpt matches offered to a rewriter after a locator/quotation failure.
 * These are candidates, never a verdict or an automatic source replacement. */
export function researchLiteralRepairCandidates(text: string, sources: readonly ResearchAuditSource[]) {
  const normalize = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  return researchAnswerProofUnits(text).flatMap(unit => {
    const cited = sources.filter(source => source.citation && unit.text.includes(`](${source.citation})`));
    return researchQuotedSpans(unit.text).spans.filter(span => span.text.length >= 12
      && !cited.some(source => normalize(source.text).includes(normalize(span.text))))
      .flatMap(span => {
        const matches = sources.filter(source => source.citation && source.proseSupport !== false && normalize(source.text).includes(normalize(span.text)));
        return matches.length ? [{ sentence: unit.text, quote: span.text, candidates: matches.map(source => ({ id: source.id, label: source.citationLabel ?? source.label,
          citation: `[${source.citationLabel ?? source.label}](${source.citation})`, attributionOnly: Boolean(source.attributionOnly) })) }] : [];
      });
  }).slice(0, 12);
}
