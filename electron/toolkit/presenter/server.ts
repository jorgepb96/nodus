// PDF Presenter — the mobile-remote server. A tiny http + WebSocket server bound to
// the LAN (0.0.0.0) so a phone can control the presentation, protected by a 6-digit
// PIN. It runs ONLY while presenting (started/stopped by windows.ts). It serves the
// built mobile page + its assets (so pdfjs reaches the phone offline), streams the
// PDF (path-traversal guarded), exposes the presentation notes, and bridges control
// actions between the phones and the app's control hub.
//
// This is the only Nodus server that faces the LAN rather than 127.0.0.1 — every
// request is gated by the PIN gate (createPinGate), and the whole thing is torn down the moment
// the presentation ends.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { PresenterAction, PresenterRuntimeState } from '@shared/presenterState';
import { readLibrary } from './library';
import { contentTypeFor, createPinGate, makePin, safePdfPath, safeStaticPath, type PinGate } from './serverAuth';

const RENDERER_DIST = path.join(__dirname, '../dist');

export interface PresenterServerDeps {
  /** Library dir holding `<id>.pdf` + library.json. */
  libraryDir: () => string;
  /** Current canonical runtime state (for late-joining clients). */
  getState: () => PresenterRuntimeState;
  /** A control action arrived from a phone; route it into the app hub. */
  onRemoteAction: (action: PresenterAction, clientId: number) => void;
  /** System output volume 0–100 (for the phone's volume slider). */
  getVolume: () => Promise<number>;
  setVolume: (volume: number) => Promise<void>;
}

export interface PresenterServerInfo {
  ip: string;
  port: number;
  pin: string;
  url: string;
}

interface Client {
  ws: WebSocket;
  id: number;
}

let server: Server | null = null;
let wss: WebSocketServer | null = null;
let pin: string | null = null;
let gate: PinGate | null = null;
let deps: PresenterServerDeps | null = null;
let nextClientId = 1;
const clients = new Set<Client>();

function getLanIp(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function readPin(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    return url.searchParams.get('pin');
  } catch {
    return null;
  }
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const filePath = safeStaticPath(RENDERER_DIST, req.url ?? '/');
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

/** Anything a LAN client can make throw — a malformed escape, an unparsable Host — runs before
 *  the PIN check; uncaught it left the socket hanging and logged an uncaught exception per
 *  request. It is answered 400 instead. */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  try { handleRequestUnsafe(req, res); }
  catch {
    if (!res.headersSent) res.writeHead(400).end('Bad request');
    else res.destroy();
  }
}

function handleRequestUnsafe(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const remote = req.socket.remoteAddress;

  if (url.pathname.startsWith('/api/')) {
    if (!gate?.admit({ remoteAddress: remote, providedPin: url.searchParams.get('pin'), host: req.headers.host, origin: req.headers.origin })) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (url.pathname === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(deps?.getState() ?? null));
      return;
    }
    if (url.pathname === '/api/volume') {
      const set = url.searchParams.get('set');
      if (set !== null) {
        void (deps?.setVolume(parseInt(set, 10) || 0) ?? Promise.resolve()).then(() =>
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'),
        ).catch(() => res.writeHead(503).end('Volume unavailable'));
        return;
      }
      void (deps?.getVolume() ?? Promise.resolve(50)).then((v) =>
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ volume: v })),
      ).catch(() => res.writeHead(503).end('Volume unavailable'));
      return;
    }
    const pdfMatch = url.pathname.match(/^\/api\/pdf\/([^/]+)$/);
    if (pdfMatch) {
      const file = deps ? safePdfPath(deps.libraryDir(), decodeURIComponent(pdfMatch[1])) : null;
      if (!file || !fs.existsSync(file)) {
        res.writeHead(404).end('PDF not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'public, max-age=31536000, immutable' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    const presMatch = url.pathname.match(/^\/api\/presentation\/([^/]+)$/);
    if (presMatch && deps) {
      const id = decodeURIComponent(presMatch[1]);
      const p = readLibrary(deps.libraryDir()).presentations.find((x) => x.id === id);
      if (!p) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ id: p.id, name: p.name, totalPages: p.totalPages, notes: p.notes, videos: p.videos }),
      );
      return;
    }
    res.writeHead(404).end('Not found');
    return;
  }

  serveStatic(req, res);
}

function currentInfo(): PresenterServerInfo | null {
  if (!server || !pin) return null;
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const ip = getLanIp();
  return { ip, port, pin, url: `http://${ip}:${port}/presenterRemote.html` };
}

export function startPresenterServer(d: PresenterServerDeps): Promise<PresenterServerInfo> {
  stopPresenterServer();
  deps = d;
  pin = makePin();
  gate = createPinGate(pin);
  return new Promise((resolve, reject) => {
    server = createServer(handleRequest);
    server.on('error', reject);
    wss = new WebSocketServer({ server });
    wss.on('connection', (ws, req) => {
      if (!gate?.admit({ remoteAddress: req.socket.remoteAddress, providedPin: readPin(req), host: req.headers.host, origin: req.headers.origin })) {
        ws.close(4001, 'Invalid PIN');
        return;
      }
      const client: Client = { ws, id: nextClientId++ };
      clients.add(client);
      // Prime the new client with the current state so a late join is consistent.
      ws.send(JSON.stringify({ kind: 'state', state: deps?.getState() ?? null }));
      ws.on('message', (raw) => {
        let action: PresenterAction;
        try {
          action = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (action && typeof action.type === 'string') deps?.onRemoteAction(action, client.id);
      });
      ws.on('close', () => clients.delete(client));
      ws.on('error', () => clients.delete(client));
    });
    server.listen(0, '0.0.0.0', () => resolve(currentInfo()!));
  });
}

/** Fan an action out to phone clients (skipping the originating client if any). */
export function broadcastToClients(action: PresenterAction, excludeClientId?: number): void {
  const msg = JSON.stringify({ kind: 'action', action });
  for (const c of clients) {
    if (c.id !== excludeClientId && c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
  }
}

export function getPresenterServerInfo(): PresenterServerInfo | null {
  return currentInfo();
}

export function stopPresenterServer(): void {
  for (const c of clients) {
    try {
      c.ws.close();
    } catch {
      /* ignore */
    }
  }
  clients.clear();
  wss?.close();
  wss = null;
  server?.close();
  server = null;
  pin = null;
  gate = null;
  deps = null;
}
