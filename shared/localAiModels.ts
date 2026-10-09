import { EMBEDDING_GEMMA2_FAMILY, EMBEDDING_GEMMA2_REVISION } from './embeddingGemma2';

export type NodusLocalModelKind = 'embedding' | 'chat';
export type NodusLocalModelRuntime = 'llama_cpp' | 'transformers' | 'embeddinggemma2';
export type NodusLocalCapability = 'chat' | 'vision' | 'summary' | 'extraction' | 'fusion' | 'documentProfile';
export type NodusLocalCapabilities = Readonly<Record<NodusLocalCapability, boolean>>;

export interface NodusLocalModelAsset {
  file: string;
  url: string;
  bytes: number;
  sha256?: string;
  /** Resource-specific upstream declaration; notices travel with the application. */
  license?: string;
  licenseUrl?: string;
  licenseNotice?: string;
}

export interface NodusLocalModelDefinition {
  id: string;
  label: string;
  kind: NodusLocalModelKind;
  runtime: NodusLocalModelRuntime;
  quantization: string;
  description: string;
  sourceUrl: string;
  /** Upstream terms displayed next to the download action. */
  licenseLabel: string;
  licenseUrl: string;
  contextLength?: number;
  dimensions?: number;
  /** Profiles in a family share verified assets and one download. */
  assetFamily?: string;
  validation?: 'experimental' | 'validated';
  vision?: boolean;
  /** Benchmarked role contract. Unsupported roles are blocked before inference. */
  capabilities: NodusLocalCapabilities;
  modelFile: string;
  projectorFile?: string;
  assets: readonly NodusLocalModelAsset[];
}

export interface NodusLocalModelStatus {
  id: string;
  downloaded: boolean;
  downloadedBytes: number;
  totalBytes: number;
  path: string;
  /** Main-process transfer state, retained while renderer views mount/unmount. */
  downloading: boolean;
  progress: number;
}

export interface NodusLocalRuntimeStatus {
  version: string;
  ready: boolean;
  executablePath: string | null;
  /** Main-process transfer state, retained while renderer views mount/unmount. */
  downloading: boolean;
  progress: number;
  /** Upstream archive the installed runtime came from, when known. */
  asset?: string | null;
  /** Backend the installed build was built for, read from its own libraries. */
  backend?: 'metal' | 'vulkan' | 'cuda' | 'cpu' | null;
  /** Device the runtime itself reported (`--list-devices`), never inferred from the host. */
  device?: NodusLocalRuntimeDeviceStatus | null;
  /** NVIDIA driver presence, reported for diagnostics; CUDA is not the backend. */
  nvidia?: { detected: boolean; driver: string | null } | null;
  /** Layer placement of the most recent server start, parsed from llama.cpp's own log. */
  offload?: NodusLocalOffloadStatus | null;
  /** Why the CPU build was chosen over a GPU one, when that happened. */
  fallbackReason?: string | null;
  /** True when inference is running without a device (explicit, never silent). */
  processedOnCpu?: boolean;
  /** Loopback endpoint of the running server (`http://127.0.0.1:<port>`), for diagnostics. */
  endpoint?: string | null;
  /** Absolute path of the runtime diagnostics log written by the main process. */
  logPath?: string;
  /** Ring buffer of the most recent diagnostics lines, oldest first. */
  logTail?: string[];
}

export interface NodusLocalRuntimeDeviceStatus {
  backend: string;
  index: number;
  name: string;
  totalMiB: number;
  freeMiB: number;
}

export interface NodusLocalOffloadStatus {
  layers: number;
  totalLayers: number;
  deviceName: string | null;
  projectedMiB: number | null;
  fitted: boolean;
}

/** Persisted next to the extracted runtime so an install can be audited and upgraded. */
export interface NodusLocalRuntimeDescriptor {
  version: 1;
  llamaCppVersion: string;
  asset: string;
  backend: 'metal' | 'vulkan' | 'cuda' | 'cpu';
  device: NodusLocalRuntimeDeviceStatus | null;
  nvidia: { detected: boolean; driver: string | null } | null;
  probedAt: string | null;
  fallbackReason: string | null;
}

export interface NodusLocalCalibrationStatus {
  /** True when a benchmark for this hardware+runtime is on record. */
  measured: boolean;
  /** Highest slot count the recorded calibration admitted. */
  slots: 1 | 2 | 4;
  /** Reason recorded by the last measurement, e.g. `timeout` or `safe-single-slot`. */
  reason: string | null;
}

export interface NodusLocalAiStatus {
  runtime: NodusLocalRuntimeStatus;
  models: NodusLocalModelStatus[];
  activeModelId: string | null;
  activeSlots: number;
  activeLeases: number;
  calibration?: NodusLocalCalibrationStatus;
}

const EMBEDDING_CAPABILITIES: NodusLocalCapabilities = {
  chat: false, vision: false, summary: false, extraction: false, fusion: false, documentProfile: false,
};
const FULL_TEXT_CAPABILITIES: NodusLocalCapabilities = {
  chat: true, vision: false, summary: true, extraction: true, fusion: true, documentProfile: true,
};
const FULL_VISION_CAPABILITIES: NodusLocalCapabilities = { ...FULL_TEXT_CAPABILITIES, vision: true };
const RESTRICTED_VISION_CAPABILITIES: NodusLocalCapabilities = {
  chat: true, vision: true, summary: false, extraction: false, fusion: false, documentProfile: false,
};
/**
 * Text-only models kept for conversation, summaries and document profiles. Extraction and
 * fusion are refused here: validated end to end on Windows + RTX 3060 Ti (Vulkan) over six
 * arXiv papers, Granite 4.0 Micro extracted fine but violated the fusion decision contract
 * on every large work — prose in `edge_to_existing.basis` where the prompt requires
 * `explicit`/`inferred`, and edge types in `resolution` (932 rejected decisions) — which
 * deterministically failed whole works at `deep_status`. Gemma 4 E2B completed all six.
 */
const TEXT_NO_EXTRACTION_CAPABILITIES: NodusLocalCapabilities = {
  chat: true, vision: false, summary: true, extraction: false, fusion: false, documentProfile: true,
};

const HF_REVISIONS: Record<string, string> = {
  'onnx-community/embeddinggemma-2-ONNX': EMBEDDING_GEMMA2_REVISION,
  'ggml-org/bge-m3-Q8_0-GGUF': '9eba04c5d75ba5a1595e45de734d36bef4e5cb98',
  'onnx-community/gte-multilingual-base': '2edbf5e672aab465f9ed4c154a8b61791c082c69',
  'Xenova/multilingual-e5-small': '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  'unsloth/Qwen3.5-0.8B-GGUF': '6ab461498e2023f6e3c1baea90a8f0fe38ab64d0',
  'google/gemma-4-E2B-it-qat-q4_0-gguf': '69536a21d70340464240401ba38223d805f6a709',
  'LiquidAI/LFM2.5-VL-1.6B-GGUF': '48c6a306939241d1ddc99b090df552cb47a066c6',
  'ibm-granite/granite-4.0-micro-GGUF': 'ec48475f0c811d812fbfb61975717a9c36eeb652',
};

const hf = (repo: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/${HF_REVISIONS[repo] ?? 'main'}/${file}?download=true`;

export const NODUS_LOCAL_MODELS: readonly NodusLocalModelDefinition[] = [
  ...([512, 256] as const).map((dimensions): NodusLocalModelDefinition => ({
    id: `embeddinggemma-2-text-q8-${dimensions}-v1`,
    label: `EmbeddingGemma 2 Q8 · ${dimensions}`,
    kind: 'embedding', runtime: 'embeddinggemma2', quantization: 'Q8', dimensions,
    assetFamily: EMBEDDING_GEMMA2_FAMILY, validation: 'experimental',
    description: dimensions === 512 ? 'Texto multilingüe · perfil recomendado de esta familia. Validación de producto pendiente.' : 'Texto multilingüe · índice más pequeño. Validación de producto pendiente.',
    sourceUrl: 'https://huggingface.co/onnx-community/embeddinggemma-2-ONNX',
    licenseLabel: 'Apache-2.0 · revisar términos del recurso', licenseUrl: 'https://ai.google.dev/gemma/apache_2',
    contextLength: 8192, capabilities: EMBEDDING_CAPABILITIES, modelFile: 'onnx/model_quantized.onnx',
    assets: [
      { file: 'config.json', url: hf('onnx-community/embeddinggemma-2-ONNX', 'config.json'), bytes: 5031, sha256: '8d011bfe08b5e345bbe0b81e5c6fd02c381920b345b986047bc2a33ce7b90d1d' },
      { file: 'tokenizer.json', url: hf('onnx-community/embeddinggemma-2-ONNX', 'tokenizer.json'), bytes: 32170510, sha256: '4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4' },
      { file: 'tokenizer_config.json', url: hf('onnx-community/embeddinggemma-2-ONNX', 'tokenizer_config.json'), bytes: 1599, sha256: '17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874' },
      { file: 'onnx/model_quantized.onnx', url: hf('onnx-community/embeddinggemma-2-ONNX', 'onnx/model_quantized.onnx'), bytes: 495165, sha256: 'd06edd601f851c633a2519304cbeb8dc6170d7ceb61b436625c17fb9b6e74953' },
      { file: 'onnx/model_quantized.onnx_data', url: hf('onnx-community/embeddinggemma-2-ONNX', 'onnx/model_quantized.onnx_data'), bytes: 313724928, sha256: '278a7ff1248c3618e4bd11a607fc54f7bdc7778854230f3956d3f86bd9db4f3b' },
    ].map(asset => ({ ...asset, license: 'Apache-2.0', licenseUrl: 'https://ai.google.dev/gemma/apache_2', licenseNotice: 'legal/EMBEDDINGGEMMA_2_NOTICE.md' })),
  })),
  {
    id: 'bge-m3-q8_0',
    label: 'BGE-M3 Q8_0',
    kind: 'embedding',
    runtime: 'llama_cpp',
    quantization: 'Q8_0',
    description: 'Embeddings multilingües de alta calidad para corpus amplios.',
    sourceUrl: 'https://huggingface.co/ggml-org/bge-m3-Q8_0-GGUF',
    licenseLabel: 'MIT',
    licenseUrl: 'https://huggingface.co/BAAI/bge-m3',
    contextLength: 8192,
    dimensions: 1024,
    capabilities: EMBEDDING_CAPABILITIES,
    modelFile: 'bge-m3-q8_0.gguf',
    assets: [
      {
        file: 'bge-m3-q8_0.gguf',
        url: hf('ggml-org/bge-m3-Q8_0-GGUF', 'bge-m3-q8_0.gguf'),
        bytes: 634_553_760,
        sha256: 'aa473d51f451a22f0fcf39ba3330c14bed38a385712b1113440f69df4047a173',
      },
    ],
  },
  {
    id: 'gte-multilingual-base-int8',
    label: 'GTE Multilingual Base INT8',
    kind: 'embedding',
    runtime: 'transformers',
    quantization: 'INT8',
    description: 'Embeddings multilingües con contexto largo y buen equilibrio entre precisión y memoria.',
    sourceUrl: 'https://huggingface.co/onnx-community/gte-multilingual-base',
    licenseLabel: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Alibaba-NLP/gte-multilingual-base',
    contextLength: 8192,
    dimensions: 768,
    capabilities: EMBEDDING_CAPABILITIES,
    modelFile: 'onnx/model_int8.onnx',
    assets: [
      { file: 'config.json', url: hf('onnx-community/gte-multilingual-base', 'config.json'), bytes: 1_648, sha256: '6ef2538d4286a7cd18d05225f659d8a1bceca7adb01c186868e53dbd4f822e17' },
      { file: 'special_tokens_map.json', url: hf('onnx-community/gte-multilingual-base', 'special_tokens_map.json'), bytes: 964, sha256: '8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835' },
      { file: 'tokenizer_config.json', url: hf('onnx-community/gte-multilingual-base', 'tokenizer_config.json'), bytes: 1_149, sha256: '24cebbf2ef20fc317256e03e52ac7b2ca326586f946a8427ecac036332bf0933' },
      {
        file: 'tokenizer.json',
        url: hf('onnx-community/gte-multilingual-base', 'tokenizer.json'),
        bytes: 17_082_734,
        sha256: '3a56def25aa40facc030ea8b0b87f3688e4b3c39eb8b45d5702b3a1300fe2a20',
      },
      {
        file: 'onnx/model_int8.onnx',
        url: hf('onnx-community/gte-multilingual-base', 'onnx/model_int8.onnx'),
        bytes: 340_318_797,
        sha256: 'ab2bd164ebd8ca9003dc49a981b611e849b5d326f504c8873ba76e07fa6c0082',
      },
    ],
  },
  {
    id: 'multilingual-e5-small-int8',
    label: 'Multilingual E5 Small INT8',
    kind: 'embedding',
    runtime: 'transformers',
    quantization: 'INT8',
    description: 'Opción ligera y rápida para equipos con menos memoria.',
    sourceUrl: 'https://huggingface.co/Xenova/multilingual-e5-small',
    licenseLabel: 'MIT',
    licenseUrl: 'https://huggingface.co/intfloat/multilingual-e5-small',
    contextLength: 512,
    dimensions: 384,
    capabilities: EMBEDDING_CAPABILITIES,
    modelFile: 'onnx/model_int8.onnx',
    assets: [
      { file: 'config.json', url: hf('Xenova/multilingual-e5-small', 'config.json'), bytes: 658, sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1' },
      { file: 'special_tokens_map.json', url: hf('Xenova/multilingual-e5-small', 'special_tokens_map.json'), bytes: 167, sha256: 'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7' },
      { file: 'tokenizer_config.json', url: hf('Xenova/multilingual-e5-small', 'tokenizer_config.json'), bytes: 443, sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b' },
      {
        file: 'tokenizer.json',
        url: hf('Xenova/multilingual-e5-small', 'tokenizer.json'),
        bytes: 17_082_730,
        sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
      },
      {
        file: 'onnx/model_int8.onnx',
        url: hf('Xenova/multilingual-e5-small', 'onnx/model_int8.onnx'),
        bytes: 118_054_593,
        sha256: '4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c',
      },
    ],
  },
  {
    id: 'qwen3.5-0.8b-q4',
    label: 'Qwen3.5-0.8B Q4',
    kind: 'chat',
    runtime: 'llama_cpp',
    quantization: 'Q4_K_M',
    description: 'Modelo visual muy ligero para conversación e imagen. La extracción, fusión, perfiles y resúmenes están bloqueados por fiabilidad.',
    sourceUrl: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF',
    licenseLabel: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen3.5-0.8B/blob/main/LICENSE',
    contextLength: 32_768,
    vision: true,
    capabilities: RESTRICTED_VISION_CAPABILITIES,
    modelFile: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    projectorFile: 'mmproj-F16.gguf',
    assets: [
      {
        file: 'Qwen3.5-0.8B-Q4_K_M.gguf',
        url: hf('unsloth/Qwen3.5-0.8B-GGUF', 'Qwen3.5-0.8B-Q4_K_M.gguf'),
        bytes: 532_517_120,
        sha256: 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517',
      },
      {
        file: 'mmproj-F16.gguf',
        url: hf('unsloth/Qwen3.5-0.8B-GGUF', 'mmproj-F16.gguf'),
        bytes: 204_987_232,
        sha256: '56e4c6cfe73b0c82e3e82bc518d7591997e61d81f723fc41a586f4fa69ea2453',
      },
    ],
  },
  {
    id: 'gemma-4-e2b-q4',
    label: 'Gemma 4 E2B Q4',
    kind: 'chat',
    runtime: 'llama_cpp',
    quantization: 'Q4_0 QAT',
    description: 'Modelo visual de mayor calidad; requiere más almacenamiento y memoria.',
    sourceUrl: 'https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf',
    licenseLabel: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf',
    contextLength: 32_768,
    vision: true,
    capabilities: FULL_VISION_CAPABILITIES,
    modelFile: 'gemma-4-E2B_q4_0-it.gguf',
    projectorFile: 'gemma-4-E2B-it-mmproj.gguf',
    assets: [
      {
        file: 'gemma-4-E2B_q4_0-it.gguf',
        url: hf('google/gemma-4-E2B-it-qat-q4_0-gguf', 'gemma-4-E2B_q4_0-it.gguf'),
        bytes: 3_349_514_112,
        sha256: '3646b4c147cd235a44d91df1546d3b7d8e29b547dbe4e1f80856419aa455e6fd',
      },
      {
        file: 'gemma-4-E2B-it-mmproj.gguf',
        url: hf('google/gemma-4-E2B-it-qat-q4_0-gguf', 'gemma-4-E2B-it-mmproj.gguf'),
        bytes: 986_833_312,
        sha256: '58c187648007cab392bd5678b87e862c3e8794017deb945feea2cf256195e96a',
      },
    ],
  },
  {
    id: 'granite-4.0-micro-q4',
    label: 'Granite 4.0 Micro Q4',
    kind: 'chat',
    runtime: 'llama_cpp',
    quantization: 'Q4_K_M',
    description: 'Modelo de texto compacto y rápido para conversación, resúmenes y perfiles. La extracción y la fusión están bloqueadas por fiabilidad: sus decisiones de fusión no cumplen el contrato JSON en obras grandes.',
    sourceUrl: 'https://huggingface.co/ibm-granite/granite-4.0-micro-GGUF',
    licenseLabel: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/ibm-granite/granite-4.0-micro-GGUF',
    contextLength: 32_768,
    capabilities: TEXT_NO_EXTRACTION_CAPABILITIES,
    modelFile: 'granite-4.0-micro-Q4_K_M.gguf',
    assets: [
      {
        file: 'granite-4.0-micro-Q4_K_M.gguf',
        url: hf('ibm-granite/granite-4.0-micro-GGUF', 'granite-4.0-micro-Q4_K_M.gguf'),
        bytes: 2_099_502_528,
        sha256: '97c417dcc0534b0737c74016fb2af083cb17c3b51eaac621192d23961b7024eb',
      },
    ],
  },
  {
    id: 'lfm2.5-vl-1.6b-q4',
    label: 'LFM2.5-VL-1.6B Q4',
    kind: 'chat',
    runtime: 'llama_cpp',
    quantization: 'Q4_0',
    description: 'Modelo visual compacto para conversación e imagen. La extracción, fusión, perfiles y resúmenes están bloqueados por fiabilidad.',
    sourceUrl: 'https://huggingface.co/LiquidAI/LFM2.5-VL-1.6B-GGUF',
    licenseLabel: 'LFM Open License 1.0 · condición comercial ≥ USD 10M',
    licenseUrl: 'https://huggingface.co/LiquidAI/LFM2.5-VL-1.6B-GGUF/blob/48c6a306939241d1ddc99b090df552cb47a066c6/LICENSE',
    contextLength: 32_768,
    vision: true,
    capabilities: RESTRICTED_VISION_CAPABILITIES,
    modelFile: 'LFM2.5-VL-1.6B-Q4_0.gguf',
    projectorFile: 'mmproj-LFM2.5-VL-1.6b-Q8_0.gguf',
    assets: [
      {
        file: 'LFM2.5-VL-1.6B-Q4_0.gguf',
        url: hf('LiquidAI/LFM2.5-VL-1.6B-GGUF', 'LFM2.5-VL-1.6B-Q4_0.gguf'),
        bytes: 695_752_480,
        sha256: '8186364a4e7c3ad30f6dd3d3b7a4e0074c77dd91eed6cad5d8be9090ce285804',
      },
      {
        file: 'mmproj-LFM2.5-VL-1.6b-Q8_0.gguf',
        url: hf('LiquidAI/LFM2.5-VL-1.6B-GGUF', 'mmproj-LFM2.5-VL-1.6b-Q8_0.gguf'),
        bytes: 583_109_888,
        sha256: '2ce89e610c56f3198ece2b86cf61743a08b9307279c89125eb2412ebb908689d',
      },
    ],
  },
] as const;

export function getNodusLocalModel(id: string): NodusLocalModelDefinition | undefined {
  return NODUS_LOCAL_MODELS.find((model) => model.id === id);
}

export function nodusLocalModelBytes(model: NodusLocalModelDefinition): number {
  return model.assets.reduce((sum, asset) => sum + asset.bytes, 0);
}

/**
 * Backwards-compatible extraction-role helper over the explicit capability matrix.
 * Unknown ids and embedding models fail closed: a newly added built-in model must be
 * certified for this role before it can mutate the graph.
 */
export function nodusLocalModelSupportsExtraction(id: string): boolean {
  const model = getNodusLocalModel(id);
  if (!model || model.kind !== 'chat') return false;
  return model.capabilities.extraction;
}

export function nodusLocalModelSupports(id: string, capability: NodusLocalCapability): boolean {
  return getNodusLocalModel(id)?.capabilities[capability] === true;
}

export function modelRefSupportsCapability(
  ref: { provider: string; model: string } | null | undefined,
  capability: NodusLocalCapability,
): boolean {
  if (!ref || ref.provider !== 'nodus') return true;
  return nodusLocalModelSupports(ref.model, capability);
}

/** The built-in chat model recommended as the default local extractor (basic mode / scans). */
export const NODUS_DEFAULT_EXTRACTION_MODEL_ID = 'gemma-4-e2b-q4';

/**
 * Provider-agnostic guard for "can this model reference drive idea extraction?". Cloud models are
 * always assumed capable; only built-in Nodus models carry a benchmarked verdict. Used by the UI to
 * gate the extraction / basic-mode-generic roles, and by the scan pipeline to warn on a bad choice.
 */
export function modelRefSupportsExtraction(ref: { provider: string; model: string } | null | undefined): boolean {
  return modelRefSupportsCapability(ref, 'extraction');
}

/**
 * The same benchmarked verdict, for a model served by somebody else's local server.
 *
 * `modelRefSupportsExtraction` is deliberately narrow: it is a HARD gate (the picker
 * disables the option, the scan pipeline refuses the job), so it may only speak about
 * ids we ship and have measured. But the models it blocks are downloadable by anyone,
 * and running Qwen3.5-0.8B through LM Studio produced exactly the same result as
 * running it through ours: it wanders inside the JSON and returns no ideas — silently,
 * because a third-party provider id told the guard nothing.
 *
 * So the knowledge is separated from the enforcement. This recognises the same weights
 * behind any local server and returns true so the UI can WARN; it never blocks, because
 * on a third-party server the id is a label the user chose, not a build we control.
 */
const WEAK_LOCAL_EXTRACTION_MODELS = NODUS_LOCAL_MODELS
  .filter((model) => model.kind === 'chat' && !model.capabilities.extraction)
  // 'qwen3.5-0.8b-q4' → 'qwen3508b': the family, without our quantization suffix, so
  // 'Qwen/Qwen3.5-0.8B-Instruct-GGUF' and 'qwen3.5-0.8b@q8_0' both match it.
  .map((model) => normalizeLocalModelId(model.id.replace(/-q\d.*$/i, '')));

function normalizeLocalModelId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** True when a third-party local server is serving weights we benchmarked as unable to
 *  extract ideas. False for our own `nodus` provider, which `modelRefSupportsExtraction`
 *  already blocks outright, so a caller never shows two warnings for one model. */
export function localModelRefLikelyWeakAtExtraction(
  ref: { provider: string; model: string } | null | undefined
): boolean {
  if (!ref || (ref.provider !== 'ollama' && ref.provider !== 'lmstudio')) return false;
  const normalized = normalizeLocalModelId(ref.model);
  return WEAK_LOCAL_EXTRACTION_MODELS.some((family) => normalized.includes(family));
}
