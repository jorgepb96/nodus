// Contract test for independent model routing. This is intentionally source-
// level: it guards the UI/backend wiring that previously let one header selector
// override unrelated scans, summaries and feature-local choices.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = async (relative) => readFile(path.join(root, relative), 'utf8');

const app = await source('src/App.tsx');
const header = app.slice(app.indexOf('{/* Top bar */}'), app.indexOf('{settings.demoMode'));
assert.ok(!header.includes('settings.defaultModel'), 'header must not depend on the legacy global model');
assert.ok(!header.includes('settings.favorites.map'), 'header must not render a model selector');
assert.ok(app.includes('dataTour="theme-toggle"'), 'header exposes a quick theme toggle');
assert.ok(app.indexOf('dataTour="theme-toggle"') < app.indexOf('icon="settings"', app.indexOf('dataTour="theme-toggle"')), 'theme toggle appears before settings');
assert.ok(app.includes("icon={isDark ? 'sun' : 'moon'}"), 'theme toggle reflects the resolved theme');
assert.ok(!app.includes('updateSettings({ defaultModel'), 'App must never mutate a global model');

for (const file of ['src/views/Library.tsx', 'src/views/CollectionsModal.tsx', 'src/views/ThemesModal.tsx']) {
  const text = await source(file);
  assert.ok(!text.includes('scanModel'), `${file} must not override workload models`);
  assert.ok(!text.includes("from '../components/ModelPicker'"), `${file} must not expose a scan-wide picker`);
}

const featureBindings = new Map([
  ['src/views/DeepResearchView.tsx', 'deepResearchModel'],
  ['src/views/ImmersionView.tsx', 'immersionModel'],
  ['src/views/WritingWorkshopView.tsx', 'writingModel'],
  ['src/views/ArgumentMapView.tsx', 'argumentMapModel'],
  ['src/views/AuthorsView.tsx', 'authorModel'],
  ['src/views/TutorPanel.tsx', 'tutorModel'],
  ['src/views/HypothesisLabView.tsx', 'hypothesisModel'],
]);
for (const [file, key] of featureBindings) {
  const text = await source(file);
  assert.ok(text.includes(`useFeatureModel(settings, '${key}')`), `${file} must persist ${key}`);
}

const researchChat = await source('src/views/ResearchAssistantModal.tsx');
assert.ok(researchChat.includes("useFeatureModel(settings, adapter?.modelFeature ?? 'chatModel', adapter?.modelFeature === 'studyModel' ? 'chatModel' : undefined)"), 'shared research chat uses the adapter-specific model setting and preserves the study-to-chat fallback');
assert.match(await source('src/views/StudyChatView.tsx'), /modelFeature: 'studyModel'/);
const hook = await source('src/hooks/useFeatureModel.ts');
assert.ok(hook.includes("modelSettingsMode: 'advanced'"), 'choosing a feature model must enter advanced mode');
assert.ok(hook.includes('[key]: next'), 'feature choices must persist in vault settings');
assert.ok(hook.includes('settings[key] ?? (fallbackKey ? settings[fallbackKey] : null) ?? settings.synthesisModel'), 'unselected features must inherit the general model');

const studyModelKeys = ['improveModel', 'questionGenModel', 'gradingModel', 'flashcardModel', 'transcriptionModel'];
const settingsTypes = await source('shared/types.ts');
const defaults = await source('shared/defaultAppSettings.ts');
const appPrefs = await source('electron/db/appPrefs.ts');
for (const key of ['synthesisModel', 'sttProvider', 'audioProvider']) {
  assert.ok(appPrefs.includes(`  '${key}',`), `${key} must be shared as a common capability setting`);
}
for (const key of ['modelSettingsMode', 'modelSettingsVersion', 'embeddingProvider', 'embeddingModel']) {
  assert.ok(!appPrefs.includes(`  '${key}',`), `${key} must stay with the vault whose task choices and vector index it describes`);
}
for (const key of studyModelKeys) {
  assert.ok(settingsTypes.includes(`${key}: ModelRef | null`), `${key} must be typed independently`);
  assert.ok(defaults.includes(`${key}: null`), `${key} must have a backwards-compatible default`);
  if (key === 'transcriptionModel') assert.ok(appPrefs.includes(`  '${key}',`), `${key} is an app-wide transcription capability`);
  else assert.ok(!appPrefs.includes(`  '${key}',`), `${key} must remain specific to the active vault`);
  assert.ok(hook.includes(`'${key}'`), `${key} must be accepted by the feature-model hook`);
}
for (const key of ['nodiModel']) {
  assert.ok(settingsTypes.includes(`${key}: ModelRef | null`), `${key} must be typed independently`);
  assert.ok(defaults.includes(`${key}: null`), `${key} must have a backwards-compatible default`);
  assert.ok(appPrefs.includes(`'${key}'`), `${key} must follow shared model preferences across vaults`);
}
assert.ok(settingsTypes.includes('sttProvider: StudySttProvider'), 'STT backend must be explicit');
assert.ok(defaults.includes("sttProvider: 'transformers'"), 'STT must default to local ONNX processing');
for (const key of ['sttTransformersModel', 'sttWhisperCppModel', 'sttWhisperCppExecutable']) {
  assert.ok(settingsTypes.includes(`${key}: string`), `${key} must be persisted in settings`);
  assert.ok(appPrefs.includes(`'${key}'`), `${key} must follow app-wide STT preferences`);
}

const light = await source('electron/ai/lightScan.ts');
const deep = await source('electron/ai/deepScan.ts');
const summary = await source('electron/ai/summaryScan.ts');
const reprocess = await source('electron/ai/reprocessConnections.ts');
assert.ok(light.includes('settings.extractionModel ?? settings.synthesisModel'), 'light scans must inherit the general model');
assert.ok(deep.includes('settings.extractionModel') && deep.includes('settings.fusionModel'), 'deep scans must split extraction and fusion');
assert.ok(summary.includes('settings.summaryModel ?? settings.synthesisModel'), 'summaries must inherit the general model');
assert.ok(reprocess.includes('settings.extractionModel') && reprocess.includes('settings.fusionModel'), 'theme/relation reprocessing must split models');

const onboarding = await source('src/views/Onboarding.tsx');
assert.ok(!onboarding.includes('defaultModel: aiModel'), 'onboarding must not recreate the global selector');
assert.ok(onboarding.includes('synthesisModel: aiModel'), 'onboarding must initialize the general model');
assert.ok(onboarding.includes("modelSettingsMode: 'basic'"), 'onboarding must keep simplified settings active');
for (const field of ['extractionModel', 'summaryModel', 'fusionModel']) assert.ok(!onboarding.includes(`${field}: aiModel`), `${field} must inherit after onboarding`);

const settingsView = await source('src/views/Settings.tsx');
for (const marker of ['model-settings-mode', 'common-model-overrides', 'vault-model-overrides', 'Ajustes avanzados del vault {vault}']) {
  assert.ok(settingsView.includes(marker), `settings must expose ${marker}`);
}
assert.ok(settingsView.includes('pendingModelSettingsMode'), 'mode changes must wait for explicit confirmation');
assert.ok(settingsView.includes('confirm-model-settings-mode'), 'mode confirmation must have a stable test hook');
assert.ok(settingsView.includes('setPendingModelSettingsMode(mode)'), 'mode buttons must open the confirmation instead of persisting immediately');
assert.ok(settingsView.includes('Solo puede haber un modo de configuración activo.'), 'settings must explain that basic and advanced are mutually exclusive');
assert.ok(!settingsView.includes('onClick={() => void patch({ modelSettingsMode: mode })}'), 'browsing another mode must never persist it immediately');
assert.ok(!settingsView.includes('Heredar modelo general'), 'advanced model selectors must contain concrete choices, not inheritance options');
assert.ok(settingsView.includes('gap-x-4 gap-y-3'), 'study model dropdowns must have horizontal and vertical separation');

// The general text model must be reachable from its own row.
//
// ModelPicker offers favourites plus whatever is currently selected and nothing else,
// and nothing in this screen could create the first favourite: the only place that read
// a provider's catalogue was the setup wizard. A vault that finished setup without a
// model — or whose one selection stopped being a favourite, which is what deleting a
// downloaded built-in model does — reached a picker whose only entry was "no model
// selected", with the fix two sections away in Providers and nothing on screen saying
// so. Reinstalling was a rational thing to try, and users did.
assert.ok(settingsView.includes('<GeneralTextModelControl settings={settings} patch={patch} />'),
  'the basic-mode general model row must carry its own catalogue, not a favourites-only picker');
const generalModel = await source('src/components/GeneralTextModelControl.tsx');
assert.ok(generalModel.includes('autoDiscoverableAiProviders'),
  'loading models must ask every provider that already answers, exactly as the wizard does');
assert.ok(generalModel.includes('general-text-model-load') && generalModel.includes('general-text-model-catalog'),
  'the load action and the catalogue need stable test hooks');
assert.ok(/favorites: \[\.\.\.favorites, model\]/.test(generalModel),
  'choosing from the catalogue must also star the model, or the picker above stays empty afterwards');
assert.ok(generalModel.includes('modelRefSupportsExtraction'),
  'the catalogue must apply the same extraction rule as the picker it feeds');
assert.ok(generalModel.includes('general-text-model-empty'),
  'an empty picker must say where models come from instead of looking broken');

// A failed step has to say why. `deep_error` is stored in Spanish by the main process and
// is not one of the `message`/`error` field names localizeIpcPayload sweeps, so it used to
// reach the reader untouched while every neighbouring line went through t().
const workStatus = await source('src/views/WorkStatusModal.tsx');
assert.ok(workStatus.includes('localizeRuntimeError(work.deep_error, getActiveLang())'),
  'the ideas failure reason must be localized, not rendered raw');
assert.ok(!/return work\.deep_error;/.test(workStatus), 'no raw Spanish may reach a non-Spanish interface');
assert.ok(workStatus.includes('localizeRuntimeError(work.notes, getActiveLang())'),
  'a failed light scan already persists its reason into notes — show it instead of a dash');
assert.ok((workStatus.match(/El paso falló sin dejar un motivo\./g) ?? []).length === 2,
  'themes and summary both explain a failure that stored no reason');

const allowedLegacyFiles = new Set([
  'shared/types.ts',
  'electron/db/settingsRepo.ts',
  'shared/defaultAppSettings.ts',
  'electron/export/exportImport.ts',
  // The Word/LibreOffice bridge keeps this response field as a compatibility wire
  // contract, but derives it from the independent flow models rather than settings.defaultModel.
  'electron/copilot/server.ts',
]);
const collect = async (directory) => {
  const out = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await collect(relative)));
    else if (/\.tsx?$/.test(entry.name)) out.push(relative);
  }
  return out;
};
for (const file of [...(await collect('src')), ...(await collect('electron')), ...(await collect('shared'))]) {
  if (allowedLegacyFiles.has(file)) continue;
  assert.ok(!(await source(file)).includes('defaultModel'), `${file} still uses the legacy global model`);
}

console.log('independent model selection contract test passed');
