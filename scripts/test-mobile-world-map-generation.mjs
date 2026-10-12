import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {AsyncLocalStorage} from 'node:async_hooks';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-map-generation-'));
const hooks=installRuntimeHooks(directory),require=createRequire(import.meta.url),Module=require('node:module'),original=Module._load;
const owner=new AsyncLocalStorage(), stores=new Map();
const state=()=>stores.get(owner.getStore()??'a');
const reset=key=>{const entry={map:{mapId:'same-map',kind:'region',style:'parchment',imageId:'old',widthPx:100,heightPx:100,visualSeed:'A real valley'},marker:{x:.5,y:.5},saved:[],failSave:false};entry.db={transaction:fn=>()=>{const backup=structuredClone({map:entry.map,marker:entry.marker,saved:entry.saved});try{return fn();}catch(error){Object.assign(entry,backup);throw error;}}};stores.set(key,entry);};
reset('a');reset('b');
let barrier=null, abort=null, change=null;
Module._load=function(request,parent,isMain){
 if(request==='@google/genai')return {GoogleGenAI:class{}};
 if(request.endsWith('/db/database'))return {getDb:()=>state().db};
 if(request.endsWith('/settingsRepo'))return {getSettings:()=>({imageProvider:'nodus',imageModel:'mac-image',synthesisModel:{provider:'openai',model:'vision'}})};
 if(request.endsWith('/worldMapsRepo'))return {getWorldMap:()=>structuredClone(state().map),getMapImageBlob:()=>({blob:Buffer.from('old'),mimeType:'image/png'}),growMapCanvas:(_id,growth)=>{state().map.widthPx/=growth.x1-growth.x0;state().map.heightPx/=growth.y1-growth.y0;state().marker.y=growth.y0+state().marker.y*(growth.y1-growth.y0);},saveMapImage:input=>{if(state().failSave)throw new Error('save_failed');state().saved.push(input);state().map.imageId='new';},updateWorldMap:(_id,input)=>Object.assign(state().map,input)};
 if(request.endsWith('/mapMarkersRepo'))return {listMapMarkers:()=>[]};
 if(request.endsWith('/mapImageStore'))return {prepareMapImage:async bytes=>({blob:bytes,width:100,height:100,mimeType:'image/png'}),extendMapCanvas:async(bytes,growth)=>({blob:Buffer.from('extended-reference'),mimeType:'image/png'})};
 if(request.endsWith('/decorativeImages'))return {callImageProvider:async(provider,model,prompt)=>{assert.equal(provider,'nodus');assert.equal(model,'mac-image');assert.match(prompt,/A real valley/);if(barrier)await barrier;if(abort)abort.abort();if(change)state().map.imageId=change;return {bytes:Buffer.from('new'),mimeType:'image/png'};}};
 if(request.endsWith('/aiClient'))return {completeText:async()=> 'A valley with river'};
 if(request.endsWith('/secretStore'))return {getApiKey:()=>null};
 return original.call(this,request,parent,isMain);
};
try {
 const {generateMobileWorldMap,worldMapGenerationRequest}=require('../electron/desktopBridge/worldMapGeneration.ts');
 for(const bad of [{mapId:'same-map',mode:'expand',fraction:Infinity},{mapId:'same-map',mode:'zoom'},{mapId:'same-map',mode:'create',edge:'north'},{mapId:'same-map',mode:'create',model:'mobile'}])assert.throws(()=>worldMapGenerationRequest(bad),/invalid_map_generation_request/);
 const phases=[];await generateMobileWorldMap({mapId:'same-map',mode:'create'},phase=>phases.push(phase));assert.deepEqual(phases,['context','generating','saving']);assert.equal(state().map.imageId,'new');
 reset('a');abort=new AbortController();await assert.rejects(generateMobileWorldMap({mapId:'same-map',mode:'create'},()=>{},abort.signal),{name:'AbortError'});assert.equal(state().map.imageId,'old');abort=null;
 reset('a');change='other-job-image';await assert.rejects(generateMobileWorldMap({mapId:'same-map',mode:'create'},()=>{}),/source_conflict/);assert.equal(state().map.imageId,'other-job-image');change=null;
 reset('a');state().failSave=true;await assert.rejects(generateMobileWorldMap({mapId:'same-map',mode:'expand',edge:'north',fraction:.5},()=>{}),/save_failed/);assert.equal(state().map.heightPx,100);assert.equal(state().marker.y,.5);assert.equal(state().map.imageId,'old');
 reset('a');await generateMobileWorldMap({mapId:'same-map',mode:'expand',edge:'north',fraction:.5},()=>{});assert.ok(Math.abs(state().map.heightPx-150)<1e-9);assert.ok(Math.abs(state().marker.y-2/3)<1e-9);assert.equal(state().saved[0].model,'mac-image');assert.match(state().saved[0].prompt,/geography to reproduce/);
 reset('a');reset('b');let release;barrier=new Promise(resolve=>{release=resolve;});const first=owner.run('a',()=>generateMobileWorldMap({mapId:'same-map',mode:'create'},()=>{}));const second=owner.run('b',()=>generateMobileWorldMap({mapId:'same-map',mode:'create'},()=>{}));await assert.rejects(owner.run('a',()=>generateMobileWorldMap({mapId:'same-map',mode:'create'},()=>{})),/busy/);release();await Promise.all([first,second]);assert.equal(stores.get('a').map.imageId,'new');assert.equal(stores.get('b').map.imageId,'new');
 console.log('PASS: canonical Mac model/prompt, strict requests, cancelled/conflicting publication, atomic image+coordinates, per-vault task isolation');
}finally{Module._load=original;hooks.restore();fs.rmSync(directory,{recursive:true,force:true});}
