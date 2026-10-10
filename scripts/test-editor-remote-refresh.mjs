import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';

const require = createRequire(import.meta.url);
const compiled = transformSync(fs.readFileSync(new URL('../src/components/editor/remoteEditorRefresh.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const module = { exports: {} };
new Function('module', 'exports', 'require', compiled)(module, module.exports, require);
const { refreshSavedEditor } = module.exports;
const clean = () => ({ documentId: 'note-a', revision: 4, signature: 'saved-a', baseline: 'saved-a', ready: true, blocked: false });
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('an open saved document receives a newer structured revision without flattening its content', async () => {
  const document = { revision: 5, nativeDocument: [{ type: 'table', content: { rows: [] } }, { type: 'equation', content: 'E=mc^2' }], academicMetadata: { bibliography: ['source-a'] } };
  let actual;
  assert.equal(await refreshSavedEditor(clean, async id => { assert.equal(id, 'note-a'); return document; }, next => { actual = next; }), 'updated');
  assert.equal(actual, document);
  assert.equal(actual.nativeDocument[0].type, 'table');
  assert.deepEqual(actual.academicMetadata.bibliography, ['source-a']);
});

test('a local draft is not replaced or even fetched while it differs from its saved baseline', async () => {
  assert.equal(await refreshSavedEditor(() => ({ ...clean(), signature: 'local-draft' }), () => { throw Error('unexpected read'); }, () => { throw Error('lost draft'); }), 'deferred');
});

test('typing while the remote read is pending keeps the local text', async () => {
  let state = clean(); const read = pending();
  const outcome = refreshSavedEditor(() => state, () => read.promise, () => { throw Error('lost concurrent typing'); });
  state = { ...state, signature: 'typed-after-request' }; read.resolve({ revision: 5 });
  assert.equal(await outcome, 'deferred');
});

test('a completed local save supersedes an older in-flight remote response', async () => {
  let state = clean(); const read = pending();
  const outcome = refreshSavedEditor(() => state, () => read.promise, () => { throw Error('rolled back the saved edit'); });
  state = { ...state, revision: 6, signature: 'local-saved', baseline: 'local-saved' }; read.resolve({ revision: 5 });
  assert.equal(await outcome, 'deferred');
});

test('switching documents discards the response for the previous document', async () => {
  let state = clean(); const read = pending();
  const outcome = refreshSavedEditor(() => state, () => read.promise, () => { throw Error('replaced another document'); });
  state = { ...state, documentId: 'note-b' }; read.resolve({ revision: 5 });
  assert.equal(await outcome, 'deferred');
});

test('saving, generating, recovery and loading gates also apply after a request starts', async () => {
  for (const patch of [{ blocked: true }, { ready: false }]) {
    let state = clean(); const read = pending();
    const outcome = refreshSavedEditor(() => state, () => read.promise, () => { throw Error('replaced protected work'); });
    state = { ...state, ...patch }; read.resolve({ revision: 5 });
    assert.equal(await outcome, 'deferred');
  }
});

test('equal, older or unversioned responses never reset the editor or its undo history', async () => {
  for (const revision of [4, 3, undefined]) {
    assert.equal(await refreshSavedEditor(clean, async () => ({ revision }), () => { throw Error('reset unchanged editor'); }), 'unchanged');
  }
});

test('an unavailable connection leaves the current document intact', async () => {
  await assert.rejects(refreshSavedEditor(clean, async () => { throw Error('Mac disconnected'); }, () => { throw Error('lost offline document'); }), /Mac disconnected/);
});
