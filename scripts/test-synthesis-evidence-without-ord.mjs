// Route evidence must degrade, never fail, when the Open Reaction Database is not there: no
// Chemistry Studio, an older package without the disconnection tool, no downloaded index, a
// format-3 index without the retro tables, or a tool that throws. In every case the textbook
// passages still arrive and the research chat is not blocked.
//
// The real electron/ai/synthesisEvidence.ts is bundled with its app dependencies replaced by
// in-memory stand-ins (capability registry, runner, reaction index, database, embeddings).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-evidence-no-ord-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

// Shared state the stubs read, set per scenario.
globalThis.__ord = { provider: null, indexDir: null, invoke: null, calls: 0 };

const STUBS = {
  '../capabilities/registry': `export const capabilityRegistry = () => ({ providers: new Map(globalThis.__ord.provider ? [['nodus:chemistry', globalThis.__ord.provider]] : []) });`,
  '../reactionIndex': `export const reactionIndexService = () => ({ localDirectory: async () => globalThis.__ord.indexDir });`,
  './moleculeInspection': `export const chemistryRunner = () => ({ runner: { invoke: async (request) => { globalThis.__ord.calls += 1; return globalThis.__ord.invoke(request); } }, dispose: async () => {} });`,
  './aiClient': `export const embed = async () => null;`,
  // No stock lists imported: disconnections are requested without a stock directory.
  './chemistryStock': `export const chemistryStockDirectory = () => null; export const chemistryStockLists = () => [];`,
  // No textbook-scheme index unless a scenario sets one.
  './textbookSchemes': `export const textbookSchemeDirectory = () => globalThis.__textbook?.dir ?? null; export const textbookCitations = (ids) => (globalThis.__textbook?.cite ?? (() => []))(ids); export const textbookTemplateCitations = (templates) => (globalThis.__textbook?.citeTemplates ?? (() => []))(templates);`,
  // No local reranker installed: the fused order stands.
  './localReranker': `export const rerankerAvailable = () => false; export const rerank = async () => null;`,
  '../db/database': `export const getDb = () => ({ prepare: () => ({ all: () => [{ nodus_id: 'w1', title: 'Klein Organic Chemistry 3rd Ed', collections: 'Chemistry' }] }) });`,
  '../db/passagesRepo': `export const findSimilarPassages = () => [];
export const lexicalPassageSearch = (query) => [{ passage_id: 'w1#' + query.length, nodus_id: 'w1', text: 'Benzocaine is made by the Fischer esterification of a carboxylic acid with an alcohol under acid catalysis. The equilibrium is driven toward the ester by using the alcohol as the solvent and by removing the water that forms, and the nitro group is then reduced to the amine with tin and hydrochloric acid or by catalytic hydrogenation over palladium on carbon.', page_label: 'p. 862', source_ref: null, page_number: 862, similarity: 0.9, title: 'Klein Organic Chemistry 3rd Ed', authors_json: '[]', year: 2017, zotero_key: 'K' }];`,
};

const outfile = path.join(tmp, 'synthesisEvidence.mjs');
await build({
  entryPoints: [path.join(root, 'electron/ai/synthesisEvidence.ts')],
  outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  alias: { '@shared': path.join(root, 'shared') },
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => (STUBS[args.path] ? { path: args.path, namespace: 'stub' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
    },
  }],
});
const { gatherSynthesisEvidence, clearSynthesisEvidenceCache } = await import(pathToFileURL(outfile).href);
// Target-level evidence is remembered between a request and its corrections, so every test here
// asks about the same target and would otherwise be served the FIRST test's stubbed answer. Each
// case starts from an empty cache; without this the suite silently stops exercising the gather,
// which is how the cache was first seen working.
test.beforeEach(() => clearSynthesisEvidenceCache());
const { synthesisEvidencePayload } = await import(pathToFileURL(await (async () => {
  const out = path.join(tmp, 'shared.mjs');
  await build({ entryPoints: [path.join(root, 'shared/synthesisEvidence.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  return out;
})()).href);

const REQUEST = 'Propose a step-by-step laboratory synthesis of benzocaine (SMILES: CCOC(=O)c1ccc(N)cc1), starting from 4-nitrotoluene (Cc1ccc([N+](=O)[O-])cc1).';
const TOOL = { tools: [{ id: 'propose-disconnections' }] };
const quiet = async (fn) => { const warn = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = warn; } };

async function scenario(state) {
  Object.assign(globalThis.__ord, { provider: null, indexDir: null, invoke: null, calls: 0 }, state);
  return quiet(() => gatherSynthesisEvidence(REQUEST));
}

function assertTextbookOnly(evidence, label) {
  assert.ok(evidence, `${label}: evidence is still gathered`);
  assert.deepEqual(evidence.disconnections, [], `${label}: no ORD disconnections`);
  assert.equal(evidence.target, 'CCOC(=O)c1ccc(N)cc1');
  assert.ok(evidence.passages.length > 0, `${label}: the textbook passages still arrive`);
  const payload = synthesisEvidencePayload(evidence);
  assert.ok(payload && !('ord_disconnections' in payload) && payload.textbook_passages.length, `${label}: the payload carries passages only`);
}

test('no Chemistry Studio at all: textbook evidence only, the tool is never called', async () => {
  const evidence = await scenario({});
  assertTextbookOnly(evidence, 'no package');
  assert.equal(globalThis.__ord.calls, 0);
});

test('an older package without the disconnection tool', async () => {
  const evidence = await scenario({ provider: { tools: [{ id: 'known-reactions' }] }, indexDir: '/idx' });
  assertTextbookOnly(evidence, 'older package');
  assert.equal(globalThis.__ord.calls, 0);
});

test('the ORD index has not been downloaded', async () => {
  const evidence = await scenario({ provider: TOOL, indexDir: null });
  assertTextbookOnly(evidence, 'no index');
  assert.equal(globalThis.__ord.calls, 0);
});

test('a format-3 index without retro tables answers with no proposals', async () => {
  const empty = { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: [{ input: 'CCOC(=O)c1ccc(N)cc1', target: 'CCOC(=O)c1ccc(N)cc1', madeBy: null, proposals: [] }], indexLacks: ['retro-templates.tsv.zst', 'molecules.tsv.zst'] } }] };
  const evidence = await scenario({ provider: TOOL, indexDir: '/idx', invoke: async () => empty });
  assertTextbookOnly(evidence, 'format 3');
  assert.equal(globalThis.__ord.calls, 1, 'no second-level call when the first found nothing');
});

test('a tool that fails or returns no artifact never blocks the request', async () => {
  for (const invoke of [async () => { throw new Error('The disconnection search failed.'); }, async () => ({ artifacts: [] }), async () => ({})]) {
    const evidence = await scenario({ provider: TOOL, indexDir: '/idx', invoke });
    assertTextbookOnly(evidence, 'tool failure');
  }
});

test('an aborted request still aborts', async () => {
  const controller = new AbortController();
  controller.abort();
  Object.assign(globalThis.__ord, { provider: TOOL, indexDir: '/idx', invoke: async () => { throw new DOMException('aborted', 'AbortError'); }, calls: 0 });
  await assert.rejects(quiet(() => gatherSynthesisEvidence(REQUEST, { signal: controller.signal })));
});

test('with the index present, the ORD brief is included', async () => {
  const found = { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: [{ input: 'CCOC(=O)c1ccc(N)cc1', target: 'CCOC(=O)c1ccc(N)cc1', madeBy: null, proposals: [{ precursors: 'CCO.Nc1ccc(C(=O)O)cc1', classes: ['Fischer esterification'], recorded: 3, available: true }] }] } }] };
  const evidence = await scenario({ provider: TOOL, indexDir: '/idx', invoke: async () => found });
  assert.equal(evidence.disconnections[0].proposals[0].classes[0], 'Fischer esterification');
  assert.ok(synthesisEvidencePayload(evidence).ord_disconnections);
});

test('with starting materials the lookup goes three levels back, toward them', async () => {
  const brief = (target, precursors) => ({ input: target, target, madeBy: null, proposals: precursors.map((p) => ({ precursors: p, classes: ['a class'], recorded: 1, available: true })) });
  // benzocaine ← ethyl 4-nitrobenzoate ← 4-nitrobenzoic acid ← 4-nitrotoluene
  const chain = {
    'CCOC(=O)c1ccc(N)cc1': brief('CCOC(=O)c1ccc(N)cc1', ['CCOC(=O)c1ccc([N+](=O)[O-])cc1']),
    'CCOC(=O)c1ccc([N+](=O)[O-])cc1': brief('CCOC(=O)c1ccc([N+](=O)[O-])cc1', ['CCO.O=C(O)c1ccc([N+](=O)[O-])cc1']),
    'O=C(O)c1ccc([N+](=O)[O-])cc1': brief('O=C(O)c1ccc([N+](=O)[O-])cc1', ['Cc1ccc([N+](=O)[O-])cc1']),
  };
  const asked = [];
  const invoke = async ({ input }) => {
    asked.push(input.targets);
    return { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: input.targets.map((t) => chain[t]).filter(Boolean) } }] };
  };
  const evidence = await scenario({ provider: TOOL, indexDir: '/idx', invoke });
  assert.deepEqual(asked, [['CCOC(=O)c1ccc(N)cc1'], ['CCOC(=O)c1ccc([N+](=O)[O-])cc1'], ['O=C(O)c1ccc([N+](=O)[O-])cc1']]);
  assert.equal(evidence.disconnections.length, 3);
  // Without starting materials it stops after two levels.
  asked.length = 0;
  Object.assign(globalThis.__ord, { provider: TOOL, indexDir: '/idx', invoke, calls: 0 });
  await quiet(() => gatherSynthesisEvidence('Propose a synthesis of benzocaine (SMILES: CCOC(=O)c1ccc(N)cc1).'));
  assert.equal(asked.length, 2);
});

test('with a textbook-scheme index, the textbook preparations of the target are cited by book and page', async () => {
  const TB = `tb-${'a'.repeat(32)}`;
  globalThis.__textbook = {
    dir: '/schemes',
    cite: (ids) => ids.filter((id) => id === TB).map((id) => ({ id, book: 'Klein Organic Chemistry 3rd Ed', page: 862, kind: 'crop', reagents: 'EtOH, H2SO4, reflux', yield: '85%', status: 'confirmed', link: 'nodus://passage/w1%23862' })),
  };
  const ordBrief = { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: [{ input: 'CCOC(=O)c1ccc(N)cc1', target: 'CCOC(=O)c1ccc(N)cc1', madeBy: null, proposals: [{ precursors: 'CCO.Nc1ccc(C(=O)O)cc1', classes: ['Fischer esterification'], recorded: 3, available: true }] }] } }] };
  const textbook = { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: [{ input: 'CCOC(=O)c1ccc(N)cc1', target: 'CCOC(=O)c1ccc(N)cc1', madeBy: { count: 1, reactions: [{ key: 'k', count: 1, samples: [TB, `tb-${'b'.repeat(32)}`, 'ord-x'], reaction: 'CCO.Nc1ccc(C(=O)O)cc1>>CCOC(=O)c1ccc(N)cc1' }] }, proposals: [] }] } }] };
  const dirs = [];
  try {
    const evidence = await scenario({ provider: TOOL, indexDir: '/idx', invoke: async ({ input }) => { dirs.push(input.indexDir); return input.indexDir === '/schemes' ? textbook : ordBrief; } });
    assert.ok(dirs.includes('/schemes'), 'the textbook index is asked');
    const payload = synthesisEvidencePayload(evidence);
    const [prep] = payload.textbook_preparations;
    assert.equal(prep.molecule, 'CCOC(=O)c1ccc(N)cc1');
    assert.equal(prep.reactions[0].citations.length, 1, 'unknown and ORD ids are not cited');
    assert.match(prep.reactions[0].citations[0], /\[\*Klein Organic Chemistry 3rd Ed\*, p\. 862\]\(nodus:\/\/passage\/w1%23862\) · conditions: EtOH, H2SO4, reflux · yield 85%/);
    assert.ok(payload.ord_disconnections, 'the ORD brief is still there');
  } finally {
    globalThis.__textbook = undefined;
  }
});

test('textbook retro templates: a proposal is cited by the schemes its templates came from; template SMARTS never reach the model', async () => {
  const T1 = '[N;H0;D3;+0:1]-[c:2]>>Cl-[c:2].[NH;D2;+0:1]';
  const T2 = '[*:1]-[N;H0;D3;+0:2]>>[*:1]-Br.[NH;D2;+0:2]';
  globalThis.__textbook = {
    dir: '/schemes',
    cite: () => [],
    citeTemplates: (templates) => templates.flatMap((t) => t === T1
      ? [{ book: 'Synthetic Textbook A', page: 1115, reagents: 'Pd cat. + ligands', generic: false }]
      : t === T2 ? [{ book: 'Synthetic Textbook B', page: 42, reagents: 'K2CO3, DMF', generic: true }] : []),
  };
  const target = 'CN1CCN(c2ccccc2)CC1';
  const ordBrief = { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: [{ input: target, target, madeBy: null, proposals: [{ precursors: 'CN1CCNCC1.Brc1ccccc1', classes: ['N-arylation'], recorded: 2, available: true, templates: ['[ord-template]>>[x]'] }] }] } }] };
  const textbook = { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: [{ input: target, target, madeBy: null, proposals: [
    { precursors: 'CN1CCNCC1.Clc1ccccc1', recorded: 0, templateCount: 5, templates: [T1] },
    { precursors: 'CN1CCNCC1.Brc1ccccc1', recorded: 0, templateCount: 3, templates: [T2, T1] },
    { precursors: 'unknown.template', recorded: 0, templates: ['[C:1]>>[C:1]'] },
    { precursors: 'CN1CCNCC1.Ic1ccccc1', recorded: 0, templates: [T1] },
  ] }] } }] };
  try {
    const evidence = await scenario({ provider: TOOL, indexDir: '/idx', invoke: async ({ input }) => (input.indexDir === '/schemes' ? textbook : ordBrief) });
    const payload = synthesisEvidencePayload(evidence);
    const [prep] = payload.textbook_preparations;
    assert.deepEqual(prep.reactions, []);
    assert.deepEqual(prep.disconnections, [
      { precursors: 'CN1CCNCC1.Clc1ccccc1', citations: ['*Synthetic Textbook A*, p. 1115 · conditions: Pd cat. + ligands · worked example'] },
      { precursors: 'CN1CCNCC1.Brc1ccccc1', citations: ['*Synthetic Textbook B*, p. 42 · conditions: K2CO3, DMF · general scheme', '*Synthetic Textbook A*, p. 1115 · conditions: Pd cat. + ligands · worked example'] },
    ], 'uncited proposals are skipped; two per molecule');
    assert.ok(!JSON.stringify(payload).includes('ord-template'), 'ORD template SMARTS are not sent to the model');
    assert.ok(!JSON.stringify(payload.ord_disconnections).includes('templates'));
  } finally {
    globalThis.__textbook = undefined;
  }
});

test('a textbook index that fails never blocks the request', async () => {
  globalThis.__textbook = { dir: '/schemes', cite: () => [] };
  try {
    const evidence = await scenario({ provider: TOOL, indexDir: null, invoke: async () => { throw new Error('boom'); } });
    assert.ok(evidence.passages.length > 0);
    assert.equal(evidence.textbookPreparations, undefined);
  } finally {
    globalThis.__textbook = undefined;
  }
});

test('route search: candidate routes over the ORD and textbook indexes, cited by ORD id, book page or template source', async () => {
  const TB = `tb-${'c'.repeat(32)}`;
  const ORD = `ord-${'d'.repeat(32)}`;
  const T1 = '[N;H0;D3;+0:1]-[c:2]>>Cl-[c:2].[NH;D2;+0:1]';
  globalThis.__textbook = {
    dir: '/schemes',
    cite: (ids) => ids.filter((id) => id === TB).map((id) => ({ id, book: 'Synthetic Textbook A', page: 921, kind: 'crop', reagents: 'H2, PtO2, EtOH', yield: '85%', status: 'confirmed', link: null })),
    citeTemplates: (templates) => (templates.includes(T1) ? [{ book: 'Synthetic Textbook B', page: 12, reagents: 'conc. H2SO4', generic: true }] : []),
  };
  const route = { target: 'CCOC(=O)c1ccc(N)cc1', expanded: 4, timedOut: false, routes: [
    { cost: 2, steps: [
      { product: 'CCOC(=O)c1ccc([N+](=O)[O-])cc1', precursors: ['CCO', 'O=C(O)c1ccc([N+](=O)[O-])cc1'], kind: 'template', index: 'textbook', recorded: 0, samples: [], templates: [T1] },
      { product: 'CCOC(=O)c1ccc(N)cc1', precursors: ['CCOC(=O)c1ccc([N+](=O)[O-])cc1'], kind: 'recorded', index: 'textbook', recorded: 2, samples: [TB, `tb-${'e'.repeat(32)}`] },
    ], startingMaterials: [{ smiles: 'CCO', given: false, inStock: true }, { smiles: 'O=C(O)c1ccc([N+](=O)[O-])cc1', given: false, inStock: false }] },
    { cost: 1, steps: [{ product: 'CCOC(=O)c1ccc(N)cc1', precursors: ['CCO', 'Nc1ccc(C(=O)O)cc1'], kind: 'recorded', index: 'ord', recorded: 1, samples: [ORD, 'not-an-id'] }],
      startingMaterials: [{ smiles: 'Cc1ccc([N+](=O)[O-])cc1', given: true, inStock: true }] },
    { cost: 9, steps: Array.from({ length: 7 }, () => ({ product: 'CCO', precursors: ['C'], kind: 'template', index: 'ord' })), startingMaterials: [] },
  ] };
  const requests = [];
  const tools = { tools: [{ id: 'propose-disconnections' }, { id: 'search-routes' }] };
  try {
    const evidence = await scenario({
      provider: tools, indexDir: '/idx',
      invoke: async (request) => {
        requests.push(request);
        if (request.toolId === 'search-routes') return { artifacts: [{ artifactType: 'candidate-routes', data: route }] };
        return { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: [] } }] };
      },
    });
    const search = requests.find((request) => request.toolId === 'search-routes');
    assert.deepEqual(search.input, { indexDirs: ['/idx', '/schemes'], target: 'CCOC(=O)c1ccc(N)cc1', maxSteps: 5, budgetSeconds: 60, startingMaterials: ['Cc1ccc([N+](=O)[O-])cc1'] });
    const payload = synthesisEvidencePayload(evidence);
    assert.equal(payload.candidate_routes.length, 2, 'a route longer than six steps is left out');
    assert.deepEqual(payload.candidate_routes[0], {
      steps: [
        { reaction: 'CCO.O=C(O)c1ccc([N+](=O)[O-])cc1>>CCOC(=O)c1ccc([N+](=O)[O-])cc1', basis: 'template', source: 'textbook', citations: ['*Synthetic Textbook B*, p. 12 · conditions: conc. H2SO4 · general scheme'] },
        { reaction: 'CCOC(=O)c1ccc([N+](=O)[O-])cc1>>CCOC(=O)c1ccc(N)cc1', basis: 'recorded', source: 'textbook', recorded: 2, citations: ['*Synthetic Textbook A*, p. 921 · conditions: H2, PtO2, EtOH · yield 85%'] },
      ],
      starting_materials: [{ smiles: 'CCO', status: 'in stock' }, { smiles: 'O=C(O)c1ccc([N+](=O)[O-])cc1', status: 'to source' }],
    });
    assert.deepEqual(payload.candidate_routes[1].steps[0].citations, [ORD], 'ORD steps cite their ORD ids only');
    assert.deepEqual(payload.candidate_routes[1].starting_materials, [{ smiles: 'Cc1ccc([N+](=O)[O-])cc1', status: 'given' }]);
    assert.ok(!JSON.stringify(payload.candidate_routes).includes('>>Cl-[c'), 'template SMARTS never reach the model');
  } finally {
    globalThis.__textbook = undefined;
  }
});

test('a route search that fails or times out never blocks the request', async () => {
  const tools = { tools: [{ id: 'propose-disconnections' }, { id: 'search-routes' }] };
  const evidence = await scenario({
    provider: tools, indexDir: '/idx',
    invoke: async (request) => {
      if (request.toolId === 'search-routes') throw new Error('timed out');
      return { artifacts: [{ artifactType: 'reaction-disconnections', data: { disconnections: [] } }] };
    },
  });
  assert.ok(evidence.passages.length > 0);
  assert.equal(evidence.candidateRoutes, undefined);
  assert.ok(!('candidate_routes' in synthesisEvidencePayload(evidence)));
});

test('a correction reuses the evidence its request gathered', async () => {
  // Measured on a real two-turn run: the gather cost 394.4s and then 393.8s and printed identical
  // counts both times, which is 43% of the clock spent twice on the same target.
  const first = await scenario({ provider: TOOL, indexDir: '/idx', invoke: () => ({ disconnections: [] }) });
  const calls = globalThis.__ord.calls;
  assert.ok(first, 'the request gathers');

  // The same target, reached through the text a correction turn carries. The gather's inputs are
  // unchanged, so nothing is recomputed.
  const second = await quiet(() => gatherSynthesisEvidence(REQUEST));
  assert.equal(globalThis.__ord.calls, calls, 'the index is not asked a second time');
  assert.equal(second.target, first.target);
  assert.deepEqual(second.passages, first.passages);

  // A DIFFERENT target must not be served the first one's evidence, which is the failure mode a
  // cache keyed too loosely would have.
  const other = 'Propose a step-by-step laboratory synthesis of aspirin (SMILES: CC(=O)Oc1ccccc1C(=O)O), starting from phenol (Oc1ccccc1).';
  const third = await quiet(() => gatherSynthesisEvidence(other));
  assert.equal(third.target, 'CC(=O)Oc1ccccc1C(=O)O');
  assert.ok(globalThis.__ord.calls > calls, 'a new target does the work');

  // And the same target in another vault is a different entry: every passage below is read from
  // that vault's own database.
  const before = globalThis.__ord.calls;
  await quiet(() => gatherSynthesisEvidence(REQUEST, { vaultId: 'another-vault' }));
  assert.ok(globalThis.__ord.calls > before, 'another vault does its own work');
});

test('clearing the cache makes the next request gather again', async () => {
  await scenario({ provider: TOOL, indexDir: '/idx', invoke: () => ({ disconnections: [] }) });
  const calls = globalThis.__ord.calls;
  await quiet(() => gatherSynthesisEvidence(REQUEST));
  assert.equal(globalThis.__ord.calls, calls, 'still cached');
  clearSynthesisEvidenceCache();
  await quiet(() => gatherSynthesisEvidence(REQUEST));
  assert.ok(globalThis.__ord.calls > calls, 'and gathers again once cleared');
});

test('the route search is not asked about a target it has never answered for', async () => {
  // Derived from every [synthesisEvidence] line on disk, grouped by distinct target: the largest
  // target the search has ever returned a candidate for has 27 atom symbols, and from 35 upwards
  // it returned zero for all twelve distinct targets measured while spending its full 60s budget
  // each time. So above the threshold it is not asked; below it, nothing changes.
  const long = 'Propose a step-by-step laboratory synthesis of'
    + ' OC([C@H](CC1=CC=C(OCCSC[C@@H](C(O)=O)N)C=C1)NC(OCC2C3=CC=CC=C3C4=C2C=CC=C4)=O)=O'
    + ' starting from natural acids.';
  const source = await import('node:fs').then((fs) => fs.readFileSync(path.join(root, 'electron/ai/synthesisEvidence.ts'), 'utf8'));
  assert.match(source, /const ROUTE_SEARCH_MAX_ATOM_SYMBOLS = 32;/);
  assert.match(source, /if \(atomSymbols > ROUTE_SEARCH_MAX_ATOM_SYMBOLS\)/);
  // The skip is reported, so a run that gathered no candidates says which of the two reasons it was.
  assert.match(source, /route search skipped: the target has \$\{atomSymbols\} atom symbols/);

  // And the evidence still arrives for that target: only the search is skipped.
  clearSynthesisEvidenceCache();
  Object.assign(globalThis.__ord, { provider: null, indexDir: null, invoke: null, calls: 0 });
  const evidence = await quiet(() => gatherSynthesisEvidence(long));
  assert.ok(evidence, 'the gather still returns evidence');
  assert.equal(evidence.candidateRoutes, undefined, 'with no candidate routes');
  assert.equal(evidence.target, 'OC([C@H](CC1=CC=C(OCCSC[C@@H](C(O)=O)N)C=C1)NC(OCC2C3=CC=CC=C3C4=C2C=CC=C4)=O)=O');
});
