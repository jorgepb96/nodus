import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-condition-agents-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { isConditionPhrase, findStepNamedSpecies } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

test('conditions under Agents are recognised as conditions', () => {
  assert.equal(typeof isConditionPhrase, 'function');
  for (const phrase of ['110 °C', '−78 °C', '0–25 °C', '12 h', '30 min', '1 h, 25 °C', '5 atm', '273 K', '254 nm', 'reflux', 'room temperature', 'rt', 'heat', 'Δ', 'hν', 'UV light', 'microwave irradiation', 'overnight']) {
    assert.equal(isConditionPhrase(phrase), true, phrase);
  }
});

test('substances are still resolved', () => {
  for (const name of ['toluene', 'sulfuric acid', 'palladium on carbon', '10% palladium on carbon', '2 M hydrochloric acid', 'potassium carbonate', '2 hydroxybenzoic acid', 'nitrogen', 'hexane', '1,4-dioxane', 'iron(III) bromide', 'light petroleum']) {
    assert.equal(isConditionPhrase(name), false, name);
  }
});

test('a typical route sends only its substances to the resolvers', () => {
  const answer = [1, 2, 3].map((n) => `## Step ${n} — Esterification\n\nHeat under reflux.\n\nReactants: acetic acid; ethanol\nProducts: ethyl acetate\nByproducts: water\nAgents: sulfuric acid; toluene; reflux; 110 °C; 12 h\n`).join('\n');
  const species = findStepNamedSpecies(answer, 3);
  const all = [...new Set(species.flat().map((entry) => entry.name))];
  const sent = [...new Set(species.flat().filter((entry) => !(entry.role === 'agent' && isConditionPhrase(entry.name))).map((entry) => entry.name))];
  assert.deepEqual(all.filter((name) => !sent.includes(name)), ['reflux', '110 °C', '12 h']);
});
