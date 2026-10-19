import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import childProcess from 'node:child_process';
import { installSupportIsolation } from '../shared/support/isolation.mjs';

test('Support blocks writes, links, networking and subprocesses outside its copied profile',async()=>{
  const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-support-boundary-'))),root=path.join(base,'copy'),original=path.join(base,'original');
  fs.mkdirSync(root);fs.mkdirSync(original);const file=path.join(original,'recent-work');fs.writeFileSync(file,'recent original work');
  if(process.platform!=='win32')fs.symlinkSync(original,path.join(root,'escape'));
  const guard=installSupportIsolation(root);
  try {
    fs.writeFileSync(path.join(root,'allowed'),'allowed');await fsp.writeFile(path.join(root,'async-allowed'),'allowed');
    assert.throws(()=>fs.writeFileSync(file,'lost'),/SUPPORT_WRITE_DENIED/);
    assert.throws(()=>fs.createWriteStream(file),/SUPPORT_WRITE_DENIED/);
    assert.throws(()=>fs.renameSync(file,path.join(root,'stolen')),/SUPPORT_WRITE_DENIED/);
    assert.throws(()=>fs.copyFileSync(path.join(root,'allowed'),file),/SUPPORT_WRITE_DENIED/);
    assert.throws(()=>fs.rmSync(original,{recursive:true,force:true}),/SUPPORT_WRITE_DENIED/);
    await assert.rejects(fsp.writeFile(file,'lost'),/SUPPORT_WRITE_DENIED/);
    const outside=await fsp.open(file,'r');try{await assert.rejects(outside.chmod(0o777),/SUPPORT_WRITE_DENIED/);}finally{await outside.close();}
    const allowedFd=fs.openSync(path.join(root,'descriptor'),'w');fs.closeSync(allowedFd);
    const readonlyFd=fs.openSync(file,'r');try{assert.throws(()=>fs.fchmodSync(readonlyFd,0o777),/SUPPORT_WRITE_DENIED/);}finally{fs.closeSync(readonlyFd);}
    assert.throws(()=>fs.linkSync(file,path.join(root,'hard-link')),/SUPPORT_WRITE_DENIED/);
    if(process.platform!=='win32')assert.throws(()=>fs.writeFileSync(path.join(root,'escape/recent-work'),'lost'),/SUPPORT_WRITE_DENIED/);
    assert.throws(()=>childProcess.spawnSync(process.execPath,['-e','process.exit(0)']),/SUPPORT_PROCESS_DENIED/);
    assert.throws(()=>net.connect(80,'example.org'),/SUPPORT_NETWORK_DENIED/);
    await assert.rejects(fetch('https://example.org'),/SUPPORT_NETWORK_DENIED/);
    assert.equal(fs.readFileSync(file,'utf8'),'recent original work');
  } finally { guard.restore();fs.rmSync(base,{recursive:true,force:true}); }
});
