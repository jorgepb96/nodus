import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createHash,webcrypto} from 'node:crypto';
const bundled=await build({entryPoints:['src/mobileWeb/autonomousResearchVisuals.ts'],bundle:true,write:false,platform:'browser',format:'cjs',metafile:true,alias:{'@shared':'./shared'}});assert(!Object.keys(bundled.metafile.inputs).some(file=>file.startsWith('electron/')));const module={exports:{}};new Function('module','exports',bundled.outputFiles[0].text)(module,module.exports);const api=module.exports;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('forty poster retries retain their birth owners and journal receipts without image blobs or paid calls',async()=>{
 const id='48309d71-e141-4689-9463-82f591e6d874',birth='58309d71-e141-4689-9463-82f591e6d874',vault='actual-source-vault',body='Actual copied source evidence.',base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGwoAAAAASUVORK5CYII=';
 const checkpoint={id,entityKey:'captured-request',request:{objective:'Actual evidence',model:{provider:'openai',model:'fixture'},documentSkills:{enabled:true,skills:[{skillId:'builtin-svg',enabled:true,maxCalls:40}]}},context:{vaultId:vault,vaultType:'study'},calls:{},report:{draft:{title:'Actual',brief:{language:'en'},draftMarkdown:body,abstract:''}}};
 const figures=Array.from({length:40},(_,i)=>{const figureId=`68309d71-e141-4689-9463-${String(i).padStart(12,'0')}`;return {id:figureId,blockId:'body:0',skillId:'builtin-svg',brief:'Actual',caption:'Evidence',sources:[],layout:'wide',state:'failed',ownerRevision:birth,owner:hash(['document-figure',vault,`deep-research:${id}:${birth}:${figureId}`]),view:{schemaVersion:1,summary:'Actual',nodes:[]}};});
 checkpoint.report.mobileVisuals={manifest:{schemaVersion:1,target:{kind:'deep-research',id},vaultId:vault,revision:birth,contentHash:hash({body}),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),state:'partial',policy:checkpoint.request.documentSkills,usage:{'builtin-svg':{attempts:40,paidCalls:0}},blocks:[],figures},assets:[]};
 let paid=0,snapshots=0,persisted=0,published=0;const receipts=[];
 const call=async(method,input)=>{
  if(method==='mobileImageConfiguration')throw new Error('not configured');
  if(method==='mobileStructuredCompletion'){paid++;throw new Error('poster retry must not buy model output');}
  if(method==='documentFigureAssetReceipts')return [];
  if(method==='documentFigureSnapshot'){snapshots++;assert(checkpoint.report.mobileVisuals.manifest.figures.some(f=>f.owner===input.owner&&f.view));assert(persisted>0);return `data:image/png;base64,${base64}`;}
  if(method==='documentFigureStoreAsset'){assert.equal(input.base64,base64);const figure=checkpoint.report.mobileVisuals.manifest.figures.find(f=>f.owner===input.owner);const assetId=`78309d71-e141-4689-9463-${String(receipts.length).padStart(12,'0')}`,sha256=createHash('sha256').update(Buffer.from(base64,'base64')).digest('hex'),receipt={id:assetId,vaultId:vault,parentRecordId:'owned-checkpoint',generationId:id,targetId:id,figureId:figure.id,figureKey:figure.id,owner:figure.owner,ownerRevision:birth,mimeType:'image/png',byteCount:Buffer.from(base64,'base64').length,sha256};receipts.push(receipt);return {receipt,attachmentId:assetId,source:`nodus-image://chat/${figure.owner}/${assetId}`,sha256,byteCount:receipt.byteCount};}
  if(method==='documentFigurePublishAssets'){published++;assert.equal(input.assets.length,40);assert(!JSON.stringify(input).includes(base64));return [];}
  throw new Error(`Unexpected host ${method}`);
 };
 globalThis.crypto??=webcrypto;
 await api.enrichAutonomousResearchVisuals(call,checkpoint,async()=>{persisted++;},new AbortController());assert.equal(paid,0);assert.equal(snapshots,40);assert.equal(checkpoint.report.mobileVisuals.manifest.state,'ready');assert(checkpoint.report.mobileVisuals.manifest.figures.every(f=>f.ownerRevision===birth));assert(!JSON.stringify(checkpoint).includes(base64));assert(JSON.stringify(checkpoint).length<100000);
 await api.publishAutonomousResearchVisualAssets(call,checkpoint,async()=>{});assert.equal(published,1);
});
test('academic visual exclusion matches the canonical Desktop route without host/provider work',async()=>{await api.enrichAutonomousResearchVisuals(()=>{throw new Error('No host calls permitted');},{context:{vaultType:'academic'},request:{documentSkills:{enabled:true,skills:[]}},report:{}},async()=>{},new AbortController());});
