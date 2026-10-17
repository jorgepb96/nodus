import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as tar from 'tar';
import pythonManifest from '../../../runtime/zotero-mcp/manifest.json';
import { findSystemPython } from '../../systemPython';
import type { SignInstallProgress } from '@shared/signTypes';
import { SignEngine } from './engine';

const run = promisify(execFile);
const pythonAt = (root: string) => path.join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const basePythonAt = (root: string) => path.join(root, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');

/** Optional, app-private installation. Never modifies a system interpreter and
 * publishes only after a real engine check.
 *
 * The bundled Python is the base only outside macOS. There it is signed with
 * Nodus' team ID under the hardened runtime, so library validation refuses every
 * native wheel pip downloads (cryptography, lxml, Pillow…) and the engine check
 * fails with ImportError. macOS starts from a supported system Python or the
 * pinned standalone download instead; Intel Macs always take the download,
 * because they reuse the bundled cryptography build made for that exact Python. */
export class SignInstaller {
  private controller: AbortController | null = null;
  constructor(readonly root: string, readonly assets: string, readonly bundledRuntime: string,
    // The lock ships wheels for 3.12-3.14, so a newer default python3 does not hide a supported python3.N.
    private findPython = () => findSystemPython('3.12', minor => /^3\.(12|13|14)$/.test(minor)),
    private host: { platform: NodeJS.Platform; arch: string } = { platform: process.platform, arch: process.arch }) {}
  cancel() { this.controller?.abort(); }
  async install(progress: (event: SignInstallProgress) => void): Promise<string> {
    if (this.controller) throw new Error('SIGN_INSTALL_BUSY');
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), 900_000);
    let staging = '';
    try {
      progress({ phase: 'checking', fraction: 0 });
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      const lock = await fs.readFile(path.join(this.assets, 'requirements.lock'), 'utf8');
      const digest = createHash('sha256').update(lock).digest('hex');
      const pointer = path.join(this.root, 'installed.json');
      let previous: { python: string; digest: string } | null = null;
      try { previous = JSON.parse(await fs.readFile(pointer, 'utf8')); } catch { /* first install */ }
      const verify = (python: string) => new SignEngine(python, path.join(this.assets, 'engine.py')).run({ op: 'status' });
      if (previous?.digest === digest && this.owns(previous.python)) {
        try { await verify(previous.python); progress({ phase: 'ready', fraction: 1 }); return previous.python; } catch { /* repair */ }
      }
      signal.throwIfAborted();
      const mac = this.host.platform === 'darwin';
      const intelMac = mac && this.host.arch === 'x64';
      let base = '';
      if (!mac) {
        const bundled = basePythonAt(this.bundledRuntime);
        try { await fs.access(bundled); base = bundled; } catch { /* no bundled runtime */ }
      }
      if (!base && !intelMac) {
        const system = await this.findPython();
        base = system && /^3\.(12|13|14)\./.test(system.version) ? system.path : '';
      }
      if (!base) base = await this.bootstrap(signal, progress);
      progress({ phase: 'environment', fraction: 0.3 });
      staging = path.join(this.root, `env-${randomUUID()}`);
      await run(base, ['-I', '-m', 'venv', staging], { signal, timeout: 300_000, windowsHide: true });
      const python = pythonAt(staging);
      let requirements = lock;
      if (intelMac) {
        // Upstream cryptography no longer publishes Intel Mac wheels. Nodus
        // already ships a hash-verified native build for its bundled Python.
        const dependencies = path.join(this.bundledRuntime, 'dependencies');
        try { await fs.access(dependencies); } catch { throw new Error('SIGN_INSTALL_BUNDLED_RUNTIME_REQUIRED'); }
        const { stdout } = await run(python, ['-I', '-c', 'import sysconfig;print(sysconfig.get_path("purelib"))'], { signal });
        await fs.writeFile(path.join(stdout.trim(), 'nodus-native.pth'), `${dependencies}\n`, { mode: 0o600 });
        const { stdout: version } = await run(python, ['-I', '-c', 'import cryptography;print(cryptography.__version__)'], { signal });
        if (version.trim() !== '50.0.1') throw new Error('SIGN_INSTALL_BUNDLED_RUNTIME_REQUIRED');
        requirements = lock.replace(/cryptography==[^\n]+(?:\n[ \t]+--hash=[^\n]+)*/g, '');
      }
      const requirementFile = path.join(staging, 'requirements.lock');
      await fs.writeFile(requirementFile, requirements, { mode: 0o600 });
      progress({ phase: 'dependencies', fraction: 0.45 });
      await run(python, ['-I', '-m', 'pip', '--isolated', 'install', '--index-url', 'https://pypi.org/simple',
        '--disable-pip-version-check', '--no-input', '--no-cache-dir', '--only-binary=:all:', '--require-hashes', '--no-deps',
        '--timeout', '30', '--retries', '1', '-r', requirementFile], { signal, timeout: 600_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      progress({ phase: 'verifying', fraction: 0.9 });
      await run(python, ['-I', '-m', 'pip', '--isolated', 'check'], { signal, timeout: 30_000, windowsHide: true });
      await verify(python);
      signal.throwIfAborted();
      const temp = `${pointer}.tmp`;
      await fs.writeFile(temp, JSON.stringify({ python, digest }), { mode: 0o600 });
      await fs.rename(temp, pointer);
      staging = '';
      progress({ phase: 'ready', fraction: 1 });
      // Reinstall/repair removes only our previous environment, never a user Python.
      if (previous && previous.python !== python && this.owns(previous.python))
        await fs.rm(path.resolve(previous.python, '../..'), { recursive: true, force: true }).catch(() => {});
      return python;
    } catch (error) {
      if (signal.aborted) throw new Error('SIGN_INSTALL_CANCELLED');
      const code = error instanceof Error ? error.message : '';
      throw new Error(code.startsWith('SIGN_') ? code : 'SIGN_INSTALL_FAILED');
    } finally {
      clearTimeout(timer);
      if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      this.controller = null;
    }
  }
  private owns(python: string) {
    const relative = path.relative(this.root, path.resolve(python));
    return /^env-[^/\\]+[/\\](bin|Scripts)[/\\]python(?:\.exe)?$/.test(relative);
  }
  private async bootstrap(signal: AbortSignal, progress: (event: SignInstallProgress) => void) {
    const target = pythonManifest.platforms[`${process.platform}-${process.arch}` as keyof typeof pythonManifest.platforms];
    if (!target) throw new Error('SIGN_INSTALL_PLATFORM_UNSUPPORTED');
    const root = path.join(this.root, 'interpreter');
    try { await fs.access(basePythonAt(root)); return basePythonAt(root); } catch { /* download pinned runtime */ }
    const staging = path.join(this.root, `python-${randomUUID()}`);
    const archive = path.join(staging, 'python.tar.gz');
    await fs.mkdir(staging, { mode: 0o700 });
    try {
      const name = `cpython-${pythonManifest.python}+${pythonManifest.pythonBuild}-${target.triple}-install_only_stripped.tar.gz`;
      const response = await fetch(`https://github.com/astral-sh/python-build-standalone/releases/download/${pythonManifest.pythonBuild}/${encodeURIComponent(name)}`, { signal });
      if (!response.ok || !response.body) throw new Error('SIGN_INSTALL_DOWNLOAD_FAILED');
      const file = await fs.open(archive, 'w');
      const hash = createHash('sha256');
      const total = Number(response.headers.get('content-length')) || 0;
      let loaded = 0;
      try {
        for await (const chunk of response.body) {
          signal.throwIfAborted();
          loaded += chunk.length;
          if (loaded > 150 * 1024 * 1024) throw new Error('SIGN_INSTALL_DOWNLOAD_FAILED');
          hash.update(chunk);
          await file.write(chunk);
          progress({ phase: 'python', fraction: total ? Math.min(.29, loaded / total * .29) : .1 });
        }
      } finally { await file.close(); }
      if (hash.digest('hex') !== target.sha256) throw new Error('SIGN_INSTALL_INTEGRITY_FAILED');
      await tar.x({ file: archive, cwd: staging, strict: true, preservePaths: false,
        filter: name => name.startsWith('python/') && !name.split('/').includes('..') });
      signal.throwIfAborted();
      await fs.rm(archive);
      await fs.rename(staging, root);
      return basePythonAt(root);
    } finally { await fs.rm(staging, { recursive: true, force: true }).catch(() => {}); }
  }
}
