// PR #998 regression: the real header keeps its React state when it renders null.
// Clearing the last source must not leave an anchor that reopens a later popover.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeContext, flush } from './drift-audio-fakes.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const ts = require('typescript');
const { build } = require('esbuild');
const defineGlobal = (key, value) => Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });

// react-dom checks DOM support at import time, before each test makes its own window.
const bootstrap = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://nodus.test/' });
for (const [key, value] of Object.entries({ window: bootstrap.window, document: bootstrap.window.document, navigator: bootstrap.window.navigator })) defineGlobal(key, value);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const act = React.act ?? require('react-dom/test-utils').act;
const h = React.createElement;

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-drift-anchor-'));
await symlink(path.join(repoRoot, 'node_modules'), path.join(outDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
test.after(async () => { bootstrap.window.close(); await rm(outDir, { recursive: true, force: true }); });

// Extract the actual two header functions, not a hand-written approximation of their
// lifecycle. Bundling App wholesale would load unrelated vault and database views.
const appPath = path.join(repoRoot, 'src/App.tsx');
const app = ts.createSourceFile(appPath, readFileSync(appPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function productionFunction(name) {
  const node = app.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `${name} still exists in App.tsx`);
  return node.getText(app);
}
const from = (file) => JSON.stringify(path.join(repoRoot, file).replaceAll('\\', '/'));
const entry = path.join(outDir, 'harness.tsx');
await writeFile(entry, `
import * as React from 'react';
import { useState } from 'react';
import { Icon } from ${from('src/components/ui')};
import { t } from ${from('src/i18n')};
import { BrowserMediaPopover, BrowserMediaProvider, useBrowserMedia } from ${from('src/components/browser/BrowserMedia')};
import { DriftProvider, useDrift } from ${from('src/components/drift/DriftProvider')};
import { DriftMiniPlayer } from ${from('src/components/drift/DriftMiniPlayer')};
import { AudioPlayerProvider, useAudioPlayer } from ${from('src/components/AudioPlayer')};
import { NarrationMiniPlayer } from ${from('src/components/narration/NarrationMiniPlayer')};
${productionFunction('HeaderAction')}
${productionFunction('BrowserMediaHeaderAction')}
export { BrowserMediaProvider, DriftProvider, AudioPlayerProvider };
export const Header = BrowserMediaHeaderAction;
export const probe: { current: ReturnType<typeof useDrift> | null } = { current: null };
export function Probe() { probe.current = useDrift(); return null; }
`);
const bundle = path.join(outDir, 'harness.cjs');
await build({
  entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'es2022', jsx: 'automatic',
  absWorkingDir: repoRoot, tsconfig: path.join(repoRoot, 'tsconfig.json'), alias: { '@shared': path.join(repoRoot, 'shared') },
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'], logLevel: 'silent',
});
const harness = require(bundle);

const SOUND = {
  id: 'white-noise', nameKey: 'Ruido blanco', descriptionKey: 'Ruido blanco', categoryId: 'noise', icon: 'waveform',
  source: { kind: 'noise', color: 'white' }, availability: 'available',
  provenance: { licenseStatus: 'verified', licenseId: 'AGPL-3.0-only', evidenceRefs: ['test'], distributionReview: 'approved', reviewRef: 'test' },
};
const SESSION = {
  tabId: 'test-tab', title: 'Test audio', url: 'https://example.test/', origin: 'https://example.test', faviconDataUrl: null,
  hasMedia: true, playing: false, audible: false, muted: false, canPlayPause: true, kind: 'audio',
};

function environment(t, { browser = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://nodus.test/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Event: dom.window.Event })) defineGlobal(key, value);
  const calls = { overlay: [], freeze: 0, device: [], browser: [] };
  defineGlobal('AudioContext', class extends FakeContext { constructor() { super({ sampleRate: 8000 }); } });
  let notifyBrowser = () => {};
  dom.window.nodus = {
    getDriftCatalog: async () => ({ schemaVersion: 1, sounds: [structuredClone(SOUND)] }),
    readDriftAudio: async () => { throw new Error('This test uses generated audio only'); },
    getBrowserMedia: async () => browser ? [structuredClone(SESSION)] : [],
    onBrowserMediaChanged: (cb) => { notifyBrowser = cb; return () => { notifyBrowser = () => {}; }; },
    captureBrowserOverlaySnapshot: async () => { calls.freeze += 1; return null; },
    setBrowserOverlayVisible: async (visible) => { calls.overlay.push(visible); },
    getBrowserDeviceVolume: async () => 40,
    setBrowserDeviceVolume: async (value) => { calls.device.push(value); },
    browserMediaCommand: async (...args) => { calls.browser.push(args); },
    // The narration player shares the header button; it only reads the saved speed here.
    getSettings: async () => ({ audioSpeed: 1 }),
  };
  const root = createRoot(dom.window.document.getElementById('root'));
  t.after(async () => { await act(async () => { root.unmount(); await flush(); }); dom.window.close(); });
  const settle = async () => { await act(async () => { await flush(); }); };
  const q = (selector) => dom.window.document.querySelector(selector);
  return {
    calls, q, settle,
    async render(strict) {
      const tree = h(harness.AudioPlayerProvider, null, h(harness.BrowserMediaProvider, null, h(harness.DriftProvider, null,
        h(harness.Probe), h(harness.Header, { onOpenTab: () => {}, onOpenDrift: () => {} }))));
      await act(async () => { root.render(strict ? h(React.StrictMode, null, tree) : tree); });
      await settle();
      await act(async () => { await harness.probe.current.loadCatalog(); });
    },
    async select() { await act(async () => { harness.probe.current.toggleSound('white-noise'); await flush(); }); await settle(); },
    async click(selector) {
      const element = q(selector);
      assert.ok(element, `element exists: ${selector}`);
      await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await flush(); });
      await settle();
    },
    async browserSessions(sessions) { await act(async () => { notifyBrowser(sessions); await flush(); }); await settle(); },
  };
}

for (const strict of [false, true]) {
  test(`clearing the last Drift voice forgets the detached anchor (StrictMode=${strict})`, async (t) => {
    const env = environment(t);
    await env.render(strict);
    await env.select();
    await env.click('[data-testid="browser-media-header-action"] > button');
    assert.ok(env.q('[data-testid="drift-mini-player"]'));
    const oldButton = env.q('[data-testid="browser-media-header-action"] > button');
    await env.click('[data-testid="drift-mini-clear"]');
    assert.equal(oldButton.isConnected, false);
    assert.equal(env.q('[data-testid="browser-media-header-action"]'), null);
    assert.equal(env.q('[data-testid="browser-media-popover"]'), null);
    assert.equal(env.calls.overlay.at(-1), false);

    await env.select();
    assert.ok(env.q('[data-testid="browser-media-header-action"]'));
    assert.equal(env.q('[data-testid="browser-media-popover"]'), null, 'a new selection must not reopen the old popover');
    await env.click('[data-testid="browser-media-header-action"] > button');
    assert.ok(env.q('[data-testid="drift-mini-player"]'), 'the new trigger opens normally');
    const captures = env.calls.freeze;
    await act(async () => { harness.probe.current.setMaster(0.6); await flush(); });
    assert.ok(env.q('[data-testid="drift-mini-player"]'));
    assert.equal(env.calls.freeze, captures, 'ordinary mix updates do not restart the overlay effect');
    assert.deepEqual(env.calls.device, []);
    assert.deepEqual(env.calls.browser, []);
  });
}

test('clearing Drift leaves an existing Browser session and the chosen tab alone', async (t) => {
  const env = environment(t, { browser: true });
  await env.render(true);
  await env.select();
  await env.click('[data-testid="browser-media-header-action"] > button');
  await env.click('[data-testid="media-source-tab-drift"]');
  const captures = env.calls.freeze;
  await env.click('[data-testid="drift-mini-clear"]');
  assert.ok(env.q('[data-testid="browser-media-header-action"]'));
  assert.ok(env.q('[data-testid="browser-media-popover"]'));
  assert.equal(env.q('[data-testid="media-source-tab-drift"]').getAttribute('aria-selected'), 'true');
  assert.equal(env.calls.freeze, captures, 'a connected trigger is not closed or refrozen');
  assert.deepEqual(env.calls.device, []);
  assert.deepEqual(env.calls.browser, []);

  // Ending the remaining Browser session removes the very same trigger. A later
  // Browser session also must not inherit its detached anchor.
  await env.browserSessions([]);
  assert.equal(env.q('[data-testid="browser-media-header-action"]'), null);
  await env.browserSessions([structuredClone(SESSION)]);
  assert.ok(env.q('[data-testid="browser-media-header-action"]'));
  assert.equal(env.q('[data-testid="browser-media-popover"]'), null);
});
