import { useCallback, useEffect, useState } from 'react';
import type { AiProvider, EmbeddingProvider, ModelRef } from '@shared/types';
import { PROVIDER_LABELS } from '@shared/providers';
import { getNodusLocalModel, modelRefSupportsExtraction, modelRefSupportsCapability, type NodusLocalAiStatus } from '@shared/localAiModels';
import {
  autoDiscoverableAiProviders,
  autoDiscoverableEmbeddingProviders,
  collectDiscovery,
  configuredKeyProviders,
  providersMissingKey,
  type DiscoveryFailure,
  type DiscoveryOutcome,
  type ModelChoice,
  type ProviderKeyMap,
} from '@shared/onboardingModels';
import { learningText } from '@shared/academicLearningCopy';
import { isLocalModelProvider } from '@shared/providers';
import { getActiveLang, t, tx } from '../i18n';
import { SearchableModelSelect } from './SearchableModelSelect';
import { SubscriptionQuotaNotice } from './ModelPicker';
import { Icon } from './ui';

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Query one provider, turning a rejection into a reportable outcome so a single
 *  unreachable provider never fails the whole discovery pass. */
async function listFor(kind: 'ai' | 'embedding', provider: AiProvider): Promise<DiscoveryOutcome> {
  try {
    const models = kind === 'ai'
      ? await window.nodus.listModels(provider)
      : await window.nodus.listEmbeddingModels(provider as EmbeddingProvider);
    return { provider, models };
  } catch (cause) {
    return { provider, error: errorText(cause) };
  }
}

/**
 * The wizard's provider step. It asks the user for nothing it can find out on its
 * own: on mount it queries every provider that already answers — the built-in
 * local models, a running local server, and every cloud provider whose key is
 * already stored — and merges the results into one searchable picker per role.
 * The user picks two models and nothing is preselected for them; a key prompt appears
 * only as a way to reach more providers, never as a prerequisite.
 */
export function OnboardingModelStep({
  providerKeys,
  aiModel,
  embeddingModel,
  onAiChange,
  onEmbeddingChange,
  disabled, purpose = 'analysis', cloudFirst = false, showEmbeddings = true,
}: {
  providerKeys: ProviderKeyMap;
  aiModel: ModelRef | null;
  embeddingModel: ModelRef | null;
  onAiChange: (ref: ModelRef) => void;
  onEmbeddingChange: (ref: ModelRef) => void;
  disabled?: boolean;
  purpose?: 'chat' | 'analysis';
  cloudFirst?: boolean;
  showEmbeddings?: boolean;
}) {
  const [localEnabled, setLocalEnabled] = useState(!cloudFirst);
  const copy = (key: Parameters<typeof learningText>[0]) => learningText(key, getActiveLang());
  const [keys, setKeys] = useState<ProviderKeyMap>(providerKeys);
  const [aiChoices, setAiChoices] = useState<ModelChoice[]>([]);
  const [embeddingChoices, setEmbeddingChoices] = useState<ModelChoice[]>([]);
  const [failures, setFailures] = useState<DiscoveryFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [localStatus, setLocalStatus] = useState<NodusLocalAiStatus | null>(null);

  // Key prompt (only a shortcut to reach more providers).
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyProvider, setKeyProvider] = useState<AiProvider | ''>('');
  const [keyValue, setKeyValue] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState('');

  const discover = useCallback(async (active: ProviderKeyMap) => {
    setLoading(true);
    const [aiOutcomes, embeddingOutcomes] = await Promise.all([
      Promise.all(autoDiscoverableAiProviders(active).filter(provider => localEnabled || !isLocalModelProvider(provider)).map((provider) => listFor('ai', provider))),
      showEmbeddings ? Promise.all(autoDiscoverableEmbeddingProviders(active).filter(provider => localEnabled || !isLocalModelProvider(provider)).map((provider) => listFor('embedding', provider))) : Promise.resolve([]),
    ]);
    const ai = collectDiscovery(aiOutcomes);
    const embedding = collectDiscovery(embeddingOutcomes);
    // The AI model becomes `synthesisModel`, which runs the scans in basic mode, so it must be able
    // to extract ideas. Drop vision-only local models (Qwen3.5-0.8B, LFM2.5) rather than offering
    // them for a role they cannot hold.
    const aiChoicesCapable = ai.choices.filter((choice) => purpose === 'analysis' ? modelRefSupportsExtraction(choice) : modelRefSupportsCapability(choice, 'chat'));
    setAiChoices(aiChoicesCapable);
    setEmbeddingChoices(embedding.choices);
    // One provider can fail for both roles; report it once.
    const seen = new Set<string>();
    setFailures([...ai.failures, ...embedding.failures].filter((failure) => {
      if (seen.has(failure.provider)) return false;
      seen.add(failure.provider);
      return true;
    }));
    // Neither picker is preselected, here or anywhere: this step exists so the person
    // decides. Every "helpful" default used to hand a vault a model nobody chose for it —
    // `choices[0]` is the bundled local Gemma (the built-in provider is queried first), a
    // favorite was starred in another vault, and the general/embedding settings are shared
    // app-wide, so their value belongs to whichever vault set it last. A local model is a
    // deliberate, resource-heavy choice, so it only reaches a vault because it was picked
    // here by hand — which is when the red warning beside the picker explains the cost.
    // Discoveries re-run when a key is added, and this leaves the two selections alone:
    // they belong to the person, not to the listing.
    setLoading(false);
  }, [localEnabled, purpose, showEmbeddings]);

  useEffect(() => {
    void discover(keys);
    if (localEnabled) void window.nodus.getNodusLocalAiStatus().then(setLocalStatus).catch(() => setLocalStatus(null));
  }, [discover, localEnabled]);

  const saveKey = async () => {
    if (!keyProvider || !keyValue.trim()) return;
    setKeyBusy(true);
    setKeyError('');
    try {
      await window.nodus.setApiKey(keyProvider, keyValue.trim());
      const next = { ...keys, [keyProvider]: true };
      setKeys(next);
      setKeyValue('');
      setKeyOpen(false);
      await discover(next);
    } catch (cause) {
      setKeyError(errorText(cause));
    } finally {
      setKeyBusy(false);
    }
  };

  /** Built-in models are downloaded on finish, so say so before the user picks one. */
  const localNote = (choice: ModelChoice): string | undefined => {
    if (choice.provider !== 'nodus') return undefined;
    if (!getNodusLocalModel(choice.model)) return undefined;
    const downloaded = localStatus?.models.find((model) => model.id === choice.model)?.downloaded;
    return downloaded ? t('ya descargado') : t('se descargará al terminar');
  };

  // Only claim a key worked once its models are actually on offer: a stored but
  // rejected key belongs in the failure line below, not in a success notice.
  const answered = new Set([...aiChoices, ...embeddingChoices].map((choice) => choice.provider));
  const configured = configuredKeyProviders(keys).filter((provider) => answered.has(provider));
  const missing = providersMissingKey(keys);

  return (
    <div className="space-y-4" data-testid="onboarding-models">
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/20 dark:text-amber-200">
        {t('El uso de IA se factura según tu proveedor (OpenAI, Anthropic, Google, OpenRouter…), no por Nodus. Revisa el precio por token y, si quieres evitar sorpresas, establece un límite de gasto (spend limit) desde el panel del proveedor antes de empezar.')}
      </div>

      {configured.length > 0 && (
        <p className="text-xs text-emerald-700 dark:text-emerald-300" data-testid="onboarding-configured-keys">
          {tx('Hemos detectado tus claves ({list}) y cargado sus modelos automáticamente. Las claves se comparten entre todas tus bóvedas.', {
            list: configured.map((provider) => PROVIDER_LABELS[provider]).join(', '),
          })}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          {purpose === 'chat' ? t('Modelo del chat') : t('Modelo de IA')}
          <span className="mt-0.5 block text-[11px] text-neutral-500">{purpose === 'chat' ? t('Pregunta sobre tus fuentes y comprueba las citas de las respuestas.') : copy('cloud')}</span>
          <div className="mt-1.5">
            <SearchableModelSelect
              testId="onboarding-ai-model"
              label={t('Modelo de IA')}
              value={aiModel}
              choices={aiChoices}
              onChange={onAiChange}
              disabled={disabled}
              loading={loading}
              emptyLabel={t('Ningún proveedor respondió todavía.')}
              noteFor={localNote}
            />
          </div>
          {/* Onboarding writes this choice to `synthesisModel` in basic mode, which
              is the fallback for every batch pipeline — so the quota caveat belongs
              here as much as in Settings. */}
          <div className="mt-1.5">
            <SubscriptionQuotaNotice model={aiModel} />
          </div>
        </label>
        {showEmbeddings && <label className="block text-sm">
          {t('Modelo de embeddings')}
          <span className="mt-0.5 block text-[11px] text-neutral-500">{t('Indexa el vault para buscar por significado.')}</span>
          <div className="mt-1.5">
            <SearchableModelSelect
              testId="onboarding-embedding-model"
              label={t('Modelo de embeddings')}
              value={embeddingModel}
              choices={embeddingChoices}
              onChange={onEmbeddingChange}
              disabled={disabled}
              loading={loading}
              emptyLabel={t('Ningún proveedor respondió todavía.')}
              noteFor={localNote}
            />
          </div>
        </label>}
      </div>

      {cloudFirst && <div className="rounded-lg border border-neutral-300 dark:border-neutral-700 p-3"><button type="button" className="btn btn-ghost text-xs" aria-expanded={localEnabled} onClick={() => setLocalEnabled(value => !value)}>{copy('local')}</button>{localEnabled && <p className="mt-2 text-xs leading-5 text-neutral-600 dark:text-neutral-400">{copy('localBody')}</p>}</div>}
      {failures.length > 0 && (
        <p className="text-[11px] leading-5 text-neutral-500" data-testid="onboarding-model-failures">
          {tx('Sin respuesta de {list}. Puedes continuar con el resto y revisarlo luego en Ajustes → Proveedores.', {
            list: failures.map((failure) => failure.providerLabel).join(', '),
          })}
        </p>
      )}

      {missing.length > 0 && (
        <div className="rounded-lg border border-neutral-300 p-3 dark:border-neutral-800" data-testid="onboarding-add-key">
          {!keyOpen ? (
            <button
              type="button"
              className="btn btn-ghost gap-1.5 px-0 text-xs text-indigo-600 dark:text-indigo-300"
              disabled={disabled}
              onClick={() => {
                setKeyProvider(missing[0]);
                setKeyOpen(true);
              }}
            >
              <Icon name="key" size={13} /> {t('Añadir la clave de otro proveedor')}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                <select
                  className="input text-xs"
                  data-testid="onboarding-key-provider"
                  value={keyProvider}
                  disabled={disabled || keyBusy}
                  onChange={(event) => setKeyProvider(event.target.value as AiProvider)}
                >
                  {missing.map((provider) => (
                    <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
                  ))}
                </select>
                <input
                  type="password"
                  className="input min-w-0 text-xs"
                  data-testid="onboarding-key-value"
                  autoFocus
                  value={keyValue}
                  placeholder={t('Clave de IA (se guarda cifrada, nunca se exporta)')}
                  disabled={disabled || keyBusy}
                  onChange={(event) => setKeyValue(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void saveKey(); }}
                />
              </div>
              <div className="flex items-center gap-2">
                <button className="btn btn-primary px-2 py-1 text-xs" disabled={disabled || keyBusy || !keyValue.trim()} onClick={() => void saveKey()}>
                  {keyBusy ? t('Buscando modelos…') : t('Guardar y buscar modelos')}
                </button>
                <button className="btn btn-ghost px-2 py-1 text-xs" disabled={keyBusy} onClick={() => { setKeyOpen(false); setKeyError(''); }}>
                  {t('Cancelar')}
                </button>
              </div>
              {keyError && <p role="alert" className="text-xs text-red-400">{keyError}</p>}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] leading-5 text-neutral-500">
        {t('Los modelos marcados como locales se ejecutan en este equipo y no tienen coste por token. Podrás cambiar ambos modelos y añadir favoritos en Ajustes.')}
      </p>
    </div>
  );
}
