import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {assert,noLinks,readJson} from './files.mjs';
export function trialReceiptPath(root,token) {
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token),'INVALID_REQUEST');
  return path.join(root,`trial-ready-${token}.json`);
}
export async function waitForTrial({root,token,version,pid,signal,timeout=90000}) {
  const file=trialReceiptPath(root,token),until=Date.now()+timeout;
  while(Date.now()<until) {
    signal?.throwIfAborted();
    if(fs.existsSync(file)) {
      noLinks(file);const value=readJson(file);
      assert(value.protocol===1&&value.root===root&&value.token===token&&value.version===version&&Number.isInteger(value.pid)&&value.pid>0&&(pid===undefined||value.pid===pid),'TRIAL_READY_INVALID');
      return value;
    }
    await delay(Math.min(200,Math.max(1,until-Date.now())),undefined,{signal});
  }
  throw Object.assign(new Error('TRIAL_NOT_READY'),{code:'TRIAL_NOT_READY'});
}
