import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-label-notes-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { findStepNamedSpecies } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

const names = (reactants, agents = 'none', products = 'ethanol') => findStepNamedSpecies(`## Step 1 — Reduction\n\nThe aldehyde is reduced.\n\nReactants: ${reactants}\nProducts: ${products}\nByproducts: none\nAgents: ${agents}\n`, 1)[0].map((entry) => entry.name);

test('a note after a name is not part of the name', () => {
  assert.deepEqual(names('ethanal; sodium borohydride (1.2 equiv)', 'methanol (solvent); sulfuric acid (cat.)', 'ethanol (distilled off as it forms)'), ['ethanal', 'sodium borohydride', 'ethanol', 'methanol', 'sulfuric acid']);
  assert.deepEqual(names('acetic acid (glacial) (excess); ethane-1,2-diol (ethylene glycol)'), ['acetic acid', 'ethane-1,2-diol', 'ethanol']);
  assert.deepEqual(names('the photodimer (crude) — `C1=CC2(C=C1)OCCO2`'), ['the photodimer', 'ethanol']);
});

test('parentheses that belong to the name stay', () => {
  assert.deepEqual(
    names('iron(III) chloride; (2R)-butan-2-ol; sodium (2R)-2-hydroxypropanoate; copper (II); tetrakis(triphenylphosphine)palladium (0); 2-(trimethylsilyl)ethanol; but-2-ene (E)'),
    ['iron(III) chloride', '(2R)-butan-2-ol', 'sodium (2R)-2-hydroxypropanoate', 'copper (II)', 'tetrakis(triphenylphosphine)palladium (0)', '2-(trimethylsilyl)ethanol', 'but-2-ene (E)', 'ethanol'],
  );
  assert.deepEqual(names('ε-caprolactam (azepan-2-one'), ['ε-caprolactam (azepan-2-one', 'ethanol']);
});
