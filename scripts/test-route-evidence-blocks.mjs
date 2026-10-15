import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-evidence-blocks-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { collectStepEvidence, formatEvidenceSources, countRouteSteps, findStepProse } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

// An overview that names the steps on plain "Step N:" lines, then the route itself.
const answer = `**Route overview**

Step 1: oxidation of ethanol to ethanal.
Step 2: aldol addition.

## Step 1 — Oxidation of ethanol

Ethanol is oxidised with PCC [Clayden, p. 120](nodus://passage/p-clayden-120).

Reactants: ethanol; pyridinium chlorochromate
Products: ethanal
Byproducts: water
Agents: dichloromethane

## Step 2 — Aldol addition

Two ethanal condense [March, p. 1220](nodus://passage/p-march-1220).

Reactants: ethanal
Products: 3-hydroxybutanal
Byproducts: none
Agents: sodium hydroxide
`;

test('a step cited in its own section is credited with that citation', () => {
  const count = countRouteSteps(answer);
  assert.equal(count, 2);
  assert.match(findStepProse(answer, count)[0], /Clayden/, 'the premise: the prose reader already finds step 1 in its own section');
  const evidence = collectStepEvidence(answer, count, null, []);
  assert.deepEqual(evidence.steps.map((step) => step.library.map((entry) => entry.id)), [['p-clayden-120'], ['p-march-1220']]);
  assert.deepEqual(evidence.steps.map((step) => step.title), ['Oxidation of ethanol', 'Aldol addition']);
  assert.deepEqual(evidence.elsewhere.library, []);
  const table = formatEvidenceSources(evidence);
  assert.doesNotMatch(table, /model knowledge only/);
  assert.match(table, /the answer cites textbooks or library passages in 2/);
});
