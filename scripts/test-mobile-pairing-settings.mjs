import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// Render the production settings and confirmation components in an isolated DOM.
// This tests interaction contracts, not layout or real Mac/device acceptance.
const cache = path.resolve('node_modules/.cache');
mkdirSync(cache, { recursive: true });
const folder = mkdtempSync(path.join(cache, 'nodus-pairing-settings-'));
const require = createRequire(import.meta.url);
const React = require('react');
const { act } = React;
const dom = new JSDOM('<div id="root"></div>', { url: 'https://nodus.test', pretendToBeVisual: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement, Element: dom.window.Element,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const statusPolls = [];
const originalInterval = window.setInterval.bind(window);
window.setInterval = (callback, delay, ...args) => {
  if (delay === 3_000) statusPolls.push(callback);
  return originalInterval(callback, delay, ...args);
};
const { createRoot } = require('react-dom/client');
const root = createRoot(document.getElementById('root'));
const older = { id: 'older-id', deviceId: 'old', deviceName: 'Same phone', vaultIds: ['vault-a'], domains: ['corpus'], createdAt: '2026-10-01T10:00:00Z', expiresAt: null, lastSeenAt: null, revokedAt: null };
const recent = { ...older, id: 'recent-id', deviceId: 'new', vaultIds: ['vault-a', 'vault-b'], domains: ['corpus', 'writing'], lastSeenAt: '2026-10-09T20:00:00Z' };
const expired = { ...older, id: 'expired-id', deviceName: 'Expired phone', expiresAt: '2000-01-01T00:00:00Z' };
let pairings = [older, expired, { ...older, id: 'revoked-id', revokedAt: '2026-10-09T19:00:00Z' }, recent];
const creates = [], revocations = [];
window.nodus = {
  listVaults: async () => [{ id: 'vault-a', name: 'Principal', active: true }, { id: 'vault-b', name: 'Other', active: false }],
  getDesktopBridgeStatus: async () => ({ running: true, pairings, error: null }),
  createDesktopBridgeOffer: async (vaults, domains, id, transport) => {
    creates.push({ vaults, domains, id, transport });
    const p = id ? pairings.find(p => p.id === id) : { vaultIds: vaults, domains };
    return { id: 'offer-id', renewalPairingId: id, vaultIds: p.vaultIds, domains: p.domains, code: 'TEST-CODE',
      expiresAt: '2030-01-01T00:00:00Z', pairingURL: 'nodus://pair?fixture=nonsecret' };
  },
  revokeDesktopBridgePairing: async id => { revocations.push(id); pairings = pairings.map(p => p.id === id ? { ...p, revokedAt: '2026-10-09T20:10:00Z' } : p); },
};
const click = async element => { assert.ok(element); await act(async () => { element.click(); }); };
const byText = text => [...document.querySelectorAll('button')].find(button => button.textContent === text);
async function settled(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.ok(predicate(), 'The production asynchronous action must settle.');
}
try {
  const bundle = path.join(folder, 'settings.cjs');
  await build({ entryPoints: ['src/components/MobilePairingSettings.tsx'], bundle: true, format: 'cjs', platform: 'node',
    packages: 'external', jsx: 'automatic', outfile: bundle, logLevel: 'silent' });
  const { MobilePairingSettings } = require(bundle);
  await act(async () => { root.render(React.createElement(MobilePairingSettings)); });
  assert.equal(document.querySelectorAll('li').length, 3, 'Revoked grants are excluded; expired grants remain manageable.');
  assert.match(document.querySelector('li').textContent, /recent-i/);
  assert.match(document.querySelector('h4').textContent, /· 2$/, 'Expired grants must not count as connected.');
  const expiredRow = [...document.querySelectorAll('li')].find(row => row.textContent.includes('Expired phone'));
  assert.equal(expiredRow.querySelector('button').disabled, true, 'Expired grants cannot be renewed.');
  assert.match(document.querySelector('li details').textContent, /Consulta del corpus.*Escritura e ideas/);
  assert.equal(document.querySelectorAll('input[type=checkbox]').length, 0, 'The primary flow must not ask users to select vaults or permissions.');
  await click(byText('Generar código y QR'));
  await settled(() => !byText('Renovar código')?.disabled);
  assert.deepEqual(creates[0].vaults, ['vault-a', 'vault-b'], 'Pair the complete workspace, including inactive vaults.');
  assert.equal(creates[0].transport, 'direct', 'The primary flow connects over LAN/VPN without waiting for Server/Cloud.');
  assert.deepEqual(creates[0].domains, ['corpus', 'writing', 'research-generation', 'testimonies', 'teaching-roster', 'teaching-grades', 'study-recordings', 'primary-source-files', 'prosopography-private']);
  pairings = [...pairings, { ...older, id: 'offer-id', deviceName: 'Just paired phone', createdAt: '2026-10-09T20:01:00Z' }];
  assert.equal(document.querySelectorAll('li').length, 3);
  assert.equal(statusPolls.length, 1);
  await act(async () => { statusPolls[0](); });
  assert.equal(document.querySelectorAll('li').length, 4, 'A newly linked phone appears without pressing Refresh.');
  assert.match(document.querySelector('[role=status]').textContent, /Just paired phone se ha vinculado/);
  assert.equal(document.querySelector('img'), null, 'A consumed QR must be replaced with a successful pairing confirmation.');
  assert.ok(byText('Generar código y QR'));

  const search = document.querySelector('input[type=search]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(search, 'recent-id');
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  assert.equal(document.querySelectorAll('li').length, 1, 'The connection ID distinguishes duplicate device names.');
  await click(byText('Renovar conexión'));
  assert.equal(creates[1].id, recent.id);
  assert.equal(creates[1].transport, 'direct');
  assert.deepEqual(creates[1].vaults, ['vault-a', 'vault-b']);
  assert.match(document.querySelector('[role=status]').textContent, /Same phone/);
  assert.equal(document.querySelectorAll('input[type=checkbox]').length, 0, 'A renewal cannot edit vaults or permissions.');
  await settled(() => !byText('Nueva vinculación')?.disabled);
  await click(byText('Nueva vinculación'));
  await click(byText('Revocar'));
  let dialog = document.querySelector('[role=dialog]');
  assert.ok(dialog); assert.match(dialog.textContent, /todas las bóvedas y permisos/);
  assert.equal(document.activeElement.textContent, 'Cancelar', 'Confirmation is cancel-first.');
  await click([...dialog.querySelectorAll('button')].find(button => button.textContent === 'Cancelar'));
  assert.equal(revocations.length, 0); assert.equal(document.querySelector('[role=dialog]'), null);
  await click(byText('Revocar'));
  dialog = document.querySelector('[role=dialog]');
  await click([...dialog.querySelectorAll('button')].find(button => button.textContent === 'Revocar'));
  assert.deepEqual(revocations, [recent.id]); assert.equal(document.querySelectorAll('li').length, 0);
  assert.match(document.querySelector('[role=status]').textContent, /No hay dispositivos/);
  console.log(JSON.stringify({ suite: 'mobile-pairing-settings', passed: true, scope: 'production components in JSDOM; real-device and visual acceptance excluded', automaticDeviceRefresh: true, sorting: true, permissions: true, expired: true, search: true, stableRenewalSelection: true, cancelFirstRevocation: true }));
} finally {
  await act(async () => root.unmount()); dom.window.close(); rmSync(folder, { recursive: true, force: true });
}
