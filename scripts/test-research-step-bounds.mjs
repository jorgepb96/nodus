// A research turn's short calls are bounded: the plan and each supervisor decision do not wait out
// the three-minute completion timeout, and one query embedding against a failing endpoint is
// retried by the app's own retry policy only, not again by the SDK inside each of its attempts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { installRuntimeHooks, repoRoot } from './lib/tsRuntimeHooks.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-research-step-bounds-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const ai = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test('one query embedding against a 503 endpoint is retried by the app, not also by the SDK', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; req.resume(); res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '0' }); res.end('{"error":{"message":"busy"}}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  const t0 = Date.now();
  try {
    await ai.embed('methyl 4-nitrobenzoate', undefined, { config: { provider: 'custom', modelId: 'm', endpoint } }).catch(() => null);
  } finally { server.close(); }
  console.log(`${hits} HTTP attempt(s) in ${Date.now() - t0} ms`);
  assert.ok(hits <= 3, `${hits} HTTP attempts for one embedding`);
});

test('the turn plan carries a short timeout on a cloud model', async () => {
  const planner = require(path.join(repoRoot, 'electron/ai/researchTurnPlanner.ts'));
  const json = ai.completeJson;
  let seen;
  ai.completeJson = async (opts) => { seen = opts; throw Error('no model in this test'); };
  try {
    await planner.planResearchTurn([{ role: 'user', content: 'What does the library say about Fischer esterification?' }], { provider: 'openai', model: 'gpt-test' });
  } finally { ai.completeJson = json; }
  assert.ok(seen, 'the planner asked the model');
  assert.ok(seen.timeoutMs && seen.timeoutMs <= 60_000, `plan timeout ${seen.timeoutMs ?? 'unset (the 180 s completion default)'}`);
});
