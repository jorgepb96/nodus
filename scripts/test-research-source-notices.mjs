import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nodus-source-notices-'));
try {
  const bundle = path.join(temp, 'notices.mjs');
  await build({ entryPoints: ['shared/researchSourceNotices.ts'], outfile: bundle, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { researchSourcePresentation: present, researchChatPresentation: chat, researchHistorySourceNotices: historyNotes, RESEARCH_SOURCE_PRESENTATION_INSTRUCTION: instruction } = await import(pathToFileURL(bundle).href);
  const body = 'La propaganda turística construyó una imagen del país [Fuente](nodus://passage/real). Su recepción exige distinguir intención y efecto.';
  const note = '**Nota sobre la evidencia disponible:** los pasajes recuperados permiten reconstruir el origen, la difusión y la persistencia del tópico, pero no ofrecen un análisis teórico comparado del mismo con otros estereotipos europeos equivalentes. Para profundizar en esa dimensión comparada, convendría indexar más fuentes o reformular la pregunta.';
  test('old legacy footer is optional, verbatim and absent from copied/saved prose', () => {
    assert.deepEqual(present(`${body}\n\n${note}`), { content: body, notices: [note] });
    const persisted = JSON.parse(JSON.stringify({ content: body, stats: { sourceNotices: [note] } }));
    assert.deepEqual(present(persisted.content, persisted.stats.sourceNotices), { content: body, notices: [note] });
    assert.deepEqual(present(`${note}\n\n${body}`), { content: body, notices: [note] });
  });
  test('observed native legacy source footers move verbatim without touching the argument', () => {
    for (const note of [
      'Nota de fuentes: varios pasajes citados proceden de una revisión indexada anterior de los documentos, no de la versión actual; algunas obras del catálogo no se leyeron en este turno.',
      'Hay además una cautela de cobertura que conviene tener presente: parte de los pasajes citados proceden de una revisión indexada anterior de sus obras.',
      '*Nota de alcance: las afirmaciones son interpretaciones atribuidas; la biblioteca no permite por sí sola corroborar cifras de visitantes.*',
    ]) assert.deepEqual(present(`${body}\n\n${note}`), { content: body, notices: [note] });
  });
  test('supplied-text translations/edits preserve their actual content and explicit sidecar', () => {
    assert.deepEqual(chat({ content: note, stats: { sourceNotices: [] } }), { content: note, notices: [] });
    assert.deepEqual(chat({ content: `${body}\n\n${note}` }), { content: body, notices: [note] });
  });
  test('coverage notes remain bounded contextual history independently of answer prose', () => {
    assert.deepEqual(historyNotes([null, 7, '  Source coverage was partial.  ']), ['Source coverage was partial.']);
    assert.deepEqual(historyNotes('untrusted non-array'), []);
    assert.equal(historyNotes(Array(10).fill('x'.repeat(7000))).length, 8);
    assert.equal(historyNotes(['x'.repeat(7000)])[0].length, 6000);
  });
  test('unlabelled operational coverage aside moves without creating a note', () => {
    const aside = 'Los pasajes recuperados no ofrecen datos sobre la recepción de esta campaña. Convendría indexar más fuentes.';
    assert.deepEqual(present(`${body}\n\n${aside}`), { content: body, notices: [aside] });
    assert.deepEqual(present(body), { content: body, notices: [] });
    assert.ok(instruction.includes('Never invent'));
  });
  test('substantive scientific uncertainty and quoted source text remain in the argument', () => {
    for (const text of [
      'La intención propagandística no demuestra por sí sola un efecto en los visitantes.',
      '*Nota de alcance: el estudio se circunscribe a la propaganda de 1938 y no demuestra efectos posteriores.*',
      'Las fuentes del archivo de 1940 no incluyen testimonios de mujeres; esta ausencia limita el estudio histórico [Autor](nodus://passage/a).',
      'La autora señala las limitaciones de las fuentes censuradas y propone compararlas con testimonios orales.',
      '> Los pasajes recuperados no ofrecen un análisis comparado.',
      '«Los pasajes recuperados no ofrecen un análisis comparado».',
      'El menú de 1950 no incluye platos extranjeros [Archivo](nodus://passage/a).',
      '```text\n\nLos pasajes recuperados no contienen pruebas.\n\n```',
      '| Campo | Valor |\n| --- | --- |\n| Los pasajes recuperados | no contienen pruebas |',
    ]) assert.deepEqual(present(text), { content: text, notices: [] }, text);
  });
  test('a provenance aside inside a paragraph separates without deleting factual scope', () => {
    const provenance = 'Los pasajes proceden de una revisión indexada anterior de cada obra, no de la versión actual.';
    assert.deepEqual(present(`${body} ${provenance}`), { content: body, notices: [provenance] });
    const indexed = 'La cita se copia de la revisión indexada disponible.';
    assert.deepEqual(present(`${body} ${indexed}`), { content: body, notices: [indexed] });
    const scoped = 'La postmodernidad aparece en 2015 [Fuente](nodus://passage/a), aspecto que no aparece en los pasajes disponibles de 2011.';
    assert.deepEqual(present(scoped), { content: scoped, notices: [] });
  });
  test('a model self-coverage footer separates from a cited argument without inventing or reordering notes', () => {
    const first = 'Esta síntesis se limita exclusivamente a las evidencias documentales proporcionadas, las cuales omiten análisis sobre la recepción real del turista individual.';
    const second = 'Nota: este análisis se ve limitado por la necesidad de una evaluación más exhaustiva del corpus documental previo a los años cuarenta.';
    assert.deepEqual(present(`${body} ${first} ${second}`), { content: body, notices: [first, second] });
    const qualification = 'Esta síntesis se limita al caso español de 1960; no establece un efecto generalizable.';
    assert.deepEqual(present(qualification), { content: qualification, notices: [] });
  });
  test('a heading on its own has a reversible optional body and never swallows the next heading', () => {
    assert.deepEqual(present(`${body}\n\n## Limitaciones de las fuentes\n\nNo se ha consultado el archivo.`), { content: body, notices: ['## Limitaciones de las fuentes\n\nNo se ha consultado el archivo.'] });
    const text = '## Limitaciones de las fuentes\n\n## Análisis\n\nTexto.';
    assert.deepEqual(present(text), { content: text, notices: [] });
  });
  test('existing notices deduplicate and citations/visuals in the answer stay byte-for-byte intact', () => {
    const visual = '```nodus-visual\n{"title":"Los pasajes recuperados no bastan"}\n```';
    const text = `${body}\n\n${visual}`;
    assert.deepEqual(present(text, [note, note]), { content: text, notices: [note] });
    assert.deepEqual(present(note), { content: '', notices: [note] });
  });
} finally { await fs.rm(temp, { recursive: true, force: true }); }
