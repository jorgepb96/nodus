import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-label-scaling-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { countRouteSteps, findStepNamedSpecies, findStepProse } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

const step = (n) => `## Step ${n} — Oxidation\n\nThe alcohol is oxidised.\n\nReactants: ethanol; oxygen\nProducts: ethanal\nByproducts: water\nAgents: none\n\n`;
const timed = (fn) => { const start = performance.now(); const value = fn(); return { value, ms: performance.now() - start }; };

// A route answer carries its drawings inline as nodus-view fences (the final report, the target
// drawing, or a picture the model drew itself). The parser blanks each one to spaces before it
// looks for labels, so a long picture is a long run of blanks. Scanning one must stay linear.
test('a 100 KB drawing does not make the label scan quadratic', () => {
  const answer = `${step(1)}\`\`\`nodus-view\n{"view":"<svg>${'x'.repeat(100_000)}</svg>"}\n\`\`\`\n\n${step(2)}`;
  const count = timed(() => countRouteSteps(answer));
  const species = timed(() => findStepNamedSpecies(answer, 2));
  assert.equal(count.value, 2);
  assert.deepEqual(species.value.map((entries) => entries.map((entry) => entry.name)), [['ethanol', 'oxygen', 'ethanal', 'water'], ['ethanol', 'oxygen', 'ethanal', 'water']]);
  assert.ok(count.ms < 1000, `countRouteSteps took ${count.ms.toFixed(0)} ms`);
  assert.ok(species.ms < 1000, `findStepNamedSpecies took ${species.ms.toFixed(0)} ms`);
});

test('a long run of blanks in prose stays linear too', () => {
  const answer = `${step(1)}${' '.repeat(100_000)}x\n\n${step(2)}`;
  const count = timed(() => countRouteSteps(answer));
  assert.equal(count.value, 2);
  assert.ok(count.ms < 1000, `countRouteSteps took ${count.ms.toFixed(0)} ms`);
  const prose = timed(() => findStepProse(`## Step 1 — Oxidation\n\nThe alcohol${' '.repeat(100_000)}is oxidised.\n\nReactants: ethanol\nProducts: ethanal\n`, 1));
  assert.match(prose.value[0], /^Step 1 — Oxidation — The alcohol is oxidised\.$/);
  assert.ok(prose.ms < 1000, `findStepProse took ${prose.ms.toFixed(0)} ms`);
});

test('markup and spacing around a label still parse as before', () => {
  const answer = '## Step 1\n\n**Reactants:** ethanol;  oxygen\n  ` Products:` ethanal\n**Byproducts:** water\n- Agents:   none\n';
  assert.deepEqual(findStepNamedSpecies(answer, 1)[0].map((entry) => `${entry.role}${entry.byproduct ? '*' : ''}:${entry.name}`), ['reactant:ethanol', 'reactant:oxygen', 'product:ethanal', 'product*:water']);
});
