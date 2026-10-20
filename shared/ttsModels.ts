// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ming-3.0-tts catalogue: the checkpoints Nodus can download, the languages the model speaks
 * and the status shapes the main process reports. Every file is pinned to a Hugging Face
 * revision, an exact size and a SHA-256, so a download is either the verified artifact or
 * nothing. MLX checkpoints run only on Apple Silicon; the PyTorch checkpoint runs everywhere
 * (CUDA when an NVIDIA GPU answers, CPU otherwise).
 */

export type TtsBackend = 'mlx' | 'torch';
export type TtsDevice = 'metal' | 'cuda' | 'cpu';

export interface TtsModelAsset {
  file: string;
  url: string;
  bytes: number;
  sha256: string;
}

export interface TtsModelDefinition {
  id: string;
  label: string;
  backend: TtsBackend;
  quantization: '8bit' | '4bit' | 'bf16';
  description: string;
  sourceUrl: string;
  licenseLabel: string;
  licenseUrl: string;
  /** Not yet published: listed for planning, never offered for download. */
  unpublished?: boolean;
  assets: readonly TtsModelAsset[];
}

const HF_REVISIONS: Record<string, string> = {
  'mlx-community/Ming-3.0-tts-0.5B-8bit': 'c807b99d2ea77d896fcffc917f0330d36470bb29',
  'inclusionAI/Ming-3.0-tts-0.5B': 'e5bd8da31ecf1b9276cdbdda821fa891068f1368',
};

const hf = (repo: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/${HF_REVISIONS[repo] ?? 'main'}/${file}?download=true`;

const assets = (repo: string, files: ReadonlyArray<readonly [string, number, string]>): TtsModelAsset[] =>
  files.map(([file, bytes, sha256]) => ({ file, url: hf(repo, file), bytes, sha256 }));

/** Tokenizer files shared by every Ming-3.0 0.5B checkpoint (identical hashes upstream). */
const TOKENIZER = [
  ['added_tokens.json', 1785, '34394b1e16d7da2db16618bd43a0f970902ade0075480bcd812fe62d559ec319'],
  ['configuration.json', 51, '6720b8448f6ad5b4631689a60857bdeb238053a37f6cc6a5936eb50c2a3b9296'],
  ['merges.txt', 1671853, '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5'],
  ['special_tokens_map.json', 2726, '2c2ec51b9da5db654ac20de8310350d0c9c1a65918ae0181b80dacd2919b4fc3'],
  ['tokenizer.json', 11431389, '87d54ca3b44ea2f822ba39a0a45cb1b61644bd6606d9d3536dea75367bffb06d'],
  ['tokenizer_config.json', 16260, '12d6162c815edef24f8606e65b60d43fe0d92b0a4e150a0db8fa01c523aaf36a'],
  ['vocab.json', 2776833, 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910'],
] as const;

const MING_LICENSE = { licenseLabel: 'MIT', licenseUrl: 'https://github.com/inclusionAI/Ming-3.0-tts/blob/main/LICENSE' } as const;

export const TTS_MODELS: readonly TtsModelDefinition[] = [
  {
    id: 'ming3-0.5b-mlx-8bit',
    label: 'Ming 3.0 · 0.5B · 8-bit',
    backend: 'mlx',
    quantization: '8bit',
    description: 'Recomendado en Mac con Apple Silicon. Clona voces y habla siete idiomas.',
    sourceUrl: 'https://huggingface.co/mlx-community/Ming-3.0-tts-0.5B-8bit',
    ...MING_LICENSE,
    assets: assets('mlx-community/Ming-3.0-tts-0.5B-8bit', [
      ['LICENSE', 1067, '2872f1918dfc04fdeb7f5d66d8d1b773594c9375e7c8f7bda39780bb97ad4fba'],
      ['campplus.safetensors', 27699096, 'a479586bd8f8f96cdb414eaa2fa07c6cd54d6d1636562e2d75a0211cb3b0a6fd'],
      ['config.json', 6087, '8ea3e685a870fd1a535d3b4a4c975fc20c4fca56e67acdef06fe40004064c73b'],
      ['model.safetensors', 1573366591, 'e88a4b53cb5b705703e961389f3d7f0e8b72c240b4dad796bf9961cc018971fc'],
      ['model.safetensors.index.json', 201850, 'f59991abebed1a4f798a9488568af496d925e6eea507450aa8051a06f475a2ce'],
      ...TOKENIZER,
    ]),
  },
  {
    id: 'ming3-0.5b-mlx-4bit',
    label: 'Ming 3.0 · 0.5B · 4-bit',
    backend: 'mlx',
    quantization: '4bit',
    description: 'Más ligero y rápido en Mac con Apple Silicon, con algo menos de calidad.',
    sourceUrl: 'https://github.com/inclusionAI/Ming-3.0-tts',
    ...MING_LICENSE,
    // Quantized and published by Nodus; the pinned repo, sizes and hashes land with the release.
    unpublished: true,
    assets: [],
  },
  {
    id: 'ming3-0.5b-torch',
    label: 'Ming 3.0 · 0.5B',
    backend: 'torch',
    quantization: 'bf16',
    description: 'Para Windows, Linux y Mac Intel. Usa la GPU NVIDIA si la hay; si no, el procesador.',
    sourceUrl: 'https://huggingface.co/inclusionAI/Ming-3.0-tts-0.5B',
    ...MING_LICENSE,
    assets: assets('inclusionAI/Ming-3.0-tts-0.5B', [
      ['campplus.onnx', 28303423, 'a6ac6a63997761ae2997373e2ee1c47040854b4b759ea41ec48e4e42df0f4d73'],
      ['config.json', 4754, '2fb0767361b3cd3f41dc9392709fc23fe5b40a39f19d70a38d04acabe991822c'],
      ['model.safetensors', 2959055504, '45c4d78d8ad6b1d942e3da86ba035fece02de569f7b2ca7e9d121dfaf18d674c'],
      ...TOKENIZER,
    ]),
  },
];

export function ttsModelBytes(model: TtsModelDefinition): number {
  return model.assets.reduce((sum, asset) => sum + asset.bytes, 0);
}

/** The checkpoints that can run on this platform, published ones only. */
export function ttsModelsForPlatform(platform: string, arch: string): TtsModelDefinition[] {
  const appleSilicon = platform === 'darwin' && arch === 'arm64';
  return TTS_MODELS.filter((model) => !model.unpublished && (model.backend === 'torch' || appleSilicon));
}

export function defaultTtsModelId(platform: string, arch: string): string {
  return platform === 'darwin' && arch === 'arm64' ? 'ming3-0.5b-mlx-8bit' : 'ming3-0.5b-torch';
}

export function ttsBackendForPlatform(platform: string, arch: string): TtsBackend {
  return platform === 'darwin' && arch === 'arm64' ? 'mlx' : 'torch';
}

/**
 * Languages Ming-3.0 speaks. Chinese and English need no language line; the other five
 * require one (`Target language:`), which also keeps them away from the zh/en normalizer.
 */
export type TtsLanguage = 'es' | 'en' | 'zh' | 'fr' | 'de' | 'ja' | 'ko';
export const TTS_LANGUAGES: ReadonlyArray<{ code: TtsLanguage; label: string; requiresLanguageLine: boolean }> = [
  { code: 'es', label: 'Español', requiresLanguageLine: true },
  { code: 'en', label: 'English', requiresLanguageLine: false },
  { code: 'zh', label: '中文', requiresLanguageLine: false },
  { code: 'fr', label: 'Français', requiresLanguageLine: true },
  { code: 'de', label: 'Deutsch', requiresLanguageLine: true },
  { code: 'ja', label: '日本語', requiresLanguageLine: true },
  { code: 'ko', label: '한국어', requiresLanguageLine: true },
];
export type TtsLanguageSetting = TtsLanguage | 'auto';

export function isTtsLanguage(value: unknown): value is TtsLanguage {
  return TTS_LANGUAGES.some((language) => language.code === value);
}

/** Where narration can be generated; each surface has its own retention override. */
export type TtsSurface = 'research_chat' | 'dictionary' | 'deep_research' | 'immersion';
export const TTS_SURFACES: readonly TtsSurface[] = ['research_chat', 'dictionary', 'deep_research', 'immersion'];

export interface TtsRetentionRule {
  /** `inherit` follows the global rule. */
  mode: 'inherit' | 'off' | 'days';
  days: number;
}

export interface TtsRetentionSettings {
  enabled: boolean;
  days: number;
  perSurface: Record<TtsSurface, TtsRetentionRule>;
}

export const DEFAULT_TTS_RETENTION: TtsRetentionSettings = {
  enabled: true,
  days: 7,
  perSurface: {
    research_chat: { mode: 'inherit', days: 7 },
    dictionary: { mode: 'inherit', days: 7 },
    deep_research: { mode: 'inherit', days: 7 },
    immersion: { mode: 'inherit', days: 7 },
  },
};

export const TTS_RETENTION_MAX_DAYS = 365;

function clampDays(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(TTS_RETENTION_MAX_DAYS, n)) : fallback;
}

export function sanitizeTtsRetention(value: unknown): TtsRetentionSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<TtsRetentionSettings>;
  const days = clampDays(raw.days, DEFAULT_TTS_RETENTION.days);
  const perSurface = {} as Record<TtsSurface, TtsRetentionRule>;
  for (const surface of TTS_SURFACES) {
    const rule = (raw.perSurface?.[surface] ?? {}) as Partial<TtsRetentionRule>;
    const mode = rule.mode === 'off' || rule.mode === 'days' ? rule.mode : 'inherit';
    perSurface[surface] = { mode, days: clampDays(rule.days, days) };
  }
  return { enabled: raw.enabled !== false, days, perSurface };
}

/** Age in days after which a surface's unpinned clips are removed, or null to keep them. */
export function ttsRetentionDays(settings: TtsRetentionSettings, surface: TtsSurface): number | null {
  const rule = settings.perSurface[surface];
  if (rule.mode === 'off') return null;
  if (rule.mode === 'days') return rule.days;
  return settings.enabled ? settings.days : null;
}

export interface TtsModelStatus {
  id: string;
  downloaded: boolean;
  downloading: boolean;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
}

export type TtsEngineState = 'unloaded' | 'starting' | 'loading' | 'ready' | 'busy' | 'error';

export interface TtsRuntimeStatus {
  backend: TtsBackend;
  installed: boolean;
  installing: boolean;
  phase?: string;
  progress?: number;
  device?: TtsDevice;
  fallbackReason?: string;
  diskBytes?: number;
  error?: string;
}

export interface TtsStatus {
  platformSupported: boolean;
  runtime: TtsRuntimeStatus;
  models: TtsModelStatus[];
  engine: { state: TtsEngineState; modelId: string | null; idleUnloadAt: number | null; error?: string };
}

/** One generated fragment, as the host relays it to the renderer. */
export interface TtsFragmentEvent {
  jobId: string;
  index: number;
  total: number;
  url: string;
  durationS: number;
  genS: number;
}

export interface TtsJobProgress {
  jobId: string;
  done: number;
  total: number;
  audioS: number;
  genS: number;
  /** Measured real-time factor (generation time / audio time) so far. */
  rtf: number | null;
  etaS: number | null;
  state: 'queued' | 'loading' | 'generating' | 'done' | 'cancelled' | 'error';
  error?: string;
}
