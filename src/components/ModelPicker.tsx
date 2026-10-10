import { useEffect, useRef, useState } from 'react';
import { matchesModelSearch } from '@shared/modelSearch';
import type { AppSettings, CodexReasoningEffort, ModelRef } from '@shared/types';
import { isSubscriptionProvider } from '@shared/providers';
import {
  localModelRefLikelyWeakAtExtraction,
  modelRefSupportsCapability,
  modelRefSupportsExtraction,
  type NodusLocalCapability,
} from '@shared/localAiModels';
import {
  codexReasoningCatalog,
  modelRefWithReasoning,
  reasoningChoiceFor,
  type CodexReasoningCatalog,
} from '@shared/codexReasoning';
import { modelLabel, sameModel, sortModelRefs } from './ui';
import { Icon } from './ui';
import { LocalModelWarning } from './LocalModelWarning';
import { t, tx } from '../i18n';
import './modelPicker.css';
import { useModelPickerPopover } from './useModelPickerPopover';

/**
 * Shown next to the pickers that drive high-volume work (scans, extraction, vision,
 * summaries, fusion). Those providers bill a personal plan with weekly and monthly
 * caps instead of pay-per-use credit, so a single full-corpus run can exhaust the
 * quota. This informs rather than blocks: the choice stays the user's.
 */
export function SubscriptionQuotaNotice({ model }: { model: ModelRef | null | undefined }) {
  if (!model || !isSubscriptionProvider(model.provider)) return null;
  return (
    <p
      role="note"
      data-testid="subscription-quota-notice"
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
    >
      {t('Este modelo consume la cuota de tu suscripción, no crédito de API. Un análisis completo del corpus puede agotar el límite semanal o mensual de tu plan.')}
    </p>
  );
}

/**
 * Shown next to the two pickers that drive idea extraction (the basic-mode generic model and the
 * dedicated extraction model) when the chosen model can't be trusted to extract — today the small
 * built-in vision models (Qwen3.5-0.8B, LFM2.5-VL), which loop inside the JSON and return no ideas.
 * They stay valid for chat/vision, so this warns rather than silently dropping the selection.
 *
 * The same weights reach Nodus through Ollama and LM Studio as well, where the built-in verdict
 * cannot apply (the id is a label the user chose, not a build we ship). Those get the warning
 * without the block: the picker still offers them, and the scan pipeline still runs them.
 */
export function ExtractionCapabilityNotice({ model }: { model: ModelRef | null | undefined }) {
  const unsupported = !modelRefSupportsExtraction(model);
  const weak = !unsupported && localModelRefLikelyWeakAtExtraction(model);
  if (!unsupported && !weak) return null;
  return (
    <p
      role="note"
      data-testid="extraction-capability-notice"
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
    >
      {unsupported
        ? t('Este modelo local es de visión y no extrae ideas de forma fiable (tiende a divagar y no cerrar el JSON). Para extracción, elige Gemma 4 E2B u otro modelo mayor.')
        : t('Estos pesos son los mismos que Nodus descarta entre sus modelos integrados: al extraer ideas divagan y no cierran el JSON. Puedes usarlos igualmente, pero para extracción conviene un modelo mayor.')}
    </p>
  );
}

/**
 * Shown beside the document-profile auditor picker when no separate auditor is configured.
 * The profile is then graded by the same model that wrote it, and that verdict — its
 * `passed` flag and its score — is the only substantive condition for publishing. The
 * document-profile pipeline is the one place in the app where a model's opinion of its own
 * prose decides whether work is published, so it is worth a warning rather than a default.
 */
export function SelfAuditNotice({ generator, auditor }: { generator: ModelRef | null | undefined; auditor: ModelRef | null | undefined }) {
  if (auditor || !generator) return null;
  return (
    <p
      role="note"
      data-testid="self-audit-notice"
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
    >
      {t('Sin un auditor propio, cada ficha documental la puntúa el mismo modelo que la redactó. Elige aquí otro modelo para que la revisión sea independiente.')}
    </p>
  );
}

export function codexReasoningLabel(effort: CodexReasoningEffort): string {
  switch (effort) {
    case 'none': return t('Ninguno');
    case 'minimal': return t('Mínimo');
    case 'low': return t('Bajo');
    case 'medium': return t('Medio');
    case 'high': return t('Alto');
    case 'xhigh': return t('Muy alto');
    case 'max': return t('Máximo');
    case 'ultra': return t('Ultra');
    default: return effort.replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
  }
}

/**
 * One catalogue read per app session, shared by every picker on screen. Codex is the
 * only provider that publishes reasoning levels, so nothing is fetched until a Codex
 * model is actually selected somewhere. A failure (no subscription connected) clears
 * the cache so the next picker to mount can try again instead of being stuck empty.
 */
let catalogRequest: Promise<CodexReasoningCatalog> | null = null;
/** What the request resolved to, kept so a picker mounting later can render its level on
 *  the first paint instead of appearing empty and filling in a tick afterwards. */
let catalogSnapshot: CodexReasoningCatalog | null = null;

function loadCodexReasoningCatalog(): Promise<CodexReasoningCatalog> {
  if (!catalogRequest) {
    catalogRequest = window.nodus
      .listModels('codex')
      .then(codexReasoningCatalog)
      .then((catalog) => { catalogSnapshot = catalog; return catalog; })
      .catch(() => { catalogRequest = null; return {}; });
  }
  return catalogRequest;
}

/** Test seam: hand the catalogue in directly instead of going through the provider. */
export function primeCodexReasoningCatalog(catalog: CodexReasoningCatalog | null): void {
  catalogRequest = catalog ? Promise.resolve(catalog) : null;
  catalogSnapshot = catalog;
}

function useCodexReasoningCatalog(model: ModelRef | null | undefined): CodexReasoningCatalog | null {
  const isCodex = model?.provider === 'codex';
  const [catalog, setCatalog] = useState<CodexReasoningCatalog | null>(() => (isCodex ? catalogSnapshot : null));
  useEffect(() => {
    if (!isCodex) return;
    let alive = true;
    void loadCodexReasoningCatalog().then((loaded) => { if (alive) setCatalog(loaded); });
    return () => { alive = false; };
  }, [isCodex]);
  return catalog;
}

/**
 * The reasoning level for one role, rendered beside its picker so the choice lives
 * where the model is chosen. It writes through the role's own `onChange` — the same
 * one the picker writes through — so the level lands on that role's selection and
 * nowhere else: two roles running one model choose their levels independently.
 *
 * «Predeterminado» names what the role would actually fall back to: the model-wide
 * level from the Providers tab when one is set, otherwise the provider's own
 * recommendation. Renders nothing when the selected model publishes no levels, which
 * is every provider except Codex today.
 */
export function ReasoningPicker({
  settings,
  model,
  onChange,
  compact,
}: {
  settings: AppSettings;
  model: ModelRef | null | undefined;
  onChange: (m: ModelRef) => void;
  compact?: boolean;
}) {
  const catalog = useCodexReasoningCatalog(model);
  const choice = reasoningChoiceFor(catalog, model);
  if (!choice || !model) return null;
  const inherited = settings.codexReasoningEfforts?.[model.model] ?? choice.fallback;
  // A level the model no longer publishes (Codex retires them) must read as
  // «Predeterminado» rather than as a blank box — which is also what the completion
  // call does with it, since it validates against the same live catalogue.
  const chosen = choice.supported.some((option) => option.reasoningEffort === model.reasoningEffort)
    ? model.reasoningEffort
    : undefined;
  return (
    <select
      // Wide enough for the longest level plus its "(default)" suffix in every
      // language, and never allowed to shrink: a truncated level reads as a different
      // level. The picker beside it keeps a floor of its own so neither can vanish.
      className={`input w-48 shrink-0 ${compact ? 'py-1 text-xs' : 'text-xs'}`}
      data-testid={`model-reasoning-${model.model}`}
      aria-label={tx('Razonamiento de {model}', { model: modelLabel(model) })}
      title={t('Nivel de razonamiento de esta tarea. Menos razonamiento responde antes y solo afecta a esta tarea, aunque otras usen el mismo modelo.')}
      value={chosen ?? ''}
      onChange={(event) => onChange(modelRefWithReasoning(
        model,
        event.target.value ? (event.target.value as CodexReasoningEffort) : null
      ))}
    >
      <option value="">
        {inherited
          ? tx('{level} (predeterminado)', { level: codexReasoningLabel(inherited) })
          : t('Predeterminado')}
      </option>
      {choice.supported.map((option) => (
        <option key={option.reasoningEffort} value={option.reasoningEffort} title={option.description}>
          {codexReasoningLabel(option.reasoningEffort)}
        </option>
      ))}
    </select>
  );
}

/**
 * A role's model picker with its reasoning level next to it. Both write through the
 * same `onChange`, so a role's level is stored with the role's model and travels with
 * it. The reasoning selector only takes width when the chosen model actually offers
 * levels, so rows for models without them look exactly as they did.
 */
export function ModelWithReasoning({
  settings,
  value,
  onChange,
  compact,
  allowEmpty = true,
  emptyLabel,
  requireExtraction = false,
  requiredCapability,
  menu,
}: {
  settings: AppSettings;
  value: ModelRef | null;
  onChange: (m: ModelRef | null) => void;
  compact?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  requireExtraction?: boolean;
  requiredCapability?: NodusLocalCapability;
  menu?: boolean;
}) {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
      <ModelPicker
        className="min-w-[8rem] flex-1"
        settings={settings}
        value={value}
        onChange={onChange}
        compact={compact}
        allowEmpty={allowEmpty}
        emptyLabel={emptyLabel}
        requireExtraction={requireExtraction}
        requiredCapability={requiredCapability}
        menu={menu}
      />
      <ReasoningPicker settings={settings} model={value} onChange={onChange} compact={compact} />
      {/* A model that runs on this machine is a heavy, deliberate choice — never a
          silent default. The red mark carries the full caveat on hover/click. */}
      <LocalModelWarning provider={value?.provider} />
    </div>
  );
}

/**
 * Shared selector over favorite models plus the currently persisted value.
 * Null means no explicit choice (the owning workload may define its own fallback).
 * With `requireExtraction`, models that can't drive extraction are shown but disabled — used for the
 * extraction role and the basic-mode generic model (which runs the scans).
 */
export function ModelPicker({
  settings,
  value,
  onChange,
  compact,
  disabled,
  emptyLabel,
  allowEmpty = true,
  menu = true,
  requireExtraction = false,
  requiredCapability,
  triggerModelOnly = false,
  ariaLabel,
  className = '',
}: {
  settings: AppSettings;
  value: ModelRef | null;
  onChange: (m: ModelRef | null) => void;
  compact?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
  allowEmpty?: boolean;
  menu?: boolean;
  requireExtraction?: boolean;
  requiredCapability?: NodusLocalCapability;
  /** Keep compact, in-context pickers readable while the options retain provider names. */
  triggerModelOnly?: boolean;
  /** Accessible control name; the current provider and model are appended as its value. */
  ariaLabel?: string;
  className?: string;
}) {
  const favorites = sortModelRefs(settings.favorites ?? []);
  const capability = requiredCapability ?? (requireExtraction ? 'extraction' : null);
  const blocked = (m: ModelRef) => capability ? !modelRefSupportsCapability(m, capability) : false;
  const optionText = (m: ModelRef) => (blocked(m) ? `${modelLabel(m)} — ${t('rol no certificado')}` : modelLabel(m));
  const serialize = (m: ModelRef) => `${m.provider}::${m.model}`;
  const valueIsFavorite = value ? favorites.some((model) => sameModel(model, value)) : false;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const optionsRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  useModelPickerPopover(open && menu && !disabled, popupRef, triggerRef);
  useEffect(() => {
    if (disabled) { setOpen(false); setQuery(''); }
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (menu) {
    const models = value && !valueIsFavorite ? [value, ...favorites] : favorites;
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filteredModels = models.filter((model) => matchesModelSearch(`${model.provider} ${model.model} ${optionText(model)}`, query));
    const emptyOptionLabel = emptyLabel ? t(emptyLabel) : t('Sin modelo seleccionado');
    const showEmptyOption = allowEmpty && matchesModelSearch(emptyOptionLabel, query);
    const choose = (model: ModelRef | null) => {
      onChange(model);
      setOpen(false);
      setQuery('');
      window.setTimeout(() => triggerRef.current?.focus());
    };
    const focusOption = (direction: 1 | -1 | 'first' | 'last') => {
      const options = [...(optionsRef.current?.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)') ?? [])];
      if (!options.length) return;
      const current = options.indexOf(document.activeElement as HTMLButtonElement);
      const next = direction === 'first' ? 0 : direction === 'last' ? options.length - 1
        : current < 0 ? (direction === 1 ? 0 : options.length - 1) : (current + direction + options.length) % options.length;
      options[next]?.focus();
    };
    const currentLabel = value ? modelLabel(value) : emptyLabel ? t(emptyLabel) : t('Sin modelo seleccionado');
    const closeAndRestoreFocus = () => { setOpen(false); setQuery(''); triggerRef.current?.focus(); };
    const closeOnFocusOutside = (destination: EventTarget | null) => {
      if (destination) {
        if (!rootRef.current?.contains(destination as Node)) { setOpen(false); setQuery(''); }
        return;
      }
      // WebKit can omit relatedTarget during a popover focus transition. Wait
      // for focus to settle before treating that transition as leaving the menu.
      window.setTimeout(() => {
        const root = rootRef.current;
        if (root && !root.contains(document.activeElement)) { setOpen(false); setQuery(''); }
      });
    };
    const openAndFocusSearch = () => {
      if (disabled) return;
      setOpen(true);
    };
    return <div ref={rootRef} className={`model-picker-menu${compact ? ' compact' : ''} ${className}`} onBlur={(event) => {
      closeOnFocusOutside(event.relatedTarget);
    }} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); closeAndRestoreFocus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!open) {
          openAndFocusSearch();
          window.setTimeout(() => focusOption(event.key === 'ArrowDown' ? 'first' : 'last'));
        } else focusOption(event.key === 'ArrowDown' ? 1 : -1);
      }
      if (event.target !== searchRef.current && open && event.key === 'Home') { event.preventDefault(); focusOption('first'); }
      if (event.target !== searchRef.current && open && event.key === 'End') { event.preventDefault(); focusOption('last'); }
    }}>
      <button ref={triggerRef} type="button" className="model-picker-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel ? `${ariaLabel}: ${currentLabel}` : undefined} onClick={() => {
        if (open) closeAndRestoreFocus();
        else openAndFocusSearch();
      }} title={currentLabel}>
        <span>{value ? (triggerModelOnly ? value.model : currentLabel) : currentLabel}</span><Icon name="chevronDown" size={14} />
      </button>
      {open && !disabled && <div ref={popupRef} className="model-picker-options">
        <div className="model-picker-search">
          <Icon name="search" size={13} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                const firstAvailable = filteredModels.find((model) => !blocked(model));
                if (firstAvailable) choose(firstAvailable);
                else if (showEmptyOption) choose(null);
              }
            }}
            placeholder={t('Buscar modelo…')}
            aria-label={t('Buscar modelo…')}
            data-testid="model-picker-search"
          />
        </div>
        <div ref={optionsRef} className="model-picker-list" role="listbox" aria-label={ariaLabel}>
          {showEmptyOption && <button type="button" role="option" aria-label={emptyOptionLabel} aria-selected={!value} className={!value ? 'selected' : ''} onClick={() => choose(null)}>{emptyOptionLabel}</button>}
          {filteredModels.map((model) => <button type="button" role="option" aria-label={optionText(model)} aria-selected={sameModel(model, value)} disabled={blocked(model)} title={blocked(model) ? optionText(model) : undefined} className={sameModel(model, value) ? 'selected' : ''} key={serialize(model)} onClick={() => { if (!blocked(model)) choose(model); }}><span>{optionText(model)}</span>{sameModel(model, value) && <Icon name="check" size={13} />}</button>)}
          {!normalizedQuery && !models.length && !allowEmpty && <span className="model-picker-empty">{t('No hay modelos favoritos configurados.')}</span>}
          {normalizedQuery && !filteredModels.length && !showEmptyOption && <span className="model-picker-empty">{tx('Ningún modelo coincide con «{query}».', { query: query.trim() })}</span>}
        </div>
      </div>}
    </div>;
  }

  return (
    <select
      className={`input ${compact ? 'text-xs py-1' : ''} ${className}`}
      disabled={disabled}
      aria-label={ariaLabel}
      value={value ? serialize(value) : ''}
      onChange={(e) => {
        if (!e.target.value) return onChange(null);
        const [provider, model] = e.target.value.split('::');
        onChange({ provider: provider as ModelRef['provider'], model });
      }}
      title={t('Seleccionar modelo')}
    >
      <option value="" disabled={!allowEmpty}>{emptyLabel ? t(emptyLabel) : t('Sin modelo seleccionado')}</option>
      {value && !valueIsFavorite && <option value={serialize(value)}>{optionText(value)}</option>}
      {favorites.map((m) => (
        <option key={serialize(m)} value={serialize(m)} disabled={blocked(m)}>
          {optionText(m)}
        </option>
      ))}
    </select>
  );
}
