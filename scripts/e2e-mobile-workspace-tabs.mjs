// Local, isolated Electron geometry/interaction regression. Native WebKit and
// SwiftUI acceptance are separate; this does not claim iPhone keyboard coverage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright-core';

const root = process.cwd(), require = createRequire(import.meta.url);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-mobile-tabs-'));
const output = path.join(root, 'artifacts/interface-2026-10-15/workspace-tabs');
fs.mkdirSync(output, { recursive: true });
const assets = path.join(root, 'dist/assets');
const css = fs.readdirSync(assets).filter(file => /^index-.*\.css$/.test(file));
assert.equal(css.length, 1, 'Build the actual Desktop CSS before this geometry fixture.');
const styles = [path.join(assets, css[0]), ...['mobile.css', 'phone.css', 'workspaceTabs.css'].map(file => path.join(root, 'src/mobileWeb', file))];
fs.writeFileSync(path.join(fixture, 'fixture.css'), styles.map(file => fs.readFileSync(file, 'utf8')).join('\n'));
await build({
  stdin: { contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {WorkspaceTabStrip} from './src/components/library/LibraryWorkspaceTabs';
    function Fixture(){
      const [tabs,setTabs]=useState([
        {key:'first',title:'Una idea con un título muy largo que debe truncarse sin cubrir el botón de cierre',icon:'book'},
        {key:'second',title:'Otra investigación con referencias y un título extenso que debe caber en esta pestaña',icon:'telescope'},
      ]);
      const [active,setActive]=useState('second');
      return <main className="mobile-surface" data-surface="deepResearch">
        <WorkspaceTabStrip homeLabel="Deep Research" homeIcon="telescope" homeTestId="home"
          tabTestId={tab=>'tab-'+tab.key} closeTestId={tab=>'close-'+tab.key}
          tabs={tabs} activeKey={active} onActivateHome={()=>setActive(null)}
          onActivateTab={setActive} onCloseTab={id=>{
            const remaining=tabs.filter(tab=>tab.key!==id);setTabs(remaining);
            if(active===id)setActive(remaining.at(-1)?.key??null);
          }}/>
        <section data-testid="document" style={{flex:1,minHeight:0,padding:12}}>Contenido del documento</section>
      </main>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `, resolveDir: root, loader: 'tsx' },
  bundle: true, outfile: path.join(fixture, 'fixture.js'), format: 'iife', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' },
});
fs.writeFileSync(path.join(fixture, 'index.html'), '<!doctype html><html class="light nodus-phone"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
fs.writeFileSync(path.join(fixture, 'main.cjs'), `
  const {app,BrowserWindow}=require('electron');
  app.setPath('userData',${JSON.stringify(path.join(fixture, 'profile'))});
  app.whenReady().then(()=>{
    const window=new BrowserWindow({width:390,height:760,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    window.loadFile(${JSON.stringify(path.join(fixture, 'index.html'))});
  });
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
const results = [];
try {
  app = await electron.launch({ executablePath: require('electron'), args: [path.join(fixture, 'main.cjs')], env });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.getByTestId('tab-second').waitFor();
  for (const device of ['phone', 'tablet']) for (const theme of ['light', 'dark']) {
    for (const [width, height, scale] of [[320,700,1],[390,760,1],[844,320,1],[600,780,1.75],[1024,760,1.75]]) {
      await app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), {width,height});
      await page.evaluate(({device,theme,scale})=>{
        document.documentElement.className=theme+(device==='phone'?' nodus-phone':'');
        document.documentElement.style.fontSize=16*scale+'px';
        document.documentElement.style.setProperty('--mobile-accent','#6366f1');
      },{device,theme,scale});
      await page.getByTestId('tab-second').scrollIntoViewIfNeeded();
      const measured = await page.evaluate(() => {
        const rect = element => {const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        const strip=document.querySelector('.library-workspace-tabs');
        return {strip:rect(strip),home:rect(document.querySelector('[data-testid="home"]')),main:rect(document.querySelector('[data-testid="tab-second"]')),
          close:rect(document.querySelector('[data-testid="close-second"]')),
          content:rect(document.querySelector('[data-testid="document"]')),
          viewport:innerWidth,pageWidth:document.documentElement.scrollWidth};
      });
      const context = `${device}/${theme}/${width}/${scale}`;
      for(const target of [measured.main,measured.close]) {
        assert.ok(target.height>=44,`${context}: touch height`);
        assert.ok(target.y>=measured.strip.y-.5&&target.bottom<=measured.strip.bottom+.5,`${context}: a tab must fit vertically inside its own bar`);
      }
      assert.ok(measured.close.width>=44,`${context}: close touch width`);
      assert.ok(measured.strip.height<=Math.max(44,44*scale)+2,`${context}: the tab strip must keep its own row instead of growing over the document`);
      assert.ok(measured.close.x>=measured.main.right-.5,`${context}: the title must not cover Close`);
      assert.ok(measured.content.y>=measured.strip.bottom-.5,`${context}: tabs must not cover the document`);
      assert.ok(measured.pageWidth<=measured.viewport,`${context}: only the strip may scroll horizontally`);
      if(device==='phone') {
        assert.ok(measured.home.x>=measured.strip.x-.5,`${context}: the catalogue remains reachable while documents scroll`);
        assert.ok(measured.main.x>=measured.home.right-.5,`${context}: the catalogue must not cover the active document title`);
      }
      results.push({device,theme,width,height,scale,measured});
      if(width===390||width===844) await page.screenshot({path:path.join(output,`${device}-${theme}-${width}.png`)});
    }
  }
  await page.getByTestId('close-second').click();
  assert.equal(await page.getByTestId('tab-second').count(),0);
  assert.equal(await page.getByTestId('tab-first').getAttribute('aria-selected'),'true');
  await page.getByTestId('home').click();
  assert.equal(await page.getByTestId('home').getAttribute('aria-selected'),'true');
  await page.getByTestId('home').press('End');
  assert.equal(await page.getByTestId('tab-first').getAttribute('aria-selected'),'true');
  await page.getByTestId('tab-first').press('Delete');
  assert.equal(await page.getByTestId('home').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('[data-testid^="tab-"]').count(),0);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({scope:'isolated actual React component in Electron; native acceptance separate',styles,scenarios:results,interactions:['close-active','catalogue','keyboard-End','keyboard-Delete'],passed:true},null,2)+'\n');
  console.log(`Mobile workspace tabs: ${results.length} geometry scenarios and close/catalogue/keyboard interactions passed.`);
} finally {
  if(app) await app.close();
  fs.rmSync(fixture,{recursive:true,force:true});
}
