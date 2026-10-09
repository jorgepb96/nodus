// The species rules named the pinacol rearrangement as one that "gains and loses no atoms" and
// told the model to write it as substrate → product with nothing else. It loses water:
// 2,3-dimethylbutane-2,3-diol (C6H14O2) gives 3,3-dimethylbutan-2-one (C6H12O) + H2O. A model
// that follows the rule writes a step the balance check must refuse, and the rule tells it not to
// add the species the checker then asks for.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-rules-pinacol-'));
await build({ entryPoints: ['shared/routeRules.ts'], outfile: path.join(dir, 'rules.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { routeSpeciesRules } = await import(pathToFileURL(path.join(dir, 'rules.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

/** Element counts of a formula such as C6H14O2. */
const counts = (formula) => Object.fromEntries([...formula.matchAll(/([A-Z][a-z]?)(\d*)/g)].map(([, el, n]) => [el, Number(n || 1)]));

test('the pinacol rearrangement is not listed as one that gains and loses no atoms', () => {
  const diol = counts('C6H14O2'); const ketone = counts('C6H12O');
  assert.notDeepEqual(diol, ketone, 'pinacol and pinacolone differ by H2O');
  const neutral = routeSpeciesRules().find((rule) => /gains and loses no atoms/.test(rule));
  assert.ok(neutral, 'the atom-neutral rearrangement rule exists');
  const listed = /gains and loses no atoms \(([^)]*)\)/.exec(neutral)[1];
  assert.doesNotMatch(listed, /pinacol/i);
  assert.match(neutral, /pinacol rearrangement is not one of these: it releases water/);
});
