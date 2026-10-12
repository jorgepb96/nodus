// Titles from Compass's XML sources (arXiv, OpenAIRE, Gallica) arrive with numeric
// character references; they must be decoded, not shown raw.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('decodeXml decodes numeric character references', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-compass-xml-'));
  try {
    const outfile = path.join(tmp, 'provider.mjs');
    await build({ entryPoints: [path.join(root, 'electron/compass/providers/provider.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', external: ['electron', 'better-sqlite3'] });
    const { decodeXml } = await import(pathToFileURL(outfile).href);
    assert.equal(decodeXml('Espa&#241;a &#x2013; caf&#xE9;'), 'España – café');
    assert.equal(decodeXml('&amp;#241;'), '&#241;', 'an escaped ampersand is not decoded twice');
    assert.equal(decodeXml('A &lt;b&gt; &amp; c'), 'A <b> & c'.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
