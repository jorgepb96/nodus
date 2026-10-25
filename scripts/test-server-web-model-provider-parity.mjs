import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { desktopSettingsPatchFromServerProfile, sanitizeServerProfilePreferences } from '../shared/serverProfilePreferences.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const view = variants(await readFile(path.join(root, 'src/serverWeb/settings/ServerSettingsView.tsx'), 'utf8'));
const css = await readFile(path.join(root, 'src/serverWeb/settings/ServerSettings.css'), 'utf8');
const profileSync = await readFile(path.join(root, 'electron/serverSync/profilePreferencesSync.ts'), 'utf8');
const replicaSync = await readFile(path.join(root, 'electron/serverSync/replicaService.ts'), 'utf8');
const providerGateway = await readFile(path.join(root, 'server/lib/ai/providerGateway.mjs'), 'utf8');
const aiRoutes = await readFile(path.join(root, 'server/lib/routes/ai.mjs'), 'utf8');
const serverApi = await readFile(path.join(root, 'src/serverWeb/api.ts'), 'utf8');
const electronIpc = await readFile(path.join(root, 'electron/ipc.ts'), 'utf8');

function profileWithFavorites(favorites) {
  const modelFields = [
    'extraction', 'vision', 'synthesis', 'summary', 'documentProfile', 'documentAudit',
    'fusion', 'assistant', 'nodi', 'deepResearch', 'immersion', 'writing', 'argumentMap',
    'author', 'dictionary', 'study', 'tutor', 'hypothesis', 'improve', 'questions',
    'grading', 'flashcards', 'transcription',
  ];
  return {
    schemaVersion: 1,
    appearance: {
      theme: 'dark', uiLanguage: 'es', promptLanguage: 'es', animationSpeed: 1,
      interfaceScale: 1, accessibleFont: false, highContrast: false, reduceMotion: false,
      readingFocusMode: false,
      mascot: { enabled: true, scale: 1, vaultCostumes: true, style: 'classic', orbColorMode: 'auto', orbColor: '#6366f1' },
    },
    ai: {
      favorites, modelSettingsMode: 'basic', modelSettingsVersion: 0,
      models: Object.fromEntries(modelFields.map((field) => [field, null])),
      chatReasoning: 'medium', codexReasoningEfforts: {}, preferFastOpenRouter: true,
      providerFreeTier: {},
      image: { provider: 'google', model: 'gemini-3.1-flash-lite-image', quality: 'balanced', style: 'antique_book' },
      audio: { provider: 'ming', voice: '', speed: 1 },
      studyPolicy: {
        enabled: true, privacyMode: 'hybrid', confirmExternal: true, monthlyBudgetUsd: 0,
        budgetWarningPercent: 80, maxInputChars: 120000, maxOutputTokens: 4000,
        temperature: 0.15, retryCount: 1, studentPseudonyms: true,
      },
    },
    workspace: {
      sidebarOrder: [], sidebarHidden: [], sidebarCustomized: false, toolkitPinnedPages: [], concurrency: 2,
      deepContextMode: 'standard', standardChunkWords: 1800, longChunkWords: 30000,
    },
  };
}

test('Server provider settings use Desktop provider identity and star-list interaction', () => {
  assert.match(view, /AI_PROVIDERS\.map\(\(provider\)/, 'the shared Desktop provider order is the source of truth');
  assert.doesNotMatch(view, /AI_PROVIDERS\.concat\(['"]nodus['"]\)/, 'Nodus local is not fabricated as a Desktop provider row');
  assert.doesNotMatch(view, /ss-add-favorite/, 'the old provider/model form is gone');
  assert.match(view, /data-testid=\{`provider-model-list-\$\{provider\}`\}/);
  assert.match(view, /aria-pressed=\{favorite\}/, 'models are favourited from the same star list pattern as Desktop');
  assert.match(css, /\.ss-provider-model-row\[data-favorite='true'\]/);
  assert.match(css, /\.ss-favorite-button\[aria-pressed='true'\]/);
});

test('feature model controls are real dropdowns backed only by portable favorites', () => {
  assert.match(view, /function ModelSelect/);
  assert.match(view, /return \(\s*<select className="ss-select"/);
  assert.match(view, /\.\.\.favorites/);
  assert.doesNotMatch(view, /<input[^>]+settings-model-/, 'model task controls are not free-text forms');
});

test('portable favorites are canonical across vaults and devices', () => {
  const canonical = sanitizeServerProfilePreferences(profileWithFavorites([
    { provider: 'openai', model: 'gpt-test', reasoningEffort: 'low' },
    { provider: 'openai', model: 'gpt-test', reasoningEffort: 'high' },
    { provider: 'gemini', model: 'gemini-test' },
  ]));
  assert.deepEqual(canonical.ai.favorites, [
    { provider: 'openai', model: 'gpt-test', reasoningEffort: 'high' },
    { provider: 'gemini', model: 'gemini-test' },
  ]);
  assert.equal(Object.hasOwn(canonical, 'providerKeys'), false, 'the portable profile cannot carry credentials');
  assert.equal(canonical.workspace.aiConcurrencyMode, 'automatic', 'legacy profiles graduate to automatic');
  assert.equal(canonical.workspace.aiConcurrencyVersion, 1);

  const explicitManual = profileWithFavorites([]);
  explicitManual.workspace.aiConcurrencyMode = 'manual';
  explicitManual.workspace.aiConcurrencyVersion = 1;
  assert.equal(sanitizeServerProfilePreferences(explicitManual).workspace.aiConcurrencyMode, 'manual', 'explicit manual survives profile sync');
});

test('a new Server profile does not invent a model selection', () => {
  assert.match(view, /const preferred = preferences\.defaultProvider;/);
  assert.match(view, /favorites: preferences\.favorites \|\| \(assistant \? \[assistant\] : \[\]\)/);
  assert.match(view, /modelSettingsVersion: 0/);
  assert.match(view, /monthlyBudgetUsd: 0/);
});

test('Server-Web profile changes are pulled back into Desktop without secrets', () => {
  const portable = profileWithFavorites([{ provider: 'openai', model: 'gpt-test' }]);
  portable.appearance.theme = 'light';
  portable.ai.models.assistant = { provider: 'openai', model: 'gpt-test' };
  const patch = desktopSettingsPatchFromServerProfile(portable);
  assert.equal(patch.theme, 'light');
  assert.deepEqual(patch.chatModel, { provider: 'openai', model: 'gpt-test' });
  assert.deepEqual(patch.favorites, [{ provider: 'openai', model: 'gpt-test' }]);
  assert.equal(Object.hasOwn(patch, 'providerKeys'), false);
  for (const forbidden of ['providerKeys', 'mcpToken', 'nodusServerToken', 'embeddingModel', 'embeddingProvider']) {
    assert.equal(Object.hasOwn(patch, forbidden), false, `${forbidden} must stay outside the portable pull`);
  }
  assert.match(profileSync, /desktopSettingsPatchFromServerProfile/);
  assert.match(profileSync, /remote\?\.source\?\.kind === 'server-web'/);
  assert.match(profileSync, /return 'pulled'/);
  assert.match(replicaSync, /syncServerProfilePreferencesForVault\(vault, undefined, \{ pull: true \}\)/);
  assert.match(profileSync, /appliedHandler\?\.\(next\)/);
  assert.match(electronIpc, /setServerProfilePreferencesAppliedHandler/);
  assert.match(electronIpc, /webContents\.send\('settings:changed', next\)/);
});

test('configured Server providers expose the same live model-catalog flow as Desktop', () => {
  assert.match(providerGateway, /async listModels\(\{ userId, provider \}\)/);
  assert.match(providerGateway, /api\.openai\.com\/v1\/models/);
  assert.match(providerGateway, /api\.anthropic\.com\/v1\/models/);
  assert.match(providerGateway, /generativelanguage\.googleapis\.com\/v1beta\/models/);
  assert.match(aiRoutes, /segments\[6\] === 'models'/);
  assert.match(aiRoutes, /gateway\.listModels/);
  assert.match(serverApi, /aiProviderModels/);
  assert.match(view, /api\s*\.aiProviderModels\(provider\)/);
  assert.match(view, /Catálogo en vivo del proveedor/);
});
