import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { BridgeRelay } from '../server/lib/bridgeRelay.mjs';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-relay-'));
installRuntimeHooks(directory);
const require = createRequire(import.meta.url);
const { DesktopRelayHost } = require('../electron/desktopBridge/relayHost.ts');
const { sealRelay, openRelay } = require('../electron/desktopBridge/relayCrypto.ts');

function inbox(socket) {
  const queued = [], waiting = [];
  socket.on('message', data => { const value = JSON.parse(data.toString()); if (waiting.length) waiting.shift()(value); else queued.push(value); });
  return async () => {
    if (queued.length) return queued.shift();
    return Promise.race([new Promise(resolve => waiting.push(resolve)), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('relay_test_timeout')), 5_000); timer.unref(); })]);
  };
}
async function laboratory(t, forward, options = {}) {
  const records = []; let ownerActive = true;
  const broker = new BridgeRelay({ records: () => records, save: () => {}, isOwnerActive: () => ownerActive, ...options });
  const server = http.createServer((_request, response) => response.end()); broker.attach(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const channel = broker.create('owner-hash', randomUUID());
  const keyId = randomUUID(), secret = randomBytes(32).toString('base64'), secrets = new Map([[keyId, secret]]);
  let connected;
  const ready = new Promise(resolve => connected = resolve);
  const host = new DesktopRelayHost({ ...channel, url }, forward, id => secrets.get(id), state => { if (state === 'connected') connected(); });
  host.start(); await ready;
  t.after(async () => { host.stop(); broker.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  async function client(token = channel.clientToken) {
    const socket = new WebSocket(`${url.replace('http', 'ws')}/api/v1/bridge-relay/${channel.id}/client`, { headers: { Authorization: `Bearer ${token}` } });
    const receive = inbox(socket); await once(socket, 'open'); let state;
    do { state = await receive(); } while (state.type !== 'ready' || !state.hostEpoch);
    return { socket, receive, state };
  }
  return { broker, records, channel, keyId, secret, secrets, host, client, url, revokeOwner: () => ownerActive = false };
}
function frame(lab, client, id, sequence, final, plain, keyId = lab.keyId) {
  return sealRelay(lab.secrets.get(keyId), lab.channel.id, { keyId, clientId: client.state.clientId, epoch: client.state.hostEpoch, id, sequence, final }, 'request', plain);
}
async function sendRequest(lab, client, input, id = randomUUID()) {
  const bytes = Buffer.from(JSON.stringify(input)), frames = [];
  for (let offset = 0; offset < bytes.length; offset += 192 * 1024) {
    const item = frame(lab, client, id, offset / (192 * 1024), offset + 192 * 1024 >= bytes.length, bytes.subarray(offset, offset + 192 * 1024));
    frames.push(item); client.socket.send(JSON.stringify(item));
  }
  const chunks = []; let sequence = 0, result;
  do {
    result = await client.receive(); if (result.type) continue;
    assert.equal(result.id, id); assert.equal(result.sequence, sequence++); assert.equal(result.clientId, client.state.clientId);
    const payload = JSON.parse(openRelay(lab.secret, lab.channel.id, result, 'response'));
    chunks.push(Buffer.from(payload.bodyBase64, 'base64'));
  } while (!result.final);
  return { bytes: Buffer.concat(chunks), frames };
}

test('encrypted relay preserves large requests and files and rejects replay, tampering, mixed keys and revoked devices', async t => {
  let calls = 0;
  const response = randomBytes(2 * 1024 * 1024 + 3);
  const lab = await laboratory(t, async input => { calls++; assert.equal(input.headers.Authorization, 'Bearer private-mac-token'); assert.equal(Buffer.from(input.bodyBase64, 'base64').length, 900_000); return { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: response }; });
  const client = await lab.client();
  const input = { path: '/bridge/v2/vaults/private/corpus/file', method: 'POST', headers: { Authorization: 'Bearer private-mac-token' }, bodyBase64: randomBytes(900_000).toString('base64') };
  const result = await sendRequest(lab, client, input);
  assert.deepEqual(result.bytes, response); assert.equal(calls, 1);
  for (const item of result.frames) client.socket.send(JSON.stringify(item));
  const corrupt = frame(lab, client, randomUUID(), 0, true, Buffer.from(JSON.stringify({ ...input, bodyBase64: '' })));
  const sealed = Buffer.from(corrupt.sealed, 'base64'); sealed[15] ^= 1; corrupt.sealed = sealed.toString('base64'); client.socket.send(JSON.stringify(corrupt));
  const otherKey = randomUUID(); lab.secrets.set(otherKey, randomBytes(32).toString('base64'));
  const id = randomUUID(), bytes = Buffer.from(JSON.stringify({ ...input, bodyBase64: '' }));
  client.socket.send(JSON.stringify(frame(lab, client, id, 0, false, bytes.subarray(0, 100))));
  client.socket.send(JSON.stringify(frame(lab, client, id, 1, true, bytes.subarray(100), otherKey)));
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(calls, 1);
  assert(!JSON.stringify(lab.records).includes(lab.secret)); assert(!JSON.stringify(lab.records).includes('private-mac-token'));
  const closed = once(client.socket, 'close'); lab.revokeOwner(); client.socket.send(JSON.stringify(result.frames[0]));
  assert.equal((await closed)[0], 1008); assert.equal(calls, 1);
});

test('channel identity, credentials, routing isolation and explicit offline state are enforced', async t => {
  const lab = await laboratory(t, async () => ({ status: 200, headers: {}, body: Buffer.from('private') }));
  const first = await lab.client(), second = await lab.client();
  const id = randomUUID();
  first.socket.send(JSON.stringify(frame(lab, first, id, 0, true, Buffer.from(JSON.stringify({ path: '/bridge/v1/capabilities', method: 'GET', headers: {} })))));
  const reply = await first.receive(); assert.equal(reply.clientId, first.state.clientId);
  assert.throws(() => openRelay(lab.secret, lab.channel.id, { ...reply, clientId: second.state.clientId }, 'response'));
  const rejected = new WebSocket(`${lab.url.replace('http', 'ws')}/api/v1/bridge-relay/${lab.channel.id}/client?token=${lab.channel.clientToken}`);
  rejected.on('error', () => {}); const [, response] = await once(rejected, 'unexpected-response'); assert.equal(response.statusCode, 401); rejected.terminate();
  lab.host.stop(); assert.equal((await first.receive()).type, 'offline');
  assert.equal(lab.broker.revoke(lab.channel.id, 'different-owner'), false); assert.equal(lab.broker.revoke(lab.channel.id, 'owner-hash'), true);
  const bad = new WebSocket(`${lab.url.replace('http', 'ws')}/api/v1/bridge-relay/${lab.channel.id}/client`, { headers: { Authorization: `Bearer ${lab.channel.clientToken}` } });
  bad.on('error', () => {}); const [, denial] = await once(bad, 'unexpected-response'); assert.equal(denial.statusCode, 401); bad.terminate();
});

test('invalid expiry denies new connections and expiry revokes idle sockets', async t => {
  const lab = await laboratory(t, async () => ({status:200,headers:{},body:Buffer.alloc(0)}), {validationIntervalMs:20});
  const client = await lab.client();
  const closed = once(client.socket,'close');
  lab.records[0].expiresAt='not-a-date';
  assert.equal((await closed)[0],1008);
  const rejected = new WebSocket(`${lab.url.replace('http','ws')}/api/v1/bridge-relay/${lab.channel.id}/client`,
    {headers:{Authorization:`Bearer ${lab.channel.clientToken}`}});
  rejected.on('error',()=>{});
  const [,response]=await once(rejected,'unexpected-response');
  assert.equal(response.statusCode,401); rejected.terminate();
});

test('replacing the Mac connection does not mark its new connection offline', async t => {
  const lab = await laboratory(t,async () => ({status:200,headers:{},body:Buffer.alloc(0)}));
  const client=await lab.client();
  const observed=[]; client.socket.on('message',bytes=>observed.push(JSON.parse(bytes)));
  const replacement=new WebSocket(`${lab.url.replace('http','ws')}/api/v1/bridge-relay/${lab.channel.id}/host`,
    {headers:{Authorization:`Bearer ${lab.channel.hostToken}`}});
  t.after(()=>replacement.terminate());
  const receive=inbox(replacement); await once(replacement,'open');
  const epoch=randomUUID(); replacement.send(JSON.stringify({type:'host',epoch}));
  let ready; do {ready=await client.receive();} while (ready.type!=='ready' || ready.hostEpoch!==epoch);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(observed.filter(frame=>frame.type==='offline').length,0);
  const input=sealRelay(lab.secret,lab.channel.id,{keyId:lab.keyId,clientId:ready.clientId,epoch,id:randomUUID(),sequence:0,final:true},
    'request',Buffer.from('new host receives this'));
  client.socket.send(JSON.stringify(input));
  const forwarded=await receive();
  assert.equal(openRelay(lab.secret,lab.channel.id,forwarded,'request').toString(),'new host receives this');
});
