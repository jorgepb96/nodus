// The Ming TTS host owns a Python sidecar. Drive the REAL host (electron/tts/host.ts,
// bundled with esbuild) against a fake sidecar that speaks the same JSON-lines protocol,
// and lock the lifecycle guarantees: lazy start at lower priority, one model resident,
// jobs in priority order, per-fragment events, cooperative cancel, a kill when a cancel
// is ignored, idle unload, and a synchronous kill for the quit paths.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-tts-host-test-'));

const FAKE = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const mode = process.env.FAKE_MODE || 'normal';
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
let cancelled = new Set();
out({ type: 'ready', backend: 'mlx', device: 'metal' });
let buffer = '';
const queue = [];
let busy = false;
async function handle(m) {
  if (m.type === 'load') { out({ type: 'loaded', id: m.id, load_s: 0.01 }); out({ type: 'warm', id: m.id, warmup_s: 0.01 }); return; }
  if (m.type === 'exit') process.exit(0);
  if (m.type === 'synth') {
    const words = m.text.split(/\s+/).filter(Boolean);
    const total = Math.max(1, Math.ceil(words.length / 5));
    fs.mkdirSync(m.out_dir, { recursive: true });
    for (let n = 0; n < total; n++) {
      if (cancelled.has(m.job_id)) { out({ type: 'cancelled', job_id: m.job_id }); return; }
      await new Promise((r) => setTimeout(r, mode === 'stuck' ? 60000 : 30));
      const file = path.join(m.out_dir, String(n).padStart(3, '0') + '.wav');
      fs.writeFileSync(file, 'RIFF');
      out({ type: 'fragment', job_id: m.job_id, n, total, path: file, duration_s: 2, gen_s: 1 });
      // A path outside out_dir must be ignored by the host.
      if (n === 0) out({ type: 'fragment', job_id: m.job_id, n: 99, total, path: '/etc/passwd', duration_s: 2, gen_s: 1 });
    }
    out({ type: 'done', job_id: m.job_id, total_audio_s: total * 2, total_gen_s: total });
  }
}
async function drain() { if (busy) return; busy = true; while (queue.length) await handle(queue.shift()); busy = false; }
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.type === 'cancel') { cancelled.add(m.job_id); continue; }
    queue.push(m); void drain();
  }
});
process.stdin.on('end', () => process.exit(0));
`;

try {
  const fakeScript = path.join(tmp, 'fake-serve.cjs');
  await writeFile(fakeScript, FAKE);
  const outfile = path.join(tmp, 'host.mjs');
  await build({ entryPoints: [path.join(repoRoot, 'electron/tts/host.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { TtsEngineHost } = await import(pathToFileURL(outfile).href);

  const makeHost = (mode = 'normal', extra = {}) => {
    const states = [];
    const spawned = [];
    const lowered = [];
    const host = new TtsEngineHost({
      python: async () => process.execPath,
      backend: () => 'mlx',
      serveScript: fakeScript,
      modelPath: (id) => path.join(tmp, 'models', id),
      liveDir: path.join(tmp, 'live'),
      logPath: path.join(tmp, 'engine.log'),
      idleMs: () => 30_000,
      onState: (s) => states.push(s.state),
      spawn: (_command, _args, options) => {
        const child = spawn(process.execPath, [fakeScript], { ...options, env: { ...options.env, FAKE_MODE: mode } });
        spawned.push(child);
        return child;
      },
      lowerPriority: (pid) => lowered.push(pid),
      cancelGraceMs: 300,
      ...extra,
    });
    return { host, states, spawned, lowered };
  };

  // ── Lazy start, lower priority, per-fragment events, unsafe paths ignored ───
  {
    const { host, spawned, lowered, states } = makeHost();
    assert.equal(host.snapshot().state, 'unloaded');
    assert.equal(spawned.length, 0, 'nothing runs until a job arrives');
    const fragments = [];
    const { done } = host.synth('ming3-0.5b-mlx-8bit', { text: 'uno dos tres cuatro cinco seis siete ocho nueve diez once', voice: { kind: 'builtin', name: 'US_James' }, language: 'es' }, { onFragment: (f) => fragments.push(f) });
    const result = await done;
    assert.equal(spawned.length, 1);
    assert.deepEqual(lowered, [spawned[0].pid], 'the sidecar runs at a lower priority');
    assert.equal(result.cancelled, false);
    assert.equal(result.fragments.length, 3);
    assert.deepEqual(fragments.map((f) => f.index), [0, 1, 2], 'fragments arrive one by one and outside paths are dropped');
    assert.equal(result.audioS, 6);
    assert.ok(states.includes('loading') && states.includes('busy'));
    assert.equal(host.snapshot().modelId, 'ming3-0.5b-mlx-8bit');
    assert.ok(host.snapshot().idleUnloadAt > Date.now(), 'an idle unload is scheduled after the job');
    assert.ok(host.isModelInUse('ming3-0.5b-mlx-8bit'));

    // A second job reuses the warm process.
    await host.synth('ming3-0.5b-mlx-8bit', { text: 'hola mundo', voice: { kind: 'builtin', name: 'US_James' }, language: 'es' }).done;
    assert.equal(spawned.length, 1, 'the warm sidecar is reused');

    await host.unload();
    assert.equal(host.snapshot().state, 'unloaded');
    assert.equal(host.isModelInUse('ming3-0.5b-mlx-8bit'), false);
  }

  // ── Priority order and cancelling a queued job ──────────────────────────────
  {
    const { host } = makeHost();
    const order = [];
    const voice = { kind: 'builtin', name: 'US_James' };
    const a = host.synth('m', { text: 'a b c d e f g h i j', voice, language: 'en', priority: 0 }, { onStart: () => order.push('a') });
    const b = host.synth('m', { text: 'b', voice, language: 'en', priority: 0 }, { onStart: () => order.push('b') });
    const c = host.synth('m', { text: 'c', voice, language: 'en', priority: 10 }, { onStart: () => order.push('c') });
    const d = host.synth('m', { text: 'd', voice, language: 'en', priority: 0 }, { onStart: () => order.push('d') });
    host.cancel(b.jobId);
    const [ra, rb, rc] = await Promise.all([a.done, b.done, c.done, d.done]);
    assert.equal(rb.cancelled, true, 'a queued job is dropped without running');
    assert.equal(ra.cancelled, false);
    assert.equal(rc.cancelled, false);
    // `a` started at once on an idle engine; among the queued, priority wins and ties keep order.
    assert.deepEqual(order, ['a', 'c', 'd'], 'higher priority runs first; cancelled jobs never start');
    await host.unload();
  }

  // ── Cooperative cancel of a running job ─────────────────────────────────────
  {
    const { host } = makeHost();
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
    let seen = 0;
    const job = host.synth('m', { text: words, voice: { kind: 'builtin', name: 'US_James' }, language: 'en' }, {
      onFragment: () => { seen += 1; if (seen === 2) host.cancel(job.jobId); },
    });
    const result = await job.done;
    assert.equal(result.cancelled, true);
    assert.ok(result.fragments.length < 12, 'generation stops between fragments');
    await host.unload();
  }

  // ── A cancel the sidecar ignores kills the process ──────────────────────────
  {
    const { host, spawned } = makeHost('stuck');
    const job = host.synth('m', { text: 'una frase larga que no termina nunca', voice: { kind: 'builtin', name: 'US_James' }, language: 'es' }, { onStart: () => setTimeout(() => host.cancel(job.jobId), 50) });
    const result = await job.done;
    assert.equal(result.cancelled, true);
    await new Promise((r) => setTimeout(r, 200));
    assert.notEqual(spawned[0].exitCode === null && spawned[0].signalCode === null, true, 'the stuck sidecar was killed');
    assert.equal(host.snapshot().state, 'unloaded');
  }

  // ── Missing runtime fails clearly; killSync for quit paths ──────────────────
  {
    const { host } = makeHost('normal', { python: async () => null });
    await assert.rejects(host.synth('m', { text: 'x', voice: { kind: 'builtin', name: 'US_James' }, language: 'en' }).done, /TTS_RUNTIME_NOT_INSTALLED/);
    const live = makeHost();
    await live.host.load('m');
    assert.equal(live.host.snapshot().state, 'ready');
    live.host.killSync();
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(live.spawned[0].killed || live.spawned[0].exitCode !== null || live.spawned[0].signalCode !== null, 'killSync stops the process');
  }
  console.log('tts host lifecycle tests passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
