import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSync} from 'esbuild';
const output=buildSync({entryPoints:['src/mobileWeb/completeGuideWebImages.ts'],bundle:true,write:false,format:'cjs',platform:'browser',metafile:true,alias:{'@shared':'./shared'}});
assert(!Object.keys(output.metafile.inputs).some(file=>/aiClient|settingsRepo|searxngService/.test(file)));
const module={exports:{}};new Function('module','exports',output.outputFiles[0].text)(module,module.exports);
const {mobileCompleteGuideWebImages}=module.exports;
function fixture(license='CC BY-SA 4.0'){
 const calls=[];
 const call=async(method,url,kind)=>{calls.push([method,url,kind]);assert.equal(method,'mobileGuideCommonsResource');const parsed=new URL(url);if(kind==='image'){assert.equal(parsed.host,'upload.wikimedia.org');return {png:'cG5n',width:400,height:300};}if(parsed.searchParams.has('generator'))return {query:{pages:[{title:'File:Earth globe.jpg',fullurl:'https://commons.wikimedia.org/wiki/File:Earth_globe.jpg'}]}};return {query:{pages:[{imageinfo:[{thumburl:'https://upload.wikimedia.org/example.jpg',thumbmime:'image/jpeg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Earth_globe.jpg',extmetadata:{LicenseShortName:{value:license},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'},Artist:{value:'<b>Actual author</b>'},ObjectName:{value:'Earth globe'},ImageDescription:{value:'Earth globe photograph'}}}]}]}};};
 return {call,calls};
}
test('device Commons discovery verifies actual licence, relevance and author before image bytes',async()=>{const {call,calls}=fixture();const images=await mobileCompleteGuideWebImages(call,[{itemId:'real-item',query:'Earth globe',caption:'Earth'}],'en',new AbortController().signal);assert.equal(images.length,1);assert.equal(images[0].attribution.author,'Actual author');assert.equal(images[0].attribution.license,'CC BY-SA 4.0');assert.equal(images[0].source,'https://commons.wikimedia.org/wiki/File:Earth_globe.jpg');assert.equal(calls.length,3);});
test('unlicensed images are never downloaded; cancellation starts no requests',async()=>{const {call,calls}=fixture('All rights reserved');assert.deepEqual(await mobileCompleteGuideWebImages(call,[{itemId:'real-item',query:'Earth globe',caption:'Earth'}],'en',new AbortController().signal),[]);assert.equal(calls.length,2);const controller=new AbortController();controller.abort();await assert.rejects(mobileCompleteGuideWebImages(call,[{itemId:'real-item',query:'Earth globe',caption:'Earth'}],'en',controller.signal));assert.equal(calls.length,2);});
