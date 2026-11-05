import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-direct-pairing-'));
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
stub('../electron/serverSync/serverSyncShared.ts', { listVaultConfigs: () => [{ configured: true, vaultId: 'vault-a', url: 'https://advanced.example.test' }] });
stub('../electron/secrets/secretStore.ts', { getNodusServerTokenFor: () => 'nonsecret-contract-token' });
let relayStarts = 0;
stub('../electron/desktopBridge/relayHost.ts', { DesktopRelayHost: class { start() { relayStarts++; } stop() {} } });
let remoteCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  remoteCalls++; assert.equal(new URL(url).hostname, 'advanced.example.test');
  return { status: 201, json: async () => ({ id: '11111111-1111-4111-8111-111111111111', hostToken: 'fixture-host', clientToken: 'fixture-client', expiresAt: '2035-01-01T00:00:00Z' }) };
};
const bridge = require('../electron/desktopBridge/server.ts');
const agent = new https.Agent({ ca: fs.readFileSync(cert) });
async function pair(offer) {
  const url = new URL('/bridge/v1/pair', `https://127.0.0.1:${bridge.desktopBridgeStatus().port}`);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { agent, method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => {
        try { assert.equal(res.statusCode, 201); resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('contract_timeout')));
    req.on('error', reject); req.end(JSON.stringify({ code: offer.code, deviceId: offer.id, deviceName: 'Direct connection contract' }));
  });
}
try {
  await assert.rejects(bridge.createDesktopBridgeOffer(['vault-a'], ['corpus'], undefined, 'invalid'), /invalid_pairing_transport/);
  assert.equal(bridge.desktopBridgeStatus().running, false);
  const direct = await bridge.createDesktopBridgeOffer(['vault-a', 'vault-b'], ['corpus', 'writing'], undefined, 'direct');
  assert.equal(remoteCalls, 0, 'A LAN offer must not open or wait for the configured advanced service.');
  assert.equal(direct.relay, undefined); assert.deepEqual(direct.vaultIds, ['vault-a', 'vault-b']);
  const linkedDirect = await pair(direct);
  assert.equal(linkedDirect.relay, undefined); assert.equal(linkedDirect.pairing.relayKeyId, undefined);

  const advanced = await bridge.createDesktopBridgeOffer(['vault-a'], ['corpus']);
  assert.equal(remoteCalls, 1); assert.equal(relayStarts, 1);
  assert.ok(advanced.relay, 'Existing callers retain the explicitly configured advanced transport.');
  const linkedAdvanced = await pair(advanced); assert.ok(linkedAdvanced.relay); assert.ok(linkedAdvanced.pairing.relayKeyId);

  const directWithRelayRunning = await bridge.createDesktopBridgeOffer(['vault-b'], ['corpus'], undefined, 'direct');
  assert.equal(directWithRelayRunning.relay, undefined);
  const linkedSecond = await pair(directWithRelayRunning);
  assert.equal(linkedSecond.relay, undefined); assert.equal(linkedSecond.pairing.relayKeyId, undefined, 'An already running advanced channel cannot add remote credentials to a direct grant.');
  bridge.revokeDesktopBridgePairing(linkedAdvanced.pairing.id);
  await bridge.stopDesktopBridge(); await bridge.resumeDesktopBridge();
  assert.equal(bridge.desktopBridgeStatus().running, true);
  assert.equal(relayStarts, 1, 'Resuming only direct connections must not start the advanced channel.');
  assert.equal(remoteCalls, 1);
  console.log(JSON.stringify({ suite: 'mobile-pairing-direct', passed: true, transport: 'real HTTPS with trusted test CA', directWithoutAdvancedDependency: true, noImplicitRelayCredentials: true, legacyAdvancedCompatible: true, directResume: true }));
} finally {
  globalThis.fetch = originalFetch; agent.destroy(); await bridge.stopDesktopBridge(); fs.rmSync(root, { recursive: true, force: true });
}
