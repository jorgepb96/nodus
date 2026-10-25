import { useState } from 'react';
import type { AiProvider, AppSettings, ModelRef } from '@shared/types';
import {
  autoDiscoverableAiProviders,
  collectDiscovery,
  type DiscoveryFailure,
  type DiscoveryOutcome,
  type ModelChoice,
} from '@shared/onboardingModels';
import { modelRefSupportsExtraction } from '@shared/localAiModels';
import { sameModel } from './ui';
import { ModelWithReasoning } from './ModelPicker';
import { SearchableModelSelect } from './SearchableModelSelect';
import { t, tx } from '../i18n';

/**
 * The general text model, with a way back into it.
 *
 * `ModelPicker` offers favourites plus whatever is currently selected, and nothing else.
 * That is fine once a favourite exists, but nothing in this screen could ever create the
 * first one: the only place that discovered a provider's catalogue was the setup wizard.
 * So a vault that finished setup without a model — or whose one selection stopped being a
 * favourite, which is what deleting a downloaded built-in model does — reached a picker
 * whose only entry was «no model selected», with the fix two sections away in Providers
 * and nothing on screen saying so. Reinstalling was a rational thing to try.
 *
 * The embedding row beside this one never had the problem, because it carries its own
 * provider list and a «load models» button. This gives the text model the same thing:
 * one button that asks every provider already reachable (the built-ins, a running local
 * server, every stored key) and a searchable list of what answered. Picking from that
 * list ALSO stars the model, so the favourites picker above is populated from then on
 * and the loop closes.
 */
export function GeneralTextModelControl({
  settings,
  patch,
}: {
  settings: AppSettings;
  patch: (value: Partial<AppSettings>) => Promise<void>;
}) {
  const [choices, setChoices] = useState<ModelChoice[] | null>(null);
  const [failures, setFailures] = useState<DiscoveryFailure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const favorites = settings.favorites ?? [];
  const providerKeys = settings.providerKeys ?? ({} as Record<AiProvider, boolean>);

  /** One provider's listing, with a rejection turned into a reportable outcome so a
   *  single unreachable provider never empties the whole catalogue. */
  const listFor = async (provider: AiProvider): Promise<DiscoveryOutcome> => {
    try {
      return { provider, models: await window.nodus.listModels(provider) };
    } catch (cause) {
      return { provider, error: cause instanceof Error ? cause.message : String(cause) };
    }
  };

  const discover = async () => {
    setLoading(true);
    setError(null);
    try {
      const outcomes = await Promise.all(autoDiscoverableAiProviders(providerKeys).map(listFor));
      const discovery = collectDiscovery(outcomes);
      // This model runs the scans in basic mode, so the same rule the picker applies
      // applies here: a built-in model that cannot extract is not on offer.
      setChoices(discovery.choices.filter((choice) => modelRefSupportsExtraction(choice)));
      setFailures(discovery.failures);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  /** Selecting from the catalogue stars the model too — that is what keeps it reachable
   *  from the picker above after this list is gone. */
  const choose = async (model: ModelRef) => {
    const starred = favorites.some((favorite) => sameModel(favorite, model));
    await patch({ synthesisModel: model, ...(starred ? {} : { favorites: [...favorites, model] }) });
  };

  const nothingToPickFrom = !settings.synthesisModel && favorites.length === 0;

  return (
    <div className="w-full max-w-3xl space-y-2">
      <div className="grid gap-2 lg:grid-cols-[minmax(13rem,1fr)_auto]">
        <ModelWithReasoning
          settings={settings}
          value={settings.synthesisModel}
          onChange={(model) => void patch({ synthesisModel: model })}
          requireExtraction
          menu
        />
        <button
          className="btn btn-ghost justify-center border border-neutral-300 dark:border-neutral-700"
          data-testid="general-text-model-load"
          disabled={loading}
          onClick={() => void discover()}
        >
          {loading ? t('Cargando…') : t('Cargar modelos')}
        </button>
      </div>

      {choices && (
        <SearchableModelSelect
          testId="general-text-model-catalog"
          label={t('Modelo general de texto')}
          value={settings.synthesisModel}
          choices={choices}
          onChange={(model) => void choose(model)}
          loading={loading}
          emptyLabel={t('Ningún proveedor respondió todavía.')}
        />
      )}

      {nothingToPickFrom && !choices && (
        <p className="text-xs leading-5 text-neutral-600 dark:text-neutral-400" data-testid="general-text-model-empty">
          {t('Todavía no hay ningún modelo entre los que elegir. Pulsa «Cargar modelos» para ver los de tus proveedores, o marca los que quieras como favoritos en Ajustes → Proveedores de IA y modelos.')}
        </p>
      )}

      {failures.length > 0 && (
        <p className="text-[11px] leading-5 text-neutral-500" data-testid="general-text-model-failures">
          {tx('Sin respuesta de {list}. Revisa su clave o que el servidor local esté abierto.', {
            list: failures.map((failure) => failure.providerLabel).join(', '),
          })}
        </p>
      )}

      {error && <p role="alert" className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  );
}
