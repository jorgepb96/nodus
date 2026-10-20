// Unit tests for the listening copy of a Deep Research report (shared/readingCopy.ts).
// The module is pure, so esbuild bundles just that file and the REAL function is
// imported. What is locked here is the whole point of the button: a report pasted
// into a voice reader must contain no citation buttons, no author-year
// parentheses, no reference list and no Markdown syntax — and must still contain
// every sentence, list item and table cell the report had.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-reading-copy-test-'));
try {
  const outfile = path.join(tmp, 'readingCopy.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/readingCopy.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const { toReadingCopy } = await import(pathToFileURL(outfile).href);

  // ── Citation buttons vanish, label included ────────────────────────────────
  {
    const out = toReadingCopy('El turismo fue propaganda [García, I. (2019)](nodus://idea/g-12) del régimen.');
    assert.equal(out, 'El turismo fue propaganda del régimen.');
  }

  // ── The parentheses that only held citations go with them ──────────────────
  {
    assert.equal(
      toReadingCopy('El turismo fue propaganda ([García, I. (2019)](nodus://idea/g-12)) del régimen.'),
      'El turismo fue propaganda del régimen.'
    );
    assert.equal(
      toReadingCopy('Varios lo sostienen ([García, I. (2019)](nodus://idea/a); [Ortiz, M. (2020)](nodus://work/b)).'),
      'Varios lo sostienen.'
    );
  }

  // ── Research Chat's author-comma-year references and compound surnames ────
  {
    assert.equal(
      toReadingCopy('La recurrencia existe ([Lleó Cañal, 1984, p. 7](nodus://passage/source-1)).\n\nVega de la Rosa lo explica (Vega de la Rosa, 2011, p. 57).'),
      'La recurrencia existe.\n\nVega de la Rosa lo explica.'
    );
    assert.equal(
      toReadingCopy('Una interpretación [Vega de la Rosa, 2011](nodus://idea/source-2) que sigue vigente.'),
      'Una interpretación que sigue vigente.',
      'author-comma-year Nodus references are removed even inside a sentence'
    );
    assert.equal(toReadingCopy('El cambio (de la ciudad en 2011) fue notable.'), 'El cambio (de la ciudad en 2011) fue notable.');
  }

  // ── Bare nodus urls ───────────────────────────────────────────────────────
  {
    const out = toReadingCopy('Ver nodus://idea/g-12 para el detalle.');
    assert.ok(!out.includes('nodus://'), 'bare nodus url must be gone');
    assert.equal(out, 'Ver para el detalle.');
  }

  // ── A reference written into the prose keeps its surname, loses the rest ──
  // Deleting it whole would leave the sentence with no subject: "llegó a hablar…".
  {
    assert.equal(toReadingCopy('Pardo, I. (2018) llegó a hablar de milagro.'), 'Pardo llegó a hablar de milagro.');
    assert.equal(toReadingCopy('De la Torre, M. (s.f.) lo niega.'), 'De la Torre lo niega.');
  }

  // ── Gap / contradiction labels: a word of the sentence, or an appended mark ─
  {
    assert.equal(
      toReadingCopy('Hay una [contradicción](nodus://contradiction/c-2) entre las cifras.'),
      'Hay una contradicción entre las cifras.',
      'a label the sentence is built around must stay'
    );
    assert.equal(
      toReadingCopy('Las series son fragmentarias [hueco](nodus://gap/g-3).'),
      'Las series son fragmentarias.',
      'a label appended as a marker is apparatus'
    );
    assert.equal(
      toReadingCopy('Las series son fragmentarias ([hueco](nodus://gap/g-3)).'),
      'Las series son fragmentarias.',
      'and so is one appended inside parentheses'
    );
  }

  // ── Prose parentheticals: citations go, real asides stay ───────────────────
  {
    assert.equal(toReadingCopy('Como señala (García, 2019), el turismo creció.'), 'Como señala, el turismo creció.');
    assert.equal(toReadingCopy('Lo matiza (cf. Ortiz, M., 2019, pp. 33-40) más adelante.'), 'Lo matiza más adelante.');
    assert.equal(
      toReadingCopy('El plan (el régimen lo negó en 1966) siguió adelante.'),
      'El plan (el régimen lo negó en 1966) siguió adelante.',
      'an aside with ordinary words is not a citation'
    );
    assert.equal(
      toReadingCopy('Se firmó en Madrid (capital) aquel verano.'),
      'Se firmó en Madrid (capital) aquel verano.',
      'a parenthesis with no year is never a citation'
    );
  }

  // ── The reference list is removed, the rest of the report is not ───────────
  {
    const report = [
      '## Resumen', '', 'Un resumen breve.', '',
      '## Desarrollo', '', 'Cuerpo del informe.', '',
      '## Limitaciones', '', '- El corpus es parcial.', '',
      '## Referencias', '', '- García, I. (2019). Turismo y propaganda.', '- Ortiz, M. (2020). Otra obra.',
    ].join('\n');
    const out = toReadingCopy(report);
    assert.ok(out.includes('Cuerpo del informe.'), 'the body must survive');
    assert.ok(out.includes('El corpus es parcial.'), 'limitations are prose and must survive');
    assert.ok(!out.includes('Referencias'), 'the reference heading must be gone');
    assert.ok(!out.includes('Turismo y propaganda'), 'the reference entries must be gone');
  }

  // ── Every language's reference heading, and every variant's wording ────────
  {
    for (const heading of ['References', 'Références', 'Referências', 'Bibliografia', 'Literaturverzeichnis', 'Kaynakça', 'Fuentes de estudio', 'Study sources', 'Çalışma kaynakları', 'Fonti di studio', 'Quellen', 'Fontes']) {
      const out = toReadingCopy(`## Cuerpo\n\nTexto.\n\n## ${heading}\n\n- Una obra citada.`);
      assert.ok(!out.includes('Una obra citada'), `"${heading}" must be recognised as a reference list`);
      assert.ok(out.includes('Texto.'), `"${heading}" must not eat the body`);
    }
  }

  // ── A heading after the references keeps the report going ─────────────────
  {
    const out = toReadingCopy('## Fuentes\n\n- Una obra.\n\n## Anexo\n\nTexto del anexo.');
    assert.ok(!out.includes('Una obra'), 'the reference list is dropped');
    assert.ok(out.includes('Texto del anexo.'), 'the section after it is not');
  }

  // ── Markdown becomes plain prose, and nothing is silently dropped ─────────
  {
    const out = toReadingCopy([
      '# Título', '', 'Texto **fuerte** y _matizado_ con `código`.', '',
      '> Una cita en bloque.', '',
      '- Primer punto', '- Segundo punto', '',
      '| Año | Obras |', '|---|---|', '| 1966 | 12 |', '',
      'Ver [la web](https://example.com) para más.',
    ].join('\n'));
    assert.ok(!/[#*_`|>]/.test(out), `no markdown syntax should survive: ${JSON.stringify(out)}`);
    assert.ok(out.includes('Título.'), 'headings keep their text and gain a stop');
    assert.ok(out.includes('Texto fuerte y matizado con código.'));
    assert.ok(out.includes('Una cita en bloque.'));
    assert.ok(out.includes('Primer punto.') && out.includes('Segundo punto.'), 'list items keep their text');
    assert.ok(out.includes('Año, Obras.') && out.includes('1966, 12.'), 'table rows are narrated, not dropped');
    assert.ok(out.includes('Ver la web para más.'), 'ordinary links keep their text');
  }

  // ── Footnotes and images are apparatus, not prose ─────────────────────────
  {
    const out = toReadingCopy('Una afirmación[^1] con nota.\n\n![Un mapa](mapa.png)\n\n[^1]: García, 2019.');
    assert.equal(out, 'Una afirmación con nota.');
  }

  // ── The title is prepended when the markdown does not carry one ───────────
  {
    const out = toReadingCopy('## Resumen\n\nUn resumen.', { title: 'El turismo como propaganda' });
    assert.ok(out.startsWith('El turismo como propaganda\n\nResumen.'), out);
    assert.equal(toReadingCopy('Texto.', { title: '  ' }), 'Texto.', 'a blank title adds nothing');
  }

  // ── Whole-report shape: paragraphs survive, spacing is clean ──────────────
  {
    const out = toReadingCopy([
      '## Resumen', '',
      'El turismo fue propaganda [García, I. (2019)](nodus://idea/a) del régimen ([Ortiz, M. (2020)](nodus://work/b)).', '',
      'Otro párrafo (García, 2019) distinto.', '',
      '## Referencias', '', '- García, I. (2019). Obra.',
    ].join('\n'), { title: 'Informe' });
    // Paragraph breaks are kept: a voice reader pauses on them.
    assert.equal(out, [
      'Informe', '',
      'Resumen.', '',
      'El turismo fue propaganda del régimen.', '',
      'Otro párrafo distinto.',
    ].join('\n'));
  }

  // ── Empty input is empty output, not "undefined" ──────────────────────────
  {
    assert.equal(toReadingCopy(''), '');
    assert.equal(toReadingCopy('', { title: 'Solo título' }), 'Solo título');
  }

  // ── The button is actually wired into the reader every vault shares ────────
  // One reader serves the four Deep Research variants (academic, genealogy, study,
  // teaching unit), so this single wiring is what puts the button in all of them.
  {
    const view = await readFile(path.join(repoRoot, 'src/views/DeepResearchView.tsx'), 'utf8');
    assert.match(view, /toReadingCopy\(/, 'the reader must build the listening copy');
    assert.match(view, /onCopyReading=\{\(\) => void copyForListening\(\)\}/, 'the reader must pass the handler down');
    const shared = await readFile(path.join(repoRoot, 'src/views/writingShared.tsx'), 'utf8');
    assert.match(shared, /onCopyReading && \(/, 'the action bar must render the button when the handler is given');
  }

  console.log('reading copy: all assertions passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
