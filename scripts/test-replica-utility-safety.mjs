import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fork } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import test from 'node:test';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
import { replicaUtilityHarness } from './lib/replicaUtilityHarness.mjs';

if (!requireElectronRuntime(path.resolve('scripts/test-replica-utility-safety.mjs'),'--electron-replica-safety')) process.exit(0);
const require=createRequire(import.meta.url);const Database=require('better-sqlite3');
const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'nodus-replica-safety-'));
const harness=await replicaUtilityHarness(directory);
process.env.NODUS_SERVER_REPLICA_WORKER_FILE=harness.worker;
installRuntimeHooks(directory,{utilityProcess:harness.utilityProcess});
const {importReplicaSnapshotInUtility,cancelReplicaImports}=require('../electron/serverSync/serverReplicaWorkerHost.ts');
test.after(async()=>{harness.cleanup();await fs.promises.rm(directory,{recursive:true,force:true});});
function database(t) {
  const db=new Database(path.join(directory,`${Math.random()}.sqlite`)); db.pragma('journal_mode=WAL');db.pragma('busy_timeout=5000');
  db.exec(`CREATE TABLE corpus(id TEXT PRIMARY KEY,title TEXT NOT NULL);CREATE TABLE server_outbox(id TEXT);
    INSERT INTO corpus VALUES('old','original');CREATE TRIGGER nodus_outbox_up_corpus AFTER INSERT ON corpus BEGIN INSERT INTO server_outbox VALUES(NEW.id);END;`);
  t.after(()=>{if(db.open) db.close();});return db;
}
const snapshot=rows=>({format:'nodus.server-snapshot',version:2,schemaVersion:1,revision:'revision',tables:{corpus:rows},assets:[]});

test('a 100,000-row snapshot imports in a separate process while the main event loop and WAL reads remain responsive',async t=>{
  const db=database(t);const bytes=Buffer.from(JSON.stringify(snapshot(Array.from({length:100000},(_,id)=>({id:String(id),title:`row ${id}`})))));
  let beats=0;let readable=0;
  const timer=setInterval(()=>{beats++;db.prepare('SELECT COUNT(*) FROM corpus').get();readable++;},5);
  try {
    const result=await importReplicaSnapshotInUtility(new Response(gzipSync(bytes)),db,1);
    assert.equal(result.revision,'revision');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM corpus').get().n,100000);
    assert.ok(beats>=5,`main process heartbeat ran ${beats} times`);assert.equal(readable,beats);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM server_outbox').get().n,0);
    assert.equal(db.pragma('busy_timeout',{simple:true}),5000);
    db.prepare('INSERT INTO corpus VALUES(?,?)').run('local','edit');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM server_outbox').get().n,1);
  } finally {clearInterval(timer);}
});

test('invalid schema, invalid tables, compressed bombs and constraint failures leave data and outbox triggers intact',async t=>{
  const db=database(t);
  const invalid=[{...snapshot([]),schemaVersion:999},{...snapshot([]),tables:{corpus:'invalid'}},snapshot([{id:'bad'}]),{tables:{corpus:[]}}];
  for(const value of invalid) await assert.rejects(()=>importReplicaSnapshotInUtility(new Response(JSON.stringify(value)),db,1));
  // >256 MiB expansion is rejected by zlib before JSON parse or any SQLite writes.
  const bomb=gzipSync(Buffer.alloc(256*1024*1024+1,32));
  await assert.rejects(()=>importReplicaSnapshotInUtility(new Response(bomb),db,1));
  assert.equal(db.prepare('SELECT title FROM corpus').get().title,'original');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n,1);
  assert.equal(db.pragma('busy_timeout',{simple:true}),5000);
});

test('cancelled and timed-out imports kill their worker and restore main connection settings',async t=>{
  const db=database(t);const stalled=path.join(directory,'stalled.cjs');fs.writeFileSync(stalled,"process.on('message',()=>{});setInterval(()=>{},1000);");
  process.env.NODUS_SERVER_REPLICA_WORKER_FILE=stalled;
  try {
    const pending=importReplicaSnapshotInUtility(new Response(JSON.stringify(snapshot([]))),db,1);
    setTimeout(()=>cancelReplicaImports(),100);
    await assert.rejects(()=>pending,/cancelado/);
    const original=globalThis.setTimeout;globalThis.setTimeout=(callback,delay,...args)=>original(callback,delay===120000?100:delay,...args);
    try {await assert.rejects(()=>importReplicaSnapshotInUtility(new Response(JSON.stringify(snapshot([]))),db,1),/plazo máximo/);} finally {globalThis.setTimeout=original;}
    assert.equal(db.prepare('SELECT title FROM corpus').get().title,'original');assert.equal(db.pragma('busy_timeout',{simple:true}),5000);
  } finally {process.env.NODUS_SERVER_REPLICA_WORKER_FILE=harness.worker;}
});

test('killing a process inside the suppression transaction rolls back rows and trigger removal together',async t=>{
  const db=database(t);const fixture=path.join(directory,'crash.cjs');
  await build({stdin:{contents:`import Database from 'better-sqlite3';import {withOutboxSuppressed} from './electron/serverSync/outboxSuppression';
    const db=new Database(process.argv[2]);withOutboxSuppressed(db,()=>{db.exec("DELETE FROM corpus;INSERT INTO corpus VALUES('new','uncommitted')");process.send('transaction-open');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);});`,resolveDir:process.cwd(),loader:'ts'},outfile:fixture,bundle:true,platform:'node',format:'cjs',external:['better-sqlite3']});
  const child=fork(fixture,[db.name],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:path.resolve('node_modules')},stdio:['ignore','ignore','pipe','ipc']});
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('fixture did not begin transaction'));},5000);child.once('message',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});
  const {beginReplicaImportWait}=require('../electron/db/replicaImportWait.ts');
  const finishWait=beginReplicaImportWait(db.name,[db]);t.after(finishWait);
  const openedLater=new Database(db.name);t.after(()=>openedLater.close());
  const runtime=require('../electron/db/database.ts');
  runtime.withDatabaseContext(openedLater,()=>runtime.getDb());
  assert.equal(openedLater.pragma('busy_timeout',{simple:true}),50,'new UI connections also adopt the bounded wait');
  const started=Date.now();assert.throws(()=>openedLater.prepare("INSERT INTO corpus VALUES('during','blocked')").run(),/locked/);
  assert.ok(Date.now()-started<500,'main writes cannot wait five seconds for the import worker');
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
  finishWait();assert.equal(openedLater.pragma('busy_timeout',{simple:true}),5000);
  assert.equal(db.prepare('SELECT title FROM corpus').get().title,'original');
  db.prepare('INSERT INTO corpus VALUES(?,?)').run('local','retained');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM server_outbox').get().n,1);
});

test('absence of a utility worker fails visibly without synchronous fallback',async t=>{
  const db=database(t);process.env.NODUS_SERVER_REPLICA_WORKER_FILE=path.join(directory,'missing');
  try {await assert.rejects(()=>importReplicaSnapshotInUtility(new Response(JSON.stringify(snapshot([]))),db,1),/no está disponible/);assert.equal(db.prepare('SELECT title FROM corpus').get().title,'original');}
  finally {process.env.NODUS_SERVER_REPLICA_WORKER_FILE=harness.worker;}
});
