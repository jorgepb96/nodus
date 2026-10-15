// Real resident Whisper + rolling long speech, silence, noise and process cleanup.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const model = process.env.NODUS_DICTATION_CPP_MODEL;
assert.ok(model, 'Set NODUS_DICTATION_CPP_MODEL to an installed base model');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-live-engine-'));
const output = path.resolve('output/qa/scriptor-dictation/realtime');
await mkdir(output, { recursive: true }); await mkdir(path.join(tmp, 'whisper.cpp/models'), { recursive: true });
await symlink(path.resolve(model), path.join(tmp, 'whisper.cpp/models/ggml-base.bin'));
const run = (cmd, args) => new Promise((resolve, reject) => { const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let log = ''; child.stderr.on('data', d => { log = (log + d).slice(-2000); }); child.on('error', reject); child.on('close', code => code ? reject(new Error(log)) : resolve()); });
await build({ entryPoints: ['electron/stt/whisperCpp.ts', 'src/lib/stt/liveDictation.ts', 'src/lib/audio/wav.ts'], outdir: path.join(tmp, 'bundles'), platform: 'node', bundle: true, format: 'esm', logLevel: 'silent', plugins: [{ name: 'profile', setup(b) {
  b.onResolve({ filter: /^electron$/ }, () => ({ path: 'e', namespace: 'qa' }));
  b.onResolve({ filter: /db\/settingsRepo$/ }, () => ({ path: 's', namespace: 'qa' }));
  b.onLoad({ filter: /.*/, namespace: 'qa' }, ({ path: name }) => ({ contents: name === 'e' ? `export const app={getPath:()=>${JSON.stringify(tmp)}}` : 'export const getSettings=()=>({sttWhisperCppExecutable:"/opt/homebrew/bin/whisper-cli",sttWhisperCppModel:"base"})' }));
} }] });
const engine = await import(pathToFileURL(path.join(tmp, 'bundles/electron/stt/whisperCpp.js')));
const { LiveDictationSession } = await import(pathToFileURL(path.join(tmp, 'bundles/src/lib/stt/liveDictation.js')));
const { encodeWavPcm16 } = await import(pathToFileURL(path.join(tmp, 'bundles/src/lib/audio/wav.js')));
const request = { requestId: 'long-local-voice', realtime: true, model: 'base', language: 'es', provider: 'whisper_cpp', allowEmpty: true };
try {
  const prepared = Date.now(); await engine.transcribeWhisperCpp({ ...request, audioBytes: new Uint8Array() });
  const report = { preparedMs: Date.now() - prepared, silence: '', tone: '', updates: [], text: '', released: 0 };
  for (const kind of ['silence', 'tone']) {
    const pcm = new Float32Array(16000 * 4);
    if (kind === 'tone') for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i * 2 * Math.PI * 220 / 16000) * 0.2;
    report[kind] = (await engine.transcribeWhisperCpp({ ...request, audioBytes: encodeWavPcm16(pcm, 16000) })).text;
    assert.equal(report[kind], '', `${kind} must not invent speech`);
  }
  const spoken = 'Estamos haciendo una prueba larga de escritura en el documento y queremos comprobar que todas las palabras aparecen mientras seguimos hablando de una manera continua para mantener el contexto de toda esta explicación sin interrumpir el trabajo porque el sistema debe conservar las palabras que ya hemos dicho y continuar con las nuevas palabras hasta llegar al final de esta prueba de transcripción local y además queremos seguir contando ideas sobre la lectura y la escritura porque esta explicación tiene que ser suficientemente larga para revisar los cambios de ventana sin que se pierdan palabras ni se repita lo que hemos dicho antes';
  const aiff = path.join(tmp, 'speech.aiff'), wav = path.join(tmp, 'speech.wav');
  await run('say', ['-v', 'Mónica', '-r', '125', '-o', aiff, spoken]);
  await run('ffmpeg', ['-y', '-i', aiff, '-ar', '16000', '-ac', '1', wav]);
  const bytes = await readFile(wav); let offset = 12;
  while (bytes.toString('ascii', offset, offset + 4) !== 'data') offset += 8 + bytes.readUInt32LE(offset + 4) + bytes.readUInt32LE(offset + 4) % 2;
  const count = bytes.readUInt32LE(offset + 4) / 2, pcm = new Float32Array(count);
  for (let i = 0; i < count; i++) pcm[i] = bytes.readInt16LE(offset + 8 + i * 2) / 32768;
  assert.ok(pcm.length > 16000 * 25, 'long fixture must cross the rolling model window');
  const utterances = new Map(), started = Date.now(); let error;
  const session = new LiveDictationSession({ sampleRate: 16000,
    transcribe: async samples => (await engine.transcribeWhisperCpp({ ...request, audioBytes: encodeWavPcm16(samples, 16000) })).text,
    onUpdate: (text, id, final) => { utterances.set(id, text); report.updates.push({ ms: Date.now() - started, text, id, final }); },
    onError: cause => { error = cause; }, onBackpressure: () => { error = new Error('Model fell behind live speech'); },
  });
  for (let i = 0; i < pcm.length; i += 2048) {
    session.push(pcm.subarray(i, i + 2048));
    await new Promise(resolve => setTimeout(resolve, 128));
  }
  await session.stop(); if (error) throw error;
  report.text = [...utterances.values()].filter(Boolean).join(' ');
  assert.ok(report.updates.length >= 20); assert.ok(utterances.size >= 2);
  assert.doesNotMatch(report.text, /\[Música|\[Music|de la de la de la/);
  assert.match(report.text, /contexto/i); assert.match(report.text, /final/i); assert.match(report.text, /local/i);
  const normalized = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z]+/g) ?? [];
  const expected = normalized(spoken), actual = normalized(report.text); let row = Array.from({ length: actual.length + 1 }, (_, i) => i);
  for (let i = 0; i < expected.length; i++) { const next = [i + 1]; for (let j = 0; j < actual.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(expected[i] !== actual[j]))); row = next; }
  report.wordErrorRate = row.at(-1) / expected.length;
  assert.ok(report.wordErrorRate < 0.25, `long speech lost or duplicated too many words: ${report.text}`);
  assert.ok((report.text.match(/[.!?]/g) ?? []).length <= 2, 'window rollover must not add artificial sentence endings');
  report.released = engine.stopAllWhisperCpp(); assert.equal(report.released, 1);
  await writeFile(path.join(output, 'long-voice.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, durationSeconds: pcm.length / 16000, updates: report.updates.length, wordErrorRate: report.wordErrorRate, text: report.text, released: report.released }, null, 2));
} finally { engine.stopAllWhisperCpp(); await rm(tmp, { recursive: true, force: true }); }
