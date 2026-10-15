// Marking a saved Deep Research report as read, against the REAL schema and the REAL
// repository. Runs under Electron-as-Node so better-sqlite3 matches the app ABI.
//
// Four things are asserted, and each one is a way the feature could be right in the
// gallery and wrong on disk:
//
//   1. The mark is a row in its own table. Not a column on writing_saved_drafts, which
//      is in MUTABLE_TABLES: an UPDATE there fires the outbox trigger, so on a connected
//      vault ticking "read" would put the whole report back on the wire. The test proves
//      the report row is byte-identical before and after.
//   2. It reaches the list, which is what the gallery draws from.
//   3. Unmarking removes it, and deleting the report takes its mark with it — a mark
//      pointing at nothing would be resurrected by the next report that reused the id.
//   4. It travels in a .nodussync package, in the same group as the reports: having read
//      something on the laptop is still true at the desk.
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

if (!process.argv.includes('--electron-deep-research-read-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-deep-research-read.mjs'), '--electron-deep-research-read-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-dr-read-'));
installTsHook();

try {
  const Database = require('better-sqlite3');
  const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  const db = new Database(path.join(root, 'vault.sqlite'));
  runMigrations(db);
  // The repository asks `./database` for its connection; hand it this one before it is
  // ever loaded, so nothing tries to open the real vault.
  stubModule('electron/db/database.ts', { getDb: () => db });
  const visualCleanup = [];
  stubModule('electron/vaults/vaultRegistry.ts', { getActiveVault: () => ({ id: 'fixture-vault' }) });
  stubModule('electron/capabilities/documentStore.ts', { deleteDocumentVisuals: (vault, target) => visualCleanup.push({ vault, target }) });
  const repo = require(path.join(repoRoot, 'electron/db/writingDraftsRepo.ts'));

  const brief = { kind: 'deep_research', objective: 'La memoria de la posguerra' };
  const draft = { title: 'La memoria de la posguerra', brief, selection: {}, draftMarkdown: '# Uno\n\nTexto.' };
  const saved = repo.saveWritingWorkshopDraft({ draft, title: draft.title, model: null });
  assert.equal(saved.readAt, null, 'a report is unread when it is written');
  assert.equal(
    repo.listWritingWorkshopDraftSummaries({ kind: 'deep_research', limit: 10, offset: 0 }).drafts[0].deepResearchApproach,
    'general',
    'an old report without approach metadata is listed as General'
  );

  const reportRow = () => db.prepare('SELECT * FROM writing_saved_drafts WHERE id = ?').get(saved.id);
  const before = JSON.stringify(reportRow());

  // ── 1. Marking read leaves the report itself untouched ──────────────────────
  const read = repo.setWritingWorkshopDraftRead(saved.id, true);
  assert.ok(read?.readAt, 'marking read returns the report wearing its mark');
  assert.equal(
    JSON.stringify(reportRow()),
    before,
    'reading a report must not rewrite the report — that is what puts it back on the wire'
  );
  assert.equal(read.updatedAt, saved.updatedAt, 'updatedAt is the report’s, not the reader’s');

  // ── 2. The mark reaches the list the gallery draws ──────────────────────────
  const listed = repo.listWritingWorkshopDrafts().find((item) => item.id === saved.id);
  assert.equal(listed?.readAt, read.readAt, 'the list carries the mark');
  assert.ok(Number.isFinite(Date.parse(read.readAt)), 'the mark is a timestamp');

  // Marking twice is one row with a later stamp, never two.
  repo.setWritingWorkshopDraftRead(saved.id, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM writing_draft_reads').get().n, 1, 'one mark per report');

  // A report that does not exist cannot be marked, and leaves nothing behind.
  assert.equal(repo.setWritingWorkshopDraftRead('no-such-report', true), null, 'no report, no mark');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM writing_draft_reads').get().n, 1, 'and no stray row');

  // ── 3. Unmarking, and deleting the report ───────────────────────────────────
  const unread = repo.setWritingWorkshopDraftRead(saved.id, false);
  assert.equal(unread?.readAt, null, 'the mark can be taken back');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM writing_draft_reads').get().n, 0);

  repo.setWritingWorkshopDraftRead(saved.id, true);
  repo.deleteWritingWorkshopDraft(saved.id);
  assert.deepEqual(visualCleanup, [{ vault: 'fixture-vault', target: { kind: 'deep-research', id: saved.id } }], 'report deletion also requests cleanup of its own visual assets');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM writing_draft_reads').get().n,
    0,
    'deleting a report takes its mark with it'
  );

  // ── 4. It travels between the reader’s own machines ─────────────────────────
  // `describeSyncCoverage` takes no connection and reads the active vault, so the
  // classification is checked through the group list, which does.
  const { syncedTableNames, syncedTablesByGroup } = require(path.join(repoRoot, 'electron/db/syncTables.ts'));
  assert.ok(syncedTableNames(db).includes('writing_draft_reads'), 'the mark travels in a sync package');
  const writingGroup = syncedTablesByGroup(db).find((group) => group.key === 'writing');
  assert.ok(
    writingGroup?.tables.includes('writing_draft_reads'),
    'the mark travels in the same group as the reports it is about'
  );

  // ── 5. Generation provenance survives a real database close/reopen ─────────
  const provenanceBrief = {
    kind: 'deep_research',
    objective: 'Comparar dos tradiciones historiográficas',
    deepResearchApproach: 'literature_review',
  };
  const provenanceModel = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
  const provenanceDraft = {
    title: 'Dos tradiciones historiográficas',
    brief: provenanceBrief,
    selection: {},
    draftMarkdown: '# Informe\n\nTexto.',
    deepResearchApproach: 'literature_review',
    generationModel: provenanceModel,
  };
  const persisted = repo.saveWritingWorkshopDraft({
    draft: provenanceDraft,
    title: provenanceDraft.title,
    model: provenanceModel,
  });
  assert.equal(
    repo.listWritingWorkshopDraftSummaries({ kind: 'deep_research', limit: 10, offset: 0 })
      .drafts.find((item) => item.id === persisted.id)?.deepResearchApproach,
    'literature_review',
    'the gallery summary carries the generation-time approach'
  );

  // A malformed stored row cannot become an empty successful consultation.
  const intact = repo.listWritingWorkshopDrafts({ requireComplete: true });
  assert.equal(intact.length, 1);
  const rowBeforeCorruption = db.prepare('SELECT * FROM writing_saved_drafts WHERE id = ?').get(persisted.id);
  db.prepare('UPDATE writing_saved_drafts SET draft_json = ? WHERE id = ?').run('{broken', persisted.id);
  assert.throws(() => repo.listWritingWorkshopDrafts({ requireComplete: true }), /formato inválido/);
  assert.throws(() => repo.listWritingWorkshopDraftSummaries({ kind: 'deep_research', limit: 10, offset: 0 }), /formato inválido/);
  assert.throws(() => repo.countWritingWorkshopDrafts('deep_research'), /formato inválido/);
  assert.throws(() => repo.getWritingWorkshopDraft(persisted.id), /formato inválido/);
  assert.equal(repo.listWritingWorkshopDrafts().length, 0, 'legacy internal subset behavior remains compatible');
  assert.equal(db.prepare('SELECT draft_json FROM writing_saved_drafts WHERE id = ?').get(persisted.id).draft_json, '{broken', 'failed consultation preserves the damaged record');
  const second = repo.saveWritingWorkshopDraft({ draft: provenanceDraft, title: 'Intact second report', model: provenanceModel });
  assert.throws(() => repo.listWritingWorkshopDrafts({ requireComplete: true }), /formato inválido/);
  assert.deepEqual(repo.listWritingWorkshopDrafts().map(item => item.id), [second.id]);
  db.prepare('UPDATE writing_saved_drafts SET draft_json = ? WHERE id = ?').run(rowBeforeCorruption.draft_json, persisted.id);
  assert.equal(repo.listWritingWorkshopDrafts({ requireComplete: true }).length, 2, 'repair permits complete consultation again');
  assert.equal(repo.countWritingWorkshopDrafts('deep_research'), 2);
  assert.equal(repo.getWritingWorkshopDraft('not-a-report'), null, 'a missing record retains its distinct missing response');
  for (const column of ['brief_json', 'draft_json', 'model_json']) {
    for (const malformed of ['{broken', 'null', '[]', '42']) {
      db.prepare(`UPDATE writing_saved_drafts SET ${column} = ? WHERE id = ?`).run(malformed, persisted.id);
      assert.throws(() => repo.listWritingWorkshopDraftSummaries({ kind: 'deep_research', limit: 1, offset: 1 }), /formato inválido/, 'pagination cannot hide a damaged record');
      assert.throws(() => repo.countWritingWorkshopDrafts('deep_research'), /formato inválido/);
      assert.throws(() => repo.listWritingWorkshopDrafts({ requireComplete: true }), /formato inválido/);
      assert.equal(db.prepare(`SELECT ${column} AS original FROM writing_saved_drafts WHERE id = ?`).get(persisted.id).original, malformed);
    }
    db.prepare(`UPDATE writing_saved_drafts SET ${column} = ? WHERE id = ?`).run(rowBeforeCorruption[column], persisted.id);
  }
  assert.equal(repo.listWritingWorkshopDraftSummaries({ kind: 'deep_research', limit: 1, offset: 1 }).total, 2);

  db.close();
  const reopened = new Database(path.join(root, 'vault.sqlite'), { readonly: true, fileMustExist: true });
  const persistedRow = reopened.prepare('SELECT brief_json, model_json, draft_json FROM writing_saved_drafts WHERE id = ?').get(persisted.id);
  assert.equal(JSON.parse(persistedRow.brief_json).deepResearchApproach, 'literature_review');
  assert.deepEqual(JSON.parse(persistedRow.model_json), provenanceModel);
  assert.equal(JSON.parse(persistedRow.draft_json).deepResearchApproach, 'literature_review');
  assert.deepEqual(JSON.parse(persistedRow.draft_json).generationModel, provenanceModel);
  reopened.close();
  console.log('deep research read marker test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

/** Put an already-built module in the cache so requiring it never runs its source. */
function stubModule(relative, exports) {
  const filename = path.join(repoRoot, relative);
  const Module = require('node:module');
  const stub = new Module(filename, null);
  stub.filename = filename;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[filename] = stub;
}

function installTsHook() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
