// Run after npm run build. Optional VITE_DEV_SERVER_URL supports local visual iteration.
import {_electron as electron} from 'playwright-core';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=process.cwd(),appVersion=require(root+'/package.json').version,profile=fs.mkdtempSync('/tmp/nodus-argument-preview-');
const env={...process.env,NODUS_USERDATA:profile,NODUS_STELLAR_PREVIEW:'1',NODUS_DISABLE_AUTO_UPDATE:'1',NODUS_DISABLE_ANNOUNCEMENTS:'1',NODUS_QA_ROOT:profile,NODUS_QA_DATABASE_AUDIT_LOG:profile+'/database-audit.jsonl'};
delete env.ELECTRON_RUN_AS_NODE;
fs.mkdirSync(root+'/output/argument-map',{recursive:true});
const app=await electron.launch({executablePath:require('electron'),args:[root],env});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 // macOS changes Spaces asynchronously. DOM fullscreenchange fires before the
 // native transition finishes; another request during that transition may fail.
 await app.evaluate(({BrowserWindow})=>{
  const win=BrowserWindow.getAllWindows()[0];
  win.argumentFullscreenTransitions={entered:0,left:0};
  win.on('enter-full-screen',()=>win.argumentFullscreenTransitions.entered++);
  win.on('leave-full-screen',()=>win.argumentFullscreenTransitions.left++);
 });
 const waitForNativeFullscreen=async(event,count)=>{
  if(process.platform!=='darwin') return;
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
   if(await app.evaluate(({BrowserWindow},{event,count})=>BrowserWindow.getAllWindows()[0].argumentFullscreenTransitions[event]>=count,{event,count})) return;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Native fullscreen transition ${event} ${count} did not finish`);
 };
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1600,1050));
 await page.waitForFunction(()=>typeof window.nodus?.updateSettings==='function');
 await page.evaluate(async(version)=>{sessionStorage.setItem('nodus.startupUpdateChecked','1');localStorage.setItem('nodus.lastSeenVersion',version);localStorage.setItem('nodus.mobileTeaserSeen.5.3.1','1');for(const key of ['nodus.platformHighlightsSeen.2026-07','nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA','nodus.toolkitBetaGuideSeen.2.4.0'])localStorage.setItem(key,'1');await window.nodus.updateSettings({onboardingComplete:true,basicsTutorialVersion:999,recoverySetupVersion:999,tourComplete:true,advancedTourComplete:true,mascotEnabled:false,mascotStyle:'orb',mascotStyleChosen:true,uiLanguage:'es',theme:'dark'});await window.nodus.seedDemoData();/* Same as the welcome's Later: the demonstration profile has seen it. */await window.nodus.setResearchPreparationPolicy({welcomeVersion:1});},appVersion);
 await page.reload();
 const dismiss=page.locator('.backup-health-dismiss'); if(await dismiss.isVisible()) await dismiss.click();
 await page.locator('[data-tour="nav-argument"]').click();
 await page.getByTestId('argument-routes-table').waitFor();
 await page.getByTestId('argument-routes-table').locator('button[title]').first().click();
 await page.getByTestId('argument-map-canvas').waitFor();await page.waitForTimeout(1000);
 const canvas=page.getByTestId('argument-map-canvas');
 const initialCount=await page.locator('.argument-node').count();
 assert.ok(initialCount>1,'real demo routes produce connected cards');
 const initialPositions=await page.locator('.argument-node').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.blockId,left:n.style.left})));
 const expand=page.locator('.argument-node:not(.is-root) button[aria-expanded="false"]').first();
 const branch=await expand.locator('xpath=ancestor::article').getAttribute('data-block-id');
 await expand.click();
 assert.ok(await page.locator('.argument-node').count()>initialCount,'expansion exposes descendants');
 for(const position of initialPositions) assert.equal(await page.locator(`[data-block-id="${position.id}"]`).evaluate(n=>n.style.left),position.left,'branch sides stay stable');
 await page.locator(`[data-block-id="${branch}"] button[aria-expanded="true"]`).click();
 assert.equal(await page.locator('.argument-node').count(),initialCount,'collapse removes only descendants');
 const filter=page.locator('.argument-relations button').filter({hasText:'contradice'});
 await filter.click();assert.equal(await page.locator('.argument-node').count(),2,'relation filter retains seed and matching branch');
 await page.getByRole('button',{name:/Todas las ramas/}).click();assert.equal(await page.locator('.argument-node').count(),initialCount);
 const transform=()=>page.locator('.argument-world').evaluate(n=>n.style.transform);
 const original=await transform();
 await page.getByRole('button',{name:'Acercar',exact:true}).click();assert.notEqual(await transform(),original,'zoom changes camera');
 await page.getByRole('button',{name:'Encuadrar',exact:true}).click();assert.equal(await transform(),original,'fit restores framing');
 const stage=page.locator('.argument-stage');await stage.focus();await page.keyboard.press('ArrowRight');assert.notEqual(await transform(),original,'keyboard pans canvas');
 await page.getByRole('button',{name:'Encuadrar',exact:true}).click();
 const bounds=await stage.boundingBox();
 await page.mouse.move(bounds.x+20,bounds.y+100);await page.mouse.down();await page.mouse.move(bounds.x+100,bounds.y+140);await page.mouse.up();
 assert.notEqual(await transform(),original,'pointer drag pans the world');
 assert.equal(await page.evaluate(()=>window.getSelection()?.toString()),'','panning does not select canvas text');
 await page.getByRole('button',{name:'Encuadrar',exact:true}).click();
 await page.mouse.wheel(0,-200);await page.waitForTimeout(80);assert.notEqual(await transform(),original,'wheel zoom changes camera');
 await page.getByRole('button',{name:'Encuadrar',exact:true}).click();
 await page.getByRole('button',{name:'Esquema',exact:true}).click();assert.equal(await canvas.isVisible(),false);
 await page.getByRole('button',{name:'Mapa visual',exact:true}).click();assert.equal(await canvas.isVisible(),true);
 assert.equal(await transform(),original,'view switching preserves camera');
 await page.getByTestId('argument-tab-catalog').click();
 await page.getByTestId('argument-tab-map').first().click();assert.equal(await page.locator('.argument-node').count(),initialCount,'tab switching preserves map');
 await page.waitForTimeout(450);
 await page.screenshot({path:root+'/output/argument-map/dark.png'});
 await canvas.screenshot({path:root+'/output/argument-map/map-dark.png'});
 await page.locator('.argument-node:not(.is-root) .argument-node-content').first().click();
 await page.locator('.graph-detail-panel h3').waitFor();
 assert.ok(await page.locator('.argument-wires .is-traced').count()>0,'selection traces its path to the seed');
 const zoom=()=>page.locator('.argument-world').evaluate(el=>Number(el.style.transform.match(/scale\(([^)]+)/)[1]));
 for(let i=0;i<6;i++) await page.getByRole('button',{name:'Alejar',exact:true}).click();
 const wideView=await transform(),wideZoom=await zoom();
 await page.locator('.argument-node-content').nth(3).click();
 await page.waitForTimeout(400);
 const focusedCard=await page.locator('.argument-node.is-selected').boundingBox(),focusedStage=await stage.boundingBox();
 assert.ok(await zoom()>wideZoom,'selection enlarges the card in a dense view');
 assert.ok(await zoom()>=.85 || focusedCard.height>=focusedStage.height-150-.5,'focus reaches a readable scale or uses the available height above controls');
 assert.ok(focusedCard.y>=focusedStage.y && focusedCard.y+focusedCard.height<=focusedStage.y+focusedStage.height,'the focused card fits vertically in a short viewport');
 await page.getByRole('button',{name:'Vista anterior',exact:true}).click();
 assert.equal(await transform(),wideView,'previous view restores the exact manual frame without closing branches');
 const autoFocus=page.getByRole('switch',{name:'Zoom automático',exact:true});
 await autoFocus.click();assert.equal(await autoFocus.getAttribute('aria-checked'),'false');
 const manualZoom=await zoom();
 await page.locator('.argument-node-content').nth(1).click();
 assert.equal(await zoom(),manualZoom,'disabled auto zoom leaves selection at the manual scale');
 assert.equal(await page.evaluate(()=>localStorage.getItem('nodus.argumentMap.autoFocus')),'false','the preference is remembered');
 await page.getByTestId('argument-tab-catalog').click();await page.getByTestId('argument-tab-map').first().click();
 assert.equal(await autoFocus.getAttribute('aria-checked'),'false','tab switches preserve the preference');
 await autoFocus.click();await page.locator('.argument-node-content').nth(1).click();
 await page.waitForTimeout(400);
 await page.screenshot({path:root+'/output/argument-map/auto-focus.png'});

 await page.waitForTimeout(450);
 await page.screenshot({path:root+'/output/argument-map/detail.png'});
 await page.locator('.argument-node:not(.is-root) .argument-node-content').first().dblclick();
 assert.equal(await page.evaluate(()=>window.getSelection()?.toString()),'','double-clicking a card never selects text');
 // Source excerpts keep native text selection for copying and citing.
 assert.notEqual(await page.locator('.graph-detail-panel').evaluate(el=>getComputedStyle(el).userSelect),'none');
 const normalHeight=await stage.evaluate(el=>el.getBoundingClientRect().height);
 for(const theme of ['dark','light']) {
  console.log(`[argument-map] entering fullscreen (${theme})`);
  const transition=theme==='dark'?1:2;
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());
  await page.waitForFunction(()=>document.hasFocus());
  await page.evaluate(theme=>{document.documentElement.classList.remove('dark','light');document.documentElement.classList.add(theme);},theme);
  await page.getByRole('button',{name:'Pantalla completa',exact:true}).click();
  try {
   await page.waitForFunction(()=>document.fullscreenElement?.classList.contains('argument-map-tab'));
  } catch(error) {
   console.error('[argument-map] fullscreen diagnostics',await page.evaluate(()=>({focused:document.hasFocus(),fullscreen:document.fullscreenElement?.className,error:document.body.textContent.includes('No se pudo activar la pantalla completa.')})),await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];return {focused:win.isFocused(),fullscreen:win.isFullScreen()};}));
   throw error;
  }
  await waitForNativeFullscreen('entered',transition);
  const geometry=await page.locator('.argument-map-tab').evaluate(el=>{const rect=el.getBoundingClientRect();return {width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight};});
  assert.ok(Math.abs(geometry.width-geometry.viewportWidth)<2 && Math.abs(geometry.height-geometry.viewportHeight)<2,'workspace fills the screen');
  assert.ok(await stage.evaluate(el=>el.getBoundingClientRect().height)>normalHeight,'fullscreen gives the canvas more space');
  assert.ok(await zoom()>=.85,'full-screen focus presents the selected card at a readable scale');
  assert.equal(await page.locator('.argument-atlas-heading').isVisible(),false,'full screen hides the overview');
  assert.equal(await page.locator('.graph-detail-panel').isVisible(),true,'source details remain visible in full screen');
  const surface=await canvas.evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.equal(surface,theme==='dark'?'rgb(9, 13, 27)':'rgb(246, 247, 252)','fullscreen inherits the chosen theme');
  await page.screenshot({path:root+'/output/argument-map/fullscreen-'+theme+'.png'});
  if(theme==='dark') await page.getByRole('button',{name:'Salir de pantalla completa',exact:true}).click();
  else await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.fullscreenElement);
  await waitForNativeFullscreen('left',transition);
  assert.equal(await page.locator('.argument-atlas-heading').isVisible(),true,'exit restores the overview');
  assert.equal(await page.locator('.argument-node').count(),initialCount,'fullscreen preserves branches');
 }
 await page.screenshot({path:root+'/output/argument-map/light.png'});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,800));
 await page.waitForTimeout(400);
 assert.equal(await page.locator('.argument-camera-controls').isVisible(),true,'controls remain available with a detail panel on smaller windows');
 assert.deepEqual(errors,[]);
 console.log('Argument map E2E passed: expansion, stable branches, collapse, filter, zoom, fit, keyboard pan, outline, tabs, real detail, light/dark full screen, Escape, source selection, and no accidental canvas text selection.');
}finally{await app.close();fs.rmSync(profile,{recursive:true,force:true});}
