import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { startResearchLunaBridge, recordResearchLunaPhase, researchLunaTiming, writeResearchLunaResponse } from './research-luna-bridge.mjs';
import { prepareResearchLunaDispatch, observeResearchLunaDispatch, snapshotResearchLunaQueue } from './research-luna-dispatch.mjs';
import { initializeResearchLunaPool, acquireResearchLunaSlot } from './lib/researchLunaAdmission.mjs';
const roots = [], bridges = [];
function isolated() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-luna-phases-'))); roots.push(root);
  fs.mkdirSync(path.join(root, 'artifacts'));
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify({ format: 'nodus.isolated-research-profile/1', root }));
  return root;
}
async function begin({ phasePolicy = { queueMs: 100, readingMs: 100 }, timeoutMs = 1000, now } = {}) {
  const root = isolated();
  const bridge = await startResearchLunaBridge({ root, timeoutMs, pollMs: 10, phasePolicy, ...(now ? { now } : {}) }); bridges.push(bridge);
  const response = fetch(`${bridge.url}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer local', 'content-type': 'application/json' },
    body: JSON.stringify({ model: bridge.model, messages: [{ role: 'user', content: 'synthetic local protocol test' }], max_tokens: 100, stream: false }) });
  while (!fs.readdirSync(bridge.requestDirectory).length) await delay(5);
  const requestFile = path.join(bridge.requestDirectory, fs.readdirSync(bridge.requestDirectory)[0]);
  const id = path.basename(requestFile, '.json');
  const events = () => fs.readFileSync(bridge.eventFile, 'utf8').trim().split('\n').map(JSON.parse);
  return { root, bridge, response, requestFile, id, events };
}
try {
  const pool = isolated(), a = isolated(), b = isolated();
  initializeResearchLunaPool(pool, 1);
  assert.throws(() => initializeResearchLunaPool(pool, 2), /EEXIST/);
  const lease = acquireResearchLunaSlot(pool, a);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {acquireResearchLunaSlot} from ${JSON.stringify(new URL('./lib/researchLunaAdmission.mjs', import.meta.url).href)}; acquireResearchLunaSlot(${JSON.stringify(pool)}, ${JSON.stringify(b)});`], { encoding: 'utf8' });
  assert.notEqual(child.status, 0); assert.match(child.stderr, /pool is full/);
  lease.release(); lease.release();
  acquireResearchLunaSlot(pool, b).release();
  assert.throws(() => acquireResearchLunaSlot(os.tmpdir(), a), /ENOENT|manifest/);

  // Successful real local HTTP/file-queue round trip, no model or external API.
  const success = await begin({ timeoutMs: 5000, phasePolicy: { queueMs: 1500, readingMs: 1500 } });
  const dispatch = prepareResearchLunaDispatch({ root: success.root, nodeBinary: process.execPath,
    responseHelper: path.resolve('scripts/research-luna-response.mjs') });
  const job = JSON.parse(fs.readFileSync(dispatch.jobFile));
  assert.equal(job.format, 'nodus.luna-generation-job/4');
  assert.match(job.prompt, /FIRST invoke metadata.dispatchHelper/);
  assert.throws(() => observeResearchLunaDispatch({ root: success.root, requestId: success.id, phase: 'reading-completed' }), /ENOENT/);
  observeResearchLunaDispatch({ root: success.root, requestId: success.id, phase: 'reading-started' });
  const readBytes = fs.readFileSync(job.requestFile); assert.equal(readBytes.length, job.requestBytes);
  fs.writeFileSync(job.readAuditFile, JSON.stringify({ ...job.expectedReadAudit, readAt: new Date(Date.now() + 1000).toISOString() }));
  assert.throws(() => observeResearchLunaDispatch({ root: success.root, requestId: success.id, phase: 'reading-completed' }), /outside observed reading boundaries/);
  fs.writeFileSync(job.readAuditFile, JSON.stringify({ ...job.expectedReadAudit, readAt: new Date().toISOString() }));
  observeResearchLunaDispatch({ root: success.root, requestId: success.id, phase: 'reading-completed' });
  const raw = '  exact raw UTF-8: cálculo\n'; fs.writeFileSync(job.rawFile, raw);
  writeResearchLunaResponse(job.requestFile, job.rawFile);
  const completed = await success.response; assert.equal(completed.status, 200);
  assert.equal((await completed.json()).choices[0].message.content, raw);
  const timing = snapshotResearchLunaQueue({ root: success.root })[0].timing;
  for (const key of ['queueMs', 'readingMs', 'postReadUntilHelperMs', 'deliveryMs']) assert.ok(timing[key] >= 0, `${key} observed`);
  assert.equal(timing.totalMs, timing.queueMs + timing.readingMs + timing.postReadUntilHelperMs + timing.deliveryMs);
  assert.match(timing.evidenceNature, /scheduling and tools/);
  assert.throws(() => observeResearchLunaDispatch({ root: success.root, requestId: success.id, phase: 'reading-started' }), /completed or abandoned/);

  // Serial operator admission can exceed 60 seconds without weakening the
  // observed reading boundary or the original total request deadline.
  let serialClock = Date.now();
  const serialRun = await begin({ timeoutMs: 300_000,
    phasePolicy: { queueMs: 180_000, readingMs: 90_000 }, now: () => serialClock });
  const serialAccepted = serialRun.events()[0];
  assert.equal(Date.parse(serialAccepted.deadlineAt) - Date.parse(serialAccepted.at), 300_000);
  serialClock += 75_000;
  recordResearchLunaPhase({ root: serialRun.root, requestId: serialRun.id, phase: 'reading-started', now: serialClock });
  serialClock += 90_000;
  assert.equal((await serialRun.response).status, 504);
  assert.equal(serialRun.events().at(-1).reason, 'reading_timeout');

  // Virtual host clock tests phase expiry without sleeping for five minutes.
  for (const mode of ['queue', 'reading', 'post-read']) {
    let clock = Date.now();
    const pending = await begin({ now: () => clock });
    if (mode !== 'queue') recordResearchLunaPhase({ root: pending.root, requestId: pending.id, phase: 'reading-started', now: clock });
    if (mode === 'post-read') recordResearchLunaPhase({ root: pending.root, requestId: pending.id, phase: 'reading-completed', now: clock });
    const original = fs.readFileSync(pending.requestFile);
    clock += mode === 'post-read' ? 1000 : 100;
    const response = await pending.response; assert.equal(response.status, 504);
    const terminal = pending.events().at(-1);
    assert.equal(terminal.reason, mode === 'post-read' ? 'timeout' : `${mode}_timeout`);
    assert.deepEqual(fs.readFileSync(pending.requestFile), original, 'expired requests remain byte-exact for diagnosis');
    assert.throws(() => recordResearchLunaPhase({ root: pending.root, requestId: pending.id, phase: 'reading-started', now: clock }), /completed or abandoned/);
    const rawFile = path.join(pending.root, 'artifacts/raw-completions', `${pending.id}.txt`); fs.writeFileSync(rawFile, 'late');
    assert.throws(() => writeResearchLunaResponse(pending.requestFile, rawFile), /completed or abandoned/);
  }
  const bypass = await begin();
  fs.writeFileSync(path.join(bypass.bridge.responseDirectory, `${bypass.id}.json`), JSON.stringify({ format: 'nodus.codex-luna-qa/1',
    id: bypass.id, nonce: bypass.bridge.nonce, content: 'cannot bypass lifecycle', finish_reason: 'stop' }));
  assert.equal((await bypass.response).status, 502, 'an envelope without observed read/helper boundaries cannot publish');
  assert.equal(fs.readdirSync(bypass.bridge.completionDirectory).length, 0);

  // Missing boundaries are unknown, not invented from file mtimes.
  const legacyTiming = researchLunaTiming([{ event: 'accepted', id: 'old', at: '2026-01-01T00:00:00Z' },
    { event: 'abandoned', id: 'old', at: '2026-01-01T00:01:00Z' }], 'old');
  assert.equal(legacyTiming.queueMs, null); assert.equal(legacyTiming.readingMs, null); assert.equal(legacyTiming.postReadUntilHelperMs, null);
  console.log('QA lifecycle: cross-process admission, complete local transport, observed queue/read/post-read/delivery timing, phase-specific expiry, unchanged total deadline, retained requests and terminal rejection passed. Zero model generations.');
} finally { for (const bridge of bridges) await bridge.close(); for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); }
