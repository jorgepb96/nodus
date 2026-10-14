// Locks in the local-model caution that now accompanies every picker than can end up
// running on the user's machine:
//  1. `isLocalModelProvider`/`isLocalModelRef` name exactly the providers whose weights
//     run locally (bundled `nodus` + a local server), and nothing else.
//  2. The tooltip copy exists in all twelve languages and the English wording is the
//     approved one, verbatim.
//  3. The mark is actually rendered wherever a processing/ideas or embedding model is
//     chosen, and the setup wizard no longer preselects a local model for a new vault.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

// providers.ts imports electron-only modules at the top level; the helpers under test are
// pure, so those specifiers are replaced with an empty module.
const stubElectronDeps = {
  name: 'stub-electron-deps',
  setup(builder) {
    builder.onResolve({ filter: /(^\.\.\/db\/|nodusLocalAi$|^electron$)/ }, (args) =>
      args.kind === 'entry-point' ? null : { path: args.path, namespace: 'stub' });
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export default {}; export const getSettings = () => ({});',
      loader: 'js',
    }));
  },
};

async function load(entry) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-local-warning-'));
  const outfile = path.join(tmp, 'mod.mjs');
  await build({
    entryPoints: [path.join(root, entry)], outfile, bundle: true, format: 'esm', platform: 'node',
    logLevel: 'silent', alias: { '@shared': path.join(root, 'shared') }, plugins: [stubElectronDeps],
  });
  return import(pathToFileURL(outfile).href);
}

test('the local-model predicate covers the bundled models and both local servers only', async () => {
  const { isLocalModelProvider, isLocalModelRef } = await load('shared/providers.ts');
  for (const provider of ['nodus', 'ollama', 'lmstudio']) {
    assert.equal(isLocalModelProvider(provider), true, `${provider} runs on this machine`);
  }
  // `custom` is an OpenAI-compatible endpoint the user typed: as often remote as local,
  // so it must never claim the local caveat.
  for (const provider of ['openai', 'anthropic', 'gemini', 'openrouter', 'custom', '', null, undefined]) {
    assert.equal(isLocalModelProvider(provider), false, `${String(provider)} must not be treated as local`);
  }
  assert.equal(isLocalModelRef({ provider: 'nodus', model: 'gemma-4-e2b-q4' }), true);
  assert.equal(isLocalModelRef({ provider: 'ollama', model: 'qwen3.5' }), true);
  assert.equal(isLocalModelRef({ provider: 'openai', model: 'gpt-5' }), false);
  assert.equal(isLocalModelRef(null), false);
});

test('the local-model warning is translated into every language, English verbatim', async () => {
  const { MODEL_SETTINGS_TRANSLATIONS } = await load('src/i18n.modelSettings.ts');
  const keys = [
    'Aviso sobre los modelos locales',
    'Los modelos locales pueden tardar bastante en procesar, sobre todo en equipos poco potentes. Nodus analiza los documentos por fragmentos en vez de enviarlos todos de golpe, y eso exige recursos incluso a los modelos pequeños.',
    'Todavía estamos optimizando los modelos locales incluidos. Gemma es ahora mismo la opción recomendada, aunque pueden quedar problemas menores. Ollama y LM Studio también son compatibles; los proveedores en la nube están mucho más probados y siguen siendo la opción más fiable para Nodus.',
    'Si encuentras cualquier problema, avísanos: los comentarios y las contribuciones que ayuden a mejorar el soporte de modelos locales son siempre bienvenidos.',
  ];
  const languages = ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko'];
  for (const key of keys) {
    for (const lang of languages) {
      const text = MODEL_SETTINGS_TRANSLATIONS[lang]?.[key];
      assert.ok(text?.trim(), `${lang} is missing a translation for "${key.slice(0, 40)}…"`);
    }
  }
  // The wording the caution was approved with; a reword must be deliberate, not a drive-by.
  const en = MODEL_SETTINGS_TRANSLATIONS.en;
  assert.equal(en[keys[1]], 'Local models may require significant processing time, especially on less powerful hardware. Nodus analyzes documents in multiple chunks rather than sending them all at once, which can be demanding even for smaller models.');
  assert.equal(en[keys[2]], "We're still optimizing the bundled local models. Gemma is currently the recommended option, although minor issues may remain. Ollama and LM Studio are also supported, while cloud providers have been more extensively tested and currently remain the most reliable option for Nodus.");
  assert.equal(en[keys[3]], 'If you encounter any problems, please report them — feedback and contributions that help improve local model support are always welcome.');
});

test('every place a processing/ideas or embedding model is chosen renders the red mark', async () => {
  const [modelPicker, searchable, embedding, localPanel, warning] = await Promise.all([
    read('src/components/ModelPicker.tsx'),
    read('src/components/SearchableModelSelect.tsx'),
    read('src/components/EmbeddingModelControl.tsx'),
    read('src/components/LocalAiModelsSettings.tsx'),
    read('src/components/LocalModelWarning.tsx'),
  ]);
  // The mark is one component: a red triangle that opens a portal tooltip on hover or click.
  assert.match(warning, /data-testid=\{testId\}/);
  assert.match(warning, /role="tooltip"/);
  assert.match(warning, /text-red-600/);
  assert.match(warning, /isLocalModelProvider/);
  // Every settings row (basic general model, advanced per-task models, vault and study
  // overrides) goes through ModelWithReasoning.
  assert.match(modelPicker, /<LocalModelWarning provider=\{value\?\.provider\} \/>/);
  // The wizard and the "load models" catalogues pick through the searchable list.
  assert.match(searchable, /<LocalModelWarning provider=\{value\?\.provider\}/);
  // The embeddings row chooses its provider outside the model list too.
  assert.match(embedding, /<LocalModelWarning provider=\{provider\}/);
  // The bundled-model panel states the same caveat before a download starts.
  assert.match(localPanel, /<LocalModelWarning provider="nodus"/);
});

test('new model roles stay empty while configured Simple chat roles are reused', async () => {
  const [onboarding, step, shared] = await Promise.all([
    read('src/views/Onboarding.tsx'),
    read('src/components/OnboardingModelStep.tsx'),
    read('shared/onboardingModels.ts'),
  ]);
  // Both pickers start empty — "Choose a model" — for the AI and the embedding role alike:
  // the settings are shared app-wide, so anything they carry belongs to another vault.
  assert.match(onboarding, /const \[aiModel, setAiModel\] = useState<ModelRef \| null>\(settings\.academicInterfaceProfile === 'simple' \? settings\.chatModel \?\? settings\.synthesisModel : null\)/);
  assert.match(onboarding, /const \[embeddingModel, setEmbeddingModel\] = useState<ModelRef \| null>\(settings\.academicInterfaceProfile === 'simple' && \(settings\.chatModel \|\| settings\.synthesisModel\)/);
  assert.doesNotMatch(onboarding, /isLocalModelRef\(settings/);
  // Nothing seeds them again: not a favorite, not the first discovered model, not the
  // value already stored in the settings.
  assert.doesNotMatch(step, /pickDefaultChoice|settings\.favorites|settings\.synthesisModel/);
  assert.equal(shared.includes('pickDefaultChoice'), false);
});
