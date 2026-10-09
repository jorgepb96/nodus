// An offline first open of the tutorial catalogue must not pin the fallback list for the run.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-tutorials-'));
test.after(() => fs.rmSync(userData, { recursive: true, force: true }));
let calls = 0;
installRuntimeHooks(userData, { net: { fetch: async () => { calls += 1; if (calls === 1) throw new Error('offline'); return new Response(JSON.stringify({ version: 1, videos: [] }), { status: 200 }); } } });
const tutorials = createRequire(import.meta.url)(path.join(root, 'electron/tutorialCatalogue.ts'));

test('a failed catalogue check is retried on the next open', async () => {
  await tutorials.getTutorialCatalogue();
  await new Promise((resolve) => setImmediate(resolve));
  await tutorials.getTutorialCatalogue();
  assert.equal(calls, 2);
});
