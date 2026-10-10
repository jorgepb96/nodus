import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export function sourceRevision(root) {
  const digest=createHash('sha256');
  const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).sort();
  for(const file of files) {
    const absolute=path.join(root,file);
    if(!fs.existsSync(absolute)){digest.update(`deleted:${file}\0`);continue;}
    if(!fs.statSync(absolute).isFile())continue;
    digest.update(file);digest.update('\0');digest.update(fs.readFileSync(absolute));digest.update('\0');
  }
  return {commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceDigest:digest.digest('hex')};
}
