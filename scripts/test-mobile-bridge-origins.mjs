import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-bridge-origins-'));
installRuntimeHooks(folder);
const {desktopBridgeOrigins}=createRequire(import.meta.url)('../shared/desktopBridgeOrigins.ts');
test('a running listener publishes its current LAN and VPN rather than the previous network',()=>{
  const first=desktopBridgeOrigins(52674,['172.16.10.5','100.64.1.20'],'acceptance-mac.local');
  const after=desktopBridgeOrigins(52674,['172.16.20.7','100.64.1.20'],'acceptance-mac.local');
  assert.equal(first[0],'https://acceptance-mac.local:52674');
  assert.equal(after[0],first[0]);
  assert(!after.includes('https://172.16.10.5:52674'));
  assert(after.includes('https://172.16.20.7:52674'));
  assert(after.includes('https://100.64.1.20:52674'));
});
test('only a valid mDNS name becomes a stable origin; no network retains loopback',()=>{
  assert.deepEqual(desktopBridgeOrigins(7443,[],'host.invalid'),['https://127.0.0.1:7443']);
  assert.deepEqual(desktopBridgeOrigins(7443,['10.0.0.2','10.0.0.2'],'user@host.local'),['https://10.0.0.2:7443']);
  assert.deepEqual(desktopBridgeOrigins(7443,[],'Mac.local.'),['https://mac.local:7443']);
});
process.on('exit',()=>fs.rmSync(folder,{recursive:true,force:true}));
