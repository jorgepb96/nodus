// Execute only on the disposable native CI host. All source data is synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {_electron} from 'playwright-core';
import {inventory} from '../apps/nodus-support/core/files.mjs';
import {installerCommand,preserveInstallation} from '../apps/nodus-support/core/releases.mjs';
assert.equal(process.platform,'win32','Native Windows verification only');
assert.equal(process.env.CI,'true','Installer verification is restricted to disposable CI hosts');
const repo=path.resolve(import.meta.dirname,'..'),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-nsis-native-')));
const target=path.join(root,'program'),profile=path.join(root,'original-profile');fs.mkdirSync(profile);
fs.writeFileSync(path.join(profile,'app-prefs.json'),JSON.stringify({uiLanguage:'en'}));fs.writeFileSync(path.join(profile,'private-note.txt'),'preserved private synthetic note');
const before=await inventory(profile),installer=path.join(repo,'release-support/Nodus-Support-win-x64.exe');assert.ok(fs.existsSync(installer));
async function setup(args) {
 return new Promise((resolve,reject)=>{
  const child=spawn(installer,args,{stdio:'ignore',windowsHide:true});
  const timer=setTimeout(()=>{child.kill();reject(new Error('Synthetic installer timeout'));},180000);
  child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('close',code=>{clearTimeout(timer);resolve(code)});
 });
}
assert.equal(await setup(['/S','/currentuser',`/D=${target}`]),0,'Fresh fixture install');
const executable=path.join(target,'nodus-support.exe');assert.ok(fs.existsSync(executable));
fs.writeFileSync(path.join(target,'retain-existing-files.txt'),'do not remove installation additions');
const backup=path.join(root,'protected-before-repair');fs.mkdirSync(backup);await preserveInstallation(target,backup);
const command=installerCommand('win32','nsis',installer,target,{repairProtocol:1});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:executable,args:['--support-retained=1',`--support-state=${path.join(root,'ui-state')}`,`--nodus-profile=${profile}`],env,timeout:60000});
try {
 const page=await app.firstWindow();await page.waitForSelector('h1');
 assert.notEqual(await setup(command.args),0,'A running app must abort repair without force quitting it');
 assert.equal(await app.evaluate(()=>1),1,'The existing process remains alive');
 assert.equal(fs.readFileSync(path.join(target,'retain-existing-files.txt'),'utf8'),'do not remove installation additions');
}finally{await app.close();}
assert.equal(await setup(command.args),0,'An idle protected installation can be repaired in place');
assert.equal(fs.readFileSync(path.join(target,'retain-existing-files.txt'),'utf8'),'do not remove installation additions','The old uninstaller did not purge the installation');
assert.deepEqual(await inventory(profile),before,'Original user data remains unchanged');
const processes=execFileSync('tasklist.exe',['/FI','IMAGENAME eq nodus-support.exe','/FO','CSV','/NH'],{encoding:'utf8'});
assert.ok(!/^"nodus-support\.exe"/im.test(processes),'Repair must not automatically launch the installed program');
const output=path.join(repo,'.ci/support-native');fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'win32-x64-nsis.json'),JSON.stringify({format:'nodus.support-nsis-native-evidence/1',freshInstall:true,repairInPlace:true,installationAdditionsRetained:true,runningProcessPreserved:true,noAutomaticLaunch:true,originalProfileUnchanged:true,previousInstallationRetained:true},null,2));
console.log('Native NSIS repair passed: in-place files, preserved process/data, no auto-launch.');
