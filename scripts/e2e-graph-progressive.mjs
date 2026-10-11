import {_electron as electron} from 'playwright-core';
import {createRequire} from 'node:module';import fs from 'node:fs';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=process.cwd(),appVersion=require(root+'/package.json').version,profile=fs.mkdtempSync('/tmp/nodus-stellar-e2e-');fs.mkdirSync(root+'/work/stellar-preview',{recursive:true});
const app=await electron.launch({executablePath:require('electron'),args:[root],env:{...process.env,NODUS_USERDATA:profile,NODUS_STELLAR_PREVIEW:'1',NODUS_DISABLE_AUTO_UPDATE:'1',NODUS_DISABLE_ANNOUNCEMENTS:'1',NODUS_QA_ROOT:profile,NODUS_QA_DATABASE_AUDIT_LOG:profile+'/database-audit.jsonl'}});
try{
const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.waitForFunction(()=>typeof window.nodus?.stellarPage==='function');
await page.evaluate(async(version)=>{sessionStorage.setItem('nodus.startupUpdateChecked','1');localStorage.setItem('nodus.lastSeenVersion',version);localStorage.setItem('nodus.mobileTeaserSeen.5.3.1','1');for(const key of ['nodus.platformHighlightsSeen.2026-07','nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA','nodus.toolkitBetaGuideSeen.2.4.0'])localStorage.setItem(key,'1');await window.nodus.updateSettings({onboardingComplete:true,basicsTutorialVersion:5,recoverySetupVersion:1,tourComplete:true,advancedTourComplete:true,mascotEnabled:false,mascotStyle:'orb',mascotStyleChosen:true,uiLanguage:'es',theme:'dark'});},appVersion);
await page.evaluate(async()=>{await window.nodus.seedDemoData();/* Same as the welcome's Later: the demonstration profile has seen it. */await window.nodus.setResearchPreparationPolicy({welcomeVersion:1});});await page.reload();await page.waitForTimeout(1800);
// Exercise the short viewport available on CI and smaller laptop displays.
await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1500,700);});
await page.locator('[data-tour="nav-graph"]').click();await page.getByTestId('stellar-canvas').waitFor();
await page.waitForTimeout(1000);await page.screenshot({path:root+'/work/stellar-preview/start.png'});
const report=await page.evaluate(async()=>{const first=await window.nodus.stellarPage({kind:'search',limit:20});for(const n of first.nodes){const p=await window.nodus.stellarPage({kind:'neighbors',id:n.id,limit:200});if(p.edges.length>2)return {node:n,neighbors:p};}return {node:first.nodes[0]};});
assert.ok(report.node,'real ideas loaded');
await page.getByTestId('stellar-themes').waitFor();
await page.getByRole('button',{name:'Nuevo grafo',exact:true}).click();
await page.getByTestId('stellar-workspace').waitFor();
await page.getByRole('spinbutton',{name:'Límite de relaciones'}).fill('1');
await page.locator('.stellar-tab-panel .stellar-search input').fill(report.node.label);await page.waitForTimeout(600);await page.locator('.stellar-tab-panel .stellar-search-choice').first().click();
await page.waitForFunction(()=>document.querySelector('.stellar-tab-panel .stellar-workspace')?.getAttribute('data-edge-count')==='1');
const click = name => page.getByRole('button', { name, exact: true }).evaluate(button => button.click());
const frame = async () => {
  // Layout-worker replies and ResizeObserver callbacks can restart the camera
  // transition. Wait for the actual framing invariant, not a fixed wall-clock delay.
  try {
    await page.waitForFunction(() => {
      if (document.querySelector('.stellar-player-line > button:nth-child(3)').disabled) return false;
      const canvas = document.querySelector('.stellar-canvas').getBoundingClientRect();
      const player = document.querySelector('.stellar-player').getBoundingClientRect();
      const labels = [...document.querySelectorAll('.stellar-node-label.featured')];
      return labels.length === 2 && labels.every(node => {
        const box = node.getBoundingClientRect();
        return box.left >= canvas.left && box.right <= canvas.right && box.top >= canvas.top && box.bottom < player.top;
      });
    }, undefined, { timeout: 10000 });
  } catch (error) {
    await page.screenshot({path:root+'/work/stellar-preview/framing-failure.png'});
    console.error('Framing geometry:', JSON.stringify(await page.evaluate(() => ({
      canvas:document.querySelector('.stellar-canvas').getBoundingClientRect().toJSON(),
      player:document.querySelector('.stellar-player').getBoundingClientRect().toJSON(),
      labels:[...document.querySelectorAll('.stellar-node-label.featured')].map(node=>({text:node.textContent,box:node.getBoundingClientRect().toJSON()})),
    })), null, 2));
    throw error;
  }
};
await click('Siguiente →'); await frame();
const first = await page.locator('.stellar-step-node').evaluateAll(nodes => nodes.map(node => node.dataset.stepNode));
await click('Encuadrar'); await click('Siguiente →'); await frame();
await page.locator('.stellar-tab-panel').getByTitle('Alejar', {exact:true}).evaluate(button => button.click());
await click('← Anterior'); await frame();
assert.deepEqual(await page.locator('.stellar-step-node').evaluateAll(nodes => nodes.map(node => node.dataset.stepNode)), first, 'Previous restores the original relationship direction');
await page.locator('.stellar-step-node').last().click();
await page.locator('.graph-detail-panel h3').waitFor();
const detailTitle = await page.locator('.graph-detail-panel h3').innerText();
await page.getByRole('spinbutton', {name:'Límite de relaciones'}).fill('2');
await page.getByRole('combobox', {name:'Velocidad'}).selectOption('2');
const beforePlay = Number(await page.getByTestId('stellar-workspace').getAttribute('data-edge-count'));
await click('▶ Play'); await frame();
await page.waitForTimeout(2400); await frame();
assert.equal(await page.getByRole('button', {name:'▶ Play', exact:true}).count(), 1, 'Play stops at the exact limit');
assert.equal(await page.locator('.graph-detail-panel h3').innerText(), detailTitle, 'playback keeps the chosen detail open');
await page.waitForTimeout(650);
assert.equal(Number(await page.getByTestId('stellar-workspace').getAttribute('data-edge-count')), beforePlay + 2, 'Play adds exactly two relationships');
for (const control of ['← Anterior', 'Siguiente →']) {
  await click('Encuadrar'); await click(control); await frame();
  assert.equal(await page.locator('.graph-detail-panel h3').innerText(), detailTitle, 'transport preserves sidebar content');
}
for (const light of [false, true]) {
  await page.evaluate(light => document.documentElement.classList.toggle('light', light), light);
  await page.locator('.graph-detail-scroll').evaluate(element => element.scrollTop = 100);
  const header = await page.evaluate(() => {
    const panel = document.querySelector('.graph-detail-panel').getBoundingClientRect();
    const element = document.querySelector('.graph-detail-header'), h = element.getBoundingClientRect();
    const body = document.querySelector('.graph-detail-scroll').getBoundingClientRect();
    return {top:h.top-panel.top, gap:body.top-h.bottom, color:getComputedStyle(element).backgroundColor};
  });
  assert.ok(Math.abs(header.top) < 1 && header.gap >= 24, 'header stays at the top with space below');
  assert.match(header.color, /^rgb\(/, 'header is opaque');
  await page.screenshot({path:root+'/work/stellar-preview/demo-stellar-'+(light?'light':'dark')+'.png'});
}
await page.reload();await page.waitForTimeout(1000);await page.locator('[data-tour="nav-graph"]').click();await page.waitForTimeout(1800);
await page.getByTestId('stellar-themes').waitFor();
assert.equal(await page.getByRole('tab').count(),1,'reload returns to the permanent themes hub');
await page.getByRole('button',{name:'Nuevo grafo',exact:true}).click();
assert.equal(await page.getByTestId('stellar-workspace').getAttribute('data-node-count'),'0','a fresh exploration starts empty');
assert.equal(await page.getByRole('button',{name:'▶ Play',exact:true}).isDisabled(),true,'an empty graph has no playback seed');
assert.deepEqual(errors,[]);
console.log('Stellar E2E: direct search, framing after manual navigation, native direction, exact playback budget, pinned detail, opaque header, and hub reload with a fresh empty exploration passed');
}finally{await app.close();fs.rmSync(profile,{recursive:true,force:true});}
