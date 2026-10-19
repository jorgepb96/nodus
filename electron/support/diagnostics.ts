import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { GRANULAR_MODEL_KEYS } from '../../shared/modelSettings';

type Finding={code:string;component:string;level:'error'|'warning'|'info';count?:number};
export function supportDatabaseFiles(profile:string):string[] {
  const registry=path.join(profile,'vaults.json');
  const vaults=fs.existsSync(registry)?JSON.parse(fs.readFileSync(registry,'utf8')).vaults:[];
  const files=[path.join(profile,'nodus.sqlite'),path.join(profile,'library/catalog.sqlite'),...(vaults??[]).map((v:{path:string})=>v.path)];
  return [...new Set(files)].filter(file=>fs.existsSync(file));
}
export function openSupportDatabase(profile:string,file:string,readonly=false):Database.Database {
  const root=fs.realpathSync(profile),canonical=fs.realpathSync(file);
  if(!canonical.startsWith(`${root}${path.sep}`))throw new Error('SUPPORT_WRITE_DENIED');
  for(const part of [file,`${file}-wal`,`${file}-shm`])if(fs.existsSync(part)&&(fs.lstatSync(part).isSymbolicLink()||fs.statSync(part).nlink>1))throw new Error('SUPPORT_WRITE_DENIED');
  const Constructor=createRequire(import.meta.url)('better-sqlite3') as typeof Database;
  return new Constructor(canonical,{readonly,fileMustExist:true});
}
const readPrefs=(profile:string):Record<string,unknown>=>{const file=path.join(profile,'app-prefs.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};};
function preserveJson(file:string,value:unknown):void {
  if(fs.existsSync(file))fs.renameSync(file,`${file}.support-before-${randomUUID()}`);
  fs.writeFileSync(file,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
}
export function configurationFindings(profile:string):Finding[] {
  let settings:Record<string,unknown>={};
  const registry=path.join(profile,'vaults.json');
  const vaults=fs.existsSync(registry)?JSON.parse(fs.readFileSync(registry,'utf8')):{vaults:[]};
  const file=vaults.vaults?.find((vault:{id:string})=>vault.id===vaults.activeVaultId)?.path??path.join(profile,'nodus.sqlite');
  if(fs.existsSync(file)) {
    const db=openSupportDatabase(profile,file,true);
    try{if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'").get()) {
      const row=db.prepare("SELECT value FROM settings WHERE key='app'").get() as {value:string}|undefined;
      if(row)settings=JSON.parse(row.value);
    }}finally{db.close();}
  }
  const prefs={...settings,...readPrefs(profile)},findings:Finding[]=[];
  if(!['synthesisModel',...GRANULAR_MODEL_KEYS].some(key=>prefs[key]))findings.push({code:'MODEL_NOT_SELECTED',component:'models',level:'warning'});
  if(prefs.autoBackupEnabled&&!prefs.autoBackupFolder)findings.push({code:'BACKUP_LOCATION_MISSING',component:'backup',level:'warning'});
  if(prefs.autoBackupFolder&&(!path.isAbsolute(String(prefs.autoBackupFolder))||!fs.existsSync(String(prefs.autoBackupFolder))))findings.push({code:'BACKUP_LOCATION_UNAVAILABLE',component:'backup',level:'error'});
  const locals=prefs.localProviders as Record<string,{baseUrl?:unknown}>|undefined;
  for(const name of ['ollama','lmstudio']) {
    if(!locals?.[name]?.baseUrl)continue;
    try{const url=new URL(String(locals[name].baseUrl));if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error();}
    catch{findings.push({code:'MODEL_ENDPOINT_INVALID',component:'models',level:'error'});}
  }
  if(typeof prefs.sttWhisperCppExecutable==='string'&&prefs.sttWhisperCppExecutable&&!fs.existsSync(prefs.sttWhisperCppExecutable))findings.push({code:'LOCAL_ENGINE_UNAVAILABLE',component:'models',level:'error'});
  return findings;
}
export function repairLocalEndpoints(profile:string):number {
  const prefs=readPrefs(profile),locals=prefs.localProviders as Record<string,{baseUrl?:unknown}>|undefined;let changed=0;
  for(const [name,url] of Object.entries({ollama:'http://127.0.0.1:11434',lmstudio:'http://127.0.0.1:1234'})) {
    const finding=locals?.[name];if(!finding)continue;
    try{const current=new URL(String(finding.baseUrl));if(!['http:','https:'].includes(current.protocol)||current.username||current.password)throw new Error();}
    catch{finding.baseUrl=url;changed++;}
  }
  if(changed)preserveJson(path.join(profile,'app-prefs.json'),prefs);return changed;
}
export function pauseCopiedSync(profile:string):void {
  const patch={syncMode:'manual',studySyncEnabled:false,autoResumeQueue:false,autoLightScan:false,autoDeepScanOnReadTag:false,documentIndexingEnabled:false};
  preserveJson(path.join(profile,'app-prefs.json'),{...readPrefs(profile),...patch});
  for(const file of supportDatabaseFiles(profile)) {
    if(file===path.join(profile,'library/catalog.sqlite'))continue;
    const db=openSupportDatabase(profile,file);
    try{if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'").get()) {
      const current=db.prepare("SELECT value FROM settings WHERE key='app'").get() as {value:string}|undefined;
      const settings=current?JSON.parse(current.value):{};
      db.prepare("INSERT INTO settings(key,value) VALUES('app',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({...settings,...patch}));
    }}
    finally{db.close();}
  }
}
export async function rebuildCopiedLibrary(profile:string):Promise<{items:number;invalidRecords:number}> {
  const prefs=readPrefs(profile);if(typeof prefs.autoBackupFolder!=='string')throw new Error('LIBRARY_UNAVAILABLE');
  const root=path.join(prefs.autoBackupFolder,'nodus-library');
  if(!fs.existsSync(root)||!fs.realpathSync(root).startsWith(`${fs.realpathSync(profile)}${path.sep}`))throw new Error('LIBRARY_UNAVAILABLE');
  const file=path.join(profile,'library/catalog.sqlite');
  for(const source of [file,`${file}-wal`,`${file}-shm`])if(fs.existsSync(source))fs.renameSync(source,`${source}.support-before-${randomUUID()}`);
  const [{LibraryCatalog},{LibraryDiskStore}]=await Promise.all([import('../library/libraryCatalog'),import('../library/libraryStorage')]);
  const catalog=new LibraryCatalog(file);
  try{const outcome=catalog.rebuild(new LibraryDiskStore(root,`support-${randomUUID()}`));return {items:outcome.items,invalidRecords:outcome.invalidRecords};}finally{catalog.close();}
}
export function recoverReadableTables(profile:string):{rows:number;tables:number;partial:true} {
  const Constructor=createRequire(import.meta.url)('better-sqlite3') as typeof Database;
  const recovery=path.join(profile,'support-recovered-tables');fs.mkdirSync(recovery,{recursive:true});let rows=0,tables=0;
  const quote=(value:string)=>`"${value.replaceAll('"','""')}"`;
  for(const [index,file]of supportDatabaseFiles(profile).entries()) {
    let source:Database.Database|null=null,target:Database.Database|null=null;
    try {
      source=openSupportDatabase(profile,file,true);source.defaultSafeIntegers(true);
      target=new Constructor(path.join(recovery,`${index}-${randomUUID()}.sqlite`));
      const names=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[];
      for(const {name}of names)try {
        const columns=source.prepare(`PRAGMA table_info(${quote(name)})`).all() as {name:string;type:string}[];
        if(!columns.length)continue;
        target.exec(`CREATE TABLE ${quote(name)}(${columns.map(c=>`${quote(c.name)} ${/^(INTEGER|REAL|TEXT|BLOB|NUMERIC)$/i.test(c.type)?c.type:'BLOB'}`).join(',')})`);
        const insert=target.prepare(`INSERT INTO ${quote(name)} VALUES(${columns.map(()=>'?').join(',')})`);
        for(const row of source.prepare(`SELECT ${columns.map(c=>quote(c.name)).join(',')} FROM ${quote(name)}`).raw().iterate() as Iterable<unknown[]>) {insert.run(...row);rows++;}
        tables++;
      }catch{/* Preserve any rows already recovered; partial recovery never replaces the vault. */}
      if(target.pragma('integrity_check',{simple:true})!=='ok')throw new Error('SQLITE_CORRUPT');
    }catch{/* A damaged source is preserved while other sources can still be recovered. */}
    finally{source?.close();target?.close();}
  }
  return {rows,tables,partial:true};
}
