// The podcast pipeline's pure core, bundled from the real sources: duration budgets, the
// rundown's normalisation, spoken-text cleaning, fact-review fixes, fitting to the cap,
// resumable orchestration (a checkpointed job never researches twice) and the recording
// timeline with its pauses. Every AI and TTS call is a deterministic double.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-podcast-core-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const entry = path.join(tmp, 'entry.ts');
await writeFile(entry, [
  `export * from ${JSON.stringify(path.join(repoRoot, 'shared/podcast.ts'))};`,
  `export * from ${JSON.stringify(path.join(repoRoot, 'electron/podcast/podcastCore.ts'))};`,
  `export * from ${JSON.stringify(path.join(repoRoot, 'electron/podcast/podcastDossier.ts'))};`,
  `export * from ${JSON.stringify(path.join(repoRoot, 'shared/podcastTranscript.ts'))};`,
].join('\n'));
const outfile = path.join(tmp, 'core.mjs');
await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', alias: { '@shared': path.join(repoRoot, 'shared') } });
const p = await import(pathToFileURL(outfile).href);

const request = (overrides = {}) => p.normalizePodcastRequest({
  objective: 'La memoria colectiva en Halbwachs',
  format: 'conversation',
  language: 'es',
  ttsModelId: 'kokoro-82m-int8',
  hosts: [{ voiceId: 'kokoro:ef_dora', name: 'Dora' }, { voiceId: 'kokoro:em_alex', name: 'Alex' }],
  durationCapMin: 5,
  cover: true,
  extraImages: 2,
  ...overrides,
});
const evidence = {
  sources: Array.from({ length: 6 }, (_, i) => ({ id: `S${i + 1}`, kind: 'passage', title: `Obra ${i + 1}`, authors: 'Autor', year: 1925 + i, excerpt: `Extracto ${i + 1} `.repeat(20) })),
  tensions: [{ id: 'X1', summary: 'Individual frente a social', sourceIds: ['S1', 'S2'] }],
  gaps: ['¿Qué pasa con la memoria digital?'],
  log: 'Consultadas seis obras.',
};
const words = (n) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ');

test('duration budget, chapters, estimate and calibration', () => {
  assert.equal(p.podcastWordBudget(10), Math.round(10 * 170 * 0.93));
  assert.equal(p.podcastWordBudget(10, 40), p.podcastWordBudget(10), 'an absurd measured rate falls back to the default');
  assert.equal(p.podcastWordBudget(10, 180), Math.round(10 * 180 * 0.93));
  assert.equal(p.podcastPlanningWpm('kokoro', null), 180, 'Kokoro plans at its measured pace, not a generic 150');
  assert.equal(p.podcastPlanningWpm('phonon', undefined), 172);
  assert.equal(p.podcastPlanningWpm('kokoro', 165), 165, 'this machine\'s measurement wins');
  assert.equal(p.podcastPlanningWpm(null, null), 170);
  assert.deepEqual([5, 10, 15, 20, 30].map(p.podcastChapterCount), [2, 4, 5, 6, 8]);
  const split = p.allocateChapterWords(1000, 4);
  assert.equal(split.length, 4);
  assert.ok(split[0] < split[1] && split[3] < split[2], 'opening and closing are lighter than the body');
  assert.ok(Math.abs(split.reduce((a, b) => a + b, 0) - 1000) <= 4);
  const script = { turns: [
    { id: 't1', chapterIndex: 0, speaker: 'A', text: words(150), sourceIds: [] },
    { id: 't2', chapterIndex: 0, speaker: 'B', text: words(150), sourceIds: [] },
    { id: 't3', chapterIndex: 1, speaker: 'B', text: words(150), sourceIds: [] },
  ] };
  assert.equal(p.estimatePodcastSeconds(script, 150), 180 + 0.35 + 0.9, 'speech plus a speaker change and a chapter pause');
  assert.equal(p.countSpokenWords("l'histoire, ¡hola! 1925 co-autor"), 4);
  assert.equal(p.measuredWpm(script, 180), 150);
  assert.equal(p.measuredWpm(script, 5), null, 'too short to trust');
  assert.equal(p.blendWpm(150, 170), 158);
  assert.equal(p.blendWpm(undefined, 170), 170);
});

test('images spread across chapters without repeats', () => {
  assert.deepEqual(p.spreadImageChapters(4, 2), [0, 3]);
  assert.deepEqual(p.spreadImageChapters(4, 6), [0, 1, 2, 3], 'never more images than chapters');
  assert.deepEqual(p.spreadImageChapters(8, 3), [0, 4, 7]);
  assert.deepEqual(p.spreadImageChapters(3, 0), []);
});

test('requests are validated: voices, engines and formats', () => {
  const r = request();
  assert.equal(r.hosts.length, 2);
  assert.deepEqual(r.hosts.map((h) => h.speaker), ['A', 'B']);
  assert.equal(r.extraImages, 2);
  assert.equal(r.webSearch, 'off');
  assert.equal(request({ format: 'essay' }).hosts.length, 1, 'an essay keeps one host');
  assert.equal(request({ format: 'lesson', hosts: [{ voiceId: 'kokoro:ef_dora' }] }).hosts.length, 1);
  assert.equal(request({ format: 'lesson' }).hosts.length, 2);
  assert.equal(request({ durationCapMin: 7 }).durationCapMin, 10, 'only offered durations');
  assert.equal(request({ extraImages: 40 }).extraImages, 6);
  assert.throws(() => request({ objective: '  ' }), /PODCAST_EMPTY_OBJECTIVE/);
  assert.throws(() => request({ hosts: [{ voiceId: 'kokoro:ef_dora' }] }), /PODCAST_VOICES_REQUIRED/, 'a conversation needs two voices');
  assert.throws(() => request({ hosts: [{ voiceId: 'kokoro:ef_dora' }, { voiceId: 'phonon:abc' }] }), /PODCAST_VOICE_ENGINE_MISMATCH/);
  assert.equal(request({ ttsModelId: 'ming3-0.5b-mlx-8bit', hosts: [{ voiceId: 'ming:x' }, { voiceId: 'user:abc' }] }).hosts.length, 2, 'Ming accepts built-in and cloned voices together');
  assert.throws(() => request({ hosts: [{ voiceId: 'ming:x' }, { voiceId: 'kokoro:y' }] }), /PODCAST_VOICE_ENGINE_MISMATCH/);
  assert.throws(() => request({ hosts: [{ voiceId: 'pocket:x' }, { voiceId: 'pocket:y' }] }), /PODCAST_VOICE_ENGINE_MISMATCH/);
  assert.throws(() => request({ ttsModelId: '' }), /PODCAST_NO_TTS_MODEL/);
});

test('an edited script is normalised for its hosts and chapters', () => {
  const script = p.normalizePodcastScript({ turns: [
    { id: 'a', speaker: 'B', text: '  Hola   ', chapterIndex: 9 },
    { id: 'a', speaker: 'Z', text: 'Segundo' },
    { speaker: 'A', text: '   ' },
  ] }, 1, 3);
  assert.deepEqual(script.turns.map((t) => [t.id, t.speaker, t.chapterIndex, t.text]), [['a', 'A', 2, 'Hola'], ['a-1', 'A', 0, 'Segundo']]);
  assert.throws(() => p.normalizePodcastScript({ turns: [] }, 2, 2), /PODCAST_EMPTY_SCRIPT/);
});

test('the rundown keeps the chapter count, known sources and a cover', () => {
  const r = request();
  const plan = p.normalizePlan({
    title: 'Recordar juntos',
    chapters: [
      { title: 'Uno', goal: 'g', keyPoints: ['a'], sourceIds: ['S1', 'S99'] },
      { title: 'Dos', sourceIds: [] },
      { title: 'Tres', keyPoints: ['extra'], sourceIds: ['S6'] },
    ],
    imageIdeas: ['portada', 'escena 1', 'escena 2'],
  }, r, evidence, 2, [300, 300]);
  assert.equal(plan.chapters.length, 2);
  assert.deepEqual(plan.chapters[0].sourceIds, ['S1'], 'unknown ids are dropped');
  assert.ok(plan.chapters[1].sourceIds.includes('S6'), 'an extra chapter merges into the last');
  assert.ok(plan.chapters[1].keyPoints.includes('extra'));
  assert.deepEqual(plan.images.map((i) => [i.slot, i.chapterIndex, i.idea]), [[0, null, 'portada'], [1, 0, 'escena 1'], [2, 1, 'escena 2']]);
  const empty = p.normalizePlan({ chapters: [{ title: 'Solo' }, { title: 'Dos' }] }, r, evidence, 2, [200, 200]);
  assert.ok(empty.chapters.every((c) => c.sourceIds.length > 0), 'a chapter without sources borrows the least used');
  const fallback = p.normalizePlan(null, r, evidence, 3, [100, 100, 100]);
  assert.equal(fallback.chapters.length, 3);
  assert.equal(fallback.title, r.objective);
});

test('turns are cleaned for the ear and coerced to the available hosts', () => {
  assert.equal(p.speakableTurnText('Como dice **Halbwachs** [S3] en [su obra](nodus://work/abc) — ver https://x.y.'), 'Como dice Halbwachs en su obra — ver.');
  const r = request({ format: 'essay' });
  const chapter = { index: 0, title: 'c', goal: '', keyPoints: [], sourceIds: [], targetWords: 100 };
  const turns = p.normalizeTurns({ turns: [
    { speaker: 'B', text: 'Primera frase.', sources: ['S1', 'S99'] },
    { speaker: 'A', text: 'Segunda frase.', sources: ['S2'] },
    { speaker: 'A', text: '' },
  ] }, r, chapter, new Set(['S1', 'S2']), 1);
  assert.equal(turns.length, 1, 'one host: consecutive turns merge');
  assert.equal(turns[0].speaker, 'A');
  assert.equal(turns[0].text, 'Primera frase. Segunda frase.');
  assert.deepEqual(turns[0].sourceIds, ['S1', 'S2']);
});

test('review fixes rewrite and drop, but never empty a chapter', () => {
  const script = { turns: [
    { id: 't1', chapterIndex: 0, speaker: 'A', text: 'Hola', sourceIds: [] },
    { id: 't2', chapterIndex: 0, speaker: 'B', text: 'Halbwachs nació en 1999', sourceIds: ['S1'] },
    { id: 't3', chapterIndex: 1, speaker: 'A', text: 'Cierre', sourceIds: [] },
  ] };
  const fixed = p.applyReviewFixes(script, { fixes: [{ turnId: 't2', action: 'rewrite', text: 'Halbwachs nació en 1877 [S1]' }, { turnId: 't1', action: 'drop' }] });
  assert.deepEqual(fixed.turns.map((t) => t.text), ['Halbwachs nació en 1877', 'Cierre']);
  const guarded = p.applyReviewFixes(script, { fixes: [{ turnId: 't3', action: 'drop' }] });
  assert.equal(guarded, script, 'dropping the only turn of a chapter is refused');
  assert.equal(p.applyReviewFixes(script, 'nonsense').turns.length, 3);
});

function fakeDeps({ chapterWords = 400, condense = true, failPlan = false } = {}) {
  const calls = { evidence: 0, plan: 0, chapter: 0, review: 0, condense: 0, checkpoints: [], progress: [] };
  return {
    calls,
    deps: {
      async gatherEvidence(_r, _s, report) { calls.evidence += 1; report('buscando'); return evidence; },
      wpm: () => null,
      async json(call) {
        const user = JSON.parse(call.user);
        if (call.system.includes('escaleta')) {
          calls.plan += 1;
          if (failPlan) throw new Error('transport');
          return { title: 'Recordar juntos', hook: 'h', summary: 's', chapters: Array.from({ length: user.chapterCount }, (_, i) => ({ title: `Capítulo ${i + 1}`, goal: 'g', keyPoints: ['k'], sourceIds: [`S${i + 1}`] })), imageIdeas: ['a', 'b', 'c'] };
        }
        if (call.system.includes('UN capítulo')) {
          calls.chapter += 1;
          return { turns: [
            { speaker: 'A', text: `Pregunta ${user.chapter.number}. ${words(chapterWords / 2)}`, sources: [] },
            { speaker: 'B', text: `Respuesta ${user.chapter.number}. ${words(chapterWords / 2)}`, sources: user.sources.map((s) => s.id) },
          ] };
        }
        if (call.system.includes('verificador')) { calls.review += 1; return { fixes: [] }; }
        if (call.system.includes('quedado corto')) {
          calls.expand = (calls.expand ?? 0) + 1;
          return { turns: user.turns.map((t) => ({ ...t, text: words(Math.ceil(user.targetWords / user.turns.length)) })) };
        }
        if (call.system.includes('Condensa')) {
          calls.condense += 1;
          if (!condense) return { turns: [] };
          return { turns: user.turns.map((t) => ({ ...t, text: words(Math.max(10, Math.floor(user.targetWords / user.turns.length))) })) };
        }
        throw new Error(`unexpected call: ${call.system.slice(0, 40)}`);
      },
      progress: (progress) => calls.progress.push(progress.phase),
      checkpoint: (checkpoint) => calls.checkpoints.push(Object.keys(checkpoint).filter((k) => checkpoint[k]).sort().join(',')),
    },
  };
}

test('the script is built stage by stage and a resumed job skips finished stages', async () => {
  const r = request();
  const { calls, deps } = fakeDeps();
  const signal = new AbortController().signal;
  const built = await p.buildPodcastScript(r, {}, deps, signal);
  assert.equal(calls.evidence, 1);
  assert.equal(calls.chapter, 2, 'one call per chapter');
  assert.equal(calls.review, 1);
  assert.deepEqual(calls.checkpoints, ['evidence', 'evidence,plan', 'evidence,plan,script', 'evidence,plan,reviewed,script']);
  assert.deepEqual([...new Set(calls.progress)], ['researching', 'planning', 'writing', 'reviewing']);
  assert.deepEqual(built.script.turns.map((t) => t.id), ['t1', 't2', 't3', 't4']);
  assert.deepEqual(built.script.turns.map((t) => t.speaker), ['A', 'B', 'A', 'B']);
  assert.equal(built.plan.images.length, 3, 'cover plus two chapter images');

  const resumed = fakeDeps();
  await p.buildPodcastScript(r, { evidence, plan: built.plan }, resumed.deps, signal);
  assert.equal(resumed.calls.evidence, 0, 'research is never repeated after a restart');
  assert.equal(resumed.calls.plan, 0);
  assert.equal(resumed.calls.chapter, 2);

  const finished = fakeDeps();
  const again = await p.buildPodcastScript(r, { evidence, plan: built.plan, script: built.script, reviewed: true }, finished.deps, signal);
  assert.equal(finished.calls.chapter + finished.calls.review, 0);
  assert.equal(again.script, built.script);
});

test('a plan call that fails falls back to an even rundown; no sources fails the job', async () => {
  const { deps } = fakeDeps({ failPlan: true });
  const built = await p.buildPodcastScript(request(), {}, deps, new AbortController().signal);
  assert.equal(built.plan.chapters.length, 2);
  const empty = fakeDeps();
  empty.deps.gatherEvidence = async () => ({ ...evidence, sources: [] });
  await assert.rejects(p.buildPodcastScript(request(), {}, empty.deps, new AbortController().signal), /PODCAST_NO_SOURCES/);
});

test('an over-long script is condensed under the cap, or trimmed if the model will not', async () => {
  const r = request({ durationCapMin: 5 });
  const { calls, deps } = fakeDeps({ chapterWords: 900 });
  const built = await p.buildPodcastScript(r, {}, deps, new AbortController().signal);
  assert.ok(calls.condense >= 1);
  assert.ok(p.estimatePodcastSeconds(built.script) <= 300, `fits: ${p.estimatePodcastSeconds(built.script)}`);

  const stubborn = fakeDeps({ chapterWords: 900, condense: false });
  const trimmed = await p.buildPodcastScript(r, {}, stubborn.deps, new AbortController().signal);
  assert.ok(trimmed.script.turns.length >= 2, 'never trims a chapter to nothing');
});

test('cancellation stops the job between stages', async () => {
  const controller = new AbortController();
  const { deps } = fakeDeps();
  deps.gatherEvidence = async () => { controller.abort(new Error('cancelled')); return evidence; };
  await assert.rejects(p.buildPodcastScript(request(), {}, deps, controller.signal), /cancelled/);
});

test('recording places every turn with the right pause and marks chapters', async () => {
  const r = request();
  const plan = { title: 't', hook: '', summary: '', images: [], chapters: [{ index: 0, title: 'Uno' }, { index: 1, title: 'Dos' }] };
  const script = { turns: [
    { id: 't1', chapterIndex: 0, speaker: 'A', text: 'uno', sourceIds: [] },
    { id: 't2', chapterIndex: 0, speaker: 'A', text: 'dos', sourceIds: [] },
    { id: 't3', chapterIndex: 0, speaker: 'B', text: 'tres', sourceIds: [] },
    { id: 't4', chapterIndex: 1, speaker: 'B', text: 'cuatro', sourceIds: [] },
  ] };
  const voiced = [];
  const gaps = [];
  let cursor = 0;
  const timeline = await p.recordScript(r, plan, script, null, {
    synthesize: async (text, voiceId) => { voiced.push(voiceId); return [`${text}.wav`]; },
    append: async (paths, gap) => { gaps.push(gap); const startS = cursor + (cursor ? gap / 1000 : 0); cursor = startS + 2; return { startS, durationS: 2 }; },
    progress: () => {},
  }, new AbortController().signal);
  assert.deepEqual(voiced, ['kokoro:ef_dora', 'kokoro:ef_dora', 'kokoro:em_alex', 'kokoro:em_alex']);
  assert.deepEqual(gaps, [0, 180, 350, 900]);
  assert.deepEqual(timeline.chapters.map((c) => [c.index, c.title]), [[0, 'Uno'], [1, 'Dos']]);
  assert.equal(timeline.chapters[1].startS, timeline.turns[3].startS);
  assert.equal(p.speechSeconds(timeline), 8);
  await assert.rejects(p.recordScript(r, plan, script, null, { synthesize: async () => [], append: async () => ({ startS: 0, durationS: 0 }), progress: () => {} }, new AbortController().signal), /PODCAST_NOTHING_RECORDED/);
});

test('a research snapshot becomes a dossier with short ids, tensions as sources and gaps', () => {
  const dossier = p.dossierFromSnapshot({
    passages: [
      { id: 'p1', label: 'Les cadres sociaux', summary: 'La memoria es social.', authors: ['Halbwachs, Maurice'], year: 1925, pageLabel: '12', citation: 'nodus://passage/p1' },
      { id: 'p2', label: 'Vacío', summary: '   ', authors: [], year: null, pageLabel: null, citation: 'nodus://passage/p2' },
    ],
    ideas: [{ id: 'i1', label: 'Memoria colectiva', statement: 'Los grupos recuerdan.', summary: '', works: [{ authors: ['Nora, Pierre', 'Ricoeur, Paul', 'Assmann, Jan'], year: 1984 }] }],
    contradictions: [{ id: 'c1', label: 'A / B', summary: 'Una cosa / otra', fromLabel: 'A', toLabel: 'B', sources: ['Halbwachs (1925)'] }],
    gaps: [{ summary: 'Falta lo digital' }],
  }, [{ id: 'w1', title: 'Página', site: 'example.org', url: 'https://example.org', published: '2024-02-01', text: 'Texto web', citation: 'nodus://passage/w1' }], 'log');
  assert.deepEqual(dossier.sources.map((s) => [s.id, s.kind]), [['S1', 'passage'], ['S2', 'idea'], ['S3', 'web'], ['S4', 'idea']]);
  assert.equal(dossier.sources[0].authors, 'Halbwachs');
  assert.equal(dossier.sources[0].location, 'p. 12');
  assert.equal(dossier.sources[1].authors, 'Nora et al.');
  assert.equal(dossier.sources[2].year, '2024');
  assert.deepEqual(dossier.tensions[0].sourceIds, ['S4'], 'a debate can cite the disagreement itself');
  assert.deepEqual(dossier.gaps, ['Falta lo digital']);
  assert.equal(p.clip('x'.repeat(10), 4), 'xxxx…');
});

test('the exported transcript has chapters, speakers, times and sources without in-app links', () => {
  const md = p.podcastTranscriptMarkdown({
    title: 'Recordar juntos', language: 'es',
    plan: { summary: 'Resumen.', chapters: [{ index: 0, title: 'Apertura' }, { index: 1, title: 'Cierre' }] },
    request: { hosts: [{ speaker: 'A', name: 'Dora' }, { speaker: 'B', name: 'Alex' }] },
    script: { turns: [
      { id: 't1', chapterIndex: 0, speaker: 'A', text: 'Hola.', sourceIds: [] },
      { id: 't2', chapterIndex: 1, speaker: 'B', text: 'Adiós.', sourceIds: ['S1'] },
    ] },
    sources: [{ id: 'S1', title: 'Les cadres sociaux', authors: 'Halbwachs', year: 1925, link: 'nodus://passage/x', excerpt: 'x' }, { id: 'S2', title: 'Sin citar', excerpt: 'y' }],
    timeline: { turns: [{ turnId: 't1', startS: 0, durationS: 1 }, { turnId: 't2', startS: 65, durationS: 1 }], chapters: [{ index: 0, startS: 0 }, { index: 1, startS: 65 }] },
  });
  assert.match(md, /^# Recordar juntos/);
  assert.match(md, /## Cierre \(1:05\)/);
  assert.match(md, /\[1:05\] \*\*Alex:\*\* Adiós\./);
  assert.match(md, /## Fuentes\n\n- Halbwachs, 1925\. Les cadres sociaux/);
  assert.doesNotMatch(md, /nodus:\/\//, 'no in-app links outside the app');
  assert.doesNotMatch(md, /Sin citar/, 'only cited sources');
});

test('a script that comes up short is developed towards the cap, never past it', async () => {
  const r = request({ durationCapMin: 5 });
  const { calls, deps } = fakeDeps({ chapterWords: 120 });
  deps.wpm = () => 180;
  const built = await p.buildPodcastScript(r, {}, deps, new AbortController().signal);
  assert.ok(calls.expand >= 1, 'the short chapters were developed');
  const seconds = p.estimatePodcastSeconds(built.script, 180);
  assert.ok(seconds >= 300 * 0.82 && seconds <= 300, `between 82% and 100% of the cap: ${seconds}`);
});
