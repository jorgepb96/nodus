import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {isSigningTarget, signingIgnore, additionalSigningTargets} = require('../build/macSigningFiles.cjs');
test('Mach-O and fat headers are signed regardless of suffix; ordinary binary resources are sealed only by their bundle', () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-sign-targets-'));
  try {
    for (const magic of ['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca']) {
      const file=path.join(temp,magic+'.dat');fs.writeFileSync(file,Buffer.from(magic+'00000000','hex'));
      assert.equal(isSigningTarget(file),true);assert.equal(signingIgnore(file),false);
    }
    for(const [name,bytes] of [['locale.dat',Buffer.from([0,1,255,0,17])],['logo.gif',Buffer.from('GIF89a\0\0')],['script',Buffer.from('#!/usr/bin/python\n')],['short.node',Buffer.from([0,1])]]) {
      const file=path.join(temp,name);fs.writeFileSync(file,bytes);assert.equal(signingIgnore(file),true);
    }
    const code=path.join(temp,'feedfacf.dat');const link=path.join(temp,'native-link');fs.symlinkSync(code,link);assert.equal(isSigningTarget(link),true);
    fs.symlinkSync(path.join(temp,'absent'),path.join(temp,'broken'));assert.throws(()=>signingIgnore(path.join(temp,'broken')));
    assert.throws(()=>signingIgnore(path.join(temp,'absent')));
    assert.equal(signingIgnore(code,()=>true),true,'retain caller restrictions');
    const app=path.join(temp,'Test.app');fs.mkdirSync(path.join(app,'Contents','PlugIns','Native.docktileplugin','Contents','MacOS'),{recursive:true});
    const native=path.join(app,'Contents','PlugIns','Native.docktileplugin','Contents','MacOS','native');fs.copyFileSync(code,native);
    const targets=additionalSigningTargets(app);assert(targets.includes(native));assert(targets.includes(path.join(app,'Contents','PlugIns','Native.docktileplugin')));
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
test('canonical local and release configurations use the classifier without weakening release requirements',()=>{
  const base=require('../build/electron-builder.config.cjs');assert.equal(base.mac.sign,'build/macLocalSign.cjs');
  const source=fs.readFileSync(new URL('../build/macSign.cjs',import.meta.url),'utf8');
  assert(source.includes('if (!isSigningTarget(filePath)) return true;'));assert(source.includes('resolveDeveloperIdIdentity(options)'));
  assert(source.includes('optionsForFile:'));assert(source.includes('entitlements: emptyEntitlements'));
});
