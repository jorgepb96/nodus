// Focused real-Electron UI verification with synthetic credentials and no user profile.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(repo, 'docs/research-evidence/model-setup'));
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-model-ui-'));
const require = createRequire(import.meta.url);
let app;
try {
  await mkdir(output, { recursive: true });
  await mkdir(path.join(tmp, 'profile'));
  await mkdir(path.join(tmp, 'session'));
  const cssPath = path.join(repo, 'src/index.css');
  const css = (await readFile(cssPath, 'utf8')).replace(/@import '([^']+)';/g, (_match, file) => readFileSync(path.resolve(path.dirname(cssPath), file), 'utf8'));
  const config = (await import(pathToFileURL(path.join(repo, 'tailwind.config.js')))).default;
  const styled = await postcss([tailwind({ ...config, content: [path.join(repo, 'src/**/*.{ts,tsx}')] })]).process(css, { from: cssPath });
  await writeFile(path.join(tmp, 'app.css'), styled.css);
  await build({
    stdin: { contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ProvidersSettings} from ${JSON.stringify(path.join(repo, 'src/views/ProvidersSettings.tsx'))};
      import {t, setActiveLang} from ${JSON.stringify(path.join(repo, 'src/i18n.ts'))};
      let saved = false;
      window.setupFixture = {failSave:false, calls:[]};
      window.nodus = {
        setApiKey:async()=>{window.setupFixture.calls.push('save');if(window.setupFixture.failSave)throw Error("Error invoking remote method 'settings:setApiKey': Error: fixture: encrypted storage unavailable");saved=true;},
        listModels:async()=>{window.setupFixture.calls.push('list');if(!saved)throw Error('key was not saved');return [{id:'mimo-ui-fixture',name:'MiMo · synthetic test model'}];},
        getChatGptSubscriptionStatus:async()=>({connected:false}),getGitHubCopilotSubscriptionStatus:async()=>({connected:false,quota:[]}),
        onChatGptSubscriptionStatusChanged:()=>()=>{},onGitHubCopilotSubscriptionStatusChanged:()=>()=>{},
      };
      function Harness(){
        const [settings,update]=useState({favorites:[],providerKeys:{xiaomi:false}});
        return <ProvidersSettings settings={settings} onChange={async()=>{update({...settings,providerKeys:{xiaomi:saved}});}}/>;
      }
      const root=createRoot(document.getElementById('root'));
      window.renderLanguage=language=>{setActiveLang(language);saved=false;window.setupFixture.calls=[];window.copy={load:t('Cargar modelos'),saved:t('clave guardada')};root.render(<Harness key={language}/>);};
      window.renderLanguage('zh-CN');
    `, resolveDir: repo, loader: 'tsx' },
    outfile: path.join(tmp, 'ui.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@shared': path.join(repo, 'shared') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  await writeFile(path.join(tmp, 'index.html'), '<!doctype html><html class="dark"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="ui.css"><body style="margin:24px;background:#171717;color:#ddd"><div id="root"></div><script src="ui.js"></script></body></html>');
  const main = path.join(tmp, 'main.cjs');
  await writeFile(main, `const {app,BrowserWindow}=require('electron');app.setName('Nodus Model UI Test');app.setPath('userData',${JSON.stringify(path.join(tmp, 'profile'))});app.setPath('sessionData',${JSON.stringify(path.join(tmp, 'session'))});app.whenReady().then(()=>{app.dock?.hide();const win=new BrowserWindow({width:1200,height:1100,show:false,webPreferences:{sandbox:true,contextIsolation:true}});win.loadFile(${JSON.stringify(path.join(tmp, 'index.html'))});});`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [main], env });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.copy && document.querySelector('[data-testid="provider-xiaomi"]'));
  assert.equal(await page.locator('[data-testid="provider-xiaomi"]').evaluate(row => getComputedStyle(row).borderRadius), '8px', 'use the real application styles');
  for (const [language, failSave] of [['zh-CN', false], ['en', true]]) {
    await page.evaluate(({language, failSave}) => { window.setupFixture.failSave=failSave;window.renderLanguage(language); }, {language, failSave});
    const row = page.locator('[data-testid="provider-xiaomi"]');
    await row.locator('button').first().click();
    await row.locator('input[type="password"]').fill('synthetic-fixture-key');
    await row.getByRole('button', { name: await page.evaluate(() => window.copy.load), exact: true }).click();
    if (failSave) {
      await row.getByRole('alert').waitFor();
      assert.equal(await row.locator('input[type="password"]').inputValue(), 'synthetic-fixture-key');
      assert.equal(await row.getByRole('alert').textContent(), 'fixture: encrypted storage unavailable');
      assert.deepEqual(await page.evaluate(() => window.setupFixture.calls), ['save']);
    } else {
      await row.getByText('mimo-ui-fixture', {exact:true}).waitFor();
      assert.match(await row.locator('button').first().textContent(), new RegExp(await page.evaluate(() => window.copy.saved)));
      assert.equal(await row.locator('input[type="password"]').inputValue(), '');
      assert.deepEqual(await page.evaluate(() => window.setupFixture.calls), ['save','list']);
    }
    await row.screenshot({ path: path.join(output, `${language}-${failSave?'save-error':'saved-and-loaded'}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(`Real Electron model setup UI passed (Chinese save/load and English save failure). Evidence: ${output}`);
} finally { if (app) await app.close(); await rm(tmp, { recursive: true, force: true }); }
