import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const temp = await mkdtemp(path.join(os.tmpdir(), 'nodus-dictation-tests-'));
const output = path.join(temp, 'dictation.mjs');
await build({ entryPoints: ['src/lib/stt/liveDictation.ts'], outfile: output, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { LiveDictationSession, cleanDictationText, implausibleDictation, removeDictationOverlap } = await import(pathToFileURL(output));
const frame = (value = 0.2, length = 10) => new Float32Array(length).fill(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const defaults = { sampleRate: 100, onError: error => { throw error; } };
test.after(() => rm(temp, { recursive: true, force: true }));

test('growing words are published inside one utterance, without premature full stops', async () => {
  const updates = [], final = [], lengths = [];
  const hypotheses = ['Hola.', 'Hola mundo.', 'Hola mundo con contexto.'];
  const session = new LiveDictationSession({ ...defaults,
    transcribe: async (samples, partial) => {
      lengths.push(samples.length);
      partial('Hola');
      return hypotheses[Math.min(lengths.length - 1, 2)];
    }, onUpdate: (text, id, done) => updates.push({ text, id, done }), onText: text => final.push(text),
  });
  session.push(frame(0.2, 80)); await tick();
  assert.equal(updates.at(-1).text, 'Hola'); assert.equal(final.length, 0);
  session.push(frame(0.2, 50)); await tick();
  assert.equal(updates.at(-1).text, 'Hola mundo');
  session.push(frame(0.2, 50)); await session.stop();
  assert.equal(updates.at(-1).text, 'Hola mundo con contexto.');
  assert.equal(updates.at(-1).done, true);
  assert.ok(updates.every(update => update.id === 0), 'hypotheses replace the same range');
  assert.deepEqual(final, ['Hola mundo con contexto.']);
  assert.deepEqual(lengths, [80, 130, 180], 'new windows retain sentence context');
});

test('slow inference coalesces obsolete windows, stays ordered and drains stop', async () => {
  const first = deferred(), lengths = [], final = [];
  const session = new LiveDictationSession({ ...defaults,
    transcribe: async samples => { lengths.push(samples.length); if (lengths.length === 1) await first.promise; return 'Habla continua.'; },
    onUpdate: () => {}, onText: text => final.push(text),
  });
  for (let i = 0; i < 100; i++) session.push(frame());
  assert.equal(lengths.length, 1);
  const stopped = session.stop(); first.resolve(); await stopped;
  assert.deepEqual(lengths, [80, 1000]);
  assert.deepEqual(final, ['Habla continua.']);
});

test('silence never invokes the model, real pauses finalize with a bounded quiet tail', async () => {
  const lengths = [], updates = [];
  const session = new LiveDictationSession({ ...defaults,
    transcribe: async samples => { lengths.push(samples.length); return 'Hola.'; },
    onUpdate: (text, id, final) => updates.push({ text, id, final }),
  });
  for (let i = 0; i < 200; i++) session.push(frame(0));
  assert.equal(lengths.length, 0);
  session.push(frame(0.2, 30));
  for (let i = 0; i < 12; i++) session.push(frame(0));
  await tick();
  assert.deepEqual(updates, [{ text: 'Hola.', id: 0, final: true }]);
  assert.ok(lengths[0] <= 90);
  for (let i = 0; i < 100; i++) session.push(frame(0));
  await session.stop(); assert.equal(lengths.length, 1);
});

test('sound captions are removed without deleting genuinely dictated music vocabulary', () => {
  assert.equal(cleanDictationText('[Música] [Música de cierre] [Music] [BLANK_AUDIO]'), '');
  assert.equal(cleanDictationText('Me gusta la música. [Música] [Aplausos]', true), 'Me gusta la música.');
  assert.equal(cleanDictationText('Esta frase todavía continúa...'), 'Esta frase todavía continúa');
  assert.equal(cleanDictationText('El número es 3.14.'), 'El número es 3.14');
});

test('runaway hypotheses never reach the editor or replace the last useful words', async () => {
  assert.equal(implausibleDictation('de la '.repeat(80), 8), true);
  assert.equal(implausibleDictation('Esta es una frase normal sobre la música', 4), false);
  const updates = []; let calls = 0;
  const session = new LiveDictationSession({ ...defaults, transcribe: async () => ++calls === 1 ? 'Una frase normal' : 'Una frase ' + 'de la '.repeat(80), onUpdate: text => updates.push(text) });
  session.push(frame(0.2, 80)); await tick(); session.push(frame(0.2, 50)); await session.stop();
  assert.ok(updates.every(text => text === 'Una frase normal'));
});

test('pause and resume keep separate utterances and preserve a final short word', async () => {
  const updates = [];
  const session = new LiveDictationSession({ ...defaults, transcribe: async () => 'deshacer', onUpdate: (text, id, final) => updates.push({ text, id, final }) });
  session.push(frame(0.2, 25)); session.pause(); session.push(frame()); await tick();
  assert.deepEqual(updates, [{ text: 'deshacer', id: 0, final: true }]);
  assert.equal(session.resume(), true); session.push(frame(0.2, 20)); await session.stop();
  assert.deepEqual(updates.at(-1), { text: 'deshacer', id: 1, final: true });
  assert.equal(session.resume(), false);
});

test('cancel suppresses late hypotheses and queued audio, keeping published words', async () => {
  const inference = deferred(), updates = []; let calls = 0;
  const session = new LiveDictationSession({ ...defaults,
    transcribe: async (_samples, partial) => { calls++; partial('Ya escrito'); return inference.promise; },
    onUpdate: text => updates.push(text),
  });
  for (let i = 0; i < 80; i++) session.push(frame());
  session.cancel(); inference.resolve('Resultado tardío'); await tick();
  assert.equal(calls, 1); assert.deepEqual(updates, ['Ya escrito']);
});

test('backpressure bounds unique audio and resumes after the final windows drain', async () => {
  const first = deferred(); let pauses = 0, pending = 0, calls = 0;
  const session = new LiveDictationSession({ ...defaults,
    transcribe: async () => { calls++; if (calls === 1) await first.promise; return 'Texto.'; }, onUpdate: () => {},
    onPending: seconds => { pending = seconds; }, onBackpressure: () => { pauses++; },
  });
  for (let i = 0; i < 1000; i++) session.push(frame());
  assert.equal(pauses, 1); assert.ok(pending <= 30.1);
  assert.equal(session.resume(), false);
  first.resolve(); await tick(); assert.equal(pending, 0); assert.equal(calls, 3);
  assert.equal(session.resume(), true); await session.stop();
});

test('continuous speech carries word onset across bounded windows without repeated overlap', async () => {
  assert.equal(removeDictationOverlap('que estamos hablando ahora', 'Esta es la frase que estamos'), 'hablando ahora');
  const finals = [], inputs = [];
  const session = new LiveDictationSession({ ...defaults, transcribe: async samples => { inputs.push(samples); return inputs.length === 1 ? 'Esta es la frase que estamos' : 'frase que estamos hablando ahora.'; }, onUpdate: () => {}, onText: text => finals.push(text) });
  session.push(frame(0.2, 2400)); await tick();
  session.push(frame(0.3, 100)); await session.stop();
  assert.deepEqual(finals, ['Esta es la frase que', 'estamos hablando ahora.']);
  assert.equal(inputs[1].length, 250, '150 samples of context plus 100 new samples');
  assert.equal(inputs[1][0], inputs[0].at(-1));
});

test('inference failure stops publication and reports the error once', async () => {
  const errors = [], updates = [];
  const session = new LiveDictationSession({ ...defaults, transcribe: async () => { throw new Error('Model failed'); }, onError: error => errors.push(error.message), onUpdate: text => updates.push(text) });
  session.push(frame(0.2, 25)); await session.stop();
  assert.deepEqual(errors, ['Model failed']); assert.deepEqual(updates, []);
});

test('the audio worklet flushes partial PCM frames before pause and mixes channels', async () => {
  let Processor;
  vm.runInNewContext(await readFile('src/lib/stt/dictation.worklet.js', 'utf8'), {
    AudioWorkletProcessor: class { port = { messages: [], postMessage(data) { this.messages.push(data); } }; },
    registerProcessor: (_name, value) => { Processor = value; },
  });
  const processor = new Processor();
  processor.process([[frame(0.2, 128), frame(0.6, 128)]]);
  processor.port.onmessage({ data: { type: 'pause', id: 'flush' } });
  assert.equal(processor.port.messages[0].samples.length, 128);
  assert.ok(Math.abs(processor.port.messages[0].samples[0] - 0.4) < 0.0001);
  assert.deepEqual(JSON.parse(JSON.stringify(processor.port.messages[1])), { type: 'flushed', id: 'flush' });
  processor.process([[frame()]]); assert.equal(processor.offset, 0);
  processor.port.onmessage({ data: { type: 'resume' } });
  processor.process([[frame()]]); assert.equal(processor.offset, 10);
});

test('live request IDs do not take over cancellation of an existing recording', async () => {
  const bridgeFile = path.join(temp, 'bridge.mjs');
  const calls = [], requests = new Map(), listeners = new Map();
  globalThis.__dictationTestIpc = {
    on(channel, handler) { const current = listeners.get(channel) ?? new Set(); current.add(handler); listeners.set(channel, current); },
    removeListener(channel, handler) { listeners.get(channel)?.delete(handler); },
    invoke(channel, ...args) {
      calls.push([channel, ...args]);
      if (channel === 'study:stt:transcribe') {
        const pending = deferred(); requests.set(args[0].requestId, pending); return pending.promise;
      }
      return Promise.resolve();
    },
  };
  await build({ entryPoints: ['electron/preload/academic.ts'], outfile: bridgeFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'ipc-stub', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'ipc', namespace: 'dictation-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'dictation-test' }, () => ({ contents: 'export const ipcRenderer = globalThis.__dictationTestIpc;', loader: 'js' }));
    } }],
  });
  const { academicApi } = await import(pathToFileURL(bridgeFile));
  const request = { audioBytes: new Uint8Array([1]), mimeType: 'audio/wav', provider: 'whisper_cpp' };
  const recording = academicApi.transcribeStudyAudio(request);
  const recordingId = calls[0][1].requestId;
  const dictation = academicApi.transcribeStudyAudio({ ...request, requestId: 'scriptor-dictation-live' });
  await academicApi.cancelStudyTranscription();
  assert.deepEqual(calls.at(-1), ['study:stt:cancel', recordingId]);
  await academicApi.cancelStudyTranscription('scriptor-dictation-live');
  assert.deepEqual(calls.at(-1), ['study:stt:cancel', 'scriptor-dictation-live']);
  const complete = id => {
    for (const handler of listeners.get('study:stt:complete') ?? []) handler({}, id);
    requests.get(id).resolve({ text: 'Texto', model: 'base', provider: 'whisper_cpp' });
  };
  complete('scriptor-dictation-live'); await dictation;
  await academicApi.cancelStudyTranscription();
  assert.deepEqual(calls.at(-1), ['study:stt:cancel', recordingId]);
  complete(recordingId); await recording;
  assert.ok([...listeners.values()].every(set => set.size === 0), 'stream listeners are removed after both requests finish');
  delete globalThis.__dictationTestIpc;
});
