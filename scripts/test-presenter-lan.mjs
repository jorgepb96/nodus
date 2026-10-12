// Real TLS/native-canvas/PDF checks; also run on Windows/Linux under Electron in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const root = path.resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);
fs.mkdirSync(path.join(root, 'node_modules/.cache'), { recursive: true });
const temp = fs.mkdtempSync(path.join(root, 'node_modules/.cache/presenter-lan-'));
await build({ entryPoints: [path.join(root, 'electron/toolkit/presenter/lan.ts')], outfile: path.join(temp, 'lan.cjs'),
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', alias: { '@shared': path.join(root, 'shared') } });
await build({ entryPoints: [path.join(root, 'shared/presenterState.ts')], outfile: path.join(temp, 'state.cjs'), bundle: true, platform: 'node', format: 'cjs' });
const { LanPresenter, presenterLanHosts, startLanPresenter, getLanPresenterInfo, stopLanPresenter } = require(path.join(temp, 'lan.cjs'));
const { beginPresentation, presenterReducer } = require(path.join(temp, 'state.cjs'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

class Client {
  messages = []; waiters = []; buffer = Buffer.alloc(0);
  constructor(socket) {
    this.socket = socket;
    socket.on('error', () => {});
    socket.on('data', bytes => {
      this.buffer = Buffer.concat([this.buffer, bytes]);
      while (this.buffer.length >= 4 && this.buffer.length >= this.buffer.readUInt32BE() + 4) {
        const length = this.buffer.readUInt32BE(), message = JSON.parse(this.buffer.subarray(4, 4 + length));
        this.buffer = this.buffer.subarray(4 + length); this.messages.push(message);
        for (const check of [...this.waiters]) check();
      }
    });
  }
  static async open(info, channel = 'control', key) {
    const params = new URL(info.url).searchParams;
    const socket = tls.connect({ host: '127.0.0.1', port: Number(params.get('port')), minVersion: 'TLSv1.3', rejectUnauthorized: false });
    const client = new Client(socket);
    await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); });
    assert.equal(socket.getProtocol(), 'TLSv1.3');
    assert.equal(socket.getPeerCertificate().fingerprint256.replace(/:/g, '').toLowerCase(), params.get('fingerprint'));
    client.send({ kind: 'hello', version: 1, channel, deviceId: crypto.randomUUID(), key: key ?? params.get('key') });
    return client;
  }
  send(message) {
    const data = Buffer.from(JSON.stringify(message)), prefix = Buffer.alloc(4); prefix.writeUInt32BE(data.length);
    this.socket.write(Buffer.concat([prefix, data]));
  }
  next(predicate, timeout = 10000) {
    // Capture the waiting call site before entering the timer callback.
    const deadlineError = new Error('Message deadline exceeded');
    return new Promise((resolve, reject) => {
      let timer;
      const check = () => {
        const index = this.messages.findIndex(predicate);
        if (index < 0) return;
        clearTimeout(timer); this.waiters = this.waiters.filter(fn => fn !== check); resolve(this.messages.splice(index, 1)[0]);
      };
      timer = setTimeout(() => {
        this.waiters = this.waiters.filter(fn => fn !== check);
        deadlineError.message += ` (queued kinds: ${this.messages.map(message => message.kind).join(', ') || 'none'}; socket closed: ${this.socket.destroyed})`;
        reject(deadlineError);
      }, timeout);
      this.waiters.push(check); check();
    });
  }
  close() { this.socket.destroy(); }
}

async function fixture() {
  const dir = fs.mkdtempSync(path.join(temp, 'deck-'));
  const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) document.addPage([960, 540]).drawText(`Nodus slide ${i}`, { x: 60, y: 350, size: 48, font });
  const bytes = Buffer.from(await document.save()); fs.writeFileSync(path.join(dir, 'fixture.pdf'), bytes);
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ version: 1, folders: [], presentations: [{ id: 'fixture', name: 'Native LAN fixture', fileName: 'fixture.pdf', createdAt: new Date().toISOString(), totalPages: 3, notes: { '1': 'Presenter notes' }, videos: { '2': { url: 'https://youtu.be/aqz-KE-bpKQ', x: 0, y: 0, w: 100, h: 100 } } }] }));
  let state = beginPresentation('fixture', 1, 3), volume = 50, count = 0;
  const server = new LanPresenter({ libraryDir: () => dir, getState: () => state,
    onAction: (action, origin) => { count++; state = presenterReducer(state, action); server.broadcast(action, origin); },
    getVolume: () => volume, setVolume: value => { volume = value; } });
  await server.start('127.0.0.1');
  return { server, info: server.info(['127.0.0.1']), file: path.join(dir, 'fixture.pdf'), bytes, get count() { return count; } };
}

test('LAN QR rotates credentials and Mac never starts the additional listener', async () => {
  if (process.platform === 'darwin') {
    await startLanPresenter({}); assert.equal(getLanPresenterInfo(), null); stopLanPresenter();
  }
  const f = await fixture(), g = await fixture();
  try {
    const a = new URL(f.info.url).searchParams, b = new URL(g.info.url).searchParams;
    assert.equal(a.get('version'), '2'); assert.equal(a.get('transport'), 'lan');
    assert.equal(Buffer.from(a.get('key'), 'base64').length, 32);
    for (const field of ['service', 'key', 'fingerprint']) assert.notEqual(a.get(field), b.get(field));
    assert.ok(!f.info.url.includes('pin='));
  } finally { f.server.stop(); g.server.stop(); }
});

test('native controls, authoritative snapshots, overlays, volume and reconnect share the protocol', async () => {
  const f = await fixture(); let client, late;
  try {
    client = await Client.open(f.info);
    const snapshot = await client.next(m => m.kind === 'update');
    assert.equal(snapshot.deck.notes['1'], 'Presenter notes'); assert.ok(snapshot.deck.videos['2']);
    const commandId = crypto.randomUUID();
    client.send({ kind: 'action', commandId, action: { type: 'next' } });
    assert.equal((await client.next(m => m.action?.type === 'next')).state.currentSlide, 2);
    client.send({ kind: 'action', commandId, action: { type: 'next' } });
    client.send({ kind: 'action', commandId: crypto.randomUUID(), action: { type: 'setTotal', total: 999 } });
    for (const action of [
      { type: 'setTool', tool: 'pointer' }, { type: 'setToolColor', color: '#22c55e' },
      { type: 'blackScreen', enabled: true }, { type: 'slideZoom', data: { scale: 2, originX: 30, originY: 40 } },
      { type: 'videoToggle' }, { type: 'timerToggle' }, { type: 'timerReset' },
      { type: 'toolData', data: { tool: 'draw', x: 10, y: 20, action: 'start', color: '#22c55e', lineWidth: 4 } },
      { type: 'toolData', data: { tool: 'draw', x: 20, y: 30, action: 'move', color: '#22c55e', lineWidth: 4 } },
    ]) {
      client.send({ kind: 'action', commandId: crypto.randomUUID(), action });
      const update = await client.next(m => m.action?.type === action.type);
      assert.equal(update.state.currentSlide, 2); assert.equal(update.state.totalSlides, 3);
    }
    assert.equal(f.count, 10);
    client.send({ kind: 'volume', value: 27 }); assert.equal((await client.next(m => m.kind === 'volume' && m.value === 27)).value, 27);
    client.send({ kind: 'ping' }); await client.next(m => m.kind === 'pong');
    client.close(); late = await Client.open(f.info);
    const resumed = await late.next(m => m.kind === 'update');
    assert.equal(resumed.state.toolColor, '#22c55e'); assert.equal(resumed.state.blackScreen, true);
    assert.equal(resumed.overlay.length, 2); assert.equal(resumed.state.videoPlaying, true);
    assert.equal((await late.next(m => m.kind === 'volume')).value, 27);
    f.server.stop(); await late.next(m => m.kind === 'ended');
  } finally { client?.close(); late?.close(); f.server.stop(); }
});

test('wrong pairing key and oversized frames cannot send commands', async () => {
  const f = await fixture(); let wrong, oversized;
  try {
    wrong = await Client.open(f.info, 'control', crypto.randomBytes(32).toString('base64'));
    await new Promise(resolve => wrong.socket.once('close', resolve));
    assert.equal(f.count, 0);
    oversized = await Client.open(f.info); await oversized.next(m => m.kind === 'update');
    const closed = new Promise(resolve => oversized.socket.once('close', resolve));
    oversized.socket.write(Buffer.from([0x7f, 0xff, 0xff, 0xff])); await closed;
    assert.equal(f.count, 0);
  } finally { wrong?.close(); oversized?.close(); f.server.stop(); }
});

test('JPEG preview, complete PDF/hash, resumed transfer and asset guards work in the Electron runtime', async () => {
  const f = await fixture(); let control, assets;
  try {
    control = await Client.open(f.info); const { deck } = await control.next(m => m.kind === 'update');
    assets = await Client.open(f.info, 'assets');
    const version = deck.assetVersion;
    assets.send({ kind: 'image', page: 1, width: 1280, assetVersion: version });
    const image = Buffer.from((await assets.next(m => m.kind === 'image')).data, 'base64');
    assert.deepEqual([...image.subarray(0, 2)], [0xff, 0xd8]); assert.ok(image.length > 2000);
    for (const start of [0, Math.floor(f.bytes.length / 2)]) {
      assets.send({ kind: 'pdf', offset: start, assetVersion: version });
      const begin = await assets.next(m => m.kind === 'pdfBegin'); assert.equal(begin.offset, start); assert.equal(begin.size, f.bytes.length);
      let offset = start; const chunks = [];
      while (offset < f.bytes.length) {
        const chunk = await assets.next(m => m.kind === 'pdfChunk'); assert.equal(chunk.offset, offset);
        const bytes = Buffer.from(chunk.data, 'base64'); chunks.push(bytes); offset += bytes.length;
      }
      const end = await assets.next(m => m.kind === 'pdfEnd');
      assert.equal(end.sha256, crypto.createHash('sha256').update(f.bytes).digest('hex'));
      assert.deepEqual(Buffer.concat(chunks), f.bytes.subarray(start));
    }
    for (const request of [{ kind: 'pdf', offset: -1, assetVersion: version }, { kind: 'image', page: 999, assetVersion: version }, { kind: 'pdf', offset: 0, assetVersion: 'old-session' }]) {
      assets.send(request); await assets.next(m => m.kind === 'assetError');
    }
    assets.send({ kind: 'action', commandId: crypto.randomUUID(), action: { type: 'next' }, assetVersion: version });
    assets.send({ kind: 'ping' }); await assets.next(m => m.kind === 'pong'); assert.equal(f.count, 0);
  } finally { control?.close(); assets?.close(); f.server.stop(); }
});

test('QR addresses prefer physical interfaces over VPNs and exclude loopback/link-local', () => {
  const value = address => ({ address, family: 'IPv4', internal: false });
  assert.deepEqual(presenterLanHosts({ utun0: [value('10.2.3.4')], en0: [value('192.168.1.3')], lo: [{ ...value('127.0.0.1'), internal: true }], eth0: [value('169.254.1.2')] }), ['192.168.1.3', '10.2.3.4']);
});

test('PDF completion waits for file cleanup and accepts an immediate resumed transfer', async () => {
  const f = await fixture(); let control, assets;
  const open = fs.promises.open;
  let releaseClose, closeStarted;
  const closing = new Promise(resolve => { closeStarted = resolve; });
  const closeGate = new Promise(resolve => { releaseClose = resolve; });
  let delayClose = true;
  fs.promises.open = async (...args) => {
    const file = await open(...args);
    if (args[0] === f.file && delayClose) {
      delayClose = false;
      const close = file.close.bind(file);
      file.close = async () => { closeStarted(); await closeGate; return close(); };
    }
    return file;
  };
  try {
    control = await Client.open(f.info);
    const { deck } = await control.next(m => m.kind === 'update');
    assets = await Client.open(f.info, 'assets');
    assets.send({ kind: 'pdf', offset: 0, assetVersion: deck.assetVersion });
    await assets.next(m => m.kind === 'pdfBegin');
    let transferred = 0;
    while (transferred < f.bytes.length) {
      const chunk = await assets.next(m => m.kind === 'pdfChunk');
      transferred += Buffer.from(chunk.data, 'base64').length;
    }
    await closing;
    // A pong on the same socket proves all earlier frames reached the client.
    assets.send({ kind: 'ping' }); await assets.next(m => m.kind === 'pong');
    assert.equal(assets.messages.some(m => m.kind === 'pdfEnd'), false, 'pdfEnd must mean the server is ready for another transfer');
    releaseClose();
    await assets.next(m => m.kind === 'pdfEnd');
    const offset = Math.floor(f.bytes.length / 2);
    assets.send({ kind: 'pdf', offset, assetVersion: deck.assetVersion });
    assert.equal((await assets.next(m => m.kind === 'pdfBegin')).offset, offset);
    const chunks = [];
    let received = 0;
    while (offset + received < f.bytes.length) {
      const chunk = await assets.next(m => m.kind === 'pdfChunk'); chunks.push(chunk);
      received += Buffer.from(chunk.data, 'base64').length;
    }
    assert.deepEqual(Buffer.concat(chunks.map(chunk => Buffer.from(chunk.data, 'base64'))), f.bytes.subarray(offset));
    assert.equal((await assets.next(m => m.kind === 'pdfEnd')).sha256, crypto.createHash('sha256').update(f.bytes).digest('hex'));
  } finally {
    releaseClose(); fs.promises.open = open;
    control?.close(); assets?.close(); f.server.stop();
  }
});
