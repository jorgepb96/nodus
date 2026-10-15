// Actual graph tab header in isolated Electron. Canvas state and native WebKit
// are checked separately; these assertions cover navigation and touch geometry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright-core';
const root=process.cwd(),require=createRequire(import.meta.url),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-stellar-phone-tabs-'));
const output=path.join(root,'artifacts/interface-2026-10-15/stellar-tabs');fs.mkdirSync(output,{recursive:true});
const css=fs.readdirSync(path.join(root,'dist/assets')).filter(file=>/^index-.*\.css$/.test(file));assert.equal(css.length,1);
const files=[`dist/assets/${css[0]}`,'src/stellarGraph/stellar.css',...['mobile.css','phone.css','workspaceTabs.css'].map(file=>'src/mobileWeb/'+file)];
const inputs=[...files,'src/stellarGraph/StellarTabsHeader.tsx','src/stellarGraph/StellarWorkspace.tsx','scripts/e2e-mobile-stellar-tabs.mjs'];
const sourceHashes=Object.fromEntries(inputs.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
fs.writeFileSync(path.join(fixture,'fixture.css'),files.map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n'));
await build({stdin:{contents:`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import{StellarTabsHeader}from'./src/stellarGraph/StellarTabsHeader';import{setActiveLang}from'./src/i18n';setActiveLang('es');
 function Fixture(){const[tabs,setTabs]=useState(Array.from({length:6},(_,index)=>({id:index+1,label:'Grafo '+(index+1)+' · Un título largo de investigación con evidencias documentadas'}))),[active,setActive]=useState(6),[fullscreen,setFullscreen]=useState(false);
 const close=id=>{if(id===tabs[0].id)return;const index=tabs.findIndex(tab=>tab.id===id),next=tabs.filter(tab=>tab.id!==id);setTabs(next);if(active===id)setActive(next[Math.min(index,next.length-1)].id);};
 return<main className="mobile-surface" data-surface="graph"><div className="mobile-surface-content"><div className="stellar-tabs-workspace"><StellarTabsHeader tabs={tabs} active={active} tabsId="fixture" tabName={tab=>tab.label} onActivate={setActive} onClose={close} onAdd={()=>{const id=Math.max(...tabs.map(tab=>tab.id))+1;setTabs([...tabs,{id,label:'Nuevo grafo '+id}]);setActive(id);}} fullscreen={fullscreen} onFullscreen={()=>setFullscreen(value=>!value)}/><section data-testid="document" style={{flex:1,minHeight:0}}>Lienzo independiente</section></div></div></main>}
 createRoot(document.getElementById('root')).render(<Fixture/>);
`,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(fixture,'fixture.js'),format:'iife',platform:'browser',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'}});
fs.writeFileSync(path.join(fixture,'index.html'),'<!doctype html><html class="light nodus-phone"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
fs.writeFileSync(path.join(fixture,'main.cjs'),`const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(fixture,'profile'))});app.whenReady().then(()=>new BrowserWindow({width:390,height:760,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}}).loadFile(${JSON.stringify(path.join(fixture,'index.html'))}));`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let app,current;const results=[],startedAt=new Date().toISOString();
try{
 app=await electron.launch({executablePath:require('electron'),args:[path.join(fixture,'main.cjs')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.getByTestId('stellar-open-tabs').waitFor({state:'visible'});
 for(const surface of ['graph','studyIdeas'])for(const device of ['phone','tablet'])for(const theme of ['light','dark'])for(const[width,height,scale]of[[320,700,1],[390,760,1],[844,320,1],[600,780,1.75],[1024,760,1.75]]){
  await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});
  await page.evaluate(({surface,device,theme,scale})=>{document.querySelector('.mobile-surface').dataset.surface=surface;document.documentElement.className=theme+(device==='phone'?' nodus-phone':'');document.documentElement.style.fontSize=16*scale+'px';document.documentElement.style.setProperty('--mobile-accent','#6366f1');},{surface,device,theme,scale});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  current=await page.evaluate(()=>{const rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};return{viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,strip:rect(document.querySelector('.stellar-tabs-header')),scroller:rect(document.querySelector('.stellar-tabs')),active:rect(document.querySelector('[aria-selected="true"]')),close:rect(document.querySelector('[aria-selected="true"]').nextElementSibling),picker:rect(document.querySelector('.stellar-tab-picker')),add:rect(document.querySelector('.stellar-new-tab')),fullscreen:rect(document.querySelector('.stellar-fullscreen')),content:rect(document.querySelector('[data-testid="document"]'))};});
  const context=`${surface}/${device}/${theme}/${width}/${scale}`;
  assert(current.pageWidth<=current.viewport,context+': the document never scrolls horizontally');
  for(const target of[current.active,current.close,current.add,current.fullscreen]){assert(target.width>=44&&target.height>=44,context+': touch target');assert(target.y>=current.strip.y-.5&&target.bottom<=current.strip.bottom+.5,context+': control inside tab row');assert(target.x>=-.5&&target.right<=current.viewport+.5,context+': selected controls inside viewport');}
  assert(current.active.x>=current.scroller.x-.5&&current.close.right<=current.scroller.right+.5,context+': selected tab including Close automatically revealed after resize');
  assert(current.close.x>=current.active.right-.5,context+': title never covers Close');
  assert(current.content.y>=current.strip.bottom-.5,context+': header does not cover canvas');
  if(device==='phone'){assert(current.picker.width===44&&current.picker.height>=44);assert(current.picker.x>=current.close.right-.5&&current.picker.right<=current.add.x+.5,context+': chooser has own space');}else assert.equal(current.picker.width,0,'Desktop/tablet picker stays hidden');
  results.push({surface,device,theme,width,height,scale,measured:current});if(width===390||width===844)await page.screenshot({path:path.join(output,`${surface}-${device}-${theme}-${width}.png`)});
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(390,760));await page.evaluate(()=>{document.documentElement.className='light nodus-phone';document.documentElement.style.fontSize='16px';});
 const picker=page.getByTestId('stellar-open-tabs');await picker.selectOption('2');assert.equal(await page.getByRole('tab',{selected:true}).getAttribute('id'),'fixture-tab-2');
 await page.getByRole('button',{name:'Cerrar grafo 2',exact:true}).click();assert.equal(await page.getByRole('tab',{selected:true}).getAttribute('id'),'fixture-tab-3');
 await picker.selectOption('1');assert.equal(await page.getByRole('button',{name:'Cerrar grafo 1',exact:true}).count(),0);
 await page.getByRole('tab',{selected:true}).press('End');assert.equal(await page.getByRole('tab',{selected:true}).getAttribute('id'),'fixture-tab-6');
 await page.getByRole('button',{name:'Nuevo grafo',exact:true}).click();assert.equal(await page.getByRole('tab',{selected:true}).getAttribute('id'),'fixture-tab-7');
 await picker.selectOption('6');await page.getByRole('button',{name:'Cerrar grafo 6',exact:true}).click();assert.equal(await page.getByRole('tab',{selected:true}).getAttribute('id'),'fixture-tab-7');
 await picker.selectOption('1');for(const id of[3,4,5,7]){await picker.selectOption(String(id));await page.getByRole('button',{name:`Cerrar grafo ${id}`,exact:true}).click();}assert.equal(await picker.count(),0);assert.equal(await page.getByRole('tab',{selected:true}).getAttribute('id'),'fixture-tab-1');
 assert.deepEqual(errors,[]);for(const file of inputs)assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),sourceHashes[file],'Source changed during fixture');
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({startedAt,completedAt:new Date().toISOString(),scope:'actual graph tab header in isolated Electron; no canvas or native acceptance claim',sourceHashes,scenarios:results,interactions:['select-offscreen','close-active-next','first-tab-permanent','keyboard-End','add-and-reveal','close-neighbor','last-picker-disappears'],passed:true},null,2)+'\n');console.log(`Graph tab header: ${results.length} geometry scenarios and 7 navigation checks passed.`);
}catch(error){fs.writeFileSync(path.join(output,`failure-${startedAt.replaceAll(':','-')}.json`),JSON.stringify({startedAt,current,error:String(error),sourceHashes,passed:false},null,2));if(app)await(await app.firstWindow()).screenshot({path:path.join(output,`failure-${startedAt.replaceAll(':','-')}.png`)});throw error;}finally{if(app)await app.close();fs.rmSync(fixture,{recursive:true,force:true});}
