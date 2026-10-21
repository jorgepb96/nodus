/**
 * Local cross-encoder rerankers for documentary and textbook evidence search. Each one runs in
 * its own llama-server (`--reranking`), downloads only on an explicit request, and is verified by
 * size and SHA-256. They reorder candidates; they never change stored embeddings.
 */
export interface LocalRerankerModel {
  id: string;
  label: string;
  /** Spanish source string, translated in the renderer. */
  description: string;
  file: string;
  url: string;
  bytes: number;
  sha256: string;
  sourceUrl: string;
  licenseLabel: string;
  licenseUrl: string;
}

const hf = (repo: string, revision: string, file: string) => `https://huggingface.co/${repo}/resolve/${revision}/${file}?download=true`;

export const LOCAL_RERANKER_MODELS: readonly LocalRerankerModel[] = [
  {
    // gte-multilingual-reranker-base would be lighter, but llama.cpp b10002 refuses its
    // architecture ("unknown model architecture: 'new'"), so the light option is BGE at 4 bits.
    id: 'bge-reranker-v2-m3-q4_k_m',
    label: 'BGE Reranker v2 M3 Q4_K_M',
    description: 'La opción ligera: el mismo modelo multilingüe de BGE cuantizado a 4 bits, con menos descarga y memoria.',
    file: 'bge-reranker-v2-m3-Q4_K_M.gguf',
    url: hf('gpustack/bge-reranker-v2-m3-GGUF', '3093af03b1a635e67b084b1d8c03c5f5e020fd05', 'bge-reranker-v2-m3-Q4_K_M.gguf'),
    bytes: 438_376_864,
    sha256: 'e186a244ed455b4ab66ec64339ce7427a6ae13f5c0b5e544de96e50f0f8b3673',
    sourceUrl: 'https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF',
    licenseLabel: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/BAAI/bge-reranker-v2-m3',
  },
  {
    id: 'qwen3-reranker-0.6b-q8_0',
    label: 'Qwen3 Reranker 0.6B Q8_0',
    description: 'Más de 100 idiomas y la conversión oficial de llama.cpp; reserva unos 5 GB de memoria de GPU, frente a menos de 0,5 GB de BGE.',
    file: 'qwen3-reranker-0.6b-q8_0.gguf',
    url: hf('ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF', 'a02f48bb4f057028298c21fa033da2b30d7742d5', 'qwen3-reranker-0.6b-q8_0.gguf'),
    bytes: 639_153_184,
    sha256: '22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48',
    sourceUrl: 'https://huggingface.co/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF',
    licenseLabel: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen3-Reranker-0.6B',
  },
  {
    id: 'bge-reranker-v2-m3-q8_0',
    label: 'BGE Reranker v2 M3 Q8_0',
    description: 'Multilingüe y probado con la búsqueda de manuales; acompaña a la familia BGE.',
    file: 'bge-reranker-v2-m3-Q8_0.gguf',
    url: hf('gpustack/bge-reranker-v2-m3-GGUF', '3093af03b1a635e67b084b1d8c03c5f5e020fd05', 'bge-reranker-v2-m3-Q8_0.gguf'),
    bytes: 635_676_416,
    sha256: 'a43c7c9b11a4c1517e5bf95151960e1621d1b72f7a493364b01e386cf1aaa1d3',
    sourceUrl: 'https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF',
    licenseLabel: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/BAAI/bge-reranker-v2-m3',
  },
];

/** The only reranker earlier versions shipped: existing downloads keep working unchanged. */
export const DEFAULT_LOCAL_RERANKER_ID = 'bge-reranker-v2-m3-q8_0';

export function getLocalRerankerModel(id: string | null | undefined): LocalRerankerModel | undefined {
  return LOCAL_RERANKER_MODELS.find(model => model.id === id);
}

export function normalizeLocalRerankerId(id: unknown): string {
  return typeof id === 'string' && getLocalRerankerModel(id) ? id : DEFAULT_LOCAL_RERANKER_ID;
}
