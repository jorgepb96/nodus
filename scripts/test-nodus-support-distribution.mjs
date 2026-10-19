import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {classifyInstallerAsset,classifyReleaseAsset,sumReleaseDownloads} from './github-release-downloads.mjs';

test('Support and diagnostic runtime downloads do not count as main Nodus installations',()=>{
 const names=['Nodus-Support-win-x64.exe','Nodus-Support-win-x64-portable.exe','Nodus-Support-mac-arm64.dmg','Nodus-Support-mac-x64.zip','Nodus-Support-x86_64.AppImage','Nodus-Support-linux-amd64.deb','Nodus-Runtime-win32-x64.zip','Nodus-Runtime-darwin-arm64.zip','Nodus-Runtime-linux-x64.zip'];
 for(const name of names){assert.equal(classifyReleaseAsset(name),null);assert.equal(classifyInstallerAsset(name),null);}
 assert.equal(sumReleaseDownloads([{assets:[...names.map(name=>({name,download_count:100})),{name:'Nodus-win-x64.exe',download_count:7}]}]).total,7);
});
test('the real website chooses main installers even when Support assets appear first',async()=>{
 const names={'dl-win':'Nodus-win-x64.exe','dl-mac-arm':'Nodus-mac-arm64.dmg','dl-mac-intel':'Nodus-mac-x64.dmg','dl-linux-appimage':'Nodus-linux-x86_64.AppImage','dl-linux-deb':'Nodus-linux-amd64.deb','dl-linux-rpm':'Nodus-linux-x86_64.rpm'};
 const anchors=new Map(Object.keys(names).map(id=>[id,{href:'unchanged',querySelector:()=>({textContent:''})}]));
 const noop=()=>{},classes={add:noop,remove:noop,contains:()=>false},modal={querySelector:()=>null,querySelectorAll:()=>[],focus:noop};
 const overlay={classList:classes,querySelector:()=>modal,addEventListener:noop};
 const document={readyState:'complete',getElementById:id=>id==='dl-overlay'?overlay:anchors.get(id)??null,querySelectorAll:()=>[],addEventListener:noop,documentElement:{classList:classes},body:{style:{}}};
 const assets=[...Object.values(names).map(name=>({name:name.replace('Nodus-','Nodus-Support-'),size:1,browser_download_url:'WRONG-SUPPORT'})),...Object.values(names).map(name=>({name,size:1,browser_download_url:'https://example.invalid/'+name}))];
 const context={document,window:{},matchMedia:query=>({matches:query.includes('prefers-reduced-motion')}),fetch:async()=>({ok:true,json:async()=>({assets})})};
 vm.runInNewContext(fs.readFileSync(path.resolve(import.meta.dirname,'../site/assets/js/site.js'),'utf8'),context);context.window.openDl();
 for(let i=0;i<10;i++)await Promise.resolve();
 for(const [id,name]of Object.entries(names))assert.equal(anchors.get(id).href,'https://example.invalid/'+name);
});

test('Support is dispatched after publication and never bundled or required by the normal release',async()=>{
 const {load}=await import('js-yaml'),read=name=>load(fs.readFileSync(path.resolve(import.meta.dirname,'../.github/workflows',name),'utf8'));
 const main=read('release-build.yml'),support=read('release-support.yml'),dispatch=main.jobs['release-support'];
 assert.equal(dispatch.needs,'verify-and-publish');assert.equal(dispatch.uses,undefined);assert.match(dispatch.steps[0].run,/gh workflow run release-support.yml/);assert.doesNotMatch(dispatch.steps[0].run,/gh run watch/);
 assert.ok(!main.jobs['verify-and-publish'].needs.includes('support-quality'));
 for(const [name,job]of Object.entries(main.jobs))if(name!=='release-support')assert.doesNotMatch(JSON.stringify(job),/support:dist|support-release\.mjs|nodus-support\.yml/);
 assert.equal(support.jobs.safety.needs,'validate');assert.deepEqual(support.jobs.build.needs,['validate','safety']);assert.equal(support.jobs.build.strategy.matrix.os.length,4);
 const steps=support.jobs.build.steps,publish=steps.findIndex(step=>step.run==='node scripts/support-app-release.mjs');assert.ok(publish>steps.findIndex(step=>step.run==='npm run support:dist'));
 const runtime=fs.readFileSync(path.resolve(import.meta.dirname,'../build/supportRuntime.cjs'),'utf8');assert.doesNotMatch(runtime,/build-nodus-support|cpSync|prepareSupportRuntime/);assert.match(runtime,/nodus-support-protocol\.json/);
 const pkg=JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname,'../package.json'),'utf8'));assert.equal(pkg.build.nsis.include,undefined);
 assert.match(support.jobs.validate.steps[1].run,/isDraft/,'Support cannot be published into a draft');
});
