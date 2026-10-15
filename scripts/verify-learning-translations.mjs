import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {_electron as electron} from 'playwright-core';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const scratch=await mkdtemp(path.join(os.tmpdir(),'nodus-guide-translations-'));
const output=path.join(root,'artifacts/academic-learning/in-situ-translations');await mkdir(output,{recursive:true});
const bundle=path.join(scratch,'registry.cjs');
buildSync({stdin:{contents:"export * from './shared/academicLearning';export * from './shared/academicLearningCopy';",resolveDir:root,loader:'ts'},outfile:bundle,bundle:true,format:'cjs',platform:'node',logLevel:'silent'});
const {ACADEMIC_LESSONS,LEARNING_LANGUAGES,LEARNING_COPY,learningText}=require(bundle);
for(const [key,row]of Object.entries(LEARNING_COPY)){assert.equal(row.length,12,key);assert.ok(row.every(s=>s.trim()),key);const fields=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();for(const s of row)assert.deepEqual(fields(s),fields(row[0]),key);}
const env={...process.env,NODUS_USERDATA:path.join(scratch,'profile'),NODUS_DISABLE_AUTO_UPDATE:'1',NODUS_E2E_UPDATE_STATUS:'not-available'};
delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:require('electron'),args:[root],env});const results=[],errors=[];
try{
 const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 await page.waitForLoadState('load');await page.evaluate(()=>window.nodus.updateSettings({basicsTutorialVersion:9999,firstVaultVersion:9999,recoverySetupVersion:9999,onboardingComplete:true,tourComplete:true,advancedTourComplete:true,mascotEnabled:false,mascotStyleChosen:true,autoBackupEnabled:false,autoLightScan:false,autoDeepScanOnReadTag:false,academicInterfaceProfile:'simple',reduceMotion:true}));
 await page.addInitScript(version=>{localStorage.setItem('nodus.lastSeenVersion',version);sessionStorage.setItem('nodus.startupUpdateChecked','1');for(const key of ['nodus.mobileTeaserSeen.3.2.4','nodus.platformHighlightsSeen.2026-07','nodus.tutorialVideosAnnouncementSeen.2026-07','nodus.pdfPresenterTutorialSeen.e2js_u-05OA','nodus.toolkitBetaGuideSeen.2.4.0'])localStorage.setItem(key,'1');},require(path.join(root,'package.json')).version);
 if(process.env.NODUS_E2E_URL)await app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows()[0].loadURL(url),process.env.NODUS_E2E_URL);else await app.evaluate(({BrowserWindow},file)=>BrowserWindow.getAllWindows()[0].loadFile(file),path.join(root,'artifacts/academic-interface/app/index.html'));
 await page.getByTestId('academic-interface-trigger').waitFor();const before=await page.evaluate(async()=>({works:await window.nodus.listWorks(),settings:await window.nodus.getSettings()}));
 for(const language of LEARNING_LANGUAGES)for(const lesson of ACADEMIC_LESSONS){
  await page.evaluate(async({language,id})=>{await window.nodus.updateSettings({uiLanguage:language});window.dispatchEvent(new CustomEvent('nodus:academic-learning',{detail:{lessonId:id,mode:'guide'}}));},{language,id:lesson.id});
  const coach=page.getByTestId('academic-learning-coach');await coach.waitFor();await page.waitForTimeout(200);
  assert.equal(await page.getByTestId('academic-learning-demo').count(),0);
  assert.ok((await coach.innerText()).includes(learningText('guideLabel',language)));
  assert.equal(await coach.locator('h2').textContent(),learningText(lesson.steps[0],language));
  assert.notEqual((await page.evaluate(()=>window.nodus.getSettings())).academicPracticeSession.phase,'complete');
  await mkdir(path.join(output,language),{recursive:true});await page.screenshot({path:path.join(output,language,lesson.id+'.png')});
  results.push({language,lesson:lesson.id,inSitu:true,translated:true});await coach.getByTestId('learning-pause').click();await coach.waitFor({state:'detached'});console.log(language+' / '+lesson.id+': translated in-app guide passed');
 }
 const after=await page.evaluate(async()=>({works:await window.nodus.listWorks(),settings:await window.nodus.getSettings()}));assert.deepEqual(after.works,before.works);for(const key of ['chatModel','extractionModel','embeddingProvider','embeddingModel','academicInterfaceProfile','autoLightScan','autoDeepScanOnReadTag'])assert.deepEqual(after.settings[key],before.settings[key],key);assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'verification.json'),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),languages:LEARNING_LANGUAGES,lessons:ACADEMIC_LESSONS.map(l=>l.id),inSituGuides:results.length,results,errors},null,2));
}catch(error){const page=await app.firstWindow();await page.screenshot({path:path.join(output,'failure.png')});await writeFile(path.join(output,'failure.txt'),await page.locator('body').innerText());throw error;}finally{await app.close();await rm(scratch,{recursive:true,force:true});}
