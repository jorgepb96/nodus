// Narrow support entry. Normal app, IPC, providers and plugins never initialize here.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertIsolatedProductionSeparation, isolatedPath, validateIsolatedRoot } from '../qa/isolatedProfile';
import { SUPPORT_ACTIONS, DIAGNOSTIC_ACTIONS } from '../../shared/support/catalog.mjs';
import { isolateSupportApplication } from './isolation';
import { configurationFindings, openSupportDatabase, pauseCopiedSync, rebuildCopiedLibrary, recoverReadableTables, repairLocalEndpoints, supportDatabaseFiles } from './diagnostics';

export async function runSupportProbe():Promise<void> {
  const requested=process.env.NODUS_ISOLATED_ROOT;if(!requested)throw new Error('An isolated root is required');
  const root=validateIsolatedRoot(requested);assertIsolatedProductionSeparation(root,app.getPath('appData'),app.getPath('home'),process.platform);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'support-session.json'),'utf8')),action=process.env.NODUS_SUPPORT_ACTION??'';
  if(manifest.protocol!==1||manifest.root!==root||manifest.network!==false||![...SUPPORT_ACTIONS,'restore-archive'].includes(action))throw new Error('Invalid support protocol');
  const profile=isolatedPath(root,'profile');
  app.setName('Nodus');app.setPath('userData',profile);app.setPath('sessionData',isolatedPath(root,'sessions'));app.setPath('temp',isolatedPath(root,'tmp'));app.setPath('crashDumps',isolatedPath(root,'crashes'));app.setAppLogsPath(isolatedPath(root,'logs'));
  process.env.NODUS_QA_ROOT=root;process.env.NODUS_QA_DATABASE_AUDIT_LOG=path.join(profile,'database-access.jsonl');process.env.NODUS_USERDATA=profile;
  process.env.TMPDIR=app.getPath('temp');process.env.TMP=app.getPath('temp');process.env.TEMP=app.getPath('temp');app.setPath('appData',isolatedPath(root,'app-data'));
  process.env.NODUS_HARNESS_KEYS_FILE=path.join(root,'no-provider-keys.json');process.env.NODUS_QA_DEFER_CREDENTIAL_STATUS='1';process.env.NODUS_BACKUP_UTILITY_INLINE='1';
  isolateSupportApplication(root);
  if(action==='software-graphics')app.disableHardwareAcceleration();
  const result=(ok:boolean,code:string,extra:Record<string,unknown>={})=>process.stdout.write(`\n@@NODUS_SUPPORT@@${JSON.stringify({protocol:1,root,ok,code,diagnostic:DIAGNOSTIC_ACTIONS.includes(action),...extra})}\n`);
  await app.whenReady();
  try {
    if(action==='restore-archive'||action==='archive-roundtrip') {
      let password:string=randomUUID();
      if(action==='restore-archive') {
        let input='';for await(const chunk of process.stdin){input+=chunk.toString();if(input.length>8192)throw new Error('Input too large');}
        password=JSON.parse(input).password;input='';if(typeof password!=='string'||!password)throw new Error('A password is required');
      }
      const prefsFile=path.join(profile,'app-prefs.json');
      if(fs.existsSync(prefsFile))fs.renameSync(prefsFile,`${prefsFile}.support-before-${randomUUID()}`);
      fs.writeFileSync(prefsFile,JSON.stringify({autoBackupFolder:path.join(profile,'recovered-library'),recoverySetupVersion:1,autoBackupEnabled:false,backupCleanupEnabled:false}),{flag:'wx',mode:0o600});
      const {restoreBackupArchiveFile,createBackupArchiveFile}=await import('../export/exportImport');
      const archive=path.join(root,action==='restore-archive'?'recovery.nodus':'synthetic-roundtrip.nodus');
      if(action==='archive-roundtrip') {
        const {getDb,closeDb}=await import('../db/database');const db=getDb();
        db.exec("CREATE TABLE support_roundtrip(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO support_roundtrip(value) VALUES('synthetic recovery check')");
        await createBackupArchiveFile({password,appVersion:app.getVersion()},archive);closeDb();
        // Restore into a genuinely empty profile. The old sample remains available.
        fs.renameSync(profile,path.join(root,'profile-before-roundtrip'));
        fs.mkdirSync(profile,{mode:0o700});
        fs.writeFileSync(prefsFile,JSON.stringify({autoBackupFolder:path.join(profile,'recovered-library'),recoverySetupVersion:1,autoBackupEnabled:false,backupCleanupEnabled:false}),{flag:'wx',mode:0o600});
      }
      const restored=await restoreBackupArchiveFile(archive,password);password='';
      let verified=restored.ok;
      if(verified&&action==='archive-roundtrip') {
        const {getDb,closeDb}=await import('../db/database');verified=Boolean(getDb().prepare("SELECT 1 FROM support_roundtrip WHERE value='synthetic recovery check'").get());closeDb();
      }
      result(verified,verified?'ARCHIVE_RECOVERED':'ARCHIVE_RECOVERY_FAILED',{diagnostic:action==='archive-roundtrip'});app.quit();return;
    }
    if(['configuration-check','model-check'].includes(action)) {result(true,'CONFIGURATION_CHECKED',{findings:configurationFindings(profile)});app.quit();return;}
    if(action==='repair-local-endpoints') {const changed=repairLocalEndpoints(profile);result(changed>0,changed?'MODEL_ENDPOINT_REPAIRED':'NO_KNOWN_REPAIR');app.quit();return;}
    if(action==='pause-sync') {pauseCopiedSync(profile);result(true,'COPIED_SYNC_PAUSED');app.quit();return;}
    if(action==='recover-database') {const recovered=recoverReadableTables(profile);result(recovered.rows>0,'PARTIAL_RECOVERY',{...recovered,diagnostic:true});app.quit();return;}
    if(action==='rebuild-library') {const rebuilt=await rebuildCopiedLibrary(profile);result(rebuilt.invalidRecords===0,rebuilt.invalidRecords?'LIBRARY_PARTIAL':'LIBRARY_REBUILT',{...rebuilt,partial:rebuilt.invalidRecords>0});app.quit();return;}
    if(['database-check','library-check','copy-profile','disable-plugins','software-graphics'].includes(action)) {
      const {SCHEMA_VERSION}=await import('../db/migrations');
      let checked=0;const findings=[];
      for(const file of supportDatabaseFiles(profile)) {
        const db=openSupportDatabase(profile,file);
        try{
          if(file!==path.join(profile,'library/catalog.sqlite')&&Number(db.pragma('user_version',{simple:true}))>SCHEMA_VERSION){result(false,'SUPPORT_SCHEMA_NEWER',{checked});app.quit();return;}
          if(db.pragma('integrity_check',{simple:true})!=='ok'){result(false,'SQLITE_CORRUPT',{checked});app.quit();return;}checked++;
        }
        finally{db.close();}
      }
      if(action==='library-check') {
        const file=path.join(profile,'app-prefs.json'),prefs=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
        const library=typeof prefs.autoBackupFolder==='string'?path.join(prefs.autoBackupFolder,'nodus-library'):null;
        if(!library||!fs.existsSync(library))findings.push({code:'LIBRARY_UNAVAILABLE',component:'library',level:'warning'});
      }
      if(action==='disable-plugins') {const plugins=path.join(profile,'plugins');if(fs.existsSync(plugins))fs.renameSync(plugins,`${plugins}.support-retained-${randomUUID()}`);}
      if(['database-check','library-check'].includes(action)){result(checked>0,checked?'DATABASES_CHECKED':'DATABASES_NOT_FOUND',{checked,findings});app.quit();return;}
    }
    const window=new BrowserWindow({width:720,height:480,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><canvas id="test"></canvas>'));
    await window.webContents.executeJavaScript('document.querySelector("canvas").getContext("2d").fillRect(0,0,10,10); true');
    result(true,'RUNTIME_CHECKED',{scope:'runtime-and-storage',softwareGraphics:action==='software-graphics'});window.destroy();app.quit();
  } catch(error) {
    const code=typeof(error as {code?:unknown}).code==='string'?(error as {code:string}).code:'TEST_FAILED';result(false,code);app.quit();
  }
}
