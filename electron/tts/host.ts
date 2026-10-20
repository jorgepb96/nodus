// SPDX-License-Identifier: AGPL-3.0-only
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { TtsBackend, TtsDevice, TtsEngineState, TtsLanguage } from '@shared/ttsModels';

/**
 * The Ming TTS sidecar's lifecycle, owned by the main process.
 *
 * Inference never runs in Electron: a Python process (runtime/ming-tts/serve.py) is spawned on
 * demand at a lower scheduling priority, loads one checkpoint, writes each generated fragment
 * as a WAV file and reports it as one JSON line. The main thread only routes small messages,
 * so a long narration can never freeze the window. One model is resident at a time and jobs run
 * one after another, because two Ming instances would compete for the same unified memory. The
 * process is stopped after `idleMs` without work, when the user unloads it, and on every quit
 * path.
 */

export type TtsVoiceRef =
  | { kind: 'clone'; voiceId: string; wavPath: string; text: string; cacheDir: string }
  | { kind: 'builtin'; name: string };

export interface TtsSynthRequest {
  text: string;
  voice: TtsVoiceRef;
  language: TtsLanguage;
  /** Higher runs first: what the user is listening to outranks background generation. */
  priority?: number;
}

export interface TtsFragment { jobId: string; index: number; total: number; path: string; durationS: number; genS: number }
export interface TtsJobCallbacks {
  onStart?: (jobId: string) => void;
  onFragment?: (fragment: TtsFragment) => void;
}
export interface TtsJobResult { jobId: string; fragments: TtsFragment[]; audioS: number; genS: number; cancelled: boolean }

export interface TtsEngineSnapshot { state: TtsEngineState; modelId: string | null; idleUnloadAt: number | null; device: TtsDevice | null; error?: string }

export interface TtsHostOptions {
  python: () => Promise<string | null>;
  backend: () => TtsBackend;
  serveScript: string;
  modelPath: (modelId: string) => string;
  liveDir: string;
  logPath: string;
  idleMs: () => number;
  onState?: (snapshot: TtsEngineSnapshot) => void;
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  /** Lowers the sidecar's CPU priority; injectable so tests can observe it. */
  lowerPriority?: (pid: number) => void;
  startTimeoutMs?: number;
  loadTimeoutMs?: number;
  /** After a cancel, how long a fragment may keep running before the process is killed. */
  cancelGraceMs?: number;
}

type Message = Record<string, unknown> & { type: string };

interface QueuedJob {
  jobId: string;
  modelId: string;
  request: TtsSynthRequest;
  callbacks: TtsJobCallbacks;
  resolve: (result: TtsJobResult) => void;
  reject: (error: Error) => void;
  fragments: TtsFragment[];
  cancelled: boolean;
  seq: number;
}

interface Running {
  child: ChildProcess;
  modelId: string | null;
  buffer: string;
  waiters: Map<string, { resolve: (message: Message) => void; reject: (error: Error) => void; expect: string }>;
  exited: boolean;
}

const MAX_LOG_BYTES = 512 * 1024;

export function defaultLowerPriority(pid: number): void {
  try { os.setPriority(pid, process.platform === 'win32' ? os.constants.priority.PRIORITY_BELOW_NORMAL : 10); } catch { /* best effort */ }
}

export class TtsEngineHost {
  private running: Running | null = null;
  private starting: Promise<Running> | null = null;
  private loading: Promise<void> | null = null;
  private queue: QueuedJob[] = [];
  private current: QueuedJob | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private idleUnloadAt: number | null = null;
  private cancelTimer: NodeJS.Timeout | null = null;
  private state: TtsEngineState = 'unloaded';
  private device: TtsDevice | null = null;
  private error: string | undefined;
  private seq = 0;
  private leases = 0;

  constructor(private options: TtsHostOptions) {}

  snapshot(): TtsEngineSnapshot {
    return { state: this.state, modelId: this.running?.modelId ?? null, idleUnloadAt: this.idleUnloadAt, device: this.device, ...(this.error ? { error: this.error } : {}) };
  }

  /** Whether a model's files are in use, so Settings cannot delete them under a live process. */
  isModelInUse(modelId: string): boolean {
    return this.running?.modelId === modelId || this.queue.some((job) => job.modelId === modelId) || this.current?.modelId === modelId;
  }

  /** Starts the sidecar and loads `modelId`. Resolves once the model is warm. */
  async load(modelId: string): Promise<void> {
    this.leases += 1;
    try { await this.ensureModel(modelId); } finally { this.leases -= 1; this.scheduleIdle(); }
  }

  /** Stops the sidecar now; queued jobs are cancelled. */
  async unload(): Promise<void> {
    for (const job of this.queue.splice(0)) job.resolve({ jobId: job.jobId, fragments: [], audioS: 0, genS: 0, cancelled: true });
    if (this.current) this.current.cancelled = true;
    await this.stop();
  }

  synth(modelId: string, request: TtsSynthRequest, callbacks: TtsJobCallbacks = {}): { jobId: string; done: Promise<TtsJobResult> } {
    const jobId = randomUUID();
    const done = new Promise<TtsJobResult>((resolve, reject) => {
      this.queue.push({ jobId, modelId, request, callbacks, resolve, reject, fragments: [], cancelled: false, seq: this.seq++ });
      this.queue.sort((a, b) => (b.request.priority ?? 0) - (a.request.priority ?? 0) || a.seq - b.seq);
    });
    this.clearIdle();
    void this.pump();
    return { jobId, done };
  }

  cancel(jobId: string): void {
    const index = this.queue.findIndex((job) => job.jobId === jobId);
    if (index >= 0) {
      const [job] = this.queue.splice(index, 1);
      job.resolve({ jobId, fragments: [], audioS: 0, genS: 0, cancelled: true });
      return;
    }
    if (this.current?.jobId !== jobId || this.current.cancelled) return;
    this.current.cancelled = true;
    this.send({ type: 'cancel', job_id: jobId });
    // Cancellation is cooperative between fragments; a fragment stuck past the grace period
    // takes the process with it, and the next job starts a fresh one.
    this.cancelTimer = setTimeout(() => { void this.stop(); }, this.options.cancelGraceMs ?? 20_000);
    this.cancelTimer.unref?.();
  }

  /** Quit-path backstop: handlers cannot await, so the process group is killed synchronously. */
  killSync(): void {
    const running = this.running;
    this.running = null;
    this.clearIdle();
    if (running && !running.exited) killTree(running.child);
  }

  private setState(state: TtsEngineState, error?: string): void {
    this.state = state;
    this.error = error;
    this.options.onState?.(this.snapshot());
  }

  private async pump(): Promise<void> {
    if (this.current) return;
    const job = this.queue.shift();
    if (!job) { this.scheduleIdle(); return; }
    this.current = job;
    try {
      await this.ensureModel(job.modelId);
      if (job.cancelled) { job.resolve({ jobId: job.jobId, fragments: [], audioS: 0, genS: 0, cancelled: true }); return; }
      job.callbacks.onStart?.(job.jobId);
      this.setState('busy');
      const result = await this.runJob(job);
      job.resolve(result);
    } catch (error) {
      job.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (this.cancelTimer) { clearTimeout(this.cancelTimer); this.cancelTimer = null; }
      this.current = null;
      if (this.running && this.state === 'busy') this.setState('ready');
      void this.pump();
    }
  }

  private async runJob(job: QueuedJob): Promise<TtsJobResult> {
    const running = await this.ensureRunning();
    const outDir = path.join(this.options.liveDir, job.jobId);
    await fs.mkdir(outDir, { recursive: true });
    const voice = job.request.voice.kind === 'clone'
      ? { kind: 'clone', voice_id: job.request.voice.voiceId, wav_path: job.request.voice.wavPath, text: job.request.voice.text, cache_dir: job.request.voice.cacheDir }
      : { kind: 'builtin', name: job.request.voice.name };
    return new Promise<TtsJobResult>((resolve, reject) => {
      const onMessage = (message: Message) => {
        if (message.job_id !== job.jobId) return false;
        if (message.type === 'fragment') {
          const fragment: TtsFragment = {
            jobId: job.jobId, index: Number(message.n), total: Number(message.total), path: String(message.path),
            durationS: Number(message.duration_s) || 0, genS: Number(message.gen_s) || 0,
          };
          if (!isInside(outDir, fragment.path)) return true;
          job.fragments.push(fragment);
          job.callbacks.onFragment?.(fragment);
          return true;
        }
        const totals = () => ({
          jobId: job.jobId, fragments: job.fragments,
          audioS: job.fragments.reduce((sum, f) => sum + f.durationS, 0), genS: job.fragments.reduce((sum, f) => sum + f.genS, 0),
        });
        if (message.type === 'done') { running.waiters.delete(`job:${job.jobId}`); resolve({ ...totals(), cancelled: job.cancelled }); return true; }
        if (message.type === 'cancelled') { running.waiters.delete(`job:${job.jobId}`); resolve({ ...totals(), cancelled: true }); return true; }
        if (message.type === 'error') { running.waiters.delete(`job:${job.jobId}`); reject(new Error(String(message.message ?? 'TTS_SYNTH_FAILED'))); return true; }
        return false;
      };
      this.jobListener = onMessage;
      running.waiters.set(`job:${job.jobId}`, {
        expect: 'job',
        resolve: () => {},
        // Process exit while a job runs: a cancelled job ends quietly, anything else fails.
        reject: (error) => job.cancelled ? resolve({ jobId: job.jobId, fragments: job.fragments, audioS: 0, genS: 0, cancelled: true }) : reject(error),
      });
      this.send({ type: 'synth', job_id: job.jobId, text: job.request.text, voice, lang: job.request.language, out_dir: outDir });
    }).finally(() => { this.jobListener = null; });
  }

  private jobListener: ((message: Message) => boolean) | null = null;

  private async ensureModel(modelId: string): Promise<void> {
    if (this.loading) await this.loading.catch(() => {});
    const running = await this.ensureRunning();
    if (running.modelId === modelId) return;
    this.loading = (async () => {
      this.setState('loading');
      const id = randomUUID();
      const loaded = this.expect(running, id, 'warm', this.options.loadTimeoutMs ?? 300_000);
      this.send({ type: 'load', id, model_path: this.options.modelPath(modelId), model_id: modelId });
      await loaded;
      running.modelId = modelId;
      this.setState('ready');
    })();
    try { await this.loading; } catch (error) {
      this.setState('error', error instanceof Error ? error.message : String(error));
      await this.stop();
      throw error;
    } finally { this.loading = null; }
  }

  private ensureRunning(): Promise<Running> {
    if (this.running && !this.running.exited) return Promise.resolve(this.running);
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async start(): Promise<Running> {
    const python = await this.options.python();
    if (!python) throw new Error('TTS_RUNTIME_NOT_INSTALLED');
    this.setState('starting');
    await fs.mkdir(path.dirname(this.options.logPath), { recursive: true });
    const spawn = this.options.spawn ?? nodeSpawn;
    const child = spawn(python, ['-I', '-B', this.options.serveScript, '--backend', this.options.backend()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // POSIX: the sidecar leads its own process group so a kill takes any helper it started.
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: scrubbedEnv(),
    });
    if (child.pid) (this.options.lowerPriority ?? defaultLowerPriority)(child.pid);
    const running: Running = { child, modelId: null, buffer: '', waiters: new Map(), exited: false };
    this.running = running;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.onStdout(running, chunk));
    child.stderr?.on('data', (chunk: Buffer) => { void this.log(chunk); });
    child.on('error', () => this.onExit(running, 'TTS_ENGINE_SPAWN_FAILED'));
    child.on('exit', (code) => this.onExit(running, code === 0 ? 'TTS_ENGINE_EXITED' : 'TTS_ENGINE_CRASHED'));
    try {
      const ready = await this.expect(running, '__ready__', 'ready', this.options.startTimeoutMs ?? 60_000);
      this.device = (ready.device as TtsDevice | undefined) ?? null;
    } catch (error) {
      this.setState('error', error instanceof Error ? error.message : String(error));
      await this.stop();
      throw error;
    }
    return running;
  }

  private onStdout(running: Running, chunk: string): void {
    running.buffer += chunk;
    let newline = running.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = running.buffer.slice(0, newline).trim();
      running.buffer = running.buffer.slice(newline + 1);
      newline = running.buffer.indexOf('\n');
      if (!line) continue;
      let message: Message;
      try { message = JSON.parse(line) as Message; } catch { void this.log(Buffer.from(`[stdout] ${line}\n`)); continue; }
      if (typeof message.type !== 'string') continue;
      if (this.jobListener?.(message)) continue;
      const key = message.type === 'ready' ? '__ready__' : String(message.id ?? '');
      const waiter = running.waiters.get(key);
      if (!waiter) continue;
      if (message.type === 'error') { running.waiters.delete(key); waiter.reject(new Error(String(message.message ?? 'TTS_ENGINE_ERROR'))); }
      else if (message.type === waiter.expect) { running.waiters.delete(key); waiter.resolve(message); }
    }
  }

  private expect(running: Running, id: string, type: string, timeoutMs: number): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => { running.waiters.delete(id); reject(new Error('TTS_ENGINE_TIMEOUT')); }, timeoutMs);
      timer.unref?.();
      running.waiters.set(id, {
        expect: type,
        resolve: (message) => { clearTimeout(timer); resolve(message); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
    });
  }

  private onExit(running: Running, reason: string): void {
    if (running.exited) return;
    running.exited = true;
    for (const waiter of running.waiters.values()) waiter.reject(new Error(reason));
    running.waiters.clear();
    if (this.running === running) {
      this.running = null;
      this.device = null;
      this.clearIdle();
      this.setState(reason === 'TTS_ENGINE_EXITED' || this.state === 'unloaded' ? 'unloaded' : 'error', reason === 'TTS_ENGINE_EXITED' ? undefined : reason);
    }
  }

  private send(message: Record<string, unknown>): void {
    const stdin = this.running?.child.stdin;
    if (!stdin || stdin.destroyed) return;
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async stop(): Promise<void> {
    const running = this.running;
    this.running = null;
    this.device = null;
    this.clearIdle();
    this.state = 'unloaded';
    if (running && !running.exited) {
      // Closing stdin is the orderly stop serve.py watches for; the group is killed if it lingers.
      try { running.child.stdin?.write(`${JSON.stringify({ type: 'exit' })}\n`); running.child.stdin?.end(); } catch { /* already closed */ }
      const exited = await new Promise<boolean>((resolve) => {
        if (running.exited) { resolve(true); return; }
        const timer = setTimeout(() => resolve(false), 3000);
        running.child.once('exit', () => { clearTimeout(timer); resolve(true); });
      });
      if (!exited) killTree(running.child);
    }
    this.options.onState?.(this.snapshot());
  }

  private scheduleIdle(): void {
    this.clearIdle();
    if (!this.running || this.current || this.queue.length || this.leases > 0) return;
    const ms = Math.max(30_000, this.options.idleMs());
    this.idleUnloadAt = Date.now() + ms;
    this.idleTimer = setTimeout(() => { if (!this.current && !this.queue.length && this.leases === 0) void this.stop(); }, ms);
    this.idleTimer.unref?.();
    this.options.onState?.(this.snapshot());
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.idleUnloadAt = null;
  }

  private async log(chunk: Buffer): Promise<void> {
    try {
      const stat = await fs.stat(this.options.logPath).catch(() => null);
      if (stat && stat.size > MAX_LOG_BYTES) await fs.rename(this.options.logPath, `${this.options.logPath}.1`).catch(() => {});
      await fs.appendFile(this.options.logPath, chunk);
    } catch { /* logging never fails a job */ }
  }
}

function isInside(dir: string, file: string): boolean {
  const relative = path.relative(dir, path.resolve(file));
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try { nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {}); } catch { /* gone */ }
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
}

/** A minimal environment: no user PYTHON* variables can redirect imports into the sidecar. */
function scrubbedEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'CUDA_VISIBLE_DEVICES'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key];
  env.PYTHONNOUSERSITE = '1';
  env.PYTHONUNBUFFERED = '1';
  env.HF_HUB_OFFLINE = '1';
  env.TOKENIZERS_PARALLELISM = 'false';
  return env;
}
