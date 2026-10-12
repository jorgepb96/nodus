import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type { StudySttRequest, StudySttResult } from '@shared/sttModels';

type Session = { child: ChildProcess | null; controller: AbortController; ready: Promise<string>; model: string; busy: boolean };
const sessions = new Map<string, Session>();

async function availablePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function start(session: Session, executable: string, weights: string): Promise<string> {
  const server = path.join(path.dirname(executable), process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server');
  if (!fs.existsSync(server)) throw new Error('El dictado en directo necesita whisper-server, incluido en whisper.cpp. Actualiza la instalación desde Ajustes → Modelos IA.');
  const port = await availablePort();
  if (session.controller.signal.aborted) throw new Error('Transcripción cancelada.');
  // The process and loaded model belong to this microphone session only. Audio
  // goes from main to a loopback service; no renderer/network provider is used.
  const route = `/nodus-${randomUUID()}`;
  const child = spawn(server, ['--model', weights, '--host', '127.0.0.1', '--port', String(port), '--request-path', route, '--threads', '4', '--best-of', '5', '--beam-size', '5', '--no-fallback', '--suppress-nst', '--no-speech-thold', '0.5'], { stdio: ['ignore', 'pipe', 'pipe'] });
  session.child = child;
  let log = '', failure: Error | null = null;
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', chunk => { log = `${log}${String(chunk)}`.slice(-2000); });
  child.on('error', error => { failure = error; });
  child.on('exit', code => { failure = new Error(log || `whisper-server terminó (${code}).`); });
  const url = `http://127.0.0.1:${port}${route}`;
  const deadline = Date.now() + 60_000;
  while (!session.controller.signal.aborted && Date.now() < deadline) {
    if (failure) throw failure;
    const response = await fetch(`${url}/health`, { signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(500)]) }).catch(() => null);
    if (response?.ok) return url;
    // Older bundled servers have the root endpoint but no health endpoint.
    if (response?.status === 404) {
      const root = await fetch(`${url}/`, { signal: session.controller.signal }).catch(() => null);
      if (root?.ok) return url;
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(session.controller.signal.aborted ? 'Transcripción cancelada.' : 'Whisper no terminó de preparar el modelo local.');
}

export async function transcribeWhisperLive(request: StudySttRequest, executable: string, weights: string, model: string): Promise<StudySttResult> {
  const id = request.requestId;
  if (!id || !/^[\w-]{1,128}$/u.test(id)) throw new Error('Identificador de dictado no válido.');
  let session = sessions.get(id);
  if (!session) {
    session = { child: null, controller: new AbortController(), ready: Promise.resolve(''), model, busy: false };
    sessions.set(id, session);
    session.ready = start(session, executable, weights);
  }
  if (session.model !== model || session.busy) throw new Error('La sesión de dictado ya está procesando otro audio.');
  session.busy = true;
  try {
    const url = await session.ready;
    if (session.controller.signal.aborted) throw new Error('Transcripción cancelada.');
    const bytes = new Uint8Array(request.audioBytes);
    if (!bytes.byteLength) return { text: '', provider: 'whisper_cpp', model };
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'dictation.wav');
    form.append('language', request.language || 'auto');
    form.append('response_format', 'verbose_json');
    form.append('max_len', '1024');
    form.append('temperature', '0'); form.append('temperature_inc', '0');
    form.append('suppress_non_speech', 'true');
    // Use only explicit vocabulary, never the transcript as an initial prompt.
    if (request.prompt?.trim()) form.append('prompt', request.prompt.trim());
    const response = await fetch(`${url}/inference`, { method: 'POST', body: form, signal: session.controller.signal });
    if (!response.ok) throw new Error(`Whisper no pudo transcribir el audio (${response.status}).`);
    const result = await response.json() as { text?: string; segments?: Array<{ text: string; start: number; end: number; no_speech_prob?: number; avg_logprob?: number }> };
    const segments = result.segments?.filter(segment => (segment.no_speech_prob ?? 0) < 0.65 && (segment.avg_logprob ?? 0) > -1.2);
    const text = segments ? segments.map(segment => segment.text).join(' ').trim() : result.text?.trim() ?? '';
    return { text, provider: 'whisper_cpp', model, chunks: segments?.map(segment => ({ text: segment.text, timestamp: [segment.start, segment.end] })) };
  } catch (error) {
    cancelWhisperLive(id);
    throw error;
  } finally { session.busy = false; }
}

export function cancelWhisperLive(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  sessions.delete(id); session.controller.abort();
  session.child?.kill('SIGKILL');
  return true;
}
export function stopWhisperLive(): number {
  const count = sessions.size;
  for (const id of sessions.keys()) cancelWhisperLive(id);
  return count;
}
