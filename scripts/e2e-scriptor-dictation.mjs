// Exercises the built desktop app, real IPC and a downloaded whisper.cpp model.
// A prerecorded WAV feeds a MediaStream; the production worklet and model run unchanged.
// NODUS_DICTATION_CPP_MODEL=/path/to/ggml-base.bin node scripts/e2e-scriptor-dictation.mjs
// Supply NODUS_DICTATION_AUDIO_FILE for a prerecorded Spanish WAV on other platforms.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

assert.ok(process.env.NODUS_DICTATION_CPP_MODEL, 'Set NODUS_DICTATION_CPP_MODEL to an existing ggml-base.bin');
const require = createRequire(import.meta.url), root = path.resolve(new URL('..', import.meta.url).pathname);
const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-scriptor-dictation-'));
const output = path.join(root, 'output/qa/scriptor-dictation/desktop');
await mkdir(output, { recursive: true });
let app, page, electronLog = '';
const errors = [], screenshots = [], checks = [];
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let stderr = '';
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
  child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr)));
});
try {
  let audio = process.env.NODUS_DICTATION_AUDIO_FILE;
  if (!audio) {
    audio = path.join(profile, 'voice.wav');
    const spoken = path.join(profile, 'voice.aiff');
    await run('say', ['-v', 'Mónica', '-r', '150', '-o', spoken, 'Hola esto es una prueba de dictado local y mientras continúo hablando el texto debe aparecer en el documento sin cortar la frase ni añadir puntos antes de terminar.']);
    await run('ffmpeg', ['-y', '-i', spoken, '-ar', '16000', '-ac', '1', audio]);
  }
  const modelDirectory = path.join(profile, 'whisper.cpp/models');
  await mkdir(modelDirectory, { recursive: true });
  await symlink(path.resolve(process.env.NODUS_DICTATION_CPP_MODEL), path.join(modelDirectory, 'ggml-base.bin'));
  const env = { ...process.env, NODUS_USERDATA: profile, NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  app = await electron.launch({ executablePath: require('electron'), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', root], env, recordVideo: { dir: path.join(output, 'video'), size: { width: 1280, height: 900 } } });
  app.process().stderr?.on('data', data => { electronLog = (electronLog + data).slice(-12000); });
  page = await app.firstWindow(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.nodus && document.getElementById('root')?.children.length));
  await page.evaluate(async version => {
    for (const [key, value] of Object.entries({ 'nodus.lastSeenVersion': version, 'nodus.platformHighlightsSeen.2026-07': '1', 'nodus.toolkitBetaGuideSeen.2.4.0': '1', 'nodus.tutorialVideosAnnouncementSeen.2026-07': '1', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA': '1', 'nodus.mobileTeaserSeen.3.2.4': '1', 'nodus.micPrivacyAcknowledged': '1' })) localStorage.setItem(key, value);
    sessionStorage.setItem('nodus.startupUpdateChecked', '1'); localStorage.setItem('nodus.sidebarWidth', '246');
    await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1 });
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', theme: 'light', mascotEnabled: false, reduceMotion: false, academicMode: 'manual', sttProvider: 'openai', sttWhisperCppModel: 'base' });
  }, require('../package.json').version);
  await page.reload(); await page.getByTestId('app-shell').waitFor();
  const note = await page.evaluate(async () => {
    const note = await window.nodus.createNote({ title: 'Verificación del dictado local', content: '' });
    await window.nodus.updateWorkspaceNote(note.id, { title: note.title, contentMarkdown: 'Texto original.' });
    const status = await window.nodus.getWhisperCppStatus();
    if (!status.executableReady || !status.models.some(model => model.id === 'base' && model.downloaded)) throw new Error('The isolated profile needs whisper-cli and the base model');
    return note;
  });
  await page.locator('[data-tour="nav-workspace"]').click();
  await page.getByTestId('workspace-item-' + note.id).click();
  const editor = page.locator('.nodus-blocknote .bn-editor'), mic = page.getByTestId('study-dictation-toggle');
  await editor.waitFor();
  await page.evaluate(bytes => {
    const AudioContext = window.AudioContext, getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const WorkletNode = window.AudioWorkletNode;
    window.AudioContext = class extends AudioContext { constructor(...args) { super(...args); window.dictationAudioContext = this; } };
    window.AudioWorkletNode = class extends WorkletNode { constructor(...args) { super(...args); window.dictationFrames = { count: 0, peak: 0 }; this.port.addEventListener('message', ({ data }) => { if (data.type === 'samples') { window.dictationFrames.count++; for (const value of data.samples) window.dictationFrames.peak = Math.max(window.dictationFrames.peak, Math.abs(value)); } }); this.port.start(); } };
    navigator.mediaDevices.getUserMedia = async constraints => {
      // Exercise Electron's permission flow, then replace only the simulated
      // device input: file-backed capture emits silence in this QA environment.
      const permission = await getUserMedia(constraints); permission.getTracks().forEach(track => track.stop());
      const context = new AudioContext({ sampleRate: 48000 }), source = context.createBufferSource();
      source.buffer = await context.decodeAudioData(new Uint8Array(bytes).buffer); source.loop = false;
      const destination = context.createMediaStreamDestination(); source.connect(destination);
      await context.resume(); source.start();
      const stream = destination.stream;
      stream.getTracks().forEach(track => { const stop = track.stop.bind(track); let stopped = false; track.stop = () => { if (stopped) return; stopped = true; stop(); source.stop(); void context.close(); }; });
      window.dictationMediaStream = stream; return stream;
    };
  }, Array.from(await readFile(audio)));
  const warning = page.getByTestId('backup-health-banner').getByRole('button', { name: 'Ocultar aviso' });
  if (await warning.isVisible().catch(() => false)) await warning.click();
  const capture = async name => { const file = name + '.png'; await page.screenshot({ path: path.join(output, file) }); screenshots.push(file); };
  const checkPrimaryContrast = async () => {
    const ratio = await page.getByTestId('study-dictation').locator('.btn-primary').evaluate(button => {
      const style = getComputedStyle(button);
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(value => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const foreground = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    assert.ok(ratio >= 4.5, `dictation primary button contrast ${ratio.toFixed(2)} is below 4.5:1`);
  };
  await editor.click(); await page.keyboard.press('ControlOrMeta+End');
  await mic.click();
  await page.getByTestId('study-dictation-status').filter({ hasText: 'Escuchando' }).waitFor();
  await checkPrimaryContrast();
  await capture('light-listening');
  await page.evaluate(() => {
    const editor = document.querySelector('.bn-editor'), bar = document.querySelector('[data-testid="study-dictation"]');
    window.realtimeAudit = { editor, records: [], done: false };
    const frame = () => {
      if (window.realtimeAudit.done) return;
      const r = editor.getBoundingClientRect();
      let visible = true;
      for (let node = editor; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.99) visible = false;
      }
      window.realtimeAudit.records.push({ t: performance.now(), text: editor.textContent, top: r.top, barHeight: bar.getBoundingClientRect().height, connected: editor.isConnected && editor === document.querySelector('.bn-editor'), visible });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.waitForFunction(() => /dictado|local/i.test(document.querySelector('.bn-editor')?.textContent ?? ''), null, { timeout: 45000 });
  assert.equal(await mic.getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(10000);
  const audit = await page.evaluate(() => { window.realtimeAudit.done = true; return window.realtimeAudit.records; });
  const changes = audit.filter((frame, index) => !index || frame.text !== audit[index - 1].text);
  console.log('Live word updates:', changes.length, 'with stable layout:', audit.every(frame => frame.connected && frame.visible));
  assert.ok(changes.length >= 6, 'real model must update growing words before the utterance finishes');
  assert.ok(audit.every(frame => frame.connected && frame.visible), 'full app must never remount or fade the editor during live transcription');
  assert.ok(Math.max(...audit.map(frame => frame.top)) - Math.min(...audit.map(frame => frame.top)) < 1, 'real transcription must not make the page jump');
  assert.ok(Math.max(...audit.map(frame => frame.barHeight)) - Math.min(...audit.map(frame => frame.barHeight)) < 1);
  assert.doesNotMatch(await editor.innerText(), /\[Música|\[Music/);
  await writeFile(path.join(output, 'live-frames.json'), JSON.stringify(audit, null, 2));
  checks.push('real Spanish words grow in the editor through resident local Whisper, with animations enabled and no remount, fade, page jump or music captions');
  await page.getByTestId('study-dictation-pause').focus(); await page.keyboard.press('Space');
  await page.getByTestId('study-dictation-status').filter({ hasText: 'Pausado' }).waitFor();
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'dark' }));
  await page.waitForFunction(() => document.documentElement.classList.contains('dark')); await page.waitForTimeout(200);
  await checkPrimaryContrast();
  await capture('dark-paused');
  // Resume as soon as the button is available: regression coverage for the flush race.
  await page.getByTestId('study-dictation-pause').focus(); await page.keyboard.press('Enter');
  await page.getByTestId('study-dictation-status').filter({ hasText: 'Escuchando' }).waitFor();
  const panel = page.getByTestId('study-dictation');
  await panel.getByRole('button', { name: 'Opciones de dictado', exact: true }).click();
  assert.match(await page.getByTestId('study-dictation-model').inputValue(), /^whisper_cpp:/);
  for (const setting of await page.getByTestId('study-dictation-settings').locator('select,input').all()) assert.equal(await setting.isDisabled(), true);
  await page.setViewportSize({ width: 600, height: 900 });
  assert.ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await capture('dark-600-active-settings');
  checks.push('keyboard pause and immediate resume, local fallback with OpenAI selected, narrow desktop settings');
  checks.push('readable primary button text in both themes with at least 4.5:1 contrast');
  await mic.focus(); await page.keyboard.press('Enter');
  await page.getByTestId('study-dictation-start').waitFor();
  assert.equal(await mic.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => window.dictationAudioContext.state), 'closed');
  assert.equal(await page.evaluate(() => window.dictationMediaStream.getTracks().every(track => track.readyState === 'ended')), true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.nodus.updateSettings({ theme: 'light' }));
  const transcript = await editor.innerText();
  assert.doesNotMatch(transcript, /\[Música|\[Music/);
  assert.ok((transcript.match(/prueba de dictado/gi) ?? []).length <= 1, 'rolling windows never duplicate the sentence');
  assert.match(transcript, /local/i); assert.match(transcript, /documento/i); assert.match(transcript, /terminar/i);
  const tokenize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z]+/g) ?? [];
  if (!process.env.NODUS_DICTATION_AUDIO_FILE) {
    const expected = tokenize('Hola esto es una prueba de dictado local y mientras continúo hablando el texto debe aparecer en el documento sin cortar la frase ni añadir puntos antes de terminar');
    const actual = tokenize(transcript.replace(/^Texto original\.\s*/, ''));
    let row = Array.from({ length: actual.length + 1 }, (_, i) => i);
    for (let i = 0; i < expected.length; i++) { const next = [i + 1]; for (let j = 0; j < actual.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(expected[i] !== actual[j]))); row = next; }
    const wordErrorRate = row.at(-1) / expected.length;
    assert.ok(wordErrorRate < 0.25, 'Whisper Base must recognize the continuous sentence with useful accuracy, not merely emit arbitrary text');
    console.log('Word error rate:', Math.round(wordErrorRate * 100) + '%');
  }
  await page.getByTestId('study-editor-undo').click(); assert.notEqual(await editor.innerText(), transcript);
  await page.getByTestId('study-editor-redo').click(); assert.equal(await editor.innerText(), transcript);
  await editor.focus(); await page.keyboard.press('ControlOrMeta+s');
  await page.getByTestId('study-editor-save-state').filter({ hasText: 'Guardado' }).waitFor();
  const saved = await page.evaluate(id => window.nodus.getWorkspaceNoteEditorData(id), note.id);
  assert.match(saved.contentMarkdown, /documento/i); assert.match(saved.contentMarkdown, /local/i);
  await capture('light-saved');
  checks.push('toolbar stop drains real speech, native undo/redo and persisted document');
  await page.reload(); await page.getByTestId('app-shell').waitFor();
  await page.locator('[data-tour="nav-workspace"]').click(); await page.getByTestId('workspace-item-' + note.id).click();
  await editor.waitFor(); assert.match(await editor.innerText(), /documento/i);
  assert.equal(await page.getByTestId('study-dictation').count(), 0);
  checks.push('reload retains text and does not restart microphone');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'transcript.txt'), transcript);
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, errors, screenshots }, null, 2));
  await writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="es"><meta charset="utf-8"><title>Scriptor · Dictado en escritorio</title><style>body{font:16px system-ui;margin:32px;background:#fafafa;color:#333}img{max-width:100%;border:1px solid #ddd;border-radius:8px}section{margin:32px 0}h2{font-size:16px}</style><h1>Dictado local en la aplicación compilada</h1><p>Prueba aprobada con voz de un WAV en español y el modelo local whisper.cpp base. Se verificaron inserción en directo, pausa y reanudación con teclado, parada, liberación del audio, guardado, deshacer/rehacer y persistencia al reiniciar.</p><p><a href="results.json">Resultados</a> · <a href="transcript.txt">Transcripción de prueba</a></p>' + screenshots.map(file => `<section><h2>${file}</h2><img src="${file}"></section>`).join('') + '</html>');
  await rm(path.join(output, 'failure.png'), { force: true });
  console.log(`Desktop real dictation passed ${checks.length} checks.`);
} catch (error) {
  const diagnostics = await page?.evaluate(() => ({ context: { state: window.dictationAudioContext?.state, sampleRate: window.dictationAudioContext?.sampleRate, time: window.dictationAudioContext?.currentTime }, tracks: window.dictationMediaStream?.getTracks().map(track => ({ label: track.label, state: track.readyState, muted: track.muted, enabled: track.enabled, settings: track.getSettings() })), frames: window.dictationFrames, panel: document.querySelector('[data-testid=study-dictation]')?.textContent, level: document.querySelector('meter')?.value })).catch(() => null);
  console.error('Audio diagnostics:', JSON.stringify(diagnostics));
  console.error('Electron log:', electronLog);
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally { const video = page?.video(); await app?.close(); if (video) await video.saveAs(path.join(output, 'dictation-live.webm')); await rm(profile, { recursive: true, force: true }); }
