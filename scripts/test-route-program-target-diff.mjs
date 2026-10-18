// A program that ends at an ISOMER of the target must be told what differs, not handed two
// truncated SMILES.
//
// `formatRouteProgramReportFix` already learned half of this lesson: its own comment records that
// "no step forms the requested target" names the problem and not the gap, and that a model given
// only that re-sends the same program four times running. Saying what the program DID end at was
// the fix. This is the other half — when what it ended at has the SAME FORMULA as the target, the
// two descriptors are identical except inside the SMILES, and both are truncated at 120 characters
// with `…`, so for a long molecule the difference is literally cut out of the message.
//
// Measured, harness-runs/spps-08-ladder2-program-mode-thinking-none (2026-10-17), all four turns:
// every step balanced, and the route ended at C38H62N8O11 against a target of C38H62N8O11. The two
// differences — one inverted alpha-centre and two residues in the opposite order — both fell past
// the 117th character. The model spent three rounds guessing and its own prose blamed a
// tert-butyl ether that was not the problem.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-program-target-diff-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { formatRouteProgramReportFix } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

/** The measured pair, verbatim. Same formula; the route's product has the Ile alpha-centre
 *  inverted and Leu/Phe in the opposite order. */
const FORMED = 'CC[C@H](C)[C@@H](NC(=O)[C@@H](NC(=O)[C@H](CC(C)C)NC(=O)[C@H](Cc1ccccc1)NC(=O)[C@@H](NC(=O)[C@H](CO)NC(=O)[C@H](C)NC(=O)CN)C(C)C)[C@@H](C)O)C(=O)O';
const WANTED = 'CC[C@H](C)[C@H](NC(=O)[C@@H](NC(=O)[C@H](Cc1ccccc1)NC(=O)[C@H](CC(C)C)NC(=O)[C@@H](NC(=O)[C@H](CO)NC(=O)[C@H](C)NC(=O)CN)C(C)C)[C@@H](C)O)C(=O)O';
/** Same molecule as WANTED but with two centres flipped: a stereochemistry-only difference. */
const EPIMER = WANTED.replace('[C@H](CO)', '[C@@H](CO)').replace('[C@H](C)NC(=O)CN', '[C@@H](C)NC(=O)CN');

const audit = (formed, wanted, formula = 'C38H62N8O11') => ({
  ok: true,
  steps: [{
    index: 0, reaction: 'a>>b', ok: true, balanced: true, chargeBalanced: true, differences: [],
    unspecifiedStereocentres: 0, reactants: [], agents: [],
    products: [{ canonicalSmiles: formed, formula, coefficient: 1 }],
  }],
  links: [], blocked: [], review: [],
  target: { reason: 'not-formed', formula, canonicalSmiles: wanted },
});

test('a same-formula mismatch says so, instead of implying a missing step', () => {
  const prompt = formatRouteProgramReportFix(audit(FORMED, WANTED));
  assert.ok(prompt, 'a fix prompt is produced');
  // The old sentence offers "add the statements that carry it the rest of the way", which is the
  // wrong instruction when the atoms already match: nothing is missing, something is misplaced.
  assert.match(prompt, /same formula|same molecular formula/i,
    `the message says the formulas match: ${prompt.slice(0, 700)}`);
  assert.match(prompt, /no step is missing|not a missing step|structural|rearrang|wrong place|differs/i,
    `and that the difference is structural: ${prompt.slice(0, 700)}`);
});

test('neither structure is truncated when the difference is inside them', () => {
  const prompt = formatRouteProgramReportFix(audit(FORMED, WANTED));
  assert.ok(prompt.includes(FORMED), 'the formed structure is given whole');
  assert.ok(prompt.includes(WANTED), 'the target is given whole');
  assert.doesNotMatch(prompt, /…/, `nothing is cut out of the comparison: ${prompt.slice(0, 400)}`);
});

test('a stereochemistry-only difference is named, with how many centres', () => {
  // Provable by string alone: identical once every @/@@ is dropped. This is the one case the
  // message can diagnose exactly, and it is the commonest of the two measured faults.
  const prompt = formatRouteProgramReportFix(audit(EPIMER, WANTED));
  assert.match(prompt, /stereo/i, `the class is named: ${prompt.slice(0, 700)}`);
  assert.match(prompt, /\b2\b/, `and the count: ${prompt.slice(0, 700)}`);
  assert.doesNotMatch(prompt, /Add the statements that carry it the rest of the way/,
    'and it does not ask for more steps, which cannot fix a configuration');
});

test('a genuinely incomplete route keeps the original advice', () => {
  // What must NOT change: different formula means the route really does stop short, and "add the
  // statements that carry it the rest of the way" is the right instruction.
  const prompt = formatRouteProgramReportFix({
    ...audit('CCO', WANTED),
    steps: [{
      index: 0, reaction: 'a>>b', ok: true, balanced: true, chargeBalanced: true, differences: [],
      unspecifiedStereocentres: 0, reactants: [], agents: [],
      products: [{ canonicalSmiles: 'CCO', formula: 'C2H6O', coefficient: 1 }],
    }],
    target: { reason: 'not-formed', formula: 'C38H62N8O11', canonicalSmiles: WANTED },
  });
  assert.match(prompt, /Add the statements that carry it the rest of the way/,
    `the original advice is kept: ${prompt.slice(0, 600)}`);
  assert.doesNotMatch(prompt, /same formula/i, 'and no same-formula claim is made');
});
