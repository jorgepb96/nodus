import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
test('actual isolated process crash releases the OS lock and retains the stale PID marker',()=>{
 const repo=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-instance-crash-'))),script=path.join(root,'verify.mjs');
 try {
  fs.mkdirSync(path.join(root,'profile'));fs.writeFileSync(path.join(root,'isolation.json'),JSON.stringify({format:'nodus.isolated-research-profile/1',root}));
  fs.writeFileSync(script,`
   import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
   import {installRuntimeHooks} from ${JSON.stringify(pathToFileURL(path.join(repo,'scripts/lib/tsRuntimeHooks.mjs')).href)};
   import {installSupportIsolation} from ${JSON.stringify(pathToFileURL(path.join(repo,'shared/support/isolation.mjs')).href)};
   const root=${JSON.stringify(root)},require=createRequire(${JSON.stringify(path.join(repo,'package.json'))});installRuntimeHooks(path.join(root,'profile'));
   const {claimSupportProfile}=require(${JSON.stringify(path.join(repo,'electron/support/instanceLock.ts'))});
   if(process.argv[2]) {
     installSupportIsolation(root);const release=claimSupportProfile(root);assert.equal(typeof release,'function');assert.equal(claimSupportProfile(root),null);assert.equal(process.kill(process.pid,0),true);
     if(process.argv[2]==='reclaim'){assert.ok(fs.readdirSync(path.join(root,'profile')).some(name=>name.startsWith('isolated-instance.lock.support-retained-')));release();process.stdout.write('RECLAIMED');}
     else {process.stdout.write('LOCKED');setInterval(()=>{},1000);}
   }else {
     const child=spawn(process.execPath,[${JSON.stringify(script)},'hold'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe']});let diagnostics='';child.stderr.on('data',value=>diagnostics+=value);
     await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(new Error('Fixture exited '+code+': '+diagnostics)));child.once('error',reject);});
     assert.equal(claimSupportProfile(root),null);child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));
     const recovered=spawn(process.execPath,[${JSON.stringify(script)},'reclaim'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe']});let output='';recovered.stdout.on('data',value=>output+=value);recovered.stderr.on('data',value=>diagnostics+=value);const code=await new Promise(resolve=>recovered.once('exit',resolve));assert.equal(code,0,diagnostics);assert.equal(output,'RECLAIMED');
   }
  `);
  execFileSync(require('electron'),[script],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:20000,stdio:'pipe'});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
