// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as tar from 'tar';
import pythonManifest from '../../runtime/zotero-mcp/manifest.json';
import { findSystemPython } from '../systemPython';
import type { TtsBackend, TtsDevice } from '@shared/ttsModels';

const run = promisify(execFile);
const pythonAt = (root: string, platform: NodeJS.Platform) => path.join(root, platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const basePythonAt = (root: string, platform: NodeJS.Platform) => path.join(root, 'python', platform === 'win32' ? 'python.exe' : 'bin/python3');

/** Which hash-locked dependency set an environment is built from. */
export type TtsLockFlavor = 'mlx' | 'torch-cpu' | 'torch-cuda';

const LOCK_FILES: Record<TtsLockFlavor, string> = {
  mlx: 'requirements-mlx.lock',
  'torch-cpu': 'requirements-torch-cpu.lock',
  'torch-cuda': 'requirements-torch-cuda.lock',
};
const EXTRA_INDEX: Partial<Record<TtsLockFlavor, string>> = {
  'torch-cpu': 'https://download.pytorch.org/whl/cpu',
  'torch-cuda': 'https://download.pytorch.org/whl/cu124',
};
/** pip timeouts: the CUDA torch wheels alone are ~2.5 GB. */
const PIP_TIMEOUT_MS: Record<TtsLockFlavor, number> = { mlx: 900_000, 'torch-cpu': 1_200_000, 'torch-cuda': 3_600_000 };

export type TtsInstallPhase = 'checking' | 'python' | 'environment' | 'dependencies' | 'verifying' | 'ready';
export interface TtsInstallProgress { phase: TtsInstallPhase; fraction: number }

export interface TtsInstalledRuntime {
  python: string;
  digest: string;
  flavor: TtsLockFlavor;
  backend: TtsBackend;
  device: TtsDevice;
  fallbackReason?: string;
}

interface SelfCheck { ok: boolean; backend: TtsBackend; device: TtsDevice; versions?: Record<string, string> }

export interface TtsHost {
  platform: NodeJS.Platform;
  arch: string;
  /** Whether an NVIDIA driver answered; decides between the CUDA and CPU torch locks. */
  hasNvidia: () => Promise<boolean>;
}

/**
 * Builds Ming's private Python environment under `root` and publishes it only after the
 * sidecar's own self-check passes. Never touches a system interpreter.
 *
 * Every environment runs CPython 3.12, the version the locks are compiled for. On Windows and
 * Linux the base is the bundled standalone runtime; on macOS it is a system 3.12 or the pinned
 * standalone download, never the bundled copy: that one is signed with the hardened runtime, so
 * library validation would refuse the native wheels (MLX, torch) pip installs.
 *
 * All work is asynchronous child processes and streamed I/O, so the main process stays responsive.
 */
export class TtsInstaller {
  private controller: AbortController | null = null;
  constructor(
    readonly root: string,
    readonly assets: string,
    readonly bundledRuntime: string,
    private host: TtsHost,
    private findPython = () => findSystemPython('3.12', (minor) => minor === '3.12'),
  ) {}

  get busy(): boolean { return this.controller !== null; }
  cancel(): void { this.controller?.abort(); }

  async installed(): Promise<TtsInstalledRuntime | null> {
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.root, 'installed.json'), 'utf8')) as TtsInstalledRuntime;
      if (!this.owns(value.python)) return null;
      await fs.access(value.python);
      return value;
    } catch { return null; }
  }

  async remove(): Promise<void> {
    if (this.controller) throw new Error('TTS_INSTALL_BUSY');
    await fs.rm(this.root, { recursive: true, force: true });
  }

  async install(progress: (event: TtsInstallProgress) => void): Promise<TtsInstalledRuntime> {
    if (this.controller) throw new Error('TTS_INSTALL_BUSY');
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    try {
      progress({ phase: 'checking', fraction: 0 });
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      const appleSilicon = this.host.platform === 'darwin' && this.host.arch === 'arm64';
      if (appleSilicon) return await this.build('mlx', signal, progress);
      if (await this.host.hasNvidia().catch(() => false)) {
        try {
          const runtime = await this.build('torch-cuda', signal, progress);
          if (runtime.device === 'cuda') return runtime;
          // CUDA torch installed but saw no device: the CPU build is ~2 GB smaller and as fast here.
          return await this.build('torch-cpu', signal, progress, 'CUDA_NO_DEVICE');
        } catch (error) {
          if (signal.aborted) throw error;
          return await this.build('torch-cpu', signal, progress, 'CUDA_INSTALL_FAILED');
        }
      }
      return await this.build('torch-cpu', signal, progress);
    } catch (error) {
      if (signal.aborted) throw new Error('TTS_INSTALL_CANCELLED');
      const code = error instanceof Error ? error.message : '';
      throw new Error(code.startsWith('TTS_') ? code : 'TTS_INSTALL_FAILED');
    } finally {
      this.controller = null;
    }
  }

  private async build(flavor: TtsLockFlavor, signal: AbortSignal, progress: (event: TtsInstallProgress) => void, fallbackReason?: string): Promise<TtsInstalledRuntime> {
    const lockPath = path.join(this.assets, LOCK_FILES[flavor]);
    const lock = await fs.readFile(lockPath, 'utf8').catch(() => { throw new Error('TTS_INSTALL_LOCK_MISSING'); });
    const digest = createHash('sha256').update(flavor).update('\0').update(lock).digest('hex');
    const previous = await this.installed();
    if (previous?.digest === digest) {
      try {
        const check = await this.selfCheck(previous.python, previous.backend, signal);
        progress({ phase: 'ready', fraction: 1 });
        return { ...previous, device: check.device };
      } catch { /* repair below */ }
    }
    signal.throwIfAborted();
    const base = await this.basePython(signal, progress);
    progress({ phase: 'environment', fraction: 0.3 });
    let staging = path.join(this.root, `env-${randomUUID()}`);
    try {
      await run(base, ['-I', '-m', 'venv', staging], { signal, timeout: 300_000, windowsHide: true });
      const python = pythonAt(staging, this.host.platform);
      progress({ phase: 'dependencies', fraction: 0.4 });
      const extra = EXTRA_INDEX[flavor];
      await run(python, ['-I', '-m', 'pip', '--isolated', 'install', '--index-url', 'https://pypi.org/simple',
        ...(extra ? ['--extra-index-url', extra] : []),
        '--disable-pip-version-check', '--no-input', '--no-cache-dir', '--only-binary=:all:', '--require-hashes', '--no-deps',
        '--timeout', '60', '--retries', '2', '-r', lockPath], { signal, timeout: PIP_TIMEOUT_MS[flavor], maxBuffer: 8 * 1024 * 1024, windowsHide: true });
      progress({ phase: 'verifying', fraction: 0.92 });
      await run(python, ['-I', '-m', 'pip', '--isolated', 'check'], { signal, timeout: 60_000, windowsHide: true });
      const backend: TtsBackend = flavor === 'mlx' ? 'mlx' : 'torch';
      const check = await this.selfCheck(python, backend, signal);
      signal.throwIfAborted();
      const runtime: TtsInstalledRuntime = { python, digest, flavor, backend, device: check.device, ...(fallbackReason ? { fallbackReason } : {}) };
      const pointer = path.join(this.root, 'installed.json');
      await fs.writeFile(`${pointer}.tmp`, JSON.stringify(runtime), { mode: 0o600 });
      await fs.rename(`${pointer}.tmp`, pointer);
      staging = '';
      progress({ phase: 'ready', fraction: 1 });
      // A reinstall removes only our previous environment, never a user Python.
      if (previous && previous.python !== python && this.owns(previous.python))
        await fs.rm(path.resolve(previous.python, '../..'), { recursive: true, force: true }).catch(() => {});
      return runtime;
    } finally {
      if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Runs the sidecar's `--self-check`: imports the backend and reports the device, loading no model. */
  private async selfCheck(python: string, backend: TtsBackend, signal: AbortSignal): Promise<SelfCheck> {
    const { stdout } = await run(python, ['-I', '-B', path.join(this.assets, 'serve.py'), '--self-check', '--backend', backend],
      { signal, timeout: 180_000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
    const parsed = JSON.parse(line) as SelfCheck;
    if (!parsed.ok || parsed.backend !== backend) throw new Error('TTS_INSTALL_VERIFY_FAILED');
    return parsed;
  }

  private async basePython(signal: AbortSignal, progress: (event: TtsInstallProgress) => void): Promise<string> {
    if (this.host.platform !== 'darwin') {
      const bundled = basePythonAt(this.bundledRuntime, this.host.platform);
      try { await fs.access(bundled); return bundled; } catch { /* no bundled runtime in this build */ }
    } else {
      const system = await this.findPython();
      if (system && /^3\.12\./.test(system.version)) return system.path;
    }
    return this.bootstrap(signal, progress);
  }

  private owns(python: string): boolean {
    const relative = path.relative(this.root, path.resolve(python));
    return /^env-[^/\\]+[/\\](bin|Scripts)[/\\]python(?:\.exe)?$/.test(relative);
  }

  /** Downloads the pinned python-build-standalone 3.12 and checks its SHA-256 against the manifest. */
  private async bootstrap(signal: AbortSignal, progress: (event: TtsInstallProgress) => void): Promise<string> {
    const target = pythonManifest.platforms[`${this.host.platform}-${this.host.arch}` as keyof typeof pythonManifest.platforms];
    if (!target) throw new Error('TTS_INSTALL_PLATFORM_UNSUPPORTED');
    const root = path.join(this.root, 'interpreter');
    try { await fs.access(basePythonAt(root, this.host.platform)); return basePythonAt(root, this.host.platform); } catch { /* download below */ }
    const staging = path.join(this.root, `python-${randomUUID()}`);
    const archive = path.join(staging, 'python.tar.gz');
    await fs.mkdir(staging, { mode: 0o700 });
    try {
      const name = `cpython-${pythonManifest.python}+${pythonManifest.pythonBuild}-${target.triple}-install_only_stripped.tar.gz`;
      const response = await fetch(`https://github.com/astral-sh/python-build-standalone/releases/download/${pythonManifest.pythonBuild}/${encodeURIComponent(name)}`, { signal });
      if (!response.ok || !response.body) throw new Error('TTS_INSTALL_DOWNLOAD_FAILED');
      const file = await fs.open(archive, 'w');
      const hash = createHash('sha256');
      const total = Number(response.headers.get('content-length')) || 0;
      let loaded = 0;
      try {
        for await (const chunk of response.body) {
          signal.throwIfAborted();
          loaded += chunk.length;
          if (loaded > 150 * 1024 * 1024) throw new Error('TTS_INSTALL_DOWNLOAD_FAILED');
          hash.update(chunk);
          await file.write(chunk);
          progress({ phase: 'python', fraction: total ? Math.min(0.29, (loaded / total) * 0.29) : 0.1 });
        }
      } finally { await file.close(); }
      if (hash.digest('hex') !== target.sha256) throw new Error('TTS_INSTALL_INTEGRITY_FAILED');
      await tar.x({ file: archive, cwd: staging, strict: true, preservePaths: false,
        filter: (entry) => entry.startsWith('python/') && !entry.split('/').includes('..') });
      signal.throwIfAborted();
      await fs.rm(archive);
      await fs.rename(staging, root);
      return basePythonAt(root, this.host.platform);
    } finally { await fs.rm(staging, { recursive: true, force: true }).catch(() => {}); }
  }
}
