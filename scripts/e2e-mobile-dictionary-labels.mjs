// Isolated actual React components + current compiled CSS. This is Chromium
// geometry/interaction coverage, not a native WebKit or real-vault acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright-core';
const root=process.cwd(),require=createRequire(import.meta.url),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-dictionary-labels-'));
const output=path.join(root,'artifacts/interface-2026-10-15/dictionary-labels');fs.mkdirSync(output,{recursive:true});
const assets=path.join(root,'dist/assets'),css=fs.readdirSync(assets).filter(file=>/^index-.*\.css$/.test(file));assert.equal(css.length,1,'Existing actual Desktop CSS is required.');
const styles=[path.join(assets,css[0]),...['mobile.css','phone.css'].map(file=>path.join(root,'src/mobileWeb',file))];
fs.writeFileSync(path.join(fixture,'fixture.css'),styles.map(file=>fs.readFileSync(file,'utf8')).join('\n'));
await build({stdin:{contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {DictionaryRows} from './src/views/DictionaryView';import {setActiveLang} from './src/i18n';setActiveLang('es');
 const entries=['draft','active','archived','in-progress'].map((state,index)=>({id:'canonical-row-'+state,name:'Concepto de historia intelectual y transmisión de evidencias documentales '+('Interdisciplinariedad'.repeat(3)),aliases:['Una denominación alternativa extensa que se conserva en el registro'],shortDescription:'Descripción legible del concepto, sus límites y las fuentes que lo documentan.',tags:['Historia de las ideas y prácticas de documentación con una etiqueta extensa','EtiquetaSinSeparadores'.repeat(6)],authorCount:14+index,workCount:42+index,evidenceCount:123+index,status:state==='in-progress'?'draft':state,insufficientEvidence:false,newEvidenceCount:index===0?3:0,createdAt:'2026-10-15T10:00:00Z',updatedAt:'2026-10-15T10:00:00Z'}));
 window.dictionaryFixture={events:[],entries};
 const jobs=new Map([['canonical-row-in-progress',{entryId:'canonical-row-in-progress',phase:'generating',message:'Relacionando los testimonios documentales y comprobando las referencias de esta entrada en sus fuentes originales'}]]);
 function Fixture(){const [compact,setCompact]=useState(false),[desktop,setDesktop]=useState(false),[selected,setSelected]=useState(new Set()),[opened,setOpened]=useState(null);window.dictionaryFixture.setCompact=setCompact;window.dictionaryFixture.setDesktop=setDesktop;
 const open=entry=>{window.dictionaryFixture.events.push({id:entry.id,name:entry.name,authorCount:entry.authorCount});setOpened(entry.id);};
 return <div className={desktop?"h-full":"mobile-surface"} data-surface="dictionary"><div className={desktop?"h-full":"mobile-surface-content"}><div className={"dictionary-workspace theme-workspace-surface flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"+(desktop?"":" dictionary-mobile")}><main className="min-h-0 flex-1 overflow-auto p-5"><DictionaryRows entries={entries} generationJobs={jobs} compact={compact} selected={selected} onOpen={open} onToggle={id=>setSelected(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next;})} onSelectAll={()=>setSelected(new Set(entries.map(entry=>entry.id)))}/><output data-testid="opened-entry">{opened}</output></main></div></div></div>;}
 createRoot(document.getElementById('root')).render(<Fixture/>);
 `,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(fixture,'fixture.js'),format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'empty'},plugins:[{name:'expose-only-real-dictionary-components-in-fixture',setup(builder){builder.onLoad({filter:/src\/views\/DictionaryView\.tsx$/},async({path:filename})=>({contents:fs.readFileSync(filename,'utf8')+'\nexport {DictionaryRows,DictionaryGenerationState,StatusPill};',loader:'tsx'}));}}]});
fs.writeFileSync(path.join(fixture,'index.html'),'<!doctype html><html class="light nodus-phone"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
fs.writeFileSync(path.join(fixture,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(fixture,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:390,height:760,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});w.loadFile(${JSON.stringify(path.join(fixture,'index.html'))});});`);
const sourceFiles=[...styles,path.join(root,'src/views/DictionaryView.tsx'),path.join(root,'src/mobileWeb/main.tsx'),new URL(import.meta.url)];
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[String(file),createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const startedAt=new Date().toISOString(),results=[],screenshots=[],env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let app,currentScenario;
try{
 app=await electron.launch({executablePath:require('electron'),args:[path.join(fixture,'main.cjs')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.locator('.dictionary-entry-row').first().waitFor();
 for(const compact of [false,true])for(const [device,width,height] of [['phone',320,760],['phone',390,844],['phone',844,390],['tablet',600,900],['tablet',1024,900],['desktop',1600,900]])for(const scale of [1,1.75])for(const theme of ['light','dark']){
  await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});
  await page.evaluate(({device,scale,theme,compact})=>{window.dictionaryFixture.setCompact(compact);window.dictionaryFixture.setDesktop(device==='desktop');document.documentElement.className=theme+(device==='phone'?' nodus-phone':'');document.documentElement.style.fontSize=16*scale+'px';document.documentElement.style.setProperty('--nodus-mobile-text-scale',String(scale));document.documentElement.style.setProperty('--mobile-accent','#6366f1');document.querySelector('main').scrollTop=0;},{device,scale,theme,compact});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const measured=await page.evaluate(()=>{
   const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
   const main=document.querySelector('main'),catalogue=document.querySelector('.dictionary-rows');
   return {viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,mainWidth:main.clientWidth,mainScrollWidth:main.scrollWidth,catalogue:rect(catalogue),rows:[...document.querySelectorAll('.dictionary-entry-row')].map((row,index)=>{
    const title=row.querySelector('.dictionary-entry-title'),state=row.querySelector('.dictionary-entry-state'),tags=row.querySelector('.dictionary-entry-tags'),counts=row.querySelector('.dictionary-entry-counts'),pill=row.querySelector('.dictionary-status-pill');
    let naturalPillWidth=null;
    if(pill){const range=document.createRange();range.selectNodeContents(pill);const style=getComputedStyle(pill);naturalPillWidth=range.getBoundingClientRect().width+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth);}
    return {id:window.dictionaryFixture.entries[index].id,row:rect(row),title:rect(title),headingText:rect(title.querySelector('strong')),titleFont:parseFloat(getComputedStyle(title.querySelector('strong')).fontSize),state:rect(state),stateText:state.textContent,pill:pill?rect(pill):null,naturalPillWidth,
     gridColumns:getComputedStyle(row).gridTemplateColumns,countsDisplay:getComputedStyle(counts).display,
     tagsArea:rect(tags),tags:[...tags.children].map(tag=>({text:tag.textContent,rect:rect(tag),scrollWidth:tag.scrollWidth,clientWidth:tag.clientWidth})),
     counts:[...counts.querySelectorAll('.dictionary-entry-count')].map(cell=>{const range=document.createRange();range.selectNodeContents(cell);return {text:cell.textContent,rect:rect(cell),textRect:rect(range),font:parseFloat(getComputedStyle(cell).fontSize),lineHeight:parseFloat(getComputedStyle(cell).lineHeight),whiteSpace:getComputedStyle(cell).whiteSpace,labelDisplay:getComputedStyle(cell.firstElementChild).display};}),
     updated:rect(row.querySelector('.dictionary-entry-updated')),open:rect(row.querySelector('.dictionary-entry-open'))};
   })};
  });
  const context=`${device}/${width}/${scale}/${theme}/${compact?'table':'list'}`;currentScenario={device,width,height,scale,theme,compact,measured};
  assert(measured.pageWidth<=width,`${context}: no page overflow`);
  if(device==='phone'||width<=600)assert(measured.mainScrollWidth<=measured.mainWidth+1,`${context}: phone/card catalogue must not scroll horizontally`);
  for(const row of measured.rows){
   assert(row.titleFont>=14*scale-.1,`${context}/${row.id}: text must not be shrunk to conceal overflow`);
   assert(row.title.width>0&&row.title.height>=(device==='desktop'?1:44),`${context}/${row.id}: real opening button remains touch-sized`);
   if(device==='phone'||width<=600)assert(row.headingText.width>=row.title.width-1,`${context}/${row.id}: evidence badge must not squeeze a long title into a narrow column`);
   if(row.pill)assert(row.pill.width<=row.naturalPillWidth+2,`${context}/${row.id}: lifecycle pill must remain intrinsic rather than fill its grid area`);
   assert(row.state.width>0&&row.state.height>0&&row.stateText.trim(),`${context}/${row.id}: lifecycle/progress text remains visible`);
   for(const tag of row.tags){assert(tag.rect.right<=row.tagsArea.right+1&&tag.rect.x>=row.tagsArea.x-1,`${context}/${row.id}: long tag remains inside its own grid area`);assert(tag.scrollWidth<=tag.clientWidth+1,`${context}/${row.id}: full long tag wraps without clipped or overflowing text`);}
   assert.equal(row.counts.length,3,`${context}/${row.id}: all three semantic counters remain present`);
   for(const [index,count] of row.counts.entries()){
    assert(count.font>=12*scale-.1&&count.rect.width>0&&count.rect.height>0,`${context}/${row.id}: readable count cell without shrinking`);
    assert(count.text.endsWith(String([14,42,123][index]+measured.rows.indexOf(row))),`${context}/${row.id}: exact count preserved`);
    assert.equal(count.whiteSpace,'nowrap',`${context}/${row.id}: a counter keeps its vocabulary and value together`);
    assert(count.textRect.height<=count.lineHeight+1,`${context}/${row.id}: labels and values stay on one unbroken line`);
    assert(count.textRect.right<=count.rect.right+1,`${context}/${row.id}: a count stays inside its own cell`);
    if(device==='phone'||width<=600)assert.notEqual(count.labelDisplay,'none',`${context}/${row.id}: card counts keep their labels`);
   }
   if(device==='desktop'){
    assert.equal(row.countsDisplay,'contents',`${context}/${row.id}: Desktop keeps independent grid counter cells`);
    assert.equal(row.gridColumns.trim().split(/\s+/).length,9,`${context}/${row.id}: Desktop retains nine columns`);
    assert(row.counts[0].rect.x>=row.state.right-1&&row.tagsArea.x>=row.counts[2].rect.right-1,`${context}/${row.id}: counters remain between state and tags`);
    for(let index=1;index<3;index++)assert(row.counts[index].rect.x>=row.counts[index-1].rect.right-1,`${context}/${row.id}: Desktop counters retain separate columns`);
   }
  }
  for(const index of [0,1,2,3]){const row=page.locator('.dictionary-entry-row').nth(index);await row.locator('.dictionary-entry-title').click();assert.equal(await page.getByTestId('opened-entry').textContent(),measured.rows[index].id);await row.locator('.dictionary-entry-open').click();assert.equal(await page.getByTestId('opened-entry').textContent(),measured.rows[index].id);}
  await page.evaluate(()=>{document.querySelector('main').scrollTop=0;});
  results.push(currentScenario);
  if(!compact&&((device==='phone'&&width===390)||(scale===1.75&&theme==='dark'))){const filename=`${device}-${width}-${scale}-${theme}.png`;await page.screenshot({path:path.join(output,filename),fullPage:true});screenshots.push({file:filename,sha256:createHash('sha256').update(fs.readFileSync(path.join(output,filename))).digest('hex')});await page.locator('.dictionary-entry-row').first().locator('.dictionary-entry-tags').scrollIntoViewIfNeeded();const metadata='metadata-'+filename;await page.screenshot({path:path.join(output,metadata),fullPage:true});screenshots.push({file:metadata,sha256:createHash('sha256').update(fs.readFileSync(path.join(output,metadata))).digest('hex')});}
 }
 assert.deepEqual(errors,[]);const events=await page.evaluate(()=>window.dictionaryFixture.events);assert.equal(events.length,results.length*8);
 for(const file of sourceFiles)assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),sourceHashes[String(file)],'Source changed during fixture');
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({scope:'actual DictionaryRows/DictionaryGenerationState/StatusPill in isolated Electron; no native WebKit, vault or provider claim',startedAt,completedAt:new Date().toISOString(),sourceHashes,styles,scenarios:results,screenshots,openingCallbacks:events,passed:true},null,2)+'\n');console.log(`PASS dictionary labels: ${results.length} scenarios, ${events.length} actual row opening callbacks.`);
}catch(error){const name=startedAt.replaceAll(':','-');fs.writeFileSync(path.join(output,`failure-${name}.json`),JSON.stringify({startedAt,sourceHashes,currentScenario,error:String(error),passed:false},null,2)+'\n');if(app)await(await app.firstWindow()).screenshot({path:path.join(output,`failure-${name}.png`)});throw error;}finally{if(app)await app.close();fs.rmSync(fixture,{recursive:true,force:true});}
