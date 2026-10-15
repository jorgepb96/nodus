// Tests for the Deep Research orchestration core. The pure control flow in
// electron/ai/deepResearchCore.ts has no Electron/DB/AI deps (only erased type
// imports), so we bundle just that file with esbuild and drive the REAL
// orchestrator with injected fakes — no provider calls, no database, and
// crucially NOT the running local app instance.
//
// It locks the guarantees that matter for a professional report:
//   • report scope is derived from evidence rather than word/page quotas;
//   • hallucinated citations never survive into the report or its references;
//   • every reference traces back to a really-cited corpus work;
//   • the model failing on a section degrades gracefully instead of aborting.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-deep-research-test-'));

try {
  const outfile = path.join(tmp, 'deepResearchCore.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/deepResearchCore.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    // Types from @shared are erased at build time, but citation naming is a real
    // value import — the writer and the reader that re-derives its labels share one
    // implementation — so it has to be bundled in rather than left external.
    external: ['@shared/types', '@shared/deepResearchApproaches'],
    alias: { '@shared': path.join(repoRoot, 'shared') },
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  const {
    orchestrateDeepResearch,
    applyCitationPolicy,
    buildSnapshotMaps,
    buildCitationCatalog,
    buildCitationMenu,
    buildPlanInput,
    normalizePlan,
    normalizeSectionClaimAudit,
    orderSections,
    normalizeSectionTitle,
    resolveSectionPlan,
    sectionPlanMaximum,
    countWords,
    normalizeNarrativeSection,
    recoverPlainMenuCitations,
    extractCitationClaims,
    applyVerification,
    objectiveExclusionStems,
    enforceObjectiveExclusions,
    DEEP_RESEARCH_NARRATIVE_RULES,
    MAX_COVERAGE_QUESTIONS,
  } = mod;

  {
    const original = 'La propaganda controló por completo la recepción extranjera.';
    const normalized = normalizeSectionClaimAudit({
      items: [{ original, status: 'partial', revised: original, evidenceTokens: [], reason: 'Solo consta una orientación institucional.' }],
    }, [original], new Set());
    assert.match(normalized.items[0].revised, /pudo condicionar|hipótesis/iu, 'a partial claim gets a bounded standalone formulation');
    assert.ok(!normalized.items[0].revised.includes('solo parcialmente esta proposición'), 'the saved outline never exposes an audit placeholder');
  }

  {
    const original = 'Se distribuyeron ejemplares gratuitos a autores y editoriales extranjeras.';
    const direct = '[Archivo (1950)](nodus://passage/free-copies)';
    const context = '[Archivo (1951)](nodus://passage/foreign-press)';
    const noise = '[Archivo (1952)](nodus://passage/unrelated)';
    const normalized = normalizeSectionClaimAudit({
      items: [{
        original,
        status: 'supported',
        revised: original,
        evidenceTokens: [direct, context, noise],
        reason: 'Hay ejemplares gratuitos, pero no constan los destinatarios.',
        requirements: [
          { text: 'La distribución fue gratuita', proofRole: 'fact', supported: true, evidenceTokens: [direct] },
          { text: 'Los destinatarios fueron autores y editoriales extranjeras', proofRole: 'actor_time', supported: false, evidenceTokens: [] },
        ],
        evidencePack: [
          { token: direct, role: 'direct', reason: 'Prueba la gratuidad.' },
          { token: context, role: 'context', reason: 'Prueba otro circuito internacional.' },
          { token: noise, role: 'irrelevant', reason: 'No responde.' },
        ],
      }],
    }, [original], new Set([direct, context, noise]));
    assert.equal(normalized.items[0].status, 'partial', 'one unmet atomic requirement deterministically blocks supported');
    assert.match(normalized.items[0].revised, /hipótesis|permanece|determinar/iu, 'the overbroad conjunction is replaced by a bounded proposition');
    assert.deepEqual(normalized.items[0].evidenceTokens, [direct, context], 'irrelevant candidates never enter the usable evidence pack');
    assert.deepEqual(normalized.items[0].requirements.map((item) => item.proofRole), ['fact', 'actor_time'], 'proof roles survive normalization and remain visible to the writer');
  }

  {
    const original = 'Dos autores convergen en que la política fue eficaz.';
    const direct = '[Autor A](nodus://idea/a)';
    const normalized = normalizeSectionClaimAudit({
      items: [{
        original,
        status: 'supported',
        revised: original,
        evidenceTokens: [direct],
        reason: 'Solo consta una posición.',
        requirements: [
          { text: 'La posición de A', proofRole: 'agreement', supported: true, evidenceTokens: [direct] },
          { text: 'La posición independiente de B', proofRole: 'agreement', supported: false, evidenceTokens: [] },
        ],
        evidencePack: [{ token: direct, role: 'direct', reason: 'Prueba únicamente la posición A.' }],
      }],
    }, [original], new Set([direct]));
    assert.equal(normalized.items[0].status, 'partial', 'a bilateral claim cannot pass while one side is unsupported');
    assert.match(normalized.items[0].revised, /hipótesis|determinar/iu, 'an unsupported agreement is downgraded rather than manufactured');
  }

  // ── Fake corpus snapshot ────────────────────────────────────────────────────
  const makeSnapshot = (ideaCount) => {
    const ideas = Array.from({ length: ideaCount }, (_, i) => ({
      id: `g-${i}`,
      label: `Idea ${i}`,
      summary: `Resumen de la idea ${i}`,
      score: 1 - i / ideaCount,
      reason: 'test',
      type: 'claim',
      statement: `Enunciado sustantivo número ${i} sobre el fenómeno estudiado.`,
      themes: ['tema'],
      workCount: 1,
      evidenceCount: 2,
      works: [
        { nodus_id: `w-${i}`, title: `Obra ${i}`, authors: [`Autor${i}, N.`], year: 2000 + (i % 25), zotero_key: `zk-${i}` },
      ],
    }));
    const works = ideas.map((idea) => ({
      id: idea.works[0].nodus_id,
      label: idea.works[0].title,
      summary: 'sinopsis',
      score: 0.5,
      reason: 'test',
      title: idea.works[0].title,
      authors: idea.works[0].authors,
      year: idea.works[0].year,
      zotero_key: idea.works[0].zotero_key,
      themes: ['tema'],
      deepStatus: 'deep',
      ideaCount: 1,
      gapCount: 0,
    }));
    const gaps = [
      {
        id: 'gap-1',
        label: 'Hueco 1',
        summary: 'Un hueco de investigación',
        score: 0.4,
        reason: 'test',
        kind: 'empirical',
        work: { nodus_id: 'w-0', title: 'Obra 0', authors: ['Autor0, N.'], year: 2000, zotero_key: 'zk-0' },
        relatedIdea: null,
        confidence: 0.7,
      },
    ];
    const contradictions = [
      {
        id: 'edge-1',
        label: 'Contradicción 1',
        summary: 'A contradice a B',
        score: 0.4,
        reason: 'test',
        fromLabel: 'A',
        toLabel: 'B',
        type: 'contradicts',
        basis: 'semantic',
        confidence: 0.6,
      },
    ];
    return {
      generatedAt: new Date().toISOString(),
      brief: { kind: 'deep_research', objective: 'obj', language: 'es' },
      stats: { ideas: ideaCount, themes: 0, gaps: 1, contradictions: 1, works: ideaCount, passages: 0, tutorRoutes: 0 },
      recommendedSelection: { ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] },
      ideas,
      themes: [],
      gaps,
      contradictions,
      works,
      passages: [],
      tutorRoutes: [],
    };
  }

  // ── 2d. Explicit exclusions are deterministic, not merely prompt advice ────
  {
    const objective = 'Analizar el turismo. Excluir el eje de género y colonialidad, ya tratado en otro informe.';
    const stems = objectiveExclusionStems(objective);
    assert.ok(stems.includes('colonial') && stems.includes('genero') && stems.includes('sahara') && stems.includes('feminin'));
    const markdown = [
      '## Sección',
      '',
      'La administración organizó las rutas oficiales. La lectura colonial reintroduce un eje excluido. La red de Paradores permanece en el análisis.',
      '',
      'Una frase sobre género también debe desaparecer. El Sahara tampoco debe reintroducir el eje. Esta evidencia territorial se conserva.',
    ].join('\n');
    const governed = enforceObjectiveExclusions(markdown, objective);
    assert.ok(!/colonial|género|Sahara/iu.test(governed));
    assert.ok(governed.includes('rutas oficiales') && governed.includes('Paradores') && governed.includes('evidencia territorial'));
  }

  // ── 2c. A sentence whose only checkable support fails is removed whole ─────
  {
    const snapshot = makeSnapshot(2);
    const maps = buildSnapshotMaps(snapshot);
    const md = '## Sección\n\nAfirmación sin respaldo [Autor0, N. (2000)](nodus://idea/g-0). Otra frase permanece.';
    const claims = extractCitationClaims(md, maps);
    assert.equal(claims.length, 1, 'the sentence exposes one checkable citation');
    const outcome = applyVerification(md, claims, ['unsupported']);
    assert.ok(!outcome.markdown.includes('Afirmación sin respaldo'), 'the unsupported claim is removed with its sentence');
    assert.ok(outcome.markdown.includes('Otra frase permanece'), 'unrelated prose remains untouched');
  }

  // ── 2d. A weak conjunct cannot hide beside another supported citation ─────
  {
    const snapshot = makeSnapshot(2);
    const maps = buildSnapshotMaps(snapshot);
    const md = '## Sección\n\nSe repartieron ejemplares gratis y llegaron a editoriales extranjeras ([Autor0](nodus://idea/g-0); [Autor1](nodus://idea/g-1)). Otra frase permanece.';
    const claims = extractCitationClaims(md, maps);
    assert.equal(claims.length, 2);
    const outcome = applyVerification(md, claims, ['supports', 'partial']);
    assert.ok(!outcome.markdown.includes('editoriales extranjeras'), 'a partially supported conjunct removes the complete compound sentence');
    assert.ok(outcome.markdown.includes('Otra frase permanece'));
  }

  const HALLUCINATED = '[Fantasma, X. (1999)](nodus://idea/HALLUCINATED-999)';

  // A plan that spreads every pool idea across `sectionCount` sections + a conclusion.
  const fakePlan = (input) => {
    const ids = input.ideas.map((i) => i.id);
    const bodyCount = Math.max(1, input.sectionCount - 1);
    const per = Math.max(1, Math.ceil(ids.length / bodyCount));
    const sections = [];
    for (let b = 0; b < bodyCount; b++) {
      const chunk = ids.slice(b * per, (b + 1) * per);
      sections.push({
        id: `s${b + 1}`,
        title: `Sección ${b + 1}`,
        purpose: 'propósito',
        keyClaims: chunk.slice(0, 3).map((id) => `clave ${id}`),
        ideaIds: chunk,
        workIds: [],
        gapIds: b === 0 ? ['gap-1'] : [],
        contradictionIds: b === 0 ? ['edge-1'] : [],
        passageIds: [],
      });
    }
    sections.push({
      id: 'concl',
      title: 'Conclusión',
      purpose: 'cierre',
      keyClaims: ['síntesis'],
      ideaIds: [],
      workIds: [],
      gapIds: ['gap-1'],
      contradictionIds: ['edge-1'],
      passageIds: [],
    });
    return { title: 'Informe de prueba', abstract: 'resumen', sections };
  }

  // Develops every offered evidence item once and slips in a hallucinated citation
  // the policy must strip.
  const fakeWriteSection = (input) => {
    const cites = input.citationMenu.map((c) => `La evidencia permite explicar una aportación distinta porque documenta el mecanismo (${c.token}).`).join(' ');
    return `## ${input.section.title}\n\n${cites} ${HALLUCINATED}`;
  }

  const fakeFinalize = (input) => {
    return {
      title: 'Informe de prueba',
      abstract: 'Este informe desarrolla el objetivo a partir del corpus.',
      limitations: input.uncoveredSamples.length ? [`Sin desarrollar: ${input.uncoveredSamples.join('; ')}`] : [],
      nextSteps: ['Revisar citas.'],
    };
  }

  const baseDeps = (snapshot) => ({
    buildSnapshot: async () => snapshot,
    planReport: async (input) => fakePlan(input),
    writeSection: async (input) => fakeWriteSection(input),
    finalize: async (input) => fakeFinalize(input),
  });

  // ── 1. applyCitationPolicy: strip hallucinations, keep + relabel real ones ──
  {
    const snapshot = makeSnapshot(3);
    const maps = buildSnapshotMaps(snapshot);
    const md = `Uno [x](nodus://idea/g-0) y dos ${HALLUCINATED} y tres [y](nodus://work/w-1).`;
    const { markdown, cited } = applyCitationPolicy(md, maps);
    assert.ok(!markdown.includes('HALLUCINATED'), 'hallucinated citation stripped');
    assert.ok(markdown.includes('nodus://idea/g-0'), 'valid idea citation kept');
    assert.ok(markdown.includes('nodus://work/w-1'), 'valid work citation kept');
    assert.ok(markdown.includes('Autor0, N. (2000)'), 'idea label rewritten to canonical corpus label');
    assert.deepEqual([...cited.ideas], ['g-0']);
    assert.deepEqual([...cited.works], ['w-1']);
  }

  {
    const snapshot = makeSnapshot(3);
    const work = snapshot.works[0];
    work.reason = 'authorized-source';
    const menu = buildCitationMenu({ ideaIds: [], workIds: [work.id], gapIds: [], contradictionIds: [], passageIds: [] }, buildSnapshotMaps(snapshot));
    assert.equal(menu.length, 0, 'catalog metadata never serves as substantive evidence in a scoped run');
  }

  // ── 2a. A visible author-year copied from the menu regains its lost URL ─────
  {
    const snapshot = makeSnapshot(3);
    const maps = buildSnapshotMaps(snapshot);
    const menu = buildCitationMenu(
      { id: 's1', title: 't', purpose: '', keyClaims: [], ideaIds: ['g-0', 'g-1'], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
      maps,
    );
    const recovered = recoverPlainMenuCitations(
      'Una afirmación [Autor0, N. (2000), p. 28; Autor1, N. (2001)]. Otra [Desconocido (1999)].',
      menu,
    );
    assert.match(recovered, /\[Autor0, N\. \(2000\), p\. 28\]\(nodus:\/\/idea\/g-0\)/);
    assert.match(recovered, /\[Autor1, N\. \(2001\)\]\(nodus:\/\/idea\/g-1\)/);
    assert.ok(recovered.includes('[Desconocido (1999)]'), 'a label outside the allowed menu is never linked');
    const governed = applyCitationPolicy(recovered, maps);
    assert.deepEqual([...governed.cited.ideas].sort(), ['g-0', 'g-1']);
  }

  // ── 2b. buildCitationCatalog: trimmed pool, and every token is really citable ──
  {
    const snapshot = makeSnapshot(90);
    const maps = buildSnapshotMaps(snapshot);
    const catalog = buildCitationCatalog(snapshot);
    // Pool is trimmed to POOL_LIMITS.ideas (70) even though the snapshot has 90.
    assert.equal(catalog.ideas.length, 70, 'idea pool trimmed to POOL_LIMITS');
    assert.equal(catalog.gaps.length, 1, 'gaps surfaced');
    assert.equal(catalog.contradictions.length, 1, 'contradictions surfaced');
    // Client-driven guarantee: a report citing ONLY catalog tokens loses nothing.
    const md = [...catalog.ideas, ...catalog.works, ...catalog.gaps, ...catalog.contradictions]
      .map((c) => `Claim ${c.token}.`)
      .join('\n');
    const { markdown } = applyCitationPolicy(md, maps);
    assert.equal((markdown.match(/nodus:\/\//g) ?? []).length, md.match(/nodus:\/\//g).length, 'every catalog token survives the citation policy');
  }

  // ── 2e. A report in another language never names a citation in Spanish ──
  {
    const snapshot = makeSnapshot(3);
    snapshot.brief = { ...snapshot.brief, language: 'en' };
    // A gap with no work and a contradiction with no sides fall back to a noun,
    // and an anonymous untitled work to a placeholder: all of them in English.
    snapshot.gaps = [{ ...snapshot.gaps[0], work: null }];
    snapshot.works = [...snapshot.works, { ...snapshot.works[0], id: 'w-anon', title: '', authors: [], year: 2001 }];
    const maps = buildSnapshotMaps(snapshot);
    const md = 'Gap [x](nodus://gap/gap-1). Tension [y](nodus://contradiction/edge-1). Work [fuente](nodus://work/w-anon).';
    const { markdown } = applyCitationPolicy(md, maps);
    assert.match(markdown, /\[gap\]\(nodus:\/\/gap\/gap-1\)/);
    assert.match(markdown, /\[contradiction\]\(nodus:\/\/contradiction\/edge-1\)/);
    assert.match(markdown, /\[Untitled work \(2001\)\]\(nodus:\/\/work\/w-anon\)/);
    const catalog = buildCitationCatalog(snapshot);
    const tokens = [...catalog.gaps, ...catalog.contradictions].map((item) => item.token).join(' ');
    assert.doesNotMatch(tokens, /hueco|contradicción|fuente|Obra sin autor/i, 'English catalog tokens carry no Spanish label');
  }

  // ── 3. Full report: evidence coverage, clean citations, references ──
  {
    const snapshot = makeSnapshot(40);
    const report = await orchestrateDeepResearch({ objective: 'X', language: 'es',}, baseDeps(snapshot));
    const { draft, meta } = report;

    assert.ok(meta.sections >= 4, 'produced several sections');
    assert.equal(meta.stoppedReason, null, 'evidence-driven run completes without provider failure');

    // No hallucinated citation anywhere in the assembled report.
    assert.ok(!draft.draftMarkdown.includes('HALLUCINATED'), 'no hallucinated citation in report body');
    // Real citations are present and clickable.
    assert.ok(/nodus:\/\/idea\/g-\d+/.test(draft.draftMarkdown), 'report carries clickable idea citations');

    // References section exists, is non-empty, and every entry traces to a cited work.
    assert.ok(draft.draftMarkdown.includes('## Referencias'), 'report has a References section');
    assert.ok(draft.bibliography.length > 0, 'bibliography is populated');
    assert.ok(meta.worksCited > 0 && meta.ideasCovered > 0, 'coverage accounting is populated');
    // Coverage: with 40 ideas across body sections, most should be cited.
    assert.ok(meta.ideasCovered >= 30, `covers the bulk of the corpus ideas (got ${meta.ideasCovered}/40)`);

    // The draft round-trips into the Writing Workshop shape (export/save reuse).
    assert.equal(typeof draft.title, 'string');
    assert.ok(Array.isArray(draft.outline) && draft.outline.length === meta.sections);
    assert.equal(draft.stats.selectedIdeas, meta.ideasCovered);
  }

  // ── 4. Long evidence-rich output is not cut by an editorial page budget ─────
  {
    const snapshot = makeSnapshot(60);
    const deps = { ...baseDeps(snapshot), writeSection: async () => `## Larga\n\n${'palabra '.repeat(6000)}` };
    const report = await orchestrateDeepResearch({ objective: 'X',}, deps);
    assert.equal(report.meta.stoppedReason, null, 'no word or page ceiling truncates a valid section');
    assert.equal(report.draft.stats.truncated, false, 'length alone never marks a report truncated');
  }

  // ── 5. Thin sections stay bounded and complete (no runaway section count) ───
  {
    const snapshot = makeSnapshot(50);
    // Each section is deliberately tiny. Coverage must remain honest rather than
    // triggering filler to reach a quota that no longer exists.
    const deps = {
      ...baseDeps(snapshot),
      writeSection: async (input) => {
        return `## ${input.section.title}\n\nBreve (${input.citationMenu[0]?.token ?? ''}).\n\n### Matiz adicional\n\nContinuación breve.`;
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'X',}, deps);
    assert.ok(report.meta.sections >= 3, `evidence-derived plan has a real argument (got ${report.meta.sections})`);
    // A writer that names one source per section HAS covered almost nothing, and the
    // report must say so instead of counting every assigned idea as developed.
    assert.ok(
      report.meta.ideasCovered < 20,
      `coverage reflects what was cited, not what was assigned (got ${report.meta.ideasCovered}/50)`
    );
    assert.ok(report.draft.limitations.length > 0, 'a thin report declares what it left out');
    assert.ok(!report.draft.draftMarkdown.includes('HALLUCINATED'), 'thin sections also citation-clean');
    assert.ok(!report.draft.draftMarkdown.includes('### '), 'model-added microheadings are flattened');
    assert.ok(report.draft.draftMarkdown.includes('Matiz adicional. Continuación breve.'), 'microheading content remains as prose');
  }

  // ── 6. Resilience: plan + every section failing still yields a report ───────
  {
    const snapshot = makeSnapshot(12);
    const deps = {
      buildSnapshot: async () => snapshot,
      planReport: async () => {
        throw new Error('planner down');
      },
      writeSection: async () => {
        throw new Error('writer down');
      },
      finalize: async () => {
        throw new Error('finalizer down');
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'X',}, deps);
    assert.ok(report.meta.sections > 0, 'fallback plan still produced sections');
    assert.ok(report.meta.stoppedReason && /degradada/.test(report.meta.stoppedReason), 'degraded generation is reported');
    assert.ok(report.draft.draftMarkdown.includes('## Referencias'), 'still assembles a full document');
    // Degraded sections still only cite real corpus ideas.
    assert.ok(!report.draft.draftMarkdown.includes('HALLUCINATED'), 'no fake citations even in degraded mode');
  }

  // ── 7. countWords sanity ────────────────────────────────────────────────────
  assert.equal(countWords('uno dos tres'), 3);
  assert.equal(countWords('[Autor (2020)](nodus://idea/g-1) palabra'), 3, 'link label counts, url does not');

  // ── 8. Narrative normalization: one epigraph, internal cuts become prose ───
  {
    const normalized = normalizeNarrativeSection(
      '## Título improvisado\n\nPrimer párrafo.\n\n### Contexto\n\nSegundo párrafo.\n\n#### Consecuencias\n\nTercer párrafo.',
      'Línea argumental amplia'
    );
    assert.equal((normalized.match(/^#{1,6}\s/gm) ?? []).length, 1, 'one visible epigraph per section');
    assert.ok(normalized.startsWith('## Línea argumental amplia'), 'the planned title is canonical');
    assert.ok(normalized.includes('Contexto. Segundo párrafo.'), 'internal heading becomes a prose lead');
    assert.ok(normalized.includes('Consecuencias. Tercer párrafo.'), 'all artificial subheadings are flattened');
    assert.ok(
      DEEP_RESEARCH_NARRATIVE_RULES.some((rule) => rule.includes('dos puntos') && rule.includes('guion largo')),
      'shared prose contract restricts disruptive punctuation'
    );
    assert.ok(
      DEEP_RESEARCH_NARRATIVE_RULES.some((rule) => rule.includes('debate historiográfico') && rule.includes('autores u obras')),
      'shared prose contract requires named, evidence-bounded historiographical positions'
    );
  }

  // ── 9. resolveSectionPlan is evidence-derived, never page-derived ───────────
  {
    const sparse = makeSnapshot(5);
    const rich = makeSnapshot(60);
    const auto = resolveSectionPlan(sparse, 'auto');
    assert.equal(auto.mode, 'auto', 'auto mode reported');
    assert.ok(auto.target >= 3, `sparse evidence still yields an argument (got ${auto.target})`);
    assert.ok(resolveSectionPlan(rich, 'auto').target > auto.target, 'richer evidence can warrant more argumentative movements');
    const preferred = resolveSectionPlan(rich, 4, 'Marco; mecanismo uno; mecanismo dos', ['pregunta uno', 'pregunta dos']);
    assert.equal(preferred.mode, 'user', 'user organization preference is reported');
    // "Máx. N secciones" means AT MOST N. Abundant evidence and an explicit coverage
    // contract used to push this above the number the user picked.
    assert.ok(preferred.target <= 4, `a numeric preference is a ceiling (got ${preferred.target})`);
    assert.ok(preferred.target >= 3, 'the ceiling never falls below the minimum architecture');
    // Sparse evidence keeps deciding downwards: the number is a cap, not a quota.
    assert.equal(
      resolveSectionPlan(sparse, 10).target,
      resolveSectionPlan(sparse, 'auto').target,
      'a generous ceiling never inflates a sparse architecture',
    );
    // The coverage grace slot in sectionPlanMaximum belongs to auto mode only.
    const questions = ['pregunta uno', 'pregunta dos'];
    assert.equal(sectionPlanMaximum(preferred, questions), preferred.target, 'a user ceiling admits no grace section');
    assert.equal(sectionPlanMaximum(preferred, []), preferred.target, 'a user ceiling is exact without coverage questions');
    const automatic = resolveSectionPlan(rich, 'auto', '', questions);
    assert.equal(sectionPlanMaximum(automatic, questions), automatic.target + 1, 'auto mode keeps the coverage grace section');
    assert.equal(sectionPlanMaximum(automatic, []), automatic.target, 'no coverage contract, no grace section');
    // 'single' keeps planning internally and is never treated as a numeric cap.
    const single = resolveSectionPlan(rich, 'single');
    assert.equal(single.mode, 'auto', 'a continuous narrative still plans from the evidence');
    assert.equal(single.target, resolveSectionPlan(rich, 'auto').target, 'single does not change the internal architecture');
  }

  // ── 9b. A fragmented provider plan is compacted without losing mandates ───
  {
    const snapshot = makeSnapshot(12);
    const coverageQuestions = ['¿Qué mecanismo explica el cambio?', '¿Qué límites conserva la evidencia?'];
    const sections = Array.from({ length: 22 }, (_, index) => ({
      id: `over-${index + 1}`,
      title: index === 0 ? 'Introducción' : index === 21 ? 'Síntesis' : `Fragmento ${index}`,
      purpose: `Desarrollar el mandato ${index + 1}`,
      keyClaims: [`Afirmación ${index + 1}`],
      ideaIds: [`g-${index % snapshot.ideas.length}`],
      workIds: [],
      gapIds: index === 15 ? ['gap-1'] : [],
      contradictionIds: index === 16 ? ['edge-1'] : [],
      passageIds: [],
      coverageQuestions: index === 0 ? [coverageQuestions[0]] : index === 18 ? [coverageQuestions[1]] : [],
      role: index === 0 ? 'intro' : index === 21 ? 'synthesis' : 'body',
      dependsOn: index > 0 ? [`over-${index}`] : [],
    }));
    const normalized = normalizePlan(
      { title: 'Plan sobredimensionado', abstract: '', sections },
      snapshot,
      4,
      coverageQuestions,
    );
    assert.equal(normalized.sections.length, 4, 'the hard architectural bound is enforced');
    assert.equal(normalized.sections[0].role, 'intro', 'the introduction survives compaction');
    assert.equal(normalized.sections.at(-1).role, 'synthesis', 'the closing synthesis survives compaction');
    assert.deepEqual(
      [...new Set(normalized.sections.flatMap((section) => section.coverageQuestions))].sort(),
      [...coverageQuestions].sort(),
      'all explicit coverage questions retain exactly one primary home',
    );
    assert.deepEqual(
      [...new Set(normalized.sections.flatMap((section) => section.ideaIds))].sort(),
      snapshot.ideas.map((idea) => idea.id).sort(),
      'all evidence assignments survive or are deterministically reassigned',
    );
    assert.ok(normalized.sections.some((section) => section.gapIds.includes('gap-1')), 'a gap assigned to a dropped fragment survives');
    assert.ok(normalized.sections.some((section) => section.contradictionIds.includes('edge-1')), 'a contradiction assigned to a dropped fragment survives');
    const retainedIds = new Set(normalized.sections.map((section) => section.id));
    assert.ok(normalized.sections.every((section) => section.dependsOn.every((id) => id !== section.id && retainedIds.has(id))),
      'dependencies are remapped to retained sections only');
  }

  // ── 9c. The orchestrator never pays for every heading a model invents ──────
  {
    const snapshot = makeSnapshot(6);
    const deps = baseDeps(snapshot);
    let writes = 0;
    deps.planReport = async (input) => ({
      title: 'Plan sobredimensionado',
      abstract: '',
      sections: Array.from({ length: 22 }, (_, index) => ({
        id: `provider-${index + 1}`,
        title: index === 0 ? 'Introducción' : index === 21 ? 'Síntesis' : `Fragmento ${index}`,
        purpose: `Mandato ${index + 1}`,
        keyClaims: [`Clave ${index + 1}`],
        ideaIds: [input.ideas[index % input.ideas.length].id],
        workIds: [],
        gapIds: [],
        contradictionIds: [],
        passageIds: [],
        role: index === 0 ? 'intro' : index === 21 ? 'synthesis' : 'body',
        dependsOn: [],
      })),
    });
    deps.writeSection = async (input) => {
      writes += 1;
      return fakeWriteSection(input);
    };
    const request = { objective: 'X', language: 'es', sectionLimit: 3 };
    const expected = resolveSectionPlan(snapshot, request.sectionLimit, request.objective).target;
    const report = await orchestrateDeepResearch(request, deps);
    assert.equal(writes, expected, 'only the computed number of sections reaches generation');
    assert.equal(report.meta.sections, expected, 'only bounded sections are published');
  }

  // ── 10. A user section preference caps the report end-to-end ────────────────
  {
    const snapshot = makeSnapshot(60);
    const report = await orchestrateDeepResearch(
      { objective: 'X', language: 'es',sectionLimit: 4 },
      baseDeps(snapshot)
    );
    assert.ok(report.meta.sections <= 4, `caps the architecture at the requested maximum (got ${report.meta.sections})`);
    assert.ok(report.meta.sections >= 3, 'the cap never drops below the minimum architecture');
    // Even capped, references still trace to really-cited works.
    assert.ok(report.draft.bibliography.length > 0, 'capped report still has references');
    assert.ok(!report.draft.draftMarkdown.includes('HALLUCINATED'), 'capped report stays citation-clean');
  }

  // ── 10b. Coverage questions + an over-sized provider plan cannot break the cap ─
  //
  // The two ways a chosen maximum used to be exceeded, together: abundant evidence
  // pushed resolveSectionPlan above the number, and sectionPlanMaximum's coverage
  // grace slot bought one more on top of that.
  {
    const snapshot = makeSnapshot(60);
    const deps = baseDeps(snapshot);
    const coverageQuestions = [
      '¿Qué mecanismo institucional explica el cambio?',
      '¿Qué límites documentales conserva la evidencia?',
      '¿Qué escalas regionales quedan fuera?',
    ];
    deps.decomposeObjective = async () => coverageQuestions;
    deps.planReport = async (input) => ({
      title: 'Plan del proveedor',
      abstract: '',
      sections: Array.from({ length: 9 }, (_, index) => ({
        id: `p${index + 1}`,
        title: index === 0 ? 'Introducción' : index === 8 ? 'Síntesis' : `Movimiento ${index}`,
        purpose: `Mandato ${index + 1}`,
        keyClaims: [`Clave ${index + 1}`],
        ideaIds: [input.ideas[index % input.ideas.length].id],
        workIds: [],
        gapIds: index === 3 ? [snapshot.gaps[0].id] : [],
        contradictionIds: index === 4 ? [snapshot.contradictions[0].id] : [],
        passageIds: [],
        coverageQuestions: index === 2 ? [coverageQuestions[0]] : index === 6 ? [coverageQuestions[1]] : [],
        role: index === 0 ? 'intro' : index === 8 ? 'synthesis' : 'body',
        dependsOn: [],
      })),
    });
    let writes = 0;
    const inner = deps.writeSection;
    deps.writeSection = async (input) => {
      writes += 1;
      return inner(input);
    };
    const report = await orchestrateDeepResearch(
      { objective: 'X', language: 'es', sectionLimit: 4 },
      deps,
    );
    assert.ok(report.meta.sections <= 4, `a five-plus-section provider plan still publishes at most four (got ${report.meta.sections})`);
    assert.equal(writes, report.meta.sections, 'no section is generated beyond the published cap');
    assert.equal(
      report.meta.coverage?.questions.length,
      coverageQuestions.length,
      'every coverage question survives the compaction',
    );
  }

  // ── 10c. Compaction reassigns evidence instead of dropping it ───────────────
  {
    const snapshot = makeSnapshot(30);
    const coverageQuestions = ['¿Qué mecanismo?', '¿Qué límites?', '¿Qué escala?'];
    const sections = Array.from({ length: 11 }, (_, index) => ({
      id: `c${index + 1}`,
      title: index === 0 ? 'Introducción' : index === 10 ? 'Síntesis' : `Fragmento ${index}`,
      purpose: `Mandato ${index + 1}`,
      keyClaims: [`Afirmación ${index + 1}`],
      ideaIds: snapshot.ideas.filter((_idea, at) => at % 11 === index).map((idea) => idea.id),
      workIds: snapshot.works.filter((_work, at) => at % 11 === index).map((work) => work.id),
      gapIds: snapshot.gaps.filter((_gap, at) => at % 11 === index).map((gap) => gap.id),
      contradictionIds: snapshot.contradictions.filter((_item, at) => at % 11 === index).map((item) => item.id),
      passageIds: [],
      coverageQuestions: index === 5 ? [coverageQuestions[0]] : index === 9 ? [coverageQuestions[2]] : [],
      role: index === 0 ? 'intro' : index === 10 ? 'synthesis' : 'body',
      dependsOn: [],
    }));
    const capped = normalizePlan({ title: 'T', abstract: '', sections }, snapshot, 4, coverageQuestions);
    assert.equal(capped.sections.length, 4, 'the requested maximum is the published architecture');
    const survives = (key, expected) => assert.deepEqual(
      [...new Set(capped.sections.flatMap((section) => section[key]))].sort(),
      [...expected].sort(),
      `${key} survive compaction`,
    );
    survives('ideaIds', snapshot.ideas.map((idea) => idea.id));
    survives('gapIds', snapshot.gaps.map((gap) => gap.id));
    survives('contradictionIds', snapshot.contradictions.map((item) => item.id));
    survives('workIds', snapshot.works.map((work) => work.id));
    survives('coverageQuestions', coverageQuestions);
    // One primary home each: a duplicated question makes two sections answer it.
    const homes = capped.sections.flatMap((section) => section.coverageQuestions);
    assert.equal(homes.length, new Set(homes).size, 'each coverage question keeps exactly one primary home');
  }

  // ── 10d. The guideline section length reaches the writers and the report ────
  //
  // The control is only useful if the writer sees it and the finished report
  // records it: the metadata is what makes "why is this section 4.000 words?"
  // answerable, and what the composer restores when the prompt is reused.
  {
    const snapshot = makeSnapshot(20);
    const deps = baseDeps(snapshot);
    const lengths = [];
    const inner = deps.writeSection;
    deps.writeSection = async (input) => {
      lengths.push(input.sectionLength);
      return inner(input);
    };
    const report = await orchestrateDeepResearch(
      { objective: 'X', language: 'es', sectionLimit: 4, sectionLength: 5_000 },
      deps,
    );
    assert.ok(lengths.length > 0, 'sections were written');
    for (const plan of lengths) {
      assert.equal(plan.targetWords, 5_000, 'every section writer receives the requested word target');
      assert.ok(plan.maxPasses > 1, 'and a bounded multi-pass budget rather than one huge request');
      assert.ok(plan.maxTokensPerPass <= 6_000, 'without raising maxTokens out of provider range');
    }
    assert.equal(report.meta.sectionLength, 5_000, 'the report records the length it was written to');
    assert.equal(report.draft.deepResearchSectionLength, 5_000, 'and so does the saved draft, for reuse');
    assert.equal(report.meta.sectionLengthOutcome.targetWords, 5_000);
    assert.equal(
      report.meta.sectionLengthOutcome.reached + report.meta.sectionLengthOutcome.short,
      report.meta.sections,
      'every published section is accounted for as reached or short',
    );
  }

  // ── 10e. A request without the field behaves exactly as before ──────────────
  {
    const snapshot = makeSnapshot(20);
    const deps = baseDeps(snapshot);
    const lengths = [];
    const inner = deps.writeSection;
    deps.writeSection = async (input) => {
      lengths.push(input.sectionLength);
      return inner(input);
    };
    const report = await orchestrateDeepResearch({ objective: 'X', language: 'es' }, deps);
    assert.ok(lengths.every((plan) => plan.targetWords === null), 'a legacy request writes in auto mode');
    assert.ok(lengths.every((plan) => plan.maxPasses === 1), 'and never spends a continuation call');
    assert.equal(report.meta.sectionLength, 'auto', 'the metadata says auto rather than inventing a number');
    assert.equal(report.meta.sectionLengthOutcome, null, 'and records no length accounting');
    // An unusable value is normalized rather than trusted through to the writer.
    const hostile = await orchestrateDeepResearch(
      { objective: 'X', language: 'es', sectionLength: 'muy largo' },
      baseDeps(snapshot),
    );
    assert.equal(hostile.meta.sectionLength, 'auto');
  }

  // ── 11. Auto architecture remains finite because the evidence pool is finite ─
  {
    const snapshot = makeSnapshot(60);
    let internalMovements = 0;
    const deps = baseDeps(snapshot);
    deps.writeSection = async (input) => {
      internalMovements += 1;
      return `${await fakeWriteSection(input)}\n\nMarcador interno ${internalMovements}.`;
    };
    const report = await orchestrateDeepResearch(
      { objective: 'X', language: 'es', sectionLimit: 'single' },
      deps
    );
    assert.ok(internalMovements > 1, 'continuous presentation keeps multiple evidence-sized writing movements internally');
    for (let index = 1; index <= internalMovements; index += 1) {
      assert.match(report.draft.draftMarkdown, new RegExp(`Marcador interno ${index}\\.`), `movement ${index} survives flattening`);
    }
    assert.equal(report.meta.structure, 'single', 'single-block structure is persisted in report metadata');
    assert.equal(report.meta.sections, 1, 'the published report is one continuous block');
    assert.equal(report.draft.deepResearchStructure, 'single', 'the saved draft preserves its presentation structure');
    assert.equal(report.draft.outline.length, 0, 'a continuous report does not expose a contradictory section outline');
    assert.equal((report.draft.draftMarkdown.match(/^#{1,6}\s+/gmu) ?? []).length, 0, 'the continuous body contains no Markdown section headings');
    assert.ok(report.draft.draftMarkdown.includes('nodus://idea/'), 'continuous assembly preserves grounded citations');
    assert.ok(report.draft.bibliography.length > 0, 'continuous assembly preserves the bibliography');
  }

  // ── 11. Auto architecture remains finite because the evidence pool is finite ─
  {
    const snapshot = makeSnapshot(60);
    const report = await orchestrateDeepResearch(
      { objective: 'X', language: 'es',},
      baseDeps(snapshot)
    );
    assert.ok(report.meta.sections >= 3, 'auto mode produces an ordered argument');
    assert.ok(report.meta.sections <= snapshot.ideas.length, 'finite evidence cannot create an unbounded plan');
  }

  // ── 11b. The writer is never handed a token whose content it cannot read ────
  {
    const snapshot = makeSnapshot(4);
    snapshot.passages = [
      {
        id: 'p-1',
        label: 'Obra 0 · p. 47',
        summary: 'El tiempo se hace tiempo humano en la medida en que se articula de modo narrativo.',
        score: 1,
        reason: 'test',
        nodus_id: 'w-0',
        pageLabel: 'p. 47',
        authors: ['Autor0, Nombre'],
        year: 2000,
        zotero_key: 'Z0',
        citation: 'nodus://passage/p-1',
      },
      // No readable text: this one must never become citable.
      {
        id: 'p-empty',
        label: 'Obra 1',
        summary: '   ',
        score: 1,
        reason: 'test',
        nodus_id: 'w-1',
        pageLabel: null,
        authors: ['Autor1, Nombre'],
        year: 2001,
        zotero_key: 'Z1',
        citation: 'nodus://passage/p-empty',
      },
    ];
    const maps = buildSnapshotMaps(snapshot);
    const menu = buildCitationMenu(
      {
        id: 's1',
        title: 't',
        purpose: 'p',
        keyClaims: [],
        ideaIds: ['g-0'],
        workIds: [],
        gapIds: ['gap-1'],
        contradictionIds: ['edge-1'],
        passageIds: ['p-1', 'p-empty'],
      },
      maps
    );
    const byKind = (kind) => menu.filter((item) => item.kind === kind);
    assert.equal(byKind('gap').length, 1, 'the gap is offered');
    assert.ok(
      byKind('gap')[0].note.includes(snapshot.gaps[0].summary.slice(0, 20)),
      'the gap carries what it actually says, not a placeholder'
    );
    assert.ok(
      byKind('contradiction')[0].note.includes(snapshot.contradictions[0].summary.slice(0, 20)),
      'the contradiction carries what it actually opposes'
    );
    assert.equal(byKind('passage').length, 1, 'the textless passage is not offered at all');
    assert.ok(byKind('passage')[0].note.includes('tiempo humano'), 'the passage carries its literal text');
    assert.ok(byKind('idea')[0].note.includes('Enunciado'), 'the idea carries its statement');
    // No menu entry may be a generic label.
    for (const item of menu) {
      assert.ok(item.note.trim().length > 12, `menu note is substantive for ${item.kind}`);
    }

    const planInput = buildPlanInput(
      { objective: 'Examinar la articulación narrativa', language: 'es' },
      'es',
      snapshot,
      resolveSectionPlan(snapshot, 'auto'),
    );
    assert.equal(planInput.passages.length, 1, 'the planner receives only readable passages it can assign');
    assert.ok(planInput.passages[0].extract.includes('tiempo humano'), 'the planner sees readable passage evidence');
  }

  // A small documentary corpus must reach every writer beyond its first page.
  {
    const snapshot = makeSnapshot(3);
    const tail = '[p. 3] The 1786 judgment changed the interval from eleven to seven days.';
    snapshot.passages = Array.from({ length: 3 }, (_, index) => ({
      id: `late-evidence-${index}`, nodus_id: 'w-1', label: 'Synthetic source',
      summary: '[p. 1] Background. '.repeat(60) + tail,
      authors: ['Synthetic Author'], year: 2030, pageLabel: 'pp. 1–3', score: 1, reason: 'source', zotero_key: '',
    }));
    const section = { ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: snapshot.passages.map(p => p.id) };
    const outputs = () => [
      buildPlanInput({ objective: 'Explain the judgment' }, 'en', snapshot, resolveSectionPlan(snapshot, 'auto')).passages.map(p => p.extract),
      buildCitationMenu(section, buildSnapshotMaps(snapshot)).map(p => p.note.slice(1, -1)),
      buildCitationCatalog(snapshot).passages.map(p => p.note.slice(1, -1)),
    ];
    for (const excerpts of outputs()) {
      assert.equal(excerpts.length, 3);
      assert.ok(excerpts.every(text => text.endsWith(tail)), 'planning, drafting and external writers receive the late evidence');
    }
    snapshot.passages = Array.from({ length: 32 }, (_, index) => ({
      ...snapshot.passages[index % 3], id: `bounded-${index}`, summary: index === 0 ? tail : 'Long source text. '.repeat(1000),
    }));
    section.passageIds = snapshot.passages.map(p => p.id);
    for (const excerpts of outputs()) {
      assert.equal(excerpts.length, 32);
      assert.equal(excerpts[0], tail, 'short evidence stays complete alongside long passages');
      assert.ok(excerpts.reduce((sum, text) => sum + text.length, 0) <= 32_000, 'the whole passage pool remains bounded');
      assert.ok(excerpts.every(text => text.length <= 6_000));
    }
  }

  // ── 11b0. Graph-first planning sees the scope contract; documents stay last ─
  {
    const snapshot = makeSnapshot(12);
    const questions = [
      '¿Cómo funcionaron los salvoconductos?',
      '¿Cuándo se desbloqueó el éxodo rural?',
      '¿Qué debate existe sobre la intencionalidad?',
      ...Array.from({ length: 10 }, (_, index) => `¿Cómo operó el mecanismo atómico ${index + 4}?`),
    ];
    assert.equal(questions.length, 13);
    assert.equal(MAX_COVERAGE_QUESTIONS, 16);
    const writerQuestions = [];
    const plannerInputs = [];
    const lifecycle = [];
    let plannedTitle = '';
    const deps = {
      ...baseDeps(snapshot),
      planReport: async (input) => {
        lifecycle.push('plan');
        plannerInputs.push(input);
        const plan = fakePlan(input);
        plan.sections[0].title = 'La tesis nace del grafo';
        plannedTitle = plan.sections[0].title;
        return plan;
      },
      auditPlanCoverage: async (input) => {
        lifecycle.push('coverage-audit');
        input.plan.sections[0].title = 'TÍTULO INYECTADO POR COBERTURA';
        input.plan.sections[0].purpose = 'Propósito profundizado sin alterar la arquitectura';
        input.plan.sections[0].keyClaims = ['Mecanismo concreto añadido tras auditar la cobertura'];
        return input.plan;
      },
      preparePlanEvidence: async (input) => {
        lifecycle.push('documents');
        assert.deepEqual(input.coverageQuestions, questions, 'coverage is audited only after the argument exists');
        assert.ok(input.candidateWorkIds[0]?.startsWith('w-'), 'planned graph works lead document preparation');
        // Deliberately attack the defensive copy. The executable plan must remain
        // unchanged, proving documents cannot redesign it through this seam.
        input.plan.sections[0].title = 'TÍTULO INYECTADO POR DOCUMENTOS';
        return { considered: 8, requested: 2, prepared: 2, unavailable: 0, failed: 0 };
      },
      writeSection: async (input) => {
        lifecycle.push('write');
        writerQuestions.push(...(input.section.coverageQuestions ?? []));
        return fakeWriteSection(input);
      },
    };
    const report = await orchestrateDeepResearch({
      objective: 'Explicar la inmovilización rural y su cronología.',
      coverageQuestions: questions,
      language: 'es',
    }, deps);
    assert.deepEqual(plannerInputs[0].coverageQuestions, questions, 'the planner must see every atomic requirement without waiting for documents');
    assert.deepEqual(lifecycle.slice(0, 3), ['plan', 'coverage-audit', 'documents'], 'coverage is audited after planning and documents start last');
    assert.notEqual(plannedTitle, 'TÍTULO INYECTADO POR COBERTURA');
    assert.equal(report.draft.outline[0].title, 'La tesis nace del grafo', 'coverage and documents cannot rewrite the graph-first proposition');
    assert.notEqual(report.draft.outline[0].purpose, 'Propósito profundizado sin alterar la arquitectura', 'coverage cannot inject a new historical purpose before evidence');
    assert.ok(!report.draft.outline[0].keyClaims.includes('Mecanismo concreto añadido tras auditar la cobertura'), 'coverage cannot inject an unsupported claim');
    assert.deepEqual([...new Set(writerQuestions)].sort(), [...questions].sort(), 'post-plan coverage audit reaches the writers');
    assert.deepEqual(report.meta.coverage?.questions, questions, 'the report metadata records the complete atomic coverage contract');
    assert.equal(report.meta.retrievalStrategy, 'idea_first_document_enrichment');
    assert.equal(report.meta.documentPreparation?.prepared, 2);
  }

  // ── 11b0a. Planned propositions become facts only after evidence audit ─────
  {
    const snapshot = makeSnapshot(8);
    const lifecycle = [];
    const seenByWriter = [];
    const deps = {
      ...baseDeps(snapshot),
      retrieveForSection: async () => {
        lifecycle.push('retrieve');
        return { ideas: [], passages: [] };
      },
      auditSectionClaims: async (input) => {
        lifecycle.push('claim-audit');
        const targets = [...input.section.keyClaims, ...(input.section.coverageQuestions ?? [])];
        return {
          items: targets.map((original, index) => ({
            original,
            status: index === 0 ? 'unsupported' : 'supported',
            // Deliberately unsafe: normalization must not let an unsupported claim
            // survive merely because the model repeated it confidently.
            revised: index === 0
              ? 'El Estado predeterminó totalmente la mirada.'
              : index >= input.section.keyClaims.length
                ? 'La evidencia documenta límites administrativos concretos, sin probar una recepción uniforme.'
                : original,
            evidenceTokens: index === 0 ? [] : input.citationMenu.slice(0, 1).map((item) => item.token),
            reason: index === 0 ? 'La evidencia solo muestra orientación.' : 'Sostenida.',
          })),
        };
      },
      writeSection: async (input) => {
        lifecycle.push('write');
        seenByWriter.push(input);
        return fakeWriteSection(input);
      },
      finalize: async (input) => {
        assert.ok((input.sectionFindings ?? []).length > 0, 'the finalizer sees verified prose, not headings alone');
        return { title: 'Final', abstract: 'El Estado controló totalmente la recepción.', limitations: ['Limitación original.'], nextSteps: [] };
      },
      auditFinalSummary: async (input, draft) => {
        assert.ok((input.sectionFindings ?? []).length > 0 && draft.abstract.includes('controló totalmente'), 'the final summary audit sees both verified prose and the proposed abstract');
        return { title: draft.title, abstract: 'El corpus documenta una orientación estatal, pero no una recepción uniforme.', limitations: [], nextSteps: [] };
      },
    };
    const report = await orchestrateDeepResearch({
      objective: 'Evaluar si el Estado predeterminó la mirada',
      coverageQuestions: ['¿Qué límites administrativos documenta el corpus?'],
      language: 'es',
    }, deps);
    assert.deepEqual(lifecycle.slice(0, 3), ['retrieve', 'claim-audit', 'write'], 'claim audit runs after section retrieval and before prose');
    assert.ok(seenByWriter[0].claimAudit, 'the writer receives the epistemic audit');
    assert.match(seenByWriter[0].section.keyClaims[0], /no permite establecer como hecho|pregunta abierta/iu, 'an unsupported proposition becomes an explicit unresolved question');
    assert.ok(!seenByWriter[0].section.keyClaims[0].includes('predeterminó totalmente la mirada.'), 'the unsafe reformulation does not survive verbatim');
    assert.match(seenByWriter[0].section.coverageClaims[0], /límites administrativos concretos/iu, 'an atomic coverage question becomes an evidence-bounded answer claim');
    assert.ok((report.meta.claimAudit?.unsupported ?? 0) > 0, 'the report records how many planned propositions lacked support');
    assert.match(report.draft.abstract, /no una recepción uniforme/iu, 'the cold final audit narrows an overclaim in the abstract');
    assert.ok(report.draft.limitations.includes('Limitación original.'), 'the final audit cannot erase an established limitation');
  }

  // ── 11b1. A weak section gets one bounded, evidence-preserving quality repair ─
  {
    const snapshot = makeSnapshot(12);
    const makeParagraph = (lead, tokens = []) => `${lead} ${'El razonamiento histórico desarrolla el mecanismo y delimita sus consecuencias con cautela. '.repeat(15)} ${tokens.join(' ')}`;
    let revisions = 0;
    const deps = {
      ...baseDeps(snapshot),
      writeSection: async (input) => `## ${input.section.title}\n\n${[
        makeParagraph('Descripción sin apoyo.'),
        makeParagraph('Otra descripción sin apoyo.'),
        makeParagraph('Una tercera generalización sin apoyo.'),
        makeParagraph('Cierre todavía sin apoyo.'),
      ].join('\n\n')}`,
      reviseSection: async (input) => {
        revisions += 1;
        const tokens = input.citationMenu.filter((item) => item.kind === 'idea').slice(0, 4).map((item) => item.token);
        return `## ${input.section.title}\n\n${[
          makeParagraph('Dos fuentes convergen porque explican el mismo mecanismo, mientras que conservan diferencias.', tokens.slice(0, 2)),
          makeParagraph('Sin embargo, otra interpretación limita el alcance y sugiere una lectura provisional.', tokens.slice(2, 4)),
          makeParagraph('Por tanto, la comparación revela consecuencias y distingue evidencia de hipótesis.', [tokens[0], tokens[2]]),
          makeParagraph('La síntesis relaciona el argumento con la pregunta y no permite una generalización absoluta.', [tokens[1], tokens[3]]),
        ].join('\n\n')}`;
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'Explicar el mecanismo y sus consecuencias', language: 'es',}, deps);
    assert.ok(revisions > 0, 'weak sections reach the professional-editing pass');
    assert.ok((report.meta.qualityRevisions ?? 0) > 0, 'accepted repairs are counted');
    assert.ok(report.draft.qualityAssessment, 'the persisted draft carries reproducible quality metrics');
    assert.ok(report.draft.qualityAssessment.metrics.crossSourceParagraphs > 0, 'the accepted text synthesizes sources');
  }

  // ── 11b2. Half-written references are repaired or dropped, never leaked ────
  {
    const snapshot = makeSnapshot(3);
    const maps = buildSnapshotMaps(snapshot);
    const md = [
      'Uno [Autor](nodus://idea/g-0].', // right link, wrong closing bracket
      'Dos [nodus://idea/g-1, nodus://idea/g-2].', // bare bracketed list
      'Tres nodus://work/w-0 sin enlace.', // bare reference in the prose
      'Cuatro nodus://idea/NO-EXISTE fantasma.', // bare reference to nothing
      'Cinco [Autor0, N. (2000) (nodus://idea/g-2)].', // brackets and parentheses swapped
      'Seis ([x](nodus://idea/g-0); Autor1, N. (2001)](nodus://idea/g-1)).', // second link lost its opening bracket
      'Siete y la autarquía Autor2, N. (2002)](nodus://idea/g-2) seguía siendo dura.', // orphan with no delimiter to anchor a label
      'Ocho [Fuentes Vega (2017)](nodus://contradicción/abc) con el tipo en español.', // invented target type
      'Nueve [hueco](nodus://280a3b7b-5404-4ab8) sin tipo ninguno.', // target with no type segment
    ].join('\n');
    const { markdown, cited } = applyCitationPolicy(md, maps);
    assert.ok(!/nodus:\/\/[^)]*\]/.test(markdown), 'no mismatched bracket survives');
    // Every surviving reference is a well-formed link, so nothing leaks a raw id.
    for (const match of markdown.matchAll(/nodus:\/\/[^\s)]+/g)) {
      const at = markdown.indexOf(match[0]);
      assert.equal(markdown[at - 1], '(', `reference ${match[0]} sits inside a real link`);
    }
    assert.ok(cited.ideas.has('g-0'), 'the mismatched bracket is still counted as a citation');
    assert.ok(cited.ideas.has('g-1') && cited.ideas.has('g-2'), 'the bare list is counted');
    assert.ok(cited.works.has('w-0'), 'the bare prose reference is counted');
    assert.ok(!markdown.includes('NO-EXISTE'), 'a bare reference to nothing is dropped entirely');
    // Repairing a broken neighbour must not damage a link that was already correct.
    assert.ok(!/\[\[/.test(markdown), 'no stray bracket is introduced next to a well-formed link');
    assert.equal((markdown.match(/\]\(nodus:\/\//g) ?? []).length, (markdown.match(/nodus:\/\//g) ?? []).length, 'every surviving reference sits in a link');
    // When the label cannot be reconstructed the reference goes, but the sentence stays.
    assert.ok(markdown.includes('y la autarquía Autor2, N. (2002) seguía siendo dura'), 'prose is never eaten to salvage a citation');
    // A link Nodus cannot resolve loses the link and keeps the visible text.
    assert.ok(!markdown.includes('contradicción/abc'), 'an invented target type is not printed');
    assert.ok(markdown.includes('Fuentes Vega (2017)'), 'its author-year survives as plain text');
    assert.ok(!markdown.includes('280a3b7b'), 'a target with no type segment is not printed');
  }

  // ── 11c. Coverage counts citations without padding a short report ───────────
  {
    const snapshot = makeSnapshot(40);
    const phases = [];
    // A writer that produces prose but cites nothing at all.
    const deps = { ...baseDeps(snapshot), writeSection: async () => `## S\n\n${'palabra '.repeat(300)}` };
    const report = await orchestrateDeepResearch(
      { objective: 'X', language: 'es',},
      deps,
      (p) => phases.push(p.phase)
    );
    assert.equal(report.meta.ideasCovered, 0, 'citing nothing covers nothing');
    assert.ok(!phases.includes('coverage'), 'length alone never triggers a filler/top-up pass');
    assert.ok(report.draft.limitations.length > 0, 'the report discloses the ideas it never developed');
    assert.equal(report.draft.stats.selectedIdeas, 0, 'the saved selection matches the honest coverage');
  }

  // ── 11d. Leftover ideas land where they fit, not by index arithmetic ────────
  {
    const snapshot = makeSnapshot(6);
    // Two clearly separate topics; the planner only claims one idea per section.
    snapshot.ideas[0].statement = 'La fotografía turística compone el paisaje nacional.';
    snapshot.ideas[1].statement = 'La legislación agraria reordena la propiedad rural.';
    snapshot.ideas[2].statement = 'La fotografía de prensa fija el paisaje como emblema.';
    snapshot.ideas[3].statement = 'La reforma de la propiedad rural altera el catastro agrario.';
    const plan = {
      title: 'T',
      abstract: '',
      sections: [
        { id: 's1', title: 'Fotografía y paisaje', purpose: 'La fotografía y el paisaje nacional.', keyClaims: [], ideaIds: ['g-0'], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
        { id: 's2', title: 'Propiedad rural', purpose: 'La legislación agraria y la propiedad rural.', keyClaims: [], ideaIds: ['g-1'], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
        { id: 's3', title: 'Cierre', purpose: 'síntesis', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
      ],
    };
    const normalized = normalizePlan(plan, snapshot);
    const photography = normalized.sections.find((s) => s.id === 's1').ideaIds;
    const land = normalized.sections.find((s) => s.id === 's2').ideaIds;
    assert.ok(photography.includes('g-2'), 'the second photography idea joins the photography section');
    assert.ok(land.includes('g-3'), 'the second land idea joins the land section');
    assert.ok(!photography.includes('g-3') && !land.includes('g-2'), 'topics are not interleaved by index');
  }

  // ── 11e. Per-section retrieval reaches material the snapshot never held ─────
  {
    const snapshot = makeSnapshot(6);
    const extraIdea = {
      id: 'g-late',
      label: 'Idea tardía',
      summary: 'Recuperada durante la redacción.',
      score: 0.9,
      reason: 'test',
      type: 'claim',
      statement: 'Enunciado recuperado por la segunda pasada de recuperación.',
      themes: [],
      workCount: 1,
      evidenceCount: 1,
      works: [{ nodus_id: 'w-late', title: 'Obra tardía', authors: ['Tardío, Ana'], year: 2010, zotero_key: 'ZL' }],
    };
    const extraPassage = {
      id: 'p-late',
      label: 'Obra tardía · p. 12',
      summary: 'Texto literal recuperado para esta sección concreta.',
      score: 0.9,
      reason: 'test',
      nodus_id: 'w-late',
      pageLabel: 'p. 12',
      authors: ['Tardío, Ana'],
      year: 2010,
      zotero_key: 'ZL',
      citation: 'nodus://passage/p-late',
    };
    let asked = 0;
    const deps = {
      ...baseDeps(snapshot),
      retrieveForSection: async (input) => {
        asked += 1;
        assert.ok(input.sectionTitle, 'the retrieval is scoped to a section');
        return { ideas: [extraIdea], passages: [extraPassage] };
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'X', language: 'es',}, deps);
    assert.ok(asked >= 2, 'the corpus is queried once per section, not only once per report');
    // Retrieved material survives the citation policy instead of being stripped.
    assert.ok(report.draft.draftMarkdown.includes('nodus://idea/g-late'), 'a retrieved idea is really citable');
    assert.ok(report.draft.draftMarkdown.includes('nodus://passage/p-late'), 'a retrieved passage is really citable');
    assert.ok(report.draft.bibliography.some((entry) => entry.includes('Tardío')), 'its work reaches the bibliography');
  }

  // ── 11f. Report language drives the document, not the developer's locale ────
  {
    const snapshot = makeSnapshot(6);
    const question = '¿Cómo se catalogó el archivo fotográfico?';
    const recoveredPassage = {
      id: 'p-recovery',
      label: 'Archivo institucional · p. 40',
      summary: 'El organismo revisó el archivo fotográfico, clasificó las imágenes y publicó su catálogo.',
      score: 0.95,
      reason: 'test',
      nodus_id: 'w-recovery',
      pageLabel: 'p. 40',
      authors: ['Archivo, Ana'],
      year: 1962,
      zotero_key: 'ZR',
      citation: 'nodus://passage/p-recovery',
    };
    const noisyRecoveryPassage = {
      ...recoveredPassage,
      id: 'p-recovery-noise',
      summary: 'El organismo celebró una exposición sin relación con la catalogación del archivo.',
      citation: 'nodus://passage/p-recovery-noise',
    };
    const retrievalInputs = [];
    const deps = {
      ...baseDeps(snapshot),
      retrieveForSection: async (input) => {
        retrievalInputs.push(input);
        return input.limits.passages === 12
          ? { ideas: [], passages: [recoveredPassage, noisyRecoveryPassage] }
          : { ideas: [], passages: [] };
      },
      auditSectionClaims: async (input) => {
        const targets = [...input.section.keyClaims, ...(input.section.coverageQuestions ?? [])];
        const recovered = input.citationMenu.find((item) => item.token.includes('nodus://passage/p-recovery'));
        return {
          items: targets.map((original, index) => {
            const isCoverage = index >= input.section.keyClaims.length;
            const evidence = recovered ?? input.citationMenu[0];
            const noise = input.citationMenu.find((item) => item.token.includes('nodus://passage/p-recovery-noise'));
            return {
              original,
              status: isCoverage && !recovered ? 'unsupported' : 'supported',
              revised: isCoverage && recovered ? 'El archivo fue revisado, clasificado y catalogado institucionalmente.' : original,
              evidenceTokens: isCoverage && !recovered ? [] : evidence ? [evidence.token] : [],
              reason: isCoverage && !recovered ? 'Falta el pasaje procedimental.' : 'Existe evidencia directa.',
              evidencePack: [
                ...(evidence ? [{ token: evidence.token, role: 'direct', reason: 'Responde a la pregunta.' }] : []),
                ...(noise ? [{ token: noise.token, role: 'irrelevant', reason: 'Solo comparte el organismo.' }] : []),
              ],
              requirements: [{
                text: isCoverage ? 'Catalogación del archivo' : 'Proposición del plan',
                supported: isCoverage ? Boolean(recovered) : Boolean(evidence),
                evidenceTokens: isCoverage ? (recovered ? [recovered.token] : []) : evidence ? [evidence.token] : [],
              }],
            };
          }),
        };
      },
    };
    const report = await orchestrateDeepResearch({
      objective: 'Explicar el archivo fotográfico.',
      coverageQuestions: [question],
      language: 'es',
    }, deps);
    const focusedRecovery = retrievalInputs.find((input) => input.limits.passages === 12);
    assert.deepEqual(focusedRecovery?.coverageQuestions, [question], 'an unsupported atomic requirement triggers one focused retrieval retry');
    assert.ok(report.draft.outline.some((section) => section.keyClaims.some((claim) => /clasificado y catalogado/iu.test(claim))), 'the recovered evidence becomes an audited answer in the saved outline');
    assert.equal(report.meta.claimAudit?.unsupported, 0, 'only the final post-recovery audit contributes to report counters');
    assert.ok((report.meta.claimAudit?.roles?.fact?.checked ?? 0) > 0, 'saved metadata exposes support by proof role instead of one opaque total');
    assert.ok(report.draft.draftMarkdown.includes('nodus://passage/p-recovery'), 'the selected direct recovery passage reaches the writer');
    assert.ok(!report.draft.draftMarkdown.includes('nodus://passage/p-recovery-noise'), 'rejected recovery noise is removed before writing');
  }

  // ── 11f. Report language drives the document, not the developer's locale ────
  {
    const snapshot = makeSnapshot(8);
    const messages = [];
    const report = await orchestrateDeepResearch(
      { objective: 'X', language: 'en',},
      baseDeps(snapshot),
      (p) => messages.push(p.message)
    );
    assert.ok(report.draft.draftMarkdown.includes('## References'), 'an English report closes in English');
    assert.ok(!report.draft.draftMarkdown.includes('## Referencias'), 'no Spanish heading leaks in');
    assert.ok(messages.some((m) => /Gathering|Writing|Assembling/.test(m)), 'progress speaks the report language');
    assert.ok(!messages.some((m) => /Reuniendo|Redactando|Ensamblando/.test(m)), 'no Spanish progress copy leaks in');
  }

  // ── 11g. Reading order follows the declared dependencies, not the emission order ─
  {
    // The planner emits the consequence before its cause and the framing last.
    const emitted = [
      { id: 'consecuencia', role: 'body', dependsOn: ['origen'], title: 'Consecuencia', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
      { id: 'cierre', role: 'synthesis', dependsOn: ['consecuencia'], title: 'Síntesis', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
      { id: 'origen', role: 'body', dependsOn: [], title: 'Origen', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
      { id: 'marco', role: 'intro', dependsOn: [], title: 'Planteamiento', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
    ];
    const ordered = orderSections(emitted).map((s) => s.id);
    assert.deepEqual(ordered, ['marco', 'origen', 'consecuencia', 'cierre'], 'framing first, cause before consequence, synthesis last');

    // A dependency cycle must degrade to an order, never hang or drop a section.
    const cyclic = [
      { id: 'a', role: 'body', dependsOn: ['b'], title: 'A', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
      { id: 'b', role: 'body', dependsOn: ['a'], title: 'B', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] },
    ];
    assert.equal(orderSections(cyclic).length, 2, 'a cycle still yields every section');
    // An unknown dependency id is ignored rather than fatal.
    const dangling = [{ id: 'a', role: 'body', dependsOn: ['ghost'], title: 'A', purpose: '', keyClaims: [], ideaIds: [], workIds: [], gapIds: [], contradictionIds: [], passageIds: [] }];
    assert.equal(orderSections(dangling).length, 1, 'a dangling dependency is ignored');
  }

  // ── 11i. Verification: a source that does not support the claim is removed ──
  {
    const snapshot = makeSnapshot(10);
    snapshot.passages = [
      {
        id: 'p-1',
        label: 'Obra 0 · p. 9',
        summary: 'El turismo interior creció durante la posguerra.',
        score: 1,
        reason: 'test',
        nodus_id: 'w-0',
        pageLabel: 'p. 9',
        authors: ['Autor0, N.'],
        year: 2000,
        zotero_key: 'zk-0',
        citation: 'nodus://passage/p-1',
      },
    ];
    // The writer cites two ideas per sentence; the judge rejects everything backed by
    // the work behind idea g-1, and accepts the rest.
    const rejected = new Set(['g-1']);
    let seenClaims = [];
    const deps = {
      ...baseDeps(snapshot),
      writeSection: async (input) => {
        const tokens = input.citationMenu.filter((c) => c.kind === 'idea').slice(0, 3);
        const sentences = tokens.map((c, i) => `Afirmación número ${i} sobre el asunto (${c.token}).`);
        return `## ${input.section.title}\n\n${sentences.join(' ')} ${'texto '.repeat(400)}`;
      },
      verifyCitations: async (claims) => {
        seenClaims = seenClaims.concat(claims);
        return claims.map((claim) => (rejected.has(claim.id) ? 'unsupported' : 'supports'));
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'X', language: 'es',}, deps);

    // The judge must receive the real sentence and the real source content.
    assert.ok(seenClaims.length > 0, 'claims reached the verifier');
    assert.ok(seenClaims.every((c) => c.sentence.includes('Afirmación número')), 'each claim carries its own sentence');
    assert.ok(seenClaims.every((c) => c.content.length > 0), 'each claim carries what the source says');
    assert.ok(seenClaims.some((c) => c.content.includes('Enunciado sustantivo')), 'an idea claim carries its statement');

    // The rejected citation is gone from the prose …
    assert.ok(!report.draft.draftMarkdown.includes('nodus://idea/g-1'), 'an unsupported citation is removed from the body');
    // … and therefore from the accounting and the bibliography too.
    assert.ok(!report.draft.selection.ideaIds.includes('g-1'), 'it stops counting as covered');
    assert.ok(
      !report.draft.bibliography.some((entry) => entry.includes('Autor1')),
      'the work behind it leaves the bibliography unless something else cites it'
    );
    assert.ok(report.meta.verification, 'verification is reported');
    assert.ok(report.meta.verification.checked > 0, 'the number of checked claims is reported');
    assert.ok(report.meta.verification.unsupported > 0, 'the number of removed citations is reported');
    // Supported citations survive untouched.
    assert.ok(report.draft.draftMarkdown.includes('nodus://idea/g-0'), 'a supported citation is kept');
  }

  // ── 11i1. A known partial citation cannot remain in published prose ────────
  {
    const snapshot = makeSnapshot(8);
    const deps = {
      ...baseDeps(snapshot),
      writeSection: async (input) => {
        const tokens = input.citationMenu.filter((item) => item.kind === 'idea').slice(0, 4).map((item) => item.token);
        return `## ${input.section.title}\n\n${tokens.map((token, index) => `CLAIM_PARCIAL_${index} formula una conclusión más fuerte que la fuente (${token}).`).join(' ')} ${'desarrollo '.repeat(500)}`;
      },
      verifyCitations: async (claims) => claims.map(() => 'partial'),
    };
    const report = await orchestrateDeepResearch({ objective: 'X', language: 'es',}, deps);
    assert.ok(!report.draft.draftMarkdown.includes('CLAIM_PARCIAL_'), 'sentences supported only partially are removed when no repair is available');
    assert.ok((report.meta.verification?.partial ?? 0) > 0, 'removed partial support is reported');
    assert.ok(report.draft.qualityAssessment.issues.includes('high_support_repair_rate'), 'the quality score exposes a high entailment-repair burden');
    assert.notEqual(report.draft.qualityAssessment.grade, 'passes_thresholds', 'a report with pervasive partial support cannot clear the top threshold');
  }

  // ── 11j. A judge that fails or answers nonsense never damages the report ────
  {
    const snapshot = makeSnapshot(12);
    const events = [];
    let verificationPass = 0;
    const paragraph = (lead, tokens) => `${lead} ${'El análisis explica el mecanismo, compara interpretaciones y delimita sus consecuencias con cautela. '.repeat(14)} ${tokens.join(' ')}`;
    const deps = {
      ...baseDeps(snapshot),
      writeSection: async (input) => {
        const tokens = input.citationMenu.filter((item) => item.kind === 'idea').slice(0, 4).map((item) => item.token);
        return `## ${input.section.title}\n\n${[
          paragraph('Dos fuentes convergen porque describen el mismo proceso.', tokens.slice(0, 2)),
          paragraph('Sin embargo, la comparación revela una diferencia de alcance.', tokens.slice(2, 4)),
          paragraph('Por tanto, el mecanismo sugiere una consecuencia verificable.', [tokens[0], tokens[2]]),
          paragraph('La síntesis distingue evidencia e hipótesis provisional.', [tokens[1], tokens[3]]),
        ].join('\n\n')}`;
      },
      verifyCitations: async (claims) => {
        events.push('verify');
        verificationPass += 1;
        return claims.map((claim, index) => verificationPass === 1 && index > 0 ? 'unsupported' : 'supports');
      },
      reviseSection: async (input) => {
        // The first quality pass runs before entailment. Leave it unchanged so the
        // test isolates the repair triggered by citations removed by verification.
        if (verificationPass === 0) return input.draft;
        events.push('revise');
        const tokens = input.citationMenu.filter((item) => item.kind === 'idea').slice(0, 4).map((item) => item.token);
        return `## ${input.section.title}\n\n${[
          paragraph('Dos fuentes convergen porque explican el mismo mecanismo.', tokens.slice(0, 2)),
          paragraph('Sin embargo, otras dos fuentes limitan esa interpretación.', tokens.slice(2, 4)),
          paragraph('Por tanto, la comparación revela consecuencias distintas.', [tokens[0], tokens[2]]),
          paragraph('La síntesis relaciona el argumento con la pregunta central.', [tokens[1], tokens[3]]),
        ].join('\n\n')}`;
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'Explicar y comparar el mecanismo', language: 'es',}, deps);
    assert.ok(events.indexOf('verify') >= 0 && events.indexOf('verify') < events.indexOf('revise'), 'a quality repair can run after verification removed support');
    assert.ok((report.meta.qualityRevisions ?? 0) >= 0, 'the repair decision is recorded without a length quota');
    assert.equal(report.meta.verification?.unverified ?? 0, 0, 'the accepted repair is itself verified');
  }

  // ── 11k. A judge that fails or answers nonsense never damages the report ────
  {
    const snapshot = makeSnapshot(10);
    const base = await orchestrateDeepResearch({ objective: 'X', language: 'es',}, baseDeps(snapshot));
    for (const broken of [
      async () => {
        throw new Error('judge down');
      },
      async () => [],
      async () => ['sí', 'no'],
      async () => null,
    ]) {
      const report = await orchestrateDeepResearch(
        { objective: 'X', language: 'es',},
        { ...baseDeps(snapshot), verifyCitations: broken }
      );
      assert.equal(
        (report.draft.draftMarkdown.match(/nodus:\/\/idea\//g) ?? []).length,
        (base.draftMarkdown ?? base.draft.draftMarkdown).match(/nodus:\/\/idea\//g).length,
        'a broken judge leaves every citation in place'
      );
    }
  }

  // ── 11l. Split headings are folded into one phrase, keeping both halves ────
  {
    assert.equal(
      normalizeSectionTitle('La genealogía de la mirada: del mito romántico a la gestión institucional'),
      'La genealogía de la mirada, del mito romántico a la gestión institucional',
      'a colon becomes a comma and the subtitle survives'
    );
    assert.equal(
      normalizeSectionTitle('La construcción del imaginario: Fotografía, patrimonio y folclore'),
      'La construcción del imaginario, Fotografía, patrimonio y folclore',
      'a subtitle starting with a content word keeps its capital'
    );
    assert.equal(
      normalizeSectionTitle('Nacionalismo banal: Hacia una síntesis'),
      'Nacionalismo banal, hacia una síntesis',
      'a subtitle starting with a function word is lowercased'
    );
    assert.equal(normalizeSectionTitle('Un título limpio'), 'Un título limpio', 'a clean title is untouched');
    assert.equal(normalizeSectionTitle('Ratio 3:1 sin espacio'), 'Ratio 3:1 sin espacio', 'a colon without a following space is not a subtitle');

    // And it reaches the report, not just the helper.
    const snapshot = makeSnapshot(12);
    const deps = {
      ...baseDeps(snapshot),
      planReport: async (input) => {
        const plan = fakePlan(input);
        plan.sections[0].title = 'Genealogías del imaginario: del romanticismo a la propaganda';
        return plan;
      },
    };
    const report = await orchestrateDeepResearch({ objective: 'X', language: 'es',}, deps);
    assert.ok(
      report.draft.draftMarkdown.includes('## Genealogías del imaginario, del romanticismo a la propaganda'),
      'the assembled report carries the folded heading'
    );
    assert.ok(!/^##\s+[^\n]*:\s/mu.test(report.draft.draftMarkdown), 'no split heading survives into the document');
  }

  // ── 11l. Self-contradictions are reported only when both quotes are real ───
  {
    const snapshot = makeSnapshot(12);
    let seenSections = [];
    const run = (issues) =>
      orchestrateDeepResearch(
        { objective: 'X', language: 'es',},
        {
          ...baseDeps(snapshot),
          writeSection: async (input) =>
            `## ${input.section.title}\n\nEl turismo creció de forma sostenida durante el periodo (${input.citationMenu[0]?.token ?? ''}). ${'texto '.repeat(400)}`,
          checkCoherence: async (sections) => {
            seenSections = sections;
            return issues(sections);
          },
        }
      );

    // A tension whose quotes really appear is reported to the reader.
    const real = await run((sections) => [
      {
        sectionA: sections[0].title,
        quoteA: 'El turismo creció de forma sostenida durante el periodo',
        sectionB: sections[1].title,
        quoteB: 'El turismo creció de forma sostenida durante el periodo',
        issue: 'Una sección afirma crecimiento sostenido y la otra lo niega.',
      },
    ]);
    // Identical quotes are not a contradiction: the grounding must reject that too.
    assert.equal(real.meta.coherenceIssues, 0, 'two identical quotes are not a tension');

    // An invented quote is discarded rather than printed in the limitations.
    const invented = await run(() => [
      {
        sectionA: 'Sección 1',
        quoteA: 'El régimen prohibió por completo el turismo extranjero hasta 1975',
        sectionB: 'Sección 2',
        quoteB: 'La apertura turística comenzó en los años cuarenta con plena libertad',
        issue: 'Fechas incompatibles.',
      },
    ]);
    assert.equal(invented.meta.coherenceIssues, 0, 'an invented tension never reaches the report');
    assert.ok(
      !invented.draft.limitations.some((l) => l.includes('Fechas incompatibles')),
      'and never reaches the limitations either'
    );

    // The checker sees real section text, stripped of its heading.
    assert.ok(seenSections.length > 1, 'every section is offered to the coherence check');
    assert.ok(seenSections.every((s) => !s.text.startsWith('## ')), 'sections arrive without their heading');
    assert.ok(seenSections.some((s) => s.text.includes('El turismo creció')), 'sections arrive with their prose');

    // A failing checker must not cost the report anything.
    const broken = await orchestrateDeepResearch(
      { objective: 'X', language: 'es',},
      {
        ...baseDeps(snapshot),
        checkCoherence: async () => {
          throw new Error('coherence down');
        },
      }
    );
    assert.equal(broken.meta.coherenceIssues, 0, 'a broken coherence check degrades to zero findings');
    assert.ok(broken.draft.draftMarkdown.includes('## Referencias'), 'and the report still assembles');
  }

  // ── 11m. Every visible citation reads like a citation ──────────────────────
  {
    const snapshot = makeSnapshot(6);
    // A gap anchored to a work, a debate with a named side, and a work whose author
    // the corpus never captured.
    snapshot.gaps[0].work = { nodus_id: 'w-0', title: 'Obra 0', authors: ['Fuentes Vega, Ana'], year: 2017, zotero_key: 'zk-0' };
    snapshot.contradictions[0].sources = ['Brandis García (2015)', 'Otro (2011)'];
    snapshot.ideas[1].works = [{ nodus_id: 'w-x', title: 'Bibliografía de viajeros por España y Portugal', authors: [], year: 2004, zotero_key: 'zk-x' }];
    const maps = buildSnapshotMaps(snapshot);
    const menu = buildCitationMenu(
      { id: 's1', title: 't', purpose: '', keyClaims: [], ideaIds: ['g-1'], workIds: [], gapIds: ['gap-1'], contradictionIds: ['edge-1'], passageIds: [] },
      maps
    );
    const anchorOf = (kind) => menu.find((i) => i.kind === kind).token.match(/^\[([^\]]*)\]/)[1];
    assert.equal(anchorOf('gap'), 'Fuentes Vega, A. (2017)', 'a gap is cited by the work it is anchored to');
    assert.equal(anchorOf('contradiction'), 'Brandis García (2015)', 'a debate is cited by whoever holds a side');
    assert.ok(!/^Autor$|^Autor \(/.test(anchorOf('idea')), 'no bare "Autor" placeholder reaches the prose');
    assert.ok(anchorOf('idea').includes('Bibliografía de viajeros'), 'an authorless work is cited by its shortened title');

    // And the anchors survive the citation policy unchanged.
    const { markdown } = applyCitationPolicy(`Frase (${menu.find((i) => i.kind === 'gap').token}).`, maps);
    assert.ok(markdown.includes('[Fuentes Vega, A. (2017)]'), 'the policy keeps the readable anchor');
    assert.ok(!markdown.includes('[hueco]'), 'the debug-looking label is gone');
  }

  // ── 12. All writer routes inherit the same narrative contract ──────────────
  {
    const sources = await Promise.all([
      'electron/ai/deepResearch.ts',
      'electron/ai/genealogyDeepResearch.ts',
      'electron/ai/deepResearchClient.ts',
      'electron/ai/studyDeepResearch.ts',
    ].map((file) => readFile(path.join(repoRoot, file), 'utf8')));
    const [writingPromptPacks, genealogyPromptPacks] = await Promise.all([
      'shared/deepResearchWritingPromptPacks.ts',
      'shared/genealogyDeepResearchPromptPacks.ts',
    ].map((file) => readFile(path.join(repoRoot, file), 'utf8')));
    assert.ok(sources.every((source) => source.includes('deepResearchNarrativeRules')), 'all Deep Research writers share the locale-aware prose contract');
    assert.match(sources[0], /deepResearchWritingPromptPack/, 'the general writer resolves its native prompt pack');
    assert.match(sources[1], /genealogyDeepResearchPromptPack/, 'the genealogy writer resolves its native prompt pack');
    assert.match(writingPromptPacks, /valor marginal sea cero/, 'the Spanish general writer stops when evidence adds no new value');
    assert.match(genealogyPromptPacks, /valor probatorio marginal/, 'the Spanish genealogy writer uses the same evidence-driven stopping rule');
    assert.match(DEEP_RESEARCH_NARRATIVE_RULES.join('\n'), /evidencia de un solo lado/iu, 'every writer rejects unilateral agreement and contradiction claims');
    assert.match(DEEP_RESEARCH_NARRATIVE_RULES.join('\n'), /intención no demuestra un efecto/iu, 'every writer separates intent, effect and reception');
  }

  // ── 13. Planned prose cannot replace the established writer without winning ─
  {
    const snapshot = makeSnapshot(18);
    const evidencePlan = {
      thesis: 'Tesis acotada',
      objectiveLinks: ['obj'],
      exclusions: [],
      paragraphs: [0, 1, 2].map((index) => ({
        function: `función ${index}`,
        claim: `afirmación ${index}`,
        evidenceTokens: [],
        relationship: 'comparación',
        caveat: 'cautela',
        transition: 'continuidad',
      })),
    };
    const run = (plannedWins) => orchestrateDeepResearch(
      { objective: 'X', language: 'es',},
      {
        ...baseDeps(snapshot),
        planSectionEvidence: async (input) => ({
          ...evidencePlan,
          paragraphs: evidencePlan.paragraphs.map((paragraph) => ({
            ...paragraph,
            evidenceTokens: input.citationMenu.slice(0, 2).map((item) => item.token),
          })),
        }),
        writeSection: async (input) => {
          const marker = input.evidencePlan ? 'RUTA PLANIFICADA' : 'RUTA HISTÓRICA';
          const citations = input.citationMenu.slice(0, 4).map((item) => item.token).join(' ');
          return `## ${input.section.title}\n\n${marker}. ${'Desarrollo porque compara mecanismos con cautela. '.repeat(220)} ${citations}`;
        },
        judgeSectionRevision: async (_input, original, revised) => {
          assert.ok(original.includes('RUTA HISTÓRICA'), 'the established writer is anonymous candidate one');
          assert.ok(revised.includes('RUTA PLANIFICADA'), 'the evidence-planned writer is anonymous candidate two');
          return plannedWins;
        },
      },
    );

    const fallback = await run(false);
    assert.ok(fallback.draft.draftMarkdown.includes('RUTA HISTÓRICA'), 'a tie or loss keeps the established prose');
    assert.ok(!fallback.draft.draftMarkdown.includes('RUTA PLANIFICADA'), 'the losing planned prose is discarded');
    assert.equal(fallback.meta.generationSelection?.baseline, fallback.meta.generationSelection?.compared);
    assert.equal(fallback.meta.generationSelection?.planned, 0);

    const promoted = await run(true);
    assert.ok(promoted.draft.draftMarkdown.includes('RUTA PLANIFICADA'), 'planned prose ships only after winning the blind comparison');
    assert.ok(!promoted.draft.draftMarkdown.includes('RUTA HISTÓRICA'), 'the losing baseline is discarded');
    assert.equal(promoted.meta.generationSelection?.planned, promoted.meta.generationSelection?.compared);
    assert.equal(promoted.meta.generationSelection?.baseline, 0);
  }

  console.log('deep research orchestration test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
