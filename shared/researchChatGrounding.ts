import { dropResearchSentences, researchPlainSentence, type ResearchAuditSource, type ResearchProseAudit } from './researchClaimAudit';

/** Applies to the writer, independently of the embedding provider or profile. */
export const RESEARCH_CHAT_PRECISION_RULES = [
  'Answer the actual question first. Match the length to its complexity: for a simple factual question use one short paragraph, normally under 120 words; for a comparison or explanation normally stay under 400 words unless the user requests depth. Do not add a catalogue of sources, language inventories or unrelated background.',
  'For documentary claims, every factual clause and table cell must be supported by the supplied excerpts. A working citation is not proof that its source entails the attached claim. Preserve exact source titles, attribution, dates, values, units, negations and corrections.',
  'When an excerpt is visibly fragmentary or a table/column extraction breaks its sentences, do not fill missing qualifiers or relationships from memory. Prefer a coherent authorized passage; otherwise state the precise evidence limit.',
  'Separate what a source states from your calculations, general explanations and hypotheses. Label a calculation or inference explicitly and give its supported premises. Write arithmetic as an explicit equation and check the result. Do not turn a plausible interpretation into a documented cause, mechanism, distribution, policy or procedure.',
  'Mark a table row containing a derived value as a calculation or inference in that row itself; a separate paragraph does not qualify the row. Prefer literal values in the table and an explicitly labelled calculation below it.',
  'Keep distinct quantities and policies distinct unless the evidence explicitly connects them. A stated confidence level does not establish that an interval was calculated. Summary statistics alone do not establish a distribution or explain their difference.',
  'An omitted detail means only that the supplied excerpts do not establish it; it does not prove absence from a document or corpus. Do not infer independent corroboration or a shared study design from repeated or translated wording.',
  'Before finishing, check every assertion, attribution and count against the exact cited excerpt. Remove unsupported additions. If the available evidence cannot answer the question, say briefly that you cannot establish the requested fact, rather than claiming that the documents contain no such information. Do not pad that limitation with unrelated facts, search narration or inventories of sources.',
].join('\n');

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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
export function researchChatLiteralQuotes(review: ResearchProseAudit, sources: ResearchAuditSource[]): ResearchProseAudit {
  const normalize = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const rejected = new Set<string>();
  const claims = review.claims.map(claim => {
    if (claim.status !== 'supported' || /traduc|translation|translated|traduit|übersetz|traduç|traduz|翻译|翻譯|訳|번역|переклад|перевод|dịch/iu.test(claim.sentence)) return claim;
    const quotes = [...claim.sentence.matchAll(/«([^»\n]+)»|“([^”\n]+)”|"([^"\n]+)"/gu)]
      .map(match => normalize(match[1] ?? match[2] ?? match[3])).filter(quote => quote.length >= 12);
    if (quotes.every(quote => sources.some(source => claim.evidence.some(evidence => evidence.id === source.id) && normalize(source.text).includes(quote)))) return claim;
    rejected.add(researchPlainSentence(claim.sentence));
    return { ...claim, status: 'removed' as const, failure: 'premise_without_literal_evidence' as const,
      reason: 'The direct quotation does not match the authorized literal source; label a translation or use an attributed paraphrase.' };
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
      if (expression.index! > 0 && /[\p{L}\p{N}.,]/u.test(plain[expression.index! - 1])) continue;
      const numeric = (value: string) => Number(value.replace(',', '.').replace('−', '-'));
      const a = numeric(expression[1]), b = numeric(expression[3]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.max(a, b) > Number.MAX_SAFE_INTEGER) continue;
      const operator = expression[2];
      if (!'+−–-'.includes(operator) && expression[0].includes('%')) continue;
      const expected = operator === '+' ? a + b : '−–-'.includes(operator) ? a - b : '×*'.includes(operator) ? a * b : a / b;
      const rest = plain.slice(expression.index! + expression[0].length);
      const equation = new RegExp(`^\\s*=\\s*(${number})`).exec(rest);
      let stated = equation?.[1];
      if (!stated && claim.kind === 'inference' && /^\s*\|/u.test(plain)) {
        const otherCells = plain.split('|').filter(cell => cell.trim() && !cell.includes(expression[0]));
        const values = otherCells.flatMap(cell => [...cell.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${number}(?![\\p{L}\\p{N}])`, 'gu'))].map(match => match[0]));
        if (values.length === 1) stated = values[0];
      }
      if (stated === undefined) continue;
      const actual = numeric(stated);
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
