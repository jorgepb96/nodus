import type { AppSettings, ModelRef } from '@shared/types';
import { learningModelPatch } from '@shared/academicLearning';
import { getNodusLocalModel } from '@shared/localAiModels';
import { configureEmbeddingIndex } from '../configureEmbeddingIndex';

/**
 * Make a chosen pair of models usable and store them.
 *
 * Shared by the in-app model dialog and the first-run screen, because "the user picked
 * two models" means the same work in both: download any built-in model that is not on
 * disk yet, point the vault's search index at the embedding model, then write the
 * settings. Returns `null` when the user backed out of the index confirmation, in which
 * case nothing was saved.
 */
export async function saveLearningModels(input: {
  purpose: 'chat' | 'analysis';
  model: ModelRef;
  /** Omitted when the purpose needs no embeddings (analysis, or the manual academic mode). */
  embedding: ModelRef | null;
  /** Called with what is being downloaded, and with '' when downloads are over. */
  onDownload?: (label: string) => void;
  /** Label for the step that installs the local runtime. */
  runtimeLabel?: string;
}): Promise<AppSettings | null> {
  const { purpose, model, embedding, onDownload, runtimeLabel = '' } = input;
  const definitions = [...new Set([model, embedding].filter((ref): ref is ModelRef => ref?.provider === 'nodus').map((ref) => ref.model))]
    .map((id) => getNodusLocalModel(id));
  try {
    if (definitions.length) {
      const status = await window.nodus.getNodusLocalAiStatus();
      if (definitions.some((definition) => definition?.runtime === 'llama_cpp') && !status.runtime.ready) {
        onDownload?.(runtimeLabel);
        await window.nodus.installNodusLocalRuntime(() => {});
      }
      for (const definition of definitions) {
        if (definition && !status.models.some((entry) => entry.id === definition.id && entry.downloaded)) {
          onDownload?.(definition.label);
          await window.nodus.downloadNodusLocalModel(definition.id, () => {});
        }
      }
    }
  } finally {
    onDownload?.('');
  }
  if (embedding && !await configureEmbeddingIndex(embedding)) return null;
  const fresh = await window.nodus.getSettings();
  return window.nodus.updateSettings({
    ...learningModelPatch(fresh, purpose, model, embedding),
    favorites: fresh.favorites.some((entry) => entry.model === model.model && entry.provider === model.provider)
      ? fresh.favorites
      : [...fresh.favorites, model],
  });
}
