import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const ROOT_FORMAT = 'nodus.isolated-research-profile/1';
const BRIDGE_FORMAT = 'nodus.codex-luna-qa/1';
const MODEL_ID = 'codex-luna-qa';
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const VALID_FINISH_REASONS = new Set(['stop', 'length', 'content_filter', 'tool_calls']);

function validateRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('QA bridge requires an absolute isolated root');
  const resolved = fs.realpathSync(root);
  const manifestPath = path.join(resolved, 'isolation.json');
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('QA bridge requires a regular isolation manifest');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== ROOT_FORMAT || manifest.root !== resolved || resolved === path.parse(resolved).root) {
    throw new Error('QA bridge rejected an invalid isolated root');
  }
  const artifactRoot = path.join(resolved, 'artifacts');
  const artifactStat = fs.lstatSync(artifactRoot);
  if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink()) throw new Error('QA bridge requires a real artifacts directory');
  const artifactDirs = { requests: 'requests', responses: 'responses', completions: 'completions',
    failedRequests: 'failed-requests', failedResponses: 'failed-responses', rawCompletions: 'raw-completions' };
  for (const name of Object.values(artifactDirs)) {
    const dir = path.join(artifactRoot, name);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`QA bridge requires a real artifacts/${name} directory`);
  }
  const dirs = Object.fromEntries(Object.entries(artifactDirs).map(([key, name]) => [key, path.join(artifactRoot, name)]));
  const events = path.join(artifactRoot, 'events.jsonl');
  if (fs.existsSync(events)) {
    const eventStat = fs.lstatSync(events);
    if (!eventStat.isFile() || eventStat.isSymbolicLink()) throw new Error('QA bridge requires a regular events log');
  }
  return { root: resolved, artifacts: artifactRoot, ...dirs, events };
}

function atomicWriteJson(file, value) {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  const serialized = `${JSON.stringify(value)}\n`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, serialized);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
    return createHash('sha256').update(serialized).digest('hex');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function atomicWriteJsonExclusive(file, value) {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  const serialized = `${JSON.stringify(value)}\n`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, serialized);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.linkSync(temp, file);
    fs.unlinkSync(temp);
    return createHash('sha256').update(serialized).digest('hex');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function safeRegularFile(file, maxBytes) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('Invalid bounded artifact file');
  return stat;
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

/** Host-observed boundaries; read completion remains an agent attestation, not
 * proof of comprehension. The post-read interval includes scheduling and tools. */
export const researchLunaPhasePolicy = Object.freeze({ queueMs: 60_000, readingMs: 90_000 });
const PHASES = ['reading-started', 'reading-completed', 'response-ready'];
export function researchLunaTiming(events, id, at = null) {
  const rows = events.filter(row => row.id === id);
  const accepted = rows.find(row => row.event === 'accepted');
  if (!accepted) throw new Error('Missing accepted request');
  const terminal = rows.find(row => ['completed', 'abandoned'].includes(row.event));
  const phases = rows.filter(row => PHASES.includes(row.event));
  if (phases.some((row, index) => row.event !== PHASES[index] || row.requestHash !== accepted.requestHash
    || !Number.isFinite(Date.parse(row.at)) || Date.parse(row.at) < Date.parse(index ? phases[index - 1].at : accepted.at))) {
    throw new Error('Invalid request phase order, timestamp or identity');
  }
  const first = phases[0], read = phases[1], ready = phases[2];
  const end = terminal ? Date.parse(terminal.at) : at === null ? null : at;
  const start = Date.parse(accepted.at);
  if (!Number.isFinite(start) || (end !== null && (!Number.isFinite(end) || end < Date.parse((phases.at(-1) ?? accepted).at)))) {
    throw new Error('Invalid request timing boundary');
  }
  const interval = (a, b) => a && b ? Date.parse(b.at) - Date.parse(a.at) : null;
  return { phase: ready ? 'delivery' : read ? 'post-read' : first ? 'reading' : 'queue',
    queueMs: interval(accepted, first), readingMs: interval(first, read),
    postReadUntilHelperMs: interval(read, ready), deliveryMs: interval(ready, terminal),
    totalMs: end === null ? null : end - start,
    phaseElapsedMs: end === null ? null : end - Date.parse((ready ?? read ?? first ?? accepted).at),
    terminal: terminal?.event ?? null,
    evidenceNature: 'Host-observed helper boundaries. Reading-completed attests a full read; post-read time includes model generation, scheduling and tools.' };
}
function phaseFailure(accepted, timing, now) {
  if (now >= Date.parse(accepted.deadlineAt)) return 'timeout';
  if (accepted.phasePolicy && timing.phase === 'queue' && timing.phaseElapsedMs >= accepted.phasePolicy.queueMs) return 'queue_timeout';
  if (accepted.phasePolicy && timing.phase === 'reading' && timing.phaseElapsedMs >= accepted.phasePolicy.readingMs) return 'reading_timeout';
  return null;
}
export function recordResearchLunaPhase({ root, requestId, phase, now = Date.now() }) {
  if (!PHASES.includes(phase) || !/^[0-9a-f-]{36}$/iu.test(requestId ?? '')) throw new Error('Invalid request phase');
  const dirs = validateRoot(root);
  const events = fs.readFileSync(dirs.events, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const accepted = events.find(row => row.event === 'accepted' && row.id === requestId);
  if (!accepted) throw new Error('Missing accepted request');
  const timing = researchLunaTiming(events, requestId, now);
  if (timing.terminal) throw new Error('Request is already completed or abandoned');
  const expired = phaseFailure(accepted, timing, now);
  if (expired) throw new Error(`Request is past its ${expired}`);
  const requestFile = path.join(dirs.requests, `${requestId}.json`);
  safeRegularFile(requestFile, MAX_REQUEST_BYTES);
  if (sha256(fs.readFileSync(requestFile)) !== accepted.requestHash) throw new Error('Request hash changed');
  const previous = events.filter(row => row.id === requestId && PHASES.includes(row.event));
  if (previous.some(row => row.event === phase)) return previous.find(row => row.event === phase);
  if (PHASES[previous.length] !== phase) throw new Error('Request phase is out of order');
  const event = { event: phase, at: new Date(now).toISOString(), id: requestId, requestHash: accepted.requestHash };
  // Validate timestamp ordering before writing immutable observations.
  researchLunaTiming([...events, event], requestId, now);
  appendEvent(dirs.events, event);
  return event;
}

/**
 * Publish agent-produced UTF-8 text as a bridge response without parsing,
 * trimming, normalizing, or repairing the generated content.
 */
export function writeResearchLunaResponse(requestFile, contentFile, { finishReason = 'stop' } = {}) {
  const absoluteRequest = path.resolve(requestFile);
  const requests = path.dirname(absoluteRequest);
  const artifacts = path.dirname(requests);
  const root = path.dirname(artifacts);
  if (path.basename(requests) !== 'requests' || path.basename(artifacts) !== 'artifacts') throw new Error('Request path is outside isolated artifacts/requests');
  const dirs = validateRoot(root);
  if (absoluteRequest !== path.join(dirs.requests, path.basename(absoluteRequest))) throw new Error('Request path is not canonical');
  safeRegularFile(absoluteRequest, MAX_REQUEST_BYTES);
  const requestBytes = fs.readFileSync(absoluteRequest);
  const requestRecord = JSON.parse(requestBytes.toString('utf8'));
  const id = path.basename(absoluteRequest, '.json');
  if (!/^[0-9a-f-]{36}$/iu.test(id) || requestRecord?.format !== BRIDGE_FORMAT || requestRecord.id !== id
      || !/^[0-9a-f]{48}$/u.test(requestRecord.nonce ?? '') || requestRecord.request?.model !== MODEL_ID) {
    throw new Error('Request artifact failed helper validation');
  }
  if (!VALID_FINISH_REASONS.has(finishReason)) throw new Error('Invalid finishReason');
  if (fs.existsSync(path.join(dirs.completions, `${id}.json`)) || fs.existsSync(path.join(dirs.failedRequests, `${id}.json`))) {
    throw new Error('Request is already completed or abandoned');
  }
  const absoluteContent = path.resolve(contentFile);
  if (absoluteContent !== path.join(dirs.rawCompletions, `${id}.txt`)) throw new Error('Raw completion must match the request ID in artifacts/raw-completions');
  safeRegularFile(absoluteContent, MAX_RESPONSE_BYTES);
  const rawBytes = fs.readFileSync(absoluteContent);
  const content = rawBytes.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(rawBytes)) throw new Error('Raw completion is not valid UTF-8');
  const responseFile = path.join(dirs.responses, `${id}.json`);
  const accepted = fs.readFileSync(dirs.events, 'utf8').trim().split('\n').map(JSON.parse)
    .find(row => row.event === 'accepted' && row.id === id);
  if (accepted?.deadlineAt && Date.now() >= Date.parse(accepted.deadlineAt)) throw new Error('Request is past its deadline');
  if (accepted?.phasePolicy) recordResearchLunaPhase({ root, requestId: id, phase: 'response-ready' });
  const responseHash = atomicWriteJsonExclusive(responseFile, {
    format: BRIDGE_FORMAT, nonce: requestRecord.nonce, id, content, finish_reason: finishReason,
  });
  return { id, responseFile, contentBytes: rawBytes.length, responseHash, requestHash: sha256(requestBytes) };
}

function appendEvent(file, event) {
  const descriptor = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(event)}\n`);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

function copyFailureArtifact(source, destination, maxBytes) {
  try {
    const stat = safeRegularFile(source, Number.MAX_SAFE_INTEGER);
    const handle = fs.openSync(source, 'r');
    let bytes;
    try {
      const length = Math.min(stat.size, maxBytes);
      bytes = Buffer.alloc(length);
      if (length) fs.readSync(handle, bytes, 0, length, 0);
    } finally { fs.closeSync(handle); }
    atomicWriteBytes(destination, bytes);
    return { bytesStored: bytes.length, bytesOriginal: stat.size, truncated: stat.size > bytes.length, sha256: sha256(bytes) };
  } catch (error) {
    // Diagnostics must never follow an unsafe link or block cleanup. The reason
    // for the rejection is logged by the caller without copying file contents.
    return null;
  }
}

function atomicWriteBytes(file, bytes) {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function fail(response, status, code, message) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ error: { type: 'invalid_request_error', code, message } }));
}

function validMessages(value) {
  return Array.isArray(value) && value.length >= 1 && value.length <= 64 && value.every((message) =>
    message && typeof message === 'object' && !Array.isArray(message)
    && ['system', 'user', 'assistant'].includes(message.role)
    && typeof message.content === 'string' && message.content.length <= 8_000_000
    && Object.keys(message).every((key) => key === 'role' || key === 'content'));
}

function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Request body must be an object';
  if (body.model !== MODEL_ID) return `Only model ${MODEL_ID} is accepted`;
  if (!validMessages(body.messages)) return 'messages must contain bounded role/content text messages';
  if (!Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 32_768) return 'max_tokens is outside the bridge limit';
  if (body.stream === true) return 'Streaming is not supported by the QA bridge';
  return null;
}

function validateResponseArtifact(value, nonce, id) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { reason: 'schema_object' };
  if (value.format !== BRIDGE_FORMAT) return { reason: 'schema_format' };
  if (value.nonce !== nonce) return { reason: 'schema_nonce' };
  if (value.id !== id) return { reason: 'schema_id' };
  if (typeof value.content !== 'string') return { reason: 'schema_content' };
  if (Buffer.byteLength(value.content, 'utf8') > MAX_RESPONSE_BYTES) return { reason: 'schema_content_too_large' };
  if (!VALID_FINISH_REASONS.has(value.finish_reason)) return { reason: 'schema_finish_reason' };
  return { value };
}

/**
 * Serve the real Nodus custom-provider transport from an isolated file queue.
 * The only listen address is IPv4 loopback. Consumers of requests/responses are
 * external orchestration agents; this module never calls a model or network API.
 */
export async function startResearchLunaBridge({ root, timeoutMs = 300_000, pollMs = 100, maxRequests = 150, now = Date.now, phasePolicy = null } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 900_000) throw new Error('Invalid bridge timeout');
  if (!Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 5000) throw new Error('Invalid bridge polling interval');
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 150) throw new Error('Invalid bridge request ceiling');
  if (phasePolicy !== null && (!Number.isSafeInteger(phasePolicy.queueMs) || !Number.isSafeInteger(phasePolicy.readingMs)
    || phasePolicy.queueMs < 10 || phasePolicy.readingMs < 10 || phasePolicy.queueMs + phasePolicy.readingMs >= timeoutMs)) {
    throw new Error('Invalid bridge phase budgets');
  }
  phasePolicy = phasePolicy ? { ...phasePolicy } : null;
  const dirs = validateRoot(root);
  const nonce = randomBytes(24).toString('hex');
  const pending = new Map();
  let closed = false;
  let acceptedRequests = 0;

  const cleanupArtifact = (file) => {
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  const preserveFailedArtifacts = (entry) => {
    const requestTarget = path.join(dirs.failedRequests, `${entry.id}.json`);
    const responseTarget = path.join(dirs.failedResponses, `${entry.id}.txt`);
    const requestArtifact = copyFailureArtifact(entry.requestFile, requestTarget, MAX_REQUEST_BYTES);
    const responseArtifact = copyFailureArtifact(entry.responseFile, responseTarget, MAX_RESPONSE_BYTES);
    return { requestArtifact, responseArtifact };
  };
  const abandon = (id, { reason, requestHash, responseHash } = {}) => {
    const entry = pending.get(id);
    if (!entry) return;
    const artifacts = preserveFailedArtifacts(entry);
    try {
      appendEvent(dirs.events, { event: 'abandoned', at: new Date(now()).toISOString(), id,
        reason, requestHash: requestHash ?? artifacts.requestArtifact?.sha256,
        ...(responseHash || artifacts.responseArtifact ? { responseHash: responseHash ?? artifacts.responseArtifact?.sha256 } : {}),
        ...(artifacts.responseArtifact ? { responseBytes: artifacts.responseArtifact.bytesStored,
          responseBytesOriginal: artifacts.responseArtifact.bytesOriginal, responseTruncated: artifacts.responseArtifact.truncated } : {}) });
    } catch { /* Cleanup remains mandatory even if the diagnostic filesystem fails. */ }
    pending.delete(id);
    clearInterval(entry.pollTimer);
    clearTimeout(entry.timeoutTimer);
    entry.request.off('aborted', entry.onAborted);
    entry.response.off('close', entry.onClose);
    // Retain the immutable accepted request for diagnosis; terminal state blocks reuse.
    cleanupArtifact(entry.responseFile);
  };

  const server = createServer((request, response) => {
    void (async () => {
      if (closed) return fail(response, 503, 'bridge_closed', 'The local QA bridge is closed');
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (request.method === 'GET' && pathname === `/${nonce}/models`) {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_ID, object: 'model', context_length: 128_000 }] }));
      }
      if (request.method !== 'POST' || pathname !== `/${nonce}/chat/completions`) {
        return fail(response, 404, 'not_found', 'Unknown QA bridge route');
      }
      if (request.headers.authorization !== 'Bearer local') return fail(response, 401, 'unauthorized', 'The local QA bridge accepts only Nodus local-provider auth');

      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > MAX_REQUEST_BYTES) {
          fail(response, 413, 'request_too_large', 'Request exceeds the QA bridge limit');
          request.destroy();
          return;
        }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return fail(response, 400, 'invalid_json', 'Request body is not valid JSON'); }
      const invalid = validateRequest(body);
      if (invalid) return fail(response, 400, 'invalid_request', invalid);
      if (acceptedRequests >= maxRequests) return fail(response, 429, 'bridge_request_limit', 'The local QA bridge reached its request limit');
      if (pending.size >= 1) return fail(response, 429, 'bridge_busy', 'The local QA bridge permits one pending request');

      const id = randomUUID();
      const requestFile = path.join(dirs.requests, `${id}.json`);
      const responseFile = path.join(dirs.responses, `${id}.json`);
      const acceptedAt = now();
      const deadlineAt = new Date(acceptedAt + timeoutMs).toISOString();
      const requestHash = atomicWriteJson(requestFile, { format: BRIDGE_FORMAT, nonce, id, receivedAt: new Date(acceptedAt).toISOString(), request: body });
      try { appendEvent(dirs.events, { event: 'accepted', at: new Date(acceptedAt).toISOString(), id, requestHash, requestBytes: fs.statSync(requestFile).size, deadlineAt, ...(phasePolicy ? { phasePolicy } : {}) }); }
      catch (error) { cleanupArtifact(requestFile); throw error; }
      acceptedRequests += 1;
      const entry = { id, request, response, requestFile, responseFile, requestHash, startedAt: now(), pollTimer: null, timeoutTimer: null };
      entry.onAborted = () => abandon(id, { reason: 'callerabort', requestHash });
      entry.onClose = () => { if (!response.writableEnded) abandon(id, { reason: 'callerabort', requestHash }); };
      request.once('aborted', entry.onAborted);
      response.once('close', entry.onClose);
      pending.set(id, entry);
      const poll = () => {
        if (!pending.has(id)) return;
        let responseBytes;
        let responseHash;
        try {
          const events = fs.readFileSync(dirs.events, 'utf8').trim().split('\n').map(JSON.parse);
          const accepted = events.find(row => row.event === 'accepted' && row.id === id);
          const timing = researchLunaTiming(events, id, now());
          const expired = phaseFailure(accepted, timing, now());
          if (expired) {
            abandon(id, { reason: expired, requestHash });
            fail(response, 504, `bridge_${expired}`, `The local QA bridge reached its ${expired}`);
            return;
          }
          if (!fs.existsSync(responseFile)) return;
          if (phasePolicy && timing.phase !== 'delivery') throw new Error('Missing response helper phase');
          const stat = fs.lstatSync(responseFile);
          if (!stat.isFile() || stat.isSymbolicLink()) {
            abandon(id, { reason: 'schema_file', requestHash });
            fail(response, 502, 'invalid_response_artifact', 'The response artifact failed validation');
            return;
          }
          const readLength = Math.min(stat.size, MAX_RESPONSE_BYTES + 1);
          const descriptor = fs.openSync(responseFile, 'r');
          try { responseBytes = Buffer.alloc(readLength); if (readLength) fs.readSync(descriptor, responseBytes, 0, readLength, 0); }
          finally { fs.closeSync(descriptor); }
          if (stat.size > MAX_RESPONSE_BYTES) {
            abandon(id, { reason: 'schema_content_too_large', requestHash });
            fail(response, 502, 'invalid_response_artifact', 'The response artifact failed validation');
            return;
          }
          responseBytes = responseBytes.subarray(0, stat.size);
          responseHash = sha256(responseBytes);
          let value;
          try { value = JSON.parse(responseBytes.toString('utf8')); }
          catch {
            abandon(id, { reason: 'jsonparse', requestHash, responseHash });
            fail(response, 502, 'invalid_response_artifact', 'The response artifact failed validation');
            return;
          }
          const checked = validateResponseArtifact(value, nonce, id);
          if (!checked.value) {
            abandon(id, { reason: checked.reason, requestHash, responseHash });
            fail(response, 502, 'invalid_response_artifact', 'The response artifact failed validation');
            return;
          }
          const result = checked.value;
          atomicWriteJson(path.join(dirs.completions, `${id}.json`), {
            format: BRIDGE_FORMAT, nonce, id, requestHash, responseHash,
            content: result.content, finish_reason: result.finish_reason,
            completedAt: new Date(now()).toISOString(),
          });
          appendEvent(dirs.events, { event: 'completed', at: new Date(now()).toISOString(), id, requestHash, responseHash,
            responseBytes: responseBytes.length, finishReason: result.finish_reason });
          pending.delete(id);
          clearInterval(entry.pollTimer);
          clearTimeout(entry.timeoutTimer);
          request.off('aborted', entry.onAborted);
          response.off('close', entry.onClose);
          cleanupArtifact(responseFile);
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          response.end(JSON.stringify({
            id: `chatcmpl-${id}`,
            object: 'chat.completion',
            created: Math.floor(entry.startedAt / 1000),
            model: MODEL_ID,
            choices: [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: result.finish_reason }],
          }));
        } catch {
          abandon(id, { reason: 'response_read_or_persist', requestHash, responseHash });
          fail(response, 502, 'invalid_response_artifact', 'The response artifact failed validation');
        }
      };
      entry.pollTimer = setInterval(poll, pollMs);
      entry.timeoutTimer = setTimeout(() => {
        if (!pending.has(id)) return;
        abandon(id, { reason: 'timeout', requestHash });
        fail(response, 504, 'bridge_timeout', 'The local QA bridge timed out waiting for an agent response');
      }, timeoutMs);
      poll();
    })().catch(() => fail(response, 500, 'bridge_error', 'The local QA bridge could not process the request'));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('QA bridge failed to bind IPv4 loopback');
  }
  const url = `http://127.0.0.1:${address.port}/${nonce}`;

  return {
    url,
    model: MODEL_ID,
    nonce,
    root: dirs.root,
    requestDirectory: dirs.requests,
    responseDirectory: dirs.responses,
    completionDirectory: dirs.completions,
    eventFile: dirs.events,
    failedRequestDirectory: dirs.failedRequests,
    failedResponseDirectory: dirs.failedResponses,
    pendingCount: () => pending.size,
    acceptedRequests: () => acceptedRequests,
    async close() {
      if (closed) return;
      closed = true;
      for (const id of [...pending.keys()]) {
        const entry = pending.get(id);
        if (!entry.response.writableEnded) fail(entry.response, 503, 'bridge_closed', 'The local QA bridge is closed');
        abandon(id, { reason: 'bridge_close', requestHash: entry.requestHash });
      }
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

export const researchLunaBridgeProtocol = Object.freeze({ format: BRIDGE_FORMAT, model: MODEL_ID, contextWindowCap: 128_000 });
