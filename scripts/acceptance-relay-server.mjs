import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { randomUUID, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { Store, token, digest } from '../server/lib/store.mjs';

const lab = process.env.NODUS_MOBILE_ACCEPTANCE_LAB;
assert(lab && fs.existsSync(path.join(lab, '.nodus-mobile-acceptance-lab')), 'An isolated laboratory is required');
const fixtureRoot = path.join(lab, `relay-server-${randomUUID()}`), store = new Store(fixtureRoot);
const admin = store.createUser('relay-acceptance@example.test', token(32), 'admin');
const spaceId = randomUUID(), credential = token();
store.state.spaces.push({ id: spaceId, name: 'Private relay acceptance', description: '', createdAt: new Date().toISOString() });
store.state.memberships.push({ userId: admin.id, spaceId, role: 'owner' });
store.state.deviceTokens.push({ hash: digest(credential), userId: admin.id, spaceId, kind: 'publisher', deviceName: 'Acceptance Mac', createdAt: new Date().toISOString(), grandfathered: false });
const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const host = Object.values(os.networkInterfaces()).flat().find(address => address?.family === 'IPv4' && !address.internal)?.address;
assert(host, 'LAN address is required'); const url = `https://${host}:${port}`;
store.state.settings.publicUrl = url; store.save();
const folder = path.join(lab, 'desktop-bridge'), certificatePEM = fs.readFileSync(path.join(folder, 'server.crt'), 'utf8');
const certificateFingerprint = new X509Certificate(certificatePEM).fingerprint256.replace(/:/g, '').toLowerCase();
const log = fs.openSync(path.join(lab, 'acceptance-relay-server.log'), 'a', 0o600);
const server = spawn(process.execPath, ['server/server.mjs'], { cwd: process.cwd(), env: { ...process.env, NODUS_DATA_DIR: fixtureRoot, NODUS_PORT: String(port), NODUS_HOST: '0.0.0.0', NODUS_PUBLIC_URL: url, NODUS_TLS_CERT_FILE: path.join(folder, 'server.crt'), NODUS_TLS_KEY_FILE: path.join(folder, 'server.key') }, stdio: ['ignore', log, log] });
const agent = new https.Agent({ ca: certificatePEM, allowPartialTrustChain: true, checkServerIdentity: (_host, peer) => { if (new X509Certificate(peer.raw).fingerprint256.replace(/:/g, '').toLowerCase() !== certificateFingerprint) return new Error('relay_certificate_mismatch'); } });
const request = (pathname, method = 'GET', input) => new Promise((resolve, reject) => {
  const req = https.request(new URL(pathname, url), { agent, method, headers: { Authorization: `Bearer ${credential}`, 'content-type': 'application/json' } }, response => {
    const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, value: JSON.parse(Buffer.concat(chunks)) }));
  }); req.on('error', reject); req.end(input ? JSON.stringify(input) : undefined);
});
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) { try { ready = (await request('/api/v1/capabilities')).status === 200; if (ready) break; } catch {} await new Promise(resolve => setTimeout(resolve, 250)); }
assert(ready, 'The production TLS Server must start');
const created = await request('/api/v1/bridge-relay/channels', 'POST', { macId: randomUUID() });
assert.equal(created.status, 201, JSON.stringify(created.value));
fs.writeFileSync(path.join(lab, 'acceptance-relay-configuration.json'), JSON.stringify({ ...created.value, url, certificatePEM, certificateFingerprint }), { mode: 0o600 });
console.log(JSON.stringify({ ready: true, protocol: 'production HTTPS Server with private relay', port, pid: server.pid }));
const shutdown = () => { server.kill('SIGTERM'); agent.destroy(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
server.on('exit', code => { fs.closeSync(log); process.exit(code ?? 0); });
