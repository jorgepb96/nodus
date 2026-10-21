import { fetchModelResource, modelResourceError } from '../network/modelResource';
import type { ChatImageAspectRatio } from '@shared/chatSkills';
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  NODUS_LOCAL_IMAGE_MODEL,
  getNodusImageQualityPreset,
  nodusLocalImageModelBytes,
  type NodusImageQuality,
  type NodusLocalImageStatus,
} from '@shared/localImageModels';

const STABLE_DIFFUSION_CPP_VERSION = 'master-782-b290693';

interface RuntimeAsset {
  name: string;
  url: string;
  sha256: string;
  bytes: number;
}

interface ActiveDownload {
  progress: number;
  promise: Promise<NodusLocalImageStatus>;
  listeners: Set<(fraction: number) => void>;
}

let activeRuntimeDownload: ActiveDownload | null = null;
let activeModelDownload: ActiveDownload | null = null;
let activeGenerations = 0;
let generationTail: Promise<void> = Promise.resolve();

function rootDirectory(): string {
  return path.join(app.getPath('userData'), 'local-image-ai');
}

function runtimeDirectory(): string {
  return path.join(rootDirectory(), 'runtime', STABLE_DIFFUSION_CPP_VERSION);
}

function modelDirectory(): string {
  return path.join(rootDirectory(), 'models', NODUS_LOCAL_IMAGE_MODEL.id);
}

function runtimeAsset(): RuntimeAsset {
  const base = `https://github.com/leejet/stable-diffusion.cpp/releases/download/${STABLE_DIFFUSION_CPP_VERSION}`;
  const assets: Record<string, Omit<RuntimeAsset, 'url'>> = {
    'darwin-arm64': {
      name: 'sd-master-b290693-bin-Darwin-macOS-26.4-arm64.zip',
      sha256: '61620d31fa787d318ca1ec67ba73ef77b3236bc3a2dc891d66c161c7b075e45c',
      bytes: 49_381_624,
    },
    'linux-x64': {
      name: 'sd-master-b290693-bin-Linux-Ubuntu-24.04-x86_64.zip',
      sha256: '16547f8ffb35547f9058e2ea831a2eb36cfcb99594043fc97ad2895c6c485aaf',
      bytes: 32_351_865,
    },
    'win32-x64': {
      name: 'sd-master-b290693-bin-win-cpu-x64.zip',
      sha256: '38da3539d3af6918f4c218fd198ac6e26cd71249e54feb3a491d184d3ca94ea0',
      bytes: 23_752_890,
    },
  };
  const key = `${process.platform}-${process.arch}`;
  const asset = assets[key];
  if (!asset) throw new Error(`stable-diffusion.cpp no ofrece un runtime integrado para ${key}.`);
  return { ...asset, url: `${base}/${asset.name}` };
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

async function sdCliPath(): Promise<string | null> {
  return findFile(runtimeDirectory(), process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli');
}

async function modelStatus(): Promise<NodusLocalImageStatus['model']> {
  const directory = modelDirectory();
  let downloadedBytes = 0;
  let downloaded = true;
  for (const asset of NODUS_LOCAL_IMAGE_MODEL.assets) {
    const target = path.join(directory, asset.file);
    const stat = await fsp.stat(target).catch(() => null);
    const partial = stat?.isFile() ? null : await fsp.stat(`${target}.download`).catch(() => null);
    downloadedBytes += stat?.isFile()
      ? Math.min(stat.size, asset.bytes)
      : partial?.isFile() ? Math.min(partial.size, asset.bytes) : 0;
    if (!stat?.isFile() || stat.size !== asset.bytes) downloaded = false;
  }
  return {
    id: NODUS_LOCAL_IMAGE_MODEL.id,
    downloaded,
    downloadedBytes,
    totalBytes: nodusLocalImageModelBytes(),
    path: directory,
    downloading: Boolean(activeModelDownload),
    progress: activeModelDownload?.progress ?? (downloaded ? 1 : 0),
  };
}

export async function getNodusLocalImageStatus(): Promise<NodusLocalImageStatus> {
  const executablePath = await sdCliPath();
  return {
    runtime: {
      version: STABLE_DIFFUSION_CPP_VERSION,
      ready: Boolean(executablePath),
      executablePath,
      downloading: Boolean(activeRuntimeDownload),
      progress: activeRuntimeDownload?.progress ?? (executablePath ? 1 : 0),
    },
    model: await modelStatus(),
    generating: activeGenerations > 0,
  };
}

function reportProgress(job: ActiveDownload, fraction: number): void {
  job.progress = Math.max(0, Math.min(1, fraction));
  for (const listener of job.listeners) {
    try { listener(job.progress); } catch { /* An observer never owns the download. */ }
  }
}

function followDownload(job: ActiveDownload, onProgress?: (fraction: number) => void): Promise<NodusLocalImageStatus> {
  if (!onProgress) return job.promise;
  job.listeners.add(onProgress);
  onProgress(job.progress);
  return job.promise.finally(() => job.listeners.delete(onProgress));
}

async function downloadFile(
  url: string,
  target: string,
  expectedBytes: number,
  expectedSha256: string | undefined,
  onBytes: (bytes: number) => void
): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.download`;
  await fsp.rm(partial, { force: true });
  const response = await fetchModelResource(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Descarga HTTP ${response.status}: ${new URL(url).hostname}`);
  const file = fs.createWriteStream(partial, { flags: 'wx' });
  const hash = createHash('sha256');
  let received = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read().catch(cause => { throw modelResourceError(url, cause); });
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
    await fsp.rm(partial, { force: true });
    throw error;
  }
  if (received !== expectedBytes) {
    await fsp.rm(partial, { force: true });
    throw new Error(`Descarga incompleta: se esperaban ${expectedBytes} bytes y se recibieron ${received}.`);
  }
  const digest = hash.digest('hex');
  if (expectedSha256 && digest !== expectedSha256) {
    await fsp.rm(partial, { force: true });
    throw new Error('La verificación SHA-256 del archivo descargado ha fallado.');
  }
  await fsp.rename(partial, target);
}

export async function installNodusLocalImageRuntime(
  onProgress?: (fraction: number) => void
): Promise<NodusLocalImageStatus> {
  if (await sdCliPath()) return getNodusLocalImageStatus();
  if (activeRuntimeDownload) return followDownload(activeRuntimeDownload, onProgress);
  const job: ActiveDownload = { progress: 0, promise: null as unknown as Promise<NodusLocalImageStatus>, listeners: new Set() };
  activeRuntimeDownload = job;
  job.promise = (async () => {
    const asset = runtimeAsset();
    const root = runtimeDirectory();
    const archive = path.join(rootDirectory(), `${asset.name}.download`);
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.mkdir(rootDirectory(), { recursive: true });
    let downloaded = 0;
    await downloadFile(asset.url, archive, asset.bytes, asset.sha256, (bytes) => {
      downloaded += bytes;
      reportProgress(job, Math.min(0.9, (downloaded / asset.bytes) * 0.9));
    });
    await fsp.mkdir(root, { recursive: true });
    new AdmZip(archive).extractAllTo(root, true);
    await fsp.rm(archive, { force: true });
    const executable = await sdCliPath();
    if (!executable) throw new Error('El runtime se descargó, pero no contiene sd-cli.');
    if (process.platform !== 'win32') await fsp.chmod(executable, 0o755);
    reportProgress(job, 1);
    return getNodusLocalImageStatus();
  })().finally(() => {
    if (activeRuntimeDownload === job) activeRuntimeDownload = null;
  }).then(() => getNodusLocalImageStatus());
  return followDownload(job, onProgress);
}

async function downloadModelAssets(onProgress: (fraction: number) => void): Promise<NodusLocalImageStatus> {
  const directory = modelDirectory();
  const total = nodusLocalImageModelBytes();
  let completed = 0;
  await fsp.mkdir(directory, { recursive: true });
  for (const asset of NODUS_LOCAL_IMAGE_MODEL.assets) {
    const target = path.join(directory, asset.file);
    const stat = await fsp.stat(target).catch(() => null);
    if (stat?.isFile() && stat.size === asset.bytes) {
      completed += asset.bytes;
      onProgress(completed / total);
      continue;
    }
    let current = 0;
    await downloadFile(asset.url, target, asset.bytes, asset.sha256, (bytes) => {
      current += bytes;
      onProgress(Math.min(0.999, (completed + current) / total));
    });
    completed += asset.bytes;
  }
  onProgress(1);
  return getNodusLocalImageStatus();
}

export async function downloadNodusLocalImageModel(
  modelId: string,
  onProgress?: (fraction: number) => void
): Promise<NodusLocalImageStatus> {
  if (modelId !== NODUS_LOCAL_IMAGE_MODEL.id) throw new Error(`Modelo de imagen local no soportado: ${modelId}`);
  if (activeModelDownload) return followDownload(activeModelDownload, onProgress);
  const job: ActiveDownload = { progress: 0, promise: null as unknown as Promise<NodusLocalImageStatus>, listeners: new Set() };
  activeModelDownload = job;
  job.promise = (async () => {
    if (!(await sdCliPath())) {
      await installNodusLocalImageRuntime((fraction) => reportProgress(job, fraction * 0.1));
      return downloadModelAssets((fraction) => reportProgress(job, 0.1 + fraction * 0.9));
    }
    return downloadModelAssets((fraction) => reportProgress(job, fraction));
  })().finally(() => {
    if (activeModelDownload === job) activeModelDownload = null;
  }).then(() => getNodusLocalImageStatus());
  return followDownload(job, onProgress);
}

export async function deleteNodusLocalImageModel(modelId: string): Promise<NodusLocalImageStatus> {
  if (modelId !== NODUS_LOCAL_IMAGE_MODEL.id) throw new Error(`Modelo de imagen local no soportado: ${modelId}`);
  if (activeModelDownload) throw new Error('Espera a que termine la descarga antes de eliminar el modelo.');
  if (activeGenerations > 0) throw new Error('Espera a que termine la generación antes de eliminar el modelo.');
  await fsp.rm(modelDirectory(), { recursive: true, force: true });
  return getNodusLocalImageStatus();
}

function runSdCli(executable: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-20_000); });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve()
      : reject(new Error(stderr.trim() || `stable-diffusion.cpp terminó con código ${code}.`)));
  });
}

async function generateNow(prompt: string, quality: NodusImageQuality, aspectRatio?: ChatImageAspectRatio): Promise<Buffer> {
  const cleanPrompt = prompt.replace(/\s+/g, ' ').trim();
  if (!cleanPrompt) throw new Error('El prompt de imagen está vacío.');
  const status = await getNodusLocalImageStatus();
  if (!status.model.downloaded) throw new Error('Descarga FLUX.2 Klein 4B Q4 en Ajustes → Modelos IA antes de generar imágenes locales.');
  const executable = status.runtime.executablePath;
  if (!executable) throw new Error('Instala el motor local de imágenes antes de generar.');
  const preset = getNodusImageQualityPreset(quality);
  const [ratioWidth, ratioHeight] = (aspectRatio ?? `${preset.width}:${preset.height}`).split(':').map(Number);
  const area = preset.width * preset.height;
  const width = aspectRatio ? Math.max(256, Math.round(Math.sqrt(area * ratioWidth / ratioHeight) / 64) * 64) : preset.width;
  const height = aspectRatio ? Math.max(256, Math.round(Math.sqrt(area * ratioHeight / ratioWidth) / 64) * 64) : preset.height;
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'nodus-flux2-'));
  const output = path.join(temporary, `${randomUUID()}.png`);
  const directory = modelDirectory();
  try {
    await runSdCli(executable, [
      '--diffusion-model', path.join(directory, NODUS_LOCAL_IMAGE_MODEL.diffusionFile),
      '--vae', path.join(directory, NODUS_LOCAL_IMAGE_MODEL.vaeFile),
      '--llm', path.join(directory, NODUS_LOCAL_IMAGE_MODEL.textEncoderFile),
      '--prompt', cleanPrompt,
      '--output', output,
      '--width', String(width),
      '--height', String(height),
      '--steps', String(preset.steps),
      '--cfg-scale', '1.0',
      '--sampling-method', 'euler',
      '--seed', '-1',
      '--offload-to-cpu',
      '--diffusion-fa',
      '--vae-tiling',
      '--mmap',
      '--disable-image-metadata',
    ], path.dirname(executable));
    const bytes = await fsp.readFile(output);
    if (!bytes.length) throw new Error('El motor local no produjo una imagen.');
    return bytes;
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
}

/** Serialise local generations: loading several ~5 GB pipelines at once can exhaust unified memory. */
export function generateNodusLocalImage(
  modelId: string,
  prompt: string,
  quality: NodusImageQuality,
  aspectRatio?: ChatImageAspectRatio
): Promise<{ bytes: Buffer; mimeType: 'image/png' }> {
  if (modelId !== NODUS_LOCAL_IMAGE_MODEL.id) return Promise.reject(new Error(`Modelo de imagen local no soportado: ${modelId}`));
  const previous = generationTail.catch(() => undefined);
  let release!: () => void;
  generationTail = new Promise<void>((resolve) => { release = resolve; });
  return previous.then(async () => {
    activeGenerations += 1;
    try {
      return { bytes: await generateNow(prompt, quality, aspectRatio), mimeType: 'image/png' as const };
    } finally {
      activeGenerations -= 1;
      release();
    }
  });
}
