import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installRuntimeHooks, requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-link-sections')) process.exit(0);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-link-sections-'));
const runtime = installRuntimeHooks(directory); runtime.app.on = () => {}; runtime.app.once = () => {};
const require = createRequire(import.meta.url), originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Section downloads must never call a provider'); };
let database;
try {
  database = require('../electron/db/database.ts');
  const {getActiveVault} = require('../electron/vaults/vaultRegistry.ts');
  const {seedDemoData} = require('../electron/db/demoData.ts');
  seedDemoData();
  const vault = getActiveVault();
  const {serveLiveCorpus, invalidateLiveCorpus, isReadOnlyCorpusQuery} = require('../electron/desktopBridge/liveCorpus.ts');
  async function read(section, method = 'GET') {
    let status, payload, headers;
    await serveLiveCorpus({method}, {writeHead(code, values) { status = code; headers = values; }, end(value) { payload = value; }},
      new URL('https://localhost/download'), vault.id, ['downloads', 'sections', section], undefined, ['corpus']);
    return {status, payload, headers};
  }
  const readOnly = database.getDb().prepare('SELECT COUNT(*) n FROM writing_saved_drafts').get().n;
  for (const section of ['ideas','authors','dictionary','deepResearch','graph','argument','library','podcast']) {
    const response = await read(section); assert.equal(response.status, 200, section);
    const value = JSON.parse(response.payload);
    assert.equal(value.version, 1); assert.equal(value.section, section); assert.equal(value.snapshot.vault.id, vault.id);
    assert.equal(value.snapshot.embeddingIndex, null); assert.equal(value.snapshot.library, undefined);
    assert.equal((value.snapshot.tables.passages ?? []).length, 0); assert.equal((value.snapshot.tables.notes ?? []).length, 0);
    const head = await read(section, 'HEAD'); assert.equal(head.status, 200); assert.equal(head.payload, undefined);
    assert.equal(head.headers['x-nodus-revision'], response.headers['x-nodus-revision']);
    invalidateLiveCorpus(vault.id);
    assert.equal((await read(section)).headers['x-nodus-revision'], response.headers['x-nodus-revision'], 'A fresh build is deterministic');
    if (['graph','ideas','argument'].includes(section)) assert(value.graph.nodes.length > 0);
    if (section === 'deepResearch') assert(value.snapshot.tables.writing_saved_drafts.length > 0);
  }
  assert.equal((await read('../../notes')).status, 400);
  assert.equal(database.getDb().prepare('SELECT COUNT(*) n FROM writing_saved_drafts').get().n, readOnly);
  assert(isReadOnlyCorpusQuery('POST', 'search/related')); assert(!isReadOnlyCorpusQuery('DELETE', 'search/related'));
  console.log(JSON.stringify({passed: true, sections: 8, deterministicRevisions: true, headWithoutBody: true, providerCalls: 0}));
} finally {
  globalThis.fetch = originalFetch; database?.closeDb(); runtime.restore(); fs.rmSync(directory, {recursive: true, force: true});
}
