#!/usr/bin/env node
/** Safe, idempotent dispatch metadata tooling for an isolated Luna QA queue. */
import { recordResearchLunaPhase, researchLunaTiming } from './research-luna-bridge.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ISOLATION_FORMAT = 'nodus.isolated-research-profile/1';
const JOB_FORMAT = 'nodus.luna-generation-job/4';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_RESPONSE_HELPER = path.join(REPO, 'scripts', 'research-luna-response.mjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const PROMPT_TEMPLATE = `Generate one real gpt-6-luna completion for the isolated QA queue. Read the generation-job metadata at {{metadataFile}} and use its requestFile path. FIRST invoke metadata.dispatchHelper through metadata.nodeBinary with begin --root=metadata.root --request-id=metadata.requestId (use actual metadata values). If it rejects the job, stop without reading or generating. Read ONLY that request file using exec_command with max_output_tokens=30000. Print the COMPLETE request JSON, including request.messages and response_format. Use all file paths from the metadata; do not copy or retype UUIDs. If the request is truncated or incomplete, stop without completing. Follow the actual request.messages. Do not read other requests, reports, repository files, gold data, web pages, credentials, or mapping metadata. After reading the complete request, write a JSON object containing exactly the keys and values specified by metadata.expectedReadAudit to metadata.readAuditFile, replacing readAt with the current ISO-8601 timestamp immediately after the complete read. Compute readAt with new Date().toISOString() in the subprocess that writes this file; do not type or guess a timestamp. Then invoke metadata.dispatchHelper through metadata.nodeBinary with read-complete --root=metadata.root --request-id=metadata.requestId; stop if it rejects. Generate the requested raw UTF-8 completion into rawFile without repairing or normalizing it. Invoke responseHelper through nodeBinary as a subprocess with --request=requestFile --content=rawFile --finish-reason=stop, using only paths from the metadata. Do not hand-write a response envelope. Final reply only the helper response path.`;
const MULTIPART_PROMPT_TEMPLATE = PROMPT_TEMPLATE.replace(
  'Read ONLY that request file using exec_command with max_output_tokens=30000. Print the COMPLETE request JSON, including request.messages and response_format.',
  'Read ONLY that request file, in EVERY metadata.requestReadParts entry in order, using exec_command with max_output_tokens=30000 for EACH part. Invoke metadata.nodeBinary to print the UTF-8 bytes at each byteOffset for byteLength from metadata.requestFile. Each part ends at a UTF-8 boundary and its SHA-256 is in the metadata. Do not print the whole file in one call, summarize, skip, or truncate any part. Together the parts are the COMPLETE request JSON, including request.messages and response_format. Interpret them as one complete JSON request.');

/** Byte-bounded tool reads preserve every byte of the real request. They do not
 * change the application's evidence budget or its messages. */
export function researchLunaRequestReadParts(bytes, partBytes = 16_000) {
  if (!Buffer.isBuffer(bytes) || !Number.isSafeInteger(partBytes) || partBytes < 4 || partBytes > 16_000
      || !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) fail('Invalid UTF-8 multipart read input');
  const parts = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + partBytes, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    const part = bytes.subarray(start, end);
    parts.push({ byteOffset: start, byteLength: part.length, sha256: sha(part) });
    start = end;
  }
  return parts;
}

function fail(message) { throw new Error(message); }
function regularFile(file, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) fail(`Expected a regular non-symlink file: ${path.basename(file)}`);
  if (fs.realpathSync(file) !== path.resolve(file)) fail(`File path is not canonical: ${path.basename(file)}`);
  return stat;
}
function pathExists(file) {
  try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function realDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Expected a real directory');
  const real = fs.realpathSync(directory);
  if (real !== path.resolve(directory)) fail('Directory path must be canonical');
  return real;
}
function readJson(file, options) { regularFile(file, options); return JSON.parse(fs.readFileSync(file, 'utf8')); }
function contained(root, candidate) {
  const absolute = path.resolve(candidate);
  const rel = path.relative(root, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) fail('Path escapes isolated QA root');
  return absolute;
}
function validateBinary(file, label) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail(`${label} must be an absolute path`);
  regularFile(file, { maxBytes: 512 * 1024 * 1024 });
  const real = fs.realpathSync(file);
  if (label === 'nodeBinary') {
    const descriptor = fs.openSync(real, 'r');
    const magic = Buffer.alloc(4);
    try { fs.readSync(descriptor, magic, 0, magic.length, 0); } finally { fs.closeSync(descriptor); }
    const recognizedBinary = magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      || magic.equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))
      || magic.equals(Buffer.from([0xfe, 0xed, 0xfa, 0xcf]))
      || magic.subarray(0, 2).equals(Buffer.from('MZ'));
    if (!['node', 'node.exe'].includes(path.basename(real)) || (fs.statSync(real).mode & 0o111) === 0 || !recognizedBinary) {
      fail('nodeBinary must be an executable Node.js binary');
    }
    return real;
  }
  const relative = path.relative(REPO, real);
  if (real !== EXPECTED_RESPONSE_HELPER || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    fail('responseHelper must be the repository research-luna-response helper');
  }
  return real;
}
function rootContext(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('Root must be an absolute path');
  const canonicalRoot = realDirectory(root);
  if (canonicalRoot === path.parse(canonicalRoot).root) fail('Isolated QA root cannot be a filesystem root');
  const isolation = readJson(path.join(canonicalRoot, 'isolation.json'), { maxBytes: 64 * 1024 });
  if (isolation.format !== ISOLATION_FORMAT || isolation.root !== canonicalRoot) fail('Root isolation manifest mismatch');
  const artifacts = realDirectory(path.join(canonicalRoot, 'artifacts'));
  if (artifacts !== path.join(canonicalRoot, 'artifacts')) fail('Artifacts directory is not canonical');
  const requests = realDirectory(path.join(artifacts, 'requests'));
  if (requests !== path.join(artifacts, 'requests')) fail('Requests directory is not canonical');
  return { root: canonicalRoot, artifacts };
}
function readEvents(artifacts) {
  const eventFile = path.join(artifacts, 'events.jsonl');
  regularFile(eventFile);
  return fs.readFileSync(eventFile, 'utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
}
function requestState(events, id) {
  const accepted = events.filter(row => row.event === 'accepted' && row.id === id);
  const terminal = events.filter(row => ['completed', 'abandoned'].includes(row.event) && row.id === id);
  if (accepted.length !== 1 || terminal.length > 1) fail('Request event history is ambiguous');
  return { accepted: accepted[0], terminal: terminal[0] ?? null };
}
function pendingRequests(events) {
  const accepted = new Map();
  const terminal = new Set();
  for (const event of events) {
    if (event.event === 'accepted') {
      if (accepted.has(event.id)) fail('Duplicate accepted request event');
      accepted.set(event.id, event);
    }
    if (['completed', 'abandoned'].includes(event.event)) terminal.add(event.id);
  }
  return [...accepted.values()].filter(event => !terminal.has(event.id));
}
function validateLiveRequest(event, artifacts, { now = Date.now(), lifetimeMs = 300_000, maxRequestBytes = 60_000 } = {}) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 900_000
      || !Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > 1_000_000) fail('Invalid dispatch time or size bounds');
  if (!UUID.test(event.id ?? '')) fail('Invalid accepted request identity');
  const acceptedAt = Date.parse(event.at ?? '');
  if (!Number.isFinite(acceptedAt)) fail('Accepted event has no valid timestamp');
  const deadlineAt = Date.parse(event.deadlineAt ?? new Date(acceptedAt + lifetimeMs).toISOString());
  if (!Number.isFinite(deadlineAt) || now > deadlineAt) fail('Accepted request is past its deadline');
  if (now < acceptedAt) fail('Accepted request timestamp is in the future');
  const requestFile = contained(artifacts, path.join(artifacts, 'requests', `${event.id}.json`));
  regularFile(requestFile, { maxBytes: maxRequestBytes });
  const bytes = fs.readFileSync(requestFile);
  if (sha(bytes) !== event.requestHash || bytes.length !== event.requestBytes) fail('Accepted request hash/byte receipt mismatch');
  return { requestFile, bytes, deadlineAt: new Date(deadlineAt).toISOString() };
}
function promptFor(metadataFile, multipart = false) {
  return (multipart ? MULTIPART_PROMPT_TEMPLATE : PROMPT_TEMPLATE).replaceAll('{{metadataFile}}', metadataFile);
}
function writeImmutable(file, bytes) {
  try {
    const descriptor = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    regularFile(file, { maxBytes: 2 * 1024 * 1024 });
    if (!fs.readFileSync(file).equals(bytes)) fail('Immutable dispatch job already exists with different bytes');
  }
}
function writePointer(file, bytes, events) {
  if (pathExists(file)) {
    regularFile(file, { maxBytes: 2 * 1024 * 1024 });
    const current = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (current.requestId !== JSON.parse(bytes.toString('utf8')).requestId) {
      const state = requestState(events, current.requestId);
      if (!state.terminal) fail('Refusing to replace generation pointer while another request is live');
    }
    if (current.requestId === JSON.parse(bytes.toString('utf8')).requestId
        && !fs.readFileSync(file).equals(bytes)) fail('Generation pointer bytes changed for this request');
  }
  const temp = `${file}.tmp-${process.pid}`;
  try {
    writeImmutable(temp, bytes);
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

export function prepareResearchLunaDispatch({ root, nodeBinary, responseHelper, now = Date.now(),
  lifetimeMs = 300_000, maxRequestBytes = 60_000, multipartRead = false, mappingFile = null, mappingSha256 = null } = {}) {
  if (typeof multipartRead !== 'boolean' || (!multipartRead && maxRequestBytes > 60_000)) fail('Large requests require bounded multipart reads');
  const context = rootContext(root);
  const node = validateBinary(nodeBinary, 'nodeBinary');
  const helper = validateBinary(responseHelper, 'responseHelper');
  const events = readEvents(context.artifacts);
  const pending = pendingRequests(events);
  if (pending.length !== 1) fail(`Expected exactly one live accepted request, found ${pending.length}`);
  const event = pending[0];
  const { requestFile, bytes, deadlineAt } = validateLiveRequest(event, context.artifacts,
    { now, lifetimeMs, maxRequestBytes });
  let mapping = null;
  if (mappingFile !== null || mappingSha256 !== null) {
    if (typeof mappingFile !== 'string' || !path.isAbsolute(mappingFile)
        || typeof mappingSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(mappingSha256)) fail('Mapping reference requires an absolute file and SHA256');
    mappingFile = contained(context.root, mappingFile);
    regularFile(mappingFile);
    if (sha(fs.readFileSync(mappingFile)) !== mappingSha256) fail('Mapping reference hash mismatch');
    mapping = { mappingFile, mappingSha256 };
  }
  const jobsDirectory = path.join(context.artifacts, 'dispatch-jobs');
  if (!fs.existsSync(jobsDirectory)) fs.mkdirSync(jobsDirectory, { mode: 0o700 });
  realDirectory(jobsDirectory);
  const metadataFile = path.join(context.artifacts, 'generation-job.json');
  const jobFile = path.join(jobsDirectory, `${event.id}.json`);
  const requestReadParts = multipartRead ? researchLunaRequestReadParts(bytes) : null;
  // A child must capture its own immutable job file. The mutable latest-job
  // pointer is retained for operators, but must never be in a dispatched prompt.
  const prompt = promptFor(jobFile, multipartRead);
  const job = { format: JOB_FORMAT, root: context.root, dispatchHelper: fileURLToPath(import.meta.url), requestId: event.id, acceptedAt: event.at, deadlineAt,
    requestFile, requestSha256: sha(bytes), requestBytes: bytes.length,
    maxRequestBytes, ...(requestReadParts ? { requestReadParts } : {}),
    rawFile: path.join(context.artifacts, 'raw-completions', `${event.id}.txt`),
    readAuditFile: path.join(context.artifacts, `read-${event.id}.json`),
    responseHelper: helper, nodeBinary: node, model: 'gpt-6-luna', forkTurns: 'none',
    reasoningEffort: 'inherited; effective effort not established',
    expectedReadAudit: { requestId: event.id, requestSha256: sha(bytes), requestBytes: bytes.length,
      toolBudget: 30_000, requestJsonPrintedComplete: true, messagesIncluded: true,
      responseFormatIncluded: true, noVisibleTruncation: true, readAt: 'ISO-8601 timestamp recorded immediately after complete read' },
    ...(mapping ? { mapping } : {}),
    prompt, promptSha256: sha(Buffer.from(prompt, 'utf8')) };
  if (requestReadParts) job.expectedReadAudit.requestReadPartsSha256 = sha(Buffer.from(JSON.stringify(requestReadParts), 'utf8'));
  const jobBytes = Buffer.from(`${JSON.stringify(job, null, 2)}\n`, 'utf8');
  if (!fs.existsSync(path.dirname(job.rawFile))) fs.mkdirSync(path.dirname(job.rawFile), { mode: 0o700 });
  realDirectory(path.dirname(job.rawFile));
  for (const outputFile of [job.rawFile, job.readAuditFile]) {
    if (pathExists(outputFile)) {
      regularFile(outputFile, { maxBytes: 16 * 1024 * 1024 });
      fail('Dispatch output already exists; refusing duplicate generation work');
    }
  }
  writeImmutable(jobFile, jobBytes);
  const latestEvents = readEvents(context.artifacts);
  const latestPending = pendingRequests(latestEvents);
  if (latestPending.length !== 1 || latestPending[0].id !== event.id) fail('Live request set changed during prepare');
  writePointer(metadataFile, jobBytes, latestEvents);
  return { requestId: event.id, jobFile, metadataFile, prompt, promptSha256: job.promptSha256,
    requestSha256: job.requestSha256, requestBytes: job.requestBytes, deadlineAt, mapping };
}

function loadJob({ root, requestId }) {
  if (!UUID.test(requestId ?? '')) fail('Invalid request identity');
  const context = rootContext(root);
  const jobFile = path.join(context.artifacts, 'dispatch-jobs', `${requestId}.json`);
  const job = readJson(jobFile, { maxBytes: 2 * 1024 * 1024 });
  if (![JOB_FORMAT, 'nodus.luna-generation-job/3', 'nodus.luna-generation-job/2'].includes(job.format) || job.requestId !== requestId) fail('Dispatch job identity mismatch');
  return { ...context, job, jobFile };
}

export function bindResearchLunaDispatch({ root, requestId, task, model = 'gpt-6-luna', forkTurns = 'none' } = {}) {
  if (typeof task !== 'string' || !/^\/root\/[a-z0-9_/]+$/u.test(task)) fail('Invalid task identity');
  if (model !== 'gpt-6-luna' || forkTurns !== 'none') fail('Dispatch binding model/fork policy mismatch');
  const { artifacts, job, jobFile } = loadJob({ root, requestId });
  const relativeJob = path.relative(artifacts, jobFile).split(path.sep).join('/');
  const promptRecord = { request_id: requestId, task, model, fork_turns: forkTurns,
    message: job.prompt, sha256: job.promptSha256, jobFile: relativeJob };
  const executionRecord = { request_id: requestId, task, model, fork_turns: forkTurns,
    effort: job.reasoningEffort, jobFile: relativeJob };
  appendIdempotent(path.join(artifacts, 'agent-prompts.jsonl'), promptRecord, requestId);
  appendIdempotent(path.join(artifacts, 'agent-executions.jsonl'), executionRecord, requestId);
  return { requestId, task, model, forkTurns, jobFile: relativeJob, mapping: job.mapping ?? null };
}

/** The first agent tool starts reading; the second follows its full-read receipt.
 * Both fail before doing more work when a job was cancelled or expired. */
export function observeResearchLunaDispatch({ root, requestId, phase, now = Date.now() } = {}) {
  const { artifacts, job } = loadJob({ root, requestId });
  if (phase === 'reading-completed') {
    verifyResearchLunaRead({ root, requestId, now });
    const read = readJson(job.readAuditFile, { maxBytes: 64 * 1024 });
    const started = readEvents(artifacts).find(row => row.id === requestId && row.event === 'reading-started');
    if (!started || Date.parse(read.readAt) < Date.parse(started.at) || Date.parse(read.readAt) > now) fail('Read attestation is outside observed reading boundaries');
  }
  if (!['reading-started', 'reading-completed'].includes(phase)) fail('Invalid agent boundary');
  return recordResearchLunaPhase({ root, requestId, phase, now });
}

function appendIdempotent(file, record, requestId) {
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
  if (fs.existsSync(file)) {
    regularFile(file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
    const existing = lines.filter(row => row.request_id === requestId);
    if (existing.length) {
      if (existing.length === 1 && JSON.stringify(existing[0]) === JSON.stringify(record)) return;
      fail('Dispatch binding already exists with different bytes');
    }
  }
  fs.appendFileSync(file, bytes, { mode: 0o600 });
}

export function verifyResearchLunaRead({ root, requestId, now = Date.now(), lifetimeMs = 300_000 } = {}) {
  const { artifacts, job } = loadJob({ root, requestId });
  const events = readEvents(artifacts);
  const state = requestState(events, requestId);
  const maxRequestBytes = job.format === 'nodus.luna-generation-job/2' ? 60_000 : job.maxRequestBytes;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > 1_000_000
      || (!job.requestReadParts && maxRequestBytes > 60_000)) fail('Invalid dispatch read bounds');
  let terminalCompletedAt = null;
  if (state.terminal?.event === 'abandoned') fail('Request was abandoned');
  if (state.terminal?.event === 'completed') {
    const acceptedAt = Date.parse(state.accepted.at ?? '');
    const deadlineAt = Date.parse(state.accepted.deadlineAt ?? new Date(acceptedAt + lifetimeMs).toISOString());
    const completedAt = Date.parse(state.terminal.at ?? '');
    if (!Number.isFinite(acceptedAt) || !Number.isFinite(deadlineAt) || !Number.isFinite(completedAt)
        || completedAt > deadlineAt || state.accepted.requestHash !== job.requestSha256
        || state.accepted.requestBytes !== job.requestBytes || state.terminal.requestHash !== job.requestSha256
        || job.deadlineAt !== new Date(deadlineAt).toISOString()) {
      fail('Completed receipt does not bind to the live request before its deadline');
    }
    terminalCompletedAt = completedAt;
    validateLiveRequest(state.accepted, artifacts, { now: acceptedAt, lifetimeMs, maxRequestBytes });
  } else validateLiveRequest(state.accepted, artifacts, { now, lifetimeMs, maxRequestBytes });
  regularFile(job.readAuditFile, { maxBytes: 64 * 1024 });
  const auditBytes = fs.readFileSync(job.readAuditFile);
  const audit = JSON.parse(auditBytes.toString('utf8'));
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) fail('Read audit must be a JSON object');
  const expectedAuditKeys = Object.keys(job.expectedReadAudit).sort();
  const auditKeys = Object.keys(audit).sort();
  const readAt = Date.parse(audit.readAt ?? '');
  const acceptedAt = Date.parse(state.accepted.at ?? '');
  const deadlineAt = Date.parse(job.deadlineAt);
  if (JSON.stringify(auditKeys) !== JSON.stringify(expectedAuditKeys)
      || !Number.isFinite(readAt) || readAt < acceptedAt || readAt > deadlineAt
      || (terminalCompletedAt !== null && readAt > terminalCompletedAt)) fail('Read audit key set or timestamp is invalid');
  if (audit.requestId !== requestId || audit.requestSha256 !== job.requestSha256
      || audit.requestBytes !== job.requestBytes || audit.toolBudget !== 30_000
      || audit.requestJsonPrintedComplete !== true || audit.messagesIncluded !== true
      || audit.responseFormatIncluded !== true || audit.noVisibleTruncation !== true) {
    fail('Complete-read audit does not match the accepted request');
  }
  const requestBytes = fs.readFileSync(job.requestFile);
  if (requestBytes.length !== job.requestBytes || sha(requestBytes) !== job.requestSha256) fail('Request bytes changed after preparation');
  if (job.requestReadParts) {
    const expectedParts = researchLunaRequestReadParts(requestBytes);
    const partsHash = sha(Buffer.from(JSON.stringify(expectedParts), 'utf8'));
    if (JSON.stringify(job.requestReadParts) !== JSON.stringify(expectedParts)
        || job.expectedReadAudit.requestReadPartsSha256 !== partsHash || audit.requestReadPartsSha256 !== partsHash) {
      fail('Multipart read plan does not cover the complete accepted request');
    }
  }
  return { verified: true, requestId, requestSha256: job.requestSha256, requestBytes: job.requestBytes,
    evidenceNature: 'self-reported full-file-tool-read attestation; not an independent observation of model reading',
    toolBudget: audit.toolBudget, requestJsonPrintedComplete: true, messagesIncluded: true,
    responseFormatIncluded: true, noVisibleTruncation: true, auditSha256: sha(auditBytes),
    ...(job.requestReadParts ? { requestReadPartsSha256: audit.requestReadPartsSha256, requestReadPartCount: job.requestReadParts.length } : {}),
    mapping: job.mapping ?? null };
}

/** Read-only queue view. Event identities always come from events.jsonl `id`;
 * `requestId` is an output/binding convention and is never used to join events. */
export function snapshotResearchLunaQueue({ root } = {}) {
  const context = rootContext(root);
  const events = readEvents(context.artifacts);
  const accepted = new Map();
  const terminal = new Map();
  for (const event of events) {
    if (event.event === 'accepted') {
      if (!UUID.test(event.id ?? '') || accepted.has(event.id)) fail('Duplicate or invalid accepted request event');
      accepted.set(event.id, event);
    } else if (['completed', 'abandoned'].includes(event.event)) {
      if (!UUID.test(event.id ?? '') || terminal.has(event.id)) fail('Duplicate or invalid terminal request event');
      terminal.set(event.id, event);
    }
  }
  const readJsonl = file => {
    if (!pathExists(file)) return [];
    regularFile(file);
    return fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
  };
  const prompts = readJsonl(path.join(context.artifacts, 'agent-prompts.jsonl'));
  const executions = readJsonl(path.join(context.artifacts, 'agent-executions.jsonl'));
  return [...accepted.entries()].map(([id, event]) => {
    const jobFile = path.join(context.artifacts, 'dispatch-jobs', `${id}.json`);
    const jobExists = pathExists(jobFile);
    const job = jobExists ? readJson(jobFile, { maxBytes: 2 * 1024 * 1024 }) : null;
    if (job && (job.requestId !== id || ![JOB_FORMAT, 'nodus.luna-generation-job/3', 'nodus.luna-generation-job/2'].includes(job.format))) fail('Dispatch job identity mismatch in snapshot');
    const bound = prompts.some(row => row.request_id === id) && executions.some(row => row.request_id === id);
    const end = terminal.get(id);
    let status = end?.event ?? (job ? (bound ? 'bound' : 'prepared') : 'accepted');
    if (!end && job && bound && pathExists(job.readAuditFile)) {
      // Use the accepted deadline as the clock so the snapshot is stable across
      // repeated calls and after a live request expires.
      const acceptedAt = Date.parse(event.at ?? '');
      const deadlineAt = Date.parse(job.deadlineAt ?? event.deadlineAt ?? '');
      const snapshotNow = Number.isFinite(deadlineAt) ? deadlineAt : acceptedAt;
      const read = verifyResearchLunaRead({ root: context.root, requestId: id, now: snapshotNow });
      if (read.verified) status = 'full-read';
    }
    return { id, status, acceptedAt: event.at ?? null, terminalAt: end?.at ?? null,
      task: prompts.find(row => row.request_id === id)?.task ?? null,
      jobFile: job ? path.relative(context.artifacts, jobFile).split(path.sep).join('/') : null,
      timing: researchLunaTiming(events, id) };
  });
}

function parseArgs(argv) {
  const values = Object.fromEntries(argv.filter(arg => arg.startsWith('--')).map(arg => {
    const index = arg.indexOf('=');
    return index < 0 ? [arg.slice(2), true] : [arg.slice(2, index), arg.slice(index + 1)];
  }));
  return values;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    const args = parseArgs(rest);
    const root = args.root;
    let result;
    if (command === 'prepare') result = prepareResearchLunaDispatch({ root, nodeBinary: args['node-binary'],
      responseHelper: args['response-helper'], ...(args['lifetime-ms'] ? { lifetimeMs: Number(args['lifetime-ms']) } : {}),
      ...(args['mapping-file'] ? { mappingFile: args['mapping-file'], mappingSha256: args['mapping-sha256'] } : {}) });
    else if (command === 'bind') result = bindResearchLunaDispatch({ root, requestId: args['request-id'], task: args.task,
      model: args.model ?? 'gpt-6-luna', forkTurns: args['fork-turns'] ?? 'none' });
    else if (command === 'begin' || command === 'read-complete') result = observeResearchLunaDispatch({ root, requestId: args['request-id'],
      phase: command === 'begin' ? 'reading-started' : 'reading-completed' });
    else if (command === 'verify-read') result = verifyResearchLunaRead({ root, requestId: args['request-id'] });
    else if (command === 'snapshot') result = { root: path.resolve(root), jobs: snapshotResearchLunaQueue({ root }) };
    else fail('Use prepare, bind, begin, read-complete, verify-read, or snapshot');
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`Research Luna dispatch rejected: ${String(error?.message ?? error)}`);
    process.exitCode = 1;
  }
}
