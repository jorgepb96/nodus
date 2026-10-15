import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startResearchLunaBridge, researchLunaBridgeProtocol, writeResearchLunaResponse } from './research-luna-bridge.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-luna-bridge-')));
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify({ format: 'nodus.isolated-research-profile/1', root }));
  for (const name of ['requests', 'responses', 'completions', 'failed-requests', 'failed-responses', 'raw-completions']) {
    fs.mkdirSync(path.join(root, 'artifacts', name), { recursive: true, mode: 0o700 });
  }
  return root;
}

async function eventually(check, message) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = check();
    if (result) return result;
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${message}`);
}

function requestBody(overrides = {}) {
  return {
    model: 'codex-luna-qa',
    messages: [{ role: 'system', content: 'Use only supplied sources.' }, { role: 'user', content: 'Fixture question.' }],
    max_tokens: 512,
    stream: false,
    ...overrides,
  };
}

async function submit(bridge, body = requestBody(), { signal } = {}) {
  return fetch(`${bridge.url}/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer local', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

async function queuedRequest(bridge, excluded = []) {
  const skip = new Set(excluded);
  const files = await eventually(() => {
    const listed = fs.readdirSync(bridge.requestDirectory).filter(file => file.endsWith('.json') && !skip.has(file));
    return listed.length ? listed : null;
  }, 'request artifact');
  const file = path.join(bridge.requestDirectory, files.at(-1));
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'request artifacts are private');
  assert.equal(record.format, researchLunaBridgeProtocol.format);
  assert.equal(record.nonce, bridge.nonce);
  assert.equal(record.id, path.basename(file, '.json'));
  return { file, record };
}

const root = makeRoot();
let bridge;
try {
  bridge = await startResearchLunaBridge({ root, timeoutMs: 5000, pollMs: 10 });
  assert.equal(bridge.model, 'codex-luna-qa');
  assert.equal(new URL(bridge.url).hostname, '127.0.0.1');
  assert.match(bridge.nonce, /^[a-f0-9]{48}$/);

  const models = await fetch(`${bridge.url}/models`);
  assert.equal(models.status, 200);
  assert.deepEqual(await models.json(), { object: 'list', data: [{ id: 'codex-luna-qa', object: 'model', context_length: 128_000 }] });
  assert.equal((await fetch(`http://127.0.0.1:${new URL(bridge.url).port}/wrong/chat/completions`, { method: 'POST' })).status, 404,
    'a wrong nonce path is rejected');

  const unauthorized = await fetch(`${bridge.url}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody()),
  });
  assert.equal(unauthorized.status, 401);
  const wrongModel = await submit(bridge, requestBody({ model: 'gpt-6-luna' }));
  assert.equal(wrongModel.status, 400, 'only the explicit bridge model slug is accepted');
  const malformed = await submit(bridge, requestBody({ max_tokens: 0 }));
  assert.equal(malformed.status, 400, 'out-of-bound generation limits are rejected');

  // A normal Nodus-compatible request is persisted verbatim, then the response
  // content and finish_reason pass back without trimming or JSON repair.
  const exact = '{\n  "answer": "línea",\n  "details": { "lines": 2 }\n}\n  ';
  const responsePromise = submit(bridge);
  const { record: queued, file: queuedFile } = await queuedRequest(bridge, fs.readdirSync(bridge.requestDirectory));
  assert.deepEqual(queued.request, requestBody());
  const answer = { format: researchLunaBridgeProtocol.format, nonce: bridge.nonce, id: queued.id,
    content: exact, finish_reason: 'length' };
  const responsePath = path.join(bridge.responseDirectory, `${queued.id}.json`);
  const rawContentFile = path.join(root, 'artifacts', 'raw-completions', `${queued.id}.txt`);
  fs.writeFileSync(rawContentFile, exact, { mode: 0o600, flag: 'wx' });
  assert.throws(() => writeResearchLunaResponse(queuedFile, rawContentFile, { finishReason: 'invalid' }), /Invalid finishReason/);
  assert.equal(fs.existsSync(responsePath), false, 'a rejected helper call leaves no partial response');
  const cli = spawnSync(process.execPath, [path.join(repo, 'scripts/research-luna-response.mjs'),
    `--request=${queuedFile}`, `--content=${rawContentFile}`, '--finish-reason=length'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const published = JSON.parse(cli.stdout.trim());
  const responseBytes = fs.readFileSync(responsePath);
  assert.equal(published.contentBytes, Buffer.byteLength(exact));
  const response = await responsePromise;
  assert.equal(response.status, 200);
  const completion = await response.json();
  assert.equal(completion.model, 'codex-luna-qa');
  assert.equal(completion.choices[0].message.content, exact);
  assert.equal(completion.choices[0].finish_reason, 'length');
  assert.deepEqual(JSON.parse(completion.choices[0].message.content), { answer: 'línea', details: { lines: 2 } });
  const storedCompletion = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'completions', `${queued.id}.json`), 'utf8'));
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(storedCompletion.content, exact, 'audit completion retains the provider text byte-for-byte after JSON decoding');
  assert.equal(storedCompletion.finish_reason, 'length');
  assert.equal(storedCompletion.requestHash, hash(fs.readFileSync(queuedFile)));
  assert.equal(storedCompletion.responseHash, hash(responseBytes));
  const eventRows = fs.readFileSync(bridge.eventFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(eventRows.filter(row => row.id === queued.id).map(row => row.event), ['accepted', 'completed']);
  assert.equal(fs.statSync(bridge.eventFile).mode & 0o777, 0o600, 'diagnostic events are private');
  assert.equal(bridge.pendingCount(), 0);
  assert.equal(fs.existsSync(responsePath), false, 'consumed response files are removed');
  assert.throws(() => writeResearchLunaResponse(queuedFile, rawContentFile), /already completed or abandoned/,
    'a late response cannot recreate an orphan for a completed request');
  assert.equal(fs.existsSync(responsePath), false);

  // One outstanding request is the queue bound; rejected requests do not create artifacts.
  const existingFiles = fs.readdirSync(bridge.requestDirectory);
  const firstPromise = submit(bridge);
  const { record: first } = await queuedRequest(bridge, existingFiles);
  const countBefore = fs.readdirSync(bridge.requestDirectory).length;
  const busy = await submit(bridge);
  assert.equal(busy.status, 429);
  assert.equal(fs.readdirSync(bridge.requestDirectory).length, countBefore);
  const firstResponsePath = path.join(bridge.responseDirectory, `${first.id}.json`);
  fs.writeFileSync(firstResponsePath, JSON.stringify({ format: researchLunaBridgeProtocol.format, nonce: bridge.nonce,
    id: first.id, content: 'done', finish_reason: 'stop' }), { mode: 0o600, flag: 'wx' });
  assert.equal((await firstPromise).status, 200);

  // Aborting the caller retains the request and closes pending bridge state.
  const controller = new AbortController();
  const beforeCancel = fs.readdirSync(bridge.requestDirectory);
  const canceledPromise = submit(bridge, requestBody(), { signal: controller.signal });
  const { record: canceledRequest, file: canceledFile } = await queuedRequest(bridge, beforeCancel);
  controller.abort();
  await assert.rejects(canceledPromise);
  await eventually(() => bridge.pendingCount() === 0 && fs.existsSync(path.join(root, 'artifacts', 'failed-requests', `${canceledRequest.id}.json`)), 'canceled request cleanup');
  const cancelEvent = fs.readFileSync(bridge.eventFile, 'utf8').trim().split('\n').map(JSON.parse)
    .find(row => row.id === canceledRequest.id && row.event === 'abandoned');
  assert.equal(cancelEvent.reason, 'callerabort');
  assert.ok(fs.existsSync(path.join(root, 'artifacts', 'failed-requests', `${canceledRequest.id}.json`)));

  const beforeMalformed = fs.readdirSync(bridge.requestDirectory);
  const malformedPromise = submit(bridge);
  const { record: malformedRequest, file: malformedFile } = await queuedRequest(bridge, beforeMalformed);
  const malformedRaw = '{not-json';
  fs.writeFileSync(path.join(bridge.responseDirectory, `${malformedRequest.id}.json`), malformedRaw, { mode: 0o600, flag: 'wx' });
  assert.equal((await malformedPromise).status, 502);
  assert.equal(fs.readFileSync(path.join(root, 'artifacts', 'failed-responses', `${malformedRequest.id}.txt`), 'utf8'), malformedRaw);
  assert.equal(fs.existsSync(malformedFile), true);
  const malformedEvent = fs.readFileSync(bridge.eventFile, 'utf8').trim().split('\n').map(JSON.parse)
    .find(row => row.id === malformedRequest.id && row.event === 'abandoned');
  assert.equal(malformedEvent.reason, 'jsonparse');

  // A stale/foreign agent response cannot be delivered; the request is retained.
  const beforeBadResponse = fs.readdirSync(bridge.requestDirectory);
  const badResponsePromise = submit(bridge);
  const { record: badResponseRequest, file: badResponseFile } = await queuedRequest(bridge, beforeBadResponse);
  const badRequestBytes = fs.readFileSync(badResponseFile);
  const invalidResponseText = JSON.stringify({
    format: researchLunaBridgeProtocol.format, nonce: 'wrong-nonce', id: badResponseRequest.id,
    content: 'should never be delivered', finish_reason: 'stop',
  });
  const invalidResponsePath = path.join(bridge.responseDirectory, `${badResponseRequest.id}.json`);
  fs.writeFileSync(invalidResponsePath, invalidResponseText, { mode: 0o600, flag: 'wx' });
  assert.equal((await badResponsePromise).status, 502);
  assert.equal(fs.existsSync(badResponseFile), true);
  const failedRequestCopy = path.join(root, 'artifacts', 'failed-requests', `${badResponseRequest.id}.json`);
  const failedResponseCopy = path.join(root, 'artifacts', 'failed-responses', `${badResponseRequest.id}.txt`);
  assert.ok(fs.readFileSync(failedRequestCopy).equals(badRequestBytes), 'failed request copy preserves the accepted artifact');
  assert.equal(fs.readFileSync(failedResponseCopy, 'utf8'), invalidResponseText, 'invalid raw provider artifact is retained byte-for-byte');
  assert.equal(fs.statSync(failedResponseCopy).mode & 0o777, 0o600);
  const invalidEvent = fs.readFileSync(bridge.eventFile, 'utf8').trim().split('\n').map(JSON.parse).find(row => row.id === badResponseRequest.id && row.event === 'abandoned');
  assert.equal(invalidEvent.reason, 'schema_nonce');
  assert.equal(invalidEvent.responseHash, hash(Buffer.from(invalidResponseText)));
  assert.equal(bridge.pendingCount(), 0);

  // Deadline expiry retains the immutable request and closes its live job.
  const timeoutBridge = await startResearchLunaBridge({ root, timeoutMs: 1000, pollMs: 10 });
  const beforeTimeout = fs.readdirSync(timeoutBridge.requestDirectory);
  const timeoutPromise = submit(timeoutBridge);
  const { file: timedOutFile } = await queuedRequest(timeoutBridge, beforeTimeout);
  assert.equal((await timeoutPromise).status, 504);
  assert.equal(timeoutBridge.pendingCount(), 0);
  assert.equal(fs.existsSync(timedOutFile), true);
  const timeoutEvent = fs.readFileSync(timeoutBridge.eventFile, 'utf8').trim().split('\n').map(JSON.parse).at(-1);
  assert.equal(timeoutEvent.reason, 'timeout');
  await timeoutBridge.close();

  // Shutdown also fails and cleans a live caller instead of orphaning a queued job.
  const closingBridge = await startResearchLunaBridge({ root, timeoutMs: 5000, pollMs: 10 });
  const beforeClose = fs.readdirSync(closingBridge.requestDirectory);
  const closingPromise = submit(closingBridge);
  const { file: closingFile } = await queuedRequest(closingBridge, beforeClose);
  await closingBridge.close();
  const closingResponse = await closingPromise;
  assert.equal(closingResponse.status, 503);
  assert.equal(closingBridge.pendingCount(), 0);
  assert.equal(fs.existsSync(closingFile), true);

  // The campaign ceiling counts accepted completions, including internally retried requests.
  const cappedBridge = await startResearchLunaBridge({ root, timeoutMs: 5000, pollMs: 10, maxRequests: 1 });
  const beforeCapped = fs.readdirSync(cappedBridge.requestDirectory);
  const cappedPromise = submit(cappedBridge);
  const { record: capped } = await queuedRequest(cappedBridge, beforeCapped);
  const cappedContent = path.join(root, 'artifacts', 'raw-completions', `${capped.id}.txt`);
  fs.writeFileSync(cappedContent, 'first and only', { mode: 0o600, flag: 'wx' });
  const cappedFile = path.join(cappedBridge.requestDirectory, `${capped.id}.json`);
  assert.throws(() => writeResearchLunaResponse(cappedFile, rawContentFile), /match the request ID/,
    'a response file from a different request cannot be attached to this request');
  assert.throws(() => writeResearchLunaResponse(cappedFile, cappedContent, { finishReason: 'not-a-finish-reason' }));
  assert.equal(fs.existsSync(path.join(cappedBridge.responseDirectory, `${capped.id}.json`)), false);
  writeResearchLunaResponse(cappedFile, cappedContent, { finishReason: 'stop' });
  assert.equal((await cappedPromise).status, 200);
  assert.equal(cappedBridge.acceptedRequests(), 1);
  assert.equal((await submit(cappedBridge)).status, 429);
  assert.equal(cappedBridge.acceptedRequests(), 1, 'denied requests do not consume accepted request count');
  await cappedBridge.close();

  // A linked artifact parent is rejected before the listener opens.
  const symlinkRoot = makeRoot();
  const completionDir = path.join(symlinkRoot, 'artifacts', 'completions');
  fs.renameSync(completionDir, `${completionDir}.real`);
  fs.symlinkSync(`${completionDir}.real`, completionDir);
  await assert.rejects(startResearchLunaBridge({ root: symlinkRoot }), /real artifacts\/completions/);
  fs.rmSync(symlinkRoot, { recursive: true, force: true });

  console.log('PASS research Luna QA bridge: isolated loopback nonce, capped private request queue, completion hash artifacts, symlink rejection, cancellation cleanup, and exact response passthrough.');
} finally {
  await bridge?.close().catch(() => {});
  fs.rmSync(root, { recursive: true, force: true });
}
