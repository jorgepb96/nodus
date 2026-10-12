import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-research-answer-structure-'));
try {
  const bundle = path.join(temp, 'researchAnswerStructure.mjs');
  await build({ entryPoints: [path.join(repo, 'shared/researchAnswerStructure.ts')], outfile: bundle,
    bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { RESEARCH_ANSWER_TABLE_LIMITS, renderResearchAnswerTable, validateResearchAnswerTable,
    validateResearchMarkdownTableAlignment } = await import(pathToFileURL(bundle).href);

  const citation = '[fixture 02, p. 1](nodus://passage/documentary%3Asample%3A0)';
  const valid = { headers: ['Grupo', 'Resultado medido', 'Puntuación'], rows: [
    ['Recuperación espaciada', 'Recuerdo', `72% ${citation}`],
    ['Relectura', 'Recuerdo', `51% ${citation}`],
  ] };
  const rendered = renderResearchAnswerTable(valid);
  assert.deepEqual(rendered.issues, []);
  assert.equal(rendered.markdown,
    `| Grupo | Resultado medido | Puntuación |\n| --- | --- | --- |\n| Recuperación espaciada | Recuerdo | 72% ${citation} |\n| Relectura | Recuerdo | 51% ${citation} |`);
  assert.deepEqual(validateResearchMarkdownTableAlignment(rendered.markdown), []);
  assert.ok(rendered.markdown.includes(citation), 'citation text and nodus:// target remain byte-for-byte resolvable');

  const escaping = renderResearchAnswerTable({ headers: ['Medición', 'Fuente'], rows: [
    ['Recuerdo | memoria\n72%', `[archivo | página](nodus://passage/documentary%3Aescaped%3A1)`],
  ] });
  assert.equal(escaping.issues.length, 0);
  assert.equal(escaping.markdown,
    '| Medición | Fuente |\n| --- | --- |\n| Recuerdo \\| memoria<br>72% | [archivo \\| página](nodus://passage/documentary%3Aescaped%3A1) |');
  assert.deepEqual(validateResearchMarkdownTableAlignment(escaping.markdown), []);

  const malformedFixtures = [
    ['not-an-object', null, 'shape'],
    ['nested-header', { headers: [['Grupo']], rows: [['A']] }, 'cell_type'],
    ['nested-cell', { headers: ['Grupo'], rows: [[{ value: 'A' }]] }, 'cell_type'],
    ['row-width-mismatch', { headers: ['Grupo', 'Resultado'], rows: [['A']] }, 'row_width'],
    ['empty-header', { headers: ['  '], rows: [['A']] }, 'header_empty'],
    ['non-meaningful-header', { headers: ['***'], rows: [['A']] }, 'header_not_meaningful'],
    ['no-data-rows', { headers: ['Grupo'], rows: [] }, 'rows'],
    ['unlinked-nodus-uri', { headers: ['Fuente'], rows: [['nodus://passage/orphan']] }, 'unsafe_link'],
    ['unsafe-nodus-target', { headers: ['Fuente'], rows: [['[cita](nodus://passage/a|b)']] }, 'unsafe_link'],
    ['control-character', { headers: ['Grupo'], rows: [['A\u0000B']] }, 'unsafe_control'],
    ['too-many-columns', { headers: Array(RESEARCH_ANSWER_TABLE_LIMITS.columns + 1).fill('Columna'), rows: [Array(RESEARCH_ANSWER_TABLE_LIMITS.columns + 1).fill('x')] }, 'header_width'],
    ['overlong-cell', { headers: ['Dato'], rows: ['x'.repeat(RESEARCH_ANSWER_TABLE_LIMITS.cellChars + 1).split()] }, 'cell_too_long'],
    ['aggregate-size-limit', { headers: ['Dato'], rows: ['x'.repeat(RESEARCH_ANSWER_TABLE_LIMITS.totalChars).split()] }, 'table_too_large'],
    ['extra-field', { headers: ['Grupo'], rows: [['A']], answer: 'unexpected' }, 'shape'],
  ];
  for (const [name, table, expectedCode] of malformedFixtures) {
    const issues = validateResearchAnswerTable(table);
    assert.ok(issues.some(issue => issue.code === expectedCode), `${name} is rejected with ${expectedCode}`);
    assert.equal(renderResearchAnswerTable(table).markdown, null, `${name} never produces partial Markdown`);
  }

  const wrongSeparator = '| Grupo | Resultado medido | Puntuación |\n|---|---|---|---|\n| A | Recuerdo | 72% |';
  assert.deepEqual(validateResearchMarkdownTableAlignment(wrongSeparator), [
    { code: 'separator_column_count', line: 2, expected: 3, actual: 4 },
  ], 'the archived three-header/four-separator defect is surfaced without inventing cells');
  const wrongDataRow = '| A | B |\n| --- | --- |\n| one | two | three |';
  assert.deepEqual(validateResearchMarkdownTableAlignment(wrongDataRow), [
    { code: 'row_column_count', line: 3, expected: 2, actual: 3 },
  ], 'existing row-width defects are returned, not repaired');
  assert.deepEqual(validateResearchMarkdownTableAlignment('Prose with x | y inline.\n'), [], 'ordinary prose is not treated as a table');
  assert.deepEqual(validateResearchMarkdownTableAlignment('| Code | Value |\n| --- | --- |\n| `a|b` | 2 |'), [], 'inline-code pipes do not change column count');

  const archivePath = path.join(repo, 'audit/research-chat-grounding/final-82dac50f/embeddinggemma-2-text-q8-256-v1.json');
  const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  const archivedAnswer = archive.answers.find(answer => answer.key === 'embeddinggemma-2-text-q8-256-v1/heldout-calculation/0');
  assert.ok(archivedAnswer, 'archived malformed-table regression fixture exists');
  const archivedMarkdown = archivedAnswer.response.answer;
  const archivedTable = archivedMarkdown.split('\n\n')[0];
  assert.deepEqual(validateResearchMarkdownTableAlignment(archivedTable), [
    { code: 'separator_column_count', line: 2, expected: 3, actual: 4 },
  ], 'archived malformed Markdown table is detected exactly');

  console.log('Research answer structure: structured table validation/rendering, citation-safe escaping, alignment checks, and archived malformed-table regression passed.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
