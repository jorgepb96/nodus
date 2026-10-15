import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const output=buildSync({entryPoints:['src/mobileWeb/completeGuideWebText.ts'],bundle:true,write:false,format:'cjs',platform:'browser',metafile:true,alias:{'@shared':'./shared'}});
assert(!Object.keys(output.metafile.inputs).some(file=>/aiClient|settingsRepo|searxngService|database\.ts/.test(file)));
const module={exports:{}};new Function('module','exports','require',output.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url));
const {mobileCompleteGuideWebText}=module.exports;
test('canonical device web step uses configured search and captured actual page text',async()=>{
 const calls=[];
 const text='Earth radius measurements describe the size of the planet. Earth has an equatorial radius near 6378 kilometres and a polar radius near 6357 kilometres. Geodesy distinguishes the reference ellipsoid from the spherical mean radius. ';
 const call=async(method,url,kind)=>{assert.equal(method,'mobilePublicWebResource');calls.push([url,kind]);if(kind==='json'){assert.equal(new URL(url).origin,'https://search.fixture.test');return {results:[{url:'https://science.fixture.test/earth-radius',title:'Earth radius measurements',content:text,engines:['fixture'],positions:[1],score:1,category:'general',publishedDate:null}]};}return {url,finalUrl:url,kind:'html',contentType:'text/html',body:`<html><head><title>Earth radius measurements</title></head><body><article><h1>Earth radius</h1><p>${text.repeat(5)}</p></article></body></html>`};};
 const json=async prompt=>{let value;if(prompt.system.includes('plan web searches'))value={search:true,queries:[{q:'Earth radius measurements',scholarly:false}]};else if(prompt.system.includes('choose which search results'))value={read:[0]};else if(prompt.system.includes('rate evidence passages'))value={ratings:Array.from({length:20},(_,i)=>({i,r:2}))};else value={queries:[]};assert(prompt.validate(value),'Fixture must satisfy the actual canonical validator');return value;};
 const result=await mobileCompleteGuideWebText(call,'https://search.fixture.test/search',{unit:'Earth radius',terms:['measurements'],sections:['Planet dimensions']},json,undefined,new AbortController().signal);
 assert(result.passages.length>0,'Actual fetched and extracted text reaches canonical evidence selection');
 for(const row of result.passages){assert(row.text.includes('Earth'));assert.equal(row.id,`web:${createHash('sha256').update(JSON.stringify([row.record.finalUrl,row.record.pageNumber,row.record.text])).digest('hex')}`);assert.equal(row.text,row.record.text);}
 assert(calls.some(([,kind])=>kind==='page'));
});
