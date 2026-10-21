import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {isolatedPath,validateIsolatedRoot} from '../qa/isolatedProfile';

// The OS releases SQLite's exclusive lock even after a process crash. The old
// PID marker remains compatible with QA tools and is retained when stale.
export function claimSupportProfile(requested:string):(()=>void)|null {
  const root=validateIsolatedRoot(requested),profile=isolatedPath(root,'profile');
  const Constructor=createRequire(import.meta.url)('better-sqlite3') as typeof Database;
  const coordination=path.join(profile,'support-instance-coordination.sqlite'),marker=path.join(profile,'isolated-instance.lock');
  const db=new Constructor(coordination,{timeout:0});let fd:number|undefined;
  const close=()=>{if(db.open){if(db.inTransaction)db.exec('ROLLBACK');db.close();}};
  try {
    db.exec('BEGIN EXCLUSIVE');fs.chmodSync(coordination,0o600);
    try{fd=fs.openSync(marker,'wx',0o600);}
    catch(error) {
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      const owner=Number(fs.readFileSync(marker,'utf8'));
      if(!Number.isSafeInteger(owner)||owner<=0)throw Object.assign(new Error('SUPPORT_INSTANCE_UNVERIFIED'),{code:'SUPPORT_INSTANCE_UNVERIFIED'});
      try{process.kill(owner,0);close();return null;}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH'){close();return null;}}
      fs.renameSync(marker,`${marker}.support-retained-${randomUUID()}`);
      try{fd=fs.openSync(marker,'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST'){close();return null;}throw error;}
    }
    fs.writeFileSync(fd,String(process.pid));fs.fsyncSync(fd);let released=false;
    return ()=>{if(released)return;released=true;try{fs.closeSync(fd!);if(fs.readFileSync(marker,'utf8')===String(process.pid))fs.unlinkSync(marker);}finally{close();}};
  }catch(error){if(fd!==undefined)fs.closeSync(fd);close();if((error as {code?:string}).code==='SQLITE_BUSY')return null;throw error;}
}
