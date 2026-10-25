// Real catalogue/library/service routing; inference and network calls are observed at their boundaries.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadTs, loadTsStubbed } from './drift-test-utils.mjs';

const { POCKET_MODEL_ID, pocketVoiceAsset, POCKET_VOICES } = loadTs('shared/pocketTts.ts');
const { TtsVoiceLibrary } = loadTs('electron/tts/voices.ts');
const { ttsReady } = loadTs('src/lib/narration/ttsClient.ts');

function wav() {
  const data = Buffer.alloc(44 + 24000 * 4 * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(24000, 24); data.writeUInt32LE(48000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}

test('Pocket references persist without transcripts, while Ming keeps its validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-pocket-library-'));
  try {
    const library = new TtsVoiceLibrary(path.join(root, 'voices'), path.join(root, 'bundled'));
    const input = { name: 'Mi voz', language: 'es', origin: 'uploaded', transcript: '', consent: true, wav: wav() };
    await assert.rejects(library.save(input), /TTS_VOICE_INVALID/);
    await assert.rejects(library.save({ ...input, engine: 'pocket', consent: false }), /CONSENT_REQUIRED/);
    const saved = await library.save({ ...input, engine: 'pocket' });
    const reopened = new TtsVoiceLibrary(library.root, library.bundledDir);
    const ref = await reopened.resolve(saved.id);
    assert.equal(ref.ref.kind, 'clone');
    assert.equal(ref.ref.text, '');
    assert.equal((await stat(ref.ref.wavPath)).size, wav().length);
    await reopened.update(saved.id, { name: 'Voz guardada', transcript: '' });
    assert.equal((await reopened.list()).find((voice) => voice.id === saved.id).name, 'Voz guardada');
    const catalogue = (await reopened.list()).filter((voice) => voice.origin === 'pocket');
    assert.equal(catalogue.length, 27);
    assert.ok(catalogue.some((voice) => voice.id === 'pocket:lola' && voice.language === 'es'));
    assert.ok(catalogue.every((voice) => voice.readOnly && !voice.downloaded));
    await reopened.remove(saved.id);
    await assert.rejects(reopened.resolve(saved.id), /NOT_FOUND/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Pocket uses its own runtime, routes language-specific voices and reuses saved references', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-pocket-service-'));
  const settings = { ttsModelId: POCKET_MODEL_ID, ttsPocketVoiceId: 'pocket:lola', ttsVoiceId: 'ming:default', ttsLanguage: 'auto', ttsIdleUnloadMin: 5 };
  const calls = [];
  globalThis.__pocketTest = { root, settings, calls };
  try {
    const { TtsService } = await loadTsStubbed('electron/tts/service.ts', { stubs: {
      '/db/settingsRepo$': 'exports.getSettings = () => globalThis.__pocketTest.settings;',
      '/ai/nodusLocalAi$': `exports.probeNvidia = async () => ({detected: true});
        exports.downloadVerifiedNodusAsset = async (...args) => { globalThis.__pocketTest.calls.push(args); };`,
      '/secrets/secretStore$': 'exports.getAudioKey = () => null;',
      '/audio/audioService$': 'exports.pruneOrphanScriptorNarration = () => 0;',
      '/db/audioClipsRepo$': 'module.exports = {};',
      '/perf$': 'module.exports = {};',
      '^./paths$': `const p = require('node:path'); const r = globalThis.__pocketTest.root;
        for (const [name, leaf] of Object.entries({ttsRuntimeDir:'runtime', ttsModelsDir:'models', ttsVoicesDir:'voices', ttsBundledVoicesDir:'bundled', ttsAssetsDir:'assets', ttsBundledPythonRoot:'python', ttsLiveDir:'live', ttsLogPath:'log'})) exports[name] = () => p.join(r,leaf);
        exports.directoryBytes = async () => 0;`,
    } });
    const service = new TtsService();
    const resident = { python: '/fixture/python', backend: 'pocket', device: 'cpu' };
    service.pocketInstaller.installed = async () => resident;
    service.installer.installed = service.phononInstaller.installed = service.kokoroInstaller.installed = async () => null;
    service.models.isReady = async () => true;
    const requests = [];
    service.host.synth = (model, request) => {
      requests.push({ model, request });
      return { jobId: `job-${requests.length}`, done: Promise.resolve({ cancelled: false, fragments: [] }) };
    };
    assert.equal((await service.status()).pocketRuntime.installed, true);
    assert.equal((await service.status()).runtime.installed, false);
    assert.equal((await service.status()).pocketRuntime.device, 'cpu');
    const started = await service.speak({ text: 'Esta es una prueba de la voz en español.' });
    assert.equal(started.language, 'es');
    assert.equal(started.voiceId, 'pocket:lola');
    assert.equal(requests[0].model, POCKET_MODEL_ID);
    assert.equal(requests[0].request.voice.kind, 'embedding');
    assert.equal(calls[0][0], pocketVoiceAsset('lola', 'es').url);
    assert.equal(calls[0][3], pocketVoiceAsset('lola', 'es').sha256);
    await service.speak({ text: 'The results are important for this study.', language: 'en' });
    assert.equal(calls[1][0], pocketVoiceAsset('lola', 'en').url, 'precomputed states follow the target language');
    await assert.rejects(service.speak({ text: 'Hola.', voiceId: 'ming:default' }), /ENGINE_MISMATCH/);
    await assert.rejects(service.speak({ text: 'Hola.', voiceId: 'kokoro:ef_dora' }), /ENGINE_MISMATCH/);
    await assert.rejects(service.speak({ text: 'Hola.', voiceId: 'pocket:missing' }), /VOICE_NOT_FOUND/);
    const voice = await service.saveVoice({ name: 'Referencia', engine: 'pocket', language: 'es', origin: 'uploaded', transcript: '', consent: true, wav: wav() });
    const clone = await service.speak({ text: 'Una voz guardada para esta prueba.', voiceId: voice.id });
    assert.equal(clone.voiceId, voice.id);
    assert.equal(requests.at(-1).request.voice.kind, 'clone');
    assert.equal(requests.at(-1).request.voice.text, '');
    assert.ok(requests.at(-1).request.voice.cacheDir.startsWith(path.join(root, 'voices')));
    for (const voice of POCKET_VOICES) await service.downloadVoice(`pocket:${voice.id}`);
    assert.equal(calls.length, 29, 'all optional catalogue voices use the existing verified downloader');
    assert.ok(calls.every(([url, , bytes, sha]) => url.includes('/resolve/') && bytes > 0 && /^[a-f0-9]{64}$/.test(sha)));
    await assert.rejects(service.downloadVoice('pocket:../../escape'), /VOICE_NOT_FOUND/);
  } finally { delete globalThis.__pocketTest; await rm(root, { recursive: true, force: true }); }
});

test('a Ming installation never makes Pocket ready', () => {
  const status = {
    runtime: { installed: true }, pocketRuntime: { installed: false },
    models: [{ id: POCKET_MODEL_ID, downloaded: true }],
  };
  assert.equal(ttsReady(status, POCKET_MODEL_ID), false);
  status.pocketRuntime.installed = true;
  assert.equal(ttsReady(status, POCKET_MODEL_ID), true);
});

test('removing Ming preserves the independent Pocket environment', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-pocket-runtime-'));
  try {
    const { TtsInstaller } = loadTs('electron/tts/install.ts');
    for (const entry of ['pocket', 'phonon', 'kokoro', 'env-fixture', 'interpreter']) await mkdir(path.join(root, entry));
    await writeFile(path.join(root, 'installed.json'), '{}');
    const host = { platform: 'darwin', arch: 'arm64', hasNvidia: async () => false };
    const ming = new TtsInstaller(root, '', '', host);
    await ming.remove();
    assert.ok((await stat(path.join(root, 'pocket'))).isDirectory());
    await assert.rejects(stat(path.join(root, 'installed.json')), { code: 'ENOENT' });
    const pocket = new TtsInstaller(path.join(root, 'pocket'), '', '', host, undefined, 'pocket');
    await pocket.remove();
    await assert.rejects(stat(path.join(root, 'pocket')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Pocket always installs the CPU lock, including on Apple Silicon and NVIDIA hosts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-pocket-install-'));
  try {
    const { TtsInstaller } = loadTs('electron/tts/install.ts');
    for (const [platform, arch] of [['darwin', 'arm64'], ['win32', 'x64'], ['linux', 'x64']]) {
      const installer = new TtsInstaller(root, '', '', {
        platform, arch, hasNvidia: async () => { throw new Error('Pocket must not probe GPUs'); },
      }, undefined, 'pocket');
      installer.build = async flavor => { assert.equal(flavor, 'pocket'); return { backend: 'pocket', device: 'cpu' }; };
      assert.equal((await installer.install(() => {})).device, 'cpu');
    }
    const unsupported = new TtsInstaller(root, '', '', { platform: 'darwin', arch: 'x64', hasNvidia: async () => false }, undefined, 'pocket');
    await assert.rejects(unsupported.install(() => {}), /PLATFORM_UNSUPPORTED/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
