// The route report's index lookups, compatibility check and stock lines read the resolved labels
// and nothing of the audit, so they must not queue behind it: verify-route is the longest single
// call in the report (about 37 s on one core), and everything started after it adds to the turn.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-route-overlap-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'inspection.mjs');
const TOOLS = ['verify-route', 'known-reactions', 'check-compatibility', 'check-stock', 'propose-disconnections'];
await build({ entryPoints: [path.join(root, 'electron/ai/moleculeInspection.ts')], outfile,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'no-external-services', setup(api) {
    const mocks = {
      '../capabilities/registry': `export const capabilityRegistry=()=>({providers:new Map([['nodus:chemistry',{id:'nodus:chemistry',tools:${JSON.stringify(TOOLS)}.map(id=>({id,inputSchema:{properties:{labels:{}}}}))}]])}); export const pinCapabilitiesForTurn=()=>[];`,
      '../capabilities/runner': `export function createTrustedCapabilityRunner(){throw Error('test must supply a runner')}`,
      './aiClient': `export async function completeText(){return ''}`,
      '../reactionIndex': `export const reactionIndexService=()=>({localDirectory:async()=>'/ord'})`,
      './synthesisEvidence': `export async function invokeDisconnectionsEach(){return []} export function synthesisEvidenceWorkIds(){return []} export async function textbookPassages(){return []}`,
      './pubchemMirror': `export const pubchemMirrorDirectory=()=>null; export const opsinDirectory=()=>null`,
      './chemistryStock': `export const chemistryStockDirectory=()=>'/stock'`,
      './textbookSchemes': `export const textbookSchemeDirectory=()=>'/schemes'; export const textbookCitations=()=>[]`,
    };
    api.onResolve({ filter: /^(\.\/aiClient|\.\/synthesisEvidence|\.\/pubchemMirror|\.\/chemistryStock|\.\/textbookSchemes|\.\.\/reactionIndex|\.\.\/capabilities\/(registry|runner))$/ }, args => (args.importer.includes(`${path.sep}electron${path.sep}`) ? { path: args.path, namespace: 'mock' } : undefined));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { appendRouteReportAndDrawings } = await import(pathToFileURL(outfile));

const steps = ['CCO>>CC=O', 'CC=O>>CC(=O)O'];
const labels = [
  [{ role: 'reactant', byproduct: false, name: 'ethanol', smiles: 'CCO' }, { role: 'product', byproduct: false, name: 'acetaldehyde', smiles: 'CC=O' }, { role: 'agent', byproduct: false, name: 'pyridinium chlorochromate', smiles: 'Cl[Cr](=O)(=O)[O-].c1cc[nH+]cc1' }],
  [{ role: 'reactant', byproduct: false, name: 'acetaldehyde', smiles: 'CC=O' }, { role: 'product', byproduct: false, name: 'acetic acid', smiles: 'CC(=O)O' }],
];
const failing = (index, reaction) => ({ index, reaction, ok: false, error: 'not balanced', balanced: false, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] });
const AUDIT_MS = 300;
const LOOKUP_MS = 150;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function recordingRunner() {
  const started = Date.now();
  const calls = [];
  return { calls, runner: { async invoke({ toolId, input }) {
    const call = { toolId, indexDir: input.indexDir, start: Date.now() - started };
    calls.push(call);
    if (toolId === 'verify-route') {
      await sleep(AUDIT_MS);
      call.end = Date.now() - started;
      return { artifacts: [{ artifactType: 'route-audit', data: { steps: steps.map((s, i) => failing(i, s)), continuous: false, blocked: [], links: [] } }] };
    }
    await sleep(LOOKUP_MS);
    call.end = Date.now() - started;
    if (toolId === 'known-reactions') return { artifacts: [{ artifactType: 'reaction-precedent', data: { reactions: steps.map(() => ({ count: 0, classes: [] })), products: [], similar: [] } }] };
    return { artifacts: [] };
  } } };
}

test('the lookups that do not read the audit start beside it, not after it', async () => {
  const { calls, runner } = recordingRunner();
  const t0 = Date.now();
  const info = console.info; console.info = () => {};
  try {
    await appendRouteReportAndDrawings('Route prose', 'Route prose', { runner, target: 'CC(=O)O' }, { steps, labels });
  } finally { console.info = info; }
  const elapsed = Date.now() - t0;
  const audit = calls.find(call => call.toolId === 'verify-route');
  const independent = calls.filter(call => ['known-reactions', 'check-compatibility', 'check-stock'].includes(call.toolId));
  console.log(`report ${elapsed} ms; audit ${audit.start}-${audit.end} ms; ${independent.map(call => `${call.toolId}${call.indexDir ? `(${call.indexDir})` : ''} ${call.start}-${call.end}`).join('; ')}`);
  assert.equal(independent.length, 4, 'ORD precedent, textbook precedent, compatibility and stock all ran');
  for (const call of independent) assert.ok(call.start < audit.end, `${call.toolId} ${call.indexDir ?? ''} waited for the audit (started ${call.start} ms, audit ended ${audit.end} ms)`);
});
