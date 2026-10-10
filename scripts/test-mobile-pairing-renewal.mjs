import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-renewal-contract-'));
const runtime = installRuntimeHooks(root); runtime.app.on = () => {}; runtime.app.once = () => {};
runtime.safeStorage.isEncryptionAvailable = () => true;
const require = createRequire(import.meta.url);
const cert = path.join(root, 'test.crt'), key = path.join(root, 'test.key');
execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
  '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
function stub(module, exports) {
  const id = require.resolve(module); require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('../electron/localServer/lanCert.ts', { ensureLanCert: async () => ({ certPath: cert, keyPath: key }), lanAddresses: () => ['127.0.0.1'] });
stub('../electron/vaults/vaultRegistry.ts', { getVault: id => ['vault-a', 'vault-b'].includes(id) ? { id, name: id, type: 'academic' } : null });
stub('../electron/serverSync/serverSyncShared.ts', { listVaultConfigs: () => [] });
const bridge = require('../electron/desktopBridge/server.ts');
const agent = new https.Agent({ ca: fs.readFileSync(cert) });
const token = () => randomBytes(32).toString('base64url');
let origin;
async function request(route, method = 'GET', body, bearer) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(route, origin), { agent, method, headers: {
      ...(text ? { 'content-type': 'application/json' } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    } }, res => {
      const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(parts).toString()) }); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('contract_timeout'))); req.on('error', reject); req.end(text);
  });
}
try {
  const first = await bridge.createDesktopBridgeOffer(['vault-a'], ['corpus', 'writing']);
  origin = `https://127.0.0.1:${bridge.desktopBridgeStatus().port}`;
  const linked = await request('/bridge/v1/pair', 'POST', { code: first.code, deviceId: 'phone-a', deviceName: 'Acceptance phone' });
  assert.equal(linked.status, 201);
  const original = linked.body.pairing, old = linked.body.token, next = token();
  assert.equal((await request('/bridge/v2/pairing/renew', 'POST', { nextToken: 'weak' }, old)).status, 400);
  assert.equal((await request('/bridge/v2/health', 'GET', undefined, old)).status, 200);
  const rotated = await request('/bridge/v2/pairing/renew', 'POST', { nextToken: next }, old);
  assert.equal(rotated.status, 200); assert.equal(rotated.body.id, original.id);
  assert.equal((await request('/bridge/v2/health', 'GET', undefined, old)).status, 401);
  assert.equal((await request('/bridge/v2/health', 'GET', undefined, next)).status, 200);
  assert.equal((await request('/bridge/v2/pairing/renew', 'POST', { nextToken: next }, next)).status, 200, 'Committed replacement permits idempotent retry');
  assert.equal(bridge.desktopBridgeStatus().pairings.length, 1);

  const offer = await bridge.createDesktopBridgeOffer(['vault-b'], ['corpus', 'testimonies'], original.id);
  assert.equal(offer.renewalPairingId, original.id);
  assert.deepEqual(offer.vaultIds, original.vaultIds); assert.deepEqual(offer.domains, original.domains, 'Renewal cannot widen the existing grant');
  const fields = JSON.parse(Buffer.from(new URL(offer.qrURL).searchParams.get('q'), 'base64url'));
  assert.equal(fields.length, 12); assert.equal(fields[11], original.id);
  const candidate = token();
  const input = { code: offer.code, deviceId: 'forged-device', deviceName: 'Forged', nextToken: candidate };
  assert.equal((await request('/bridge/v1/pair', 'POST', input)).status, 401, 'Code alone cannot replace a linked device credential');
  const otherOffer = await bridge.createDesktopBridgeOffer(['vault-b'], ['corpus']);
  const other = await request('/bridge/v1/pair', 'POST', { code: otherOffer.code, deviceId: 'other-phone', deviceName: 'Other' });
  assert.equal(other.status, 201);
  assert.equal((await request('/bridge/v1/pair', 'POST', input, other.body.token)).status, 401);
  const approved = await request('/bridge/v1/pair', 'POST', input, next);
  assert.equal(approved.status, 201); assert.equal(approved.body.token, candidate);
  assert.equal(approved.body.pairing.id, original.id); assert.equal(approved.body.pairing.deviceId, 'phone-a');
  assert.equal(approved.body.pairing.deviceName, original.deviceName); assert.equal(approved.body.pairing.createdAt, original.createdAt);
  assert.deepEqual(approved.body.pairing.domains, original.domains); assert.deepEqual(approved.body.pairing.vaultIds, original.vaultIds);
  assert.equal(bridge.desktopBridgeStatus().pairings.length, 2, 'Renewal creates no duplicate device');
  assert.equal((await request('/bridge/v2/health', 'GET', undefined, next)).status, 401);
  assert.equal((await request('/bridge/v2/health', 'GET', undefined, candidate)).status, 200);
  assert.equal((await request('/bridge/v1/pair', 'POST', input, candidate)).status, 400, 'The renewal code is single-use');
  const capabilities = await request('/bridge/v2/capabilities', 'GET', undefined, candidate);
  assert.equal(capabilities.status, 200); assert.deepEqual(capabilities.body.vaultIds, original.vaultIds);

  // Failed credential persistence must not consume an offer or rotate the token.
  const retryOffer = await bridge.createDesktopBridgeOffer([], [], original.id);
  const retryInput = { ...input, code: retryOffer.code, nextToken: token() };
  const encrypt = runtime.safeStorage.encryptString;
  runtime.safeStorage.encryptString = () => { throw new Error('fixture_locked_keychain'); };
  assert.equal((await request('/bridge/v1/pair', 'POST', retryInput, candidate)).status, 500);
  runtime.safeStorage.encryptString = encrypt;
  assert.equal((await request('/bridge/v2/health', 'GET', undefined, candidate)).status, 200);
  assert.equal((await request('/bridge/v1/pair', 'POST', retryInput, candidate)).status, 201);
  const current = retryInput.nextToken;
  assert.equal((await request('/bridge/v2/pairing', 'DELETE', undefined, current)).status, 200);
  assert.equal((await request('/bridge/v2/pairing/renew', 'POST', { nextToken: token() }, current)).status, 401);
  await assert.rejects(bridge.createDesktopBridgeOffer([], [], original.id), /ya no está activa/);
  const state = path.join(root, 'desktop-bridge/pairings.bin');
  const values = JSON.parse(runtime.safeStorage.decryptString(fs.readFileSync(state)));
  values.find(value => value.id === other.body.pairing.id).expiresAt = '2000-01-01T00:00:00Z';
  fs.writeFileSync(state, runtime.safeStorage.encryptString(JSON.stringify(values)));
  assert.equal((await request('/bridge/v2/pairing/renew', 'POST', { nextToken: token() }, other.body.token)).status, 401);
  await assert.rejects(bridge.createDesktopBridgeOffer([], [], other.body.pairing.id), /ya no está activa/);
  assert(!JSON.stringify(bridge.desktopBridgeStatus()).includes(createHash('sha256').update(current).digest('hex')));
  console.log(JSON.stringify({ suite: 'mobile-pairing-renewal', passed: true, transport: 'real HTTPS with trusted test CA', stableGrant: true,
    scopedCodeRenewal: true, noDuplicate: true, idempotentRetry: true, failedPersistencePreservesOffer: true, expiryAndRevocation: true }));
} finally { agent.destroy(); await bridge.stopDesktopBridge(); fs.rmSync(root, { recursive: true, force: true }); }
