// A stopped turn must stop the name-correction call too. The route check asks the model to correct
// each name no reference resolves, and that request is the one model call on this path that was not
// given the turn's signal: a stop then waited for the full reply (up to the provider timeout).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-route-names-abort-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'inspection.mjs');
await build({ entryPoints: [path.join(root, 'electron/ai/moleculeInspection.ts')], outfile,
  bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'no-external-services', setup(api) {
    const mocks = {
      '../capabilities/registry': `export const capabilityRegistry=()=>({providers:new Map([['nodus:chemistry',{id:'nodus:chemistry',tools:[{id:'resolve-names',inputSchema:{properties:{}}}]}]])}); export const pinCapabilitiesForTurn=()=>[];`,
      '../capabilities/runner': `export function createTrustedCapabilityRunner(){throw Error('test must supply a runner')}`,
      // A model that answers after five seconds unless the request is cancelled.
      './aiClient': `export function completeText(opts){ globalThis.__modelSignal = opts.signal; return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve('{"names":[]}'), 5000);
        opts.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(opts.signal.reason); }, { once: true });
      }); }`,
      '../reactionIndex': `export const reactionIndexService=()=>({localDirectory:async()=>null})`,
      './synthesisEvidence': `export async function invokeDisconnectionsEach(){return []} export function synthesisEvidenceWorkIds(){return []} export async function textbookPassages(){return []}`,
      './pubchemMirror': `export const pubchemMirrorDirectory=()=>null; export const opsinDirectory=()=>null`,
      './chemistryStock': `export const chemistryStockDirectory=()=>null`,
      './textbookSchemes': `export const textbookSchemeDirectory=()=>null; export const textbookCitations=()=>[]`,
    };
    api.onResolve({ filter: /^(\.\/aiClient|\.\/synthesisEvidence|\.\/pubchemMirror|\.\/chemistryStock|\.\/textbookSchemes|\.\.\/reactionIndex|\.\.\/capabilities\/(registry|runner))$/ }, args => (args.importer.includes(`${path.sep}electron${path.sep}`) ? { path: args.path, namespace: 'mock' } : undefined));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { resolveNamedRoute } = await import(pathToFileURL(outfile));

const ANSWER = [
  '**Step 1 — Oxidation of the alcohol**',
  '',
  'Reactants: ethanol; frobnicated ethyl widget',
  'Products: acetaldehyde',
].join('\n');

// Every name comes back unresolved, so the route asks the model for corrections.
const runner = { async invoke({ input }) {
  return { artifacts: [{ artifactType: 'species-resolution', data: { results: input.names.map(name => ({ name, status: 'unresolved', feedback: 'No exact match.' })) } }] };
} };

test('stopping the turn cancels the name-correction request', async () => {
  const controller = new AbortController();
  const t0 = Date.now();
  setTimeout(() => controller.abort(), 100);
  const warn = console.warn; console.warn = () => {};
  let outcome;
  try { outcome = await resolveNamedRoute(ANSWER, ANSWER, { runner, signal: controller.signal }); }
  finally { console.warn = warn; }
  const elapsed = Date.now() - t0;
  console.log(`returned ${elapsed} ms after the start, ${elapsed - 100} ms after the stop`);
  assert.ok(globalThis.__modelSignal, 'the correction request carries the turn signal');
  assert.ok(elapsed < 1000, `the route check kept waiting on the model after the stop (${elapsed} ms)`);
  assert.equal(outcome.legacy, true, 'a stopped route check reports nothing, as the other stopped paths do');
});
