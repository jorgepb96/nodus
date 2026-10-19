// Uses the real Electron application and real IPC, with synthetic sources only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-support-ui-')));
const profile = path.join(scratch,'synthetic-profile'); fs.mkdirSync(profile);
fs.writeFileSync(path.join(profile,'app-prefs.json'),JSON.stringify({uiLanguage:'en'}));
fs.writeFileSync(path.join(profile,'vaults.json'),JSON.stringify({vaults:[]}));
const messages = path.join(scratch,'messages.mjs');
await build({entryPoints:[path.join(root,'shared/support/messages.ts')],outfile:messages,bundle:true,format:'esm'});
const { SUPPORT_LANGUAGES, supportText } = await import(new URL(`file://${messages}`));
const output = path.join(root,'.ci/support-ui'); fs.mkdirSync(output,{recursive:true});
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({args:[path.join(root,'build/support-app'),`--support-state=${path.join(scratch,'assistant-state')}`,`--nodus-profile=${profile}`],env,timeout:60000});
const errors = [];
try {
  // Other native fixtures can open windows. Keep rendering checks progressing
  // while this synthetic window is occluded, as they do on a dedicated CI host.
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await page.waitForSelector('h1');
  await page.evaluate(fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'),'utf8'));
  for (const language of SUPPORT_LANGUAGES) {
    await page.locator('.preferences select').selectOption(language);
    await page.waitForFunction(({language,text}) => document.documentElement.lang === language && document.querySelector('h1')?.textContent === text,{language,text:supportText(language,'welcome')});
    for (const theme of ['light','dark']) {
      const current = await page.evaluate(()=>document.documentElement.classList.contains('dark')?'dark':'light');
      if (theme !== current) await page.locator('.theme-toggle').click();
      await page.evaluate(()=>Promise.race([Promise.allSettled(document.getAnimations().map(animation=>animation.finished)),new Promise(resolve=>setTimeout(resolve,1000))]));
      assert.equal(await page.locator('h1').innerText(),supportText(language,'welcome'));
      assert.equal(await page.evaluate(()=>document.documentElement.lang),language);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),true);
      const accessibility=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
      assert.deepEqual(accessibility.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))})),[],`${language}/${theme} accessibility`);
      await page.screenshot({path:path.join(output,`${language}-${theme}.png`),fullPage:true});
    }
  }
  await page.locator('.preferences select').selectOption('en');
  await page.locator('.preferences select').focus();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.className),'theme-toggle');
  const themeBefore=await page.evaluate(()=>document.documentElement.classList.contains('dark'));await page.keyboard.press('Space');
  assert.notEqual(await page.evaluate(()=>document.documentElement.classList.contains('dark')),themeBefore);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.theme-toggle').evaluate(element=>getComputedStyle(element).transitionDuration),'0s');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  await page.waitForFunction(()=>window.innerWidth<700);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'200% scaling must not hide content');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  await page.getByRole('button',{name:'Check my installation',exact:true}).click();
  await page.getByRole('button',{name:'Create verified copy',exact:true}).waitFor();
  await page.getByRole('button',{name:'Create verified copy',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('button.primary:disabled'));
  assert.equal(fs.readFileSync(path.join(profile,'app-prefs.json'),'utf8'),JSON.stringify({uiLanguage:'en'}));
  await page.getByRole('button',{name:'Get help',exact:true}).click();
  await page.locator('textarea').waitFor();
  assert.match(await page.locator('textarea').inputValue(),/Nodus support report/);
  assert.equal(await page.getByRole('button',{name:'Open issue on GitHub',exact:true}).isDisabled(),true);
  assert.equal(errors.length,0,errors.join('\n'));
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({languages:SUPPORT_LANGUAGES,themes:['light','dark'],screenshots:24,wcagAxeChecks:24,keyboard:true,reducedMotion:true,scaling200:true,originalsUnchanged:true,errors},null,2));
  console.log('Nodus Support: real native UI, 12 languages, 2 themes, protected originals and issue review passed.');
} finally { await app.close(); /* Keep evidence and synthetic session files for inspection. */ }
