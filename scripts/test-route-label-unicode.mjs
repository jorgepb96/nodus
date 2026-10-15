import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-label-unicode-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { findStepNamedSpecies } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

const names = (reactants, products, byproducts = 'water') => findStepNamedSpecies(`## Step 1 — Coupling\n\nThe acid is coupled.\n\nReactants: ${reactants}\nProducts: ${products}\nByproducts: ${byproducts}\nAgents: dichloromethane\n`, 1)[0].map((entry) => entry.name);

test('typographic hyphens and primes in a name are read as ASCII', () => {
  assert.deepEqual(
    names('4‑nitrophenol; N,N′-dicyclohexylcarbodiimide; 2−methylpropan−2−ol', '2′-deoxyadenosine; N,N’-dimethylurea', 'N,N′-dicyclohexylurea; 1‐bromopropane'),
    ['4-nitrophenol', "N,N'-dicyclohexylcarbodiimide", '2-methylpropan-2-ol', "2'-deoxyadenosine", "N,N'-dimethylurea", "N,N'-dicyclohexylurea", '1-bromopropane', 'dichloromethane'],
  );
});

test('a double prime and the structure fallback are kept intact', () => {
  assert.deepEqual(names("N,N,N′,N″-tetramethyl-x; the photodimer — `C1=CC2(C=C1)OCCO2`", 'ethanol'), ["N,N,N',N''-tetramethyl-x", 'the photodimer', 'ethanol', 'water', 'dichloromethane']);
  const declared = findStepNamedSpecies('## Step 1\n\nReactants: the photodimer – `C1=CC2(C=C1)OCCO2`\nProducts: ethanol\n', 1)[0][0];
  assert.equal(declared.declaredSmiles, 'C1=CC2(C=C1)OCCO2');
});
