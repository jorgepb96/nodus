// The podcast lane with a fake pipeline: one job at a time, bound to its vault, persisted
// after every transition, restored after a quit (a running job resumes from its checkpoint),
// cancellable while running, parked for script review without holding the lane, and
// retryable after a failure without losing finished stages.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-podcast-queue-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'queue.mjs');
await build({ entryPoints: [path.join(repoRoot, 'electron/podcast/podcastQueue.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', alias: { '@shared': path.join(repoRoot, 'shared') } });
const { PodcastQueue } = await import(pathToFileURL(outfile).href);

const request = (objective = 'Tema') => ({
  objective, format: 'essay', language: 'es', ttsModelId: 'kokoro-82m-int8',
  hosts: [{ voiceId: 'kokoro:ef_dora', name: 'Dora' }], durationCapMin: 5, cover: false, extraImages: 0, reviewScript: false,
});
const plan = { title: 'T', hook: '', summary: '', images: [], chapters: [{ index: 0, title: 'Uno' }, { index: 1, title: 'Dos' }] };
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle(queue) { for (let i = 0; i < 20 && (queue.busy() || queue.list().some((j) => j.status === 'queued' && j.vaultId === 'v1')); i += 1) await tick(); }

function harness({ vault = 'v1', run, load } = {}) {
  const state = { vault, persisted: null, settled: [], runs: [] };
  let ids = 0;
  const queue = new PodcastQueue({
    activeVault: () => ({ id: state.vault, name: state.vault }),
    run: async (job, context) => { state.runs.push(job); return run ? run(job, context) : { outcome: 'done', episodeId: `ep-${job.id}` }; },
    persist: (jobs) => { state.persisted = jobs; },
    onSettled: (job) => state.settled.push(`${job.id}:${job.status}`),
    load,
    newId: () => `j${(ids += 1)}`,
    now: () => '2026-11-08T00:00:00.000Z',
  });
  return { queue, state };
}

test('jobs run one at a time, in order, and only in their own vault', async () => {
  let active = 0;
  let peak = 0;
  const { queue, state } = harness({ run: async (job) => { active += 1; peak = Math.max(peak, active); await tick(); await tick(); active -= 1; return { outcome: 'done', episodeId: `ep-${job.id}` }; } });
  queue.enqueue(request('a'));
  queue.enqueue(request('b'));
  state.vault = 'v2';
  queue.enqueue(request('c'));
  state.vault = 'v1';
  await settle(queue);
  assert.equal(peak, 1, 'never two at once');
  assert.deepEqual(state.runs.map((job) => job.request.objective), ['a', 'b']);
  const c = queue.list().find((job) => job.request.objective === 'c');
  assert.equal(c.status, 'queued', 'a job of another vault waits for its vault');
  state.vault = 'v2';
  await queue.drain();
  assert.equal(queue.get(c.id).status, 'done');
  assert.equal(queue.get('j1').episodeId, 'ep-j1');
  assert.equal(queue.get('j1').checkpoint, undefined, 'a finished job drops its checkpoint');
  assert.ok(state.persisted.length === 3, 'every transition is persisted');
});

test('invalid requests are refused before they enter the lane', () => {
  const { queue } = harness();
  assert.throws(() => queue.enqueue({ ...request(), objective: ' ' }), /PODCAST_EMPTY_OBJECTIVE/);
  assert.equal(queue.list().length, 0);
});

test('progress, title and checkpoints reach the record', async () => {
  const seen = [];
  const { queue, state } = harness({ run: async (_job, context) => {
    context.progress({ phase: 'writing', done: 1, total: 2, message: 'Uno' });
    seen.push(state.persisted.at(-1).phase);
    context.title('Título');
    context.checkpoint({ evidence: { sources: [], tensions: [], gaps: [], log: '' }, plan });
    seen.push(Boolean(state.persisted.at(-1).checkpoint.plan));
    return { outcome: 'done', episodeId: 'ep' };
  } });
  queue.enqueue(request());
  await settle(queue);
  assert.deepEqual(seen, ['writing', true]);
  assert.equal(queue.get('j1').title, 'Título');
});

test('cancelling a running job aborts it and frees the lane; a queued one is cancelled at once', async () => {
  let release;
  const { queue, state } = harness({ run: (job, context) => new Promise((resolve, reject) => {
    if (job.request.objective === 'second') { resolve({ outcome: 'done', episodeId: 'x' }); return; }
    context.signal.addEventListener('abort', () => reject(context.signal.reason));
    release = resolve;
  }) });
  queue.enqueue(request('first'));
  queue.enqueue(request('second'));
  queue.enqueue(request('third'));
  await tick();
  assert.equal(queue.get('j1').status, 'running');
  queue.cancel('j3');
  assert.equal(queue.get('j3').status, 'cancelled');
  queue.cancel('j1');
  await settle(queue);
  assert.equal(queue.get('j1').status, 'cancelled');
  assert.equal(queue.get('j2').status, 'done', 'the lane moves on');
  assert.deepEqual(state.settled, ['j3:cancelled', 'j1:cancelled', 'j2:done']);
  assert.equal(typeof release, 'function');
});

test('a failure is recorded with its code and a retry keeps the checkpoint', async () => {
  let attempts = 0;
  const { queue, state } = harness({ run: async (job, context) => {
    attempts += 1;
    if (attempts === 1) { context.checkpoint({ evidence: { sources: [{ id: 'S1' }], tensions: [], gaps: [], log: '' } }); throw new Error('TTS_RUNTIME_NOT_INSTALLED'); }
    assert.equal(job.checkpoint.evidence.sources[0].id, 'S1', 'the retried run starts from the checkpoint');
    return { outcome: 'done', episodeId: 'ep' };
  } });
  queue.enqueue(request());
  await settle(queue);
  assert.equal(queue.get('j1').status, 'failed');
  assert.equal(queue.get('j1').error, 'TTS_RUNTIME_NOT_INSTALLED');
  queue.retry('j1');
  await settle(queue);
  assert.equal(queue.get('j1').status, 'done');
  assert.equal(state.runs.length, 2);
  assert.throws(() => queue.retry('j1'), /PODCAST_NOT_FAILED/);
});

test('script review parks the job without holding the lane; approval resumes it', async () => {
  const { queue, state } = harness({ run: async (job, context) => {
    if (job.request.reviewScript && !job.checkpoint?.reviewed) {
      context.checkpoint({ evidence: { sources: [], tensions: [], gaps: [], log: '' }, plan, script: { turns: [{ id: 't1', chapterIndex: 0, speaker: 'A', text: 'Hola', sourceIds: [] }] } });
      return { outcome: 'awaiting_review' };
    }
    return { outcome: 'done', episodeId: `ep-${job.id}` };
  } });
  queue.enqueue({ ...request('review'), reviewScript: true });
  queue.enqueue(request('next'));
  await settle(queue);
  assert.equal(queue.get('j1').status, 'awaiting_review');
  assert.equal(queue.get('j2').status, 'done', 'a parked job does not block the next');
  assert.throws(() => queue.approve('j2'), /PODCAST_NOT_AWAITING_REVIEW/);
  const edited = queue.updateScript('j1', { turns: [{ speaker: 'B', text: 'Editado', chapterIndex: 5 }] });
  assert.deepEqual(edited.checkpoint.script.turns.map((t) => [t.speaker, t.chapterIndex, t.text]), [['A', 1, 'Editado']], 'normalised for one host and two chapters');
  queue.approve('j1');
  await settle(queue);
  assert.equal(queue.get('j1').status, 'done');
  assert.equal(state.runs.at(-1).checkpoint.script.turns[0].text, 'Editado', 'recording uses the edited script');
  assert.equal(state.runs.at(-1).request.reviewScript, false);
});

test('a restart queues an interrupted job again and keeps parked ones parked', async () => {
  const saved = [
    { id: 'old-run', vaultId: 'v1', request: request('interrupted'), status: 'running', phase: 'recording', createdAt: 'x', checkpoint: { plan } },
    { id: 'old-park', vaultId: 'v1', request: request('parked'), status: 'awaiting_review', phase: 'awaiting_review', createdAt: 'x' },
  ];
  const { queue, state } = harness({ load: () => saved });
  assert.equal(queue.get('old-run').status, 'queued');
  await queue.drain();
  assert.equal(state.runs[0].id, 'old-run');
  assert.ok(state.runs[0].checkpoint.plan, 'the resumed run gets its checkpoint');
  assert.equal(queue.get('old-park').status, 'awaiting_review');
});

test('clearing finished jobs keeps pending and parked ones', async () => {
  const { queue } = harness({ run: async (job) => (job.request.reviewScript ? { outcome: 'awaiting_review' } : { outcome: 'done', episodeId: 'e' }) });
  queue.enqueue(request());
  queue.enqueue({ ...request(), reviewScript: true });
  await settle(queue);
  queue.clearFinished();
  assert.deepEqual(queue.list().map((job) => job.status), ['awaiting_review']);
});
