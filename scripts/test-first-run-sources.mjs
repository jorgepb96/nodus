// The decisions behind the first run's "bring your sources" step and the two reminders
// it postpones (shared/firstRunSources.ts, shared/firstRunNudges.ts).
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-first-run-test-'));
function load(file) {
  const out = path.join(scratch, `${path.basename(file)}.cjs`);
  buildSync({ entryPoints: [file], outfile: out, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' });
  return require(out);
}
const S = load('shared/firstRunSources.ts');
const N = load('shared/firstRunNudges.ts');
test.after(() => rm(scratch, { recursive: true, force: true }));

const ready = { text: 'available', lexical: 'ready', embeddings: 'ready', status: 'ready', reason: null, error: null, passages: 4, embedded: 4 };
const doc = (id, preparation = {}, coverage = 'fulltext') => ({
  id, title: `Doc ${id}`, workId: `w-${id}`, revision: `r-${id}`, coverage,
  preparation: { documentId: id, revision: `r-${id}`, text: 'missing', lexical: 'missing', embeddings: 'missing', status: 'queued', reason: null, error: null, passages: 0, embedded: 0, ...preparation },
});

test('the starter set prefers works whose file was seen to hold text', () => {
  const documents = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id }));
  const preflight = [
    { documentId: 'a', status: 'inaccessible' },
    { documentId: 'b', status: 'abstract' },
    { documentId: 'c', status: 'available' },
    { documentId: 'e', status: 'unknown' },
    { documentId: 'f', status: 'available' },
  ];
  assert.deepEqual(S.pickStarterDocuments(documents, preflight, 4).map((d) => d.id), ['c', 'f', 'd', 'e'],
    'readable first, then not-yet-ruled-out, in the library order');
  assert.deepEqual(S.pickStarterDocuments(documents, preflight, 7).map((d) => d.id).slice(-2), ['a', 'b'],
    'a work known to be unreadable is a last resort');
  assert.equal(S.pickStarterDocuments(documents).length, S.STARTER_DOCUMENT_LIMIT, 'never more than the starter limit');
  assert.ok(S.STARTER_DOCUMENT_LIMIT <= 5, 'a first run must not index a library before showing anything');
  assert.deepEqual(S.pickStarterDocuments([], preflight), []);
});

test('one searchable document is enough to move on', () => {
  const inventory = [doc('a', { status: 'running', text: 'available', lexical: 'ready', embeddings: 'running', passages: 10, embedded: 3 }), doc('b', ready), doc('c')];
  const progress = S.starterProgress(inventory, ['a', 'b', 'c']);
  assert.equal(progress.ready?.id, 'b');
  assert.equal(progress.readyCount, 1);
  assert.equal(progress.pendingCount, 2);
  assert.equal(progress.failure, null);
  assert.equal(progress.active?.id, 'a', 'the running document is the one the progress line names');
});

test('embeddings still running is not searchable, and manual work needs none', () => {
  const half = doc('a', { text: 'available', lexical: 'ready', embeddings: 'running', status: 'running' });
  assert.equal(S.isDocumentSearchable(half), false);
  assert.equal(S.isDocumentSearchable(half, true), true, 'the manual academic mode works from text alone');
  assert.equal(S.isDocumentSearchable(doc('b', { ...ready, text: 'abstract' })), false, 'an abstract is not the document');
  assert.equal(S.isDocumentSearchable(doc('z', ready, 'metadata')), true,
    'a work read from Zotero keeps "metadata" coverage after its text is prepared, and is searchable');
  assert.equal(S.isDocumentSearchable(doc('c', { ...ready, unpreparedAttachmentIds: ['x'] })), false);
});

test('a starter set that cannot be read says why instead of waiting forever', () => {
  const noFile = (id) => doc(id, { status: 'blocked', reason: 'no_attachment' });
  const inventory = [noFile('a'), noFile('b'), doc('c', { status: 'failed', reason: 'provider_failed' })];
  const progress = S.starterProgress(inventory, ['a', 'b', 'c']);
  assert.equal(progress.ready, null);
  assert.equal(progress.pendingCount, 0);
  assert.equal(progress.failure, 'no-file', 'the reason most documents share');
  assert.equal(S.starterFailure(doc('x', { status: 'blocked', reason: 'ocr_required' })), 'unreadable');
  assert.equal(S.starterFailure(doc('x', { status: 'blocked', reason: 'no_model' })), 'no-model');
  assert.equal(S.starterFailure(doc('x', { status: 'failed', reason: 'provider_failed' })), 'provider');
  assert.equal(S.starterFailure(doc('x', { status: 'ready', text: 'abstract' })), 'no-file');
  // Still one in the queue: not a failure yet.
  assert.equal(S.starterProgress([noFile('a'), doc('b')], ['a', 'b']).failure, null);
  // Nothing known about the starter set yet: neither ready nor failed.
  assert.equal(S.starterProgress([], ['a']).failure, null);
});

test('the recovery-kit reminder waits a day and respects "later"', () => {
  const day = 24 * 60 * 60 * 1000, now = Date.parse('2026-11-20T10:00:00Z');
  const at = (ms) => new Date(now - ms).toISOString();
  assert.equal(N.recoveryKitReminderDue({ credentialsPending: true, quickStartAt: at(2 * 60 * 60 * 1000), now }), false, 'not on the first day');
  assert.equal(N.recoveryKitReminderDue({ credentialsPending: true, quickStartAt: at(day + 1), now }), true);
  assert.equal(N.recoveryKitReminderDue({ credentialsPending: false, quickStartAt: at(9 * day), now }), false, 'never once a credential is held');
  assert.equal(N.recoveryKitReminderDue({ credentialsPending: true, quickStartAt: null, now }), false);
  assert.equal(N.recoveryKitReminderDue({ credentialsPending: true, quickStartAt: at(3 * day), snoozedUntil: String(now + day), now }), false);
  assert.equal(N.recoveryKitReminderDue({ credentialsPending: true, quickStartAt: at(9 * day), snoozedUntil: String(now - 1), now }), true, 'and returns after the snooze');
});

test('the stuck nudge needs days, an empty vault and no first answer', () => {
  const day = 24 * 60 * 60 * 1000, now = Date.parse('2026-11-20T10:00:00Z');
  const base = { firstSeenAt: now - 3 * day, firstAnswerCompleted: false, workCount: 0, dismissed: false, now };
  assert.equal(N.stuckNudgeDue(base), true);
  assert.equal(N.stuckNudgeDue({ ...base, firstSeenAt: now - day }), false, 'not while the install is new');
  assert.equal(N.stuckNudgeDue({ ...base, workCount: 3 }), false, 'someone with sources is not stuck');
  assert.equal(N.stuckNudgeDue({ ...base, workCount: null }), false, 'an unknown count is not zero');
  assert.equal(N.stuckNudgeDue({ ...base, firstAnswerCompleted: true }), false);
  assert.equal(N.stuckNudgeDue({ ...base, dismissed: true }), false, 'dismissed is for good');
  assert.equal(N.stuckNudgeDue({ ...base, firstSeenAt: null }), false);
});

test('the first run is wired where the welcome card was, and reaches Zotero without a submenu', async () => {
  const gate = await readFile('src/app/StartupGate.tsx', 'utf8');
  assert.match(gate, /id: 'academic-learning-welcome'[\s\S]{0,900}<FirstRunStart/, 'the academic first-run guard renders the sources step');
  assert.match(gate, /reloadRecoveryStatus\(\)\]\);[\s\S]{0,200}<\/?FirstVaultSetup|FirstVaultSetup[\s\S]{0,700}reloadRecoveryStatus/, 'the vault screen refreshes the recovery status its quick start changed');
  const vault = await readFile('src/views/FirstVaultSetup.tsx', 'utf8');
  assert.match(vault, /quickStartRecovery\(/, 'storage is prepared without a question');
  const start = await readFile('src/views/FirstRunStart.tsx', 'utf8');
  for (const id of ['first-run-source-', 'first-run-continue', 'first-run-start', 'first-run-steps', 'welcome-later', 'welcome-guide']) {
    assert.ok(start.includes(id), `first run keeps its ${id} control`);
  }
  assert.match(start, /useZoteroConnection\(\)/, 'Zotero is detected, not asked about');
  assert.match(start, /ZoteroConnectionNotice/, 'and a closed Zotero is explained in place');
  assert.match(start, /step: 2, documentId/, 'the practice is handed over past "choose" and "prepare"');
  assert.match(start, /embeddingProvider: 'nodus', embeddingModel: DEFAULT_EMBEDDING_MODELS\.nodus/,
    'Manual mode gets its local idea index explicitly, since choosing the mode never replaces an index');
  for (const path of ['const skip', 'const openGuide', "if (from === 'models')"]) {
    const at = start.indexOf(path);
    assert.ok(at >= 0 && start.slice(at, at + 400).includes('prepareManualIndex()'), `${path} prepares the Manual index before anything is imported`);
  }
  const collections = await readFile('src/views/CollectionsModal.tsx', 'utf8');
  assert.match(collections, /ZoteroConnectionNotice/, 'the collections window explains a Zotero that does not answer');
  assert.equal(/zoteroLibraries\(\)\.then\(\(next\) => \{ setLibraries/.test(collections), false, 'no unhandled Zotero read is left behind');
});

test('the first vault folds the early-phase types, and the first answer leads to ideas', async () => {
  const [picker, vault, surface, learning, app] = await Promise.all([
    readFile('src/components/vaultTypeUi.tsx', 'utf8'),
    readFile('src/views/FirstVaultSetup.tsx', 'utf8'),
    readFile('src/learning/AcademicLearningSurface.tsx', 'utf8'),
    readFile('src/learning/useAcademicLearning.ts', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
  ]);
  assert.match(vault, /<VaultTypePicker[^>]*foldEarlyPhases/, 'only the first-run screen folds them');
  assert.match(picker, /phase === 'alpha' \|\| phase === 'pre-alpha'/, 'beta types stay visible; alpha and pre-alpha fold');
  assert.match(picker, /!isEarlyPhaseVaultType\(type\) \|\| type === value/, 'the type in use is never hidden');
  assert.match(picker, /data-testid="vault-type-more"/);
  assert.match(surface, /data-testid="learning-next-ideas"/, 'a verified first answer offers the ideas of that source');
  assert.match(surface, /data-testid="learning-extract-current"/, 'extraction runs on the lesson source without finding its row');
  assert.match(learning, /lessonId:\s*'first-idea'|newPractice\(vault\.id, 'first-idea'/);
  assert.match(learning, /step: 1, documentId/, 'the ideas lesson starts at "extract" with the source chosen');
  assert.match(app, /onContinueWithIdeas=\{async documentId =>[\s\S]{0,240}chooseInterface\('intermediate'\)/, 'ideas live in the Intermediate interface');
});
