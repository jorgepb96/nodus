import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-label-none-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { findStepNamedSpecies } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

const route = (byproducts, agents = 'sulfuric acid') => `## Step 1 — Pinacol rearrangement\n\nThe diol rearranges under acid.\n\nReactants: 2,3-dimethylbutane-2,3-diol\nProducts: 3,3-dimethylbutan-2-one; water\nByproducts: ${byproducts}\nAgents: ${agents}\n`;
const names = (text) => findStepNamedSpecies(text, 1)[0].map((entry) => `${entry.byproduct ? 'byproduct' : entry.role}:${entry.name}`);

test('"none" followed by an explanation lists no byproduct', () => {
  for (const line of ['none; the rearrangement loses no atoms', 'None. The acid is a catalyst; it is regenerated', 'none, since the step is an isomerisation; the acid is regenerated', 'n/a; isomerisation', '—; nothing is released']) {
    assert.deepEqual(names(route(line)).filter((entry) => entry.startsWith('byproduct:')), [], line);
  }
});

test('"none" followed by an explanation lists no agent', () => {
  assert.deepEqual(names(route('water', 'none; the reaction is run neat at 120 °C')).filter((entry) => entry.startsWith('agent:')), []);
});

test('a list that does not open with "none" is read as before', () => {
  assert.deepEqual(names(route('water; carbon dioxide')).filter((entry) => entry.startsWith('byproduct:')), ['byproduct:water', 'byproduct:carbon dioxide']);
  assert.deepEqual(names(route('water; none')).filter((entry) => entry.startsWith('byproduct:')), ['byproduct:water']);
  assert.deepEqual(names(route('NO; nitrogen dioxide')).filter((entry) => entry.startsWith('byproduct:')), ['byproduct:nitrogen dioxide']);
  assert.deepEqual(names(route('none (an isomerisation; no atoms are lost)')).filter((entry) => entry.startsWith('byproduct:')), []);
});
