import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assert, canonical, noLinks, readJson, separate, writeRecord } from './files.mjs';
import { assertSourceState,captureSourceState } from './source-state.mjs';

export function readPolicy(folder, profile) {
  if (!fs.existsSync(folder)) return null;
  noLinks(folder);
  const source = canonical(profile);
  for (const name of fs.readdirSync(folder).filter(name => /^\d+-[a-f0-9-]+\.json$/.test(name)).sort().reverse()) {
    const file = path.join(folder,name); noLinks(file); const value = readJson(file);
    if (value.format === 'nodus.support-launch-policy/1' && value.source === source) return value;
  }
  return null;
}
export function resolvePolicy(folder,profile,{verifySources=true}={}) {
  let source=canonical(profile),selected=null,last=null,softwareGraphics=false;
  const visited=new Set();
  for(let depth=0;depth<32;depth++) {
    assert(!visited.has(source),'RECOVERY_SELECTION_CONFLICT');visited.add(source);
    const policy=readPolicy(folder,source);
    if(!policy)return last?{...last,recoveredRoot:selected,softwareGraphics}:null;
    last=policy;softwareGraphics||=policy.softwareGraphics===true;
    if(!policy.recoveredRoot)return {...policy,recoveredRoot:selected,softwareGraphics};
    if(verifySources)assertSourceState(policy.sourceState);
    const marker=readJson(path.join(policy.recoveredRoot,'support-session.json'));
    assert(marker.protocol===1&&marker.root===canonical(policy.recoveredRoot)&&marker.network===false,'INVALID_SESSION');
    noLinks(policy.recoveredRoot);selected=policy.recoveredRoot;source=path.join(selected,'profile');
  }
  throw new Error('RECOVERY_SELECTION_CONFLICT');
}
export async function writePolicy(folder, profile, changes, previousId, id = randomUUID()) {
  assert(/^[0-9a-f-]{36}$/.test(id),'INVALID_REQUEST');
  separate(folder,profile); const previous = readPolicy(folder,profile);
  if (previousId !== undefined) assert((previous?.id ?? null) === previousId,'CONCURRENT_CHANGE');
  assert(typeof changes.softwareGraphics === 'boolean' && (changes.recoveredRoot === null || typeof changes.recoveredRoot === 'string'),'INVALID_REQUEST');
  if (changes.recoveredRoot) {
    separate(profile,changes.recoveredRoot); noLinks(changes.recoveredRoot);
    const manifest = readJson(path.join(changes.recoveredRoot,'support-session.json'));
    assert(manifest.protocol === 1 && manifest.root === canonical(changes.recoveredRoot),'INVALID_SESSION');
  }
  const sourceState=changes.recoveredRoot?(changes.sourceState??captureSourceState([profile])):null;
  if(sourceState)assertSourceState(sourceState);
  const value = {format:'nodus.support-launch-policy/1',id,source:canonical(profile),at:new Date().toISOString(),softwareGraphics:changes.softwareGraphics,recoveredRoot:changes.recoveredRoot,sourceState};
  const latest = fs.existsSync(folder) ? Math.max(0,...fs.readdirSync(folder).filter(name=>/^\d+-[a-f0-9-]+\.json$/.test(name)).map(name=>Number(name.split('-')[0]))) : 0;
  await writeRecord(path.join(folder,`${Math.max(Date.now(),latest+1)}-${value.id}.json`),value); return value;
}
