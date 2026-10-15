// The vendor CLIs behind the subscription providers — OpenAI's Codex and GitHub's
// Copilot — fetched the first time they are used instead of riding in every installer.
//
// Together they were ~540 MB of a 2.4 GB macOS app (~220 MB of every download) for
// two providers most people never connect. The packager now leaves their platform
// packages out (build/packagedNodeModules.cjs) and writes Resources/agent-runtimes.json
// from package-lock.json: for each platform package, the npm tarball and the integrity
// hash npm itself installed. This module downloads exactly that tarball, refuses any
// byte that does not match the hash, unpacks it beside the profile and runs it from
// there. The binaries inside are the vendors' own, still signed by OpenAI and GitHub.
//
// A development checkout has the packages in node_modules and never downloads. A
// status read never downloads either: opening Providers must not cost every user
// 100 MB. Using the provider does — connecting, generating, listing its models — and
// so does the explicit "download" button, which is where the progress shows.
// A namespace import: this module is reached from most of the AI stack, and the test
// harnesses that bundle it stub `electron` with `app` alone.
import * as electron from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import type { AgentRuntimeStatus } from '@shared/types';

export type AgentRuntimeKind = 'codex' | 'copilot';

export interface AgentRuntimeTarget {
  /** The npm package holding this platform's binary, e.g. `@openai/codex-darwin-arm64`. */
  packageName: string;
  /** The executable, relative to that package's root. */
  executable: string;
}

interface ManifestEntry {
  version: string;
  resolved: string;
  integrity: string;
}

interface AgentRuntimeManifest {
  version: 1;
  packages: Record<string, ManifestEntry>;
}

const MANIFEST_FILE = 'agent-runtimes.json';
const MARKER_FILE = '.nodus-runtime.json';

const CODEX_TRIPLES: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

/** The platform package and executable a runtime needs here, or null where it does not exist. */
export function agentRuntimeTarget(
  kind: AgentRuntimeKind,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): AgentRuntimeTarget | null {
  const key = `${platform}-${arch}`;
  if (!(key in CODEX_TRIPLES)) return null;
  const exe = platform === 'win32' ? '.exe' : '';
  if (kind === 'codex') {
    return { packageName: `@openai/codex-${key}`, executable: `vendor/${CODEX_TRIPLES[key]}/bin/codex${exe}` };
  }
  return { packageName: `@github/copilot-${key}`, executable: `copilot${exe}` };
}

interface Environment {
  root: () => string;
  manifestPath: () => string | null;
  fetch: (url: string) => Promise<Response>;
  locateBundled: (kind: AgentRuntimeKind, target: AgentRuntimeTarget) => string | null;
}

function unpackedAsarPath(file: string): string {
  const marker = `${path.sep}app.asar${path.sep}`;
  return file.includes(marker) ? file.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`) : file;
}

/**
 * The binary from node_modules, where a development checkout (or an older installer)
 * keeps it. electron-builder may nest an optional dependency under its parent, so the
 * parent loader package is tried as well.
 */
function locateBundled(kind: AgentRuntimeKind, target: AgentRuntimeTarget): string | null {
  // The Electron bundle recreates __filename in its banner; using it also keeps
  // the repository's CommonJS-based TS test harness compatible with this module.
  const require = createRequire(__filename);
  // Literal specifiers, so the packager's scan of the bundle sees the loaders it must keep.
  const loader = () => (kind === 'codex'
    ? require.resolve('@openai/codex/package.json')
    : require.resolve('@github/copilot/package.json'));
  const candidates: Array<() => string> = [
    // Copilot's platform packages export the binary itself and nothing else.
    () => kind === 'codex'
      ? path.join(path.dirname(require.resolve(`${target.packageName}/package.json`)), target.executable)
      : require.resolve(target.packageName),
    () => path.join(path.dirname(loader()), 'node_modules', ...target.packageName.split('/'), target.executable),
  ];
  for (const candidate of candidates) {
    try {
      const executable = unpackedAsarPath(candidate());
      if (fs.existsSync(executable)) return executable;
    } catch { /* not installed this way */ }
  }
  return null;
}

let environment: Environment = {
  root: () => path.join(electron.app.getPath('userData'), 'agent-runtimes'),
  manifestPath: () => (electron.app.isPackaged ? path.join(process.resourcesPath, MANIFEST_FILE) : null),
  // Chromium's network stack: the system proxy and certificate store apply.
  fetch: (url) => electron.net.fetch(url),
  locateBundled,
};

/** Test seam: replace where runtimes live, what the manifest says and how bytes arrive. */
export function __setAgentRuntimeEnvironmentForTest(overrides: Partial<Environment>): void {
  environment = { ...environment, ...overrides };
  installs.clear();
  progress.clear();
  failed.clear();
}

const installs = new Map<AgentRuntimeKind, Promise<string>>();
const progress = new Map<AgentRuntimeKind, { receivedBytes: number; totalBytes: number | null }>();
const failed = new Set<AgentRuntimeKind>();
const listeners = new Set<(kind: AgentRuntimeKind) => void>();

/** Notified whenever a runtime's state or download progress changes. */
export function onAgentRuntimeChanged(listener: (kind: AgentRuntimeKind) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(kind: AgentRuntimeKind): void {
  for (const listener of listeners) {
    try { listener(kind); } catch { /* a listener must not break the download */ }
  }
}

function readManifest(): AgentRuntimeManifest | null {
  const file = environment.manifestPath();
  if (!file) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as AgentRuntimeManifest;
    return manifest.version === 1 && manifest.packages ? manifest : null;
  } catch {
    return null;
  }
}

/** `@openai/codex-darwin-arm64` → `@openai+codex-darwin-arm64`: one directory level. */
function directoryName(target: AgentRuntimeTarget): string {
  return target.packageName.replace('/', '+');
}

function installDirectory(target: AgentRuntimeTarget, version: string): string {
  return path.join(environment.root(), `${directoryName(target)}@${version}`);
}

function installedExecutable(target: AgentRuntimeTarget, entry: ManifestEntry): string | null {
  const directory = installDirectory(target, entry.version);
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(directory, MARKER_FILE), 'utf8')) as { integrity?: string };
    const executable = path.join(directory, target.executable);
    return marker.integrity === entry.integrity && fs.existsSync(executable) ? executable : null;
  } catch {
    return null;
  }
}

/** The runtime's executable if it is already on this machine; never downloads. */
export function resolveAgentRuntime(kind: AgentRuntimeKind): string | null {
  const target = agentRuntimeTarget(kind);
  if (!target) return null;
  const bundled = environment.locateBundled(kind, target);
  if (bundled) return bundled;
  const entry = readManifest()?.packages[target.packageName];
  return entry ? installedExecutable(target, entry) : null;
}

export function agentRuntimeStatus(kind: AgentRuntimeKind): AgentRuntimeStatus {
  const running = progress.get(kind);
  if (running) return { state: 'installing', ...running };
  if (resolveAgentRuntime(kind)) return { state: 'ready', receivedBytes: 0, totalBytes: null };
  return { state: failed.has(kind) ? 'failed' : 'missing', receivedBytes: 0, totalBytes: null };
}

/**
 * The CLIs a profile already relies on: any model it chose anywhere in its settings
 * (favorites, task defaults, per-feature models) that runs on Codex or Copilot.
 */
export function agentRuntimesInUse(settings: unknown): AgentRuntimeKind[] {
  const used = new Set<AgentRuntimeKind>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const provider = (value as { provider?: unknown }).provider;
    if (provider === 'codex') used.add('codex');
    if (provider === 'github-copilot') used.add('copilot');
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(settings, 0);
  return [...used];
}

/**
 * Fetch, in the background, the CLIs this profile already uses but this installation
 * does not have — the first launch after updating from an installer that shipped them —
 * so the next generation does not wait on a download. Nobody else downloads anything.
 */
export function prefetchAgentRuntimesInUse(settings: unknown): void {
  for (const kind of agentRuntimesInUse(settings)) {
    if (agentRuntimeStatus(kind).state !== 'missing') continue;
    void ensureAgentRuntime(kind).catch((error) => {
      console.warn(`[agent-runtime] ${kind} could not be downloaded ahead of use:`, error);
    });
  }
}

/** The runtime's executable, downloading it first if this machine does not have it yet. */
export function ensureAgentRuntime(kind: AgentRuntimeKind): Promise<string> {
  const ready = resolveAgentRuntime(kind);
  if (ready) return Promise.resolve(ready);
  let running = installs.get(kind);
  if (!running) {
    running = install(kind).finally(() => installs.delete(kind));
    installs.set(kind, running);
  }
  return running;
}

function unsupported(kind: AgentRuntimeKind): Error {
  return kind === 'codex'
    ? new Error(`Codex no es compatible con ${process.platform}/${process.arch}.`)
    : new Error(`GitHub Copilot no es compatible con ${process.platform}/${process.arch}.`);
}

/**
 * This package's leftovers from an interrupted install, and the versions this build no
 * longer uses. Only its own: the other runtime may be downloading beside it.
 */
function removeStale(target: AgentRuntimeTarget, keep: string): void {
  const root = environment.root();
  const name = directoryName(target);
  for (const entry of fs.readdirSync(root)) {
    const stale = entry.startsWith(`.partial-${name}-`) || entry.startsWith(`.download-${name}-`)
      || (entry.startsWith(`${name}@`) && path.join(root, entry) !== keep);
    if (stale) fs.rmSync(path.join(root, entry), { recursive: true, force: true });
  }
}

async function install(kind: AgentRuntimeKind): Promise<string> {
  const target = agentRuntimeTarget(kind);
  if (!target) throw unsupported(kind);
  const entry = readManifest()?.packages[target.packageName];
  if (!entry) throw new Error('Esta instalación de Nodus no indica de dónde descargar el motor oficial.');

  const root = environment.root();
  fs.mkdirSync(root, { recursive: true });
  const destination = installDirectory(target, entry.version);
  const archive = path.join(root, `.download-${directoryName(target)}-${randomUUID()}.tgz`);
  const staging = path.join(root, `.partial-${directoryName(target)}-${randomUUID()}`);
  failed.delete(kind);
  progress.set(kind, { receivedBytes: 0, totalBytes: null });
  changed(kind);
  try {
    removeStale(target, destination);

    let response: Response;
    try {
      response = await environment.fetch(entry.resolved);
    } catch {
      throw new Error('No se pudo descargar el motor oficial. Comprueba la conexión y vuelve a intentarlo.');
    }
    if (!response.ok || !response.body) {
      throw new Error('No se pudo descargar el motor oficial. Comprueba la conexión y vuelve a intentarlo.');
    }
    const declared = Number(response.headers.get('content-length'));
    const state = { receivedBytes: 0, totalBytes: Number.isFinite(declared) && declared > 0 ? declared : null };
    progress.set(kind, state);
    changed(kind);

    const hash = createHash('sha512');
    let lastReport = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        state.receivedBytes += chunk.length;
        const now = Date.now();
        if (now - lastReport > 250) {
          lastReport = now;
          changed(kind);
        }
        done(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), meter, fs.createWriteStream(archive));
    } catch {
      throw new Error('No se pudo descargar el motor oficial. Comprueba la conexión y vuelve a intentarlo.');
    }
    if (`sha512-${hash.digest('base64')}` !== entry.integrity) {
      throw new Error('El motor descargado no coincide con su huella publicada y se ha descartado.');
    }

    // npm tarballs keep everything under package/; tar refuses absolute and `..` paths.
    fs.mkdirSync(staging);
    await tar.x({ file: archive, cwd: staging, strip: 1, strict: true });
    const executable = path.join(staging, target.executable);
    if (!fs.existsSync(executable)) {
      throw new Error('El paquete descargado no contiene el ejecutable esperado.');
    }
    if (process.platform !== 'win32') fs.chmodSync(executable, 0o755);
    fs.writeFileSync(path.join(staging, MARKER_FILE), JSON.stringify({
      packageName: target.packageName,
      version: entry.version,
      integrity: entry.integrity,
    }));
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(staging, destination);
    return path.join(destination, target.executable);
  } catch (error) {
    failed.add(kind);
    throw error;
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
    progress.delete(kind);
    changed(kind);
  }
}
