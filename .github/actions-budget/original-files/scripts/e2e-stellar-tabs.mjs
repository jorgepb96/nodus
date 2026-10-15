// npm run build && node scripts/e2e-stellar-tabs.mjs (optional VITE_DEV_SERVER_URL).
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=process.cwd(),appVersion=require(root+'/package.json').version,profile=fs.mkdtempSync('/tmp/nodus-stellar-tabs-');
const env={...process.env,NODUS_USERDATA:profile,NODUS_STELLAR_PREVIEW:'1',NODUS_DISABLE_AUTO_UPDATE:'1',NODUS_DISABLE_ANNOUNCEMENTS:'1',NODUS_QA_ROOT:profile,NODUS_QA_DATABASE_AUDIT_LOG:profile+'/database-audit.jsonl'};
delete env.ELECTRON_RUN_AS_NODE;
fs.mkdirSync(root+'/output/stellar-tabs',{recursive:true});
const app=await electron.launch({executablePath:require('electron'),args:[root],env});
try {
 const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1560,1000));
 await page.waitForFunction(()=>typeof window.nodus?.updateSettings==='function');
 await page.evaluate(async(version)=>{
  sessionStorage.setItem('nodus.startupUpdateChecked','1');localStorage.setItem('nodus.lastSeenVersion',version);localStorage.setItem('nodus.mobileTeaserSeen.5.3.1','1');
  for(const key of ['nodus.platformHighlightsSeen.2026-07','nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA','nodus.toolkitBetaGuideSeen.2.4.0'])localStorage.setItem(key,'1');
  await window.nodus.updateSettings({onboardingComplete:true,basicsTutorialVersion:999,recoverySetupVersion:999,tourComplete:true,advancedTourComplete:true,mascotEnabled:false,mascotStyle:'orb',mascotStyleChosen:true,uiLanguage:'es',theme:'dark'});
  await window.nodus.seedDemoData();
  /* Same as the welcome's Later: the demonstration profile has seen it. */
  await window.nodus.setResearchPreparationPolicy({welcomeVersion:1});
  const state=await window.nodus.getStellarSession('academic:corpus');
  await window.nodus.saveStellarSession(state.vaultId,'academic:corpus',{version:1,seeds:['demo-i1'],history:[],cursor:0,activeSeed:'demo-i1',positions:{},camera:{x:0,y:0,zoom:1},limit:3,speed:1});
 },appVersion);
 // Give one demo idea a second theme so the hub must deduplicate memberships.
 execFileSync(require('electron'),['-e',`
  const fs=require('node:fs'),path=require('node:path');
  const profile=process.argv[2];
  const registry=JSON.parse(fs.readFileSync(path.join(profile,'vaults.json'),'utf8'));
  const target=registry.vaults.find(v=>v.id===registry.activeVaultId).path;
  if(!target.startsWith(profile+path.sep))throw new Error('Fixture database is outside the demo profile');
  const Database=require(process.argv[1]),db=new Database(target);
  try {
   const inserted=db.prepare("INSERT INTO idea_theme_links(nodus_id,global_id,theme_id,confidence,basis) SELECT io.nodus_id,io.global_id,t.theme_id,1,'explicit' FROM idea_occurrences io CROSS JOIN themes t WHERE io.global_id='demo-i1' AND NOT EXISTS(SELECT 1 FROM idea_theme_links l WHERE l.nodus_id=io.nodus_id AND l.global_id=io.global_id AND l.theme_id=t.theme_id) ORDER BY t.theme_id LIMIT 1").run();
   if(inserted.changes!==1)throw new Error('The overlapping-theme fixture was not inserted');
  } finally {db.close();}
 `,require.resolve('better-sqlite3'),profile],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
 await page.reload();await page.locator('[data-tour="nav-graph"]').click();
 const active=()=>page.locator('.stellar-tab-panel [data-testid="stellar-workspace"]');
 const hub=()=>page.locator('.stellar-tab-panel [data-testid="stellar-themes"]');
 const captureThemes=process.env.NODUS_STELLAR_THEME_CAPTURE==='1';
 const reviewDir=root+'/output/stellar-theme-review';
 if(captureThemes)fs.mkdirSync(reviewDir,{recursive:true});
 const captureAppearance=async name=>{
  if(!captureThemes)return;
  const original=await page.evaluate(()=>document.documentElement.classList.contains('light')?'light':'dark');
  for(const mode of ['light','dark']){
   await page.evaluate(mode=>{document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(mode);},mode);
   await page.mouse.move(10,10);await page.waitForTimeout(180);
   const colors=await page.locator('.stellar-tab-panel .stellar-workspace:visible').evaluate(el=>({
    graph:getComputedStyle(el).backgroundColor,body:getComputedStyle(document.body).backgroundColor,
    node:el.querySelector('.stellar-node-label')?getComputedStyle(el.querySelector('.stellar-node-label')).color:null,
   }));
   assert.equal(colors.graph,colors.body,'graph uses the same background as the app');
   if(colors.node)assert.equal(colors.node,mode==='light'?'rgb(38, 40, 62)':'rgb(230, 234, 248)','node caption colors stay unchanged');
   await page.screenshot({path:reviewDir+'/'+name+'-'+mode+'.png'});
  }
  await page.evaluate(mode=>{document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(mode);},original);
 };
 const count=async field=>Number(await active().getAttribute(`data-${field}-count`));
 const waitEdges=n=>page.waitForFunction(n=>document.querySelector('.stellar-tab-panel [data-testid="stellar-workspace"]')?.getAttribute('data-edge-count')===String(n),n);
 const centered=async button=>{
  const delta=await button.evaluate(button=>{
   const icon=button.querySelector('svg'),box=button.getBoundingClientRect(),shape=icon.getBBox();
   const center=new DOMPoint(shape.x+shape.width/2,shape.y+shape.height/2).matrixTransform(icon.getScreenCTM());
   return {x:center.x-box.x-box.width/2,y:center.y-box.y-box.height/2};
  });
  assert.ok(Math.abs(delta.x)<.02&&Math.abs(delta.y)<.02,'icon is centered on both button axes');
 };
 await centered(page.locator('.stellar-new-tab'));
 await hub().waitFor();
 assert.equal(await page.getByRole('tab').first().innerText(),'Temas','the graph opens on the themes hub');
 assert.equal(await page.getByRole('button',{name:'Cerrar grafo 1',exact:true}).count(),0,'the first tab is permanent');

 const verifyContext=async(container,name)=>{
  const canvas=container.locator('[data-testid="stellar-canvas"]');
  const before=await container.locator('.stellar-hit').evaluateAll(nodes=>nodes.map(n=>[n.dataset.node,n.getAttribute('style')]));
  const control=container.getByRole('switch',{name:'Contexto',exact:true});
  assert.equal(await control.getAttribute('aria-checked'),'false');
  await control.click();
  await page.waitForFunction(()=>Number(document.querySelector('.stellar-tab-panel [data-testid="stellar-canvas"]')?.getAttribute('data-context-nodes'))>0);
  const all=await page.evaluate(async()=> (await window.nodus.listIdeasPage({limit:1,offset:0,sort:'label'})).total);
  assert.equal(Number(await canvas.getAttribute('data-context-nodes')),all,'context contains unique corpus ideas');
  assert.ok(Number(await canvas.getAttribute('data-context-edges'))>0);
  assert.deepEqual(await container.locator('.stellar-hit').evaluateAll(nodes=>nodes.map(n=>[n.dataset.node,n.getAttribute('style')])),before,'context preserves foreground and camera');
  const slider=container.getByRole('slider',{name:'Intensidad del contexto'});
  await slider.fill('35');
  assert.deepEqual(await container.locator('.stellar-hit').evaluateAll(nodes=>nodes.map(n=>[n.dataset.node,n.getAttribute('style')])),before,'intensity does not move working nodes');
  await page.screenshot({path:root+'/output/stellar-tabs/context-'+name+'.png'});
  if(name==='exploration')await captureAppearance('contexto');
  await control.click();
  assert.equal(Number(await canvas.getAttribute('data-context-nodes')),0);
  assert.deepEqual(await container.locator('.stellar-hit').evaluateAll(nodes=>nodes.map(n=>[n.dataset.node,n.getAttribute('style')])),before,'turning off restores the unchanged foreground');
 };
 const themeNode='[data-testid="stellar-themes"] .stellar-node-label';
 await page.locator(themeNode).first().waitFor();
 const expectedThemes=await page.evaluate(()=>window.nodus.stellarThemes());
 const uniqueIdeas=await page.evaluate(async()=> (await window.nodus.listIdeasPage({limit:1,offset:0,sort:'label'})).total);
 assert.ok(expectedThemes.reduce((sum,theme)=>sum+theme.ideaCount,0)>uniqueIdeas,'fixture includes ideas that belong to multiple themes');
 // The initial full-size constellation may extend beyond a CI runner's screen.
 // Fit it before inspecting every caption; offscreen captions are intentionally culled.
 await hub().getByRole('button',{name:'Encuadrar',exact:true}).click();
 await page.waitForFunction(n=>document.querySelectorAll('[data-testid="stellar-themes"] .stellar-node-label').length===n,expectedThemes.length);
 const bubbles=await page.locator(themeNode).evaluateAll(list=>list.map(b=>({
  id:b.dataset.node,
  label:b.querySelector('span').textContent,
  ideas:Number(b.querySelector('small').textContent.replace(/\D/g,'')),
  size:Math.round(b.getBoundingClientRect().width)})));
 assert.ok(bubbles.length>1,'the demo corpus has several themes');
 assert.equal(new Set(bubbles.map(b=>b.size)).size,1,'every theme is the same node, whatever it holds');
 assert.ok(bubbles.every(b=>b.ideas>0),'each theme node says how many ideas it holds');
 assert.equal(bubbles.reduce((sum,theme)=>sum+theme.ideas,0),expectedThemes.reduce((sum,theme)=>sum+theme.ideaCount,0),'visible theme captions match the complete membership counts');
 assert.ok((await hub().locator('.stellar-meta').innerText()).includes(`${uniqueIdeas.toLocaleString()} ideas únicas en el corpus`),'hub counts unique ideas instead of summing overlapping theme memberships');
 await captureAppearance('temas');
 await verifyContext(hub(),'hub');
 const dots=await page.locator('[data-testid="stellar-themes"] .stellar-hit').count();
 assert.equal(dots,bubbles.length,'every theme is drawn as a graph node');
 const busiest=bubbles.reduce((best,b)=>b.ideas>best.ideas?b:best,bubbles[0]);
 bubbles[0]=busiest;
 await page.locator(`${themeNode}[data-node="${busiest.id}"]`).click();
 await active().waitFor();
 await page.waitForFunction(()=>Number(document.querySelector('.stellar-tab-panel [data-testid="stellar-workspace"]')?.getAttribute('data-node-count'))>0);
 assert.equal(await page.getByRole('tab').count(),2,'clicking a theme opens a new tab');
 assert.equal(await page.getByRole('tab').first().innerText(),'Temas','the themes hub keeps its name');
 assert.equal(await page.getByRole('tab',{selected:true}).innerText(),bubbles[0].label,'the new tab is active and named after the theme');
 await page.waitForTimeout(700);
 await verifyContext(active(),'theme');
 const walked=await count('node');
 const themePlayer=active().locator('.stellar-player');
 assert.ok(await themePlayer.evaluate(el=>el.getBoundingClientRect().height)<=56,'theme controls fit in one compact row');
 assert.equal(await themePlayer.locator('.stellar-play,.stellar-player-selection').count(),0,'themes have no playback or empty selection footer');
 assert.equal(await active().getByRole('spinbutton',{name:'Límite de relaciones'}).count(),0,'themes show only their visible connection budget');
 assert.equal(await active().getByRole('combobox',{name:'Velocidad'}).count(),0,'playback speed is exclusive to exploration tabs');
 const scopeSelect=active().getByRole('combobox',{name:'Mostrar ideas',exact:true});
 const connectionsSelect=active().getByRole('combobox',{name:'Conexiones por idea',exact:true});
 assert.equal(await scopeSelect.inputValue(),'0','themes open with every idea');
 assert.equal(await connectionsSelect.inputValue(),'6','themes start with up to six connections per idea');
 assert.equal(walked,bubbles[0].ideas,'the complete theme is visible by default');
 assert.equal(await themePlayer.getByRole('button').count(),0,'theme controls no longer have an infinity button');
 const captureControls=async name=>{
  const original=await page.evaluate(()=>document.documentElement.classList.contains('light')?'light':'dark');
  for(const mode of ['light','dark']){
   await page.evaluate(mode=>{document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(mode);},mode);
   await page.mouse.move(10,10);await page.waitForTimeout(180);
   await page.screenshot({path:root+'/output/stellar-tabs/'+name+'-'+mode+'.png'});
   await themePlayer.screenshot({path:root+'/output/stellar-tabs/'+name+'-controls-'+mode+'.png'});
  }
  await page.evaluate(mode=>{document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(mode);},original);
 };
 await captureControls('theme-default');
 const walkedEdges=await count('edge');
 await connectionsSelect.selectOption('custom');
 await active().getByRole('spinbutton',{name:'Máximo de conexiones por idea'}).fill('1');
 await page.waitForTimeout(400);
 assert.ok(await count('edge')<=walkedEdges,'the connection limit only removes lines');
 assert.equal(await count('node'),walked,'limiting connections preserves all ideas');
 await scopeSelect.selectOption('1');
 await page.waitForTimeout(400);
 const nearbyIds=await active().locator('.stellar-hit').evaluateAll(nodes=>nodes.map(n=>n.dataset.node).sort());
 await connectionsSelect.selectOption('0');
 await page.waitForTimeout(400);
 assert.deepEqual(await active().locator('.stellar-hit').evaluateAll(nodes=>nodes.map(n=>n.dataset.node).sort()),nearbyIds,'neighbourhood membership is independent of the line budget');
 assert.ok(await active().locator('.stellar-theme-focus').innerText(),'limited scope names its focal idea');
 await connectionsSelect.selectOption('6');
 await captureControls('theme-neighbourhood');
 await scopeSelect.selectOption('0');
 await page.waitForFunction(n=>Number(document.querySelector('.stellar-tab-panel [data-testid="stellar-workspace"]')?.getAttribute('data-node-count'))===n,bubbles[0].ideas);
 assert.equal(await active().locator('.stellar-theme-focus').count(),0,'whole-theme mode has no focal hint');
 await scopeSelect.selectOption('2');
 await page.waitForTimeout(400);
 assert.ok(await count('node')<=bubbles[0].ideas,'narrowing the scope limits ideas');
 await page.screenshot({path:root+'/output/stellar-tabs/theme.png'});
 await captureAppearance('tema-abierto');
 const preservedThemeNodes=await count('node');
 await page.getByRole('button',{name:'Volver a los temas'}).click();
 await hub().waitFor();
 assert.equal(await page.getByRole('tab').count(),2,'going back leaves the theme tab open');
 assert.equal(await page.getByRole('tab',{selected:true}).innerText(),'Temas','going back selects the hub');
 const secondTheme=bubbles.find(theme=>theme.id!==busiest.id);
 await page.locator(`${themeNode}[data-node="${secondTheme.id}"]`).click();
 await active().waitFor();
 assert.equal(await page.getByRole('tab').count(),3,'another theme opens its own tab');
 assert.equal(await page.getByRole('tab',{selected:true}).innerText(),secondTheme.label);
 await page.getByRole('tab').nth(1).click();
 assert.equal(await count('node'),preservedThemeNodes,'switching themes preserves the first graph');
 await page.locator('.stellar-tab').nth(2).locator('.stellar-tab-close').click();
 await page.locator('.stellar-tab').nth(1).locator('.stellar-tab-close').click();
 await hub().waitFor();
 await page.locator(themeNode).first().waitFor();
 await page.screenshot({path:root+'/output/stellar-tabs/themes.png'});
 const hubSearch=hub().getByRole('combobox',{name:'Buscar una idea'});
 await hubSearch.fill(''); await hubSearch.focus();
 await hub().locator('.stellar-search-toggle').first().waitFor();
 const pinnedLabel=await hub().locator('.stellar-search-choice strong').first().innerText();
 const initialHubNodes=await hub().locator('.stellar-hit').count();
 await hub().locator('.stellar-search-toggle').first().click();
 assert.equal(await hub().locator('.stellar-search-toggle').first().getAttribute('title'),'Quitar idea del lienzo','adding to the hub updates the toggle immediately');
 await page.waitForFunction(n=>document.querySelectorAll('.stellar-tab-panel .stellar-hit').length===n,initialHubNodes+1);
 assert.equal(await page.getByRole('tab').count(),1,'quick addition stays in the main tab');
 await hub().locator('.stellar-search-toggle').nth(1).click();
 await page.waitForFunction(n=>document.querySelectorAll('.stellar-tab-panel .stellar-hit').length===n,initialHubNodes+2);
 await page.keyboard.press('Escape');
 await page.locator(`${themeNode}[data-node="${busiest.id}"]`).click();
 await active().waitFor();
 await page.getByRole('button',{name:'Volver a los temas'}).click();
 assert.equal(await hub().locator('.stellar-hit').count(),initialHubNodes+2,'hub additions survive entering and leaving a theme');
 await page.locator('.stellar-tab').nth(1).locator('.stellar-tab-close').click();
 await hubSearch.focus();
 await hub().locator('.stellar-search-toggle').nth(1).click();
 await page.waitForFunction(n=>document.querySelectorAll('.stellar-tab-panel .stellar-hit').length===n,initialHubNodes+1);
 await page.keyboard.press('Escape');
 await page.screenshot({path:root+'/output/stellar-tabs/hub-ideas.png'});
 await page.getByRole('button',{name:'Nuevo grafo',exact:true}).click();
 assert.equal(await page.getByRole('tab').count(),2);
 assert.equal(await active().getAttribute('data-node-count'),'0','a new tab is a blank canvas');
 await captureAppearance('pestana-vacia');
 await verifyContext(active(),'blank');
 await active().getByRole('switch',{name:'Contexto',exact:true}).click();
 const backgroundIdea=active().locator('.stellar-context-label').first();
 await backgroundIdea.waitFor();
 const backgroundId=await backgroundIdea.getAttribute('data-context-node');
 await backgroundIdea.click();
 await page.waitForFunction(id=>!!document.querySelector('.stellar-tab-panel .stellar-hit[data-node="'+id+'"]'),backgroundId);
 assert.ok(await count('node')>0,'clicking a context label promotes that idea into the working exploration');
 await active().getByRole('button',{name:'Limpiar',exact:true}).click();
 await active().getByRole('switch',{name:'Contexto',exact:true}).click();
 assert.equal(await count('node'),0,'clearing an exploration leaves its context separate');
 const candidates=await page.evaluate(()=>window.nodus.discoverArgumentRoutes());
 const seed=candidates.find(n=>n.degree>=3);assert.ok(seed);
 const search=async label=>{await page.locator('.stellar-tab-panel .stellar-search input').fill(label);await page.locator('.stellar-tab-panel .stellar-search-choice').first().waitFor();};
 await active().getByRole('spinbutton',{name:'Límite de relaciones'}).fill('2');
 await search(seed.label);await centered(page.locator('.stellar-tab-panel .stellar-search-toggle').first());
 await page.locator('.stellar-tab-panel .stellar-search-choice').first().click();await waitEdges(2);
 assert.ok(await count('node')>=2,'choosing a seed loads its links without Play');
 await page.waitForTimeout(750);
 await captureAppearance('exploracion');
 await verifyContext(active(),'exploration');
 const firstCount=await count('node');
 await search(seed.label);
 const minus=page.locator('.stellar-tab-panel .stellar-search-toggle').first();
 await centered(minus);
 assert.equal(await minus.getAttribute('title'),'Quitar idea del lienzo','included seed shows a removal affordance');
 await minus.click();await waitEdges(0);
 assert.equal(await count('node'),firstCount-1,'removing the seed keeps the other visible ideas');
 assert.equal(await page.locator('.stellar-tab-panel .stellar-search-toggle').first().getAttribute('title'),'Añadir idea al lienzo');
 await page.locator('.stellar-tab-panel .stellar-search-toggle').first().click();await waitEdges(2);
 await page.keyboard.press('Escape');
 const other=candidates.find(n=>n.ideaId!==seed.ideaId && n.degree>=2);assert.ok(other);
 await search(other.label);await page.locator('.stellar-tab-panel .stellar-search-toggle').first().click();
 await page.waitForTimeout(450);await page.keyboard.press('Escape');
 assert.ok(await count('edge')>=2);
 const preserved=await count('node');
 const playerHeight=await active().locator('.stellar-player').evaluate(el=>el.getBoundingClientRect().height);
 assert.ok(playerHeight<=108,'exploration transport stays compact even before selecting an idea');
 await page.locator('.stellar-tab-panel .stellar-node-label').first().press('Enter');
 await page.locator('.stellar-tab-panel .graph-detail-panel h3').waitFor();
 assert.equal(await active().locator('.stellar-player').evaluate(el=>el.getBoundingClientRect().height),playerHeight,'selecting an idea keeps transport height stable');
 const detail=await page.locator('.stellar-tab-panel .graph-detail-panel h3').innerText();
 await active().getByRole('button',{name:'Mostrar fuentes',exact:true}).click();
 await active().getByTitle('Alejar',{exact:true}).click();await page.waitForTimeout(500);
 const positions=await page.locator('.stellar-tab-panel .stellar-hit').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.dataset.node,node.getAttribute('style')])));
 await page.getByRole('button',{name:'Nuevo grafo',exact:true}).click();
 assert.equal(await page.getByRole('tab').count(),3);
 assert.equal(await count('node'),0,'new tab starts empty');
 await active().getByRole('spinbutton',{name:'Límite de relaciones'}).fill('1');
 await search(other.label);await page.locator('.stellar-tab-panel .stellar-search-choice').first().click();await waitEdges(1);
 await page.getByRole('tab').nth(1).click();assert.equal(await count('node'),preserved,'each canvas keeps its topology');
 await page.waitForTimeout(250);
 assert.equal(await page.locator('.stellar-tab-panel .graph-detail-panel h3').innerText(),detail,'the chosen detail belongs to its tab');
 assert.equal(await active().getByRole('button',{name:'Ocultar fuentes',exact:true}).getAttribute('aria-pressed'),'true');
 assert.deepEqual(await page.locator('.stellar-tab-panel .stellar-hit').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.dataset.node,node.getAttribute('style')]))),positions,'camera and positions are restored when switching tabs');
 assert.equal(await active().getByRole('spinbutton',{name:'Límite de relaciones'}).inputValue(),'2','relationship limits belong to their tabs');
 await active().getByRole('button',{name:'Limpiar',exact:true}).click();
 assert.equal(await count('node'),0);assert.equal(await count('edge'),0);
 await page.waitForTimeout(500);assert.equal(await count('node'),0,'late layout messages cannot repopulate cleared topology');
 await page.getByRole('tab').nth(2).click();assert.equal(await count('edge'),1,'clear leaves other tabs alone');
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>{document.documentElement.classList.remove('dark','light');document.documentElement.classList.add(theme);},theme);
  const tab=page.locator('.stellar-tab.active');
  for(const target of [tab.getByRole('tab'),tab.locator('.stellar-tab-close')]){
   await target.hover();
   const colors=await tab.evaluate(el=>Array.from(el.querySelectorAll('button')).map(b=>({color:getComputedStyle(b).color,background:getComputedStyle(b).backgroundColor})));
   assert.equal(colors[0].color,colors[1].color,'tab and close share the accent on hover');
   assert.equal(colors[0].background,colors[1].background,'hover does not split the tab surface');
  }
  await page.getByRole('button',{name:'Pantalla completa',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement);
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(()=>document.fullscreenElement?.classList.contains('stellar-tabs-workspace')),true);
  const label=active().locator('.stellar-node-label').first();
  await label.waitFor();
  const contained=await label.evaluate(el=>{
   const span=el.querySelector('span'),original=span.textContent;
   span.textContent='Nombre extremadamente largo de una idea que debe seguir dentro de su tarjeta incluso con palabras '.repeat(15)+'x'.repeat(150);
   const box=el.getBoundingClientRect(),text=span.getBoundingClientRect();
   const result=text.bottom<=box.bottom+.5&&text.right<=box.right+.5&&text.height<=parseFloat(getComputedStyle(span).lineHeight)*3+.5;
   span.textContent=original;return result;
  });
  assert.ok(contained,'long node names remain inside their label in both themes');
  await page.screenshot({path:root+'/output/stellar-tabs/fullscreen-'+theme+'.png'});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.fullscreenElement);await page.waitForTimeout(1200);
 }
 await page.locator('.stellar-tab').nth(1).locator('.stellar-tab-close').click();assert.equal(await page.getByRole('tab').count(),2);assert.equal(await count('edge'),1);
 const unselectedHeight=await active().locator('.stellar-player').evaluate(el=>el.getBoundingClientRect().height);
 await active().getByRole('button',{name:'Siguiente',exact:false}).click();
 await active().locator('.stellar-step').waitFor();
 await page.waitForTimeout(650);
 assert.equal(await active().locator('.stellar-player').evaluate(el=>el.getBoundingClientRect().height),unselectedHeight,'an inferred or explicit relation keeps transport height stable');
 await captureAppearance('conexion-seleccionada');
 if(captureThemes){
  const {build}=await import('esbuild');
  const compiled=await build({entryPoints:[root+'/shared/vaultColors.ts'],bundle:true,platform:'node',format:'esm',write:false});
  const {VAULT_TYPE_COLORS}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const original=await page.locator('[data-testid="app-shell"]').evaluate(el=>el.style.getPropertyValue('--vault-accent'));
  for(const [vault,color] of Object.entries(VAULT_TYPE_COLORS)){
   await page.locator('[data-testid="app-shell"]').evaluate((el,color)=>el.style.setProperty('--vault-accent',color),color);
   await captureAppearance('acento-'+vault);
  }
  await page.locator('[data-testid="app-shell"]').evaluate((el,color)=>el.style.setProperty('--vault-accent',color),original);
 }
 const clearOfControls=await active().evaluate(el=>{
  const player=el.querySelector('.stellar-player'),top=player.getBoundingClientRect().top;
  return [...el.querySelectorAll('.stellar-node-label')].every(label=>label.getBoundingClientRect().bottom<=top);
 });
 assert.ok(clearOfControls,'endpoint cards fit above the compact controls');
 const layered=await active().evaluate(el=>{
  const label=el.querySelector('.stellar-node-label.featured');
  if(!label)return false;
  const original=label.getAttribute('style');
  const player=el.querySelector('.stellar-player').getBoundingClientRect(),canvas=el.querySelector('.stellar-canvas').getBoundingClientRect();
  const x=player.x+player.width/2,y=player.y+10;
  label.style.left=`${x-canvas.x}px`;label.style.top=`${y-canvas.y-5}px`;
  const result=!!document.elementFromPoint(x,y)?.closest('.stellar-player');
  label.setAttribute('style',original);return result;
 });
 assert.ok(layered,'a card dragged underneath the transport cannot paint over or intercept it');
 const balanced=await active().locator('.stellar-step-relation').evaluate(button=>{
  const label=button.querySelector('span'),original=label.textContent;
  const row=button.closest('.stellar-step-ideas').getBoundingClientRect(),center=row.x+row.width/2;
  const results=['Apoya','Refuta','Aplica','Comparte método','Es condición de','Mide lo mismo','Es variante de','Contiene','Causa','Depende de','Forma parte de','Contrasta','Se relaciona'].map(text=>{
   label.textContent=text;
   const box=button.getBoundingClientRect(),word=label.getBoundingClientRect(),arrow=button.querySelector('svg').getBoundingClientRect();
   return Math.abs(box.x+box.width/2-center)<.1&&Math.abs(word.x+word.width/2-center)<.1&&Math.abs(arrow.x+arrow.width/2-center)<.1&&arrow.top>=word.bottom;
  });
  label.textContent=original;return results.every(Boolean);
 });
 assert.ok(balanced,'every relation and its arrow share the exact horizontal centre of the strip');
 await page.screenshot({path:root+'/output/stellar-tabs/compact-connection.png'});
 const stage=active().locator('.stellar-canvas');
 await stage.dblclick({position:{x:20,y:90}});
 assert.equal(await active().locator('.stellar-step,.stellar-node-actions,.stellar-hit.selected,.stellar-node-label.featured').count(),0,'double-clicking the background clears node and edge selection');
 assert.equal(await active().locator('.graph-detail-panel').count(),0);
 await page.locator('.stellar-tab').nth(1).locator('.stellar-tab-close').click();assert.equal(await page.getByRole('tab').count(),1);await hub().waitFor();
 assert.equal(await hub().locator('.stellar-hit').count(),initialHubNodes+1,'closing secondary tabs preserves the hub and pinned ideas');
 await hub().locator('.stellar-node-label').filter({hasText:pinnedLabel}).first().press('Enter');
 await active().waitFor();
 assert.equal(await page.getByRole('tab').count(),2,'a pinned idea opens its own exploration');
 await search(seed.label);await page.locator('.stellar-tab-panel .stellar-search-choice').first().click();await page.waitForTimeout(600);
 const beforeNavigation=await count('node');assert.ok(beforeNavigation>0);
 await page.locator('[data-tour="nav-ideas"]').click();await page.getByTestId('ideas-tabs').waitFor();
 await page.locator('[data-tour="nav-graph"]').click();await active().waitFor();
 await page.waitForFunction(n=>Number(document.querySelector('.stellar-tab-panel .stellar-workspace')?.getAttribute('data-node-count'))===n,beforeNavigation);
 await page.getByRole('tab').first().click();await hub().waitFor();
 // Section navigation remounts the hub at its initial zoom; restore a full view
 // before comparing its visible targets with the pre-navigation fitted canvas.
 await hub().getByRole('button',{name:'Encuadrar',exact:true}).click();
 await page.waitForFunction(n=>document.querySelectorAll('.stellar-tab-panel .stellar-hit').length===n,initialHubNodes+1);
 assert.equal(await hub().locator('.stellar-node-label').filter({hasText:pinnedLabel}).count(),1,'pinned ideas restore after section navigation');
 await page.getByRole('tab').nth(1).click();await active().waitFor();
 const beforeTarget=await count('node');
 await app.evaluate(({BrowserWindow},ideaId)=>BrowserWindow.getAllWindows()[0].webContents.send('copilot:openIdea',{ideaId,destination:'graph'}),other.ideaId);
 await page.waitForFunction(()=>document.querySelectorAll('.stellar-tabs [role="tab"]').length===3);
 await page.waitForFunction(()=>Number(document.querySelector('.stellar-tab-panel .stellar-workspace')?.getAttribute('data-edge-count'))>0);
 assert.ok((await page.getByRole('tab').last().innerText()).includes(other.label.slice(0,20)),'an external idea opens its own graph');
 await page.getByRole('tab').nth(1).click();assert.equal(await count('node'),beforeTarget,'external navigation preserves previous graphs');
 await page.reload();await page.locator('[data-tour="nav-graph"]').click();await hub().waitFor();
 await hub().getByRole('button',{name:'Encuadrar',exact:true}).click();
 assert.equal(await page.getByRole('tab').count(),1,'a fresh app session starts on the themes hub alone');
 await page.locator('[data-testid="stellar-themes"] .stellar-node-label').first().click();await active().waitFor();
 await page.getByRole('button',{name:'Volver a los temas'}).click();await hub().waitFor();
 await page.screenshot({path:root+'/output/stellar-tabs/empty.png'});
 assert.deepEqual(errors,[]);
 console.log('Stellar tabs E2E passed: corpus context in hub/theme/blank/exploration, intensity and toggle preserve foreground, context idea promotion, permanent themes hub, instant additive hub search, pinned-idea exploration, theme walk + child limit + depth + back, isolated tabs, stable transport height, unified accent hover, background deselection, light/dark full screen, section navigation, hub on reload.');
} finally {await app.close();fs.rmSync(profile,{recursive:true,force:true});}
