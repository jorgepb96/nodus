import { app } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StudySttRequest, StudySttResult, WhisperCppStatus } from '@shared/sttModels';
import { WHISPER_CPP_MODELS } from '@shared/sttModels';
import { getSettings } from '../db/settingsRepo';
import { transcribeWhisperLive, cancelWhisperLive, stopWhisperLive } from './whisperLive';

const active = new Map<string, ChildProcess>();
const cancelled = new Set<string>();

function brewExecutable(): string | null {
  for (const candidate of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew', '/home/linuxbrew/.linuxbrew/bin/brew']) if (fs.existsSync(candidate)) return candidate;
  return resolveFromPath('brew');
}

function runInstaller(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-12_000); });
    child.stderr?.on('data', (chunk) => { output = `${output}${String(chunk)}`.slice(-12_000); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(output.trim() || `El instalador terminó con código ${code}.`)));
  });
}

function modelDirectory(): string {
  return path.join(app.getPath('userData'), 'whisper.cpp', 'models');
}

function modelPath(model: string): string {
  return path.join(modelDirectory(), `ggml-${model}.bin`);
}

function validModel(model: string): boolean {
  return WHISPER_CPP_MODELS.some((entry) => entry.id === model);
}

function executableCandidates(): string[] {
  const configured = getSettings().sttWhisperCppExecutable.trim();
  const candidates = [configured];
  if (process.platform === 'darwin') candidates.push('/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli');
  if (process.platform === 'win32') candidates.push('whisper-cli.exe', 'main.exe');
  else candidates.push('whisper-cli', 'whisper-cpp');
  return candidates.filter(Boolean);
}

function resolveFromPath(command: string): string | null {
  if (path.isAbsolute(command)) return fs.existsSync(command) ? command : null;
  const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], { encoding: 'utf8', timeout: 2_000 });
  const found = lookup.status === 0 ? lookup.stdout.split(/\r?\n/u).find(Boolean)?.trim() : '';
  return found && fs.existsSync(found) ? found : null;
}

export function resolveWhisperCppExecutable(): string | null {
  for (const candidate of executableCandidates()) {
    const resolved = resolveFromPath(candidate);
    if (resolved) return resolved;
  }
  return null;
}

export async function getWhisperCppStatus(): Promise<WhisperCppStatus> {
  const executablePath = resolveWhisperCppExecutable();
  const models = await Promise.all(WHISPER_CPP_MODELS.map(async ({ id }) => {
    const target = modelPath(id);
    const stat = await fsp.stat(target).catch(() => null);
    return { id, path: target, downloaded: Boolean(stat?.isFile() && stat.size > 0), bytes: stat?.size ?? 0 };
  }));
  return { executablePath, executableReady: Boolean(executablePath), models };
}

export async function installWhisperCpp(): Promise<WhisperCppStatus> {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('La instalación automática de whisper.cpp todavía no está disponible en este sistema.');
  const brew = brewExecutable();
  if (!brew) throw new Error('Para instalar whisper.cpp con un clic se necesita Homebrew. Instálalo y vuelve a intentarlo.');
  await runInstaller(brew, ['install', 'whisper-cpp']);
  const status = await getWhisperCppStatus();
  if (!status.executableReady) throw new Error('whisper.cpp se instaló, pero no se encontró whisper-cli. Reinicia Nodus y vuelve a comprobarlo.');
  return status;
}

export async function uninstallWhisperCpp(): Promise<WhisperCppStatus> {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('La desinstalación automática de whisper.cpp todavía no está disponible en este sistema.');
  const brew = brewExecutable();
  if (!brew) throw new Error('No se encontró Homebrew para desinstalar whisper.cpp.');
  await runInstaller(brew, ['uninstall', 'whisper-cpp']);
  return getWhisperCppStatus();
}

export async function downloadWhisperCppModel(model: string, onProgress?: (fraction: number) => void): Promise<WhisperCppStatus> {
  if (!validModel(model)) throw new Error(`Modelo whisper.cpp no soportado: ${model}`);
  const before = await getWhisperCppStatus();
  if (!before.executableReady) await installWhisperCpp();
  await fsp.mkdir(modelDirectory(), { recursive: true });
  const target = modelPath(model);
  const partial = `${target}.download`;
  await fsp.rm(partial, { force: true });
  const response = await fetch(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${encodeURIComponent(model)}.bin`, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`No se pudo descargar el modelo whisper.cpp (${response.status}).`);
  const total = Number(response.headers.get('content-length') ?? 0);
  const file = await fsp.open(partial, 'w');
  let loaded = 0;
  try {
    const reader = response.body.getReader();
    let chunk = await reader.read();
    while (!chunk.done) {
      const { value } = chunk;
      await file.write(value);
      loaded += value.byteLength;
      onProgress?.(total > 0 ? loaded / total : 0);
      chunk = await reader.read();
    }
  } catch (error) {
    await file.close().catch(() => undefined);
    await fsp.rm(partial, { force: true });
    throw error;
  } finally {
    await file.close().catch(() => undefined);
  }
  if (loaded === 0) throw new Error('La descarga del modelo whisper.cpp quedó vacía.');
  await fsp.rename(partial, target);
  onProgress?.(1);
  return getWhisperCppStatus();
}

export async function deleteWhisperCppModel(model: string): Promise<WhisperCppStatus> {
  if (!validModel(model)) throw new Error(`Modelo whisper.cpp no soportado: ${model}`);
  await fsp.rm(modelPath(model), { force: true });
  await fsp.rm(`${modelPath(model)}.download`, { force: true });
  return getWhisperCppStatus();
}

function timestampSeconds(value: string): number {
  const [hours, minutes, seconds] = value.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

export async function transcribeWhisperCpp(
  request: StudySttRequest,
  handlers: { onProgress?: (fraction: number) => void; onPartial?: (text: string) => void } = {},
): Promise<StudySttResult> {
  const executable = resolveWhisperCppExecutable();
  if (!executable) throw new Error('whisper.cpp no está instalado. Instálalo desde Ajustes.');
  const model = request.model?.trim() || getSettings().sttWhisperCppModel;
  if (!validModel(model)) throw new Error(`Modelo whisper.cpp no soportado: ${model}`);
  const weights = modelPath(model);
  if (!fs.existsSync(weights)) throw new Error(`Descarga ${model} desde Ajustes antes de transcribir.`);
  const bytes = request.audioBytes instanceof Uint8Array ? request.audioBytes : new Uint8Array(request.audioBytes);
  if (request.realtime) {
    if (request.requestId && cancelled.delete(request.requestId)) throw new Error('Transcripción cancelada.');
    return transcribeWhisperLive(request, executable, weights, model);
  }
  if (!bytes.byteLength) throw new Error('La grabación está vacía.');

  const requestId = request.requestId && /^[\w-]{1,128}$/.test(request.requestId) ? request.requestId : randomUUID();
  if (active.has(requestId)) throw new Error('Ya hay una transcripción con este identificador.');
  const input = path.join(os.tmpdir(), `nodus-whisper-${requestId}.wav`);
  await fsp.writeFile(input, bytes);
  // Cancellation can arrive while the temporary WAV is still being written.
  if (cancelled.delete(requestId)) {
    await fsp.rm(input, { force: true });
    throw new Error('Transcripción cancelada.');
  }
  const language = request.language?.trim().toLocaleLowerCase() || 'auto';
  const args = [
    '--model', weights,
    '--file', input,
    '--language', language,
    '--threads', String(Math.max(1, Math.min(8, os.cpus().length - 1))),
    '--print-progress',
    '--no-prints',
  ];
  if (request.prompt?.trim()) args.push('--prompt', request.prompt.trim());

  return new Promise<StudySttResult>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    active.set(requestId, child);
    const chunks: Array<{ text: string; timestamp: [number, number] }> = [];
    let partial = '';
    let stdoutBuffer = '';
    let stderr = '';
    const consumeLine = (line: string) => {
      const clean = line.replace(new RegExp(String.raw`\u001b\[[0-9;]*m`, 'gu'), '').trim();
      const match = clean.match(/^\[([\d:.]+)\s+-->\s+([\d:.]+)\]\s*(.+)$/u);
      if (!match) return;
      const text = match[3].trim();
      if (!text) return;
      chunks.push({ text, timestamp: [timestampSeconds(match[1]), timestampSeconds(match[2])] });
      partial = `${partial} ${text}`.trim();
      handlers.onPartial?.(partial);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      stdoutBuffer += data;
      const lines = stdoutBuffer.split(/\r?\n/u);
      stdoutBuffer = lines.pop() ?? '';
      lines.forEach(consumeLine);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (data: string) => {
      stderr = `${stderr}${data}`.slice(-8_000);
      for (const match of data.matchAll(/progress\s*=\s*(\d+)%/giu)) handlers.onProgress?.(Math.min(0.99, Number(match[1]) / 100));
    });
    child.on('error', (error) => {
      active.delete(requestId);
      void fsp.rm(input, { force: true });
      reject(error);
    });
    child.on('close', (code, signal) => {
      active.delete(requestId);
      consumeLine(stdoutBuffer);
      void fsp.rm(input, { force: true });
      if (signal === 'SIGTERM') { reject(new Error('Transcripción cancelada.')); return; }
      if (code !== 0) { reject(new Error(stderr.trim() || `whisper.cpp terminó con código ${code}.`)); return; }
      const text = chunks.map((chunk) => chunk.text).join(' ').trim() || partial.trim();
      if (!text && !request.allowEmpty) { reject(new Error('whisper.cpp no devolvió texto para este audio.')); return; }
      handlers.onProgress?.(1);
      resolve({ text, provider: 'whisper_cpp', model, chunks });
    });
  });
}

export function cancelWhisperCpp(requestId: string): void {
  if (cancelWhisperLive(requestId)) return;
  const child = active.get(requestId);
  if (child) child.kill('SIGTERM');
  else {
    cancelled.add(requestId);
    if (cancelled.size > 100) cancelled.delete(cancelled.values().next().value!);
  }
}

/**
 * Kill every running transcription. Call this on app quit.
 *
 * whisper-cli is spawned with up to 8 threads and is not in our process group,
 * so it does NOT die with the app: without this, quitting Nodus mid-transcription
 * left a detached process saturating those cores with no UI left to stop it, and
 * every subsequent run added another one.
 *
 * SIGKILL rather than the SIGTERM used by `cancelWhisperCpp`: the app is going
 * away, so there is no result to deliver and no reason to let the child choose
 * whether to exit. Returns the number of children signalled so shutdown can be
 * observed in tests and logs.
 */
export function stopAllWhisperCpp(): number {
  const live = stopWhisperLive();
  let killed = 0;
  for (const [requestId, child] of active) {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGKILL');
      killed += 1;
    }
    // Best-effort: the `close` handler that normally removes the temp WAV may
    // not run before the app exits.
    try {
      fs.rmSync(path.join(os.tmpdir(), `nodus-whisper-${requestId}.wav`), { force: true });
    } catch {
      // tmpdir cleanup is not worth blocking shutdown over
    }
  }
  active.clear();
  cancelled.clear();
  return killed + live;
}

/** Test seam: how many transcriptions are currently running. */
export function activeWhisperCppCount(): number {
  return active.size;
}

/**
 * Test seam: register a child as if `transcribeWithWhisperCpp` had spawned it.
 * Exercising shutdown otherwise requires a real whisper-cli install.
 */
export function __testRegisterWhisperChild(requestId: string, child: ChildProcess): void {
  active.set(requestId, child);
}
