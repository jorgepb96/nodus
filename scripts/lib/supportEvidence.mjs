import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

export function supportSourceDigest(root) {
  const names=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','--','apps/nodus-support','shared','electron','src','build','scripts','package.json','package-lock.json','vite.config.ts','.github/workflows'],{cwd:root,encoding:'utf8'}).split('\0').filter(name=>name!=='apps/nodus-support/qualified-repairs.json'&&/\.(?:[cm]?js|tsx?|json|css|svg|ya?ml)$/.test(name));
  const hash=createHash('sha256');
  for(const name of [...new Set(names)].sort()) {hash.update(name+'\0');hash.update(fs.existsSync(path.join(root,name))?fs.readFileSync(path.join(root,name),'utf8').replaceAll('\r\n','\n'):'<deleted>');hash.update('\0');}
  return hash.digest('hex');
}
