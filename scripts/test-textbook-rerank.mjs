// The textbook evidence search with the local reranker: when it is installed the fused candidates
// are taken in its order; when it is absent or fails, the fused order stands.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-textbook-rerank-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

const PROSE = 'The reaction is an equilibrium, so it is driven toward the ester by using the alcohol as the solvent and by removing the water that forms, for example with a Dean-Stark trap. Concentrated sulfuric acid or a sulfonic acid is the usual catalyst, and the mechanism proceeds by protonation of the carbonyl group, addition of the alcohol and loss of water from the tetrahedral intermediate.';
const passage = (id, extra) => ({ passage_id: id, nodus_id: 'w1', text: `Fischer esterification of a carboxylic acid with an alcohol under acid catalysis gives the ester; ${extra} ${PROSE}`, page_label: `p. ${id}`, source_ref: null, page_number: 1, similarity: 0.9, title: 'Organic Chemistry', authors_json: '[]', year: 2016, zotero_key: 'K' });
globalThis.__rr = { available: true, scores: null, laneSizes: [] };
const STUBS = {
  '../capabilities/registry': 'export const capabilityRegistry = () => ({ providers: new Map() });',
  '../reactionIndex': 'export const reactionIndexService = () => ({ localDirectory: async () => null });',
  './moleculeInspection': 'export const chemistryRunner = () => ({ runner: {}, dispose: async () => {} });',
  './aiClient': 'export const embed = async () => null;',
  './chemistryStock': 'export const chemistryStockDirectory = () => null;',
  // No textbook-scheme index unless a scenario sets one.
  './textbookSchemes': `export const textbookSchemeDirectory = () => globalThis.__textbook?.dir ?? null; export const textbookCitations = (ids) => (globalThis.__textbook?.cite ?? (() => []))(ids); export const textbookTemplateCitations = (templates) => (globalThis.__textbook?.citeTemplates ?? (() => []))(templates);`,
  './localReranker': 'export const rerankerAvailable = () => globalThis.__rr.available; export const rerank = async (q, docs) => globalThis.__rr.scores ? globalThis.__rr.scores(docs) : null;',
  '../db/database': 'export const getDb = () => ({ prepare: () => ({ all: () => [] }) });',
  '../db/passagesRepo': `export const findSimilarPassages = () => [];
export const findSimilarPassagesPaged = async () => [];
export const lexicalPassageSearch = (query, limit) => { globalThis.__rr.laneSizes.push(limit); return globalThis.__rr.lane; };`,
};
const outfile = path.join(tmp, 'evidence.mjs');
await build({
  entryPoints: [path.join(root, 'electron/ai/synthesisEvidence.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  alias: { '@shared': path.join(root, 'shared') },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => (STUBS[args.path] ? { path: args.path, namespace: 'stub' } : undefined));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
  } }],
});
const { textbookPassages } = await import(pathToFileURL(outfile).href);
globalThis.__rr.lane = [passage('1', 'first in the fused order.'), passage('2', 'second.'), passage('3', 'third, the best explanation.')];

test('with the reranker, its order picks the passages and each lane offers 20 candidates', async () => {
  Object.assign(globalThis.__rr, { available: true, laneSizes: [], scores: (docs) => docs.map((text) => (text.includes('best') ? 9 : text.includes('second') ? 5 : 1)) });
  const found = await textbookPassages(['Fischer esterification'], ['w1'], undefined, 2);
  assert.deepEqual(found.map((p) => p.location), ['p. 3', 'p. 2']);
  assert.deepEqual(globalThis.__rr.laneSizes, [20]);
});

test('without the reranker (or when it fails) the fused order stands and lanes stay at 6', async () => {
  Object.assign(globalThis.__rr, { available: false, laneSizes: [], scores: null });
  assert.deepEqual((await textbookPassages(['Fischer esterification'], ['w1'], undefined, 2)).map((p) => p.location), ['p. 1', 'p. 2']);
  assert.deepEqual(globalThis.__rr.laneSizes, [6]);
  Object.assign(globalThis.__rr, { available: true, scores: null });
  assert.deepEqual((await textbookPassages(['Fischer esterification'], ['w1'], undefined, 2)).map((p) => p.location), ['p. 1', 'p. 2'], 'a failed rerank keeps the fused order');
});
