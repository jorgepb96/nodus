import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './drift-test-utils.mjs';

const { resolveTtsVoiceFilters, sanitizeTtsVoiceFilters } = loadTs('shared/ttsVoiceFilters.ts');
const { TTS_MODELS } = loadTs('shared/ttsModels.ts');
const ming = TTS_MODELS.find((model) => model.engine === 'ming');
const phonon = TTS_MODELS.find((model) => model.engine === 'phonon' && model.languages.length === 1);

test('automatic voice filters follow model changes and the interface locale', () => {
  assert.deepEqual(resolveTtsVoiceFilters({}, ming, 'en'), { engines: ['ming'], languages: ['en'], modelLanguages: ming.languages });
  assert.deepEqual(resolveTtsVoiceFilters({}, phonon, 'es'), { engines: ['phonon'], languages: ['es'], modelLanguages: phonon.languages });
  for (const [locale, language] of [['pt-BR', 'pt'], ['zh-CN', 'zh'], ['zh-TW', 'zh'], ['ja', 'ja']]) {
    assert.deepEqual(resolveTtsVoiceFilters({}, ming, locale).languages, [language]);
  }
  assert.deepEqual(resolveTtsVoiceFilters({}, ming, 'it').languages, [], 'unsupported speech languages leave the voice list open');
});

test('manual filters override each automatic default independently, including All', () => {
  const allModels = resolveTtsVoiceFilters({ engines: [] }, phonon, 'fr');
  assert.deepEqual(allModels.engines, []);
  assert.equal(allModels.modelLanguages, undefined, 'all models removes the automatic checkpoint language restriction');
  assert.deepEqual(allModels.languages, ['fr']);
  const allLanguages = resolveTtsVoiceFilters({ languages: [] }, ming, 'en');
  assert.deepEqual(allLanguages.languages, []);
  assert.deepEqual(allLanguages.engines, ['ming']);
  assert.deepEqual(allLanguages.modelLanguages, ming.languages);
  const preferences = { engines: ['kokoro'], languages: ['es', 'fr'] };
  const restored = sanitizeTtsVoiceFilters(JSON.parse(JSON.stringify(preferences)));
  assert.deepEqual(resolveTtsVoiceFilters(restored, phonon, 'ja'), { ...preferences, modelLanguages: undefined });
});

test('stored filters discard invalid entries without losing explicit empty overrides', () => {
  assert.deepEqual(sanitizeTtsVoiceFilters(null), {});
  assert.deepEqual(sanitizeTtsVoiceFilters({ engines: 'ming', languages: 'en' }), {});
  assert.deepEqual(sanitizeTtsVoiceFilters({ engines: ['ming', 'ming', 'invalid'], languages: ['es', 'es', 'invalid'] }), { engines: ['ming'], languages: ['es'] });
  assert.deepEqual(sanitizeTtsVoiceFilters({ engines: [], languages: [] }), { engines: [], languages: [] });
});
