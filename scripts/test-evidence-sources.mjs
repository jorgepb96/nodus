import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'evidence-sources-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { collectStepEvidence, formatEvidenceSources, routeReportsForHistory } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

const ANSWER = `## Synthesis of benzocaine

### Step 1 — Oxidation of 4-nitrotoluene
Potassium permanganate oxidises the methyl group [Organic Chemistry 7e Ed, p. 882](nodus://passage/2ad84c69-0adf-4c87-926e-46a4d235112b%231205).

- **Reactants:** 4-nitrotoluene, potassium permanganate
- **Products:** 4-nitrobenzoic acid

### Step 2 — Fischer esterification
Ethanol and sulfuric acid, as in [Klein, 2012](nodus://passage/scoped%3Aaa%3Abb) and [Organic Syntheses](https://www.orgsyn.org/demo.aspx?prep=cv1p0240).

- **Reactants:** 4-nitrobenzoic acid, ethanol

### Step 3 — Reduction of the nitro group
Tin and hydrochloric acid reduce the nitro group.

- **Reactants:** ethyl 4-nitrobenzoate, tin

### Summary
Overall this follows [McMurry, 2012](nodus://passage/2ad84c69-0adf-4c87-926e-46a4d235112b%231146).
`;

const PRECEDENT = {
  reactions: [
    { input: 'r1', count: 4, key: 'k1' },
    { input: 'r2', count: 0, key: 'k2' },
    { input: 'r3', count: 0, key: 'k3' },
  ],
  products: [],
  similar: [
    { input: 'r2', neighbors: [{ key: 'a', distance: 1, count: 1, similarity: 0.52 }, { key: 'b', distance: 1, count: 1, similarity: 0.81 }] },
    { input: 'r3', neighbors: [{ key: 'c', distance: 1, count: 1, similarity: 0.4 }] },
  ],
};
const QUERIES = [{ step: 0, query: 'r1' }, { step: 1, query: 'r2' }, { step: 2, query: 'r3' }];

test('each step gets its own ORD result and the citations in its own section', () => {
  const { steps, elsewhere } = collectStepEvidence(ANSWER, 3, PRECEDENT, QUERIES);
  assert.deepEqual(steps.map((step) => step.ord), [{ kind: 'exact', count: 4 }, { kind: 'similar', similarity: 0.81 }, { kind: 'similar', similarity: 0.4 }]);
  assert.deepEqual(steps[0].library.map((entry) => entry.id), ['2ad84c69-0adf-4c87-926e-46a4d235112b#1205']);
  assert.deepEqual(steps[1].library.map((entry) => entry.id), ['scoped:aa:bb']);
  assert.deepEqual(steps[1].web.map((entry) => entry.host), ['orgsyn.org']);
  assert.equal(steps[2].library.length + steps[2].web.length, 0);
  assert.deepEqual(elsewhere.library.map((entry) => entry.label), ['McMurry, 2012']);
});

test('the table names the four sources, resolves library titles and counts model-only steps', () => {
  const text = formatEvidenceSources(collectStepEvidence(ANSWER, 3, PRECEDENT, QUERIES),
    (id) => (id.endsWith('#1205') ? 'Organic Chemistry 7e Ed, p. 882' : null));
  assert.match(text, /### Where the evidence came from/);
  assert.match(text, /\| 1 — Oxidation of 4-nitrotoluene \| recorded \(4×\) \| Organic Chemistry 7e Ed, p\. 882 \| — \|/);
  assert.match(text, /\| 2 — Fischer esterification \| 81% similar \(same transformation\) \| Klein, 2012 \| orgsyn\.org \|/);
  assert.match(text, /\| 3 — Reduction of the nitro group \| 40% similar \(weak\) \| — \| — · _model knowledge only_ \|/);
  assert.match(text, /\*\*3 step\(s\):\*\* the Open Reaction Database snapshot records 2 \(or the same transformation\), the answer cites textbooks or library passages in 2 and the web in 1; 1 cites nothing of its own and rests on the model's own knowledge\./);
  assert.match(text, /Cited outside the steps: McMurry, 2012\./);
});

test('without the ORD index every step still gets a row', () => {
  const text = formatEvidenceSources(collectStepEvidence(ANSWER, 3, null, []));
  assert.match(text, /\| 3 — Reduction of the nitro group \| — \| — \| — · _model knowledge only_ \|/);
  assert.match(text, /snapshot records 0 \(or the same transformation\)/);
});

test('bold lead-in steps, the check\'s own passage, and a closing section kept out of the last step', () => {
  const answer = `# Route\n\n**Step 1 — First alkylation.** Deprotonate and alkylate.\n\nReactants: diethyl malonate\n\n**Step 2 — Decarboxylation.** Heat it ([Klein, 2012](nodus://passage/scoped%3Ax)).\n\nReactants: the acid\n\n**Target structure**\n\nAs in [McMurry, 2012](nodus://passage/w%2312).\n`;
  const support = new Map([[0, { passage: { title: 'Klein Organic Chemistry', location: 'p. 924', citation: '', excerpt: '', about: 'alkylation' } }]]);
  const evidence = collectStepEvidence(answer, 2, null, [], support);
  assert.deepEqual(evidence.steps.map((step) => step.title), ['First alkylation', 'Decarboxylation']);
  assert.deepEqual(evidence.steps[1].library.map((entry) => entry.label), ['Klein, 2012']);
  assert.deepEqual(evidence.elsewhere.library.map((entry) => entry.label), ['McMurry, 2012']);
  const text = formatEvidenceSources(evidence);
  // A passage the CHECK found is support, so the row no longer carries it and "model knowledge
  // only" at the same time — which had the block contradicting its own header, since the header
  // lists "Found by the check" among the things that stop a step resting on the model.
  assert.match(text, /\| 1 — First alkylation \| — \| Klein Organic Chemistry, p\. 924 \(found by the check\) \| — \|/);
  assert.ok(!/First alkylation[^\n]*model knowledge only/.test(text), 'a step with a found passage is not model-only');
  assert.match(text, /the check found a textbook passage for 1; 0 cite nothing of their own and rest on/);
});

test('an idea citation counts as library support, not as model knowledge', () => {
  // The third citation the application emits - `[Author, Year](nodus://idea/<id>)`, the form the
  // prompt packs ask for. Only passages and web pages were recognised, so a step whose only
  // support was an idea from the author's own graph was counted as resting on the model.
  const answer = [
    '### Step 1 - Oxidation',
    'The ring is oxidised ([Baddeley, 1992](nodus://idea/abc-123)).',
    'Reactants: toluene',
    'Products: benzoic acid',
    '',
    '### Step 2 - Esterification',
    'No citation here at all.',
    'Reactants: benzoic acid',
    'Products: methyl benzoate',
  ].join('\n');
  const evidence = collectStepEvidence(answer, 2, null, []);
  assert.deepEqual(evidence.steps[0].library, [{ id: 'abc-123', label: 'Baddeley, 1992' }]);
  assert.deepEqual(evidence.steps[1].library, [], 'the step that cites nothing is still counted as such');

  const table = formatEvidenceSources(evidence);
  // No passage lookup resolves an idea id, so the row falls back to the label the answer wrote.
  assert.match(table, /Baddeley, 1992/);
  assert.match(table, /library passages in 1 and the web in 0/);
  assert.match(table, /1 cites nothing of its own/);
  assert.ok(!/Oxidation[^\n]*model knowledge only/.test(table), 'the cited step is no longer model-only');
});

test('no steps, no table', () => {
  assert.equal(formatEvidenceSources(collectStepEvidence('Just prose.', 0, null, [])), '');
});

test('the table is not replayed to the model in later turns', () => {
  const answer = `${ANSWER}\n### Route check\n**Route verified**\n\n${formatEvidenceSources(collectStepEvidence(ANSWER, 3, PRECEDENT, QUERIES))}`;
  for (const latest of [true, false]) assert.doesNotMatch(routeReportsForHistory(answer, latest), /Where the evidence came from/);
});

test('a passage from a scanned book is marked in the table', () => {
  const support = new Map([[0, { passage: { title: 'Organic Chemistry 7e Ed', location: '882', citation: '', excerpt: '', about: 'enolate alkylation', scanned: true } }]]);
  const text = formatEvidenceSources(collectStepEvidence(ANSWER, 3, null, [], support));
  assert.match(text, /Organic Chemistry 7e Ed, p\. 882 \(scanned\) \(found by the check\)/);
});
