// Verifies that rebuilding the study search index gathers the corpus once
// rather than once per progress emit.
//
// collectStudySearchEntries re-reads every study document, material,
// transcript, question and exam from SQLite, re-chunks all their markdown into
// 1400-character pieces and SHA1-hashes each one. It was reached from
// statusFrom, which every progress emit calls — and the indexing loop emits
// twice per 16-entry batch. A 2,000-fragment corpus therefore paid for roughly
// 250 full re-collections of data it was already holding, in long synchronous
// stalls between embedding calls, monopolising the single SQLite handle.
//
// The measurement counts prepared statements rather than elapsed time: the
// suite runs test files in parallel, so timing thresholds flake.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-study-indexing-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-study-search-indexing.mjs'), '--electron-study-indexing-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-indexing-'));
installRuntimeHooks(root);

try {
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const search = require(path.join(repoRoot, 'electron/ai/studySearch.ts'));
  const database = require(path.join(repoRoot, 'electron/db/database.ts'));

  // A corpus big enough to span several embedding batches (16 entries each),
  // so a per-emit re-collection would be clearly visible.
  const course = org.createStudyCourse({ name: 'Historia' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Contemporánea' });
  const paragraph =
    'El proceso descrito en este apartado se apoya en fuentes primarias y en la ' +
    'correspondencia conservada, que permite reconstruir la secuencia de los hechos ' +
    'con un grado de detalle poco habitual para el periodo estudiado. ';
  for (let index = 0; index < 12; index += 1) {
    org.createStudyDocument({
      title: `Apunte ${index}`,
      contentMarkdown: `# Apunte ${index}\n\n${paragraph.repeat(30)}`,
      placement: { courseId: course.id, subjectId: subject.id, topicId: null },
    });
  }

  const entries = search.collectStudySearchEntries();
  assert.ok(entries.length > 32, `corpus must span several batches (${entries.length} fragments)`);

  // Meter the database: every collection runs a fixed set of queries, so
  // prepared statements are a faithful proxy for "how many times did we gather
  // the whole corpus".
  const db = database.getDb();
  let prepares = 0;
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    // Registry lookups and normalized-vector persistence are intentionally per batch.
    // Count corpus reads, so the metric still detects full re-collection per emit.
    if (!/\bembedding_index(?:es|_\w+)\b/.test(sql)) prepares += 1;
    return originalPrepare(sql);
  };

  const beforeOneCollect = prepares;
  search.collectStudySearchEntries();
  const perCollect = prepares - beforeOneCollect;
  assert.ok(perCollect > 0, 'collecting the corpus must hit the database');

  // The number of prepared statements per collection is fixed — it does not
  // depend on how many rows come back — so prepares/perCollect is a faithful
  // count of "how many times did the rebuild gather the whole corpus".
  const measureRebuild = async () => {
    const before = prepares;
    const result = await search.rebuildStudySearchIndex();
    return { result, collections: (prepares - before) / perCollect };
  };

  const small = await measureRebuild();
  assert.equal(small.result.state, 'ready', 'the rebuild must complete');
  assert.ok(small.result.indexedEntries >= entries.length, 'every fragment must be indexed');
  const smallBatches = Math.ceil(entries.length / 16);
  assert.ok(smallBatches >= 3, `the corpus should span at least three batches (${smallBatches})`);

  // Double the corpus, which doubles the number of embedding batches — and
  // therefore the number of progress emits.
  for (let index = 12; index < 26; index += 1) {
    org.createStudyDocument({
      title: `Apunte ${index}`,
      contentMarkdown: `# Apunte ${index}\n\n${paragraph.repeat(30)}`,
      placement: { courseId: course.id, subjectId: subject.id, topicId: null },
    });
  }
  const grownEntries = search.collectStudySearchEntries().length;
  const grownBatches = Math.ceil(grownEntries / 16);
  assert.ok(grownBatches >= smallBatches * 1.8, `the corpus must have grown substantially (${smallBatches} -> ${grownBatches} batches)`);

  const large = await measureRebuild();
  assert.equal(large.result.state, 'ready', 'the larger rebuild must complete too');

  // The load-bearing property: gathering the corpus is a fixed cost per
  // rebuild, not a cost per progress emit. Before the fix each emit collected,
  // so this difference would have tracked the extra batches.
  const extraCollections = large.collections - small.collections;
  assert.ok(
    extraCollections < 1,
    `gathering must not scale with batch count: ${small.collections.toFixed(1)} collections at ` +
      `${smallBatches} batches vs ${large.collections.toFixed(1)} at ${grownBatches} batches ` +
      `(a per-emit collection would have added about ${(grownBatches - smallBatches) * 2})`
  );
  assert.ok(
    large.collections < 4,
    `a rebuild should gather the corpus a small constant number of times, measured ${large.collections.toFixed(1)}`
  );

  // --- Progress reporting must still be correct ---------------------------
  // The optimisation passes an already-collected list into the status
  // computation, so a wrong list would silently corrupt what the UI shows.
  const status = search.getStudySearchIndexStatus();
  assert.equal(status.state, 'ready', 'status must report the finished state');
  assert.equal(status.indexedEntries, large.result.indexedEntries, 'indexed count must agree');
  assert.equal(status.pendingEntries, 0, 'nothing may remain pending straight after a full rebuild');

  // Adding new material must show up as pending again — proving the passed-in
  // list did not permanently replace real collection.
  org.createStudyDocument({
    title: 'Apunte nuevo',
    contentMarkdown: `# Apunte nuevo\n\n${paragraph.repeat(4)}`,
    placement: { courseId: course.id, subjectId: subject.id, topicId: null },
  });
  const afterAdding = search.getStudySearchIndexStatus();
  assert.ok(
    afterAdding.pendingEntries > 0,
    'new material must be reported as pending, so the status is still computed from the real corpus'
  );

  database.closeDb();
  console.log('# study search indexing tests passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: {}, shell: {}, BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
