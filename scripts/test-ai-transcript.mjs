import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-transcript-'));
const file = path.join(scratch, 'trace.jsonl');
const bundle = path.join(scratch, 'transcript.mjs');
await build({ entryPoints: ['electron/ai/transcript.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { transcriptFetch } = await import(pathToFileURL(bundle));
const originalFetch = globalThis.fetch;
const originalSetting = process.env.NODUS_AI_TRANSCRIPT;
test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalSetting === undefined) delete process.env.NODUS_AI_TRANSCRIPT;
  else process.env.NODUS_AI_TRANSCRIPT = originalSetting;
  fs.rmSync(scratch, { recursive: true, force: true });
});
const records = () => fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
async function untilRecorded(count) {
  const deadline = Date.now() + 2000;
  while (records().filter(row => row.phase === 'http-response').length < count) {
    assert.ok(Date.now() < deadline, 'debug response was not recorded');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('debugging excludes authentication for every HeadersInit representation', async () => {
  process.env.NODUS_AI_TRANSCRIPT = file;
  const secret = 'synthetic-review-key';
  const entries = [['Authorization', `Bearer ${secret}`], ['X-API-Key', secret], ['Cookie', secret], ['Content-Type', 'application/json']];
  globalThis.fetch = async () => new Response('ok');
  for (const headers of [Object.fromEntries(entries), new Headers(entries), entries]) {
    await transcriptFetch(secret)(`https://user:${secret}@review.invalid/?api_key=${secret}`, { headers });
  }
  await untilRecorded(3);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(secret));
  for (const row of records().filter(row => row.phase === 'http')) {
    assert.deepEqual(row.headers, { 'content-type': 'application/json' });
    assert.match(row.keyFp, /^[a-f0-9]{12}$/);
  }
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('the caller receives and reads an SSE response before the stream closes', async () => {
  let close;
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: first\n\n'));
    close = () => controller.close();
  } });
  globalThis.fetch = async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  const response = await Promise.race([
    transcriptFetch('synthetic')('https://review.invalid/'),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('fetch waited for the stream to close')), 1000); timer.unref(); }),
  ]);
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  close();
  assert.equal((await reader.read()).done, true);
  await untilRecorded(4);
});

test('a large debug response is capped without truncating the caller response', async () => {
  const payload = 'x'.repeat(2 * 1024 * 1024);
  globalThis.fetch = async () => new Response(payload);
  const response = await transcriptFetch('synthetic')('https://review.invalid/');
  assert.equal((await response.text()).length, payload.length);
  await untilRecorded(5);
  const recorded = records().at(-1);
  assert.equal(recorded.truncated, true);
  assert.equal(recorded.raw.length, 1024 * 1024);
});
