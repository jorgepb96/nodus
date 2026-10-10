import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { Miniflare, convertV4MiniflareOptions } from '../cloudflare/node_modules/miniflare/dist/src/index.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const receive = socket => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off('message', message); reject(new Error('cloud_relay_timeout')); }, 10_000);
  const message = data => { clearTimeout(timer); resolve(JSON.parse(data.toString())); };
  socket.once('message', message);
});

test('Cloud relay runs in workerd with real D1 ownership, WebSockets, opaque routing, offline and revocation', { timeout: 60_000 }, async t => {
  const worker = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: path.resolve('cloudflare/dist/worker.mjs'), compatibilityDate: '2026-08-14', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'relay-acceptance' }, r2Buckets: ['OBJECTS'], durableObjects: { BRIDGE_RELAY: { className: 'NodusBridgeRelay', useSQLite: true } }, bindings: { NODUS_VERSION: '0.1.0-acceptance' } }));
  t.after(() => worker.dispose());
  const url = await worker.ready, database = await worker.getD1Database('DB');
  for (const file of fs.readdirSync('cloudflare/migrations').sort()) {
    const statements = fs.readFileSync(`cloudflare/migrations/${file}`, 'utf8').replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
    for (const statement of statements) await database.prepare(statement).run();
  }
  const now = new Date().toISOString(), expiry = new Date(Date.now() + 3600_000).toISOString(), ownerToken = randomBytes(32).toString('base64url');
  await database.prepare("INSERT INTO users(id,email,display_name,role,created_at,updated_at) VALUES('owner','relay@example.test','Audit','admin',?1,?1)").bind(now).run();
  await database.prepare("INSERT INTO spaces(id,name,description,created_at,updated_at) VALUES('space','Private','','" + now + "','" + now + "')").run();
  await database.prepare("INSERT INTO memberships(user_id,space_id,role,created_at,updated_at) VALUES('owner','space','owner',?1,?1)").bind(now).run();
  await database.prepare("INSERT INTO device_tokens(id,token_hash,user_id,space_id,device_name,device_kind,expires_at,created_at) VALUES('publisher',?1,'owner','space','Mac','publisher',?2,?3)").bind(sha(ownerToken), expiry, now).run();
  const response = await fetch(new URL('/api/v1/bridge-relay/channels', url), { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ macId: randomUUID() }) });
  assert.equal(response.status, 201, await response.clone().text()); const channel = await response.json();
  const wsURL = new URL(`/api/v1/bridge-relay/${channel.id}/host`, url); wsURL.protocol = 'ws:';
  let host = new WebSocket(wsURL, { headers: { Authorization: `Bearer ${channel.hostToken}` } }); await once(host, 'open');
  const epoch = randomUUID(); host.send(JSON.stringify({ type: 'host', epoch }));
  wsURL.pathname = `/api/v1/bridge-relay/${channel.id}/client`;
  const client = new WebSocket(wsURL, { headers: { Authorization: `Bearer ${channel.clientToken}` } }); const readyPromise = receive(client); await once(client, 'open');
  let ready = await readyPromise;
  if (!ready.hostEpoch) ready = await receive(client);
  assert.equal(ready.hostEpoch, epoch);
  const opaque = { version: 1, keyId: randomUUID(), id: randomUUID(), clientId: ready.clientId, epoch, sequence: 0, final: true, sealed: randomBytes(200_000).toString('base64') };
  const toHost = receive(host); client.send(JSON.stringify(opaque)); assert.deepEqual(await toHost, opaque);
  const toClient = receive(client); host.send(JSON.stringify(opaque)); assert.deepEqual(await toClient, opaque);
  const records = await database.prepare('SELECT * FROM bridge_relay_channels').all();
  assert.equal(records.results.length, 1); assert(!JSON.stringify(records).includes(channel.hostToken));
  const observed=[]; client.on('message',bytes=>observed.push(JSON.parse(bytes)));
  const replaced=once(host,'close');
  wsURL.pathname=`/api/v1/bridge-relay/${channel.id}/host`;
  host=new WebSocket(wsURL,{headers:{Authorization:`Bearer ${channel.hostToken}`}});
  await once(host,'open'); const newEpoch=randomUUID();
  const newReady=receive(client); host.send(JSON.stringify({type:'host',epoch:newEpoch}));
  assert.equal((await newReady).hostEpoch,newEpoch); assert.equal((await replaced)[0],1008);
  assert.equal(observed.filter(frame=>frame.type==='offline').length,0,'An old host closing must not interrupt its replacement');
  const forwarded=receive(host); client.send(JSON.stringify({...opaque,epoch:newEpoch}));
  assert.equal((await forwarded).epoch,newEpoch);
  const offline = receive(client); host.close(1000, 'offline'); assert.equal((await offline).type, 'offline');
  const closed = once(client, 'close');
  const revoked = await fetch(new URL(`/api/v1/bridge-relay/channels/${channel.id}`, url), { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(revoked.status, 200); assert.equal((await closed)[0], 1008);
  const denied = await fetch(new URL('/api/v1/bridge-relay/channels', url), { method: 'POST', headers: { Authorization: 'Bearer unknown' }, body: JSON.stringify({ macId: randomUUID() }) });
  assert.equal(denied.status, 401);
  const secondResponse=await fetch(new URL('/api/v1/bridge-relay/channels',url),{method:'POST',headers:{Authorization:`Bearer ${ownerToken}`,'content-type':'application/json'},body:JSON.stringify({macId:randomUUID()})});
  assert.equal(secondResponse.status,201); const second=await secondResponse.json();
  wsURL.pathname=`/api/v1/bridge-relay/${second.id}/client`;
  const idle=new WebSocket(wsURL,{headers:{Authorization:`Bearer ${second.clientToken}`}});
  await once(idle,'open'); const idleClosed=once(idle,'close');
  await database.prepare("UPDATE device_tokens SET expires_at=?1 WHERE id='publisher'").bind(new Date(0).toISOString()).run();
  assert.equal((await idleClosed)[0],1008,'Owner expiry must revoke an idle hibernating socket without another request');
});
