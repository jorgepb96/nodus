// Real Chromium SVG metrics and raster; provider/asset boundaries are isolated
// fixture transports. This does not claim native WK or provider acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';import {createHash,randomUUID} from 'node:crypto';
import {build} from 'esbuild';import {_electron as electron} from 'playwright-core';
const require=createRequire(import.meta.url),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-document-resources-'));
await build({entryPoints:{autonomousDocumentResources:'src/mobileWeb/autonomousDocumentResources.ts',portableChatSvgQuality:'shared/portableChatSvgQuality.ts'},bundle:true,platform:'node',format:'cjs',outdir:scratch});
const {autonomousDocumentResources}=require(path.join(scratch,'autonomousDocumentResources.js'));
const {portableChatSvgQuality}=require(path.join(scratch,'portableChatSvgQuality.js'));
fs.writeFileSync(path.join(scratch,'main.cjs'),"const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.loadURL('data:text/html,<body>Isolated visual contract</body>')});");
const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[path.join(scratch,'main.cjs'),'--user-data-dir='+path.join(scratch,'profile')],env:environment});
let assertions=0;
try {
 const evaluate=script=>app.evaluate(async({BrowserWindow},script)=>{const win=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'fixture-'+Math.random()}});try{await win.loadURL('data:text/html,'+encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><body style="margin:0">'));return await win.webContents.executeJavaScript(script);}finally{win.destroy();}},script);
 const valid='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><text x="20" y="50" font-family="Arial" font-size="24">Documented relation</text></svg>';
 const clipped='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40"><text x="50" y="30" font-size="24">A long evidence label</text></svg>';
 const owner='a'.repeat(64),model={provider:'openai',model:'fixture-only'};
 const trace=[],assets=[];let paid=0,repairs=0,flushes=0;
 const host={generationId:'fixture-generation',owner,version:0,imageProvider:'openai',imageModel:'fixture-image',resolveModelRef:()=>model,evaluate,
 completeText:async()=>{assert.equal(trace.at(-1),'flush');repairs++;return '```svg\n'+valid+'\n```';},
 generateImage:async(_prompt,aspect)=>{assert.equal(trace.at(-1),'flush');assert.equal(aspect,'3:4');paid++;const page=await app.firstWindow();await page.setContent(valid);const actualPng=await page.screenshot();return {base64:actualPng.toString('base64'),mimeType:'image/png'};},
 storeAsset:async input=>{assert.equal(input.generationId,'fixture-generation');assert.equal(input.owner,owner);const raw=Buffer.from(input.base64,'base64');const attachmentId=randomUUID(),receipt={source:`${input.kind==='image'?'nodus-image':'nodus-capability'}://chat/${owner}/${attachmentId}`,attachmentId,sha256:createHash('sha256').update(raw).digest('hex'),byteCount:raw.length};assets.push({...receipt,...input});return receipt;}};
 const execution={skills:[{id:'builtin-svg',instructions:'Draw faithfully',capabilities:['nodus:svg']}],question:'Explain documented evidence',model,owner,version:0,isCurrent:()=>true,locale:'en',pins:{},registry:{providers:new Map(),fences:new Map(),chatOrder:[],problems:[],revision:1},beforeInvoke:()=>trace.push('invoke'),beforePaidCall:()=>trace.push('paid'),beforeRepair:()=>trace.push('repair'),maxSvgRepairs:1,flushPersist:async()=>{flushes++;trace.push('flush');}};
 const quality=portableChatSvgQuality({...host,evaluateInSvgSandbox:evaluate});
 assert.deepEqual(await quality.inspectChatSvg(valid),[]);assert.ok((await quality.inspectChatSvg(clipped)).some(x=>x.startsWith('Clipped label:')));assertions+=2;
 const svgOnly=autonomousDocumentResources({...host,imageProvider:null,imageModel:null,generateImage:async()=>{throw new Error('SVG must not invoke an unconfigured image provider');}});
 const svgOnlyResult=await svgOnly.executeResources('```svg\n'+valid+'\n```',execution);assert.equal(svgOnlyResult.view.nodes[0].kind,'svg');assert.equal(paid,0);assertions+=2;
 const resources=autonomousDocumentResources(host);
 const svg=await resources.executeResources('```svg\n'+clipped+'\n```',execution);assert.equal(repairs,1);assert.equal(svg.view.nodes[0].svg.includes('Documented relation'),true);assert.equal(paid,0);assertions+=3;
 const dangerous=await resources.executeResources('```svg\n'+valid.replace('</svg>','<script>alert(1)</script><image href="https://example.invalid/a.png"/></svg>')+'\n```',execution);assert.doesNotMatch(dangerous.view.nodes[0].svg,/<script|https:\/\//);assertions++;
 const imageExecution={...execution,skills:[{id:'builtin-image',capabilities:['nodus:image']}]};
 const brief='```nodus-image\n'+JSON.stringify({prompt:'An evidence diagram with clear readable labels',aspectRatio:'3:4'})+'\n```';
 const result=await resources.executeResources(brief+'\n'+brief,imageExecution);assert.equal(paid,1);assert.equal(result.view.nodes.length,1);assert.match(result.text,/Only one image/);assert.equal(assets.length,2);assert.ok(flushes>=2);assertions+=5;
 const savedAssets=assets.map(a=>({...a,owner}));
 const reopened=autonomousDocumentResources({...host,existingAssets:savedAssets,generateImage:async()=>{throw new Error('Reopening must not buy an image');}});
 await reopened.executeResources(result.text,imageExecution);assert.equal(paid,1);assert.ok(Object.keys(reopened.assets()).length>=2);assertions+=2;
 await assert.rejects(()=>resources.executeResources('```nodus-capability-result\n{}\n```',execution),/Desktop|fabricated/);
 await assert.rejects(()=>resources.executeResources('```nodus-tool\n{}\n```',execution),/Desktop/);
 await assert.rejects(()=>resources.executeResources(brief,{...imageExecution,owner:'b'.repeat(64)}),/owner/);assertions+=3;
 const failed=autonomousDocumentResources({...host,generateImage:async()=>{throw new Error('Must never invoke after failed durable flush');}});
 await assert.rejects(()=>failed.executeResources(brief,{...imageExecution,flushPersist:async()=>{throw new Error('disk unavailable');}}),/insertable/);assert.equal(paid,1);assertions+=2;
 const corrupt=autonomousDocumentResources({...host,existingAssets:[{...savedAssets[0],sha256:'0'.repeat(64)}]});await assert.rejects(()=>corrupt.executeResources(result.text,imageExecution),/receipt/);assertions++;
 console.log(JSON.stringify({ok:true,assertions,actualDomInspector:true,actualRaster:true,fixtureImageProviderCalls:paid,repairCalls:repairs,assetReceipts:assets.length,nativeWK:false,externalProvider:false}));
} finally {await app.close();fs.rmSync(scratch,{recursive:true,force:true});}
