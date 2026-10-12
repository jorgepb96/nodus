import { renderResearchAnswerTable, type ResearchAnswerTable } from './researchAnswerStructure';

export interface ResearchPlanSource {
  id: string;
  text: string;
}

export interface ResearchAnswerPlanEvidence {
  sourceId: string;
  quote: string;
}

export interface ResearchAnswerPlanFacetInput {
  questionQuote: string;
  evidence: ResearchAnswerPlanEvidence[];
}

export interface ResearchAnswerPlanInput {
  facets: ResearchAnswerPlanFacetInput[];
  format: 'prose' | 'table';
  formatQuestionQuote?: string;
}

export interface ValidatedResearchAnswerPlanFacet extends ResearchAnswerPlanFacetInput {
  id: string;
  /** Whether excerpt premises were selected; this is not an availability or support verdict. */
  excerptPremises: 'selected' | 'none';
}

export interface ValidatedResearchAnswerPlan {
  facets: ValidatedResearchAnswerPlanFacet[];
  format: 'prose' | 'table';
  formatQuestionQuote?: string;
}

export interface ResearchAnswerPlanIssue {
  path: string;
  code: string;
  message: string;
}

export interface ResearchAnswerPlanValidation {
  plan: ValidatedResearchAnswerPlan | null;
  issues: ResearchAnswerPlanIssue[];
}

export interface ResearchAnswerText {
  facetId: string;
  text: string;
}

export interface ResearchStructuredAnswerTable extends ResearchAnswerTable {
  facetIds: string[];
}

export interface ResearchAnswerOutputInput {
  answers: ResearchAnswerText[];
  tables?: ResearchStructuredAnswerTable[];
}

export interface ValidatedResearchAnswerOutput {
  answers: ResearchAnswerText[];
  tables?: Array<ResearchStructuredAnswerTable & { markdown: string }>;
}

export interface ResearchAnswerOutputValidation {
  output: ValidatedResearchAnswerOutput | null;
  issues: ResearchAnswerPlanIssue[];
}

const MAX_FACETS = 6;
const MAX_EVIDENCE_PER_FACET = 6;
const MAX_QUESTION_QUOTE = 500;
const MAX_SOURCE_QUOTE = 1000;
const MAX_ANSWER_TEXT = 3000;
const MAX_ANSWERS_TOTAL = 12000;
const MAX_TABLES = 6;
const MAX_FACET_ID = /^f[1-6]$/u;

const plainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const normalized = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
const duplicateKey = (value: string) => normalized(value).toLocaleLowerCase('und');
const issue = (path: string, code: string, message: string): ResearchAnswerPlanIssue => ({ path, code, message });

/** The audit-source wrapper separates metadata from its verbatim excerpt. */
function literalExcerpt(text: string): string | null {
  const marker = 'Verbatim excerpt:\n';
  // Metadata is interpolated before the real boundary and can itself contain
  // marker-like text. The final marker is the boundary emitted by the app.
  const markerIndex = text.lastIndexOf(marker);
  return markerIndex < 0 ? null : text.slice(markerIndex + marker.length);
}

function literalSpan(container: string, quote: string): boolean {
  const needle = normalized(quote);
  return needle.length >= 8 && normalized(container).includes(needle);
}

/** Validates a source-grounded plan, then assigns stable IDs in input order. */
export function validateResearchAnswerPlan(input: unknown, question: string, sources: readonly ResearchPlanSource[]): ResearchAnswerPlanValidation {
  const issues: ResearchAnswerPlanIssue[] = [];
  if (typeof question !== 'string' || !question.trim()) return { plan: null, issues: [issue('question', 'question', 'A nonempty user question is required.')] };
  if (!plainObject(input) || Object.keys(input).some(key => !['facets', 'format', 'formatQuestionQuote'].includes(key))) {
    return { plan: null, issues: [issue('plan', 'shape', 'Plan must be a plain object with only the declared fields.')] };
  }
  if (input.format !== 'prose' && input.format !== 'table') issues.push(issue('format', 'format', 'Format must be prose or table.'));
  if (!Array.isArray(input.facets) || input.facets.length < 1 || input.facets.length > MAX_FACETS) {
    issues.push(issue('facets', 'facet_count', `Expected 1–${MAX_FACETS} facets.`));
  }
  if (input.format === 'table') {
    if (typeof input.formatQuestionQuote !== 'string' || input.formatQuestionQuote.trim().length < 2
      || input.formatQuestionQuote.length > MAX_QUESTION_QUOTE || !normalized(question).includes(normalized(input.formatQuestionQuote))) {
      issues.push(issue('formatQuestionQuote', 'format_not_requested', 'Table format requires a literal bounded span of the user question requesting a table.'));
    }
  } else if (input.formatQuestionQuote !== undefined) {
    issues.push(issue('formatQuestionQuote', 'unexpected_format_quote', 'A format quote is only valid when table format was requested.'));
  }

  if (!Array.isArray(sources)) return { plan: null, issues: [issue('sources', 'authorized_sources', 'Authorized sources must be supplied as a list.')] };
  const sourceMap = new Map<string, ResearchPlanSource>();
  for (const source of sources) {
    if (!plainObject(source) || typeof source.id !== 'string' || !source.id || typeof source.text !== 'string' || sourceMap.has(source.id)) continue;
    sourceMap.set(source.id, { id: source.id, text: source.text });
  }

  const validatedFacets: ValidatedResearchAnswerPlanFacet[] = [];
  const seenQuestions = new Set<string>();
  if (Array.isArray(input.facets)) {
    for (let index = 0; index < input.facets.length; index++) {
      const facet = input.facets[index];
      const path = `facets[${index}]`;
      if (!plainObject(facet) || Object.keys(facet).some(key => key !== 'questionQuote' && key !== 'evidence')) {
        issues.push(issue(path, 'facet_shape', 'Facet must contain only questionQuote and evidence.'));
        continue;
      }
      if (typeof facet.questionQuote !== 'string' || facet.questionQuote.trim().length < 2 || facet.questionQuote.length > MAX_QUESTION_QUOTE
        || !normalized(question).includes(normalized(facet.questionQuote))) {
        issues.push(issue(`${path}.questionQuote`, 'question_quote', 'Facet must quote a bounded literal span of the user question.'));
      } else {
        const key = duplicateKey(facet.questionQuote);
        if (seenQuestions.has(key)) issues.push(issue(`${path}.questionQuote`, 'duplicate_facet', 'Facet question quotes must be distinct.'));
        seenQuestions.add(key);
      }
      if (!Array.isArray(facet.evidence) || facet.evidence.length > MAX_EVIDENCE_PER_FACET) {
        issues.push(issue(`${path}.evidence`, 'evidence_shape', `Evidence must be an array with at most ${MAX_EVIDENCE_PER_FACET} entries.`));
        continue;
      }
      const evidence: ResearchAnswerPlanEvidence[] = [];
      const seenEvidence = new Set<string>();
      for (let evidenceIndex = 0; evidenceIndex < facet.evidence.length; evidenceIndex++) {
        const row = facet.evidence[evidenceIndex];
        const evidencePath = `${path}.evidence[${evidenceIndex}]`;
        if (!plainObject(row) || Object.keys(row).some(key => key !== 'sourceId' && key !== 'quote')) {
          issues.push(issue(evidencePath, 'evidence_shape', 'Evidence must contain only sourceId and quote.'));
          continue;
        }
        if (typeof row.sourceId !== 'string' || row.sourceId.length < 1 || row.sourceId.length > 512 || typeof row.quote !== 'string'
          || row.quote.trim().length < 8 || row.quote.length > MAX_SOURCE_QUOTE) {
          issues.push(issue(evidencePath, 'evidence_value', 'Evidence requires a source ID and a literal quote of 8–1000 characters.'));
          continue;
        }
        const source = sourceMap.get(row.sourceId);
        if (!source) {
          issues.push(issue(`${evidencePath}.sourceId`, 'unauthorized_source', 'Evidence source ID is not in the authorized source set.'));
          continue;
        }
        const excerpt = literalExcerpt(source.text);
        if (excerpt === null || !literalSpan(excerpt, row.quote)) {
          issues.push(issue(`${evidencePath}.quote`, 'quote_not_in_excerpt', 'Evidence quote must occur literally in the source verbatim excerpt, not its metadata.'));
          continue;
        }
        const key = `${row.sourceId}\u0000${normalized(row.quote)}`;
        if (seenEvidence.has(key)) {
          issues.push(issue(evidencePath, 'duplicate_evidence', 'Duplicate evidence rows are not allowed within a facet.'));
          continue;
        }
        seenEvidence.add(key);
        evidence.push({ sourceId: row.sourceId, quote: row.quote });
      }
      if (typeof facet.questionQuote === 'string' && facet.questionQuote.trim().length >= 2 && facet.questionQuote.length <= MAX_QUESTION_QUOTE
        && normalized(question).includes(normalized(facet.questionQuote)) && Array.isArray(facet.evidence)) {
        validatedFacets.push({ id: `f${index + 1}`, questionQuote: facet.questionQuote, evidence,
          excerptPremises: evidence.length ? 'selected' : 'none' });
      }
    }
  }
  if (issues.length) return { plan: null, issues };
  const plan: ValidatedResearchAnswerPlan = {
    facets: validatedFacets,
    format: input.format as 'prose' | 'table',
    ...(input.format === 'table' ? { formatQuestionQuote: input.formatQuestionQuote as string } : {}),
  };
  return { plan, issues: [] };
}

function containsMarkdownTable(text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/u);
  const hasPipeRow = (line: string) => /(?<!\\)\|/u.test(line);
  const separator = (line: string) => {
    if (!hasPipeRow(line)) return false;
    const cells = line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split(/(?<!\\)\|/u);
    return cells.length > 1 && cells.every(cell => /^\s*:?-{3,}:?\s*$/u.test(cell));
  };
  return lines.some((line, index) => hasPipeRow(line) && separator(lines[index + 1] ?? ''));
}

/** Validates one writer result against validated facet IDs and renders only valid structured tables. */
export function validateResearchAnswerOutput(input: unknown, plan: ValidatedResearchAnswerPlan): ResearchAnswerOutputValidation {
  const issues: ResearchAnswerPlanIssue[] = [];
  if (!plainObject(input) || Object.keys(input).some(key => key !== 'answers' && key !== 'tables')) {
    return { output: null, issues: [issue('output', 'shape', 'Writer output must be a plain object with only answers and tables.')] };
  }
  const planIds = new Set(plan.facets.map(facet => facet.id));
  const answers = input.answers;
  if (!Array.isArray(answers) || answers.length !== plan.facets.length) {
    issues.push(issue('answers', 'answer_count', 'Writer must return exactly one answer for every planned facet.'));
  }
  const seenIds = new Set<string>();
  let answerChars = 0;
  const validatedAnswers: ResearchAnswerText[] = [];
  if (Array.isArray(answers)) {
    for (let index = 0; index < answers.length; index++) {
      const row = answers[index];
      const path = `answers[${index}]`;
      if (!plainObject(row) || Object.keys(row).some(key => key !== 'facetId' && key !== 'text')) {
        issues.push(issue(path, 'answer_shape', 'Answer must contain only facetId and text.'));
        continue;
      }
      if (typeof row.facetId !== 'string' || !MAX_FACET_ID.test(row.facetId) || !planIds.has(row.facetId)) {
        issues.push(issue(`${path}.facetId`, 'unknown_facet', 'Answer facetId must be assigned by the validated plan.'));
        continue;
      }
      if (seenIds.has(row.facetId)) issues.push(issue(`${path}.facetId`, 'duplicate_facet_id', 'Each planned facet ID must appear exactly once.'));
      seenIds.add(row.facetId);
      if (typeof row.text !== 'string' || !row.text.trim() || row.text.length > MAX_ANSWER_TEXT) {
        issues.push(issue(`${path}.text`, 'answer_text', `Answer text must be nonempty and at most ${MAX_ANSWER_TEXT} characters.`));
        continue;
      }
      answerChars += row.text.length;
      if (containsMarkdownTable(row.text)) issues.push(issue(`${path}.text`, 'ad_hoc_table', 'Tables must use the structured tables field.'));
      validatedAnswers.push({ facetId: row.facetId, text: row.text });
    }
  }
  for (const facet of plan.facets) if (!seenIds.has(facet.id)) issues.push(issue('answers', 'missing_facet_id', `Missing answer for ${facet.id}.`));
  if (answerChars > MAX_ANSWERS_TOTAL) issues.push(issue('answers', 'answer_total_size', `Answer text exceeds ${MAX_ANSWERS_TOTAL} total characters.`));

  const tables = input.tables;
  if (plan.format === 'prose' && tables !== undefined) issues.push(issue('tables', 'unexpected_tables', 'Structured tables are only allowed when the user requested table format.'));
  if (plan.format === 'table' && (!Array.isArray(tables) || tables.length < 1 || tables.length > MAX_TABLES)) {
    issues.push(issue('tables', 'table_count', `Table format requires 1–${MAX_TABLES} structured tables.`));
  }
  const renderedTables: Array<ResearchStructuredAnswerTable & { markdown: string }> = [];
  const tableFacetIds = new Set<string>();
  if (Array.isArray(tables)) {
    for (let index = 0; index < tables.length; index++) {
      const table = tables[index];
      const path = `tables[${index}]`;
      if (!plainObject(table) || Object.keys(table).some(key => !['facetIds', 'headers', 'rows'].includes(key))) {
        issues.push(issue(path, 'table_shape', 'Table must contain only facetIds, headers and rows.'));
        continue;
      }
      if (!Array.isArray(table.facetIds) || table.facetIds.length < 1 || table.facetIds.length > MAX_FACETS) {
        issues.push(issue(`${path}.facetIds`, 'table_facets', `Table must reference 1–${MAX_FACETS} planned facets.`));
      } else {
        const local = new Set<string>();
        for (const id of table.facetIds) {
          if (typeof id !== 'string' || !planIds.has(id)) issues.push(issue(`${path}.facetIds`, 'unknown_facet', 'Table facet IDs must come from the validated plan.'));
          else if (local.has(id) || tableFacetIds.has(id)) issues.push(issue(`${path}.facetIds`, 'duplicate_table_facet', `Facet ${id} may appear in only one table row group.`));
          else { local.add(id); tableFacetIds.add(id); }
        }
      }
      const rendered = renderResearchAnswerTable({ headers: table.headers, rows: table.rows });
      for (const tableIssue of rendered.issues) issues.push(issue(path, `table_${tableIssue.code}`, tableIssue.message));
      if (rendered.markdown !== null && Array.isArray(table.facetIds) && table.facetIds.every(id => typeof id === 'string' && planIds.has(id))) {
        renderedTables.push({ facetIds: table.facetIds as string[], headers: table.headers as string[], rows: table.rows as string[][], markdown: rendered.markdown });
      }
    }
  }
  if (issues.length) return { output: null, issues };
  return { output: { answers: validatedAnswers, ...(renderedTables.length ? { tables: renderedTables } : {}) }, issues: [] };
}

/** Produces user-facing Markdown from an already validated writer result; facet IDs stay internal. */
export function renderValidatedResearchAnswerOutput(output: ValidatedResearchAnswerOutput): string {
  const answers = [...output.answers].sort((left, right) => Number(left.facetId.slice(1)) - Number(right.facetId.slice(1)));
  const sections = answers.map(answer => answer.text.trim());
  for (const table of output.tables ?? []) sections.push(table.markdown);
  return sections.filter(Boolean).join('\n\n');
}
