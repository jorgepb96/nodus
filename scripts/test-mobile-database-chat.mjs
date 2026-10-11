import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-database-chat'))process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-database-chat-'));
const runtime=installRuntimeHooks(directory);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Capturing/composing a chat source must never use a provider');};
let db;
try {
  db=require('../electron/db/database.ts');db.getDb();
  const vaults=require('../electron/vaults/vaultRegistry.ts'),vault=vaults.createVault('Chat de datos aislado','databases');
  const repo=require('../electron/db/databasesRepo.ts'),native=require('../electron/ai/databaseChat.ts'),api=require('../electron/desktopBridge/databaseResearchPublication.ts');
  const portable=require('../shared/companionChatContext.ts'),prompts=require('../shared/databaseChat.ts'),history=require('../electron/desktopBridge/chatHistory.ts');
  await vaults.withOwningVault(vault.id,()=>db.withVaultDatabase(vault.id,async()=>{
    const source=repo.createDatabase('Métrica completa'),column=repo.createColumn(source.id,'Valor','number');
    for(let i=0;i<650;i++){const row=repo.createRow(source.id);repo.setCell(row.id,column.id,String(i+1));}
    const pack=api.mobileDatabaseResearchSourcePack({databaseIds:[source.id]});
    assert.equal(pack.databases[0].chat.profile.rowCount,650);assert.equal(pack.databases[0].chat.sample.length,10);
    const prior=[{role:'user',content:'Cuántos hay?'},{role:'assistant',content:'650 registros.'}];
    for(const language of ['es','en','fr','de','pt','pt-BR','it','tr','zh-Hans','zh-Hant','vi','ja','ru','uk','ko']) {
      const expected=native.buildDatabaseChatContext([source.id],language),result=portable.prepareDatabaseChat({vaultId:vault.id,packs:[pack],databaseIds:[source.id],question:'Cuál es la media?',history:prior,language});
      assert.equal(result.system,prompts.databaseChatSystem(language));
      assert.equal(result.user,prompts.buildDbChatUser(expected.context,'Cuál es la media?',prior,language));
      assert.deepEqual(result.names,expected.names);
    }
    const input={vaultId:vault.id,packs:[pack],databaseIds:[source.id],question:'Recuento',history:[],language:'es'};
    assert.throws(()=>portable.prepareDatabaseChat({...input,vaultId:randomUUID()}),/vault_mismatch/);
    assert.throws(()=>portable.prepareDatabaseChat({...input,databaseIds:[source.id,source.id]}),/invalid_database_chat/);
    const altered=structuredClone(pack);altered.databases[0].chat.profile.rowCount=10;
    assert.throws(()=>portable.prepareDatabaseChat({...input,packs:[altered]}),/source_pack/);
    const old=structuredClone(pack);delete old.databases[0].chat;
    const core=require('../shared/databaseResearchEngine.ts'),packs=require('../shared/mobileDatabaseResearch.ts');
    const newer=structuredClone(pack),older=structuredClone(pack);
    newer.capturedAt='2026-10-10T12:00:00.000Z';older.capturedAt='2026-10-09T12:00:00.000Z';
    newer.databases[0].database.name=newer.databases[0].chat.name='Newest selected capture';older.databases[0].database.name=older.databases[0].chat.name='Older selected capture';
    newer.id=core.sha256Snapshot(packs.databaseSourcePackPayload(newer));older.id=core.sha256Snapshot(packs.databaseSourcePackPayload(older));
    assert.deepEqual(portable.prepareDatabaseChat({...input,packs:[newer,older]}),portable.prepareDatabaseChat({...input,packs:[older,newer]}),'Overlapping selected copies always retain the newest full profile');
    assert(portable.prepareDatabaseChat({...input,packs:[newer,older]}).user.includes('Newest selected capture'));
    old.id=core.sha256Snapshot(packs.databaseSourcePackPayload(old));
    assert.throws(()=>portable.prepareDatabaseChat({...input,packs:[old]}),/perfil completo/);
    const id=randomUUID(),edit={version:1,id:randomUUID(),conversationId:id,expectedRevision:null,action:'save',draft:{title:'Chat móvil numérico',archived:false,messages:[{role:'user',content:'Métrica completa'}],databaseIds:[source.id]},companion:null};
    const saved=await history.saveMobileChat(vault.id,randomUUID(),'database',edit,['corpus','writing']);
    assert.deepEqual(saved.snapshot.data.databaseIds,[source.id]);
    await assert.rejects(history.saveMobileChat(vault.id,randomUUID(),'database',{...edit,id:randomUUID(),conversationId:randomUUID(),draft:{...edit.draft,databaseIds:[randomUUID()]}},['corpus','writing']),error=>error.code==='invalid_chat_database_selection');
  }));
  console.log('650-row immutable profiles, identical Desktop/device context in 15 languages, signed source identity and genuine private chat selection passed. Device/native acceptance remains separate.');
} finally {
  globalThis.fetch=originalFetch;db?.closeDb();runtime.restore();fs.rmSync(directory,{recursive:true,force:true});
}
