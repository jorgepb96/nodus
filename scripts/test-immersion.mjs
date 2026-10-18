// Tests for the Inmersión orchestration core. The pure control flow in
// electron/ai/immersionCore.ts has no Electron/DB/AI deps (only erased type
// imports), so we bundle just that file with esbuild and drive the REAL
// orchestrator with injected fakes — no provider calls, no database.
//
// It locks the guarantees the feature stands on:
//   • literal quote text ALWAYS comes from the material, never from the model;
//   • hallucinated citations (unknown nodus:// urls, unknown passage ids) never survive;
//   • a model failure at any step degrades to structural content and the
//     session still completes end to end (stoppedReason records it);
//   • quiz questions are validated (broken choice questions dropped) and
//     includeQuiz=false produces a session with no questions at all;
//   • station count respects both the time budget and the material;
//   • the contrast matrix has one row per station and only known authors.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-immersion-test-'));

try {
  const outfile = path.join(tmp, 'immersionCore.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/immersionCore.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: { '@shared': path.join(repoRoot, 'shared') },
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  const {
    orchestrateImmersion,
    resolveStationCount,
    applyCitationPolicy,
    buildCitationCatalog,
    buildCitationLabels,
    normalizeBareCitations,
    IMMERSION_LIMITS,
  } = mod;

  // ── Fake material ───────────────────────────────────────────────────────────
  const makeMaterial = (ideaCount = 24, passageCount = 8) => {
    const authors = ['García, A.', 'Pérez, B.', 'Ruiz, C.'];
    const ideas = Array.from({ length: ideaCount }, (_, i) => ({
      id: `g-${i}`,
      type: i % 5 === 0 ? 'construct' : 'claim',
      label: `Idea ${i}`,
      statement: `Enunciado sustantivo número ${i} sobre el fenómeno estudiado.`,
      score: 0.6 - i * 0.01,
      themes: [`Tema ${i % 3}`],
      authors: [authors[i % authors.length]],
      works: [{ nodusId: `w-${i % 6}`, title: `Obra ${i % 6}`, year: 1960 + i, zoteroKey: `Z${i % 6}` }],
    }));
    const passages = Array.from({ length: passageCount }, (_, i) => ({
      id: `p-${i}`,
      workId: `w-${i % 6}`,
      workTitle: `Obra ${i % 6}`,
      authors: [authors[i % authors.length]],
      year: 1970 + i,
      zoteroKey: `Z${i % 6}`,
      pageLabel: String(10 + i),
      text: `Texto literal completo del pasaje ${i}, tal y como está almacenado en la base de datos, con su redacción original íntegra.`,
      score: 0.5 - i * 0.02,
    }));
    return {
      topic: 'uso franquista de las fiestas',
      embeddingAvailable: true,
      ideas,
      passages,
      works: Array.from({ length: 6 }, (_, i) => ({
        nodusId: `w-${i}`,
        title: `Obra ${i}`,
        authors: [authors[i % authors.length]],
        year: 1960 + i,
        zoteroKey: `Z${i}`,
        score: 0.5,
        ideaCount: 4,
      })),
      authors: authors.map((name, i) => ({ authorId: `a-${i}`, name, ideaCount: 8 - i, workCount: 2 })),
      edges: [{ id: 'e-1', source: 'g-0', target: 'g-1', type: 'supports' }],
      debates: [{ edgeId: 'e-d', fromIdeaId: 'g-0', toIdeaId: 'g-2', fromLabel: 'Idea 0', toLabel: 'Idea 2', type: 'contradicts' }],
      gaps: [{ id: 'gap-1', kind: 'evidence', statement: 'Falta evidencia sobre X.', workTitle: 'Obra 1', score: 0.4 }],
      themes: ['Tema 0', 'Tema 1', 'Tema 2'],
      graph: {
        nodes: ideas.map((i) => ({ id: i.id, label: i.label, type: 'claim', workCount: 1, read: false, themes: [], years: [], authors: i.authors, maxConfidence: 0.8 })),
        edges: [{ id: 'e-1', source: 'g-0', target: 'g-1', type: 'supports', basis: 'deep', confidence: 0.8 }],
      },
    };
  };

  const happyDeps = (material) => ({
    buildMaterial: async () => material,
    planCurriculum: async (input) => ({
      title: 'Inmersión de prueba',
      stations: Array.from({ length: input.stationCount }, (_, i) => ({
        id: `st-${i + 1}`,
        title: `Estación ${i + 1}`,
        question: `¿Sub-pregunta ${i + 1}?`,
        ideaIds: input.ideas.slice(i * 3, i * 3 + 3).map((x) => x.id),
        passageIds: input.passages.slice(i, i + 2).map((x) => x.id),
      })),
    }),
    writePanorama: async (input) => ({
      overview: `Panorama con cita válida [García (1960)](${input.ideas[0].citation}) y una alucinada [Falso (1999)](nodus://idea/NO-EXISTE).`,
      keyTerms: [{ term: 'Término', definition: 'Definición breve.' }],
    }),
    writeStation: async (input) => ({
      context: 'Esta sub-pregunta importa porque estructura el debate del tema.',
      synthesis: `Síntesis con cita válida [A (1970)](${input.passages[0]?.citation ?? input.ideas[0].citation}) y una inventada [B (2000)](nodus://passage/FALSO).`,
      takeaways: ['Primera idea que retener.', 'Segunda idea que retener.'],
      citations: [
        { passageId: input.passages[0]?.id ?? 'nope', whyItMatters: 'Es la formulación canónica.', commentary: 'Fíjate en el vocabulario institucional del pasaje.' },
        { passageId: 'FALSO-ID', whyItMatters: 'No debería sobrevivir.', commentary: 'x' },
      ],
      positions: [
        { author: input.authors[0], position: 'Defiende la lectura instrumental.', ideaIds: [input.ideas[0]?.id] },
        { author: 'Autor Inventado', position: 'No debería sobrevivir.', ideaIds: [] },
      ],
      quiz: [
        { kind: 'choice', question: '¿Cuál es correcta?', options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'Porque sí.', ideaIds: [input.ideas[0]?.id] },
        { kind: 'choice', question: 'Rota (sin opciones)', options: [], correctIndex: 0 },
        { kind: 'open', question: '¿Qué sostiene el autor?', expected: 'La tesis central.', ideaIds: [] },
      ],
    }),
    writeContrasts: async (input) => ({
      rows: input.rows.map((r) => ({
        stationId: r.stationId,
        cells: input.authors.map((a) => ({ author: a, stance: r.ideasByAuthor[a] ? `Postura de ${a}` : '' })),
      })),
    }),
    writeExam: async (input) => ({
      questions: Array.from({ length: input.questionCount }, (_, i) =>
        i % 2 === 0
          ? { kind: 'choice', question: `Examen ${i}`, options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'ok', ideaIds: [] }
          : { kind: 'open', question: `Examen ${i}`, expected: 'Respuesta esperada.', ideaIds: [] }
      ),
      feynman: 'Explica el tema completo.',
    }),
  });

  // ── resolveStationCount: depth tiers (express ~6 / afternoon ~12 / deep ~20) ─
  assert.equal(resolveStationCount(90, 60), 6, 'express targets ~6 stations');
  assert.equal(resolveStationCount(150, 60), 12, 'an afternoon targets ~12 stations');
  assert.equal(resolveStationCount(240, 60), 20, 'a deep dive targets ~20 stations');
  assert.equal(resolveStationCount(30, 60), IMMERSION_LIMITS.minStations, 'never below min stations');
  assert.equal(resolveStationCount(600, 500), IMMERSION_LIMITS.maxStations, 'never above max stations');
  assert.equal(resolveStationCount(600, 8), IMMERSION_LIMITS.minStations, 'thin material limits stations');
  // A rich deep route can hold far more stations than the old cap of 8.
  assert.ok(IMMERSION_LIMITS.maxStations >= 20, 'the ceiling allows deep, multi-station routes');

  // ── Happy path ──────────────────────────────────────────────────────────────
  {
    const material = makeMaterial();
    const events = [];
    const plan = await orchestrateImmersion(
      { topic: material.topic, language: 'es', minutes: 150, includeQuiz: true, model: null },
      happyDeps(material),
      (p) => events.push(p.phase)
    );

    assert.equal(plan.title, 'Inmersión de prueba');
    assert.ok(plan.stations.length >= IMMERSION_LIMITS.minStations, 'has stations');
    assert.ok(plan.overview.includes('[García (1960)](nodus://idea/g-0)'), 'valid citation survives');
    assert.ok(!plan.overview.includes('nodus://idea/NO-EXISTE'), 'hallucinated overview citation stripped');
    assert.ok(plan.overview.includes('[Falso (1999)]') === false && plan.overview.includes('Falso (1999)'), 'stripped citation keeps its label');

    for (const station of plan.stations) {
      assert.ok(!station.synthesis.includes('nodus://passage/FALSO'), 'hallucinated station citation stripped');
      assert.ok(station.context.length > 0, 'station carries framing context');
      assert.ok(station.takeaways.length >= 2, 'station carries takeaways');
      for (const c of station.citations) {
        assert.ok(c.text.startsWith('Texto literal completo del pasaje'), 'quote text comes from material');
        assert.notEqual(c.passageId, 'FALSO-ID', 'unknown passage ids dropped');
      }
      assert.ok(station.citations.some((c) => c.commentary.length > 0), 'guided-reading commentary survives');
      for (const p of station.positions) {
        assert.notEqual(p.name, 'Autor Inventado', 'unknown authors dropped');
      }
      // The broken choice question (no options) must be dropped; the rest capped.
      assert.ok(station.quiz.length <= IMMERSION_LIMITS.quizPerStation, 'quiz capped per station');
      for (const q of station.quiz) {
        if (q.kind === 'choice') assert.ok(q.options.length >= 2 && q.correctIndex != null, 'choice quiz valid');
        if (q.kind === 'open') assert.ok(q.expected, 'open quiz has expected');
      }
    }

    assert.equal(plan.contrasts.rows.length, plan.stations.length, 'one contrast row per station');
    assert.ok(plan.contrasts.authors.length > 0 && plan.contrasts.authors.every((a) => material.authors.some((m) => m.name === a)), 'contrast authors are known');
    assert.ok(plan.frontiers.some((f) => f.kind === 'gap'), 'frontiers include gaps');
    assert.ok(plan.exam.questions.length > 0 && plan.exam.questions.length <= IMMERSION_LIMITS.examQuestions, 'exam sized');
    assert.ok(plan.exam.feynman.length > 0, 'feynman present');
    assert.equal(plan.stoppedReason, null, 'no degradation on happy path');
    assert.ok(plan.ideaIndex.length > 0, 'idea index stored for offline assessment');
    const covered = new Set(plan.stations.flatMap((s) => s.ideaIds));
    assert.ok(plan.ideaIndex.every((r) => covered.has(r.id)), 'idea index covers station ideas');
    assert.ok(plan.graph.nodes.length > 0, 'plan embeds the topic subgraph');

    // Progress events arrive in phase order and end with done.
    assert.equal(events[0], 'material');
    assert.equal(events[events.length - 1], 'done');
    assert.ok(events.includes('station') && events.includes('contrasts') && events.includes('exam'), 'phases emitted');
  }

  // ── includeQuiz=false → zero questions anywhere ─────────────────────────────
  {
    const material = makeMaterial();
    const plan = await orchestrateImmersion(
      { topic: material.topic, language: 'es', minutes: 90, includeQuiz: false, model: null },
      happyDeps(material)
    );
    assert.ok(plan.stations.every((s) => s.quiz.length === 0), 'no station quiz when disabled');
    assert.equal(plan.exam.questions.length, 0, 'no exam questions when disabled');
    assert.ok(plan.exam.feynman.length > 0, 'feynman still present');
    assert.equal(plan.stats.quizQuestions, 0, 'stats reflect no quiz');
  }

  // ── One transient generation failure is retried before degradation ──────────
  {
    const material = makeMaterial();
    const deps = happyDeps(material);
    const writeStation = deps.writeStation;
    let stationCalls = 0;
    deps.writeStation = async (input) => {
      stationCalls += 1;
      if (stationCalls === 1) throw new Error('transient provider failure');
      return writeStation(input);
    };
    const plan = await orchestrateImmersion(
      { topic: material.topic, language: 'es', minutes: 90, includeQuiz: true, model: null },
      deps
    );
    assert.equal(plan.stoppedReason, null, 'a recovered transient failure does not mark the route as degraded');
    assert.equal(stationCalls, plan.stations.length + 1, 'the failed station received exactly one fresh attempt');
  }

  // V1 stops immediately on failures that no unchanged retry can repair.
  for (const code of ['auth', 'budget_exhausted', 'context_overflow']) {
    const deps = happyDeps(makeMaterial());
    let calls = 0;
    deps.haltOnProviderFailure = true;
    deps.writePanorama = async () => { calls++; throw Object.assign(new Error(code), { code }); };
    deps.writeStation = async () => { throw new Error('must not fan out after terminal failure'); };
    await assert.rejects(() => orchestrateImmersion(
      { topic: 'test', language: 'es', minutes: 30, includeQuiz: true, model: null }, deps
    ), error => error.code === code);
    assert.equal(calls, 1);
  }

  // ── Every AI step failing → structural fallback, still completes ────────────
  {
    const material = makeMaterial();
    const failing = {
      buildMaterial: async () => material,
      planCurriculum: async () => {
        throw new Error('boom');
      },
      writePanorama: async () => {
        throw new Error('boom');
      },
      writeStation: async () => {
        throw new Error('boom');
      },
      writeContrasts: async () => {
        throw new Error('boom');
      },
      writeExam: async () => {
        throw new Error('boom');
      },
    };
    const plan = await orchestrateImmersion(
      { topic: material.topic, language: 'es', minutes: 150, includeQuiz: true, model: null },
      failing
    );
    assert.ok(plan.stations.length >= IMMERSION_LIMITS.minStations, 'structural stations exist');
    assert.ok(plan.overview.length > 0, 'structural overview exists');
    assert.ok(plan.stations.every((s) => s.synthesis.length > 0), 'structural synthesis exists');
    assert.ok(plan.stations.every((s) => s.citations.every((c) => c.text.startsWith('Texto literal'))), 'structural citations still literal');
    assert.ok(plan.exam.feynman.length > 0, 'exam fallback exists');
    assert.ok(plan.stoppedReason && plan.stoppedReason.length > 0, 'degradation recorded');
    assert.equal(plan.contrasts.rows.length, plan.stations.length, 'fallback contrasts complete');
  }

  // Station research must run before writing, and its fresh citations must reach
  // both the writer and the output policy. Verification precedes persistence.
  {
    const material = makeMaterial();
    const deps = happyDeps(material);
    const write = deps.writeStation;
    let prepared = 0, verified = 0;
    deps.prepareStation = async (spec, corpus) => {
      const id = `late-station-${++prepared}`;
      corpus.passages.push({ ...corpus.passages[0], id, text: 'Fresh literal evidence collected for this station.' });
      spec.passageIds = [id];
    };
    deps.writeStation = async input => {
      assert.ok(input.passages[0].id.startsWith('late-station-'));
      return write(input);
    };
    const phases = [];
    deps.verifyPlan = async plan => { assert.ok(!phases.includes('done')); verified++; return { ...plan, overview: 'Verified overview' }; };
    const plan = await orchestrateImmersion({ topic: material.topic, language: 'es', minutes: 90, includeQuiz: true, model: null }, deps, p => phases.push(p.phase));
    assert.equal(phases.at(-1), 'done');
    assert.equal(prepared, plan.stations.length);
    assert.equal(verified, 1);
    assert.equal(plan.overview, 'Verified overview');
    assert.ok(plan.stations.every(station => station.citations.some(c => c.text === 'Fresh literal evidence collected for this station.')));
    phases.length = 0;
    deps.verifyPlan = async () => { throw new Error('verification unavailable'); };
    await assert.rejects(() => orchestrateImmersion({ topic: material.topic, language: 'es', minutes: 90, includeQuiz: true, model: null }, deps, p => phases.push(p.phase)), /verification unavailable/);
    assert.ok(!phases.includes('done'), 'Failed verification never announces a ready lesson');
  }

  // ── No material → clean error ───────────────────────────────────────────────
  {
    const empty = { ...makeMaterial(0, 0), ideas: [], passages: [] };
    await assert.rejects(
      orchestrateImmersion({ topic: 'x', language: 'es', minutes: 150, includeQuiz: true, model: null }, happyDeps(empty)),
      /No hay material relevante/,
      'empty corpus raises a clear error'
    );
  }

  // ── Citation policy unit ────────────────────────────────────────────────────
  {
    const material = makeMaterial(4, 2);
    const catalog = buildCitationCatalog(material);
    const out = applyCitationPolicy('Ver [A](nodus://idea/g-0) y [B](nodus://idea/zzz) y [C](nodus://passage/p-1).', catalog);
    assert.ok(out.includes('[A](nodus://idea/g-0)'), 'known idea kept');
    assert.ok(out.includes('[C](nodus://passage/p-1)'), 'known passage kept');
    assert.ok(!out.includes('nodus://idea/zzz') && out.includes('B'), 'unknown stripped to label');
  }

  // ── Bare-citation repair: raw nodus:// urls never reach the reader ──────────
  {
    const material = makeMaterial(4, 2);
    const labels = buildCitationLabels(material);
    const raw = [
      'Una idea suelta (nodus://idea/g-1) en paréntesis.',
      'Un enlace roto [García (1961)] (nodus://idea/g-2).',
      'Un pasaje pelado nodus://passage/p-0 al final.',
      'Uno correcto [Bien](nodus://idea/g-0) queda igual.',
    ].join(' ');
    const out = normalizeBareCitations(raw, labels);
    assert.ok(out.includes('([Idea 1](nodus://idea/g-1))'), 'bare url in parens becomes a labelled link');
    assert.ok(out.includes('[García (1961)](nodus://idea/g-2)'), 'spaced markdown link is repaired');
    assert.ok(/\[[^\]]+\]\(nodus:\/\/passage\/p-0\)/.test(out), 'bare passage url becomes a labelled link');
    assert.ok(out.includes('[Bien](nodus://idea/g-0)'), 'valid links untouched');
    assert.ok(!/(?<!\]\()nodus:\/\//.test(out.replace(/\]\(nodus:\/\/[^)]+\)/g, '')), 'no raw nodus:// text remains');
    // The whole repaired string survives the policy (all urls are in catalog).
    const policed = applyCitationPolicy(out, buildCitationCatalog(material));
    assert.ok(policed.includes('(nodus://idea/g-1)'), 'repaired citations pass the policy');
  }

  console.log('IMMERSION CORE TESTS OK');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
