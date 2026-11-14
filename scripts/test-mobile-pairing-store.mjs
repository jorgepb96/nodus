import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-pairing-store-'));
const runtime=installRuntimeHooks(root);runtime.app.once=()=>{};runtime.app.on=()=>{};
const require=createRequire(import.meta.url);
try {
  const bridge=require('../electron/desktopBridge/server.ts');
  assert.deepEqual(bridge.desktopBridgeStatus().pairings,[]);
  assert.equal(bridge.desktopBridgeStatus().error,null);
  const file=path.join(root,'desktop-bridge/pairings.bin');fs.mkdirSync(path.dirname(file),{recursive:true});
  const original=Buffer.from('unreadable encrypted credentials');fs.writeFileSync(file,original);
  assert.match(bridge.desktopBridgeStatus().error,/llavero.*bloqueado/);
  await bridge.resumeDesktopBridge();assert.equal(bridge.desktopBridgeStatus().running,false);
  await assert.rejects(bridge.createDesktopBridgeOffer([],['corpus']),/llavero.*bloqueado/);
  runtime.safeStorage.isEncryptionAvailable=()=>true;runtime.safeStorage.decryptString=()=>{throw new Error('Authentication failed');};
  assert.match(bridge.desktopBridgeStatus().error,/descifrar/);
  await assert.rejects(bridge.createDesktopBridgeOffer([],['corpus']),/descifrar/);
  assert.deepEqual(fs.readFileSync(file),original,'Inaccessible credentials must remain byte-identical');
  for(const invalid of ['{}','null','[{}]']){
    runtime.safeStorage.decryptString=()=>invalid;
    assert.match(bridge.desktopBridgeStatus().error,/descifrar/);
  }
  runtime.safeStorage.decryptString=()=>JSON.stringify([{id:'legacy-device',tokenHash:'hash',vaultIds:['vault'],domains:['corpus'],deviceName:'Phone'}]);
  const status=bridge.desktopBridgeStatus();assert.equal(status.pairings.length,1);assert.equal(status.pairings[0].id,'legacy-device');
  assert(!Object.hasOwn(status.pairings[0],'tokenHash'),'Status never exposes credential hashes');
  console.log(JSON.stringify({suite:'mobile-pairing-store',passed:true,lockedKeychain:true,corruptCiphertext:true,invalidJSON:true,noOverwrite:true,legacyCompatible:true}));
} finally {fs.rmSync(root,{recursive:true,force:true});}
