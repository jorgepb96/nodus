// SPPS-FIXES-2026-10-17 fix 8, the nodus half.
//
// An inverted stereocentre used to arrive with `balanced: false` and the complaint written into
// `differences`, because the plugin had no channel for it. The renderer then printed
// `FAIL — NOT balanced (This step inverts a stereocentre: ...)` about an equation that is closed on
// every element. Measured on harness-runs/spps-06-ladder1-names-first-thinking-none, turns 1 to 3
// unchanged: `C24H21NO4 + OH-(support) -> C24H20NO4-(support) + H2O` balances, and the one wrong
// `@`/`@@` in the product was never looked at because the verdict sent the model to count atoms.
//
// The plugin now carries it as `stereoProblem` (chemistryRouteAudit.ts). This side has to read that
// field, fail the step on it, and say what it actually is.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-stereo-channel-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { routeStepFailure, normalizeRouteAudit } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

const INVERSION = 'This step inverts a stereocentre: atom 3 of (2S)-2-{[(9H-fluoren-9-ylmethoxy)carbonyl]amino}-3-phenylpropanoic acid (S) comes out as atom 4 of the resin-bound ester (R) with the opposite configuration.';

/** The measured step: balanced on every element, one centre inverted. */
const step = () => ({
  index: 0, reaction: 'a.b>>c.d', ok: true, balanced: true, chargeBalanced: true,
  differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [],
  stereoProblem: INVERSION,
});

test('a step whose only fault is an inverted centre still fails', () => {
  // The whole point of the old `balanced: false` was that something had to fail the step. Moving
  // the complaint must not quietly let it pass.
  const failure = routeStepFailure(step());
  assert.ok(failure, 'the step fails');
  assert.match(failure, /inverts a stereocentre/, `and fails for the right reason: ${failure}`);
});

test('the failure does not describe a balanced equation as not balanced', () => {
  const failure = routeStepFailure(step());
  assert.doesNotMatch(failure, /not balanced/,
    `an equation closed on every element must not be called unbalanced: ${failure}`);
});

test('the audit normaliser carries stereoProblem through from the plugin', () => {
  // The field crosses the process boundary through normalizeRouteAudit, which drops anything it
  // does not know about — so a field the plugin sets and this side never reads is silently lost.
  const audit = normalizeRouteAudit({
    ok: true, steps: [{ ...step(), reaction: 'a.b>>c.d' }], links: [], blocked: [], review: [],
  });
  assert.equal(audit.steps.length, 1, JSON.stringify(audit));
  assert.match(audit.steps[0].stereoProblem ?? '', /inverts a stereocentre/,
    `the field survives normalisation: ${JSON.stringify(audit.steps[0])}`);
});

test('a step with no stereo problem is unaffected', () => {
  const clean = { ...step(), stereoProblem: undefined };
  assert.equal(routeStepFailure(clean), null, 'a balanced, clean step still passes');
});

test('a genuine balance failure still reads as one', () => {
  const unbalanced = { ...step(), stereoProblem: undefined, balanced: false, differences: ['O: reactants 5, products 4'] };
  const failure = routeStepFailure(unbalanced);
  assert.match(failure, /not balanced/, `the balance channel is untouched: ${failure}`);
});

test('the printed step says the equation balances and the configuration does not', async () => {
  // The line the model actually reads. `NOT balanced` was the whole problem: it is a true-sounding
  // statement about atoms that are correct, and it is what sent three correction rounds to the
  // wrong place.
  const { formatRouteAudit } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
  const report = formatRouteAudit({
    ok: true, steps: [step()], links: [], blocked: [`Step 1: ${INVERSION}`], review: [],
  });
  const line = report.split('\n').find((entry) => entry.startsWith('- Step 1'));
  assert.ok(line, `the step is printed: ${report}`);
  assert.match(line, /FAIL/, `it still fails: ${line}`);
  assert.doesNotMatch(line, /NOT balanced/, `it is not called unbalanced: ${line}`);
  assert.match(line, /balanced, but a stereocentre is inverted/, `it says what it is: ${line}`);
  assert.match(line, /inverts a stereocentre/, `and the detail is there to act on: ${line}`);
});
