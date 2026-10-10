import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  DictionaryDuplicateMatch,
  DictionaryEntry,
  DictionaryEntryDetail,
  DictionaryEntryInput,
  DictionaryEntryPatch,
  DictionaryEntryStatus,
  DictionaryEntrySummary,
  DictionaryEvidenceDecision,
  DictionaryEvidenceItem,
  DictionaryFacets,
  DictionaryScope,
  DictionarySortKey,
  DictionaryProgress,
  DictionaryVersion,
} from "@shared/dictionary";
import {
  DICTIONARY_PROMPT_PRESET_OPTIONS,
  dictionaryPromptPresetOption,
  type DictionaryPromptPreset,
} from "@shared/dictionaryPromptPresets";
import type {
  AppSettings,
  AuthorSummary,
  CollectionFacet,
  ModelRef,
  PromptLanguage,
  WorkView,
  ZoteroTag,
} from "@shared/types";
import { PROMPT_LANGUAGES } from "@shared/types";
import { ConfirmModal } from "../components/ConfirmModal";
import { Markdown, type MarkdownCitation } from "../components/Markdown";
import { ResearchEffortControl } from '../components/ResearchEffortControl';
import { useResearchEffort } from '../hooks/useResearchEffort';
import type { ResearchEffort } from '@shared/researchReasoning';
import type { ResearchWebSearchMode } from '@shared/types';
import { ModelPicker } from "../components/ModelPicker";
import {
  SourceCitationModal,
  type CitationTarget,
  type OpenCitationLibraryWork,
} from "../components/SourceCitationModal";
import { WorkspaceTabStrip } from "../components/library/LibraryWorkspaceTabs";
import { Icon, Spinner } from "../components/ui";
import { useFeatureModel } from "../hooks/useFeatureModel";
import { errorText, getActiveLang, pick, t as appT, tr } from "../i18n";
import { DICTIONARY_TRANSLATIONS } from "../i18n.dictionary";
import { readDictionaryCatalogue, readDictionaryEvidence } from '@shared/dictionaryPagination';
import type { DictionarySnapshot } from "../app/viewSnapshots";

export type DictionaryDetailTab =
  | "overview"
  | "evidence"
  | "authors"
  | "works"
  | "versions"
  | "relations";
type DictionaryTranslationTable = Record<string, string>;
const t = (es: string): string => {
  const language = getActiveLang();
  if (language === "es") return es;
  return (
    (DICTIONARY_TRANSLATIONS[language] as DictionaryTranslationTable)[es] ??
    appT(es)
  );
};
const tx = (es: string, vars: Record<string, string | number>): string => {
  let translated = t(es);
  for (const [name, value] of Object.entries(vars)) {
    translated = translated.split(`{${name}}`).join(String(value));
  }
  return translated;
};
type CatalogData = {
  authors: AuthorSummary[];
  works: WorkView[];
  tags: ZoteroTag[];
  collections: CollectionFacet[];
};
const emptyCatalog: CatalogData = {
  authors: [],
  works: [],
  tags: [],
  collections: [],
};
const DEFAULT_DICTIONARY_PROMPT_PRESET: DictionaryPromptPreset = "basic";
const emptyInput = (): DictionaryEntryInput => ({
  name: "",
  aliases: [],
  focusPrompt: t(
    dictionaryPromptPresetOption(DEFAULT_DICTIONARY_PROMPT_PRESET).prompt,
  ),
  scope: { kind: "vault" },
  outputLanguage: "es",
  detailLevel: "standard",
});
type DictionaryCreationDraft = {
  key: number;
  name: string;
  aliases: string;
};
let dictionaryCreationDraftKey = 0;
const emptyCreationDraft = (): DictionaryCreationDraft => ({
  key: ++dictionaryCreationDraftKey,
  name: "",
  aliases: "",
});
const normalizedCreationName = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
const promptLanguageLabel = (language: PromptLanguage): string => {
  switch (language) {
    case "es":
      return t("Español");
    case "en":
      return t("English");
    case "fr":
      return t("Français");
    case "tr":
      return t("Türkçe");
    case "de":
      return t("Deutsch");
    case "pt":
      return t("Português");
    case "pt-BR":
      return t("Português (Brasil)");
    case "it":
      return t("Italiano");
    case "zh-Hans":
      return "简体中文";
    case "zh-Hant":
      return "繁體中文";
    case "vi":
      return "Tiếng Việt";
    case "ja":
      return "日本語";
    case "ru":
      return "Русский";
    case "uk":
      return "Українська";
    case "ko":
      return "한국어";
  }
};
const dictionaryStatusLabel = (status: DictionaryEntryStatus): string => {
  if (status === "active") {
    return pick({
      es: "Activo",
      en: "Active",
      fr: "Actif",
      de: "Aktiv",
      pt: "Ativo",
      "pt-BR": "Ativo",
      it: "Attivo",
      tr: "Etkin",
      "zh-Hans": "活跃",
      "zh-Hant": "使用中",
      "zh-CN": "活跃",
      'zh-TW': "活躍",
      vi: "Đang hoạt động",
      ja: "有効",
      ru: "Активна",
      uk: "Активна",
      ko: "활성",
    } as Partial<Record<PromptLanguage, string>> & { es: string; en: string });
  }
  if (status === "archived") {
    return pick({
      es: "Archivado",
      en: "Archived",
      fr: "Archivé",
      de: "Archiviert",
      pt: "Arquivado",
      "pt-BR": "Arquivado",
      it: "Archiviato",
      tr: "Arşivlendi",
      "zh-Hans": "已归档",
      "zh-Hant": "已封存",
      "zh-CN": "已归档",
      'zh-TW': "已歸檔",
      vi: "Đã lưu trữ",
      ja: "アーカイブ済み",
      ru: "В архиве",
      uk: "В архіві",
      ko: "보관됨",
    } as Partial<Record<PromptLanguage, string>> & { es: string; en: string });
  }
  return pick({
    es: "Borrador",
    en: "Draft",
    fr: "Brouillon",
    de: "Entwurf",
    pt: "Rascunho",
    "pt-BR": "Rascunho",
    it: "Bozza",
    tr: "Taslak",
    "zh-Hans": "草稿",
    "zh-Hant": "草稿",
    "zh-CN": "草稿",
    'zh-TW': "草稿",
    vi: "Bản nháp",
    ja: "下書き",
    ru: "Черновик",
    uk: "Чернетка",
    ko: "초안",
  } as Partial<Record<PromptLanguage, string>> & { es: string; en: string });
};
const panel =
  "rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950/70";

const csv = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
const message = (reason: unknown) => errorText(reason);
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(getActiveLang(), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs text-neutral-600 dark:text-neutral-400">
      {label}
      {children}
    </label>
  );
}

function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
    >
      {children}
    </p>
  );
}

function ButtonBusy({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 !text-white">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      {label}
    </span>
  );
}

function dictionaryProgressText(value: string): string {
  if (value === "En cola") return t("En cola");
  if (value.startsWith("Analizando corpus")) return t("Analizando corpus…");
  if (value.startsWith("Generando definición")) return t("Generando definición…");
  if (value.startsWith("Redactando definición")) return t("Redactando definición…");
  if (value.startsWith("Comprobando")) return t("Comprobando…");
  return tr(value);
}

function dictionaryVersionText(value: string): string {
  const key = ({ creation: "Creación", update: "Actualización", regeneration: "Regeneración",
    manual_edit: "Edición manual", restore: "Restauración", applied: "Aplicada",
    proposed: "Propuesta", degraded: "Degradada", degradada: "Degradada" } as Record<string, string>)[value]
    ?? value.replaceAll("_", " ");
  return t(key);
}

function dictionaryDegradationText(value?: string | null): string {
  switch (value) {
    case "output_truncated":
      return t("La respuesta se truncó antes de completarse.");
    case "malformed_output":
      return t("El modelo devolvió una respuesta que no se pudo interpretar.");
    case "schema_error":
      return t("La respuesta no respetó la estructura requerida.");
    case "invalid_evidence_refs":
      return t("La respuesta utilizó referencias de evidencia no válidas.");
    case "missing_citations":
      return t("La síntesis no incluyó citas verificables.");
    case "semantic_rejection":
      return t("La verificación rechazó las afirmaciones generadas.");
    case "legacy_extractive_fallback":
      return t("Esta versión procedía del fallback extractivo anterior.");
    default:
      return t("No se obtuvo una síntesis verificable.");
  }
}

function StatusPill({ status }: { status: string }) {
  const classes =
    status === "active"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
      : status === "archived"
        ? "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
        : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
  return (
    <span
      className={`dictionary-status-pill inline-flex w-fit max-w-full justify-self-start rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${classes}`}
    >
      {dictionaryStatusLabel(
        status === "active" || status === "archived" ? status : "draft",
      )}
    </span>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
      {children}
    </span>
  );
}

function ScopeEditor({
  value,
  onChange,
  catalog,
}: {
  value: DictionaryScope;
  onChange: (value: DictionaryScope) => void;
  catalog: CatalogData;
}) {
  const toggle = (values: string[], id: string) =>
    values.includes(id)
      ? values.filter((value) => value !== id)
      : [...values, id];
  return (
    <div className="space-y-3">
      <Field label={t("Ámbito")}>
        <select
          className="input mt-1 w-full"
          value={value.kind}
          onChange={(event) => {
            const kind = event.target.value as DictionaryScope["kind"];
            onChange(
              kind === "vault"
                ? { kind }
                : kind === "authors"
                  ? { kind, authorIds: [] }
                  : kind === "works"
                    ? { kind, workIds: [] }
                    : { kind, zoteroTags: [], collectionKeys: [] },
            );
          }}
        >
          <option value="vault">{t("Toda la bóveda")}</option>
          <option value="authors">{t("Autores seleccionados")}</option>
          <option value="works">{t("Obras seleccionadas")}</option>
          <option value="tags_collections">
            {t("Etiquetas o colecciones")}
          </option>
        </select>
      </Field>
      {value.kind === "authors" && (
        <ChoiceGrid
          items={catalog.authors.map((author) => ({
            id: author.author_id,
            label: author.fullName || author.name,
          }))}
          selected={value.authorIds}
          onToggle={(id) =>
            onChange({ ...value, authorIds: toggle(value.authorIds, id) })
          }
        />
      )}
      {value.kind === "works" && (
        <ChoiceGrid
          items={catalog.works.map((work) => ({
            id: work.nodus_id,
            label: work.title,
          }))}
          selected={value.workIds}
          onToggle={(id) =>
            onChange({ ...value, workIds: toggle(value.workIds, id) })
          }
        />
      )}
      {value.kind === "tags_collections" && (
        <div className="grid gap-3 md:grid-cols-2">
          <ChoiceGrid
            title={t("Etiquetas")}
            items={catalog.tags.map((tag) => ({
              id: tag.label,
              label: `${tag.label} (${tag.workCount})`,
            }))}
            selected={value.zoteroTags}
            onToggle={(id) =>
              onChange({ ...value, zoteroTags: toggle(value.zoteroTags, id) })
            }
          />
          <ChoiceGrid
            title={t("Colecciones")}
            items={catalog.collections.map((item) => ({
              id: item.key,
              label: `${"· ".repeat(item.depth)}${item.name} (${item.workCount})`,
            }))}
            selected={value.collectionKeys}
            onToggle={(id) =>
              onChange({
                ...value,
                collectionKeys: toggle(value.collectionKeys, id),
              })
            }
          />
        </div>
      )}
    </div>
  );
}

function ChoiceGrid({
  items,
  selected,
  onToggle,
  title,
}: {
  items: Array<{ id: string; label: string }>;
  selected: string[];
  onToggle: (id: string) => void;
  title?: string;
}) {
  return (
    <div>
      {title && (
        <p className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">
          {title}
        </p>
      )}
      <div className="max-h-36 overflow-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-950/60">
        {items.length ? (
          items.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-neutral-700 hover:bg-white dark:text-neutral-400 dark:hover:bg-neutral-900"
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              <span className="truncate">{item.label}</span>
            </label>
          ))
        ) : (
          <p className="px-2 py-3 text-xs text-neutral-500">
            {t("No hay opciones disponibles.")}
          </p>
        )}
      </div>
    </div>
  );
}

interface DictionaryResearchOptions {
  thinkingEffort: ResearchEffort;
  onThinkingEffort: (effort: ResearchEffort) => void;
  webSearch: ResearchWebSearchMode;
  onWebSearch: (mode: ResearchWebSearchMode) => void;
}

function DictionaryResearchControls({ model, research, disabled = false }: {
  model: ModelRef | null; research: DictionaryResearchOptions; disabled?: boolean;
}) {
  return <div className="flex flex-wrap items-center gap-2" data-testid="dictionary-research-controls">
    <ResearchEffortControl model={model} value={research.thinkingEffort} onChange={research.onThinkingEffort}
      disabled={disabled} variant="field" testId="dictionary-thinking" />
    <button type="button" className="btn btn-ghost h-8 gap-1.5 text-xs" aria-pressed={research.webSearch !== 'off'}
      disabled={disabled} data-testid="dictionary-web" title={t('Consultar la web cuando sea necesario')}
      onClick={() => research.onWebSearch(research.webSearch === 'off' ? 'auto' : 'off')}>
      <Icon name="globe" size={14} /> {t('Web')} · {t(research.webSearch === 'off' ? 'Desactivada' : 'Automática')}
    </button>
  </div>;
}

function CreationDialog({
  catalog,
  settings,
  model,
  research,
  onModel,
  onClose,
  onOpenExisting,
  onQueued,
}: {
  catalog: CatalogData;
  settings: AppSettings;
  model: ModelRef | null;
  research: DictionaryResearchOptions;
  onModel: (model: ModelRef | null) => void;
  onClose: () => void;
  onOpenExisting: (entry: DictionaryEntrySummary) => void;
  onQueued: (entries: Array<Pick<DictionaryEntry, "id" | "name">>) => void;
}) {
  const [input, setInput] = useState(emptyInput);
  const [drafts, setDrafts] = useState<DictionaryCreationDraft[]>(() => [
    emptyCreationDraft(),
  ]);
  const [promptPreset, setPromptPreset] = useState<
    DictionaryPromptPreset | "custom"
  >(DEFAULT_DICTIONARY_PROMPT_PRESET);
  const [duplicates, setDuplicates] = useState<
    Map<number, DictionaryDuplicateMatch[]> | null
  >(null);
  const [relateTo, setRelateTo] = useState<Map<number, string>>(new Map());
  const [created, setCreated] = useState<Map<number, DictionaryEntry>>(
    new Map(),
  );
  const [relationsAdded, setRelationsAdded] = useState<Set<number>>(new Set());
  const [queuedDrafts, setQueuedDrafts] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState<"checking" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const interfaceLanguage = getActiveLang();

  useEffect(() => {
    if (promptPreset === "custom") return;
    const translatedPrompt = t(
      dictionaryPromptPresetOption(promptPreset).prompt,
    );
    setInput((current) =>
      current.focusPrompt === translatedPrompt
        ? current
        : { ...current, focusPrompt: translatedPrompt },
    );
  }, [interfaceLanguage, promptPreset]);

  const updateDraft = (
    key: number,
    patch: Partial<Pick<DictionaryCreationDraft, "name" | "aliases">>,
  ) =>
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === key ? { ...draft, ...patch } : draft,
      ),
    );
  const removeDraft = (key: number) => {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
    setCreated((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    setRelateTo((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    setRelationsAdded((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setQueuedDrafts((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };
  const namedDrafts = () => drafts.filter((draft) => draft.name.trim());

  const createAndQueue = async () => {
    const batch = namedDrafts();
    if (!batch.length) return;
    setPhase("creating");
    setError(null);
    setDuplicates(null);
    try {
      const results = await Promise.allSettled(
        batch.map(async (draft) => {
          const existing = created.get(draft.key);
          const entry =
            existing ??
            (await window.nodus.createDictionaryEntry({
              ...input,
              name: draft.name,
              aliases: csv(draft.aliases),
            }));
          if (!existing) {
            setCreated((current) => new Map(current).set(draft.key, entry));
          }
          const relation = relateTo.get(draft.key);
          if (relation && !relationsAdded.has(draft.key)) {
            await window.nodus.addDictionaryRelation(
              entry.id,
              relation,
              "related",
            );
            setRelationsAdded((current) => new Set(current).add(draft.key));
          }
          if (!queuedDrafts.has(draft.key)) {
            await window.nodus.startDictionaryGeneration({
              entryId: entry.id,
              mode: "creation",
              model,
              thinkingEffort: research.thinkingEffort,
              webSearch: research.webSearch,
            });
            setQueuedDrafts((current) => new Set(current).add(draft.key));
          }
          return entry;
        }),
      );
      const failures = results.flatMap((result, index) =>
        result.status === "rejected"
          ? [`${batch[index]?.name ?? index + 1}: ${message(result.reason)}`]
          : [],
      );
      if (failures.length) {
        setError(failures.join(" · "));
        setPhase(null);
        return;
      }
      onQueued(
        results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        ),
      );
    } catch (reason) {
      setError(message(reason));
      setPhase(null);
    }
  };
  const check = async () => {
    const batch = namedDrafts();
    if (!batch.length) return;
    const names = batch.map((draft) => normalizedCreationName(draft.name));
    if (new Set(names).size !== names.length) {
      setError(t("Hay conceptos repetidos en el lote."));
      return;
    }
    setPhase("checking");
    setError(null);
    try {
      const matches = await Promise.all(
        batch.map((draft) =>
          created.has(draft.key)
            ? Promise.resolve([])
            : window.nodus.detectDictionaryDuplicates(
                draft.name,
                csv(draft.aliases),
              ),
        ),
      );
      const matching = new Map<number, DictionaryDuplicateMatch[]>();
      matches.forEach((items, index) => {
        if (items.length) matching.set(batch[index]!.key, items);
      });
      if (matching.size) {
        setDuplicates(matching);
        setPhase(null);
      } else await createAndQueue();
    } catch (reason) {
      setError(message(reason));
      setPhase(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-2xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name="thesaurus" />
          </span>
          <div>
            <h2 className="font-semibold">
              {t("Nueva entrada del Diccionario")}
            </h2>
            <p className="text-xs text-neutral-500">
              {t(
                "Nodus buscará la evidencia más relevante y generará la definición automáticamente.",
              )}
            </p>
          </div>
          <button
            className="btn btn-ghost ml-auto"
            disabled={phase !== null}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        {duplicates ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/70 dark:bg-amber-950/20">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                {t("Posibles conceptos duplicados")}
              </h3>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300/70">
                {t("No se fusionará nada automáticamente.")}
              </p>
            </div>
            {[...duplicates.entries()].map(([draftKey, matches]) => {
              const draft = drafts.find((item) => item.key === draftKey);
              return (
                <section
                  key={draftKey}
                  className="space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
                >
                  <h4 className="text-sm font-semibold">
                    {draft?.name ?? t("Concepto")}
                  </h4>
                  {matches.map((match) => (
                    <div
                      key={match.entry.id}
                      className="flex items-center gap-3 rounded-lg bg-neutral-50 p-2 dark:bg-neutral-900/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {match.entry.name}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                          {t(match.match)}
                          {match.similarity
                            ? ` · ${Math.round(match.similarity * 100)}%`
                            : ""}
                        </p>
                      </div>
                      <button
                        className="btn btn-ghost"
                        onClick={() => onOpenExisting(match.entry)}
                      >
                        {t("Abrir")}
                      </button>
                      <button
                        className={`btn ${relateTo.get(draftKey) === match.entry.id ? "btn-primary" : "btn-ghost"}`}
                        onClick={() =>
                          setRelateTo((current) => {
                            const next = new Map(current);
                            if (next.get(draftKey) === match.entry.id)
                              next.delete(draftKey);
                            else next.set(draftKey, match.entry.id);
                            return next;
                          })
                        }
                      >
                        {t("Relacionar")}
                      </button>
                    </div>
                  ))}
                </section>
              );
            })}
            {error && <ErrorNotice>{error}</ErrorNotice>}
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-ghost"
                disabled={phase !== null}
                onClick={() => setDuplicates(null)}
              >
                {t("Volver")}
              </button>
              <button
                className="btn btn-primary !text-white disabled:!text-white"
                disabled={phase !== null}
                onClick={() => void createAndQueue()}
              >
                {phase === "creating" ? (
                  <ButtonBusy
                    label={tx("Preparando {n} definiciones…", {
                      n: namedDrafts().length,
                    })}
                  />
                ) : (
                  namedDrafts().length > 1
                    ? tx("Generar {n} definiciones de todos modos", {
                        n: namedDrafts().length,
                      })
                    : t("Generar de todos modos")
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {drafts.map((draft, index) => {
                const persisted = created.has(draft.key);
                return (
                  <div
                    key={draft.key}
                    data-testid="dictionary-concept-row"
                    className="grid items-end gap-3 rounded-xl border border-neutral-200 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] dark:border-neutral-800"
                  >
                    <Field label={`${t("Concepto")} ${index + 1}`}>
                      <input
                        autoFocus={index === 0}
                        data-testid={`dictionary-concept-name-${index}`}
                        className="input mt-1 w-full"
                        value={draft.name}
                        disabled={persisted || phase !== null}
                        onChange={(event) =>
                          updateDraft(draft.key, { name: event.target.value })
                        }
                      />
                    </Field>
                    <Field label={t("Aliases o términos alternativos")}>
                      <input
                        className="input mt-1 w-full"
                        placeholder={t("Separados por comas")}
                        value={draft.aliases}
                        disabled={persisted || phase !== null}
                        onChange={(event) =>
                          updateDraft(draft.key, {
                            aliases: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <button
                      type="button"
                      className="btn btn-ghost h-9 w-9 p-0"
                      aria-label={t("Quitar concepto")}
                      title={t("Quitar concepto")}
                      disabled={
                        drafts.length === 1 || persisted || phase !== null
                      }
                      onClick={() => removeDraft(draft.key)}
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="dictionary-add-concept"
                  className="btn btn-ghost"
                  disabled={phase !== null}
                  onClick={() =>
                    setDrafts((current) => [
                      ...current,
                      emptyCreationDraft(),
                    ])
                  }
                >
                  <Icon name="plus" /> {t("Añadir concepto")}
                </button>
                <p className="text-xs text-neutral-500">
                  {t(
                    "Cada concepto se guardará como una entrada independiente y se procesará en paralelo.",
                  )}
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.6fr)]">
              <label className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon name="sparkles" className="text-indigo-500" />
                  {t("Preconfiguración del prompt")}
                </span>
                <select
                  data-testid="dictionary-prompt-preset"
                  className="input mt-2 w-full"
                  value={promptPreset}
                  onChange={(event) => {
                    const value = event.target.value as
                      | DictionaryPromptPreset
                      | "custom";
                    setPromptPreset(value);
                    if (value !== "custom") {
                      setInput({
                        ...input,
                        focusPrompt: t(
                          dictionaryPromptPresetOption(value).prompt,
                        ),
                      });
                    }
                  }}
                >
                  {DICTIONARY_PROMPT_PRESET_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {t(option.label)}
                    </option>
                  ))}
                  <option value="custom">{t("Personalizado")}</option>
                </select>
                <p
                  data-testid="dictionary-prompt-preset-help"
                  className="mt-2 text-xs leading-relaxed text-neutral-500"
                >
                  {promptPreset === "custom"
                    ? t(
                        "Escribe o adapta libremente las instrucciones para la síntesis.",
                      )
                    : t(dictionaryPromptPresetOption(promptPreset).description)}
                </p>
              </label>
              <Field label={t("Prompt de enfoque")}>
                <textarea
                  data-testid="dictionary-focus-prompt"
                  className="input mt-1 min-h-32 w-full resize-y"
                  value={input.focusPrompt}
                  onChange={(event) => {
                    const focusPrompt = event.target.value;
                    setInput({ ...input, focusPrompt });
                    const matching = DICTIONARY_PROMPT_PRESET_OPTIONS.find(
                      (option) => t(option.prompt) === focusPrompt,
                    );
                    setPromptPreset(matching?.id ?? "custom");
                  }}
                  placeholder={t(
                    "Qué aspecto del concepto debe priorizar la síntesis",
                  )}
                />
              </Field>
            </div>
            <ScopeEditor
              value={input.scope}
              onChange={(scope) => setInput({ ...input, scope })}
              catalog={catalog}
            />
            <div className="grid items-end gap-4 md:grid-cols-3">
              <Field label={t("Idioma de salida")}>
                <select
                  className="input mt-1 w-full"
                  value={input.outputLanguage}
                  onChange={(event) =>
                    setInput({
                      ...input,
                      outputLanguage: event.target.value as PromptLanguage,
                    })
                  }
                >
                  {PROMPT_LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {promptLanguageLabel(lang)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Nivel de detalle")}>
                <select
                  className="input mt-1 w-full"
                  value={input.detailLevel}
                  onChange={(event) =>
                    setInput({
                      ...input,
                      detailLevel: event.target
                        .value as DictionaryEntryInput["detailLevel"],
                    })
                  }
                >
                  <option value="concise">{t("Conciso")}</option>
                  <option value="standard">{t("Estándar")}</option>
                  <option value="detailed">{t("Detallado")}</option>
                </select>
              </Field>
              <Field label={t("Modelo de síntesis")}>
                <ModelPicker
                  className="mt-1 w-full"
                  settings={settings}
                  value={model}
                  onChange={onModel}
                  compact
                  allowEmpty={false}
                  menu
                />
                <DictionaryResearchControls model={model} research={research} disabled={!!phase} />
              </Field>
            </div>
            {error && <ErrorNotice>{error}</ErrorNotice>}
            <div className="flex items-center justify-end gap-2">
              {created.size > 0 && (
                <span className="mr-auto text-xs text-neutral-500">
                  {created.size === 1
                    ? t(
                        "La entrada ya está guardada; reintentar no creará un duplicado.",
                      )
                    : tx(
                        "{n} entradas ya están guardadas; reintentar no creará duplicados.",
                        { n: created.size },
                      )}
                </span>
              )}
              <button
                className="btn btn-ghost"
                disabled={phase !== null}
                onClick={onClose}
              >
                {t("Cancelar")}
              </button>
              <button
                className="btn btn-primary !text-white disabled:!text-white"
                disabled={
                  phase !== null ||
                  !drafts.some((draft) => draft.name.trim())
                }
                onClick={() => void check()}
              >
                {phase === "checking" ? (
                  <ButtonBusy label={t("Comprobando duplicados…")} />
                ) : phase === "creating" ? (
                  <ButtonBusy
                    label={tx("Preparando {n} definiciones…", {
                      n: namedDrafts().length,
                    })}
                  />
                ) : created.size > 0 ? (
                  t("Reintentar generación")
                ) : namedDrafts().length > 1 ? (
                  tx("Generar {n} definiciones", { n: namedDrafts().length })
                ) : (
                  t("Generar definición")
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function DictionaryView({
  settings,
  mobile = false,
  snapshot,
  onSnapshotChange,
  onOpenIdea,
  onOpenAuthor,
  onOpenLibraryWork,
}: {
  settings: AppSettings;
  mobile?: boolean;
  /** Where this section was last left. Read once, at mount, and never again. */
  snapshot?: DictionarySnapshot;
  onSnapshotChange?: (patch: Partial<DictionarySnapshot>) => void;
  onOpenIdea: (id: string) => void;
  onOpenAuthor: (id: string, name: string) => void;
  onOpenLibraryWork: OpenCitationLibraryWork;
}) {
  const [model, setModel] = useFeatureModel(settings, "dictionaryModel");
  const [thinkingEffort, onThinkingEffort] = useResearchEffort(settings, model);
  const [webSearch, onWebSearch] = useState<ResearchWebSearchMode>(
    () => settings.researchWebSearch ?? 'auto',
  );
  const research = { thinkingEffort, onThinkingEffort, webSearch, onWebSearch };
  const [entries, setEntries] = useState<DictionaryEntrySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [facets, setFacets] = useState<DictionaryFacets>({
    letters: [],
    tags: [],
    authors: [],
    works: [],
  });
  const [catalog, setCatalog] = useState<CatalogData>(emptyCatalog);
  const [openEntries, setOpenEntries] = useState<
    Array<{ id: string; title: string }>
  >(() =>
    (snapshot?.openEntries ?? []).map((entry) => ({
      id: entry.id,
      title: entry.label,
    })),
  );
  const [activeId, setActiveId] = useState<string | null>(() =>
    snapshot?.openEntries?.some((entry) => entry.id === snapshot.activeEntryId)
      ? snapshot.activeEntryId
      : null,
  );
  const [detailTabs, setDetailTabs] = useState<
    Record<string, DictionaryDetailTab>
  >(() => snapshot?.detailTabs ?? {});
  const [query, setQuery] = useState(() => snapshot?.query ?? "");
  const [letter, setLetter] = useState(() => snapshot?.letter ?? "");
  const [status, setStatus] = useState<DictionaryEntryStatus | "">(
    () => snapshot?.status ?? "",
  );
  const [tag, setTag] = useState(() => snapshot?.tag ?? "");
  const [authorId, setAuthorId] = useState(() => snapshot?.authorId ?? "");
  const [workId, setWorkId] = useState(() => snapshot?.workId ?? "");
  const [newOnly, setNewOnly] = useState(() => snapshot?.newOnly ?? false);
  const [insufficientOnly, setInsufficientOnly] = useState(
    () => snapshot?.insufficientOnly ?? false,
  );
  const [sortKey, setSortKey] = useState<DictionarySortKey>(
    () => snapshot?.sortKey ?? "updated",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    () => snapshot?.sortDir ?? "desc",
  );
  const [viewMode, setViewMode] = useState<"list" | "table">(
    () => snapshot?.viewMode ?? "list",
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generationJobs, setGenerationJobs] = useState<
    Map<string, DictionaryProgress>
  >(new Map());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const report = useRef(onSnapshotChange);
  report.current = onSnapshotChange;
  useEffect(() => {
    report.current?.({
      openEntries: openEntries.map(({ id, title }) => ({ id, label: title })),
      activeEntryId: activeId,
      detailTabs,
      query,
      letter,
      status,
      tag,
      authorId,
      workId,
      newOnly,
      insufficientOnly,
      sortKey,
      sortDir,
      viewMode,
    });
  }, [
    activeId,
    authorId,
    detailTabs,
    insufficientOnly,
    letter,
    newOnly,
    openEntries,
    query,
    sortDir,
    sortKey,
    status,
    tag,
    viewMode,
    workId,
  ]);
  const reload = useCallback(
    async (foreground = true) => {
      if (foreground) setLoading(true);
      setError(null);
      try {
        const [page, nextFacets] = await Promise.all([
          readDictionaryCatalogue(request => window.nodus.listDictionaryEntries(request), {
            query,
            letter: letter || undefined,
            tags: tag ? [tag] : undefined,
            authorIds: authorId ? [authorId] : undefined,
            workIds: workId ? [workId] : undefined,
            statuses: status ? [status as DictionaryEntryStatus] : undefined,
            hasNewEvidence: newOnly || undefined,
            insufficientEvidence: insufficientOnly || undefined,
            sort: { key: sortKey, dir: sortDir },
          }),
          window.nodus.listDictionaryFacets(),
        ]);
        setEntries(page.items);
        setTotal(page.total);
        setFacets(nextFacets);
        return true;
      } catch (reason) {
        setError(message(reason));
        return false;
      } finally {
        if (foreground) setLoading(false);
      }
    },
    [
      authorId,
      insufficientOnly,
      letter,
      newOnly,
      query,
      sortDir,
      sortKey,
      status,
      tag,
      workId,
    ],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 180);
    return () => window.clearTimeout(timer);
  }, [reload]);
  useEffect(() => {
    void Promise.all([
      window.nodus.listAuthors(),
      window.nodus.listWorks(),
      window.nodus.listZoteroTags(),
      window.nodus.listCollectionFacets(),
    ]).then(([authors, works, tags, collections]) =>
      setCatalog({ authors, works, tags, collections }),
    );
  }, []);
  useEffect(() => {
    void window.nodus
      .scanChangedDictionaryEntries(20)
      .then((ids) => {
        if (ids.length) void reload(false);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    let alive = true;
    void window.nodus
      .listDictionaryGenerationJobs()
      .then((jobs) => {
        if (!alive) return;
        setGenerationJobs((current) => {
          // A successful job has already committed the entry's persistent
          // lifecycle status. Rehydrating that terminal progress would cover
          // "Active" with "Generated" for the rest of the app session.
          const next = new Map(
            jobs
              .filter((job) => job.phase !== "done")
              .map((job) => [job.entryId, job]),
          );
          // Events received while the IPC round-trip was in flight are newer than
          // the returned snapshot and must win.
          for (const [entryId, progress] of current) {
            if (progress.phase !== "done") next.set(entryId, progress);
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  useEffect(
    () =>
      window.nodus.onDictionaryChanged(() => {
        void reload(false);
      }),
    [reload],
  );
  useEffect(
    () =>
      window.nodus.onDictionaryProgress((progress) => {
        setGenerationJobs((current) => {
          const next = new Map(current);
          next.set(progress.entryId, progress);
          return next;
        });
        if (progress.phase === "done") {
          // Keep the completion tick only until the saved entry has been read
          // back. Afterwards its real status (normally Active) owns the column.
          void reload(false).then((reloaded) => {
            if (!reloaded) return;
            setGenerationJobs((current) => {
              if (current.get(progress.entryId)?.phase !== "done") return current;
              const next = new Map(current);
              next.delete(progress.entryId);
              return next;
            });
          });
        } else if (progress.phase === "degraded") {
          void reload(false);
        }
      }),
    [reload],
  );
  const openEntry = (entry: Pick<DictionaryEntrySummary, "id" | "name">) => {
    setOpenEntries((current) =>
      current.some((item) => item.id === entry.id)
        ? current
        : [...current, { id: entry.id, title: entry.name }],
    );
    setActiveId(entry.id);
  };
  const closeEntry = (id: string) => {
    const index = openEntries.findIndex((entry) => entry.id === id);
    const next = openEntries.filter((entry) => entry.id !== id);
    setOpenEntries(next);
    setDetailTabs((current) => {
      if (!(id in current)) return current;
      const nextTabs = { ...current };
      delete nextTabs[id];
      return nextTabs;
    });
    if (activeId === id)
      setActiveId(next[Math.min(index, next.length - 1)]?.id ?? null);
  };
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const remove = async (ids: string[]) => {
    if (!ids.length) return;
    setPendingDeleteIds(null);
    try {
      await window.nodus.deleteDictionaryEntries(ids);
      const deleted = new Set(ids);
      setOpenEntries((current) =>
        current.filter((entry) => !deleted.has(entry.id)),
      );
      setActiveId((current) =>
        current && deleted.has(current) ? null : current,
      );
      setDetailTabs((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => !deleted.has(id)),
        ) as Record<string, DictionaryDetailTab>,
      );
      setSelected(new Set());
      await reload();
    } catch (reason) {
      setError(message(reason));
    }
  };

  return (
    <div
      data-testid="dictionary-workspace"
      className={`dictionary-workspace ${mobile ? 'dictionary-mobile' : ''} theme-workspace-surface flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100`}
    >
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name="thesaurus" size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{t("Diccionario")}</h1>
            <p className="text-[11px] text-neutral-500">
              {t(
                "Conceptos con evidencia de tu biblioteca y, cuando sea necesario, de la web.",
              )}
            </p>
          </div>
          <div className="flex-1" />
          <details open={mobile ? undefined : true} className="dictionary-model-options">
          <summary>{t("Modelo de síntesis")}</summary>
          <span className="dictionary-model-label text-xs text-neutral-500">
            {t("Modelo de síntesis")}
          </span>
          <ModelPicker
            className="!w-auto max-w-full"
            settings={settings}
            value={model}
            onChange={setModel}
            compact
            allowEmpty={false}
            menu
          />
          <DictionaryResearchControls model={model} research={research} />
          </details>
          {selected.size > 0 && (
            <button
              className="btn btn-ghost border border-red-200 text-red-600 dark:border-red-900/70 dark:text-red-400"
              onClick={() => setPendingDeleteIds([...selected])}
            >
              <Icon name="trash" /> {tx("Eliminar ({n})", { n: selected.size })}
            </button>
          )}
          <button
            className="btn btn-primary !text-white"
            data-testid="dictionary-new"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" /> {t("Nueva entrada")}
          </button>
        </div>
        <WorkspaceTabStrip
          homeLabel={tx("Diccionario ({n})", { n: total })}
          homeIcon="list"
          homeTestId="dictionary-tab-home"
          tabTestId={(tab) => `dictionary-tab-${tab.key}`}
          closeTestId={(tab) => `dictionary-close-${tab.key}`}
          tabs={openEntries.map((entry) => ({
            key: entry.id,
            title: entry.title,
            icon: "thesaurus",
          }))}
          activeKey={activeId}
          onActivateHome={() => setActiveId(null)}
          onActivateTab={setActiveId}
          onCloseTab={closeEntry}
        />
      </header>
      {activeId ? (
        <DictionaryEntryView
          key={activeId}
          mobile={mobile}
          entryId={activeId}
          restoredTab={detailTabs[activeId]}
          onTabChange={(tab) =>
            setDetailTabs((current) =>
              current[activeId] === tab
                ? current
                : { ...current, [activeId]: tab },
            )
          }
          progress={generationJobs.get(activeId)}
          onGenerationStarted={(progress) =>
            setGenerationJobs((current) => {
              const existing = current.get(progress.entryId);
              if (
                existing &&
                !["done", "failed"].includes(existing.phase)
              ) {
                return current;
              }
              const next = new Map(current);
              next.set(progress.entryId, progress);
              return next;
            })
          }
          settings={settings}
          model={model}
          research={research}
          catalog={catalog}
          onRename={(title) =>
            setOpenEntries((current) =>
              current.map((entry) =>
                entry.id === activeId ? { ...entry, title } : entry,
              ),
            )
          }
          onOpenIdea={onOpenIdea}
          onOpenAuthor={onOpenAuthor}
          onOpenLibraryWork={onOpenLibraryWork}
          onOpenEntry={openEntry}
        />
      ) : (
        <main className="min-h-0 flex-1 overflow-auto p-5">
          <div className="mx-auto max-w-[110rem]">
            <div className="mb-3 flex flex-wrap gap-2">
              <div className="relative min-w-72 flex-1">
                <Icon
                  name="search"
                  size={13}
                  className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                />
                <input
                  className="input input-with-leading-icon w-full"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t(
                    "Buscar concepto, alias, descripción, etiqueta, autor u obra…",
                  )}
                />
              </div>
              {mobile && <button className="btn btn-ghost" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}>{t("Filtros")}</button>}
              <div className={`dictionary-facets ${mobile && !filtersOpen ? 'dictionary-filters-hidden' : ''}`}>
              <select
                className="input"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as DictionaryEntryStatus | "")
                }
              >
                <option value="">{t("Todos los estados")}</option>
                <option value="draft">{dictionaryStatusLabel("draft")}</option>
                <option value="active">{dictionaryStatusLabel("active")}</option>
                <option value="archived">{dictionaryStatusLabel("archived")}</option>
              </select>
              <select
                className="input max-w-44"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
              >
                <option value="">{t("Todas las etiquetas")}</option>
                {facets.tags.map((item) => (
                  <option key={item.label}>{item.label}</option>
                ))}
              </select>
              <select
                className="input max-w-44"
                value={authorId}
                onChange={(event) => setAuthorId(event.target.value)}
              >
                <option value="">{t("Todos los autores")}</option>
                {facets.authors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                className="input max-w-44"
                value={workId}
                onChange={(event) => setWorkId(event.target.value)}
              >
                <option value="">{t("Todas las obras")}</option>
                {facets.works.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              </div>
            </div>
            <div className={`mb-4 flex flex-wrap items-center gap-2 ${mobile && !filtersOpen ? 'dictionary-filters-hidden' : ''}`}>
              <div className="flex flex-wrap gap-1">
                <button
                  className={`dictionary-filter-button btn btn-ghost h-7 px-2 ${!letter ? "is-selected text-indigo-600 dark:text-indigo-300" : ""}`}
                  onClick={() => setLetter("")}
                >
                  {t("Todas")}
                </button>
                {["#", ...facets.letters.filter((item) => item !== "#")].map(
                  (item) => (
                    <button
                      key={item}
                      className={`dictionary-filter-button btn btn-ghost h-7 w-7 p-0 ${letter === item ? "is-selected text-indigo-600 dark:text-indigo-300" : ""}`}
                      onClick={() => setLetter(letter === item ? "" : item)}
                    >
                      {item}
                    </button>
                  ),
                )}
              </div>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500">
                <input
                  type="checkbox"
                  checked={newOnly}
                  onChange={(event) => setNewOnly(event.target.checked)}
                />{" "}
                {t("Evidencia nueva")}
              </label>
              <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                <input
                  type="checkbox"
                  checked={insufficientOnly}
                  onChange={(event) =>
                    setInsufficientOnly(event.target.checked)
                  }
                />{" "}
                {t("Evidencia insuficiente")}
              </label>
              <select
                className="input h-8"
                value={sortKey}
                onChange={(event) =>
                  setSortKey(event.target.value as DictionarySortKey)
                }
              >
                <option value="name">{t("Nombre")}</option>
                <option value="created">{t("Creación")}</option>
                <option value="updated">{t("Actualización")}</option>
                <option value="authors">{t("Autores")}</option>
                <option value="works">{t("Obras")}</option>
                <option value="evidence">{t("Evidencia")}</option>
              </select>
              <button
                className="dictionary-sort-button btn btn-ghost h-8 w-8 p-0"
                type="button"
                aria-label={t("Cambiar dirección de orden")}
                title={t("Cambiar dirección de orden")}
                onClick={() =>
                  setSortDir((current) => (current === "asc" ? "desc" : "asc"))
                }
              >
                <Icon name={sortDir === "asc" ? "arrowUp" : "arrowDown"} />
              </button>
              <button
                className={`dictionary-view-button btn btn-ghost h-8 px-2 ${viewMode === "list" ? "is-selected text-indigo-600 dark:text-indigo-300" : ""}`}
                aria-pressed={viewMode === "list"}
                onClick={() => setViewMode("list")}
              >
                <Icon name="list" />
              </button>
              <button
                className={`dictionary-view-button btn btn-ghost h-8 px-2 ${viewMode === "table" ? "is-selected text-indigo-600 dark:text-indigo-300" : ""}`}
                aria-pressed={viewMode === "table"}
                onClick={() => setViewMode("table")}
              >
                <Icon name="table" />
              </button>
            </div>
            {error ? (
              <ErrorNotice>{error}</ErrorNotice>
            ) : loading ? (
              <div className="grid h-48 place-items-center">
                <Spinner label={t("Cargando Diccionario…")} />
              </div>
            ) : !entries.length ? (
              <div className="rounded-2xl border border-dashed border-neutral-300 p-12 text-center dark:border-neutral-800">
                <Icon
                  name="thesaurus"
                  size={30}
                  className="mx-auto text-neutral-400"
                />
                <p className="mt-3 text-sm text-neutral-500">
                  {t("No hay entradas con este filtro.")}
                </p>
              </div>
            ) : (
              <DictionaryRows
                entries={entries}
                generationJobs={generationJobs}
                compact={viewMode === "table"}
                selected={selected}
                onToggle={toggle}
                onOpen={openEntry}
                onSelectAll={() =>
                  setSelected(
                    entries.every((entry) => selected.has(entry.id))
                      ? new Set()
                      : new Set(entries.map((entry) => entry.id)),
                  )
                }
              />
            )}
          </div>
        </main>
      )}
      {creating && (
        <CreationDialog
          catalog={catalog}
          settings={settings}
          model={model}
          research={research}
          onModel={setModel}
          onClose={() => setCreating(false)}
          onOpenExisting={(entry) => {
            setCreating(false);
            openEntry(entry);
          }}
          onQueued={(queuedEntries) => {
            setCreating(false);
            setActiveId(null);
            setGenerationJobs((current) => {
              const next = new Map(current);
              for (const entry of queuedEntries) {
                if (!next.has(entry.id)) {
                  next.set(entry.id, {
                    entryId: entry.id,
                    phase: "queued",
                    message: t("En cola"),
                  });
                }
              }
              return next;
            });
            void reload(false);
          }}
        />
      )}
      {pendingDeleteIds && (
        <ConfirmModal
          title={
            pendingDeleteIds.length === 1
              ? t("Eliminar entrada del Diccionario")
              : tx("Eliminar {n} entradas del Diccionario", {
                  n: pendingDeleteIds.length,
                })
          }
          message={t(
            "Se eliminarán también todas sus versiones y relaciones. Esta acción no se puede deshacer.",
          )}
          confirmLabel={
            pendingDeleteIds.length === 1
              ? t("Eliminar entrada")
              : tx("Eliminar {n} entradas", { n: pendingDeleteIds.length })
          }
          danger
          onCancel={() => setPendingDeleteIds(null)}
          onConfirm={() => void remove(pendingDeleteIds)}
        />
      )}
    </div>
  );
}

function DictionaryRows({
  entries,
  generationJobs,
  compact,
  selected,
  onToggle,
  onOpen,
  onSelectAll,
}: {
  entries: DictionaryEntrySummary[];
  generationJobs: ReadonlyMap<string, DictionaryProgress>;
  compact: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (entry: DictionaryEntrySummary) => void;
  onSelectAll: () => void;
}) {
  const columns =
    "grid-cols-[2.25rem_minmax(300px,2.4fr)_minmax(150px,0.8fr)_5rem_5rem_6rem_minmax(180px,1fr)_8rem_2rem]";
  return (
    <div className="dictionary-rows overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950/40">
      <div
        className={`dictionary-row-heading grid min-w-[960px] ${columns} items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/65`}
      >
        <input
          type="checkbox"
          checked={entries.every((entry) => selected.has(entry.id))}
          onChange={onSelectAll}
        />
        <span>{t("Concepto")}</span>
        <span>{t("Estado")}</span>
        <span>{t("Autores")}</span>
        <span>{t("Obras")}</span>
        <span>{t("Evidencia")}</span>
        <span>{t("Etiquetas")}</span>
        <span>{t("Actualización")}</span>
        <span />
      </div>
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`dictionary-entry-row grid min-w-[960px] ${columns} items-center gap-3 border-b border-neutral-100 px-3 transition-colors last:border-b-0 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55 ${compact ? "py-2" : "py-3"} ${selected.has(entry.id) ? "bg-indigo-50/60 dark:bg-indigo-950/20" : ""}`}
        >
          <input
            type="checkbox"
            checked={selected.has(entry.id)}
            onChange={() => onToggle(entry.id)}
          />
          <button className="min-w-0 text-left" onClick={() => onOpen(entry)}>
            <span className="flex items-center gap-2">
              <strong className="truncate text-sm font-medium hover:text-indigo-600 dark:hover:text-indigo-300">
                {entry.name}
              </strong>
              {entry.newEvidenceCount > 0 && (
                <span className="shrink-0 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
                  {tx("{n} nuevas", { n: entry.newEvidenceCount })}
                </span>
              )}
            </span>
            {entry.aliases.length > 0 && (
              <span className="mt-0.5 block truncate text-[10px] text-neutral-500">
                {entry.aliases.join(" · ")}
              </span>
            )}
            {!compact && (
              <span className="mt-1 line-clamp-2 block text-xs leading-5 text-neutral-600 dark:text-neutral-400">
                {entry.shortDescription ||
                  t("Aún no se ha generado una descripción.")}
              </span>
            )}
            {entry.insufficientEvidence && (
              <span className="mt-1 block text-[10px] text-amber-600 dark:text-amber-400">
                {t("Evidencia insuficiente")}
              </span>
            )}
          </button>
          <DictionaryGenerationState
            progress={generationJobs.get(entry.id)}
            status={entry.status}
          />
          <span className="text-xs text-neutral-500"><span className="dictionary-count-label">{t("Autores")} · </span>{entry.authorCount}</span>
          <span className="text-xs text-neutral-500"><span className="dictionary-count-label">{t("Obras")} · </span>{entry.workCount}</span>
          <span className="text-xs text-neutral-500">
            <span className="dictionary-count-label">{t("Evidencia")} · </span>{entry.evidenceCount}
          </span>
          <div className="flex flex-wrap gap-1">
            {entry.tags.slice(0, compact ? 2 : 5).map((item) => (
              <Tag key={item}>{item}</Tag>
            ))}
          </div>
          <span className="text-[10px] text-neutral-500">
            {date(entry.updatedAt)}
          </span>
          <button
            className="grid h-7 w-7 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-200 hover:text-indigo-600 dark:hover:bg-neutral-800 dark:hover:text-indigo-300"
            onClick={() => onOpen(entry)}
          >
            <Icon name="chevronRight" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function DictionaryDetailActions({ mobile, children }: { mobile: boolean; children: ReactNode }) {
  const className = "dictionary-detail-actions ml-auto grid w-full max-w-full gap-2 xl:w-[620px]";
  return mobile ? (
    <details className={className} data-testid="dictionary-entry-options">
      <summary>{t("Opciones de la entrada")}</summary>
      {children}
    </details>
  ) : <div className={className}>{children}</div>;
}

function DictionaryGenerationState({
  progress,
  status,
}: {
  progress?: DictionaryProgress;
  status: DictionaryEntryStatus;
}) {
  // Defensively prefer the persisted lifecycle once a successful generation has
  // already activated (or preserved the archived state of) the entry.
  if (!progress || (progress.phase === "done" && status !== "draft")) {
    return <StatusPill status={status} />;
  }
  if (progress.phase === "failed") {
    return (
      <span
        className="min-w-0 text-xs text-red-600 dark:text-red-400"
        title={progress.error ? errorText(progress.error) : undefined}
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Icon name="x" size={12} /> {t("Error al generar")}
        </span>
        <span className="mt-0.5 block truncate text-[10px] opacity-80">
          {progress.error ? errorText(progress.error) : t("La generación no pudo completarse.")}
        </span>
      </span>
    );
  }
  if (progress.phase === "done") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <Icon name="check" size={12} /> {t("Generada")}
      </span>
    );
  }
  if (progress.phase === "degraded") {
    return (
      <span
        className="min-w-0 text-xs text-amber-700 dark:text-amber-300"
        title={progress.error ? errorText(progress.error) : undefined}
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Icon name="warning" size={12} /> {t("Síntesis pendiente")}
        </span>
        <span className="mt-0.5 block truncate text-[10px] opacity-80">
          {progress.attempts
            ? tx("Se intentó {n} veces. La versión anterior se conserva.", {
                n: progress.attempts,
              })
            : dictionaryDegradationText(progress.degradationReason)}
        </span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-300">
      <Icon name="refresh" size={13} className="animate-spin" />
      {dictionaryProgressText(progress.message)}
    </span>
  );
}

function DictionaryEntryView({
  entryId,
  mobile = false,
  restoredTab,
  onTabChange,
  progress,
  onGenerationStarted,
  settings,
  model,
  research,
  catalog,
  onRename,
  onOpenIdea,
  onOpenAuthor,
  onOpenLibraryWork,
  onOpenEntry,
}: {
  entryId: string;
  mobile?: boolean;
  restoredTab?: DictionaryDetailTab;
  onTabChange: (tab: DictionaryDetailTab) => void;
  progress?: DictionaryProgress;
  onGenerationStarted: (progress: DictionaryProgress) => void;
  settings: AppSettings;
  model: ModelRef | null;
  research: DictionaryResearchOptions;
  catalog: CatalogData;
  onRename: (name: string) => void;
  onOpenIdea: (id: string) => void;
  onOpenAuthor: (id: string, name: string) => void;
  onOpenLibraryWork: OpenCitationLibraryWork;
  onOpenEntry: (entry: Pick<DictionaryEntrySummary, 'id' | 'name'>) => void;
}) {
  const [detail, setDetail] = useState<DictionaryEntryDetail | null>(null);
  const [tab, setTab] = useState<DictionaryDetailTab>(
    () => restoredTab ?? "overview",
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [citation, setCitation] = useState<CitationTarget>(null);
  const [hideBackgroundFailure, setHideBackgroundFailure] = useState(false);
  const choseTab = useRef(restoredTab !== undefined);
  const load = useCallback(
    async () => setDetail(await window.nodus.getDictionaryEntry(entryId)),
    [entryId],
  );
  useEffect(() => {
    void load();
    return window.nodus.onDictionaryChanged((changed) => {
      if (!changed || changed === entryId) void load();
    });
  }, [entryId, load]);
  useEffect(() => {
    if (!detail || choseTab.current) return;
    choseTab.current = true;
    if (!detail.entry.currentVersionId) setTab("evidence");
  }, [detail]);
  useEffect(() => onTabChange(tab), [onTabChange, tab]);
  const run = async (
    name: string,
    action: () => Promise<unknown>,
    next?: DictionaryDetailTab,
  ) => {
    setBusy(name);
    setError(null);
    try {
      await action();
      await load();
      if (next) setTab(next);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy("");
    }
  };
  if (!detail)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner label={t("Abriendo entrada…")} />
      </div>
    );
  const entry = detail.entry;
  const hasEvidence = detail.coverage.included > 0;
  const backgroundBusy =
    !!progress && !["done", "degraded", "failed"].includes(progress.phase);
  const backgroundFailure =
    progress?.phase === "failed" && !hideBackgroundFailure
      ? progress.error || t("La generación no pudo completarse.")
      : null;
  const mode = entry.currentVersionId ? "regeneration" : "creation";
  const generate = (generation: "creation" | "regeneration" | "update") => {
    setHideBackgroundFailure(true);
    setBusy(generation);
    setError(null);
    void window.nodus
      .startDictionaryGeneration({
          entryId,
          mode: generation,
          model,
          thinkingEffort: research.thinkingEffort,
          webSearch: research.webSearch,
      })
      .then((nextProgress) => {
        onGenerationStarted(nextProgress);
        setTab(generation === "update" ? "versions" : "overview");
      })
      .catch((reason) => setError(message(reason)))
      .finally(() => setBusy(""));
  };
  const tabs: Array<{
    id: DictionaryDetailTab;
    label: string;
    icon: string;
    count?: number;
  }> = [
    { id: "overview", label: t("Resumen"), icon: "file" },
    {
      id: "evidence",
      label: t("Evidencia"),
      icon: "quote",
      count: entry.evidenceCount,
    },
    {
      id: "authors",
      label: t("Autores"),
      icon: "user",
      count: entry.authorCount,
    },
    { id: "works", label: t("Obras"), icon: "book", count: entry.workCount },
    { id: "versions", label: t("Versiones"), icon: "clock" },
    { id: "relations", label: appT("Relaciones"), icon: "link", count: detail.relations?.length ?? 0 },
  ];
  const regenerationBusy =
    busy === mode ||
    (backgroundBusy && progress?.mode !== "update");
  const updateBusy =
    busy === "update" ||
    (backgroundBusy && progress?.mode === "update");
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto p-5"
      data-testid="dictionary-entry-detail"
    >
      <div className="mx-auto max-w-[1480px] space-y-4">
        <section className="rounded-2xl border border-indigo-100 bg-indigo-50/80 p-5 dark:border-neutral-800 dark:bg-neutral-900/35">
          <div className="flex flex-wrap items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
              <Icon name="thesaurus" size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={entry.status} />
                {entry.insufficientEvidence && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400">
                    {t("Evidencia insuficiente")}
                  </span>
                )}
                {detail.latestDegradedVersion && (
                  <span className="text-[10px] text-amber-700 dark:text-amber-300">
                    {t("Último intento degradado")}
                  </span>
                )}
              </div>
              <h2 className="mt-2 text-xl font-semibold">{entry.name}</h2>
              <p className="mt-1 text-xs text-neutral-500">
                {entry.aliases.length
                  ? entry.aliases.join(" · ")
                  : t("Sin aliases")}
              </p>
              {mobile ? <details className="dictionary-entry-focus mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                <summary className="cursor-pointer py-2">{appT("Foco de la entrada")}</summary>
                <p className="leading-6">{entry.focusPrompt || t("Sin foco adicional.")}</p>
              </details> : <p className="mt-2 max-w-4xl text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                {entry.focusPrompt || t("Sin foco adicional.")}
              </p>}
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                <span className="rounded-full bg-white px-2 py-1 dark:bg-neutral-800">
                  {tx("{n} evidencias", { n: entry.evidenceCount })}
                </span>
                <span className="rounded-full bg-white px-2 py-1 dark:bg-neutral-800">
                  {tx("{n} autores", { n: entry.authorCount })}
                </span>
                <span className="rounded-full bg-white px-2 py-1 dark:bg-neutral-800">
                  {tx("{n} obras", { n: entry.workCount })}
                </span>
                {entry.newEvidenceCount > 0 && (
                  <span className="rounded-full bg-cyan-100 px-2 py-1 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
                    {tx("{n} nuevas", { n: entry.newEvidenceCount })}
                  </span>
                )}
              </div>
            </div>
            {mobile && progress && (
              <div className="w-full min-w-0" aria-live="polite">
                <DictionaryGenerationState progress={progress} status={entry.status} />
              </div>
            )}
            <DictionaryDetailActions mobile={mobile}>
              <details open={mobile ? undefined : true} className="dictionary-model-options">
              <summary aria-label={mobile ? t("Modelo de síntesis de la entrada") : undefined}>{t("Modelo de síntesis")}</summary>
              <div className="flex min-h-9 flex-wrap items-center justify-end gap-3">
                {!mobile && progress && (
                  <div className="min-w-0 flex-1" aria-live="polite">
                    <DictionaryGenerationState progress={progress} status={entry.status} />
                  </div>
                )}
                <ModelPicker
                  className="!w-auto max-w-full"
                  settings={settings}
                  value={model}
                  onChange={() => undefined}
                  compact
                  disabled
                  ariaLabel={t("Modelo del Diccionario")}
                  menu
                />
                <DictionaryResearchControls model={model} research={research} disabled={!!busy || backgroundBusy} />
              </div>
              </details>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(118px,0.58fr)_minmax(118px,0.58fr)] gap-2">
                <button
                  className="btn btn-ghost h-9 min-w-0 justify-center whitespace-nowrap border border-neutral-300 text-xs dark:border-neutral-700"
                  disabled={!!busy || backgroundBusy}
                  onClick={() =>
                    void run(
                      "scan",
                      () => window.nodus.scanDictionaryNewEvidence(entryId, { model, thinkingEffort: research.thinkingEffort, webSearch: research.webSearch }),
                      "evidence",
                    )
                  }
                >
                  <Icon name="search" size={13} />{" "}
                  {busy === "scan"
                    ? t("Buscando…")
                    : entry.lastEvidenceScanAt
                      ? t("Buscar evidencia nueva")
                      : t("Recuperar evidencia")}
                </button>
                <button
                  className="btn btn-primary h-9 min-w-0 justify-center whitespace-nowrap text-xs !text-white disabled:!text-white"
                  disabled={!!busy || backgroundBusy}
                  onClick={() => generate(mode)}
                >
                  {regenerationBusy ? (
                    <ButtonBusy label={t("Generando…")} />
                  ) : (
                    <>
                      <Icon name="sparkles" size={13} />
                      {entry.currentVersionId ? t("Regenerar") : t("Generar")}
                    </>
                  )}
                </button>
                <button
                  className="btn btn-ghost h-9 min-w-0 justify-center whitespace-nowrap border border-neutral-300 text-xs dark:border-neutral-700"
                  disabled={
                    !!busy ||
                    backgroundBusy ||
                    !entry.currentVersionId ||
                    entry.newEvidenceCount === 0
                  }
                  onClick={() => generate("update")}
                >
                  {updateBusy ? (
                    <ButtonBusy label={t("Actualizando…")} />
                  ) : (
                    <><Icon name="refresh" size={13} /> {t("Actualizar")}</>
                  )}
                </button>
              </div>
            </DictionaryDetailActions>
          </div>
        </section>
        {backgroundFailure && <ErrorNotice>{backgroundFailure}</ErrorNotice>}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {!hasEvidence && (
          <button
            className="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-800 hover:border-amber-300 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
            onClick={() => setTab("evidence")}
          >
            <Icon name="info" />{" "}
            {t(
              "Al generar, se consultarán las obras, ideas y documentos del ámbito elegido. Puedes revisar las fuentes en Evidencia.",
            )}
            <Icon name="chevronRight" className="ml-auto" />
          </button>
        )}
        <div className="dictionary-detail-tabs flex min-w-0 gap-1 overflow-x-auto border-b border-neutral-200 dark:border-neutral-800">
          {tabs.map((item) => (
            <button
              key={item.id}
              data-testid={`dictionary-detail-tab-${item.id}`}
              className={`flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-xs ${tab === item.id ? "border-indigo-500 text-indigo-700 dark:text-indigo-300" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"}`}
              onClick={() => setTab(item.id)}
            >
              <Icon name={item.icon} size={13} /> {item.label}
              {item.count !== undefined && (
                <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800">
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="pb-8">
          {tab === "overview" ? (
            <OverviewTab
              detail={detail}
              catalog={catalog}
              onSaved={(next) => {
                onRename(next.name);
                void load();
              }}
              onCitation={setCitation}
            />
          ) : tab === "evidence" ? (
            <EvidenceTab
              detail={detail}
              onChanged={load}
              onGenerate={(next) => generate(next)}
              onCitation={setCitation}
              onOpenIdea={onOpenIdea}
              onOpenAuthor={onOpenAuthor}
              onOpenLibraryWork={onOpenLibraryWork}
            />
          ) : tab === "authors" ? (
            <AuthorsTab
              detail={detail}
              onOpenAuthor={onOpenAuthor}
              onCitation={setCitation}
            />
          ) : tab === "works" ? (
            <WorksTab detail={detail} onOpenLibraryWork={(id) => onOpenLibraryWork(id, "vault")} />
          ) : tab === "relations" ? (
            <div className="space-y-3">
              {(detail.relations ?? []).map(relation => <button key={relation.id} aria-label={`${appT("Abrir entrada relacionada")}: ${relation.entry.name}`} className={`${panel} flex w-full items-center gap-3 p-4 text-left`} onClick={() => onOpenEntry(relation.entry)}>
                <Icon name="thesaurus" /><span className="min-w-0 flex-1"><strong className="block">{relation.entry.name}</strong><span className="text-xs text-neutral-500">{appT(({related:'Relacionado',broader:'Más general',narrower:'Más específico',synonym:'Sinónimo',opposing:'Contrapuesto',historically_related:'Relación histórica',frequently_co_occurring:'Aparecen juntos'} as const)[relation.direction === 'incoming' && relation.type === 'broader' ? 'narrower' : relation.direction === 'incoming' && relation.type === 'narrower' ? 'broader' : relation.type])}</span></span><Icon name="chevronRight" />
              </button>)}
              {!detail.relations?.length && <p className="text-sm text-neutral-500">{appT("Esta entrada aún no tiene relaciones.")}</p>}
            </div>
          ) : (
            <VersionsTab
              detail={detail}
              onChanged={load}
              onCitation={setCitation}
            />
          )}
        </div>
      </div>
      <SourceCitationModal
        target={citation}
        onClose={() => setCitation(null)}
        onOpenLibraryWork={onOpenLibraryWork}
      />
    </div>
  );
}

function OverviewTab({
  detail,
  catalog,
  onSaved,
  onCitation,
}: {
  detail: DictionaryEntryDetail;
  catalog: CatalogData;
  onSaved: (entry: DictionaryEntry) => void;
  onCitation: (citation: MarkdownCitation) => void;
}) {
  const entry = detail.entry;
  const [editing, setEditing] = useState(false);
  const [patch, setPatch] = useState<DictionaryEntryPatch>({});
  const [aliases, setAliases] = useState(entry.aliases.join(", "));
  const [tags, setTags] = useState(entry.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPatch({
      name: entry.name,
      focusPrompt: entry.focusPrompt,
      scope: entry.scope,
      contentMarkdown: entry.contentMarkdown,
      notes: entry.notes,
      status: entry.status,
      outputLanguage: entry.outputLanguage,
      detailLevel: entry.detailLevel,
    });
    setAliases(entry.aliases.join(", "));
    setTags(entry.tags.join(", "));
  }, [entry]);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await window.nodus.updateDictionaryEntry(
        entry.id,
        { ...patch, aliases: csv(aliases), tags: csv(tags) },
        entry.updatedAt,
      );
      onSaved(next);
      setEditing(false);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  };
  if (editing)
    return (
      <section className={`${panel} p-5`}>
        <div className="mb-4 flex items-center">
          <h2 className="font-semibold">{t("Editar entrada")}</h2>
          <button
            className="btn btn-ghost ml-auto"
            onClick={() => setEditing(false)}
          >
            {t("Cancelar")}
          </button>
          <button
            className="btn btn-primary !text-white disabled:!text-white"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? (
              <ButtonBusy label={t("Guardando…")} />
            ) : (
              t("Guardar versión manual")
            )}
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("Nombre")}>
              <input
                className="input mt-1 w-full"
                value={patch.name ?? ""}
                onChange={(event) =>
                  setPatch({ ...patch, name: event.target.value })
                }
              />
            </Field>
            <Field label={t("Aliases")}>
              <input
                className="input mt-1 w-full"
                value={aliases}
                onChange={(event) => setAliases(event.target.value)}
              />
            </Field>
          </div>
          <Field label={t("Prompt de enfoque")}>
            <textarea
              className="input mt-1 min-h-20 w-full"
              value={patch.focusPrompt ?? ""}
              onChange={(event) =>
                setPatch({ ...patch, focusPrompt: event.target.value })
              }
            />
          </Field>
          <ScopeEditor
            value={patch.scope ?? entry.scope}
            onChange={(scope) => setPatch({ ...patch, scope })}
            catalog={catalog}
          />
          <div className="grid gap-4 md:grid-cols-4">
            <Field label={t("Etiquetas")}>
              <input
                className="input mt-1 w-full"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
              />
            </Field>
            <Field label={t("Estado")}>
              <select
                className="input mt-1 w-full"
                value={patch.status}
                onChange={(event) =>
                  setPatch({
                    ...patch,
                    status: event.target.value as DictionaryEntryStatus,
                  })
                }
              >
                <option value="draft">{dictionaryStatusLabel("draft")}</option>
                <option value="active">{dictionaryStatusLabel("active")}</option>
                <option value="archived">{dictionaryStatusLabel("archived")}</option>
              </select>
            </Field>
            <Field label={t("Idioma de salida")}>
              <select
                className="input mt-1 w-full"
                value={patch.outputLanguage}
                onChange={(event) =>
                  setPatch({
                    ...patch,
                    outputLanguage: event.target.value as PromptLanguage,
                  })
                }
              >
                {PROMPT_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {promptLanguageLabel(lang)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Nivel de detalle")}>
              <select
                className="input mt-1 w-full"
                value={patch.detailLevel}
                onChange={(event) =>
                  setPatch({
                    ...patch,
                    detailLevel: event.target
                      .value as DictionaryEntryInput["detailLevel"],
                  })
                }
              >
                <option value="concise">{t("Conciso")}</option>
                <option value="standard">{t("Estándar")}</option>
                <option value="detailed">{t("Detallado")}</option>
              </select>
            </Field>
          </div>
          <Field label={t("Descripción Markdown")}>
            <textarea
              className="input mt-1 min-h-80 w-full font-mono text-xs leading-5"
              value={patch.contentMarkdown ?? ""}
              onChange={(event) =>
                setPatch({ ...patch, contentMarkdown: event.target.value })
              }
            />
          </Field>
          <Field label={t("Notas")}>
            <textarea
              className="input mt-1 min-h-28 w-full"
              value={patch.notes ?? ""}
              onChange={(event) =>
                setPatch({ ...patch, notes: event.target.value })
              }
            />
          </Field>
          {error && <ErrorNotice>{error}</ErrorNotice>}
        </div>
      </section>
    );
  return (
    <div className="grid items-start gap-4 xl:grid-cols-12">
      {detail.latestDegradedVersion && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 xl:col-span-12 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <Icon name="warning" className="mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold">
                {t("El último intento no produjo una síntesis verificable")}
              </h3>
              <p className="mt-1 text-xs leading-5 opacity-80">
                {dictionaryDegradationText(
                  detail.latestDegradedVersion.degradationReason,
                )}{" "}
                {tx("Nodus realizó {n} intentos automáticos.", {
                  n: detail.latestDegradedVersion.generationAttempts,
                })}{" "}
                {entry.currentVersionId
                  ? t("La versión anterior permanece intacta.")
                  : t(
                      "La evidencia extractiva se conserva en Versiones, pero no se ha aplicado como definición.",
                    )}
              </p>
            </div>
          </div>
        </section>
      )}
      <section className={`${panel} p-5 xl:col-span-8`}>
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-neutral-500">
              {t("Síntesis del concepto")}
            </p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {entry.focusPrompt || t("Sin foco adicional.")}
            </p>
          </div>
          <button
            className="btn btn-ghost border border-neutral-300 text-xs dark:border-neutral-700"
            onClick={() => setEditing(true)}
          >
            <Icon name="edit" /> {t("Editar")}
          </button>
        </div>
        {entry.contentMarkdown ? (
          <Markdown content={entry.contentMarkdown} onCitation={onCitation} />
        ) : (
          <p className="rounded-lg bg-neutral-50 py-12 text-center text-sm text-neutral-500 dark:bg-neutral-900/45">
            {t(
              "No se pudo generar todavía una definición. Vuelve a intentarlo desde el botón Generar.",
            )}
          </p>
        )}
      </section>
      <div className="space-y-4 xl:col-span-4">
        <section className={`${panel} p-4`}>
          <div className="mb-3 flex items-center gap-2">
            <Icon name="chartBar" size={15} className="text-indigo-500" />
            <h3 className="font-semibold">{t("Cobertura")}</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              [t("Incluida"), detail.coverage.included],
              [t("Citada"), detail.coverage.cited],
              [t("No usada"), detail.coverage.unused],
              [t("Excluida"), detail.coverage.excluded],
              [t("Nueva"), detail.coverage.newEvidence],
              [t("No disponible"), detail.coverage.unavailable],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900/55"
              >
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  {label}
                </p>
                <p className="mt-1 text-base font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </section>
        <section className={`${panel} p-4`}>
          <div className="mb-3 flex items-center gap-2">
            <Icon name="info" size={15} className="text-indigo-500" />
            <h3 className="font-semibold">{t("Ficha")}</h3>
          </div>
          <dl className="space-y-2 text-xs text-neutral-500">
            <div className="flex justify-between gap-3">
              <dt>{t("Creación")}</dt>
              <dd>{date(entry.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t("Actualización")}</dt>
              <dd>{date(entry.updatedAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t("Último escaneo")}</dt>
              <dd>{date(entry.lastEvidenceScanAt)}</dd>
            </div>
          </dl>
        </section>
        {entry.tags.length > 0 && (
          <section className={`${panel} p-4`}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Etiquetas")}
            </h3>
            <div className="flex flex-wrap gap-1">
              {entry.tags.map((item) => (
                <Tag key={item}>{item}</Tag>
              ))}
            </div>
          </section>
        )}
        {entry.notes && (
          <section className={`${panel} p-4`}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t("Notas")}
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">
              {entry.notes}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function EvidenceTab({
  detail,
  onChanged,
  onGenerate,
  onCitation,
  onOpenIdea,
  onOpenAuthor,
  onOpenLibraryWork,
}: {
  detail: DictionaryEntryDetail;
  onChanged: () => Promise<void>;
  onGenerate: (mode: "creation" | "regeneration") => void;
  onCitation: (citation: MarkdownCitation) => void;
  onOpenIdea: (id: string) => void;
  onOpenAuthor: (id: string, name: string) => void;
  onOpenLibraryWork: OpenCitationLibraryWork;
}) {
  const entryId = detail.entry.id;
  const [items, setItems] = useState<DictionaryEvidenceItem[]>([]);
  const [all, setAll] = useState<DictionaryEvidenceItem[]>([]);
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState("");
  const [newOnly, setNewOnly] = useState(false);
  const [authorId, setAuthorId] = useState("");
  const [workId, setWorkId] = useState("");
  const [tag, setTag] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await readDictionaryEvidence(request => window.nodus.listDictionaryEvidence(request), {
        entryId,
        query,
        decisions: decision
          ? [decision as DictionaryEvidenceDecision]
          : undefined,
        newOnly,
        authorIds: authorId ? [authorId] : undefined,
        workIds: workId ? [workId] : undefined,
        tags: tag ? [tag] : undefined,
      });
      setItems(page.items);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setLoading(false);
    }
  }, [authorId, decision, entryId, newOnly, query, tag, workId]);
  const loadAll = useCallback(
    async () =>
      setAll(
        (
          await readDictionaryEvidence(request => window.nodus.listDictionaryEvidence(request), {
            entryId,
          })
        ).items,
      ),
    [entryId],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 150);
    return () => window.clearTimeout(timer);
  }, [load, detail.entry.updatedAt]);
  useEffect(() => {
    void loadAll();
  }, [loadAll, detail.entry.updatedAt]);
  const authors = useMemo(
    () =>
      [
        ...new Map(
          all
            .flatMap((item) => item.authors)
            .filter((author) => author.id)
            .map((author) => [author.id!, author.name]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [all],
  );
  const works = useMemo(
    () =>
      [
        ...new Map(
          all
            .flatMap((item) => item.works)
            .map((work) => [work.id, work.title]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [all],
  );
  const tags = useMemo(
    () => [...new Set(all.flatMap((item) => item.tags))].sort(),
    [all],
  );
  const included = all.filter(
    (item) => item.decision === "included" && !item.unavailable,
  ).length;
  const decide = async (
    item: DictionaryEvidenceItem,
    next: DictionaryEvidenceDecision,
  ) => {
    try {
      await window.nodus.setDictionaryEvidenceDecision(
        entryId,
        [{ kind: item.kind, id: item.id }],
        next,
      );
      await Promise.all([load(), loadAll(), onChanged()]);
    } catch (reason) {
      setError(message(reason));
    }
  };
  return (
    <div>
      <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/20">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
              {t("Evidencia recuperada")}
            </h2>
            <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-300/70">
              {tx(
                "Nodus seleccionó automáticamente {n} elementos para la definición. Aquí puedes inspeccionarlos o ajustar una regeneración.",
                { n: included },
              )}
            </p>
          </div>
          <button
            className="btn btn-primary ml-auto !text-white disabled:!text-white"
            disabled={!included}
            onClick={() =>
              onGenerate(
                detail.entry.currentVersionId ? "regeneration" : "creation",
              )
            }
          >
            <Icon name="sparkles" />{" "}
            {detail.entry.currentVersionId
              ? t("Regenerar con ajustes")
              : t("Reintentar generación")}
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-4">
          <ErrorNotice>{error}</ErrorNotice>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-72 flex-1">
          <Icon
            name="search"
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
          />
          <input
            className="input input-with-leading-icon w-full"
            placeholder={t("Buscar en la evidencia…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          className="input"
          value={decision}
          onChange={(event) => setDecision(event.target.value)}
        >
          <option value="">{t("Todas las decisiones")}</option>
          <option value="included">{t("Usada")}</option>
          <option value="unused">{t("Relevante no usada")}</option>
          <option value="excluded">{t("Excluida")}</option>
        </select>
        <select
          className="input max-w-44"
          value={authorId}
          onChange={(event) => setAuthorId(event.target.value)}
        >
          <option value="">{t("Todos los autores")}</option>
          {authors.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          className="input max-w-44"
          value={workId}
          onChange={(event) => setWorkId(event.target.value)}
        >
          <option value="">{t("Todas las obras")}</option>
          {works.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
        <select
          className="input max-w-40"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
        >
          <option value="">{t("Todas las etiquetas")}</option>
          {tags.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          <input
            type="checkbox"
            checked={newOnly}
            onChange={(event) => setNewOnly(event.target.checked)}
          />{" "}
          {t("Solo nueva")}
        </label>
      </div>
      {loading ? (
        <div className="grid h-40 place-items-center">
          <Spinner label={t("Cargando evidencia…")} />
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <EvidenceCard
              key={`${item.kind}:${item.id}`}
              item={item}
              onDecision={(next) => void decide(item, next)}
              onCitation={onCitation}
              onOpenIdea={onOpenIdea}
              onOpenAuthor={onOpenAuthor}
              onOpenLibraryWork={(id) => onOpenLibraryWork(id, "vault")}
            />
          ))}
          {!items.length && (
            <p className="rounded-xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500 dark:border-neutral-800">
              {t("No hay evidencia con estos filtros.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceCard({
  item,
  onDecision,
  onCitation,
  onOpenIdea,
  onOpenAuthor,
  onOpenLibraryWork,
}: {
  item: DictionaryEvidenceItem;
  onDecision: (decision: DictionaryEvidenceDecision) => void;
  onCitation: (citation: MarkdownCitation) => void;
  onOpenIdea: (id: string) => void;
  onOpenAuthor: (id: string, name: string) => void;
  onOpenLibraryWork: (id: string) => void;
}) {
  const color =
    item.decision === "included"
      ? "border-emerald-300 dark:border-emerald-900/60"
      : item.decision === "excluded"
        ? "border-red-200 opacity-70 dark:border-red-950"
        : "border-neutral-200 dark:border-neutral-800";
  return (
    <article
      className={`rounded-xl border bg-white p-4 dark:bg-neutral-950/55 ${color}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`rounded px-2 py-1 text-[10px] uppercase ${item.kind === "idea" ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"}`}
        >
          {t(item.kind === "idea" ? "IDEA" : item.id.startsWith("web:") ? "Web" : "PASSAGE")}
        </span>
        <div className="min-w-0 flex-1">
          <button
            className="text-left text-sm font-medium hover:text-indigo-600 dark:hover:text-indigo-300"
            onClick={() => onCitation({ kind: item.kind, id: item.id })}
          >
            {item.label}
          </button>
          <p className="mt-2 line-clamp-5 whitespace-pre-line text-xs leading-5 text-neutral-600 dark:text-neutral-400">
            {item.text}
          </p>
        </div>
        {item.isNew && (
          <span className="rounded-full bg-cyan-100 px-2 py-1 text-[10px] text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
            {t("Nueva")}
          </span>
        )}
        {item.usedInCurrentVersion && (
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {t("Versión actual")}
          </span>
        )}
        <select
          className="input h-8"
          value={item.decision}
          onChange={(event) =>
            onDecision(event.target.value as DictionaryEvidenceDecision)
          }
        >
          <option value="included">{t("Incluir")}</option>
          <option value="unused">{t("No usar")}</option>
          <option value="excluded">{t("Excluir")}</option>
        </select>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800/60">
        <button
          className="text-[10px] text-neutral-500 hover:text-indigo-600"
          onClick={() =>
            item.kind === "idea"
              ? onOpenIdea(item.id)
              : onCitation({ kind: "passage", id: item.id })
          }
        >
          {item.kind === "idea" ? t("Abrir idea") : t("Abrir pasaje original")}
        </button>
        {item.works.map((work) => (
          <button
            key={work.id}
            className="text-[10px] text-neutral-500 hover:text-indigo-600"
            onClick={() => onOpenLibraryWork(work.id)}
          >
            {work.title}
          </button>
        ))}
        {item.authors.map((author) => (
          <button
            key={author.id ?? author.name}
            className="text-[10px] text-neutral-500 hover:text-indigo-600 disabled:opacity-50"
            disabled={!author.id}
            onClick={() => author.id && onOpenAuthor(author.id, author.name)}
          >
            {author.name}
          </button>
        ))}
        {item.tags.map((itemTag) => (
          <Tag key={itemTag}>{itemTag}</Tag>
        ))}
      </div>
    </article>
  );
}

function AuthorsTab({
  detail,
  onOpenAuthor,
  onCitation,
}: {
  detail: DictionaryEntryDetail;
  onOpenAuthor: (id: string, name: string) => void;
  onCitation: (citation: MarkdownCitation) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {detail.authors.map((author) => (
        <article key={author.id} className={`${panel} p-4`}>
          <button
            className="flex w-full items-center gap-3 text-left"
            onClick={() => onOpenAuthor(author.id, author.name)}
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
              <Icon name="user" />
            </span>
            <div>
              <h3 className="text-sm font-medium">{author.name}</h3>
              <p className="text-[10px] text-neutral-500">
                {tx("{ideas} ideas · {works} obras", {
                  ideas: author.ideaCount,
                  works: author.workCount,
                })}
                {author.attributionBasis === "editor_only"
                  ? ` · ${t("atribución editorial")}`
                  : ""}
              </p>
            </div>
            <Icon
              name="external"
              size={12}
              className="ml-auto text-neutral-400"
            />
          </button>
          {author.summaryMarkdown ? (
            <Markdown
              content={author.summaryMarkdown}
              onCitation={onCitation}
              className="mt-3 text-xs"
            />
          ) : (
            <p className="mt-3 text-xs text-neutral-500">
              {t("Sin resumen específico en la versión actual.")}
            </p>
          )}
        </article>
      ))}
      {!detail.authors.length && (
        <p className="text-sm text-neutral-500">
          {t("La versión actual no relaciona autores.")}
        </p>
      )}
    </div>
  );
}

function WorksTab({
  detail,
  onOpenLibraryWork,
}: {
  detail: DictionaryEntryDetail;
  onOpenLibraryWork: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {detail.works.map((work) => (
        <article
          key={work.id}
          className={`${panel} dictionary-work-card flex flex-wrap items-start gap-3 p-4`}
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <Icon name="book" />
          </span>
          <div className="dictionary-work-copy min-w-0 flex-1">
            <h3 className="text-sm font-medium">{work.title}</h3>
            <p className="mt-1 text-xs text-neutral-500">
              {work.authors.join(", ") || t("Autor no disponible")} ·{" "}
              {tx("{n} evidencias", { n: work.evidenceCount })}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {work.tags.map((item) => (
                <Tag key={item}>{item}</Tag>
              ))}
            </div>
          </div>
          <button
            className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
            onClick={() => onOpenLibraryWork(work.id)}
          >
            <Icon name="bookOpen" /> {t("Nodus Library")}
          </button>
          {work.zoteroKey && (
            <button
              className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
              onClick={() => void window.nodus.openInZotero(work.zoteroKey!)}
            >
              <Icon name="external" /> {t("Zotero")}
            </button>
          )}
        </article>
      ))}
      {!detail.works.length && (
        <p className="text-sm text-neutral-500">
          {t("La versión actual no relaciona obras.")}
        </p>
      )}
    </div>
  );
}

function VersionsTab({
  detail,
  onChanged,
  onCitation,
}: {
  detail: DictionaryEntryDetail;
  onChanged: () => Promise<void>;
  onCitation: (citation: MarkdownCitation) => void;
}) {
  const [versions, setVersions] = useState<DictionaryVersion[]>([]);
  const [open, setOpen] = useState<string | null>(
    detail.entry.proposedVersionId,
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async () => {
      setLoading(true);
      try { setVersions(await window.nodus.listDictionaryVersions(detail.entry.id)); setError(null); }
      catch (reason) { setError(message(reason)); }
      finally { setLoading(false); }
    },
    [detail.entry.id],
  );
  useEffect(() => {
    void load();
  }, [load, detail.entry.proposedVersionId]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await Promise.all([load(), onChanged()]);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {loading && <Spinner label={t("Cargando…")} />}
      {detail.proposedVersion && (
        <div className="rounded-xl border border-cyan-300 bg-cyan-50 p-4 dark:border-cyan-900 dark:bg-cyan-950/20">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h3 className="text-sm font-semibold text-cyan-800 dark:text-cyan-200">
                {t("Actualización propuesta")}
              </h3>
              <p className="text-xs text-cyan-700 dark:text-cyan-400/70">
                {t(
                  "La versión actual permanece intacta hasta que aceptes esta propuesta.",
                )}
              </p>
            </div>
            <button
              className="btn btn-primary ml-auto !text-white disabled:!text-white"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  window.nodus.acceptDictionaryVersion(
                    detail.entry.id,
                    detail.proposedVersion!.id,
                    detail.entry.currentVersionId,
                  ),
                )
              }
            >
              {t("Aceptar propuesta")}
            </button>
          </div>
        </div>
      )}
      {versions.map((version) => (
        <article
          key={version.id}
          className={`${panel} p-4 ${version.id === detail.entry.currentVersionId ? "!border-emerald-300 dark:!border-emerald-900" : version.state === "proposed" ? "!border-cyan-300 dark:!border-cyan-900" : version.outcome === "degraded" ? "!border-amber-300 dark:!border-amber-900" : ""}`}
        >
          <button
            aria-label={`${t("Versión")} · ${dictionaryVersionText(version.trigger)} · ${date(version.generatedAt)}`}
            className="flex w-full items-center gap-3 text-left"
            onClick={() => setOpen(open === version.id ? null : version.id)}
          >
            <Icon name="clock" className="text-neutral-500" />
            <div>
              <p className="text-sm font-medium">
                {dictionaryVersionText(version.trigger)}
              </p>
              <p className="text-[10px] text-neutral-500">
                {date(version.generatedAt)} ·{" "}
                {tx("{n} evidencias", { n: version.evidence.length })} ·{" "}
                {dictionaryVersionText(
                  version.outcome === "degraded" ? "degradada" : version.state,
                )}
              </p>
            </div>
            {version.insufficientEvidence && (
              <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400">
                {t("Insuficiente")}
              </span>
            )}
            <Icon
              name={open === version.id ? "chevronUp" : "chevronDown"}
              className={version.insufficientEvidence ? "" : "ml-auto"}
            />
          </button>
          {open === version.id && (
            <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
              {version.outcome === "degraded" && (
                <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-200">
                  <p className="font-semibold">{t("Generación degradada")}</p>
                  <p className="mt-1">
                    {dictionaryDegradationText(version.degradationReason)}{" "}
                    {tx("Se realizaron {n} intentos automáticos.", {
                      n: version.generationAttempts,
                    })}
                  </p>
                </div>
              )}
              <Markdown
                content={version.contentMarkdown}
                onCitation={onCitation}
              />
              <div className="mt-4 flex justify-end">
                {version.id !== detail.entry.currentVersionId &&
                  version.state !== "proposed" &&
                  version.outcome !== "degraded" && (
                    <button
                      className="btn btn-ghost border border-neutral-300 dark:border-neutral-700"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          window.nodus.restoreDictionaryVersion(
                            detail.entry.id,
                            version.id,
                            detail.entry.currentVersionId,
                          ),
                        )
                      }
                    >
                      <Icon name="undo" /> {t("Restaurar como nueva versión")}
                    </button>
                  )}
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
