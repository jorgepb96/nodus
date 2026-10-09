// A publication's time budget grows with what it uploads.
//
// Every request to Nodus Server ran under AbortSignal.timeout(60 s), and that signal covers
// the upload too: the server answers only once it holds the whole body. A real academic
// library publishes a 36.7 MiB gzipped snapshot (85.6 MiB with passages), so on an uplink
// below ~4.9 Mbit/s every attempt was aborted and rebuilt from scratch, and the vault never
// published. This checks the budget the senders actually hand to fetch.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-server-request-timeout')) process.exit(0);

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-server-request-timeout-'));
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const { fetchWithTimeout } = require(path.join(repoRoot, 'electron/serverSync/serverSyncShared.ts'));
const { serverFetchWithTimeout } = require(path.join(repoRoot, 'electron/serverSync/serverNetwork.ts'));

test.after(async () => { await rm(userData, { recursive: true, force: true }); });

test('a snapshot-sized upload gets a budget a 2 Mbit/s uplink can meet', async () => {
  const budgets = [];
  const originalTimeout = AbortSignal.timeout;
  const originalFetch = globalThis.fetch;
  AbortSignal.timeout = (ms) => { budgets.push(ms); return originalTimeout.call(AbortSignal, ms); };
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  try {
    const snapshot = Buffer.alloc(Math.round(36.7 * 1024 * 1024));
    const atTwoMbit = (snapshot.length / (256 * 1024)) * 1000;
    for (const send of [fetchWithTimeout, serverFetchWithTimeout]) {
      budgets.length = 0;
      await send('https://sync.invalid/api/v1/spaces/s/snapshot', { method: 'PUT', body: snapshot });
      assert.ok(budgets[0] >= atTwoMbit, `a 36.7 MiB upload is given ${budgets[0]} ms; at 2 Mbit/s it needs ${Math.round(atTwoMbit)} ms`);

      // An ordinary request keeps the sixty seconds it always had.
      budgets.length = 0;
      await send('https://sync.invalid/api/v1/me', { headers: {} });
      assert.equal(budgets[0], 60_000);
    }
  } finally {
    AbortSignal.timeout = originalTimeout;
    globalThis.fetch = originalFetch;
  }
});
