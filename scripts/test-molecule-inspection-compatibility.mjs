import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-route-compatibility-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'inspection.mjs');
await build({ entryPoints: [path.join(root, 'electron/ai/moleculeInspection.ts')], outfile,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'no-external-services', setup(api) {
    const mocks = {
      '../capabilities/registry': `export const capabilityRegistry=()=>({providers:new Map([['nodus:chemistry',{id:'nodus:chemistry',tools:[{id:'verify-route',inputSchema:{properties:{labels:{}}}}]}]])}); export const pinCapabilitiesForTurn=()=>[];`,
      '../capabilities/runner': `export function createTrustedCapabilityRunner(){throw Error('test must supply a runner')}`,
      './aiClient': `export function completeText(){throw Error('test must not call a model')}`,
      // The reaction index and the route evidence are optional; with no index they add nothing.
      '../reactionIndex': `export const reactionIndexService=()=>({localDirectory:async()=>null})`,
      './synthesisEvidence': `export async function invokeDisconnectionsEach(){return []} export function synthesisEvidenceWorkIds(){return []} export async function textbookPassages(){return []}`,
      // No PubChem mirror: the name and structure lookups go to the package as before.
      './pubchemMirror': `export const pubchemMirrorDirectory=()=>null; export const opsinDirectory=()=>null`,
      './chemistryStock': `export const chemistryStockDirectory=()=>null`,
      // No textbook-scheme index built: the route report has no textbook section.
      './textbookSchemes': `export const textbookSchemeDirectory=()=>null; export const textbookCitations=()=>[]`,
    };
    // Only the electron modules' imports are mocked: a shared module's own `./textbookSchemes` is the
    // real shared file, not electron/ai/textbookSchemes.
    api.onResolve({ filter: /^(\.\/aiClient|\.\/synthesisEvidence|\.\/pubchemMirror|\.\/chemistryStock|\.\/textbookSchemes|\.\.\/reactionIndex|\.\.\/capabilities\/(registry|runner))$/ }, args => (args.importer.includes(`${path.sep}electron${path.sep}`) ? { path: args.path, namespace: 'mock' } : undefined));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { appendRouteReportAndDrawings } = await import(pathToFileURL(outfile));
const steps = ['CCO>>CC=O', '', 'CC=O>>CC(=O)O'];
const labels = steps.map(() => [{ role: 'reactant', byproduct: false, name: 'ethanol', smiles: 'CCO' }]);
const passing = (index, reaction) => ({ index, reaction, ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] });
function runnerFor(auditSteps) {
  return { async invoke({ toolId, input }) {
    assert.equal(toolId, 'verify-route');
    assert.deepEqual(input.steps, steps);
    return { artifacts: [{ artifactType: 'route-audit', data: { steps: auditSteps, continuous: false, blocked: ['Step 2 is not built'], links: [] } }] };
  } };
}

test('an installed 2.5.6-style checker cannot attach shifted labels or corrections', async () => {
  const old = [passing(0, steps[0]), passing(1, steps[2])];
  const answer = await appendRouteReportAndDrawings('Route prose', '', { runner: runnerFor(old) }, { steps, labels });
  assert.match(answer, /Route check unavailable:.*omitted or renumbered/);
  assert.match(answer, /Update Chemistry Studio/);
  assert.doesNotMatch(answer, /Route checked: balanced|nodus-route-fix|### Route drawings/);
});

test('a checker that keeps the count but renumbers steps is also refused', async () => {
  const reordered = [passing(0, steps[0]), passing(2, steps[2]), passing(1, '')];
  const answer = await appendRouteReportAndDrawings('Route prose', '', { runner: runnerFor(reordered) }, { steps, labels });
  assert.match(answer, /omitted or renumbered/);
});

test('a 2.5.7-style checker preserves the failed step and the following step number', async () => {
  const current = [passing(0, steps[0]), { ...passing(1, ''), ok: false, error: 'Step could not be built' }, passing(2, steps[2])];
  const answer = await appendRouteReportAndDrawings('Route prose', '', { runner: runnerFor(current) }, { steps, labels });
  assert.doesNotMatch(answer, /Route check unavailable/);
  assert.match(answer, /Step 2/);
  assert.match(answer, /Step 3/);
  assert.match(answer, /Step could not be built/);
  assert.match(answer, /nodus-route-fix/);
});

test('a route where NO step could be built still gets a route check the model can act on (B50)', async () => {
  // Every step names a species that did not resolve. The package refuses an all-empty route, and
  // that refusal used to end the check with "route check unavailable", telling the model nothing.
  // The application now answers it itself, in the package's shape for an unbuilt step.
  let called = false;
  const runner = { async invoke() { called = true; throw new Error('Provide at least one reaction SMILES step.'); } };
  const empty = ['', '', ''];
  const unresolved = [{ step: 1, role: 'product', byproduct: false, name: 'benzyl (2S)-2-{[(tert-butoxycarbonyl)amino]propanamido}acetate', feedback: 'PubChem has no exact match for this name.' }];
  const answer = await appendRouteReportAndDrawings('Route prose', '', { runner }, { steps: empty, labels: empty.map(() => []), unresolved });
  assert.equal(called, false, 'the package is not asked to check a route with nothing in it');
  assert.doesNotMatch(answer, /Route check unavailable/, 'not the dead end it used to be');
  assert.match(answer, /could not be built/);
  assert.match(answer, /Step 1/);
  assert.match(answer, /Step 3/);
  assert.match(answer, /nodus-route-fix/, 'and the fix prompts are offered');

  // The measured case: some species DID resolve (given as structures), but no step had all of its own.
  called = false;
  const someLabels = [[{ role: 'reactant', byproduct: false, name: 'DCC', smiles: 'C(=NC1CCCCC1)=NC1CCCCC1' }], [], []];
  const measured = await appendRouteReportAndDrawings('Route prose', '', { runner }, { steps: empty, labels: someLabels, unresolved });
  assert.equal(called, false);
  assert.match(measured, /could not be built/);
  assert.doesNotMatch(measured, /Route check unavailable/);
});

test('a route review that never answered is said to be missing, not read as a clean review', async () => {
  // The review is the blocking check a balance cannot do. When its call fails (a timeout, a
  // provider error) the report used to print the same verdict as a review that found nothing.
  const passingSteps = [passing(0, 'CCO>>CC=O'), passing(1, 'CC=O>>CC(=O)O')];
  const two = ['CCO>>CC=O', 'CC=O>>CC(=O)O'];
  const runner = { async invoke({ toolId }) {
    assert.equal(toolId, 'verify-route');
    return { artifacts: [{ artifactType: 'route-audit', data: { steps: passingSteps, continuous: true, blocked: [], links: [] } }] };
  } };
  const warn = console.warn; const info = console.info; console.warn = () => {}; console.info = () => {};
  let answer;
  try { answer = await appendRouteReportAndDrawings('Route prose', '', { runner }, { steps: two, labels: two.map(() => [{ role: 'reactant', byproduct: false, name: 'ethanol', smiles: 'CCO' }]) }); }
  finally { console.warn = warn; console.info = info; }
  assert.match(answer, /Route checked: balanced and connected/);
  assert.match(answer, /model review did not run/i);
});
