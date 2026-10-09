import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-label-fullwidth-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { findStepNamedSpecies, annotateSpeciesSmiles } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

// An answer written in Chinese keeps the English labels the contract asks for, but punctuates with
// full-width marks: the colon is already accepted, the semicolon was not.
const answer = '## Step 1 — 酯化\n\n乙酸与乙醇在酸催化下酯化。\n\nReactants： acetic acid；ethanol\nProducts： ethyl acetate\nByproducts： water\nAgents： sulfuric acid；toluene\n';

test('a full-width semicolon separates species', () => {
  const species = findStepNamedSpecies(answer, 1)[0].map((entry) => `${entry.role}:${entry.name}`);
  assert.deepEqual(species, ['reactant:acetic acid', 'reactant:ethanol', 'product:ethyl acetate', 'product:water', 'agent:sulfuric acid', 'agent:toluene']);
});

test('each species is annotated in place', () => {
  const species = findStepNamedSpecies(answer, 1);
  const resolved = species.map((step) => step.map((entry, index) => ({ ...entry, status: 'resolved', smiles: `C${index}` })));
  const out = annotateSpeciesSmiles(answer, resolved);
  assert.match(out, /Reactants： acetic acid — `C0`；ethanol — `C1`\n/);
});
