import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
const root = mkdtempSync(path.join(os.tmpdir(), 'nodus-discovery-txt-'));
const runtime = installRuntimeHooks(root);
const {desktopBridgeDiscoveryTXT} = createRequire(import.meta.url)('../shared/desktopBridgeDiscovery.ts');
const mac = 'cfa9d2f3-6b6d-48ce-832b-e3716fb49a78';

test('reconnection advertises bounded public LAN/VPN hints without pairing secrets', () => {
  const origins = ['https://mac.local:12345', 'https://192.168.1.10:12345', 'https://100.64.0.1:12345', 'https://[fd7a:115c:a1e0::1]:12345'];
  const txt = desktopBridgeDiscoveryTXT(mac, origins);
  assert.deepEqual(txt, ['discoveryVersion=1', `macId=${mac}`, 'rc=4', ...origins.map((url, index) => `r${index}=${url}`)]);
  assert(txt.every(value => Buffer.byteLength(value) <= 255), 'Every DNS-SD TXT entry respects the wire limit');
  assert(!txt.some(value => /token|code|secret|fingerprint|vault|proof/.test(value)), 'No credential, vault name or purported trust anchor is advertised');
});

test('malformed and oversized hints are excluded and list size is bounded', () => {
  const good = 'https://100.64.0.1:7443';
  const bad = ['http://host:7443', 'https://user:pass@host:7443', 'https://host:7443/path', 'https://host:7443?token=x', 'https://host:7443#fragment', 'not a URL', 'https://' + 'a'.repeat(245) + '.local'];
  assert.deepEqual(desktopBridgeDiscoveryTXT(mac, [...bad, good, good]), ['discoveryVersion=1', `macId=${mac}`, 'rc=1', `r0=${good}`]);
  assert.equal(desktopBridgeDiscoveryTXT(mac, Array.from({length:40}, (_, i) => `https://192.168.1.${i + 1}:7443`)).length, 19);
  assert.throws(() => desktopBridgeDiscoveryTXT('unknown', [good]), /invalid_mac_identity/);
  assert.throws(() => desktopBridgeDiscoveryTXT(mac, bad), /missing_discovery_origin/);
});
process.on('exit', () => {runtime.restore(); rmSync(root, {recursive:true, force:true});});
