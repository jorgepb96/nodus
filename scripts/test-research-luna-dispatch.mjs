import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { startResearchLunaBridge } from './research-luna-bridge.mjs';
import { bindResearchLunaDispatch, prepareResearchLunaDispatch, researchLunaRequestReadParts, snapshotResearchLunaQueue, verifyResearchLunaRead } from './research-luna-dispatch.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-luna-dispatch-test-')));
const realNodeBinary = process.execPath;
const realResponseHelper = fileURLToPath(new URL('./research-luna-response.mjs', import.meta.url));
let serial = 0;
let integratedBridge;
function fixture({ now = Date.parse('2026-10-13T10:00:00.000Z'), bytes = Buffer.from('{"messages":[],"response_format":{"type":"json_object"}}\n') } = {}) {
  const root = path.join(base, `root-${serial++}`);
  const artifacts = path.join(root, 'artifacts');
  for (const folder of ['requests', 'dispatch-jobs', 'raw-completions']) fs.mkdirSync(path.join(artifacts, folder), { recursive: true });
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify({ format: 'nodus.isolated-research-profile/1', root }));
  const id = '596cb54b-fa38-4946-84c4-b0b347c5677b';
  const requestFile = path.join(artifacts, 'requests', `${id}.json`);
  fs.writeFileSync(requestFile, bytes);
  const event = { event: 'accepted', at: new Date(now - 1000).toISOString(), id, requestHash: hash(bytes), requestBytes: bytes.length };
  fs.writeFileSync(path.join(artifacts, 'events.jsonl'), `${JSON.stringify(event)}\n`);
  const mappingFile = path.join(artifacts, 'dispatch-ledger-source.json');
  const mappingBytes = Buffer.from('{"fixture":"mapping reference only"}\n');
  fs.writeFileSync(mappingFile, mappingBytes);
  return { root, artifacts, id, event, now, requestFile, mappingFile, mappingSha256: hash(mappingBytes),
    nodeBinary: realNodeBinary, responseHelper: realResponseHelper };
}
async function eventually(check, description) {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    const result = check();
    if (result) return result;
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

try {
  const data = fixture();
  assert.equal(snapshotResearchLunaQueue({ root: data.root })[0].status, 'accepted');
  const prepared = prepareResearchLunaDispatch({ root: data.root, nodeBinary: data.nodeBinary,
    responseHelper: data.responseHelper, now: data.now, lifetimeMs: 10_000,
    mappingFile: data.mappingFile, mappingSha256: data.mappingSha256 });
  assert.equal(prepared.requestId, data.id);
  assert.equal(prepared.requestBytes, fs.statSync(data.requestFile).size);
  assert.match(prepared.prompt, /max_output_tokens=30000/u);
  assert.match(prepared.prompt, /COMPLETE request JSON/u);
  assert.match(prepared.prompt, /If the request is truncated or incomplete, stop/u);
  assert.match(prepared.prompt, /Compute readAt with new Date\(\)\.toISOString\(\) in the subprocess/u);
  const jobFile = path.join(data.artifacts, 'dispatch-jobs', `${data.id}.json`);
  const originalJob = fs.readFileSync(jobFile);
  const job = JSON.parse(originalJob);
  assert.equal(snapshotResearchLunaQueue({ root: data.root })[0].status, 'prepared');
  assert.deepEqual(snapshotResearchLunaQueue({ root: data.root }), snapshotResearchLunaQueue({ root: data.root }), 'queue snapshots are deterministic');
  assert.match(job.prompt, new RegExp(`dispatch-jobs/${data.id}\\.json`, 'u'), 'child prompt captures immutable job metadata');
  assert.doesNotMatch(job.prompt, /generation-job\.json/u, 'child prompt never follows mutable latest-job pointer');
  assert.equal(job.model, 'gpt-6-luna');
  assert.equal(job.forkTurns, 'none');
  assert.equal(job.reasoningEffort, 'inherited; effective effort not established');
  assert.equal(job.requestSha256, hash(fs.readFileSync(data.requestFile)));
  assert.equal(job.mapping.mappingSha256, data.mappingSha256);
  assert.doesNotMatch(job.prompt, /dispatch-ledger-source/u, 'mapping remains metadata-only and outside the prompt');
  const again = prepareResearchLunaDispatch({ root: data.root, nodeBinary: data.nodeBinary,
    responseHelper: data.responseHelper, now: data.now, lifetimeMs: 10_000,
    mappingFile: data.mappingFile, mappingSha256: data.mappingSha256 });
  assert.deepEqual(fs.readFileSync(jobFile), originalJob, 'same request metadata is idempotent and immutable');
  assert.equal(again.promptSha256, prepared.promptSha256);
  const mutatedJob = Buffer.from(originalJob); mutatedJob[mutatedJob.length - 2] ^= 1;
  fs.writeFileSync(jobFile, mutatedJob);
  assert.throws(() => prepareResearchLunaDispatch({ root: data.root, nodeBinary: data.nodeBinary,
    responseHelper: data.responseHelper, now: data.now, lifetimeMs: 10_000,
    mappingFile: data.mappingFile, mappingSha256: data.mappingSha256 }), /different bytes/u);
  fs.writeFileSync(jobFile, originalJob);

  const bound = bindResearchLunaDispatch({ root: data.root, requestId: data.id, task: '/root/current_pdf_retrieval' });
  assert.equal(bound.model, 'gpt-6-luna');
  assert.deepEqual(bound.mapping, job.mapping);
  bindResearchLunaDispatch({ root: data.root, requestId: data.id, task: '/root/current_pdf_retrieval' });
  const prompts = fs.readFileSync(path.join(data.artifacts, 'agent-prompts.jsonl'), 'utf8').trim().split('\n');
  assert.equal(prompts.length, 1, 'binding writes are idempotent');
  assert.throws(() => bindResearchLunaDispatch({ root: data.root, requestId: data.id,
    task: '/root/current_pdf_retrieval', model: 'gpt-6-astra' }), /model\/fork policy mismatch/u);
  assert.equal(snapshotResearchLunaQueue({ root: data.root })[0].status, 'bound');

  const audit = { requestId: data.id, requestSha256: job.requestSha256, requestBytes: job.requestBytes,
    toolBudget: 30_000, requestJsonPrintedComplete: true, messagesIncluded: true,
    responseFormatIncluded: true, noVisibleTruncation: true,
    readAt: new Date(data.now + 1000).toISOString() };
  fs.writeFileSync(job.readAuditFile, `${JSON.stringify(audit)}\n`);
  const verified = verifyResearchLunaRead({ root: data.root, requestId: data.id, now: data.now, lifetimeMs: 10_000 });
  assert.equal(verified.noVisibleTruncation, true);
  assert.equal(verified.verified, true, 'the actual helper receipt is explicitly verified for the collector');
  assert.equal(verified.responseFormatIncluded, true);
  assert.match(verified.evidenceNature, /self-reported/u);
  assert.deepEqual(verified.mapping, job.mapping);
  const beforeSnapshot = fs.readFileSync(path.join(data.artifacts, 'events.jsonl'));
  assert.equal(snapshotResearchLunaQueue({ root: data.root })[0].status, 'full-read');
  assert.deepEqual(fs.readFileSync(path.join(data.artifacts, 'events.jsonl')), beforeSnapshot, 'snapshot is read-only');
  fs.writeFileSync(job.readAuditFile, JSON.stringify({ ...audit, requestBytes: audit.requestBytes - 1 }));
  assert.throws(() => verifyResearchLunaRead({ root: data.root, requestId: data.id, now: data.now, lifetimeMs: 10_000 }), /Complete-read audit/u);
  fs.writeFileSync(job.readAuditFile, `${JSON.stringify(audit)}\n`);
  fs.appendFileSync(path.join(data.artifacts, 'events.jsonl'), `${JSON.stringify({ event: 'completed',
    at: new Date(data.now + 2000).toISOString(), id: data.id, requestHash: job.requestSha256,
    responseHash: 'b'.repeat(64), responseBytes: 40, finishReason: 'stop' })}\n`);
  const completedRead = verifyResearchLunaRead({ root: data.root, requestId: data.id,
    now: data.now + 100_000, lifetimeMs: 10_000 });
  assert.equal(completedRead.requestId, data.id,
    'a verified completion event before deadline remains verifiable after wall-clock expiry');
  assert.equal(snapshotResearchLunaQueue({ root: data.root })[0].status, 'completed');

  const abandoned = fixture();
  fs.appendFileSync(path.join(abandoned.artifacts, 'events.jsonl'), `${JSON.stringify({ event: 'abandoned',
    at: new Date(abandoned.now).toISOString(), id: abandoned.id, reason: 'fixture' })}\n`);
  assert.equal(snapshotResearchLunaQueue({ root: abandoned.root })[0].status, 'abandoned');

  const multilingual = Buffer.from(JSON.stringify({ request: { messages: [{ role: 'user',
    content: 'Español, Ελληνικά, 日本語 🌍\n'.repeat(4000) }], response_format: { type: 'json_object' } } }), 'utf8');
  const large = fixture({ bytes: multilingual });
  assert.ok(multilingual.length > 60_000);
  assert.throws(() => prepareResearchLunaDispatch({ root: large.root, nodeBinary: large.nodeBinary,
    responseHelper: large.responseHelper, now: large.now }), /regular non-symlink/u);
  assert.throws(() => prepareResearchLunaDispatch({ root: large.root, nodeBinary: large.nodeBinary,
    responseHelper: large.responseHelper, now: large.now, maxRequestBytes: 240_000 }), /multipart/u);
  const multipart = prepareResearchLunaDispatch({ root: large.root, nodeBinary: large.nodeBinary,
    responseHelper: large.responseHelper, now: large.now, maxRequestBytes: 240_000, multipartRead: true });
  const multipartJob = JSON.parse(fs.readFileSync(multipart.jobFile));
  const chunks = multipartJob.requestReadParts.map(part => {
    assert.ok(part.byteLength <= 16_000);
    const bytes = multilingual.subarray(part.byteOffset, part.byteOffset + part.byteLength);
    assert.equal(hash(bytes), part.sha256);
    assert.deepEqual(Buffer.from(bytes.toString('utf8'), 'utf8'), bytes, 'every tool read ends at a UTF-8 boundary');
    return bytes;
  });
  assert.deepEqual(Buffer.concat(chunks), multilingual, 'all actual request bytes are read once in order');
  assert.match(multipart.prompt, /EVERY metadata.requestReadParts entry in order/u);
  assert.throws(() => researchLunaRequestReadParts(Buffer.from([0xc3, 0x28])), /UTF-8/u);
  const multipartAudit = { ...multipartJob.expectedReadAudit, readAt: new Date(large.now + 1000).toISOString() };
  fs.writeFileSync(multipartJob.readAuditFile, JSON.stringify(multipartAudit));
  const multipartReceipt = verifyResearchLunaRead({ root: large.root, requestId: large.id, now: large.now });
  assert.equal(multipartReceipt.requestReadPartCount, chunks.length);
  fs.writeFileSync(multipartJob.readAuditFile, JSON.stringify({ ...multipartAudit, requestReadPartsSha256: '0'.repeat(64) }));
  assert.throws(() => verifyResearchLunaRead({ root: large.root, requestId: large.id, now: large.now }), /Multipart/u);
  fs.writeFileSync(multipartJob.readAuditFile, JSON.stringify(multipartAudit));
  multipartJob.requestReadParts.pop();
  fs.writeFileSync(multipart.jobFile, JSON.stringify(multipartJob));
  assert.throws(() => verifyResearchLunaRead({ root: large.root, requestId: large.id, now: large.now }), /Multipart/u);

  const expired = fixture();
  assert.throws(() => prepareResearchLunaDispatch({ root: expired.root, nodeBinary: expired.nodeBinary,
    responseHelper: expired.responseHelper, now: expired.now + 10_001, lifetimeMs: 10_000 }), /past its deadline/u);

  const multiple = fixture();
  prepareResearchLunaDispatch({ root: multiple.root, nodeBinary: multiple.nodeBinary,
    responseHelper: multiple.responseHelper, now: multiple.now });
  const generationPointer = path.join(multiple.artifacts, 'generation-job.json');
  const priorPointer = fs.readFileSync(generationPointer);
  const secondId = 'c0c74aad-cf06-4bb9-b470-934d6f0f7e64';
  const secondBytes = Buffer.from('{}');
  fs.writeFileSync(path.join(multiple.artifacts, 'requests', `${secondId}.json`), secondBytes);
  fs.appendFileSync(path.join(multiple.artifacts, 'events.jsonl'), `${JSON.stringify({ ...multiple.event, id: secondId,
    requestHash: hash(secondBytes), requestBytes: secondBytes.length })}\n`);
  assert.throws(() => prepareResearchLunaDispatch({ root: multiple.root, nodeBinary: multiple.nodeBinary,
    responseHelper: multiple.responseHelper, now: multiple.now }), /exactly one live accepted request/u);
  assert.deepEqual(fs.readFileSync(generationPointer), priorPointer,
    'a different live request cannot overwrite the current generation pointer');

  const symlinked = fixture();
  const original = fs.readFileSync(symlinked.requestFile);
  fs.unlinkSync(symlinked.requestFile);
  const outside = path.join(base, 'outside-request.json');
  fs.writeFileSync(outside, original);
  fs.symlinkSync(outside, symlinked.requestFile);
  assert.throws(() => prepareResearchLunaDispatch({ root: symlinked.root, nodeBinary: symlinked.nodeBinary,
    responseHelper: symlinked.responseHelper, now: symlinked.now }), /regular non-symlink/u);

  const wrongHash = fixture();
  assert.throws(() => prepareResearchLunaDispatch({ root: wrongHash.root, nodeBinary: wrongHash.nodeBinary,
    responseHelper: wrongHash.responseHelper, now: wrongHash.now,
    mappingFile: wrongHash.mappingFile, mappingSha256: '0'.repeat(64) }), /Mapping reference hash mismatch/u);
  const externalHelper = path.join(wrongHash.root, 'external-response.mjs');
  fs.writeFileSync(externalHelper, 'export {};');
  assert.throws(() => prepareResearchLunaDispatch({ root: wrongHash.root, nodeBinary: wrongHash.nodeBinary,
    responseHelper: externalHelper, now: wrongHash.now }), /repository research-luna-response/u);
  const fakeNode = path.join(wrongHash.root, 'node');
  fs.writeFileSync(fakeNode, 'not a Node.js executable'); fs.chmodSync(fakeNode, 0o755);
  assert.throws(() => prepareResearchLunaDispatch({ root: wrongHash.root, nodeBinary: fakeNode,
    responseHelper: wrongHash.responseHelper, now: wrongHash.now }), /executable Node.js binary/u);

  const rootAlias = path.join(base, 'root-alias');
  fs.symlinkSync(data.root, rootAlias);
  assert.throws(() => prepareResearchLunaDispatch({ root: rootAlias, nodeBinary: data.nodeBinary,
    responseHelper: data.responseHelper, now: data.now }), /real directory|canonical/u);

  const integratedRoot = path.join(base, 'bridge-integrated-root');
  fs.mkdirSync(path.join(integratedRoot, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(integratedRoot, 'isolation.json'), JSON.stringify({
    format: 'nodus.isolated-research-profile/1', root: integratedRoot }));
  integratedBridge = await startResearchLunaBridge({ root: integratedRoot, timeoutMs: 10_000, pollMs: 10 });
  const requestBody = { model: 'codex-luna-qa', messages: [{ role: 'user', content: 'Synthetic bridge tooling fixture.' }],
    max_tokens: 16, stream: false };
  const httpResponsePromise = fetch(`${integratedBridge.url}/chat/completions`, { method: 'POST',
    headers: { authorization: 'Bearer local', 'content-type': 'application/json' }, body: JSON.stringify(requestBody) });
  const requestFiles = await eventually(() => {
    const files = fs.readdirSync(integratedBridge.requestDirectory).filter(file => file.endsWith('.json'));
    return files.length ? files : null;
  }, 'integrated bridge request');
  assert.equal(requestFiles.length, 1);
  const requestId = path.basename(requestFiles[0], '.json');
  const acceptedAt = Date.now();
  const integrated = prepareResearchLunaDispatch({ root: integratedRoot, nodeBinary: realNodeBinary,
    responseHelper: realResponseHelper, now: acceptedAt, lifetimeMs: 30_000 });
  assert.equal(integrated.requestId, requestId);
  bindResearchLunaDispatch({ root: integratedRoot, requestId, task: '/root/separate_quality_metrics' });
  const integratedJob = JSON.parse(fs.readFileSync(integrated.jobFile, 'utf8'));
  const readAt = new Date().toISOString();
  fs.writeFileSync(integratedJob.readAuditFile, `${JSON.stringify({ ...integratedJob.expectedReadAudit, readAt })}\n`, { flag: 'wx', mode: 0o600 });
  const syntheticRawCompletion = '{"synthetic":"dispatch helper and bridge integration fixture"}\n';
  fs.writeFileSync(integratedJob.rawFile, syntheticRawCompletion, { flag: 'wx', mode: 0o600 });
  const helperRun = spawnSync(realNodeBinary, [realResponseHelper, `--request=${integratedJob.requestFile}`,
    `--content=${integratedJob.rawFile}`, '--finish-reason=stop'], { encoding: 'utf8' });
  assert.equal(helperRun.status, 0, helperRun.stderr);
  const httpResponse = await httpResponsePromise;
  assert.equal(httpResponse.status, 200);
  const completion = await httpResponse.json();
  assert.equal(completion.choices[0].message.content, syntheticRawCompletion);
  const finalRead = verifyResearchLunaRead({ root: integratedRoot, requestId,
    now: Date.now() + 60_000, lifetimeMs: 30_000 });
  assert.equal(finalRead.requestId, requestId);
  assert.equal(finalRead.evidenceNature, 'self-reported full-file-tool-read attestation; not an independent observation of model reading');
  assert.equal(integratedBridge.pendingCount(), 0);
  await integratedBridge.close(); integratedBridge = null;
  console.log('PASS Luna dispatch helper: canonical isolated roots, live/deadline and hash receipts, immutable idempotent jobs, pointer safety, binding, read-attestation verification, mapping references, and synthetic local bridge integration. No model generation occurred.');
} finally {
  await integratedBridge?.close().catch(() => {});
  fs.rmSync(base, { recursive: true, force: true });
}
