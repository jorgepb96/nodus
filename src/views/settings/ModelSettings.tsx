import { useEffect, useState } from 'react';
import type { AiConcurrencySnapshot, AppSettings, ModelRef, VaultSummary } from '@shared/types';
import type { PrimarySourcePolicySettings } from '@shared/primarySourcesTypes';
import type { LocalRerankerStatus } from '@shared/embeddingComparison';
import { GRANULAR_MODEL_KEYS, type GranularModelKey } from '@shared/modelSettings';
import { LOCAL_RERANKER_MODELS, normalizeLocalRerankerId } from '@shared/localRerankers';
import { ModelWithReasoning, SubscriptionQuotaNotice, ExtractionCapabilityNotice, SelfAuditNotice } from '../../components/ModelPicker';
import { EmbeddingIndexesManager } from '../../components/EmbeddingIndexesManager';
import { GeneralTextModelControl } from '../../components/GeneralTextModelControl';
import { LocalRerankerControl } from '../../components/LocalRerankerControl';
import { SttSettings } from '../../components/SttSettings';
import { LocalAiModelsSettings } from '../../components/LocalAiModelsSettings';
import { LocalImageModelSettings } from '../../components/LocalImageModelSettings';
import { SettingsPanel, SettingsRow, SettingsTabs } from '../../components/SettingsPanel';
import { Icon } from '../../components/ui';
import { ImageGenerationSettings } from '../ProvidersSettings';
import { NarrationSettings } from '../NarrationSettings';
import { t, tx } from '../../i18n';

export type ModelTabId = 'essentials' | 'search' | 'local' | 'image' | 'stt' | 'tts' | 'advanced';

/** A request from outside to open one tab, optionally scrolled to an element in it. */
export type ModelTabRequest = { tab: ModelTabId; target?: string; nonce: number };

const MODEL_TABS: { id: ModelTabId; label: string; icon: string; keywords: string }[] = [
  { id: 'essentials', label: 'Esenciales', icon: 'sparkles', keywords: 'esenciales principal general chat texto conversacion extraccion ideas vision ocr embeddings reranker reordenamiento' },
  { id: 'search', label: 'Búsqueda semántica', icon: 'search', keywords: 'busqueda semantica embeddings indice indices vectores perfil prefijo comparar reranker reordenamiento' },
  { id: 'local', label: 'Modelos locales', icon: 'cube', keywords: 'locales local llama.cpp descargar gemma qwen motor gpu cpu' },
  { id: 'image', label: 'Imagen', icon: 'image', keywords: 'imagen imagenes generacion flux estilo calidad' },
  { id: 'stt', label: 'Voz a texto', icon: 'microphone', keywords: 'voz a texto transcripcion whisper audio dictado stt' },
  { id: 'tts', label: 'Texto a voz', icon: 'volume', keywords: 'texto a voz narracion voz audio ming kokoro pocket clonar grabar tts lectura' },
  { id: 'advanced', label: 'Avanzado', icon: 'sliders', keywords: 'avanzado resumen resumenes fusion relaciones auditor documentos concurrencia llamadas simultaneas razonamiento openrouter contexto deep scan fragmento palabras privacidad alumnado estudio flashcards preguntas' },
];

const MODEL_TAB_STORAGE_KEY = 'nodus.settingsModelTab';

function readRememberedModelTab(): ModelTabId {
  try {
    const remembered = localStorage.getItem(MODEL_TAB_STORAGE_KEY);
    return MODEL_TABS.some((tab) => tab.id === remembered) ? remembered as ModelTabId : 'essentials';
  } catch {
    return 'essentials';
  }
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** The same comparison the main process uses to keep basic mode levelled: the reasoning
 *  level is part of a selection, so two picks that differ only in it are different. */
function sameSelection(a: ModelRef | null | undefined, b: ModelRef | null | undefined): boolean {
  return (a?.provider ?? null) === (b?.provider ?? null)
    && (a?.model ?? null) === (b?.model ?? null)
    && (a?.reasoningEffort ?? null) === (b?.reasoningEffort ?? null);
}

/** Tasks the essentials card shows by name; every other task follows «Chat y texto»
 *  unless its own section picked something else. */
const ESSENTIAL_TASKS = new Set<GranularModelKey>(['extractionModel', 'visionModel']);

/** Names for the tasks that can drift from the main model, to say which ones did. */
const TASK_LABELS: Partial<Record<GranularModelKey, string>> = {
  summaryModel: 'Resúmenes de obras',
  fusionModel: 'Fusión y deduplicación',
  relationModel: 'Relaciones semánticas',
  chatModel: 'Chat con el corpus',
  nodiModel: 'Asistente Nodi',
  deepResearchModel: 'Deep Research',
  immersionModel: 'Inmersión',
  writingModel: 'Nodus Scriptor',
  argumentMapModel: 'Mapa argumental',
  authorModel: 'Autores y biografías',
  dictionaryModel: 'Diccionario',
  studyModel: 'Guías de estudio',
  tutorModel: 'Tutor',
  hypothesisModel: 'Laboratorio de hipótesis',
  improveModel: 'Mejora de texto',
  questionGenModel: 'Generación de preguntas',
  flashcardModel: 'Generación de flashcards',
};

function aiConcurrencyReason(entry: AiConcurrencySnapshot): string | null {
  if (entry.cooldownUntil || /quota-reserved/.test(entry.lastChangeReason)) return 'espera por cuota';
  if (/rate-limited|overloaded|repeated-/.test(entry.lastChangeReason)) return 'reducción temporal';
  if (entry.lastChangeReason === 'healthy-saturated-queue') return 'capacidad ampliada';
  if (entry.lastChangeReason === 'quota-window-reset') return 'cuota restablecida';
  if (entry.provider === 'nodus') return 'límite local seguro';
  return null;
}

/**
 * Settings → AI models.
 *
 * The first tab holds the handful of models the user actually has to choose — the main
 * text model, extraction, vision, embeddings and the reranker. Each tool still picks
 * its own model in place, so the long per-task list that used to sit here is gone; the
 * few scan-pipeline tasks that have no picker of their own live under «Avanzado». The
 * other tabs gather each kind of model (search, local, image, speech) behind an icon,
 * all drawn with the same panel so they read as one screen.
 *
 * There is no basic/advanced switch any more. The mode is derived from the selections:
 * while every task runs the main model the vault stays in basic mode, and it becomes
 * advanced the moment one task picks something else — the main process already flips it
 * when a single task is written, and this screen sets it back once they agree again.
 */
export function ModelSettings({
  settings,
  activeVault,
  query,
  request,
  patch,
  onChange,
}: {
  settings: AppSettings;
  activeVault: VaultSummary | null;
  /** The Settings search, so a query lands on the tab that holds the match. */
  query: string;
  request: ModelTabRequest | null;
  patch: (value: Partial<AppSettings>) => Promise<void>;
  onChange: () => Promise<unknown>;
}) {
  const [tab, setTab] = useState<ModelTabId>(readRememberedModelTab);

  useEffect(() => {
    try { localStorage.setItem(MODEL_TAB_STORAGE_KEY, tab); } catch { /* the tab is a convenience */ }
  }, [tab]);

  useEffect(() => {
    const normalized = normalize(query);
    if (!normalized) return;
    const match = MODEL_TABS.find((item) => normalize(`${item.label} ${t(item.label)} ${item.keywords}`).includes(normalized));
    if (match) setTab(match.id);
  }, [query]);

  useEffect(() => {
    if (!request) return;
    setTab(request.tab);
    if (!request.target) return;
    const target = request.target;
    const timer = window.setTimeout(() => document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    return () => window.clearTimeout(timer);
  }, [request]);

  const tabs = MODEL_TABS.map((item) => ({ id: item.id, icon: item.icon, label: t(item.label) }));
  return <div data-testid="model-settings">
    <SettingsTabs tabs={tabs} active={tab} onSelect={setTab} label={t('Tipos de modelo')} data-testid="model-type-tabs" />
    {tab === 'essentials' && <EssentialModels settings={settings} activeVault={activeVault} patch={patch} onChange={onChange} onOpenTab={setTab} />}
    {tab === 'search' && <>
      <SettingsPanel icon="network" title={t('Índices de embeddings de esta bóveda')} description={t('Cada modelo de embeddings guarda su propio índice. Puedes conservar varios y activar el que prefieras sin volver a generarlo.')}>
        <EmbeddingIndexesManager settings={settings} onChange={onChange} vaultId={activeVault?.id} view="indexes" />
      </SettingsPanel>
      <SettingsPanel icon="sort" title={t('Reordenamiento')} description={t('Ordena los candidatos de la búsqueda documental con un modelo local. No modifica ni regenera embeddings. Si falla, se conserva el orden original.')}>
        <LocalRerankerControl enabled={settings.researchReranking === 'local'} selected={settings.researchRerankerModel}
          onChange={async (enabled) => { await window.nodus.updateSettings({ researchReranking: enabled ? 'local' : 'off' }); await onChange(); }}
          onSelect={async (modelId) => { await window.nodus.updateSettings({ researchRerankerModel: modelId }); await onChange(); }} />
      </SettingsPanel>
    </>}
    {tab === 'local' && <LocalAiModelsSettings settings={settings} patch={patch} />}
    {tab === 'image' && <>
      <ImageGenerationSettings settings={settings} onChange={onChange} />
      <LocalImageModelSettings settings={settings} patch={patch} />
    </>}
    {tab === 'stt' && <SttSettings settings={settings} patch={patch} />}
    {tab === 'tts' && <NarrationSettings settings={settings} patch={patch} />}
    {tab === 'advanced' && <AdvancedModelSettings settings={settings} activeVault={activeVault} patch={patch} />}
  </div>;
}

function EssentialModels({ settings, activeVault, patch, onChange, onOpenTab }: {
  settings: AppSettings;
  activeVault: VaultSummary | null;
  patch: (value: Partial<AppSettings>) => Promise<void>;
  onChange: () => Promise<unknown>;
  onOpenTab: (tab: ModelTabId) => void;
}) {
  const general = settings.synthesisModel;

  /** Writes task selections and the mode they imply, so no switch is ever needed. */
  const patchTasks = (value: Partial<AppSettings>, main: ModelRef | null = general) => {
    const unified = main != null && GRANULAR_MODEL_KEYS.every((key) => sameSelection(key in value ? value[key] : settings[key], main));
    return patch({ ...value, modelSettingsMode: unified ? 'basic' : 'advanced' });
  };

  /** The main model carries along every task that was running it, and leaves the ones
   *  a section deliberately pointed elsewhere where they are. */
  const patchGeneral = async (value: Partial<AppSettings>) => {
    if (!('synthesisModel' in value) || !value.synthesisModel) return patch(value);
    const next = value.synthesisModel;
    const followers: Partial<AppSettings> = {};
    for (const key of GRANULAR_MODEL_KEYS) {
      if (settings.modelSettingsMode === 'basic' || sameSelection(settings[key], general)) (followers as Record<string, ModelRef>)[key] = next;
    }
    return patchTasks({ ...value, ...followers }, next);
  };

  const drifted = GRANULAR_MODEL_KEYS.filter((key) => !ESSENTIAL_TASKS.has(key) && TASK_LABELS[key] && settings[key] && !sameSelection(settings[key], general));
  const unify = () => {
    const value: Partial<AppSettings> = {};
    for (const key of GRANULAR_MODEL_KEYS) if (!ESSENTIAL_TASKS.has(key)) (value as Record<string, ModelRef | null>)[key] = general;
    void patchTasks(value);
  };

  return <SettingsPanel
    icon="sparkles"
    title={t('Modelos esenciales')}
    description={t('Los modelos que Nodus usa a diario. Cada herramienta puede elegir otro desde su propio selector.')}
    data-testid="essential-models"
  >
    <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
      <SettingsRow className="pb-4" icon="chat" label={t('Chat y texto')} hint={t('Conversación, análisis, resúmenes y demás tareas de texto.')}>
        <GeneralTextModelControl settings={settings} patch={patchGeneral} />
      </SettingsRow>
      <SettingsRow className="py-4" icon="scanText" label={t('Extracción')} hint={t('Extrae temas, ideas, evidencias y relaciones cuando Nodus analiza el corpus.')} data-testid="essential-extraction">
        <div className="w-full max-w-3xl space-y-2">
          <ModelWithReasoning allowEmpty={false} settings={settings} value={settings.extractionModel} onChange={(extractionModel) => void patchTasks({ extractionModel })} emptyLabel="Seleccionar modelo" requireExtraction menu />
          {/* One scan covers the whole corpus, so this is where a subscription plan's
              quota runs out first — and the model must be able to extract at all. */}
          <ExtractionCapabilityNotice model={settings.extractionModel} />
          <SubscriptionQuotaNotice model={settings.extractionModel} />
        </div>
      </SettingsRow>
      <SettingsRow className="py-4" icon="eye" label={t('Visión y OCR')} hint={t('Interpreta imágenes y páginas escaneadas y obtiene su texto cuando hace falta.')} data-testid="essential-vision">
        <div className="w-full max-w-3xl space-y-2">
          <ModelWithReasoning allowEmpty={false} settings={settings} value={settings.visionModel} onChange={(visionModel) => void patchTasks({ visionModel })} emptyLabel="Seleccionar modelo" menu />
          <SubscriptionQuotaNotice model={settings.visionModel} />
        </div>
      </SettingsRow>
      <SettingsRow className="py-4" icon="network" label={t('Embeddings')} hint={t('Representa el significado del texto para la búsqueda semántica y la recuperación por similitud.')}>
        <EmbeddingIndexesManager settings={settings} onChange={onChange} vaultId={activeVault?.id} view="model" onManage={() => onOpenTab('search')} />
      </SettingsRow>
      <SettingsRow className="pt-4" icon="sort" label={t('Reordenamiento')} hint={t('Reordena los resultados de la búsqueda documental con un modelo local.')}>
        <RerankerSelect settings={settings} onChange={onChange} onManage={() => onOpenTab('search')} />
      </SettingsRow>
    </div>
    {drifted.length > 0 && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs leading-5 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400" data-testid="essential-models-drift">
      <Icon name="info" size={14} className="shrink-0 text-indigo-500" />
      <p className="min-w-0 flex-1">
        {tx('Usan otro modelo, elegido desde su sección: {list}.', { list: drifted.map((key) => t(TASK_LABELS[key]!)).join(', ') })}
      </p>
      <button className="btn btn-ghost h-8 shrink-0 border border-neutral-300 px-3 text-xs dark:border-neutral-700" data-testid="essential-models-unify" onClick={unify}>
        {t('Usar Chat y texto en todas')}
      </button>
    </div>}
  </SettingsPanel>;
}

/** The reranker in one select: off, or one of the models already on this machine. The
 *  download list lives in «Búsqueda semántica». */
function RerankerSelect({ settings, onChange, onManage }: {
  settings: AppSettings;
  onChange: () => Promise<unknown>;
  onManage: () => void;
}) {
  const [status, setStatus] = useState<LocalRerankerStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void window.nodus.getLocalRerankerStatus().then((next) => { if (alive) setStatus(next); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const downloaded = LOCAL_RERANKER_MODELS.filter((model) => status?.models.some((entry) => entry.id === model.id && entry.available));
  const selectedId = normalizeLocalRerankerId(settings.researchRerankerModel);
  const value = settings.researchReranking === 'local' && downloaded.some((model) => model.id === selectedId) ? selectedId : 'off';
  const choose = async (id: string) => {
    await window.nodus.updateSettings(id === 'off' ? { researchReranking: 'off' } : { researchReranking: 'local', researchRerankerModel: id });
    await onChange();
  };
  return <div className="w-full max-w-3xl space-y-2">
    <select data-testid="essential-reranker" className="input w-full" value={value} disabled={!status} onChange={(event) => void choose(event.target.value)}>
      <option value="off">{t('Sin reordenamiento')}</option>
      {downloaded.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
    </select>
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-neutral-500">
      <span className="min-w-0 flex-1">{downloaded.length ? t('No modifica ni regenera embeddings. Si falla, se conserva el orden original.') : t('Descarga un modelo de reordenamiento para activarlo.')}</span>
      <button className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-300" data-testid="essential-reranker-manage" onClick={onManage}>
        {t('Gestionar modelos')}<Icon name="chevronRight" size={12} />
      </button>
    </p>
  </div>;
}

const STUDY_VAULT_MODEL_FIELDS = [
  { task: 'chat', label: 'Chat con el corpus', hint: 'Responde preguntas sobre el corpus y cita la evidencia utilizada.', key: 'chatModel' },
  { task: 'improve', label: 'Mejora de texto', hint: 'Revisa, amplía y transforma borradores en el Taller de escritura.', key: 'improveModel' },
  { task: 'questions', label: 'Generación de preguntas', hint: 'Adapta explicaciones, preguntas y rutas de aprendizaje en el Tutor.', key: 'questionGenModel' },
  { task: 'flashcards', label: 'Generación de flashcards', hint: 'Prepara guías y materiales de repaso a partir del contenido del vault.', key: 'flashcardModel' },
] as const;

function StudyVaultModelOverrides({ settings, patch }: {
  settings: AppSettings;
  patch: (value: Partial<AppSettings>) => Promise<void>;
}) {
  return <div className="grid grid-cols-[minmax(9rem,1fr)_minmax(11rem,1fr)_minmax(11rem,1fr)] gap-x-4 gap-y-3 text-xs" data-testid="study-model-overrides">
    <b className="text-neutral-600">{t('Tarea')}</b>
    <b className="text-neutral-600">{t('Principal')}</b>
    <b className="text-neutral-600">{t('Alternativo ante error')}</b>
    {STUDY_VAULT_MODEL_FIELDS.map((item) => <div key={item.task} className="contents">
      <span className="self-center text-neutral-800 dark:text-neutral-300">
        {t(item.label)}
        <span className="mt-0.5 block text-[10px] leading-4 text-neutral-500">{t(item.hint)}</span>
      </span>
      <ModelWithReasoning compact allowEmpty={false} settings={settings} value={settings[item.key]} onChange={(model) => void patch({ [item.key]: model })} emptyLabel="Seleccionar modelo" menu />
      <ModelWithReasoning compact settings={settings} value={settings.studyAiFallbackModels[item.task] ?? null} onChange={(model) => void patch({ studyAiFallbackModels: { ...settings.studyAiFallbackModels, [item.task]: model } })} emptyLabel="Sin modelo alternativo" menu />
    </div>)}
  </div>;
}

function AdvancedModelSettings({ settings, activeVault, patch }: {
  settings: AppSettings;
  activeVault: VaultSummary | null;
  patch: (value: Partial<AppSettings>) => Promise<void>;
}) {
  const [aiConcurrency, setAiConcurrency] = useState<AiConcurrencySnapshot[]>([]);
  const [primarySourcePolicy, setPrimarySourcePolicy] = useState<PrimarySourcePolicySettings | null>(null);

  useEffect(() => {
    void window.nodus.getAiConcurrencySnapshot().then(setAiConcurrency);
    return window.nodus.onAiConcurrencySnapshot(setAiConcurrency);
  }, []);

  useEffect(() => {
    if (activeVault?.type !== 'primary_sources') {
      setPrimarySourcePolicy(null);
      return;
    }
    let cancelled = false;
    void window.nodus.getPrimarySourceGovernanceWorkspace().then((workspace) => {
      if (!cancelled) setPrimarySourcePolicy(workspace.policy);
    });
    return () => { cancelled = true; };
  }, [activeVault?.id, activeVault?.type]);

  const patchPrimarySourcePolicy = async (value: Partial<PrimarySourcePolicySettings>) => {
    setPrimarySourcePolicy(await window.nodus.updatePrimarySourcePolicySettings(value));
  };

  const activeChunkWords = settings.deepContextMode === 'long' ? settings.deepLongChunkWords : settings.deepStandardChunkWords;
  const patchActiveChunkWords = (value: string) => {
    const min = settings.deepContextMode === 'long' ? 5000 : 500;
    const max = settings.deepContextMode === 'long' ? 50000 : 5000;
    const parsed = Math.min(max, Math.max(min, parseInt(value, 10) || min));
    void patch(settings.deepContextMode === 'long' ? { deepLongChunkWords: parsed } : { deepStandardChunkWords: parsed });
  };

  return <>
    {/* These scan-pipeline tasks have no picker anywhere else in the app. */}
    <SettingsPanel icon="layers" title={t('Análisis del corpus por tarea')} description={t('Estas tareas usan el modelo de Chat y texto salvo que elijas otro aquí. Repartirlas entre modelos permite ajustar el coste de cada análisis.')} data-testid="common-model-overrides">
      <SettingsRow label={t('Resúmenes de obras')} hint={t('Redacta resúmenes breves de cada obra para orientar la navegación y la recuperación.')}>
        <div className="w-full max-w-3xl space-y-2">
          <ModelWithReasoning allowEmpty={false} settings={settings} value={settings.summaryModel} onChange={(summaryModel) => void patch({ summaryModel })} emptyLabel="Seleccionar modelo" requiredCapability="summary" menu />
          <SubscriptionQuotaNotice model={settings.summaryModel} />
        </div>
      </SettingsRow>
      {activeVault?.type === 'academic' && <>
        <SettingsRow label={t('Comprensión de documentos completos')} hint={t('Analiza todas las secciones y sintetiza la arquitectura global de cada obra.')}>
          <div className="w-full max-w-3xl space-y-2">
            <ModelWithReasoning settings={settings} value={settings.documentProfileModel} onChange={(documentProfileModel) => void patch({ documentProfileModel })} emptyLabel="Usar modelo de resúmenes" requiredCapability="documentProfile" menu />
            <ExtractionCapabilityNotice model={settings.documentProfileModel ?? settings.summaryModel} />
            <SubscriptionQuotaNotice model={settings.documentProfileModel ?? settings.summaryModel} />
          </div>
        </SettingsRow>
        <SettingsRow label={t('Auditor de fichas documentales')} hint={t('Revisa soporte, cobertura y fidelidad antes de publicar una versión nueva.')}>
          <div className="w-full max-w-3xl space-y-2">
            <ModelWithReasoning settings={settings} value={settings.documentAuditModel} onChange={(documentAuditModel) => void patch({ documentAuditModel })} emptyLabel="Usar modelo de comprensión documental" requiredCapability="documentProfile" menu />
            <SelfAuditNotice generator={settings.documentProfileModel ?? settings.summaryModel} auditor={settings.documentAuditModel} />
            <SubscriptionQuotaNotice model={settings.documentAuditModel ?? settings.documentProfileModel ?? settings.summaryModel} />
          </div>
        </SettingsRow>
      </>}
      <SettingsRow label={t('Fusión y deduplicación')} hint={t('Combina resultados equivalentes y elimina duplicados sin perder su evidencia.')}>
        <div className="w-full max-w-3xl space-y-2">
          <ModelWithReasoning allowEmpty={false} settings={settings} value={settings.fusionModel} onChange={(fusionModel) => void patch({ fusionModel })} emptyLabel="Seleccionar modelo" requiredCapability="fusion" menu />
          <ExtractionCapabilityNotice model={settings.fusionModel} />
          <SubscriptionQuotaNotice model={settings.fusionModel} />
        </div>
      </SettingsRow>
      <SettingsRow label={t('Relaciones semánticas')} hint={t('Valida pares de ideas y genera las relaciones del grafo.')}>
        <div className="w-full max-w-3xl space-y-2">
          <ModelWithReasoning allowEmpty settings={settings} value={settings.relationModel} onChange={(relationModel) => void patch({ relationModel })} emptyLabel="Usar modelo de fusión" requiredCapability="fusion" menu />
          <ExtractionCapabilityNotice model={settings.relationModel ?? settings.fusionModel} />
          <SubscriptionQuotaNotice model={settings.relationModel ?? settings.fusionModel} />
        </div>
      </SettingsRow>
    </SettingsPanel>

    {activeVault?.type === 'estudio' && <SettingsPanel icon="graduation" title={t('Vault de estudio')} description={t('Estos cambios no modifican los demás vaults.')}>
      <SettingsRow
        label={t('Procesamiento de materiales nuevos con IA')}
        hint={t('Controla si Nodus crea automáticamente conceptos, citas y relaciones para el mapa de Ideas y el grafo de estudio.')}
      >
        <select
          data-testid="study-knowledge-auto-process"
          className="input"
          value={settings.studyKnowledgeAutoProcess}
          onChange={(event) => void patch({ studyKnowledgeAutoProcess: event.target.value as AppSettings['studyKnowledgeAutoProcess'] })}
        >
          <option value="ask">{t('Preguntar cada vez')}</option>
          <option value="always">{t('Procesar automáticamente')}</option>
          <option value="never">{t('No procesar automáticamente')}</option>
        </select>
      </SettingsRow>
      <StudyVaultModelOverrides settings={settings} patch={patch} />
    </SettingsPanel>}

    <SettingsPanel icon="sliders" title={t('Rendimiento')} description={t('Cuántas peticiones se ejecutan a la vez, cuánto razonan las respuestas y cómo se trocean los documentos.')}>
      <SettingsRow label={t('Llamadas simultáneas')} hint={t('Automático se adapta por proveedor y modelo; Manual conserva un límite fijo entre 1 y 8.')}>
        <div className="flex items-center gap-2">
          <select
            className="input"
            value={settings.aiConcurrencyMode}
            onChange={(e) => patch({
              aiConcurrencyMode: e.target.value as AppSettings['aiConcurrencyMode'],
              aiConcurrencyVersion: 1,
            })}
          >
            <option value="automatic">{t('Automático')}</option>
            <option value="manual">{t('Manual')}</option>
          </select>
          {settings.aiConcurrencyMode === 'manual' && <input
            type="number"
            min={1}
            max={8}
            className="input w-20"
            value={settings.concurrency}
            onChange={(e) => patch({ concurrency: Math.max(1, Math.min(8, parseInt(e.target.value) || 1)) })}
          />}
        </div>
      </SettingsRow>
      {settings.aiConcurrencyMode === 'automatic' && aiConcurrency.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400">
          {aiConcurrency.map((entry) => {
            const reason = aiConcurrencyReason(entry);
            return <div key={`${entry.provider}:${entry.model}`}>
              {entry.provider} · {entry.model}: {t('Automático')} · {entry.currentLimit}/{entry.maximumLimit} {t('ahora')}
              {reason ? ` · ${t(reason)}` : ''}
            </div>;
          })}
        </div>
      )}
      <SettingsRow
        label={t('Razonamiento (chat/tutor/escritura)')}
        hint={t('Los escaneos van sin razonamiento para ir más rápido; esto solo afecta a las respuestas conversacionales. En Codex, el nivel que fijes a cada tarea en Modelos manda también en sus escaneos.')}
      >
        <select
          className="input"
          value={settings.chatReasoning}
          onChange={(e) => patch({ chatReasoning: e.target.value as AppSettings['chatReasoning'] })}
        >
          <option value="off">{t('Desactivado (más rápido)')}</option>
          <option value="low">{t('Bajo')}</option>
          <option value="medium">{t('Medio')}</option>
          <option value="high">{t('Alto (más lento)')}</option>
        </select>
      </SettingsRow>
      <SettingsRow
        label={t('OpenRouter: priorizar velocidad')}
        hint={t('Enruta hacia el proveedor más rápido disponible. Puede aumentar ligeramente el coste.')}
      >
        <input
          type="checkbox"
          checked={settings.openRouterThroughput}
          onChange={(e) => patch({ openRouterThroughput: e.target.checked })}
        />
      </SettingsRow>
      <SettingsRow label={t('Modo de contexto deep scan')} hint={t('Elige cuánto texto conserva cada análisis profundo antes de dividirlo.')}>
        <select
          className="input"
          value={settings.deepContextMode}
          onChange={(e) => patch({ deepContextMode: e.target.value as AppSettings['deepContextMode'] })}
        >
          <option value="standard">{t('Estándar')}</option>
          <option value="long">{t('Contexto largo')}</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('Palabras por fragmento')} hint={t('Define el tamaño de cada fragmento según el modo de contexto seleccionado.')}>
        <input
          type="number"
          min={settings.deepContextMode === 'long' ? 5000 : 500}
          max={settings.deepContextMode === 'long' ? 50000 : 5000}
          step={settings.deepContextMode === 'long' ? 1000 : 100}
          className="input w-28"
          value={activeChunkWords}
          onChange={(e) => patchActiveChunkWords(e.target.value)}
        />
      </SettingsRow>
    </SettingsPanel>

    <SettingsPanel icon="shield" title={t('Privacidad de la IA')}>
      <SettingsRow
        label={t('IA y datos del alumnado')}
        hint={t('La IA de Nodus no recibe listados, notas ni respuestas del alumnado y no puede calificar, perfilar ni evaluar estudiantes. Solo puede generar o estructurar contenido docente que no contenga datos del alumnado.')}
      >
        <span data-testid="settings-no-ai-student-evaluation" className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          <Icon name="shield" size={12} /> {t('Bloqueado por diseño')}
        </span>
      </SettingsRow>
      {activeVault?.type === 'primary_sources' && primarySourcePolicy && (
        <div className="space-y-4 border-t border-neutral-200 pt-4 dark:border-neutral-800" data-testid="primary-sources-ai-policy">
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t('Política de IA de Fuentes primarias')}</h3>
          <p className="text-xs leading-5 text-neutral-500">
            {t('Las fuentes restringidas o embargadas nunca salen del dispositivo. Nodi solo recibe fuentes abiertas y no altamente sensibles; las notas privadas y las propuestas pendientes quedan excluidas.')}
          </p>
          <SettingsRow
            label={t('Confirmar cada envío externo')}
            hint={t('Si está activo, la indexación externa en segundo plano no enviará documentos. Desactívalo solo si autorizas el procesamiento de fuentes abiertas con el proveedor configurado.')}
          >
            <input
              type="checkbox"
              checked={primarySourcePolicy.requireExternalConfirmation}
              onChange={(event) => void patchPrimarySourcePolicy({ requireExternalConfirmation: event.target.checked })}
            />
          </SettingsRow>
          <SettingsRow
            label={t('Permitir IA externa con fuentes privadas')}
            hint={t('Cada fuente privada seguirá necesitando consentimiento explícito. Las fuentes restringidas y embargadas continúan bloqueadas.')}
          >
            <input
              type="checkbox"
              checked={primarySourcePolicy.allowPrivateExternalAi}
              onChange={(event) => void patchPrimarySourcePolicy({ allowPrivateExternalAi: event.target.checked })}
            />
          </SettingsRow>
          <SettingsRow
            label={t('Permitir IA local con fuentes restringidas')}
            hint={t('Solo se aplica a modelos que se ejecutan en tu equipo; nunca autoriza un proveedor remoto.')}
          >
            <input
              type="checkbox"
              checked={primarySourcePolicy.allowRestrictedLocalAi}
              onChange={(event) => void patchPrimarySourcePolicy({ allowRestrictedLocalAi: event.target.checked })}
            />
          </SettingsRow>
        </div>
      )}
    </SettingsPanel>
  </>;
}
