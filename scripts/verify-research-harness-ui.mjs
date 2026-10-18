import assert from 'node:assert/strict';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { _electron } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nodus-harness-ui-'));
const artifacts = path.join(root, 'artifacts/research-harness');
let app;
try {
  await fs.mkdir(artifacts, { recursive: true });
  await build({ entryPoints: ['visual-tests/research-harness-entry.tsx'], outfile: path.join(temp, 'ui.js'), bundle: true, format: 'esm', platform: 'browser',
    alias: { '@shared': path.join(root, 'shared') }, loader: { '.svg': 'dataurl', '.woff2': 'file' }, logLevel: 'silent',
    plugins: [{ name: 'styles', setup(builder) { builder.onLoad({ filter: /src\/index\.css$/ }, async args => ({
      contents: (await postcss([tailwindcss({ config: path.join(root, 'tailwind.config.js') })]).process(await fs.readFile(args.path, 'utf8'), { from: args.path })).css,
      loader: 'css', resolveDir: path.dirname(args.path),
    })); } }] });
  await fs.writeFile(path.join(temp, 'index.html'), '<!doctype html><html class="light" style="--interface-scale:1"><head><meta charset="utf-8"><link rel="stylesheet" href="./ui.css"></head><body><div id="root"></div><script type="module" src="./ui.js"></script></body></html>');
  await fs.writeFile(path.join(temp, 'main.cjs'), `const {app,BrowserWindow}=require('electron'); app.setPath('userData',${JSON.stringify(path.join(temp, 'profile'))}); app.whenReady().then(()=>{ const w=new BrowserWindow({width:900,height:700,show:false}); w.loadFile(${JSON.stringify(path.join(temp, 'index.html'))}); });`);
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: require('electron'), args: [path.join(temp, 'main.cjs')], env: environment });
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.getByTestId('research-harness-control').waitFor();
  assert.equal(await page.getByRole('radio', { name: 'Rápido', exact: true }).isChecked(), true);
  await page.getByRole('radio', { name: 'Rápido', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('radio', { name: 'Ampliado', exact: true }).isChecked(), true);
  await page.getByLabel('Búsqueda web', { exact: true }).check();
  const panel = page.getByTestId('research-harness-panel'); await panel.locator('summary').click();
  await panel.getByText(/Contrastar explicaciones alternativas/).waitFor();
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Continuar' && !button.disabled));
  await page.screenshot({ path: path.join(artifacts, 'light.png') });
  await page.evaluate(() => { document.documentElement.classList.replace('light', 'dark'); });
  await page.screenshot({ path: path.join(artifacts, 'dark.png') });
  await page.setViewportSize({ width: 380, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: path.join(artifacts, 'narrow.png') });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await panel.getByText(/Evidencia suficiente/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Continuar', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Harness UI passed: profile switch, web switch, pause/resume, terminal state, dark/light and narrow layout.');
} finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true }); }
