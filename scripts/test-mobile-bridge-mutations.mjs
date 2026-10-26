import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks, requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-mobile-mutation-receipts')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-mobile-mutation-receipts-'));
const runtime = installRuntimeHooks(root); runtime.app.on = () => {}; runtime.app.once = () => {};
const require = createRequire(import.meta.url);
let database;
try {
  database = require('../electron/db/database.ts');
  const {getActiveVault, createVault, setActiveVault} = require('../electron/vaults/vaultRegistry.ts');
  const {applyBridgeMutations} = require('../electron/desktopBridge/mutations.ts');
  const first = getActiveVault(), second = createVault('Otra bóveda ficticia');
  const note = (id, title = 'Edición móvil') => ({id, clientId:'fixture-phone', kind:'upsert', table:'notes', key:[id],
    row:{id,title,content:'Contenido íntegro',created_at:'2026-10-08T10:00:00.000Z',updated_at:'2026-10-08T10:00:00.000Z'},
    assets:[],schemaVersion:database.SCHEMA_VERSION,createdAt:'2026-10-08T10:00:00.000Z'});
  const read = (vault, work) => database.withVaultDatabase(vault.id, () => work(database.getDb()));
  const mutation = note('one');
  const saved = await applyBridgeMutations(first.id, 'grant-phone', [mutation]);
  assert.deepEqual(saved,{accepted:['one'],duplicate:[],rejected:[],applied:['one'],cursor:null});
  assert.equal(await read(first, db => db.prepare('SELECT title FROM notes WHERE id=?').get('one').title),'Edición móvil');
  assert.equal(await read(second, db => db.prepare('SELECT COUNT(*) n FROM notes').get().n),0,'A different active vault must not receive the edit');
  const receiptTime = await read(first,db => db.prepare('SELECT applied_at FROM desktop_bridge_receipts').get().applied_at);
  const replay = await applyBridgeMutations(first.id,'grant-phone',[{...mutation,row:Object.fromEntries(Object.entries(mutation.row).reverse())}]);
  assert.deepEqual(replay,{accepted:[],duplicate:['one'],rejected:[],applied:['one'],cursor:null});
  assert.equal(await read(first,db => db.prepare('SELECT applied_at FROM desktop_bridge_receipts').get().applied_at),receiptTime,'A retry must preserve the original committed receipt');
  const conflict = await applyBridgeMutations(first.id,'grant-phone',[note('one','Contenido diferente')]);
  assert.deepEqual(conflict,{accepted:[],duplicate:[],rejected:[{id:'one',reason:'idempotency_conflict'}],applied:[],cursor:null});
  assert.equal(await read(first,db => db.prepare('SELECT title FROM notes WHERE id=?').get('one').title),'Edición móvil');
  const mixed = await applyBridgeMutations(first.id,'grant-phone',[
    note('two'),{...note('tool'),table:'settings'}, {...note('private'),table:'teaching_students'},
    {...note('asset'),assets:[{hash:'f'.repeat(64)}]}, {...note('bad'),row:{id:'bad',unknown_column:'Refused'}},
  ]);
  assert.deepEqual(mixed.accepted,['two']); assert.deepEqual(mixed.applied,['two']); assert.equal(mixed.rejected.length,4);
  assert.equal(await read(first,db => db.prepare('SELECT COUNT(*) n FROM desktop_bridge_receipts').get().n),2,'Refused edits must never gain an application receipt');
  assert.equal(await read(first,db => db.prepare('SELECT COUNT(*) n FROM notes').get().n),2,'Only the two valid edits may exist');
  const deleted = {...note('delete-one'),kind:'delete',key:['one'],row:undefined};
  assert.deepEqual((await applyBridgeMutations(first.id,'grant-phone',[deleted])).applied,['delete-one']);
  assert.equal(await read(first,db => db.prepare('SELECT COUNT(*) n FROM notes WHERE id=?').get('one').n),0);
  database.closeDb(); setActiveVault(second.id);
  assert.deepEqual((await applyBridgeMutations(first.id,'grant-phone',[deleted])).duplicate,['delete-one'],'A reopened vault retains idempotency receipts');
  assert.deepEqual((await applyBridgeMutations(second.id,'grant-phone',[mutation])).accepted,['one'],'Vault identity scopes receipt IDs');
  console.log(JSON.stringify({passed:true,isolatedVaults:2,canonicalWriteConfirmed:true,retryDoesNotDuplicate:true,hashConflictRefused:true,
    invalidAndPrivateTablesRefused:4,deleteConfirmed:true,reopenedReceipts:true,providerCalls:0,releaseApproved:false}));
} finally {
  try {database?.closeDb();} catch {}
  fs.rmSync(root,{recursive:true,force:true});
}
