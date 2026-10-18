// A reagent the step CONSUMES is a reactant, and the compatibility check never saw it.
//
// The functional-group check reads each step's reagent classes from text: the step's `Conditions:`
// line plus the names of its agents. Everything else about the step is structural. That is enough
// when the conditions line spells the reagent out, and it misses it entirely when the reagent is a
// REACTANT instead — which is where a consumed reagent belongs, and where the route rules tell the
// model to put it ("Account for every species that is consumed: if a coupling reagent is used up,
// list it as a reactant and name what it becomes").
//
// Measured 2026-10-17 on a real seven-residue solid-phase peptide route. The route wrote
// no `Conditions:` line at all, so every step's reagent text was just its agent names:
//
//   step  4  "The resin is treated with 20% piperidine..."  piperidine filed as a REACTANT
//            agents: N,N-dimethylformamide          -> classify() == []        -> no hazards
//   step  9  "DIC/HOBt coupling of Fmoc-L-Arg(Pbf)-OH"      DIC filed as a REACTANT
//            agents: HOBt, DMF                      -> classify() == []        -> no hazards
//
// Both steps are hazards the package can see perfectly well once it knows what the reagent is: the
// first is a diketopiperazine that would take the peptide off the resin, the second an arginine
// that can close its own lactam. The classifier was simply never told. The same silence covers the
// Asn/Gln dehydration flag, which has shipped for weeks.
//
// So the text now carries the step's REACTANT names too. The structures were always sent; this is
// the one place the step's own words were being dropped.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'compat-reagent-text-'));
await build({ entryPoints: ['shared/stepCompatibility.ts'], outfile: path.join(dir, 'compat.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { compatibilityReagentText } = await import(pathToFileURL(path.join(dir, 'compat.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

/** A step's labels as the route report resolves them. */
const label = (role, name, extra = {}) => ({ role, name, byproduct: false, smiles: 'C', ...extra });

test('a consumed coupling agent reaches the text, from the reactants', () => {
  // The measured route's step 9, verbatim.
  const text = compatibilityReagentText('', [
    label('reactant', 'the resin-bound L-cysteinyl(Trt)-L-seryl(tBu)-glycyl-L-alaninate'),
    label('reactant', 'Fmoc-Nω-(2,2,4,6,7-pentamethyl-2,3-dihydro-1-benzofuran-5-sulfonyl)-L-arginine'),
    label('reactant', "N,N'-diisopropylcarbodiimide"),
    label('agent', '1-hydroxybenzotriazole'),
    label('agent', 'N,N-dimethylformamide'),
  ]);
  assert.match(text, /diisopropylcarbodiimide/, `the consumed reagent is named: ${text}`);
  assert.match(text, /hydroxybenzotriazole/, 'the agents are still there');
});

test('a consumed base reaches the text too', () => {
  // step 4: piperidine is a reactant because it traps the dibenzofulvene.
  const text = compatibilityReagentText('', [
    label('reactant', 'the resin-bound Fmoc-glycyl-L-alaninate'),
    label('reactant', 'piperidine'),
    label('agent', 'N,N-dimethylformamide'),
  ]);
  assert.match(text, /piperidine/, `the base is named: ${text}`);
});

test('the conditions line still leads, and is not displaced', () => {
  const text = compatibilityReagentText('TFA/H2O 95:5, 2 h', [
    label('reactant', 'the protected peptide'),
    label('agent', 'dichloromethane'),
  ]);
  assert.ok(text.startsWith('TFA/H2O 95:5, 2 h'), `conditions first: ${text}`);
  assert.match(text, /dichloromethane/);
});

test('byproducts are left out: they are what the step made, not what it was run with', () => {
  const text = compatibilityReagentText('', [
    label('reactant', 'the resin-bound peptide'),
    label('reactant', 'water'),
    label('product', 'the free peptide'),
    label('reactant', 'triphenylmethanol', { byproduct: true }),
  ]);
  assert.doesNotMatch(text, /triphenylmethanol/, `a byproduct is not a reagent: ${text}`);
  assert.doesNotMatch(text, /the free peptide/, `a product is not a reagent: ${text}`);
  assert.match(text, /water/);
});

test('an unnamed species contributes nothing, and no empty separators appear', () => {
  const text = compatibilityReagentText(undefined, [
    { role: 'reactant', smiles: 'CCO', byproduct: false },
    label('reactant', 'piperidine'),
    { role: 'agent', name: '', byproduct: false, smiles: 'C' },
  ]);
  assert.equal(text, 'piperidine', `no stray separators: ${JSON.stringify(text)}`);
});

test('the text stays bounded, however many species a step names', () => {
  const many = Array.from({ length: 400 }, (_, index) => label('reactant', `reagent-number-${index}`));
  const text = compatibilityReagentText('conditions', many);
  assert.ok(text.length <= 2000, `bounded: ${text.length}`);
});

test('nothing is invented when the step names no reagent at all', () => {
  assert.equal(compatibilityReagentText('', [label('product', 'the product')]), '');
});
