// Unit tests for the local-model research-chat fitting + citation repair. The helpers in
// electron/ai/researchContextFit.ts are pure (no Electron/DB deps), so we bundle just that
// file with esbuild and import the REAL functions. This locks two guarantees:
//   1. enforceContextBudget ALWAYS brings the payload under budget, degrading gracefully:
//      panoramic sections drop first, the citable core (ideas/passages) survives partially
//      instead of vanishing — the bug that left a 4096-token model with an empty context.
//   2. humanizeCitationLabels repairs both weak-local-model citation shapes (id-as-label
//      link, and bracketed bare id with no link) while leaving good labels + hallucinated
//      ids alone.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-localfit-test-'));
try {
  const outfile = path.join(tmp, 'researchContextFit.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/researchContextFit.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const { enforceContextBudget, prioritizePassageQueryCoverage, humanizeCitationLabels, passagePageCitationLabel, researchAuthorYearLabel, CONTEXT_DROP_ORDER } = await import(pathToFileURL(outfile).href);
  assert.equal(researchAuthorYearLabel(['Alburquerque García, Luis'], 2014), 'Alburquerque García, 2014');
  assert.equal(researchAuthorYearLabel(['John Urry'], 1997), 'Urry, 1997');
  assert.equal(researchAuthorYearLabel([], 2014), '2014');
  assert.equal(researchAuthorYearLabel([], null), null);

  // Build a realistic context: a big ideas array (most relevant), some contradictions and
  // gaps (less relevant), plus a panoramic authors object (least relevant, dropped first).
  const makeContext = () => ({
    generated_at: '2026-07-11T00:00:00.000Z',
    note: 'x',
    autores: { authors: Array.from({ length: 20 }, (_, i) => ({ id: `a-${i}`, name: `Autor ${i}`, bio: 'y'.repeat(200) })), relations: [] },
    huecos_de_investigacion: Array.from({ length: 20 }, (_, i) => ({ id: `gap-${i}`, statement: 'g'.repeat(150) })),
    contradicciones: Array.from({ length: 20 }, (_, i) => ({ id: `c-${i}`, explanation: 'c'.repeat(150) })),
    orientacion_documental: Array.from({ length: 20 }, (_, i) => ({ id: `w-${i}`, orientation: 'o'.repeat(500) })),
    // ideas are relevance-ordered: idea-0 is the MOST relevant and must survive.
    ideas_generadas: Array.from({ length: 60 }, (_, i) => ({ id: `g-${String(i).padStart(4, '0')}`, statement: 's'.repeat(150) })),
    pasajes_relevantes: Array.from({ length: 8 }, (_, i) => ({ id: `p-${i}`, text: 'p'.repeat(300) })),
  });

  // ── enforceContextBudget: always fits, degrades gracefully ──────────────────
  // The context above is ~22k chars; every budget below it must force a fit.
  for (const budget of [12000, 6000, 3000, 1500, 400]) {
    const ctx = makeContext();
    const { truncated } = enforceContextBudget(ctx, budget);
    const size = JSON.stringify(ctx).length;
    assert.ok(size <= budget, `budget ${budget}: fit to ${size} <= ${budget}`);
    assert.ok(truncated, `budget ${budget}: reported truncated`);
    assert.ok(ctx.contexto_recortado, `budget ${budget}: annotated the cut`);
  }

  // At a mid budget the panoramic section (autores) is dropped before the citable core,
  // and the MOST relevant ideas survive (relevance order preserved from the front).
  {
    const ctx = makeContext();
    enforceContextBudget(ctx, 6000);
    assert.ok(!('autores' in ctx), 'autores (panoramic) dropped first');
    assert.ok(!('orientacion_documental' in ctx), 'non-citable orientation yields before literal evidence');
    assert.ok(Array.isArray(ctx.ideas_generadas) && ctx.ideas_generadas.length > 0, 'ideas survive partially');
    assert.ok(Array.isArray(ctx.pasajes_relevantes) && ctx.pasajes_relevantes.length > 0, 'literal passages survive orientation');
    assert.equal(ctx.ideas_generadas[0].id, 'g-0000', 'the most-relevant idea is kept (front-of-array)');
  }

  // A context already under budget is untouched.
  {
    const small = { generated_at: 'x', ideas_generadas: [{ id: 'g-0001', statement: 'short' }] };
    const { truncated } = enforceContextBudget(small, 100000);
    assert.equal(truncated, false, 'under-budget context not truncated');
    assert.ok(!small.contexto_recortado, 'no cut annotation when nothing dropped');
  }

  // The optional receipt snapshots IDs/counts instead of retaining live array references,
  // and reports measurements from the same callback that drives the fit.
  {
    const makeReceiptContext = () => ({
      pasajes_relevantes: Array.from({ length: 8 }, (_, i) => ({ id: `passage-${i}`, nodus_id: 'same-parent-work', text: 'x'.repeat(700) })),
    });
    const traced = makeReceiptContext();
    const untraced = makeReceiptContext();
    const bound = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
    const budget = 3100;
    const beforeBytes = bound(traced);
    let sizeCalls = 0;
    let receipt;
    const size = () => { sizeCalls += 1; return bound(traced); };
    const fitResult = enforceContextBudget(traced, budget, size, value => { receipt = value; });
    const untracedResult = enforceContextBudget(untraced, budget, () => bound(untraced));
    assert.ok(fitResult.truncated && untracedResult.truncated, 'same over-budget case is fitted');
    assert.deepEqual(traced, untraced, 'tracing does not change fit output or item order');
    assert.equal(receipt.measuredSizeBefore, beforeBytes, 'receipt captures actual initial size callback result');
    assert.equal(receipt.measuredSizeAfter, bound(traced), 'receipt captures actual post-fit size callback result');
    assert.ok(sizeCalls > 1, 'the supplied size callback drives the fit');
    assert.deepEqual(receipt.passageIdsBefore, Array.from({ length: 8 }, (_, i) => `passage-${i}`));
    assert.deepEqual(receipt.removedPassageIds, receipt.passageIdsBefore.filter(id => !receipt.passageIdsAfter.includes(id)));
    assert.ok(receipt.removedPassageIds.length > 0, 'receipt identifies passages removed by fitting');
    traced.pasajes_relevantes.length = 0;
    assert.notEqual(receipt.passageIdsBefore.length, traced.pasajes_relevantes.length, 'receipt passage IDs do not alias context arrays');
    assert.equal(receipt.sectionCountsBefore.pasajes_relevantes, 8, 'receipt section counts are snapshots');
  }

  assert.ok(CONTEXT_DROP_ORDER[0] === 'grafo' && CONTEXT_DROP_ORDER.at(-1) === 'pasajes_relevantes', 'drop order least→most relevant');

  // A final window used to keep only repeated records of the first comparator.
  // The same byte bound must retain representatives of the planned searches.
  for (const [first, second] of [['Cedar', 'Orion'], ['Álamo', 'Órbita']]) {
    const makeComparison = () => ({ pasajes_relevantes: [
      ...Array.from({ length: 6 }, (_, index) => ({ id: `policy-${index}`, summary: `${first} retains events for fourteen days. ${'x'.repeat(180)}` })),
      ...Array.from({ length: 5 }, (_, index) => ({ id: `sensor-${index}`, summary: `${second} measures turbidity with green light. ${'x'.repeat(180)}` })),
    ] });
    const queries = [`${second} measurement exclusions`, `${first} restoration exclusions`, `${first} event retention`];
    const original = makeComparison();
    const bound = value => Buffer.byteLength(JSON.stringify(value), 'utf8') + 500;
    const oldFit = structuredClone(original), newFit = structuredClone(original);
    const budget = 1800;
    enforceContextBudget(oldFit, budget, () => bound(oldFit));
    let receipt;
    enforceContextBudget(newFit, budget, () => bound(newFit), value => { receipt = value; }, { passageQueries: queries });
    assert.ok(oldFit.pasajes_relevantes.every(row => row.id.startsWith('policy-')), 'baseline tail pruning loses the other comparator');
    assert.ok(newFit.pasajes_relevantes.some(row => row.id === 'policy-0') && newFit.pasajes_relevantes.some(row => row.id === 'sensor-0'),
      'same budget preserves a representative for each independently planned search');
    assert.ok(bound(newFit) <= budget, 'query coverage never adds unbudgeted text');
    assert.deepEqual(original, makeComparison(), 'the source snapshot is not mutated');
    assert.equal(receipt.passageIdsBefore.length, 11);
    assert.ok(receipt.passageIdsAfter.includes('sensor-0'), 'receipt identifies the retained comparator');
    const under = makeComparison();
    enforceContextBudget(under, 100000, () => bound(under), undefined, { passageQueries: queries });
    assert.deepEqual(under, original, 'no reordering when the context already fits');
    const droppedOtherSections = { obras: [{ summary: 'x'.repeat(10000) }], ...makeComparison() };
    enforceContextBudget(droppedOtherSections, bound(original) + 500, () => bound(droppedOtherSections), undefined, { passageQueries: queries });
    assert.deepEqual(droppedOtherSections.pasajes_relevantes, original.pasajes_relevantes,
      'dropping other sections first avoids unnecessary passage reordering');
    assert.deepEqual(prioritizePassageQueryCoverage(original.pasajes_relevantes, ['unmatched facet', 'no matching tokens']), original.pasajes_relevantes,
      'unmatched facets do not fabricate coverage or perturb retrieval order');
    const exactOrder = prioritizePassageQueryCoverage(original.pasajes_relevantes, queries);
    assert.deepEqual(exactOrder.map(row => row.id), ['policy-0', 'sensor-0', ...original.pasajes_relevantes.map(row => row.id).filter(id => !['policy-0', 'sensor-0'].includes(id))],
      'representatives and remaining evidence retain their relative ranking');
  }
  assert.deepEqual(prioritizePassageQueryCoverage([
    { id: 'shared', summary: 'alpha' }, { id: 'first', summary: 'beta' }, { id: 'second', summary: 'gamma' },
  ], ['alpha beta', 'alpha gamma']).map(row => row.id), ['first', 'second', 'shared'],
  'shared query vocabulary is discounted so it cannot crowd out the distinct facet terms on a tie');

  // ── humanizeCitationLabels: repair both weak-model shapes ───────────────────
  assert.equal(passagePageCitationLabel('fixture 25', 'p. 1'), 'fixture 25, p. 1');
  assert.equal(passagePageCitationLabel('fixture 25', 'pp. 1–2'), 'fixture 25, pp. 1–2');
  assert.equal(passagePageCitationLabel('fixture 25', 'page 1'), 'fixture 25, page 1');
  assert.equal(passagePageCitationLabel('fixture 25', 'pages 1–2'), 'fixture 25, pages 1–2');
  assert.equal(passagePageCitationLabel('fixture 25', ' p.   1 '), 'fixture 25, p.   1');
  assert.equal(passagePageCitationLabel('fixture 25', '1'), 'fixture 25, p. 1');
  assert.equal(passagePageCitationLabel('fixture 25', 'iv'), 'fixture 25, p. iv');
  assert.equal(passagePageCitationLabel('fixture 25', 'Sec. 2'), 'fixture 25, Sec. 2');
  assert.equal(passagePageCitationLabel('fixture 25', 'Table 3'), 'fixture 25, Table 3');
  assert.equal(passagePageCitationLabel('fixture 25', 'paragraph 4'), 'fixture 25, paragraph 4');
  assert.equal(passagePageCitationLabel('fixture 25', null), 'fixture 25');

  // Fake corpus lookup: g-0001 → "Toro Tamayo, 2019"; w-1 → "Kossoy, 2014"; others null.
  const WORK_UUID = '2aea3baa-5f5f-4822-a9f4-1ef6ac6127ef';
  const lookup = (kind, id) => {
    if (kind === 'idea' && id === 'g-0001') return 'Toro Tamayo, 2019';
    if (kind === 'work' && (id === 'w-1' || id === WORK_UUID)) return 'Kossoy, 2014';
    return null;
  };

  // id-as-label link → label repaired, href untouched.
  assert.equal(
    humanizeCitationLabels('La imagen ([g-0001](nodus://idea/g-0001)).', lookup),
    'La imagen ([Toro Tamayo, 2019](nodus://idea/g-0001)).'
  );
  // bracketed bare id (no URL) → linkified.
  assert.equal(
    humanizeCitationLabels('No es objetiva [g-0001].', lookup),
    'No es objetiva [Toro Tamayo, 2019](nodus://idea/g-0001).'
  );
  // work link with id-as-label → repaired.
  assert.equal(
    humanizeCitationLabels('Ver [w-1](nodus://work/w-1).', lookup),
    'Ver [Kossoy, 2014](nodus://work/w-1).'
  );
  // Already-good label → unchanged.
  assert.equal(
    humanizeCitationLabels('Ok ([Toro Tamayo, 2019](nodus://idea/g-0001)).', lookup),
    'Ok ([Toro Tamayo, 2019](nodus://idea/g-0001)).'
  );
  // Hallucinated id (lookup returns null) → left as-is in both shapes.
  assert.equal(humanizeCitationLabels('Falsa [g-9999].', lookup), 'Falsa [g-9999].');
  assert.equal(
    humanizeCitationLabels('Falsa [g-9999](nodus://idea/g-9999).', lookup),
    'Falsa [g-9999](nodus://idea/g-9999).'
  );
  // bracketed bare UUID (a work nodus_id) → work link.
  assert.equal(
    humanizeCitationLabels(`Segun [${WORK_UUID}].`, lookup),
    `Segun [Kossoy, 2014](nodus://work/${WORK_UUID}).`
  );
  // bracketed UUID that resolves to nothing → left as-is.
  assert.equal(
    humanizeCitationLabels('Segun [11111111-2222-3333-4444-555555555555].', lookup),
    'Segun [11111111-2222-3333-4444-555555555555].'
  );
  // A placeholder noun copied from the citation contract names nothing, in any
  // language: it becomes the source's author-year.
  for (const placeholder of ['fuente', 'Fuente', 'source', 'Source 2', 'Quelle', 'fonte', '出典']) {
    assert.equal(
      humanizeCitationLabels(`Dato ([${placeholder}](nodus://work/w-1)).`, lookup),
      'Dato ([Kossoy, 2014](nodus://work/w-1)).',
      placeholder
    );
  }
  // Real prose labels are never treated as placeholders.
  assert.equal(
    humanizeCitationLabels('Ver [la fuente original](nodus://work/w-1).', lookup),
    'Ver [la fuente original](nodus://work/w-1).'
  );
  // No citations at all → identity.
  assert.equal(humanizeCitationLabels('Texto sin citas.', lookup), 'Texto sin citas.');

  console.log('local chat fit + citation repair test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
