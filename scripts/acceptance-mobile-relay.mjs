import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import https from 'node:https';
import { WebSocket } from 'ws';
import { createRequire } from 'node:module';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const lab = process.env.NODUS_MOBILE_ACCEPTANCE_LAB;
assert(lab && fs.existsSync(path.join(lab, '.nodus-mobile-acceptance-lab')));
installRuntimeHooks(lab);
const { sealRelay, openRelay } = createRequire(import.meta.url)('../electron/desktopBridge/relayCrypto.ts');
const source = JSON.parse(fs.readFileSync(path.join(lab, 'mobile-pairing-offer.json'), 'utf8'));
const payload = JSON.parse(Buffer.from(new URL(source.pairingURL).searchParams.get('offer'), 'base64url').toString());
assert(payload.relay, 'The real Mac must expose an authenticated relay offer');
const certificate = JSON.parse(fs.readFileSync(path.join(lab, 'acceptance-relay-configuration.json'), 'utf8')).certificatePEM;
const agent = new https.Agent({ ca: certificate, allowPartialTrustChain: true, checkServerIdentity: (_host, peer) => {
  if (createHash('sha256').update(peer.raw).digest('hex') !== payload.relay.certificateFingerprint) return new Error('relay_certificate_mismatch');
} });
let configuration = payload.relay, token;
async function request(path, method = 'GET', input, expected = 200) {
  const url = new URL(`/api/v1/bridge-relay/${configuration.id}/client`, configuration.url); url.protocol = 'wss:';
  const socket = new WebSocket(url, { agent, headers: { Authorization: `Bearer ${configuration.clientToken}` }, maxPayload: 768 * 1024 });
  const queue = [], waiting = [];
  socket.on('message', bytes => { const value = JSON.parse(bytes.toString()); if (waiting.length) waiting.shift().resolve(value); else queue.push(value); });
  socket.on('error', error => { for (const waiter of waiting.splice(0)) waiter.reject(error); });
  const timeout = setTimeout(() => { for (const waiter of waiting.splice(0)) waiter.reject(new Error('relay_acceptance_timeout')); socket.terminate(); }, 120_000);
  const receive = async () => queue.length ? queue.shift() : new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  try {
    const ready = await receive(); assert(ready.clientId && ready.hostEpoch, 'The Mac outgoing relay must be connected');
    const id = randomUUID(), bytes = Buffer.from(JSON.stringify({ path, method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, bodyBase64: input ? Buffer.from(JSON.stringify(input)).toString('base64') : undefined }));
    for (let offset = 0; offset < bytes.length; offset += 192 * 1024) socket.send(JSON.stringify(sealRelay(configuration.secret, configuration.id,
      { keyId: configuration.keyId, clientId: ready.clientId, epoch: ready.hostEpoch, id, sequence: offset / (192 * 1024), final: offset + 192 * 1024 >= bytes.length }, 'request', bytes.subarray(offset, offset + 192 * 1024))));
    let frame, sequence = 0, headers; const chunks = [];
    do { frame = await receive(); assert.equal(frame.sequence, sequence++); assert.equal(frame.id, id); assert.equal(frame.keyId, configuration.keyId);
      const output = JSON.parse(openRelay(configuration.secret, configuration.id, frame, 'response')); assert.equal(output.status, expected); headers = output.headers; chunks.push(Buffer.from(output.bodyBase64, 'base64')); } while (!frame.final);
    return { bytes: Buffer.concat(chunks), headers };
  } finally { clearTimeout(timeout); socket.close(); }
}
try {
  const paired = JSON.parse((await request('/bridge/v1/pair', 'POST', { code: payload.code, deviceId: randomUUID(), deviceName: 'Remote Bridge acceptance' }, 201)).bytes);
  assert(paired.relay && paired.relay.keyId !== configuration.keyId, 'Every linked device needs its own end-to-end key');
  configuration = paired.relay; token = paired.token;
  const capabilities = JSON.parse((await request('/bridge/v2/capabilities')).bytes);
  const vault = capabilities.vaults.find(vault => vault.name === 'Principal'); assert(vault);
  assert.notEqual(capabilities.deviceId, vault.id);
  const root = `/bridge/v2/vaults/${vault.id}`;
  const reports = JSON.parse((await request(`${root}/corpus/deep-research?limit=7&offset=0`)).bytes);
  assert(reports.total >= 29 && reports.reports.length === 7);
  const detail = JSON.parse((await request(`${root}/corpus/library/documents/${encodeURIComponent('nodus:acceptance-report')}`)).bytes);
  const archive = (await request(`${root}/corpus/library/documents/${encodeURIComponent('nodus:acceptance-report')}/download.zip`)).bytes;
  assert.equal(createHash('sha256').update(archive).digest('hex'), detail.document.packageHash);
  assert(archive.length > 100_000);
  await request('/bridge/v2/pairing', 'DELETE');
  console.log(JSON.stringify({ executed: 1, passed: 1, failed: 0, skipped: 0, transport: 'encrypted WebSocket through production HTTPS Server and real Mac Bridge', reports: reports.total, archiveBytes: archive.length, scopedIdentity: true, perDeviceKey: true, revoked: true }));
} finally { agent.destroy(); }
