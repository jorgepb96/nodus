// The species rules are sent with the first request and every correction. They used to promise
// that a reagent listed under Reactants and taking no part "is treated as an Agent by the checker,
// so it never needs removing" — while routeStepFailure fails exactly that step (`refiledReactant`)
// and the correction asks the model to move it. The prompt and the verdict must agree.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-rules-refiled-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
await build({ entryPoints: ['shared/routeRules.ts'], outfile: path.join(dir, 'rules.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { routeStepFailure } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
const { routeSpeciesRules } = await import(pathToFileURL(path.join(dir, 'rules.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

test('the rules do not promise that a reactant taking no part is harmless, because that step fails', () => {
  const refiled = { index: 0, reaction: 'a.b>>c', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [],
    refiledReactant: '"sulfuric acid" was listed under Reactants, and the step balances only if it takes no part, so the check treated it as a condition.' };
  assert.ok(routeStepFailure(refiled), 'the checker fails a balanced step whose declared reactant took no part');
  const rules = routeSpeciesRules().join('\n');
  assert.doesNotMatch(rules, /never needs removing/);
  assert.doesNotMatch(rules, /treated as an Agent by the checker/);
  assert.match(rules, /takes no part fails the step/, 'the rules say what the verdict does');
});
