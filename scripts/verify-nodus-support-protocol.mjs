import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { inventory } from '../apps/nodus-support/core/files.mjs';
import { runProbe } from '../apps/nodus-support/core/probe.mjs';
const require=createRequire(import.meta.url),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-support-protocol-')));
for (const action of ['fresh-profile','software-graphics']) {
  const root=path.join(scratch,action),profile=path.join(root,'profile');fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'private-canary.txt'),'retained synthetic work');
  fs.writeFileSync(path.join(root,'isolation.json'),JSON.stringify({format:'nodus.isolated-research-profile/1',root}));
  fs.writeFileSync(path.join(root,'support-session.json'),JSON.stringify({protocol:1,root,network:false}));
  const before=await inventory(profile);
  const result=await runProbe({executable:require('electron'),args:[repo],root,action,diagnostic:value=>console.error('Synthetic protocol bootstrap diagnostic:',JSON.stringify(value))});
  assert.equal(result.ok,true);assert.equal(result.root,root);assert.equal(result.protocol,1);assert.equal(result.softwareGraphics,action==='software-graphics');
  assert.deepEqual(await inventory(profile),before);
}
console.log('Native early bootstrap protocol passed: fresh profile and software graphics, retained fixture data.');
