import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-genealogy-dossiers'))process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-genealogy-dossiers-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),previousFetch=globalThis.fetch;
let database,providerCalls=0;
globalThis.fetch=async()=>{providerCalls++;throw new Error('Genealogy consultation is provider-free');};
try{
 const registry=require('../electron/vaults/vaultRegistry.ts');database=require('../electron/db/database.ts');
 const vault=registry.createVault('Isolated genealogy dossier fixture','genealogy');
 await database.withVaultDatabase(vault.id,()=>{
  const db=database.getDb(),now='2026-01-01';
  for(const [id,name]of[['p','Selected person'],['q','Related sibling']])db.prepare('INSERT INTO persons(person_id,display_name,created_at,updated_at)VALUES(?,?,?,?)').run(id,name,now,now);
  db.prepare("INSERT INTO places(place_id,name,created_at,updated_at)VALUES('place','Named place',?,?)").run(now,now);
  db.prepare("INSERT INTO events(event_id,type,label,place_id,created_at,updated_at)VALUES('event','marriage','Recorded event','place',?,?)").run(now,now);
  db.prepare("INSERT INTO relationships(rel_id,from_person,to_person,type,created_at)VALUES('relation','p','q','sibling',?)").run(now);
  for(const[kind,id]of[['person','p'],['event','event'],['place','place'],['relationship','relation'],['person','missing'],['archive_item','private-source'],['identity_resolution','private-identity']]){
   db.prepare('INSERT INTO record_evidence(id,target_kind,target_id,nodus_id,source_kind,quote,location,created_at,created_by)VALUES(?,?,?,?,?,?,?,?,?)').run(`${kind}-${id}`,kind,id,'archive-ref','archive',`Literal ${kind} ${id}`,'folio 37',now,'private-author');
  }
  db.prepare("INSERT INTO archive_items(item_id,title,kind,blob,extracted_text,created_at,updated_at)VALUES('private-source','Private original','other',?,'PRIVATE ORIGINAL TEXT',?,?)").run(Buffer.from('PRIVATE ORIGINAL BYTES'),now,now);
 });
 const {buildServerSnapshot}=require('../electron/serverSync/serverSnapshot.ts');
 const settings={nodusServerIncludeUserContent:false,nodusServerIncludePassages:false};
 const snapshots=await database.withVaultDatabase(vault.id,()=>{
  const db=database.getDb();return{public:buildServerSnapshot(vault,settings,db),weak:buildServerSnapshot(vault,{...settings,bridgeGenealogyEvidence:false},db),strong:buildServerSnapshot(vault,{...settings,bridgeGenealogyEvidence:true},db)};
 });
 const publicValue=JSON.parse(snapshots.public.buffer),strong=JSON.parse(snapshots.strong.buffer),weak=JSON.parse(snapshots.weak.buffer);
 assert.equal(publicValue.tables.record_evidence,undefined,'Default publication must retain its original privacy boundary');
 assert.equal(publicValue.capabilities.genealogyEvidenceAccess,undefined);
 assert.equal(weak.tables.record_evidence,undefined);
 assert.equal(weak.capabilities.genealogyEvidenceAccess,'requires-primary-source-files');
 assert.equal(strong.capabilities.genealogyEvidenceAccess,'granted');
 assert.deepEqual(strong.tables.record_evidence.map(row=>row.id).sort(),['event-event','person-p','place-place','relationship-relation']);
 assert(!JSON.stringify(strong).includes('private-author'));
 assert(!JSON.stringify(strong).includes('PRIVATE ORIGINAL'));
 assert.equal(strong.tables.archive_items,undefined);
 assert.notEqual(snapshots.weak.revision,snapshots.strong.revision);
 const {createCorpusRoutes}=await import('../server/lib/routes/corpus.mjs');
 async function read(snapshot,segments){
  let status,body;const routes=createCorpusRoutes({readSnapshot:()=>snapshot});
  await routes.handle({headers:{}},{writeHead(){},end(){}},{json:(_res,s,value)=>{status=s;body=value;},url:new URL(`https://fixture.test/api/v1/spaces/${vault.id}/${segments.join('/')}`),space:{id:vault.id,revision:'fixture'},segments});
  assert.equal(status,200);return body;
 }
 for(const[path,id,kind]of[['persons','p','person'],['events','event','event'],['places','place','place'],['relationships','relation','relationship']]){
  const body=await read(strong,[path,id]);assert.equal(body.evidence.length,1);assert.equal(body.evidence[0].quote,`Literal ${kind} ${id}`);
  const denied=await read(weak,[path,id]);assert.equal(denied.evidence,undefined);assert.equal(denied.evidenceAccess.state,'requires-primary-source-files');
 }
 const person=await read(strong,['persons','p']);assert.equal(person.relatedPersons[0].display_name,'Related sibling');assert.equal(person.relationships[0].type,'sibling');
 // Exercise the production Bridge cache with identical database state across grants.
 const {serveLiveCorpus}=require('../electron/desktopBridge/liveCorpus.ts');
 async function live(domains){let status,raw;const headers={};const res={setHeader:(k,v)=>headers[k]=v,writeHead:s=>status=s,end:value=>raw=value};
  await serveLiveCorpus({method:'GET',headers:{}},res,new URL('https://fixture.test/persons/p'),vault.id,['persons','p'],undefined,domains);
  assert.equal(status,200);return{body:JSON.parse(String(raw)),revision:headers['x-nodus-revision']};
 }
 const owner=await live(['corpus','primary-source-files']);assert.equal(owner.body.evidence[0].quote,'Literal person p');
 const limited=await live(['corpus']);assert.equal(limited.body.person.display_name,'Selected person');assert.equal(limited.body.relatedPersons[0].display_name,'Related sibling');assert.equal(limited.body.evidence,undefined);assert.equal(limited.body.evidenceAccess.state,'requires-primary-source-files');
 assert.notEqual(owner.revision,limited.revision,'A stronger cached snapshot must not answer a weaker grant');
 const restored=await live(['corpus','primary-source-files']);assert.equal(restored.body.evidence[0].quote,'Literal person p');
 assert.equal(providerCalls,0);
 console.log(JSON.stringify({suite:'mobile-genealogy-dossiers',passed:true,actualSnapshotBuilder:true,actualDossierRoutes:true,actualBridgeCache:true,defaultPublicationUnchanged:true,exactTargets:true,privateOriginalsAbsent:true,providerCalls}));
}finally{globalThis.fetch=previousFetch;database?.closeDb?.();runtime.restore();fs.rmSync(root,{recursive:true,force:true});}
