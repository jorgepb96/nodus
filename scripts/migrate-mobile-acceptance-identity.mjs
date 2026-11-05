import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const lab=process.env.NODUS_MOBILE_ACCEPTANCE_LAB;
assert(lab && fs.existsSync(path.join(lab,'.nodus-mobile-acceptance-lab')),'Only a marked disposable laboratory can be migrated');
const script=path.resolve('node_modules/.cache/nodus-mobile-acceptance/identity-migration.cjs');
fs.mkdirSync(path.dirname(script),{recursive:true});
fs.writeFileSync(script,`
const {app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path');
const lab=process.env.NODUS_MOBILE_ACCEPTANCE_LAB, mode=process.env.NODUS_ACCEPTANCE_IDENTITY_MIGRATION;
if(!lab || !fs.existsSync(path.join(lab,'.nodus-mobile-acceptance-lab')))throw new Error('Laboratory required');
app.setName(mode==='read'?'Nodus Mobile Acceptance':'Nodus');app.setPath('userData',lab);
app.whenReady().then(async()=>{
 if(!safeStorage.isEncryptionAvailable())throw new Error('Protected storage unavailable');
 const files=['secrets/ai_key_deepseek.bin','secrets/backup_password.bin','secrets/backup_recovery_key.bin','desktop-bridge/pairings.bin','desktop-bridge/relay.bin'];
 if(mode==='read'){
  const values={};for(const file of files){const p=path.join(lab,file);if(!fs.existsSync(p))continue;
   if(fs.lstatSync(p).isSymbolicLink())throw new Error('Unexpected laboratory symlink');
   try{values[file]=safeStorage.decryptString(fs.readFileSync(p));}catch{}
  }
  process.stdout.write(JSON.stringify(values),()=>app.quit());return;
 }
 let input='';for await(const chunk of process.stdin)input+=chunk.toString();const values=JSON.parse(input);let converted=0,compatible=0;
 for(const file of files){const p=path.join(lab,file);if(!fs.existsSync(p))continue;
  if(fs.lstatSync(p).isSymbolicLink())throw new Error('Unexpected laboratory symlink');
  try{safeStorage.decryptString(fs.readFileSync(p));compatible++;continue;}catch{}
  if(typeof values[file]!=='string')throw new Error('Cannot recover protected laboratory file: '+file);
  const backup=path.join(lab,'identity-migration-backups',file);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(p,backup);
  const temporary=p+'.identity-migration';fs.writeFileSync(temporary,safeStorage.encryptString(values[file]),{mode:0o600});fs.renameSync(temporary,p);
  if(safeStorage.decryptString(fs.readFileSync(p))!==values[file])throw new Error('Protected migration verification failed');converted++;
 }
 input='';for(const key of Object.keys(values))values[key]='';
 process.stdout.write(JSON.stringify({converted,compatible,plaintextFilesWritten:0}),()=>app.quit());
}).catch(error=>{console.error(error.message);app.exit(1)});
`,{mode:0o600});
const executable=path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
async function run(mode,input) {
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,[script],{env:{...process.env,NODUS_ACCEPTANCE_IDENTITY_MIGRATION:mode},stdio:['pipe','pipe','pipe']});
  const chunks=[];let diagnostics='';child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.on('data',chunk=>diagnostics+=chunk.toString());
  child.on('error',reject);child.on('exit',code=>code===0?resolve(Buffer.concat(chunks)):reject(new Error('Laboratory identity migration failed: '+diagnostics.slice(0,200))));
  child.stdin.end(input);
 });
}
const protectedValues=await run('read');
const result=await run('write',protectedValues);protectedValues.fill(0);
console.log(result.toString());
