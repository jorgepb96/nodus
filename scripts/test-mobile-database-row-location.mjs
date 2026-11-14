import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-database-row-location'))process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-row-location-'));
const runtime=installRuntimeHooks(directory);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;let database,calls=0;
globalThis.fetch=async()=>{calls++;throw new Error('Following a relation must not invoke a provider');};
try {
  database=require('../electron/db/database.ts');database.getDb();
  const vaults=require('../electron/vaults/vaultRegistry.ts'),vault=vaults.createVault('Filas móviles aisladas','databases'),other=vaults.createVault('Otras filas aisladas','databases');
  const repo=require('../electron/db/databasesRepo.ts'),read=require('../electron/desktopBridge/databaseRowLocation.ts');
  let rowId;
  await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,async()=>{
    const parent=repo.createDatabase('Base vinculada'),row=repo.createRow(parent.id);rowId=row.id;
    const before=database.getDb().prepare('SELECT total_changes() AS count').get().count;
    const pageId=database.getDb().prepare("SELECT id FROM pages WHERE row_id=? AND state='active'").get(rowId).id;
    assert.deepEqual(read.mobileDatabaseRowLocation(vault.id,rowId),{version:1,vaultId:vault.id,rowId,databaseId:parent.id,pageId});
    assert.equal(database.getDb().prepare('SELECT total_changes() AS count').get().count,before,'The locator must not hydrate rows or materialise formulas');
    for(const value of ['',null,{},'x'.repeat(1025)])assert.throws(()=>read.mobileDatabaseRowLocation(vault.id,value),/invalid_arguments/);
    assert.throws(()=>read.mobileDatabaseRowLocation(vault.id,parent.id),/record_not_found/,'A database identity is not a row identity');
  }));
  await vaults.withOwningVault(other.id,()=>database.withVaultDatabase(other.id,async()=>assert.throws(()=>read.mobileDatabaseRowLocation(other.id,rowId),/record_not_found/)));
  await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,async()=>{
    database.getDb().prepare('DELETE FROM db_rows WHERE id=?').run(rowId);
    assert.throws(()=>read.mobileDatabaseRowLocation(vault.id,rowId),/record_not_found/);
  }));
  assert.equal(calls,0);console.log('Actual relation row locator, owning database, no writes/providers and vault isolation: PASS');
} finally {globalThis.fetch=originalFetch;database?.closeDb();runtime.restore();fs.rmSync(directory,{recursive:true,force:true});}
