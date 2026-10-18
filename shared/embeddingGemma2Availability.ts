import { isEmbeddingGemma2 } from './embeddingGemma2';

export const EMBEDDING_GEMMA2_INTEL_UNAVAILABLE = 'EmbeddingGemma no está disponible en los Mac con procesador Intel. Elige otro modelo de embeddings.';
export const EMBEDDING_GEMMA2_INTEL_COPY = {
  en: 'EmbeddingGemma is unavailable on Intel Macs. Choose another embedding model.',
  fr: 'EmbeddingGemma est indisponible sur les Mac Intel. Choisissez un autre modèle de plongements.',
  de: 'EmbeddingGemma ist auf Intel-Macs nicht verfügbar. Wähle ein anderes Embedding-Modell.',
  pt: 'O EmbeddingGemma não está disponível em Macs Intel. Escolhe outro modelo de embeddings.',
  'pt-BR': 'O EmbeddingGemma não está disponível em Macs Intel. Escolha outro modelo de embeddings.',
  it: 'EmbeddingGemma non è disponibile sui Mac Intel. Scegli un altro modello di embedding.',
  tr: 'EmbeddingGemma Intel Mac bilgisayarlarda kullanılamaz. Başka bir gömme modeli seçin.',
  'zh-CN': 'EmbeddingGemma 不支持 Intel Mac。请选择其他嵌入模型。',
  'zh-TW': 'EmbeddingGemma 不支援 Intel Mac。請選擇其他嵌入模型。',
  ja: 'EmbeddingGemma は Intel Mac では利用できません。別の埋め込みモデルを選択してください。',
  ko: 'Intel Mac에서는 EmbeddingGemma를 사용할 수 없습니다. 다른 임베딩 모델을 선택하세요.',
} as const;

/** The pinned Transformers runtime has no darwin-x64 native binary. Never
 * substitute the legacy runtime: that would change an immutable vector contract. */
export function nodusLocalModelUnavailableReason(modelId: string, platform: string, arch: string): string | undefined {
  return isEmbeddingGemma2(modelId) && platform === 'darwin' && arch === 'x64'
    ? EMBEDDING_GEMMA2_INTEL_UNAVAILABLE : undefined;
}

export function assertNodusLocalModelAvailable(modelId: string, platform: string, arch: string): void {
  const reason = nodusLocalModelUnavailableReason(modelId, platform, arch);
  if (reason) throw new Error(reason);
}
