// Native filesystem failures against disposable fixtures, including a dedicated image.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {SupportService} from '../apps/nodus-support/core/service.mjs';
import {inventory,verifyInventory,writeNew} from '../apps/nodus-support/core/files.mjs';
import {createFaultVolume,fillFaultVolume} from './lib/supportFaultVolume.mjs';
import {supportSourceDigest} from './lib/supportEvidence.mjs';

const repo=path.resolve(import.meta.dirname,'..'),sourceSha256=supportSourceDigest(repo),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-support-storage-'))),checked=[];
const profile=path.join(root,'original');fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'note.txt'),Buffer.alloc(1024**2,42));
const initial=await inventory(profile),make=(storage,progress=()=>{})=>new SupportService({profile,storage,isRunning:async()=>false,progress});
const volume=createFaultVolume(root);
let testFailure,detachFailure;
try {
  // Preflight must stop before copying into a volume that is already full.
  const preflight=make(path.join(volume.mount,'preflight'));let session=await preflight.create({symptom:'data',mode:'guided'});
  const filler=path.join(volume.mount,'owned-filler.bin');fillFaultVolume(volume.mount,filler);
  try{session=await preflight.protect(session.id);assert.equal(session.status,'blocked');assert.equal(session.lastError,'NOT_ENOUGH_SPACE');assert.equal(session.protection,undefined);}
  finally{fs.truncateSync(filler,0);}
  checked.push('native-disk-full-preflight');

  // Fill the same small filesystem AFTER inventory/reservation and before output finishes.
  let filled=false;const late=make(path.join(volume.mount,'late-full'),value=>{
    if(!filled&&value.phase==='protecting'&&value.completed>0){filled=true;fillFaultVolume(volume.mount,path.join(volume.mount,'late-owned-filler.bin'));}
  });
  session=await late.create({symptom:'data',mode:'guided'});let failure;
  try{session=await late.protect(session.id);}catch(error){failure=error;}
  finally{fs.truncateSync(path.join(volume.mount,'late-owned-filler.bin'),0);}
  assert.ok(filled);session=await late.session(session.id);
  assert.notEqual(session.status,'protected');assert.equal(session.protection,undefined);
  assert.ok(['ENOSPC','EIO','OPERATION_FAILED'].includes(failure?.code??session.lastError),`Expected actual filesystem failure: ${failure?.code??session.lastError}`);
  await verifyInventory(profile,initial);
  session=await late.resume(session.id);assert.equal(session.status,'created');
  const attempts=fs.readdirSync(path.join(session.folder,'protection'));assert.ok(attempts.length>0);
  // A subsequent attempt must retain the failed directory and make a new verified copy.
  late.progress=()=>{};session=await late.protect(session.id);assert.equal(session.status,'protected');
  for(const name of attempts)assert.ok(fs.existsSync(path.join(session.folder,'protection',name)));
  checked.push('native-disk-full-during-copy','resume-after-disk-full','partial-copy-retained');

  // An external library is disconnected at a file boundary during protection.
  const library=path.join(volume.mount,'nodus-library');fs.mkdirSync(library);fs.writeFileSync(path.join(library,'a.bin'),Buffer.alloc(4096,11));fs.writeFileSync(path.join(library,'b.bin'),Buffer.alloc(4096,12));
  const external=await inventory(library);fs.writeFileSync(path.join(profile,'app-prefs.json'),JSON.stringify({autoBackupFolder:volume.mount,libraryGlobalEnabled:true}));
  const withLibrary=await inventory(profile);let disconnected=false,lastPhase='';
  const unplugged=make(path.join(root,'unplugged-support'),value=>{
    const boundary=lastPhase==='verifying';lastPhase=value.phase;
    if(!disconnected&&boundary&&value.phase==='protecting'&&value.total===8192&&value.completed===4096){volume.disconnect();disconnected=true;}
  });
  session=await unplugged.create({symptom:'data',mode:'guided'});session=await unplugged.protect(session.id);
  assert.ok(disconnected);assert.equal(session.status,'blocked');assert.equal(session.protection,undefined);
  volume.reconnect();await verifyInventory(library,external);await verifyInventory(profile,withLibrary);
  unplugged.progress=()=>{};session=await unplugged.resume(session.id);session=await unplugged.protect(session.id);assert.equal(session.status,'protected');
  checked.push('native-volume-disconnected-during-copy','resume-after-reconnect');

  // Deny write access to the protection directory, leaving journals writable.
  const denied=make(path.join(root,'permission-support'));session=await denied.create({symptom:'data',mode:'guided'});
  const protection=path.join(session.folder,'protection');fs.mkdirSync(protection);
  let sid;
  if(process.platform==='win32') {
    sid=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8'}).trim();assert.match(sid,/^S-\d-(?:\d+-)*\d+$/);
    execFileSync('icacls.exe',[protection,'/deny',`*${sid}:(OI)(CI)(W)`],{stdio:'pipe'});
  } else fs.chmodSync(protection,0o500);
  try{session=await denied.protect(session.id);assert.equal(session.status,'blocked');assert.ok(['EACCES','EPERM'].includes(session.lastError));assert.equal(session.protection,undefined);}
  finally{if(sid)execFileSync('icacls.exe',[protection,'/remove:d',`*${sid}`],{stdio:'pipe'});else fs.chmodSync(protection,0o700);}
  session=await denied.protect(session.id);assert.equal(session.status,'protected');await verifyInventory(profile,withLibrary);
  checked.push('native-permission-denied','resume-after-permission-restored');

  if(process.platform==='win32') {
    // FileShare.None is a real Windows sharing violation, not an injected JS error.
    const ready=path.join(root,'lock-ready'),file=path.join(root,'hold-lock.ps1');
    fs.writeFileSync(file,`param([string]$Source,[string]$Ready)\n$h=[System.IO.File]::Open($Source,'Open','ReadWrite','None');try{[System.IO.File]::WriteAllText($Ready,'ready');[Console]::ReadLine()|Out-Null}finally{$h.Dispose()}`);
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',file,path.join(profile,'note.txt'),ready],{stdio:['pipe','ignore','pipe']});const closed=new Promise(resolve=>child.once('close',resolve));let stderr='';child.stderr.on('data',value=>{stderr+=value;});
    try {
      const until=Date.now()+30000;while(!fs.existsSync(ready)){assert.equal(child.exitCode,null,stderr);assert.ok(Date.now()<until);await new Promise(resolve=>setTimeout(resolve,20));}
      const locked=make(path.join(root,'locked-support'));let blocked=await locked.create({symptom:'data',mode:'guided'});blocked=await locked.protect(blocked.id);
      assert.equal(blocked.status,'blocked');assert.ok(['EBUSY','EACCES','EPERM'].includes(blocked.lastError));assert.equal(blocked.protection,undefined);
    }finally{child.stdin.end('\n');await closed;}
    await verifyInventory(profile,withLibrary);checked.push('native-windows-sharing-violation');
  }
  assert.equal(supportSourceDigest(repo),sourceSha256,'Sources changed during qualification.');
  const output=path.join(repo,'.ci/support-native');fs.mkdirSync(output,{recursive:true});
  await writeNew(path.join(output,`${process.platform}-${process.arch}-storage-${Date.now()}.json`),{format:'nodus.support-storage-evidence/1',sourceSha256,platform:process.platform,arch:process.arch,originalsUnchanged:true,nativeVolume:true,checked});
  console.log(`Native storage failure recovery passed: ${checked.join(', ')}.`);
}catch(error){testFailure=error;throw error;}
finally{try{volume.disconnect();}catch(error){detachFailure=error;console.error('Fixture detach:',error.message);}/* Preserve all images, fixtures, journals and copies. */}
if(detachFailure&&!testFailure)throw detachFailure;
