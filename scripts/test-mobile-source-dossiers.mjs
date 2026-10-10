import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks, requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-mobile-source-dossiers')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-mobile-source-dossiers-'));
const runtime = installRuntimeHooks(root); runtime.app.on = () => {}; runtime.app.once = () => {};
const require = createRequire(import.meta.url), beforeFetch = globalThis.fetch;
let providerCalls = 0, database;
globalThis.fetch = async () => { providerCalls++; throw new Error('Source consultation must remain provider-free'); };
globalThis.crypto ??= webcrypto;
try {
  database = require('../electron/db/database.ts'); const db = database.getDb();
  const works = require('../electron/db/worksRepo.ts'), ideas = require('../electron/db/ideasRepo.ts');
  const gaps = require('../electron/db/gapsRepo.ts'), summaries = require('../electron/db/workSummariesRepo.ts');
  const synthesis = require('../electron/ai/workIdeaSynthesis.ts'), authors = require('../electron/ai/authorDossier.ts');
  const {snapshotSourceDetails} = require('../shared/snapshotSourceDetails.ts');
  const {buildServerSnapshot} = require('../electron/serverSync/serverSnapshot.ts');
  for (const [id, archived] of [['work-1', 0], ['work-2', 0], ['archived', 1]]) {
    db.prepare('INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,archived,read_tag) VALUES(?,?,?,?,?,?,?)')
      .run(id, id.toUpperCase(), `Obra ${id}`, '["Uno, Autora"]', 2020, archived, 0);
  }
  db.prepare("INSERT INTO authors(author_id,name,affiliation) VALUES('author-1','Uno, Autora',NULL),('editor','Dos, Editora','Instituto ficticio')").run();
  db.prepare("INSERT INTO work_authors(nodus_id,author_id,role) VALUES('work-1','author-1','author'),('work-2','editor','editor'),('archived','author-1','author')").run();
  db.prepare("INSERT INTO themes(theme_id,label,created_at) VALUES('theme-a','Árbol','2026-01-01'),('theme-b','Memoria','2026-01-01')").run();
  db.prepare("INSERT INTO work_themes(nodus_id,theme_id) VALUES('work-1','theme-a'),('work-1','theme-b')").run();
  const allIds = [];
  for (let index = 0; index < 131; index++) {
    const id = `idea-${String(index).padStart(3, '0')}`; allIds.push(id);
    db.prepare('INSERT INTO ideas(global_id,type,label,statement,created_at) VALUES(?,?,?,?,?)')
      .run(id, 'claim', `Idea ${index}`, `El testimonio ${index} conserva su contexto.`, '2026-01-01');
    for (const work of index < 4 ? ['work-1','work-2','archived'] : ['work-1']) {
      db.prepare('INSERT INTO idea_occurrences(global_id,nodus_id,role,development,confidence) VALUES(?,?,?,?,?)')
        .run(id, work, index % 2 ? 'secondary' : 'principal', `Desarrollo ${work}`, .9 - index / 1000);
      db.prepare('INSERT INTO evidence(id,global_id,nodus_id,quote,location,kind) VALUES(?,?,?,?,?,?)')
        .run(`evidence-${work}-${index}`, id, work, `Cita literal ${index}`, 'p. 12', 'quote');
      db.prepare('INSERT INTO idea_theme_links(global_id,nodus_id,theme_id,confidence,basis) VALUES(?,?,?,.9,\'explicit\')').run(id, work, index % 2 ? 'theme-a' : 'theme-b');
    }
  }
  for (const [id, type, from, to, confidence] of [['accepted','contradicts',allIds[0],allIds[130],.95],['rejected','supports',allIds[0],allIds[1],.99],['containment','contains',allIds[0],allIds[2],1]]) {
    db.prepare('INSERT INTO edges(id,from_id,to_id,type,basis,confidence,source_work) VALUES(?,?,?,?,?,?,?)')
      .run(id, from, to, type, 'explicit', confidence, 'work-1');
  }
  db.prepare("INSERT INTO edge_feedback(from_id,to_id,type,verdict,note,created_at) VALUES(?,?,'supports','rejected','Descartado','2026-01-01')").run(allIds[1], allIds[0]);
  db.prepare("INSERT INTO gaps(id,nodus_id,related_idea,kind,statement,confidence,evidence_id) VALUES('gap','work-1',?,'limitation','Una limitación',.8,'evidence-work-1-0'),('gap-missing','absent',NULL,'open_question','Fuente no disponible',.5,NULL)").run(allIds[0]);
  summaries.upsertWorkSummary({nodusId:'work-1',summary:'Resumen ya guardado',sourceLevel:'deep',model:null,contentHash:'fixture'});
  const fingerprint = createHash('sha1').update(db.prepare('SELECT global_id,role,confidence FROM idea_occurrences WHERE nodus_id=? ORDER BY global_id').all('work-1')
    .map(row => `${row.global_id}:${row.role}:${row.confidence.toFixed(4)}`).join('|')).digest('hex').slice(0,16);
  db.prepare('INSERT INTO work_idea_synthesis(nodus_id,thesis,remember_json,positioning,model_json,fingerprint,generated_at) VALUES(?,?,?,?,?,?,?)')
    .run('work-1','Tesis guardada','["Recuerdo",9]','Posicionamiento','{"provider":"openai","model":"fixture"}',fingerprint,'2026-01-01');
  db.prepare('INSERT INTO work_idea_synthesis(nodus_id,thesis,remember_json,positioning,model_json,fingerprint,generated_at) VALUES(?,?,?,?,?,?,?)')
    .run('work-2','Tesis anterior','invalid-json','','invalid-json','stale','2026-01-01');
  db.prepare("INSERT INTO author_relations(from_author,to_author,type,weight) VALUES('author-1','editor','supports',.75)").run();
  const changes = db.prepare('SELECT total_changes() n').get().n;
  const snapshot = JSON.parse(buildServerSnapshot({id:'fixture',name:'Fuentes ficticias',type:'academic',path:path.join(root,'vault.sqlite')},
    {nodusServerIncludePassages:true,nodusServerIncludeUserContent:true},db).buffer);
  const source = snapshotSourceDetails(snapshot.tables);
  // Desktop-only paths and binaries are never eligible publication fields.
  const publishedWork = work => {
    if (!work) return work;
    const published = snapshot.tables.works.find(row => row.nodus_id === work.nodus_id);
    const keys = new Set([...Object.keys(published).filter(key => key !== 'authors_json'),'authors','themes','zoteroTags','ideaCount']);
    return Object.fromEntries(Object.entries(work).filter(([key]) => keys.has(key)));
  };
  for (const id of ['work-1','work-2','archived','missing']) {
    assert.deepEqual(source.work(id),publishedWork(works.getWork(id)),id);
    assert.deepEqual(source.workSummary(id),summaries.getWorkSummary(id),id);
    assert.deepEqual(await source.workSynthesis(id),synthesis.getCachedWorkIdeaSynthesis(id),id);
    for (const offset of [0,50,100,130,200]) assert.deepEqual(source.ideasByWork(id,50,offset),ideas.getIdeasByWork(id,50,offset),`${id}:${offset}`);
  }
  for (const id of [allIds[0],allIds[130],'missing']) {
    const expected = ideas.getIdeaDetail(id);
    if (expected) expected.occurrences = expected.occurrences.map(value => ({...value,work:publishedWork(value.work)}));
    assert.deepEqual(source.ideaDetail(id),expected,id);
    assert.deepEqual(source.ideaEdges(id),ideas.getIdeaEdges(id),id);
  }
  for (const id of ['accepted','rejected','containment','missing']) assert.deepEqual(source.edgeDetail(id),ideas.getEdgeDetail(id),id);
  for (const id of ['gap','gap-missing','missing']) assert.deepEqual(source.gapDetail(id),gaps.getGapDetail(id),id);
  for (const id of ['author-1','editor','missing']) assert.deepEqual(source.authorDossier(id),authors.buildAuthorDossier(id),id);
  assert.equal(source.workMeta('work-1'),null,'a downloaded dossier must not invent Zotero enrichment');
  assert.throws(() => snapshotSourceDetails({...snapshot.tables,evidence:undefined}).ideaDetail(allIds[0]),/no incluye la tabla evidence/);
  assert.throws(() => snapshotSourceDetails({...snapshot.tables,edge_feedback:undefined}).ideaEdges(allIds[0]),/no incluye la tabla edge_feedback/);
  await assert.rejects(() => snapshotSourceDetails({...snapshot.tables,work_idea_synthesis:undefined}).workSynthesis('work-1'),/no incluye la tabla work_idea_synthesis/);
  assert.throws(() => source.ideasByWork('work-1',0,0),/no es válida/);
  assert.equal(providerCalls,0);
  assert.equal(db.prepare('SELECT total_changes() n').get().n,changes,'consultation must not mutate or trigger generation');
  console.log(JSON.stringify({passed:true,ideas:allIds.length,workPages:20,ideaDossiers:3,edgeDossiers:4,gapDossiers:3,authorDossiers:3,
    completeWorkPagination:true,archivedSourceRetained:true,rejectedEdgesHidden:true,providerCalls,dbWritesDuringConsultation:0,missingTablesFailExplicitly:true,
    optionalZoteroEnrichment:'not-in-current-publications',localGenerationTraces:'not-in-current-publications'}));
} finally {
  globalThis.fetch = beforeFetch; try { database?.closeDb?.(); } catch {} fs.rmSync(root,{recursive:true,force:true});
}
