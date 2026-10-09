// Scheme decluttering of passages through the real modules: layout files in userData are
// matched to a document's pages by page text, chunks are cleaned, and a document with no
// matching page is left exactly as before.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-scheme-cleaning-'));
installRuntimeHooks(userData);
const { schemeCleaningFor, documentPages, SCHEME_LAYOUT_DIR } = require(path.join(repoRoot, 'electron/ai/schemeCleaning.ts'));
const { pageTextHash } = require(path.join(repoRoot, 'electron/extraction/schemeSidecar.ts'));
const { planRetrievalChunks } = require(path.join(repoRoot, 'shared/retrievalChunks.ts'));
test.after(() => rm(userData, { recursive: true, force: true }));

const page1 = 'The earliest example was the synthesis of tropinone in 1917.\nCH2 CHO + H2NCH3\nCO2 – CH3 N O\nRef. 191\nAs with aldol additions, the reaction is catalysed.';
const page2 = 'CHAPTER 2 Reactions of Carbon\nA page with only prose on it, nothing to remove here at all.';
const text = `[[src:s1 p.171]]\n${page1}\n\n[[src:s1 p.172]]\n${page2}`;
const sourceMap = { s1: 'zotero:user:1:ABCD1234' };

test('with no layout files a document is untouched', () => {
  assert.equal(schemeCleaningFor(text, sourceMap), null);
});

test('pages are split on source markers with the chunker\'s source names', () => {
  assert.deepEqual(documentPages(text, sourceMap).map(({ sourceRef, page }) => [sourceRef, page]), [['zotero:user:1:ABCD1234', 171], ['zotero:user:1:ABCD1234', 172]]);
});

test('a layout matched by page text cleans the chunks on that page only', () => {
  fs.mkdirSync(path.join(userData, SCHEME_LAYOUT_DIR), { recursive: true });
  fs.writeFileSync(path.join(userData, SCHEME_LAYOUT_DIR, 'book.json'), JSON.stringify({ version: 1, body: 10, pages: {
    [pageTextHash(page1)]: { scheme: ['CH2 CHO + H2NCH3', 'CO2 – CH3 N O', 'Ref. 191'], margin: [] },
    [pageTextHash('some other page')]: { scheme: ['x y'], margin: ['CHAPTER 2 Reactions of Carbon'] },
  } }));
  const cleaning = schemeCleaningFor(text, sourceMap);
  assert.ok(cleaning);
  assert.equal(cleaning.pages, 1);
  assert.match(cleaning.signature, /^scheme-layout\/1:[0-9a-f]{32}$/);
  const chunks = planRetrievalChunks(text, { sourceMap }).map((chunk) => cleaning.clean(chunk));
  assert.equal(chunks[0].text, 'The earliest example was the synthesis of tropinone in 1917. [scheme] As with aldol additions, the reaction is catalysed. CHAPTER 2 Reactions of Carbon A page with only prose on it, nothing to remove here at all.',
    'page 172 has no layout of its own, so its running head stays');
  assert.equal(chunks[0].pageNumber, 171);
});

test('a changed page text no longer matches: the layout never applies to other text', () => {
  assert.equal(schemeCleaningFor(text.replace('tropinone', 'tropine'), sourceMap), null);
});
