import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const hash = value => createHash('sha256').update(String(value)).digest('hex');
const equal = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(value));
const unexpired = record => Number.isFinite(Date.parse(record.expiresAt)) && Date.parse(record.expiresAt) > Date.now();

/** Routing only: no vault contents, encryption keys, decrypted requests or publication. */
export class BridgeRelay {
  constructor({ records, save, isOwnerActive, validationIntervalMs = 30_000 }) {
    this.records = records; this.save = save; this.isOwnerActive = isOwnerActive;
    this.sockets = new Map();
    this.websockets = new WebSocketServer({ noServer: true, maxPayload: 768 * 1024, perMessageDeflate: false });
    // Idle connections must lose access too: revocation and expiry do not depend
    // on the next encrypted request arriving from either device.
    this.validationTimer = setInterval(() => {
      for (const [id, connections] of this.sockets) {
        const record = this.records().find(item => item.id === id);
        if (record && unexpired(record) && this.isOwnerActive(record)) continue;
        for (const {ws} of connections.values()) ws.close(1008, 'revoked');
      }
    }, validationIntervalMs);
    this.validationTimer.unref();
  }
  create(ownerDeviceHash, macId) {
    if (!uuid(macId)) throw new Error('invalid_mac_identity');
    if (this.records().filter(r => r.ownerDeviceHash === ownerDeviceHash && unexpired(r)).length >= 10)
      throw new Error('relay_channel_limit');
    const hostToken = randomBytes(32).toString('base64url'), clientToken = randomBytes(32).toString('base64url');
    const record = { id: randomUUID(), macId, ownerDeviceHash, hostHash: hash(hostToken), clientHash: hash(clientToken), expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString() };
    this.records().push(record); this.save();
    return { id: record.id, hostToken, clientToken, expiresAt: record.expiresAt };
  }
  revoke(id, ownerDeviceHash) {
    const record = this.records().find(r => r.id === id && r.ownerDeviceHash === ownerDeviceHash);
    if (!record) return false;
    record.expiresAt = new Date(0).toISOString(); this.save();
    for (const connection of this.sockets.get(id)?.values() ?? []) connection.ws.close(1008, 'revoked');
    return true;
  }
  attach(server) { server.on('upgrade', (request, socket, head) => this.upgrade(request, socket, head)); }
  upgrade(request, socket, head) {
    const fail = code => { socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    let url; try { url = new URL(request.url, 'http://localhost'); } catch { fail(400); return; }
    const match = /^\/api\/v1\/bridge-relay\/([a-f0-9-]+)\/(host|client)$/.exec(url.pathname);
    const record = match && this.records().find(r => r.id === match[1]);
    const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
    if (url.search || !record || !token || !unexpired(record) || !this.isOwnerActive(record) ||
        !equal(record[match[2] === 'host' ? 'hostHash' : 'clientHash'], hash(token))) { fail(401); return; }
    const connections = this.sockets.get(record.id) ?? new Map();
    const replacement = match[2] === 'host' && [...connections.values()].some(item => item.role === 'host');
    if (connections.size >= 33 && !replacement) { fail(429); return; }
    this.websockets.handleUpgrade(request, socket, head, ws => {
      const role = match[2], clientId = randomUUID();
      if (role === 'host') for (const [id, item] of connections) if (item.role === 'host') {
        connections.delete(id); item.ws.close(1008, 'host_replaced');
      }
      const connection = { ws, role, clientId, epoch: null, frames: 0, window: Date.now() };
      connections.set(clientId, connection); this.sockets.set(record.id, connections);
      const send = (target, value) => { if (target.ws.readyState === WebSocket.OPEN) { if (target.ws.bufferedAmount > 16 * 1024 * 1024) target.ws.close(1008, 'slow_receiver'); else target.ws.send(JSON.stringify(value)); } };
      const host = () => [...connections.values()].find(item => item.role === 'host' && item.ws.readyState === WebSocket.OPEN);
      if (role === 'client') send(connection, { type: 'ready', clientId, hostEpoch: host()?.epoch ?? null });
      ws.on('message', bytes => {
        if (!this.isOwnerActive(record) || !unexpired(record)) { ws.close(1008, 'revoked'); return; }
        if (Date.now() - connection.window > 60_000) { connection.frames = 0; connection.window = Date.now(); }
        if (++connection.frames > 4096) { ws.close(1008, 'rate_limited'); return; }
        let frame; try { frame = JSON.parse(bytes.toString()); } catch { ws.close(1008, 'invalid_frame'); return; }
        if (role === 'host' && frame.type === 'host' && uuid(frame.epoch)) {
          connection.epoch = frame.epoch;
          for (const item of connections.values()) if (item.role === 'client') send(item, { type: 'ready', clientId: item.clientId, hostEpoch: frame.epoch });
          return;
        }
        if (frame.version !== 1 || !uuid(frame.keyId) || !Number.isSafeInteger(frame.sequence) || frame.sequence < 0 || typeof frame.final !== 'boolean' || !uuid(frame.id) || !uuid(frame.epoch) || typeof frame.sealed !== 'string' || frame.sealed.length > 720 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(frame.sealed)) { ws.close(1008, 'invalid_frame'); return; }
        if (role === 'client') {
          const target = host();
          if (!target?.epoch) send(connection, { type: 'offline' });
          else if (frame.epoch === target.epoch) send(target, { ...frame, clientId });
        } else {
          const target = connections.get(frame.clientId);
          if (target?.role === 'client' && frame.epoch === connection.epoch) send(target, frame);
        }
      });
      ws.on('close', () => {
        connections.delete(clientId);
        if (role === 'host' && !host()) for (const item of connections.values()) if (item.role === 'client') send(item, { type: 'offline' });
        if (!connections.size) this.sockets.delete(record.id);
      });
      ws.on('error', () => {});
    });
  }
  close() { clearInterval(this.validationTimer); for (const connections of this.sockets.values()) for (const { ws } of connections.values()) ws.terminate(); this.websockets.close(); }
}
