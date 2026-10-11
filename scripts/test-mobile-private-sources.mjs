import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks, requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-mobile-private-sources')) process.exit(0);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-private-source-contract-'));
const runtime = installRuntimeHooks(temporary); runtime.app.on = () => {}; runtime.app.once = () => {};
const require = createRequire(import.meta.url), originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('A source reader must not invoke a provider'); };
let database;
try {
  database = require('../electron/db/database.ts'); const db = database.getDb();
  const {getActiveVault, createVault} = require('../electron/vaults/vaultRegistry.ts');
  const vault = getActiveVault().id;
  const {readPrivateSource, listPrivateSources} = require('../electron/desktopBridge/privateSources.ts');
  const stamp = '2026-10-11T00:00:00.000Z';
  const audio = Buffer.alloc(2 * 1024 * 1024, 37);
  db.prepare('INSERT INTO study_recordings(id,short_id,title,file_name,mime_type,content_hash,audio_blob,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('recording/encoded', 'r-1', 'Grabación elegida', 'lesson.m4a', 'audio/mp4', 'fixture', audio, stamp, stamp);
  db.prepare('INSERT INTO study_transcripts(id,short_id,recording_id,content_markdown,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('transcript', 't-1', 'recording/encoded', 'Texto completo de la transcripción · 37 datos', stamp, stamp);
  const insert = db.prepare('INSERT INTO study_transcript_segments(id,short_id,transcript_id,t_start,t_end,text,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 121; i++) insert.run(`s-${i}`, `seg-${i}`, 'transcript', i, i + 1, `Contenido literal ${i}`, i, stamp, stamp);
  const recording = await readPrivateSource(vault, 'study-recordings', 'study-recording', 'recording/encoded');
  assert.equal(recording.root.id, 'recording/encoded'); assert.equal(recording.root.audio_blob, undefined);
  assert.equal(JSON.stringify(recording).includes('binary'), false);
  const segments = recording.groups.find(group => group.key === 'segments'); assert.equal(segments.total, 121);
  const page = await readPrivateSource(vault, 'study-recordings', 'study-recording', 'recording/encoded', {group:'segments',cursor:0,limit:100,revision:segments.revision});
  const last = await readPrivateSource(vault, 'study-recordings', 'study-recording', 'recording/encoded', {group:'segments',cursor:page.cursor,limit:100,revision:segments.revision});
  assert.equal(page.rows.length, 100); assert.equal(last.rows.length, 21); assert.equal(last.hasMore, false);
  assert.equal(last.rows.at(-1).text, 'Contenido literal 120'); assert.equal(new Set([...page.rows, ...last.rows].map(row => row.id)).size, 121);
  db.prepare('UPDATE study_transcript_segments SET text=? WHERE id=?').run('Cambio concurrente', 's-120');
  await assert.rejects(() => readPrivateSource(vault, 'study-recordings', 'study-recording', 'recording/encoded', {group:'segments',cursor:page.cursor,limit:100,revision:segments.revision}), {code:'source_changed'});
  assert.notEqual((await readPrivateSource(vault, 'study-recordings', 'study-recording', 'recording/encoded')).revision, recording.revision);
  await assert.rejects(() => readPrivateSource(vault, 'corpus', 'study-recording', 'recording/encoded'), {status:403});
  await assert.rejects(() => readPrivateSource(vault, 'study-recordings', 'persons', 'id'), {status:403});
  await assert.rejects(() => readPrivateSource(vault, 'study-recordings', 'study-recording', 'missing'), {status:404});
  await assert.rejects(() => readPrivateSource(vault, 'study-recordings', 'study-recording', 'recording/encoded', {group:'audio_blob',cursor:0,limit:100,revision:segments.revision}), {status:403});
  const other = createVault('Otra bóveda de contrato');
  await assert.rejects(() => readPrivateSource(other.id, 'study-recordings', 'study-recording', 'recording/encoded'), {status:404});

  const insertRecording = db.prepare('INSERT INTO study_recordings(id,short_id,title,file_name,mime_type,content_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  for (let i=0;i<120;i++) insertRecording.run(`catalogue-${String(i).padStart(3,'0')}`,`record-${i}`,`Grabación ${i}`,'audio.m4a','audio/mp4','fixture',stamp,stamp);
  const catalogue = await listPrivateSources(vault,'study-recordings','study-recording',{offset:0,limit:100,query:''});
  const catalogueLast = await listPrivateSources(vault,'study-recordings','study-recording',{offset:100,limit:100,query:''});
  assert.equal(catalogue.total,121); assert.equal(catalogueLast.items.length,21); assert.equal(catalogueLast.revision,catalogue.revision);
  assert.equal(new Set([...catalogue.items,...catalogueLast.items].map(item=>item.id)).size,121);
  assert.equal(JSON.stringify(catalogue).includes('content_markdown'),false); assert.equal(JSON.stringify(catalogue).includes('audio_blob'),false);
  const transcriptSearch = await listPrivateSources(vault,'study-recordings','study-recording',{offset:0,limit:100,query:'37 datos'});
  assert.equal(transcriptSearch.total,1); assert.equal(transcriptSearch.items[0].id,'recording/encoded');
  db.prepare('UPDATE study_recordings SET archived_at=? WHERE id=?').run(stamp,'catalogue-000');
  db.prepare('UPDATE study_recordings SET deleted_at=? WHERE id=?').run(stamp,'catalogue-001');
  assert.equal((await listPrivateSources(vault,'study-recordings','study-recording',{offset:0,limit:100,query:''})).total,119);
  assert.equal((await listPrivateSources(vault,'study-recordings','study-recording',{offset:0,limit:100,query:'',state:'archived'})).items[0].id,'catalogue-000');
  assert.equal((await listPrivateSources(vault,'study-recordings','study-recording',{offset:0,limit:100,query:'',state:'trash'})).items[0].id,'catalogue-001');
  assert.equal((await listPrivateSources(vault,'study-recordings','study-recording',{offset:0,limit:100,query:'',state:'all'})).total,121);

  db.prepare('INSERT INTO persons(person_id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run('private-person', 'Persona privada', stamp, stamp);
  db.prepare('INSERT INTO prosop_person_profiles(person_id,created_at,updated_at) VALUES(?,?,?)').run('private-person',stamp,stamp);
  db.prepare('INSERT INTO prosop_sources(source_id,title,source_kind,created_at,updated_at) VALUES(?,?,?,?,?)').run('source','Fuente concreta','document',stamp,stamp);
  db.prepare('INSERT INTO prosop_source_segments(segment_id,source_id,locator_display,quoted_text,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('literal','source','p.37','Evidencia literal íntegra',stamp,stamp);
  db.prepare('INSERT INTO prosop_factoids(factoid_id,source_id,source_segment_id,factoid_kind,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('factoid','source','literal','observation','human',stamp,stamp);
  db.prepare('INSERT INTO prosop_statements(statement_id,factoid_id,statement_type,value_kind,literal_value,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('statement','factoid','claim','text','37',stamp,stamp);
  db.prepare('INSERT INTO prosop_statement_entities(id,statement_id,entity_kind,entity_id,role,position) VALUES(?,?,?,?,?,?)').run('entity','statement','person','private-person','subject',0);
  db.prepare('INSERT INTO prosop_name_attestations(attestation_id,source_id,source_segment_id,factoid_id,literal_name,normalized_search_name,person_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('mention','source','literal','factoid','Nombre literal','nombre literal','private-person',stamp,stamp);
  for (const [kind, id] of [['prosop-person','private-person'], ['prosop-source','source'], ['prosop-factoid','factoid'], ['prosop-mention','mention']]) {
    const source = await readPrivateSource(vault,'prosopography-private',kind,id);
    assert.equal(source.id,id);
    for (const group of source.groups) {
      const rows = await readPrivateSource(vault,'prosopography-private',kind,id,{group:group.key,cursor:0,limit:100,revision:group.revision});
      assert.equal(rows.rows.length,group.total); assert.equal(rows.hasMore,false);
      if (group.key === 'segments') assert.equal(rows.rows[0].quoted_text,'Evidencia literal íntegra');
    }
    await assert.rejects(() => readPrivateSource(vault,'corpus',kind,id), {status:403});
  }
  console.log('Private source ownership, domain isolation, complete pagination and concurrent revision contracts passed.');
} finally {
  globalThis.fetch = originalFetch; database?.closeDb(); runtime.restore();
  fs.rmSync(temporary, {recursive:true,force:true});
}
