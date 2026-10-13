// Real Electron IPC, study service, provider transport and vault storage.
// Only the external Ollama endpoint is replaced by a controlled local server.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';
const require = createRequire(import.meta.url), root = path.resolve(new URL('..', import.meta.url).pathname);
const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-scriptor-provider-')), output = path.join(root, 'output/qa/scriptor-provider');
await mkdir(output, { recursive: true });
const env = { ...process.env, NODUS_USERDATA: profile, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
let app, page;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env, timeout: 90000 }); page = await app.firstWindow(); page.setDefaultTimeout(30000);
  await page.waitForFunction(() => Boolean(window.nodus && document.getElementById('root')?.children.length));
  const port = await app.evaluate(async () => {
    globalThis.qaProviderRequests = []; globalThis.qaProviderRelease = false; globalThis.qaProviderMode = 'normal'; globalThis.qaProviderAborted = 0;
    const http = process.getBuiltinModule('http');
    globalThis.qaProviderServer = http.createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk; const body = raw ? JSON.parse(raw) : {};
      if (req.url === '/api/show') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ model_info: { 'general.architecture': 'qwen', 'qwen.context_length': 32768 } })); return; }
      if (req.url !== '/api/chat') { res.end(JSON.stringify({ models: [] })); return; }
      globalThis.qaProviderRequests.push(body); const mode = globalThis.qaProviderMode;
      const source = body.messages.find(m => m.role === 'user').content.match(/<<<NODUS_SELECTION\n([\s\S]*?)\nNODUS_SELECTION>>>/)?.[1] ?? '';
      const text = mode === 'empty' ? '' : source.replace('paisaje', 'territorio');
      res.on('close', () => { if (!res.writableEnded) globalThis.qaProviderAborted++; });
      res.setHeader('Content-Type', 'application/x-ndjson');
      for (const delta of [text.slice(0, 12), text.slice(12)]) { await new Promise(r => setTimeout(r, 100)); if (res.destroyed) return; res.write(JSON.stringify({ message: { content: delta }, done: false }) + '\n'); }
      while (!globalThis.qaProviderRelease && !res.destroyed) await new Promise(r => setTimeout(r, 20));
      if (!res.destroyed) res.end(JSON.stringify({ done: true, done_reason: 'stop', prompt_eval_count: 100, eval_count: 10 }) + '\n');
    });
    await new Promise(resolve => globalThis.qaProviderServer.listen(0, '127.0.0.1', resolve)); return globalThis.qaProviderServer.address().port;
  });
  await page.evaluate(async ({ version, port }) => {
    for (const [k, v] of Object.entries({ 'nodus.lastSeenVersion': version, 'nodus.platformHighlightsSeen.2026-07': '1', 'nodus.toolkitBetaGuideSeen.2.4.0': '1', 'nodus.tutorialVideosAnnouncementSeen.2026-07': '1', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA': '1', 'nodus.mobileTeaserSeen.3.2.4': '1' })) localStorage.setItem(k, v);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1'); await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1 });
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', theme: 'light', mascotEnabled: false, reduceMotion: true, academicMode: 'auto', modelSettingsMode: 'advanced', improveModel: { provider: 'ollama', model: 'qa-real-transport' }, localProviders: { ollama: { baseUrl: `http://127.0.0.1:${port}` }, lmstudio: { baseUrl: 'http://127.0.0.1:1' } } });
  }, { version: require('../package.json').version, port });
  await page.reload();
  const fixture = await page.evaluate(async () => {
    const note = await window.nodus.createNote({ title: 'Servicio y proveedor reales', content: '' });
    const native = [{ id: 'source', type: 'paragraph', props: { textAlignment: 'left', textColor: 'default', backgroundColor: 'default' }, content: [{ type: 'text', text: 'La memoria del paisaje.', styles: { bold: true } }], children: [] }];
    await window.nodus.updateWorkspaceNote(note.id, { title: note.title, contentMarkdown: '', nativeDocument: native }); return { id: note.id, native };
  });
  await page.locator('[data-tour="nav-workspace"]').click(); await page.getByTestId('workspace-item-' + fixture.id).click(); await page.locator('.nodus-blocknote .bn-editor').waitFor();
  const open = async () => {
    await page.locator('[data-id="source"] .bn-inline-content').evaluate(el => { el.closest('.bn-editor').focus(); const range = document.createRange(); range.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
    await page.waitForTimeout(100); await page.locator('.editorial-editor-body').dispatchEvent('mouseup'); await page.getByTestId('study-selection-improve').click();
  };
  const saved = () => page.evaluate(async id => (await window.nodus.getWorkspaceNoteEditorData(id)).nativeDocument, fixture.id);
  const logs = () => page.evaluate(id => window.nodus.listStudyImprovementLog(id), fixture.id);
  await open(); await page.getByTestId('scriptor-ai-input').fill('Mantén el tono y el formato.'); await page.getByTestId('scriptor-ai-send').click(); await page.getByTestId('scriptor-ai-added').first().waitFor();
  assert.deepEqual(await saved(), fixture.native); await page.screenshot({ path: path.join(output, 'real-stream.png') });
  await app.evaluate(() => { globalThis.qaProviderRelease = true; }); await page.getByTestId('scriptor-ai-accept').waitFor();
  const log = (await logs())[0]; assert.equal(log.action, 'generated'); assert.equal(log.modelName, 'qa-real-transport'); assert.equal(log.modelProvider, 'ollama');
  await page.getByTestId('scriptor-ai-reject').click(); assert.equal((await logs())[0].action, 'rejected'); assert.deepEqual(await saved(), fixture.native);
  await page.getByTestId('scriptor-ai-send').click(); await page.getByTestId('scriptor-ai-accept').click();
  await page.waitForFunction(async id => JSON.stringify((await window.nodus.getWorkspaceNoteEditorData(id)).nativeDocument).includes('territorio'), fixture.id); assert.equal((await logs())[0].action, 'replace');
  const accepted = await saved(); await page.getByTestId('study-editor-undo').click(); await page.waitForFunction(async ({ id, native }) => JSON.stringify((await window.nodus.getWorkspaceNoteEditorData(id)).nativeDocument) === JSON.stringify(native), { id: fixture.id, native: fixture.native });
  await page.getByTestId('study-editor-redo').click(); await page.waitForFunction(async ({ id, accepted }) => JSON.stringify((await window.nodus.getWorkspaceNoteEditorData(id)).nativeDocument) === JSON.stringify(accepted), { id: fixture.id, accepted });
  await page.reload(); await page.locator('[data-tour="nav-workspace"]').click(); await page.getByTestId('workspace-item-' + fixture.id).click(); await page.locator('.bn-editor').waitFor(); assert.deepEqual(await saved(), accepted);
  await open(); await app.evaluate(() => { globalThis.qaProviderRelease = false; }); await page.getByTestId('scriptor-ai-send').click(); await page.getByTestId('scriptor-ai-added').first().waitFor(); const count = (await logs()).length; await page.getByTestId('study-improve-cancel').click(); await page.waitForTimeout(500); assert.equal((await logs()).length, count); assert.deepEqual(await saved(), accepted); assert.ok(await app.evaluate(() => globalThis.qaProviderAborted > 0));
  await app.evaluate(() => { globalThis.qaProviderMode = 'empty'; globalThis.qaProviderRelease = true; }); await page.getByTestId('scriptor-ai-send').click(); await page.getByTestId('scriptor-ai-error').waitFor(); assert.deepEqual(await saved(), accepted);
  const requests = await app.evaluate(() => globalThis.qaProviderRequests); assert.ok(requests[0].messages.find(m => m.role === 'user').content.includes('Mantén el tono y el formato.'));
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ checks: ['real native transport, IPC and study service', 'streaming, protected prompt and persistent decision log', 'accept, undo, redo and persistence after reload', 'provider cancellation and empty response'], requests: requests.length, passed: true }, null, 2)); console.log('Real provider integration passed: ' + output);
} catch (error) { if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }); console.error(await page.getByTestId('scriptor-ai-error').allTextContents()); } throw error; }
finally { if (app) { await app.evaluate(({ app }) => app.exit()).catch(() => {}); await app.close().catch(() => {}); } await rm(profile, { recursive: true, force: true }); }
