import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';

if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-dictionary-snapshot'))process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-dictionary-snapshot-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),fetchBefore=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Dictionary consultation must not call a provider');};
globalThis.crypto??=webcrypto;
let database;
try {
  database=require('../electron/db/database.ts');const db=database.getDb();
  const repo=require('../electron/db/dictionaryRepo.ts');
  const {dictionarySnapshot}=require('../shared/dictionarySnapshot.ts');
  const {snapshotCitations}=require('../shared/snapshotCitations.ts');
  const {verifyCitations,previewCitation}=require('../electron/citations/verifyCitations.ts');
  const {getPassageDetail}=require('../electron/db/passagesRepo.ts');
  const {buildServerSnapshot,stripUnpublishableColumns}=require('../electron/serverSync/serverSnapshot.ts');
  db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,archived,read_tag,resolved_text_hash) VALUES('work-1','FIX-1','Obra ficticia','["Autora Uno"]',2020,0,0,'current')`).run();
  db.prepare(`INSERT INTO authors(author_id,name,affiliation) VALUES('author-1','Uno, Autora',NULL)`).run();
  db.prepare(`INSERT INTO work_authors(nodus_id,author_id,role) VALUES('work-1','author-1','author')`).run();
  db.prepare(`INSERT INTO ideas(global_id,type,label,statement,created_at) VALUES('idea-1','construct','Memoria social','La memoria se construye socialmente','2026-01-01')`).run();
  db.prepare(`INSERT INTO idea_occurrences(global_id,nodus_id,role,development,confidence) VALUES('idea-1','work-1','central','Desarrollo situado',.9)`).run();
  const passageText='La memoria colectiva cambia entre generaciones.';
  for(const [id,hash]of[['current','current'],['stale','old']])db.prepare(`INSERT INTO passages(passage_id,nodus_id,chunk_index,text,page_label,char_len,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(`work-1#${id}`,'work-1',id==='current'?0:1,passageText,'p. 12',passageText.length,hash,'2026-01-01');
  const created=[];
  for(let i=0;i<241;i++) {
    const entry=repo.createDictionaryEntry({name:i===0?'Árbol [especial]':i===1?'123 numérico':`Concepto ${String(i).padStart(3,'0')}`,aliases:[`Alias ${i}`],focusPrompt:'Corpus ficticio',scope:{kind:'vault'},outputLanguage:'es',detailLevel:'standard',tags:[i%2?'grupo A':'grupo B']});
    created.push(entry.id);
    const refs=[['idea','idea-1','included'],['passage','work-1#current','included'],['passage','work-1#stale','unused'],['idea','missing','excluded']];
    repo.upsertDictionaryEvidence(entry.id,refs.map(([kind,refId,decision],index)=>({kind,refId,decision,score:.95-index*.2,reason:'fixture',label:`${index?'z':'A'} evidencia ${i}`,text:passageText,workId:'work-1',workTitle:'Obra ficticia',zoteroKey:'FIX-1',works:[{id:'work-1',title:'Obra ficticia',zoteroKey:'FIX-1',authors:['Autora Uno'],year:2020}],pageLabel:'p. 12',authors:[{id:'author-1',name:'Autora Uno'},{id:null,name:i%2?'Anónima Á':'Anónima B'}],tags:['memoria'],sourceRevision:kind==='passage'?createHash('sha256').update(passageText).digest('hex'):'fixture',isNew:index===1})));
    repo.saveDictionaryVersion({entryId:entry.id,contentMarkdown:`Definición ${i} [Memoria](nodus://idea/idea-1).`,evidence:[{kind:'idea',id:'idea-1'}],citations:[{kind:'idea',id:'idea-1',label:'Memoria',tags:['memoria']}],authorSummaries:[],model:null,trigger:'creation',state:'applied',outcome:'synthesis',degradationReason:null,generationAttempts:1,generationProblems:[],insufficientEvidence:false});
    if(i%3===0)repo.saveDictionaryVersion({entryId:entry.id,contentMarkdown:`Propuesta ${i}`,evidence:[],citations:[],authorSummaries:[],model:null,trigger:'update',state:i%2?'degraded':'proposed',outcome:i%2?'degraded':'synthesis',degradationReason:i%2?'schema_error':null,generationAttempts:2,generationProblems:i%2?['fixture problem']:[],insufficientEvidence:false});
    if(i%5===0)db.prepare(`UPDATE dictionary_entries SET status='archived',insufficient_evidence=1 WHERE id=?`).run(entry.id);
  }
  repo.addDictionaryRelation(created[0],created[240],'broader');repo.addDictionaryRelation(created[1],created[0],'related');
  const changes=db.prepare('SELECT total_changes() n').get().n;
  const snapshot=JSON.parse(buildServerSnapshot({id:'fixture',name:'Diccionario ficticio',type:'academic',path:path.join(root,'vault.sqlite')},{nodusServerIncludePassages:true,nodusServerIncludeUserContent:true},db).buffer);
  assert.equal(snapshot.tables.dictionary_evidence[0].score,.95,'Dictionary relevance must survive publication');
  assert.deepEqual(stripUnpublishableColumns({score:1,student_score:2,password:'secret',name:'allowed'}),{name:'allowed'},'The exception must not widen the generic publication boundary');
  const projection=await dictionarySnapshot(snapshot.tables);
  const citations=snapshotCitations(snapshot.tables);
  const refs=[{kind:'idea',id:'idea-1'},{kind:'work',id:'work-1'},{kind:'passage',id:'work-1#current'},{kind:'passage',id:'work-1#stale'},...['idea','work','passage','gap','contradiction'].map(kind=>({kind,id:'missing'}))];
  assert.deepEqual(citations.verify(refs),verifyCitations(refs));
  for(const ref of refs)assert.deepEqual(citations.preview(ref),previewCitation(ref));
  for(const id of ['work-1#current','work-1#stale','missing'])assert.deepEqual(citations.passage(id),getPassageDetail(id));
  assert.throws(()=>snapshotCitations({}).verify([{kind:'idea',id:'idea-1'}]),/no incluye la tabla/);
  let catalogues=0,details=0,evidencePages=0;
  const queries=['','concepto','alias 240','árbol','arbol','%','0_0','[especial]','memoria','Autora Uno','\\'];
  const filters=[{}, {letter:'#'}, {letter:'C'}, {statuses:['archived']}, {hasNewEvidence:true}, {hasNewEvidence:false}, {insufficientEvidence:true}, {tags:['grupo A']}, {authorIds:['author-1']}, {workIds:['work-1']}];
  for(const query of queries)for(const filter of filters)for(const key of ['name','created','updated','authors','works','evidence'])for(const dir of ['asc','desc'])for(const offset of [0,200]) {
    const request={query,...filter,sort:{key,dir},offset,limit:37};assert.deepEqual(projection.list(request),repo.listDictionaryEntries(request),JSON.stringify(request));catalogues++;
  }
  assert.deepEqual(projection.facets(),repo.listDictionaryFacets());
  for(const id of created) {
    assert.deepEqual(projection.detail(id),repo.getDictionaryEntryDetail(id),id);details++;
    assert.deepEqual(projection.listVersions(id),repo.listDictionaryVersions(id));
    for(const filter of [{},{kinds:['passage']},{decisions:['included']},{newOnly:true},{query:'MEMORIA'},{authorIds:['author-1'],tags:['memoria']},{workIds:['work-1']}]) {
      const request={entryId:id,...filter,offset:0,limit:2};assert.deepEqual(projection.listEvidence(request),repo.listDictionaryEvidence(request));evidencePages++;
    }
  }
  assert.equal(projection.detail('missing'),null);
  await assert.rejects(()=>dictionarySnapshot({...snapshot.tables,dictionary_entries:undefined}),/no incluye la tabla/);
  await assert.rejects(()=>dictionarySnapshot({...snapshot.tables,dictionary_evidence:snapshot.tables.dictionary_evidence.map(({score,...row})=>row)}),/relevancia/);
  assert.equal(db.prepare('SELECT total_changes() n').get().n,changes,'Consultation must not mutate or schedule retrieval');
  console.log(JSON.stringify({passed:true,entries:created.length,catalogues,details,evidencePages,versions:created.length,citationLookups:refs.length,providerCalls:0,missingTablesFailExplicitly:true,genericPublicationBoundaryPreserved:true}));
} finally {
  globalThis.fetch=fetchBefore;try{database?.closeDb?.();}catch{}fs.rmSync(root,{recursive:true,force:true});
}
