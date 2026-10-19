import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {waitForTrial,trialReceiptPath} from '../apps/nodus-support/core/trial-ready.mjs';
test('a spawn alone cannot qualify a trial, and stale/wrong receipts cannot confirm it',async()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-ready-'))),token=randomUUID(),input={root,token,version:'5.13.0',pid:1234,timeout:15};
  try {
    await assert.rejects(waitForTrial(input),/TRIAL_NOT_READY/);
    assert.throws(()=>trialReceiptPath(root,'../outside'),/INVALID_REQUEST/);
    const file=trialReceiptPath(root,token);fs.writeFileSync(file,JSON.stringify({protocol:1,...input,pid:5678}));await assert.rejects(waitForTrial(input),/TRIAL_READY_INVALID/);
    fs.writeFileSync(file,JSON.stringify({protocol:1,...input}));assert.equal((await waitForTrial(input)).pid,1234);assert.equal((await waitForTrial({...input,pid:undefined})).pid,1234);
    const controller=new AbortController();controller.abort();await assert.rejects(waitForTrial({...input,signal:controller.signal}),error=>error.name==='AbortError');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
