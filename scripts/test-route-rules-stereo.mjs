// A stereocentre in the route contract has to be checked by a person before it ships.
//
// The route rules show the model worked examples. A worked example teaches whatever it contains,
// including a mistake, and a stereochemical mistake is the one kind that survives every automatic
// check we have: a D enantiomer parses, canonicalises, balances and draws exactly as well as the L
// one. Nothing downstream can tell them apart, so nothing downstream will warn you.
//
// This happened. #1068 added a `Fmoc-Lys(Boc)-OH` exemplar written as the D enantiomer and
// labelled L. It was merged, and it left again only because a later commit deleted that whole rule
// for unrelated reasons. A model given that example wrote protected amino acids as their D forms
// while naming them "Fmoc-L-X", and the routes still passed, because the application resolves the
// NAME and checks the structure the name gives — so the model's error was corrected silently and
// reported as OK.
//
// The guard is deliberately dumb and dependency-free: it does not know chemistry and does not try
// to. It asserts that routeRules.ts contains NO tetrahedral stereocentre that is not in the
// allow-list below, which is currently empty because the file currently has none. The moment
// someone adds an exemplar with a stereocentre, this test fails and sends them here — which is all
// it needs to do, because the only reliable check is a human assigning the configuration on
// purpose.
//
// To add an exemplar: verify its configuration with a cheminformatics toolkit (assign the CIP
// label; do not eyeball the `@`/`@@` tag), then paste the exact string into VALIDATED below with a
// comment naming the compound and its configuration.
//
// Why the tag cannot be eyeballed: `@` and `@@` encode the neighbour order AS WRITTEN, not the
// configuration. The same molecule is `[C@H]` in one atom ordering and `[C@@H]` in another, so two
// exemplars of the same amino acid can disagree in tag and agree in chemistry — or the reverse.
// L-Lys is `O=C(O)[C@H](CCCCN...)N...` written carboxyl-first and `...NCCCC[C@@H](C(=O)O)N...`
// written side-chain-first. Both are L. A reviewer comparing tags learns nothing.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(repoRoot, 'shared/routeRules.ts'), 'utf8');

/** Exemplar SMILES whose configuration has been checked with a toolkit, exactly as written in
 *  routeRules.ts. Empty because the contract shows no stereocentre today. */
const VALIDATED = [];

/** A tetrahedral stereocentre in SMILES, with enough trailing context for the failure message to
 *  show which exemplar it came from. */
const STEREOCENTRE = /\[C@@?H\][^\s`"']*/g;

test('no unchecked stereocentre in the route contract', () => {
  let remaining = source;
  for (const validated of VALIDATED) remaining = remaining.split(validated).join('');
  const found = remaining.match(STEREOCENTRE) ?? [];
  assert.deepEqual(
    found, [],
    `shared/routeRules.ts shows ${found.length} stereocentre(s) that nobody has signed off:\n`
    + found.map(hit => `    ${hit}`).join('\n')
    + '\n\nAn exemplar in the route contract teaches the model whatever it contains, and a wrong '
    + 'enantiomer is invisible to every other check: it parses, balances and draws like the right '
    + 'one.\n\nAssign the CIP label with a toolkit rather than reading the @/@@ tag, which encodes '
    + 'atom order and not configuration. L is (S) for every proteinogenic amino acid except '
    + 'cysteine, where sulfur outranks the carboxyl and L is (R).\n\nThen add the exact string to '
    + `VALIDATED in ${path.relative(repoRoot, fileURLToPath(import.meta.url))}.`,
  );
});

test('the guard is looking at the right file', () => {
  // A guard that silently reads an empty string passes for ever. Two cheap anchors: the file was
  // found, and it is the route contract rather than something that merely resolved.
  assert.ok(source.length > 0, 'shared/routeRules.ts is empty or was not read');
  assert.match(source, /ROUTE_SPECIES_RULES/, 'shared/routeRules.ts does not look like the route contract');
});

test('the allow-list mechanism actually suppresses a match', () => {
  // Proves the stripping works, so an empty VALIDATED is an empty allow-list and not a broken one.
  // Without this, a typo in the strip loop would make every future exemplar pass unnoticed.
  const sample = 'start(smiles="O=C(O)[C@H](C)N")';
  assert.deepEqual(sample.match(STEREOCENTRE) ?? [], ['[C@H](C)N'], 'the pattern should match a stereocentre');
  const stripped = sample.split('O=C(O)[C@H](C)N').join('');
  assert.deepEqual(stripped.match(STEREOCENTRE) ?? [], [], 'stripping a validated exemplar should remove its match');
});
