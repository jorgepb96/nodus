// The Ming-3.0 TTS sidecar's side of the pipe (runtime/ming-tts/serve.py), driven
// through its fake backend: no model and no packages, so this runs on any interpreter.
// What is under test is the protocol the Electron host relies on: one ready line,
// nothing but JSON on stdout, fragments written to disk in order, exactly one terminal
// event per job, cooperative cancellation, and exit as soon as stdin closes.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync, spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const runtime = path.join(root, 'runtime', 'ming-tts');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ming-sidecar-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const interpreter = ['python3', 'python'].find(candidate => {
  try { execFileSync(candidate, ['-c', 'import sys; assert sys.version_info >= (3, 9)'], { stdio: 'ignore' }); return true; }
  catch { return false; }
});
const hasNumpy = Boolean(interpreter) && (() => {
  try { execFileSync(interpreter, ['-I', '-c', 'import numpy'], { stdio: 'ignore' }); return true; }
  catch { return false; }
})();

const modelDir = path.join(scratch, 'model');
fs.mkdirSync(modelDir, { recursive: true });
fs.writeFileSync(path.join(modelDir, 'config.json'), '{}');

function start() {
  // Started exactly as electron/tts/host.ts starts it: no --models-dir, scrubbed environment.
  const child = spawn(interpreter, ['-I', '-B', path.join(runtime, 'serve.py'), '--backend', 'fake'], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '' },
  });
  const events = [];
  const waiters = [];
  const nonJson = [];
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  readline.createInterface({ input: child.stdout }).on('line', line => {
    let event;
    try { event = JSON.parse(line); } catch { nonJson.push(line); return; }
    events.push(event);
    for (const waiter of [...waiters]) if (waiter.match(event)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(event); }
  });
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
  return {
    child, events, nonJson, exited, stderr: () => stderr,
    send: message => child.stdin.write(`${JSON.stringify(message)}\n`),
    next(match, timeout = 20_000) {
      const seen = events.find(match);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out; events: ${JSON.stringify(events)}\nstderr: ${stderr}`)), timeout);
        waiters.push({ match, resolve: event => { clearTimeout(timer); resolve(event); } });
      });
    },
  };
}

const terminal = new Set(['done', 'error', 'cancelled']);
const endOf = (sidecar, job) => sidecar.next(event => event.job_id === job && terminal.has(event.type));
const LONG = 'One two three four five six seven eight nine ten. '.repeat(12);

test('the Ming sidecar protocol', { skip: interpreter ? false : 'no Python interpreter on PATH' }, async t => {
  const sidecar = start();
  t.after(() => sidecar.child.kill());

  await t.test('announces itself once, before anything else', async () => {
    const ready = await sidecar.next(event => event.type === 'ready');
    assert.equal(sidecar.events[0], ready);
    assert.equal(ready.backend, 'fake');
    assert.equal(ready.protocol, 1);
    assert.ok(['metal', 'cuda', 'cpu'].includes(ready.device), ready.device);
  });

  await t.test('refuses to synthesize before a model is loaded', async () => {
    sidecar.send({ type: 'synth', job_id: 'early', text: 'Hola.', voice: { kind: 'builtin', name: 'US_James' }, lang: 'es', out_dir: path.join(scratch, 'early') });
    const end = await endOf(sidecar, 'early');
    assert.equal(end.type, 'error');
    assert.match(end.message, /no model loaded/);
  });

  await t.test('loads, then warms up on its own', async () => {
    sidecar.send({ type: 'load', id: 'l1', model_path: modelDir, model_id: 'fake-model' });
    const loaded = await sidecar.next(event => event.type === 'loaded' && event.id === 'l1');
    const warm = await sidecar.next(event => event.type === 'warm' && event.id === 'l1');
    assert.equal(typeof loaded.load_s, 'number');
    assert.equal(typeof warm.warmup_s, 'number');
    assert.ok(sidecar.events.indexOf(loaded) < sidecar.events.indexOf(warm));
  });

  await t.test('rejects bad requests without dying', async () => {
    sidecar.send({ type: 'load', id: 'bad-id', model_path: modelDir, model_id: '../escape' });
    assert.equal((await sidecar.next(event => event.id === 'bad-id')).type, 'error');
    sidecar.send({ type: 'synth', job_id: 'bad-lang', text: 'Hola.', voice: { kind: 'builtin', name: 'US_James' }, lang: 'pt', out_dir: path.join(scratch, 'x') });
    assert.match((await endOf(sidecar, 'bad-lang')).message, /unsupported lang/);
    sidecar.send({ type: 'synth', job_id: 'bad-voice', text: 'Hola.', voice: { kind: 'builtin', name: 'alloy' }, lang: 'es', out_dir: path.join(scratch, 'x') });
    assert.match((await endOf(sidecar, 'bad-voice')).message, /built-in voice/);
    sidecar.send({ type: 'frobnicate', id: 'unknown' });
    assert.equal((await sidecar.next(event => event.id === 'unknown')).type, 'error');
    sidecar.child.stdin.write('this is not json\n');
    await sidecar.next(event => event.type === 'error' && /invalid command/.test(event.message));
    sidecar.send({ type: 'ping', id: 'alive' });
    assert.equal((await sidecar.next(event => event.id === 'alive')).type, 'pong');
  });

  await t.test('writes every fragment in order and ends with done', async () => {
    const out = path.join(scratch, 'job1');
    sidecar.send({ type: 'synth', job_id: 'job1', text: LONG, voice: { kind: 'builtin', name: 'US_James' }, lang: 'en', out_dir: out });
    const end = await endOf(sidecar, 'job1');
    assert.equal(end.type, 'done');
    const fragments = sidecar.events.filter(event => event.type === 'fragment' && event.job_id === 'job1');
    assert.ok(fragments.length > 1, 'a long text is split');
    assert.equal(end.total, fragments.length);
    fragments.forEach((fragment, n) => {
      assert.equal(fragment.n, n);
      assert.equal(fragment.total, fragments.length);
      assert.equal(fragment.path, path.join(out, `${String(n).padStart(3, '0')}.wav`));
      const wav = fs.readFileSync(fragment.path);
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.readUInt16LE(22), 1, 'mono');
      assert.equal(wav.readUInt32LE(24), fragment.sample_rate);
      assert.equal(wav.readUInt16LE(34), 16, 'PCM16');
      assert.ok(fragment.duration_s > 0 && fragment.gen_s >= 0);
    });
    assert.deepEqual(fs.readdirSync(out).sort(), fragments.map(f => path.basename(f.path)).sort(), 'no partial files left behind');
    const audio = fragments.reduce((sum, f) => sum + f.duration_s, 0);
    assert.ok(Math.abs(end.total_audio_s - audio) < 0.01);
  });

  await t.test('cancels a running job between steps and a queued one before it starts', async () => {
    const send = job => sidecar.send({ type: 'synth', job_id: job, text: LONG, voice: { kind: 'builtin', name: 'US_James' }, lang: 'en', out_dir: path.join(scratch, job) });
    send('running');
    send('queued');
    await sidecar.next(event => event.type === 'fragment' && event.job_id === 'running');
    sidecar.send({ type: 'cancel', job_id: 'queued' });
    sidecar.send({ type: 'cancel', job_id: 'running' });
    assert.equal((await endOf(sidecar, 'running')).type, 'cancelled');
    assert.equal((await endOf(sidecar, 'queued')).type, 'cancelled');
    assert.ok(!sidecar.events.some(event => event.job_id === 'queued' && event.type === 'fragment'));
    const running = sidecar.events.filter(event => event.job_id === 'running');
    assert.equal(running.filter(event => terminal.has(event.type)).length, 1, 'exactly one terminal event');
    assert.ok(running.filter(event => event.type === 'fragment').length < running.find(e => e.type === 'fragment').total);
    // A cancel for a finished job is not answered: its terminal event was already sent.
    const before = sidecar.events.length;
    sidecar.send({ type: 'cancel', job_id: 'job1' });
    sidecar.send({ type: 'ping', id: 'after-cancel' });
    await sidecar.next(event => event.id === 'after-cancel');
    assert.equal(sidecar.events.length, before + 1);
  });

  await t.test('refuses a job id that is already queued', async () => {
    const job = { type: 'synth', job_id: 'twice', text: LONG, voice: { kind: 'builtin', name: 'US_James' }, lang: 'en', out_dir: path.join(scratch, 'twice') };
    sidecar.send(job);
    sidecar.send(job);
    await sidecar.next(event => event.rejected_job_id === 'twice' && event.type === 'error' && /already queued/.test(event.message));
    assert.ok(!sidecar.events.some(event => event.job_id === 'twice' && terminal.has(event.type)), 'the queued job is untouched');
    sidecar.send({ type: 'cancel', job_id: 'twice' });
    assert.equal((await endOf(sidecar, 'twice')).type, 'cancelled');
  });

  await t.test('caches a clone voice and reuses it', { skip: hasNumpy ? false : 'numpy is not installed' }, async () => {
    const wav = path.join(scratch, 'ref.wav');
    const samples = 16000;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + samples * 2, 4); header.write('WAVEfmt ', 8, 'ascii');
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36, 'ascii');
    header.writeUInt32LE(samples * 2, 40);
    fs.writeFileSync(wav, Buffer.concat([header, Buffer.alloc(samples * 2)]));
    const voice = { voice_id: 'v1', wav_path: wav, text: 'Una frase de referencia.', cache_dir: path.join(scratch, 'voices', 'v1') };
    sidecar.send({ type: 'prepare_voice', id: 'pv', ...voice });
    const ready = await sidecar.next(event => event.id === 'pv');
    assert.equal(ready.type, 'voice_ready', JSON.stringify(ready));
    assert.equal(ready.cache_path, path.join(voice.cache_dir, 'fake-model.npz'));
    assert.ok(fs.existsSync(ready.cache_path));
    const stamp = fs.statSync(ready.cache_path).mtimeMs;
    sidecar.send({ type: 'synth', job_id: 'clone', text: 'Hola, mundo.', voice: { kind: 'clone', ...voice }, lang: 'es', out_dir: path.join(scratch, 'clone') });
    assert.equal((await endOf(sidecar, 'clone')).type, 'done');
    assert.equal(fs.statSync(ready.cache_path).mtimeMs, stamp, 'the cached prompt is reused, not rebuilt');
    sidecar.send({ type: 'synth', job_id: 'clone-spk', text: 'Hola.', voice: { kind: 'clone', ...voice }, lang: 'es', use_spk_emb: true, out_dir: path.join(scratch, 'clone-spk') });
    assert.match((await endOf(sidecar, 'clone-spk')).message, /campplus\.onnx/);
  });

  await t.test('keeps stdout for protocol lines only', () => {
    assert.deepEqual(sidecar.nonJson, []);
  });

  await t.test('exits as soon as stdin closes', async () => {
    const started = Date.now();
    sidecar.child.stdin.end();
    const { code } = await sidecar.exited;
    assert.equal(code, 0);
    assert.ok(Date.now() - started < 5000);
  });
});

test('the sidecar exits on EOF even mid-job', { skip: interpreter ? false : 'no Python interpreter on PATH' }, async () => {
  const sidecar = start();
  await sidecar.next(event => event.type === 'ready');
  sidecar.send({ type: 'load', id: 'l', model_path: modelDir, model_id: 'fake-model' });
  await sidecar.next(event => event.type === 'warm');
  sidecar.send({ type: 'synth', job_id: 'orphan', text: LONG, voice: { kind: 'builtin', name: 'US_James' }, lang: 'en', out_dir: path.join(scratch, 'orphan') });
  await sidecar.next(event => event.type === 'fragment');
  sidecar.child.stdin.end();
  assert.equal((await sidecar.exited).code, 0);
});

test('fragments are split exactly as the vendored mlx-audio module splits them', { skip: interpreter ? false : 'no Python interpreter on PATH' }, () => {
  const script = `
import ast, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
def defs(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {node.name: ast.dump(node) for node in tree.body if isinstance(node, ast.FunctionDef)}
ours, theirs = defs(root / "ming_text.py"), defs(root / "mlx_ming3" / "bailingmm.py")
names = ["_semantic_length", "_add_period", "_split_fragments"]
print(json.dumps({name: ours.get(name) == theirs.get(name) and name in ours for name in names}))
sys.path.insert(0, str(root))
import ming_text
assert ming_text.MING3_MAX_FRAGMENT_LENGTH == 50
`;
  const result = JSON.parse(execFileSync(interpreter, ['-I', '-c', script, runtime], { encoding: 'utf8' }));
  assert.deepEqual(result, { _semantic_length: true, _add_period: true, _split_fragments: true });
});
