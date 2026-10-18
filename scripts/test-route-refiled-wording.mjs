// SPPS-FIXES-2026-10-17 fix 9.
//
// Measured on harness-runs/spps-06-ladder1-names-first-thinking-none, step 12, turns 1 to 3
// unchanged. The step read:
//
//   Step 12 FAIL — balanced only after the checker refiled a declared reactant. "trifluoroacetic
//   acid" was listed under Reactants, and the step balances only if it takes no part, so the check
//   treated it as a condition. Make one edit to this step: move "trifluoroacetic acid" to Agents,
//   or name under Products the product it becomes.
//
// Two things were wrong with that, and neither was missing information — the route review DID reach
// the model, in the correction preamble, saying step 12 folded a TFA cleavage into the piperidine
// Fmoc deprotection:
//
//   1. "balanced only after the checker refiled" describes a repair that has been made. The step is
//      failing. A reader cannot act on a sentence that says both.
//   2. "Make one edit to this step" is false where the step is doing two transformations at once,
//      which is what the review had found. One edit cannot fix it, so the instruction and the
//      situation do not meet.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-refiled-wording-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { formatRouteAudit, routeStepFailure } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

/** The measured step, verbatim in the part this file is about. */
const REFILED = '"trifluoroacetic acid" was listed under Reactants, and the step balances only if it takes no part, so the check treated it as a condition.';
const step = () => ({
  index: 11, reaction: 'a.b>>c.d', ok: true, balanced: true, chargeBalanced: true,
  differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [],
  refiledReactant: REFILED,
});

test('the step is not described as having been repaired', () => {
  const report = formatRouteAudit({ ok: true, steps: [step()], links: [], blocked: [], review: [] });
  const line = report.split('\n').find((entry) => entry.startsWith('- Step 12'));
  assert.ok(line, `the step is printed: ${report}`);
  assert.match(line, /FAIL/, `it fails: ${line}`);
  // The contradiction: a line that says the checker already refiled it, under a FAIL verdict.
  assert.doesNotMatch(line, /balanced only after/,
    `the verdict must not claim a repair it did not make: ${line}`);
  // What it should say instead — the condition, which is both true and actionable.
  assert.match(line, /balances only if a declared reactant takes no part/,
    `the verdict states the condition: ${line}`);
});

test('the failure reason given to the fix chips matches the printed verdict', () => {
  // These two are rendered from the same field by different code paths. When they disagree the
  // model is told two different things about one step.
  const failure = routeStepFailure(step());
  assert.ok(failure, 'the step still fails');
  assert.doesNotMatch(failure, /balanced only after/, `the chip reason agrees with the line: ${failure}`);
  assert.match(failure, /takes no part/, failure);
});

test('a step with no refiled reactant is unaffected', () => {
  const clean = { ...step(), refiledReactant: undefined };
  assert.equal(routeStepFailure(clean), null);
  const report = formatRouteAudit({ ok: true, steps: [clean], links: [], blocked: [], review: [] });
  const line = report.split('\n').find((entry) => entry.startsWith('- Step 12'));
  assert.match(line, /OK — balanced/, `an ordinary balanced step is unchanged: ${line}`);
});
