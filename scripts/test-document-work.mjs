import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-document-work-'));
const file = path.join(root, 'limits.mjs');
await build({ stdin: { contents: `export * from './electron/workers/documentWork'; export * from './electron/util/responsiveTimeout';`, resolveDir: process.cwd() },
  outfile: file, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { withDocumentWork, DOCUMENT_WORK_CONCURRENCY, responsiveTimeout } = await import(pathToFileURL(file));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('a 32-document burst and two idea extractions share a bounded CPU budget', async () => {
  let active = 0, peak = 0, done = 0;
  await Promise.all(Array.from({ length: 34 }, (_, i) => withDocumentWork(async () => {
    active++; peak = Math.max(peak, active);
    await delay(2);
    active--; done++;
    return i;
  })));
  assert.equal(done, 34);
  assert.equal(peak, DOCUMENT_WORK_CONCURRENCY);
  assert.ok(peak <= 2, 'network concurrency cannot multiply local parsers');
});

test('cancellation while queued does not start work, and failures release capacity', async () => {
  const releases = [];
  const held = Array.from({ length: DOCUMENT_WORK_CONCURRENCY }, () => withDocumentWork(() => new Promise(resolve => releases.push(resolve))));
  while (releases.length < DOCUMENT_WORK_CONCURRENCY) await delay(1);
  const controller = new AbortController();
  let ran = false;
  const cancelled = withDocumentWork(async () => { ran = true; }, controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(ran, false);
  releases.forEach(resolve => resolve()); await Promise.all(held);
  await assert.rejects(withDocumentWork(async () => { throw new Error('parser failed'); }), /parser failed/);
  assert.equal(await withDocumentWork(async () => 'next document'), 'next document');
});

test('a host stall does not spend the child startup budget before spawn can be delivered', async () => {
  let expired = false;
  const cancel = responsiveTimeout(() => { expired = true; }, 40);
  const until = performance.now() + 150;
  while (performance.now() < until) { /* Model synchronous parent work during launch. */ }
  await delay(1); // Let the overdue timer run first, as it did in the incident.
  assert.equal(expired, false, 'the child must receive a turn before being called stuck');
  cancel(); // Spawn arrives and cancels the deadline.
  await delay(60);
  assert.equal(expired, false);
});

test('an absent child still times out while the parent is responsive', async () => {
  let expired = false;
  const cancel = responsiveTimeout(() => { expired = true; }, 30);
  const deadline = Date.now() + 2_000;
  while (!expired && Date.now() < deadline) await delay(10);
  cancel();
  assert.equal(expired, true);
});
