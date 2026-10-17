// SPPS-FIXES-2026-10-17 fix 5, the rule half.
//
// The largest fault of the two-ladder run. A coupling reagent given as its salt (HBTU,
// `C11H16F6N5OP`) was declared under Reactants with its two organic fragments as byproducts — which
// is the right chemistry — and came out at coefficient 0 because the hexafluorophosphate is
// accounted for nowhere. The checker's advice was "Delete the molecule … water and a solvent are
// the usual ones", which is false of a reagent the step consumes, so the model rightly declined and
// the turn repeated byte-identically for three rounds. Seen at
// harness-runs/spps-08-ladder1-names-first-thinking-none (turns 2 and 3, nine steps each) and
// spps-10-ladder1-names-first-thinking-none (piperidine, turns 1-3).
//
// The checker now says what is actually wrong (chemistryReaction.ts, the idle-reactant branch).
// This is the half that gets there first: the rules already fail a reactant that takes no part, and
// they now say what the usual cause is.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-rules-counterion-'));
await build({ entryPoints: ['shared/routeRules.ts'], outfile: path.join(dir, 'rules.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { routeSpeciesRules } = await import(pathToFileURL(path.join(dir, 'rules.mjs')));
const { routeStepFailure } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

test('the rules say a reagent given as a salt has to account for its counter-ion', () => {
  const coefficients = routeSpeciesRules().find((rule) => rule.includes('You never choose coefficients'));
  assert.ok(coefficients, 'the balancing rule is still present');
  assert.match(coefficients, /counter-ion/, 'the counter-ion is named as the thing to account for');
  // Both ways out, because either can be the right one: name where it goes, or declare the ion.
  assert.match(coefficients, /name the species it leaves in|the ion that reacts/,
    'the rule gives a repair, not only a prohibition');
  // And the consequence, since this is what the model did not know: a partly-accounted reagent
  // fails in exactly the same way as an unused one, which is why the verdict looked wrong to it.
  assert.match(coefficients, /partly accounted|comes out at zero/,
    'the rule connects a half-accounted reagent to the zero-coefficient verdict');
});

test('the rules and the verdict still agree that such a step fails', () => {
  // The companion to test-route-rules-refiled.mjs: the prompt must not imply the checker tolerates
  // this. A reactant at coefficient 0 is a failing step, and the rules have to say so.
  const idle = {
    index: 0, reaction: 'a.b>>c', ok: true, balanced: false, chargeBalanced: true,
    differences: ['The declared species cannot be balanced: "C11H16F6N5OP" is declared under Reactants but the equation balances only with it at zero.'],
    unspecifiedStereocentres: 0, reactants: [], agents: [], products: [],
  };
  assert.ok(routeStepFailure(idle), 'a step whose declared reactant takes no part is a failing step');
  assert.match(routeSpeciesRules().join('\n'), /takes no part fails the step/,
    'the rules say what the verdict does');
});
