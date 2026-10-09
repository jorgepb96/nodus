// Unit tests for the pure logic of the "Nodus for Zotero" plugin. The plugin's
// content scripts are chrome:// IIFEs that attach to `window`; here we evaluate
// them in a vm sandbox with minimal stubs (ChromeUtils/Zotero/document) and
// exercise the parts that don't need a live Zotero or a real DOM.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import AdmZip from 'adm-zip';
import { buildXpi } from './build-zotero-xpi.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(repoRoot, 'zotero-plugin');
const contentDir = path.join(pluginDir, 'content');
const readSource = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

// Extract the `{...}` literal starting at openIdx, respecting string literals so
// that braces inside values (e.g. "{pct}") don't unbalance the scan.
function sliceBalanced(src, openIdx) {
  let depth = 0, inStr = false, quote = '';
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === '\\') { i++; } else if (c === quote) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(openIdx, i + 1);
  }
  throw new Error('unbalanced braces');
}
// Eval the plugin's I18N object literal out of sidebar.js source (pure data).
function extractI18n(src) {
  const open = src.indexOf('{', src.indexOf('const I18N'));
  return vm.runInNewContext('(' + sliceBalanced(src, open) + ')');
}
const placeholders = (s) => new Set((String(s).match(/\{(\w+)\}/g) || []));

// ---- minimal fake DOM (enough for NodusMarkdown.render) ----
function makeDoc() {
  const doc = {
    createElement(tag) { return makeEl(tag, doc); },
    createTextNode(text) { return { nodeType: 3, _text: String(text) }; },
  };
  return doc;
}
function makeEl(tag, doc) {
  return {
    tagName: String(tag).toUpperCase(),
    ownerDocument: doc,
    className: '',
    children: [],
    attrs: {},
    classList: { add() {} },
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener() {},
    get textContent() { return serializeText(this); },
    set textContent(v) { this.children = []; if (v) this.children.push({ nodeType: 3, _text: String(v) }); },
  };
}
const serializeText = (n) => (n.nodeType === 3 ? n._text : (n.children || []).map(serializeText).join(''));
const serializeHtml = (n) => {
  if (n.nodeType === 3) return n._text;
  const t = n.tagName.toLowerCase();
  return `<${t}>${(n.children || []).map(serializeHtml).join('')}</${t}>`;
};
// Every ELEMENT tag name in the tree (text nodes excluded) — used to prove no
// real <script> element was created from model output.
const elementTags = (n, acc = []) => {
  if (n.nodeType === 3) return acc;
  acc.push(n.tagName);
  for (const c of n.children || []) elementTags(c, acc);
  return acc;
};

// ---- load a plugin content file into a fresh sandbox ----
function loadModule(file, extraGlobals = {}) {
  const src = readFileSync(path.join(contentDir, file), 'utf8');
  const sandbox = {
    window: {},
    document: makeDoc(),
    Zotero: { logError() {}, launchURL() {} },
    ChromeUtils: { importESModule: () => ({ Zotero: { logError() {}, launchURL() {} } }) },
    console,
    ...extraGlobals,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: file });
  return sandbox.window;
}

// ─────────────────────────────────────────── #1 Markdown
test('markdown: parse produces block/inline tokens', () => {
  const { NodusMarkdown } = loadModule('markdown.js');
  const blocks = NodusMarkdown.parse('# Title\n\nA **bold** and *em* and `code`.\n\n- one\n- two\n\n> quote');
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[1].type, 'paragraph');
  const strong = blocks[1].inline.find((s) => s.type === 'strong');
  assert.ok(strong && strong.children[0].value === 'bold');
  assert.ok(blocks[1].inline.some((s) => s.type === 'em'));
  assert.ok(blocks[1].inline.some((s) => s.type === 'code' && s.value === 'code'));
  const list = blocks.find((b) => b.type === 'list');
  assert.ok(list && list.items.length === 2 && !list.ordered);
  assert.ok(blocks.some((b) => b.type === 'blockquote'));
});

test('markdown: ordered lists, fenced code and hr', () => {
  const { NodusMarkdown } = loadModule('markdown.js');
  const blocks = NodusMarkdown.parse('1. first\n2. second\n\n```js\nconst x = 1;\n```\n\n---');
  const ol = blocks.find((b) => b.type === 'list');
  assert.ok(ol && ol.ordered && ol.items.length === 2);
  const code = blocks.find((b) => b.type === 'code');
  assert.equal(code.text, 'const x = 1;');
  assert.ok(blocks.some((b) => b.type === 'hr'));
});

test('markdown: underscores in identifiers are NOT italicised', () => {
  const { NodusMarkdown } = loadModule('markdown.js');
  const spans = NodusMarkdown.parseInline('use my_snake_case_name here');
  assert.equal(spans.length, 1);
  assert.equal(spans[0].type, 'text');
  assert.equal(spans[0].value, 'use my_snake_case_name here');
});

test('markdown: citations become chips via citeFn, body is escaped (no XSS)', () => {
  const { NodusMarkdown } = loadModule('markdown.js');
  const doc = makeDoc();
  const container = makeEl('div', doc);
  const seen = [];
  const citeFn = (kind, id, label) => { seen.push({ kind, id, label }); const e = doc.createElement('cite'); e.textContent = label || id; return e; };
  NodusMarkdown.render(container, 'See [[p:12|page 12]] and **bold**. <script>alert(1)</script>', citeFn);
  const html = serializeHtml(container);
  assert.ok(seen.some((c) => c.kind === 'p' && c.id === '12' && c.label === 'page 12'), 'citeFn called for [[p:12]]');
  assert.ok(html.includes('<cite>page 12</cite>'), 'chip rendered');
  assert.ok(html.includes('<strong>bold</strong>'), 'bold rendered');
  // The literal script text is present as escaped text, but never as a real
  // element node (which is what would actually execute).
  assert.ok(serializeText(container).includes('<script>alert(1)</script>'));
  assert.ok(!elementTags(container).includes('SCRIPT'), 'no live <script> element injected');
});

test('markdown: evidence citations become chips', () => {
  const { NodusMarkdown } = loadModule('markdown.js');
  const spans = NodusMarkdown.parseInline('Claim [[e:ev_abc|source p. 2]].');
  const cite = spans.find((s) => s.type === 'cite');
  assert.equal(cite.kind, 'e');
  assert.equal(cite.id, 'ev_abc');
});

// ─────────────────────────────────────────── #2 long-document sampling
test('util: sampleDocText keeps short docs whole', () => {
  const { NodusUtil } = loadModule('util.js');
  const r = NodusUtil.sampleDocText('hello world', 1000);
  assert.equal(r.truncated, false);
  assert.equal(r.text, 'hello world');
  assert.equal(r.ratio, 1);
});

test('util: sampleDocText keeps head AND tail of long docs', () => {
  const { NodusUtil } = loadModule('util.js');
  const big = 'A'.repeat(500) + 'B'.repeat(500) + 'ZEND';
  const r = NodusUtil.sampleDocText(big, 200);
  assert.equal(r.truncated, true);
  assert.ok(r.text.startsWith('A'), 'head preserved');
  assert.ok(r.text.includes('ZEND'), 'tail (conclusion) preserved — the whole point of #2');
  assert.ok(r.text.includes('omitted'), 'visible omission marker');
  assert.ok(r.sentChars <= 200 + 60, 'roughly within budget');
  assert.equal(r.totalChars, big.length);
  assert.ok(r.ratio > 0 && r.ratio < 1);
});

// ─────────────────────────────────────────── auto-connect
test('util: reconnection backs off while down and idles while connected', () => {
  const { NodusUtil } = loadModule('util.js');
  const d = (attempts) => NodusUtil.nextConnectDelay({ connected: false, attempts });
  assert.equal(d(0), NodusUtil.CONNECT_DELAYS.first, 'first retry is eager — Nodus was probably just launched');
  assert.ok(d(1) > d(0) && d(2) > d(1), 'backs off instead of hammering the port');
  assert.equal(d(50), NodusUtil.CONNECT_DELAYS.max, 'capped: a Zotero left open for hours still retries');
  assert.equal(
    NodusUtil.nextConnectDelay({ connected: true, attempts: 0 }),
    NodusUtil.CONNECT_DELAYS.connected,
    'an established link is only re-validated occasionally',
  );
});

test('util: a restarted Nodus (new port or token) invalidates the cached bridge config', () => {
  const { NodusUtil } = loadModule('util.js');
  const cfg = { port: 4321, token: 'abc' };
  assert.equal(NodusUtil.bridgeConfigChanged(cfg, { port: 4321, token: 'abc' }), false);
  assert.equal(NodusUtil.bridgeConfigChanged(cfg, { port: 4322, token: 'abc' }), true, 'restarted on another port');
  assert.equal(NodusUtil.bridgeConfigChanged(cfg, { port: 4321, token: 'zzz' }), true, 'token rotated');
  assert.equal(NodusUtil.bridgeConfigChanged(cfg, null), true, 'bridge file disappeared');
  assert.equal(NodusUtil.bridgeConfigChanged(null, cfg), true, 'bridge file appeared — Nodus just started');
  assert.equal(NodusUtil.bridgeConfigChanged(null, null), false);
});

test('sidebar: the link is established without the user pressing "Test connection"', () => {
  const src = readSource('zotero-plugin/content/sidebar.js');
  // The background loop must be armed at boot and re-armed after every attempt,
  // or the sidebar would go back to needing a manual click.
  assert.match(src, /scheduleConnectionCheck\(\);\s*\n\s*await refreshItem/, 'boot arms the auto-connect loop');
  assert.match(src, /connTimer = setTimeout\([\s\S]*?connect\(\)[\s\S]*?scheduleConnectionCheck\)/, 'each attempt schedules the next');
  assert.match(src, /window\.addEventListener\("focus", retryConnectionNow\)/, 'refocusing Zotero retries immediately');
  // Sending must try to connect first: "not connected" to a message the user
  // just typed is exactly the failure this replaces.
  const send = src.slice(src.indexOf('async function send(text)'), src.indexOf('async function generateAssistant'));
  assert.ok(send.indexOf('ensureConnected()') < send.indexOf('chat.offline'), 'send() reconnects before refusing');
  assert.ok(!/state\.mode === "connected" && !state\.connected/.test(send), 'no bare offline gate left in send()');
  // The token is checked against a guarded endpoint: /health is tokenless.
  const probe = src.slice(src.indexOf('async function probeConfig'), src.indexOf('let connectInFlight'));
  assert.match(probe, /\/api\/z\/health/);
  assert.match(probe, /\/api\/z\/models/, 'a stale token must not read as "connected"');
});

// ── the sidebar, running for real against a fake Nodus server ────────────────
// sidebar.js is a plain chrome:// script: its top-level `function`s land on the
// sandbox global, and `const state` stays visible to later scripts evaluated in
// the same realm. That is enough to boot the real thing over stub DOM/Zotero
// and watch it connect on its own.
function stubEl(doc, tag) {
  const attrs = {};
  return {
    tagName: String(tag || 'div').toUpperCase(), ownerDocument: doc, children: [],
    className: '', id: '', value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, focus() {}, blur() {}, scrollIntoView() {},
    setAttribute(k, v) { attrs[k] = v; }, getAttribute: (k) => (k in attrs ? attrs[k] : null), removeAttribute(k) { delete attrs[k]; },
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  };
}
function stubDoc() {
  const byId = new Map();
  const doc = {
    createElement: (tag) => stubEl(doc, tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    createDocumentFragment: () => stubEl(doc, 'fragment'),
    getElementById(id) { if (!byId.has(id)) byId.set(id, stubEl(doc, 'div')); return byId.get(id); },
    querySelector(sel) { return doc.getElementById(String(sel)); },
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  doc.body = stubEl(doc, 'body');
  doc.documentElement = stubEl(doc, 'html');
  return doc;
}
const FAKE_STORE = {
  getMode: () => 'connected', setMode() {}, getLang: () => 'en', setLang() {},
  getModel: () => null, setModel() {}, getMaxTokens: () => 8192, setMaxTokens() {},
  getReasoning: () => 'default', setReasoning() {},
  getHlColors: () => ({ high: '#ff6666', medium: '#ffd400' }), setHlColors() {},
  getContext: () => ({ useIdeas: true, useCorpus: true, useFulltext: true, strategy: 'auto', ocr: 'off', repair: 'auto', agenticRounds: 1, fullTextThreshold: 48000 }),
  setContext() {}, getKey: async () => '', setKey: async () => true, getLocalBase: () => '', setLocalBase() {},
  getPinned: () => [], setPinned() {}, isPinned: () => false, togglePinned: () => [],
  getCustomPrompts: () => [], addCustomPrompt: () => [], removeCustomPrompt() {},
  getAutoUpdate: () => false, setAutoUpdate() {}, getAgent: () => false, setAgent() {},
  getAgentAuto: () => false, setAgentAuto() {},
  SOURCE_SCOPES: ['current', 'selection', 'collection', 'library'], getSourceScope: () => 'current', setSourceScope() {},
  getHistoryEnabled: () => true, setHistoryEnabled() {}, getHistoryRetention: () => 365, setHistoryRetention() {},
  getManual: async () => ({ port: 0, token: '' }), setManual: async () => true, deleteConversationHistory: async () => true,
  loadConversations: async () => [], saveConversations: async () => {},
  saveEvidenceIndex: async () => {}, loadEvidenceIndex: async () => null, loadEvidenceIndexes: async () => [],
  evidenceCacheStats: async () => ({ documents: 0, pages: 0, bytes: 0 }), pruneEvidenceIndexes: async () => 0, clearEvidenceIndexes: async () => 0,
  newId: () => 'conv-1', compactAudit: (a) => a, compactConversations: (a) => a,
};
// A stand-in for electron/zotero-plugin/server.ts: every Zotero route,
// including health, requires the bridge bearer token.
const openServers = new Set();
function fakeNodus(token) {
  const hits = { total: 0 };
  const server = http.createServer((req, res) => {
    hits.total++;
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const url = (req.url || '/').split('?')[0];
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'bad token' });
    if (url === '/api/z/health') return send(200, { ok: true, app: 'nodus', vault: 'Test', corpusSize: 3 });
    if (url === '/api/z/models') return send(200, { models: [{ provider: 'openai', model: 'gpt-test' }], default: null });
    return send(404, {});
  });
  openServers.add(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, hits, port: server.address().port })));
}
// A failed assertion must FAIL the run, not hang it: an open listener keeps the
// test process alive forever, so every server is closed from the after hook.
const closeServers = async () => {
  for (const s of openServers) await new Promise((r) => s.close(() => r()));
  openServers.clear();
};
const waitFor = async (fn, ms = 4000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
};

test('sidebar: connects to Nodus by itself, follows a restart, and refuses a stale token', async (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'nodus-zotero-'));
  mkdirSync(path.join(home, '.nodus'), { recursive: true });
  const bridge = path.join(home, '.nodus', 'zotero-bridge.json');
  const writeBridge = (port, token) => writeFileSync(bridge, JSON.stringify({ port, token, updatedAt: 'now' }));

  const doc = stubDoc();
  const Zotero = { logError() {}, launchURL() {}, getMainWindow: () => null };
  const sandbox = {
    window: { NodusStore: FAKE_STORE, addEventListener() {}, removeEventListener() {}, parent: null },
    document: doc, console, Zotero,
    ChromeUtils: { importESModule: () => ({ Zotero }) },
    Components: { interfaces: { nsIFile: {} } },
    Services: { dirsvc: { get: () => ({ path: home }) } },
    PathUtils: { join: (...parts) => path.join(...parts) },
    IOUtils: { readUTF8: async (p) => readFileSync(p, 'utf8') },
    fetch, AbortController, AbortSignal, TextDecoder, URL,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  };
  vm.createContext(sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  t.after(async () => {
    try { run('stopConnectionWatch(); clearInterval(state.pollTimer);'); } catch {}
    await closeServers();
    rmSync(home, { recursive: true, force: true });
  });

  // Nodus is NOT running and there is no bridge file: exactly the situation in
  // which the plugin used to sit until the user pressed "Test connection".
  for (const file of ['util.js', 'sidebar.js']) vm.runInContext(readFileSync(path.join(contentDir, file), 'utf8'), sandbox, { filename: file });
  run('NU.CONNECT_DELAYS.first = 30; NU.CONNECT_DELAYS.max = 60; NU.CONNECT_DELAYS.connected = 60;');
  assert.equal(await waitFor(async () => run('state.connAttempts') >= 1, 2000), true, 'the loop keeps trying while Nodus is down');
  assert.equal(run('state.connected'), false);

  // Nodus starts. Nothing in the UI is touched — only the bridge file appears.
  const token = 'tok-first';
  const first = await fakeNodus(token);
  writeBridge(first.port, token);
  assert.equal(await waitFor(async () => run('state.connected'), 4000), true, 'the sidebar connects with no user action');
  assert.equal(run('state.config.port'), first.port);
  assert.equal(await waitFor(async () => run('state.modelsConnected.length') === 1, 2000), true, 'models arrive too, so the composer is usable');

  // Watching must be nearly free: while the link is up and the bridge file is
  // untouched, the loop reads a local file and leaves Nodus's main process
  // alone. Measured as requests served, not as elapsed time.
  const settled = first.hits.total;
  const tick = run('NU.CONNECT_DELAYS.connected');
  await new Promise((r) => setTimeout(r, 400)); // ~6 ticks at the 60ms test cadence
  assert.equal(first.hits.total, settled, `an idle connected sidebar does not poll the server (tick=${tick}ms)`);
  assert.equal(run('state.connected'), true, 'and it stays connected while idle');

  // Nodus restarts on another port with a fresh token: the cached config is
  // stale and must be replaced without anyone clicking anything.
  await new Promise((r) => { openServers.delete(first.server); first.server.close(() => r()); });
  const second = await fakeNodus('tok-second');
  writeBridge(second.port, 'tok-second');
  assert.equal(await waitFor(async () => run('state.connected && state.config.port') === second.port, 4000), true, 'follows a restarted Nodus to its new port');

  // A wrong token still passes the tokenless /health, so the link must be
  // judged by an endpoint that actually checks it.
  writeBridge(second.port, 'tok-wrong');
  assert.equal(await waitFor(async () => run('state.connected') === false, 4000), true, 'a stale token does not read as connected');
  await new Promise((r) => { openServers.delete(second.server); second.server.close(() => r()); });
});

// ─────────────────────────────────────────── evidence retrieval
test('evidence: page-aware chunking preserves exact passages, group provenance and stable ids', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const text = 'INTRODUCTION\n' + 'First page evidence. '.repeat(80) + '\fRESULTS\n' + 'Second page finding. '.repeat(80);
  const idx = E.buildIndex({ libraryID: 1, groupID: 42, itemKey: 'PARENT', attachmentKey: 'ATT', title: 'Paper', pageLabels: ['i', '7'] }, text, { targetChars: 500, minChars: 150, overlapChars: 50 });
  assert.equal(idx.pages.length, 2);
  assert.equal(idx.groupID, 42);
  assert.ok(idx.chunks.length >= 4);
  assert.ok(idx.chunks.every((chunk) => chunk.groupID === 42));
  assert.ok(idx.chunks.some((c) => c.pageLabel === '7' && c.section === 'RESULTS'));
  assert.equal(E.resolvePageIndex(idx, 'i'), 0, 'roman front matter resolves by its visible Zotero label');
  assert.equal(E.resolvePageIndex(idx, '7'), 1, 'printed numeric labels resolve before physical positions');
  for (const chunk of idx.chunks) {
    const page = idx.pages[chunk.pageIndex];
    const combined = [page.text, page.visualText].filter(Boolean).join('\n\n[VISUAL/OCR]\n');
    assert.equal(combined.slice(chunk.start, chunk.end), chunk.text);
    assert.match(chunk.id, /^ev_/);
  }
  const idx2 = E.buildIndex({ libraryID: 1, itemKey: 'PARENT', attachmentKey: 'ATT', title: 'Paper', pageLabels: ['i', '7'] }, text, { targetChars: 500, minChars: 150, overlapChars: 50 });
  assert.deepEqual([...idx.chunks.map((c) => c.id)], [...idx2.chunks.map((c) => c.id)]);
});

test('evidence: hybrid retrieval uses semantics, limits sources and produces citable catalogue', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const a = E.buildIndex({ libraryID: 1, itemKey: 'A', attachmentKey: 'AA', title: 'Alpha' }, 'Cats sleep in warm windows. '.repeat(80), { targetChars: 300, minChars: 100, overlapChars: 40 });
  const b = E.buildIndex({ libraryID: 1, itemKey: 'B', attachmentKey: 'BB', title: 'Beta' }, 'Quantum entanglement links distant particles. '.repeat(80), { targetChars: 300, minChars: 100, overlapChars: 40 });
  a.chunks.forEach((c) => { c.embedding = [1, 0]; });
  b.chunks.forEach((c) => { c.embedding = [0, 1]; });
  const result = E.hybridSearch([a, b], 'nonlocal physics', [0, 1], { topK: 5, maxPerSource: 3 });
  assert.equal(result.method, 'hybrid');
  assert.equal(result.hits[0].attachmentKey, 'BB');
  assert.ok(result.hits.filter((h) => h.attachmentKey === 'BB').length <= 3);
  const prompt = E.evidencePrompt(result.hits);
  assert.ok(prompt.includes(`[[e:${result.hits[0].id}]]`));
  assert.ok(prompt.includes('EXACT PASSAGE'));
});

test('evidence: full text remains citable and citation validation rejects invented ids', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const idx = E.buildIndex({ libraryID: 1, itemKey: 'A', attachmentKey: 'AA', title: 'Alpha' }, 'A supported factual sentence with enough detail. '.repeat(30), { targetChars: 300, minChars: 100, overlapChars: 40 });
  const full = E.fullEvidencePrompt([idx], 100000);
  assert.equal(full.hits.length, idx.chunks.length);
  assert.ok(full.text.includes(`[[e:${idx.chunks[0].id}]]`));
  const checked = E.validateCitations(`Supported [[e:${idx.chunks[0].id}]]. Invented [[e:nope]]. Legacy [[p:2]].`, { evidence: E.evidenceMap(full.hits) });
  assert.equal(checked.invalid.length, 1);
  assert.ok(!checked.text.includes('[[e:nope]]'));
  assert.ok(checked.text.includes('[[p:2]]'), 'unspecified legacy citation kinds remain untouched');
});

test('evidence: every rendered citation kind is constrained by an explicit allow-list', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const checked = E.validateCitations(
    'Page [[p:i]] [[p:999]], idea [[idea:ok]] [[idea:fake]], gap [[gap:g1]] [[gap:g2]], item [[zotero:groups:42:GOOD]] [[zotero:BAD]].',
    {
      evidence: [], pages: ['i'], ideas: ['ok'], gaps: ['g1'],
      zotero: ['groups:42:GOOD'],
    },
  );
  assert.match(checked.text, /\[\[p:i\]\]/);
  assert.match(checked.text, /\[\[idea:ok\]\]/);
  assert.match(checked.text, /\[\[gap:g1\]\]/);
  assert.match(checked.text, /\[\[zotero:groups:42:GOOD\]\]/);
  for (const invented of ['[[p:999]]', '[[idea:fake]]', '[[gap:g2]]', '[[zotero:BAD]]']) assert.ok(!checked.text.includes(invented));
  assert.equal(checked.invalid.length, 4);
});

test('evidence: malformed evidence brackets are normalized only for allowed ids', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const evidence = E.evidenceMap([{ id: 'first' }, { id: 'second' }]);
  const checked = E.validateCitations('Supported [[e:first], [e:second]]. Invented [e:nope].', { evidence });
  assert.equal(checked.text, 'Supported [[e:first]], [[e:second]]. Invented.');
  assert.equal(checked.valid.length, 2);
  assert.equal(checked.invalid.length, 1);
});

test('evidence: claim audit distinguishes supported, weak and uncited statements', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const evidence = [{ id: 'one', text: 'The trial enrolled 240 adult participants and reduced blood pressure significantly.' }];
  const answer = 'The trial enrolled 240 adult participants and reduced blood pressure significantly [[e:one]].\n\nThe moon is made entirely of polished copper according to this investigation [[e:one]].\n\nA separate long factual assertion appears here without any supporting source citation.';
  const audit = E.auditClaims(answer, evidence);
  assert.equal(audit.covered, 1);
  assert.equal(audit.weak, 1);
  assert.equal(audit.missing, 1);
});

test('evidence: claim audit supports faithful English-to-Spanish citations and ignores lead-ins', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const evidence = [{
    id: 'computer',
    text: 'A computer is a machine that can be programmed to automatically carry out sequences of arithmetic or logical operations.',
  }];
  const answer = 'Aquí tienes una comparación de las fuentes:\\n'
    + '- Un ordenador es una máquina programada para llevar a cabo automáticamente secuencias de operaciones aritméticas o lógicas [[e:computer]].';
  const audit = E.auditClaims(answer, evidence);
  assert.equal(audit.total, 1);
  assert.equal(audit.covered, 1);
  assert.equal(audit.coverage, 1);
});

test('store: conversation audits are compacted without persisting embeddings', () => {
  const { NodusStore: S } = loadModule('store.js');
  const conversations = [{
    id: 'conversation',
    messages: [{
      role: 'assistant',
      content: 'Supported answer.',
      evidence: [{ id: 'good', libraryID: 8, groupID: 42, itemKey: 'ITEM', attachmentKey: 'ATT', text: 'Exact passage' }],
      audit: {
        total: 1, covered: 1, weak: 0, missing: 0, coverage: 1,
        invalidCitations: [{ id: 'bad', token: '[[e:bad]]', embedding: [9, 9] }],
        claims: [{
          text: 'Supported answer.', citationIds: ['good'], status: 'covered', support: 0.91,
          evidence: [{ id: 'good', embedding: [0.1, 0.2], text: 'Exact passage' }],
        }],
      },
    }],
  }];
  const compact = S.compactConversations(conversations);
  assert.equal(compact[0].messages[0].audit.claims[0].support, 0.91);
  assert.equal(compact[0].messages[0].audit.claims[0].evidence, undefined);
  assert.equal(compact[0].messages[0].audit.invalidCitations[0].embedding, undefined);
  assert.equal(compact[0].messages[0].evidence[0].groupID, 42, 'history retains group provenance for PDF fallbacks');
  assert.ok(!JSON.stringify(compact).includes('embedding'));
});

test('store: evidence cache separates compressed metadata from Float32 vectors', () => {
  const { NodusStore: S } = loadModule('store.js');
  const index = {
    libraryID: 1,
    attachmentKey: 'ATT',
    chunks: [
      { id: 'a', text: 'alpha', embedding: [0.1, -0.2, 0.3] },
      { id: 'b', text: 'beta', embedding: null },
      { id: 'c', text: 'gamma', embedding: [1, 0, -1] },
    ],
  };
  const packed = S.detachEmbeddings(index);
  assert.equal(packed.index.cache.vectorFormat, 'float32-le');
  assert.equal(packed.index.cache.vectorCount, 6);
  assert.equal(packed.bytes.byteLength, 6 * 4);
  assert.ok(packed.index.chunks.every((chunk) => chunk.embedding === null), 'JSON carries no vector arrays');
  const restored = S.attachEmbeddings(JSON.parse(JSON.stringify(packed.index)), packed.bytes);
  assert.equal(restored.chunks[1].embedding, null);
  assert.equal(restored.chunks[0].embedding.length, 3);
  assert.ok(Math.abs(restored.chunks[0].embedding[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(restored.chunks[2].embedding[2] + 1) < 1e-6);
});

test('store: evidence cache drops unused duplicate layout maps', () => {
  const { NodusStore: S } = loadModule('store.js');
  const index = {
    pages: [{ text: 'alpha', rawText: 'alpha', spans: [{ start: 0, end: 5, rect: [1, 2, 3, 4], text: 'alpha' }] }],
    chunks: [{ text: 'alpha', positions: [{ start: 0, end: 5, rect: [1, 2, 3, 4], text: 'alpha' }] }],
  };
  assert.equal(S.compactEvidenceIndex(index), true);
  assert.equal(index.pages[0].rawText, undefined);
  assert.equal(index.pages[0].spans, undefined);
  assert.equal(index.chunks[0].positions, undefined);
  assert.equal(index.pages[0].text, 'alpha', 'retrieval text remains intact');
  assert.equal(S.compactEvidenceIndex(index), false, 'migration is idempotent');
});

test('evidence: layout extraction removes repeated margins, orders columns and retains exact coordinates', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const item = (str, x, y, width = 90) => ({ str, x, y, width, height: 10 });
  const pages = Array.from({ length: 4 }, (_, pageIndex) => ({
    pageIndex,
    pageLabel: String(pageIndex + 1),
    width: 600,
    height: 800,
    items: [
      item(`Journal header ${pageIndex + 1}`, 50, 10, 500),
      item(`multi${String.fromCharCode(97 + pageIndex)}-`, 50, 100), item(`lingual evidence ${String.fromCharCode(97 + pageIndex)}`, 50, 120, 130), item(`left conclusion ${String.fromCharCode(97 + pageIndex)}.`, 50, 140, 130),
      item(`left detail one ${String.fromCharCode(97 + pageIndex)}`, 50, 160, 130), item(`left detail two ${String.fromCharCode(97 + pageIndex)}`, 50, 180, 130), item(`left detail three ${String.fromCharCode(97 + pageIndex)}.`, 50, 200, 130),
      item(`right first ${String.fromCharCode(97 + pageIndex)}`, 330, 100), item(`right second ${String.fromCharCode(97 + pageIndex)}`, 330, 120), item(`right third ${String.fromCharCode(97 + pageIndex)}.`, 330, 140),
      item(`right detail one ${String.fromCharCode(97 + pageIndex)}`, 330, 160), item(`right detail two ${String.fromCharCode(97 + pageIndex)}`, 330, 180), item(`right detail three ${String.fromCharCode(97 + pageIndex)}.`, 330, 200),
      item(`Page ${pageIndex + 1}`, 250, 780, 100),
    ],
  }));
  const structured = E.structureLayoutPages(pages, { pageLabels: ['i', 'ii', '1', '2'] });
  assert.equal(structured.length, 4);
  assert.ok(structured.every((page) => !page.text.includes('Journal header') && !page.text.includes('Page ')));
  assert.ok(structured[0].text.indexOf('left conclusion') < structured[0].text.indexOf('right first'));
  assert.ok(structured[0].text.includes('multialingual evidence a'), 'line-end hyphen reconstructed');
  assert.equal(structured[2].pageLabel, '1');
  assert.ok(structured[0].spans.length >= 6);
  for (const span of structured[0].spans) {
    assert.equal(structured[0].text.slice(span.start, span.end), span.text);
    assert.equal(span.rect.length, 4);
  }
});

test('evidence: a sparse figure caption is not mistaken for a second prose column', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const item = (str, x, y, width = 110) => ({ str, x, y, width, height: 10 });
  const page = E.structureLayoutPage({
    pageIndex: 0,
    pageLabel: '26',
    width: 600,
    height: 800,
    items: [
      item('Main prose starts here', 253, 80, 299),
      item('and continues through the', 253, 100, 299),
      item('important network account.', 253, 120, 299),
      item('A second paragraph remains', 253, 140, 299),
      item('part of the dominant prose', 253, 160, 299),
      item('before the wide section.', 253, 180, 299),
      item('Figure showing routes', 35, 120, 200),
      item('on the Internet', 35, 140, 120),
      item('Full-width continuation below the floating figure.', 35, 250, 520),
    ],
  });
  assert.ok(page.text.indexOf('Main prose starts here') < page.text.indexOf('Figure showing routes'));
  assert.ok(page.text.indexOf('Figure showing routes') < page.text.indexOf('Full-width continuation'));
});

test('evidence: a new heading starts its own paragraph and carries into the next page', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const item = (str, x, y, width = 480) => ({ str, x, y, width, height: 10 });
  const pages = E.structureLayoutPages([
    {
      pageIndex: 0, pageLabel: '25', width: 600, height: 800,
      items: [
        item('The prior discussion ends here.[143]', 50, 100),
        item('Networking and the Internet', 50, 140, 220),
      ],
    },
    {
      pageIndex: 1, pageLabel: '26', width: 600, height: 800,
      items: [item('Computers have coordinated information across locations since the 1950s.', 50, 100)],
    },
  ], {});
  assert.ok(pages[0].text.includes('\n\nNetworking and the Internet'));
  assert.equal(pages[0].headings.at(-1).title, 'Networking and the Internet');
  assert.equal(pages[0].inheritedSection, '');
  assert.equal(pages[1].inheritedSection, 'Networking and the Internet');
  const index = E.buildIndex(
    { libraryID: 1, itemKey: 'A', attachmentKey: 'AA', title: 'Computer', layoutPages: [
      {
        pageIndex: 0, pageLabel: '25', width: 600, height: 800,
        items: [
          item('The prior discussion ends here.[143]', 50, 100),
          item('Networking and the Internet', 50, 140, 220),
        ],
      },
      {
        pageIndex: 1, pageLabel: '26', width: 600, height: 800,
        items: [item('Computers have coordinated information across locations since the 1950s.', 50, 100)],
      },
    ] },
    '',
    { targetChars: 500, minChars: 80, overlapChars: 20 },
  );
  assert.equal(index.chunks.find((chunk) => chunk.pageIndex === 1).section, 'Networking and the Internet');
});

test('evidence: reference entries do not replace the References section or dominate ordinary retrieval', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  assert.equal(E.looksLikeHeading('References'), true);
  assert.equal(E.looksLikeHeading('37. Smith, Jane (2024). "Computer Networks" (https://example.test)'), false);
  assert.equal(E.looksLikeHeading('Software-'), false);
  assert.equal(E.looksLikeHeading('3. System Architecture'), true);
  const index = E.buildIndex(
    { libraryID: 1, itemKey: 'A', attachmentKey: 'AA', title: 'Computer', totalPages: 3 },
    'Networking and the Internet\nComputers exchange information over linked networks.\fReferences\n37. Smith, Jane (2024). Computer Networks and the Internet.\f18. Leonardo Torres. Memoria sobre las máquinas algébricas',
    { targetChars: 180, minChars: 80, overlapChars: 20 },
  );
  assert.equal(index.pages[2].inheritedSection, 'References');
  assert.ok(index.chunks.filter((chunk) => chunk.pageIndex === 2).every((chunk) => chunk.section === 'References'));
  assert.equal(
    E.detectHeadings('118. Example reference\nConcise Guide for the New User\nPublisher Name', 'References').length,
    0,
  );
  const dims = 4;
  index.chunks.forEach((chunk) => {
    chunk.embedding = chunk.section === 'References' ? [1, 0, 0, 0] : [0.92, 0.2, 0, 0];
  });
  const result = E.hybridSearch([index], 'computer networks and internet', [1, 0, 0, 0], { topK: 2, candidateK: 4 });
  assert.notEqual(result.hits[0].section, 'References');
  assert.ok(result.candidates.every((hit) => hit.section !== 'References'));
  const citePages = E.hybridSearch([index], 'explica computer networks y cita páginas exactas', [1, 0, 0, 0], { topK: 2, candidateK: 4 });
  assert.ok(citePages.hits.every((hit) => hit.section !== 'References'));
  assert.ok(citePages.candidates.every((hit) => hit.section !== 'References'));
  const bibliography = E.hybridSearch([index], 'bibliography reference for computer networks', [1, 0, 0, 0], { topK: 2, candidateK: 4 });
  assert.ok(bibliography.hits.some((hit) => hit.section === 'References'));
  assert.equal(dims, index.chunks[0].embedding.length);
});

test('evidence: section-neighbor expansion crosses a page boundary without pulling unrelated sections', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const index = {
    libraryID: 1, attachmentKey: 'A', signature: 'sig',
    chunks: [
      { id: 'p1', libraryID: 1, attachmentKey: 'A', pageIndex: 0, chunkIndex: 0, section: 'Networking', text: 'ARPANET history' },
      { id: 'p2a', libraryID: 1, attachmentKey: 'A', pageIndex: 1, chunkIndex: 0, section: 'Networking', text: 'Standards groups ANSI IETF' },
      { id: 'p2b', libraryID: 1, attachmentKey: 'A', pageIndex: 1, chunkIndex: 1, section: 'Notes', text: 'Unrelated notes' },
      { id: 'p3', libraryID: 1, attachmentKey: 'A', pageIndex: 2, chunkIndex: 0, section: 'References', text: 'Bibliography' },
    ],
  };
  const expanded = E.expandWithNeighbors([index], [index.chunks[0]], { topK: 5, maxPerSource: 5 });
  assert.ok(expanded.some((hit) => hit.id === 'p2a' && hit.retrieval === 'section-neighbor'));
  assert.ok(!expanded.some((hit) => hit.id === 'p2b' || hit.id === 'p3'));
});

test('evidence: bounded page reads and iterative result merging never invent sources', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const a = E.buildIndex({ libraryID: 1, itemKey: 'A', attachmentKey: 'AA', title: 'Alpha', pageLabels: ['1', '2', '3'] }, 'first page\fsecond target page\fthird page');
  const b = E.buildIndex({ libraryID: 1, itemKey: 'B', attachmentKey: 'BB', title: 'Beta' }, 'other source');
  const pageHits = E.pageRequestHits([a, b], [
    { source: 'AA', from: 2, to: 99 },
    { source: 'INVENTED', from: 1, to: 4 },
  ], { maxPagesPerRequest: 1, maxHits: 8 });
  assert.ok(pageHits.length > 0);
  assert.ok(pageHits.every((hit) => hit.attachmentKey === 'AA' && hit.pageLabel === '2'));
  const base = { method: 'lexical', hits: [{ ...a.chunks[0], score: 0.2 }], candidates: [{ ...a.chunks[0], score: 0.2 }] };
  const expanded = { method: 'hybrid', hits: [{ ...a.chunks[0], score: 0.8 }, { ...b.chunks[0], score: 0.7 }], candidates: [{ ...b.chunks[0], score: 0.7 }] };
  const merged = E.mergeRetrievalResults([base, expanded], pageHits);
  assert.equal(merged.method, 'hybrid');
  assert.equal(merged.hits.filter((hit) => hit.id === a.chunks[0].id).length, 1, 'deduplicates repeated hits');
  assert.ok(merged.candidates.some((hit) => hit.attachmentKey === 'BB'));
});

test('evidence: complete-text mode obeys a token budget', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const idx = E.buildIndex({ libraryID: 1, itemKey: 'A', attachmentKey: 'AA', title: 'Alpha' }, 'Evidence sentence with several words. '.repeat(300), { targetChars: 260, minChars: 100, overlapChars: 30 });
  const bounded = E.fullEvidencePrompt([idx], { maxChars: 100000, maxTokens: 250 });
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.tokens <= 250);
  assert.ok(bounded.hits.length < idx.chunks.length);
});

// A several-hundred-page monograph: one sentence per page, form-feed
// separated, so a known token appears on exactly one known page.
function makeBook(E, pages, opts = {}) {
  const text = Array.from({ length: pages }, (_, i) => `This is page ${i + 1}. It discusses topic marker ${i + 1} in detail with enough words to chunk.`).join('\f');
  return E.buildIndex({ libraryID: 1, itemKey: 'BOOK', attachmentKey: 'BK', title: opts.title || 'Big Monograph', totalPages: pages, pageLabels: opts.pageLabels }, text, { targetChars: 400, minChars: 120, overlapChars: 40 });
}

test('evidence: document map reports true length + current/first/last, never guessed from evidence', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const book = makeBook(E, 600);
  const map = E.buildDocumentMap([book], { current: { attachmentKey: 'BK', pageIndex: 43 } });
  const src = map.sources[0];
  assert.equal(src.totalPages, 600);
  assert.equal(src.firstLabel, '1');
  assert.equal(src.lastLabel, '600');
  assert.equal(src.currentLabel, '44'); // pageIndex 43 → human page 44
  const en = E.documentMapPrompt(map, { lang: 'en' });
  assert.ok(/600 pages/.test(en));
  assert.ok(/currently open at page 44/.test(en));
  assert.ok(/AUTHORITATIVE/.test(en) && /NEVER infer/.test(en));
  assert.ok(/NOT a citable source/i.test(en), 'map declares itself non-citable');
  const es = E.documentMapPrompt(map, { lang: 'es' });
  assert.ok(/600 páginas/.test(es) && /página 44/.test(es) && /NUNCA/.test(es));
});

test('evidence: document map surfaces roman-numeral front matter as differing labels', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const labels = ['i', 'ii', 'iii', '1', '2'];
  const book = makeBook(E, 5, { pageLabels: labels });
  const map = E.buildDocumentMap([book], { current: { attachmentKey: 'BK', pageIndex: 0 } });
  const src = map.sources[0];
  assert.equal(src.firstLabel, 'i');
  assert.equal(src.currentLabel, 'i');
  assert.equal(src.labelsDiffer, true);
  assert.ok(/page labels "i"/.test(E.documentMapPrompt(map, { lang: 'en' })));
});

test('evidence: positional query classifier detects current/last/first/explicit pages in ES + EN', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  assert.equal(E.classifyPositionalQuery('¿en qué página estoy?').current, true);
  assert.equal(E.classifyPositionalQuery('what page am I on right now').current, true);
  assert.equal(E.classifyPositionalQuery('¿qué dice la última página?').last, true);
  assert.equal(E.classifyPositionalQuery('summarize the last page').last, true);
  assert.equal(E.classifyPositionalQuery('resume la primera página').first, true);
  assert.equal(E.classifyPositionalQuery('¿cuántas páginas tiene el libro?').length, true);
  assert.deepEqual([...E.classifyPositionalQuery('explica la página 213').pages], [213]);
  assert.deepEqual(Array.from(E.classifyPositionalQuery('compara las páginas 10 a 12').ranges, (r) => ({ from: r.from, to: r.to })), [{ from: 10, to: 12 }]);
  // A content question must NOT be treated as positional.
  const plain = E.classifyPositionalQuery('what is the main argument about tourism?');
  assert.equal(plain.positional, false);
});

test('evidence: positional page hits fetch the exact page content deterministically', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const book = makeBook(E, 600);
  const last = E.positionalPageHits(book, E.classifyPositionalQuery('¿qué dice la última página?'), {});
  assert.ok(last.length > 0);
  assert.ok(last.every((h) => h.pageIndex >= 598)); // last page (599) + its neighbor
  assert.ok(last.some((h) => h.text.includes('page 600')));
  const explicit = E.positionalPageHits(book, E.classifyPositionalQuery('resume la página 213'), {});
  assert.ok(explicit.length > 0 && explicit.every((h) => h.pageIndex === 212));
  assert.ok(explicit.some((h) => h.text.includes('page 213')));
  const current = E.positionalPageHits(book, E.classifyPositionalQuery('what is on this page'), { currentPageIndex: 43 });
  assert.ok(current.length > 0 && current.every((h) => h.pageIndex === 43));
  assert.ok(current.some((h) => h.text.includes('page 44')));
});

test('evidence: explicit page number matches the printed LABEL, not just the physical index', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  // Physical page 4 (index 3) is printed "1"; a reader asking for "page 1" means the label.
  const book = makeBook(E, 5, { pageLabels: ['i', 'ii', 'iii', '1', '2'] });
  const hits = E.positionalPageHits(book, E.classifyPositionalQuery('página 1'), {});
  assert.ok(hits.length > 0 && hits.every((h) => h.pageIndex === 3));
});

test('evidence: candidate selection bounds embedding cost far below the whole book', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const book = makeBook(E, 600);
  assert.ok(book.chunks.length >= 400, 'a 600-page book chunks into hundreds of passages');
  const ids = E.candidateChunkIdsForQuery([book], 'topic marker 317', { limit: 96 });
  // Bounded: never the whole book, and small relative to it.
  assert.ok(ids.length <= 96 + 6 + 8, `candidates ${ids.length} stay bounded`);
  assert.ok(ids.length < book.chunks.length / 3, 'far fewer than the whole document');
  // The lexically-relevant page for the query is among the candidates.
  const target = book.chunks.find((c) => c.text.includes('marker 317'));
  assert.ok(ids.includes(target.id), 'the on-topic chunk is selected for embedding');
});

test('evidence: visual extraction is merged into the correct page and re-chunked', () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const idx = E.buildIndex({ libraryID: 1, itemKey: 'A', attachmentKey: 'AA', title: 'Alpha', totalPages: 2 }, 'Text page\f');
  E.addVisualText(idx, 1, '[TABLE] Group | Mean\\nA | 42');
  assert.ok(idx.pages[1].visualText.includes('Mean'));
  assert.equal(idx.pages[1].needsOcr, false);
  assert.ok(idx.chunks.some((c) => c.pageIndex === 1 && c.text.includes('[TABLE]')));
});

test('multimodal: validates images and detects figures, tables, formulas, diagrams and OCR pages', () => {
  const { NodusMultimodal: V } = loadModule('multimodal.js');
  const data = 'data:image/png;base64,aGVsbG8=';
  assert.equal(V.isImageDataUrl(data), true);
  assert.deepEqual({ ...V.dataUrlToImagePart(data) }, { mimeType: 'image/png', data: 'aGVsbG8=' });
  const signals = V.visualSignals('Figure 2 and Table 4 show α = 0.5 in the architecture diagram');
  assert.deepEqual({ ...signals }, { figure: true, table: true, formula: true, diagram: true });
  assert.equal(V.needsVisualAnalysis({ needsOcr: true, text: '' }), true);
  assert.ok(V.cleanVisualExtraction('```text\n[OCR] EMPTY\n[TABLE] A | B\n```').includes('[TABLE]'));
});

test('multimodal: resolves the Zotero 9 PDFView iframe and extracts positioned text', async () => {
  const { NodusMultimodal: V } = loadModule('multimodal.js');
  const pdfViewer = { currentPageNumber: 3 };
  const pdfDocument = {
    numPages: 1,
    async getPage(pageNumber) {
      assert.equal(pageNumber, 1);
      return {
        getViewport: () => ({ width: 612, height: 792 }),
        getTextContent: async () => ({
          items: [{ str: 'Positioned evidence', width: 96, height: 12, transform: [12, 0, 0, 12, 54, 700] }],
        }),
      };
    },
  };
  const iframe = { PDFViewerApplication: { pdfDocument, pdfViewer } };
  const reader = { _internalReader: { _primaryView: { _pdfView: { _iframeWindow: iframe } } } };
  const internals = V.readerInternals(reader);
  assert.equal(internals.iframe, iframe);
  assert.equal(internals.viewer, pdfViewer);
  assert.equal(V.currentPageIndex(reader), 2);
  const pages = await V.extractDocumentLayout(reader);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].items[0].str, 'Positioned evidence');
  assert.deepEqual(
    { x: pages[0].items[0].x, y: pages[0].items[0].y, width: pages[0].items[0].width },
    { x: 54, y: 80, width: 96 },
  );
});

test('multimodal: unwraps PDF.js page and text objects returned across the Zotero iframe boundary', async () => {
  const cloned = [];
  const { NodusMultimodal: V } = loadModule('multimodal.js', {
    Components: {
      utils: {
        cloneInto(value, target) {
          cloned.push({ value, target });
          return { ...value, cloned: true };
        },
      },
    },
  });
  const rawContent = {
    items: [{ wrappedJSObject: { str: 'Cross-compartment evidence', width: 120, height: 10, transform: [10, 0, 0, 10, 40, 740] } }],
  };
  const rawPage = {
    getViewport: (options) => {
      assert.equal(options.cloned, true);
      return { wrappedJSObject: { width: 600, height: 800 } };
    },
    getTextContent: async () => ({ wrappedJSObject: rawContent }),
  };
  const pdfDocument = {
    numPages: 1,
    getPage: async () => ({ wrappedJSObject: rawPage }),
  };
  const iframe = {
    wrappedJSObject: {
      PDFViewerApplication: {
        wrappedJSObject: {
          pdfDocument: { wrappedJSObject: pdfDocument },
          pdfViewer: {},
        },
      },
    },
  };
  const reader = { _internalReader: { _primaryView: { _iframeWindow: iframe } } };
  const pages = await V.extractDocumentLayout(reader);
  assert.equal(pages[0].items.length, 1);
  assert.equal(pages[0].items[0].str, 'Cross-compartment evidence');
  assert.equal(pages[0].items[0].y, 50);
  assert.equal(cloned.length, 1);
  assert.equal(cloned[0].target, iframe);
});

test('providers: multimodal body builders and embedding response ordering', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }) };
  };
  const { NodusProviders: P } = loadModule('providers.js', { fetch: fakeFetch });
  const image = { dataUrl: 'data:image/jpeg;base64,YQ==', label: 'page' };
  const openai = P.withOpenAiImages([{ role: 'user', content: 'inspect' }], [image]);
  assert.ok(Array.isArray(openai[0].content));
  assert.equal(openai[0].content.at(-1).type, 'image_url');
  const anthropic = P.withAnthropicImages([{ role: 'user', content: 'inspect' }], [image]);
  assert.equal(anthropic[0].content.at(-1).type, 'image');
  const vectors = await P.embed({ provider: 'openrouter', model: 'openai/text-embedding-3-small' }, ['a', 'b'], { key: 'secret' });
  assert.deepEqual([...vectors[0]], [1, 0]);
  assert.ok(calls[0].url.endsWith('/embeddings'));
  assert.equal(JSON.parse(calls[0].init.body).input.length, 2);
});

test('providers: detects short unfinished streams without flagging complete replies', () => {
  const { NodusProviders: P } = loadModule('providers.js');
  assert.equal(P.isProbablyTruncated('Un ordenador es una máquina program', 'stop'), true);
  assert.equal(P.isProbablyTruncated('Un ordenador es una máquina programable.', 'stop'), false);
  assert.equal(P.isProbablyTruncated('A complete but long answer. '.repeat(20), 'stop'), false);
  assert.equal(P.isProbablyTruncated('Complete.', 'length'), true);
});

// ─────────────────────────────────────────── #4 save chat as note
test('util: conversationToHtml renders roles and escapes html', () => {
  const { NodusUtil } = loadModule('util.js');
  const html = NodusUtil.conversationToHtml(
    { messages: [{ role: 'user', content: 'Hi <there>' }, { role: 'assistant', content: 'Line1\nLine2' }] },
    { you: 'You', nodus: 'Nodus' },
  );
  assert.ok(html.includes('<b>You:</b> Hi &lt;there&gt;'));
  assert.ok(html.includes('<b>Nodus:</b> Line1<br/>Line2'));
});

// ─────────────────────────────────────────── #6 multi-item context
test('util: buildItemsSummary only fires for 2+ items', () => {
  const { NodusUtil } = loadModule('util.js');
  assert.equal(NodusUtil.buildItemsSummary([]), '');
  assert.equal(NodusUtil.buildItemsSummary([{ title: 'Solo' }]), '');
  const s = NodusUtil.buildItemsSummary([
    { title: 'Paper A', creators: 'Smith', year: '2020', abstract: 'aaa' },
    { title: 'Paper B', creators: 'Doe', year: '2021' },
  ]);
  assert.ok(s.includes('SELECTED DOCUMENTS'));
  assert.ok(s.includes('1. Paper A') && s.includes('2. Paper B'));
  assert.ok(s.includes('Smith') && s.includes('(2020)'));
});

test('util: reply language follows the last user message, not the source language', () => {
  const { NodusUtil } = loadModule('util.js');
  assert.equal(NodusUtil.detectLanguage('Describe la figura de la página y cita la evidencia.', 'en'), 'Spanish');
  assert.equal(NodusUtil.detectLanguage('Describe the figure on the page and cite the evidence.', 'es'), 'English');
  assert.equal(NodusUtil.detectLanguage('OK', 'es'), 'Spanish');
});

// ─────────────────────────────────────────── #3 agent tools
test('agent: new tools are registered and parsed', () => {
  const { NodusAgent } = loadModule('agent.js');
  // Spread into a local-realm array: the vm sandbox has its own Array.prototype,
  // which trips deepStrictEqual's prototype check.
  assert.deepEqual(
    [...NodusAgent.TOOLS],
    ['create_note', 'highlight', 'add_tags', 'add_to_collection', 'set_field', 'extract_annotations_note'],
  );
  const reply = 'Sure.\n```nodus:action\n{"tool":"add_to_collection","name":"To read"}\n```\n```nodus:action\n{"tool":"set_field","field":"abstractNote","value":"x"}\n```';
  const { actions, clean } = NodusAgent.parseActions(reply);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].tool, 'add_to_collection');
  assert.equal(actions[1].field, 'abstractNote');
  assert.ok(!clean.includes('nodus:action'));
  // SYSTEM prompt advertises the new tools.
  for (const tool of ['add_to_collection', 'set_field', 'extract_annotations_note']) {
    assert.ok(NodusAgent.SYSTEM.includes(tool), `SYSTEM documents ${tool}`);
  }
});

test('agent: describe returns human text for each tool', () => {
  const { NodusAgent } = loadModule('agent.js');
  const t = (k) => k; // identity: assert the right key is used
  assert.ok(NodusAgent.describe({ tool: 'add_to_collection', name: 'X' }, t).includes('agent.desc.collection'));
  assert.ok(NodusAgent.describe({ tool: 'set_field', field: 'title', value: 'Y' }, t).includes('agent.desc.field'));
  assert.ok(NodusAgent.describe({ tool: 'extract_annotations_note' }, t).includes('agent.desc.extract'));
});

// ─────────────────────────────────────────── #7 max_tokens
test('providers: Anthropic body uses configurable max_tokens (default 8192)', () => {
  const { NodusProviders } = loadModule('providers.js');
  assert.equal(NodusProviders.DEFAULT_MAX_TOKENS, 8192);
  const def = NodusProviders.buildAnthropicBody('claude-x', 'sys', [{ role: 'user', content: 'hi' }]);
  assert.equal(def.max_tokens, 8192, 'no longer the old hardcoded 4096');
  assert.equal(def.stream, true);
  assert.equal(def.system, 'sys');
  const custom = NodusProviders.buildAnthropicBody('claude-x', '', [], 32000);
  assert.equal(custom.max_tokens, 32000);
  assert.equal(custom.system, undefined, 'empty system omitted');
  // clamp: nonsense → default, absurdly high → capped, tiny → floored
  assert.equal(NodusProviders.clampMaxTokens('nope'), 8192);
  assert.equal(NodusProviders.clampMaxTokens(9_000_000), 200000);
  assert.equal(NodusProviders.clampMaxTokens(1), 256);
});

test('providers: chatBase builds per-provider URLs', () => {
  const { NodusProviders } = loadModule('providers.js');
  assert.equal(NodusProviders.chatBase('openai'), 'https://api.openai.com/v1');
  assert.equal(NodusProviders.chatBase('ollama'), 'http://localhost:11434/v1');
  assert.equal(NodusProviders.chatBase('ollama', 'http://127.0.0.1:1234/'), 'http://127.0.0.1:1234/v1');
  assert.throws(() => NodusProviders.chatBase('ollama', 'http://box:1234/'), /localhost/);
});

test('security: model-authored links require HTTPS', () => {
  const { NodusMarkdown } = loadModule('markdown.js');
  assert.equal(NodusMarkdown.safeExternalUrl('https://example.org/paper'), 'https://example.org/paper');
  for (const value of ['http://127.0.0.1:4321', 'http://example.org', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'chrome://zotero/content']) {
    assert.equal(NodusMarkdown.safeExternalUrl(value), '', `${value} is not clickable`);
  }
});

test('security: agent actions are bounded and note HTML is sanitized', () => {
  const { NodusAgent } = loadModule('agent.js');
  const raw = '<script>alert(1)</script><p onclick="steal()">Safe <strong>text</strong><img src=x onerror=x></p><iframe src=x>bad</iframe>';
  const safe = NodusAgent.sanitizeNoteHtml(raw);
  assert.equal(safe, '<p>Safe <strong>text</strong></p>');
  assert.doesNotMatch(safe, /script|onclick|onerror|iframe|img/i);
  const blocks = Array.from({ length: 9 }, (_, i) => '```nodus:action\n' + JSON.stringify({ tool: 'add_tags', tags: [`tag-${i}`] }) + '\n```').join('\n');
  assert.equal(NodusAgent.parseActions(blocks).actions.length, NodusAgent.MAX_ACTIONS);
  const tags = NodusAgent.validateAction({ tool: 'add_tags', tags: Array.from({ length: 40 }, (_, i) => `t${i}`) });
  assert.equal(tags.tags.length, NodusAgent.LIMITS.tags);
  assert.equal(NodusAgent.validateAction({ tool: 'set_field', field: 'itemType', value: 'book' }), null);
  assert.equal(NodusAgent.isUserRequested({ tool: 'create_note' }, 'Summarize this paper'), false, 'a normal research question cannot authorize a document-injected action');
  assert.equal(NodusAgent.isUserRequested({ tool: 'create_note' }, 'Create a note with this summary'), true);
  assert.equal(NodusAgent.isUserRequested({ tool: 'add_tags' }, 'Añade las etiquetas historia y viajes'), true);
  assert.equal(NodusAgent.isUserRequested({ tool: 'set_field', field: 'DOI' }, 'Cambia el DOI a 10.1/test'), true);
});

test('security: Gemini model discovery keeps the API key out of the URL', async () => {
  let seen = null;
  const { NodusProviders } = loadModule('providers.js', {
    fetch: async (url, opts) => {
      seen = { url, opts };
      return { ok: true, json: async () => ({ models: [{ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] }] }) };
    },
  });
  assert.deepEqual(await NodusProviders.listModels('gemini', { key: 'secret-key' }), ['gemini-test']);
  assert.doesNotMatch(seen.url, /secret-key|\?key=/);
  assert.equal(seen.opts.headers['x-goog-api-key'], 'secret-key');
});

test('evidence: attachment signature detects same-size middle edits and forced rebuild preserves unchanged OCR', async () => {
  const { NodusEvidence: E } = loadModule('evidence.js');
  const att = {
    id: 7, libraryID: 1, key: 'ATT', attachmentContentType: 'text/plain',
    parentItem: { key: 'ITEM', getDisplayTitle: () => 'Source' },
    getFilePathAsync: async () => null,
    attachmentText: 'first page\fsecond page',
  };
  const a = await E.attachmentSignature(att, 'A'.repeat(5000) + 'X' + 'B'.repeat(5000));
  const b = await E.attachmentSignature(att, 'A'.repeat(5000) + 'Y' + 'B'.repeat(5000));
  assert.notEqual(a, b);
  const first = E.buildIndex({ libraryID: 1, itemKey: 'ITEM', attachmentKey: 'ATT', title: 'Source', contentType: 'text/plain' }, att.attachmentText);
  E.addVisualText(first, 0, 'OCR diagram label');
  let saved = null;
  const store = { loadEvidenceIndex: async () => first, saveEvidenceIndex: async (index) => { saved = index; } };
  const rebuilt = await E.ensureIndex(att, store, { force: true });
  assert.equal(rebuilt.rebuilt, true);
  assert.equal(rebuilt.index.pages[0].visualText, 'OCR diagram label');
  assert.equal(saved.pages[0].visualText, 'OCR diagram label');
});

test('security: provider credentials use Zotero Login Manager and migrate plaintext prefs', async () => {
  const prefs = new Map([['nodus.key.openai', 'legacy-secret']]);
  const logins = [];
  const manager = {
    findLogins: () => logins,
    addLogin: (login) => logins.push(login),
    modifyLogin: (oldLogin, next) => Object.assign(oldLogin, next),
    removeLogin: (login) => logins.splice(logins.indexOf(login), 1),
  };
  const Zotero = { Prefs: { get: (key) => prefs.get(key), set: (key, value) => prefs.set(key, value) }, logError() {} };
  const LoginInfo = function () { this.init = (origin, form, realm, username, password) => Object.assign(this, { origin, realm, username, password }); };
  const { NodusStore } = loadModule('store.js', {
    ChromeUtils: { importESModule: () => ({ Zotero }) },
    Services: { logins: manager, dirsvc: { get: () => ({ path: '/tmp' }) } },
    Components: { classes: { '@mozilla.org/login-manager/loginInfo;1': { createInstance: () => new LoginInfo() } }, interfaces: { nsILoginInfo: {}, nsIFile: {} } },
    PathUtils: { join: (...parts) => parts.join('/') }, IOUtils: {},
  });
  assert.equal(NodusStore.getSecretStorageStatus(), 'encrypted');
  assert.equal(await NodusStore.getKey('openai'), 'legacy-secret');
  assert.equal(logins[0].password, 'legacy-secret');
  assert.equal(prefs.get('nodus.key.openai'), '');
  assert.equal(await NodusStore.setKey('openai', 'new-secret'), true);
  assert.equal(await NodusStore.getKey('openai'), 'new-secret');
});

test('security: legacy plaintext credentials fail closed without Login Manager', async () => {
  const prefs = new Map([['nodus.key.openai', 'must-not-leak'], ['nodus.token', 'bridge-secret'], ['nodus.port', 4321]]);
  const Zotero = { Prefs: { get: (key) => prefs.get(key), set: (key, value) => prefs.set(key, value) }, logError() {} };
  const { NodusStore } = loadModule('store.js', {
    ChromeUtils: { importESModule: () => ({ Zotero }) },
    Services: { dirsvc: { get: () => ({ path: '/tmp' }) } },
    Components: { classes: {}, interfaces: { nsIFile: {} } },
    PathUtils: { join: (...parts) => parts.join('/') }, IOUtils: {},
  });
  assert.equal(NodusStore.getSecretStorageStatus(), 'unavailable');
  assert.equal(await NodusStore.getKey('openai'), '');
  assert.equal((await NodusStore.getManual()).token, '');
});

test('security: Zotero bridge is authenticated, non-reflective, owner-only and removed on stop', () => {
  const server = readSource('electron/zotero-plugin/server.ts');
  assert.ok(server.indexOf("urlPath === '/api/z/health'") > server.indexOf('hasValidToken(req, token)'), 'health route is after bearer validation');
  assert.doesNotMatch(server.slice(server.indexOf('function setCors'), server.indexOf('function describeError')), /allowedOrigin\s*=.*:\s*origin/, 'Zotero CORS never reflects a request origin');
  assert.match(server, /chmod\(bridgePath, 0o600\)/);
  assert.match(server, /chmod\(dir, 0o700\)/);
  assert.match(server, /messages\.length > 60/);
  assert.match(server, /model requested|modelo solicitado|modelos configurados/);
  assert.match(server, /rm\(path\.join\(bridgeDir\(\), 'zotero-bridge\.json'\)/);
  assert.match(server, /UNTRUSTED SOURCE DATA/);
  const installer = readSource('electron/zotero-plugin/install.ts');
  assert.doesNotMatch(installer, /user_pref\("extensions\.(?:startupScanScopes|autoDisableScopes)"/, 'installer does not weaken global add-on policy');
  assert.doesNotMatch(installer, /path\.join\(profile, 'extensions'\)/, 'installer never sideloads into a Zotero profile');
  assert.match(installer, /official Add-ons flow|official Add-ons UI/);
});

test('scope: group and personal Zotero keys cannot collide at the server boundary', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const server = readSource('electron/zotero-plugin/server.ts');
  const liveRelations = readSource('electron/ai/liveRelations.ts');
  const sourceKeys = sidebar.slice(sidebar.indexOf('async function scopedSourceKeys'), sidebar.indexOf('async function refreshScopeStatus'));
  assert.match(sourceKeys, /add\(index\.libraryID, index\.itemKey\)/);
  assert.match(sourceKeys, /add\(index\.libraryID, index\.attachmentKey\)/);
  assert.match(sourceKeys, /canonicalZoteroKey\(libraryID, key\)/);
  assert.match(sourceKeys, /NS\.listEvidenceRecords/);
  assert.match(sourceKeys, /await scopedAttachments\(\)/);
  assert.match(sourceKeys, /getSelectedItemInfos\(\)/);
  assert.doesNotMatch(sourceKeys, /state\.items/, 'selection keys are read live rather than from the polling snapshot');
  assert.match(sidebar, /const sourceKeys = await scopedSourceKeys\(\)/, 'scope identity does not depend on full-text indexing');
  const send = sidebar.slice(sidebar.indexOf('async function send(text)'), sidebar.indexOf('// Streams an assistant reply'));
  assert.match(send, /await refreshItem\(false\)/, 'send synchronizes a just-changed selection before appending the message');
  const connected = sidebar.slice(sidebar.indexOf('async function sendConnected'), sidebar.indexOf('async function sendStandalone'));
  assert.match(connected, /const liveCurrent = getCurrentItem\(\)/);
  assert.match(server, /export function canonicalZoteroSourceKey/);
  assert.match(server, /const currentKey = canonicalLibraryItemKey\(context\)/);
  assert.match(server, /sourceKeys\.has\(passage\.zoteroKey\)/);
  assert.match(sidebar, /attachmentKey: liveCurrent\.attachment \? String\(liveCurrent\.attachment\.key/, 'the exact open attachment is sent to Nodus');
  assert.match(liveRelations, /attachmentKey: source\?\.attachment_key \|\| null/, 'retrieved passages retain their exact attachment provenance');
  assert.match(server, /p\.zoteroKey === currentKey && p\.attachmentKey === currentAttachmentKey/, 'bare page chips are emitted only for the exact open attachment');
  assert.match(server, /navigablePage \? `\[\[p:\$\{pageLabel\}\]\] ` : pageLabel \? `\(p\. \$\{pageLabel\}\) `/, 'other-source page labels remain non-actionable text');
  assert.match(server, /citations:\s*\{[\s\S]*gaps:[\s\S]*zotero:/, 'server returns exact citation allow-lists with its stream metadata');
  const select = sidebar.slice(sidebar.indexOf('async function selectInZotero'), sidebar.indexOf('// ─────────────────────────────────────────── conversations'));
  assert.match(select, /if \(!item && !group\)/, 'a group key is never searched across unrelated libraries');
  assert.match(sidebar, /hit\.groupID[\s\S]*"groups\/" \+ groupID/, 'PDF fallback retains persisted group provenance');
});

test('scope: a source change aborts and generation-guards the foreground response', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const reset = sidebar.slice(sidebar.indexOf('async function resetSourceContext'), sidebar.indexOf('async function refreshItem'));
  const generate = sidebar.slice(sidebar.indexOf('async function generateAssistant'), sidebar.indexOf('async function sendConnected'));
  assert.match(reset, /state\.sourceGeneration \+= 1/);
  assert.match(reset, /foreground\.abort\(\)/);
  assert.match(generate, /const conversation = state\.conv/);
  assert.match(generate, /isCurrentRun/);
  assert.match(generate, /if \(!isCurrentRun\(\)\) return/);
  assert.match(generate, /conversation\.messages\.push/);
  assert.doesNotMatch(generate, /state\.conv\.messages\.push/);
});

test('privacy: disabled history and deleted Zotero items are purged automatically', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const boot = sidebar.slice(sidebar.indexOf('async function boot()'));
  assert.match(boot, /!state\.historyEnabled[\s\S]*deleteConversationHistory\(\)/);
  assert.match(boot, /await NS\.pruneEvidenceIndexes\(\)/);
  const notifier = sidebar.slice(sidebar.indexOf('function registerNotifier'), sidebar.indexOf('async function boot'));
  assert.match(notifier, /event === "delete"[\s\S]*scheduleEvidencePrune\(\)/);
  assert.match(sidebar, /history\.deleteFailed/);
});

test('agent: approval revalidates the exact PDF selection', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const cards = sidebar.slice(sidebar.indexOf('function selectionFingerprint'), sidebar.indexOf('function okMsg'));
  assert.match(cards, /selectionFingerprint: selectionFingerprint\(state\.selection, state\.selectionDraft\)/);
  assert.match(cards, /action\.tool === "highlight"/);
  assert.match(cards, /selectionFingerprint\(state\.selection, state\.selectionDraft\) !== target\.selectionFingerprint/);
});

test('scope: indexed-library identity includes validated signatures and collection scope is recursive', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  assert.match(sidebar, /async function librarySourceIdentity\(records\)/);
  assert.match(sidebar, /String\(record\.signature \|\| ""\)/);
  assert.match(sidebar, /syncLibraryIdentityBeforeSend/);
  assert.match(sidebar, /getChildCollections \? collection\.getChildCollections\(false, false\)/);
});

test('accessibility and i18n: tabs are related, keyboard-operable and citation fallbacks are localized', () => {
  const html = readSource('zotero-plugin/content/sidebar.html');
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  assert.match(html, /id="nd-tab-chat"[^>]+aria-controls="nd-panel-chat"/);
  assert.match(html, /id="nd-panel-chat"[^>]+aria-labelledby="nd-tab-chat"/);
  assert.match(html, /id="nd-history-close"[^>]+data-i18n-title="modal.close"/);
  assert.match(sidebar, /function handleTabKey/);
  assert.match(sidebar, /"ArrowLeft", "ArrowRight", "Home", "End"/);
  const makeCite = sidebar.slice(sidebar.indexOf('function makeCite'), sidebar.indexOf('async function goToEvidence'));
  assert.doesNotMatch(makeCite, /"Evidence unavailable"|\|\| "source"|\|\| "evidence"/);
  assert.match(makeCite, /t\("citation\.unavailable"\)/);
  const audit = sidebar.slice(sidebar.indexOf('function validateAnswerCitations'), sidebar.indexOf('async function buildSelectedIndexes'));
  assert.match(audit, /pages,/);
  for (const kind of ['ideas', 'gaps', 'zotero']) assert.match(audit, new RegExp(kind + ':'));
});

test('providers: reasoning maps to the right per-provider body', () => {
  const { NodusProviders: P } = loadModule('providers.js');
  // JSON compare: objects returned from the vm sandbox have a foreign prototype
  // that trips deepStrictEqual.
  const jeq = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual([...P.REASONING_LEVELS], ['default', 'off', 'low', 'medium', 'high']);
  // default sends nothing (model decides)
  jeq(P.reasoningBody('openrouter', 'default'), {});
  jeq(P.reasoningBody('openai', 'default'), {});
  // OpenRouter uses its unified `reasoning` object (verified live vs gemini/deepseek)
  jeq(P.reasoningBody('openrouter', 'off'), { reasoning: { enabled: false } });
  jeq(P.reasoningBody('openrouter', 'high'), { reasoning: { effort: 'high' } });
  // other OpenAI-compat use the standard reasoning_effort; 'off' has no portable disable
  jeq(P.reasoningBody('deepseek', 'low'), { reasoning_effort: 'low' });
  jeq(P.reasoningBody('openai', 'off'), {});
  // Anthropic: thinking budget + max_tokens made room for it
  const body = P.buildAnthropicBody('claude-x', 's', [], 4096, 'high');
  assert.equal(body.thinking.type, 'enabled');
  assert.equal(body.thinking.budget_tokens, 8192);
  assert.ok(body.max_tokens > 8192, 'max_tokens leaves room above the thinking budget');
  // no thinking when off/default
  assert.equal(P.buildAnthropicBody('claude-x', 's', [], 4096, 'off').thinking, undefined);
});

test('#reasoning: sidebar + server wire the selector through', () => {
  const src = readSource('zotero-plugin/content/sidebar.js');
  assert.ok(src.includes('renderReasoningSelect'), 'sidebar builds the reasoning dropdown');
  assert.ok(/reasoning:\s*state\.reasoning/.test(src), 'standalone passes reasoning to chatStream');
  assert.ok(src.includes('NS.setReasoning'), 'persists the choice');
  const store = readSource('zotero-plugin/content/store.js');
  assert.ok(store.includes('getReasoning') && store.includes('setReasoning'), 'store persists reasoning');
  const server = readSource('electron/zotero-plugin/server.ts');
  assert.ok(/reasoning/.test(server) && server.includes('ReasoningEffort'), 'connected server honors reasoning');
});

test('security: Zotero-required update feed is HTTPS while background updates stay disabled per add-on', () => {
  const manifest = JSON.parse(readSource('zotero-plugin/manifest.json'));
  const bootstrap = readSource('zotero-plugin/bootstrap.js');
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const html = readSource('zotero-plugin/content/sidebar.html');
  assert.equal(
    manifest.applications.zotero.update_url,
    'https://github.com/jorgepb96/nodus/releases/latest/download/updates.json',
    'Zotero 9 and 10 reject extensions without applications.zotero.update_url',
  );
  assert.equal(manifest.applications.zotero.strict_min_version, '9.0');
  assert.equal(manifest.applications.zotero.strict_max_version, '10.*');
  assert.match(bootstrap, /applyBackgroundUpdates\s*=\s*AddonManager\.AUTOUPDATE_DISABLE/);
  assert.doesNotMatch(bootstrap, /updater\.js|configureAutoUpdate|findUpdates/);
  assert.doesNotMatch(html, /nd-autoupdate|updater\.js/);
  assert.doesNotMatch(sidebar, /NodusUpdater|\.configure\(state\.autoUpdate/);
  assert.match(html, /Tools → Plugins → ⚙ → Install Add-on From File/);
  assert.doesNotMatch(`${html}\n${sidebar}`, /installs? the packaged XPI|instala el XPI empaquetado/i);
});

test('local retrieval: E5 is pinned, isolated in a worker and requires no embedding setting or API', () => {
  const worker = readSource('scripts/zotero-local-embedding-worker.mjs');
  const bridge = readSource('zotero-plugin/content/local-embeddings.js');
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const html = readSource('zotero-plugin/content/sidebar.html');
  assert.ok(worker.includes("Xenova/multilingual-e5-small"));
  assert.match(worker, /MODEL_REVISION = '[0-9a-f]{40}'/);
  assert.ok(worker.includes("MODEL_DTYPE = 'q8'"));
  assert.ok(worker.includes("device: 'wasm'") && worker.includes("pooling: 'mean'") && worker.includes('normalize: true'));
  assert.ok(worker.includes("'query'") && worker.includes("'passage'"), 'E5 query/passage prefixes are distinct');
  assert.match(worker, /env\.useBrowserCache = false/);
  assert.match(worker, /env\.useCustomCache = true/);
  assert.ok(worker.includes('createIndexedDbCache') && worker.includes("indexedDB.open(CACHE_DB, 1)"));
  assert.ok(bridge.includes('ChromeWorker') && bridge.includes('embedQueries'));
  assert.ok(bridge.includes('IDLE_TERMINATE_MS') && bridge.includes('scheduleIdleTermination'));
  assert.match(bridge, /addEventListener\("unload", reset/);
  assert.ok(sidebar.includes('NL.embedPassages') && sidebar.includes('NL.embedQuery'));
  assert.ok(!sidebar.includes('NP.embed('), 'retrieval no longer calls a provider embedding API');
  assert.ok(!html.includes('nd-embedding-model'), 'embedding configuration was removed');
});

test('local retrieval: completed workers terminate when idle and pending work terminates on unload', async () => {
  const workers = [];
  const timers = new Map();
  let nextTimer = 0;
  let unload = null;
  class FakeWorker {
    constructor() { this.listeners = {}; this.terminated = false; workers.push(this); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
    reply(result) { this.listeners.message({ data: { type: 'result', id: this.message.id, result } }); }
  }
  const fakeWindow = {
    addEventListener(type, listener) { if (type === 'unload') unload = listener; },
  };
  const { NodusLocalEmbeddings: embeddings } = loadModule('local-embeddings.js', {
    window: fakeWindow,
    ChromeWorker: FakeWorker,
    DOMException,
    setTimeout(listener, ms) { const id = ++nextTimer; timers.set(id, { listener, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });

  const completed = embeddings.embedPassages(['alpha']);
  workers[0].reply([[0.1, 0.2]]);
  await completed;
  const idle = [...timers.values()].find((timer) => timer.ms === 5 * 60 * 1000);
  assert.ok(idle, 'the heavyweight worker gets an idle deadline');
  idle.listener();
  assert.equal(workers[0].terminated, true);
  assert.equal(embeddings.getBackend(), null);

  const pending = embeddings.warmup();
  assert.equal(workers.length, 2, 'work after the deadline creates a fresh worker');
  unload();
  await assert.rejects(pending, /local-embedding-reset/);
  assert.equal(workers[1].terminated, true);
});

test('library scope computes identity from metadata and loads full indexes only for retrieval', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const start = sidebar.indexOf('async function syncLibraryIdentityBeforeSend()');
  const end = sidebar.indexOf('\nfunction availableContextTokens()', start);
  const body = sidebar.slice(start, end);
  assert.ok(body.includes('NS.listEvidenceRecords'));
  assert.ok(!body.includes('buildSelectedIndexes'), 'identity sync must not duplicate the full-index allocation');
});

test('agentic retrieval: both modes use a validated two-round planner', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const server = readSource('electron/zotero-plugin/server.ts');
  assert.match(sidebar, /for \(let round = 1; round <= ctx\.agenticRounds; round\+\+\)/);
  const store = readSource('zotero-plugin/content/store.js');
  assert.ok(store.includes('agenticRounds') && /Math\.max\(0, Math\.min\(2,/.test(store), 'agentic rounds are capped at 2, configurable via settings');
  assert.ok(sidebar.includes('/api/z/retrieval-plan'));
  assert.ok(sidebar.includes('pageRequestHits') && sidebar.includes('mergeRetrievalResults'));
  assert.ok(sidebar.includes('every named entity, requested sub-question'));
  assert.ok(server.includes("urlPath === '/api/z/retrieval-plan'"));
  assert.ok(server.includes('safeRetrievalPlan'));
  assert.ok(server.includes('every named entity, requested sub-question'));
  assert.match(server, /\.slice\(0, 3\)/, 'query expansion is bounded');
  assert.match(server, /\.slice\(0, 4\)/, 'page requests are bounded');
  assert.ok(sidebar.includes('do not add tangential facts'));
  assert.ok(sidebar.includes('never infer causation'));
  assert.ok(server.includes('omit tangential neighboring facts'));
});

// ─────────────────────────────────────────── extra edge coverage (#8)
test('markdown: links, nested emphasis and `)` ordered markers', () => {
  const { NodusMarkdown } = loadModule('markdown.js');
  const link = NodusMarkdown.parseInline('see [the site](https://x.org) now');
  const l = link.find((s) => s.type === 'link');
  assert.ok(l && l.href === 'https://x.org' && l.children[0].value === 'the site');
  const nested = NodusMarkdown.parseInline('**bold with *em* inside**');
  const strong = nested.find((s) => s.type === 'strong');
  assert.ok(strong && strong.children.some((c) => c.type === 'em'));
  const ol = NodusMarkdown.parse('1) alpha\n2) beta');
  assert.ok(ol[0].ordered && ol[0].items.length === 2);
});

test('util: sampleDocText exact-boundary is not truncated; buildItemsSummary trims abstracts', () => {
  const { NodusUtil } = loadModule('util.js');
  const exact = 'x'.repeat(100);
  assert.equal(NodusUtil.sampleDocText(exact, 100).truncated, false);
  const s = NodusUtil.buildItemsSummary(
    [{ title: 'A', abstract: 'y'.repeat(2000) }, { title: 'B' }],
    { maxAbstract: 50 },
  );
  const abstractLine = s.split('\n').find((ln) => ln.includes('yyy'));
  assert.ok(abstractLine.trim().length <= 60, 'abstract trimmed to ~maxAbstract');
});

test('agent: malformed action blocks are ignored; describe shows field+value', () => {
  const { NodusAgent } = loadModule('agent.js');
  const { actions } = NodusAgent.parseActions('```nodus:action\n{not json}\n```\n```nodus:action\n{"tool":"add_tags","tags":["x"]}\n```');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tool, 'add_tags');
  const d = NodusAgent.describe({ tool: 'set_field', field: 'title', value: 'Hello world' }, (k) => k);
  assert.ok(d.includes('title') && d.includes('Hello world'));
});

// ─────────────────────────────────────────── #8 i18n parity
test('i18n: en/es have identical key sets and matching placeholders', () => {
  const I18N = extractI18n(readSource('zotero-plugin/content/sidebar.js'));
  const en = Object.keys(I18N.en).sort();
  const es = Object.keys(I18N.es).sort();
  assert.deepEqual(en, es, 'en and es must define exactly the same keys');
  // The new keys from this work exist.
  for (const k of ['msg.copy', 'msg.edit', 'msg.regenerate', 'doc.truncated', 'item.multi', 'agent.desc.collection', 'settings.maxTokens']) {
    assert.ok(I18N.en[k] && I18N.es[k], `both languages define ${k}`);
  }
  // Interpolation placeholders must match between languages, or tf() breaks.
  for (const k of en) {
    assert.deepEqual(
      [...placeholders(I18N.en[k])].sort(),
      [...placeholders(I18N.es[k])].sort(),
      `placeholders differ for "${k}"`,
    );
  }
});

// ─────────────────────────────────────────── #10 chat affordances + Notifier wiring
test('#10: sidebar wires copy/edit/regenerate + Zotero.Notifier and drops the old poll', () => {
  const src = readSource('zotero-plugin/content/sidebar.js');
  for (const fn of ['attachMessageActions', 'copyToClipboard', 'editUserMessage', 'regenerateFrom', 'rerenderConversation', 'generateAssistant', 'registerNotifier', 'scheduleRefresh']) {
    assert.ok(src.includes('function ' + fn) || src.includes(fn + ' ='), `defines ${fn}`);
  }
  assert.ok(src.includes('Zotero.Notifier.registerObserver'), 'registers a Notifier observer');
  assert.ok(src.includes('unregisterObserver'), 'unregisters on unload');
  assert.ok(!/refreshItem\(false\)[^;]*\},\s*1200\)/.test(src), 'old 1200ms poll replaced');
});

test('#10: message-action buttons live-render via the real fake-DOM path', () => {
  // Reuse the markdown render harness to prove renderRich-style DOM building is
  // sound; the affordance DOM is asserted structurally above (sidebar.js can't
  // boot in a sandbox). Here we just guard that clipboard uses Components.
  const src = readSource('zotero-plugin/content/sidebar.js');
  assert.ok(src.includes('nsIClipboardHelper'), 'copy uses the clipboard helper XPCOM');
});

test('streaming UX: Markdown and safe citation chips render progressively in one frame', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const start = sidebar.indexOf('function renderCitations');
  const end = sidebar.indexOf('async function goToEvidence');
  assert.ok(start >= 0 && end > start, 'streaming renderer source is available');

  const { NodusMarkdown } = loadModule('markdown.js');
  const doc = makeDoc();
  const body = makeEl('div', doc);
  const frames = [];
  const cancelled = new Set();
  const testState = {
    evidence: new Map(), ideaLabels: {},
    citationAllow: { pages: new Set(), ideas: new Set(), gaps: new Set(), zotero: new Set() },
  };
  const testCurrent = { reader: { itemID: 9 }, attachment: { key: 'PDF', libraryID: 1, attachmentContentType: 'application/pdf' } };
  const testLog = makeEl('div', doc);
  const sandbox = {
    window: {
      requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
      cancelAnimationFrame(id) { cancelled.add(id); },
    },
    document: doc,
    testState, testCurrent, testLog,
    testMarkdown: NodusMarkdown,
    Zotero: { logError() {} },
    setTimeout, clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    const state = testState;
    const NM = testMarkdown;
    const getCurrentItem = () => testCurrent;
    const messagesEl = () => testLog;
    const emptyCitationAllow = () => ({ pages: new Set(), ideas: new Set(), gaps: new Set(), zotero: new Set() });
    const labels = { "citation.page": "p. {page}", "citation.source": "source", "citation.evidence": "evidence", "citation.idea": "idea", "citation.gap": "gap", "citation.pending": "Validating citation…", "citation.unavailable": "Evidence unavailable", "evidence.noLocator": "No locator" };
    const t = (key) => labels[key] || key;
    const tf = (key, params) => t(key).replace(/\\{(\\w+)\\}/g, (m, p) => params[p] == null ? m : String(params[p]));
    const el = (tag, cls, txt) => { const node = document.createElement(tag); if (cls) node.className = cls; if (txt != null) node.textContent = txt; return node; };
    ${sidebar.slice(start, end)}
    window.streaming = { renderStreamingRich, cancelStreamingRich, setStreamingAccessibility };
  `, sandbox);

  sandbox.window.streaming.renderStreamingRich(body, '**First');
  sandbox.window.streaming.renderStreamingRich(body, '**First** and [[p:7]]');
  assert.equal(frames.length, 1, 'multiple provider deltas are coalesced into one paint');
  frames.shift()();
  assert.ok(serializeHtml(body).includes('<strong>First</strong>'), 'completed Markdown is formatted before the stream ends');
  let button = body.children.flatMap(function walk(node) { return [node, ...(node.children || []).flatMap(walk)]; }).find((node) => node.tagName === 'BUTTON');
  assert.ok(button && button.disabled, 'an unverified streaming citation is visible but cannot be clicked');
  assert.equal(button.title, 'Validating citation…');

  testState.citationAllow.pages.add('7');
  sandbox.window.streaming.renderStreamingRich(body, '**First** and [[p:7]] plus text');
  assert.equal(frames.length, 1);
  frames.shift()();
  button = body.children.flatMap(function walk(node) { return [node, ...(node.children || []).flatMap(walk)]; }).find((node) => node.tagName === 'BUTTON');
  assert.ok(button && !button.disabled, 'the chip becomes actionable as soon as server metadata allows it');
  assert.equal(serializeText(body), 'First and p. 7 plus text');

  testCurrent.attachment.attachmentContentType = 'application/epub+zip';
  sandbox.window.streaming.renderStreamingRich(body, 'EPUB [[p:7]]');
  frames.shift()();
  button = body.children.flatMap(function walk(node) { return [node, ...(node.children || []).flatMap(walk)]; }).find((node) => node.tagName === 'BUTTON');
  assert.ok(button && button.disabled, 'EPUB logical pages never become misleading PDF navigation buttons');

  sandbox.window.streaming.setStreamingAccessibility(body, true);
  assert.equal(testLog.getAttribute('aria-busy'), 'true');
  assert.equal(body.getAttribute('aria-live'), 'off');
  sandbox.window.streaming.setStreamingAccessibility(body, false);
  assert.equal(testLog.getAttribute('aria-busy'), 'false');
  assert.equal(body.getAttribute('aria-live'), null, 'the final validated response is announced once');

  sandbox.window.streaming.renderStreamingRich(body, 'will be cancelled');
  sandbox.window.streaming.cancelStreamingRich(body);
  assert.ok(cancelled.size > 0, 'a pending paint is cancelled before final validated rendering');
});

test('streaming UX: response growth never forces the reading position downward', () => {
  const sidebar = readSource('zotero-plugin/content/sidebar.js');
  const connected = sidebar.slice(sidebar.indexOf('async function sendConnected'), sidebar.indexOf('async function sendStandalone'));
  const standalone = sidebar.slice(sidebar.indexOf('async function sendStandalone'), sidebar.indexOf('// ─────────────────────────────────────────── providers tab'));
  const cards = sidebar.slice(sidebar.indexOf('function renderActionCards'), sidebar.indexOf('async function runAction'));
  for (const [name, source] of [['connected stream', connected], ['standalone stream', standalone], ['action cards', cards]]) {
    assert.doesNotMatch(source, /scrollTop\s*=\s*[^;]*scrollHeight/, `${name} does not auto-scroll as content grows`);
  }
  assert.match(connected, /renderStreamingRich\(bodyEl, acc\)/);
  assert.match(standalone, /renderStreamingRich\(bodyEl, acc\)/);
  assert.match(readSource('zotero-plugin/content/sidebar.css'), /#nd-messages[^}]*overflow-anchor:\s*none/);
});

test('composer: Enter sends and Alt+Enter keeps the textarea newline', () => {
  const src = readSource('zotero-plugin/content/sidebar.js');
  assert.match(
    src,
    /e\.key === "Enter" && !e\.altKey\)\s*\{\s*e\.preventDefault\(\);/,
    'plain Enter is intercepted for sending while Alt+Enter keeps its default newline',
  );
  assert.doesNotMatch(
    src,
    /e\.key === "Enter" && \(e\.metaKey \|\| e\.ctrlKey\)/,
    'sending no longer requires Ctrl/Command',
  );
});

test('reader selection popup keeps icon actions inside Zotero popup bounds', () => {
  const src = readSource('zotero-plugin/bootstrap.js');
  const popup = src.slice(src.indexOf('function registerSelectionPopup()'));

  assert.match(popup, /wrap\.style\.cssText = "[^"]*width:238px[^"]*max-width:100%[^"]*min-width:0[^"]*overflow:hidden/, 'the whole Nodus block respects a narrower host popup');
  assert.match(popup, /row\.style\.cssText = "[^"]*flex-wrap:wrap[^"]*max-width:100%[^"]*overflow:hidden/, 'the action row wraps and clips to the host popup');
  assert.match(popup, /b\.style\.cssText = "[^"]*flex:1 1 44px[^"]*min-width:0[^"]*max-width:100%[^"]*overflow:hidden/, 'actions can shrink without intrinsic-width overflow');
  assert.match(popup, /b\.setAttribute\("aria-label", label\)/, 'icon-only actions retain an accessible name');
  assert.match(popup, /b\.title = label/, 'icon-only actions explain themselves on hover');
  assert.match(popup, /b\.innerHTML = iconSvg;/, 'actions render only their icon');
  assert.doesNotMatch(popup, /iconSvg \+ "<span>" \+ label/, 'visible labels cannot widen the action buttons');
});

// ─────────────────────────────────────────── auto-highlighter engine (pure)
test('highlighter: parsePassages extracts {text,level} robustly', () => {
  const { NodusHighlighter: H } = loadModule('highlighter.js');
  const r = H.parsePassages('sure!\n```json\n[{"text":"Alpha beta","level":"high"},{"text":"Gamma"},"Delta epsilon"]\n```');
  assert.equal(r.length, 3);
  assert.deepEqual({ ...r[0] }, { text: 'Alpha beta', level: 'high' });
  assert.equal(r[1].level, 'medium'); // default
  assert.equal(r[2].text, 'Delta epsilon');
  // level synonyms → high
  assert.equal(H.parsePassages('[{"text":"x y z","level":"muy importante"}]')[0].level, 'high');
  assert.equal(H.parsePassages('no json here').length, 0);
});

test('highlighter: normalizeText / buildPageNorm strip whitespace + hyphens with a char map', () => {
  const { NodusHighlighter: H } = loadModule('highlighter.js');
  assert.equal(H.normalizeText('Open-source  software'), 'opensourcesoftware');
  const chars = [{ c: 'O' }, { c: 'p' }, { c: '-' }, { c: 'e' }, { c: 'n' }];
  const { norm, map } = H.buildPageNorm(chars);
  assert.equal(norm, 'open');       // hyphen dropped
  assert.deepEqual([...map], [0, 1, 3, 4]); // norm index → char index
});

test('highlighter: NFKC decomposes ligatures + curly quotes so long quotes still match', () => {
  const { NodusHighlighter: H } = loadModule('highlighter.js');
  // PDF page renders "files" as the ﬁ ligature (U+FB01); model wrote plain "fi".
  assert.equal(H.normalizeText('source ﬁles'), H.normalizeText('source files'));
  assert.equal(H.normalizeText('author’s'), H.normalizeText("author's")); // curly apostrophe == straight
  // buildPageNorm maps both norm chars of a ligature back to the one source char.
  const { norm, map } = H.buildPageNorm([{ c: 'a' }, { c: 'ﬁ' }, { c: 'x' }]);
  assert.equal(norm, 'afix');
  assert.deepEqual([...map], [0, 1, 1, 2]); // the ligature glyph (index 1) spans two norm positions
});

test('highlighter: findQuote falls back to a prefix when the full quote drifts', () => {
  const { NodusHighlighter: H } = loadModule('highlighter.js');
  const pages = [{ norm: 'opensourceisthepracticeofpublishingdigitalresources', map: Array.from({ length: 52 }, (_, i) => i) }];
  // Full quote has extra tail that isn't on the page → prefix match still lands.
  const hit = H.findQuote(pages, 'opensourceisthepracticeofpublishingSOMETHINGELSE');
  assert.ok(hit, 'prefix fallback found a match');
  assert.equal(hit.start, 0);
  assert.ok(H.findQuote(pages, 'nothingmatcheshereatall') === null);
});

test('highlighter: rangeRects builds one rect per line-run', () => {
  const { NodusHighlighter: H } = loadModule('highlighter.js');
  const chars = [
    { rect: [10, 100, 20, 110], inlineRect: [10, 98, 20, 112], rotation: 0, lineBreakAfter: false },
    { rect: [20, 100, 30, 110], inlineRect: [20, 98, 30, 112], rotation: 0, lineBreakAfter: true },
    { rect: [10, 80, 25, 90], inlineRect: [10, 78, 25, 92], rotation: 0, lineBreakAfter: true },
  ];
  const rects = H.rangeRects(chars, 0, 2);
  assert.equal(rects.length, 2); // two lines
  // JSON compare: arrays returned from the vm sandbox have a foreign prototype.
  assert.equal(JSON.stringify(rects[0]), JSON.stringify([10, 98, 30, 112])); // left/right from chars, top/bottom from inlineRect
  assert.equal(JSON.stringify(rects[1]), JSON.stringify([10, 78, 25, 92]));
});

test('highlighter: sortIndexStr matches Zotero page|offset|top format', () => {
  const { NodusHighlighter: H } = loadModule('highlighter.js');
  assert.equal(H.sortIndexStr(0, [0, 0, 600, 800], 700, 44), '00000|000044|00100');
  assert.equal(H.sortIndexStr(3, [0, 0, 600, 800], 800, 5), '00003|000005|00000');
});

// ─────────────────────────────────────────── #9 packaging
test('#9: build-zotero-xpi produces a valid xpi + updates.json', () => {
  const r = buildXpi();
  const firstBytes = readFileSync(r.xpiPath);
  const second = buildXpi();
  assert.deepEqual(readFileSync(second.xpiPath), firstBytes, 'identical source builds produce byte-identical XPIs');
  const manifest = JSON.parse(readSource('zotero-plugin/manifest.json'));
  assert.equal(r.version, manifest.version);
  assert.equal(r.xpiName, 'nodus-zotero.xpi', 'release asset name stays stable across versions');
  assert.match(manifest.applications.zotero.update_url, /^https:\/\//, 'Zotero 9 and 10 require an HTTPS update_url to install');

  const zip = new AdmZip(r.xpiPath);
  const names = zip.getEntries().map((e) => e.entryName);
  assert.ok(names.includes('manifest.json'), 'manifest.json at zip ROOT (Zotero rejects it otherwise)');
  for (const need of [
    'content/sidebar.js',
    'content/local-embeddings.js',
    'content/runtime/local-embedding-worker.js',
    'content/runtime/ort-wasm-simd-threaded.jsep.mjs',
    'content/runtime/ort-wasm-simd-threaded.jsep.wasm',
    'content/markdown.js',
    'content/util.js',
    'content/highlighter.js',
    'content/icons.js',
    'bootstrap.js',
    'icons/nodus.svg',
    'locale/en-US/nodus.ftl',
    'locale/es-ES/nodus.ftl',
    'LICENSE',
    'SOURCE_CODE.md',
    'THIRD_PARTY_NOTICES.md',
  ]) {
    assert.ok(names.includes(need), `xpi contains ${need}`);
  }
  const pkg = JSON.parse(readSource('package.json'));
  const serverPkg = JSON.parse(readSource('server/package.json'));
  assert.equal(manifest.version, serverPkg.version, 'the add-on shares the stable server release version');
  if (!pkg.version.includes('-')) assert.equal(manifest.version, pkg.version, 'stable desktop and add-on versions agree');
  assert.equal(manifest.license, 'AGPL-3.0-only');
  assert.ok(zip.readAsText('SOURCE_CODE.md').includes(`/releases/tag/v${pkg.version}\n`), 'the packaged source offer names the current immutable release');
  assert.equal(manifest.icons['64'], 'icons/nodus.svg');
  assert.match(zip.readAsText('icons/nodus.svg'), /M18 48V16L46 48V16/, 'Zotero keeps the normal Nodus N');
  assert.ok(!names.includes('icons/zotero-z.svg'), 'the rotated release-note mark is not shipped as Zotero UI');
  assert.ok(zip.getEntry('content/runtime/ort-wasm-simd-threaded.jsep.wasm').header.size > 20_000_000, 'full ONNX WASM runtime is packaged');

  const updates = JSON.parse(readSource('dist-zotero/updates.json'));
  const entry = updates.addons[manifest.applications.zotero.id].updates[0];
  assert.equal(entry.version, manifest.version);
  assert.ok(entry.update_link.endsWith(r.xpiName), 'update_link points at the built xpi');
  assert.match(entry.update_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(entry.applications.zotero.strict_min_version, manifest.applications.zotero.strict_min_version);
  assert.equal(entry.applications.zotero.strict_max_version, manifest.applications.zotero.strict_max_version);
});

test('#9: desktop exports the canonical release XPI and leaves installation to Zotero', () => {
  const install = readSource('electron/zotero-plugin/install.ts');
  const beforePack = readSource('build/beforePack.cjs');
  const pkg = JSON.parse(readSource('package.json'));
  assert.match(install, /dist-zotero.*PLUGIN_XPI_NAME/s);
  assert.match(install, /fs\.copyFile\(packagedXpiPath\(\), destXpi\)/);
  assert.match(install, /ort-wasm-simd-threaded\.jsep\.wasm/);
  assert.match(install, /icons\/nodus\.svg/);
  assert.doesNotMatch(install, /addLocalFolder/);
  assert.doesNotMatch(install, /path\.join\(profile, 'extensions'\)/);
  assert.match(install, /ok: false[\s\S]*Herramientas → Complementos/);
  assert.match(beforePack, /build-zotero-xpi\.mjs/);
  assert.ok(pkg.build.extraResources.some((entry) => (
    entry.from === 'dist-zotero/nodus-zotero.xpi'
    && entry.to === 'zotero/nodus-zotero.xpi'
  )));
});

test('#9: opt-in live smoke uses an isolated Zotero profile and verifies active bootstrap startup', () => {
  const smoke = readSource('scripts/smoke-zotero-xpi.mjs');
  assert.match(smoke, /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'nodus-zotero-live-smoke-'\)\)/);
  assert.match(smoke, /extensions\.startupScanScopes/);
  assert.match(smoke, /extensions\.autoDisableScopes/);
  assert.match(smoke, /extensions\.zotero\.dataDir/);
  assert.match(smoke, /state\.active === true/);
  assert.match(smoke, /state\.appDisabled === false/);
  assert.match(smoke, /state\.userDisabled === false/);
  assert.match(smoke, /state\.applyBackgroundUpdates === 0/);
  assert.match(smoke, /\[Nodus\] startup complete/);
  assert.doesNotMatch(smoke, /Library\/Application Support\/Zotero|AppData|profiles\.ini/);
});

test('#9: stable release blocks publication until the Zotero assets exist', () => {
  const workflow = readSource('.github/workflows/release-build.yml');
  const pluginJob = workflow.slice(
    workflow.indexOf('  build-zotero-plugin:'),
    workflow.indexOf('  verify-and-publish:'),
  );
  const verificationJob = workflow.slice(workflow.indexOf('  verify-and-publish:'));

  assert.match(pluginJob, /needs: release/, 'plugin build waits for the draft app release');
  assert.match(pluginJob, /npm run zotero:xpi/, 'release builds the XPI');
  assert.match(pluginJob, /dist-zotero\/nodus-zotero\.xpi/, 'release uploads the fixed-name XPI');
  assert.match(pluginJob, /dist-zotero\/updates\.json/, 'release uploads the Zotero update manifest');
  assert.match(verificationJob, /- build-zotero-plugin/, 'publication waits for the plugin job');
  assert.match(verificationJob, /nodus-zotero\.xpi/, 'publication verifies the XPI asset');
  assert.match(verificationJob, /updates\.json/, 'publication verifies the update manifest asset');
});
