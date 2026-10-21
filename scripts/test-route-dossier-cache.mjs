// The structure check remembers a dossier it has already produced.
//
// `inspect` takes only a SMILES, so a dossier is a pure function of that string, and the structure
// block is rebuilt on every turn of a conversation from the same route. Measured on the 34-step
// program route (2026-10-20): 54 unique species cost 24.0 s, 12 of them over 300 characters cost
// 11.2 s of that, and six turns of a real run spent 133.9 s re-inspecting the identical set. These
// tests pin the memo that stops it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-dossier-cache-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'inspection.mjs');
await build({ entryPoints: [path.join(root, 'electron/ai/moleculeInspection.ts')], outfile,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'no-external-services', setup(api) {
    const mocks = {
      // The registry must offer `inspect`, or inspectProvider() finds nothing and the structure
      // check never runs at all.
      '../capabilities/registry': `export const capabilityRegistry=()=>({providers:new Map([['nodus:chemistry',{id:'nodus:chemistry',tools:[{id:'inspect'},{id:'verify-route',inputSchema:{properties:{labels:{}}}},{id:'compile'}]}]])}); export const pinCapabilitiesForTurn=()=>[];`,
      '../capabilities/runner': `export function createTrustedCapabilityRunner(){throw Error('test must supply a runner')}`,
      './aiClient': `export async function completeText(){return '{"status":"ok"}'}`,
      '../reactionIndex': `export const reactionIndexService=()=>({localDirectory:async()=>null})`,
      './synthesisEvidence': `export async function invokeDisconnections(){return []} export async function invokeDisconnectionsEach(){return []} export async function invokeForwardSteps(){return null} export function synthesisEvidenceWorkIds(){return []} export async function textbookPassages(){return []}`,
      './pubchemMirror': `export const pubchemMirrorDirectory=()=>null; export const opsinDirectory=()=>null`,
      './chemistryStock': `export const chemistryStockDirectory=()=>null`,
      './textbookSchemes': `export const textbookSchemeDirectory=()=>null; export const textbookCitations=()=>[]`,
    };
    api.onResolve({ filter: /^(\.\/aiClient|\.\/synthesisEvidence|\.\/pubchemMirror|\.\/chemistryStock|\.\/textbookSchemes|\.\.\/reactionIndex|\.\.\/capabilities\/(registry|runner))$/ }, args => (args.importer.includes(`${path.sep}electron${path.sep}`) ? { path: args.path, namespace: 'mock' } : undefined));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { inspectResearchMolecules } = await import(pathToFileURL(outfile));

/** A dossier needs canonicalSmiles plus atom and bond arrays, or normalizeMoleculeDossier
 *  discards it and nothing is cached. */
const dossierFor = (smiles) => ({
  data: { inputSmiles: smiles, canonicalSmiles: smiles, formula: 'C2H4O2',
    atoms: [{ index: 0, element: 'C' }], bonds: [] },
});

function countingRunner() {
  const seen = [];
  return {
    seen,
    async invoke({ toolId, input }) {
      if (toolId !== 'inspect') throw Error(`unexpected tool ${toolId}`);
      const batch = input.smiles ?? [];
      seen.push(batch);
      return { artifacts: batch.map(dossierFor) };
    },
    renderView: () => '',
  };
}

// findSmilesCandidates is deliberately conservative — it will not read `CC(=O)O` out of prose, so
// these are shapes it does accept. The memo is module-wide and therefore shared BETWEEN tests:
// each test below uses species no other test mentions, except where it is relying on a hit.
const ACETIC = 'C1CC1CCNN';
const PROPANOL = 'C1CC1CCOO';

test('the same species is inspected once, not once per turn', async () => {
  const runner = countingRunner();
  const first = await inspectResearchMolecules(`what is ${ACETIC}`, { runner });
  assert.equal(first.length, 1, 'the premise: one dossier came back');
  assert.equal(runner.seen.length, 1, 'the first turn asks the package');

  const second = await inspectResearchMolecules(`what is ${ACETIC}`, { runner });
  assert.equal(second.length, 1, 'the second turn still reports the structure');
  assert.equal(runner.seen.length, 1, 'but it does not ask the package again');
  assert.deepEqual(second[0], first[0], 'and the remembered dossier is the same one');
});

test('a species not seen before is still inspected, and only that one', async () => {
  const runner = countingRunner();
  await inspectResearchMolecules(`what is ${ACETIC}`, { runner });
  const asked = runner.seen.length;
  const mixed = await inspectResearchMolecules(`compare ${ACETIC} with ${PROPANOL}`, { runner });
  assert.equal(mixed.length, 2, 'both structures are reported');
  assert.equal(runner.seen.length, asked + 1, 'one further call for the new species');
  assert.deepEqual(runner.seen.at(-1), [PROPANOL], 'and it carries only the species not already known');
});

test('the memo is bounded, and the oldest species is the one that goes', async () => {
  const runner = countingRunner();
  // One species per turn, past the 512-entry ceiling. The first is then the oldest entry, so a
  // FIFO bound must have dropped it while a later one is still remembered.
  const species = (length) => `C1CC1${'C'.repeat(length)}NO`;
  const first = species(1);
  for (let length = 1; length <= 520; length += 1) {
    await inspectResearchMolecules(`what is ${species(length)}`, { runner });
  }
  assert.equal(runner.seen.length, 520, 'the premise: each species was new and was asked for once');

  const asked = runner.seen.length;
  await inspectResearchMolecules(`what is ${species(520)}`, { runner });
  assert.equal(runner.seen.length, asked, 'the most recent species is still remembered');
  await inspectResearchMolecules(`what is ${first}`, { runner });
  assert.equal(runner.seen.length, asked + 1, 'and the oldest was evicted, so it is asked again');
});

test('a dossier the package refused is not remembered as an answer', async () => {
  const runner = {
    calls: 0,
    async invoke() { this.calls += 1; return { artifacts: [] }; },
    renderView: () => '',
  };
  // Never inspected by the tests above, so this reaches the package rather than the memo.
  const unknown = 'C1CCCCC1O';
  const first = await inspectResearchMolecules(`what is ${unknown}`, { runner });
  assert.equal(first.length, 0, 'nothing is reported for a species with no dossier');
  await inspectResearchMolecules(`what is ${unknown}`, { runner });
  assert.equal(runner.calls, 2, 'it is retried rather than cached as a failure');
});
