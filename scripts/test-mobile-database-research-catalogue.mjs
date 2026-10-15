import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-database-research-catalogue')) process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-data-research-catalogue-'));
const runtime=installRuntimeHooks(directory); runtime.app.on=()=>{}; runtime.app.once=()=>{};
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Report catalogue must not invoke a provider');};
let database;
try {
  database=require('../electron/db/database.ts'); const db=database.getDb();
  const {getActiveVault,createVault}=require('../electron/vaults/vaultRegistry.ts');
  const first=getActiveVault(),other=createVault('Bóveda aislada');
  const {mobileDatabaseResearchCatalogue}=require('../electron/desktopBridge/databaseResearchCatalogue.ts');
  const {loadMobileDatabaseResearchReports}=require('../src/mobileWeb/databaseResearchCatalogue.ts');
  const stamp='2026-10-11T00:00:00Z';
  db.prepare('INSERT INTO db_databases(id,short_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run('database','DB-37','Datos',stamp,stamp);
  const run=db.prepare('INSERT INTO database_research_runs(id,database_id,objective,status,created_at,updated_at) VALUES(?,?,?,?,?,?)');
  const report=db.prepare('INSERT INTO database_research_reports(id,run_id,title,markdown,summary,metadata_json,quality_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  for (let index=0;index<241;index++) {
    run.run(`run-${index}`,'database','Pregunta verificable','completed',stamp,stamp);
    report.run(`report-${index}`,`run-${index}`,`Informe ${index}`,index===240 ? 'Texto íntegro 37 '.repeat(100000) : 'Texto guardado','Resumen verificable','{"costUsd":0.37}','{"status":"verified"}',stamp,stamp);
  }
  const scoped=input=>database.withVaultDatabase(first.id,()=>mobileDatabaseResearchCatalogue(input));
  const page=await scoped({limit:100,offset:0}); assert.equal(page.total,241); assert.equal(page.items.length,100); assert.equal(page.hasMore,true);
  assert.equal(JSON.stringify(page).includes('Texto íntegro'),false); assert.equal(JSON.stringify(page).includes('markdown'),false);
  const all=await loadMobileDatabaseResearchReports(async(method,input)=>{assert.equal(method,'listMobileDatabaseDeepResearchReports');return scoped(input);});
  assert.equal(all.length,241); assert.equal(new Set(all.map(row=>row.id)).size,241); assert.ok(all.some(row=>row.id==='report-240')); assert.equal(all[0].costUsd,0.37);
  assert.equal((await database.withVaultDatabase(other.id,()=>mobileDatabaseResearchCatalogue())).total,0);
  await assert.rejects(loadMobileDatabaseResearchReports(async(_method,input)=>{
    const value=await scoped(input); if (input.offset) value.revision='0'.repeat(64); return value;
  }),/cambió/);
  db.prepare('UPDATE database_research_reports SET read_at=?,updated_at=? WHERE id=?').run(stamp,'2026-10-11T01:00:00Z','report-240');
  assert.notEqual((await scoped({limit:100})).revision,page.revision);
  console.log('Data research metadata, 241 report pagination, literal isolation, revisions and foreign vault contracts passed.');
} finally {
  globalThis.fetch=originalFetch; database?.closeDb(); runtime.restore(); fs.rmSync(directory,{recursive:true,force:true});
}
