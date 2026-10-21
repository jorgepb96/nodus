// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ming-3.0-tts catalogue: the checkpoints Nodus can download, the languages the model speaks
 * and the status shapes the main process reports. Every file is pinned to a Hugging Face
 * revision, an exact size and a SHA-256, so a download is either the verified artifact or
 * nothing. MLX checkpoints run only on Apple Silicon; the PyTorch checkpoint runs everywhere
 * (CUDA when an NVIDIA GPU answers, CPU otherwise).
 */

export type TtsBackend = 'mlx' | 'torch' | 'phonon' | 'kokoro';
export type TtsEngine = 'ming' | 'phonon' | 'kokoro';
export type TtsDevice = 'metal' | 'cuda' | 'cpu';

export interface TtsModelAsset {
  file: string;
  url: string;
  bytes: number;
  /** Absent only for small text files of gated repos, whose hash cannot be read without a token; the size is still enforced. */
  sha256?: string;
}

export interface TtsModelDefinition {
  id: string;
  label: string;
  engine: TtsEngine;
  backend: TtsBackend;
  quantization: '8bit' | '4bit' | 'bf16' | 'q8' | 'int8';
  /** Languages the checkpoint speaks. */
  languages: readonly TtsLanguage[];
  /** Gated on Hugging Face: the user accepts the terms there and gives Nodus a token. */
  gated?: boolean;
  /** Not for commercial use (CC BY-NC): the user must accept it in Nodus before downloading. */
  nonCommercial?: boolean;
  /** Can clone a voice from a reference recording locally. */
  cloning: boolean;
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
  'jorgepb96/Ming-3.0-tts-0.5B-4bit': 'd06229cac0b9059337ffdc3d5440300bb304e181',
  'inclusionAI/Ming-3.0-tts-0.5B': 'e5bd8da31ecf1b9276cdbdda821fa891068f1368',
  'gradium/phonon-31m-en': '52433c46975bfa13144c56204c9f4ee1c5b148aa',
  'gradium/phonon-40m-es': 'eceb8758b5ed899bd661febecffdc6be61d8e1e6',
  'gradium/phonon-40m-multilingual': '1267486cbcb55d2eaa61ba521c2ed8e4d22923c2',
};

const hf = (repo: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/${HF_REVISIONS[repo] ?? 'main'}/${file}?download=true`;

const assets = (repo: string, files: ReadonlyArray<readonly [string, number, string]>): TtsModelAsset[] =>
  files.map(([file, bytes, sha256]) => ({ file, url: hf(repo, file), bytes, ...(sha256 ? { sha256 } : {}) }));

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
const MING_LANGUAGES: readonly TtsLanguage[] = ['es', 'en', 'zh', 'fr', 'de', 'ja', 'ko'];
const PHONON_DEFAULT_VOICE = ['default-voice.safetensors', 256136, 'f739e8c4c76ee7f92e7c94a82002748c8cd22e99582ac49f7b9b94cd63786e18'] as const;
const CC_BY_NC = { licenseLabel: 'CC BY-NC 4.0 · no comercial', licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/' } as const;

export const TTS_MODELS: readonly TtsModelDefinition[] = [
  {
    id: 'ming3-0.5b-mlx-8bit',
    label: 'Ming 3.0 · 0.5B · 8-bit',
    engine: 'ming',
    backend: 'mlx',
    quantization: '8bit',
    languages: MING_LANGUAGES,
    cloning: true,
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
    ]).concat(
      // The speaker encoder for voice cloning runs on onnxruntime; the MLX repo only ships
      // its weights as safetensors, so the ONNX file comes from the official checkpoint.
      assets('inclusionAI/Ming-3.0-tts-0.5B', [['campplus.onnx', 28303423, 'a6ac6a63997761ae2997373e2ee1c47040854b4b759ea41ec48e4e42df0f4d73']]),
    ),
  },
  {
    id: 'ming3-0.5b-mlx-4bit',
    label: 'Ming 3.0 · 0.5B · 4-bit',
    engine: 'ming',
    backend: 'mlx',
    quantization: '4bit',
    languages: MING_LANGUAGES,
    cloning: true,
    description: 'Más ligero y rápido en Mac con Apple Silicon, con algo menos de calidad.',
    sourceUrl: 'https://huggingface.co/jorgepb96/Ming-3.0-tts-0.5B-4bit',
    ...MING_LICENSE,
    assets: assets('jorgepb96/Ming-3.0-tts-0.5B-4bit', [
      ['LICENSE', 1067, '2872f1918dfc04fdeb7f5d66d8d1b773594c9375e7c8f7bda39780bb97ad4fba'],
      ['campplus.safetensors', 27699096, 'a479586bd8f8f96cdb414eaa2fa07c6cd54d6d1636562e2d75a0211cb3b0a6fd'],
      ['config.json', 6087, 'efbf26b62d5218c344ced9f69b59e88a8aaed35d2567bef3a7ac219816e3072b'],
      ['model.safetensors', 834246537, '7b6054b4099250eee87fd4b620ae837f32425169725e9407816e2986d51652d8'],
      ['model.safetensors.index.json', 201849, 'f3780f1ad7df33a5516584b253e8e5156d984182b76fd8a5a44277c51b1c43ca'],
      ...TOKENIZER,
    ]).concat(
      // Voice cloning still uses the official CAM++ ONNX graph (the MLX repo only carries
      // its fused safetensors weights), exactly as the 8-bit checkpoint does.
      assets('inclusionAI/Ming-3.0-tts-0.5B', [['campplus.onnx', 28303423, 'a6ac6a63997761ae2997373e2ee1c47040854b4b759ea41ec48e4e42df0f4d73']]),
    ),
  },
  {
    id: 'ming3-0.5b-torch',
    label: 'Ming 3.0 · 0.5B',
    engine: 'ming',
    backend: 'torch',
    quantization: 'bf16',
    languages: MING_LANGUAGES,
    cloning: true,
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
  {
    id: 'phonon-31m-en',
    label: 'Phonon S · 31M · inglés',
    engine: 'phonon',
    backend: 'phonon',
    quantization: 'q8',
    languages: ['en'],
    cloning: false,
    description: 'Muy ligero y mucho más rápido que el tiempo real incluso en el procesador. Solo inglés.',
    sourceUrl: 'https://huggingface.co/gradium/phonon-31m-en',
    licenseLabel: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/gradium/phonon-31m-en',
    assets: assets('gradium/phonon-31m-en', [
      ['config.json', 2851, '7062ea376e6b158543c8abec8e5af67df171c49ad70eb7e2a0fb25c16f265e06'],
      ['tokenizer.json', 277967, '691a00068fa7b989f2f3e5ae5daa2d1a5bb319f2d5360deafcfb19a8bb6e7936'],
      ['model.q8.gguf', 64512352, 'a7d9aad2cd6dc66473f24a08bc6d2939030ef4d751ef82349361fbef3272dbae'],
      PHONON_DEFAULT_VOICE,
    ]),
  },
  {
    id: 'phonon-40m-es',
    label: 'Phonon · 40M · español',
    engine: 'phonon',
    backend: 'phonon',
    quantization: 'q8',
    languages: ['es'],
    cloning: false,
    gated: true,
    nonCommercial: true,
    description: 'Español muy rápido incluso en el procesador. Uso no comercial; requiere aceptar la licencia en Hugging Face.',
    sourceUrl: 'https://huggingface.co/gradium/phonon-40m-es',
    ...CC_BY_NC,
    assets: assets('gradium/phonon-40m-es', [
      ['config.json', 2851, ''],
      ['tokenizer.json', 278837, ''],
      ['model.q8.gguf', 74553568, 'b90d5897e5e663c56a8975a8b2d6f7db557b9bad59ad82a82361ac56614c2a5c'],
      PHONON_DEFAULT_VOICE,
    ]),
  },
  {
    id: 'phonon-40m-multilingual',
    label: 'Phonon · 40M · multilingüe',
    engine: 'phonon',
    backend: 'phonon',
    quantization: 'q8',
    languages: ['es', 'en', 'fr', 'de', 'pt'],
    cloning: false,
    gated: true,
    nonCommercial: true,
    description: 'Español, inglés, francés, alemán y portugués en un solo modelo. Uso no comercial; requiere aceptar la licencia en Hugging Face.',
    sourceUrl: 'https://huggingface.co/gradium/phonon-40m-multilingual',
    ...CC_BY_NC,
    assets: assets('gradium/phonon-40m-multilingual', [
      ['config.json', 2891, ''],
      ['tokenizer.json', 277749, ''],
      ['model.q8.gguf', 74553568, '96fa067813244e0c6c5997b98ec2596b65ec8574b14916b48e97db056ff97e27'],
      PHONON_DEFAULT_VOICE,
    ]),
  },
  {
    id: 'kokoro-82m-int8',
    label: 'Kokoro 82M · int8',
    engine: 'kokoro',
    backend: 'kokoro',
    quantization: 'int8',
    languages: ['es', 'en'],
    cloning: false,
    description: 'Un solo modelo de 82M con 31 voces inglesas y españolas. ONNX Runtime en el procesador, varias veces más rápido que el tiempo real.',
    sourceUrl: 'https://huggingface.co/hexgrad/Kokoro-82M',
    licenseLabel: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/hexgrad/Kokoro-82M',
    assets: [
      {
        file: 'kokoro-v1.0.int8.onnx',
        url: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx',
        bytes: 92361271,
        sha256: '6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb',
      },
      {
        file: 'voices-v1.0.bin',
        url: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',
        bytes: 28214398,
        sha256: 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
      },
    ],
  },
];

export function ttsModelBytes(model: TtsModelDefinition): number {
  return model.assets.reduce((sum, asset) => sum + asset.bytes, 0);
}

/** The checkpoints that can run on this platform, published ones only. Phonon runs everywhere. */
export function ttsModelsForPlatform(platform: string, arch: string): TtsModelDefinition[] {
  // Each Ming checkpoint runs on one backend, and this machine has one: MLX on Apple Silicon,
  // PyTorch elsewhere. The PyTorch checkpoint on an Apple Silicon Mac would download 3 GB and
  // then fail to load in the MLX sidecar.
  const backend = ttsBackendForPlatform(platform, arch);
  return TTS_MODELS.filter((model) => !model.unpublished && (model.engine !== 'ming' || model.backend === backend));
}

/** The sidecar backend a checkpoint needs: Phonon has its own; Ming's depends on the machine. */
export function ttsBackendForModel(model: TtsModelDefinition | undefined, platform: string, arch: string): TtsBackend {
  if (model?.engine === 'phonon') return 'phonon';
  if (model?.engine === 'kokoro') return 'kokoro';
  return ttsBackendForPlatform(platform, arch);
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
export type TtsLanguage = 'es' | 'en' | 'zh' | 'fr' | 'de' | 'ja' | 'ko' | 'pt';
export const TTS_LANGUAGES: ReadonlyArray<{ code: TtsLanguage; label: string; requiresLanguageLine: boolean }> = [
  { code: 'es', label: 'Español', requiresLanguageLine: true },
  { code: 'en', label: 'English', requiresLanguageLine: false },
  { code: 'zh', label: '中文', requiresLanguageLine: false },
  { code: 'fr', label: 'Français', requiresLanguageLine: true },
  { code: 'de', label: 'Deutsch', requiresLanguageLine: true },
  { code: 'ja', label: '日本語', requiresLanguageLine: true },
  { code: 'ko', label: '한국어', requiresLanguageLine: true },
  // Phonon only; Ming does not speak Portuguese.
  { code: 'pt', label: 'Português', requiresLanguageLine: false },
];
export type TtsLanguageSetting = TtsLanguage | 'auto';

/**
 * Languages the Phonon runtime can spell and normalise. A catalogue voice carries its own
 * language, so the Spanish (Spain) voices stay usable even with the compact English
 * checkpoint; the checkpoint label still says which languages it was trained for.
 */
export const PHONON_LANGUAGES = ['es', 'en', 'fr', 'de', 'pt'] as const;
export type PhononLanguage = (typeof PHONON_LANGUAGES)[number];

export function isTtsLanguage(value: unknown): value is TtsLanguage {
  return TTS_LANGUAGES.some((language) => language.code === value);
}

/** Where narration can be generated; each surface has its own retention override. */
export type TtsSurface = 'research_chat' | 'dictionary' | 'deep_research' | 'immersion' | 'scriptor';
export const TTS_SURFACES: readonly TtsSurface[] = ['research_chat', 'dictionary', 'deep_research', 'immersion', 'scriptor'];

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
    // A Scriptor document keeps changing, so reading it aloud is a quick check, not an archive.
    scriptor: { mode: 'days', days: 1 },
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
    // A surface added after the settings were saved starts from its own default rule.
    const fallback = DEFAULT_TTS_RETENTION.perSurface[surface];
    const rule = (raw.perSurface?.[surface] ?? (fallback.mode === 'inherit' ? {} : fallback)) as Partial<TtsRetentionRule>;
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
  engine: TtsEngine;
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
  /** Ming's environment (MLX or PyTorch). */
  runtime: TtsRuntimeStatus;
  /** Phonon's environment (the small `ptts` runtime). */
  phononRuntime: TtsRuntimeStatus;
  /** Kokoro-82M's environment (`kokoro-onnx` + espeak-ng, no PyTorch). */
  kokoroRuntime: TtsRuntimeStatus;
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
