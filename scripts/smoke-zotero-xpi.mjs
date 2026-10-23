#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Opt-in live Zotero smoke test. It launches the real Zotero binary with a
// disposable profile, enables foreign-extension scanning only in that profile,
// and proves that the built XPI is registered, active and actually reaches its
// bootstrap startup, opens its evidence database, persists encrypted credentials
// and item conversation history across a restart, and exits normally. The user's
// Zotero profile and library are never opened.
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argValue = (name) => {
  const exact = process.argv.indexOf(name);
  if (exact >= 0) return process.argv[exact + 1];
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
};
const embeddingSwitchSmoke = process.argv.includes('--embedding-switch-smoke');
const embeddingBenchmark = process.argv.includes('--embedding-benchmark');
const benchmarkOutput = path.resolve(argValue('--benchmark-output') || path.join(repoRoot, 'audit/zotero-embeddings/native-results.json'));
const benchmarkFixture = JSON.parse(readFileSync(path.join(repoRoot, 'scripts/fixtures/zotero-embeddings/retrieval.json'), 'utf8'));
const keepProfile = process.argv.includes('--keep-profile');
const timeoutMs = Number(argValue('--timeout-ms') || process.env.ZOTERO_SMOKE_TIMEOUT_MS || 90_000);
const xpiPath = path.resolve(argValue('--xpi') || path.join(repoRoot, 'dist-zotero', 'nodus-zotero.xpi'));
const defaultBins = {
  darwin: '/Applications/Zotero.app/Contents/MacOS/zotero',
  win32: 'C:\\Program Files\\Zotero\\zotero.exe',
  linux: '/usr/bin/zotero',
};
const zoteroBin = argValue('--zotero-bin') || process.env.ZOTERO_BIN || defaultBins[process.platform];

if (!zoteroBin || !existsSync(zoteroBin)) throw new Error(`Zotero binary not found: ${zoteroBin || '(unset)'}`);
if (!existsSync(xpiPath)) throw new Error(`XPI not found: ${xpiPath}`);
if (!Number.isFinite(timeoutMs) || timeoutMs < 5_000) throw new Error('--timeout-ms must be at least 5000');

const zip = new AdmZip(xpiPath);
for (const entry of zip.getEntries()) if (!entry.isDirectory) entry.getData();
const manifest = JSON.parse(zip.readAsText('manifest.json'));
const addon = manifest.applications?.zotero ?? {};
if (!addon.id || !manifest.version || !/^https:\/\//.test(addon.update_url ?? '')) {
  throw new Error('XPI manifest must include version, applications.zotero.id and the Zotero-required HTTPS update_url');
}

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'nodus-zotero-live-smoke-'));
const dataDir = path.join(profileDir, 'data');
const extensionsDir = path.join(profileDir, 'extensions');
const installedXpi = path.join(extensionsDir, `${addon.id}.xpi`);
mkdirSync(dataDir, { recursive: true });
mkdirSync(extensionsDir, { recursive: true });
cpSync(xpiPath, installedXpi);
// A separate diagnostic add-on requests a normal quit only after the host has
// verified startup. It never closes Nodus resources itself: that is the test.
const quitRequestPath = path.join(profileDir, 'request-normal-quit');
const driver = new AdmZip();
const driverID = 'nodus-live-smoke@example.invalid';
driver.addFile('manifest.json', Buffer.from(JSON.stringify({
  manifest_version: 2, name: 'Nodus isolated smoke driver', version: '1.0',
  applications: { zotero: {
    id: driverID, strict_min_version: '9.0', strict_max_version: '10.*',
    update_url: 'https://example.invalid/updates.json',
  } },
})));
driver.addFile('bootstrap.js', Buffer.from(`
var timer;
function install() {}
function uninstall() {}
function onMainWindowLoad() {}
function onMainWindowUnload() {}
function shutdown() { if (timer) clearTimeout(timer); }
function startup() {
  async function check() {
    try {
      if (await IOUtils.exists(${JSON.stringify(quitRequestPath)})) {
        await Zotero.uiReadyPromise;
        const win = Zotero.getMainWindow();
        const store = win?.document.getElementById('nodus-sidebar-frame')?.contentWindow?.NodusStore;
        // Bootstrap finishes before the sidebar's content scripts necessarily do.
        if (!store || !win.document.getElementById('nodus-tb-button')) {
          timer = setTimeout(check, 250);
          return;
        }
        const stats = await store.evidenceCacheStats();
        if (!(await IOUtils.exists(stats.database))) throw new Error('Evidence database missing');
        const phase = await IOUtils.readUTF8(${JSON.stringify(quitRequestPath)});
        function expect(value, message) { if (!value) throw new Error(message); }
        if (phase === 'save-credentials' && ${embeddingSwitchSmoke}) {
          const frame = win.document.getElementById('nodus-sidebar-frame').contentWindow;
          const embeddings = frame.NodusLocalEmbeddings;
          const catalog = frame.NodusEmbeddingModels;
          const waitUntil = async (fn) => { const deadline = Date.now() + 90000; while (!fn()) { if (Date.now() > deadline) throw new Error('Model switch timeout'); await new Promise(r => setTimeout(r, 100)); } };
          embeddings.select('e5-small'); store.setEmbeddingModel('e5-small');
          const vector = (await embeddings.embedPassages(['Allocation concealment prevents prediction of treatment assignment.']))[0];
          const index = { libraryID: Zotero.Libraries.userLibraryID, attachmentKey: 'EMBEDQA1', itemKey: 'ITEMQA01', signature: 'qa-v1', version: 1, title: 'QA controlled passage', totalPages: 1, totalChars: 75, pages: [], chunks: [{ id: 'qa', text: 'Allocation concealment prevents prediction of treatment assignment.', embedding: vector, embeddingModel: embeddings.MODEL.fingerprint }] };
          expect(await store.saveEvidenceIndex(index), 'Initial vector save');
          const select = frame.document.getElementById('nd-embedding-model');
          const apply = frame.document.getElementById('nd-embedding-apply');
          select.value = 'granite-97m'; apply.click();
          await waitUntil(() => !apply.disabled);
          expect(store.getEmbeddingModel() === 'granite-97m', 'Granite activation');
          const saved = await store.loadEvidenceIndex(index.libraryID, index.attachmentKey);
          catalog.useIndex(saved, catalog.get('e5-small'));
          expect(saved.chunks[0].embedding.every((v,i) => Math.abs(v-vector[i]) < 0.000001), 'Old vectors preserved');
          select.value = 'e5-small'; apply.click();
          await waitUntil(() => !apply.disabled);
          expect(store.getEmbeddingModel() === 'e5-small', 'Return to saved model');
          select.value = 'harrier-270m'; apply.click();
          frame.document.getElementById('nd-stop').click();
          await waitUntil(() => !apply.disabled);
          expect(store.getEmbeddingModel() === 'e5-small', 'Cancellation preserves active model');
          await store.deleteEvidenceIndex(index.libraryID, index.attachmentKey);
          embeddings.reset();
          Zotero.debug('[Nodus smoke] embedding activation, binary reuse and cancellation passed');
        }
        if (phase === 'save-credentials' && ${embeddingBenchmark}) {
          const embeddings = win.document.getElementById('nodus-sidebar-frame').contentWindow.NodusLocalEmbeddings;
          const fixture = ${JSON.stringify(benchmarkFixture)};
          const report = { runtime: 'Zotero ' + Zotero.version, backend: 'wasm', fixture: fixture.description, models: [] };
          for (const model of embeddings.MODELS) {
            embeddings.select(model.key);
            const row = { key: model.key, contract: model.fingerprint };
            try {
              let peak = null;
              const sample = () => { try { const manager = Components.classes["@mozilla.org/memory-reporter-manager;1"].getService(Components.interfaces.nsIMemoryReporterManager); peak = Math.max(peak || 0, manager.resident); } catch (e) {} };
              sample();
              const start = Date.now();
              await embeddings.embedQuery(fixture.queries[0].text);
              row.coldQueryMs = Date.now() - start;
              sample();
              const docStart = Date.now();
              const vectors = [];
              for (const p of fixture.passages) { vectors.push((await embeddings.embedPassages([p.text]))[0]); sample(); }
              row.indexMs = Date.now() - docStart;
              const ranks = [], latencies = [];
              for (const q of fixture.queries) {
                const qStart = Date.now();
                const vector = await embeddings.embedQuery(q.text); latencies.push(Date.now() - qStart); sample();
                const scored = vectors.map((v, i) => ({ id: fixture.passages[i].id, score: v.reduce((n, x, j) => n + x * vector[j], 0) })).sort((a,b) => b.score - a.score);
                ranks.push(scored.findIndex(p => q.relevant.includes(p.id)) + 1);
              }
              row.recall1 = ranks.filter(r => r <= 1).length / ranks.length;
              row.recall5 = ranks.filter(r => r <= 5).length / ranks.length;
              row.recall10 = ranks.filter(r => r <= 10).length / ranks.length;
              row.mrr = ranks.reduce((n,r) => n + 1/r, 0) / ranks.length;
              latencies.sort((a,b) => a-b);
              row.warmQueryMedianMs = latencies[Math.floor(latencies.length/2)];
              row.warmQueryP95Ms = latencies[Math.ceil(latencies.length*.95)-1];
              row.sampledZoteroResidentBytes = peak;
              row.ranks = ranks;
            } catch (error) { row.error = String(error) + '\\n' + String(error.stack || ''); }
            finally { embeddings.reset(); }
            report.models.push(row);
            await IOUtils.writeUTF8(${JSON.stringify(benchmarkOutput)}, JSON.stringify(report, null, 2));
            Zotero.debug('[Nodus benchmark] ' + JSON.stringify(row));
          }
        }
        if (phase === 'save-credentials') {
          expect(store.getHistoryEnabled(), 'Local conversation history should default on');
          expect(await store.saveConversations([{
            id: 'nodus-smoke-conversation', title: 'Item history',
            zoteroItem: { libraryID: Zotero.Libraries.userLibraryID, key: 'SMOKEKEY' },
            messages: [{ role: 'user', content: 'Remember this item conversation' }],
          }]), 'Conversation save failed');
          expect((await store.loadConversations()).length === 1, 'Saved conversation is not readable');
          expect(typeof Services.logins.addLoginAsync === 'function', 'Async Login Manager API missing');
          expect(await store.setKey('openai', 'nodus-smoke-first-key'), 'First API key save failed');
          expect(await store.setKey('openai', 'nodus-smoke-updated-key'), 'API key update failed');
          expect(await store.getKey('openai') === 'nodus-smoke-updated-key', 'Updated API key read failed');
          Zotero.Prefs.set('nodus.key.gemini', 'nodus-smoke-legacy-key');
          expect(await store.getKey('gemini') === 'nodus-smoke-legacy-key', 'Legacy API key migration failed');
          expect(Zotero.Prefs.get('nodus.key.gemini') === '', 'Migrated API key remains in prefs');
          Zotero.Prefs.set('nodus.port', 4321);
          Zotero.Prefs.set('nodus.token', 'nodus-smoke-legacy-token');
          const migrated = await store.getManual();
          expect(migrated.port === 4321 && migrated.token === 'nodus-smoke-legacy-token', 'Legacy bridge migration failed');
          expect(await store.setManual(4322, 'nodus-smoke-bridge-token'), 'Manual bridge update failed');
          expect(Zotero.Prefs.get('nodus.key.openai') === '' && Zotero.Prefs.get('nodus.token') === '', 'Plaintext credentials remain in prefs');
          Zotero.debug('[Nodus smoke] encrypted credential saves, updates and migrations passed on Zotero ' + Zotero.version);
        } else if (phase === 'verify-credentials') {
          const history = await store.loadConversations();
          expect(history.length === 1 && history[0].id === 'nodus-smoke-conversation', 'Conversation lost after restart');
          expect(history[0].zoteroItem.key === 'SMOKEKEY'
            && history[0].zoteroItem.libraryID === Zotero.Libraries.userLibraryID
            && history[0].messages[0].content === 'Remember this item conversation', 'Conversation owner or messages lost after restart');
          expect(await store.deleteConversationHistory(), 'Conversation deletion failed');
          expect(await store.getKey('openai') === 'nodus-smoke-updated-key', 'API key lost after restart');
          expect(await store.getKey('gemini') === 'nodus-smoke-legacy-key', 'Migrated key lost after restart');
          const manual = await store.getManual();
          expect(manual.port === 4322 && manual.token === 'nodus-smoke-bridge-token', 'Bridge lost after restart');
          expect(await store.setKey('openai', '') && await store.setKey('gemini', '') && await store.setManual(0, ''), 'Credential deletion failed');
          expect(await store.getKey('openai') === '' && await store.getKey('gemini') === '' && (await store.getManual()).token === '', 'Deleted credentials remain readable');
          Zotero.debug('[Nodus smoke] encrypted credential restart and deletion passed');
        }
        Zotero.debug('[Nodus smoke] UI and evidence database ready; requesting normal quit');
        Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
        return;
      }
      timer = setTimeout(check, 250);
    } catch (error) { Zotero.debug('[Nodus smoke] FAILED: ' + error); }
  }
  timer = setTimeout(check, 250);
}
`));
driver.writeZip(path.join(extensionsDir, `${driverID}.xpi`));
writeFileSync(path.join(profileDir, 'prefs.js'), [
  'user_pref("extensions.startupScanScopes", 15);',
  'user_pref("extensions.autoDisableScopes", 0);',
  'user_pref("extensions.update.enabled", false);',
  'user_pref("extensions.zotero.httpServer.enabled", false);',
  'user_pref("extensions.zotero.sync.autoSync", false);',
  'user_pref("extensions.zoteroMacWordIntegration.skipInstallation", true);',
  'user_pref("extensions.zoteroOpenOfficeIntegration.skipInstallation", true);',
  'user_pref("extensions.zotero.nodus.mode", "standalone");',
  'user_pref("extensions.zotero.useDataDir", true);',
  `user_pref("extensions.zotero.dataDir", ${JSON.stringify(dataDir)});`,
  '',
].join('\n'));

let output = '';
let child;
let succeeded = false;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readState = () => {
  const statePath = path.join(profileDir, 'extensions.json');
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    return state.addons?.find((entry) => entry.id === addon.id) ?? null;
  } catch {
    return null;
  }
};
const startZotero = () => {
  output = '';
  const process = spawn(zoteroBin, ['-profile', profileDir, '-no-remote', '-ZoteroDebugText'], {
    env: { ...globalThis.process.env, MOZ_NO_REMOTE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk) => { output = (output + chunk.toString()).slice(-2_000_000); if (embeddingBenchmark || embeddingSwitchSmoke) writeFileSync(path.join(profileDir, 'live.log'), output); };
  process.stdout.on('data', append);
  process.stderr.on('data', append);
  return process;
};
const stopZotero = async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(2_000)]);
  }
};
if (embeddingBenchmark) mkdirSync(path.dirname(benchmarkOutput), { recursive: true });
const diagnostic = () => output.split('\n')
  .filter((line) => /nodus|extension is invalid|update_url|bootstrap|error/i.test(line))
  .slice(-80)
  .join('\n');

try {
  // Phase 1: let a completely fresh Zotero profile discover and register the
  // XPI. Zotero can finish first-run profile setup before invoking bootstrap,
  // so registration and runtime startup are intentionally separate gates.
  child = startZotero();
  const registrationDeadline = Date.now() + Math.max(15_000, Math.floor(timeoutMs / 2));
  let registered = false;
  while (Date.now() < registrationDeadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Zotero exited during registration with code ${child.exitCode}`);
    const state = readState();
    if (
      state?.version === manifest.version
      && state.active === true
      && state.appDisabled === false
      && state.userDisabled === false
      && state.seen === true
    ) {
      registered = true;
      break;
    }
    await wait(250);
  }
  if (!registered) {
    throw new Error(`Zotero did not register the XPI\nstate=${JSON.stringify(readState())}\n${diagnostic()}`);
  }
  await stopZotero();

  // Phase 2: prove that the registered add-on really executes bootstrap on a
  // normal subsequent launch and persists the per-add-on update opt-out.
  child = startZotero();
  const startupDeadline = Date.now() + timeoutMs;
  let started = false;
  while (Date.now() < startupDeadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Zotero exited during startup with code ${child.exitCode}`);
    const state = readState();
    if (
      state?.version === manifest.version
      && state.active === true
      && state.appDisabled === false
      && state.userDisabled === false
      && state.applyBackgroundUpdates === 0
      && output.includes(`[Nodus] startup complete v${manifest.version}`)
    ) {
      started = true;
      break;
    }
    await wait(250);
  }
  if (!started) {
    throw new Error(`Zotero did not start the registered add-on within ${timeoutMs} ms\nstate=${JSON.stringify(readState())}\n${diagnostic()}`);
  }
  writeFileSync(quitRequestPath, 'save-credentials');
  const shutdownDeadline = Date.now() + ((embeddingBenchmark || embeddingSwitchSmoke) ? 1_800_000 : 20_000);
  while (child.exitCode === null && child.signalCode === null && Date.now() < shutdownDeadline) {
    if (output.includes('[Nodus smoke] FAILED:')) throw new Error(diagnostic());
    await wait(100);
  }
  if (child.exitCode !== 0 || child.signalCode !== null
    || !output.includes('[Nodus smoke] UI and evidence database ready; requesting normal quit')
    || !output.includes('[Nodus smoke] encrypted credential saves, updates and migrations passed')) {
    throw new Error(`Zotero did not exit normally after opening the evidence database\n${diagnostic()}`);
  }
  if (embeddingSwitchSmoke && !output.includes('[Nodus smoke] embedding activation, binary reuse and cancellation passed')) throw new Error('Missing model-switch proof');
  const encryptedLogins = JSON.parse(readFileSync(path.join(profileDir, 'logins.json'), 'utf8'));
  const providerLogins = encryptedLogins.logins.filter((login) => login.hostname === 'chrome://nodus');
  if (providerLogins.length !== 3 || providerLogins.some((login) => !login.encryptedUsername || !login.encryptedPassword)
    || JSON.stringify(encryptedLogins).includes('nodus-smoke-')) {
    throw new Error('Credentials were not persisted encrypted in logins.json');
  }

  // Phase 3: use the same disposable profile after a normal restart to prove
  // that credentials survive on disk and can still be removed securely.
  writeFileSync(quitRequestPath, 'verify-credentials');
  child = startZotero();
  const restartDeadline = Date.now() + timeoutMs;
  while (child.exitCode === null && child.signalCode === null && Date.now() < restartDeadline) {
    if (output.includes('[Nodus smoke] FAILED:')) throw new Error(diagnostic());
    await wait(100);
  }
  if (child.exitCode !== 0 || child.signalCode !== null
    || !output.includes('[Nodus smoke] encrypted credential restart and deletion passed')) {
    throw new Error(`Credential verification after restart failed\n${diagnostic()}`);
  }
  if (embeddingBenchmark) {
    const report = JSON.parse(readFileSync(benchmarkOutput, 'utf8'));
    if (report.models.length !== 3 || report.models.some(model => model.error)) throw new Error('Local embedding benchmark incomplete: inspect ' + benchmarkOutput);
  }
  succeeded = true;
  console.log(`Zotero live smoke passed: ${addon.id} v${manifest.version}`);
  console.log('registered=true active=true appDisabled=false userDisabled=false backgroundUpdates=disabled startup=true ui=true evidence=true normalShutdown=true credentials=encrypted migration=true credentialRestart=true credentialDeletion=true itemHistory=true historyRestart=true historyDeletion=true');
} finally {
  await stopZotero();
  writeFileSync(path.join(profileDir, 'smoke.log'), output);
  if (keepProfile || !succeeded) console.error(`Live-smoke profile kept at ${profileDir}`);
  else rmSync(profileDir, { recursive: true, force: true });
}
