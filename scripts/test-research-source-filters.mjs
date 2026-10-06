import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-source-filters')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-source-filter-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('External network forbidden: source-filter tests use local fixtures only'); };
try {
  const db = load('electron/db/database.ts').getDb();
  load('electron/db/settingsRepo.ts').updateSettings({ embeddingProvider: 'openai', embeddingModel: 'test-vector' });
  const ideas = load('electron/db/ideasRepo.ts');
  const passages = load('electron/db/passagesRepo.ts');
  const profiles = load('electron/db/documentProfilesRepo.ts');
  const summaries = load('electron/db/workSummariesRepo.ts');
  for (const [id, name] of [['a', 'Autora Seleccionada'], ['b', 'OUTSIDE_AUTHOR']]) db.prepare('INSERT INTO authors(author_id,name) VALUES (?,?)').run(id, name);
  for (const id of ['a1', 'a2', 'b1', 'edited', 'archived']) {
    const outside = ['b1', 'edited', 'archived'].includes(id);
    const author = outside ? 'b' : 'a';
    db.prepare(`INSERT INTO works(nodus_id,zotero_key,title,authors_json,year,item_type,source_type,archived,light_status,deep_status,summary_status,summary_hash,deep_hash)
      VALUES(?,?,?,?,2020,'book','text',?,'done','done','done','hash','hash')`).run(id, id, outside ? `OUTSIDE_ONLY ${id}` : `Selected ${id}`, JSON.stringify([outside ? 'OUTSIDE_AUTHOR' : 'Autora Seleccionada']), id === 'archived' ? 1 : 0);
    db.prepare("INSERT INTO work_authors(nodus_id,author_id,role) VALUES (?,?,'author')").run(id, author);
    const text = outside ? 'topic OUTSIDE_ONLY evidence' : `topic Selected evidence ${id}`;
    passages.replaceWorkPassages(id, 'hash', [{ text, pageLabel: '1', embedding: outside ? [1, 0] : [.8, .6] }]);
    profiles.publishDocumentProfile({ nodusId: id, sourceFingerprint: 'hash', pipelineVersion: 'test/1', schemaVersion: 1, sourceLanguage: 'es', presentationLanguage: 'es', profile: { overview: text }, overview: text, sections: [], fields: [], supports: [], ideaLinks: [],
      vectors: [{ vectorId: `v-${id}`, kind: 'overview', sourceId: `s-${id}`, text, weight: 1, embedding: outside ? [1, 0] : [.8, .6] }],
      generatorModel: null, auditorModel: null, promptHash: 'test', audit: { passed: true, score: 1, issues: [] }, qualityScore: 1 });
    summaries.upsertWorkSummary({ nodusId: id, summary: text, sourceLevel: 'deep', contentHash: 'hash', model: null });
    summaries.updateWorkSummaryEmbedding(id, text, outside ? [1, 0] : [.8, .6]);
  }
  db.prepare("INSERT INTO work_authors(nodus_id,author_id,role) VALUES ('edited','a','editor')").run();
  for (const [id, work] of [['shared', 'a1'], ['inside', 'a1'], ['second', 'a2'], ['outside', 'b1']]) {
    const text = id === 'outside' ? 'OUTSIDE_ONLY idea' : `Selected idea ${id}`;
    db.prepare("INSERT INTO ideas(global_id,type,label,statement,created_at) VALUES (?,'claim',?,?,datetime('now'))").run(id, text, text);
    ideas.updateIdeaEmbedding(id, text, id === 'outside' ? [1, 0] : [.8, .6]);
    db.prepare("INSERT INTO idea_occurrences(global_id,nodus_id,role,development,confidence) VALUES (?,?,'supports',?,.9)").run(id, work, text);
    db.prepare("INSERT INTO evidence(id,global_id,nodus_id,quote,location,kind) VALUES (?,?,?,?,'1','quote')").run(`e-${id}`, id, work, text);
  }
  db.prepare("INSERT INTO idea_occurrences VALUES ('shared','b1','supports','OUTSIDE_ONLY occurrence',1)").run();
  db.prepare("INSERT INTO evidence(id,global_id,nodus_id,quote,location,kind) VALUES ('e-out-shared','shared','b1','OUTSIDE_ONLY shared evidence','1','quote')").run();
  db.prepare("INSERT INTO themes(theme_id,label) VALUES ('t','Shared theme')").run();
  for (const id of ['a1', 'b1']) db.prepare("INSERT INTO work_themes VALUES (?,'t')").run(id);
  for (const id of ['shared', 'outside']) db.prepare("INSERT INTO idea_theme_links(global_id,theme_id,nodus_id,confidence,basis) VALUES (?,'t',?,.9,'explicit')").run(id, id === 'outside' ? 'b1' : 'a1');
  for (const [id, work] of [['edge-in', 'a1'], ['edge-out', 'b1']]) db.prepare("INSERT INTO edges VALUES (?,'shared','inside',?,'explicit',.9,?)").run(id, id === 'edge-in' ? 'contradicts' : 'supports', work);
  db.prepare("INSERT INTO gaps(id,nodus_id,related_idea,kind,statement,confidence,evidence_id) VALUES ('gap-in','a1','outside','research','Selected gap',.9,'e-outside')").run();
  db.prepare("INSERT INTO gaps(id,nodus_id,kind,statement,confidence) VALUES ('gap-out','b1','research','OUTSIDE_ONLY gap',1)").run();
  const scopeApi = load('electron/ai/researchSourceScope.ts');
  const sources = scopeApi.listResearchContextSources();
  assert.deepEqual(sources.authors.find(a => a.id === 'a').workIds.sort(), ['a1', 'a2'], 'editorship alone is not authorship');
  const filter = (authorIds = [], workIds = [], enabled = true) => ({ authorIds, workIds, enabled });
  assert.equal(scopeApi.resolveResearchSourceScope(filter(['a'], [], false)), null);
  for (const [value, expected] of [[filter(['a']), ['a1', 'a2']], [filter([], ['b1']), ['b1']], [filter(['a'], ['a1', 'b1']), ['a1']], [filter(['missing']), []], [filter([], ['archived']), []], [filter(), []]]) {
    assert.deepEqual([...scopeApi.resolveResearchSourceScope(value).workIds].sort(), expected);
  }
  const ai = load('electron/ai/aiClient.ts');
  let vector = null;
  ai.embedQuery = async () => vector;
  const textReads = [];
  load('electron/zotero/zoteroClient.ts').getItem = async () => null;
  load('electron/extraction/textExtractor.ts').resolveWorkText = async (_user, id) => { textReads.push(id); return { text: id.startsWith('a') ? `Selected document ${id}` : 'OUTSIDE_ONLY full text', sourceType: 'text' }; };
  const { buildResearchContext, buildNodiResearchContext } = load('electron/ai/researchAssistant.ts');
  const selection = { ideas: true, themes: true, contradictions: true, gaps: true, readingPath: true, authors: true, documents: true, passages: true, graph: true,
    graphParts: { ideaNodes: true, themeNodes: true, ideaEdges: true, authorGraph: true } };
  let checks = 0;
  for (const embedding of [null, [1, 0], [-1, 0]]) {
    vector = embedding;
    textReads.length = 0;
    const result = await buildResearchContext({ ...selection, sourceFilter: filter(['a'], ['a1']) }, 'topic', 250000, 'es');
    const json = JSON.stringify(result.context);
    assert.doesNotMatch(json, /OUTSIDE_ONLY|OUTSIDE_AUTHOR|edge-out/);
    assert.ok(json.includes('Selected idea inside'));
    assert.doesNotMatch(json, /Selected idea shared/, 'an inseparable cross-source Idea is excluded from the academic scope');
    assert.deepEqual([...new Set(textReads)], ['a1']);
    assert.equal(result.stats.works, 1);
    assert.equal(result.context.huecos_de_investigacion[0].evidence, null);
    assert.equal(result.context.huecos_de_investigacion[0].related_idea, null);
    if (embedding === null) assert.ok(result.context.pasajes_relevantes.length > 0, 'lexical passages work without an embedding provider');
    for (const value of [filter(), filter(['missing']), filter(['a'], ['b1']), filter([], ['archived'])]) {
      textReads.length = 0;
      const empty = await buildResearchContext({ ...selection, sourceFilter: value }, 'topic', 250000, 'es');
      assert.equal(empty.stats.works, 0);
      assert.deepEqual(empty.context.ideas_generadas, []);
      assert.deepEqual(empty.context.documentos_relacionados, []);
      assert.deepEqual(empty.context.pasajes_relevantes, []);
      assert.deepEqual(textReads, []);
      assert.doesNotMatch(JSON.stringify(empty.context), /OUTSIDE_ONLY|Selected idea/);
      checks++;
    }
    checks++;
  }
  // Prove filtering happens before top-K, even when excluded vectors rank higher.
  assert.deepEqual(passages.lexicalPassageSearch('topic', 10, { nodusIds: [] }), []);
  assert.deepEqual(passages.findSimilarPassages([1, 0], -1, 10, { nodusIds: [] }), []);
  assert.deepEqual(await passages.findSimilarPassagesPaged([1, 0], -1, 10, { nodusIds: [] }), []);
  assert.deepEqual(await ideas.findSimilarIdeasPaged([1, 0], -1, 10, { nodusIds: [] }), []);
  const { retrieveHierarchical } = load('electron/ai/hierarchicalRetrieval.ts');
  const hit = await retrieveHierarchical('topic', { embedding: [1, 0], nodusIds: ['a1'], ideaLimit: 1, passageLimit: 1, documentLimit: 1 });
  assert.ok(hit.ideas.length && hit.documents.length && hit.passages.length);
  assert.ok(hit.documents.every(hit => hit.nodusId === 'a1'));
  assert.ok(hit.passages.every(hit => hit.nodus_id === 'a1'));
  assert.ok(hit.ideas.every(hit => ['inside', 'shared'].includes(hit.global_id)));
  assert.deepEqual(await summaries.findSimilarWorksPaged([1,0], -1, 1, { nodusIds: ['a1'] }).then(rows => rows.map(row => row.nodus_id)), ['a1']);
  vector = null;
  const original = await buildResearchContext(selection, 'topic', 250000, 'es');
  const disabled = await buildResearchContext({ ...selection, sourceFilter: filter(['a'], [], false) }, 'topic', 250000, 'es');
  delete original.context.generated_at; delete disabled.context.generated_at;
  delete original.context.rutas_de_lectura.generatedAt; delete disabled.context.rutas_de_lectura.generatedAt;
  assert.deepEqual(disabled.context, original.context, 'disabled filters preserve existing retrieval');
  assert.ok(JSON.stringify((await buildNodiResearchContext('topic')).context).includes('OUTSIDE_ONLY'), 'Research Assistant filters never narrow Nodi');
  const chat = load('electron/db/chatRepo.ts');
  const conversation = chat.createConversation({ selection: { ...selection, sourceFilter: filter(['a']) } });
  assert.deepEqual(chat.getConversation(conversation.id).selection.sourceFilter, filter(['a']), 'filters round-trip through existing conversation persistence');
  console.log(`Source filters passed: ${checks} complete context assemblies, pre-ranking SQL filters, author/work intersection, editor exclusion, empty/archived sources, lexical fallback, persistence and Nodi isolation. No network or paid inference.`);
} finally {
  globalThis.fetch = originalFetch;
  load('electron/db/database.ts').closeDb();
  fs.rmSync(scratch, { recursive: true, force: true });
}
