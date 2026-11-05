import { bearerToken, bytesToBase64Url, constantTimeEqual, first, HttpError, json, readJson, run, sha256Hex, strictRateLimit, clientAddress } from './util.mjs';

const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(value));
const secret = () => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));

export async function handleBridgeRelay(env, request, rest, authorize) {
  if (!env.BRIDGE_RELAY) throw new HttpError(503, 'relay_not_configured');
  const [id, role] = rest;
  if (id === 'channels') {
    const auth = await authorize({ via: ['device'] });
    if (auth.space_role !== 'owner' || auth.device_kind !== 'publisher') throw new HttpError(403, 'publisher_owner_required');
    if (!rest[1] && request.method === 'POST') {
      if (!await strictRateLimit(env, 'bridge-relay', clientAddress(request), 10, 60_000)) throw new HttpError(429, 'rate_limited');
      const input = await readJson(request, 4096);
      if (!uuid(input.macId)) throw new HttpError(400, 'invalid_mac_identity');
      const count = await first(env.DB, 'SELECT count(*) AS count FROM bridge_relay_channels WHERE owner_device_id=?1 AND expires_at>?2', auth.device_id, new Date().toISOString());
      if (Number(count?.count) >= 10) throw new HttpError(429, 'relay_channel_limit');
      const id = crypto.randomUUID(), hostToken = secret(), clientToken = secret(), expiresAt = new Date(Date.now() + 365 * 86400_000).toISOString();
      const record = { id, macId: input.macId, ownerDeviceId: auth.device_id, hostHash: await sha256Hex(hostToken), clientHash: await sha256Hex(clientToken), expiresAt };
      await run(env.DB, 'INSERT INTO bridge_relay_channels(id,owner_device_id,mac_id,expires_at) VALUES(?1,?2,?3,?4)', id, auth.device_id, input.macId, expiresAt);
      const object = env.BRIDGE_RELAY.get(env.BRIDGE_RELAY.idFromName(id));
      const initialized = await object.fetch(new Request('https://relay.internal/initialize', { method: 'POST', body: JSON.stringify(record) }));
      if (!initialized.ok) { await run(env.DB, 'DELETE FROM bridge_relay_channels WHERE id=?1', id); throw new HttpError(503, 'relay_initialization_failed'); }
      return json({ id, hostToken, clientToken, expiresAt }, 201);
    }
    if (uuid(rest[1]) && request.method === 'DELETE') {
      const record = await first(env.DB, 'SELECT id FROM bridge_relay_channels WHERE id=?1 AND owner_device_id=?2', rest[1], auth.device_id);
      if (!record) throw new HttpError(404, 'not_found');
      await run(env.DB, 'UPDATE bridge_relay_channels SET expires_at=?1 WHERE id=?2', new Date(0).toISOString(), rest[1]);
      await env.BRIDGE_RELAY.get(env.BRIDGE_RELAY.idFromName(rest[1])).fetch(new Request('https://relay.internal/revoke', { method: 'POST' }));
      return json({ revoked: true });
    }
    throw new HttpError(405, 'method_not_allowed');
  }
  if (!uuid(id) || !['host', 'client'].includes(role) || request.method !== 'GET' || rest.length !== 2 || new URL(request.url).search) throw new HttpError(400, 'invalid_relay_endpoint');
  return env.BRIDGE_RELAY.get(env.BRIDGE_RELAY.idFromName(id)).fetch(request);
}

/** Hibernating ciphertext router: storage contains only routing credentials' hashes. */
export class NodusBridgeRelay {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.record = undefined; this.tail = Promise.resolve();
    ctx.blockConcurrencyWhile(async () => { this.record = await ctx.storage.get('channel'); });
  }
  async active() {
    const record = this.record;
    if (!record || !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= Date.now()) return false;
    const owner = await first(this.env.DB, `SELECT d.expires_at,u.disabled_at,m.role FROM device_tokens d
      JOIN users u ON u.id=d.user_id JOIN memberships m ON m.user_id=d.user_id AND m.space_id=d.space_id
      WHERE d.id=?1 AND d.revoked_at IS NULL`, record.ownerDeviceId);
    return Boolean(owner && !owner.disabled_at && owner.role === 'owner' && (!owner.expires_at || Date.parse(owner.expires_at) > Date.now()));
  }
  sockets() { return this.ctx.getWebSockets(); }
  host() { return this.sockets().find(socket => socket.readyState === 1 && socket.deserializeAttachment()?.role === 'host'); }
  send(socket, frame) { if (socket?.readyState === 1) socket.send(JSON.stringify(frame)); }
  async scheduleValidation() {
    if (!this.record) return;
    const expires=Date.parse(this.record.expiresAt);
    if (!Number.isFinite(expires)) return;
    await this.ctx.storage.setAlarm(Math.max(Date.now()+1,Math.min(expires,Date.now()+30_000)));
  }
  async alarm() {
    if (!await this.active()) {
      for (const socket of this.sockets()) socket.close(1008,'revoked');
      return;
    }
    if (this.sockets().length) await this.scheduleValidation();
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.host === 'relay.internal' && url.pathname === '/initialize' && request.method === 'POST') {
      if (this.record) return json({ error: 'already_initialized' }, 409);
      this.record = await request.json(); await this.ctx.storage.put('channel', this.record); return json({ ready: true });
    }
    if (url.host === 'relay.internal' && url.pathname === '/revoke' && request.method === 'POST') {
      if (this.record) { this.record.expiresAt = new Date(0).toISOString(); await this.ctx.storage.put('channel', this.record); }
      for (const socket of this.sockets()) socket.close(1008, 'revoked'); return json({ revoked: true });
    }
    const match = /^\/api\/v[13]\/bridge-relay\/([^/]+)\/(host|client)$/.exec(url.pathname);
    const token = bearerToken(request);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || url.search || !match || match[1] !== this.record?.id || !token || !await this.active() ||
        !constantTimeEqual(await sha256Hex(token), this.record[match[2] === 'host' ? 'hostHash' : 'clientHash'])) return json({ error: 'invalid_token' }, 401);
    if (this.sockets().length >= 33 && !(match[2]==='host' && this.host())) return json({ error: 'relay_busy' }, 429);
    const role = match[2], clientId = crypto.randomUUID();
    if (role === 'host') this.host()?.close(1008, 'host_replaced');
    const [client, socket] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(socket); socket.serializeAttachment({ role, clientId, epoch: null, window: Date.now(), frames: 0 });
    await this.scheduleValidation();
    if (role === 'client') this.send(socket, { type: 'ready', clientId, hostEpoch: this.host()?.deserializeAttachment()?.epoch ?? null });
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(socket, message) {
    const run = this.tail.then(() => this.message(socket, message));
    this.tail = run.catch(() => { if (socket.readyState === 1) socket.close(1008, 'invalid_frame'); });
    await this.tail;
  }
  async message(socket, message) {
    if (!await this.active()) { for (const peer of this.sockets()) peer.close(1008, 'revoked'); return; }
    if ((typeof message === 'string' ? new TextEncoder().encode(message).length : message.byteLength) > 768 * 1024) { socket.close(1009, 'frame_too_large'); return; }
    const connection = socket.deserializeAttachment();
    if (Date.now() - connection.window > 60_000) { connection.frames = 0; connection.window = Date.now(); }
    if (++connection.frames > 4096) { socket.close(1008, 'rate_limited'); return; }
    socket.serializeAttachment(connection);
    const frame = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    if (connection.role === 'host' && frame.type === 'host' && uuid(frame.epoch)) {
      connection.epoch = frame.epoch; socket.serializeAttachment(connection);
      for (const peer of this.sockets()) { const client = peer.deserializeAttachment(); if (client.role === 'client') this.send(peer, { type: 'ready', clientId: client.clientId, hostEpoch: frame.epoch }); }
      return;
    }
    if (frame.version !== 1 || !uuid(frame.keyId) || !uuid(frame.id) || !uuid(frame.epoch) || !Number.isSafeInteger(frame.sequence) || frame.sequence < 0 || typeof frame.final !== 'boolean' || typeof frame.sealed !== 'string' || frame.sealed.length > 720 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(frame.sealed)) { socket.close(1008, 'invalid_frame'); return; }
    if (connection.role === 'client') {
      const host = this.host(), epoch = host?.deserializeAttachment()?.epoch;
      if (!epoch) this.send(socket, { type: 'offline' });
      else if (frame.epoch === epoch) this.send(host, { ...frame, clientId: connection.clientId });
    } else {
      const client = this.sockets().find(peer => peer.deserializeAttachment()?.clientId === frame.clientId && peer.deserializeAttachment()?.role === 'client');
      if (frame.epoch === connection.epoch) this.send(client, frame);
    }
  }
  webSocketClose(socket, code, reason) {
    socket.close(code, reason);
    if (socket.deserializeAttachment()?.role === 'host' && !this.host()) for (const peer of this.sockets()) if (peer.deserializeAttachment()?.role === 'client') this.send(peer, { type: 'offline' });
  }
  webSocketError(socket) { socket.close(1011, 'relay_disconnected'); }
}
