import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => Promise.resolve(readSource(relative));

async function sourceFiles(root, extensions = new Set(['.ts', '.tsx'])) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (extensions.has(path.extname(entry.name))) result.push(absolute);
    }
  }
  await visit(path.join(repoRoot, root));
  return result;
}

test('the distributable contains the privacy policy and controller checklist', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.scripts['privacy:verify'], 'node --test scripts/test-privacy-compliance.mjs');
  assert.ok(pkg.build.extraResources.some((item) => item.from === 'PRIVACY.md' && item.to === 'legal/PRIVACY.md'));
  assert.ok(pkg.build.extraResources.some((item) => item.from === 'legal' && item.to === 'legal'));
  assert.equal(existsSync(path.join(repoRoot, 'legal/RGPD_DEPLOYMENT_CHECKLIST.md')), true);

  const settings = await read('src/views/Settings.tsx');
  assert.match(settings, /data-testid="about-privacy"/);
  assert.match(settings, /data-testid="about-gdpr"/);
  assert.match(settings, /data-testid="about-third-party-licenses"/);
  assert.match(settings, /data-testid="about-transparency-security"/);
  // The privacy, GDPR and licenses cards open a localized in-app modal instead of
  // launching an external markdown file (which only existed in Spanish).
  assert.match(settings, /setOpenLegalDoc\('privacy'\)/);
  assert.match(settings, /setOpenLegalDoc\('gdpr'\)/);
  assert.match(settings, /setOpenLegalDoc\('licenses'\)/);
  assert.match(settings, /<LegalDocModal/);
  assert.match(settings, /blob\/main\/PRIVACY\.md/);
  assert.match(settings, /blob\/v\$\{__APP_VERSION__\}\/LICENSE/);
  assert.match(settings, /data-testid="source-code"/);
  assert.match(settings, /security\/advisories\/new/);
  assert.match(settings, /no es una certificación/);

  // The in-app modal content links back to the authoritative documents and is
  // authored per UI language (no Spanish leaks into a non-Spanish UI).
  const legalDocs = await read('src/legalDocs.ts');
  assert.match(legalDocs, /blob\/main\/PRIVACY\.md/);
  assert.match(legalDocs, /blob\/main\/legal\/RGPD_DEPLOYMENT_CHECKLIST\.md/);
  assert.match(legalDocs, /blob\/main\/THIRD_PARTY_NOTICES\.md/);
  for (const key of ['es:', 'en:', 'fr:', 'de:', 'pt:', "'pt-BR':", 'it:']) {
    assert.ok(legalDocs.includes(key), `legalDocs must cover the ${key} language`);
  }
  assert.match(legalDocs, /cannot grade, profile or evaluate students/);

  for (const source of await Promise.all(['@main', '@bridge', '@api'].map(read))) {
    assert.match(source, /openPrivacyPolicy/);
  }
});

test('the policy states the real local and controller boundaries without an invalid blanket waiver', async () => {
  const policy = await read('PRIVACY.md');
  const normalized = policy.replace(/\s+/g, ' ');
  for (const marker of [
    'does not incorporate advertising, telemetry, remote analytics',
    'does not use AI to rate, grade, rank, profile, or evaluate',
    'does not in itself create a legal basis',
    'does not eliminate mandatory legal obligations',
    'Articles 13 and 14 of the GDPR',
    'Article 28 GDPR',
    'impact assessment',
    'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    'https://www.aepd.es/',
  ]) assert.match(normalized, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.doesNotMatch(policy, /Nodus (?:cumple|garantiza) (?:íntegramente|totalmente|oficialmente)|el usuario es el único responsable/i);
});

test('no production bridge can send student work to AI for grading, feedback or evaluation', async () => {
  assert.equal(existsSync(path.join(repoRoot, 'electron/ai/studyGrading.ts')), false);
  const sources = await Promise.all([
    '@main',
    '@bridge',
    '@api',
    'electron/ai/assessmentImport.ts',
    'electron/ai/studyGuide.ts',
    'src/views/TeachingGradesView.tsx',
    'src/components/StudyTestGenerator.tsx',
  ].map(read));
  for (const source of sources) {
    assert.doesNotMatch(source, /teaching:feedback:draft|['"]study:grading:run['"]|['"]study:answer['"]|draftStudentFeedback|gradeStudyAnswer|cancelStudyGrading/);
  }
  const tasks = await read('shared/studyAi.ts');
  assert.doesNotMatch(tasks, /['"]grading['"]/);

  const immersion = await read('electron/ai/immersion.ts');
  assert.match(immersion, /assessment: null/);
  assert.doesNotMatch(immersion, /respuesta_del_estudiante|EVALUA LA RESPUESTA|open → AI|heuristic fallback/i);
});

test('teaching AI modules cannot reach the student roster', async () => {
  // The shipped boundary is that the AI never receives roster data at all — stronger
  // than receiving it pseudonymised. It holds because electron/ai and the roster are
  // physically disjoint, so that disjointness is what has to be enforced. Today this
  // passes trivially; it fails the day someone imports the roster into a prompt.
  // Comments are stripped first: studentPrivacyContext.ts documents this very rule
  // and would otherwise flag itself.
  const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const file of await sourceFiles('electron/ai')) {
    const code = stripComments(await readFile(file, 'utf8'));
    const relative = path.relative(repoRoot, file);
    assert.doesNotMatch(code, /teachingGroupsRepo/, `${relative}: teaching AI must not import the roster repo`);
    assert.doesNotMatch(code, /teaching_students/, `${relative}: teaching AI must not read the roster table`);
    assert.doesNotMatch(code, /teachingAttendanceRepo|teaching_attendance/, `${relative}: teaching AI must not read attendance`);
  }

  // The dormancy note is load-bearing documentation: without it the next reader sees
  // an unused pseudonymisation layer and concludes the guarantee is active.
  const context = await read('electron/ai/studentPrivacyContext.ts');
  assert.match(context, /THIS LAYER IS DORMANT/);
  assert.match(context, /never receives roster data at all/);

  // What actually protects the one roster-adjacent model path (the MCP gradebook).
  const grid = await read('shared/assessment/grid.ts');
  assert.match(grid, /export function anonymousGrid/);
  assert.match(grid, /new Set<string>\(\[GRID_COL\.givenNames, GRID_COL\.surnames\]\)/);
  assert.match(await read('electron/mcp/tools.ts'), /anonymousGrid\(/);
});

test('remote vault publication excludes credentials, files and student administration tables', async () => {
  const [snapshot, secretStore, backup, settings] = await Promise.all([
    read('electron/serverSync/serverSnapshot.ts'),
    read('electron/secrets/secretStore.ts'),
    read('electron/export/exportImport.ts'),
    read('src/views/Settings.tsx'),
  ]);
  assert.match(snapshot, /TEACHING_SERVER_TABLES = \[[\s\S]*'teaching_exams'[\s\S]*'teaching_rubrics'/);
  // Comments explain the wildcards that were REMOVED, and naming a pattern is not using it,
  // so these assertions read the code with the prose stripped out.
  const snapshotCode = snapshot.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(snapshotCode, /table\.startsWith\('teaching_'\)/);
  // The same mistake lived in the other family: `study_` was selected by prefix, which swept
  // in class recordings, attempt records and grading runs. Every table is now named.
  assert.doesNotMatch(snapshotCode, /table\.startsWith\('study_'\)/);
  for (const sensitive of ['study_recordings', 'study_attempts', 'study_grading_runs', 'study_mastery']) {
    assert.doesNotMatch(snapshotCode, new RegExp(`'${sensitive}'`), `${sensitive} must not be publishable`);
  }
  for (const sensitive of ['teaching_students', 'teaching_groups', 'teaching_grade_entries', 'teaching_rubric_evaluations', 'teaching_attendance', 'teaching_attendance_holidays']) {
    assert.doesNotMatch(snapshotCode, new RegExp(`['"]${sensitive}['"]`));
  }
  assert.match(snapshot, /embedding[\s\S]*file_path[\s\S]*api_key[\s\S]*access_token/);
  assert.match(secretStore, /nodus_server_token\.bin/);
  assert.match(backup, /nodusServerEnabled = false/);
  assert.match(backup, /obj\.nodusServerUrl = ''/);
  // Embeddings deliberately left OFF this list: idea vectors DO travel now, behind their own
  // switch, and a privacy notice that claims otherwise is worse than no notice at all.
  assert.match(settings, /Nunca: archivos PDF, audio, claves API, contraseñas, rutas locales/);
  assert.doesNotMatch(settings, /Nunca:[^']*embeddings/, 'the panel must not claim embeddings never travel');
  assert.match(settings, /Incluir vectores semánticos/, 'the vectors switch must be offered');
  assert.match(settings, /listas de alumnos, grupos, calificaciones/);
});

test('every microphone access is blocked by the just-in-time recording notice', async () => {
  const files = await sourceFiles('src');
  const microphoneSources = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (!source.includes('getUserMedia(')) continue;
    microphoneSources.push(path.relative(repoRoot, file));
    assert.match(source, /confirmMicrophonePrivacy/);
    assert.ok(source.indexOf('confirmMicrophonePrivacy()') < source.indexOf('getUserMedia('), `${file}: notice must precede microphone access`);
  }
  // La captura de audio se extrajo a un componente compartido por Estudio y Testimonios,
  // así que ahora hay UN solo punto de acceso al micrófono además del dictado — que es
  // menos superficie que auditar, no más.
  assert.deepEqual(microphoneSources.sort(), [
    'src/components/editor/StudyDictation.tsx',
    'src/components/media/LocalAudioRecorder.tsx',
  ]);
  const notice = await read('src/privacyNotices.tsx');
  assert.match(notice, /base jurídica y autorización/);
  assert.match(notice, /no sustituye el consentimiento/);
  // The notice offers three choices — accept once, accept and remember, reject —
  // and a remembered acceptance skips it on later sessions.
  assert.match(notice, /confirmWithRemember/);
  assert.match(notice, /micPrivacyAcknowledged/);
  assert.match(notice, /Aceptar y no volver a mostrar/);
  assert.match(notice, /Rechazar/);
});

test('file pickers open directly, with no import privacy modal', async () => {
  // Native pickers stay centralised in a single audited entry point, so future
  // importers cannot quietly reach dialog.showOpenDialog on their own.
  const electronFiles = await sourceFiles('electron', new Set(['.ts']));
  const rawDialogs = [];
  for (const file of electronFiles) {
    const source = await readFile(file, 'utf8');
    if (source.includes('dialog.showOpenDialog')) rawDialogs.push(path.relative(repoRoot, file));
  }
  assert.deepEqual(rawDialogs, ['electron/privacy.ts']);

  // That entry point opens the OS picker directly: file imports are processed
  // locally and no longer interrupt the user with an in-app consent modal.
  const mainNotice = await read('electron/privacy.ts');
  assert.doesNotMatch(mainNotice, /privacy:fileImport:request|requestFileImportPrivacy/);
  assert.doesNotMatch(mainNotice, /showMessageBox/);

  // No renderer surface keeps the removed file-import gate.
  const rendererFiles = await sourceFiles('src');
  for (const file of rendererFiles) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /confirmFileImportPrivacy/, `${file}: the file-import privacy gate must be gone`);
  }

  // The bridge host survives for the AI-processing prompt, but neither the preload
  // nor the typed API still carries the file-import modal plumbing.
  const [rendererNotice, app, preload, apiTypes, ipc] = await Promise.all([
    read('src/privacyNotices.tsx'),
    read('src/App.tsx'),
    read('@bridge'),
    read('@api'),
    read('@main'),
  ]);
  assert.match(rendererNotice, /PrivacyRequestHost/);
  assert.match(app, /<PrivacyRequestHost\s*\/>/);
  for (const source of [rendererNotice, preload, apiTypes, ipc]) {
    assert.doesNotMatch(source, /FileImportPrivacyRequest|privacy:fileImport/);
  }
});

test('new study materials use a remembered in-app AI processing decision', async () => {
  const [notice, settings, defaults, preload, apiTypes, ipc, consent, policy, knowledge] = await Promise.all([
    read('src/privacyNotices.tsx'),
    read('src/views/Settings.tsx'),
    read('shared/defaultAppSettings.ts'),
    read('@bridge'),
    read('@api'),
    read('@main'),
    read('electron/ai/studyKnowledgeConsent.ts'),
    read('electron/ai/studyAiPolicy.ts'),
    read('electron/ai/studyKnowledge.ts'),
  ]);
  assert.match(notice, /study-material-ai-processing-prompt/);
  assert.match(notice, /No volver a preguntar/);
  assert.match(notice, /Sí, procesar/);
  assert.match(notice, /No, ahora no/);
  assert.match(settings, /data-testid="study-knowledge-auto-process"/);
  assert.match(defaults, /studyKnowledgeAutoProcess:\s*'ask'/);
  assert.match(consent, /decision\.process \? 'always' : 'never'/);
  assert.match(policy, /externalConsentModelKey/);
  assert.match(knowledge, /autoPreference !== 'always'/);
  for (const source of [preload, apiTypes, ipc]) {
    assert.match(source, /StudyMaterialAiProcessingRequest|study:knowledge:processing:resolve/);
  }
});

test('public copy matches the no-AI-student-evaluation product boundary', async () => {
  const [readme, faq, landing, teachingDemo] = await Promise.all([
    read('README.md'), read('site/faq.js'), read('site/index.html'), read('site/demo/teaching.html'),
  ]);
  for (const source of [readme, faq, landing, teachingDemo]) {
    assert.doesNotMatch(source, /When AI assists with feedback or assessment|student-name pseudonymisation|códigos seudónimos locales siempre que interviene la IA/i);
    assert.match(source, /(?:never|does not use AI to) [\s\S]{0,80}(?:grade|evaluate)[\s\S]{0,40}students|nunca (?:califica|envía)[\s\S]{0,120}(?:estudiantes|alumnado)|nunca evalúa estudiantes/i);
  }
});

test('only the five named image tables can produce a published asset, and no document can', async () => {
  const snapshot = await read('electron/serverSync/serverSnapshot.ts');
  // ASSET_SOURCES is the single code path that turns a database blob into something the
  // server can receive. Anything added to it becomes publishable, so its size is pinned.
  const sources = snapshot.slice(snapshot.indexOf('export const ASSET_SOURCES'), snapshot.indexOf('const IMAGE_SIGNATURES'));
  assert.ok(sources.length > 0, 'the ASSET_SOURCES block was not found — this test is reading nothing');
  assert.equal((sources.match(/table: '/g) ?? []).length, 5, 'exactly five named image tables may produce an asset');
  assert.match(sources, /table: 'decorative_images'/);
  assert.match(sources, /table: 'person_portraits'/);
  assert.match(sources, /table: 'world_images'/);
  assert.match(sources, /table: 'map_images'/);
  assert.match(sources, /entity_kind = 'deep_research'/, 'immersion illustrations are not published');

  // The third source is the one that needs watching. An attachment column takes any file the
  // user drops on it, so it may only be read under a size ceiling applied in SQL — before the
  // blob is loaded, which is the difference between skipping a 5 GB video and reading it.
  // What makes it safe at all is the sniffer, asserted at the bottom of this test.
  assert.match(sources, /table: 'db_attachments'/);
  assert.match(
    sources,
    /kind: 'db_attachment',[\s\S]*?where: `blob IS NOT NULL AND length\(blob\) > 0 AND length\(blob\) <= \$\{MAX_ASSET_BYTES\}`/,
    'database attachments are read only under the size ceiling, in SQL'
  );

  // Audio metadata lives in audio_clips and the files themselves on disk; a work's PDF is
  // outside the vault entirely. Neither may appear as a source of publishable bytes.
  for (const forbidden of ['audio_clips', 'study_recordings', 'study_materials', 'archive_item_files']) {
    assert.doesNotMatch(sources, new RegExp(`table: '${forbidden}'`));
  }
  // The server refuses by content, not by declaration, and WAV must not pass as WEBP.
  // The server refuses by content, not by declaration, and a WAV must not pass as a WEBP.
  const { sniffImageMime } = await import('../server/lib/assets.mjs');
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(20)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([26, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(18)]);
  assert.equal(sniffImageMime(wav), null, 'audio sharing the RIFF header is still refused');
  assert.equal(sniffImageMime(webp), 'image/webp');
  assert.equal(sniffImageMime(Buffer.from('%PDF-1.7 padded out past twelve bytes')), null);
});

test('a replica can only send back content its own user authored', async () => {
  const [desktop, generatedDesktopTables, syncTables] = await Promise.all([
    read('electron/serverSync/outboxTriggers.ts'),
    read('electron/serverSync/generatedMutableTables.ts'),
    read('electron/db/syncTables.ts'),
  ]);
  const { MUTABLE_TABLES } = await import('../server/lib/core/mutations.mjs');
  const serverTables = Object.keys(MUTABLE_TABLES);
  // Desktop consumes the generated TypeScript view of the same registry as the server. Read
  // that generated source here so this privacy assertion cannot be bypassed by a runtime shim.
  const desktopList = generatedDesktopTables.slice(
    generatedDesktopTables.indexOf('export const MUTABLE_TABLES'),
    generatedDesktopTables.indexOf('] as const')
  );
  assert.match(desktop, /from '\.\/generatedMutableTables'/);

  // Anything derived from the owner's corpus, and everything about students, testimonies or
  // prosopography, must be absent from both whitelists.
  for (const forbidden of [
    'works', 'ideas', 'edges', 'evidence', 'passages', 'themes', 'gaps', 'authors',
    'teaching_students', 'teaching_groups', 'teaching_grade_entries',
    'testimony_interviews', 'prosop_audit_log', 'settings',
  ]) {
    assert.ok(!serverTables.includes(forbidden), `${forbidden} must not be writable from a replica`);
    assert.doesNotMatch(desktopList, new RegExp(`["']${forbidden}["']`), `${forbidden} must not be queued by a replica`);
  }
  for (const allowed of ['notes', 'writing_saved_drafts', 'immersion_sessions']) {
    assert.ok(serverTables.includes(allowed));
    assert.match(desktopList, new RegExp(`["']${allowed}["']`));
  }
  // decorative_images travels only as a Deep Research illustration, never an immersion one.
  assert.equal(MUTABLE_TABLES.decorative_images.require.entity_kind, 'deep_research');
  // A reader's database has no triggers at all, which is the guarantee that holds even if
  // every other check were wrong.
  assert.match(desktop, /ensureOutboxTriggers\(db: Database\.Database, enabled: boolean\)/);
  assert.match(await read('electron/db/database.ts'), /mayQueueMutations/);
  // The queue is this machine's own record and must never travel in a sync package.
  assert.match(syncTables, /'server_outbox'/);
});

test('the server never receives an AI provider key', async () => {
  const [api, corpus, queries] = await Promise.all([
    read('server/lib/routes/api.mjs'),
    read('server/lib/routes/corpus.mjs'),
    read('server/lib/core/corpusQueries.mjs'),
  ]);
  for (const source of [api, corpus, queries]) {
    assert.doesNotMatch(source, /apiKey|api_key|OPENAI_API_KEY|anthropic/i);
  }
  // The chat endpoint hands over retrieval and a budget, and the client calls its own
  // provider. A server that produced answers would be the first place in this project to
  // hold a third-party credential.
  assert.match(api, /contextPackage/);
  assert.match(api, /contextReadQuery\(snapshot, input, space\.revision\)/);
  assert.match(queries, /citationScheme/);
});

test('a connected vault has a screen, and a revoked one says so', async () => {
  const [settings, panel, preload, types] = await Promise.all([
    read('src/views/Settings.tsx'),
    read('src/components/ConnectedVaultsPanel.tsx'),
    read('electron/preload/api.ts'),
    read('shared/types.ts'),
  ]);
  // The IPC existed with nothing calling it, so a replica that lost access simply stopped
  // updating and never told anyone. The panel is what makes that state visible, and it is
  // its own component precisely so scripts/test-connected-vaults-panel.mjs can render it.
  assert.match(panel, /data-testid="connected-vault-panel"/);
  assert.match(panel, /data-testid="replica-revoked-notice"/);
  assert.match(settings, /<ConnectedVaultsPanel/);
  assert.match(settings, /window\.nodus\.replicaOverview\(\)/);
  assert.match(settings, /window\.nodus\.replicaSyncNow\(/);
  assert.match(settings, /window\.nodus\.replicaDetach\(/);
  // Disconnecting must never read as deleting.
  assert.match(settings, /se quedan en este equipo; solo deja de sincronizarse/);
  // A reader is told plainly that their work stays put.
  assert.match(panel, /se queda en este equipo y nunca se envía al vault principal/);
  for (const channel of ['vaults:replicaOverview', 'vaults:replicaSyncNow', 'vaults:replicaDetach']) {
    assert.match(preload, new RegExp(channel.replace(':', ':')), `${channel} is not bridged`);
  }
  assert.match(types, /pendingMutations: number/);
  assert.match(types, /rejectedMutations: number/);
});

test('the vectors switch exists and the privacy notice matches what really travels', async () => {
  const [privacy, settings, publisher] = await Promise.all([
    read('PRIVACY.md'),
    read('src/views/Settings.tsx'),
    read('electron/serverSync/serverSyncService.ts'),
  ]);
  // PRIVACY.md used to state outright that embeddings were never uploaded. They are now,
  // behind a switch — and a privacy notice that contradicts the code is the worst outcome.
  assert.doesNotMatch(privacy, /Never uploads[^.]*embeddings/i, 'the notice still claims embeddings never travel');
  assert.match(privacy, /Semantic search vectors/);
  assert.match(privacy, /no longer accurate and the statement has been corrected/);
  assert.match(privacy, /ideas and audited document profiles/);
  assert.match(privacy, /Vectors derived from passages follow\s+the passages switch/);
  assert.match(settings, /nodusServerIncludeVectors/);
  assert.match(settings, /Incluye las representaciones auditadas de documentos/);
  // Off means off.
  assert.match(publisher, /if \(!config\.includeVectors\) return;/);
  // Passage vectors are gated by the passages switch, not by the vectors one alone.
  assert.match(publisher, /(?:config|publicationConfig)\.includePassages \? \['ideas', 'documents', 'passages'\] : \['ideas', 'documents'\]/);
});
