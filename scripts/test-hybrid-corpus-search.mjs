import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const state = { db: { open: true }, provider: 'test', model: 'v1', inputs: [], fail: false };
globalThis.__hybridSearchFixture = state;
const bundle = await build({ entryPoints: ['electron/ai/hybridCorpusSearch.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'isolated-provider', setup(build) {
    build.onResolve({ filter: /^(\.\/aiClient|\.\.\/db\/(database|ideasRepo))$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path.endsWith('database')
      ? 'export function getDb() { return globalThis.__hybridSearchFixture.db; }'
      : path.endsWith('ideasRepo') ? 'export function currentEmbeddingConfig() { const s=globalThis.__hybridSearchFixture; return {provider:s.provider,model:s.model}; }'
      : `export async function embedQuery() { if(globalThis.__hybridSearchFixture.fail) throw new Error('offline'); return [1,0]; }
         export async function embedMany(texts) { const s=globalThis.__hybridSearchFixture; s.inputs.push(...texts); return texts.map(text=>text.includes('orchard')?[1,0]:[0,1]); }`, loader: 'js' }));
  } }],
});
const { searchHybridCorpus } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const apple = { kind: 'row', id: 'apple', title: 'An orchard', snippet: 'Apple and pear trees' };

test('semantic retrieval discovers content without query words; filtering precedes embedding', async () => {
  const response = await searchHybridCorpus('fruit', [apple, { kind: 'note', id: 'private', title: 'restricted orchard' }], new Set(['row']));
  assert.equal(response.results[0].id, 'apple');
  assert.equal(response.semanticAvailable, true);
  assert.equal(state.inputs.some(text => text.includes('restricted')), false);
});
test('cache reuses vectors but invalidates edits, model changes and vault connections', async () => {
  const count = state.inputs.length;
  await searchHybridCorpus('fruit', [apple]);
  assert.equal(state.inputs.length, count);
  await searchHybridCorpus('fruit', [{ ...apple, snippet: 'Changed orchard' }]);
  assert.equal(state.inputs.length, count + 1);
  state.model = 'v2';
  await searchHybridCorpus('fruit', [apple]);
  assert.equal(state.inputs.length, count + 2);
  state.db = { open: true };
  await searchHybridCorpus('fruit', [apple]);
  assert.equal(state.inputs.length, count + 3);
});
test('deleted content cannot reappear from cached vectors; empty filters yield zero results', async () => {
  assert.deepEqual((await searchHybridCorpus('fruit', [])).results, []);
  assert.deepEqual((await searchHybridCorpus('fruit', [apple], new Set())).results, []);
});
test('a failed provider preserves literal search and reports semantic unavailability', async () => {
  state.fail = true;
  const response = await searchHybridCorpus('orchard', [apple]);
  assert.equal(response.results[0].id, 'apple');
  assert.equal(response.semanticAvailable, false);
  state.fail = false;
});
test('long content is indexed beyond the first chunk and deduplicated back to its entity', async () => {
  const response = await searchHybridCorpus('fruit', [{ ...apple, title: 'Long document', snippet: 'preface '.repeat(500) + ' orchard' }]);
  assert.equal(response.results.length, 1);
  assert.match(response.results[0].snippet, /orchard/);
});

test('local literal visibility never authorizes embedding sensitive content', async () => {
  const before = state.inputs.length;
  const response = await searchHybridCorpus('private', [{ kind: 'source', id: 's', title: 'private orchard', semanticAllowed: false }]);
  assert.equal(response.results[0].id, 's');
  assert.equal(state.inputs.length, before);
});
