// The Ming TTS catalogue, its language table and the retention rules are pure modules.
// Bundle the real files with esbuild and lock what the downloader and the retention
// sweep rely on: pinned revisions with exact sizes and hashes, platform filtering,
// language detection and per-surface retention inheritance.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-tts-catalogue-test-'));
try {
  const entry = path.join(tmp, 'entry.ts');
  await writeFile(entry, [
    `export * from ${JSON.stringify(path.join(repoRoot, 'shared/ttsModels.ts'))};`,
    `export * from ${JSON.stringify(path.join(repoRoot, 'shared/ttsLanguage.ts'))};`,
    `export * from ${JSON.stringify(path.join(repoRoot, 'shared/mingBuiltinVoices.ts'))};`,
    `export * from ${JSON.stringify(path.join(repoRoot, 'shared/phononVoices.ts'))};`,
    `export * from ${JSON.stringify(path.join(repoRoot, 'shared/kokoroVoices.ts'))};`,
  ].join('\n'));
  const outfile = path.join(tmp, 'tts.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const tts = await import(pathToFileURL(outfile).href);

  // ── Every published asset is pinned, sized and hashed ───────────────────────
  for (const model of tts.TTS_MODELS) {
    assert.ok(model.licenseLabel && model.licenseUrl, `${model.id} shows its license before download`);
    if (model.unpublished) { assert.equal(model.assets.length, 0); continue; }
    assert.ok(model.assets.some((a) => a.file === 'model.safetensors' || a.file === 'model.q8.gguf' || a.file.endsWith('.onnx')), `${model.id} has weights`);
    for (const asset of model.assets) {
      assert.match(asset.url, model.engine === 'kokoro'
        ? /^https:\/\/github\.com\/thewh1teagle\/kokoro-onnx\/releases\/download\/model-files-v1\.0\//
        : /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//, `${asset.file} pins a revision`);
      if (model.gated && asset.bytes < 1_000_000 && !asset.sha256) continue; // gated small text files: size only
      assert.match(asset.sha256, /^[0-9a-f]{64}$/, `${asset.file} has a SHA-256`);
      assert.ok(Number.isInteger(asset.bytes) && asset.bytes > 0, `${asset.file} has an exact size`);
    }
  }

  // ── Platform filtering: MLX only on Apple Silicon ───────────────────────────
  const mac = tts.ttsModelsForPlatform('darwin', 'arm64').map((m) => m.id);
  assert.ok(mac.includes('ming3-0.5b-mlx-8bit'));
  assert.ok(mac.includes('ming3-0.5b-mlx-4bit'), 'the published 4-bit MLX checkpoint is offered');
  for (const [platform, arch] of [['win32', 'x64'], ['linux', 'x64'], ['darwin', 'x64']]) {
    assert.deepEqual([...new Set(tts.ttsModelsForPlatform(platform, arch).map((m) => m.backend))], ['torch', 'phonon', 'kokoro']);
    assert.equal(tts.ttsBackendForPlatform(platform, arch), 'torch');
  }
  assert.equal(tts.defaultTtsModelId('darwin', 'arm64'), 'ming3-0.5b-mlx-8bit');

  // ── Phonon: licences, gating and the voice backend per model ───────────────
  for (const model of tts.TTS_MODELS.filter((m) => m.engine === 'phonon')) {
    assert.equal(tts.ttsBackendForModel(model, 'darwin', 'arm64'), 'phonon');
    assert.equal(Boolean(model.nonCommercial), model.licenseLabel.startsWith('CC BY-NC'), `${model.id} flags non-commercial terms`);
    assert.equal(Boolean(model.gated), Boolean(model.nonCommercial));
    assert.equal(model.cloning, false, 'public Phonon checkpoints cannot clone locally');
  }
  assert.deepEqual(tts.TTS_MODELS.find((m) => m.id === 'phonon-31m-en').languages, ['en']);
  assert.ok(tts.TTS_MODELS.find((m) => m.id === 'phonon-40m-es').languages.includes('es'));
  assert.deepEqual([...tts.PHONON_LANGUAGES], ['es', 'en', 'fr', 'de', 'pt'], 'Phonon can carry an es-ES catalogue voice');
  assert.ok(!tts.PHONON_LANGUAGES.includes('zh'), 'Phonon does not accept Ming-only languages');

  // ── Kokoro: one ONNX checkpoint, bundled voices, no cloning ─────────────────
  const kokoro = tts.TTS_MODELS.find((m) => m.id === 'kokoro-82m-int8');
  assert.equal(tts.ttsBackendForModel(kokoro, 'darwin', 'arm64'), 'kokoro');
  assert.equal(tts.ttsBackendForModel(kokoro, 'win32', 'x64'), 'kokoro');
  assert.equal(kokoro.engine, 'kokoro');
  assert.equal(kokoro.cloning, false);
  assert.deepEqual([...kokoro.languages], ['es', 'en']);
  assert.ok(kokoro.assets.some((asset) => asset.file.endsWith('.onnx')));
  assert.ok(kokoro.assets.some((asset) => asset.file === 'voices-v1.0.bin'));
  assert.equal(tts.KOKORO_VOICES.length, 31, 'the catalogue carries 31 English and Spanish voices');
  assert.ok(tts.KOKORO_VOICES.some((voice) => voice.id === 'ef_dora' && voice.language === 'es'));
  assert.ok(tts.KOKORO_VOICES.some((voice) => voice.id === 'af_heart' && voice.language === 'en'));
  assert.equal(tts.kokoroVoiceId('ef_dora'), 'kokoro:ef_dora');
  assert.ok(tts.isKokoroVoiceId('kokoro:ef_dora'));
  assert.equal(tts.isKokoroVoiceId('ef_dora'), false);

  // ── Language detection and resolution ───────────────────────────────────────
  assert.equal(tts.detectTtsLanguage('Los resultados sugieren que la concentración de zinc influye en la eficacia del proceso.'), 'es');
  assert.equal(tts.detectTtsLanguage('The results suggest that the concentration of zinc affects the process.'), 'en');
  assert.equal(tts.detectTtsLanguage('Les résultats suggèrent que la concentration de zinc est importante pour le processus.'), 'fr');
  assert.equal(tts.detectTtsLanguage('Die Ergebnisse zeigen, dass die Konzentration von Zink für den Prozess wichtig ist.'), 'de');
  assert.equal(tts.detectTtsLanguage('傍晚的风从山口吹过来，远处的云慢慢染成了金色。'), 'zh');
  assert.equal(tts.detectTtsLanguage('週末、駅前の小さな喫茶店で、季節限定の抹茶パフェを食べました'), 'ja');
  assert.equal(tts.detectTtsLanguage('오늘 날씨가 정말 좋아서 공원에 산책하러 갔어요.'), 'ko');
  assert.equal(tts.detectTtsLanguage('Hola'), null, 'too short to tell');
  assert.equal(tts.resolveTtsLanguage('fr', 'Hola, ¿qué tal estás hoy?', 'es'), 'fr', 'an explicit choice wins');
  assert.equal(tts.resolveTtsLanguage('auto', 'Hola', 'en'), 'en', 'falls back to the voice language');
  for (const language of tts.TTS_LANGUAGES) {
    assert.equal(language.requiresLanguageLine, !['zh', 'en', 'pt'].includes(language.code), `${language.code} language line matches Ming`);
  }

  // ── Retention: defaults, inheritance, overrides, sanitizing ─────────────────
  const defaults = tts.sanitizeTtsRetention(undefined);
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.days, 7);
  for (const surface of tts.TTS_SURFACES) assert.equal(tts.ttsRetentionDays(defaults, surface), 7);
  const custom = tts.sanitizeTtsRetention({
    enabled: false, days: 30,
    perSurface: { research_chat: { mode: 'days', days: 1 }, dictionary: { mode: 'off', days: 9 }, deep_research: { mode: 'bogus' } },
  });
  assert.equal(tts.ttsRetentionDays(custom, 'research_chat'), 1, 'a surface override applies even when global is off');
  assert.equal(tts.ttsRetentionDays(custom, 'dictionary'), null);
  assert.equal(tts.ttsRetentionDays(custom, 'deep_research'), null, 'inherit follows the disabled global rule');
  assert.equal(tts.sanitizeTtsRetention({ days: 99999 }).days, tts.TTS_RETENTION_MAX_DAYS);
  assert.equal(tts.sanitizeTtsRetention({ days: -3 }).days, 1);

  // ── Built-in voices: invocable ids only ──────────────────────────────────────
  const ids = new Set(tts.MING_BUILTIN_VOICES.map((v) => v.id));
  assert.equal(ids.size, tts.MING_BUILTIN_VOICES.length, 'voice ids are unique');
  for (const name of tts.MING_RECOMMENDED_VOICES) assert.ok(ids.has(name), `${name} is in the catalogue`);
  for (const voice of tts.MING_BUILTIN_VOICES) {
    assert.ok(['male', 'female'].includes(voice.gender), `${voice.id} has a gender`);
    const invocation = tts.mingBuiltinInvocation(voice);
    if (voice.emotions) assert.notEqual(invocation, voice.id, `${voice.id} is invoked through a variant`);
  }
  assert.ok(tts.MING_BUILTIN_VOICES.filter((v) => v.language === 'en').length === 5);
  assert.equal(tts.PHONON_VOICES.length, 102);
  assert.ok(tts.PHONON_VOICES.filter((v) => v.locale === 'es-es').length >= 10, 'Castilian voices are listed');
  for (const voice of tts.PHONON_VOICES) assert.match(voice.sha256, /^[0-9a-f]{64}$/);
  console.log('tts catalogue tests passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
