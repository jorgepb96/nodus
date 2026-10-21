import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),{rpmRemoveScript,prepareSupportRpmScripts}=require('../build/supportLinux.cjs');

test('RPM upgrade and same-version repair retain new launcher links and policies', {skip:process.platform==='win32'},()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'support-rpm-remove-')),script=path.join(root,'postun'),marker=path.join(root,'removed');
  try {
    fs.writeFileSync(script,rpmRemoveScript('#!/bin/bash\nprintf removed >"$SUPPORT_SYNTHETIC_REMOVE_MARKER"\n'));
    for(const remaining of ['1','2','unknown']) {
      execFileSync('/bin/bash',[script,remaining],{env:{...process.env,SUPPORT_SYNTHETIC_REMOVE_MARKER:marker}});
      assert.equal(fs.existsSync(marker),false,`Postun must retain the new installation when ${remaining} versions remain`);
    }
    execFileSync('/bin/bash',[script,'0'],{env:{...process.env,SUPPORT_SYNTHETIC_REMOVE_MARKER:marker}});
    assert.equal(fs.readFileSync(marker,'utf8'),'removed');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('the guarded RPM script delegates final removal to the pinned builder template',()=>{
  const template=path.join(path.dirname(require.resolve('app-builder-lib/package.json')),'templates/linux/after-remove.tpl');
  const generated=fs.readFileSync(prepareSupportRpmScripts(),'utf8');
  assert.ok(generated.endsWith(fs.readFileSync(template,'utf8').replace(/^#![^\n]*\n/,'')));
});
