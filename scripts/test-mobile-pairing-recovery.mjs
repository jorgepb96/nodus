import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-pairing-recovery-'));
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
const nextToken = () => randomBytes(32).toString('base64url');
let origin;
async function request(route, method = 'GET', body, bearer, discardResponse = false) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(route, origin), { agent, method, headers: {
      ...(text ? { 'content-type': 'application/json' } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    } }, res => {
      // The Mac has committed before writing these headers. The mobile client
      // loses the complete response body and must recover without its contents.
      if (discardResponse) { res.destroy(); resolve({ status: res.statusCode }); return; }
      const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(parts).toString()) }); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('contract_timeout'))); req.on('error', reject); req.end(text);
  });
}
try {
  const offer = await bridge.createDesktopBridgeOffer(['vault-a', 'vault-b'], ['corpus', 'writing'], undefined, 'direct');
  origin = `https://127.0.0.1:${bridge.desktopBridgeStatus().port}`;
  assert.equal((await request('/bridge/v1/pair', 'POST', { code: offer.code, nextToken: 'weak' })).status, 400);
  const candidate = nextToken();
  const input = { code: offer.code, deviceId: 'phone', deviceName: 'Phone', nextToken: candidate };
  assert.equal((await request('/bridge/v1/pair', 'POST', input, undefined, true)).status, 201);
  assert.equal((await request('/bridge/v2/pairing')).status, 401);
  assert.equal((await request('/bridge/v2/pairing', 'GET', undefined, nextToken())).status, 401);
  const receipt = await request('/bridge/v2/pairing', 'GET', undefined, candidate);
  assert.equal(receipt.status, 200); assert.equal(receipt.body.pairing.id, offer.id);
  assert.equal(receipt.body.pairing.deviceId, 'phone');
  assert.deepEqual(receipt.body.pairing.vaultIds, offer.vaultIds); assert.deepEqual(receipt.body.pairing.domains, offer.domains);
  assert(!JSON.stringify(receipt.body).includes(createHash('sha256').update(candidate).digest('hex')));
  assert(!Object.hasOwn(receipt.body, 'token')); assert(!Object.hasOwn(receipt.body.pairing, 'relaySecret'));
  const duplicate = await bridge.createDesktopBridgeOffer(['vault-a'], ['corpus'], undefined, 'direct');
  assert.equal((await request('/bridge/v1/pair', 'POST', { code: duplicate.code, deviceId: 'other', nextToken: candidate })).status, 400,
    'Reusing another active grant credential is rejected without consuming its code');
  assert.equal((await request('/bridge/v1/pair', 'POST', input)).status, 400, 'Code remains single-use');
  assert.equal(bridge.desktopBridgeStatus().pairings.length, 1);
  await bridge.stopDesktopBridge(); await bridge.resumeDesktopBridge();
  origin = `https://127.0.0.1:${bridge.desktopBridgeStatus().port}`;
  assert.equal((await request('/bridge/v2/pairing', 'GET', undefined, candidate)).body.pairing.id, offer.id,
    'The receipt survives Mac listener restart');

  const renewal = await bridge.createDesktopBridgeOffer([], [], offer.id, 'direct');
  const replacement = nextToken();
  assert.equal((await request('/bridge/v1/pair', 'POST', { ...input, code: renewal.code, nextToken: replacement }, candidate, true)).status, 201);
  assert.equal((await request('/bridge/v2/pairing', 'GET', undefined, candidate)).status, 401);
  const renewed = await request('/bridge/v2/pairing', 'GET', undefined, replacement);
  assert.equal(renewed.status, 200); assert.equal(renewed.body.pairing.id, offer.id);
  assert.equal(renewed.body.pairing.createdAt, receipt.body.pairing.createdAt);
  assert.deepEqual(renewed.body.pairing.vaultIds, offer.vaultIds); assert.equal(bridge.desktopBridgeStatus().pairings.length, 1);
  assert.equal((await request('/bridge/v2/pairing', 'DELETE', undefined, replacement)).status, 200);
  assert.equal((await request('/bridge/v2/pairing', 'GET', undefined, replacement)).status, 401);

  const legacy = await bridge.createDesktopBridgeOffer(['vault-a'], ['corpus'], undefined, 'direct');
  const compatible = await request('/bridge/v1/pair', 'POST', { code: legacy.code, deviceId: 'legacy-phone' });
  assert.equal(compatible.status, 201); assert.match(compatible.body.token, /^[A-Za-z0-9_-]{43}$/);
  console.log(JSON.stringify({ suite: 'mobile-pairing-recovery', passed: true,
    transport: 'real HTTPS with trusted test CA', discardedInitialAndRenewalResponses: true,
    authenticatedReceiptAfterMacRestart: true, singleUseCode: true, oneStableGrant: true, legacyClient: true }));
} finally { agent.destroy(); await bridge.stopDesktopBridge(); fs.rmSync(root, { recursive: true, force: true }); }
