// Real renderer + production preload; a controlled main-process service exercises
// UI transitions without enabling unqualified repairs or touching user files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-flow-')));
const fixture=path.join(scratch,'main.mjs');
fs.writeFileSync(fixture,`
import {app,BrowserWindow,ipcMain} from 'electron';
import {randomUUID} from 'node:crypto';
const state={inspection:{profile:'/synthetic/profile',executable:'/synthetic/Nodus',version:'5.13.0',protocol:1,language:'en',platform:process.platform,arch:process.arch,findings:[],roots:[]},sessions:[],storage:'/synthetic/support',qualifiedRepairs:['interactive-copy','apply-solution','restore-copy','reinstall']};
let current=null,events=[],delay=0;globalThis.fixture={reset(){current=null;events=[];delay=0},events:()=>events,delay(ms){delay=ms}};
const clone=value=>structuredClone(value),record=(action,...args)=>events.push({action,args});
const methods={
 inspect:()=>state,setLanguage(){},
 create(input){current={id:randomUUID(),at:new Date().toISOString(),...input,status:'created',actions:[],files:3,bytes:100,folder:'/synthetic/session',recoveredProfiles:[]};return current},
 protect(){current.status='protected';return current},
 async test(id,action){record('test',action);if(delay)await new Promise(resolve=>setTimeout(resolve,delay));const diagnostic=['fresh-profile','configuration-check','database-check','model-check','library-check','archive-roundtrip'].includes(action);current.status=diagnostic?'protected':'awaiting-user';current.trialOpened=null;current.actions.push({id:randomUUID(),at:new Date().toISOString(),action,status:'passed'});if(!diagnostic)current.recoveredProfiles.push('/synthetic/trial-'+current.actions.length);return current},
 launchRecovered(id,index){current.trialOpened=current.recoveredProfiles[index];return current},
 answer(id,works){record('answer',works);current.status=works?'confirmed':'reverted';return current},
 applySolution(){record('apply');current.policyApplied='synthetic-policy';return current},
 undoSolution(id,choice='check'){record('undo',choice);if(choice==='check')current.status='conflict';else if(choice==='keep-current')current.status='confirmed';else{current.status='reverted';current.policyApplied=null;}return current},
 cancel(){record('cancel');return current},
 report(id,selection){record('report',selection);return {markdown:'# Nodus support report\\nReviewed synthetic findings.',errors:[],issueUrl:'https://github.com/jorgepb96/nodus/issues/new',needsClipboard:false}},
 copyReport(value){record('copy',value)},saveReport(id,selection,value){record('save',value);return '/synthetic/reviewed.zip'},openIssue(id,selection,value){record('issue',value)},
 reinstall(){record('reinstall');current.installationPrevious='/synthetic/previous-installation';current.status='awaiting-user';current.trialOpened=null;current.recoveredProfiles.push('/synthetic/reinstall-trial');return current},
 restore(){record('restore');current.status='awaiting-user';current.trialOpened=null;const root='/synthetic/restored';current.recoveredProfiles.push(root);current.recoveryInfo={[root]:{source:'additional-copy.nodus',backupDate:'2026-01-02T00:00:00.000Z'}};return current},
 exportOriginalLogs(){record('private-export');return '/synthetic/private.zip'},reveal(){},openGuide(){},resume(){return current}
};
void (async()=>{await app.whenReady();
const win=new BrowserWindow({width:1120,height:850,webPreferences:{preload:${JSON.stringify(path.join(repo,'build/support-app/preload.cjs'))},sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
for(const [name,fn]of Object.entries(methods))ipcMain.handle('support:'+name,async(event,...args)=>{if(event.sender!==win.webContents)throw new Error('Invalid sender');return {ok:true,value:clone(await fn(...args))}});
await win.loadFile(${JSON.stringify(path.join(repo,'build/support-app/ui/index.html'))});
app.on('window-all-closed',()=>app.quit());
})();
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({args:[fixture],env,timeout:60000});
const output=path.join(repo,'.ci/support-ui');fs.mkdirSync(output,{recursive:true});
const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
const button=(name)=>page.getByRole('button',{name,exact:true});
const enabled=async name=>page.waitForFunction(name=>[...document.querySelectorAll('button')].some(button=>button.textContent===name&&!button.disabled),name);
const events=()=>app.evaluate(()=>globalThis.fixture.events());
async function ready(){await page.waitForSelector('h1');await button('Check my installation').click();await button('Create verified copy').click();await page.locator('.test-list .test-row').first().waitFor();}
async function reset(automatic=false){await app.evaluate(()=>globalThis.fixture.reset());await page.reload();await page.waitForSelector('h1');if(automatic)await page.getByRole('radio').nth(1).check();await ready();}
let accessibilityChecks=0;
async function accessible(name){await page.evaluate(fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'),'utf8'));const violations=await page.evaluate(async()=> (await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[],name);accessibilityChecks++;await page.screenshot({path:path.join(output,'flow-'+name+'.png'),fullPage:true});}
try{
 await ready();assert.equal(await page.locator('.test-list').first().locator('.test-row').count(),1);await accessible('guided-protected');
 await page.locator('.test-list').first().getByRole('button').click();
 await page.waitForFunction(()=>document.querySelector('.test-list')?.textContent?.includes('graphics'));
 await page.locator('.test-list').first().getByRole('button').click();
 await button('It works now').waitFor();assert.equal(await button('It works now').isDisabled(),true);
 await page.getByRole('button',{name:/^Open additional copy/}).first().click();await enabled('It works now');assert.equal(await button('It works now').isEnabled(),true);await accessible('awaiting-confirmation');
 await button('Still not working').click();await page.locator('.test-list').first().getByRole('button').click();
 await page.getByRole('button',{name:/^Open additional copy/}).last().click();await button('It works now').click();await button('Use this solution when opening Nodus').click();await accessible('confirmed');
 await button('Return to the previous state, keeping all copies').click();await button('Keep the current profile').waitFor();await accessible('divergent-edits');
 await button('Keep the current profile').click();await button('Return to the previous state, keeping all copies').click();await button('Use the previous profile and retain this one too').click();
 assert.deepEqual((await events()).filter(e=>e.action==='undo').map(e=>e.args[0]),['check','keep-current','check','use-previous']);
 await button('Get help').click();await page.locator('textarea').waitFor();assert.equal(await button('Open issue on GitHub').isDisabled(),true);
 await page.locator('.log-filters select').selectOption('20');await page.waitForFunction(()=>document.querySelector('.review-ack input')?.disabled);assert.equal(await page.locator('.review-ack input').isDisabled(),true);
 await page.locator('.report').getByRole('button',{name:'Check',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.review-ack input')?.disabled);
 await page.locator('.review-ack input').check();await button('Copy report').click();
 await page.locator('textarea').fill('# Nodus support report\nEdited and reviewed findings.');assert.equal(await button('Open issue on GitHub').isDisabled(),true);await page.locator('.review-ack input').check();await button('Open issue on GitHub').click();await button('Save report').click();
 assert.equal((await events()).find(e=>e.action==='issue').args[0],'# Nodus support report\nEdited and reviewed findings.');await accessible('reviewed-report');
 await reset(true);await button('Automatic sequence').click();await button('It works now').waitFor();assert.deepEqual((await events()).filter(e=>e.action==='test').map(e=>e.args[0]),['fresh-profile','software-graphics']);await accessible('automatic-paused-for-user');
 await reset(true);await app.evaluate(()=>globalThis.fixture.delay(1200));await button('Automatic sequence').click();await button('Stop').click();await page.waitForFunction(()=>!document.querySelector('button.primary:disabled'));await new Promise(resolve=>setTimeout(resolve,250));assert.equal((await events()).filter(e=>e.action==='test').length,1,'Stop must prevent the next action even if the current diagnostic completed');
 await reset();await button('Download and reinstall Nodus').click();await button('It works now').waitFor();assert.equal(await button('It works now').isDisabled(),true);await page.getByRole('button',{name:/^Open additional copy/}).last().click();await button('It works now').click();await button('It works now').waitFor({state:'detached'});assert.equal(await button('Use this solution when opening Nodus').count(),0,'A successful reinstall must not redirect the user to a copied profile');await accessible('reinstall-confirmed');
 assert.equal(errors.length,0,errors.join('\n'));
 fs.writeFileSync(path.join(output,'flow-verification.json'),JSON.stringify({scope:'production-renderer-and-preload-with-controlled-main-service',guided:true,automatic:true,failedSolution:true,conflictChoices:true,reviewRequired:true,editedReport:true,stopBetweenSteps:true,reinstallationConfirmation:true,accessibilityChecks,errors},null,2));
 console.log('Support renderer: guided/automatic flow, failed solution, divergent edits, reviewed reports, cancellation and reinstall confirmation passed.');
}catch(error){await page.screenshot({path:path.join(output,'flow-failure.png'),fullPage:true}).catch(()=>{});throw error;}finally{await app.close();}
