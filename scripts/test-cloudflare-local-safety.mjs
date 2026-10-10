// Local workerd + SQLite D1 + filesystem R2. Outbound Worker fetches are forbidden.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { webcrypto, createHash } from 'node:crypto';
import { build } from 'esbuild';
import test from 'node:test';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
import { replicaUtilityHarness } from './lib/replicaUtilityHarness.mjs';
import { reserveBudget, DEFAULT_SYNC_BUDGET } from '../cloudflare/src/budget.mjs';
import { cleanupPublications, putSmallObject } from '../cloudflare/src/publications.mjs';
import { drainObjectQueue, stageObject } from '../cloudflare/src/objectLifecycle.mjs';
import { ackMutations, getMutations, cleanupSync } from '../cloudflare/src/sync.mjs';
import { cleanupBlobUploads } from '../cloudflare/src/binaries.mjs';
import worker from '../cloudflare/src/worker.mjs';

if (!requireElectronRuntime(path.resolve('scripts/test-cloudflare-local-safety.mjs'),'--electron-cloudflare-local')) process.exit(0);
if (!globalThis.crypto) globalThis.crypto=webcrypto;
const require=createRequire(import.meta.url);
const {Miniflare}=require('miniflare');
// Each suite owns its bundle: npm test may run the release-contract bundler in parallel.
const bundleDirectory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'nodus-cf-local-bundle-'));
const bundleFile=path.join(bundleDirectory,'worker.mjs');
await build({entryPoints:[path.resolve('cloudflare/src/worker.mjs')],outfile:bundleFile,bundle:true,platform:'browser',format:'esm',target:'es2022'});
test.after(()=>fs.promises.rm(bundleDirectory,{recursive:true,force:true}));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

async function localCloud(t,bindings={}) {
  const mf=new Miniflare({rootPath:bundleDirectory,modulesRoot:bundleDirectory,modules:true,scriptPath:bundleFile,compatibilityDate:'2026-07-01',
    d1Databases:{DB:'local-test'},r2Buckets:['OBJECTS'],bindings, outboundService:()=>{throw new Error('External network is forbidden in Cloudflare safety tests');}});
  t.after(()=>mf.dispose());
  const DB=await mf.getD1Database('DB'); const OBJECTS=await mf.getR2Bucket('OBJECTS');
  for(const name of fs.readdirSync('cloudflare/migrations').sort()) {
    const sql=fs.readFileSync(`cloudflare/migrations/${name}`,'utf8').replace(/--[^\n]*/g,'');
    const statements=[];let statement='';
    for(const line of sql.split('\n')) {
      statement+=`${line}\n`;
      const trigger=/^\s*CREATE\s+TRIGGER/i.test(statement);
      if ((trigger && /\bEND;\s*$/.test(statement)) || (!trigger && /;\s*$/.test(statement))) {statements.push(statement);statement='';}
    }
    await DB.batch(statements.map(sql=>DB.prepare(sql)));
  }
  const now=new Date().toISOString();
  await DB.prepare(`INSERT INTO installation VALUES(1,'local','Local','en','https://example.invalid','test',?1,?1)`).bind(now).run();
  await DB.prepare(`INSERT INTO spaces(id,name,created_at,updated_at) VALUES('space','Local',?1,?1)`).bind(now).run();
  for(const [id,role] of [['owner','owner'],['writer','writer'],['reader','reader'],['other','writer']]) {
    await DB.prepare(`INSERT INTO users(id,email,role,created_at,updated_at) VALUES(?1,?2,'user',?3,?3)`).bind(id,`${id}@local.invalid`,now).run();
    await DB.prepare(`INSERT INTO memberships VALUES(?1,'space',?2,?3,?3)`).bind(id,role,now).run();
    await DB.prepare(`INSERT INTO device_tokens(id,token_hash,user_id,space_id,device_name,device_kind,created_at) VALUES(?1,?2,?3,'space','local','publisher',?4)`)
      .bind(`device-${id}`,sha(`token-${id}`),id,now).run();
  }
  const api=async(route,{user='owner',method='GET',body,headers={}}={})=>{
    let data=body;
    if(body && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {data=JSON.stringify(body);headers={'content-type':'application/json',...headers};}
    if(data) headers={'content-length':String(Buffer.byteLength(data)),...headers};
    return mf.dispatchFetch(`http://local.test/api/v1/${route}`,{method,body:data,headers:{authorization:`Bearer token-${user}`,...headers}});
  };
  return {mf,DB,OBJECTS,api,env:{DB,OBJECTS,...bindings}};
}

test('daily and monthly budgets reserve atomically under concurrent clients and survive restart',async t=>{
  const {env,DB}=await localCloud(t,{NODUS_SYNC_DAILY_REQUESTS:10,NODUS_SYNC_MONTHLY_REQUESTS:15});
  const now=Date.UTC(2026,0,1,12);
  const first=await Promise.allSettled(Array.from({length:40},()=>reserveBudget(env,{requests:1},'sync',now)));
  assert.equal(first.filter(r=>r.status==='fulfilled').length,10);
  assert.equal((await DB.prepare("SELECT * FROM sync_budget WHERE lane='sync'").first()).month_requests,10);
  assert.equal((await Promise.allSettled(Array.from({length:20},()=>reserveBudget({...env},{requests:1},'sync',now+86400000)))).filter(r=>r.status==='fulfilled').length,5);
  await assert.rejects(()=>reserveBudget(env,{requests:1},'sync',now+2*86400000),e=>e.status===429);
  await reserveBudget(env,{requests:1},'sync',Date.UTC(2026,1,1));
  assert.equal((await DB.prepare("SELECT * FROM sync_budget WHERE lane='sync'").first()).month_requests,1);
  await assert.rejects(()=>reserveBudget(env,{requests:1},'sync',Date.UTC(2026,0,3)),e=>e.status===429,'a backwards clock cannot reopen an old window');
});

test('successful writes consume cumulative budget and a rejected body cannot reach R2',async t=>{
  const {api,DB,OBJECTS}=await localCloud(t,{NODUS_SYNC_DAILY_BYTES:12,NODUS_SYNC_MONTHLY_BYTES:20});
  const one=Buffer.from('first'); const two=Buffer.from('second');
  assert.equal((await api(`spaces/space/document-updates/${sha(one)}`,{user:'writer',method:'PUT',body:one})).status,200);
  assert.equal((await api(`spaces/space/document-updates/${sha(two)}`,{user:'writer',method:'PUT',body:two})).status,200);
  const denied=await api(`spaces/space/document-updates/${sha(Buffer.from('third'))}`,{user:'writer',method:'PUT',body:Buffer.from('third')});
  assert.equal(denied.status,429); assert.equal((await denied.json()).error,'sync_budget_exhausted');
  assert.equal((await DB.prepare("SELECT day_bytes FROM sync_budget WHERE lane='sync'").first()).day_bytes,11);
  assert.equal((await OBJECTS.list()).objects.length,2);
});

test('work budgets and invalid configurations fail closed without partial reservations',async t=>{
  const {env,DB}=await localCloud(t,{NODUS_SYNC_DAILY_WORK:5,NODUS_SYNC_MONTHLY_WORK:6});
  await reserveBudget(env,{requests:1,work:5});
  await assert.rejects(()=>reserveBudget(env,{requests:10,work:2}),e=>e.status===429);
  const state=await DB.prepare("SELECT * FROM sync_budget WHERE lane='sync'").first(); assert.equal(state.day_requests,1);assert.equal(state.month_work,5);
  await assert.rejects(()=>reserveBudget({...env,NODUS_SYNC_MONTHLY_WORK:'NaN'},{work:1}),e=>e.status===503);
});

test('R2 failure leaves a durable job; GC restart retries once and never removes a reuploaded hash',async t=>{
  const {env,DB,OBJECTS}=await localCloud(t);
  const bytes=Buffer.from('snapshot');const hash=sha(bytes);
  await DB.prepare("UPDATE spaces SET active_generation=10 WHERE id='space'").run();
  await OBJECTS.put('old-key',bytes);
  await DB.prepare(`INSERT INTO objects VALUES('space',?1,'snapshot','old-key','application/json',?2,?3,1)`).bind(hash,bytes.length,new Date().toISOString()).run();
  await cleanupPublications(env);
  assert.equal(await DB.prepare("SELECT * FROM objects WHERE object_key='old-key'").first(),null);
  assert.ok(await DB.prepare("SELECT * FROM r2_delete_queue WHERE object_key='old-key'").first());
  let deletes=0;const broken={...env,OBJECTS:{delete:async()=>{deletes++;throw new Error('R2 unavailable');}}};
  assert.equal((await drainObjectQueue(broken)).pending,1);assert.equal(deletes,1);
  assert.equal((await drainObjectQueue(broken)).removed,0);assert.equal(deletes,1,'backoff prevents another R2 request');
  await putSmallObject(env,{space_id:'space'},'snapshot',hash,new Request('http://local.test/upload',{method:'PUT',body:bytes}));
  const current=await DB.prepare("SELECT * FROM objects WHERE kind='snapshot'").first();assert.notEqual(current.object_key,'old-key');
  assert.equal((await drainObjectQueue({...env},Date.now()+7200000)).removed,1);
  assert.equal(await OBJECTS.get('old-key'),null);assert.ok(await OBJECTS.get(current.object_key));
});

test('failed metadata commits and abandoned uploads leave collectible objects with bounded batches',async t=>{
  const {env,DB,OBJECTS}=await localCloud(t);
  const key=await stageObject(env,'abandoned');await OBJECTS.put(key,'orphan');
  const now=new Date().toISOString();
  await DB.batch(Array.from({length:1004},(_,index)=>DB.prepare('INSERT INTO r2_delete_queue VALUES(?1,?2,0,?2)').bind(`garbage-${index}`,now)));
  let max=0;const counting={...env,OBJECTS:{delete:async keys=>{max=Math.max(max,keys.length);return OBJECTS.delete(keys);}}};
  assert.equal((await drainObjectQueue(counting,Date.now()+2*86400000)).removed,1005);assert.equal(max,1000);
  assert.equal((await drainObjectQueue(counting,Date.now()+2*86400000)).removed,0);assert.equal(await OBJECTS.get(key),null);
});

test('binary uploads resume, verify whole checksums, deduplicate and support authenticated ranges',async t=>{
  const {api,DB,OBJECTS,env}=await localCloud(t);
  const bytes=Buffer.alloc(1024*1024+17,7);const hash=sha(bytes);const endpoint=`spaces/space/blobs/${hash}`;
  const send=async index=>{const chunk=bytes.subarray(index*1024*1024,(index+1)*1024*1024);return api(`${endpoint}/chunks/${index}`,{user:'writer',method:'PUT',body:chunk,headers:{'x-nodus-total-chunks':'2','x-nodus-total-bytes':String(bytes.length),'x-nodus-chunk-sha256':sha(chunk)}});};
  assert.equal((await send(1)).status,200);assert.deepEqual((await (await api(`${endpoint}/status`,{user:'writer'})).json()).received,[1]);
  assert.equal((await api(`${endpoint}/complete`,{user:'writer',method:'POST'})).status,409);
  assert.equal((await send(0)).status,200);const count=(await OBJECTS.list()).objects.length;
  assert.equal((await (await send(0)).json()).deduplicated,true);assert.equal((await OBJECTS.list()).objects.length,count);
  assert.equal((await api(`${endpoint}/complete`,{user:'writer',method:'POST'})).status,200);
  const denied=await api(endpoint,{user:'other'});assert.equal(denied.status,404,'unreferenced binary stays private');
  const range=await api(endpoint,{user:'writer',headers:{range:'bytes=1048576-1048592'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(1024*1024));
  assert.equal((await api(endpoint,{user:'writer',headers:{range:'bytes=9999999-'}})).status,416);
  assert.equal(await DB.prepare('SELECT * FROM blob_uploads').first(),null);assert.equal((await drainObjectQueue(env)).removed,2);
});

test('reader cannot upload, corrupt binaries are rejected, and oversize upload metadata creates nothing',async t=>{
  const {api,DB}=await localCloud(t);const body=Buffer.from('bad');
  assert.equal((await api(`spaces/space/document-updates/${sha(body)}`,{user:'reader',method:'PUT',body})).status,403);
  assert.equal((await api(`spaces/space/document-updates/${'a'.repeat(64)}`,{user:'writer',method:'PUT',body})).status,400);
  assert.equal((await api(`spaces/space/blobs/${sha(body)}/chunks/0`,{user:'writer',method:'PUT',body,headers:{'x-nodus-total-chunks':'999','x-nodus-total-bytes':'999999999','x-nodus-chunk-sha256':sha(body)}})).status,400);
  assert.equal(await DB.prepare('SELECT * FROM blob_uploads').first(),null);assert.equal(await DB.prepare('SELECT * FROM binary_objects').first(),null);
});

test('owner acknowledgements retain relay bodies; each device advances independently and private rows stay private',async t=>{
  const {env,DB,OBJECTS}=await localCloud(t);
  const body={id:'mutation',clientId:'local',kind:'upsert',table:'writing_notes',key:['note'],row:{id:'note'},ownerScope:'vault'};
  await OBJECTS.put('mutation-body',JSON.stringify(body));
  await DB.prepare(`INSERT INTO mutations(id,space_id,client_id,user_id,kind,table_name,row_key,body_object_key,schema_version,created_at)
    VALUES('mutation','space','local','writer','upsert','writing_notes','note','mutation-body',1,?1)`).bind(new Date().toISOString()).run();
  await DB.prepare(`INSERT INTO mutations(id,space_id,client_id,user_id,kind,table_name,row_key,body_json,schema_version,created_at)
    VALUES('private','space','local','writer','upsert','pages','private',?1,1,?2)`).bind(JSON.stringify({...body,id:'private',table:'pages',ownerScope:'user:writer'}),new Date().toISOString()).run();
  const req=cursor=>new Request('http://local.test/ack',{method:'POST',body:JSON.stringify({cursor})});
  await ackMutations(env,{space_id:'space',user_id:'owner',device_id:'owner'},req(2));
  assert.equal((await getMutations(env,{space_id:'space',user_id:'owner'},new Request('http://local.test/mutations'))).mutations.length,0);
  const relay=new Request('http://local.test/mutations?relay=1');
  const one=await getMutations(env,{space_id:'space',user_id:'reader',device_id:'one'},relay);assert.equal(one.mutations.length,1);assert.equal(one.cursor,2);
  await ackMutations(env,{space_id:'space',user_id:'reader',device_id:'one'},new Request('http://local.test/ack?relay=1',{method:'POST',body:'{"cursor":2}'}));
  assert.equal((await getMutations(env,{space_id:'space',user_id:'reader',device_id:'one'},relay)).mutations.length,0);
  assert.equal((await getMutations(env,{space_id:'space',user_id:'reader',device_id:'one'},new Request('http://local.test/mutations?relay=1&since=0'))).mutations.length,1,'an explicit backup cursor can recover already acknowledged local changes');
  assert.equal((await getMutations(env,{space_id:'space',user_id:'reader',device_id:'two'},relay)).mutations.length,1);
  assert.equal((await getMutations(env,{space_id:'space',user_id:'writer',device_id:'writer'},relay)).mutations.length,2);
  await DB.prepare("UPDATE mutations SET acknowledged_at='2020-01-01'").run();await cleanupSync(env);
  assert.ok(await DB.prepare("SELECT * FROM r2_delete_queue WHERE object_key='mutation-body'").first());await drainObjectQueue(env);assert.equal(await OBJECTS.get('mutation-body'),null);
});

test('expired chunk uploads queue physical keys before their D1 references disappear',async t=>{
  const {env,DB,OBJECTS}=await localCloud(t);
  await DB.prepare("INSERT INTO blob_uploads VALUES('upload','space',?1,'writer',1,1,'2020-01-01')").bind('f'.repeat(64)).run();
  await DB.prepare("INSERT INTO blob_upload_chunks VALUES('upload',0,?1,'expired-chunk')").bind('f'.repeat(64)).run();await OBJECTS.put('expired-chunk','x');
  await cleanupBlobUploads(env);assert.equal(await DB.prepare('SELECT * FROM blob_uploads').first(),null);assert.ok(await DB.prepare("SELECT * FROM r2_delete_queue WHERE object_key='expired-chunk'").first());
  await drainObjectQueue(env);assert.equal(await OBJECTS.get('expired-chunk'),null);
});

test('streamed personal Library objects verify size and checksum without buffering the whole file',async t=>{
  const {api,DB}=await localCloud(t);const bytes=Buffer.alloc(12*1024*1024,13);const hash=sha(bytes);
  assert.equal((await api(`library/objects/${hash}`,{user:'writer',method:'PUT',body:bytes})).status,200);
  assert.equal((await (await api(`library/objects/${hash}`,{user:'writer',method:'PUT',body:bytes})).json()).duplicate,true);
  assert.equal((await api(`library/objects/${'a'.repeat(64)}`,{user:'writer',method:'PUT',body:Buffer.from('corrupt')})).status,400);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM library_objects').first()).n,1);
});

test('binary mutations travel through the actual API relay, preserve metadata and respect private page ownership',async t=>{
  const {api,DB}=await localCloud(t);
  const publicBytes=Buffer.from('public-yjs');const privateBytes=Buffer.from('private-yjs');
  for(const bytes of [publicBytes,privateBytes]) assert.equal((await api(`spaces/space/document-updates/${sha(bytes)}`,{user:'writer',method:'PUT',body:bytes})).status,200);
  const mutations=[
    {id:'shared-update',kind:'upsert',table:'page_document_updates',key:['shared-update'],row:{id:'shared-update',page_id:'shared-page',update_hash:sha(publicBytes)},documentHash:sha(publicBytes),actorId:'actor',deviceId:'source-device',hlc:'0000000000001:000001:source'},
    {id:'private-update',kind:'upsert',table:'page_document_updates',key:['private-update'],row:{id:'private-update',page_id:'note:private-page',update_hash:sha(privateBytes)},documentHash:sha(privateBytes)},
  ];
  const posted=await api('spaces/space/mutations',{user:'writer',method:'POST',body:{mutations}});assert.equal(posted.status,200);
  assert.deepEqual((await posted.json()).accepted,['shared-update','private-update']);
  const read=await api('spaces/space/mutations?relay=1',{user:'reader'});assert.equal(read.status,200);const result=await read.json();
  assert.equal(result.mutations.length,1);assert.equal(result.cursor,2);assert.equal(result.mutations[0].documentHash,sha(publicBytes));assert.equal(result.mutations[0].actorId,'actor');
  assert.equal((await api(`spaces/space/document-updates/${sha(publicBytes)}`,{user:'reader'})).status,200);
  assert.equal((await api(`spaces/space/document-updates/${sha(privateBytes)}`,{user:'reader'})).status,404);
  assert.equal((await api('spaces/space/mutations',{user:'reader'})).status,403);
  const ack=await api('spaces/space/mutations/ack?relay=1',{user:'reader',method:'POST',body:{cursor:2}});assert.equal(ack.status,200);
  assert.equal((await DB.prepare("SELECT cursor FROM mutation_relay_cursors WHERE device_id='device-reader'").first()).cursor,2);
});

test('concurrent partial uploads reserve storage once and cannot exceed the space quota',async t=>{
  const {api,DB}=await localCloud(t);const chunk=Buffer.alloc(1024*1024,42);
  const responses=await Promise.all(Array.from({length:5},(_,index)=>api(`spaces/space/blobs/${sha(`blob-${index}`)}/chunks/0`,{user:'writer',method:'PUT',body:chunk,headers:{'x-nodus-total-chunks':'32','x-nodus-total-bytes':String(32*1024*1024),'x-nodus-chunk-sha256':sha(chunk)}})));
  assert.equal(responses.filter(r=>r.status===200).length,2);assert.equal(responses.filter(r=>r.status===507).length,3);
  const stock=await DB.prepare("SELECT * FROM binary_storage_usage WHERE space_id='space'").first();assert.equal(stock.reserved,64*1024*1024);assert.equal(stock.bytes,0);
  await DB.prepare("UPDATE blob_uploads SET expires_at='2020-01-01'").run();await cleanupBlobUploads({DB});
  assert.equal((await DB.prepare("SELECT reserved FROM binary_storage_usage WHERE space_id='space'").first()).reserved,0);
});

test('default budgets are finite and cannot be disabled with zero or infinity',()=>{
  for(const value of Object.values(DEFAULT_SYNC_BUDGET)) assert.ok(Number.isSafeInteger(value)&&value>0);
});

test('a failed metadata transaction rolls back reference acquisition and leaves its R2 upload queued',async t=>{
  const {env,DB,OBJECTS}=await localCloud(t);
  const broken={...env,DB:{prepare:sql=>DB.prepare(sql),batch:async()=>{throw new Error('simulated D1 failure');}}};
  const bytes=Buffer.from('uncommitted');
  await assert.rejects(()=>putSmallObject(broken,{space_id:'space'},'snapshot',sha(bytes),new Request('http://local.test/upload',{method:'PUT',body:bytes})),/D1 failure/);
  assert.equal(await DB.prepare('SELECT * FROM objects').first(),null);
  const job=await DB.prepare('SELECT * FROM r2_delete_queue').first();assert.ok(job);assert.ok(await OBJECTS.get(job.object_key));
  await drainObjectQueue(env,Date.now()+2*86400000);assert.equal(await OBJECTS.get(job.object_key),null);
});

test('a failed publication cleanup cannot prevent the independent durable R2 queue from draining',async t=>{
  const {env,DB,OBJECTS}=await localCloud(t);await OBJECTS.put('pending-delete','orphan');
  await DB.prepare('INSERT INTO r2_delete_queue VALUES(?1,?2,0,?2)').bind('pending-delete',new Date().toISOString()).run();
  const broken={...env,DB:{prepare:sql=>{if(sql.includes('SELECT id,active_generation')) throw new Error('failed catalogue scan');return DB.prepare(sql);},batch:statements=>DB.batch(statements)}};
  let completion;await worker.scheduled({},broken,{waitUntil:promise=>{completion=promise;}});
  await assert.rejects(()=>completion,/maintenance/);assert.equal(await OBJECTS.get('pending-delete'),null);assert.equal(await DB.prepare('SELECT * FROM r2_delete_queue').first(),null);
});

test('concurrent mutation writers cannot exceed the pending byte quota',async t=>{
  const {api,DB}=await localCloud(t);
  await DB.prepare("INSERT INTO mutation_ledger_usage VALUES('space',?1)").bind(50*1024*1024-700).run();
  const responses=await Promise.all(Array.from({length:12},(_,index)=>api('spaces/space/mutations',{user:'writer',method:'POST',body:{mutations:[{id:`concurrent-${index}`,kind:'upsert',table:'notes',key:[`note-${index}`],row:{id:`note-${index}`,title:'quota',body:'x'.repeat(100)}}]}})));
  const stock=await DB.prepare("SELECT bytes FROM mutation_ledger_usage WHERE space_id='space'").first();assert.ok(stock.bytes<=50*1024*1024);
  assert.ok(responses.some(response=>response.status===507));assert.ok(responses.some(response=>response.status===200));
});

test('real Desktop publisher and two Cloudflare replicas converge Yjs through local D1/R2 without the owner online',async t=>{
  const {mf,DB}=await localCloud(t);
  const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'nodus-cf-desktop-'));
  const harness=await replicaUtilityHarness(directory);process.env.NODUS_SERVER_REPLICA_WORKER_FILE=harness.worker;
  installRuntimeHooks(directory,{utilityProcess:harness.utilityProcess});
  const Database=require('better-sqlite3');const {runMigrations}=require('../electron/db/migrations.ts');
  const runtime=require('../electron/db/database.ts');const pages=require('../electron/db/pagesRepo.ts');const {Y}=require('../shared/pageYjs.ts');
  const replica=require('../electron/serverSync/replicaService.ts');
  t.after(async()=>{replica.stopReplicaSync();harness.cleanup();await fs.promises.rm(directory,{recursive:true,force:true});});
  const owner=new Database(path.join(directory,'owner.sqlite'));runMigrations(owner);
  t.after(()=>{if(owner.open) owner.close();});
  const original=runtime.withDatabaseContext(owner,()=>pages.createPage({title:'Shared',blocks:[{id:'paragraph',type:'paragraph',content:{text:'Base'}}]}));
  const url=(await mf.ready).origin;
  const config={url,spaceId:'space',kind:'cloudflare',includeUserContent:true,includePassages:false,includeVectors:false,includeLibraryDocuments:false,includePrimarySources:false,includeTestimonies:false,includePersonalImports:false};
  const {publishVaultToCloudflare}=require('../electron/serverSync/cloudflarePublisher.ts');
  await publishVaultToCloudflare(config,'token-owner',{id:'owner',name:'Shared',type:'databases'},owner,null);
  const {hashPassword}=await import('../cloudflare/src/auth.mjs');const password='local-replica-password';const hashed=await hashPassword(password);
  await DB.prepare("UPDATE users SET password_hash=?1,password_salt=?2,password_scheme=?3 WHERE id IN('writer','other')").bind(hashed.hash,hashed.salt,hashed.scheme).run();
  const connect=async user=>{const signed=await replica.signInToNodusServer(url,`${user}@local.invalid`,password);assert.equal(signed.serverKind,'cloudflare');
    return replica.createConnectedVault({...signed,space:signed.spaces[0]});};
  const alice=await connect('writer');const bob=await connect('other');
  const edit=(vault,suffix)=>runtime.withVaultDatabase(vault.id,()=>{
    const current=pages.getPageDocument(original.page.id);assert.ok(current);
    const doc=new Y.Doc();Y.applyUpdate(doc,current.yjsState);const vector=Y.encodeStateVector(doc);
    const text=doc.getMap('blockById').get('paragraph').get('text');text.insert(text.length,suffix);
    assert.equal(pages.applyPageDocumentUpdate(original.page.id,Y.encodeStateAsUpdate(doc,vector),current.revision,vault.id).ok,true);
  });
  await edit(alice,' Alice');await edit(bob,' Bob');
  for(let pass=0;pass<8;pass++){await replica.drainOutbox(alice.id);await replica.drainOutbox(bob.id);}
  const updates=await DB.prepare("SELECT COUNT(*) AS n FROM mutations WHERE table_name='page_document_updates'").first();assert.equal(updates.n,2);
  await replica.pullReplica(alice.id,{force:true});await replica.pullReplica(bob.id,{force:true});
  const read=vault=>runtime.withVaultDatabase(vault.id,()=>pages.getPageDocument(original.page.id).blocks[0].content.text);
  const aliceText=await read(alice);const bobText=await read(bob);
  assert.equal(aliceText,bobText);assert.match(aliceText,/Alice/);assert.match(aliceText,/Bob/);
  assert.ok((await DB.prepare('SELECT COUNT(*) AS n FROM mutation_relay_cursors').first()).n>=2);
  assert.ok(replica.getReplicaOverview().every(connection=>connection.phase==='ok'),JSON.stringify(replica.getReplicaOverview()));
});
