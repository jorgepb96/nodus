import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  NODUS_LOCAL_MODELS,
  getNodusLocalModel,
  nodusLocalModelBytes,
  type NodusLocalAiStatus,
  type NodusLocalModelDefinition,
  type NodusLocalOffloadStatus,
  type NodusLocalRuntimeDescriptor,
} from '@shared/localAiModels';
import {
  LLAMA_CPP_VERSION,
  classifyStartupFailure,
  detectInstalledBackend,
  parseDeviceList,
  parseOffloadDecision,
  runtimeAssetCandidates,
  shouldReplaceInstalledRuntime,
  type NodusLocalRuntimeAsset,
  type NodusLocalRuntimeBackend,
  type NodusLocalRuntimeDevice,
} from '@shared/localAiRuntime';
import type { ModelInfo } from '@shared/types';
import { isEmbeddingGemma2, type EmbeddingRole } from '@shared/embeddingGemma2';
import { embedEmbeddingGemma2, closeEmbeddingGemma2Worker, embeddingGemma2Busy } from './embeddingGemma2Host';

export { LLAMA_CPP_VERSION };

interface ActiveLocalAiDownload {
  progress: number;
  promise: Promise<NodusLocalAiStatus>;
  listeners: Set<(fraction: number) => void>;
  controller: AbortController;
}

const activeDownloads = new Map<string, ActiveLocalAiDownload>();
let activeRuntimeDownload: ActiveLocalAiDownload | null = null;
const embeddingPipelines = new Map<string, Promise<any>>();
const verifiedAssetCache = new Map<string, { size: number; mtimeMs: number; sha256: string }>();

interface ActiveServer {
  key: string;
  modelId: string;
  mode: 'chat' | 'embedding';
  // llama-server answers /health at the root but serves the OpenAI-compatible
  // surface under /v1, and the two disagree: /embeddings returns a bare array of
  // per-token vectors while /v1/embeddings returns the OpenAI envelope callers
  // parse. Deriving the API URL once, here, is what keeps a caller that reaches a
  // running server from silently talking to the wrong one.
  baseUrl: string;
  apiUrl: string;
  child: ChildProcess;
  slots: number;
  leases: number;
  stopWhenIdle: boolean;
  idleWaiters: Set<() => void>;
}

let activeServer: ActiveServer | null = null;
let lifecycleTail: Promise<void> = Promise.resolve();
const safeSlotsByModel = new Map<string, 1 | 2 | 4>();
const calibrationJobs = new Map<string, Promise<void>>();
let calibrationTail: Promise<void> = Promise.resolve();

async function serializeLifecycle<T>(task: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = lifecycleTail;
  lifecycleTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await task(); } finally { release(); }
}

function rootDirectory(): string {
  return path.join(app.getPath('userData'), 'local-ai');
}

function modelsDirectory(): string {
  return path.join(rootDirectory(), 'models');
}

function modelDirectory(modelId: string): string {
  return path.join(modelsDirectory(), getNodusLocalModel(modelId)?.assetFamily ?? modelId);
}

function downloadKey(modelId: string): string { return getNodusLocalModel(modelId)?.assetFamily ?? modelId; }

function runtimeDirectory(): string {
  return path.join(rootDirectory(), 'runtime', LLAMA_CPP_VERSION);
}

/**
 * Where a candidate archive is extracted before it replaces the installed
 * runtime. A sibling of the runtime directory, never inside it, so a half-extracted
 * upgrade can neither be found by `llamaServerPath()` nor destroy the working
 * install it is replacing.
 */
function runtimeStagingDirectory(): string {
  return path.join(rootDirectory(), 'runtime', `.staging-${LLAMA_CPP_VERSION}`);
}

function runtimeDescriptorPath(): string {
  return path.join(runtimeDirectory(), 'runtime.json');
}

function runtimeLogPath(): string {
  return path.join(rootDirectory(), 'runtime.log');
}

// ── Runtime diagnostics ──────────────────────────────────────────────────────
// Every backend decision is written here, in order, with the values that drove
// it. A user report ("it runs on the CPU") must be answerable from this file:
// which archive was installed, what the probe saw, which device llama.cpp used,
// how many layers were offloaded and which fallback fired.
const runtimeLogRing: string[] = [];

function runtimeLog(message: string): void {
  const line = `${new Date().toISOString()} [local-ai] ${message}`;
  runtimeLogRing.push(line);
  if (runtimeLogRing.length > 200) runtimeLogRing.shift();
  console.log(line);
  // Best-effort: diagnostics must never fail a download or a model start.
  void (async () => {
    try {
      await fsp.mkdir(rootDirectory(), { recursive: true });
      const stat = await fsp.stat(runtimeLogPath()).catch(() => null);
      if (stat && stat.size > 512 * 1024) await fsp.rm(runtimeLogPath(), { force: true });
      await fsp.appendFile(runtimeLogPath(), `${line}\n`, 'utf8');
    } catch { /* Diagnostics never own the operation they describe. */ }
  })();
}

export function readNodusLocalRuntimeLog(): string[] {
  return [...runtimeLogRing];
}

/** Cheap host signals used to avoid downloading a GPU build on a machine that has no graphics stack. */
function hostRuntimeSignals(): { platform: string; arch: string; vulkanLoader: boolean; renderNode: boolean } {
  const platform = process.platform;
  const arch = process.arch;
  let vulkanLoader = false;
  let renderNode = false;
  if (platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    vulkanLoader = fs.existsSync(path.join(systemRoot, 'System32', 'vulkan-1.dll'));
  } else if (platform === 'linux') {
    vulkanLoader = [
      '/usr/lib/x86_64-linux-gnu/libvulkan.so.1',
      '/usr/lib/aarch64-linux-gnu/libvulkan.so.1',
      '/usr/lib/libvulkan.so.1',
      '/usr/lib64/libvulkan.so.1',
      '/usr/lib/libvulkan.so',
    ].some((candidate) => fs.existsSync(candidate));
    try {
      renderNode = fs.existsSync('/dev/dri') && fs.readdirSync('/dev/dri').some((entry) => entry.startsWith('renderD'));
    } catch { renderNode = false; }
  }
  return { platform, arch, vulkanLoader, renderNode };
}

/** The build this machine should run, most capable candidate first. */
export function nodusLocalRuntimeCandidates(): NodusLocalRuntimeAsset[] {
  return runtimeAssetCandidates(hostRuntimeSignals());
}

interface RuntimeProbeResult {
  devices: NodusLocalRuntimeDevice[];
  nvidia: { detected: boolean; driver: string | null } | null;
  probedAt: string;
}

let cachedProbe: RuntimeProbeResult | null = null;
let cachedDescriptor: NodusLocalRuntimeDescriptor | null = null;
let cachedDescriptorRead = false;

function nvidiaSmiPath(): string | null {
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe')]
    : ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi', '/opt/cuda/bin/nvidia-smi'];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * Report whether an NVIDIA GPU/driver is present even when the runtime is a
 * Vulkan build, so the diagnostics can answer "was CUDA detected?" without ever
 * claiming CUDA is being used. Best-effort and cached; never fatal.
 */
async function probeNvidia(): Promise<{ detected: boolean; driver: string | null } | null> {
  const executable = nvidiaSmiPath();
  if (!executable) return null;
  try {
    const output = await runCapture(executable, ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'], 8_000);
    const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (!first) return { detected: false, driver: null };
    const [name, driver] = first.split(',').map((part) => part.trim());
    return { detected: Boolean(name), driver: driver ?? null };
  } catch {
    return { detected: false, driver: null };
  }
}

/** Spawn a short-lived helper and capture its combined output. */
function runCapture(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(() => {
      if (child.exitCode == null) child.kill('SIGKILL');
      finish(new Error(`${path.basename(command)} agotó el tiempo de espera.`));
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-32_000); });
    child.stderr?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-32_000); });
    child.on('error', (error) => finish(error));
    child.on('close', () => finish());
  });
}

/**
 * Ask the installed runtime what it can actually use.
 *
 * `--list-devices` needs no model and exits by itself, so it is the cheapest
 * honest answer to "does this build see a GPU on this machine?". A CPU-only
 * archive prints the header with no devices, which is why the probe — not the
 * archive name — decides whether a GPU build is kept.
 */
async function probeLlamaRuntime(executable: string): Promise<RuntimeProbeResult> {
  const started = Date.now();
  let devices: NodusLocalRuntimeDevice[] = [];
  try {
    const output = await runCapture(executable, ['--list-devices'], 30_000);
    devices = parseDeviceList(output);
    runtimeLog(`probe: ${path.basename(executable)} reported ${devices.length} device(s) in ${Date.now() - started} ms`
      + (devices.length ? `: ${devices.map((device) => `${device.backend}${device.index} ${device.name} (${device.totalMiB} MiB, ${device.freeMiB} MiB free)`).join('; ')}` : ' (CPU-only)')); 
  } catch (error) {
    runtimeLog(`probe: --list-devices failed for ${path.basename(executable)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const nvidia = await probeNvidia();
  if (nvidia) runtimeLog(`probe: NVIDIA driver check → detected=${nvidia.detected} driver=${nvidia.driver ?? 'unknown'}`);
  const result: RuntimeProbeResult = { devices, nvidia, probedAt: new Date().toISOString() };
  cachedProbe = result;
  return result;
}

async function readRuntimeDescriptor(): Promise<NodusLocalRuntimeDescriptor | null> {
  if (cachedDescriptorRead) return cachedDescriptor;
  cachedDescriptorRead = true;
  try {
    const parsed = JSON.parse(await fsp.readFile(runtimeDescriptorPath(), 'utf8')) as NodusLocalRuntimeDescriptor;
    cachedDescriptor = parsed?.version === 1 ? parsed : null;
  } catch {
    cachedDescriptor = null;
  }
  return cachedDescriptor;
}

async function writeRuntimeDescriptor(descriptor: NodusLocalRuntimeDescriptor): Promise<void> {
  cachedDescriptor = descriptor;
  cachedDescriptorRead = true;
  try {
    const temporary = `${runtimeDescriptorPath()}.tmp`;
    await fsp.writeFile(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
    await fsp.rename(temporary, runtimeDescriptorPath());
  } catch (error) {
    runtimeLog(`descriptor: could not be written: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Backend of whatever sits in the runtime directory right now (no download, no spawn). */
async function installedRuntimeBackend(): Promise<{ backend: NodusLocalRuntimeBackend; files: string[] }> {
  const files = await listRuntimeFiles(runtimeDirectory());
  return { backend: detectInstalledBackend(files), files };
}

async function listRuntimeFiles(directory: string): Promise<string[]> {
  const names: string[] = [];
  const walk = async (current: string) => {
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(current, entry.name));
      else names.push(entry.name);
    }
  };
  await walk(directory);
  return names;
}

async function findFile(directory: string, wanted: string): Promise<string | null> {
  const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === wanted) return target;
    if (entry.isDirectory()) {
      const nested = await findFile(target, wanted);
      if (nested) return nested;
    }
  }
  return null;
}

export async function llamaServerPath(): Promise<string | null> {
  return findFile(runtimeDirectory(), process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
}

async function modelStatus(model: NodusLocalModelDefinition) {
  const directory = modelDirectory(model.id);
  let downloadedBytes = 0;
  let downloaded = true;
  for (const asset of model.assets) {
    const stat = await fsp.stat(path.join(directory, asset.file)).catch(() => null);
    const partial = stat?.isFile() ? null : await fsp.stat(`${path.join(directory, asset.file)}.download`).catch(() => null);
    downloadedBytes += stat?.isFile()
      ? Math.min(stat.size, asset.bytes)
      : partial?.isFile() ? Math.min(partial.size, asset.bytes) : 0;
    if (!stat?.isFile() || stat.size !== asset.bytes) downloaded = false;
    else if (model.assetFamily && (!asset.sha256 || await sha256Path(path.join(directory, asset.file)) !== asset.sha256)) downloaded = false;
  }
  const active = activeDownloads.get(downloadKey(model.id));
  return {
    id: model.id,
    downloaded,
    downloadedBytes,
    totalBytes: nodusLocalModelBytes(model),
    path: directory,
    downloading: Boolean(active),
    progress: active?.progress ?? (downloaded ? 1 : 0),
  };
}

async function sha256Path(target: string): Promise<string> {
  const stat = await fsp.stat(target);
  const cached = verifiedAssetCache.get(target);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.sha256;
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(target)) hash.update(chunk as Buffer);
  const sha256 = hash.digest('hex');
  verifiedAssetCache.set(target, { size: stat.size, mtimeMs: stat.mtimeMs, sha256 });
  return sha256;
}

export async function verifyNodusLocalModel(modelId: string): Promise<boolean> {
  const model = getNodusLocalModel(modelId);
  if (!model) throw new Error(`Modelo local no soportado: ${modelId}`);
  for (const asset of model.assets) {
    const target = path.join(modelDirectory(model.id), asset.file);
    const stat = await fsp.stat(target).catch(() => null);
    if (!stat?.isFile() || stat.size !== asset.bytes || !asset.sha256) return false;
    if (await sha256Path(target) !== asset.sha256) return false;
  }
  return true;
}

export async function getNodusLocalAiStatus(): Promise<NodusLocalAiStatus> {
  const executablePath = await llamaServerPath();
  return {
    runtime: {
      version: LLAMA_CPP_VERSION,
      ready: Boolean(executablePath),
      executablePath,
      downloading: Boolean(activeRuntimeDownload),
      progress: activeRuntimeDownload?.progress ?? (executablePath ? 1 : 0),
      ...await runtimeDiagnostics(),
    },
    models: await Promise.all(NODUS_LOCAL_MODELS.map(modelStatus)),
    activeModelId: activeServer?.modelId ?? null,
    activeSlots: activeServer?.slots ?? 0,
    activeLeases: activeServer?.leases ?? 0,
    calibration: await calibrationStatus(),
  };
}

/**
 * What the Settings panel and the issue reports need: which build is installed,
 * which device the probe saw, how the last run offloaded its layers and why any
 * fallback fired. Everything here is read from cache or a directory listing —
 * asking for the status never spawns a process and never downloads anything.
 */
async function runtimeDiagnostics(): Promise<{
  asset: string | null;
  backend: NodusLocalRuntimeBackend | null;
  device: NodusLocalRuntimeDevice | null;
  nvidia: { detected: boolean; driver: string | null } | null;
  offload: NodusLocalOffloadStatus | null;
  fallbackReason: string | null;
  processedOnCpu: boolean;
  endpoint: string | null;
  logPath: string;
  logTail: string[];
}> {
  const descriptor = await readRuntimeDescriptor();
  const probedDevice = cachedProbe?.devices[0] ?? null;
  let backend: NodusLocalRuntimeBackend | null = descriptor?.backend ?? null;
  if (!backend && probedDevice) backend = inferBackendFromDevice(probedDevice);
  if (!backend) {
    const files = await listRuntimeFiles(runtimeDirectory());
    backend = files.length ? detectInstalledBackend(files) : null;
  }
  const device = descriptor?.device ?? probedDevice;
  const nvidia = descriptor?.nvidia ?? cachedProbe?.nvidia ?? null;
  const offload: NodusLocalOffloadStatus | null = lastOffload;
  return {
    asset: descriptor?.asset ?? null,
    backend,
    device,
    nvidia,
    offload,
    fallbackReason: descriptor?.fallbackReason ?? null,
    // A CPU answer must be explicit: no device, or every layer on the CPU.
    processedOnCpu: !device || (offload ? offload.layers === 0 : backend === 'cpu'),
    // The loopback endpoint of the running server, so a diagnostics report can
    // name the port in use instead of guessing (the CachyOS report asked whether
    // the failure was a port problem).
    endpoint: activeServer && activeServer.child.exitCode == null ? activeServer.baseUrl : null,
    logPath: runtimeLogPath(),
    logTail: readNodusLocalRuntimeLog().slice(-12),
  };
}

function inferBackendFromDevice(device: NodusLocalRuntimeDevice): NodusLocalRuntimeBackend {
  const backend = device.backend.toLowerCase();
  if (backend.startsWith('vulkan')) return 'vulkan';
  if (backend.startsWith('cuda')) return 'cuda';
  if (backend.startsWith('metal')) return 'metal';
  return 'cpu';
}

let lastOffload: NodusLocalOffloadStatus | null = null;

/** Harvest llama.cpp's own layer-placement report from a captured server log. */
function recordOffloadFromLog(log: string, options: { announce?: boolean } = {}): void {
  const decision = parseOffloadDecision(log);
  if (!decision) return;
  const changed = !lastOffload
    || lastOffload.layers !== decision.layers
    || lastOffload.totalLayers !== decision.totalLayers
    || lastOffload.deviceName !== decision.deviceName;
  // The runtime announces the layer placement in one line and the device it chose
  // in another; when the placement line arrives first, name the device from the
  // probe that already selected this build instead of reporting an unknown one.
  const probed = cachedProbe?.devices[0] ?? cachedDescriptor?.device ?? null;
  lastOffload = {
    layers: decision.layers,
    totalLayers: decision.totalLayers,
    deviceName: decision.deviceName ?? (probed ? `${probed.backend}${probed.index}` : null),
    projectedMiB: decision.projectedMiB,
    fitted: decision.fitted,
  };
  if (changed || options.announce) {
    runtimeLog(`offload: ${lastOffload.layers}/${lastOffload.totalLayers} layers on ${lastOffload.deviceName ?? 'unknown device'}`
      + `${decision.projectedMiB ? `, projected ${decision.projectedMiB} MiB` : ''}${decision.fitted ? ' (fitted to device memory)' : ''}`);
  }
}

/**
 * Concurrency health for the Settings panel: whether this machine+hardware+runtime
 * has a measured calibration at all, the best slot count it admitted, and the last
 * recorded reason. Unmeasured means the conservative single slot is in force.
 */
/**
 * Keep the startup lines that state what the runtime did with the device in the
 * diagnostics log. The parsed summary above is compact; these are the raw
 * sentences a bug report can quote, and they exist only in the child's output.
 */
function recordServerStartupDetails(log: string): void {
  const relevant = log.split(/\r?\n/)
    .filter((line) => /using device|offloaded \d+\/\d+ layers|projected to use|fit params to|failed to allocate|cannot meet free memory target|context size set by user/.test(line))
    .slice(-8);
  for (const line of relevant) runtimeLog(`server: ${line.trim()}`);
}

async function calibrationStatus(): Promise<{ measured: boolean; slots: 1 | 2 | 4; reason: string | null }> {
  try {
    const file = JSON.parse(await fsp.readFile(path.join(rootDirectory(), 'calibration.json'), 'utf8')) as LocalCalibrationFile;
    if (file.version !== 1 || file.hardware !== hardwareFingerprint() || file.runtime !== LLAMA_CPP_VERSION) {
      return { measured: false, slots: 1, reason: null };
    }
    const entries = Object.values(file.models ?? {});
    if (!entries.length) return { measured: false, slots: 1, reason: null };
    const slots = entries.reduce<1 | 2 | 4>((best, entry) => (entry.slots > best ? entry.slots : best), 1);
    return { measured: true, slots, reason: entries[entries.length - 1]?.reason ?? null };
  } catch {
    return { measured: false, slots: 1, reason: null };
  }
}

function reportDownloadProgress(job: ActiveLocalAiDownload, fraction: number): void {
  job.progress = Math.max(0, Math.min(1, fraction));
  for (const listener of job.listeners) {
    try { listener(job.progress); } catch { /* Progress observers never own the transfer. */ }
  }
}

function followDownload(
  job: ActiveLocalAiDownload,
  onProgress?: (fraction: number) => void
): Promise<NodusLocalAiStatus> {
  if (!onProgress) return job.promise;
  job.listeners.add(onProgress);
  onProgress(job.progress);
  return job.promise.finally(() => job.listeners.delete(onProgress));
}

function downloadCancelledError(): Error {
  const error = new Error('Descarga cancelada.');
  error.name = 'AbortError';
  return error;
}

function throwIfDownloadCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw downloadCancelledError();
}

async function downloadFile(
  url: string,
  target: string,
  expectedBytes: number | undefined,
  expectedSha256: string | undefined,
  onBytes: (bytes: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const qaProxy = process.env.NODUS_LOCAL_AI_QA_ASSET_PROXY;
  if (qaProxy) {
    const root = process.env.NODUS_ISOLATED_ROOT;
    if (!root || !path.isAbsolute(root)) throw new Error('El proxy de recursos exige un perfil aislado.');
    const canonical = fs.realpathSync(root);
    const marker = JSON.parse(fs.readFileSync(path.join(canonical, 'isolation.json'), 'utf8'));
    const base = new URL(qaProxy);
    if (marker.root !== canonical || marker.format !== 'nodus.isolated-research-profile/1'
      || !app.getPath('userData').startsWith(canonical + path.sep)
      || base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || Number(base.port) < 1024
      || base.username || base.password || base.search || base.hash || !/^\/[a-f0-9-]{36}$/.test(base.pathname)) throw new Error('Proxy de recursos QA inválido.');
    url = `${base.href}/asset?url=${encodeURIComponent(url)}`;
  }
  throwIfDownloadCancelled(signal);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const completed = await fsp.stat(target).catch(() => null);
  if (completed?.isFile() && (!expectedBytes || completed.size === expectedBytes)) {
    if (!expectedSha256 || await sha256Path(target) === expectedSha256) {
      onBytes(completed.size);
      return;
    }
    await fsp.rm(target, { force: true });
  }
  const partial = `${target}.download`;
  let resumedBytes = (await fsp.stat(partial).catch(() => null))?.size ?? 0;
  if (expectedBytes && resumedBytes > expectedBytes) {
    await fsp.rm(partial, { force: true });
    resumedBytes = 0;
  }
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal,
      headers: resumedBytes > 0 ? { Range: `bytes=${resumedBytes}-` } : undefined,
    });
  } catch (error) {
    if (signal?.aborted) throw downloadCancelledError();
    throw error;
  }
  if (response.status === 416 && expectedBytes && resumedBytes === expectedBytes) {
    const digest = await sha256Path(partial);
    if (!expectedSha256 || digest === expectedSha256) {
      await fsp.rename(partial, target);
      return;
    }
    await fsp.rm(partial, { force: true });
    throw new Error('La verificación SHA-256 del archivo reanudado ha fallado.');
  }
  if (!response.ok || !response.body) throw new Error(`Descarga HTTP ${response.status}: ${url}`);
  const resumed = resumedBytes > 0 && response.status === 206;
  if (!resumed && resumedBytes > 0) {
    await fsp.rm(partial, { force: true });
    resumedBytes = 0;
  }
  const file = fs.createWriteStream(partial, { flags: resumed ? 'a' : 'wx' });
  const hash = createHash('sha256');
  let received = resumedBytes;
  try {
    if (resumedBytes > 0) {
      for await (const chunk of fs.createReadStream(partial)) hash.update(chunk as Buffer);
      onBytes(resumedBytes);
    }
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.length;
      hash.update(chunk);
      if (!file.write(chunk)) await new Promise<void>((resolve) => file.once('drain', resolve));
      onBytes(chunk.length);
    }
    await new Promise<void>((resolve, reject) => file.end((error?: Error | null) => error ? reject(error) : resolve()));
  } catch (error) {
    file.destroy();
    // Preserve a bounded partial file. A later request resumes it with HTTP Range;
    // checksum verification still guards against a corrupt server response.
    if (signal?.aborted) throw downloadCancelledError();
    throw error;
  }
  throwIfDownloadCancelled(signal);
  if (expectedBytes && received !== expectedBytes) {
    if (received > expectedBytes) await fsp.rm(partial, { force: true });
    throw new Error(`Descarga incompleta: se esperaban ${expectedBytes} bytes y se recibieron ${received}.`);
  }
  const digest = hash.digest('hex');
  if (expectedSha256 && digest !== expectedSha256) {
    await fsp.rm(partial, { force: true });
    throw new Error('La verificación SHA-256 del archivo descargado ha fallado.');
  }
  await fsp.rename(partial, target);
}

function run(command: string, args: string[], cwd?: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(downloadCancelledError());
      return;
    }
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      if (child.exitCode == null) child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr?.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-8_000); });
    child.on('error', (error) => finish(signal?.aborted ? downloadCancelledError() : error));
    child.on('close', (code) => {
      if (signal?.aborted) finish(downloadCancelledError());
      else if (code === 0) finish();
      else finish(new Error(stderr || `${command} terminó con código ${code}.`));
    });
  });
}

async function extractRuntimeArchive(asset: NodusLocalRuntimeAsset, archive: string, root: string, signal?: AbortSignal): Promise<string> {
  await fsp.mkdir(root, { recursive: true });
  if (asset.archive === 'zip') {
    new AdmZip(archive).extractAllTo(root, true);
    throwIfDownloadCancelled(signal);
  } else {
    await run('tar', ['-xzf', archive, '-C', root], undefined, signal);
  }
  const executable = await findFile(root, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
  if (!executable) throw new Error('El runtime se descargó, pero no contiene llama-server.');
  if (process.platform !== 'win32') await fsp.chmod(executable, 0o755);
  return executable;
}

export interface NodusLocalRuntimeInstallOptions {
  /** Reinstall even when the installed build already matches this machine. */
  force?: boolean;
}

/**
 * Install the llama.cpp build this machine can actually accelerate with.
 *
 * The candidate list is ordered most-capable-first (see `runtimeAssetCandidates`)
 * and every GPU build is *verified by running it*: a build that cannot see a
 * device is discarded and the next candidate — ultimately the CPU archive — is
 * installed instead, with the reason persisted for the Settings panel. This is
 * what keeps a GPU-less Windows or Linux box working while giving a machine with
 * a Vulkan-capable driver the accelerated runtime it used to never get.
 */
export async function installNodusLocalRuntime(
  onProgress?: (fraction: number) => void,
  options: NodusLocalRuntimeInstallOptions = {},
): Promise<NodusLocalAiStatus> {
  if (activeRuntimeDownload) return followDownload(activeRuntimeDownload, onProgress);
  const candidates = nodusLocalRuntimeCandidates();
  if (!candidates.length) {
    throw new Error(`llama.cpp no ofrece un runtime integrado para ${process.platform}-${process.arch}.`);
  }
  const existing = await llamaServerPath();
  if (existing && !options.force) {
    const descriptor = await readRuntimeDescriptor();
    const { backend } = await installedRuntimeBackend();
    const desired = candidates[0];
    const replace = shouldReplaceInstalledRuntime({
      installedBackend: backend,
      installedAsset: descriptor?.asset ?? null,
      desired,
      installedBackendUsable: true,
    });
    if (!replace) {
      runtimeLog(`install: keeping installed runtime (backend=${backend}, asset=${descriptor?.asset ?? 'legacy install'})`);
      if (!cachedProbe) await probeLlamaRuntime(existing);
      return getNodusLocalAiStatus();
    }
    runtimeLog(`install: replacing runtime (installed backend=${backend}, asset=${descriptor?.asset ?? 'legacy install'}) with ${desired.name}`);
  }

  const job: ActiveLocalAiDownload = {
    progress: 0,
    promise: null as unknown as Promise<NodusLocalAiStatus>,
    listeners: new Set(),
    controller: new AbortController(),
  };
  activeRuntimeDownload = job;
  job.promise = (async () => {
    const root = runtimeDirectory();
    const staging = runtimeStagingDirectory();
    let installed: string | null = null;
    // Why a GPU candidate was passed over, in the words Settings shows the user. Set
    // whenever one is skipped or fails, so the CPU engine is never installed silently.
    let fallbackReason: string | null = null;
    const failures: string[] = [];
    try {
      await fsp.rm(staging, { recursive: true, force: true });
      await fsp.mkdir(rootDirectory(), { recursive: true });
      for (const [index, asset] of candidates.entries()) {
        throwIfDownloadCancelled(job.controller.signal);
        const archive = path.join(rootDirectory(), asset.name);
        const base = index / candidates.length;
        const span = 1 / candidates.length;
        let executable: string | null = null;
        try {
          runtimeLog(`install: candidate ${index + 1}/${candidates.length} ${asset.name} (${asset.backend}, ${asset.bytes} bytes)`);
          let downloaded = 0;
          await downloadFile(asset.url, archive, asset.bytes, asset.sha256, (bytes) => {
            downloaded += bytes;
            reportDownloadProgress(job, Math.min(0.9 * span, (downloaded / asset.bytes) * 0.9 * span) + base);
          }, job.controller.signal);
          throwIfDownloadCancelled(job.controller.signal);
          runtimeLog(`install: verified SHA-256 for ${asset.name}`);
          // Extract and probe in the staging directory: the installed runtime keeps
          // working until a candidate has proven it can see a device.
          await fsp.rm(staging, { recursive: true, force: true });
          executable = await extractRuntimeArchive(asset, archive, staging, job.controller.signal);
          if (asset.backend !== 'cpu') {
            const probe = await probeLlamaRuntime(executable);
            throwIfDownloadCancelled(job.controller.signal);
            if (!probe.devices.length) {
              failures.push(`${asset.name}: sin dispositivos utilizables`);
              fallbackReason = `el motor con GPU (${asset.backend}) no encontró ningún dispositivo utilizable`;
              runtimeLog(`install: ${asset.name} found no usable device; falling back`);
              await fsp.rm(staging, { recursive: true, force: true });
              continue;
            }
          }
          await fsp.rm(root, { recursive: true, force: true });
          await fsp.rename(staging, root);
          await writeRuntimeDescriptor({
            version: 1,
            llamaCppVersion: LLAMA_CPP_VERSION,
            asset: asset.name,
            backend: asset.backend,
            device: cachedProbe?.devices[0] ?? null,
            nvidia: cachedProbe?.nvidia ?? null,
            probedAt: cachedProbe?.probedAt ?? null,
            fallbackReason: fallbackReason ?? null,
          });
          installed = asset.name;
        } catch (error) {
          if (job.controller.signal.aborted) throw error;
          failures.push(`${asset.name}: ${error instanceof Error ? error.message : String(error)}`);
          if (asset.backend !== 'cpu') {
            fallbackReason = `el motor con GPU (${asset.backend}) no se pudo preparar: ${error instanceof Error ? error.message : String(error)}`;
          }
          runtimeLog(`install: ${asset.name} failed: ${error instanceof Error ? error.message : String(error)}`);
          await fsp.rm(staging, { recursive: true, force: true });
          continue;
        } finally {
          await fsp.rm(archive, { force: true }).catch(() => undefined);
        }
        if (installed) {
          runtimeLog(`install: ${asset.name} installed and verified`);
          break;
        }
      }
      if (!installed) {
        throw new Error(`No se pudo instalar un runtime de llama.cpp utilizable. ${failures.join(' | ')}`);
      }
      reportDownloadProgress(job, 1);
      return getNodusLocalAiStatus();
    } finally {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      if (job.controller.signal.aborted && !installed) {
        // A cancelled upgrade must not leave the machine without the runtime it had.
        runtimeLog('install: cancelled before a candidate was verified; the previous runtime is untouched');
      }
    }
  })().finally(() => {
    if (activeRuntimeDownload === job) activeRuntimeDownload = null;
  }).then(() => getNodusLocalAiStatus());
  return followDownload(job, onProgress);
}

/**
 * Settings action: probe the installed runtime again and reinstall when this
 * machine's best build changed (a GPU driver appearing after the CPU fallback was
 * chosen, or a newer runtime after an app update). Never triggers a download by
 * merely opening Settings.
 */
export async function recheckNodusLocalRuntime(): Promise<NodusLocalAiStatus> {
  cachedProbe = null;
  const executable = await llamaServerPath();
  const probe = executable ? await probeLlamaRuntime(executable) : null;
  const candidates = nodusLocalRuntimeCandidates();
  const descriptor = await readRuntimeDescriptor();
  const { backend } = await installedRuntimeBackend();
  const desired = candidates[0];
  if (!desired) return getNodusLocalAiStatus();
  if (backend !== desired.backend) {
    runtimeLog(`recheck: installed backend=${backend} differs from best available backend=${desired.backend}; reinstalling ${desired.name}`);
    return installNodusLocalRuntime(undefined, { force: true });
  }
  if (descriptor?.fallbackReason) {
    await writeRuntimeDescriptor({ ...descriptor, fallbackReason: null, device: probe?.devices[0] ?? descriptor.device });
  }
  runtimeLog(`recheck: runtime backend=${backend} is the best available for this machine`);
  return getNodusLocalAiStatus();
}

/** Explicit "measure concurrency" action; automatic benchmarking is gone (issue #851). */
export async function calibrateNodusLocalRuntimeConcurrency(modelId: string): Promise<NodusLocalAiStatus> {
  await calibrateNodusLocalModelConcurrency(modelId, true);
  return getNodusLocalAiStatus();
}

async function downloadModelAssets(
  model: NodusLocalModelDefinition,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<NodusLocalAiStatus> {
  const directory = modelDirectory(model.id);
  const total = nodusLocalModelBytes(model);
  let completed = 0;
  await fsp.mkdir(directory, { recursive: true });
  for (const asset of model.assets) {
    throwIfDownloadCancelled(signal);
    const target = path.join(directory, asset.file);
    const stat = await fsp.stat(target).catch(() => null);
    if (stat?.isFile() && stat.size === asset.bytes && asset.sha256 && await sha256Path(target) === asset.sha256) {
      completed += asset.bytes;
      onProgress?.(completed / total);
      continue;
    }
    let current = 0;
    await downloadFile(asset.url, target, asset.bytes, asset.sha256, (bytes) => {
      current += bytes;
      onProgress?.(Math.min(0.999, (completed + current) / total));
    }, signal);
    completed += asset.bytes;
  }
  throwIfDownloadCancelled(signal);
  onProgress?.(1);
  return getNodusLocalAiStatus();
}

export async function downloadNodusLocalModel(
  modelId: string,
  onProgress?: (fraction: number) => void
): Promise<NodusLocalAiStatus> {
  const model = getNodusLocalModel(modelId);
  if (!model) throw new Error(`Modelo local no soportado: ${modelId}`);
  const family = downloadKey(modelId);
  const running = activeDownloads.get(family);
  if (running) return followDownload(running, onProgress);
  const job: ActiveLocalAiDownload = {
    progress: 0,
    promise: null as unknown as Promise<NodusLocalAiStatus>,
    listeners: new Set(),
    controller: new AbortController(),
  };
  activeDownloads.set(family, job);
  job.promise = (async () => {
    // The runtime is a dependency of every llama.cpp model: install it first, and
    // let the installer decide whether the installed build still fits this machine
    // (an old CPU-only install on a GPU box is replaced here, not left in place).
    if (model.runtime === 'llama_cpp') {
      await installNodusLocalRuntime((fraction) => reportDownloadProgress(job, fraction * 0.2));
      throwIfDownloadCancelled(job.controller.signal);
      return downloadModelAssets(model, (fraction) => reportDownloadProgress(job, 0.2 + fraction * 0.8), job.controller.signal);
    }
    return downloadModelAssets(model, (fraction) => reportDownloadProgress(job, fraction), job.controller.signal);
  })().finally(() => {
    if (activeDownloads.get(family) === job) activeDownloads.delete(family);
  }).then(() => getNodusLocalAiStatus());
  return followDownload(job, onProgress);
}

export async function cancelNodusLocalDownloads(): Promise<NodusLocalAiStatus> {
  const modelJobs = [...activeDownloads.entries()];
  const runtimeJob = activeRuntimeDownload;
  for (const [, job] of modelJobs) job.controller.abort();
  runtimeJob?.controller.abort();
  await Promise.allSettled([
    ...modelJobs.map(([, job]) => job.promise),
    ...(runtimeJob ? [runtimeJob.promise] : []),
  ]);
  if (runtimeJob) {
    // Only the staging directory is discarded. The installed runtime and the
    // verified archive (with its `.download`) survive: an upgrade cancelled
    // halfway must not leave the machine without a working engine, and a later
    // install resumes the transfer and re-verifies SHA-256.
    await fsp.rm(runtimeStagingDirectory(), { recursive: true, force: true });
  }
  return getNodusLocalAiStatus();
}

export async function deleteNodusLocalModel(modelId: string): Promise<NodusLocalAiStatus> {
  const model = getNodusLocalModel(modelId);
  if (!model) throw new Error(`Modelo local no soportado: ${modelId}`);
  if (activeDownloads.has(downloadKey(modelId))) throw new Error('Espera a que termine la descarga antes de eliminar el modelo.');
  if (isEmbeddingGemma2(modelId)) {
    if (embeddingGemma2Busy()) throw new Error('EmbeddingGemma tiene solicitudes en curso.');
    closeEmbeddingGemma2Worker();
  }
  if (activeServer?.modelId === modelId && activeServer.leases > 0) {
    throw new Error('El modelo tiene solicitudes en curso. Espera a que terminen antes de eliminarlo.');
  }
  if (activeServer?.modelId === modelId) stopNodusLocalServer();
  embeddingPipelines.delete(modelId);
  for (const asset of model.assets) verifiedAssetCache.delete(path.join(modelDirectory(modelId), asset.file));
  await fsp.rm(modelDirectory(modelId), { recursive: true, force: true });
  return getNodusLocalAiStatus();
}

export function listNodusLocalChatModels(): ModelInfo[] {
  return NODUS_LOCAL_MODELS.filter((model) => model.kind === 'chat').map((model) => ({
    id: model.id,
    name: model.label,
    sizeBytes: nodusLocalModelBytes(model),
    quantization: model.quantization,
    contextLength: model.contextLength,
    kind: model.vision ? 'vlm' : 'llm',
    vision: model.vision === true,
  }));
}

export function listNodusLocalEmbeddingModels(): ModelInfo[] {
  return NODUS_LOCAL_MODELS.filter((model) => model.kind === 'embedding').map((model) => ({
    id: model.id,
    name: model.label,
    sizeBytes: nodusLocalModelBytes(model),
    quantization: model.quantization,
    contextLength: model.contextLength,
    kind: 'embeddings',
    vision: false,
  }));
}

export async function freePort(): Promise<number> {
  if (process.env.NODUS_LOCAL_AI_QA_PORT) {
    const port = Number(process.env.NODUS_LOCAL_AI_QA_PORT);
    if (!process.env.NODUS_ISOLATED_ROOT || !Number.isInteger(port) || port < 1024 || port > 65535 || port === 23119) throw new Error('Puerto de runtime QA inválido.');
    return port;
  }
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

/**
 * Wait until llama-server answers /health, bounded twice.
 *
 * The per-request deadline matters: a process that accepts the connection and
 * then never answers (a security product holding the binary, a backend wedged in
 * a driver call) used to leave `fetch` pending forever, so the outer deadline was
 * never re-checked and the caller hung with no diagnostic. The whole-startup
 * deadline scales with the model size, because loading 3 GB of weights on a CPU
 * fallback legitimately takes longer than loading 500 MB of them.
 */
async function waitForServer(baseUrl: string, child: ChildProcess, logs: () => string, modelBytes = 0): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(120_000, Math.min(600_000, Math.round(modelBytes / 10_000_000) * 1_000));
  while (Date.now() < deadline) {
    if (child.exitCode != null || child.signalCode != null) {
      const failure = classifyStartupFailure({ exitCode: child.exitCode, signal: child.signalCode, log: logs(), elapsedMs: Date.now() - startedAt });
      throw new Error(describeStartupFailure(failure, logs(), child.exitCode, child.signalCode));
    }
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
    } catch {
      // Model loading can take several seconds; keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const failure = classifyStartupFailure({ log: logs(), elapsedMs: Date.now() - startedAt });
  throw new Error(`llama-server no estuvo listo a tiempo. ${describeStartupFailure(failure, logs(), null, null)}`);
}

/** Turn a classified startup failure into an error a user can act on. */
function describeStartupFailure(
  failure: ReturnType<typeof classifyStartupFailure>,
  log: string,
  exitCode: number | null,
  signal: string | null,
): string {
  const tail = log.trim().slice(-1_200);
  const where = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  switch (failure.kind) {
    case 'blocked-by-security-software':
      return `El sistema de seguridad de ${where} bloqueó llama-server (${failure.detail}). Añade la carpeta del motor local a las exclusiones del antivirus y vuelve a intentarlo. ${tail}`;
    case 'exited-without-output':
      return `llama-server terminó sin escribir nada (código ${exitCode ?? 'desconocido'}${signal ? `, señal ${signal}` : ''}). Suele ser un antivirus o una política de ejecución bloqueando el binario; revisa las exclusiones de la carpeta del motor local. ${tail}`;
    case 'out-of-memory':
      return `llama-server no pudo reservar memoria para el modelo y los layers solicitados. ${tail}`;
    case 'missing-system-library':
      return `llama-server no pudo cargar una biblioteca del sistema. ${tail}`;
    case 'no-usable-device':
      return `llama-server no encontró un dispositivo utilizable. ${tail}`;
    default:
      return tail || `llama-server terminó con código ${exitCode ?? 'desconocido'}${signal ? ` (señal ${signal})` : ''}.`;
  }
}

export function stopNodusLocalServer(): void {
  const current = activeServer;
  if (current?.leases) {
    current.stopWhenIdle = true;
    return;
  }
  activeServer = null;
  if (current && current.child.exitCode == null) current.child.kill('SIGTERM');
}

/** Process-shutdown backstop. Normal model switches must use leases above. */
export function killNodusLocalServerSync(): void {
  const current = activeServer;
  activeServer = null;
  if (!current) return;
  current.stopWhenIdle = false;
  for (const resolve of current.idleWaiters) resolve();
  current.idleWaiters.clear();
  if (current.child.exitCode == null) current.child.kill('SIGKILL');
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode != null) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    child.once('exit', onExit);
  });
}

async function stopNodusLocalServerAndWait(server = activeServer): Promise<void> {
  if (!server) return;
  if (activeServer === server) activeServer = null;
  server.stopWhenIdle = false;
  for (const resolve of server.idleWaiters) resolve();
  server.idleWaiters.clear();
  if (server.child.exitCode != null) return;
  server.child.kill('SIGTERM');
  if (await waitForChildExit(server.child, 10_000)) return;
  server.child.kill('SIGKILL');
  await waitForChildExit(server.child, 2_000);
}

interface LocalCalibrationFile {
  version: 1;
  hardware: string;
  runtime: string;
  models: Record<string, { slots: 1 | 2 | 4; measuredAt: string; throughputGain: number; p95Change: number; safe: boolean; reason?: string }>;
}

function hardwareFingerprint(): string {
  return createHash('sha256')
    .update([process.platform, process.arch, os.cpus()[0]?.model ?? 'cpu', os.totalmem(), LLAMA_CPP_VERSION].join('|'))
    .digest('hex').slice(0, 20);
}

async function calibratedSlots(modelId: string): Promise<1 | 2 | 4> {
  try {
    const file = JSON.parse(await fsp.readFile(path.join(rootDirectory(), 'calibration.json'), 'utf8')) as LocalCalibrationFile;
    const calibration = file.version === 1 && file.hardware === hardwareFingerprint() && file.runtime === LLAMA_CPP_VERSION
      ? file.models?.[modelId]
      : null;
    if (calibration?.safe && calibration.throughputGain >= 0.15 && calibration.p95Change <= 0.1
      && (calibration.slots === 2 || calibration.slots === 4)) {
      safeSlotsByModel.set(modelId, calibration.slots);
      return calibration.slots;
    }
  } catch { /* Missing/stale calibration intentionally falls back to one full-context slot. */ }
  safeSlotsByModel.set(modelId, 1);
  return 1;
}

export function getNodusLocalSafeSlots(modelId: string): 1 | 2 | 4 {
  return safeSlotsByModel.get(modelId) ?? 1;
}

export async function recordNodusLocalCalibration(input: {
  modelId: string;
  slots: 1 | 2 | 4;
  throughputGain: number;
  p95Change: number;
  memorySafe: boolean;
  reason?: string;
}): Promise<void> {
  const model = getNodusLocalModel(input.modelId);
  if (!model || model.runtime !== 'llama_cpp') throw new Error('Modelo local no calibrable.');
  const safe = input.memorySafe
    && (input.slots === 1 || (input.throughputGain >= 0.15 && input.p95Change <= 0.1));
  const selected: 1 | 2 | 4 = safe ? input.slots : 1;
  const target = path.join(rootDirectory(), 'calibration.json');
  let existing: LocalCalibrationFile = {
    version: 1, hardware: hardwareFingerprint(), runtime: LLAMA_CPP_VERSION, models: {},
  };
  try {
    const parsed = JSON.parse(await fsp.readFile(target, 'utf8')) as LocalCalibrationFile;
    if (parsed.version === 1 && parsed.hardware === existing.hardware && parsed.runtime === existing.runtime) existing = parsed;
  } catch { /* Start a hardware-scoped calibration file. */ }
  existing.models[input.modelId] = {
    slots: selected,
    measuredAt: new Date().toISOString(),
    throughputGain: input.throughputGain,
    p95Change: input.p95Change,
    safe,
    reason: input.reason,
  };
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(existing, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(temporary, target);
  safeSlotsByModel.set(input.modelId, selected);
}

async function hasCurrentCalibration(modelId: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(rootDirectory(), 'calibration.json'), 'utf8')) as LocalCalibrationFile;
    return parsed.version === 1 && parsed.hardware === hardwareFingerprint()
      && parsed.runtime === LLAMA_CPP_VERSION && Boolean(parsed.models?.[modelId]);
  } catch { return false; }
}

function percentile95(values: number[]): number {
  if (!values.length) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

async function childRssBytes(child: ChildProcess): Promise<number> {
  const pid = child.pid;
  if (!pid) return 0;
  if (process.platform === 'linux') {
    const status = await fsp.readFile(`/proc/${pid}/status`, 'utf8').catch(() => '');
    const kib = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1]);
    return Number.isFinite(kib) ? kib * 1024 : 0;
  }
  if (process.platform === 'darwin') {
    return new Promise((resolve) => {
      const ps = spawn('ps', ['-o', 'rss=', '-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      ps.stdout?.on('data', (chunk) => { stdout += String(chunk); });
      ps.once('close', () => {
        const kib = Number(stdout.trim());
        resolve(Number.isFinite(kib) ? kib * 1024 : 0);
      });
      ps.once('error', () => resolve(0));
    });
  }
  return 0;
}

async function calibrationRequest(model: NodusLocalModelDefinition, apiUrl: string, index: number): Promise<void> {
  const endpoint = model.kind === 'embedding' ? 'embeddings' : 'chat/completions';
  const body = model.kind === 'embedding'
    ? { model: model.id, input: `Nodus concurrency calibration sentence ${index}: semantic indexing remains complete and ordered.` }
    : {
        model: model.id,
        temperature: 0,
        // Small reasoning-capable local models may spend the first ~100 tokens
        // internally. Keep the probe concise but leave enough output budget for
        // the requested health JSON, otherwise calibration measures truncation.
        max_tokens: 512,
        messages: [
          { role: 'system', content: 'This is an offline runtime health calibration. Return concise valid JSON only.' },
          { role: 'user', content: `${'Stable full-context calibration data. '.repeat(160)}\nReturn {"status":"ok","index":${index}}.` },
        ],
      };
  const response = await fetch(`${apiUrl}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Calibración local HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json() as any;
  if (model.kind === 'embedding') {
    const vector = payload?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || !vector.length || vector.some((value: unknown) => !Number.isFinite(value))) {
      throw new Error('El runtime devolvió un embedding inválido durante la calibración.');
    }
  } else if (!String(payload?.choices?.[0]?.message?.content ?? '').trim()) {
    throw new Error('El runtime devolvió una respuesta vacía durante la calibración.');
  }
}

async function benchmarkLocalSlots(
  model: NodusLocalModelDefinition,
  slots: 1 | 2 | 4,
): Promise<{ throughput: number; p95Ms: number; memorySafe: boolean }> {
  const mode = model.kind === 'embedding' ? 'embedding' : 'chat';
  for (;;) {
    const acquired = await serializeLifecycle(async () => {
      const current = activeServer;
      if (current?.leases) return { wait: new Promise<void>((resolve) => current.idleWaiters.add(resolve)) } as const;
      const apiUrl = await ensureNodusLocalServerUnlocked(model.id, mode, slots);
      const server = activeServer!;
      server.leases += 1;
      return { apiUrl, server } as const;
    });
    if ('wait' in acquired) {
      await acquired.wait;
      continue;
    }
    let minimumFree = os.freemem();
    let peakRss = 0;
    const sample = async () => {
      minimumFree = Math.min(minimumFree, os.freemem());
      peakRss = Math.max(peakRss, await childRssBytes(acquired.server.child));
    };
    const timer = setInterval(() => { void sample(); }, 100);
    timer.unref?.();
    try {
      const started = process.hrtime.bigint();
      const latencies: number[] = [];
      await Promise.all(Array.from({ length: 8 }, async (_, index) => {
        const requestStarted = process.hrtime.bigint();
        await calibrationRequest(model, acquired.apiUrl, index);
        latencies.push(Number(process.hrtime.bigint() - requestStarted) / 1_000_000);
      }));
      await sample();
      const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
      const memorySafe = acquired.server.child.exitCode == null
        && minimumFree >= os.totalmem() * 0.05
        && (peakRss === 0 || peakRss <= os.totalmem() * 0.7);
      return { throughput: 8 / elapsedSeconds, p95Ms: percentile95(latencies), memorySafe };
    } finally {
      clearInterval(timer);
      await serializeLifecycle(async () => {
        acquired.server.leases = Math.max(0, acquired.server.leases - 1);
        for (const resolve of acquired.server.idleWaiters) resolve();
        acquired.server.idleWaiters.clear();
        if (activeServer === acquired.server) await stopNodusLocalServerAndWait(acquired.server);
      });
    }
  }
}

/**
 * Offline, hardware-scoped calibration. Slots 2 and 4 are admitted only after a
 * full-context runtime starts, eight identical health jobs complete, throughput
 * improves by at least 15%, p95 regresses at most 10%, and memory remains safe.
 */
export function calibrateNodusLocalModelConcurrency(modelId: string, force = false): Promise<void> {
  const running = calibrationJobs.get(modelId);
  if (running) return running;
  const previous = calibrationTail;
  const job = (async () => {
    await previous;
    const model = getNodusLocalModel(modelId);
    if (!model || model.runtime !== 'llama_cpp') return;
    if (!force && await hasCurrentCalibration(modelId)) {
      await calibratedSlots(modelId);
      return;
    }
    if (!await verifyNodusLocalModel(modelId)) throw new Error('checksum-failed');
    const baseline = await benchmarkLocalSlots(model, 1);
    let selected: 1 | 2 | 4 = 1;
    let selectedGain = 0;
    let selectedP95Change = 0;
    let selectedMemorySafe = baseline.memorySafe;
    for (const slots of [2, 4] as const) {
      try {
        const candidate = await benchmarkLocalSlots(model, slots);
        const gain = candidate.throughput / baseline.throughput - 1;
        const p95Change = candidate.p95Ms / baseline.p95Ms - 1;
        if (!candidate.memorySafe || gain < 0.15 || p95Change > 0.1) break;
        selected = slots;
        selectedGain = gain;
        selectedP95Change = p95Change;
        selectedMemorySafe = true;
      } catch {
        break;
      }
    }
    await recordNodusLocalCalibration({
      modelId,
      slots: selected,
      throughputGain: selectedGain,
      p95Change: selectedP95Change,
      memorySafe: selectedMemorySafe,
      reason: !selectedMemorySafe ? 'memory-gate-failed'
        : selected === 1 ? 'safe-single-slot'
        : 'throughput-gate-passed',
    });
  })().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const reason = /checksum-failed/i.test(message) ? 'checksum-failed'
      : /HTTP\s+(\d+)/i.test(message) ? `runtime-http-${message.match(/HTTP\s+(\d+)/i)?.[1]}`
      : /embedding inválido/i.test(message) ? 'invalid-embedding'
      : /respuesta vacía/i.test(message) ? 'empty-response'
      : /timeout|timed out|aborted/i.test(message) ? 'timeout'
      : 'runtime-start-or-transport';
    await recordNodusLocalCalibration({
      modelId,
      slots: 1,
      throughputGain: 0,
      p95Change: 1,
      memorySafe: false,
      reason,
    }).catch(() => undefined);
    console.warn(`[local-ai] concurrency calibration failed for ${modelId}: ${reason}`);
    throw new Error(`La calibración local de «${modelId}» falló (${reason}); se mantendrá un único slot seguro.`);
  }).finally(() => calibrationJobs.delete(modelId));
  calibrationJobs.set(modelId, job);
  calibrationTail = job.catch(() => undefined);
  return job;
}

export async function readNodusLocalMetrics(): Promise<string | null> {
  const server = activeServer;
  if (!server || server.child.exitCode != null) return null;
  try {
    const response = await fetch(`${server.baseUrl}/metrics`);
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

async function ensureNodusLocalServerUnlocked(
  modelId: string,
  mode: 'chat' | 'embedding',
  slotsOverride?: 1 | 2 | 4,
): Promise<string> {
  const model = getNodusLocalModel(modelId);
  if (!model || model.runtime !== 'llama_cpp' || model.kind !== mode) {
    throw new Error(`El modelo «${modelId}» no puede ejecutarse como ${mode}.`);
  }
  const key = `${mode}:${modelId}`;
  if (activeServer?.key === key && activeServer.child.exitCode == null
    && (slotsOverride == null || activeServer.slots === slotsOverride)) return activeServer.apiUrl;
  await stopNodusLocalServerAndWait();
  const executable = await llamaServerPath();
  if (!executable) throw new Error('Instala primero el motor local de Nodus desde Ajustes → Modelos IA.');
  const status = await modelStatus(model);
  if (!status.downloaded) throw new Error(`Descarga primero «${model.label}» desde Ajustes → Modelos IA.`);
  if (!await verifyNodusLocalModel(model.id)) {
    throw new Error(`La verificación SHA-256 de «${model.label}» ha fallado. Bórralo y vuelve a descargarlo.`);
  }
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const slots = slotsOverride ?? await calibratedSlots(modelId);
  const contextPerSlot = Math.min(model.contextLength ?? 8192, 32_768);
  const args = [
    '--model', path.join(modelDirectory(model.id), model.modelFile),
    '--alias', model.id,
    '--host', '127.0.0.1',
    '--port', String(port),
    // llama.cpp shares n_ctx across slots. Reserve the complete supported window
    // for every calibrated slot instead of silently dividing 32k between them.
    '--ctx-size', String(contextPerSlot * slots),
    '--parallel', String(slots),
    '--threads', String(Math.max(1, Math.min(8, os.cpus().length - 1))),
    // llama-server's default verbosity (3) never prints where the layers went, so
    // "is this run using the GPU?" was unanswerable from its output. Level 4 adds
    // the model-loading lines we parse for the diagnostics — the placement report
    // and the fitter's projection — and nothing per-token.
    '-lv', '4',
    '--jinja',
    '--metrics',
    '--no-webui',
  ];
  if (process.platform === 'darwin') {
    // macOS archives are Metal-enabled and use unified memory: ask for every
    // layer, exactly as before. Never change this path for Apple Silicon.
    args.push('--n-gpu-layers', '999');
  } else {
    // Windows and Linux may run either a GPU build or the CPU archive, and the
    // VRAM budget is not ours to guess. llama.cpp's own fitter (`--fit`, on by
    // default and pinned with this runtime) measures the model plus the KV cache
    // against free device memory and places as many layers as fit; because
    // `--ctx-size` is set explicitly the context contract is never shrunk to make
    // room. A CPU-only runtime simply has no device to fit and runs as before.
    args.push('--fit', 'on');
  }
  if (model.projectorFile) args.push('--mmproj', path.join(modelDirectory(model.id), model.projectorFile));
  if (mode === 'embedding') {
    // llama.cpp's non-causal embedding path cannot split one input across
    // micro-batches. Its defaults (n_batch=2048, n_ubatch=512) are collapsed to
    // 512 by llama-server in embedding mode, which made BGE-M3 reject ordinary
    // 513-token passages despite its advertised 8k context.
    //
    // This is a per-input limit, so it is deliberately not multiplied by slots.
    // Keep logical and physical sizes equal, as encoder models require.
    args.push(
      '--batch-size', String(contextPerSlot),
      '--ubatch-size', String(contextPerSlot),
      '--embedding', '--pooling', 'mean',
    );
  }
  const installed = await installedRuntimeBackend();
  const device = (await readRuntimeDescriptor())?.device ?? cachedProbe?.devices[0] ?? null;
  runtimeLog(`server: starting ${model.id} (${mode}) slots=${slots} ctx=${contextPerSlot * slots} backend=${installed.backend}`
    + `${device ? ` device=${device.backend}${device.index} ${device.name} (${device.freeMiB}/${device.totalMiB} MiB free)` : ' device=none'}`);
  const child = spawn(executable, args, { cwd: path.dirname(executable), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const capture = (chunk: unknown) => {
    output = `${output}${String(chunk)}`.slice(-48_000);
    recordOffloadFromLog(output);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  let spawnError: Error | null = null;
  child.on('error', (error) => { spawnError = error; });
  const server: ActiveServer = {
    key, modelId, mode, baseUrl, apiUrl: `${baseUrl}/v1`, child,
    slots, leases: 0, stopWhenIdle: false, idleWaiters: new Set(),
  };
  activeServer = server;
  child.once('exit', () => {
    server.leases = 0;
    for (const resolve of server.idleWaiters) resolve();
    server.idleWaiters.clear();
    if (activeServer === server) activeServer = null;
  });
  try {
    await waitForServer(baseUrl, child, () => output, status.totalBytes ?? 0);
    recordOffloadFromLog(output, { announce: true });
    recordServerStartupDetails(output);
    return server.apiUrl;
  } catch (error) {
    if (activeServer === server) await stopNodusLocalServerAndWait(server);
    if (spawnError && !output.trim()) {
      const failure = classifyStartupFailure({
        spawnErrorCode: (spawnError as NodeJS.ErrnoException).code ?? null,
        log: output,
      });
      throw new Error(describeStartupFailure(failure, output, child.exitCode, child.signalCode));
    }
    if (slotsOverride == null && slots > 1) {
      runtimeLog(`server: ${model.id} failed with ${slots} slots; recording a single safe slot`);
      await recordNodusLocalCalibration({
        modelId,
        slots: 1,
        throughputGain: 0,
        p95Change: 1,
        memorySafe: false,
      });
      return ensureNodusLocalServerUnlocked(modelId, mode);
    }
    throw error;
  }
}

export async function ensureNodusLocalServer(modelId: string, mode: 'chat' | 'embedding'): Promise<string> {
  await calibrationTail;
  const key = `${mode}:${modelId}`;
  for (;;) {
    const outcome = await serializeLifecycle(async () => {
      const current = activeServer;
      if (current && current.key !== key && current.leases > 0) {
        return { wait: new Promise<void>((resolve) => current.idleWaiters.add(resolve)) } as const;
      }
      return { apiUrl: await ensureNodusLocalServerUnlocked(modelId, mode) } as const;
    });
    if ('apiUrl' in outcome && typeof outcome.apiUrl === 'string') return outcome.apiUrl;
    await outcome.wait;
  }
}

/** Hold the selected local runtime/model for the complete network request. */
export async function withNodusLocalServerLease<T>(
  modelId: string,
  mode: 'chat' | 'embedding',
  task: (apiUrl: string) => Promise<T>,
): Promise<T> {
  await calibrationTail;
  const key = `${mode}:${modelId}`;
  for (;;) {
    const acquired = await serializeLifecycle(async () => {
      const current = activeServer;
      if (current && current.key !== key && current.leases > 0) {
        return { wait: new Promise<void>((resolve) => current.idleWaiters.add(resolve)) } as const;
      }
      const apiUrl = await ensureNodusLocalServerUnlocked(modelId, mode);
      const server = activeServer!;
      server.leases += 1;
      return { server, apiUrl } as const;
    });
    if ('wait' in acquired) {
      await acquired.wait;
      continue;
    }
    try {
      return await task(acquired.apiUrl);
    } catch (error) {
      if (acquired.server.slots > 1 && (
        acquired.server.child.exitCode != null || /out of memory|oom|memory pressure|allocation failed/i.test(error instanceof Error ? error.message : String(error))
      )) {
        await recordNodusLocalCalibration({
          modelId,
          slots: 1,
          throughputGain: 0,
          p95Change: 1,
          memorySafe: false,
        });
        acquired.server.stopWhenIdle = true;
      }
      throw error;
    } finally {
      await serializeLifecycle(async () => {
        acquired.server.leases = Math.max(0, acquired.server.leases - 1);
        if (acquired.server.leases === 0) {
          for (const resolve of acquired.server.idleWaiters) resolve();
          acquired.server.idleWaiters.clear();
          if (acquired.server.stopWhenIdle && activeServer === acquired.server) stopNodusLocalServer();
        }
      });
    }
  }
}

async function transformersPipeline(model: NodusLocalModelDefinition): Promise<any> {
  let pending = embeddingPipelines.get(model.id);
  if (!pending) {
    pending = (async () => {
      const status = await modelStatus(model);
      if (!status.downloaded) throw new Error(`Descarga primero «${model.label}» desde Ajustes → Modelos IA.`);
      if (!await verifyNodusLocalModel(model.id)) throw new Error(`La verificación SHA-256 de «${model.label}» ha fallado.`);
      const { env, pipeline } = await import('@huggingface/transformers');
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      return pipeline('feature-extraction', modelDirectory(model.id), {
        dtype: 'int8',
        device: 'cpu',
        local_files_only: true,
      } as any);
    })();
    embeddingPipelines.set(model.id, pending);
  }
  return pending;
}

export async function embedWithNodusLocal(modelId: string, input: string | string[], signal?: AbortSignal, options: { role?: EmbeddingRole; title?: string; titles?: (string | undefined)[] } = {}): Promise<number[][]> {
  signal?.throwIfAborted();
  const model = getNodusLocalModel(modelId);
  if (!model || model.kind !== 'embedding') throw new Error(`Modelo de embeddings local no soportado: ${modelId}`);
  const texts = Array.isArray(input) ? input : [input];
  if (isEmbeddingGemma2(modelId)) {
    if (!await verifyNodusLocalModel(modelId)) throw new Error(`Descarga y verifica «${model.label}» desde Ajustes → Modelos IA.`);
    return embedEmbeddingGemma2(modelId, modelDirectory(modelId), texts, options, signal);
  }
  if (model.runtime === 'llama_cpp') {
    return withNodusLocalServerLease(modelId, 'embedding', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
        body: JSON.stringify({ model: modelId, input: texts }),
        signal,
      });
      if (!response.ok) throw new Error(`Embeddings locales HTTP ${response.status}: ${await response.text()}`);
      const body = await response.json() as { data?: Array<{ index?: number; embedding?: number[] }> };
      return (body.data ?? [])
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((entry) => entry.embedding ?? []);
    });
  }
  const extractor = await transformersPipeline(model);
  // A large padded CPU batch can exceed Electron's native allocator limit and
  // terminate the application before JavaScript can report the failure. Bound
  // dispatch without changing historical text, pooling or normalization.
  const values: number[][] = [];
  const tokenLengths = texts.map(text => extractor.tokenizer(text, { truncation: true, return_tensor: false }).input_ids.length as number);
  for (let offset = 0; offset < texts.length;) {
    signal?.throwIfAborted();
    let end = offset + 1, maximum = tokenLengths[offset];
    while (end < texts.length && end - offset < 8) {
      const nextMaximum = Math.max(maximum, tokenLengths[end]);
      if (nextMaximum * (end - offset + 1) > 2048) break;
      maximum = nextMaximum; end++;
    }
    const output = await extractor(texts.slice(offset, end), { pooling: 'mean', normalize: true });
    values.push(...output.tolist() as number[][]);
    offset = end;
  }
  signal?.throwIfAborted();
  return values;
}

// Several repository tests load the provider layer under a deliberately tiny
// Electron mock. The real Electron app always exposes EventEmitter methods, but
// guarding registration keeps the local-model module import-safe in workers and
// test harnesses that do not own the application lifecycle.
if (typeof app.once === 'function') app.once('before-quit', () => { stopNodusLocalServer(); closeEmbeddingGemma2Worker(); });
