// Builds disposable, real Nodus/SQLite fixtures. Never used by the installed application.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { installRuntimeHooks,repoRoot } from './lib/tsRuntimeHooks.mjs';
if(process.argv[3]==='--check-wal') {
  const require=createRequire(import.meta.url),Database=require('better-sqlite3');
  const profile=fs.realpathSync(process.argv[2]),registry=JSON.parse(fs.readFileSync(path.join(profile,'vaults.json'),'utf8'));
  for(const vault of registry.vaults) {
    if(!fs.realpathSync(vault.path).startsWith(profile+path.sep))throw new Error('Fixture verification must stay in a copied profile');
    const db=new Database(vault.path,{readonly:true,fileMustExist:true});
    try{if(db.prepare('SELECT COUNT(*) AS n FROM support_fixture').get().n!==2)throw new Error('Committed WAL row was not recovered');}finally{db.close();}
  }
  console.log('Both original and WAL-committed rows are present in the copied vault.');process.exit(0);
}
const root=fs.realpathSync(process.argv[2]),profile=path.join(root,'original');fs.mkdirSync(profile,{recursive:true});
installRuntimeHooks(profile);const require=createRequire(import.meta.url);
const {getDb,closeDb}=require(path.join(repoRoot,'electron/db/database.ts'));
const db=getDb();db.exec('CREATE TABLE support_fixture(id INTEGER PRIMARY KEY, note TEXT, binary BLOB)');db.prepare('INSERT INTO support_fixture(note,binary) VALUES(?,?)').run('Alice private recent work',Buffer.from([0,1,127,255]));
db.prepare("INSERT INTO settings(key,value) VALUES('app',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({syncMode:'auto',documentIndexingEnabled:true}));closeDb();
const {LibraryDiskStore}=require(path.join(repoRoot,'electron/library/libraryStorage.ts'));
const library=path.join(root,'external-library','nodus-library'),store=new LibraryDiskStore(library,'support-fixture');store.initialize();
store.upsertItem({id:'local:SUPPORTPDF',storageId:'SUPPORTPDF',source:'nodus',sourceLibraryId:null,sourceKey:null,metadata:{title:'Private sample',itemType:'document',creators:[],isbn:[],issn:[],tags:[]},collectionIds:[],attachments:[],files:{annotations:'annotations.json'},extraction:{status:'pending'}});
fs.writeFileSync(path.join(store.itemFolder('SUPPORTPDF'),'private-source.pdf'),'%PDF-1.4 private original');
fs.writeFileSync(path.join(profile,'app-prefs.json'),JSON.stringify({uiLanguage:'en',autoBackupFolder:path.dirname(library),libraryGlobalEnabled:true,localProviders:{ollama:{baseUrl:'not a URL'}}}));
fs.mkdirSync(path.join(profile,'plugins'),{recursive:true});fs.writeFileSync(path.join(profile,'plugins/private-plugin.txt'),'preserve plugin');
const Database=require('better-sqlite3'),source=new Database(path.join(profile,'nodus.sqlite'));
source.pragma('journal_mode = WAL');source.pragma('wal_autocheckpoint = 0');source.prepare('INSERT INTO support_fixture(note) VALUES(?)').run('committed pending WAL row');
const external=path.join(root,'external-vault/vault.sqlite');fs.mkdirSync(path.dirname(external));
for(const suffix of ['','-wal','-shm'])if(fs.existsSync(`${source.name}${suffix}`))fs.copyFileSync(`${source.name}${suffix}`,`${external}${suffix}`);
source.close();
fs.writeFileSync(path.join(profile,'vaults.json'),JSON.stringify({formatVersion:1,activeVaultId:'external',vaults:[{id:'external',name:'Private vault',path:external,legacy:false,type:'research',origin:'local',createdAt:new Date().toISOString(),lastOpenedAt:new Date().toISOString()}]}));
console.log('Synthetic Nodus fixture prepared, including a committed SQLite WAL.');
