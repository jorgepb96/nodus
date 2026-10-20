// Pure pieces of the Ming narration engine, bundled from the real sources with esbuild:
// the nodus-audio:// URL mapping (no path can escape its directory), WAV fragment
// concatenation (header surgery only) and the retention sweep (pinned clips survive,
// each surface follows its own rule, work is batched).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-tts-units-test-'));

function wav(samples, sampleRate = 44100) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => data.writeInt16LE(value, i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii'); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii'); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

try {
  const entry = path.join(tmp, 'entry.ts');
  await writeFile(entry, [
    `export * from ${JSON.stringify(path.join(repoRoot, 'electron/tts/audioUrls.ts'))};`,
    `export * from ${JSON.stringify(path.join(repoRoot, 'electron/tts/wavConcat.ts'))};`,
    `export { sweepNarrationClips, SURFACE_KINDS } from ${JSON.stringify(path.join(repoRoot, 'electron/tts/retention.ts'))};`,
    `export { readWavInfo, minimumVoiceTranscriptChars } from ${JSON.stringify(path.join(repoRoot, 'shared/ttsVoices.ts'))};`,
    `export { TtsVoiceLibrary } from ${JSON.stringify(path.join(repoRoot, 'electron/tts/voices.ts'))};`,
    `export { sanitizeTtsRetention } from ${JSON.stringify(path.join(repoRoot, 'shared/ttsModels.ts'))};`,
    `export { liveStartThreshold } from ${JSON.stringify(path.join(repoRoot, 'src/components/AudioPlayer.tsx'))};`,
    `export { mergeTtsModelStatus } from ${JSON.stringify(path.join(repoRoot, 'src/lib/narration/ttsClient.ts'))};`,
  ].join('\n'));
  const outfile = path.join(tmp, 'units.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', jsx: 'automatic', alias: { '@shared': path.join(repoRoot, 'shared') } });
  const u = await import(pathToFileURL(outfile).href);

  // ── Live playback threshold ──────────────────────────────────────────────────
  // The player waits until the buffered audio covers what generation is still behind:
  // total × (1 − 1/rtf). At or below real time it starts immediately; without a measured
  // RTF it waits for `finish()` (the queue is complete).
  assert.equal(u.liveStartThreshold(null, 120), Infinity);
  assert.equal(u.liveStartThreshold(0.5, 120), 0);
  assert.equal(u.liveStartThreshold(0.9, 120), 0, 'real-time generation starts at the first fragment');
  assert.equal(u.liveStartThreshold(0.95, 120), 0, 'a ratio just above real time still needs no backlog');
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
  close(u.liveStartThreshold(1.2, 120), 20);
  close(u.liveStartThreshold(2, 120), 60);
  assert.equal(u.liveStartThreshold(1.5, 0), 0, 'an empty estimate has nothing to wait for');

  // ── Download progress in the cached status ──────────────────────────────────
  // The main process sends `model` events while a 1.5 GB checkpoint downloads. Folding
  // each one into the cached status keeps every progress bar moving without a status IPC
  // round trip four times a second.
  const before = {
    platformSupported: true,
    runtime: { engine: 'ming', backend: 'mlx', installed: true, installing: false },
    phononRuntime: { engine: 'phonon', backend: 'phonon', installed: false, installing: false },
    engine: { state: 'unloaded', modelId: null, idleUnloadAt: null },
    models: [
      { id: 'ming3-0.5b-mlx-8bit', downloaded: false, downloading: false, downloadedBytes: 0, totalBytes: 100, progress: 0 },
      { id: 'phonon-31m-en', downloaded: true, downloading: false, downloadedBytes: 50, totalBytes: 50, progress: 1 },
    ],
  };
  const progress = { id: 'ming3-0.5b-mlx-8bit', downloaded: false, downloading: true, downloadedBytes: 40, totalBytes: 100, progress: 0.4 };
  const merged = u.mergeTtsModelStatus(before, progress);
  assert.deepEqual(merged.models.map((model) => model.id), ['ming3-0.5b-mlx-8bit', 'phonon-31m-en'], 'model order is stable');
  assert.equal(merged.models[0], progress, 'the downloading model is replaced');
  assert.equal(merged.models[1], before.models[1], 'other models are untouched');
  assert.equal(merged.runtime, before.runtime, 'engine status is preserved');
  assert.equal(u.mergeTtsModelStatus(null, progress), null, 'no cached status yet, nothing to update');

  // ── Reference transcript length ─────────────────────────────────────────────
  // A file name such as "Example" is not a transcript. A 12.48 s clip needs at least
  // 38 characters; the old validation accepted any non-empty string and the prompt then
  // mismatched the reference audio.
  assert.equal(u.minimumVoiceTranscriptChars(3), 12);
  assert.equal(u.minimumVoiceTranscriptChars(12.48), 38);
  assert.equal(u.minimumVoiceTranscriptChars(30), 90);
  assert.equal(u.minimumVoiceTranscriptChars(Number.NaN), 12);
  const voiceLibrary = new u.TtsVoiceLibrary(path.join(tmp, 'voice-library'), path.join(tmp, 'bundled-voices'));
  const voiceWav = new Uint8Array(wav(new Array(4 * 44100).fill(0)));
  const voice = { name: 'Example', language: 'es', origin: 'uploaded', wav: voiceWav, consent: true };
  await assert.rejects(() => voiceLibrary.save({ ...voice, transcript: 'Example' }), /TTS_VOICE_TRANSCRIPT_TOO_SHORT/, 'a name is not a transcript');
  const savedVoice = await voiceLibrary.save({ ...voice, transcript: 'En este capítulo analizaremos la hipótesis principal del estudio.' });
  await assert.rejects(() => voiceLibrary.update(savedVoice.id, { transcript: 'Example' }), /TTS_VOICE_TRANSCRIPT_TOO_SHORT/, 'editing cannot erase the transcript either');
  await assert.rejects(() => voiceLibrary.update(savedVoice.id, { transcript: '   ' }), /TTS_VOICE_INVALID/, 'an empty edit is refused instead of silently ignored');
  assert.equal((await voiceLibrary.list()).find((entry) => entry.id === savedVoice.id)?.transcript, 'En este capítulo analizaremos la hipótesis principal del estudio.');

  // ── nodus-audio:// mapping ───────────────────────────────────────────────────
  const live = path.join(tmp, 'live');
  const resolvers = { liveDir: () => live, clipPath: (id) => (id === 'clip-1' ? '/vault/audio/a.wav' : null), voicePath: (id) => (id === 'user:x' ? '/voices/user_x/reference.wav' : null) };
  const job = '0b4c4f1e-1111-2222-3333-444455556666';
  assert.equal(u.resolveAudioUrl(u.liveFragmentUrl(job, '/anything/007.wav'), resolvers), path.join(live, job, '007.wav'));
  assert.equal(u.resolveAudioUrl(u.clipAudioUrl('clip-1'), resolvers), '/vault/audio/a.wav');
  assert.equal(u.resolveAudioUrl(u.voiceAudioUrl('user:x'), resolvers), '/voices/user_x/reference.wav');
  for (const bad of [
    `nodus-audio://live/${job}/../../etc/passwd`,
    `nodus-audio://live/${job}/%2e%2e%2fsecret.wav`,
    'nodus-audio://live/../007.wav',
    `nodus-audio://live/${job}/007.mp3`,
    'nodus-audio://clip/a/b',
    'nodus-audio://other/x',
    'https://example.com/x.wav',
    'nodus-audio://clip/unknown',
  ]) assert.equal(u.resolveAudioUrl(bad, resolvers), null, `refused: ${bad}`);

  // ── WAV concatenation ─────────────────────────────────────────────────────────
  await mkdir(path.join(tmp, 'frag'));
  const a = path.join(tmp, 'frag/000.wav'); const b = path.join(tmp, 'frag/001.wav');
  await writeFile(a, wav([1, 2, 3])); await writeFile(b, wav([4, 5]));
  const joined = await u.concatWavFiles([a, b], 0);
  const info = u.readWavInfo(new Uint8Array(joined));
  assert.equal(info.sampleRate, 44100);
  assert.equal(Math.round(info.durationS * 44100), 5, 'samples are concatenated');
  assert.deepEqual([...Array(5)].map((_, i) => joined.readInt16LE(44 + i * 2)), [1, 2, 3, 4, 5]);
  const gapped = await u.concatWavFiles([a, b], 1000);
  assert.equal(Math.round(u.readWavInfo(new Uint8Array(gapped)).durationS * 44100), 5 + 44100, 'a pause is inserted between fragments');
  const c = path.join(tmp, 'frag/002.wav');
  await writeFile(c, wav([9], 24000));
  await assert.rejects(u.concatWavFiles([a, c]), /TTS_FRAGMENT_FORMAT_MISMATCH/);
  await writeFile(c, Buffer.from('not a wav at all, definitely not one'));
  await assert.rejects(u.concatWavFiles([c]), /TTS_BAD_FRAGMENT/);

  // ── Retention sweep ───────────────────────────────────────────────────────────
  const now = Date.parse('2026-10-20T12:00:00Z');
  const day = 86_400_000;
  const clips = [
    { id: 'chat-old', kind: 'chat_message', created: now - 3 * day, pinned: false },
    { id: 'chat-new', kind: 'chat_message', created: now - 0.5 * day, pinned: false },
    { id: 'dr-old', kind: 'deep_research', created: now - 10 * day, pinned: false },
    { id: 'dr-old-kept', kind: 'deep_research', created: now - 30 * day, pinned: true },
    { id: 'dict-old', kind: 'dictionary_entry', created: now - 100 * day, pinned: false },
    { id: 'study-old', kind: 'study_document', created: now - 400 * day, pinned: false },
    ...Array.from({ length: 250 }, (_, i) => ({ id: `imm-${i}`, kind: 'immersion', created: now - 8 * day - i, pinned: false })),
  ];
  const store = {
    listExpired: (kind, cutoff, limit) => clips.filter((c) => c.kind === kind && !c.pinned && new Date(c.created).toISOString() < cutoff).slice(0, limit),
    remove: (id) => { clips.splice(clips.findIndex((c) => c.id === id), 1); },
  };
  const settings = u.sanitizeTtsRetention({ enabled: true, days: 7, perSurface: { research_chat: { mode: 'days', days: 1 }, dictionary: { mode: 'off' } } });
  const removed = await u.sweepNarrationClips(settings, store, now, 100);
  const left = new Set(clips.map((c) => c.id));
  assert.equal(removed, 252, 'chat-old, dr-old and all 250 immersion clips (in batches)');
  for (const kept of ['chat-new', 'dr-old-kept', 'dict-old', 'study-old']) assert.ok(left.has(kept), `${kept} survives`);
  assert.ok(!Object.values(u.SURFACE_KINDS).includes('study_document'), 'study clips are never swept');
  console.log('tts engine unit tests passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
