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
  const {readPrivateSource, listPrivateSources, readPrivateSourceContext} = require('../electron/desktopBridge/privateSources.ts');
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
  db.prepare('INSERT INTO testimony_participant_profiles(person_id,public_name,biographical_note,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run('private-person','Alias público','Biografía privada elegida',stamp,stamp);
  const participant = await readPrivateSource(vault,'testimonies','testimony-participant','private-person');
  const participantProfile = participant.groups.find(group=>group.key==='profile');
  const participantRows = await readPrivateSource(vault,'testimonies','testimony-participant','private-person',
    {group:'profile',cursor:0,limit:100,revision:participantProfile.revision});
  assert.equal(participant.root.display_name,'Persona privada'); assert.equal(participantRows.rows[0].biographical_note,'Biografía privada elegida');
  await assert.rejects(() => readPrivateSource(vault,'corpus','testimony-participant','private-person'),{status:403});
  await assert.rejects(() => readPrivateSource(vault,'prosopography-private','testimony-participant','private-person'),{status:403});
  const addInterview = db.prepare('INSERT INTO testimony_interviews(id,short_id,title,abstract,created_at,updated_at) VALUES(?,?,?,?,?,?)');
  const addSession = db.prepare('INSERT INTO testimony_sessions(id,short_id,interview_id,title,field_notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
  const addMedia = db.prepare('INSERT INTO testimony_media(id,short_id,session_id,file_name,mime_type,content_blob,created_at) VALUES(?,?,?,?,?,?,?)');
  const addTranscript = db.prepare('INSERT INTO testimony_transcripts(id,short_id,media_id,content_markdown,created_at,updated_at) VALUES(?,?,?,?,?,?)');
  for (const label of ['chosen','foreign']) {
    addInterview.run(label,`INT-${label}`,`Entrevista ${label}`,`Resumen ${label}`,stamp,stamp);
    addSession.run(`${label}-session`,`SES-${label}`,label,`Sesión ${label}`,`Notas ${label}`,stamp,stamp);
    addMedia.run(`${label}-media`,`MED-${label}`,`${label}-session`,`${label}.m4a`,'audio/mp4',audio,stamp);
    addTranscript.run(`${label}-transcript`,`TRN-${label}`,`${label}-media`,`Texto literal completo ${label}`,stamp,stamp);
  }
  db.prepare('INSERT INTO testimony_interview_participants(interview_id,person_id,role,created_at) VALUES(?,?,?,?)').run('chosen','private-person','narrator',stamp);
  const addSegment = db.prepare('INSERT INTO testimony_transcript_segments(id,short_id,transcript_id,t_start,t_end,text,speaker_person_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (let i=0;i<121;i++) addSegment.run(`chosen-segment-${i}`,`SEG-${i}`,'chosen-transcript',i,i+1,`Fragmento literal ${i}`,'private-person',i,stamp,stamp);
  addSegment.run('foreign-segment','SEG-foreign','foreign-transcript',0,1,'Contenido de otra entrevista','private-person',0,stamp,stamp);
  db.prepare('INSERT INTO testimony_annotations(id,short_id,interview_id,transcript_id,segment_id,quote_snapshot,memo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('chosen-annotation','ANN-chosen','chosen','chosen-transcript','chosen-segment-37','Fragmento literal 37','Interpretación vinculada',stamp,stamp);
  db.prepare('INSERT INTO testimony_codes(id,label,normalized_label,created_at,updated_at) VALUES(?,?,?,?,?)').run('chosen-code','Código utilizado','codigo utilizado',stamp,stamp);
  db.prepare('INSERT INTO testimony_annotation_codes(annotation_id,code_id,created_at) VALUES(?,?,?)').run('chosen-annotation','chosen-code',stamp);
  db.prepare('INSERT INTO testimony_agreements(id,interview_id,restrictions_markdown,created_at,updated_at) VALUES(?,?,?,?,?)').run('chosen-agreement','chosen','Acuerdo privado vigente',stamp,stamp);
  db.prepare('INSERT INTO testimony_contrasts(id,short_id,title,memo_markdown,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('chosen-contrast','CON-chosen','Contraste elegido','Memo completo del contraste',stamp,stamp);
  db.prepare('INSERT INTO testimony_contrast_items(contrast_id,annotation_id,note,created_at) VALUES(?,?,?,?)').run('chosen-contrast','chosen-annotation','Fragmento fijado',stamp);
  db.prepare('INSERT INTO testimony_note_links(note_id,target_kind,target_id,created_at) VALUES(?,?,?,?)').run('selected-note','testimony_annotation','chosen-annotation',stamp);
  for (const [kind,id] of [['testimony-interview','chosen'],['testimony-transcript','chosen-transcript'],['testimony-contrast','chosen-contrast']]) {
    const dossier = await readPrivateSource(vault,'testimonies',kind,id);
    for (const group of dossier.groups) {
      let cursor=0, more=true; const owned=[];
      while (more) {
        const page=await readPrivateSource(vault,'testimonies',kind,id,{group:group.key,cursor,limit:100,revision:group.revision});
        owned.push(...page.rows); cursor=page.cursor; more=page.hasMore;
      }
      assert.equal(owned.length,group.total);
      assert.equal(JSON.stringify(owned).includes('foreign'),false,`foreign ${kind}/${group.key}`);
      assert.equal(JSON.stringify(owned).includes('content_blob'),false);
      if (group.key==='segments') { assert.equal(owned.length,121); assert.equal(owned.at(-1).text,'Fragmento literal 120'); }
      if (group.key==='noteLinks' && kind==='testimony-interview') assert.equal(owned[0].note_id,'selected-note');
      if (group.key==='items') assert.equal(owned[0].quote_snapshot,'Fragmento literal 37');
      if (group.key==='participants') assert.equal(owned[0].display_name,'Persona privada');
    }
    await assert.rejects(() => readPrivateSource(vault,'corpus',kind,id),{status:403});
  }
  const interviewSearch = await listPrivateSources(vault,'testimonies','testimony-interview',{offset:0,limit:100,query:'literal completo chosen'});
  assert.equal(interviewSearch.total,1); assert.equal(interviewSearch.items[0].id,'chosen');
  assert.equal(JSON.stringify(interviewSearch).includes('content_markdown'),false);
  const transcriptSource = await readPrivateSource(vault,'testimonies','testimony-transcript','chosen-transcript');
  assert.equal(transcriptSource.root.interview_id,'chosen'); assert.equal(transcriptSource.root.session_id,'chosen-session');
  const transcriptCatalogue = await listPrivateSources(vault,'testimonies','testimony-transcript',{offset:0,limit:100,query:'literal completo chosen'});
  assert.equal(transcriptCatalogue.total,1); assert.equal(transcriptCatalogue.items[0].id,'chosen-transcript');
  const newParticipant = await readPrivateSource(vault,'testimonies','testimony-participant','private-person');
  const involvement = newParticipant.groups.find(group=>group.key==='participation');
  assert.equal((await readPrivateSource(vault,'testimonies','testimony-participant','private-person',{group:'participation',cursor:0,limit:100,revision:involvement.revision})).rows[0].interview_title,'Entrevista chosen');
  db.prepare('UPDATE testimony_transcript_segments SET text=? WHERE id=?').run('Corrección literal posterior','chosen-segment-37');
  const originalSegments = transcriptSource.groups.find(group=>group.key==='segments');
  await assert.rejects(() => readPrivateSource(vault,'testimonies','testimony-transcript','chosen-transcript',{group:'segments',cursor:0,limit:100,revision:originalSegments.revision}),{code:'source_changed'});
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
  const deniedContext = await readPrivateSourceContext(vault,['corpus'],'37',120000);
  assert.equal(deniedContext.items.length,0);
  const recordingContext = await readPrivateSourceContext(vault,['study-recordings'],'37',120000);
  const exactVersion = recordingContext.items.find(row=>row.contentScope==='record');
  assert.equal(exactVersion.citation,'nodus://study/recording/recording%2Fencoded?transcript=transcript');
  assert.equal(exactVersion.text,'Texto completo de la transcripción · 37 datos');
  assert.equal(recordingContext.items.some(row=>row.domain!=='study-recordings'),false);
  assert.equal(JSON.stringify(recordingContext).includes('audio_blob'),false);
  const prosopContext = await readPrivateSourceContext(vault,['prosopography-private'],'íntegra',120000);
  assert.equal(prosopContext.items.some(row=>row.citation==='nodus://prosop/factoid/factoid' && row.text.includes('Evidencia literal íntegra')),true);
  assert.equal(prosopContext.items.some(row=>row.domain!=='prosopography-private'),false);
  const testimonyContext = await readPrivateSourceContext(vault,['testimonies'],'literal',120000);
  assert.equal(testimonyContext.items.some(row=>row.privateKind==='testimony-transcript'),true);
  assert.equal(new Set(testimonyContext.items.map(row=>row.citation)).size,testimonyContext.items.length);
  assert.equal(JSON.stringify(testimonyContext).includes('content_blob'),false);
  db.prepare('UPDATE study_transcripts SET content_markdown=? WHERE id=?').run('37 datos '.repeat(20000),'transcript');
  const budget = await readPrivateSourceContext(vault,['study-recordings'],'37',1000);
  assert.equal(budget.truncated,true); assert.equal(budget.items.some(row=>row.contentScope==='record'),false);
  console.log('Private source ownership, domain isolation, complete pagination, context and concurrent revision contracts passed.');
} finally {
  globalThis.fetch = originalFetch; database?.closeDb(); runtime.restore();
  fs.rmSync(temporary, {recursive:true,force:true});
}
