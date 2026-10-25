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
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nodus-source-notice-ui-'));
const artifacts = path.join(root, 'artifacts/research-harness/source-notices');
let app;
try {
  await fs.mkdir(artifacts, { recursive: true });
  await build({ entryPoints: ['visual-tests/research-source-notices-entry.tsx'], outfile: path.join(temp, 'ui.js'), bundle: true, format: 'esm', platform: 'browser',
    alias: { '@shared': path.join(root, 'shared') }, loader: { '.svg': 'dataurl', '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'dataurl', '.jpg': 'dataurl' }, logLevel: 'silent',
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
  const trigger = page.getByRole('button', { name: 'Sobre las fuentes' });
  await trigger.waitFor();
  assert.equal(await page.getByText(/los pasajes recuperados/).count(), 0);
  assert.equal(await page.getByTestId('no-notice').getByRole('button').count(), 0);
  await page.getByRole('button', { name: 'Copiar', exact: true }).click();
  assert.equal(await page.getByTestId('copied').textContent(), 'La campaña promovía una imagen del país. Su recepción no demuestra por sí sola que cambiara la opinión de todos los visitantes.');
  await trigger.click();
  const balloon = page.getByRole('dialog', { name: 'Sobre las fuentes' });
  await balloon.waitFor();
  assert.ok((await balloon.textContent()).includes('los pasajes recuperados'));
  await page.screenshot({ path: path.join(artifacts, 'light.png') });
  await page.keyboard.press('Escape');
  assert.equal(await balloon.count(), 0);
  await trigger.focus(); await page.keyboard.press('Enter'); await balloon.waitFor();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  await trigger.click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.documentElement.classList.replace('light', 'dark'));
  await trigger.click(); await balloon.waitFor();
  await page.screenshot({ path: path.join(artifacts, 'dark.png') });
  await page.setViewportSize({ width: 380, height: 720 });
  await page.screenshot({ path: path.join(artifacts, 'narrow.png') });
  const rect = await balloon.boundingBox();
  assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= 380);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.locator('main').click({ position: { x: 2, y: 2 } });
  assert.equal(await balloon.count(), 0);
  assert.deepEqual(errors, []);
  console.log('Source-note UI passed: optional, clean copy, click/keyboard, dismissal/focus, dark/light and narrow viewport.');
} finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true }); }
