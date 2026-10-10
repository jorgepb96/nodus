import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks, requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-immersion-test')) process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-immersion-contract-'));
const runtime=installRuntimeHooks(root);
runtime.app.once=()=>{};
runtime.app.on=()=>{};
const require=createRequire(import.meta.url);
let database;
const originalFetch=globalThis.fetch;
let providerRequests=0;
globalThis.fetch=async()=>{providerRequests++;throw new Error('A phone context must never call a Mac provider');};
try {
  database=require('../electron/db/database.ts');
  const db=database.getDb();
  db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,archived,read_tag) VALUES('work-1','ZOT-1','Memoria social','[\"Autora Uno\"]',2020,0,0)").run();
  db.prepare("INSERT INTO authors(author_id,name) VALUES('author-1','Autora Uno')").run();
  db.prepare("INSERT INTO work_authors(nodus_id,author_id,role) VALUES('work-1','author-1','author')").run();
  for(let i=0;i<12;i++){
    db.prepare('INSERT INTO ideas(global_id,type,label,statement,created_at) VALUES(?,?,?,?,?)').run(`idea-${i}`,'claim',`Memoria social ${i}`,`La memoria social se transforma entre generaciones: dimensión ${i}.`,'2026-01-01');
    db.prepare('INSERT INTO idea_occurrences(global_id,nodus_id,role,development,confidence) VALUES(?,?,?,?,?)').run(`idea-${i}`,'work-1','central','Memoria social situada',0.9);
  }
  const text='La memoria social se transforma entre generaciones y depende de relaciones e instituciones.';
  db.prepare('INSERT INTO passages(passage_id,nodus_id,chunk_index,text,page_label,char_len,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run('work-1#0','work-1',0,text,'p. 12',text.length,'hash','2026-01-01');
  const ai=require('../electron/ai/immersion.ts');
  const core=require('../electron/ai/immersionCore.ts');
  const repo=require('../electron/db/immersionRepo.ts');
  const request={topic:'Memoria social',language:'es',minutes:90,includeQuiz:false,model:{provider:'deepseek',model:'phone-owned-model'}};
  const before=db.prepare('SELECT (SELECT COUNT(*) FROM ideas) ideas,(SELECT COUNT(*) FROM passages) passages,(SELECT COUNT(*) FROM immersion_sessions) sessions').get();
  const context=await ai.mobileImmersionGenerationContext(request);
  assert(context.material.ideas.length>=3 && context.material.passages.length>0,'The contract requires usable corpus fixtures');
  assert.equal(context.material.embeddingAvailable,false);
  assert.equal((await ai.mobileImmersionGenerationContext(request)).revision,context.revision,'Read-only context fingerprints must be stable');
  assert.deepEqual(db.prepare('SELECT (SELECT COUNT(*) FROM ideas) ideas,(SELECT COUNT(*) FROM passages) passages,(SELECT COUNT(*) FROM immersion_sessions) sessions').get(),before);
  assert.equal(providerRequests,0,'Context preparation must use no Mac provider');
  // This suite validates persistence and provenance. Real provider generation
  // is independently required by the iPhone acceptance campaign.
  const plan=await core.orchestrateImmersion(request,{
    buildMaterial:async()=>context.material,
    planCurriculum:async input=>({title:'Inmersión de contrato',stations:Array.from({length:input.stationCount},(_,i)=>({id:`st-${i}`,title:`Memoria ${i}`,question:'¿Cómo cambia la memoria?',ideaIds:input.ideas.slice(i,i+3).map(item=>item.id),passageIds:['work-1#0']}))}),
    writePanorama:async()=>({overview:'La memoria depende de instituciones [Autora Uno](nodus://idea/idea-0).',keyTerms:[]}),
    writeStation:async()=>({context:'Una lectura del corpus.',synthesis:'La memoria cambia [Autora Uno](nodus://passage/work-1%230).',takeaways:['Conserva el contexto.'],citations:[{passageId:'work-1#0',whyItMatters:'Texto de la fuente.',commentary:'Compara las generaciones.'}],positions:[],quiz:[]}),
    writeContrasts:async input=>({rows:input.rows.map(row=>({stationId:row.stationId,cells:input.authors.map(author=>({author,stance:'La memoria cambia.'}))}))}),
    writeExam:async()=>({questions:[],feynman:'Explica la memoria social.'}),
  });
  assert.equal(plan.stoppedReason,null);
  const input={request,revision:context.revision,plan,model:request.model};
  await assert.rejects(ai.saveMobileImmersion({...input,revision:'0'.repeat(64)}),/immersion_generation_conflict/);
  for(const invalid of [{...plan,stations:[null]},{...plan,exam:null},{...plan,minutes:1},{...plan,model:{provider:'codex',model:'Mac-only'}},{...plan,contrasts:{authors:[],rows:[null]}}]){
    await assert.rejects(ai.saveMobileImmersion({...input,plan:invalid}),/invalid_immersion_plan/);
  }
  await assert.rejects(ai.saveMobileImmersion({...input,plan:{...plan,overview:'[Foreign](nodus://idea/foreign-vault)'}}),/invalid_immersion_evidence/);
  const altered=structuredClone(plan);altered.stations[0].citations[0].text='Invented source quote';
  await assert.rejects(ai.saveMobileImmersion({...input,plan:altered}),/invalid_immersion_evidence/);
  assert.equal(repo.listImmersionSessions().length,0,'Rejected plans never create a saved session');
  const saved=await ai.saveMobileImmersion(input);
  assert.equal(saved.model.model,'phone-owned-model');
  assert.equal(repo.getImmersionSession(saved.id).plan.stations[0].citations[0].text,text);
  db.prepare('UPDATE immersion_sessions SET language=? WHERE id=?').run('fr',saved.id);
  assert.equal(repo.getImmersionSession(saved.id).language,'fr','Reading a French immersion must preserve its persisted language');
  assert.equal(repo.listImmersionSessions().find(row=>row.id===saved.id).language,'fr');
  assert.equal(providerRequests,0);
  console.log(JSON.stringify({executed:1,passed:1,failed:0,skipped:0,contextReadOnly:true,macProviderRequests:0,sourceQuotePreserved:true,foreignEvidenceRejected:true,phoneModelPersisted:true}));
} finally {
  globalThis.fetch=originalFetch;
  database?.closeDb();
  fs.rmSync(root,{recursive:true,force:true});
}
