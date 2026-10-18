import { researchPlainSentence } from './researchClaimAudit';

export interface ResearchAnswerTable {
  headers: string[];
  rows: string[][];
}

export type ResearchAnswerTableIssueCode = 'shape' | 'headers' | 'header_width' | 'header_empty' | 'header_not_meaningful'
  | 'rows' | 'row_width' | 'cell_type' | 'cell_too_long' | 'table_too_large' | 'unsafe_control' | 'unsafe_link';

export interface ResearchAnswerTableIssue {
  code: ResearchAnswerTableIssueCode;
  row?: number;
  column?: number;
  message: string;
}

export interface ResearchMarkdownTableIssue {
  code: 'separator_column_count' | 'malformed_separator' | 'row_column_count';
  line: number;
  expected: number;
  actual: number;
}

export const RESEARCH_ANSWER_TABLE_LIMITS = Object.freeze({
  columns: 12,
  rows: 40,
  headerChars: 120,
  cellChars: 1600,
  totalChars: 14000,
});

const plainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function meaningfulHeader(header: string): boolean {
  const plain = researchPlainSentence(header).replace(/[*_`~]/gu, '').trim();
  return /[\p{L}\p{N}]/u.test(plain);
}

function hasUnsafeControl(text: string): boolean {
  // Explicit control-byte rejection is intentional at the model-output boundary.
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text);
}

/** Strictly validates the writer's structured table payload without repairing it. */
export function validateResearchAnswerTable(input: unknown): ResearchAnswerTableIssue[] {
  const issues: ResearchAnswerTableIssue[] = [];
  if (!plainObject(input) || Object.keys(input).some(key => key !== 'headers' && key !== 'rows')) {
    return [{ code: 'shape', message: 'Expected only headers and rows on a plain table object.' }];
  }
  const headers = input.headers;
  const rows = input.rows;
  if (!Array.isArray(headers) || headers.length < 1 || headers.length > RESEARCH_ANSWER_TABLE_LIMITS.columns) {
    issues.push({ code: 'header_width', message: `Expected 1–${RESEARCH_ANSWER_TABLE_LIMITS.columns} headers.` });
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > RESEARCH_ANSWER_TABLE_LIMITS.rows) {
    issues.push({ code: 'rows', message: `Expected 1–${RESEARCH_ANSWER_TABLE_LIMITS.rows} data rows.` });
  }
  if (!Array.isArray(headers) || !Array.isArray(rows)) return issues;

  let totalChars = 0;
  for (let column = 0; column < headers.length; column++) {
    const header = headers[column];
    if (typeof header !== 'string') {
      issues.push({ code: 'cell_type', row: -1, column, message: 'Header must be a string.' });
      continue;
    }
    totalChars += header.length;
    if (header.length > RESEARCH_ANSWER_TABLE_LIMITS.headerChars) issues.push({ code: 'header_width', row: -1, column, message: 'Header exceeds the character limit.' });
    if (!header.trim()) issues.push({ code: 'header_empty', row: -1, column, message: 'Header cannot be empty.' });
    else if (!meaningfulHeader(header)) issues.push({ code: 'header_not_meaningful', row: -1, column, message: 'Header must contain a word or number.' });
    if (hasUnsafeControl(header)) issues.push({ code: 'unsafe_control', row: -1, column, message: 'Header contains a control character.' });
  }

  for (let row = 0; row < rows.length; row++) {
    const values = rows[row];
    if (!Array.isArray(values)) {
      issues.push({ code: 'row_width', row, message: 'Each row must be an array of strings.' });
      continue;
    }
    if (values.length !== headers.length) issues.push({ code: 'row_width', row, message: `Expected ${headers.length} cells, found ${values.length}.` });
    for (let column = 0; column < values.length; column++) {
      const value = values[column];
      if (typeof value !== 'string') {
        issues.push({ code: 'cell_type', row, column, message: 'Cell must be a string.' });
        continue;
      }
      totalChars += value.length;
      if (value.length > RESEARCH_ANSWER_TABLE_LIMITS.cellChars) issues.push({ code: 'cell_too_long', row, column, message: 'Cell exceeds the character limit.' });
      if (hasUnsafeControl(value)) issues.push({ code: 'unsafe_control', row, column, message: 'Cell contains a control character.' });
      const links = [...value.matchAll(/\[[^\]\r\n]*\]\(([^)\r\n]*)\)/gu)];
      const nodusCount = value.match(/nodus:\/\//gu)?.length ?? 0;
      const linkedNodusCount = links.filter(match => match[1].startsWith('nodus://')).length;
      if (nodusCount !== linkedNodusCount || links.some(match => /[|\r\n]/u.test(match[1]))) {
        issues.push({ code: 'unsafe_link', row, column, message: 'A Nodus citation must be a complete Markdown link with a table-safe target.' });
      }
    }
  }
  if (totalChars > RESEARCH_ANSWER_TABLE_LIMITS.totalChars) {
    issues.push({ code: 'table_too_large', message: `Table exceeds ${RESEARCH_ANSWER_TABLE_LIMITS.totalChars} total characters.` });
  }
  return issues;
}

function escapeCellText(value: string): string {
  return value.replace(/\r\n|\r|\n/gu, '<br>').replace(/\\?\|/gu, '\\|');
}

function renderCell(value: string): string {
  // Keep each destination byte-for-byte; only escape visible link-label text.
  const linkPattern = /\[([^\]\r\n]*)\]\(([^)\r\n]*)\)/gu;
  let result = '';
  let offset = 0;
  for (const match of value.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    result += escapeCellText(value.slice(offset, index));
    result += `[${escapeCellText(match[1])}](${match[2]})`;
    offset = index + match[0].length;
  }
  return result + escapeCellText(value.slice(offset));
}

export interface RenderResearchAnswerTableResult {
  markdown: string | null;
  issues: ResearchAnswerTableIssue[];
}

/** Renders a validated table; invalid payloads return issues and no partial Markdown. */
export function renderResearchAnswerTable(input: unknown): RenderResearchAnswerTableResult {
  const issues = validateResearchAnswerTable(input);
  if (issues.length) return { markdown: null, issues };
  const table = input as ResearchAnswerTable;
  const line = (cells: string[]) => `| ${cells.map(renderCell).join(' | ')} |`;
  return {
    markdown: [line(table.headers), line(table.headers.map(() => '---')), ...table.rows.map(line)].join('\n'),
    issues: [],
  };
}

function splitMarkdownRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed || (!trimmed.startsWith('|') && !trimmed.endsWith('|'))) return null;
  const cells: string[] = [];
  let start = trimmed.startsWith('|') ? 1 : 0;
  let index = start;
  let escaped = false;
  let codeTicks = 0;
  let linkDestinationDepth = 0;
  while (index < trimmed.length) {
    const character = trimmed[index];
    if (escaped) { escaped = false; index++; continue; }
    if (character === '\\') { escaped = true; index++; continue; }
    if (character === '`') {
      let end = index + 1;
      while (trimmed[end] === '`') end++;
      const run = end - index;
      codeTicks = codeTicks === 0 ? run : codeTicks === run ? 0 : codeTicks;
      index = end;
      continue;
    }
    if (codeTicks === 0 && character === '(' && trimmed[index - 1] === ']') linkDestinationDepth++;
    else if (codeTicks === 0 && character === ')' && linkDestinationDepth > 0) linkDestinationDepth--;
    if (character === '|' && codeTicks === 0 && linkDestinationDepth === 0) {
      cells.push(trimmed.slice(start, index).trim());
      start = index + 1;
    }
    index++;
  }
  if (start < trimmed.length) cells.push(trimmed.slice(start).trim());
  return cells.length ? cells : null;
}

const separatorCell = (cell: string) => /^:?-{3,}:?$/u.test(cell.trim());

/** Requires a rendered header, separator and data row after factual filtering. */
export function hasResearchMarkdownTable(markdown: string): boolean {
  const lines = markdown.split(/\r\n|\r|\n/u);
  for (let index = 0; index + 2 < lines.length; index++) {
    const header = splitMarkdownRow(lines[index]);
    const separator = splitMarkdownRow(lines[index + 1]);
    const row = splitMarkdownRow(lines[index + 2]);
    if (header && separator && row && header.length === separator.length && header.length === row.length
      && separator.every(separatorCell)) return true;
  }
  return false;
}

/** Reports existing Markdown table width defects; it never adds or removes cells. */
export function validateResearchMarkdownTableAlignment(markdown: string): ResearchMarkdownTableIssue[] {
  if (typeof markdown !== 'string' || !markdown) return [];
  const lines = markdown.split(/\r\n|\r|\n/u);
  const issues: ResearchMarkdownTableIssue[] = [];
  for (let index = 0; index + 1 < lines.length; index++) {
    const header = splitMarkdownRow(lines[index]);
    const separator = splitMarkdownRow(lines[index + 1]);
    if (!header || !separator) continue;
    const separatorLike = separator.some(cell => /^:?-{1,}/u.test(cell.trim()));
    if (!separatorLike) continue;
    const validSeparator = separator.every(separatorCell);
    if (!validSeparator) issues.push({ code: 'malformed_separator', line: index + 2, expected: header.length, actual: separator.length });
    if (header.length !== separator.length) issues.push({ code: 'separator_column_count', line: index + 2, expected: header.length, actual: separator.length });
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex++) {
      const row = splitMarkdownRow(lines[rowIndex]);
      if (!row) break;
      if (row.length !== header.length) issues.push({ code: 'row_column_count', line: rowIndex + 1, expected: header.length, actual: row.length });
    }
  }
  return issues;
}
