import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The TypeScript/electron require hooks live in scripts/lib so the server suites can drive
// the same production modules without a second, subtly different copy of them.
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-mcp-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-mcp.mjs'), '--electron-mcp-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const testParent = process.env.NODUS_USERDATA
  ? path.resolve(process.env.NODUS_USERDATA)
  : process.env.NODUS_QA_ROOT
    ? path.resolve(process.env.NODUS_QA_ROOT)
    : os.tmpdir();
await mkdir(testParent, { recursive: true });
const root = await mkdtemp(path.join(testParent, 'nodus-mcp-test-'));
installRuntimeHooks(root);

function FakeServer() {
  this.tools = new Map();
}

FakeServer.prototype.registerTool = function registerTool(name, meta, handler) {
  assert.equal(this.tools.has(name), false, `duplicate MCP tool ${name}`);
  this.tools.set(name, { meta, handler });
};

try {
  const { registerTools, registerToolsForVault } = require(path.join(repoRoot, 'electron/mcp/tools.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const server = new FakeServer();
  registerTools(server);

  const expectedTools = [
    'nodus_get_capabilities',
    'nodus_list_ideas',
    'nodus_get_idea',
    'nodus_get_ideas_by_work',
    'nodus_search_ideas',
    'nodus_analyze_passage',
    'nodus_get_copilot_idea',
    'nodus_compose_insertion',
    'nodus_list_debates',
    'nodus_get_debate',
    'nodus_list_gaps',
    'nodus_get_gap',
    'nodus_get_author_relations',
    'nodus_search_authors',
    'nodus_read_author_synthesis',
    'nodus_get_author_synthesis',
    'nodus_list_works',
    'nodus_get_work',
    'nodus_get_document_profile',
    'nodus_search_documents',
    'nodus_search_hybrid',
    'nodus_list_work_passages',
    'nodus_get_passage',
    'nodus_search_passages',
    'nodus_list_themes',
    'nodus_get_theme',
    'nodus_list_tutor_routes',
    'nodus_get_tutor_route',
    'nodus_list_projects',
    'nodus_get_project',
    'nodus_search_notes',
    'nodus_list_notes_tree',
    'nodus_get_note',
    'nodus_list_coverage_questions',
    'nodus_get_coverage_question',
    'nodus_ask_coverage_question',
    'nodus_writing_snapshot',
    'nodus_generate_writing_draft',
    'nodus_save_writing_draft',
    'nodus_list_writing_drafts',
    'nodus_get_writing_draft',
    'nodus_list_deep_research_reports',
    'nodus_get_deep_research_report',
    'nodus_generate_deep_research',
    'nodus_finalize_deep_research',
    'nodus_enqueue_deep_research',
    'nodus_list_deep_research_jobs',
    'nodus_get_deep_research_job',
    'nodus_cancel_deep_research_job',
    'nodus_create_folder',
    'nodus_update_folder_summary',
    'nodus_create_note',
    'nodus_update_note',
    'nodus_list_persons',
    'nodus_get_person',
    'nodus_list_kin_suggestions',
    'nodus_list_events',
    'nodus_list_archive_items',
    'nodus_get_archive_item',
    'nodus_search_archive',
    'nodus_list_databases',
    'nodus_enqueue_database_deep_research',
    'nodus_preview_database_deep_research',
    'nodus_list_database_deep_research_jobs',
    'nodus_get_database_deep_research_job',
    'nodus_cancel_database_deep_research_job',
    'nodus_list_database_deep_research_reports',
    'nodus_get_database_deep_research_reports',
    'nodus_get_database_schema',
    'nodus_query_database',
    'nodus_get_database_row',
    'nodus_list_database_views',
    'nodus_list_database_templates',
    'nodus_list_database_automations',
    'nodus_list_database_forms',
    'nodus_list_pages',
    'nodus_search_pages',
    'nodus_get_page',
    'nodus_list_page_comments',
    'nodus_create_page',
    'nodus_update_page',
    'nodus_replace_page_markdown',
    'nodus_create_page_comment',
    'nodus_study_get_workspace',
    'nodus_study_get_document',
    'nodus_study_search',
    'nodus_study_list_questions',
    'nodus_study_get_progress',
    'nodus_study_get_schedule',
    'nodus_teaching_list_groups',
    'nodus_teaching_get_group',
    'nodus_teaching_list_assessment_plans',
    'nodus_teaching_get_assessment_plan',
    'nodus_teaching_get_gradebook',
    'nodus_teaching_list_exams',
    'nodus_teaching_get_exam',
    'nodus_teaching_list_rubrics',
    'nodus_teaching_get_rubric',
    'nodus_create_database_row',
    'nodus_set_database_cell',
    'nodus_world_get_overview',
    'nodus_world_search',
    'nodus_world_list_characters',
    'nodus_world_get_character',
    'nodus_world_create_character',
    'nodus_world_update_character',
    'nodus_world_list_places',
    'nodus_world_get_place',
    'nodus_world_create_place',
    'nodus_world_update_place',
    'nodus_world_list_groups',
    'nodus_world_get_group',
    'nodus_world_create_group',
    'nodus_world_update_group',
    'nodus_world_list_scenes',
    'nodus_world_get_scene',
    'nodus_world_create_scene',
    'nodus_world_update_scene',
    'nodus_world_list_secrets',
    'nodus_world_get_secret',
    'nodus_world_create_secret',
    'nodus_world_update_secret',
    'nodus_world_list_entries',
    'nodus_world_get_entry',
    'nodus_world_list_unresolved_links',
    'nodus_world_create_article',
    'nodus_world_update_article',
    'nodus_world_list_threads',
    'nodus_world_get_thread',
    'nodus_world_get_story_board',
    'nodus_world_create_thread',
    'nodus_world_update_thread',
    'nodus_world_list_rules',
    'nodus_world_get_rule',
    'nodus_world_create_rule',
    'nodus_world_update_rule',
    'nodus_world_list_questions',
    'nodus_world_get_question',
    'nodus_world_create_question',
    'nodus_world_update_question',
    'nodus_world_list_maps',
    'nodus_world_get_map',
    'nodus_world_get_manuscript',
    'nodus_world_update_scene_text',
    'nodus_world_get_continuity',
    'nodus_world_get_calendar',
    'nodus_prosop_get_design',
    'nodus_prosop_list_population',
    'nodus_prosop_search',
    'nodus_prosop_get_person',
    'nodus_prosop_list_statements',
    'nodus_prosop_get_coverage',
    'nodus_prosop_run_analysis',
    'nodus_prosop_create_proposal',
  ];
  assert.deepEqual([...server.tools.keys()], expectedTools);

  // MCP clients can cache tools/list across reconnects. The complete read-only
  // surface therefore has to remain stable when the active vault changes, while
  // writes/actions keep their vault-type gate. Registering with null still keeps
  // the complete surface (what the FakeServer above exercises).
  const surfaceFor = (vaultType) => {
    const scoped = new FakeServer();
    registerToolsForVault(scoped, vaultType);
    return new Set(scoped.tools.keys());
  };
  const readOnlyTools = [...server.tools]
    .filter(([, entry]) => entry.meta.annotations?.readOnlyHint === true)
    .map(([name]) => name);
  const retrievalVerbs = new Set(['get', 'list', 'search', 'query']);
  const hybridGetTools = new Set(['nodus_get_author_synthesis']);
  assert.deepEqual(
    [...server.tools]
      .filter(([name, entry]) =>
        name.split('_').some((part) => retrievalVerbs.has(part))
          && !hybridGetTools.has(name)
          && entry.meta.annotations?.readOnlyHint !== true)
      .map(([name]) => name),
    [],
    'every get/list/search/query tool must declare itself read-only so it joins the stable cross-vault surface',
  );
  assert.ok(server.tools.get('nodus_read_author_synthesis').meta.annotations.readOnlyHint, 'the hybrid author getter has a stable read-only alternative');
  const assertStableReads = (surface, label) => {
    assert.deepEqual(
      readOnlyTools.filter((name) => !surface.has(name)),
      [],
      `${label} must retain every read-only tool so a cached MCP catalogue remains valid after a vault switch`,
    );
  };
  const docencia = surfaceFor('docencia');
  assert.ok(docencia.has('nodus_get_capabilities') && docencia.has('nodus_create_note'), 'docencia keeps the universal tools');
  assert.ok(docencia.has('nodus_teaching_get_gradebook') && docencia.has('nodus_study_get_workspace'), 'docencia exposes teaching + study layers');
  assert.ok(docencia.has('nodus_list_ideas') && docencia.has('nodus_list_databases') && docencia.has('nodus_list_persons'), 'docencia retains every readable layer');
  assert.ok(!docencia.has('nodus_create_database_row') && !docencia.has('nodus_create_page') && !docencia.has('nodus_world_create_character'), 'docencia still hides incompatible writes');
  const databases = surfaceFor('databases');
  assert.ok(databases.has('nodus_create_database_row') && databases.has('nodus_set_database_cell') && databases.has('nodus_create_page'), 'databases exposes rows and universal-page authoring');
  assert.ok(databases.has('nodus_teaching_get_gradebook') && databases.has('nodus_list_ideas') && databases.has('nodus_study_get_workspace'), 'databases retains every readable layer');
  assert.ok(!databases.has('nodus_prosop_run_analysis') && !databases.has('nodus_world_create_character'), 'databases hides incompatible actions');
  const academic = surfaceFor('academic');
  assert.ok(academic.has('nodus_list_ideas') && academic.has('nodus_search_passages'), 'academic exposes the research surface');
  assert.ok(academic.has('nodus_list_databases') && academic.has('nodus_teaching_get_gradebook') && academic.has('nodus_list_persons'), 'academic retains every readable layer');
  assert.ok(!academic.has('nodus_create_database_row') && !academic.has('nodus_create_page') && !academic.has('nodus_prosop_run_analysis'), 'academic hides incompatible actions');
  const genealogy = surfaceFor('genealogy');
  assert.ok(genealogy.has('nodus_list_persons') && genealogy.has('nodus_list_ideas'), 'genealogy exposes records + research layers');
  assert.ok(genealogy.has('nodus_list_databases') && genealogy.has('nodus_teaching_get_gradebook'), 'genealogy retains other readable layers');
  assert.ok(!genealogy.has('nodus_create_database_row') && !genealogy.has('nodus_world_create_character'), 'genealogy hides incompatible writes');
  const prosopography = surfaceFor('prosopography');
  assert.ok(
    prosopography.has('nodus_prosop_get_design')
      && prosopography.has('nodus_prosop_search')
      && prosopography.has('nodus_prosop_run_analysis'),
    'prosopography exposes its evidence-first read and analysis surface',
  );
  assert.ok(
    prosopography.has('nodus_list_persons')
      && prosopography.has('nodus_list_databases')
      && prosopography.has('nodus_teaching_get_gradebook'),
    'prosopography retains every readable layer',
  );
  const worldbuilding = surfaceFor('worldbuilding');
  assert.ok(
    worldbuilding.has('nodus_world_get_overview')
      && worldbuilding.has('nodus_world_create_character')
      && worldbuilding.has('nodus_world_get_manuscript')
      && worldbuilding.has('nodus_world_get_continuity'),
    'worldbuilding exposes its complete namespaced read and non-destructive authoring surface',
  );
  assert.ok(
    worldbuilding.has('nodus_list_ideas')
      && worldbuilding.has('nodus_list_persons')
      && worldbuilding.has('nodus_list_databases')
      && worldbuilding.has('nodus_prosop_search'),
    'worldbuilding retains every readable layer',
  );
  assert.ok(
    !academic.has('nodus_world_create_character') && !academic.has('nodus_world_update_character'),
    'worldbuilding writes fail closed outside a Worldbuilding vault',
  );
  for (const [label, surface] of [
    ['docencia', docencia],
    ['databases', databases],
    ['academic', academic],
    ['genealogy', genealogy],
    ['prosopography', prosopography],
    ['worldbuilding', worldbuilding],
  ]) assertStableReads(surface, label);
  assert.equal(surfaceFor(null).size, expectedTools.length, 'a null vault type registers the full surface');

  seedMcpDatabase(getDb());

  const capabilitiesRaw = await callToolRaw(server, 'nodus_get_capabilities');
  // Object results mirror into structuredContent (no outputSchema declared) while
  // still carrying the text block for older clients.
  assert.ok(capabilitiesRaw.structuredContent, 'object results expose structuredContent');
  assert.deepEqual(
    capabilitiesRaw.structuredContent,
    JSON.parse(capabilitiesRaw.content[0].text),
    'structuredContent mirrors the text block'
  );
  const capabilities = capabilitiesRaw.structuredContent;
  assert.equal(capabilities.version, '0.0.0-test', 'capabilities reports the running app version');
  assert.match(capabilities.access.read, /All read-only MCP tools stay available across vault switches/);
  assert.match(capabilities.access.write, /limited to the active vault type/);
  assert.equal(capabilities.counts.works, 3);
  assert.equal(capabilities.counts.notes, 1);
  assert.equal(capabilities.counts.writingDrafts, 0, 'capabilities reports the saved writing catalogue size');
  assert.equal(capabilities.counts.deepResearchReports, 0, 'capabilities reports the persistent Deep Research gallery size');
  assert.equal(capabilities.counts.themes, 1);
  assert.equal(capabilities.counts.passages, 2);
  assert.equal(capabilities.counts.databases, 0, 'capabilities reports the databases count');
  assert.equal(capabilities.counts.persons, 0, 'capabilities reports the records-layer person count');
  assert.equal(capabilities.counts.events, 0, 'capabilities reports the records-layer event count');
  assert.equal(capabilities.counts.archiveItems, 0, 'capabilities reports the archive count');
  assert.equal(capabilities.counts.teachingGroups, 0, 'capabilities reports the teaching group count');
  assert.equal(capabilities.counts.teachingStudents, 0, 'capabilities reports the teaching student count');
  assert.equal(capabilities.counts.teachingAssessmentPlans, 0, 'capabilities reports the assessment-plan count');
  assert.equal(capabilities.counts.teachingExams, 0, 'capabilities reports the exam count');
  assert.equal(capabilities.counts.teachingRubrics, 0, 'capabilities reports the rubric count');
  assert.equal(capabilities.counts.worldCharacters, 0, 'capabilities reports Worldbuilding characters');
  assert.equal(capabilities.counts.worldScenes, 0, 'capabilities reports Worldbuilding scenes');
  assert.equal(capabilities.counts.worldEntries, 0, 'capabilities reports the unified world index');
  assert.ok(Array.isArray(capabilities.enums.eventTypes), 'capabilities exposes the event-type vocabulary');
  assert.ok(Array.isArray(capabilities.enums.worldEntryKinds), 'capabilities exposes the Worldbuilding vocabulary');
  assert.ok(capabilities.vault.active.type, 'capabilities exposes the active vault type');

  // Read-only genealogy tools are wired and safe on a non-genealogy corpus, and use
  // the same paginated shape as every other list tool.
  const personList = await callTool(server, 'nodus_list_persons', { limit: 10, offset: 0 });
  assert.deepEqual(
    personList,
    { persons: [], total: 0, limit: 10, offset: 0, hasMore: false },
    'nodus_list_persons callable, empty without a records layer'
  );
  const kinList = await callTool(server, 'nodus_list_kin_suggestions', { limit: 10, offset: 0 });
  assert.deepEqual(
    kinList,
    { suggestions: [], total: 0, limit: 10, offset: 0, hasMore: false },
    'nodus_list_kin_suggestions callable, empty'
  );
  const emptyEvents = await callTool(server, 'nodus_list_events', { limit: 10, offset: 0 });
  assert.equal(emptyEvents.total, 0, 'nodus_list_events callable, empty without a records layer');
  const emptyArchive = await callTool(server, 'nodus_list_archive_items', { limit: 10, offset: 0 });
  assert.equal(emptyArchive.total, 0, 'nodus_list_archive_items callable, empty without an archive');

  // Records layer: persons, events (timeline) and the evidence archive.
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const archiveRepo = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const juan = entities.createPerson({ displayName: 'Juan García', sex: 'male', birthDate: '1890' });
  const maria = entities.createPerson({ displayName: 'María López', sex: 'female' });
  entities.createEvent({
    type: 'baptism',
    label: 'Bautismo de Juan',
    date: '1890-05-02',
    participants: [
      { personId: juan.personId, role: 'principal' },
      { personId: maria.personId, role: 'mother' },
    ],
  });
  entities.createEvent({
    type: 'marriage',
    label: 'Matrimonio de Juan',
    date: '1915-11-20',
    participants: [{ personId: juan.personId, role: 'principal' }],
  });

  const allEvents = await callTool(server, 'nodus_list_events', { limit: 10, offset: 0 });
  assert.equal(allEvents.total, 2);
  assert.equal(allEvents.events[0].type, 'baptism', 'events come back in chronological order');
  assert.ok(
    allEvents.events[0].participants.some((p) => p.name === 'María López' && p.role === 'mother'),
    'events carry their participants with roles'
  );
  const baptisms = await callTool(server, 'nodus_list_events', { type: 'baptism', limit: 10, offset: 0 });
  assert.equal(baptisms.total, 1, 'events filter by type');
  const windowed = await callTool(server, 'nodus_list_events', { from: '1900', to: '1920', limit: 10, offset: 0 });
  assert.equal(windowed.total, 1, 'events filter by date window');
  assert.equal(windowed.events[0].type, 'marriage');
  const juanEvents = await callTool(server, 'nodus_list_events', { personId: juan.personId, limit: 10, offset: 0 });
  assert.equal(juanEvents.total, 2, 'events filter by participant');
  const badPersonEvents = await callToolRaw(server, 'nodus_list_events', { personId: 'per_missing', limit: 10, offset: 0 });
  assert.equal(badPersonEvents.isError, true);
  assert.equal(JSON.parse(badPersonEvents.content[0].text).error.category, 'not_found');

  const seededPersons = await callTool(server, 'nodus_list_persons', { limit: 1, offset: 0 });
  assert.equal(seededPersons.total, 2);
  assert.equal(seededPersons.hasMore, true, 'person list paginates with hasMore');

  const padronesFolder = archiveRepo.createFolder('Padrones');
  const padron = archiveRepo.createItem({
    folderId: padronesFolder.folderId,
    title: 'Padrón municipal de 1890',
    kind: 'image',
    docType: 'census_padron',
    extractedText: 'Juan García figura como jornalero en el padrón municipal de 1890.',
    description: 'Hoja del padrón con la familia García.',
    source: 'Archivo Municipal, caja 12',
    tags: ['padrón'],
  });
  archiveRepo.linkItemPerson(padron.itemId, juan.personId);
  archiveRepo.createItem({
    title: 'Partida de bautismo',
    kind: 'pdf',
    extractedText: 'Partida de bautismo de la parroquia, año 1890.',
  });

  const archiveList = await callTool(server, 'nodus_list_archive_items', { limit: 10, offset: 0 });
  assert.equal(archiveList.total, 2);
  const compactItem = archiveList.items.find((item) => item.itemId === padron.itemId);
  assert.equal('extractedText' in compactItem, false, 'archive list returns snippets, not full text');
  assert.match(compactItem.extractedTextSnippet, /jornalero/);
  assert.deepEqual(compactItem.folders, ['Padrones'], 'archive list resolves folder names');
  assert.deepEqual(compactItem.linkedPersons, ['Juan García']);
  const archiveByQuery = await callTool(server, 'nodus_list_archive_items', { query: 'jornalero', limit: 10, offset: 0 });
  assert.equal(archiveByQuery.total, 1, 'archive filters by text query');
  const archiveByKind = await callTool(server, 'nodus_list_archive_items', { kinds: ['pdf'], limit: 10, offset: 0 });
  assert.equal(archiveByKind.total, 1, 'archive filters by kind');
  const archiveByTag = await callTool(server, 'nodus_list_archive_items', { tags: ['padrón'], limit: 10, offset: 0 });
  assert.equal(archiveByTag.total, 1, 'archive filters by tag');
  const archiveByPerson = await callTool(server, 'nodus_list_archive_items', { personId: juan.personId, limit: 10, offset: 0 });
  assert.equal(archiveByPerson.total, 1, 'archive filters by linked person');
  const archiveByDocType = await callTool(server, 'nodus_list_archive_items', { docTypes: ['census_padron'], limit: 10, offset: 0 });
  assert.equal(archiveByDocType.total, 1, 'archive filters by document type');

  const fullItem = await callTool(server, 'nodus_get_archive_item', { itemId: padron.itemId });
  assert.match(fullItem.extractedText, /jornalero/, 'get_archive_item returns the full text');
  assert.equal(fullItem.source, 'Archivo Municipal, caja 12');
  const missingItem = await callToolRaw(server, 'nodus_get_archive_item', { itemId: 'ait_missing' });
  assert.equal(missingItem.isError, true);
  assert.equal(JSON.parse(missingItem.content[0].text).error.category, 'not_found');

  const archiveAiError = await callToolRaw(server, 'nodus_search_archive', { query: 'jornalero', limit: 5, minSimilarity: 0.35 });
  assert.equal(archiveAiError.isError, true, 'semantic archive search requires embeddings');
  assert.equal(JSON.parse(archiveAiError.content[0].text).error.category, 'ai_unconfigured');

  // Read-only databases-mode tools: list, schema, query (decoded values), get row.
  const dbmode = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const mdb = dbmode.createDatabase('MCP DB');
  const mName = dbmode.createColumn(mdb.id, 'Nombre', 'title');
  const mSel = dbmode.createColumn(mdb.id, 'Estado', 'select');
  const mVivo = dbmode.addOption(mSel.id, 'vivo');
  const mRow = dbmode.createRow(mdb.id);
  dbmode.setCell(mRow.id, mName.id, 'Gato');
  dbmode.setCell(mRow.id, mSel.id, mVivo.id);
  const dbList = await callTool(server, 'nodus_list_databases');
  assert.ok(dbList.databases.some((d) => d.name === 'MCP DB' && d.rows === 1), 'nodus_list_databases returns the database');
  const schema = await callTool(server, 'nodus_get_database_schema', { databaseId: mdb.id });
  assert.equal(schema.columns.length, 2, 'schema returns columns');
  assert.deepEqual(schema.columns.find((c) => c.type === 'select').options, ['vivo'], 'schema exposes option labels');
  const q = await callTool(server, 'nodus_query_database', { databaseId: mdb.id, limit: 10, offset: 0 });
  assert.equal(q.total, 1);
  assert.equal(q.rows[0].fields.Nombre, 'Gato');
  assert.equal(q.rows[0].fields.Estado, 'vivo', 'query decodes select to its label');
  const qFiltered = await callTool(server, 'nodus_query_database', { databaseId: mdb.id, query: 'perro', limit: 10, offset: 0 });
  assert.equal(qFiltered.total, 0, 'query filters by text');
  const gotRow = await callTool(server, 'nodus_get_database_row', { rowId: mRow.id });
  assert.equal(gotRow.fields.Nombre, 'Gato', 'nodus_get_database_row decodes the row');
  assert.ok(gotRow.page?.id, 'a database row exposes its universal page id');

  const view = dbmode.createView(mdb.id, { name: 'Tablero MCP', layout: 'board' });
  const taskMode = require(path.join(repoRoot, 'electron/db/databaseTasksRepo.ts'));
  const template = taskMode.createDatabaseRowTemplate(mdb.id, {
    name: 'Incidencia MCP',
    properties: { [mName.id]: 'Sin título' },
    blocks: [{ type: 'heading_2', content: { text: 'Pasos de reproducción' } }],
    recurrence: 'none',
    timeZone: 'Europe/Madrid',
  });
  const automationMode = require(path.join(repoRoot, 'electron/db/databaseAutomationsRepo.ts'));
  const automation = automationMode.createAutomationRule(mdb.id, {
    name: 'Avisar al crear',
    trigger: { type: 'row_created' },
    actions: [{ type: 'notify', title: 'Nueva fila', body: '{{row.title}}' }],
  });
  const form = automationMode.createDatabaseForm(mdb.id, {
    name: 'Alta MCP', slug: 'alta-mcp', title: 'Nueva entrada', description: 'Formulario MCP', access: 'public',
    fields: [{ columnId: mName.id, label: 'Nombre', description: null, required: true, width: 'full' }],
    enabled: true,
  });
  const mcpViews = await callTool(server, 'nodus_list_database_views', { databaseId: mdb.id });
  assert.ok(mcpViews.views.some((item) => item.id === view.id && item.config.layout === 'board'), 'MCP exposes complete versioned view config');
  const mcpTemplates = await callTool(server, 'nodus_list_database_templates', { databaseId: mdb.id });
  assert.ok(mcpTemplates.templates.some((item) => item.id === template.id && item.blocks[0].type === 'heading_2'), 'MCP exposes page templates and typed blocks');
  const mcpAutomations = await callTool(server, 'nodus_list_database_automations', { databaseId: mdb.id, runLimit: 10 });
  assert.ok(mcpAutomations.rules.some((item) => item.id === automation.id), 'MCP exposes automation rules');
  assert.ok(Array.isArray(mcpAutomations.runs), 'MCP automation execution history is bounded and explicit');
  const mcpForms = await callTool(server, 'nodus_list_database_forms', { databaseId: mdb.id });
  const listedForm = mcpForms.forms.find((item) => item.id === form.id);
  assert.equal(listedForm.fields[0].columnId, mName.id, 'MCP exposes form fields and validation');
  assert.equal(Object.hasOwn(listedForm, 'authToken'), false, 'MCP never exposes form authentication secrets');

  const rowPage = await callTool(server, 'nodus_get_page', { pageId: gotRow.page.id, includeBlocks: true });
  assert.equal(rowPage.page.origin, 'database_row', 'get_page opens a row through the universal page engine');
  assert.ok(Array.isArray(rowPage.blocks), 'get_page can return the structured block projection');

  // Pages, blocks, revision conflicts, comments and ACL all cross the real repositories.
  const createdPage = await callTool(server, 'nodus_create_page', {
    title: 'Cuaderno MCP',
    parentPageId: null,
    icon: '📓',
    markdown: '# Primera nota\n\nTexto visible para la búsqueda MCP.',
  });
  assert.ok(createdPage.page.id, 'create_page returns the universal page id');
  const pageList = await callTool(server, 'nodus_list_pages', { state: 'active', limit: 20, offset: 0 });
  assert.ok(pageList.pages.some((item) => item.id === createdPage.page.id), 'list_pages returns the standalone page');
  const pageSearch = await callTool(server, 'nodus_search_pages', { query: 'visible búsqueda', limit: 20, offset: 0 });
  assert.ok(pageSearch.results.some((item) => item.pageId === createdPage.page.id), 'search_pages finds projected block text');
  const fullPage = await callTool(server, 'nodus_get_page', { pageId: createdPage.page.id, includeBlocks: true });
  assert.match(fullPage.markdown, /Primera nota/, 'get_page returns reconstructible Markdown');
  assert.ok(fullPage.blocks.some((block) => block.type === 'heading_1'), 'Markdown is projected into typed blocks');

  const metadata = await callTool(server, 'nodus_update_page', {
    pageId: createdPage.page.id,
    expectedPageRevision: createdPage.page.revision,
    title: 'Cuaderno MCP revisado',
  });
  assert.equal(metadata.page.title, 'Cuaderno MCP revisado', 'page metadata uses its expected revision');
  const replaced = await callTool(server, 'nodus_replace_page_markdown', {
    pageId: createdPage.page.id,
    expectedDocumentRevision: createdPage.documentRevision,
    markdown: '## Segunda versión\n\nContenido convergente.',
  });
  assert.equal(replaced.ok, true, 'page Markdown is replaced through the block engine');
  const conflict = await callTool(server, 'nodus_replace_page_markdown', {
    pageId: createdPage.page.id,
    expectedDocumentRevision: createdPage.documentRevision,
    markdown: 'Este texto obsoleto no debe ganar.',
  });
  assert.equal(conflict.ok, false, 'a stale document revision returns an explicit conflict');
  assert.equal(conflict.conflict.actualRevision, replaced.documentRevision, 'the conflict returns the current revision token');

  const comment = await callTool(server, 'nodus_create_page_comment', {
    pageId: createdPage.page.id,
    blockId: null,
    parentCommentId: null,
    body: 'Comentario real desde MCP.',
  });
  const comments = await callTool(server, 'nodus_list_page_comments', { pageId: createdPage.page.id, includeResolved: false });
  assert.ok(comments.comments.some((item) => item.id === comment.comment.id), 'page comments round-trip through MCP');

  const acl = require(path.join(repoRoot, 'electron/db/aclRepo.ts'));
  acl.setAclEntry({ resourceType: 'page', resourceId: createdPage.page.id, principalType: 'actor', principalId: 'local', role: 'view', actorId: 'local' });
  const deniedWrite = await callToolRaw(server, 'nodus_replace_page_markdown', {
    pageId: createdPage.page.id,
    expectedDocumentRevision: replaced.documentRevision,
    markdown: 'No autorizado',
  });
  assert.equal(deniedWrite.isError, true, 'MCP page writes obey the same ACL as Electron IPC');
  const deniedWriteError = JSON.parse(deniedWrite.content[0].text).error;
  assert.equal(deniedWriteError.category, 'permission_denied', 'ACL refusal has a stable machine-readable category');
  assert.match(deniedWriteError.message, /permission/, 'ACL refusal is explicit');

  // Derived columns have to reach a client as data it can reason about. A rollup keeps its
  // value beside the cells, so reading cells alone hands the client null; a formula lives in
  // cells but is typed by what it computes, so a numeric one must arrive as a number and the
  // schema must say so — "type: formula" tells a client nothing it can query on.
  const mNum = dbmode.createColumn(mdb.id, 'Peso', 'number');
  dbmode.setCell(mRow.id, mNum.id, '4');
  const mDoble = dbmode.createColumn(mdb.id, 'Doble', 'formula', {
    formula: { kind: 'arithmetic', op: 'multiply', operands: [{ kind: 'column', columnId: mNum.id }, { kind: 'number', value: 2 }] },
  });
  const _mVerdict = dbmode.createColumn(mdb.id, 'Veredicto', 'formula', {
    formula: { kind: 'ifThen', rules: [{ id: 'r', conjunction: 'and', conditions: [{ id: 'c', columnId: mNum.id, op: 'gt', value: '3' }], output: { kind: 'text', value: 'Pesado' } }], otherwise: { kind: 'text', value: 'Ligero' } },
  });
  // A rollup over a relation from another database back to this row.
  const mOther = dbmode.createDatabase('MCP Rel');
  const mOtherName = dbmode.createColumn(mOther.id, 'N', 'title');
  const mOtherRow = dbmode.createRow(mOther.id);
  dbmode.setCell(mOtherRow.id, mOtherName.id, 'Enlazado');
  const mRel = dbmode.createColumn(mdb.id, 'Vínculo', 'relation', { relationTargetKind: 'db_row', relationTargetDatabaseId: mOther.id });
  dbmode.addRelation(mRow.id, mRel.id, 'db_row', mOtherRow.id);
  const _mRollup = dbmode.createColumn(mdb.id, 'Enlaces', 'rollup', { rollupRelationColumnId: mRel.id, rollupTargetColumnId: '__title__', rollupFunction: 'count' });

  const schema2 = await callTool(server, 'nodus_get_database_schema', { databaseId: mdb.id });
  const doble = schema2.columns.find((c) => c.name === 'Doble');
  assert.equal(doble.type, 'formula', 'the schema still reports the declared type');
  assert.equal(doble.computes, 'number', 'and what the formula computes');
  assert.match(doble.formula, /Peso/, 'and describes the recipe in words');
  assert.equal(schema2.columns.find((c) => c.name === 'Veredicto').computes, 'text', 'a text formula computes text');

  const q2 = await callTool(server, 'nodus_query_database', { databaseId: mdb.id, limit: 10, offset: 0 });
  const f = q2.rows[0].fields;
  assert.strictEqual(f.Doble, 8, 'a numeric formula arrives as a number, not a string');
  assert.strictEqual(f.Veredicto, 'Pesado', 'a text formula arrives as its text');
  assert.strictEqual(f.Enlaces, '1', 'a rollup arrives with its computed value, not null');
  const qFormula = await callTool(server, 'nodus_query_database', { databaseId: mdb.id, query: 'pesado', limit: 10, offset: 0 });
  assert.equal(qFormula.total, 1, 'a formula value is searchable over MCP');

  // Typed filters + sorts: the same engine as the in-app filter bar, addressed by
  // column NAME and option LABEL so an MCP client never needs internal ids.
  const mRow2 = dbmode.createRow(mdb.id);
  dbmode.setCell(mRow2.id, mName.id, 'Perro');
  dbmode.setCell(mRow2.id, mNum.id, '2');
  const heavy = await callTool(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: { conjunction: 'and', conditions: [{ column: 'Peso', op: 'gt', value: '3' }] },
    limit: 10,
    offset: 0,
  });
  assert.equal(heavy.total, 1, 'numeric filter narrows the rows');
  assert.equal(heavy.rows[0].fields.Nombre, 'Gato');
  assert.equal(heavy.hasMore, false, 'query_database uses the standard paginated shape');
  const byLabel = await callTool(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: { conjunction: 'and', conditions: [{ column: 'Estado', op: 'isAnyOf', value: ['vivo'] }] },
    limit: 10,
    offset: 0,
  });
  assert.equal(byLabel.total, 1, 'select filter accepts option labels');
  assert.equal(byLabel.rows[0].fields.Nombre, 'Gato');
  const eitherOr = await callTool(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: {
      conjunction: 'or',
      conditions: [
        { column: 'Peso', op: 'gt', value: '3' },
        { column: 'Nombre', op: 'contains', value: 'perro' },
      ],
    },
    limit: 10,
    offset: 0,
  });
  assert.equal(eitherOr.total, 2, 'or-conjunction unions the conditions');
  const sortedDesc = await callTool(server, 'nodus_query_database', {
    databaseId: mdb.id,
    sorts: [{ column: 'Peso', dir: 'desc' }],
    limit: 10,
    offset: 0,
  });
  assert.equal(sortedDesc.rows[0].fields.Nombre, 'Gato', 'sorts order rows by column value');
  const sortedAsc = await callTool(server, 'nodus_query_database', {
    databaseId: mdb.id,
    sorts: [{ column: 'Peso', dir: 'asc' }],
    limit: 10,
    offset: 0,
  });
  assert.equal(sortedAsc.rows[0].fields.Nombre, 'Perro');

  const badColumn = await callToolRaw(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: { conjunction: 'and', conditions: [{ column: 'Altura', op: 'gt', value: '3' }] },
    limit: 10,
    offset: 0,
  });
  assert.equal(badColumn.isError, true);
  const badColumnError = JSON.parse(badColumn.content[0].text).error;
  assert.equal(badColumnError.category, 'invalid_input');
  assert.match(badColumnError.message, /Peso/, 'unknown-column error lists the available columns');
  const badOp = await callToolRaw(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: { conjunction: 'and', conditions: [{ column: 'Nombre', op: 'gt', value: '3' }] },
    limit: 10,
    offset: 0,
  });
  assert.equal(badOp.isError, true);
  assert.match(JSON.parse(badOp.content[0].text).error.message, /contains/, 'invalid-operator error lists the valid operators');
  const badOption = await callToolRaw(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: { conjunction: 'and', conditions: [{ column: 'Estado', op: 'isAnyOf', value: ['muerto'] }] },
    limit: 10,
    offset: 0,
  });
  assert.equal(badOption.isError, true);
  assert.match(JSON.parse(badOption.content[0].text).error.message, /vivo/, 'unknown-option error lists the available labels');
  const missingValue = await callToolRaw(server, 'nodus_query_database', {
    databaseId: mdb.id,
    filter: { conjunction: 'and', conditions: [{ column: 'Peso', op: 'gt' }] },
    limit: 10,
    offset: 0,
  });
  assert.equal(missingValue.isError, true);
  assert.equal(JSON.parse(missingValue.content[0].text).error.category, 'invalid_input');

  // A single row resolves its relation columns to target labels and names its database.
  const rowDetail = await callTool(server, 'nodus_get_database_row', { rowId: mRow.id });
  assert.equal(rowDetail.database.name, 'MCP DB', 'row detail names its parent database');
  assert.deepEqual(rowDetail.fields['Vínculo'], [{ label: 'Enlazado', kind: 'db_row' }], 'row detail resolves relation targets to labels');

  // Additive writes: create a row, then set its cells by typed value. User-authored
  // structured data is the only thing MCP is allowed to write into a databases vault.
  const created = await callTool(server, 'nodus_create_database_row', { databaseId: mdb.id });
  assert.ok(created.row.id, 'nodus_create_database_row returns the new row id');
  await callTool(server, 'nodus_set_database_cell', { rowId: created.row.id, columnId: mName.id, value: 'Tortuga' });
  await callTool(server, 'nodus_set_database_cell', { rowId: created.row.id, columnId: mNum.id, value: 7 });
  const setSelect = await callTool(server, 'nodus_set_database_cell', { rowId: created.row.id, columnId: mSel.id, value: 'vivo' });
  assert.equal(setSelect.row.fields.Nombre, 'Tortuga', 'set_database_cell stores a title value');
  assert.equal(setSelect.row.fields.Estado, 'vivo', 'set_database_cell resolves a select label to its option');
  assert.strictEqual(setSelect.row.fields.Peso, 7, 'set_database_cell stores a typed number');
  const writtenBack = await callTool(server, 'nodus_query_database', { databaseId: mdb.id, query: 'tortuga', limit: 10, offset: 0 });
  assert.equal(writtenBack.total, 1, 'a row written over MCP is queryable');
  // A bad option label is rejected with the available labels, never silently stored.
  const badSet = await callToolRaw(server, 'nodus_set_database_cell', { rowId: created.row.id, columnId: mSel.id, value: 'zombi' });
  assert.equal(badSet.isError, true);
  assert.match(JSON.parse(badSet.content[0].text).error.message, /vivo/, 'unknown-option write lists the available labels');
  // Computed/binary columns cannot be written through MCP.
  const badFormula = await callToolRaw(server, 'nodus_set_database_cell', { rowId: created.row.id, columnId: mDoble.id, value: 3 });
  assert.equal(badFormula.isError, true);
  assert.match(JSON.parse(badFormula.content[0].text).error.message, /formula/, 'a formula column refuses a direct write');
  // Clean the write-test row back out so later row-count assertions stay stable.
  dbmode.deleteRow(created.row.id);
  acl.setAclEntry({ resourceType: 'database', resourceId: mdb.id, principalType: 'actor', principalId: 'local', role: 'view', actorId: 'local' });
  const deniedCell = await callToolRaw(server, 'nodus_set_database_cell', { rowId: mRow.id, columnId: mName.id, value: 'No autorizado' });
  assert.equal(JSON.parse(deniedCell.content[0].text).error.category, 'permission_denied', 'database writes also obey ACL');
  const stillReadable = await callTool(server, 'nodus_get_database_row', { rowId: mRow.id });
  assert.equal(stillReadable.fields.Nombre, 'Gato', 'view ACL preserves reads and the denied write changed nothing');

  // Read-only study-vault tools expose organisation, grounded search, questions
  // and progress without allowing an MCP client to mutate learning state.
  const studyOrg = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const studyQuestions = require(path.join(repoRoot, 'electron/db/studyQuestionsRepo.ts'));
  const studyCourse = studyOrg.createStudyCourse({ name: 'Biología MCP' });
  const studySubject = studyOrg.createStudySubject({ courseId: studyCourse.id, name: 'Biología celular' });
  const studyTopic = studyOrg.createStudyTopic({ subjectId: studySubject.id, name: 'Membrana' });
  const studyDoc = studyOrg.createStudyDocument({
    title: 'Membrana plasmática',
    contentMarkdown: '# Membrana\n\nEl transporte activo mueve solutos contra gradiente.',
    placement: { courseId: studyCourse.id, subjectId: studySubject.id, topicId: studyTopic.id },
  });
  const studyQuestion = studyQuestions.createStudyQuestion({
    prompt: '¿Qué mueve solutos contra gradiente?',
    type: 'short',
    answer: { text: 'El transporte activo.' },
    explanation: 'El transporte activo requiere energía.',
    courseId: studyCourse.id,
    subjectId: studySubject.id,
    topicId: studyTopic.id,
    documentId: studyDoc.id,
    source: { title: studyDoc.title, excerpt: 'El transporte activo mueve solutos contra gradiente.' },
  });
  const studyWorkspace = await callTool(server, 'nodus_study_get_workspace', { includeArchived: false });
  assert.ok(studyWorkspace.courses.some((course) => course.id === studyCourse.id));
  assert.equal('contentMarkdown' in studyWorkspace.documents.find((document) => document.id === studyDoc.id), false, 'workspace keeps document bodies compact');
  const compactStudyDoc = await callTool(server, 'nodus_study_get_document', { documentId: studyDoc.shortId, includeContent: false });
  assert.equal(compactStudyDoc.contentOmitted, true);
  assert.equal('contentMarkdown' in compactStudyDoc.document, false);
  const fullStudyDoc = await callTool(server, 'nodus_study_get_document', { documentId: studyDoc.id, includeContent: true });
  assert.match(fullStudyDoc.document.contentMarkdown, /transporte activo/);
  const studySearch = await callTool(server, 'nodus_study_search', { query: 'transporte activo', kinds: ['document'], limit: 10 });
  assert.ok(studySearch.results.some((result) => result.sourceId === studyDoc.id), 'study search returns grounded document snippets');
  const questionList = await callTool(server, 'nodus_study_list_questions', { query: 'solutos', favorite: false, limit: 10, offset: 0 });
  assert.ok(questionList.questions.some((question) => question.id === studyQuestion.id));
  const byCourse = await callTool(server, 'nodus_study_list_questions', { courseId: studyCourse.id, favorite: false, limit: 10, offset: 0 });
  assert.equal(byCourse.total, 1, 'questions filter by course');
  const otherCourse = await callTool(server, 'nodus_study_list_questions', { courseId: 'course_missing', favorite: false, limit: 10, offset: 0 });
  assert.equal(otherCourse.total, 0);
  const byType = await callTool(server, 'nodus_study_list_questions', { type: 'short', favorite: false, limit: 10, offset: 0 });
  assert.equal(byType.total, 1, 'questions filter by type');
  const byDifficulty = await callTool(server, 'nodus_study_list_questions', { difficulty: 'hard', favorite: false, limit: 10, offset: 0 });
  assert.equal(byDifficulty.total, 0, 'questions filter by difficulty');
  const byStatus = await callTool(server, 'nodus_study_list_questions', { status: 'pending', favorite: false, limit: 10, offset: 0 });
  assert.equal(byStatus.total, 1, 'questions filter by review status');
  const studyProgress = await callTool(server, 'nodus_study_get_progress');
  assert.equal(typeof studyProgress.progress.dueCards, 'number');
  assert.ok(Array.isArray(studyProgress.planner.events));
  const schedule = await callTool(server, 'nodus_study_get_schedule', { academicYearId: null });
  assert.ok(Array.isArray(schedule.periods) && Array.isArray(schedule.cells), 'schedule returns the weekly grid');

  // Read-only teaching-vault tools. Two invariants under test: students are only ever
  // returned by pseudonym code (a name set here must never reach the client), and the
  // gradebook is a computed projection with cohort statistics.
  const teachingGroups = require(path.join(repoRoot, 'electron/db/teachingGroupsRepo.ts'));
  const teachingGrades = require(path.join(repoRoot, 'electron/db/teachingGradesRepo.ts'));
  const teachingExamsRepo = require(path.join(repoRoot, 'electron/db/teachingExamsRepo.ts'));
  const teachingRubricsRepo = require(path.join(repoRoot, 'electron/db/teachingRubricsRepo.ts'));

  const teachGroup = teachingGroups.createTeachingGroup({ name: 'Grupo MCP', subjectId: studySubject.id, expectedSize: 2 });
  const [alumnaA, alumnaB] = teachGroup.students;
  teachingGroups.updateTeachingStudent(alumnaA.id, { givenNames: 'Ada', surnames: 'Lovelace' });
  teachingGroups.updateTeachingStudent(alumnaB.id, { givenNames: 'Grace', surnames: 'Hopper' });
  const teachPlan = teachingGrades.createAssessmentPlan({ name: 'Plan MCP', subjectId: studySubject.id });
  const itemExam = teachingGrades.createAssessmentItem(teachPlan.id, { name: 'Examen', kind: 'activity', weight: 1, maxPoints: 10, entryMode: 'numeric' });
  const itemWork = teachingGrades.createAssessmentItem(teachPlan.id, { name: 'Trabajo', kind: 'activity', weight: 1, maxPoints: 10, entryMode: 'numeric' });
  teachingGrades.setGradeEntry({ studentId: alumnaA.id, itemId: itemExam.id, rawValue: 8 });
  teachingGrades.setGradeEntry({ studentId: alumnaA.id, itemId: itemWork.id, rawValue: 6 });
  teachingGrades.setGradeEntry({ studentId: alumnaB.id, itemId: itemExam.id, rawValue: 4 });
  teachingGrades.setGradeEntry({ studentId: alumnaB.id, itemId: itemWork.id, rawValue: 2 });

  const groupList = await callTool(server, 'nodus_teaching_list_groups', {});
  assert.equal(groupList.length, 1, 'list_groups returns the group');
  assert.equal(groupList[0].studentCount, 2, 'list_groups reports the roster size');
  const rosterRaw = await callToolRaw(server, 'nodus_teaching_get_group', { groupId: teachGroup.id });
  assert.equal(rosterRaw.structuredContent.students.length, 2, 'get_group returns the roster');
  assert.ok(rosterRaw.structuredContent.students.every((s) => /^STU_/.test(s.code)), 'roster identifies students by pseudonym code');
  assert.equal(rosterRaw.content[0].text.includes('Lovelace'), false, 'get_group never leaks a student name');

  const planList = await callTool(server, 'nodus_teaching_list_assessment_plans', {});
  assert.equal(planList.length, 1, 'list_assessment_plans returns the plan');
  const planDetail = await callTool(server, 'nodus_teaching_get_assessment_plan', { planId: teachPlan.id });
  assert.equal(planDetail.items.length, 2, 'get_assessment_plan returns the item tree');

  const gradebookRaw = await callToolRaw(server, 'nodus_teaching_get_gradebook', { planId: teachPlan.id, groupId: teachGroup.id, convocatoria: 'ordinaria', track: 'continua' });
  const gradebook = gradebookRaw.structuredContent;
  assert.equal(gradebook.students.length, 2, 'gradebook has a row per student');
  assert.ok(gradebook.students.every((row) => /^STU_/.test(row.code)), 'gradebook rows are keyed by pseudonym code');
  assert.equal(gradebook.distribution.evaluated, 2, 'gradebook cohort stats count the evaluated students');
  assert.ok(gradebook.students.some((row) => typeof row.final.numeric === 'number'), 'gradebook projects a numeric final grade');
  assert.equal(gradebookRaw.content[0].text.includes('Lovelace'), false, 'gradebook never leaks a student name');
  assert.equal(gradebookRaw.content[0].text.includes('Hopper'), false, 'gradebook never leaks a student name');
  const gradebookMissing = await callToolRaw(server, 'nodus_teaching_get_gradebook', { planId: 'plan_missing', groupId: teachGroup.id, convocatoria: 'ordinaria', track: 'continua' });
  assert.equal(gradebookMissing.isError, true);
  assert.equal(JSON.parse(gradebookMissing.content[0].text).error.category, 'not_found');

  const teachExam = teachingExamsRepo.createTeachingExam({ title: 'Examen MCP', subjectId: studySubject.id });
  teachingExamsRepo.addTeachingExamQuestion(teachExam.id, { type: 'short_answer', prompt: 'Define célula', points: 2, imageDataUrl: 'data:image/png;base64,AAAA' });
  const examList = await callTool(server, 'nodus_teaching_list_exams', {});
  assert.equal(examList.length, 1, 'list_exams returns the exam');
  const examDetail = await callTool(server, 'nodus_teaching_get_exam', { examId: teachExam.id });
  assert.equal(examDetail.questions.length, 1, 'get_exam returns questions');
  assert.equal(examDetail.questions[0].hasImage, true, 'get_exam flags an image without returning its data');
  assert.equal('imageDataUrl' in examDetail.questions[0], false, 'get_exam strips inline image data');
  assert.equal(typeof examDetail.logoCount, 'number', 'get_exam reports a logo count, not the logo blobs');

  const teachRubric = teachingRubricsRepo.createTeachingRubric({ title: 'Rúbrica MCP', subjectId: studySubject.id });
  const rubricList = await callTool(server, 'nodus_teaching_list_rubrics', {});
  assert.ok(rubricList.some((r) => r.id === teachRubric.id), 'list_rubrics returns the rubric');
  const rubricDetail = await callTool(server, 'nodus_teaching_get_rubric', { rubricId: teachRubric.id });
  assert.ok(Array.isArray(rubricDetail.criteria) && Array.isArray(rubricDetail.levels), 'get_rubric returns criteria and levels');

  // Worldbuilding is a first-class MCP surface. It can build and inspect canonical
  // author-owned data, while destructive deletion remains exclusive to the app.
  const worldPlace = (await callTool(server, 'nodus_world_create_place', {
    name: 'Ciudad de Nácar',
    kind: 'city',
    atmosphere: 'Bruma azul y campanas de marea.',
  })).place;
  const worldCharacter = (await callTool(server, 'nodus_world_create_character', {
    displayName: 'Ilyra Venn',
    species: 'Humana',
    narrativeRole: 'protagonist',
    lifeStatus: 'alive',
    backstory: 'Custodia el archivo de mareas.',
  })).character;
  const worldGroup = (await callTool(server, 'nodus_world_create_group', {
    name: 'Consejo de Nácar',
    kind: 'faction',
    summary: 'Gobierna las rutas de marea.',
    seatPlaceId: worldPlace.placeId,
  })).group;
  assert.equal(worldGroup.seatPlaceId, worldPlace.placeId);
  const worldScene = (await callTool(server, 'nodus_world_create_scene', {
    title: 'La puerta lunar',
    placeId: worldPlace.placeId,
    status: 'draft',
    summary: 'Ilyra abre la puerta durante la tercera luna.',
  })).scene;
  await callTool(server, 'nodus_world_update_scene_text', {
    sceneId: worldScene.sceneId,
    text: 'Ilyra apoyó la mano en la puerta lunar. La marea respondió.',
  });
  const worldArticle = (await callTool(server, 'nodus_world_create_article', {
    title: 'La tercera luna',
    category: 'concept',
    summary: 'Una marea celeste que abre rutas imposibles.',
    body: `La [[scene:${worldScene.sceneId}|puerta lunar]] solo responde a la tercera luna.`,
  })).article;
  const worldThread = (await callTool(server, 'nodus_world_create_thread', {
    kind: 'conflict',
    title: 'El bloqueo del estuario',
    stakes: 'La ciudad perderá su única ruta segura.',
  })).thread;
  const worldRule = (await callTool(server, 'nodus_world_create_rule', {
    title: 'Toda puerta exige una memoria',
    statement: 'Las puertas de marea solo se abren entregando un recuerdo.',
    cost: 'El recuerdo desaparece para siempre.',
    hardness: 'costly',
  })).rule;
  const worldQuestion = (await callTool(server, 'nodus_world_create_question', {
    question: '¿Qué recuerdo entrega Ilyra?',
    anchorKind: 'scene',
    anchorId: worldScene.sceneId,
    anchorField: 'summary',
    blocking: true,
  })).question;
  const worldSecret = (await callTool(server, 'nodus_world_create_secret', {
    title: 'El archivo miente',
    ownerPersonId: worldCharacter.personId,
    content: 'Las cartas de marea fueron reescritas.',
  })).secret;

  const worldOverview = await callTool(server, 'nodus_world_get_overview');
  assert.ok(worldOverview.counts.total >= 1 && worldOverview.counts.scenes >= 1, 'world overview counts the canonical cast and scenes');
  const worldCharacterDetail = await callTool(server, 'nodus_world_get_character', { personId: worldCharacter.personId });
  assert.equal(worldCharacterDetail.character.profile.backstory, 'Custodia el archivo de mareas.');
  assert.ok(worldCharacterDetail.secrets.owned.some((secret) => secret.secretId === worldSecret.secretId));
  const worldPlaceDetail = await callTool(server, 'nodus_world_get_place', { placeId: worldPlace.placeId });
  assert.equal(worldPlaceDetail.place.profile.atmosphere, 'Bruma azul y campanas de marea.');
  const worldEntry = await callTool(server, 'nodus_world_get_entry', { kind: 'article', id: worldArticle.articleId });
  assert.match(worldEntry.body, /tercera luna/i);
  const worldSearch = await callTool(server, 'nodus_world_search', { query: 'puerta lunar', limit: 20 });
  assert.ok(worldSearch.results.some((result) => result.id === worldScene.sceneId || result.id === worldArticle.articleId));
  const worldManuscript = await callTool(server, 'nodus_world_get_manuscript', { includeText: true });
  assert.ok(worldManuscript.scenes.some((scene) => scene.sceneId === worldScene.sceneId && /marea respondió/.test(scene.text)));
  assert.equal((await callTool(server, 'nodus_world_get_thread', { threadId: worldThread.threadId })).thread.title, 'El bloqueo del estuario');
  assert.equal((await callTool(server, 'nodus_world_get_rule', { ruleId: worldRule.ruleId })).rule.hardness, 'costly');
  assert.equal((await callTool(server, 'nodus_world_get_question', { questionId: worldQuestion.questionId })).question.blocking, true);
  assert.ok(Array.isArray((await callTool(server, 'nodus_world_get_continuity')).findings));
  assert.ok((await callTool(server, 'nodus_world_get_calendar')).calendar);

  const { buildServerSnapshot, WORLDBUILDING_SERVER_TABLES } = require(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'));
  const publishedWorld = buildServerSnapshot(
    { id: 'world-mcp-test', name: 'Orthea', type: 'worldbuilding' },
    { nodusServerIncludeUserContent: false, nodusServerIncludePassages: false },
    getDb(),
  );
  const publishedWorldPayload = JSON.parse(publishedWorld.buffer.toString('utf8'));
  for (const table of ['persons', 'character_profiles', 'world_scenes', 'world_scene_text', 'world_articles', 'world_secrets']) {
    assert.ok(WORLDBUILDING_SERVER_TABLES.includes(table), `${table} belongs to the explicit Worldbuilding server contract`);
    assert.ok(Array.isArray(publishedWorldPayload.tables[table]), `${table} is published to Nodus Server`);
  }
  assert.ok(
    publishedWorldPayload.tables.world_secrets.some((secret) => secret.secret_id === worldSecret.secretId),
    'fictional secret ids remain linkable in the safe server projection',
  );
  assert.equal(publishedWorldPayload.tables.character_chat_messages, undefined, 'private character chats stay local');
  assert.equal(publishedWorldPayload.tables.world_scene_snapshots, undefined, 'manuscript editing history stays local');

  const ideas = await callTool(server, 'nodus_list_ideas', { limit: 1, offset: 0, query: 'turismo' });
  assert.equal(ideas.total, 1);
  assert.equal(ideas.hasMore, false);
  assert.equal(ideas.ideas[0].global_id, 'idea-1');
  // Compact by default: a statement snippet instead of the full statement…
  assert.equal('statement' in ideas.ideas[0], false);
  assert.match(ideas.ideas[0].statementSnippet, /memoria visual/);
  // …and full=true restores the complete rows.
  const fullIdeas = await callTool(server, 'nodus_list_ideas', { limit: 1, offset: 0, query: 'turismo', full: true });
  assert.equal(fullIdeas.ideas[0].statement, 'El turismo reorganiza la memoria visual local.');
  assert.equal('statementSnippet' in fullIdeas.ideas[0], false);

  // query must match text fields only — never JSON keys, enum values or internal ids.
  const enumLeak = await callTool(server, 'nodus_list_ideas', { limit: 10, offset: 0, query: 'claim' });
  assert.equal(enumLeak.total, 0, 'query must not match the type enum');
  const idLeak = await callTool(server, 'nodus_list_ideas', { limit: 10, offset: 0, query: 'idea-1' });
  assert.equal(idLeak.total, 0, 'query must not match internal ids');
  const statementHit = await callTool(server, 'nodus_list_ideas', { limit: 10, offset: 0, query: 'memoria visual' });
  assert.equal(statementHit.total, 1, 'query must match the statement text');
  const noteKindLeak = await callTool(server, 'nodus_search_notes', { query: 'markdown', limit: 10, offset: 0 });
  assert.equal(noteKindLeak.total, 0, 'note query must not match the kind enum');

  const gaps = await callTool(server, 'nodus_list_gaps', { limit: 10, offset: 0, kind: 'open_question' });
  assert.equal(gaps.total, 1);
  assert.equal(gaps.gaps[0].gapIds[0], 'gap-1');

  const works = await callTool(server, 'nodus_list_works', {
    limit: 1,
    offset: 0,
    query: 'turismo',
    includeArchived: false,
    lightStatus: 'all',
    deepStatus: 'all',
    summaryStatus: 'all',
    zoteroTagMode: 'any',
    collectionMode: 'any',
  });
  assert.equal(works.total, 2);
  assert.equal(works.works.length, 1);
  assert.equal(works.hasMore, true);

  const work = await callTool(server, 'nodus_get_work', { workId: 'ZOT1' });
  assert.equal(work.work.nodus_id, 'work-1');
  assert.equal(work.counts.ideas, 1);
  assert.equal(work.counts.passages, 2);

  const documentProfile = await callTool(server, 'nodus_get_document_profile', { workId: 'ZOT1' });
  assert.equal(documentProfile.profile.nodusId, 'work-1');
  assert.equal(documentProfile.profile.fields[0].kind, 'thesis');
  assert.equal(documentProfile.citationPolicy, 'orientation_only');
  const documentSearch = await callTool(server, 'nodus_search_documents', { query: 'memoria visual', limit: 5 });
  assert.equal(documentSearch.documents[0].nodusId, 'work-1');
  assert.equal(documentSearch.citationPolicy, 'orientation_only');

  const passages = await callTool(server, 'nodus_list_work_passages', { workId: 'work-1', query: 'visual', limit: 1, offset: 0 });
  assert.equal(passages.total, 2);
  assert.equal(passages.passages[0].passage_id, 'passage-1');

  const passage = await callTool(server, 'nodus_get_passage', { passageId: 'passage-1' });
  assert.equal(passage.passage_id, 'passage-1');
  assert.match(passage.text, /visual/);

  const themeList = await callTool(server, 'nodus_list_themes', { query: 'turismo', limit: 10, offset: 0 });
  assert.equal(themeList.total, 1);
  assert.equal(themeList.themes[0].label, 'turismo');

  const theme = await callTool(server, 'nodus_get_theme', {
    theme: 'turismo',
    worksLimit: 10,
    worksOffset: 0,
    ideasLimit: 10,
    ideasOffset: 0,
  });
  assert.equal(theme.works.total, 2);
  assert.equal(theme.ideas.total, 1);

  const authors = await callTool(server, 'nodus_search_authors', {
    query: 'ana',
    synthesis: 'all',
    limit: 10,
    offset: 0,
  });
  assert.equal(authors.total, 1);
  assert.equal(authors.authors[0].author_id, 'author-1');
  assert.equal(authors.authors[0].hasSynthesis, true);

  const storedAuthorSynthesis = await callTool(server, 'nodus_read_author_synthesis', { author: 'author-1' });
  assert.equal(storedAuthorSynthesis.source, 'cached');
  assert.match(storedAuthorSynthesis.synthesis.thesis, /memoria visual/);
  assert.equal(storedAuthorSynthesis.counts.works, 1);
  const absentStoredSynthesis = await callTool(server, 'nodus_read_author_synthesis', { author: 'author-2' });
  assert.equal(absentStoredSynthesis.source, 'missing');
  assert.equal(absentStoredSynthesis.synthesis, null);

  const authorSynthesis = await callTool(server, 'nodus_get_author_synthesis', {
    author: 'author-1',
    generateIfMissing: false,
    refresh: false,
  });
  assert.equal(authorSynthesis.source, 'cached');
  assert.match(authorSynthesis.synthesis.thesis, /memoria visual/);
  assert.equal(authorSynthesis.counts.works, 1);

  const missingAuthorSynthesis = await callTool(server, 'nodus_get_author_synthesis', {
    author: 'author-2',
    generateIfMissing: false,
    refresh: false,
  });
  assert.equal(missingAuthorSynthesis.source, 'missing');
  assert.equal(missingAuthorSynthesis.synthesis, null);

  const routes = await callTool(server, 'nodus_list_tutor_routes', { mode: 'overview', limit: 10, offset: 0 });
  assert.equal(routes.total, 1);
  assert.equal(routes.routes[0].routeTitle, 'Ruta turismo');
  assert.equal(routes.routes[0].stopCount, 1);

  const route = await callTool(server, 'nodus_get_tutor_route', { routeId: 'route-1' });
  assert.equal(route.route.stops[0].id, 'stop-1');

  const projects = await callTool(server, 'nodus_list_projects', { query: 'tesis', status: 'active', limit: 10, offset: 0 });
  assert.equal(projects.total, 1);

  const project = await callTool(server, 'nodus_get_project', { projectId: 'project-1', includeChapterText: false });
  assert.equal(project.stats.chapters, 1);
  assert.equal('currentMarkdown' in project.chapters[0], false);
  assert.equal(project.chapters[0].currentMarkdownSnippet, 'Contenido sobre turismo visual y memoria.', 'MCP reads the canonical manuscript note instead of its stale chapter cache');

  const noteSearch = await callTool(server, 'nodus_search_notes', { query: 'turismo', limit: 10, offset: 0 });
  assert.equal(noteSearch.total, 1);
  assert.match(noteSearch.notes[0].contentSnippet, /turismo/);

  const noteTree = await callTool(server, 'nodus_list_notes_tree', { query: 'turismo', limit: 1, offset: 0 });
  assert.equal(noteTree.total, 1);
  assert.equal('content' in noteTree.notes[0], false);

  const folder = await callTool(server, 'nodus_create_folder', { name: 'MCP creada', summary: 'Carpeta creada desde el test MCP.' });
  assert.equal(folder.name, 'MCP creada');
  const createdNote = await callTool(server, 'nodus_create_note', {
    title: 'Nota MCP',
    content: 'Contenido creado por la prueba MCP.',
    kind: 'markdown',
    folderId: folder.id,
  });
  assert.equal(createdNote.folderId, folder.id);

  const updatedManuscript = await callTool(server, 'nodus_update_note', { id: 'note-1', content: '# Capitulo actualizado\n\nEdición compatible desde MCP.' });
  const refreshedProject = await callTool(server, 'nodus_get_project', { projectId: 'project-1', includeChapterText: true });
  assert.equal(refreshedProject.chapters[0].currentMarkdown, updatedManuscript.content, 'legacy Markdown writes are immediately visible in the manuscript');

  const aiError = await callToolRaw(server, 'nodus_search_ideas', { query: 'turismo', limit: 5 });
  assert.equal(aiError.isError, true);
  assert.equal(JSON.parse(aiError.content[0].text).error.category, 'ai_unconfigured');

  // Progress bridge: with a progressToken, long tools stream notifications/progress.
  // The deep-research pipeline degrades gracefully without an AI provider (fallback
  // plan + sections), so it walks every phase and the bridge must fire throughout.
  const deepArgs = {
    objective: 'Estado del turismo visual en el corpus',
    sectionLimit: 'auto',
    writer: 'nodus',
    save: false,
  };
  const continuousClientBrief = await callTool(server, 'nodus_generate_deep_research', {
    objective: 'Informe continuo sobre el corpus',
    sectionLimit: 'single',
    writer: 'client',
    save: false,
  });
  assert.equal(continuousClientBrief.structure, 'single', 'MCP accepts and propagates the continuous structure to the client writer');
  assert.ok(continuousClientBrief.method.some((rule) => /sin encabezados/i.test(rule)), 'MCP client instructions match continuous output');
  const continuousClientFinal = await callTool(server, 'nodus_finalize_deep_research', {
    objective: 'Informe continuo sobre el corpus',
    sectionLimit: 'single',
    sectionsMarkdown: '## Corte accidental\n\nCuerpo continuo verificado por el ensamblador.',
    abstract: 'Resumen continuo.',
    limitations: ['Corpus de prueba.'],
    save: false,
  });
  assert.equal(continuousClientFinal.report.meta.structure, 'single', 'MCP finalize preserves the continuous structure');
  assert.equal(continuousClientFinal.report.meta.sections, 1);
  assert.equal((continuousClientFinal.report.draft.draftMarkdown.match(/^#{1,6}\s+/gmu) ?? []).length, 0, 'MCP finalize removes accidental headings');
  assert.match(continuousClientFinal.report.draft.draftMarkdown, /^Resumen continuo\./u, 'the self-contained Markdown keeps its abstract without adding a section');
  const progressNotes = [];
  const deepReport = await callToolRaw(server, 'nodus_generate_deep_research', deepArgs, {
    _meta: { progressToken: 'tok-1' },
    sendNotification: async (n) => progressNotes.push(n),
  });
  assert.notEqual(deepReport.isError, true, `deep research failed: ${deepReport.content?.[0]?.text}`);
  assert.ok(progressNotes.length >= 3, `expected several MCP progress notifications, got ${progressNotes.length}`);
  assert.equal(progressNotes[0].method, 'notifications/progress');
  assert.equal(progressNotes[0].params.progressToken, 'tok-1');
  assert.match(progressNotes[0].params.message, /obras|corpus/i);
  assert.ok(
    progressNotes.some((note) => /\[section \d+/.test(note.params.message)),
    'expected per-section progress messages'
  );
  progressNotes.forEach((note, index) => assert.equal(note.params.progress, index + 1, 'progress must increase monotonically'));

  // Without a progressToken the bridge must stay silent (and never crash the tool).
  const silentNotes = [];
  const silentReport = await callToolRaw(server, 'nodus_generate_deep_research', deepArgs, {
    _meta: {},
    sendNotification: async (n) => silentNotes.push(n),
  });
  assert.notEqual(silentReport.isError, true);
  assert.equal(silentNotes.length, 0);

  // Queued reports: the tool returns a job id at once and the report is written in the
  // background, one at a time. The second is still waiting when the first is generating,
  // which is exactly when it can be cancelled.
  const firstQueued = await callTool(server, 'nodus_enqueue_deep_research', {
    objective: 'Informe encolado sobre el corpus',
    sectionLimit: 'single',
    save: true,
  });
  const secondQueued = await callTool(server, 'nodus_enqueue_deep_research', {
    objective: 'Segundo informe encolado',
    sectionLimit: 'auto',
    save: false,
  });
  assert.equal(firstQueued.job.origin, 'mcp');
  assert.equal(firstQueued.job.status, 'running', 'an idle lane starts the first report immediately');
  assert.equal(secondQueued.job.status, 'queued');
  assert.equal(secondQueued.job.ahead, 1, 'the second report is told what is in front of it');
  assert.ok(firstQueued.job.vaultId, 'a job is bound to the vault it was queued against');

  const listed = await callTool(server, 'nodus_list_deep_research_jobs', { status: 'active' });
  assert.equal(listed.jobs.length, 2);
  assert.equal(listed.running, true);

  const cancelled = await callTool(server, 'nodus_cancel_deep_research_job', { jobId: secondQueued.job.id });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.job.status, 'cancelled');

  const deadline = Date.now() + 60_000;
  let finished = await callTool(server, 'nodus_get_deep_research_job', { jobId: firstQueued.job.id, includeReport: true });
  while (finished.job.status === 'running' || finished.job.status === 'queued') {
    if (Date.now() > deadline) throw new Error(`queued report never finished (status ${finished.job.status})`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    finished = await callTool(server, 'nodus_get_deep_research_job', { jobId: firstQueued.job.id, includeReport: true });
  }
  assert.equal(finished.job.status, 'completed', `queued report failed: ${finished.job.error}`);
  assert.ok(finished.job.savedDraftId, 'save=true files the finished report as a draft');
  assert.ok(finished.report.draft.title, 'includeReport returns the report itself');
  assert.equal(finished.report.meta.structure, 'single', 'MCP queue preserves the requested continuous structure');
  assert.equal(finished.report.meta.sections, 0, 'a query without retrieved evidence returns a limitation, not a fabricated report section');
  assert.deepEqual(finished.report.draft.outline, []);
  assert.ok(finished.report.meta.stoppedReason, 'the evidence-free response explains why research stopped');
  assert.equal((finished.report.draft.draftMarkdown.match(/^#{1,6}\s+/gmu) ?? []).length, 0, 'the queued continuous report has no section headings');
  const savedByQueue = await callTool(server, 'nodus_list_writing_drafts', {
    sort: 'newest',
    limit: 25,
    offset: 0,
  });
  assert.ok(
    savedByQueue.drafts.some((draft) => draft.id === finished.job.savedDraftId),
    'the queued report is readable through the ordinary drafts tool once the job is dropped'
  );
  assert.equal('draft' in savedByQueue.drafts[0], false, 'catalogue rows never carry a full report body');

  const persistedReports = await callTool(server, 'nodus_list_deep_research_reports', {
    sort: 'newest',
    limit: 25,
    offset: 0,
  });
  assert.ok(
    persistedReports.reports.some((report) => report.id === finished.job.savedDraftId),
    'the dedicated persistent catalogue includes a completed queued report'
  );
  const persistedReport = await callTool(server, 'nodus_get_deep_research_report', {
    reportId: finished.job.savedDraftId,
  });
  assert.equal(persistedReport.report.id, finished.job.savedDraftId);
  assert.equal(
    persistedReport.report.draft.draftMarkdown,
    finished.report.draft.draftMarkdown,
    'detail retrieval returns the complete persisted report'
  );

  // Regression for the failure seen by real clients: an archive containing several
  // long reports used to be returned whole and crossed the 1 MB MCP response ceiling.
  // The catalogue must stay compact and traversable while detail remains lossless.
  const writingDraftRepo = require(path.join(repoRoot, 'electron/db/writingDraftsRepo.ts'));
  const longMarkdown = `# Long report\n\n${'evidence '.repeat(18_000)}`;
  for (let i = 0; i < 12; i += 1) {
    writingDraftRepo.saveWritingWorkshopDraft({
      title: `Archived report ${String(i).padStart(2, '0')}`,
      draft: {
        ...finished.report.draft,
        title: `Archived report ${String(i).padStart(2, '0')}`,
        abstract: `Archive summary ${i}. ${'context '.repeat(800)}`,
        draftMarkdown: `${longMarkdown}\n\nReport ${i}`,
        brief: { ...finished.report.draft.brief, objective: `Archived objective ${i}` },
      },
    });
  }
  const ordinaryDraft = writingDraftRepo.saveWritingWorkshopDraft({
    title: 'Ordinary literature review',
    draft: {
      ...finished.report.draft,
      title: 'Ordinary literature review',
      brief: { ...finished.report.draft.brief, kind: 'literature_review', objective: 'A normal workshop draft' },
    },
  });
  const firstArchivePage = await callTool(server, 'nodus_list_deep_research_reports', {
    query: 'Archived',
    sort: 'title',
    limit: 5,
    offset: 0,
  });
  assert.equal(firstArchivePage.total, 12);
  assert.equal(firstArchivePage.reports.length, 5);
  assert.equal(firstArchivePage.hasMore, true);
  assert.equal(firstArchivePage.reports[0].title, 'Archived report 00');
  assert.equal('draft' in firstArchivePage.reports[0], false);
  assert.ok(
    Buffer.byteLength(JSON.stringify(firstArchivePage), 'utf8') < 50_000,
    'a page of long reports remains comfortably below the MCP response ceiling'
  );
  const secondArchivePage = await callTool(server, 'nodus_list_deep_research_reports', {
    query: 'Archived',
    sort: 'title',
    limit: 5,
    offset: 5,
  });
  assert.equal(secondArchivePage.reports[0].title, 'Archived report 05', 'offset traverses the complete archive');
  const archivedDetail = await callTool(server, 'nodus_get_deep_research_report', {
    reportId: firstArchivePage.reports[0].id,
  });
  assert.equal(archivedDetail.report.draft.draftMarkdown.length, longMarkdown.length + '\n\nReport 0'.length);
  const ordinaryList = await callTool(server, 'nodus_list_writing_drafts', {
    kind: 'literature_review',
    sort: 'newest',
    limit: 10,
    offset: 0,
  });
  assert.equal(ordinaryList.total, 1, 'the generic catalogue can filter non-Deep-Research drafts');
  const ordinaryDetail = await callTool(server, 'nodus_get_writing_draft', { draftId: ordinaryDraft.id });
  assert.equal(ordinaryDetail.draft.draft.title, 'Ordinary literature review');

  const missing = await callTool(server, 'nodus_get_deep_research_job', { jobId: 'drj-does-not-exist' });
  assert.equal(missing.job, null);
  assert.match(missing.error, /nodus_list_deep_research_reports/, 'a dropped job points the client at the persistent gallery');

  // The two semantic searches must never hold the main process for a whole scan.
  // MCP calls arrive while the user is working in another application with Nodus
  // open behind it, so a blocking scan freezes a window nobody is even looking at:
  // one statement running vec_cosine() over every embedded row is, on a real corpus
  // (13,799 ideas, 44,138 passages), 95 ms per idea scan and 366 ms per passage
  // scan of dead UI. The paged scans (electron/db/vectorScan.ts) return the same
  // rows in the same order and yield between rowid windows.
  const toolsSource = await readFile(path.join(repoRoot, 'electron/mcp/tools.ts'), 'utf8');
  for (const blocking of ['findSimilarIdeas', 'findSimilarPassages']) {
    assert.doesNotMatch(
      toolsSource,
      new RegExp(`\\.${blocking}\\(`),
      `${blocking}() blocks the event loop for the whole scan — use ${blocking}Paged()`
    );
  }

  // Semantic passage search: unconfigured provider must fail cleanly…
  const passageAiError = await callToolRaw(server, 'nodus_search_passages', {
    query: 'turismo visual',
    limit: 10,
    minSimilarity: 0.18,
  });
  assert.equal(passageAiError.isError, true);
  assert.equal(JSON.parse(passageAiError.content[0].text).error.category, 'ai_unconfigured');

  // …and with embeddings in place it must rank by cosine similarity. Stub the
  // embedder (patching the transpiled CommonJS export) and seed vectors that match
  // currentEmbeddingConfig(), exactly as the real pipeline stores them.
  const aiClient = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  const ideasRepo = require(path.join(repoRoot, 'electron/db/ideasRepo.ts'));
  const embedConfig = ideasRepo.currentEmbeddingConfig();
  const setEmbedding = getDb().prepare(
    'UPDATE passages SET embedding = ?, embedding_provider = ?, embedding_model = ?, embedding_dim = ? WHERE passage_id = ?'
  );
  setEmbedding.run(ideasRepo.encodeEmbedding([1, 0]), embedConfig.provider, embedConfig.model, 2, 'passage-1');
  setEmbedding.run(ideasRepo.encodeEmbedding([0, 1]), embedConfig.provider, embedConfig.model, 2, 'passage-2');
  const originalEmbed = aiClient.embedQuery;
  aiClient.embedQuery = async () => [1, 0];
  try {
    const semantic = await callTool(server, 'nodus_search_passages', {
      query: 'turismo visual',
      limit: 10,
      minSimilarity: 0.18,
    });
    assert.equal(semantic.passages.length, 1, 'only the similar passage clears the threshold');
    assert.equal(semantic.passages[0].passage_id, 'passage-1');
    assert.ok(semantic.passages[0].similarity > 0.9);
    assert.equal(semantic.passages[0].work.zotero_key, 'ZOT1');
    assert.match(semantic.passages[0].textSnippet, /turismo visual/);
    assert.equal('text' in semantic.passages[0], false, 'search returns snippets, not full text');

    const scoped = await callTool(server, 'nodus_search_passages', {
      query: 'turismo visual',
      limit: 10,
      minSimilarity: 0,
      workId: 'ZOT2',
    });
    assert.equal(scoped.passages.length, 0, 'work scoping must exclude other works');

    const badScope = await callToolRaw(server, 'nodus_search_passages', {
      query: 'turismo visual',
      limit: 10,
      minSimilarity: 0.18,
      workId: 'ZOT-MISSING',
    });
    assert.equal(badScope.isError, true);
    assert.equal(JSON.parse(badScope.content[0].text).error.category, 'not_found');

    // Semantic archive search: with embeddings in place, only the similar document
    // clears the threshold and comes back compact with its similarity.
    const archiveItems = archiveRepo.listItems();
    const partida = archiveItems.find((item) => item.itemId !== padron.itemId);
    archiveRepo.setItemEmbedding(
      padron.itemId,
      [1, 0],
      embedConfig.provider,
      embedConfig.model,
      'hash-padron'
    );
    archiveRepo.setItemEmbedding(
      partida.itemId,
      [0, 1],
      embedConfig.provider,
      embedConfig.model,
      'hash-partida'
    );
    const archiveHits = await callTool(server, 'nodus_search_archive', { query: 'jornalero', limit: 5, minSimilarity: 0.35 });
    assert.equal(archiveHits.items.length, 1, 'only the similar archive item clears the threshold');
    assert.equal(archiveHits.items[0].itemId, padron.itemId);
    assert.ok(archiveHits.items[0].similarity > 0.9);
    assert.equal('extractedText' in archiveHits.items[0], false, 'archive search returns compact items');
    assert.equal(archiveHits.indexed, 2, 'archive search reports index coverage');
    assert.equal(archiveHits.warning, undefined, 'no warning while the archive is indexed');

    // An indexed corpus reports coverage and stays silent…
    assert.equal(semantic.indexed, 2, 'passage search reports how many passages are indexed');
    assert.equal(semantic.indexable, 2);
    assert.equal(semantic.warning, undefined, 'no warning while the passages are indexed');

    // …but an UNINDEXED corpus must never answer with a bare empty list: that reads as
    // "the corpus does not discuss this" when it only means "nothing was embedded".
    const unindexed = await callTool(server, 'nodus_search_ideas', { query: 'turismo visual', limit: 5 });
    assert.deepEqual(unindexed.ideas, [], 'no ideas carry embeddings in this fixture');
    assert.equal(unindexed.indexed, 0, 'idea search reports zero coverage');
    assert.equal(unindexed.indexable, 2, 'and how many ideas could be indexed');
    assert.match(unindexed.warning ?? '', /not mean the corpus lacks the topic/i, 'and warns that the empty result is not an absence of evidence');

    // Coverage is model-scoped: re-embedding under a different model must resurface the
    // warning, because the stored vectors can no longer match the configured model.
    const stale = getDb().prepare('UPDATE passages SET embedding_model = ?');
    stale.run('some-other-model');
    const afterModelChange = await callTool(server, 'nodus_search_passages', { query: 'turismo visual', limit: 10, minSimilarity: 0.18 });
    assert.equal(afterModelChange.passages.length, 0, 'vectors from another model cannot match');
    assert.equal(afterModelChange.indexed, 0, 'so coverage drops to zero');
    assert.ok(afterModelChange.warning, 'and the empty result is flagged rather than read as absence');
    stale.run(embedConfig.model);
  } finally {
    aiClient.embedQuery = originalEmbed;
  }

  // A tool that writes before calling the AI must not leave the write behind when the
  // AI step fails: the client is told the call errored, so nothing may survive it.
  const researchMapRepo = require(path.join(repoRoot, 'electron/db/researchMapRepo.ts'));
  const questionsBefore = researchMapRepo.listResearchQuestions().length;
  const coverageError = await callToolRaw(server, 'nodus_ask_coverage_question', { question: '¿Deja basura al fallar?' });
  assert.equal(coverageError.isError, true, 'coverage mapping fails without an AI provider');
  assert.equal(JSON.parse(coverageError.content[0].text).error.category, 'ai_unconfigured');
  assert.equal(
    researchMapRepo.listResearchQuestions().length,
    questionsBefore,
    'a failed coverage question must be rolled back, not left orphaned in the vault'
  );

  // The vault the tools SERVE is the database this process has open, which is not always
  // the registry's activeVaultId — a second Nodus instance can rewrite that file while
  // this connection stays on the old vault. Reporting the registry's answer would label
  // this vault's data with another vault's name, so capabilities must name the open one
  // and warn. Kept last: it deliberately leaves the registry pointing elsewhere.
  const vaultRegistry = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const servingVaultId = vaultRegistry.getActiveVault().id;
  const otherVault = vaultRegistry.createVault('Otra bóveda', 'estudio');
  vaultRegistry.setActiveVault(otherVault.id); // rewrites the registry; the open DB does not move
  const diverged = await callTool(server, 'nodus_get_capabilities');
  assert.equal(diverged.vault.active.id, servingVaultId, 'capabilities names the vault whose data it serves, not the registry’s');
  assert.match(diverged.vault.warning ?? '', /Otra bóveda/, 'and warns that the app has since switched vaults');
  assert.ok(
    diverged.vault.available.find((vault) => vault.id === servingVaultId).active,
    'the served vault is the one flagged active in the list'
  );
  vaultRegistry.setActiveVault(servingVaultId);
  const realigned = await callTool(server, 'nodus_get_capabilities');
  assert.equal(realigned.vault.warning, undefined, 'no warning once the registry and the open database agree');

  closeDb();
  console.log('mcp tool contract test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

async function callTool(server, name, args = {}) {
  const result = await callToolRaw(server, name, args);
  assert.notEqual(result.isError, true, `${name} returned an MCP error: ${JSON.stringify(result)}`);
  return JSON.parse(result.content[0].text);
}

async function callToolRaw(server, name, args = {}, extra = undefined) {
  const entry = server.tools.get(name);
  assert.ok(entry, `missing MCP tool ${name}`);
  return entry.handler(args, extra);
}

function seedMcpDatabase(db) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO works (
      nodus_id, zotero_key, zotero_version, title, authors_json, year, item_type, doi,
      read_tag, manual_deep, deep_trigger, source_type, light_status, deep_status,
      summary_status, archived, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'work-1',
    'ZOT1',
    1,
    'Turismo visual y memoria',
    JSON.stringify(['Garcia, Ana']),
    2024,
    'book',
    null,
    1,
    1,
    'both',
    'pdf',
    'done',
    'done',
    'done',
    0,
    'Obra central'
  );
  db.prepare(
    `INSERT INTO works (
      nodus_id, zotero_key, zotero_version, title, authors_json, year, item_type, doi,
      read_tag, manual_deep, deep_trigger, source_type, light_status, deep_status,
      summary_status, archived, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'work-2',
    'ZOT2',
    1,
    'Turismo y guias locales',
    JSON.stringify(['Lopez, Marta']),
    2022,
    'article',
    null,
    0,
    0,
    null,
    'abstract_only',
    'done',
    'none',
    'none',
    0,
    null
  );
  db.prepare(
    `INSERT INTO works (
      nodus_id, zotero_key, zotero_version, title, authors_json, year, item_type, doi,
      read_tag, manual_deep, deep_trigger, source_type, light_status, deep_status,
      summary_status, archived, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'work-3',
    'ZOT3',
    1,
    'Archivo patrimonial',
    JSON.stringify(['Diaz, Luis']),
    2018,
    'book',
    null,
    0,
    0,
    null,
    'pdf',
    'none',
    'none',
    'none',
    1,
    null
  );

  db.prepare('INSERT INTO authors (author_id, name, affiliation, canonical_key) VALUES (?, ?, ?, ?)').run(
    'author-1',
    'Garcia, Ana',
    'Universidad de Prueba',
    'garcia::a'
  );
  db.prepare('INSERT INTO authors (author_id, name, affiliation, canonical_key) VALUES (?, ?, ?, ?)').run(
    'author-2',
    'Lopez, Marta',
    null,
    'lopez::m'
  );
  db.prepare('INSERT INTO work_authors (nodus_id, author_id, role) VALUES (?, ?, ?)').run('work-1', 'author-1', 'author');
  db.prepare('INSERT INTO work_authors (nodus_id, author_id, role) VALUES (?, ?, ?)').run('work-2', 'author-2', 'author');
  db.prepare(
    `INSERT INTO author_dossier_synthesis (
      author_id, thesis, remember_json, positioning, model_json, fingerprint, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'author-1',
    'Garcia sintetiza el papel de la memoria visual en el turismo.',
    JSON.stringify(['La memoria visual ordena el corpus.', 'El turismo actua como mediador.']),
    'Se conecta con otros autores a traves del tema turismo.',
    null,
    'test-fingerprint',
    now
  );

  db.prepare('INSERT INTO themes (theme_id, label, created_at, pinned) VALUES (?, ?, ?, ?)').run('theme-1', 'turismo', now, 1);
  db.prepare('INSERT INTO work_themes (nodus_id, theme_id) VALUES (?, ?)').run('work-1', 'theme-1');
  db.prepare('INSERT INTO work_themes (nodus_id, theme_id) VALUES (?, ?)').run('work-2', 'theme-1');
  db.prepare('INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'idea-1',
    'claim',
    'Turismo visual',
    'El turismo reorganiza la memoria visual local.',
    now
  );
  db.prepare('INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'idea-2',
    'finding',
    'Patrimonio selectivo',
    'El patrimonio se selecciona de forma desigual.',
    now
  );
  db.prepare('INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence) VALUES (?, ?, ?, ?, ?)').run(
    'idea-1',
    'work-1',
    'principal',
    'Desarrollo sobre fotografias y turismo.',
    0.92
  );
  db.prepare('INSERT INTO idea_occurrences (global_id, nodus_id, role, development, confidence) VALUES (?, ?, ?, ?, ?)').run(
    'idea-2',
    'work-2',
    'secondary',
    'Contrapunto patrimonial.',
    0.81
  );
  db.prepare('INSERT INTO idea_theme_links (nodus_id, global_id, theme_id, confidence, basis) VALUES (?, ?, ?, ?, ?)').run(
    'work-1',
    'idea-1',
    'theme-1',
    0.9,
    'explicit'
  );
  db.prepare('INSERT INTO evidence (id, global_id, nodus_id, quote, location, kind) VALUES (?, ?, ?, ?, ?, ?)').run(
    'evidence-1',
    'idea-1',
    'work-1',
    'La imagen turistica reordena la memoria.',
    'p. 12',
    'explicit'
  );
  db.prepare('INSERT INTO gaps (id, nodus_id, related_idea, kind, statement, confidence, evidence_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'gap-1',
    'work-1',
    'idea-1',
    'open_question',
    'Falta comparar la dimension visual con archivos locales.',
    0.72,
    'evidence-1'
  );
  db.prepare(
    `INSERT INTO passages (
      passage_id, nodus_id, chunk_index, text, page_label, char_len, content_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('passage-1', 'work-1', 0, 'Este pasaje analiza el turismo visual y la memoria.', '12', 51, 'hash-1', now);
  db.prepare(
    `INSERT INTO passages (
      passage_id, nodus_id, chunk_index, text, page_label, char_len, content_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('passage-2', 'work-1', 1, 'Segundo pasaje sobre memoria local.', '13', 34, 'hash-1', now);

  db.prepare(`INSERT INTO document_profile_versions(
    version_id,nodus_id,state,source_fingerprint,pipeline_version,schema_version,source_language,
    presentation_language,overview,profile_json,prompt_hash,audit_json,quality_score,created_at,published_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'profile-1','work-1','current','hash-1','document-profile/1',1,'es','es',
    'La obra estudia el turismo y la memoria visual.','{}','prompt-1',
    '{"passed":true,"score":1,"supportCoverage":1,"structureCoverage":1,"issues":[],"repaired":false}',1,now,now,
  );
  db.prepare(`INSERT INTO document_profile_fields(
    field_id,version_id,nodus_id,kind,ordinal,text,confidence,centrality,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
    'profile-field-1','profile-1','work-1','thesis',0,'El turismo reorganiza la memoria visual local.',1,1,now,
  );
  db.prepare(`INSERT INTO document_profile_state(
    nodus_id,current_version_id,status,source_fingerprint,profile_fingerprint,pipeline_version,updated_at
  ) VALUES(?,?,?,?,?,?,?)`).run('work-1','profile-1','current','hash-1','profile-hash','document-profile/1',now);
  db.prepare(`INSERT INTO document_profiles_fts(nodus_id,version_id,title,overview,fields)
    VALUES(?,?,?,?,?)`).run(
    'work-1','profile-1','Turismo visual y memoria','La obra estudia el turismo y la memoria visual.',
    'El turismo reorganiza la memoria visual local.',
  );

  db.prepare('INSERT INTO note_folders (id, parent_id, name, summary, order_idx, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'folder-1',
    null,
    'Notas turismo',
    'Ideas sobre turismo',
    0,
    now,
    now
  );
  db.prepare(
    'INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('note-1', 'folder-1', 'Nota turismo', 'markdown', 'Contenido sobre turismo visual y memoria.', null, 0, now, now);

  const route = {
    id: 'route-1',
    title: 'Ruta turismo',
    description: 'Ruta de prueba sobre turismo.',
    weight: 1,
    weightLabel: 'linea principal',
    themes: ['turismo'],
    stops: [{ id: 'stop-1', kind: 'theme', title: 'Turismo', focus: 'Tema principal.', nodeIds: ['theme:theme-1'], edgeId: null }],
  };
  db.prepare(
    `INSERT INTO tutor_saved_routes (
      route_id, plan_id, generated_at, updated_at, last_played_at, mode, prompt, model_json,
      overview, total_themes, total_ideas, total_connections, route_json, rating
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('route-1', 'plan-1', now, now, now, 'overview', '', null, 'Vista general del turismo.', 1, 2, 0, JSON.stringify(route), 5);

  db.prepare(
    `INSERT INTO projects (
      id, title, kind, status, brief, research_question_id, root_folder_id, model_json, target_words, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('project-1', 'Tesis sobre turismo', 'thesis', 'active', 'Brief del proyecto', null, 'folder-1', null, 10000, now, now);
  db.prepare(
    `INSERT INTO project_sections (
      id, project_id, folder_id, title, role, status, target_words, order_idx, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('section-1', 'project-1', 'folder-1', '06 - Manuscrito', 'manuscript', 'in_progress', 3000, 0, now, now);
  db.prepare(
    `INSERT INTO project_chapters (
      id, project_id, section_id, note_id, title, source_format, original_file_name, original_text_hash,
      original_text, current_markdown, word_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'chapter-1',
    'project-1',
    'section-1',
    'note-1',
    'Capitulo 1',
    'markdown',
    'capitulo.md',
    'chapter-hash',
    'Texto original',
    '# Capitulo 1\n\nTexto sobre turismo visual.',
    6,
    now,
    now
  );
}
