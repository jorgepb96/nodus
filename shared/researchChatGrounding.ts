import { dropResearchSentences, researchPlainSentence, type ResearchAuditSource, type ResearchProseAudit } from './researchClaimAudit';

/** Applies to the writer, independently of the embedding provider or profile. */
export const RESEARCH_CHAT_PRECISION_RULES = [
  'Answer the actual question first. Match the length to its complexity: for a simple factual question use one short paragraph, normally under 120 words; for a comparison or explanation normally stay under 400 words unless the user requests depth. Do not add a catalogue of sources, language inventories or unrelated background. Mention an extraction limitation once and only when it materially affects the requested conclusion; avoid repeating citations in a final caveat paragraph.',
  'When the question names several roles, stages, organisms or criteria, address each requested element explicitly. Condensing must not silently drop one of those facets; if the evidence cannot establish one, identify that precise limit.',
  'For documentary claims, every factual clause and table cell must be supported by the supplied excerpts. A working citation is not proof that its source entails the attached claim. Preserve exact source titles, attribution, dates, values, units, negations and corrections.',
  'Preserve the subject, action and object of each statement, including ellipsis and temporal contrasts. Do not turn a contrast between what opened in a given year into a claim that one building opened another. Keep the premises of an interpretation identifiable and cite their actual sources.',
  'Preserve technical terminology and operations faithfully across languages. Prefer the original source term to an approximate translated synonym; add a translation only when it preserves the exact operation or property. A correct original term in parentheses does not excuse a wrong translated term. Do not introduce a translation/version relationship between records unless their provenance explicitly establishes it.',
  'When an excerpt is visibly fragmentary or a table/column extraction breaks its sentences, do not fill missing qualifiers or relationships from memory. Prefer a coherent authorized passage; otherwise state the precise evidence limit.',
  'Reason across sources: useful comparisons, interpretations and hypotheses may follow from cited evidence even when no source states the combined conclusion verbatim. Distinguish your synthesis naturally from a source\'s explicit claim, using qualifications proportionate to the evidence; no ritual label or separate inference paragraph is required. Cite the premises accurately. Write arithmetic as an explicit equation and check the result. Do not turn an interpretation into a demonstrated fact, cause, mechanism, distribution, policy or procedure.',
  'When asked to compare interpretation limits, contrast the directly stated measurements and qualifications as your own reasoning with those supported premises. A source need not use the word limit or state the joint comparison verbatim. Do not refuse supported reasoning merely because that joint sentence is absent. This does not authorize inventing measurements, causes, a distribution shape or absence from complete sources.',
  'Mark a table row containing a derived value as a calculation or inference in that row itself; a separate paragraph does not qualify the row. Prefer literal values in the table and an explicitly labelled calculation below it.',
  'Keep distinct quantities and policies distinct unless the evidence explicitly connects them. A stated confidence level does not establish that an interval was calculated. Summary statistics alone do not establish a distribution or explain their difference.',
  'An omitted detail means only that the supplied excerpts do not establish it; it does not prove absence from a document or corpus. Do not infer independent corroboration or a shared study design from repeated or translated wording.',
  'Keep absence claims within the exact lookup predicates: no matches for author AND title AND year does not prove no records for that author OR year separately. A truncated example inventory cannot establish the years of every record. Never turn a passage silence into "the author does not address this" without limiting the claim to that passage.',
  'Use only comparisons that bear on the requested question. Do not add a literary-genre foil to an answer about social gender. Political approval or moral evaluation is not evidence of experiential inauthenticity. A fragment without its grammatical subject cannot establish who makes its claim; prefer another coherent excerpt instead of assigning the claim to the catalogue author.',
  'For a catalogue identity question, answer only the requested metadata fields and name document kinds in the answer language rather than dumping internal enum values. A cover page may establish additional facts but is not a catalogue record; do not call its university, supervisors or month catalogue fields. Metadata catalogue lookups do not depend on passage indexing: do not add unrelated semantic-index or extraction caveats to a catalogue result. Respect exclusions such as no alternative bibliography, even when other real publications were found.',
  'Link positive catalogue examples with their supplied Nodus work citations so the user can open the records. Counts and zero-result lookups are operational facts and never require a fictitious documentary citation. Do not call a passage an abstract, introduction or conclusion unless the source establishes that section: a page range can span an abstract and the body. Use passage or text when its section is unknown.',
  'Do not invent disagreement or consensus from differences of emphasis. Compatible propositions are not a contradiction. Catalogue credits for an edited volume identify its editors, not the author of every chapter; when the excerpt speaker is unknown, attribute the statement to the passage or volume, not to its editors. State a count of consulted works only when requested and established by the backend records. When using a secondary source, identify that mediation explicitly.',
  'A bibliographic reference proves only that the cited work is referenced; it does not prove conceptual continuity, influence, agreement, contradiction or an evolution of theory. Do not attribute those relationships to an author without an explicit supporting passage.',
  'Before finishing, check every assertion, attribution and count against the exact cited excerpt. Remove unsupported additions. If the available evidence cannot answer the question, say briefly that you cannot establish the requested fact, rather than claiming that the documents contain no such information. Do not pad that limitation with unrelated facts, search narration or inventories of sources.',
  'Use an evidence-gap acknowledgement only for an unanswered facet actually requested by the user. Do not add inability statements about source relationships, classifications or distinctions that the question does not require. A directly stated negation can be described as explicit; its source need not itself use the word explicit.',
].join('\n');

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export interface ResearchCoveragePlannedFacet {
  id: string;
  questionQuote: string;
}

/** Bind only absent routing metadata to one uniquely exact planned question span.
 * Explicit IDs, complaint text, quote proof and omissions are never rewritten. */
export function bindResearchCoverageFacetIds(input: unknown,
  plannedFacets: readonly ResearchCoveragePlannedFacet[]): unknown {
  if (!object(input) || !Array.isArray(plannedFacets)) return input;
  const matches = (complaint: unknown) => typeof complaint === 'string'
    ? plannedFacets.filter(facet => facet.questionQuote === complaint) : [];
  const output: Record<string, unknown> = { ...input };
  for (const key of ['addressed', 'omissions'] as const) {
    const rows = input[key];
    if (!Array.isArray(rows)) continue;
    output[key] = rows.map(row => {
      if (!object(row) || Object.prototype.hasOwnProperty.call(row, 'facetId')) return row;
      const exact = matches(row.complaint);
      return exact.length === 1 ? { ...row, facetId: exact[0].id } : row;
    });
  }
  return output;
}

export interface ResearchAnswerQuoteProof {
  answerQuote?: string;
  answerQuotes?: string[];
}

/** Coverage can span several paragraphs. Every cited span must still be literal
 * in the audited final answer; joined ellipses, invented wording and a mixture of
 * the legacy single-span and multiple-span formats are never repaired implicitly. */
export function validResearchAnswerQuotes(answer: string, proof: ResearchAnswerQuoteProof, maxChars: number): boolean {
  if ((proof.answerQuote === undefined) === (proof.answerQuotes === undefined)) return false;
  const quotes = proof.answerQuotes ?? [proof.answerQuote];
  if (!Array.isArray(quotes) || quotes.length < 1 || quotes.length > 6) return false;
  const comparable = (text: string) => researchPlainSentence(text).replace(/\*\*|__/gu, '').normalize('NFC').replace(/\s+/gu, ' ').trim();
  const target = comparable(answer);
  const seen = new Set<string>();
  let total = 0;
  let hasSubstantiveSpan = false;
  for (const quote of quotes) {
    if (typeof quote !== 'string' || !quote.trim() || (total += quote.length) > maxChars) return false;
    const literal = comparable(quote);
    if (!literal || seen.has(literal) || !target.includes(literal)) return false;
    seen.add(literal);
    if (literal.length >= 8) {
      hasSubstantiveSpan = true;
      continue;
    }
    // Tiny answer adjuncts such as "No." can accompany a meaningful span,
    // but cannot establish coverage themselves. Keep them unique, lexical,
    // and bounded as whole words in the audited answer.
    if (!/\p{L}/u.test(literal)) return false;
    const word = (character: string | undefined) => Boolean(character && /[\p{L}\p{N}_]/u.test(character));
    let offset = 0, occurrences = 0;
    while ((offset = target.indexOf(literal, offset)) >= 0) {
      occurrences += 1;
      if ((word(target[offset - 1]) && word(literal[0]))
          || (word(target[offset + literal.length]) && word(literal.at(-1)))) return false;
      offset += literal.length;
    }
    if (occurrences !== 1) return false;
  }
  return hasSubstantiveSpan;
}

export function researchChatNeedsGrounding(sourceContext: string): boolean {
  let input: unknown;
  try { input = JSON.parse(sourceContext); } catch { return false; }
  if (object(input) && object(input.contexto_modular_seleccionado)) {
    const scope = input.contexto_modular_seleccionado.research_scope;
    if (object(scope) && scope.answer_mode === 'constructive') return false;
    if (object(scope) && scope.documentary_evidence_required === true) return true;
  }
  return researchChatAuditSources(sourceContext).length > 0;
}

/** Only literal evidence in this frozen turn is admitted. History, council opinions,
 * catalogue entries and generated orientation never become audit sources. */
export function researchChatAuditSources(sourceContext: string): ResearchAuditSource[] {
  let input: unknown;
  try { input = JSON.parse(sourceContext); } catch { return []; }
  if (!object(input) || !object(input.contexto_modular_seleccionado)) return [];
  const context = input.contexto_modular_seleccionado;
  const seen = new Set<string>();
  return ['pasajes_relevantes', 'pasajes_web'].flatMap(key => {
    const rows = context[key];
    if (!Array.isArray(rows)) return [];
    return rows.flatMap(row => {
      if (!object(row) || typeof row.id !== 'string' || typeof row.citation !== 'string') return [];
      const citation = `nodus://passage/${encodeURIComponent(row.id)}`;
      if (row.citation !== citation || seen.has(row.id)) return [];
      const text = typeof row.summary === 'string' ? row.summary : typeof row.text === 'string' ? row.text : '';
      if (!text.trim()) return [];
      const title = typeof row.label === 'string' ? row.label : typeof row.title === 'string' ? row.title
        : object(row.work) && typeof row.work.title === 'string' ? row.work.title : '';
      if (!title.trim()) return [];
      seen.add(row.id);
      const location = typeof row.pageLabel === 'string' ? row.pageLabel : typeof row.page === 'number' ? String(row.page) : '';
      const label = [title.trim(), location ? /^\d/u.test(location) ? `p. ${location}` : location : ''].filter(Boolean).join(', ');
      // These are supplied application metadata, separate from the verbatim excerpt.
      // They let the auditor check an attribution without inventing author/year/page data.
      const metadata = [`Source title: ${title.trim()}`, ...(location ? [`Source locator: ${location}`] : []),
        ...(Array.isArray(row.authors) && row.authors.every(author => typeof author === 'string') && row.authors.length ? [`Source authors: ${row.authors.join('; ')}`] : []),
        ...(typeof row.year === 'number' && Number.isInteger(row.year) ? [`Source year: ${row.year}`] : []),
        ...(typeof row.reason === 'string' && row.reason.trim() ? [`Evidence provenance: ${row.reason}`] : [])];
      return [{ id: row.id, label, citation, text: `${metadata.join('\n')}\nVerbatim excerpt:\n${text}` }];
    });
  });
}

/** The prose auditor appends verified links after a span. Put them inside the
 * last cell of a Markdown table row so verification cannot break its structure. */
export function researchChatAuditedMarkdown(markdown: string): string {
  const table = markdown.replace(/^(\s*\|[^\n]+)\|[ \t]+((?:\[[^\]\n]+\]\(nodus:\/\/[^)\n]+\)[ \t]*)+)$/gm,
    (_match, cells: string, citations: string) => `${cells.trimEnd()} ${citations.trim()} |`);
  // Removing a rejected section's body must not leave an empty heading that
  // promises an explanation the final answer no longer provides.
  const lines = table.split('\n');
  return lines.filter((line, index) => {
    if (!/^\s*#{1,6}\s/u.test(line)) return true;
    const next = lines.slice(index + 1).find(candidate => candidate.trim());
    return Boolean(next && !/^\s*#{1,6}\s/u.test(next));
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A semantic verdict cannot turn a paraphrase into a verbatim quotation. A
 * labelled translation may differ; an unlabelled direct quote must be literal. */
/** Balanced outer quotations preserve nested source quotations as literal content. */
export function researchQuotedSpans(text: string) {
  const spans: Array<{ start: number; end: number; text: string }> = [];
  const stack: string[] = [];
  let start = -1;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '\\') { index++; continue; }
    if (!stack.length && character === '"' && /\d/u.test(text[index - 1] ?? '')) continue;
    if (stack.length && character === stack.at(-1)) {
      stack.pop();
      if (!stack.length) spans.push({ start, end: index + 1, text: text.slice(start + 1, index) });
    } else if (character === '«' || character === '“' || character === '"') {
      if (!stack.length) start = index;
      stack.push(character === '«' ? '»' : character === '“' ? '”' : '"');
    }
  }
  return { spans, unclosed: stack.length > 0 };
}
export function researchChatLiteralQuotes(review: ResearchProseAudit, sources: ResearchAuditSource[]): ResearchProseAudit {
  const normalize = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const rejected = new Set<string>();
  const claims = review.claims.map(claim => {
    if (claim.status !== 'supported') return claim;
    const parsed = researchQuotedSpans(claim.sentence);
    const quotes = parsed.spans.filter(span => !/(?:traducci[oó]n|traduction|translation|translated|traduit|übersetz(?:ung|t)|tradução|traduzido|翻译|翻譯|訳|번역|переклад|перевод|dịch)(?:\s+[\p{L}-]+){0,4}\s*[:：]\s*$/iu.test(claim.sentence.slice(Math.max(0, span.start - 80), span.start)))
      .map(span => normalize(span.text)).filter(quote => quote.length >= 12);
    const missing = quotes.filter(quote => !sources.some(source => claim.evidence.some(evidence => evidence.id === source.id) && normalize(source.text).includes(quote)));
    if (!missing.length && !parsed.unclosed) return claim;
    rejected.add(researchPlainSentence(claim.sentence));
    return { ...claim, status: 'removed' as const, failure: 'premise_without_literal_evidence' as const,
      reason: `The direct quotation does not match the authorized literal source; use an attributed paraphrase or copy the exact excerpt without changing OCR, accents or punctuation. Nonliteral quotes: ${JSON.stringify(missing).slice(0, 1400)}${parsed.unclosed ? '; unclosed quotation delimiter' : ''}` };
  });
  return rejected.size ? { claims, markdown: dropResearchSentences(review.markdown, sentence => rejected.has(sentence)).markdown } : review;
}

/** Check simple arithmetic independently of a semantic judge. This deliberately
 * covers explicit binary equations and a single-result table row, not arbitrary
 * mathematical prose, locale-dependent thousands separators or symbolic algebra. */
export function researchChatCalculations(review: ResearchProseAudit): ResearchProseAudit {
  const number = '[+−-]?\\d+(?:[.,]\\d+)?';
  const binary = new RegExp(`(${number})\\s*%?\\s*([+−–×÷*/\\-])\\s*(${number})\\s*%?`, 'gu');
  const rejected = new Set<string>();
  const claims = review.claims.map(claim => {
    if (claim.status !== 'supported' || claim.kind === 'attributed' || claim.kind === 'nonfactual') return claim;
    // A quotation reports its source's words; it is not the writer's calculation.
    const plain = researchPlainSentence(claim.sentence).replace(/«[^»]*»|“[^”]*”|"[^"]*"/gu, '').replace(/\*\*|__/gu, '');
    for (const expression of plain.matchAll(binary)) {
      if (expression.index! > 0 && /[\p{L}\p{N}.,^_]/u.test(plain[expression.index! - 1])) continue;
      // A separator followed by three digits can mean decimal precision or
      // thousands grouping. Do not choose a locale and reject a valid equation.
      const ambiguous = (value: string) => /^[+−-]?\d{1,3}[.,]\d{3}$/u.test(value);
      if (ambiguous(expression[1]) || ambiguous(expression[3])) continue;
      const numeric = (value: string) => Number(value.replace(',', '.').replace('−', '-'));
      const a = numeric(expression[1]), b = numeric(expression[3]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.max(Math.abs(a), Math.abs(b)) > Number.MAX_SAFE_INTEGER) continue;
      const operator = expression[2];
      if (!'+−–-'.includes(operator) && expression[0].includes('%')) continue;
      const expected = operator === '+' ? a + b : '−–-'.includes(operator) ? a - b : '×*'.includes(operator) ? a * b : a / b;
      const rest = plain.slice(expression.index! + expression[0].length);
      const equation = new RegExp(`^\\s*=\\s*(${number})`).exec(rest);
      // Do not check a prefix of a grouped number, exponent or symbolic result.
      if (equation && /^(?:[.,]\d|[\p{L}\p{N}^_])/u.test(rest.slice(equation[0].length))) continue;
      let stated = equation?.[1];
      if (!stated && claim.kind === 'inference' && /^\s*\|/u.test(plain)) {
        const otherCells = plain.split('|').filter(cell => cell.trim() && !cell.includes(expression[0]));
        const values = otherCells.flatMap(cell => [...cell.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${number}(?![\\p{L}\\p{N}])`, 'gu'))].map(match => match[0]));
        if (values.length === 1) stated = values[0];
      }
      if (stated === undefined) continue;
      const actual = numeric(stated);
      if (ambiguous(stated) || !Number.isFinite(actual) || Math.abs(actual) > Number.MAX_SAFE_INTEGER) continue;
      // Equality permits decimal rounding to the displayed precision; integer
      // equations are exact. An approximate result should use ≈ instead of =.
      const decimals = stated.split(/[.,]/u)[1]?.length;
      const tolerance = decimals ? 0.5 * 10 ** -decimals + 1e-10 : 1e-10;
      if (Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance) continue;
      rejected.add(researchPlainSentence(claim.sentence));
      return { ...claim, status: 'removed' as const, failure: 'premise_not_entailed' as const,
        reason: `Arithmetic verification failed: ${expression[1]} ${operator} ${expression[3]} gives ${expected}, not ${stated}. Correct the calculation using the same supported operands.` };
    }
    return claim;
  });
  return rejected.size ? { claims, markdown: dropResearchSentences(review.markdown, sentence => rejected.has(sentence)).markdown } : review;
}
