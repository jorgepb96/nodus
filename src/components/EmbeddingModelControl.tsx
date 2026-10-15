import { useEffect, useRef, useState } from 'react';
import type { AppSettings, EmbeddingProvider, ModelInfo } from '@shared/types';
import { DEFAULT_EMBEDDING_MODELS, EMBEDDING_PROVIDERS, PROVIDER_LABELS } from '@shared/providers';
import { toModelChoices } from '@shared/onboardingModels';
import { SearchableModelSelect } from './SearchableModelSelect';
import { LocalModelWarning } from './LocalModelWarning';
import { t } from '../i18n';

export function EmbeddingModelControl({
  settings,
  onEmbeddingChange,
}: {
  settings: AppSettings;
  onEmbeddingChange: (provider: EmbeddingProvider, model: string) => void;
}) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const requestId = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = settings.embeddingProvider ?? 'openai';
  const [modelInput, setModelInput] = useState(settings.embeddingModel);

  useEffect(() => setModelInput(settings.embeddingModel), [settings.embeddingModel]);

  const commitModelInput = () => {
    const model = modelInput.trim() || DEFAULT_EMBEDDING_MODELS[provider];
    setModelInput(model);
    if (model !== settings.embeddingModel) onEmbeddingChange(provider, model);
  };

  const setProvider = (next: EmbeddingProvider) => {
    requestId.current++;
    setLoading(false);
    setModels(null);
    setError(null);
    onEmbeddingChange(next, DEFAULT_EMBEDDING_MODELS[next]);
  };

  const loadModels = async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const loaded = await window.nodus.listEmbeddingModels(provider);
      if (request === requestId.current) setModels(loaded);
    } catch (e) {
      if (request === requestId.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  };

  const choices = toModelChoices(provider, models ?? []);

  return (
    <div className="w-full max-w-3xl space-y-2">
      <div className="grid gap-2 lg:grid-cols-[11rem_minmax(13rem,1fr)_auto]">
        <div className="flex items-center gap-1.5">
          <select data-testid="embedding-provider" className="input w-full min-w-0 flex-1" value={provider} onChange={(e) => setProvider(e.target.value as EmbeddingProvider)}>
            {EMBEDDING_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
          {/* `nodus`, `ollama` and `lmstudio` run the whole corpus index on this machine. */}
          <LocalModelWarning provider={provider} testId="embedding-provider-local-warning" />
        </div>
        <input
          data-testid="embedding-model-input"
          className="input w-full min-w-0"
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
          onBlur={commitModelInput}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          placeholder={DEFAULT_EMBEDDING_MODELS[provider]}
        />
        <button className="btn btn-ghost justify-center border border-neutral-700" onClick={loadModels} disabled={loading}>
          {loading ? t('Cargando…') : t('Cargar modelos')}
        </button>
      </div>
      {models && (
        <SearchableModelSelect
          testId="embedding-model-picker"
          label={t('Modelo de embeddings')}
          value={{ provider, model: settings.embeddingModel }}
          choices={choices.some((choice) => choice.model === settings.embeddingModel) ? choices : [
            ...toModelChoices(provider, [{ id: settings.embeddingModel }]), ...choices,
          ]}
          onChange={(model) => onEmbeddingChange(provider, model.model)}
          emptyLabel={t('Seleccionar modelo')}
        />
      )}
      {error && <div className="text-xs text-red-400">{error}</div>}
      <p className="text-xs text-neutral-500">
        {t('OpenRouter acepta IDs como baai/bge-m3; si escribes BAAI:bge-m3 se normaliza automáticamente.')}
      </p>
      <p className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs leading-5 text-amber-200">
        {t('Si cambias de modelo de embeddings, los vectores anteriores no servirán con el nuevo modelo y tendrás que reindexar.')}
      </p>
    </div>
  );
}
