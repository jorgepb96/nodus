/** Shared real-Electron harness for isolated Research scenarios.
 * The application runs under the inherited OS boundary proven before launch.
 * A simulated provider may sit behind the existing cost-reserving proxy: the
 * proxy, routing and application code are real; only the upstream answer is
 * produced locally, so no request leaves the machine. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { _electron } from 'playwright-core';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from '../research-isolation.mjs';
import { startResearchProviderProxy } from '../research-provider-proxy.mjs';

const require = createRequire(import.meta.url);
export const repoRoot = path.resolve(import.meta.dirname, '../..');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

/** Deterministic unit vector from text: identical passages embed identically. */
export function fakeEmbedding(text, dimensions = 1024) {
  const vector = [];
  for (let block = 0; vector.length < dimensions; block++) {
    const digest = createHash('sha256').update(`${block}:${text}`).digest();
    for (const byte of digest) vector.push(byte / 127.5 - 1);
  }
  const values = vector.slice(0, dimensions);
  const norm = Math.hypot(...values) || 1;
  return values.map(value => value / norm);
}

/**
 * behaviour(provider, body, call) → { status, json } | { status, text } | { hangMs } | { throw: true }.
 * The default answers embeddings with deterministic vectors and chat with a short
 * JSON-compatible message.
 */
export function simulatedUpstream(behaviour = () => null) {
  const calls = [];
  const dispatch = async (url, init) => {
    const provider = url.includes('openrouter') ? 'openrouter' : 'deepseek';
    if (init.method === 'GET') return Response.json({ data: [{ id: 'deepseek-flash', effort: { supported_levels: ['low', 'high', 'max'] } }] });
    const body = JSON.parse(Buffer.from(init.body).toString('utf8'));
    const call = { provider, at: Date.now(), index: calls.length };
    calls.push(call);
    const planned = await behaviour(provider, body, call) ?? {};
    call.planned = Object.keys(planned).length ? planned : 'default';
    if (planned.hangMs) await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, planned.hangMs);
      init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
    });
    if (planned.throw) throw Object.assign(new Error('simulated_connection_reset'), { code: 'SIMULATED_RESET' });
    if (planned.text !== undefined) return new Response(planned.text, { status: planned.status ?? 200, headers: { 'content-type': 'application/json' } });
    if (planned.json) return Response.json(planned.json, { status: planned.status ?? 200 });
    if (provider === 'openrouter') {
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return Response.json({ object: 'list', model: body.model, data: inputs.map((text, index) => ({ object: 'embedding', index,
        // Same wire format as the real API: the OpenAI SDK requests base64 float32 by default.
        embedding: body.encoding_format === 'base64' ? Buffer.from(new Float32Array(fakeEmbedding(text)).buffer).toString('base64') : fakeEmbedding(text) })),
        usage: { prompt_tokens: inputs.join(' ').split(/\s+/).length, total_tokens: 0, cost: 0 } });
    }
    return Response.json({ id: `sim-${call.index}`, object: 'chat.completion', model: body.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: planned.content ?? 'Simulated answer without sources.' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } });
  };
  return { dispatch, calls };
}

/** `realProvider.campaignRoot` sends requests to the real providers through the
 * shared cost-reserving proxy and ledger of that campaign root; `realProvider.dispatch`
 * may wrap the real fetch to observe requests (it must still send them). `extraEnv`
 * reaches only the application (for example an explicit disposable Zotero endpoint).
 * Every launch, not only the first, re-proves the five isolation guarantees. */
export async function createResearchApp({ provider = null, realProvider = null, extraPorts = [], extraEnv = {}, root: requestedRoot = null, executablePath = require('electron'), appArgs = [repoRoot] } = {}) {
  const root = requestedRoot ? fs.realpathSync(requestedRoot) : createResearchTestRoot();
  const marker = JSON.parse(fs.readFileSync(path.join(root, 'isolation.json'), 'utf8'));
  if (marker.root !== root || marker.format !== 'nodus.isolated-research-profile/1') throw new Error('Only a marked disposable QA profile can be resumed');
  let proxy = null;
  if (provider) proxy = await startResearchProviderProxy(root, { dispatch: provider.dispatch, catalogDispatch: provider.dispatch });
  else if (realProvider) proxy = await startResearchProviderProxy(realProvider.campaignRoot, { ...(realProvider.dispatch ? { dispatch: realProvider.dispatch, catalogDispatch: fetch } : {}), ...realProvider.proxyOptions });
  const ports = [...extraPorts, ...(proxy ? [Number(new URL(proxy.url).port)] : [])];
  const sandbox = macResearchSandbox(root, ports);
  const proof = { ...verifyResearchSandbox(root, sandbox), allowedLoopbackPorts: ports };
  fs.writeFileSync(path.join(root, 'isolation.sb'), sandbox);
  const wrapper = path.join(root, 'electron-isolated');
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(path.join(root, 'isolation.sb'))} ${quote(executablePath)} "$@"\n`, { mode: 0o700 });
  const environment = { ...researchTestEnvironment(root), ...extraEnv, ...(proxy ? { NODUS_RESEARCH_PROVIDER_PROXY: proxy.url } : {}) };
  let app = null;
  const harness = {
    root, proof, proxy, launchProofs: [],
    async launch() {
      // The boundary is inherited from the OS, so prove it again before every start.
      const launchProof = { ...verifyResearchSandbox(root, sandbox), allowedLoopbackPorts: ports, at: new Date().toISOString() };
      harness.launchProofs.push(launchProof);
      const lock = path.join(root, 'profile/isolated-instance.lock');
      if (fs.existsSync(lock)) {
        const pid = Number(fs.readFileSync(lock, 'utf8'));
        if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('Invalid disposable profile lock');
        try { process.kill(pid, 0); throw new Error('Disposable profile is still running'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; fs.unlinkSync(lock); }
      }
      app = await _electron.launch({ executablePath: wrapper, args: ['--no-sandbox', '--disable-gpu', ...appArgs], cwd: root, env: environment, timeout: 60000 });
      const page = await app.firstWindow();
      await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), null, { timeout: 60000 });
      harness.app = app; harness.page = page;
      return { app, page };
    },
    async prepareProfile(page, extra = {}) {
      await page.evaluate(async ({ root, extra }) => {
        await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'declined' });
        await window.nodus.updateSettings({ autoLightScan: false, autoDeepScanOnReadTag: false, autoSummaryAfterDeep: false, autoBridgeAfterQueue: false,
          autoBackupFolder: `${root}/library`, onboardingComplete: true, basicsTutorialVersion: 99, recoverySetupVersion: 999, tourComplete: true,
          advancedTourComplete: true, uiLanguage: 'es', mascotEnabled: false, mascotStyleChosen: true, reduceMotion: true, ...extra });
      }, { root, extra });
    },
    /** Simulated credentials only: the simulated upstream never forwards them. */
    async simulatedKeys(page) {
      await page.evaluate(async () => {
        await window.nodus.setApiKey('deepseek', 'simulated-deepseek-key');
        await window.nodus.setApiKey('openrouter', 'simulated-openrouter-key');
        await window.nodus.updateSettings({ chatModel: { provider: 'deepseek', model: 'deepseek-flash' }, deepResearchModel: { provider: 'deepseek', model: 'deepseek-flash' },
          synthesisModel: { provider: 'deepseek', model: 'deepseek-flash' }, embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3', chatReasoning: 'off' });
      });
    },
    /** Replaces the profile's provider credentials with the isolated encrypted copies. */
    async importCredentials(source, providers = ['deepseek', 'openrouter']) {
      if (app) throw new Error('close the application before replacing credentials');
      const secrets = path.join(root, 'profile/secrets');
      for (const name of fs.existsSync(secrets) ? fs.readdirSync(secrets) : []) if (/^ai_key_(deepseek|openrouter)/.test(name)) fs.rmSync(path.join(secrets, name));
      const { importResearchTestCredentials } = await import('../research-test-credentials.mjs');
      return importResearchTestCredentials(root, source, providers);
    },
    async closeApp() {
      if (app) await app.close().catch(() => undefined);
      app = null; harness.app = null;
    },
    async close() {
      if (app) await app.close().catch(() => undefined);
      app = null;
      if (proxy) await proxy.close().catch(() => undefined);
    },
  };
  return harness;
}

/** Synthetic PDFs with varying prose (templated lines are stripped as headers). */
export async function writeSyntheticPdfs(root, { documents = 2, pages = 3, prefix = 'DOC' } = {}) {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const words = ['archive', 'measurement', 'field', 'survey', 'record', 'river', 'harvest', 'ledger', 'north', 'season', 'witness', 'parcel',
    'boundary', 'inspection', 'granary', 'village', 'census', 'weather', 'tithe', 'mill', 'estate', 'register', 'orchard', 'valley'];
  const files = [];
  for (let index = 0; index < documents; index++) {
    let seed = index + 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let number = 1; number <= pages; number++) {
      const lines = Array.from({ length: 30 }, () => Array.from({ length: 9 }, () => words[Math.floor(random() * words.length)]).join(' ') + '.');
      lines[1 + Math.floor(random() * 28)] += ` Marker ${prefix}${index + 1}P${number} closes this line.`;
      pdf.addPage().drawText(lines.join('\n'), { x: 30, y: 760, size: 8, lineHeight: 12, font });
    }
    const filename = path.join(root, 'fixtures', `${prefix.toLowerCase()}-${index + 1}.pdf`);
    fs.writeFileSync(filename, await pdf.save());
    files.push(filename);
  }
  return files;
}

export async function addPdfItems(app, page, files) {
  const ids = [];
  for (const filename of files) {
    await app.evaluate(({ dialog }, filename) => { globalThis.harnessOpenDialog ??= dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, filename);
    ids.push(await page.evaluate(async title => {
      const item = await window.nodus.createGlobalLibraryItem({ title, itemType: 'report', creators: [] }, []);
      await window.nodus.addGlobalLibraryAttachments(item.id);
      return item.id;
    }, path.basename(filename, '.pdf')));
  }
  await app.evaluate(({ dialog }) => { if (globalThis.harnessOpenDialog) dialog.showOpenDialog = globalThis.harnessOpenDialog; });
  return ids;
}

export async function waitFor(probe, { timeoutMs = 120000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  return value;
}

export const inventoryOf = async (page, ids) => (await page.evaluate(() => window.nodus.getResearchPreparationInventory())).documents.filter(document => ids.includes(document.id));

export function reserveLoopbackPort() {
  return new Promise(resolve => { const server = http.createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
}
