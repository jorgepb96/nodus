import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-writing-document-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'writingDocument.mjs');
await build({
  entryPoints: [path.join(root, 'shared/writingDocument.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { stripLeadingAbstract, documentBodyForPanels, researchDocumentProse } = await import(pathToFileURL(outfile).href);

test('continuous Deep Research stays self-contained but panels do not duplicate it', () => {
  const abstract = 'Resumen exacto del hallazgo.';
  const markdown = [
    abstract,
    '',
    'Primer argumento con evidencia.',
    '',
    '**Limitaciones.** El corpus es parcial.',
    '',
    '**Referencias**',
    '',
    '- Fuente A',
  ].join('\n');
  assert.match(markdown, new RegExp(`^${abstract}`), 'the persisted Markdown includes its abstract');
  assert.equal(stripLeadingAbstract(markdown, abstract).startsWith('Primer argumento'), true);
  const panelBody = documentBodyForPanels(markdown, abstract);
  assert.doesNotMatch(panelBody, /Resumen exacto/u, 'the reader does not repeat the abstract subtitle');
  assert.doesNotMatch(panelBody, /El corpus es parcial/u, 'the reader does not repeat the limitations panel');
  assert.match(panelBody, /Primer argumento/u);
  assert.match(panelBody, /\*\*Referencias\*\*/u, 'references remain in the report body');
});

test('research copy/export omits structured source-note footers and keeps scientific argument', () => {
  const body = 'La intención propagandística no demuestra su recepción.';
  const structured = `${body}\n\n**Limitaciones:** El corpus es parcial.`;
  assert.equal(researchDocumentProse(structured, true), body);
  assert.equal(researchDocumentProse('## Limitaciones\n\nLa censura afecta a los testimonios.', false), '## Limitaciones\n\nLa censura afecta a los testimonios.');
});
