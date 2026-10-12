import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

// The scope checks were linear scans run once per document of the scope — quadratic in the library,
// several times per retrieval round. They now look documents up by id, which must answer exactly as
// the scan did, duplicates and absences included.
test('a scope is checked by id with the answers a linear scan gave', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-scope-index-'));
  try {
    await build({ entryPoints: ['electron/ai/researchCorpusScope.ts'], outfile: path.join(root, 'scope.cjs'), bundle: true, platform: 'node', format: 'cjs',
      alias: { '@shared': path.resolve('shared') }, logLevel: 'silent' });
    const { documentsById, assertResearchDocumentPermission } = require(path.join(root, 'scope.cjs'));

    const first = { id: 'a', tag: 'first' }, second = { id: 'a', tag: 'second' };
    assert.equal(documentsById([first, { id: 'b' }, second]).get('a'), first, 'the first of a duplicate wins, as find() would');
    assert.equal(documentsById([]).get('a'), undefined);

    const doc = (id, extra = {}) => ({ id, permissionRevision: 1, workId: `w-${id}`, attachments: [], ...extra });
    const scope = { documents: [doc('a'), doc('b')] };
    assert.equal(assertResearchDocumentPermission(scope, 'b', doc('b')), scope.documents[1], 'a pinned document is found');
    assert.throws(() => assertResearchDocumentPermission(scope, 'z', doc('z')), /research_source_not_authorized/, 'one outside the scope is refused');
    assert.throws(() => assertResearchDocumentPermission(scope, 'a', doc('a', { permissionRevision: 2 })), /research_source_not_authorized/, 'a revoked one is refused');
    assert.throws(() => assertResearchDocumentPermission(scope, 'a', undefined), /research_source_not_authorized/, 'a deleted one is refused');
    // The index is per scope object: a different scope does not answer from the first one's index.
    const other = { documents: [doc('z')] };
    assert.equal(assertResearchDocumentPermission(other, 'z', doc('z')), other.documents[0]);
    assert.throws(() => assertResearchDocumentPermission(other, 'a', doc('a')), /research_source_not_authorized/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
