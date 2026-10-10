import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-svg-runtime-'));
const file = path.join(dir, 'check.cjs');
await build({
  stdin: { contents: `import { app, BrowserWindow } from 'electron'; import assert from 'node:assert/strict'; import { inspectChatSvg, refineChatSvg } from './electron/ai/chatSvgQuality'; import { sanitizeChatSvg } from './shared/chatSvg'; import { DEFAULT_CHAT_SKILLS, splitChatVisuals } from './shared/chatSkills';
    app.setPath('userData', ${JSON.stringify(dir)}); app.on('window-all-closed', () => {});
    app.whenReady().then(async () => {
      const svg = (body) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">'+body+'</svg>';
      assert.deepEqual(await inspectChatSvg(svg('<text x="20" y="40" font-size="20">Readable label</text>')), []);
      assert.ok((await inspectChatSvg(svg('<text x="390" y="40" font-size="20">Clipped label</text>'))).some(issue => issue.includes('Clipped')));
      assert.ok((await inspectChatSvg(svg('<text x="20" y="40">One label</text><text x="25" y="40">Other label</text>'))).some(issue => issue.includes('Overlapping')));
      assert.ok((await inspectChatSvg(svg('<rect x="20" y="20" width="100" height="60" fill="blue"/><text x="30" y="50" font-size="20">Overflowing card label</text>'))).some(issue => issue.includes('box boundary')));
      assert.ok((await inspectChatSvg(svg('<circle cx="100" cy="100" r="50" fill="blue"/><text x="55" y="108" font-size="20">Long node title</text>'))).some(issue => issue.includes('circular node')));
      assert.ok((await inspectChatSvg('<svg><invalid')).some(issue => issue.includes('Invalid')));
      assert.deepEqual(await inspectChatSvg(svg('<script>throw new Error("must not execute")</script><text onload="throw 1" x="10" y="30">Safe</text>')), []);
      const probe = new BrowserWindow({ show: false, focusable: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
      await probe.loadURL('data:text/html,<body></body>');
      const hostile = svg('<script>alert(1)</script><foreignObject>HTML</foreignObject><image href="https://example.com/private"/><use href="file:///etc/passwd"/><style>@import url(https://example.com/font);</style><text onclick="alert(1)" x="10" y="30">Safe</text>');
      const clean = await probe.webContents.executeJavaScript('(' + sanitizeChatSvg.toString() + ')(' + JSON.stringify(hostile) + ')');
      assert.doesNotMatch(clean.svg, /script|foreignObject|onclick|https:|file:|@import/);
      assert.match(clean.svg, /Safe/);
      // A model writing a divider comment emits two dashes inside it, which XML forbids:
      // the parser rejected the whole drawing over a decoration that never renders.
      // Checked in a real parser, because that is the only place the rejection happens.
      const commented = svg('<!-- ---- section ---- --><text x="10" y="30">Kept</text>');
      const survived = await probe.webContents.executeJavaScript('(' + sanitizeChatSvg.toString() + ')(' + JSON.stringify(commented) + ')');
      assert.ok(survived, 'a dashed comment must not take the drawing with it');
      assert.match(survived.svg, /Kept/);
      assert.doesNotMatch(survived.svg, /section/, 'and the comment itself is gone');
      probe.destroy();
      // Reproduce Electron's generic "Script failed to execute" rejection. A
      // failed optional layout review must not replace the chat answer with it.
      let rendererFailures = 0;
      const failNextInspection = () => app.once('browser-window-created', (_event, win) => {
        const execute = win.webContents.executeJavaScript.bind(win.webContents);
        win.webContents.executeJavaScript = async () => {
          try { return await execute('throw new Error("Injected SVG inspection failure")'); }
          catch (error) { rendererFailures++; assert.match(error.message, /Script failed to execute/); throw error; }
        };
      });
      const originalSvg = svg('<title>Preserved drawing</title><text x="20" y="40">Readable label</text>');
      const originalAnswer = 'Here is your drawing.\\n\\n' + originalSvg + '\\n\\nIts explanation remains available.';
      const options = { question: 'Draw a diagram', skills: DEFAULT_CHAT_SKILLS };
      failNextInspection();
      const fallback = await refineChatSvg(originalAnswer, options);
      assert.equal(rendererFailures, 1, 'real renderer failure was exercised');
      assert.equal(splitChatVisuals(fallback).find(part => part.kind === 'svg').content, originalSvg);
      assert.match(fallback, /Here is your drawing/);
      assert.match(fallback, /Its explanation remains available/);
      assert.doesNotMatch(fallback, /Script failed|Injected SVG/);
      assert.equal(BrowserWindow.getAllWindows().length, 0, 'failed inspection window was released');
      const controller = new AbortController(); controller.abort();
      await assert.rejects(refineChatSvg(originalAnswer, { ...options, signal: controller.signal }), { name: 'AbortError' });
      console.log('SVG runtime regression: renderer failure preserves the drawing and prose, closes the inspection window, and still honors cancellation.');
      console.log('SVG runtime QA: layout, box overflow, XML validation and removal of executable/external content passed.'); app.quit();
    }).catch(error => { console.error(error); app.exit(1); });`, resolveDir: root, loader: 'ts' },
  outfile: file, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent',
  plugins: [{ name: 'qa-only', setup(api) {
    api.onResolve({ filter: /^\.\/aiClient$/ }, () => ({ path: 'ai', namespace: 'mock' }));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const completeText = () => { throw new Error("Unexpected model call"); }; export const resolveModelRef = () => { throw new Error("Unexpected model resolution"); };', loader: 'js' }));
    api.onResolve({ filter: /^@shared\// }, ({ path: specifier }) => ({ path: path.join(root, 'shared', specifier.slice(8) + '.ts') }));
  } }],
});
try {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(require('electron'), [file], { env, stdio: 'inherit', timeout: 30_000 });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
