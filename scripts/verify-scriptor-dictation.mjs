import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-live-dictation-'));
const output = path.join(root, 'output/qa/scriptor-dictation/realtime');
await mkdir(output, { recursive: true });
const audioFile = path.join(temp, 'microphone.wav');
const wav = Buffer.alloc(44 + 16000 * 60 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < (wav.length - 44) / 2; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / 16000) * 7000), 44 + i * 2);
await writeFile(audioFile, wav);
const server = await createServer({ configFile: false, root, logLevel: 'error', define: { __APP_VERSION__: '"qa"' },
  optimizeDeps: { entries: ['scripts/fixtures/scriptor-dictation-verify.html', 'src/lib/stt/stt.worker.ts'] },
  esbuild: { jsx: 'automatic' }, resolve: { alias: { '@shared': path.join(root, 'shared') } }, worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 0 },
});
let browser, page;
const errors = [], checks = [], screenshots = [];
try {
  await server.listen(); const port = server.httpServer.address().port;
  const url = `http://127.0.0.1:${port}/scripts/fixtures/scriptor-dictation-verify.html`;
  browser = await chromium.launch({ executablePath: process.env.NODUS_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${audioFile}`, '--autoplay-policy=no-user-gesture-required'],
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  const editor = page.locator('.bn-editor');
  const text = () => editor.innerText();
  const cursorAtEnd = async () => { await editor.evaluate(element => { element.focus(); const range = document.createRange(); range.selectNodeContents(element); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }); };
  const mic = page.getByTestId('study-dictation-toggle');
  const start = async () => { await cursorAtEnd(); await mic.click(); await page.getByTestId('study-dictation-status').filter({ hasText: 'Escuchando' }).waitFor(); };
  const stop = async () => { await page.getByTestId('study-dictation-stop').click(); await page.getByTestId('study-dictation-start').waitFor(); };
  const reload = async () => { if (page.url().startsWith('http')) await page.evaluate(() => localStorage.clear()); await page.goto(url); await editor.waitFor(); };
  const shot = async name => { const file = name + '.png'; await page.screenshot({ path: path.join(output, file) }); screenshots.push(file); };
  await reload(); await start();
  await page.evaluate(() => {
    const editor = document.querySelector('.bn-editor'), panel = document.querySelector('[data-testid="study-dictation"]');
    window.liveAudit = { editor, panel, records: [], done: false };
    const sample = () => {
      const audit = window.liveAudit;
      if (audit.done) return;
      const box = editor.getBoundingClientRect(), bar = panel.getBoundingClientRect();
      audit.records.push({ t: performance.now(), text: editor.textContent, connected: editor.isConnected && editor === document.querySelector('.bn-editor'), top: box.top, height: bar.height, focus: document.activeElement?.getAttribute('aria-label'), opacity: getComputedStyle(editor).opacity });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.waitForFunction(() => /Primera frase dictada mientras/.test(document.querySelector('.bn-editor')?.textContent));
  assert.equal(await mic.getAttribute('aria-pressed'), 'true');
  assert.match(await text(), /^Texto original\. Primera frase dictada/);
  assert.doesNotMatch(await text(), /\[Música|dictada\./);
  await page.getByTestId('study-dictation').getByRole('button', { name: 'Opciones de dictado', exact: true }).click();
  const settings = page.getByTestId('study-dictation-settings');
  await settings.waitFor();
  const focusSelect = settings.getByRole('button', { name: 'Cerrar', exact: true });
  await focusSelect.focus();
  await page.waitForFunction(() => /sin puntos artificiales/.test(document.querySelector('.bn-editor')?.textContent));
  assert.equal(await focusSelect.evaluate(element => document.activeElement === element), true, 'new words must not steal settings focus');
  await page.keyboard.press('Escape'); await settings.waitFor({ state: 'detached' });
  await page.waitForTimeout(1800); // Includes the autosave path, with live hypotheses in the document.
  const audit = await page.evaluate(() => { window.liveAudit.done = true; return window.liveAudit.records; });
  assert.ok(audit.every(frame => frame.connected && frame.opacity === '1'), 'editor must never remount, disappear or fade during transcription');
  assert.ok(Math.max(...audit.map(frame => frame.top)) - Math.min(...audit.map(frame => frame.top)) < 1, 'no page jumping while words or settings change');
  assert.ok(Math.max(...audit.map(frame => frame.height)) - Math.min(...audit.map(frame => frame.height)) < 1, 'dictation bar has a stable height');
  assert.ok(new Set(audit.map(frame => frame.text)).size >= 5, 'words grow inside the ordinary editor before stop');
  assert.equal((await text()).match(/Primera frase/g).length, 1, 'rolling windows never append duplicate phrases');
  checks.push('live words in the ordinary editor, no premature full stop, no music captions, no remount/fade/layout jump or stolen focus');
  await writeFile(path.join(output, 'live-frames.json'), JSON.stringify(audit, null, 2));
  await stop();
  const final = await text(); assert.match(final, /sin puntos artificiales\.$/); assert.doesNotMatch(final, /Música/);
  await page.getByTestId('study-editor-undo').click(); assert.equal((await text()).trim(), 'Texto original.', 'one undo removes the entire evolving utterance');
  await page.getByTestId('study-editor-redo').click(); assert.equal(await text(), final);
  await page.evaluate(() => window.dictationFlush());
  assert.match(await page.evaluate(() => window.dictationSaved.get('dictation-a').contentMarkdown), /sin puntos artificiales\./);
  checks.push('final punctuation, single utterance undo/redo and normal document persistence');

  await start(); await page.waitForTimeout(1300);
  await page.getByTestId('study-dictation-pause').click();
  await page.getByTestId('study-dictation-status').filter({ hasText: 'Pausado' }).waitFor();
  await page.waitForTimeout(250); const calls = await page.evaluate(() => window.dictationQa.calls.length);
  await page.waitForTimeout(700); assert.equal(await page.evaluate(() => window.dictationQa.calls.length), calls);
  await page.getByTestId('study-dictation-pause').click(); await page.waitForTimeout(800); await stop();
  assert.ok(await page.evaluate(() => window.dictationQa.releasedTracks > 0));
  checks.push('pause/resume, final word draining, and microphone release');

  await reload(); await page.evaluate(() => { window.dictationQa.delay = 1400; }); await start();
  await page.waitForTimeout(950); const beforeCancel = await text();
  await page.getByTestId('study-dictation-discard').click(); await page.waitForTimeout(1800);
  assert.equal(await text(), beforeCancel, 'cancel preserves published words but ignores late hypotheses');
  assert.ok(await page.evaluate(() => window.dictationQa.cancelled.length > 0));
  checks.push('cancellation releases model session and prevents late document edits');

  await reload(); await start(); await page.waitForTimeout(1300);
  await page.getByRole('tab', { name: 'Segundo documento' }).click();
  await page.waitForFunction(() => document.querySelector('.bn-editor')?.textContent === 'Otro documento.'); await page.waitForTimeout(1000);
  assert.equal((await text()).trim(), 'Otro documento.');
  assert.match(await page.evaluate(() => window.dictationSaved.get('dictation-a').contentMarkdown), /Primera/);
  checks.push('document switching drains and saves the originating editor only');

  await reload(); await start(); await page.waitForTimeout(1500);
  // A writer's correction must win over later decoder corrections.
  await editor.evaluate(element => { element.focus(); const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode(); const range = document.createRange(); range.setStart(node, 0); range.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(range); }); await page.keyboard.type('Escrito a mano. ');
  await page.waitForTimeout(1200); assert.match(await text(), /^Escrito a mano\. Texto original\./); await stop();
  checks.push('typing outside the dictated range remains intact during later hypotheses');

  for (const mode of ['native', 'raw']) {
    await reload();
    if (mode === 'raw') { await page.getByRole('button', { name: 'Opciones del documento', exact: true }).click(); await page.getByRole('button', { name: 'Markdown crudo', exact: true }).click(); }
    const target = mode === 'raw' ? page.locator('textarea[aria-label="Editor Markdown"]') : editor;
    await target.evaluate(element => { element.focus(); if (element instanceof HTMLTextAreaElement) element.setSelectionRange(0, 0); else { const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode(); const range = document.createRange(); range.setStart(node, 0); range.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(range); } });
    await mic.click();
    await page.getByTestId('study-dictation-status').filter({ hasText: 'Escuchando' }).waitFor();
    await page.waitForTimeout(1600); await stop();
    const value = mode === 'raw' ? await target.inputValue() : await text();
    assert.match(value, /Primera frase/); assert.doesNotMatch(value, /Música/);
    await page.getByTestId('study-editor-undo').click();
    const undone = mode === 'raw' ? await target.inputValue() : await text();
    assert.notEqual(undone, value, 'dictated text participates in normal undo');
    await page.getByTestId('study-editor-redo').click();
    assert.equal(mode === 'raw' ? await target.inputValue() : await text(), value);
    checks.push(`${mode} rolling text insertion is ordinary editable text`);
  }

  await reload(); await start();
  await page.getByTestId('study-dictation').getByRole('button', { name: 'Opciones de dictado', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme); }, theme);
    for (const width of [1280, 900, 600, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(60);
      assert.ok(await page.getByTestId('study-dictation').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      assert.ok(await settings.evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && element.scrollWidth <= element.clientWidth + 1; }));
      await shot(`settings-${theme}-${width}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 }); await page.keyboard.press('Escape'); await stop();
  checks.push('floating settings stay inside all four viewport sizes in light/dark themes');
  await page.getByTestId('study-dictation').getByRole('button', { name: 'Opciones de dictado', exact: true }).click();
  await settings.getByLabel('Conservar audio original local').check();
  await page.keyboard.press('Escape'); await start(); await page.waitForTimeout(1500); await stop();
  await page.getByTestId('study-dictation').getByRole('button', { name: 'Opciones de dictado', exact: true }).click();
  await settings.locator('audio').waitFor(); const savedText = await text();
  await settings.getByRole('button', { name: 'Reprocesar con el modelo actual', exact: true }).first().click();
  await page.getByTestId('study-dictation-start').waitFor(); assert.equal(await text(), savedText);
  await settings.getByRole('button', { name: 'Eliminar audio local', exact: true }).first().click();
  await settings.locator('audio').waitFor({ state: 'detached' });
  checks.push('optional local audio preservation/reprocessing/deletion never duplicates document text');

  await reload(); await page.evaluate(() => { window.dictationQa.noModels = true; }); await mic.click();
  await page.getByTestId('study-dictation-start').waitFor(); assert.equal(await page.getByTestId('study-dictation-start').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.dictationQa.calls.length), 0);
  await reload(); await page.evaluate(() => { window.dictationQa.denied = true; }); await mic.click();
  await page.getByTestId('study-dictation').getByRole('alert').waitFor();
  assert.equal(await page.evaluate(() => window.dictationQa.calls.length), 0);
  await reload(); await page.evaluate(() => { window.dictationQa.fail = true; }); await mic.click();
  await page.getByTestId('study-dictation').getByRole('alert').waitFor(); assert.equal((await text()).trim(), 'Texto original.');
  checks.push('no-model, denied microphone and failed model paths do not change the document');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, screenshots, errors }, null, 2));
  await writeFile(path.join(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Dictado: revisión corregida</title><style>body{background:#eef0f4;font:15px system-ui;padding:24px;max-width:1280px;margin:auto}img{width:100%;border:1px solid #ccc;border-radius:12px}figure{margin:24px 0}li{margin:10px 0}</style><h1>Dictado: revisión corregida</h1><ul>${checks.map(check => `<li>${check}</li>`).join('')}</ul>${screenshots.map(file => `<figure><figcaption>${file}</figcaption><img src="${file}"></figure>`).join('')}`);
  await rm(path.join(output, 'failure.png'), { force: true });
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally { await browser?.close(); await server.close(); await rm(temp, { recursive: true, force: true }); }
