// Opens a manual dictation preview with real microphone input and copies of
// the user's installed whisper.cpp weights. Keeps all writing in a new profile.
import { _electron as electron } from 'playwright-core';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResearchTestRoot, researchTestEnvironment } from './research-isolation.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const source = process.env.NODUS_SOURCE_USERDATA || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support/Nodus' : process.platform === 'win32' ? 'AppData/Roaming/Nodus' : '.config/Nodus');
const reuse = process.env.NODUS_PREVIEW_ROOT;
const root = reuse ? path.resolve(reuse) : createResearchTestRoot(), profile = path.join(root, 'profile');
const preferences = await readFile(path.join(source, 'app-prefs.json'), 'utf8').then(JSON.parse).catch(() => ({}));
const settings = Object.fromEntries(['sttProvider', 'sttTransformersModel', 'sttWhisperCppModel', 'sttWhisperCppExecutable', 'theme'].filter(key => preferences[key] !== undefined).map(key => [key, preferences[key]]));
const models = [];
const weights = path.join(profile, 'whisper.cpp/models');
await mkdir(weights, { recursive: true });
for (const entry of await readdir(path.join(source, 'whisper.cpp/models'), { withFileTypes: true }).catch(() => [])) {
  if (!entry.isFile() || !/^ggml-[\w.-]+\.bin$/.test(entry.name)) continue;
  if (!reuse) await copyFile(path.join(source, 'whisper.cpp/models', entry.name), path.join(weights, entry.name), constants.COPYFILE_FICLONE);
  models.push(entry.name);
}
if (!reuse) await writeFile(path.join(profile, 'app-prefs.json'), JSON.stringify(settings), { mode: 0o600 });
const env = researchTestEnvironment(root);
const app = await electron.launch({ executablePath: require('electron'), args: [repo], env, timeout: 60000 });
const page = await app.firstWindow(); page.setDefaultTimeout(30000);
await page.waitForFunction(() => Boolean(window.nodus && document.getElementById('root')?.children.length));
await page.evaluate(async ({ version, settings }) => {
  for (const [key, value] of Object.entries({ 'nodus.lastSeenVersion': version, 'nodus.platformHighlightsSeen.2026-07': '1', 'nodus.toolkitBetaGuideSeen.2.4.0': '1', 'nodus.tutorialVideosAnnouncementSeen.2026-07': '1', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA': '1', 'nodus.mobileTeaserSeen.3.2.4': '1' })) localStorage.setItem(key, value);
  sessionStorage.setItem('nodus.startupUpdateChecked', '1');
  await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1 });
  await window.nodus.updateSettings({ ...settings, onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', mascotEnabled: false, academicMode: 'manual' });
}, { version: require('../package.json').version, settings });
await page.reload(); await page.getByTestId('app-shell').waitFor();
const note = await page.evaluate(async ({ existingId, title }) => {
  if (existingId) {
    const note = (await window.nodus.getNotesTree()).notes.find(note => note.id === existingId);
    if (!note) throw new Error('No se encontró el documento de prueba anterior.');
    return note;
  }
  const note = await window.nodus.createNote({ title, content: '' });
  await window.nodus.updateWorkspaceNote(note.id, { title: note.title, contentMarkdown: '' });
  return note;
}, { existingId: process.env.NODUS_PREVIEW_NOTE_ID, title: process.env.NODUS_PREVIEW_TITLE || 'Prueba de dictado' });
await page.locator('[data-tour="nav-workspace"]').click();
await page.getByTestId('workspace-item-' + note.id).click();
await page.locator('.bn-editor').waitFor();
await page.getByTestId('study-dictation-toggle').waitFor();
const warning = page.getByTestId('backup-health-banner').getByRole('button', { name: 'Ocultar aviso' });
if (await warning.isVisible().catch(() => false)) await warning.click();
const status = await page.evaluate(() => window.nodus.getWhisperCppStatus());
await app.evaluate(({ app, BrowserWindow }) => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) { window.setSize(1280, 860); window.center(); window.show(); app.focus({ steal: true }); window.focus(); }
});
await page.locator('.bn-editor').click();
const artifact = path.join(repo, 'output/qa/scriptor-dictation');
await mkdir(artifact, { recursive: true });
await writeFile(path.join(artifact, 'manual-preview.json'), JSON.stringify({ root, profile, noteId: note.id, models, executableReady: status.executableReady, downloaded: status.models.filter(model => model.downloaded).map(model => model.id), pid: app.process().pid }, null, 2));
await page.screenshot({ path: path.join(artifact, 'manual-preview.png') });
console.log(JSON.stringify({ ready: true, profile, document: note.title, microphone: 'real', downloaded: status.models.filter(model => model.downloaded).map(model => model.id), executableReady: status.executableReady }));
// Leave the window and the independent profile available for the user's test.
await new Promise(resolve => app.process().once('exit', resolve));
