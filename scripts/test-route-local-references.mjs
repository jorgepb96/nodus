import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-route-local-references-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'inspection.mjs');
await build({ entryPoints: [path.join(root, 'electron/ai/moleculeInspection.ts')], outfile,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'no-external-services', setup(api) {
    const mocks = {
      '../capabilities/registry': `export const capabilityRegistry=()=>({providers:new Map([['nodus:chemistry',{id:'nodus:chemistry',tools:[{id:'verify-route',inputSchema:{properties:{labels:{},...(globalThis.__routeMirrorFields?{pubchemDir:{},opsinDir:{},localOnly:{}}:{})}}}]}]])}); export const pinCapabilitiesForTurn=()=>[];`,
      '../capabilities/runner': `export function createTrustedCapabilityRunner(){throw Error('test must supply a runner')}`,
      './aiClient': `export function completeText(){throw Error('test must not call a model')}`,
      // The reaction index and the route evidence are optional; with no index they add nothing.
      '../reactionIndex': `export const reactionIndexService=()=>({localDirectory:async()=>null})`,
      './synthesisEvidence': `export async function invokeDisconnectionsEach(){return []} export function synthesisEvidenceWorkIds(){return []} export async function textbookPassages(){return []}`,
      // A PubChem mirror and a local OPSIN are installed.
      './pubchemMirror': `export const pubchemMirrorDirectory=()=>'/mirror'; export const opsinDirectory=()=>'/opsin'`,
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
const steps = ['CCO.CC(=O)O>>CCOC(C)=O.O'];
const labels = [[{ role: 'reactant', byproduct: false, name: 'ethanol', smiles: 'CCO' }]];
const audit = { steps: [{ index: 0, reaction: steps[0], ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] }], continuous: true, blocked: [], links: [] };
const routeInputs = async () => {
  const sent = [];
  const runner = { async invoke({ toolId, input }) {
    if (toolId === 'verify-route') sent.push(input);
    return toolId === 'verify-route' ? { artifacts: [{ artifactType: 'route-audit', data: audit }] } : { artifacts: [] };
  }, async renderView() { return ''; } };
  await appendRouteReportAndDrawings('Route prose', '', { runner }, { steps, labels });
  return sent;
};

test('the route check is sent the local reference directories when the package reads them', async () => {
  globalThis.__routeMirrorFields = true;
  const [input] = await routeInputs();
  assert.equal(input.pubchemDir, '/mirror', 'the label check can answer from the local mirror');
  assert.equal(input.opsinDir, '/opsin');
});

test('an older package that does not declare them is never sent them', async () => {
  globalThis.__routeMirrorFields = false;
  const [input] = await routeInputs();
  assert.equal('pubchemDir' in input, false);
  assert.equal('opsinDir' in input, false);
});
