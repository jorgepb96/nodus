// The nouns a citation falls back to (a source, a gap, a contradiction) are shown to
// the reader inside the citation pill. They used to be Spanish literals, so readers of
// every other language saw "fuente" or "hueco" in their reports and chat answers.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-citation-words-'));
const outfile = path.join(tmp, 'citationWords.mjs');
await build({
  entryPoints: [path.join(repoRoot, 'shared/citationWords.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { citationWords, isGenericCitationLabel } = await import(pathToFileURL(outfile).href);
const typesFile = path.join(tmp, 'types.mjs');
await build({ entryPoints: [path.join(repoRoot, 'shared/types.ts')], outfile: typesFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { PROMPT_LANGUAGES } = await import(pathToFileURL(typesFile).href);
// Words that are spelled the same in another language are that language's own word.
const COGNATES = new Set(['de.author', 'pt.author', 'pt-BR.author']);
test.after(() => rm(tmp, { recursive: true, force: true }));

test('no language but Spanish names a citation with a Spanish word', () => {
  const spanish = citationWords('es');
  const spanishWords = new Set(Object.values(spanish).map((word) => word.toLowerCase()));
  for (const language of PROMPT_LANGUAGES) {
    if (language === 'es') continue;
    for (const [key, word] of Object.entries(citationWords(language))) {
      assert.ok(word.trim(), `${language}.${key} is empty`);
      if (COGNATES.has(`${language}.${key}`)) continue;
      assert.ok(!spanishWords.has(word.toLowerCase()), `${language}.${key} is the Spanish "${word}"`);
    }
  }
});

test('a placeholder label is recognised in every language, with or without a number', () => {
  for (const language of PROMPT_LANGUAGES) {
    const { source, gap, contradiction } = citationWords(language);
    for (const label of [source, gap, contradiction, `${source} 2`, source.toUpperCase()])
      assert.equal(isGenericCitationLabel(label), true, `${language}: ${label}`);
  }
  assert.equal(isGenericCitationLabel('contradiccion'), true, 'the unaccented spelling of the old prompt rule');
});

test('a label that names something is never a placeholder', () => {
  for (const label of ['Kossoy, 2014', 'Toro Tamayo (2019)', 'la fuente original', 'Source criticism', 'Untitled work (1978)'])
    assert.equal(isGenericCitationLabel(label), false, label);
});
