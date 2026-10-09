import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { pluginsRuntimesRoot } from './pluginStoreV2';
import { Semaphore } from './hostLimits';
import type { TrustedWorkerRuntime } from './workerHost';

/** Python environments a capability declares and the host builds.
 *
 *  The interpreter is the user's — Nodus does not ship one — but everything installed into
 *  the environment is pinned: the package carries a lock naming every wheel with its URL,
 *  size and SHA-256, the host downloads each one through the capability's own declared
 *  network permission, verifies it, and installs with `--no-index --require-hashes` from
 *  the verified directory. Nothing is ever resolved from a mutable index at install time. */

const run = promisify(execFile);

export interface RuntimeLockEntry {
  /** The artifact's own file name, as published. */
  name: string;
  /** What pip is asked to install, e.g. `numpy==2.2.6`. */
  requirement: string;
  url: string;
  bytes: number;
  sha256: string;
}
export interface RuntimeLock { schemaVersion: 1; python: string; platform: string; packages: RuntimeLockEntry[] }

const READY = 'READY';
const MAX_WHEEL_BYTES = 256 * 1024 * 1024;
// The main process owns provisioning. Serialize by the full shared path (including the
// profile), then recheck READY: another capability may have completed it while we waited.
const runtimeBuilds = new Map<string, Promise<void>>();

async function withRuntimeLock<T>(root: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const previous = runtimeBuilds.get(root) ?? Promise.resolve();
  // A caller cancelled while another build holds the lock leaves at once instead of waiting out
  // that build (pip has fifteen minutes); its turn in the chain still passes, without running.
  const result = previous.then(() => { signal?.throwIfAborted(); return action(); });
  const settled = result.then(() => {}, () => {});
  runtimeBuilds.set(root, settled);
  void settled.then(() => { if (runtimeBuilds.get(root) === settled) runtimeBuilds.delete(root); });
  if (!signal) return result;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([result, new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new DOMException('The runtime check was cancelled.', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    })]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Environments are shared by lock digest: two capabilities that pin the same dependencies build
 *  and reuse one environment instead of a private copy each. */
const sharedRuntimeDir = (lockDigest: string) => path.join(pluginsRuntimesRoot(), 'shared', lockDigest);
/** A pointer naming the shared environment a capability's runtime resolves to. It lives under the
 *  plugin's own directory, so uninstalling the plugin drops the reference while the shared
 *  environment survives for any other plugin whose lock matches. */
const pointerFile = (runtime: TrustedWorkerRuntime, runtimeId: string) => path.join(pluginsRuntimesRoot(), runtime.plugin.id, `${runtimeId}.json`);
const interpreter = (root: string) => process.platform === 'win32' ? path.join(root, 'venv', 'Scripts', 'python.exe') : path.join(root, 'venv', 'bin', 'python');

function writePointer(file: string, lockDigest: string, python: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, lockDigest, python }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readPointer(file: string): string | null {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(String(record.lockDigest))) return null;
    return String(record.lockDigest);
  } catch {
    return null;
  }
}

export function validateRuntimeLock(input: unknown): RuntimeLock {
  const value = input as RuntimeLock;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1
    || typeof value.python !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(value.python)
    || typeof value.platform !== 'string' || !Array.isArray(value.packages) || !value.packages.length || value.packages.length > 500) {
    throw new Error('Invalid runtime lock.');
  }
  for (const entry of value.packages) {
    let url: URL;
    try { url = new URL(entry.url); } catch { throw new Error('Invalid runtime lock URL.'); }
    if (url.protocol !== 'https:' || typeof entry.name !== 'string' || !/^[A-Za-z0-9._+-]{1,160}$/.test(entry.name)
      || entry.name.includes('..') || !Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_WHEEL_BYTES
      || typeof entry.requirement !== 'string' || !/^[A-Za-z0-9._-]{1,120}==[A-Za-z0-9._+!-]{1,60}$/.test(entry.requirement)
      || !/^[a-f0-9]{64}$/.test(String(entry.sha256))) throw new Error('Invalid runtime lock entry.');
  }
  return structuredClone(value);
}

/** The interpreter the user already has, or nothing. Nodus never installs one. */
export async function findSystemPython(minVersion: string): Promise<{ path: string; version: string } | null> {
  const candidates = process.platform === 'win32' ? ['py', 'python3', 'python'] : ['python3', 'python'];
  const [minMajor, minMinor] = minVersion.split('.').map(Number);
  for (const candidate of candidates) {
    try {
      const { stdout } = await run(candidate, ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'], { timeout: 10_000 });
      const version = stdout.trim();
      const [major, minor] = version.split('.').map(Number);
      if (major > minMajor || major === minMajor && minor >= minMinor) {
        const { stdout: resolved } = await run(candidate, ['-c', 'import sys; print(sys.executable)'], { timeout: 10_000 });
        return { path: resolved.trim(), version };
      }
    } catch { /* try the next candidate */ }
  }
  return null;
}

export interface EnsureRuntimeContext {
  /** Downloads one pinned artifact through the capability's own network permission. */
  download: (url: string) => Promise<Buffer>;
  minVersion: string;
  /** The lock for one interpreter, from the locks shipped inside the installed package.
   *
   *  A wheel is built for a specific Python, so there is no single pinned set that fits
   *  every interpreter a user might have. The package ships one lock per version it
   *  supports and this picks the one that matches; returning null is what turns "we
   *  resolved something for you" into "this package does not support your Python", which
   *  is the honest answer and the one a user can act on. */
  selectLock: (pythonVersion: string) => RuntimeLock | null;
  signal: AbortSignal;
}

/** Environments found ready in this process, by pointer. A capability asks before every call it
 *  makes, and the full check starts three interpreters (the system Python's version, its path, the
 *  environment's own version): 59 ms measured, every call. Within a few minutes of a full check, the
 *  pointer and the READY marker still naming the same lock is answer enough; anything else (a
 *  rebuild, a removal, an interpreter upgraded in between) is checked in full again. */
const confirmedRuntimes = new Map<string, { root: string; lockDigest: string; at: number }>();
const CONFIRMED_RUNTIME_MS = 10 * 60_000;

export async function ensurePythonRuntime(runtime: TrustedWorkerRuntime, runtimeId: string, context: EnsureRuntimeContext): Promise<{ ready: boolean; detail?: string }> {
  const pointer = pointerFile(runtime, runtimeId);
  const known = confirmedRuntimes.get(pointer);
  if (known && Date.now() - known.at < CONFIRMED_RUNTIME_MS && readPointer(pointer) === known.lockDigest) {
    try { if (fs.readFileSync(path.join(known.root, READY), 'utf8').trim() === known.lockDigest) return { ready: true }; }
    catch { /* rebuilt or removed: check in full */ }
  }

  const python = await findSystemPython(context.minVersion);
  if (!python) return { ready: false, detail: `Python ${context.minVersion} or newer was not found on this machine.` };

  const minor = python.version.split('.').slice(0, 2).join('.');
  const lock = context.selectLock(minor);
  if (!lock) return { ready: false, detail: `This package publishes no pinned dependency set for Python ${minor} on ${process.platform}-${process.arch}.` };
  const lockDigest = createHash('sha256').update(JSON.stringify(lock)).digest('hex');
  const root = sharedRuntimeDir(lockDigest);
  return withRuntimeLock(root, () => provisionPythonRuntime(pointer, root, lockDigest, lock, python, context), context.signal);
}

async function provisionPythonRuntime(
  pointer: string,
  root: string,
  lockDigest: string,
  lock: RuntimeLock,
  python: { path: string; version: string },
  context: EnsureRuntimeContext,
): Promise<{ ready: boolean; detail?: string }> {
  context.signal.throwIfAborted();
  const marker = path.join(root, READY);

  // The marker records which lock produced the environment: a package that changes its
  // dependencies, or a user who changed interpreter, gets a rebuild instead of an
  // environment that no longer matches what it claims to be.
  try {
    if (fs.readFileSync(marker, 'utf8').trim() === lockDigest) {
      await run(interpreter(root), ['--version'], { timeout: 10_000 });
      writePointer(pointer, lockDigest, python.version);
      confirmedRuntimes.set(pointer, { root, lockDigest, at: Date.now() });
      return { ready: true };
    }
  } catch { /* not built, or built from a different lock */ }

  const staging = `${root}.${randomUUID()}.building`;
  const wheels = path.join(staging, 'wheels');
  try {
    fs.mkdirSync(wheels, { recursive: true, mode: 0o700 });
    for (const entry of lock.packages) {
      context.signal.throwIfAborted();
      const bytes = await context.download(entry.url);
      if (bytes.byteLength !== entry.bytes) throw new Error(`${entry.name} does not match the size the lock pinned.`);
      if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`${entry.name} does not match the digest the lock pinned.`);
      fs.writeFileSync(path.join(wheels, entry.name), bytes, { mode: 0o600 });
    }
    const requirements = path.join(staging, 'requirements.txt');
    // `requirement` rather than the file name: pip resolves a requirement against
    // `--find-links`, and a bare filename would be read as a path relative to whatever the
    // working directory happens to be.
    fs.writeFileSync(requirements, lock.packages.map(entry => `${entry.requirement} --hash=sha256:${entry.sha256}`).join('\n'), { mode: 0o600 });

    await run(python.path, ['-m', 'venv', path.join(staging, 'venv')], { timeout: 300_000, signal: context.signal });
    await run(interpreter(staging), ['-m', 'pip', 'install', '--no-index', '--require-hashes', '--find-links', wheels, '-r', requirements], { timeout: 900_000, maxBuffer: 16 * 1024 * 1024, signal: context.signal });
    context.signal.throwIfAborted();

    fs.rmSync(wheels, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(root), { recursive: true, mode: 0o700 });
    fs.renameSync(staging, root);
    fs.writeFileSync(marker, lockDigest, { mode: 0o600 });
    writePointer(pointer, lockDigest, python.version);
    confirmedRuntimes.set(pointer, { root, lockDigest, at: Date.now() });
    return { ready: true };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    return { ready: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export interface PythonRunRequest {
  runtimeId: string;
  args: string[];
  stdin?: string;
  /** Read by the host and written to the interpreter's stdin. Never an argument, because
   *  arguments are visible to anything that can list processes. */
  secret?: string;
  timeoutMs: number;
  /** The script answers requests in a loop, so one interpreter may serve many calls (see
   *  `askServedInterpreter`). Ignored with a secret: a served process outlives the call that
   *  was entitled to it. */
  persistent?: boolean;
}

const STDOUT_LIMIT = 32 * 1024 * 1024;
const STDERR_TAIL = 64_000;

/** The shell's convention for a process ended by a signal, so a caller that only reads the code
 *  still sees a failure. */
const signalExitCode = (name: NodeJS.Signals | null): number =>
  128 + ((name && os.constants.signals[name]) || 9);

/** Interpreters running at once, across every capability and every turn. Each one is a CPU-bound
 *  process carrying its own RDKit and index tables, and nothing else bounded them: one evidence
 *  gather and one route check together started a dozen on a four-core machine. One core is left
 *  for the main process, which serves every capability's host calls. */
const pythonSlots = new Semaphore(Math.max(2, os.availableParallelism() - 1));
export const pythonRuntimeConcurrency = (): number => pythonSlots.size;

/** Interpreters whose process group may still hold something, so a quit does not leave a
 *  capability's helpers running after the application is gone. */
const liveInterpreters = new Set<ChildProcess>();
process.once('exit', () => { for (const child of liveInterpreters) killInterpreter(child); });

const interpreterEnvironment = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', ...extra,
});

/** Kills the interpreter AND whatever it started. A capability's Python may run its own helpers —
 *  a local OPSIN under Java, a multiprocessing pool — and killing only the interpreter left them
 *  running, unbudgeted, after the call that wanted them had been cancelled. On POSIX the
 *  interpreter leads its own process group, so the group goes with it; Windows has no groups, and
 *  `taskkill /T` walks the tree instead. */
function killInterpreter(child: ChildProcess): void {
  liveInterpreters.delete(child);
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {}); } catch { /* already gone */ }
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
}

export async function runInPythonRuntime(runtime: TrustedWorkerRuntime, request: PythonRunRequest, signal: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  signal.throwIfAborted();
  const lockDigest = readPointer(pointerFile(runtime, request.runtimeId));
  const root = lockDigest ? sharedRuntimeDir(lockDigest) : null;
  if (!root || !fs.existsSync(path.join(root, READY))) throw new Error('That capability runtime is not installed.');
  if (request.args.some(argument => typeof argument !== 'string' || argument.length > 4_000)) throw new Error('Invalid runtime argument.');

  // The deadline below is armed once the interpreter has a slot: time spent queued behind other
  // calls is not time this one spent running, and must not be reported as it.
  const release = await pythonSlots.acquire(signal);
  try {
    return await (request.persistent && !request.secret ? askServedInterpreter(root, request, signal) : spawnInterpreter(root, request, signal));
  } finally { release(); }
}

/** An interpreter that answers one request per line until its stdin closes.
 *
 *  A one-shot call pays for the interpreter, RDKit and whatever tables the script loads before it
 *  does any work: measured on the chemistry runtime, 0.2 to 1.8 s a call, 30 to 45 calls an answer.
 *  A script that opts in (`persistent`) is started with NODUS_PYTHON_SERVE=1 and kept: the host
 *  writes {"id", "stdin"} and reads {"id", "code", "stdout", "stderr"}, the same three things a
 *  one-shot run returns. The interpreter is reused only after a clean answer; a timeout, a
 *  cancellation, a malformed reply or an exit kills it, and the next call starts a fresh one. */
interface ServedInterpreter {
  key: string;
  child: ChildProcess;
  uses: number;
  buffer: string;
  stderr: string;
  idle?: NodeJS.Timeout;
  onLine?: (line: string) => void;
  onExit?: (code: number | null, killedBy: NodeJS.Signals | null) => void;
}

/** Retired after this long unused, so an answer's phases share it but an idle app holds nothing. */
const SERVED_IDLE_MS = 120_000;
/** Retired after this many answers, so a slow leak in a script or a library stays bounded. */
const SERVED_MAX_USES = 200;
/** Interpreters kept idle per script; more run at once only while the admission above allows. */
const SERVED_IDLE_PER_KEY = 2;
const servedIdle = new Map<string, ServedInterpreter[]>();
let servedRequests = 0;

/** Stops every served interpreter. For shutdown and tests; a call in flight fails as an exit. */
export function stopServedInterpreters(): void {
  for (const list of servedIdle.values()) for (const served of list) retireServed(served);
  servedIdle.clear();
}

function retireServed(served: ServedInterpreter): void {
  if (served.idle) clearTimeout(served.idle);
  const list = servedIdle.get(served.key);
  if (list?.includes(served)) list.splice(list.indexOf(served), 1);
  killInterpreter(served.child);
}

function parkServed(served: ServedInterpreter): void {
  served.onLine = served.onExit = undefined;
  const list = servedIdle.get(served.key) ?? [];
  if (served.uses >= SERVED_MAX_USES || list.length >= SERVED_IDLE_PER_KEY || served.child.exitCode !== null || served.child.signalCode !== null) {
    retireServed(served);
    return;
  }
  list.push(served);
  servedIdle.set(served.key, list);
  served.idle = setTimeout(() => retireServed(served), SERVED_IDLE_MS);
  served.idle.unref?.();
}

function startServed(root: string, args: string[], key: string): ServedInterpreter {
  const child = spawn(interpreter(root), args, {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
    env: interpreterEnvironment({ NODUS_PYTHON_SERVE: '1' }),
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  liveInterpreters.add(child);
  const served: ServedInterpreter = { key, child, uses: 0, buffer: '', stderr: '' };
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    served.buffer += chunk;
    for (let newline = served.buffer.indexOf('\n'); newline >= 0; newline = served.buffer.indexOf('\n')) {
      const line = served.buffer.slice(0, newline);
      served.buffer = served.buffer.slice(newline + 1);
      served.onLine?.(line);
    }
    // A reply carries the whole stdout of one request, so this is the one-shot bound plus the envelope.
    if (served.buffer.length > STDOUT_LIMIT * 2) served.onExit?.(null, null);
  });
  child.stderr!.on('data', (chunk: string) => { served.stderr = (served.stderr + chunk).slice(-STDERR_TAIL); });
  child.stdin!.on('error', () => {});
  child.once('error', () => { retireServed(served); served.onExit?.(null, null); });
  child.once('close', (code, killedBy) => { retireServed(served); served.onExit?.(code, killedBy); });
  return served;
}

function askServedInterpreter(root: string, request: PythonRunRequest, signal: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  const key = [root, ...request.args].join('\0');
  let served: ServedInterpreter | undefined;
  for (const candidate of servedIdle.get(key) ?? []) {
    if (candidate.child.exitCode === null && candidate.child.signalCode === null) { served = candidate; break; }
  }
  if (served) {
    if (served.idle) clearTimeout(served.idle);
    const list = servedIdle.get(key)!;
    list.splice(list.indexOf(served), 1);
  } else {
    served = startServed(root, request.args, key);
  }
  const target = served;
  target.stderr = '';
  const id = ++servedRequests;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (outcome: { error?: Error; result?: { code: number; stdout: string; stderr: string } }, reusable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      target.onLine = target.onExit = undefined;
      if (reusable) parkServed(target); else retireServed(target);
      if (outcome.error) reject(outcome.error); else resolve(outcome.result!);
    };
    const abort = () => finish({ error: new DOMException('The capability runtime call was cancelled.', 'AbortError') }, false);
    const timer = setTimeout(() => finish({ error: new Error(`The capability runtime exceeded ${Math.round(request.timeoutMs / 1000)} seconds.`) }, false), Math.min(Math.max(request.timeoutMs, 1_000), 900_000));
    signal.addEventListener('abort', abort, { once: true });
    target.onLine = line => {
      let reply: { id?: unknown; code?: unknown; stdout?: unknown; stderr?: unknown } | null = null;
      try { reply = JSON.parse(line); } catch { /* handled below */ }
      if (!reply || reply.id !== id || !Number.isInteger(reply.code) || typeof reply.stdout !== 'string') {
        finish({ result: { code: 1, stdout: '', stderr: `${target.stderr}\nThe interpreter answered out of turn.`.slice(-STDERR_TAIL) } }, false);
        return;
      }
      if (reply.stdout.length > STDOUT_LIMIT) { finish({ error: new Error('The capability runtime produced too much output.') }, false); return; }
      target.uses += 1;
      const stderr = `${target.stderr}${typeof reply.stderr === 'string' ? reply.stderr : ''}`.slice(-STDERR_TAIL);
      finish({ result: { code: reply.code as number, stdout: reply.stdout, stderr } }, true);
    };
    target.onExit = (code, killedBy) => {
      const stderr = `${target.stderr}\n${killedBy ? `The interpreter was terminated by ${killedBy}.` : 'The interpreter exited before it answered.'}`.slice(-STDERR_TAIL);
      finish({ result: { code: code === null ? signalExitCode(killedBy) : code || 1, stdout: '', stderr } }, false);
    };
    try { target.child.stdin!.write(`${JSON.stringify({ id, stdin: request.stdin ?? '' })}\n`); }
    catch (error) { finish({ error: error instanceof Error ? error : new Error(String(error)) }, false); }
  });
}

function spawnInterpreter(root: string, request: PythonRunRequest, signal: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(interpreter(root), request.args, {
      cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
      // A clean environment: the interpreter gets what it needs and nothing the user's
      // shell happens to be carrying.
      env: interpreterEnvironment(),
      // Its own process group (POSIX), so a kill reaches everything it started.
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    liveInterpreters.add(child);
    let stdout = '', stderr = '', settled = false;
    const finish = (error?: Error, code = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      // Also after a clean exit: a helper the interpreter left behind is still the call's.
      killInterpreter(child);
      if (error) reject(error); else resolve({ code, stdout, stderr });
    };
    const abort = () => finish(new DOMException('The capability runtime call was cancelled.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error(`The capability runtime exceeded ${Math.round(request.timeoutMs / 1000)} seconds.`)), Math.min(Math.max(request.timeoutMs, 1_000), 900_000));
    signal.addEventListener('abort', abort, { once: true });
    // Decoded as a stream, not chunk by chunk: a character whose bytes straddle two pipe reads
    // otherwise comes out as two replacement characters.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > STDOUT_LIMIT) finish(new Error('The capability runtime produced too much output.')); });
    // The tail, bounded in total: a traceback is at the end, and a library that warns in a loop
    // must not hold the main process's memory for as long as it keeps warning.
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-STDERR_TAIL); });
    // An interpreter that exits before reading its input closes the pipe under the write. Its
    // exit status says why; the EPIPE says nothing, and unhandled it is a main-process fault.
    child.stdin.on('error', () => {});
    child.once('error', error => finish(error instanceof Error ? error : new Error(String(error))));
    // A process ended by a signal has no exit code. Reporting it as 0 turned an interpreter the
    // OOM killer stopped mid-answer into a success with truncated output.
    child.once('close', (code, killedBy) => {
      if (code === null && killedBy) stderr = `${stderr}\nThe interpreter was terminated by ${killedBy}.`.slice(-STDERR_TAIL);
      finish(undefined, code ?? signalExitCode(killedBy));
    });
    try {
      if (request.secret) child.stdin.write(`${request.secret}\n`);
      if (request.stdin) child.stdin.write(request.stdin);
      child.stdin.end();
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
