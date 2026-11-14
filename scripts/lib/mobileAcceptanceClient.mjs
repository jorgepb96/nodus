import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import tls from 'node:tls';
import {isIP} from 'node:net';
import { createHash, randomUUID } from 'node:crypto';

// Choose an address from the signed pairing offer before consuming its code.
// An unavailable mDNS resolver must not hide a reachable authorised LAN/VPN
// endpoint. No write is replayed and a certificate mismatch stops the check.
export async function selectAcceptanceOrigin(offer) {
  let lastError;
  // Prefer a signed LAN/VPN address when one is available. A successful mDNS
  // probe can be followed by a failed second DNS lookup on this Mac.
  const origins=[...offer.origins].sort((a,b)=>Number(Boolean(isIP(new URL(b).hostname.replace(/^\[(.*)\]$/,'$1'))))-Number(Boolean(isIP(new URL(a).hostname.replace(/^\[(.*)\]$/,'$1')))));
  for (const address of origins) {
    const origin = new URL(address); assert.equal(origin.protocol, 'https:');
    try {
      await new Promise((resolve, reject) => {
        const socket = tls.connect({host:origin.hostname,port:Number(origin.port || 443),rejectUnauthorized:false});
        socket.once('error',reject);
        socket.setTimeout(5000,()=>socket.destroy(Object.assign(new Error('Connection timed out'),{code:'ETIMEDOUT'})));
        socket.once('secureConnect',()=>{
          const pin=createHash('sha256').update(socket.getPeerCertificate().raw).digest('hex');
          socket.end();
          if(pin!==offer.certificateFingerprint.replace(/:/g,'').toLowerCase())reject(new Error('certificate_mismatch'));
          else resolve();
        });
      });
      return origin;
    } catch(error) {
      if(!['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','ETIMEDOUT','ECONNRESET'].includes(error.code))throw error;
      lastError=error;
    }
  }
  throw lastError ?? new Error('No authorised HTTPS origin');
}

/** Acceptance uses the production pinned HTTPS protocol and only a marked laboratory. */
export async function connectAcceptanceBridge(deviceName) {
  const lab = process.env.NODUS_MOBILE_ACCEPTANCE_LAB;
  assert(lab && fs.existsSync(`${lab}/.nodus-mobile-acceptance-lab`), 'An isolated laboratory is required');
  const offer = JSON.parse(fs.readFileSync(`${lab}/mobile-pairing-offer.json`, 'utf8'));
  assert(Date.parse(offer.expiresAt) > Date.now(), 'Renew the temporary offer before acceptance');
  const origin = await selectAcceptanceOrigin(offer);
  const agent = new https.Agent();
  agent.createConnection = (options, callback) => {
    const socket = tls.connect({ ...options, rejectUnauthorized: false });
    socket.once('error', callback);
    socket.once('secureConnect', () => {
      const pin = createHash('sha256').update(socket.getPeerCertificate().raw).digest('hex');
      if (pin !== offer.certificateFingerprint.replace(/:/g, '').toLowerCase()) {
        socket.destroy(); callback(new Error('certificate_mismatch')); return;
      }
      callback(null, socket);
    });
  };
  let token;
  async function request(path, method = 'GET', body, expected = 200, binary = false) {
    return new Promise((resolve, reject) => {
      const input = body === undefined ? undefined : JSON.stringify(body);
      const req = https.request(new URL(path, origin), { agent, method, headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(input ? { 'content-type': 'application/json' } : {}),
      } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => {
          const bytes = Buffer.concat(chunks), text = bytes.toString();
          try { assert.equal(res.statusCode, expected, `${path}: ${text.slice(0, 240)}`); resolve(binary ? bytes : JSON.parse(text)); }
          catch (error) { reject(error); }
        });
      });
      req.setTimeout(120_000, () => req.destroy(new Error('Bridge timed out'))); req.on('error', reject); req.end(input);
    });
  }
  const paired = await request('/bridge/v1/pair', 'POST', { code: offer.code, deviceId: randomUUID(), deviceName }, 201);
  token = paired.token;
  const capabilities = await request('/bridge/v2/capabilities');
  const vault = capabilities.vaults.find(item => item.name === 'Principal'); assert(vault);
  const root = `/bridge/v2/vaults/${encodeURIComponent(vault.id)}`;
  return {
    request, root, vault,
    binary: path => request(path, 'GET', undefined, 200, true),
    operation: async (method, args = []) => (await request(`${root}/operations`, 'POST', { method, args })).result,
    async job(method, args, onState = () => {}, timeout = 15 * 60_000) {
      const key = randomUUID();
      let job = (await request(`${root}/jobs`, 'POST', { method, args, idempotencyKey: key }, 202)).job;
      assert.equal((await request(`${root}/jobs`, 'POST', { method, args, idempotencyKey: key }, 202)).job.id, job.id);
      const deadline = Date.now() + timeout;
      while (['accepted', 'running', 'saved'].includes(job.state)) {
        onState(job); assert(Date.now() < deadline, 'Generation did not finish before its deadline');
        await new Promise(resolve => setTimeout(resolve, 1_000));
        job = (await request(`${root}/jobs/${job.id}`)).job;
      }
      onState(job); assert.equal(job.state, 'available', job.error); return job;
    },
    async close() { try { await request('/bridge/v2/pairing', 'DELETE'); } finally { agent.destroy(); } },
  };
}
