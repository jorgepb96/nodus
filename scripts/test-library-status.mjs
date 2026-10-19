// The library row folds five pipeline fields into one readable status. These are
// the cases that decide whether a reader trusts it: an abstract-only work must
// never be reported as one retry away from ready, and a work with no ideas must
// not be reported as missing an idea index.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-status-'));
const bundle = path.join(outDir, 'libraryStatus.cjs');
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  path.join(root, 'src/libraryStatus.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
], { cwd: root, stdio: 'inherit' });
const { deriveWorkStatus, queueItemsByWork, hasNoFullText, isAbstractOnly, READY_STEPS, RETRYABLE_STEP_STATES, retryableSteps } = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

/** A fully-analysed work with full text; individual tests override what they exercise. */
const work = (over = {}) => ({
  nodus_id: 'w1',
  zotero_key: 'ZK1',
  title: 'Obra',
  authors: [],
  themes: [],
  zoteroTags: [],
  ideaCount: 10,
  year: 2006,
  source_type: 'pdf',
  light_status: 'done',
  deep_status: 'done',
  deep_error: null,
  summary_status: 'done',
  ...over,
});
const embedded = (over = {}) => ({ nodus_id: 'w1', totalIdeas: 10, embeddedIdeas: 10, complete: true, ...over });
const indexed = (over = {}) => ({ nodus_id: 'w1', totalPassages: 40, status: 'complete', outdatedReason: null, ...over });

test('a fully processed work is ready without a documentary index', () => {
  // deriveWorkStatus deliberately has no document-profile input: an absent beta
  // index cannot turn a completed work amber.
  assert.equal(deriveWorkStatus(work(), embedded(), indexed()).readiness, 'ready');
});

test('a missing summary or stale semantic index keeps a work incomplete', () => {
  // All five pipeline steps gate the green: a work whose own step breakdown says
  // "missing"/"partial" must not read as "Listo".
  const noSummary = deriveWorkStatus(work({ summary_status: 'none' }), embedded(), indexed());
  assert.equal(noSummary.readiness, 'incomplete');
  assert.equal(noSummary.steps.summary.state, 'missing');
  assert.ok(READY_STEPS.includes('summary'));

  const staleSemantic = deriveWorkStatus(work(), embedded({ embeddedIdeas: 4, totalIdeas: 10, complete: false }), indexed());
  assert.equal(staleSemantic.readiness, 'incomplete');
  assert.equal(staleSemantic.steps.semantic.state, 'partial');
  assert.ok(READY_STEPS.includes('semantic'));
});

test('an untouched work is unstarted, not incomplete', () => {
  const s = deriveWorkStatus(work({ light_status: 'none', deep_status: 'none', summary_status: 'none' }), undefined, undefined);
  assert.equal(s.readiness, 'unstarted');
});

test('a work whose text was never extracted is noText, never incomplete', () => {
  // The whole point: passages can never be indexed, so "incomplete · 1 step"
  // would invite the reader to burn tokens on a retry that cannot succeed.
  const skipped = deriveWorkStatus(work({ deep_status: 'skipped_no_text' }), undefined, undefined);
  assert.equal(skipped.readiness, 'noText');
  assert.equal(skipped.steps.ideas.state, 'blocked');
  assert.equal(skipped.steps.citable.state, 'blocked');
});

test('abstract-only is its own state, distinct from having no text at all', () => {
  // The demo corpus is entirely abstract_only, so collapsing this into "no text"
  // would make every row of a new user's first library read as broken — and it
  // would understate a work whose ideas were genuinely extracted and are usable.
  const w = work({ source_type: 'abstract_only' });
  assert.equal(isAbstractOnly(w), true);
  assert.equal(hasNoFullText(w), true);
  const s = deriveWorkStatus(w, embedded(), { nodus_id: 'w1', totalPassages: 0, status: 'missing', outdatedReason: null });
  assert.equal(s.readiness, 'abstractOnly');
  // Deep analysis really did run — it just only saw the abstract.
  assert.equal(s.steps.ideas.state, 'partial');
  assert.equal(s.steps.citable.state, 'blocked');

  // Extraction attempted, nothing to read: that IS "no text".
  assert.equal(deriveWorkStatus(work({ deep_status: 'skipped_no_text' }), undefined, undefined).readiness, 'noText');
});

test('a work with no ideas is not reported as missing its idea index', () => {
  const s = deriveWorkStatus(work({ ideaCount: 0 }), { nodus_id: 'w1', totalIdeas: 0, embeddedIdeas: 0, complete: false }, indexed());
  assert.equal(s.steps.semantic.state, 'na');
  assert.ok(!s.missing.includes('semantic'));
  assert.equal(s.readiness, 'ready');
});

test('partial embeddings and outdated passages are partial, and carry their numbers', () => {
  const s = deriveWorkStatus(
    work(),
    embedded({ embeddedIdeas: 31, totalIdeas: 47, complete: false }),
    indexed({ status: 'outdated', outdatedReason: 'model_changed' })
  );
  assert.equal(s.readiness, 'incomplete');
  assert.equal(s.steps.semantic.state, 'partial');
  assert.equal(s.steps.semantic.done, 31);
  assert.equal(s.steps.semantic.total, 47);
  assert.equal(s.steps.citable.state, 'partial');
  // Both unfinished steps gate readiness now, and both are reported.
  assert.deepEqual(s.missing, ['semantic', 'citable']);
  assert.ok(READY_STEPS.includes('semantic'));
});

test('newly indexed passages are current even while the deep analysis still belongs to the previous text', () => {
  const s = deriveWorkStatus(
    work({ deep_hash: 'old-text', resolved_text_hash: 'new-text' }),
    embedded(),
    indexed(),
  );
  assert.equal(s.steps.ideas.state, 'partial', 'the stale analytical ideas are the step that needs repair');
  assert.equal(s.steps.ideas.reason, 'analysis_text_changed');
  assert.equal(s.steps.citable.state, 'done', 'a current passage index must not inherit the ideas hash');
  assert.deepEqual(s.missing, ['ideas']);
});

test('failure outranks absence, and queued/running work has honest transient labels', () => {
  const failed = deriveWorkStatus(work({ summary_status: 'failed', light_status: 'none' }), embedded(), indexed());
  assert.equal(failed.readiness, 'failed');
  assert.equal(deriveWorkStatus(work({ deep_error: 'falló el reintento' }), embedded(), indexed()).readiness, 'failed',
    'a replacement failure is visible even while the committed deep graph remains readable');

  // A queued job wins even though nothing is persisted as pending yet, but it
  // must not claim that model inference has already started.
  const pending = deriveWorkStatus(work({ deep_status: 'failed' }), embedded(), indexed(), [
    { id: 'q1', nodus_id: 'w1', title: 'Obra', kind: 'deep', state: 'queued' },
  ]);
  assert.equal(pending.readiness, 'pending');
  assert.equal(pending.steps.ideas.state, 'pending');

  const running = deriveWorkStatus(work({ deep_status: 'failed' }), embedded(), indexed(), [
    { id: 'q1', nodus_id: 'w1', title: 'Obra', kind: 'deep', state: 'running' },
  ]);
  assert.equal(running.readiness, 'running');
  assert.equal(running.steps.ideas.state, 'running');
});

test('a persisted resumption marker is pending, never falsely running', () => {
  const pending = deriveWorkStatus(work({ deep_status: 'pending' }), undefined, undefined);
  assert.equal(pending.readiness, 'pending');
  assert.equal(pending.steps.ideas.state, 'pending');
});

test('queue indexing keeps only live items and groups them by work', () => {
  const map = queueItemsByWork([
    { id: 'q1', nodus_id: 'w1', kind: 'light', state: 'running' },
    { id: 'q2', nodus_id: 'w1', kind: 'deep', state: 'queued' },
    { id: 'q3', nodus_id: 'w2', kind: 'deep', state: 'done' },
    { id: 'q4', nodus_id: 'w3', kind: 'summary', state: 'failed' },
  ]);
  assert.equal(map.get('w1').length, 2);
  // Finished and failed items are not "in flight" and must not light a row up.
  assert.equal(map.has('w2'), false);
  assert.equal(map.has('w3'), false);
});

test('the SQL presets stay in step with the JS readiness derivation', async () => {
  const [sql, repo, status] = await Promise.all([
    readFile(path.join(root, 'electron/db/readinessFilters.ts'), 'utf8'),
    readFile(path.join(root, 'electron/db/worksRepo.ts'), 'utf8'),
    readFile(path.join(root, 'src/libraryStatus.ts'), 'utf8'),
  ]);

  // Same precedence chain as deriveWorkStatus: failed, then unstarted, then the
  // two text-shortage states, and only then ready vs incomplete.
  assert.match(sql, /w\.light_status = 'failed' OR w\.deep_status = 'failed' OR w\.deep_error IS NOT NULL OR w\.summary_status = 'failed'/);
  assert.match(sql, /w\.light_status = 'none' AND w\.deep_status = 'none'/);
  assert.match(sql, /w\.deep_status = 'done' AND w\.source_type IN \('abstract_only', 'none'\)/);
  assert.match(sql, /NOT \$\{PENDING\} AND NOT \$\{FAILED\} AND NOT \$\{UNSTARTED\} AND NOT \$\{ABSTRACT_ONLY\} AND NOT \$\{NO_TEXT\}/);
  // ready and incomplete must be exact complements over the analysable set,
  // or a work would fall through both presets and be unreachable.
  assert.match(sql, /case 'ready':[\s\S]{0,120}\$\{ANALYSABLE\} AND \$\{READY_CORE\}/);
  assert.match(sql, /case 'incomplete':[\s\S]{0,140}\$\{ANALYSABLE\} AND NOT \(\$\{READY_CORE\}\)/);
  // Persisted pending has a preset of its own instead of leaking into incomplete.
  assert.match(sql, /case 'pending':[\s\S]{0,60}return \{ sql: PENDING/);

  // READY_CORE must cover exactly READY_STEPS: all five pipeline steps.
  assert.match(status, /READY_STEPS: readonly StepId\[\] = \['themes', 'ideas', 'summary', 'semantic', 'citable'\]/);
  assert.match(sql, /READY_CORE = `w\.light_status = 'done' AND w\.deep_status = 'done'[\s\S]{0,140}w\.deep_hash = w\.resolved_text_hash[\s\S]{0,120}\$\{SEMANTIC_COMPLETE\} AND w\.summary_status = 'done' AND \$\{PASSAGES_COMPLETE\}`/);
  // Semantic freshness IS evaluated in SQL now, through a function registered from
  // the same helper the embedding pipeline uses. If it disappears, the semantic
  // step silently drops out of "Incompleto" again.
  assert.match(sql, /idea_embedding_text_hash/);

  assert.match(repo, /if \(filter\.readiness\)/);
  assert.match(repo, /Object\.assign\(params, readiness\.params\)/);

  // A bare HAVING with no GROUP BY is rejected by SQLite as a non-aggregate
  // query. It shipped in the passages/!passages status filters, which threw
  // instead of filtering, and would do the same to any readiness preset that
  // reused the shape. `HAVING COUNT(*)` is that shape; the tag filter's
  // `GROUP BY … HAVING COUNT(DISTINCT …)` is a real aggregate and stays.
  assert.doesNotMatch(sql, /HAVING COUNT\(\*\)/);
  assert.doesNotMatch(repo, /HAVING COUNT\(\*\)/);
  for (const source of [sql, repo]) {
    assert.match(source, /NOT EXISTS \(\s*SELECT 1 FROM (?:embedding_read_)?passages p/);
  }
});

test('the status modal repairs missing steps without wasting work', async () => {
  const [source, passagePipeline, status] = await Promise.all([
    readFile(path.join(root, 'src/views/WorkStatusModal.tsx'), 'utf8'),
    readFile(path.join(root, 'electron/ai/passageEmbeddingPipeline.ts'), 'utf8'),
    readFile(path.join(root, 'src/libraryStatus.ts'), 'utf8'),
  ]);

  // Indexes are built FROM the ideas. Firing startEmbedding alongside a pending
  // deep pass would index nothing, so the chain has to take over in that case.
  assert.match(source, /if \(retryable\.includes\('themes'\) \|\| retryable\.includes\('ideas'\)\)/);
  assert.match(source, /await window\.nodus\.processFull\(work\.nodus_id\)/);
  // ...but when the ideas are already done, re-running the deep pass would purge
  // good analysis, so the individual steps must run directly instead.
  assert.match(source, /for \(const id of retryable\) await runStep\(id\)/);

  // Every step maps to its own retry, and a finished deep pass is re-scanned
  // rather than re-flagged (setManualDeep is not an idempotent retry).
  assert.match(source, /rescan\(work\.nodus_id, 'light'\)/);
  assert.match(source, /work\.deep_status === 'done'[\s\S]{0,120}rescan\(work\.nodus_id, 'deep'\)/);
  assert.match(source, /summarizeWork\(work\.nodus_id\)/);
  assert.match(source, /startEmbedding\(\[work\.nodus_id\]\)/);
  assert.match(source, /startPassageEmbedding\(\[work\.nodus_id\]\)/);
  assert.match(source, /await window\.nodus\.getPassageStatus\(\)/, 'passage provider errors are surfaced in the modal');
  assert.match(source, /await onChanged\(\)/, 'the modal waits for fresh row data before reporting success');
  assert.match(source, /if \(progress\.running\) setCitableQueued\(true\)/, 'a retry joining a live passage run stays visibly queued');
  assert.match(passagePipeline, /if \(state\.running\)[\s\S]{0,1000}state\.works\.push/, 'per-work retries join an existing passage run instead of returning silently');

  // Blocked and not-applicable steps are terminal: offering a retry there spends
  // tokens on something that cannot succeed. The set is shared with the Library's
  // bulk repair action rather than declared once per call site, so the two can
  // never disagree about what "what is missing" means.
  assert.match(status, /export const RETRYABLE_STEP_STATES: readonly StepState\[\] = \['partial', 'missing', 'failed'\]/);
  assert.match(source, /RETRYABLE_STEP_STATES\.includes\(status\.steps\[id\]\.state\)/);
  assert.doesNotMatch(source, /const RETRYABLE: StepState\[\]/);
  assert.match(source, /data-testid="work-status-documentary-index"/);
  assert.match(source, /data-testid="work-status-documentary-beta"[^>]*>BETA</);
  assert.match(source, /enqueueDocumentProfile\(work\.nodus_id\)/, 'the documentary index remains an explicit per-work action');
  assert.match(source, /no afecta al estado general de la obra/, 'the optional index is explained next to its action');
  assert.match(source, /role="dialog"[\s\S]{0,120}aria-modal="true"/);
});

test('the retry set is exactly the steps a reader can repair', () => {
  assert.deepEqual(RETRYABLE_STEP_STATES, ['partial', 'missing', 'failed']);

  const mixed = deriveWorkStatus(
    work({ light_status: 'failed', summary_status: 'none' }),
    embedded({ embeddedIdeas: 4, totalIdeas: 10, complete: false }),
    indexed({ status: 'outdated', outdatedReason: 'text_changed' })
  );
  assert.deepEqual(retryableSteps(mixed), ['themes', 'summary', 'semantic', 'citable']);

  // Nothing to repair: everything is done, or everything left is terminal.
  assert.deepEqual(retryableSteps(deriveWorkStatus(work(), embedded(), indexed())), []);
  assert.deepEqual(retryableSteps(deriveWorkStatus(work({ deep_status: 'skipped_no_text' }), undefined, undefined)), []);

  // A job already waiting in the queue is not offered again — re-enqueueing it
  // would only move the same work to the back of the line.
  const queued = deriveWorkStatus(work({ deep_status: 'failed' }), embedded(), indexed(), [
    { id: 'q1', nodus_id: 'w1', title: 'Obra', kind: 'deep', state: 'queued' },
  ]);
  assert.deepEqual(retryableSteps(queued), []);
});

test('the library row renders the derived status instead of the five pipeline columns', async () => {
  const source = await readFile(path.join(root, 'src/views/Library.tsx'), 'utf8');
  assert.match(source, /deriveWorkStatus/);
  assert.match(source, /DOCUMENT_INDEX_MANAGER_VISIBLE && vaultType === 'academic'/, 'the global documentary-index button remains implemented but hidden');
  // The tour and the tutorial video both anchor on this.
  assert.match(source, /data-tour="library-actions"/);
  // The pipeline columns and the per-row icon toolbar are gone.
  assert.doesNotMatch(source, /sortKey="embeddings"/);
  assert.doesNotMatch(source, /sortKey="passages"/);
  assert.doesNotMatch(source, /nodus_id\.slice\(0, 8\)/);
});

test('the Library repairs what is missing across the whole selection', async () => {
  const source = await readFile(path.join(root, 'src/views/Library.tsx'), 'utf8');

  // The action is offered while some selected work still has something to finish, and
  // says how many works that is, so a disabled/no-op button is never what the reader
  // clicks first.
  assert.match(source, /data-testid="library-retry-missing-selected"/);
  assert.match(source, /retryPlan\.works > 0 && \(/);
  assert.match(source, /\{t\('Reintentar'\)\}/);

  // Same rule as the per-work modal: themes/ideas pull the whole chain, because the
  // indexes are built FROM the ideas.
  assert.match(source, /steps\.includes\('themes'\) \|\| steps\.includes\('ideas'\)/);

  // The rest is grouped one call per step — a 200-work selection must not become one
  // IPC round-trip per work.
  assert.match(source, /processFullBulk\(chain\)/);
  assert.match(source, /summarizeBulk\(summaries\)/);
  assert.match(source, /startEmbedding\(semantic\)/);
  assert.match(source, /startPassageEmbedding\(citable\)/);

  // It is the repair path, not an import path: the cross-vault reuse checkbox is
  // deliberately not consulted here.
  assert.doesNotMatch(source, /retryMissingSelected[\s\S]{0,900}reuseSelectedAnalysis/);
});

test('documentary indexing is limited to Deep Research and explicit reader actions', async () => {
  const [policy, queue, immersion, deepResearch, modal, profile, extractor] = await Promise.all([
    readFile(path.join(root, 'shared/documentIndexPolicy.ts'), 'utf8'),
    readFile(path.join(root, 'electron/pipeline/documentIndexQueue.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ai/immersion.ts'), 'utf8'),
    readFile(path.join(root, 'electron/ai/deepResearch.ts'), 'utf8'),
    readFile(path.join(root, 'src/views/WorkStatusModal.tsx'), 'utf8'),
    readFile(path.join(root, 'electron/ai/documentProfile.ts'), 'utf8'),
    readFile(path.join(root, 'electron/extraction/textExtractor.ts'), 'utf8'),
  ]);
  assert.match(policy, /DOCUMENT_INDEX_CONTINUOUS_AVAILABLE = false/);
  assert.match(policy, /DOCUMENT_INDEX_MANAGER_VISIBLE = false/);
  assert.match(queue, /DOCUMENT_INDEX_CONTINUOUS_AVAILABLE && settings\.documentIndexingEnabled/);
  assert.doesNotMatch(immersion, /prepareRelevantDocumentProfiles/, 'Immersion may reuse profiles but never creates them');
  assert.match(deepResearch, /prepareRelevantDocumentProfiles\([\s\S]{0,180}'deep-research'/);
  assert.match(modal, /enqueueDocumentProfile\(work\.nodus_id\)/);
  assert.match(profile, /work\.zotero_key\.startsWith\('nodus-library:'\)[\s\S]{0,120}\? null[\s\S]{0,80}getItem/,
    'Nodus-owned Library works bypass the Zotero metadata request');
  assert.match(extractor, /attachmentReadAttempts = isNodusLibraryItem \? 0 : ATTACHMENT_READ_ATTEMPTS/,
    'Nodus-owned Library works resolve their clean local copy without Zotero attachment retries');
});
