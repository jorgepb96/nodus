// SPPS-FIXES-2026-10-17 fix 1, the rule half.
//
// The support rule shows `*Cl` and `*O` as its examples but never said that the hydrogen cannot be
// written. Measured on harness-runs/spps-02-ladder1-names-first-thinking-high, turn 0: the free
// support was written `*OH` at steps 1 and 5 — "resin–OH" read straight off the page — and the two
// rejections were the whole of that turn's failure. The checker now names the fault
// (chemistryValidationCore.characterFault); this is the other half, so the model is told before it
// writes rather than after.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-rules-support-'));
await build({ entryPoints: ['shared/routeRules.ts'], outfile: path.join(dir, 'rules.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const rulesModule = await import(pathToFileURL(path.join(dir, 'rules.mjs')));
const { routeSpeciesRules } = rulesModule;
test.after(() => rm(dir, { recursive: true, force: true }));

/** Every backticked SMILES in a rule string. The rules write structures in single backticks, and
 *  the structure fallback writes them in doubled ones, so both are read. */
function backtickedStructures(text) {
  return [...text.matchAll(/`+([^`]+)`+/g)].map((match) => match[1].trim());
}

/** A bare `H` outside a bracket atom, which is what the checker refuses. Deliberately the same
 *  predicate the plugin applies, so a rule can never show a form the checker would reject. */
function hasBareHydrogen(smiles) {
  for (let at = 0; at < smiles.length; at += 1) {
    if (smiles[at] === '[') { const close = smiles.indexOf(']', at); if (close < 0) break; at = close; continue; }
    if (smiles[at] === 'H') return true;
  }
  return false;
}

test('the support rule forbids writing the hydrogen, and names the form that works', () => {
  const support = routeSpeciesRules().find((rule) => rule.includes('attached to a solid support'));
  assert.ok(support, 'the species rules still carry a solid-support rule');
  // The prohibition itself. Not a wording assertion: the rule has to say both that the H is not
  // written and what to write instead, because `*OH` is what a chemist reaches for unprompted.
  assert.match(support, /\bH\b/, 'the rule mentions the hydrogen at all');
  assert.match(support, /outside brackets|not written/, 'the rule says the hydrogen is not written');
  assert.ok(support.includes('*O'), 'the rule shows the form that parses');
});

test('no rule shows a structure the checker would refuse for a bare hydrogen', () => {
  // Load-bearing: this is the guard that keeps the prompt and the checker from drifting apart. A
  // rule that illustrates `*OH` would teach the exact string the checker rejects.
  for (const rule of routeSpeciesRules()) {
    for (const smiles of backtickedStructures(rule)) {
      // Only the structures, not prose in backticks (`Fmoc-Cys(Trt)-OH`, role names, env vars).
      if (!/^[*A-Za-z0-9@+\-[\]()=#$%./\\]+$/.test(smiles)) continue;
      if (!/^[*[]|^[A-Z]/.test(smiles)) continue;
      if (!/[*=#()[\]0-9]/.test(smiles)) continue;
      assert.ok(!hasBareHydrogen(smiles), `a rule shows \`${smiles}\`, which the checker refuses for a bare H`);
    }
  }
});
