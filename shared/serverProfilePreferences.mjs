/**
 * Portable, non-secret user preferences shared between Nodus Desktop and Server.
 *
 * This is deliberately an allowlist, not a redaction pass over AppSettings. AppSettings
 * also contains API-key presence, local URLs, bearer tokens, filesystem paths, backup
 * policy and the vault's immutable embedding selection. None of those fields may cross
 * this boundary, even when a future setting is added to Desktop.
 */
import { APP_THEME_IDS, sanitizeCustomThemes } from './appThemes.mjs';
import { migrateScriptorSidebar } from './scriptorNavigation.mjs';

export const SERVER_PROFILE_PREFERENCES_VERSION = 1;

export const SERVER_PROFILE_MODEL_FIELDS = Object.freeze([
  'extraction', 'vision', 'synthesis', 'summary', 'documentProfile', 'documentAudit',
  'fusion', 'assistant', 'nodi', 'deepResearch', 'immersion', 'writing', 'argumentMap',
  'author', 'dictionary', 'study', 'tutor', 'hypothesis', 'improve', 'questions',
  'grading', 'flashcards', 'transcription',
]);

const DESKTOP_MODEL_FIELDS = Object.freeze({
  extraction: 'extractionModel',
  vision: 'visionModel',
  synthesis: 'synthesisModel',
  summary: 'summaryModel',
  documentProfile: 'documentProfileModel',
  documentAudit: 'documentAuditModel',
  fusion: 'fusionModel',
  assistant: 'chatModel',
  nodi: 'nodiModel',
  deepResearch: 'deepResearchModel',
  immersion: 'immersionModel',
  writing: 'writingModel',
  argumentMap: 'argumentMapModel',
  author: 'authorModel',
  dictionary: 'dictionaryModel',
  study: 'studyModel',
  tutor: 'tutorModel',
  hypothesis: 'hypothesisModel',
  improve: 'improveModel',
  questions: 'questionGenModel',
  grading: 'gradingModel',
  flashcards: 'flashcardModel',
  transcription: 'transcriptionModel',
});

const ROOT_KEYS = new Set(['schemaVersion', 'appearance', 'ai', 'workspace']);
const APPEARANCE_KEYS = new Set([
  'theme', 'appTheme', 'customThemes', 'uiLanguage', 'promptLanguage', 'animationSpeed', 'interfaceScale',
  'accessibleFont', 'highContrast', 'reduceMotion', 'readingFocusMode', 'mascot',
]);
const MASCOT_KEYS = new Set(['enabled', 'scale', 'vaultCostumes', 'style', 'orbColorMode', 'orbColor']);
const AI_KEYS = new Set([
  'favorites', 'modelSettingsMode', 'modelSettingsVersion', 'models', 'chatReasoning',
  'codexReasoningEfforts', 'preferFastOpenRouter', 'providerFreeTier', 'image', 'audio',
  'studyPolicy', 'pendingAssignments',
]);
const IMAGE_KEYS = new Set(['provider', 'model', 'quality', 'style', 'pending']);
const AUDIO_KEYS = new Set(['provider', 'voice', 'speed', 'pending']);
const STUDY_KEYS = new Set([
  'enabled', 'privacyMode', 'confirmExternal', 'monthlyBudgetUsd', 'budgetWarningPercent',
  'maxInputChars', 'maxOutputTokens', 'temperature', 'retryCount', 'studentPseudonyms',
]);
const WORKSPACE_KEYS = new Set([
  'sidebarOrder', 'sidebarHidden', 'sidebarCustomized', 'scriptorSidebarVersion', 'toolkitPinnedPages', 'aiConcurrencyMode', 'aiConcurrencyVersion', 'concurrency', 'deepContextMode',
  'standardChunkWords', 'longChunkWords',
]);
const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:/+-]{1,200}$/;
const REASONING_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const SECRET_VALUE_PATTERNS = Object.freeze([
  /\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{12,}\b/,
  /\b(?:gsk_|xai-)[A-Za-z0-9_-]{16,}\b/,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}\b/i,
]);

export class ServerProfilePreferenceError extends Error {
  constructor(code = 'invalid_profile_preferences') {
    super(code);
    this.name = 'ServerProfilePreferenceError';
    this.code = code;
  }
}

function fail(code) { throw new ServerProfilePreferenceError(code); }
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value;
}
function exactKeys(value, allowed) {
  for (const key of Object.keys(value)) {
    const folded = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (folded.includes('embedding')) fail('embedding_model_locked');
    if (folded.includes('apikey') || folded.includes('accesstoken') || folded.includes('password') || folded.includes('credential') || folded === 'secret') {
      fail('secret_preferences_forbidden');
    }
    if (!allowed.has(key)) fail();
  }
}
function rejectSecretValues(value, depth = 0) {
  if (depth > 8) fail();
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) fail('secret_preferences_forbidden');
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const entry of Array.isArray(value) ? value : Object.values(value)) rejectSecretValues(entry, depth + 1);
}
function text(value, max = 200) {
  if (typeof value !== 'string') fail();
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000\r\n]/.test(clean)) fail();
  return clean;
}
function optionalText(value, max = 200) {
  if (typeof value !== 'string' || value.length > max || /[\u0000\r\n]/.test(value)) fail();
  return value.trim();
}
function bool(value) { if (typeof value !== 'boolean') fail(); return value; }
function number(value, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail();
  return value;
}
function enumValue(value, values) { return values.includes(value) ? value : fail(); }
function strings(value, maxItems = 200, maxLength = 120) {
  if (!Array.isArray(value) || value.length > maxItems) fail();
  const clean = value.map((entry) => text(entry, maxLength));
  return [...new Set(clean)];
}
function modelRef(value) {
  if (value == null) return null;
  const input = object(value);
  exactKeys(input, new Set(['provider', 'model', 'reasoningEffort', 'pending']));
  const provider = text(input.provider, 48);
  const model = text(input.model, 200);
  if (!PROVIDER_PATTERN.test(provider) || !IDENTIFIER_PATTERN.test(model)) fail();
  const reasoningEffort = input.reasoningEffort == null ? undefined : text(input.reasoningEffort, 32);
  if (reasoningEffort !== undefined && !REASONING_PATTERN.test(reasoningEffort)) fail();
  const local = isLocalServerModel(provider, model);
  // `pending` is accepted for compatibility with an early web client, but the
  // local provider/model itself is never persisted in a portable profile.
  if (input.pending !== undefined && typeof input.pending !== 'boolean') fail();
  if (local) return null;
  return { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
}

// These providers/models need an executable or downloaded runtime on the
// Desktop host. They are retained as pending assignments so a later Desktop
// sync can resolve them, but Server must never turn them into a paid fallback.
const LOCAL_MODEL_PROVIDERS = new Set(['nodus', 'ollama', 'lmstudio']);
const LOCAL_STT_PROVIDERS = new Set(['transformers', 'whisper_cpp', 'whisper-cpp', 'ming', 'piper', 'kokoro']);
export function isLocalServerModel(provider, model = '') {
  const normalizedProvider = String(provider).toLowerCase().replace(/-/g, '_');
  const normalizedModel = String(model).toLowerCase();
  return LOCAL_MODEL_PROVIDERS.has(String(provider).toLowerCase())
    || LOCAL_STT_PROVIDERS.has(normalizedProvider)
    || /(?:^|[/_.:-])(?:whisper|ggml|piper|kokoro)(?:[/_.:-]|$)/.test(normalizedModel)
    || normalizedModel.startsWith('xenova/whisper');
}
function booleanRecord(value) {
  const input = object(value);
  if (Object.keys(input).length > 32) fail();
  return Object.fromEntries(Object.entries(input).map(([key, entry]) => {
    if (!PROVIDER_PATTERN.test(key) || typeof entry !== 'boolean') fail();
    return [key, entry];
  }));
}
function effortRecord(value) {
  const input = object(value);
  if (Object.keys(input).length > 200) fail();
  return Object.fromEntries(Object.entries(input).map(([key, entry]) => {
    if (!IDENTIFIER_PATTERN.test(key) || typeof entry !== 'string' || !REASONING_PATTERN.test(entry)) fail();
    return [key, entry];
  }));
}

/** Build the only payload Desktop is permitted to upload to a Server user profile. */
export function extractServerProfilePreferences(settings) {
  const models = Object.fromEntries(SERVER_PROFILE_MODEL_FIELDS.map((name) => [name, modelRef(settings?.[DESKTOP_MODEL_FIELDS[name]] ?? null)]));
  const pendingAssignments = SERVER_PROFILE_MODEL_FIELDS
    .filter((name) => isLocalServerModel(settings?.[DESKTOP_MODEL_FIELDS[name]]?.provider, settings?.[DESKTOP_MODEL_FIELDS[name]]?.model))
    .concat(isLocalServerModel(settings?.imageProvider, settings?.imageModel) ? ['image'] : [])
    .concat(isLocalServerModel(settings?.audioProvider, settings?.audioVoice) ? ['audio'] : [])
    .concat(['transformers', 'whisper_cpp', 'whisper-cpp'].includes(String(settings?.sttProvider || '').toLowerCase()) ? ['transcription'] : [])
    .concat(Array.isArray(settings?.favorites) && settings.favorites.some((entry) => isLocalServerModel(entry?.provider, entry?.model)) ? ['favorites'] : []);
  return sanitizeServerProfilePreferences({
    schemaVersion: SERVER_PROFILE_PREFERENCES_VERSION,
    appearance: {
      theme: settings.theme,
      appTheme: settings.appTheme,
      customThemes: settings.customThemes,
      uiLanguage: settings.uiLanguage,
      promptLanguage: settings.promptLanguage,
      animationSpeed: settings.animationSpeed,
      interfaceScale: settings.interfaceScale,
      accessibleFont: settings.accessibleFont,
      highContrast: settings.highContrast,
      reduceMotion: settings.reduceMotion,
      readingFocusMode: settings.readingFocusMode,
      mascot: {
        enabled: settings.mascotEnabled,
        scale: settings.mascotScale,
        vaultCostumes: settings.mascotVaultCostumes,
        style: settings.mascotStyle,
        orbColorMode: settings.mascotOrbColorMode,
        orbColor: settings.mascotOrbColor,
      },
    },
    ai: {
      favorites: Array.isArray(settings.favorites) ? settings.favorites : [],
      modelSettingsMode: settings.modelSettingsMode,
      modelSettingsVersion: settings.modelSettingsVersion,
      models,
      chatReasoning: settings.chatReasoning,
      codexReasoningEfforts: settings.codexReasoningEfforts ?? {},
      preferFastOpenRouter: settings.openRouterThroughput,
      providerFreeTier: settings.providerFreeTier ?? {},
      image: { provider: settings.imageProvider, model: settings.imageModel, quality: settings.imageQuality, style: settings.imageStyle },
      audio: { provider: settings.audioProvider, voice: settings.audioVoice, speed: settings.audioSpeed },
      studyPolicy: {
        enabled: settings.studyAiEnabled,
        privacyMode: settings.studyAiPrivacyMode,
        confirmExternal: settings.studyAiConfirmExternal,
        monthlyBudgetUsd: settings.studyAiMonthlyBudgetUsd,
        budgetWarningPercent: settings.studyAiBudgetWarningPercent,
        maxInputChars: settings.studyAiMaxInputChars,
        maxOutputTokens: settings.studyAiMaxOutputTokens,
        temperature: settings.studyAiTemperature,
        retryCount: settings.studyAiRetryCount,
        studentPseudonyms: settings.studentPseudonymsEnabled,
      },
      pendingAssignments,
    },
    workspace: {
      sidebarOrder: Array.isArray(settings.sidebarOrder) ? settings.sidebarOrder : [],
      sidebarHidden: Array.isArray(settings.sidebarHidden) ? settings.sidebarHidden : [],
      sidebarCustomized: settings.sidebarCustomized,
      scriptorSidebarVersion: settings.scriptorSidebarVersion,
      toolkitPinnedPages: Array.isArray(settings.toolkitPinnedPages) ? settings.toolkitPinnedPages : [],
      aiConcurrencyMode: settings.aiConcurrencyMode,
      aiConcurrencyVersion: settings.aiConcurrencyVersion,
      concurrency: settings.concurrency,
      deepContextMode: settings.deepContextMode,
      standardChunkWords: settings.deepStandardChunkWords,
      longChunkWords: settings.deepLongChunkWords,
    },
  });
}

/**
 * Rebuild the Desktop settings patch represented by a portable Server profile.
 * This is the inverse of `extractServerProfilePreferences`: it remains an
 * allowlist and therefore can never pull credentials, local endpoints, paths,
 * backup policy or the immutable embedding configuration into Desktop.
 */
export function desktopSettingsPatchFromServerProfile(value) {
  const profile = sanitizeServerProfilePreferences(value);
  // Do not write a server-incompatible assignment as `null`: Desktop interprets
  // null as "use the paid default". Leaving it untouched keeps an installed
  // local runtime usable and, on a fresh device, leaves the assignment pending
  // until the user picks a supported model.
  const modelPatch = Object.fromEntries(SERVER_PROFILE_MODEL_FIELDS
    .filter((name) => !profile.ai.pendingAssignments.includes(name))
    .map((name) => [DESKTOP_MODEL_FIELDS[name], profile.ai.models[name]]));
  return {
    theme: profile.appearance.theme,
    appTheme: profile.appearance.appTheme,
    customThemes: profile.appearance.customThemes,
    uiLanguage: profile.appearance.uiLanguage,
    promptLanguage: profile.appearance.promptLanguage,
    animationSpeed: profile.appearance.animationSpeed,
    interfaceScale: profile.appearance.interfaceScale,
    accessibleFont: profile.appearance.accessibleFont,
    highContrast: profile.appearance.highContrast,
    reduceMotion: profile.appearance.reduceMotion,
    readingFocusMode: profile.appearance.readingFocusMode,
    mascotEnabled: profile.appearance.mascot.enabled,
    mascotScale: profile.appearance.mascot.scale,
    mascotVaultCostumes: profile.appearance.mascot.vaultCostumes,
    mascotStyle: profile.appearance.mascot.style,
    mascotOrbColorMode: profile.appearance.mascot.orbColorMode,
    mascotOrbColor: profile.appearance.mascot.orbColor,
    favorites: profile.ai.favorites,
    modelSettingsMode: profile.ai.modelSettingsMode,
    modelSettingsVersion: profile.ai.modelSettingsVersion,
    ...modelPatch,
    chatReasoning: profile.ai.chatReasoning,
    codexReasoningEfforts: { ...profile.ai.codexReasoningEfforts },
    openRouterThroughput: profile.ai.preferFastOpenRouter,
    providerFreeTier: { ...profile.ai.providerFreeTier },
    ...(profile.ai.image.pending ? {} : {
      imageProvider: profile.ai.image.provider,
      imageModel: profile.ai.image.model,
      imageQuality: profile.ai.image.quality,
      imageStyle: profile.ai.image.style,
    }),
    ...(profile.ai.audio.pending ? {} : {
      audioProvider: profile.ai.audio.provider,
      audioVoice: profile.ai.audio.voice,
      audioSpeed: profile.ai.audio.speed,
    }),
    studyAiEnabled: profile.ai.studyPolicy.enabled,
    studyAiPrivacyMode: profile.ai.studyPolicy.privacyMode,
    studyAiConfirmExternal: profile.ai.studyPolicy.confirmExternal,
    studyAiMonthlyBudgetUsd: profile.ai.studyPolicy.monthlyBudgetUsd,
    studyAiBudgetWarningPercent: profile.ai.studyPolicy.budgetWarningPercent,
    studyAiMaxInputChars: profile.ai.studyPolicy.maxInputChars,
    studyAiMaxOutputTokens: profile.ai.studyPolicy.maxOutputTokens,
    studyAiTemperature: profile.ai.studyPolicy.temperature,
    studyAiRetryCount: profile.ai.studyPolicy.retryCount,
    studentPseudonymsEnabled: profile.ai.studyPolicy.studentPseudonyms,
    sidebarOrder: [...profile.workspace.sidebarOrder],
    sidebarHidden: [...profile.workspace.sidebarHidden],
    sidebarCustomized: profile.workspace.sidebarCustomized,
    scriptorSidebarVersion: profile.workspace.scriptorSidebarVersion,
    toolkitPinnedPages: [...profile.workspace.toolkitPinnedPages],
    aiConcurrencyMode: profile.workspace.aiConcurrencyMode,
    aiConcurrencyVersion: profile.workspace.aiConcurrencyVersion,
    concurrency: profile.workspace.concurrency,
    deepContextMode: profile.workspace.deepContextMode,
    deepStandardChunkWords: profile.workspace.standardChunkWords,
    deepLongChunkWords: profile.workspace.longChunkWords,
  };
}

/** Validate and rebuild in canonical key order. Unknown fields are rejected, not ignored. */
export function sanitizeServerProfilePreferences(value) {
  rejectSecretValues(value);
  const root = object(value); exactKeys(root, ROOT_KEYS);
  if (root.schemaVersion !== SERVER_PROFILE_PREFERENCES_VERSION) fail('unsupported_profile_preferences_version');

  const appearance = object(root.appearance); exactKeys(appearance, APPEARANCE_KEYS);
  const mascot = object(appearance.mascot); exactKeys(mascot, MASCOT_KEYS);
  const ai = object(root.ai); exactKeys(ai, AI_KEYS);
  const models = object(ai.models); exactKeys(models, new Set(SERVER_PROFILE_MODEL_FIELDS));
  const image = object(ai.image); exactKeys(image, IMAGE_KEYS);
  const audio = object(ai.audio); exactKeys(audio, AUDIO_KEYS);
  const study = object(ai.studyPolicy); exactKeys(study, STUDY_KEYS);
  const workspace = object(root.workspace); exactKeys(workspace, WORKSPACE_KEYS);
  const { changed: _scriptorMigrated, ...scriptorWorkspace } = migrateScriptorSidebar({
    sidebarOrder: strings(workspace.sidebarOrder), sidebarHidden: strings(workspace.sidebarHidden),
    scriptorSidebarVersion: workspace.scriptorSidebarVersion === undefined ? 0 : number(workspace.scriptorSidebarVersion, 0, 100, true),
  });

  const favorites = Array.isArray(ai.favorites) ? ai.favorites : fail();
  if (favorites.length > 100) fail();
  // Desktop's `sameModel` deliberately ignores reasoning effort: a favourite is
  // one provider/model pair, while reasoning is selected per task. Canonicalise
  // that invariant at the portable boundary so two devices cannot accumulate
  // visually duplicated favourites with different reasoning metadata.
  const canonicalFavorites = [...new Map(favorites
    .map(modelRef)
    .filter(Boolean)
    .map((model) => [`${model.provider}\u0000${model.model}`, model])).values()];
  const pendingAssignments = strings(ai.pendingAssignments ?? [], 100, 80);
  const customThemes = sanitizeCustomThemes(appearance.customThemes);
  const allowedAppThemes = APP_THEME_IDS.concat(customThemes.map((theme) => theme.id));
  if (favorites.some((entry) => entry && isLocalServerModel(entry.provider, entry.model)) && !pendingAssignments.includes('favorites')) pendingAssignments.push('favorites');
  const canonicalModels = Object.fromEntries(SERVER_PROFILE_MODEL_FIELDS.map((name) => {
    const input = models[name];
    const local = input && isLocalServerModel(input.provider, input.model);
    return [name, local ? null : modelRef(input)];
  }));
  for (const name of SERVER_PROFILE_MODEL_FIELDS) {
    const input = models[name];
    if (input && isLocalServerModel(input.provider, input.model) && !pendingAssignments.includes(name)) pendingAssignments.push(name);
  }
  const imageProvider = text(image.provider, 48);
  const imageModel = text(image.model, 200);
  const imagePending = isLocalServerModel(imageProvider, imageModel) || image.pending === true;
  const audioProvider = text(audio.provider, 48);
  const audioVoice = optionalText(audio.voice, 200);
  const audioPending = isLocalServerModel(audioProvider, audioVoice) || audio.pending === true;
  if (imagePending && !pendingAssignments.includes('image')) pendingAssignments.push('image');
  if (audioPending && !pendingAssignments.includes('audio')) pendingAssignments.push('audio');
  return {
    schemaVersion: SERVER_PROFILE_PREFERENCES_VERSION,
    appearance: {
      theme: enumValue(appearance.theme, ['dark', 'light', 'system']),
      // Tolerate profiles written before this key existed.
      appTheme: enumValue(appearance.appTheme ?? 'default', allowedAppThemes),
      customThemes,
      uiLanguage: enumValue(appearance.uiLanguage, ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko']),
      promptLanguage: enumValue(appearance.promptLanguage, ['es', 'en', 'fr', 'tr', 'de', 'pt', 'pt-BR', 'it', 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko']),
      animationSpeed: number(appearance.animationSpeed, 0, 1),
      interfaceScale: number(appearance.interfaceScale, 0.75, 1.5),
      accessibleFont: bool(appearance.accessibleFont),
      highContrast: bool(appearance.highContrast),
      reduceMotion: bool(appearance.reduceMotion),
      readingFocusMode: bool(appearance.readingFocusMode),
      mascot: {
        enabled: bool(mascot.enabled), scale: number(mascot.scale, 0.5, 3),
        vaultCostumes: bool(mascot.vaultCostumes), style: enumValue(mascot.style, ['classic', 'orb']),
        orbColorMode: enumValue(mascot.orbColorMode, ['auto', 'manual']),
        orbColor: typeof mascot.orbColor === 'string' && HEX_COLOR_PATTERN.test(mascot.orbColor) ? mascot.orbColor.toLowerCase() : fail(),
      },
    },
    ai: {
      favorites: canonicalFavorites,
      modelSettingsMode: enumValue(ai.modelSettingsMode, ['basic', 'advanced']),
      modelSettingsVersion: number(ai.modelSettingsVersion, 0, 100, true),
      models: canonicalModels,
      pendingAssignments,
      chatReasoning: enumValue(ai.chatReasoning, ['off', 'low', 'medium', 'high']),
      codexReasoningEfforts: effortRecord(ai.codexReasoningEfforts),
      preferFastOpenRouter: bool(ai.preferFastOpenRouter),
      providerFreeTier: booleanRecord(ai.providerFreeTier),
      image: {
        // Local image runtimes are represented only as an unresolved marker;
        // their provider/model ids must not be copied to Server.
        provider: imagePending ? 'pending' : imageProvider,
        model: imagePending ? 'unresolved' : imageModel,
        quality: text(image.quality, 48), style: text(image.style, 80),
        ...(imagePending ? { pending: true } : {}),
      },
      audio: {
        provider: audioPending ? 'pending' : audioProvider,
        voice: audioPending ? '' : audioVoice,
        speed: number(audio.speed, 0.5, 2),
        ...(audioPending ? { pending: true } : {}),
      },
      studyPolicy: {
        enabled: bool(study.enabled), privacyMode: enumValue(study.privacyMode, ['local', 'hybrid', 'external']),
        confirmExternal: bool(study.confirmExternal), monthlyBudgetUsd: number(study.monthlyBudgetUsd, 0, 1_000_000),
        budgetWarningPercent: number(study.budgetWarningPercent, 1, 100),
        maxInputChars: number(study.maxInputChars, 1_000, 10_000_000, true),
        maxOutputTokens: number(study.maxOutputTokens, 1, 1_000_000, true),
        temperature: number(study.temperature, 0, 2), retryCount: number(study.retryCount, 0, 20, true),
        studentPseudonyms: bool(study.studentPseudonyms),
      },
    },
    workspace: {
      ...scriptorWorkspace,
      sidebarCustomized: bool(workspace.sidebarCustomized),
      toolkitPinnedPages: workspace.toolkitPinnedPages === undefined ? [] : strings(workspace.toolkitPinnedPages),
      // Version 1 records an explicit selector choice. Older/missing values are
      // the pre-release opt-in default and graduate once to production automatic.
      aiConcurrencyMode: workspace.aiConcurrencyVersion !== undefined
        && number(workspace.aiConcurrencyVersion, 0, 100, true) >= 1
        ? enumValue(workspace.aiConcurrencyMode, ['automatic', 'manual'])
        : 'automatic',
      aiConcurrencyVersion: workspace.aiConcurrencyVersion !== undefined
        && number(workspace.aiConcurrencyVersion, 0, 100, true) >= 1
        ? number(workspace.aiConcurrencyVersion, 1, 100, true)
        : 1,
      concurrency: number(workspace.concurrency, 1, 8, true),
      deepContextMode: enumValue(workspace.deepContextMode, ['standard', 'long']),
      standardChunkWords: number(workspace.standardChunkWords, 100, 100_000, true),
      longChunkWords: number(workspace.longChunkWords, 1_000, 1_000_000, true),
    },
  };
}

/** Server AI defaults derived without ever consulting or carrying a credential. */
export function aiPreferencesFromServerProfile(profile, supportedProviders = []) {
  const allowed = new Set(supportedProviders);
  const candidates = [profile?.ai?.models?.assistant, profile?.ai?.models?.synthesis, ...(profile?.ai?.favorites ?? [])]
    .filter((entry) => entry && !entry.pending && (!allowed.size || allowed.has(entry.provider)));
  const chatModels = {};
  for (const entry of candidates) if (!chatModels[entry.provider]) chatModels[entry.provider] = entry.model;
  const preferred = candidates[0] ?? null;
  return {
    ...(preferred ? { defaultProvider: preferred.provider } : {}),
    ...(Object.keys(chatModels).length ? { chatModels } : {}),
    // Keep no local assignment in Server's execution preferences. In
    // particular, do not synthesize a paid fallback when every assignment is
    // pending; an explicit missing model is safer than a surprise charge.
    featureModels: Object.fromEntries(Object.entries(profile.ai.models).map(([name, model]) => [name, model])),
    favorites: profile.ai.favorites,
    modelSettingsMode: profile.ai.modelSettingsMode,
  };
}
