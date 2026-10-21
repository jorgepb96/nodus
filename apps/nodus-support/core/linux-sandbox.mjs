import fs from 'node:fs';
import path from 'node:path';
import {noLinks} from './files.mjs';
// Keep Chromium's sandbox enabled when a retained runtime needs the separately
// installed Support package's root-owned helper. Never chmod or elevate here.
export function supportSandbox(executable,inherited=null) {
 if(process.platform!=='linux')return null;
 for(const candidate of [path.join(path.dirname(executable),'chrome-sandbox'),inherited])if(candidate)try{
  noLinks(candidate);const stat=fs.statSync(candidate);
  if(stat.isFile()&&stat.uid===0&&(stat.mode&0o4000)!==0&&(stat.mode&0o022)===0&&(stat.mode&0o111)!==0)return candidate;
 }catch{/* Namespaces or the official system installer are needed instead. */}
 return null;
}
