// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isTtsLanguage, type TtsLanguage } from '@shared/ttsModels';
import { MING_BUILTIN_VOICES, mingBuiltinInvocation } from '@shared/mingBuiltinVoices';
import {
  TTS_VOICE_MAX_BYTES, TTS_VOICE_MAX_S, TTS_VOICE_MIN_S, builtinVoiceId, isBuiltinVoiceId, isUserVoiceId, readWavInfo,
  type TtsVoice, type TtsVoiceSaveInput,
} from '@shared/ttsVoices';
import type { TtsVoiceRef } from './host';

/**
 * The voice library is the user's, not a vault's: `voices/<id>/` holds `reference.wav`, a
 * `meta.json` and a `cache/` the sidecar fills with each model's encoded prompt, so a voice is
 * analysed once rather than on every narration. Bundled CC0 voices are copied out of the app
 * on first use (the sidecar needs a real file path, not one inside the asar) and are read-only.
 */
const BUNDLED: ReadonlyArray<{ id: string; file: string; name: string; language: TtsLanguage; attribution: string }> = [
  { id: 'cc0:es-dave', file: 'es-dave', name: 'Dave · castellano', language: 'es', attribution: 'OHF-Voice/voice-datasets · CC0' },
];

interface StoredMeta {
  id: string;
  name: string;
  origin: 'recorded' | 'uploaded';
  language: TtsLanguage;
  transcript: string;
  durationS: number;
  createdAt: string;
  consent: true;
}

const dirName = (id: string) => id.replace(':', '_');

export class TtsVoiceLibrary {
  constructor(readonly root: string, readonly bundledDir: string) {}

  private dir(id: string): string {
    if (!/^(user:[0-9a-f-]{36}|cc0:[a-z0-9-]{1,40})$/.test(id)) throw new Error('TTS_VOICE_INVALID');
    return path.join(this.root, dirName(id));
  }

  async list(): Promise<TtsVoice[]> {
    const voices: TtsVoice[] = [];
    let entries: string[] = [];
    try { entries = await fs.readdir(this.root); } catch { /* empty library */ }
    for (const entry of entries.filter((name) => name.startsWith('user_')).sort()) {
      try {
        const meta = JSON.parse(await fs.readFile(path.join(this.root, entry, 'meta.json'), 'utf8')) as StoredMeta;
        voices.push({ id: meta.id, name: meta.name, origin: meta.origin, language: meta.language, transcript: meta.transcript, durationS: meta.durationS, createdAt: meta.createdAt, readOnly: false });
      } catch { /* a half-written voice is skipped */ }
    }
    voices.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    for (const bundled of BUNDLED) {
      const transcript = await fs.readFile(path.join(this.bundledDir, `${bundled.file}.txt`), 'utf8').catch(() => '');
      voices.push({ id: bundled.id, name: bundled.name, origin: 'bundled', language: bundled.language, transcript: transcript.trim(), attribution: bundled.attribution, readOnly: true });
    }
    for (const voice of MING_BUILTIN_VOICES) {
      voices.push({ id: builtinVoiceId(voice.id), name: voice.id, origin: 'builtin', language: voice.language, readOnly: true });
    }
    return voices;
  }

  async save(input: TtsVoiceSaveInput): Promise<TtsVoice> {
    if (input.consent !== true) throw new Error('TTS_VOICE_CONSENT_REQUIRED');
    const name = String(input.name ?? '').trim().slice(0, 80);
    const transcript = String(input.transcript ?? '').trim().slice(0, 2000);
    if (!name || !transcript) throw new Error('TTS_VOICE_INVALID');
    if (!isTtsLanguage(input.language)) throw new Error('TTS_VOICE_INVALID');
    const bytes = input.wav instanceof Uint8Array ? input.wav : new Uint8Array(input.wav as ArrayBuffer);
    if (bytes.byteLength > TTS_VOICE_MAX_BYTES) throw new Error('TTS_VOICE_TOO_LARGE');
    const info = readWavInfo(bytes);
    if (!info || info.channels !== 1 || info.bitsPerSample !== 16) throw new Error('TTS_VOICE_BAD_AUDIO');
    if (info.durationS < TTS_VOICE_MIN_S || info.durationS > TTS_VOICE_MAX_S) throw new Error('TTS_VOICE_BAD_LENGTH');
    const id = `user:${randomUUID()}`;
    const dir = this.dir(id);
    const staging = `${dir}.tmp-${randomUUID()}`;
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(path.join(staging, 'reference.wav'), bytes, { mode: 0o600 });
      const meta: StoredMeta = { id, name, origin: input.origin === 'uploaded' ? 'uploaded' : 'recorded', language: input.language, transcript, durationS: Math.round(info.durationS * 100) / 100, createdAt: new Date().toISOString(), consent: true };
      await fs.writeFile(path.join(staging, 'meta.json'), JSON.stringify(meta), { mode: 0o600 });
      await fs.rename(staging, dir);
      return { id, name: meta.name, origin: meta.origin, language: meta.language, transcript, durationS: meta.durationS, createdAt: meta.createdAt, readOnly: false };
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async update(id: string, patch: { name?: string; transcript?: string; language?: TtsLanguage }): Promise<void> {
    if (!isUserVoiceId(id)) throw new Error('TTS_VOICE_READ_ONLY');
    const file = path.join(this.dir(id), 'meta.json');
    const meta = JSON.parse(await fs.readFile(file, 'utf8')) as StoredMeta;
    const next: StoredMeta = { ...meta };
    if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim().slice(0, 80);
    if (typeof patch.transcript === 'string' && patch.transcript.trim()) next.transcript = patch.transcript.trim().slice(0, 2000);
    if (isTtsLanguage(patch.language)) next.language = patch.language;
    await fs.writeFile(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
    // A new transcript changes the prompt; the cached encoding must be rebuilt.
    if (next.transcript !== meta.transcript) await fs.rm(path.join(this.dir(id), 'cache'), { recursive: true, force: true });
  }

  async remove(id: string): Promise<void> {
    if (!isUserVoiceId(id)) throw new Error('TTS_VOICE_READ_ONLY');
    await fs.rm(this.dir(id), { recursive: true, force: true });
  }

  /** Reference recording path for the `nodus-audio://voice/` route; null for built-ins. */
  referencePath(id: string): string | null {
    if (isBuiltinVoiceId(id)) return null;
    try { return path.join(this.dir(id), 'reference.wav'); } catch { return null; }
  }

  /** What the sidecar needs to speak with a voice. Bundled voices are materialized on demand. */
  async resolve(id: string): Promise<{ ref: TtsVoiceRef; language: TtsLanguage }> {
    if (isBuiltinVoiceId(id)) {
      const voice = MING_BUILTIN_VOICES.find((entry) => builtinVoiceId(entry.id) === id);
      if (!voice) throw new Error('TTS_VOICE_NOT_FOUND');
      return { ref: { kind: 'builtin', name: mingBuiltinInvocation(voice) }, language: voice.language };
    }
    const bundled = BUNDLED.find((entry) => entry.id === id);
    const dir = this.dir(id);
    if (bundled) {
      const target = path.join(dir, 'reference.wav');
      try { await fs.access(target); } catch {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(target, await fs.readFile(path.join(this.bundledDir, `${bundled.file}.wav`)));
      }
      const text = (await fs.readFile(path.join(this.bundledDir, `${bundled.file}.txt`), 'utf8')).trim();
      return { ref: { kind: 'clone', voiceId: id, wavPath: target, text, cacheDir: path.join(dir, 'cache') }, language: bundled.language };
    }
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8').catch(() => { throw new Error('TTS_VOICE_NOT_FOUND'); })) as StoredMeta;
    return { ref: { kind: 'clone', voiceId: id, wavPath: path.join(dir, 'reference.wav'), text: meta.transcript, cacheDir: path.join(dir, 'cache') }, language: meta.language };
  }
}
