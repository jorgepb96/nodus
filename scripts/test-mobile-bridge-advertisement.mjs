import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Bonjour from 'bonjour-service';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-link-mdns-'));
const runtime=installRuntimeHooks(root);
const {advertiseDesktopBridge}=createRequire(import.meta.url)('../electron/desktopBridge/advertisement.ts');

test('portable publisher is discoverable over real mDNS with byte-exact TXT and shuts down', {timeout:15000}, async()=>{
  const name='Nodus-Link-Test-'+process.pid;
  const instance=new Bonjour();
  let advertisement;
  let browser;
  try {
    const found=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('mdns_discovery_timeout')),12000);
      browser=instance.find({type:'nodus-mobile'},service=>{
        if(service.name!==name)return;clearTimeout(timeout);resolve(service);
      });
      // Exercise the Windows/Linux implementation on this host, without changing process.platform.
      advertisement=advertiseDesktopBridge(name,52172,['n=1','p0=signed-offer-fixture','proof=opaque-proof'],'linux');
      advertisement.on('error',error=>{clearTimeout(timeout);reject(error);});
    });
    assert.equal(found.port,52172);assert.equal(found.type,'nodus-mobile');
    assert.equal(String(found.txt.p0),'signed-offer-fixture');assert.equal(String(found.txt.proof),'opaque-proof');
    await new Promise(resolve=>{advertisement.once('exit',resolve);advertisement.kill();});
    assert.equal(advertisement.kill(),false);
  } finally {browser?.stop();instance.destroy();advertisement?.kill();}
});
process.on('exit',()=>{runtime.restore();fs.rmSync(root,{recursive:true,force:true});});
