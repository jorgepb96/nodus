import {physicalFs as fs} from './files.mjs';
import path from 'node:path';
import { assert,canonical,noLinks } from './files.mjs';

// The full hashes are verified before applying a solution. At later launches,
// detect intervening file/directory changes without hashing large libraries on
// every startup. Reading can change atime, so atime is deliberately excluded.
export function captureSourceState(sources) {
  const roots=[...new Set(sources.map(canonical))].map(source=>{
    noLinks(source);const entries=[];
    function walk(file,relative) {
      const stat=fs.lstatSync(file,{bigint:true});
      assert(!stat.isSymbolicLink()&&(stat.isFile()||stat.isDirectory()),'RECOVERY_SELECTION_CONFLICT');
      entries.push({path:relative,type:stat.isDirectory()?'directory':'file',bytes:String(stat.size),mtime:String(stat.mtimeNs),ctime:String(stat.ctimeNs),inode:String(stat.ino),device:String(stat.dev)});
      if(stat.isDirectory())for(const name of fs.readdirSync(file).sort())walk(path.join(file,name),relative?`${relative}/${name}`:name);
    }
    walk(source,'');return {source,entries};
  });
  return {format:'nodus.support-source-state/1',roots};
}
export function assertSourceState(state) {
  try{
    assert(state?.format==='nodus.support-source-state/1'&&Array.isArray(state.roots)&&state.roots.length>0,'RECOVERY_SELECTION_CONFLICT');
    const current=captureSourceState(state.roots.map(root=>root.source));
    assert(JSON.stringify(current)===JSON.stringify(state),'RECOVERY_SELECTION_CONFLICT');
  }catch{assert(false,'RECOVERY_SELECTION_CONFLICT');}
}
