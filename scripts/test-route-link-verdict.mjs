import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-link-verdict-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { normalizeRouteAudit, formatRouteAudit, formatNamedRouteFixPrompts } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

const R = 'C[C@@H](O)CC';
const S = 'C[C@H](O)CC';
const species = (canonicalSmiles, name, extra = {}) => ({ input: canonicalSmiles, canonicalSmiles, formula: 'C4H10O', name, ...extra });
const step = (index, reactants, products) => ({ index, reaction: 'x>>y', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants, agents: [], products });
const labels = [
  [{ role: 'reactant', byproduct: false, name: 'butan-2-one', smiles: 'CCC(C)=O' }, { role: 'product', byproduct: false, name: '(2R)-butan-2-ol', smiles: R }],
  [{ role: 'reactant', byproduct: false, name: '(2R)-butan-2-ol', smiles: R }, { role: 'product', byproduct: false, name: '(2R)-2-methoxybutane', smiles: 'CC[C@@H](C)OC' }],
  [{ role: 'reactant', byproduct: false, name: '(2S)-butan-2-ol', smiles: S }, { role: 'product', byproduct: false, name: 'target', smiles: 'CC[C@H](C)OC(C)=O' }],
];

// What chemistry-studio's route audit returns when step 3 consumes the other enantiomer of what an
// earlier step made: the link is refused as constitution-only and `continuous` is false, but the
// link is still an edge, so no step is isolated.
const audit = () => normalizeRouteAudit({
  continuous: false,
  blocked: ['Step 1 → 3: the intermediate has the same constitution but different stereochemistry or charge.'],
  isolated: [],
  steps: [
    step(0, [species('CCC(C)=O', 'butan-2-one')], [species(R, '(2R)-butan-2-ol')]),
    step(1, [species(R, '(2R)-butan-2-ol')], [species('CC[C@@H](C)OC', '(2R)-2-methoxybutane')]),
    step(2, [species(S, '(2S)-butan-2-ol')], [species('CC[C@H](C)OC(C)=O', 'target')]),
  ],
  links: [
    { from: 0, to: 1, ok: true, reason: 'carried', carried: [{ canonicalSmiles: R, formula: 'C4H10O', heavyAtoms: 5 }] },
    { from: 0, to: 2, ok: false, reason: 'constitution-only', carried: [], skeletonOnly: [{ product: R, reactant: S, skeletonSmiles: 'CCC(C)O' }] },
  ],
});

test('a refused intermediate link fails the route check header', () => {
  const report = formatRouteAudit(audit(), labels);
  assert.match(report, /Step 1 → 3 FAIL — same constitution/, 'the premise: the continuity line already says FAIL');
  assert.doesNotMatch(report, /Route checked: balanced and connected/);
  assert.match(report, /\*\*Route check failed\*\* — .*intermediate link\(s\) do not carry the same structure \(step 1 → 3\)/);
  assert.doesNotMatch(report, /\nBalanced and connected: every intermediate is carried over\./);
});

test('a refused intermediate link is offered back as a correction', () => {
  const chips = formatNamedRouteFixPrompts(labels, audit());
  assert.notEqual(chips, '', 'a route the checker refused gets a fix chip');
  assert.match(chips, /Step 1 → 3: step 3 consumes a different stereoisomer or charge state/);
});

test('a route whose links all hold is unchanged', () => {
  const ok = audit();
  ok.links = ok.links.slice(0, 1);
  ok.blocked = [];
  ok.continuous = true;
  assert.match(formatRouteAudit(ok, labels), /Route checked: balanced and connected/);
  assert.equal(formatNamedRouteFixPrompts(labels, ok), '');
});
