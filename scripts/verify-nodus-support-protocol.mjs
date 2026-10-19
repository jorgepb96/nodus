import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { inventory } from '../apps/nodus-support/core/files.mjs';
const require=createRequire(import.meta.url),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-support-protocol-')));
for (const action of ['fresh-profile','software-graphics']) {
  const root=path.join(scratch,action),profile=path.join(root,'profile');fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'private-canary.txt'),'retained synthetic work');
  fs.writeFileSync(path.join(root,'isolation.json'),JSON.stringify({format:'nodus.isolated-research-profile/1',root}));
  fs.writeFileSync(path.join(root,'support-session.json'),JSON.stringify({protocol:1,root,network:false}));
  const before=await inventory(profile), env={...process.env,NODUS_ISOLATED_ROOT:root,NODUS_SUPPORT_PROBE:'1',NODUS_SUPPORT_ACTION:action};delete env.ELECTRON_RUN_AS_NODE;
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[repo],{env,stdio:['ignore','pipe','pipe']});let stdout='';
    const timer=setTimeout(()=>{child.kill();reject(new Error('Native probe timeout'));},60000);
    child.stdout.on('data',chunk=>stdout+=chunk.toString());child.stderr.on('data',()=>{});
    child.on('error',reject);child.on('close',code=>{clearTimeout(timer);try{assert.equal(code,0);resolve(JSON.parse(stdout.split('\n').find(line=>line.startsWith('@@NODUS_SUPPORT@@')).slice(17)));}catch(error){reject(error);}});
  });
  assert.equal(result.ok,true);assert.equal(result.root,root);assert.equal(result.protocol,1);assert.equal(result.softwareGraphics,action==='software-graphics');
  assert.deepEqual(await inventory(profile),before);
}
console.log('Native early bootstrap protocol passed: fresh profile and software graphics, retained fixture data.');
