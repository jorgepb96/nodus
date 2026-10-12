import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-name-feedback-long-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { parseNameFeedback, findStepNamedSpecies, formatNameCorrectionNote, MAX_SPECIES_NAME } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

// A long systematic name of an assembled chain, as the parser keeps it (well under MAX_SPECIES_NAME).
const unit = '2-[(2S)-2-amino-3-(4-hydroxyphenyl)propanamido]';
const written = `${unit.repeat(6)}acetic acid`;
const corrected = `${unit.repeat(6)}ethanoic acid`;

test('a long name the parser kept is answered back whole', () => {
  assert.ok(written.length > 200 && written.length < MAX_SPECIES_NAME);
  const [species] = findStepNamedSpecies(`## Step 1\n\nCoupling.\n\nReactants: ${written}\nProducts: water\n`, 1)[0];
  assert.equal(species.name, written, 'the premise: the parser keeps the whole name');
  const feedback = parseNameFeedback(JSON.stringify({ names: [{ from: written, to: corrected }] }));
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].from, species.name, 'the rename is keyed by the name the step carries');
  assert.equal(feedback[0].to, corrected, 'the corrected name is not cut short');
  const structure = parseNameFeedback(JSON.stringify({ names: [{ from: written, smiles: 'CC(=O)O' }] }));
  assert.equal(structure[0].from, written);
});

test('the correction note keeps a long rename', () => {
  assert.match(formatNameCorrectionNote([`${written} → ${corrected}`]), /ethanoic acid$/);
});
