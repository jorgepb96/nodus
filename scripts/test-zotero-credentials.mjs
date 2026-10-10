// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const storeSource = readFileSync(new URL('../zotero-plugin/content/store.js', import.meta.url), 'utf8');
function credentialStore({ async = true, prefs = new Map(), beforeAdd = () => {}, failRemove = false } = {}) {
  const logins = [];
  const calls = { async: 0, sync: 0, modify: 0 };
  const manager = {
    findLogins: () => logins,
    addLogin(login) {
      calls.sync++;
      if (async) throw new Error('NS_ERROR_XPC_JSOBJECT_HAS_NO_FUNCTION_NAMED');
      logins.push(login);
    },
    modifyLogin(existing, next) { calls.modify++; Object.assign(existing, next); },
    removeLogin(login) {
      if (failRemove) throw new Error('credential store locked');
      logins.splice(logins.indexOf(login), 1);
    },
  };
  if (async) manager.addLoginAsync = async (login) => {
    calls.async++;
    await beforeAdd();
    logins.push(login);
  };
  const Zotero = { Prefs: { get: (key) => prefs.get(key), set: (key, value) => prefs.set(key, value) } };
  const sandbox = {
    window: {},
    ChromeUtils: { importESModule: () => ({ Zotero }) },
    Services: { logins: manager },
    Components: {
      classes: { '@mozilla.org/login-manager/loginInfo;1': { createInstance: () => ({
        init(origin, form, realm, username, password) { Object.assign(this, { origin, realm, username, password }); },
      }) } },
      interfaces: { nsILoginInfo: {} },
    },
  };
  vm.runInNewContext(storeSource, sandbox, { filename: 'store.js' });
  return { store: sandbox.window.NodusStore, logins, calls, prefs };
}

for (const async of [true, false]) {
  test(`credentials: first save, update and delete with ${async ? 'Zotero 10 async' : 'legacy sync'} Login Manager`, async () => {
    const { store, logins, calls, prefs } = credentialStore({ async });
    assert.equal(await store.setKey('openai', 'first-secret'), true);
    assert.equal(await store.getKey('openai'), 'first-secret');
    assert.equal(await store.setKey('openai', 'updated-secret'), true);
    assert.equal(await store.getKey('openai'), 'updated-secret');
    assert.equal(logins.length, 1);
    assert.equal(calls.modify, 1);
    assert.equal(calls.async, async ? 1 : 0);
    assert.equal(calls.sync, async ? 0 : 1);
    assert.equal(prefs.get('nodus.key.openai'), '');
    assert.equal(await store.setKey('openai', ''), true);
    assert.equal(await store.getKey('openai'), '');
    assert.equal(logins.length, 0);
    assert.equal(await store.setManual(4321, 'bridge-secret'), true);
    assert.equal((await store.getManual()).token, 'bridge-secret');
    assert.equal((await store.getManual()).port, 4321);
    assert.equal(await store.setManual(4322, 'updated-bridge-secret'), true);
    assert.equal((await store.getManual()).token, 'updated-bridge-secret');
    assert.equal(prefs.get('nodus.token'), '');
    assert.equal(await store.setManual(0, ''), true);
    assert.equal((await store.getManual()).token, '');
    assert.equal(logins.length, 0);
  });
}

test('credentials: plaintext migration waits for encrypted persistence before clearing preferences', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const prefs = new Map([['nodus.key.openai', 'legacy-secret'], ['nodus.token', 'legacy-bridge'], ['nodus.port', 4321]]);
  const { store, logins } = credentialStore({ prefs, beforeAdd: () => pending });
  const key = store.getKey('openai');
  const manual = store.getManual();
  await Promise.resolve();
  assert.equal(prefs.get('nodus.key.openai'), 'legacy-secret');
  assert.equal(prefs.get('nodus.token'), 'legacy-bridge');
  assert.equal(logins.length, 0);
  finish();
  assert.equal(await key, 'legacy-secret');
  assert.equal((await manual).token, 'legacy-bridge');
  assert.equal(prefs.get('nodus.key.openai'), '');
  assert.equal(prefs.get('nodus.token'), '');
  assert.equal(logins.length, 2);
});

test('credentials: rejected async writes report failure and preserve legacy secrets and port', async () => {
  const prefs = new Map([['nodus.key.openai', 'legacy-secret'], ['nodus.token', 'legacy-bridge'], ['nodus.port', 4321]]);
  const { store, logins, calls } = credentialStore({ prefs, beforeAdd: () => { throw new Error('credential store locked'); } });
  assert.equal(await store.setKey('openai', 'new-secret'), false);
  assert.equal(await store.setManual(1234, 'new-bridge'), false);
  assert.equal(await store.getKey('openai'), '');
  assert.equal((await store.getManual()).token, '');
  assert.equal(prefs.get('nodus.key.openai'), 'legacy-secret');
  assert.equal(prefs.get('nodus.token'), 'legacy-bridge');
  assert.equal(prefs.get('nodus.port'), 4321);
  assert.equal(logins.length, 0);
  assert.equal(calls.sync, 0, 'a rejected async API must not fall back to the obsolete sync API');
});

test('credentials: failed deletion is reported and retains encrypted secrets', async () => {
  const { store } = credentialStore({ async: false, failRemove: true });
  assert.equal(await store.setKey('openai', 'saved-secret'), true);
  assert.equal(await store.setManual(4321, 'saved-bridge'), true);
  assert.equal(await store.setKey('openai', ''), false);
  assert.equal(await store.setManual(0, ''), false);
  assert.equal(await store.getKey('openai'), 'saved-secret');
  assert.equal((await store.getManual()).token, 'saved-bridge');
  assert.equal((await store.getManual()).port, 4321);
});

function credentialSidebar(store) {
  const dom = new JSDOM(readFileSync(new URL('../zotero-plugin/content/sidebar.html', import.meta.url), 'utf8'));
  const calls = { models: [], connected: 0, toasts: [] };
  dom.window.NodusStore = store;
  dom.window.NodusProviders = {
    PROVIDERS: [{ id: 'openai', label: 'OpenAI', needsKey: true }],
    listModels: async (provider, options) => { calls.models.push(options.key); return []; },
  };
  const sandbox = {
    window: dom.window, document: dom.window.document,
    ChromeUtils: { importESModule: () => ({ Zotero: {} }) },
    setInterval: dom.window.setInterval.bind(dom.window),
    clearInterval: dom.window.clearInterval.bind(dom.window),
    calls,
  };
  vm.createContext(sandbox);
  // Exercise the real settings handlers without starting the unrelated item,
  // evidence and connection watchers that boot() normally starts in Zotero.
  const source = readFileSync(new URL('../zotero-plugin/content/sidebar.js', import.meta.url), 'utf8');
  vm.runInContext(source.slice(0, source.lastIndexOf('\nboot().catch(')), sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  run('showToast = (text) => calls.toasts.push(text); showConfirm = async () => true; connect = async () => { calls.connected++; }; loadModelsForMode = async () => {}; scheduleConnectionCheck = () => {};');
  return { dom, calls, run, document: dom.window.document };
}
const settleEvents = () => new Promise((resolve) => setImmediate(resolve));

test('credentials sidebar: loading models waits for the first encrypted save', async (t) => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const { store } = credentialStore({ beforeAdd: () => pending });
  const { dom, calls, run, document } = credentialSidebar(store);
  t.after(() => dom.window.close());
  await run('renderProviders()');
  const input = document.querySelector('.nd-prov-keyrow input');
  const dot = document.querySelector('.nd-prov-dot');
  const deleteButton = document.querySelector('.nd-prov-del');
  input.value = 'new-secret';
  input.dispatchEvent(new dom.window.Event('change'));
  document.querySelector('.nd-prov-actions button').click();
  await settleEvents();
  assert.equal(input.disabled, true);
  assert.equal(dot.classList.contains('nd-prov-dot--on'), false);
  assert.equal(deleteButton.style.display, 'none');
  assert.deepEqual(calls.models, []);
  finish();
  await settleEvents();
  assert.equal(input.disabled, false);
  assert.equal(dot.classList.contains('nd-prov-dot--on'), true);
  assert.equal(deleteButton.style.display, '');
  assert.deepEqual(calls.models, ['new-secret']);
  assert.deepEqual(calls.toasts, []);
  deleteButton.click();
  await settleEvents();
  assert.equal(await store.getKey('openai'), '');
  assert.equal(input.value, '');
  assert.equal(deleteButton.style.display, 'none');
  assert.equal(dot.classList.contains('nd-prov-dot--on'), false);
});

test('credentials sidebar: rejected saves and deletions restore the actual stored state', async (t) => {
  const { store } = credentialStore({ beforeAdd: () => { throw new Error('credential store locked'); } });
  const { dom, calls, run, document } = credentialSidebar(store);
  t.after(() => dom.window.close());
  await run('renderProviders()');
  const input = document.querySelector('.nd-prov-keyrow input');
  input.value = 'unsaved-secret';
  input.dispatchEvent(new dom.window.Event('change'));
  await settleEvents();
  assert.equal(input.value, '');
  assert.equal(document.querySelector('.nd-prov-dot').classList.contains('nd-prov-dot--on'), false);
  assert.match(calls.toasts[0], /secret was not saved/);

  const saved = credentialStore({ async: false, failRemove: true });
  await saved.store.setKey('openai', 'saved-secret');
  // The sidebar module keeps this same store object throughout its lifecycle.
  Object.assign(store, saved.store);
  await run('renderProviders()');
  document.querySelector('.nd-prov-del').click();
  await settleEvents();
  assert.equal(document.querySelector('.nd-prov-keyrow input').value, 'saved-secret');
  assert.equal(document.querySelector('.nd-prov-dot').classList.contains('nd-prov-dot--on'), true);
  assert.equal(calls.toasts.length, 2);
});

for (const fail of [false, true]) {
  test(`credentials sidebar: manual connection ${fail ? 'stops on rejection' : 'waits for persistence'}`, async (t) => {
    let finish;
    const pending = new Promise((resolve, reject) => { finish = fail ? reject : resolve; });
    const { store } = credentialStore({ beforeAdd: () => pending });
    const { dom, calls, run, document } = credentialSidebar(store);
    t.after(() => dom.window.close());
    run('wire()');
    document.querySelector('#nd-port').value = '4321';
    document.querySelector('#nd-token').value = 'manual-secret';
    document.querySelector('#nd-test').click();
    await settleEvents();
    assert.equal(calls.connected, 0);
    finish(fail ? new Error('credential store locked') : undefined);
    await settleEvents();
    assert.equal(calls.connected, fail ? 0 : 1);
    assert.equal((await store.getManual()).token, fail ? '' : 'manual-secret');
    if (fail) assert.match(calls.toasts[0], /secret was not saved/);
  });
}
