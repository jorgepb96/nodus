import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launchComponentBrowser } from './lib/component-test-browser.mjs';
import { componentStyles } from './lib/component-test-styles.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname);
test('image favorites can be saved and removed with keyboard without changing the default or text favorites',{timeout:120000},async t=>{
 const chrome=[process.env.CHROME_BIN,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium'].filter(Boolean).find(existsSync);if(!chrome){t.skip('A test browser is required');return;}
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import {useState} from 'react';import{createRoot}from'react-dom/client';import{ImageGenerationSettings}from'./src/views/ProvidersSettings';
 const models=[{provider:'openai',id:'image-a',name:'Imagen A'},{provider:'openai',id:'image-b',name:'Imagen B'}];
 let settings={imageProvider:'openai',imageModel:'image-a',imageStyle:'watercolor',imageFavorites:[],favorites:[{provider:'ollama',model:'text-only'}]};
 window.readPreferences=()=>settings;window.nodus={listImageModels:async()=>models,updateSettings:async patch=>{settings={...settings,...patch};return settings;}};
 function App(){const[state,setState]=useState(settings);return<ImageGenerationSettings settings={state} onChange={async()=>setState({...settings})}/>;}createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,outdir:'out',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const{browser,close}=await launchComponentBrowser(chromium,{executablePath:chrome,headless:true});
 try{const page=await browser.newPage({viewport:{width:1100,height:800}});await page.setContent('<html><body><div id="root"></div></body></html>');await page.addStyleTag({content:await readFile(componentStyles(),'utf8')});const css=bundle.outputFiles.find(file=>file.path.endsWith('.css'));if(css)await page.addStyleTag({content:css.text});await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
 const star=page.getByTestId('image-favorite-openai-image-b');await star.waitFor();await star.focus();await page.keyboard.press('Space');await page.waitForFunction(()=>window.readPreferences().imageFavorites.length===1);
 assert.equal(await star.getAttribute('aria-pressed'),'true');assert.deepEqual(await page.evaluate(()=>window.readPreferences()),{imageProvider:'openai',imageModel:'image-a',imageStyle:'watercolor',imageFavorites:[{provider:'openai',model:'image-b'}],favorites:[{provider:'ollama',model:'text-only'}]});
 await star.click();await page.waitForFunction(()=>window.readPreferences().imageFavorites.length===0);assert.equal(await star.getAttribute('aria-pressed'),'false');
 }finally{await close();}
});
