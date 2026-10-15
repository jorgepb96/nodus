import { createHash, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { openRelay, sealRelay, type RelayFrame } from './relayCrypto';

export interface RelayConfiguration { url: string; id: string; hostToken: string; clientToken: string; expiresAt: string; certificatePEM?: string; certificateFingerprint?: string }
export interface RelayHttpRequest { path: string; method: string; headers: Record<string, string>; bodyBase64?: string }
export interface RelayHttpResponse { status: number; headers: Record<string, string>; body: Buffer }
type Forward = (request: RelayHttpRequest) => Promise<RelayHttpResponse>;

/** The Mac initiates this connection. The relay only sees authenticated ciphertext. */
export class DesktopRelayHost {
  private stopped = false;
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  constructor(private configuration: RelayConfiguration, private forward: Forward, private resolveSecret: (keyId: string) => string | undefined, private onState: (state: string) => void = () => {}) {}
  start(): void {
    if (this.stopped || Date.parse(this.configuration.expiresAt) <= Date.now()) return;
    const { configuration } = this;
    const base = new URL(configuration.url);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('relay_requires_https');
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    base.pathname = `/api/v1/bridge-relay/${configuration.id}/host`; base.search = ''; base.hash = '';
    const socket = new WebSocket(base, { headers: { authorization: `Bearer ${configuration.hostToken}` }, maxPayload: 768 * 1024, perMessageDeflate: false, ...(configuration.certificatePEM ? { ca: configuration.certificatePEM, allowPartialTrustChain: true, checkServerIdentity: (_host: string, peer: import('node:tls').PeerCertificate) => {
      if (!peer.raw || createHash('sha256').update(peer.raw).digest('hex') !== configuration.certificateFingerprint) return new Error('relay_certificate_mismatch');
    } } : {}) });
    this.socket = socket;
    const epoch = randomUUID();
    const seen = new Set<string>();
    const assembling = new Map<string, { parts: Buffer[]; size: number; sequence: number; started: number; keyId: string }>();
    let active = 0;
    const send = (frame: RelayFrame) => new Promise<void>((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) { reject(new Error('relay_disconnected')); return; }
      socket.send(JSON.stringify(frame), error => error ? reject(error) : resolve());
    });
    const respond = async (frame: RelayFrame, secret: string, response: RelayHttpResponse) => {
      const chunkBytes = 192 * 1024;
      for (let offset = 0, sequence = 0; offset < response.body.length || sequence === 0; offset += chunkBytes, sequence++) {
        const final = offset + chunkBytes >= response.body.length;
        const payload = Buffer.from(JSON.stringify({ status: response.status, headers: response.headers,
          bodyBase64: response.body.subarray(offset, offset + chunkBytes).toString('base64') }));
        await send(sealRelay(secret, configuration.id, { keyId: frame.keyId, clientId: frame.clientId, epoch, id: frame.id, sequence, final }, 'response', payload));
      }
    };
    socket.on('open', () => { this.attempts = 0; socket.send(JSON.stringify({ type: 'host', epoch })); this.onState('connected'); });
    socket.on('message', bytes => {
      void (async () => {
        const frame = JSON.parse(bytes.toString()) as RelayFrame;
        if (frame.epoch !== epoch || !/^[a-f0-9-]{36}$/i.test(frame.clientId) || !/^[a-f0-9-]{36}$/i.test(frame.id)) return;
        const identity = `${frame.clientId}:${frame.id}`;
        if (seen.has(identity)) return;
        const secret = this.resolveSecret(frame.keyId);
        if (!secret) return;
        const plain = openRelay(secret, configuration.id, frame, 'request');
        for (const [id, request] of assembling) if (Date.now() - request.started > 30_000) { assembling.delete(id); seen.add(id); }
        let request = assembling.get(identity);
        if (!request) {
          if (frame.sequence !== 0 || assembling.size >= 32 || seen.size >= 100_000) return;
          request = { parts: [], size: 0, sequence: 0, started: Date.now(), keyId: frame.keyId }; assembling.set(identity, request);
        }
        if (frame.keyId !== request.keyId || frame.sequence !== request.sequence || request.size + plain.length > 24 * 1024 * 1024) { assembling.delete(identity); seen.add(identity); return; }
        request.parts.push(plain); request.size += plain.length; request.sequence++;
        if (!frame.final) return;
        assembling.delete(identity); seen.add(identity);
        if (active >= 8) { await respond(frame, secret, { status: 429, headers: {}, body: Buffer.from('{"error":"relay_busy"}') }); return; }
        active++;
        try {
          const input = JSON.parse(Buffer.concat(request.parts).toString()) as RelayHttpRequest;
          if (!/^\/bridge\/v[12]\//.test(input.path) || input.path.includes('#') || !['GET', 'HEAD', 'POST', 'DELETE'].includes(input.method)) throw new Error('invalid_relay_request');
          const result = await this.forward(input);
          if (result.body.length > 512 * 1024 * 1024) throw new Error('relay_response_too_large');
          await respond(frame, secret, result);
        } catch (error) {
          await respond(frame, secret, { status: 502, headers: {}, body: Buffer.from(JSON.stringify({ error: error instanceof Error ? error.message : 'relay_forward_failed' })) });
        } finally { active--; }
      })().catch(() => { /* Invalid authenticated envelopes never reach the Bridge. */ });
    });
    socket.on('error', () => this.onState('disconnected'));
    socket.on('close', () => {
      this.onState('disconnected'); assembling.clear();
      if (!this.stopped) { this.retry = setTimeout(() => this.start(), Math.min(60_000, 1_000 * 2 ** Math.min(this.attempts++, 6))); this.retry.unref(); }
    });
  }
  stop(): void { this.stopped = true; if (this.retry) clearTimeout(this.retry); this.socket?.terminate(); }
}
