import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-database-mutations'))process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-database-write-'));
const runtime=installRuntimeHooks(directory);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),fetch=globalThis.fetch;let database,calls=0;
globalThis.fetch=async()=>{calls++;throw new Error('A content edit cannot start a provider');};
try{
  database=require('../electron/db/database.ts');database.getDb();const vaults=require('../electron/vaults/vaultRegistry.ts'),vault=vaults.createVault('Escritura móvil aislada','databases');
  const {applyBridgeMutations}=require('../electron/desktopBridge/mutations.ts'),repo=require('../electron/db/databasesRepo.ts');
  await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,async()=>{
    const db=database.getDb(),databaseId=`db_${randomUUID()}`,columnId=`dcol_${randomUUID()}`,rowId=`drow_${randomUUID()}`;
    const mutation=(table,key,row)=>({id:randomUUID(),kind:'upsert',table,key,row,assets:[],createdAt:new Date().toISOString()});
    const creates=[mutation('db_databases',[databaseId],{id:databaseId,name:'Desde el móvil',icon:'tablecells'}),mutation('db_columns',[columnId],{id:columnId,database_id:databaseId,name:'Nombre',type:'title',config_json:'{}'}),mutation('db_rows',[rowId],{id:rowId,database_id:databaseId})];
    const first=await applyBridgeMutations(vault.id,'grant',creates);assert.deepEqual(first.applied,creates.map(item=>item.id));assert.equal(first.rejected.length,0);
    assert.equal(repo.getRow(rowId).databaseId,databaseId);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM db_data_sources WHERE database_id=?').get(databaseId).n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM page_documents WHERE page_id=?').get(`row:${rowId}`).n,1,'Canonical row creation must retain its universal page');
    const cell=(value,revision,expected)=>mutation('db_cells',[rowId,columnId],{row_id:rowId,column_id:columnId,database_id:databaseId,value_text:value,_mobileExpectedRevision:revision,_mobileExpectedValue:expected});
    const edit=cell('Título móvil',0,''),written=await applyBridgeMutations(vault.id,'grant',[edit]);assert.deepEqual(written.applied,[edit.id]);assert.equal(repo.getRow(rowId).cells[columnId],'Título móvil');
    const actual=db.prepare('SELECT revision,value_text FROM db_cells WHERE row_id=? AND column_id=?').get(rowId,columnId);
    const document=db.prepare('SELECT title FROM pages WHERE row_id=?').get(rowId);assert.equal(document.title,'Título móvil','Title writes must reach the actual linked page');
    const duplicate=await applyBridgeMutations(vault.id,'grant',[edit]);assert.deepEqual(duplicate.duplicate,[edit.id]);assert.deepEqual(db.prepare('SELECT revision,value_text FROM db_cells WHERE row_id=? AND column_id=?').get(rowId,columnId),actual);
    repo.setCell(rowId,columnId,'Edición posterior del Mac');
    const rejected=await applyBridgeMutations(vault.id,'grant',[cell('Sobrescritura',actual.revision,'Título móvil')]);assert.equal(rejected.rejected[0].reason,'database_cell_revision_conflict');assert(rejected.rejected[0].error_description);assert.equal(repo.getRow(rowId).cells[columnId],'Edición posterior del Mac');
    const revision=db.prepare('SELECT revision FROM db_cells WHERE row_id=? AND column_id=?').get(rowId,columnId).revision;
    // A later queued phone edit cannot overwrite a foreign edit merely because
    // its guessed revision coincides with the foreign revision.
    assert.equal((await applyBridgeMutations(vault.id,'grant',[cell('Otra sobrescritura',revision,'Título móvil')])).rejected[0].reason,'database_cell_revision_conflict');
    const clear=await applyBridgeMutations(vault.id,'grant',[cell('',revision,'Edición posterior del Mac')]);assert.equal(clear.rejected.length,0);assert.equal(db.prepare('SELECT 1 FROM db_cells WHERE row_id=? AND column_id=?').get(rowId,columnId),undefined);
    assert.equal((await applyBridgeMutations(vault.id,'grant',[mutation('db_columns',[`dcol_${randomUUID()}`],{id:'mismatched',database_id:databaseId,type:'formula',name:'No',config_json:'{}'})])).rejected.length,1);
    assert.equal((await applyBridgeMutations(vault.id,'grant',[mutation('automation_rules',['rule'],{id:'rule'})])).rejected[0].reason,'table_not_writable');
  }));
  assert.equal(calls,0);console.log('Canonical database, column and row creation, page title hooks, durable duplicate receipts, typed cell clearing and revision/value conflicts: PASS');
}finally{globalThis.fetch=fetch;database?.closeDb();runtime.restore();fs.rmSync(directory,{recursive:true,force:true});}
