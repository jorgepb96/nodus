// How the host runs a capability's interpreter: what it reports back when the process ends
// badly, how much of its output it keeps, and what it leaves running when a call is abandoned.
// The interpreter is a real one, in a virtual environment laid out the way the host builds it;
// nothing is installed into it, because what is under test is the host's side of the pipe.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-python-host-'));
const profile = path.join(scratch, 'profile');
fs.mkdirSync(profile, { recursive: true });
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const interpreter = ['python3', 'python'].find(candidate => {
  try { execFileSync(candidate, ['-c', 'print(1)'], { stdio: 'ignore' }); return true; }
  catch { return false; }
});

const bundle = path.join(scratch, 'runtime.cjs');
await build({
  stdin: { contents: `export * from './electron/capabilities/pythonRuntime';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{
    name: 'test-environment',
    setup(api) {
      api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
      api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export const app={getPath:()=>${JSON.stringify(profile)},getVersion:()=>"5.8.0"};`, loader: 'js' }));
      api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
    },
  }],
});
const lib = createRequire(import.meta.url)(bundle);

const runtime = {
  capabilityId: 'nodus:probe',
  plugin: { id: 'probe', version: '1.0.0', digest: 'a'.repeat(64) },
  manifest: { id: 'probe' },
  entryPath: path.join(scratch, 'worker.js'),
  permissions: { runtimes: [{ id: 'probe', kind: 'python', minVersion: '3.10' }] },
};

function installRuntime() {
  const digest = 'b'.repeat(64);
  const dir = path.join(profile, 'plugins', 'runtimes', 'shared', digest);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'venv'))) execFileSync(interpreter, ['-m', 'venv', '--without-pip', path.join(dir, 'venv')], { stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'READY'), digest);
  const pointers = path.join(profile, 'plugins', 'runtimes', 'probe');
  fs.mkdirSync(pointers, { recursive: true });
  fs.writeFileSync(path.join(pointers, 'probe.json'), JSON.stringify({ schemaVersion: 1, lockDigest: digest, python: '3.12.0' }));
}

let scripts = 0;
const script = code => {
  const file = path.join(scratch, `script-${scripts++}.py`);
  fs.writeFileSync(file, code);
  return file;
};
const run = (code, extra = {}, signal = new AbortController().signal) =>
  lib.runInPythonRuntime(runtime, { runtimeId: 'probe', args: ['-I', script(code)], timeoutMs: 30_000, ...extra }, signal);

test('an interpreter killed by a signal is a failure, not an empty success', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  if (process.platform === 'win32') { t.skip('POSIX signals'); return; }
  installRuntime();
  const result = await run('import os, sys\nsys.stdout.write(\'{"partial": [1, 2\')\nsys.stdout.flush()\nos.kill(os.getpid(), 9)\n');
  assert.notEqual(result.code, 0, 'a process the kernel killed must not read as exit code 0');
  assert.match(result.stderr, /SIGKILL/);
});

test('stderr is bounded in total and keeps the end, where the traceback is', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  installRuntime();
  const result = await run('import sys\nfor _ in range(400): sys.stderr.write("x" * 50000)\nsys.stderr.write("THE-END")\nsys.exit(2)\n');
  assert.equal(result.code, 2);
  assert.ok(result.stderr.length <= 64_000, `kept ${result.stderr.length} characters of stderr`);
  assert.ok(result.stderr.endsWith('THE-END'));
});

test('multi-byte characters split across pipe reads arrive intact', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  installRuntime();
  const result = await run('import sys\nsys.stdout.write("€" * 300000)\n');
  assert.equal(result.code, 0);
  assert.equal(result.stdout.length, 300_000);
  assert.ok(!result.stdout.includes('�'), 'no replacement characters');
});

test('an interpreter that exits without reading its input is reported by its exit code, not as a main-process fault', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  installRuntime();
  const faults = [];
  const onFault = error => faults.push(error);
  process.on('uncaughtException', onFault);
  try {
    const result = await run('import sys\nsys.exit(3)\n', { stdin: 'x'.repeat(4 * 1024 * 1024) });
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(result.code, 3);
    assert.deepEqual(faults.map(error => error.code ?? error.message), []);
  } finally { process.off('uncaughtException', onFault); }
});

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (check, ms = 5_000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25)); return check(); };

test('cancelling a call also stops what the interpreter started', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  if (process.platform === 'win32') { t.skip('process groups are POSIX'); return; }
  installRuntime();
  const pidFile = path.join(scratch, 'helper.pid');
  const controller = new AbortController();
  const pending = run(`import subprocess, time\nhelper = subprocess.Popen(["sleep", "60"])\nopen(${JSON.stringify(pidFile)}, "w").write(str(helper.pid))\ntime.sleep(60)\n`, {}, controller.signal);
  pending.catch(() => {});
  assert.ok(await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').length > 0), 'the helper started');
  const helper = Number(fs.readFileSync(pidFile, 'utf8'));
  try {
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.ok(await waitFor(() => !alive(helper)), `the helper ${helper} outlived the cancelled call`);
  } finally { try { process.kill(helper, 'SIGKILL'); } catch { /* gone */ } }
});

test('interpreters are admitted up to a machine-wide limit, and a queued call keeps its whole budget', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  installRuntime();
  const limit = typeof lib.pythonRuntimeConcurrency === 'function' ? lib.pythonRuntimeConcurrency() : Math.max(2, os.availableParallelism() - 1);
  const log = path.join(scratch, 'overlap.log');
  fs.writeFileSync(log, '');
  const body = `import time\nopen(${JSON.stringify(log)}, "a").write("+\\n")\ntime.sleep(0.6)\nopen(${JSON.stringify(log)}, "a").write("-\\n")\n`;
  const calls = Array.from({ length: limit + 3 }, () => run(body));
  // Queued behind every slot for at least 0.6 s, with a one-second budget for 0.1 s of work.
  const late = run('import time\ntime.sleep(0.1)\nprint("done")\n', { timeoutMs: 1_000 });
  const results = await Promise.all([...calls, late]);
  assert.ok(results.every(result => result.code === 0));
  assert.equal(results.at(-1).stdout.trim(), 'done');
  let running = 0, peak = 0;
  for (const mark of fs.readFileSync(log, 'utf8').trim().split('\n')) { running += mark === '+' ? 1 : -1; peak = Math.max(peak, running); }
  assert.ok(peak <= limit, `${peak} interpreters ran at once with a limit of ${limit}`);
});

test('a call cancelled while it waits for a slot never starts', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  installRuntime();
  const limit = typeof lib.pythonRuntimeConcurrency === 'function' ? lib.pythonRuntimeConcurrency() : Math.max(2, os.availableParallelism() - 1);
  const marker = path.join(scratch, 'started.marker');
  const busy = Array.from({ length: limit }, () => run('import time\ntime.sleep(1.0)\n'));
  const controller = new AbortController();
  const queued = run(`open(${JSON.stringify(marker)}, "w").write("started")\n`, {}, controller.signal);
  queued.catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 200));
  controller.abort();
  const started = Date.now();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.ok(Date.now() - started < 300, 'the cancellation did not wait for a slot');
  await Promise.all(busy);
  assert.ok(!fs.existsSync(marker), 'the cancelled call ran anyway');
});

/** A script that answers in a loop when the host asks it to, and once otherwise. */
const SERVED = `
import json, os, sys, time
def answer(request):
    if request.get("sleep"): time.sleep(request["sleep"])
    if request.get("exit") is not None: os._exit(request["exit"])
    return {"pid": os.getpid(), "echo": request.get("echo")}
if os.environ.get("NODUS_PYTHON_SERVE") == "1":
    for line in sys.stdin:
        message = json.loads(line)
        reply = {"id": message["id"], "code": 0, "stdout": json.dumps(answer(json.loads(message["stdin"] or "{}"))), "stderr": ""}
        sys.stdout.write(json.dumps(reply) + "\\n")
        sys.stdout.flush()
else:
    print(json.dumps(answer(json.loads(sys.stdin.read() or "{}"))))
`;

test('a persistent script is started once and answers call after call', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  if (typeof lib.stopServedInterpreters !== 'function') assert.fail('the host has no persistent interpreters');
  installRuntime();
  const file = script(SERVED);
  const ask = (request, extra = {}, signal = new AbortController().signal) => lib.runInPythonRuntime(runtime, { runtimeId: 'probe', args: ['-I', file], stdin: JSON.stringify(request), timeoutMs: 30_000, persistent: true, ...extra }, signal);
  try {
    const first = JSON.parse((await ask({ echo: 'é€' })).stdout);
    const second = JSON.parse((await ask({ echo: 2 })).stdout);
    assert.equal(first.echo, 'é€');
    assert.equal(second.pid, first.pid, 'the second call was answered by the same interpreter');

    // A timeout kills the interpreter; the next call gets a fresh one that works.
    await assert.rejects(ask({ sleep: 5 }, { timeoutMs: 1_000 }), /exceeded 1 seconds/);
    const afterTimeout = JSON.parse((await ask({ echo: 3 })).stdout);
    assert.notEqual(afterTimeout.pid, first.pid);

    // So does a cancellation.
    const controller = new AbortController();
    const cancelled = ask({ sleep: 5 }, {}, controller.signal);
    setTimeout(() => controller.abort(), 200);
    await assert.rejects(cancelled, { name: 'AbortError' });

    // An interpreter that dies mid-request is a failure with its exit code, never a hang or a success.
    const died = await ask({ exit: 7 });
    assert.equal(died.code, 7);
    assert.match(died.stderr, /exited before it answered/);

    // Calls at the same time are answered by different interpreters.
    const both = await Promise.all([ask({ sleep: 0.3 }), ask({ sleep: 0.3 })]);
    assert.notEqual(JSON.parse(both[0].stdout).pid, JSON.parse(both[1].stdout).pid);
  } finally { lib.stopServedInterpreters(); }
});

test('a call that carries a secret is never given a persistent interpreter', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  installRuntime();
  const file = script('import sys, json, os\nprint(json.dumps({"serve": os.environ.get("NODUS_PYTHON_SERVE"), "first": sys.stdin.readline().strip()}))\n');
  const result = await lib.runInPythonRuntime(runtime, { runtimeId: 'probe', args: ['-I', file], secret: 'not-a-real-key', timeoutMs: 30_000, persistent: true }, new AbortController().signal);
  assert.deepEqual(JSON.parse(result.stdout), { serve: null, first: 'not-a-real-key' });
});

test('a runtime found ready is not re-examined with three interpreter starts on every call', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  if (process.platform === 'win32') { t.skip('the counting shim is a shell script'); return; }
  const { createHash } = await import('node:crypto');
  const lock = { schemaVersion: 1, python: '3.12', platform: `${process.platform}-${process.arch}`, packages: [{ name: 'x-1.0-py3-none-any.whl', requirement: 'x==1.0', url: 'https://files.pythonhosted.org/packages/x.whl', bytes: 1, sha256: 'c'.repeat(64) }] };
  const digest = createHash('sha256').update(JSON.stringify(lock)).digest('hex');
  const dir = path.join(profile, 'plugins', 'runtimes', 'shared', digest);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'venv'))) execFileSync(interpreter, ['-m', 'venv', '--without-pip', path.join(dir, 'venv')], { stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'READY'), digest);
  // Every start of the system interpreter, counted.
  const shims = path.join(scratch, 'shims');
  const log = path.join(scratch, 'starts.log');
  fs.mkdirSync(shims, { recursive: true });
  const real = execFileSync(interpreter, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(shims, 'python3'), `#!/bin/sh\necho start >> ${JSON.stringify(log)}\nexec ${JSON.stringify(real)} "$@"\n`, { mode: 0o755 });
  const savedPath = process.env.PATH;
  process.env.PATH = `${shims}${path.delimiter}${savedPath}`;
  try {
    const ensure = () => lib.ensurePythonRuntime(runtime, 'probe', { download: async () => { throw new Error('nothing may be downloaded'); }, minVersion: '3.8', selectLock: () => lib.validateRuntimeLock(lock), signal: new AbortController().signal });
    assert.deepEqual(await ensure(), { ready: true });
    const firstStarts = fs.readFileSync(log, 'utf8').trim().split('\n').length;
    assert.ok(firstStarts >= 1, 'the first check looks for the interpreter');
    for (let i = 0; i < 5; i++) assert.deepEqual(await ensure(), { ready: true });
    assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, firstStarts, 'later checks started the interpreter again');
    // A rebuilt environment (its marker changed) is examined in full again.
    fs.writeFileSync(path.join(dir, 'READY'), 'rebuilding');
    const rebuilt = await ensure();
    assert.equal(rebuilt.ready, false, 'a half-rebuilt environment is not reported ready from memory');
  } finally { process.env.PATH = savedPath; }
});

test('a runtime check cancelled while another call is building the environment leaves at once', async (t) => {
  if (!interpreter) { t.skip('no Python interpreter on this machine'); return; }
  // A lock no environment exists for yet: the first caller starts building it, and its download
  // takes a while; the second caller queues behind it, then is cancelled.
  const lock = { schemaVersion: 1, python: '3.12', platform: `${process.platform}-${process.arch}`, packages: [{ name: 'slow-1.0-py3-none-any.whl', requirement: 'slow==1.0', url: 'https://files.pythonhosted.org/packages/slow.whl', bytes: 1, sha256: 'd'.repeat(64) }] };
  const ensure = (download, signal) => lib.ensurePythonRuntime(runtime, 'probe', { download, minVersion: '3.8', selectLock: () => lib.validateRuntimeLock(lock), signal });
  const building = ensure(() => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('offline')), 3_000)), new AbortController().signal);
  await new Promise(resolve => setTimeout(resolve, 300));
  const controller = new AbortController();
  const queued = ensure(async () => { throw new Error('must not download'); }, controller.signal);
  setTimeout(() => controller.abort(), 100);
  const started = Date.now();
  await assert.rejects(Promise.race([queued, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('still waiting for the other build')), 1_500))]), { name: 'AbortError' });
  assert.ok(Date.now() - started < 1_000);
  assert.equal((await building).ready, false);
});
