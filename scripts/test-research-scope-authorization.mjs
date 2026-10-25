// What a pinned research scope is re-checked against, mid-turn.
//
// An academic turn resolves its scope once, pins it, and re-validates at every stage. The
// check has to answer "may this turn still read these documents?", which is a question about
// membership and permissions. A document's `revision` is a fingerprint over its extracted
// text, and library preparation rewrites those as it indexes, so a check that compares the
// whole scope `id` fails any turn that overlaps indexing — while the same documents remain
// admitted under the same permissions.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-scope-authorization')) process.exit(0);
installRuntimeHooks(process.cwd());
const require = createRequire(import.meta.url);
const { researchScopeAuthorization, resolveNotebookScope } = require('../electron/ai/researchCorpusScope.ts');

const VAULT = 'vault-1';
const notebook = {
  id: 'nb-1', name: 'Cuaderno', mode: 'fixed', sources: [], exclusions: [], revision: 3,
  resolvedDocumentIds: ['doc-a', 'doc-b'], createdAt: '2026-10-01', updatedAt: '2026-10-01',
};
/** A document as the backend inventory hands it over: identity, permission state, and a
 *  content `revision` over the extracted text. */
const document = (id, over = {}) => ({
  id, title: `Obra ${id}`, authors: [], year: 2006, workId: `work-${id}`, libraryItemId: null,
  origin: { kind: 'nodus', id }, revision: `text-${id}`, attachmentId: null, coverage: 'fulltext',
  permissionRevision: `perm-${id}`, ...over,
});
const scopeOf = (documents) => resolveNotebookScope(VAULT, notebook, documents, []);
const admitted = [document('doc-a'), document('doc-b')];

test('re-extracting a document does not change what the scope authorizes', () => {
  const before = scopeOf(admitted);
  // Preparation re-read doc-a: new text hash, new pinned index. Nothing about who may read it.
  const after = scopeOf([
    document('doc-a', { revision: 'text-doc-a-v2', indexedSource: { revision: 'text-doc-a-v2', attachmentId: null, indexKeys: ['k'] } }),
    document('doc-b'),
  ]);
  assert.notEqual(after.id, before.id, 'the content fingerprint must still notice the new text');
  assert.equal(researchScopeAuthorization(after), researchScopeAuthorization(before),
    'an indexing write must not invalidate a turn that is already running');
});

test('a document leaving the scope does change what it authorizes', () => {
  const before = scopeOf(admitted);
  const after = scopeOf([document('doc-a')]);
  assert.notEqual(researchScopeAuthorization(after), researchScopeAuthorization(before));
});

test('a permission change on an admitted document changes what it authorizes', () => {
  const before = scopeOf(admitted);
  const after = scopeOf([document('doc-a', { permissionRevision: 'perm-doc-a-archived' }), document('doc-b')]);
  assert.notEqual(researchScopeAuthorization(after), researchScopeAuthorization(before));
});

test('the vault and the notebook revision are part of what it authorizes', () => {
  const base = scopeOf(admitted);
  assert.notEqual(researchScopeAuthorization({ ...base, vaultId: 'vault-2' }), researchScopeAuthorization(base));
  assert.notEqual(researchScopeAuthorization({ ...base, notebookRevision: 4 }), researchScopeAuthorization(base));
});

test('attachments count by which ones were attached, not by their content revision', () => {
  const base = scopeOf(admitted);
  const attached = (revision) => ({
    ...base, conversationAttachments: [{ conversationId: 'c1', attachmentId: 'a1', revision }],
  });
  assert.equal(researchScopeAuthorization(attached('v2')), researchScopeAuthorization(attached('v1')),
    're-extracting an attachment is the same class of write as re-extracting a document');
  assert.notEqual(researchScopeAuthorization(attached('v1')), researchScopeAuthorization(base),
    'attaching a source at all is an authorization change');
  assert.notEqual(
    researchScopeAuthorization({ ...base, conversationAttachments: [{ conversationId: 'c1', attachmentId: 'a2', revision: 'v1' }] }),
    researchScopeAuthorization(attached('v1')),
    'a different attachment is a different authorization',
  );
});

test('every mid-run scope check compares authorization, not the content fingerprint', async () => {
  // One site left comparing `scope.id` is one feature that still dies under indexing, so the
  // three that re-validate a pinned scope are checked by source rather than by behaviour.
  const files = ['electron/ai/researchNotebookService.ts', 'electron/ai/deepResearch.ts', 'electron/ai/dictionary.ts'];
  for (const file of files) {
    const source = await readFile(path.join(repoRoot, file), 'utf8');
    assert.match(source, /researchScopeAuthorization\(/, `${file} must compare what the scope authorizes`);
    assert.doesNotMatch(source, /\bresolve\w*\([^)]*\)\.id !== scope\.id/, `${file} must not compare the content fingerprint`);
    assert.doesNotMatch(source, /\bcurrent\.id !== scope\.id/, `${file} must not compare the content fingerprint`);
  }
});
