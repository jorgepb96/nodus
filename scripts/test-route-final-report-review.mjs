import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-route-final-report-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'inspection.mjs');
await build({ entryPoints: [path.join(root, 'electron/ai/moleculeInspection.ts')], outfile,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'no-external-services', setup(api) {
    const mocks = {
      '../capabilities/registry': `export const capabilityRegistry=()=>({providers:new Map([['nodus:chemistry',{id:'nodus:chemistry',tools:[{id:'verify-route',inputSchema:{properties:{labels:{}}}},{id:'compile'}]}]])}); export const pinCapabilitiesForTurn=()=>[];`,
      '../capabilities/runner': `export function createTrustedCapabilityRunner(){throw Error('test must supply a runner')}`,
      // The route review: one blocking finding, as parseRouteReview reads it.
      './aiClient': `export async function completeText(){return globalThis.__routeReview ?? '{"status":"ok"}'}`,
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
const steps = ['CCO>>CC=O', 'CC=O>>CC(=O)O'];
const labels = [
  [{ role: 'reactant', byproduct: false, name: 'ethanol', smiles: 'CCO' }, { role: 'product', byproduct: false, name: 'ethanal', smiles: 'CC=O' }],
  [{ role: 'reactant', byproduct: false, name: 'ethanal', smiles: 'CC=O' }, { role: 'product', byproduct: false, name: 'acetic acid', smiles: 'CC(=O)O' }],
];
const species = (smiles, name) => ({ input: smiles, canonicalSmiles: smiles, formula: '', name });
const passing = (index, reaction, reactants, products) => ({ index, reaction, ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants, agents: [], products });
const runner = {
  async invoke({ toolId }) {
    if (toolId === 'verify-route') {
      return { artifacts: [{ artifactType: 'route-audit', data: {
        steps: [passing(0, steps[0], [species('CCO', 'ethanol')], [species('CC=O', 'ethanal')]), passing(1, steps[1], [species('CC=O', 'ethanal')], [species('CC(=O)O', 'acetic acid')])],
        links: [{ from: 0, to: 1, ok: true, reason: 'carried', carried: [{ canonicalSmiles: 'CC=O', formula: 'C2H4O', heavyAtoms: 3 }] }],
        continuous: true, blocked: [], isolated: [],
      } }] };
    }
    if (toolId === 'compile') return { artifacts: [{ artifactType: 'chemistry-document', view: { kind: 'svg' } }] };
    throw Error(`unexpected tool ${toolId}`);
  },
  renderView: () => '<figure>step drawing</figure>',
};

test('a route the review holds back is not reported as passed under its drawings', async () => {
  globalThis.__routeReview = JSON.stringify({ status: 'problems', problems: [{ step: 2, severity: 'blocking', detail: 'The product named is not the one the prose describes.' }] });
  const answer = await appendRouteReportAndDrawings('Route prose', '', { runner, question: 'synthesis of acetic acid' }, { steps, labels });
  assert.match(answer, /\*\*Route check failed\*\* — a route review raised 1 problem/, 'the premise: the header refuses the route');
  assert.match(answer, /### Final report/, 'the drawings are still made: the gate does not wait for the review');
  assert.doesNotMatch(answer, /Every step of this route passed the check/);
  assert.match(answer, /the model review above found a named structure wrong for its step/);
});

test('a route the review accepts keeps its final report as it was', async () => {
  globalThis.__routeReview = JSON.stringify({ status: 'ok' });
  const answer = await appendRouteReportAndDrawings('Route prose', '', { runner, question: 'synthesis of acetic acid' }, { steps, labels });
  assert.match(answer, /Route checked: balanced and connected/);
  assert.match(answer, /Every step of this route passed the check, so the route is drawn\. 2 step\(s\)/);
});
