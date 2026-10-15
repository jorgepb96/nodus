// The rule that decides which citation labels a stored report may have rewritten.
//
// Getting this wrong is not a cosmetic bug. Too permissive and Nodus edits prose a
// person wrote; too strict and a report keeps naming the wrong author forever. The
// cases below are the boundary, so they are pinned here rather than left to a
// reviewer's memory of the regex.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundle = path.join(mkdtempSync(path.join(os.tmpdir(), 'nodus-citation-label-')), 'citationLabel.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/citationLabel.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const {
  authorYearLabel,
  looksLikeGeneratedLabel,
  splitPageSuffix,
  referenceEntry,
  NODUS_LINK_RE,
} = require(bundle);

test('a generated author-year label is recognised, in every shape the writer emits', () => {
  for (const label of [
    'Arco Blanco, M. (2024)',
    'Nash (1999)',
    'Román Ruiz, G. (2024)',
    'Obra sin autor (1978)',
    'La España negra en color: el desarrollismo turístico… (2012)',
    'Fuentes Vega, A. (2017), p. 44', // passage: author-year plus a page locator
    'Lleó Cañal, V. (1984), pp. 20-31',
  ]) {
    assert.equal(looksLikeGeneratedLabel(label), true, label);
  }
});

test('prose a person wrote is never treated as a generated label', () => {
  for (const label of [
    'esta idea',
    'véase la discusión',
    'the argument developed here',
    'Arco Blanco', // no year: left alone rather than guessed at
    'Obra sin autor',
    'una obra de 2024', // a bare year is not a citation
    '(2024) abre la sección', // the year must close the label
  ]) {
    assert.equal(looksLikeGeneratedLabel(label), false, label);
  }
});

test('the page locator of a passage survives a relabel', () => {
  assert.deepEqual(splitPageSuffix('Fuentes Vega, A. (2017), p. 44'), {
    base: 'Fuentes Vega, A. (2017)',
    suffix: ', p. 44',
  });
  assert.deepEqual(splitPageSuffix('Arco Blanco, M. (2024)'), {
    base: 'Arco Blanco, M. (2024)',
    suffix: '',
  });
});

test('the label of a work is its first author, surname and initial, with the year', () => {
  assert.equal(authorYearLabel('Arco Blanco, Miguel Ángel del', 2024), 'Arco Blanco, M. (2024)');
  assert.equal(authorYearLabel('Miguel Ángel del Arco Blanco', 2024), 'Blanco, M. (2024)');
  assert.equal(authorYearLabel(undefined, 2024, 'Los niños de Franco'), 'Los niños de Franco (2024)');
  assert.equal(authorYearLabel(undefined, null, ''), 'Obra sin autor');
  // An anonymous untitled work is named in the report's language, not always Spanish.
  assert.equal(authorYearLabel(undefined, 1978, '', 'en'), 'Untitled work (1978)');
  assert.equal(authorYearLabel(undefined, null, '', 'de'), 'Werk ohne Autor');
});

test('an editor marked in the byline is named as one, never silently as an author', () => {
  // The byline repair marks editors with "(ed.)". A citation derived from one has
  // to carry the marker: a reader seeing "Román Ruiz, G. (2024)" cannot tell she
  // edited the volume rather than wrote it, which is the whole point of the repair.
  assert.equal(authorYearLabel('Román Ruiz, G. (ed.)', 2024), 'Román Ruiz, G. (ed.) (2024)');
  assert.equal(authorYearLabel('Román Ruiz, G. (ed.)', null), 'Román Ruiz, G. (ed.)');
  // And the marker must not break the two rules that decide whether a label is
  // rewritable and where its page locator starts.
  assert.equal(looksLikeGeneratedLabel('Román Ruiz, G. (ed.) (2024)'), true);
  assert.deepEqual(splitPageSuffix('Román Ruiz, G. (ed.) (2024), p. 12'), {
    base: 'Román Ruiz, G. (ed.) (2024)',
    suffix: ', p. 12',
  });
});

test('the link pattern captures the label and the anchor, and stops at the bracket', () => {
  const md = 'Como sostiene [Arco Blanco, M. (2024)](nodus://idea/g-1160) y también [Nash (1999)](nodus://work/w-2).';
  const found = [...md.matchAll(new RegExp(NODUS_LINK_RE.source, 'g'))].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(found, [
    ['Arco Blanco, M. (2024)', 'idea', 'g-1160'],
    ['Nash (1999)', 'work', 'w-2'],
  ]);
});

test('a reference entry joins every author, and an edited volume shows its editors', () => {
  assert.equal(
    referenceEntry(
      { authors: ['Arco Blanco, M.', 'Román Ruiz, G. (ed.)'], year: 2024, title: 'Los niños de la derrota.', doi: null },
      { unknownAuthor: 'Autor desconocido', noDate: 's.f.' }
    ),
    'Arco Blanco, M.; Román Ruiz, G. (ed.) (2024). Los niños de la derrota.'
  );
  assert.equal(
    referenceEntry({ authors: [], year: null, title: 'Sin datos', doi: null }, { unknownAuthor: 'Autor desconocido', noDate: 's.f.' }),
    'Autor desconocido (s.f.). Sin datos.'
  );
});
