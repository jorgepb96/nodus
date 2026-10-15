// The strict Compass query (used for HAL, BnF, Gallica, arXiv, Zenodo, Europe PMC) must
// always carry a positive term; a query of exclusions only matches the wrong things.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('strict expression keeps the plain words when there is no quote or concept', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-compass-strict-'));
  try {
    const outfile = path.join(tmp, 'interpreter.mjs');
    await build({ entryPoints: [path.join(root, 'electron/compass/compassQueryInterpreter.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', external: ['electron', 'better-sqlite3'] });
    const { interpretCompassQuery } = await import(pathToFileURL(outfile).href);
    const { strict } = interpretCompassQuery('spanish civil war -novel', {}).expressions;
    assert.match(strict, /civil war/i, `strict: ${strict}`);
    assert.match(strict, /-"novel"/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
