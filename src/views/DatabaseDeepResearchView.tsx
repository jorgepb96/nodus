import { ResearchEffortControl } from "../components/ResearchEffortControl";
import { useResearchEffort } from "../hooks/useResearchEffort";
import {
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import type {
  PromptLanguage,
  ModelRef,
  DatabaseDetail,
  DatabaseRow,
  DatabaseSavedView,
  DatabaseSummary,
} from "@shared/types";
import type {
  DatabaseDeepResearchExportFormat,
  DatabaseDeepResearchJob,
  DatabaseDeepResearchJobInput,
  DatabaseDeepResearchPreview,
  DatabaseDeepResearchReport,
  DatabaseResearchArtifact,
  DatabaseResearchClaim,
  DatabaseResearchDepth,
  DatabaseResearchProgress,
  DatabaseResearchSemanticRoles,
  DatabaseResearchStepKind,
  DatabaseDeepResearchReportType,
  DatabaseDeepResearchReportAnnotation,
  DatabaseDeepResearchReportAnnotationInput,
} from "@shared/databaseDeepResearch";
import {
  DATABASE_DEEP_RESEARCH_REPORT_TYPE_OPTIONS,
  DATABASE_RESEARCH_BUDGETS,
  redactDatabaseResearchMarkdown,
} from "@shared/databaseDeepResearch";
import type { DatabaseDeepResearchSnapshot } from "../app/viewSnapshots";
import { Icon } from "../components/ui";
import { GalleryFilterMenu, GalleryFilterReset, GallerySortMenu, passesFilter, readFilterFromStates, readStatesFromFilter, type GalleryFilterOption, type ReadState } from "../components/GalleryFilters";
import { SectionHeader, SectionToolbar } from "../components/SectionHeader";
import { DeepResearchQueueStrip, type QueueStripItem } from "../components/DeepResearchQueueStrip";
import { FindInPage } from "../components/FindInPage";
import {
  ReaderHighlighterControl,
  ReaderSelectionActions,
  type ReaderSelectionActionsHandle,
} from "../components/ReaderSelectionActions";
import { Markdown } from "../components/Markdown";
import { ModelPicker } from "../components/ModelPicker";
import { SaveToNotesModal } from "../components/SaveToNotesModal";
import { DeepResearchSectionLengthField } from "../components/DeepResearchSectionLengthField";
import type { DeepResearchSectionLength } from "@shared/deepResearchSectionLength";
import { PROMPT_LANGUAGE_OPTIONS } from "@shared/promptLanguageOptions";
import { getActiveLang, t, tx } from "../i18n";
import { useReadingPlace, type ReadingPlace } from "../readingPlace";
import type {
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
} from "@shared/types";

const DATABASE_REPORT_TYPES = DATABASE_DEEP_RESEARCH_REPORT_TYPE_OPTIONS;
const REPORT_TYPE_ICONS: Record<DatabaseDeepResearchReportType, string> = {
  general: "sparkles",
  data_quality: "shield",
  cohort_comparison: "users",
  temporal_anomalies: "clock",
  relationships_integrity: "network",
  causal_impact: "gitBranch",
  survival_retention: "activity",
  privacy_attachments: "lock",
  formulas_reconciliation: "calculator",
};

/** The one list every prompt-language picker shares, so none can drift again. */
const REPORT_LANGUAGE_OPTIONS = PROMPT_LANGUAGE_OPTIONS;

type PreviewSection = { title: string; focus: string; evidenceCount: number };
type ReportSection = { id: string; title: string; markdown: string };
type ReportChart = {
  id: string;
  title: string;
  data: Array<Record<string, unknown>>;
};
interface EvidenceItem {
  id: string;
  label: string;
  excerpt: string;
  databaseName?: string;
  rowIds: string[];
  method?: string;
  n?: number;
  denominator?: number;
  interval?: { low: number; high: number; level: number };
  pValue?: number | null;
  qValue?: number | null;
  confidence?: number | null;
  columnIds?: string[];
  filters?: { query: string; columnIds: string[] };
  hash?: string;
  warnings?: string[];
  status?: DatabaseResearchClaim["status"];
}
interface ReaderReport {
  id: string;
  runId: string;
  title: string;
  summary: string;
  markdown: string;
  createdAt: string;
  sections: ReportSection[];
  charts: ReportChart[];
  evidence: EvidenceItem[];
  costUsd?: number;
  qualityStatus?: string;
  reportType: DatabaseDeepResearchReportType;
  readAt?: string | null;
}

function toWritingAnnotation(annotation: DatabaseDeepResearchReportAnnotation): WritingDraftAnnotation {
  return { ...annotation, draftId: annotation.reportId };
}

const inputClass = "input min-h-10 w-full";
const DEPTHS: Array<{
  id: DatabaseResearchDepth;
  label: string;
  detail: string;
  multiplier: number;
}> = [
  {
    id: "focused",
    label: "Enfocada",
    detail: "Una pasada, síntesis compacta",
    multiplier: 0.6,
  },
  {
    id: "deep",
    label: "Profunda",
    detail: "Cobertura y contraste recomendados",
    multiplier: 1,
  },
  {
    id: "exhaustive",
    label: "Exhaustiva",
    detail: "Más iteraciones y evidencia",
    multiplier: 2.8,
  },
];
const ROLE_DEFS: Array<{
  id: keyof DatabaseResearchSemanticRoles;
  label: string;
  hint: string;
  multiple?: boolean;
}> = [
  {
    id: "outcome",
    label: "Resultado",
    hint: "Variable que quieres explicar o estimar.",
  },
  {
    id: "treatment",
    label: "Tratamiento",
    hint: "Exposición, intervención o grupo comparado.",
  },
  {
    id: "confounders",
    label: "Confusores",
    hint: "Variables que pueden explicar una asociación.",
    multiple: true,
  },
  {
    id: "group",
    label: "Cohorte o grupo",
    hint: "Categoría que define los grupos que se compararán.",
  },
  {
    id: "metrics",
    label: "Métricas",
    hint: "Medidas numéricas que se resumirán o compararán.",
    multiple: true,
  },
  { id: "time", label: "Tiempo", hint: "Fecha o instante de la observación." },
  {
    id: "duration",
    label: "Duración",
    hint: "Tiempo hasta el resultado o evento.",
  },
  { id: "event", label: "Evento", hint: "Indicador de que el evento ocurrió." },
  {
    id: "entity",
    label: "Entidad",
    hint: "Unidad, persona o registro observado.",
  },
  {
    id: "text",
    label: "Texto",
    hint: "Columnas textuales para contexto.",
    multiple: true,
  },
  { id: "location", label: "Ubicación", hint: "Lugar o coordenada asociada." },
  {
    id: "sensitive",
    label: "Datos sensibles",
    hint: "Columnas que deben redactarse y auditarse con precaución.",
    multiple: true,
  },
  {
    id: "reconciliation",
    label: "Reconciliación",
    hint: "Columnas de totales, fórmulas o controles que deben cuadrar.",
    multiple: true,
  },
];
const PHASE_LABELS: Record<DatabaseResearchStepKind, string> = {
  snapshot: "Capturar snapshot",
  semantic_profile: "Perfilar semántica",
  planning: "Planificar análisis",
  calculations: "Calcular resultados",
  sensitivity: "Comprobar sensibilidad",
  adversarial_review: "Revisar objeciones",
  verification: "Verificar evidencia",
  assembly: "Ensamblar informe",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
function progressPercent(value: number): number {
  const n = Number(value) || 0;
  return Math.round(Math.min(100, Math.max(0, n <= 1 ? n * 100 : n)));
}
function outputMetric(
  value: unknown,
  keys: Set<string>,
  depth = 0,
): number | null {
  if (depth > 5 || value == null || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>))
    if (keys.has(key) && typeof item === "number" && Number.isFinite(item))
      return item;
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = outputMetric(item, keys, depth + 1);
    if (found != null) return found;
  }
  return null;
}
function outputInterval(value: unknown): EvidenceItem["interval"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const interval = (value as Record<string, unknown>).confidenceInterval;
  return Array.isArray(interval) &&
    interval.length === 2 &&
    interval.every((item) => typeof item === "number" && Number.isFinite(item))
    ? { low: interval[0] as number, high: interval[1] as number, level: 0.95 }
    : undefined;
}
function artifactEvidence(artifact: DatabaseResearchArtifact): EvidenceItem {
  const inputs = artifact.inputs ?? {};
  const unusable =
    artifact.n <= 0 ||
    artifact.warnings.some((warning) =>
      /empty|failed|insufficient|not enough|error|non[- ]?converg/i.test(
        warning,
      ),
    );
  const status = unusable
    ? "unverifiable"
    : ["kaplanMeier", "logRank", "coxPH", "ipw", "simpson"].includes(
          artifact.method,
        ) || artifact.warnings.length > 0
      ? "sensitive"
      : [
            "correlation",
            "linearRegression",
            "logisticRegression",
            "pca",
            "changePoints",
            "acf",
            "relationGraph",
          ].includes(artifact.method)
        ? "exploratory"
        : "verified";
  return {
    id: artifact.id,
    label: artifact.method || t("Resultado reproducible"),
    excerpt: t("Resultado agregado disponible; los valores de celdas están redactados."),
    // Row identifiers are sensitive operational data and are not needed to
    // reproduce an aggregate claim in the reader.
    rowIds: [],
    method: artifact.method,
    n: artifact.n,
    denominator: artifact.denominator,
    interval: outputInterval(artifact.output),
    pValue: outputMetric(artifact.output, new Set(["p", "pValue"])),
    qValue: outputMetric(artifact.output, new Set(["qValue"])),
    columnIds: Array.isArray(inputs.columnIds)
      ? inputs.columnIds.map(String)
      : undefined,
    filters: artifact.filters ? { ...artifact.filters, query: "" } : undefined,
    hash: artifact.hash,
    warnings: artifact.warnings,
    status,
  };
}
function claimEvidence(claim: DatabaseResearchClaim): EvidenceItem {
  const evidence = claim.evidence ?? {};
  return {
    id: claim.id,
    label: claim.text,
    excerpt: t("Afirmación respaldada por evidencia determinista; valores sensibles omitidos."),
    rowIds: [],
    method: typeof evidence.method === "string" ? evidence.method : undefined,
    n: typeof evidence.n === "number" ? evidence.n : undefined,
    denominator:
      typeof evidence.denominator === "number"
        ? evidence.denominator
        : undefined,
    interval: claim.interval ?? undefined,
    pValue: claim.pValue,
    qValue: claim.qValue,
    confidence: claim.confidence,
    columnIds: Array.isArray(evidence.columnIds)
      ? evidence.columnIds.map(String)
      : undefined,
    filters:
      typeof evidence.filters === "object" && evidence.filters
        ? { ...(evidence.filters as { query: string; columnIds: string[] }), query: "" }
        : undefined,
    hash: typeof evidence.hash === "string" ? evidence.hash : undefined,
    warnings: claim.limitations,
    status: claim.status,
  };
}
function normalizeReport(report: DatabaseDeepResearchReport): ReaderReport {
  const structured = report.structured ?? {};
  const rawSections = Array.isArray(structured.sections)
    ? structured.sections
    : [];
  const rawArtifacts = Array.isArray(structured.evidenceLedger)
    ? structured.evidenceLedger
    : [];
  const rawClaims = Array.isArray(structured.claims) ? structured.claims : [];
  const rawCharts = Array.isArray(structured.charts) ? structured.charts : [];
  const metadata = report.metadata ?? {};
  const cost = metadata.costUsd ?? metadata.estimatedCostUsd;
  const reportType = String(
    (report as DatabaseDeepResearchReport & { reportType?: unknown }).reportType ??
      metadata.reportType ??
      "general",
  ) as DatabaseDeepResearchReportType;
  return {
    id: report.id,
    runId: report.runId,
    title: report.title,
    summary: report.summary ?? "",
    markdown: redactDatabaseResearchMarkdown(report.markdown),
    createdAt: report.createdAt,
    sections: rawSections
      .filter(
        (item): item is ReportSection =>
          !!item && typeof item === "object" && typeof item.title === "string",
      )
      .map((item) => ({
        id: item.id || item.title,
        title: item.title,
        markdown: redactDatabaseResearchMarkdown(item.markdown || ""),
      })),
    charts: rawCharts
      .filter(
        (item): item is ReportChart =>
          !!item &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          Array.isArray(item.data),
      )
      .map((item) => ({
        ...item,
        data: item.data.filter((row) => row && typeof row === "object"),
      })),
    evidence: [
      ...rawArtifacts
        .filter(
          (item): item is DatabaseResearchArtifact =>
            !!item && typeof item === "object",
        )
        .map(artifactEvidence),
      ...rawClaims
        .filter(
          (item): item is DatabaseResearchClaim =>
            !!item && typeof item === "object",
        )
        .map(claimEvidence),
    ],
    costUsd: typeof cost === "number" ? cost : undefined,
    qualityStatus:
      typeof report.quality?.status === "string"
        ? report.quality.status
        : undefined,
    readAt:
      typeof (report as DatabaseDeepResearchReport & { readAt?: unknown }).readAt === "string"
        ? (report as DatabaseDeepResearchReport & { readAt: string }).readAt
        : null,
    reportType: DATABASE_REPORT_TYPES.some((item) => item.id === reportType)
      ? reportType
      : "general",
  };
}

function ReportCharts({ charts }: { charts: ReportChart[] }) {
  if (!charts.length) return null;
  return (
    <section
      data-testid="database-deep-research-charts"
      className="mb-8 grid gap-4 lg:grid-cols-2"
    >
      {charts.map((chart) => {
        const points = chart.data.map((row) => {
          const value =
            typeof row.value === "number" && Number.isFinite(row.value)
              ? row.value
              : typeof row.rate === "number" && Number.isFinite(row.rate)
              ? row.rate
              : typeof row.median === "number" && Number.isFinite(row.median)
                ? row.median
                : 0;
          return {
            label: String(row.label ?? row.columnId ?? row.artifactId ?? "—"),
            value,
            n: typeof row.n === "number" && Number.isFinite(row.n) ? row.n : null,
          };
        });
        const scale = Math.max(
          1,
          ...points.map((point) => Math.abs(point.value)),
        );
        const hasNegative = points.some((point) => point.value < 0);
        return (
          <figure
            key={chart.id}
            className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800"
            aria-label={chart.title}
          >
            <figcaption className="mb-3 text-sm font-semibold">
              {chart.title}
            </figcaption>
            <div className="space-y-2">
              {points.map((point, index) => (
                <div
                  key={`${point.label}:${index}`}
                  className="grid grid-cols-[minmax(5rem,.8fr)_2fr_auto] items-center gap-2 text-xs"
                >
                  <span
                    className="truncate text-neutral-500"
                    title={point.label}
                  >
                    {point.label}
                  </span>
                  <span
                    className="relative h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-900"
                    role="img"
                    aria-label={`${point.label}: ${Number(point.value.toPrecision(6))}${point.n == null ? "" : `, n=${point.n}`}`}
                  >
                    {hasNegative ? <span className="absolute inset-y-0 left-1/2 w-px bg-neutral-400/70" /> : null}
                    <span
                      className={`absolute h-full rounded-full ${point.value < 0 ? "bg-amber-500" : "bg-cyan-500"}`}
                      style={{
                        width: `${Math.max(1, Math.min(hasNegative ? 50 : 100, (Math.abs(point.value) / scale) * (hasNegative ? 50 : 100)))}%`,
                        left: hasNegative ? (point.value < 0 ? "50%" : "50%") : "0",
                        transform: point.value < 0 ? "translateX(-100%)" : undefined,
                      }}
                    />
                  </span>
                  <span className="font-mono tabular-nums">
                    {Number(point.value.toPrecision(6))}{point.n == null ? "" : ` · n=${point.n}`}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] tabular-nums text-neutral-400" aria-hidden="true">
              <span>{hasNegative ? Number((-scale).toPrecision(4)) : 0}</span>
              {hasNegative ? <span>0</span> : null}
              <span>{Number(scale.toPrecision(4))}</span>
            </div>
          </figure>
        );
      })}
    </section>
  );
}
function roleValue(
  roles: DatabaseResearchSemanticRoles,
  id: keyof DatabaseResearchSemanticRoles,
): string | string[] {
  const value = roles[id];
  return Array.isArray(value) ? value : (value ?? "");
}

function DatabaseReaderSurface({
  report,
  annotations,
  highlighterColor,
  fullscreen,
  fontSize,
  evidenceOpen,
  onBack,
  onToggleFullscreen,
  onFontSize,
  onToggleRead,
  onExport,
  onToggleEvidence,
  onCopy,
  onSaveToNotes,
  includeSnapshot,
  onIncludeSnapshot,
  onCreateAnnotation,
  onUpdateComment,
  onDeleteAnnotation,
  onAnnotationError,
  onHighlighterChange,
  initialReading,
  onReadingChange,
  error,
}: {
  report: ReaderReport;
  annotations: WritingDraftAnnotation[];
  highlighterColor: WritingDraftAnnotationColor | null;
  fullscreen: boolean;
  fontSize: number;
  evidenceOpen: boolean;
  onBack: () => void;
  onToggleFullscreen: () => void;
  onFontSize: (delta: number) => void;
  onToggleRead: () => void;
  onExport: (format: DatabaseDeepResearchExportFormat) => void;
  onToggleEvidence: () => void;
  onCopy: () => void;
  onSaveToNotes: () => void;
  includeSnapshot: boolean;
  onIncludeSnapshot: (value: boolean) => void;
  onCreateAnnotation: (input: Omit<WritingDraftAnnotationInput, "draftId" | "scope">) => Promise<void>;
  onUpdateComment: (id: string, comment: string) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
  onAnnotationError: (message: string) => void;
  onHighlighterChange: (value: WritingDraftAnnotationColor | null) => void;
  initialReading: ReadingPlace | null;
  onReadingChange: (place: ReadingPlace | null) => void;
  error?: string | null;
}) {
  const documentRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const markActionsRef = useRef<ReaderSelectionActionsHandle | null>(null);
  const [progress, setProgress] = useState(0);
  const [hasMark, setHasMark] = useState(false);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const update = () => setProgress(Math.round((element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight)) * 100));
    update();
    element.addEventListener("scroll", update, { passive: true });
    return () => element.removeEventListener("scroll", update);
  }, [report.id]);
  useReadingPlace({
    scrollerRef: scrollRef,
    documentRef,
    restore: initialReading,
    rendering: "source",
    revision: report.id,
    onCapture: onReadingChange,
  });
  const copy = () => void onCopy();
  return (
    <div className={fullscreen ? "fixed inset-0 z-40 flex min-h-0 flex-col bg-white dark:bg-neutral-950" : "flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950"} data-testid="database-deep-research-reader">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2.5">
        <button className="btn btn-ghost gap-1.5" onClick={onBack}><Icon name="chevronLeft" size={14} />{t("Volver a la biblioteca")}</button>
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold" title={report.title}>{report.title}</div><div className="text-[11px] text-neutral-500">{formatDate(report.createdAt)} · {progress}%</div></div>
        <span className="rounded-full bg-cyan-100 px-2 py-1 text-[10px] font-medium text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300">{t(DATABASE_REPORT_TYPES.find((item) => item.id === report.reportType)?.label ?? "Investigación general")}</span>
        <button className="btn btn-ghost h-9 min-h-9 border border-neutral-700" onClick={copy} title={t("Copiar")}>{t("Copiar")}</button>
        <button className="btn btn-ghost h-9 min-h-9 border border-neutral-700" onClick={onSaveToNotes}>{t("Guardar a notas")}</button>
        <div className="flex h-9 items-center overflow-hidden rounded-lg border border-neutral-700"><button className="grid h-full w-8 place-items-center text-sm" onClick={() => onFontSize(-1)} aria-label={t("Disminuir texto")}>A−</button><span className="grid h-full min-w-8 place-items-center border-x border-neutral-700 text-xs">{fontSize}</span><button className="grid h-full w-8 place-items-center text-sm" onClick={() => onFontSize(1)} aria-label={t("Aumentar texto")}>A+</button></div>
        <ReaderHighlighterControl value={highlighterColor} onChange={onHighlighterChange} />
        <button className="btn btn-ghost h-9 min-h-9 border border-neutral-700" onClick={() => markActionsRef.current?.goToMark()} disabled={!hasMark} title={t("Ir al marcador de lectura")}><Icon name={hasMark ? "bookmarkFill" : "bookmark"} size={14} /></button>
        <button className="btn btn-ghost h-9 min-h-9 border border-neutral-700" onClick={onToggleRead}>{report.readAt ? t("Marcar como no leído") : t("Marcar como leído")}</button>
        <button className="btn btn-ghost h-9 min-h-9 border border-neutral-700" onClick={onToggleEvidence}><Icon name="book" size={14} />{t("Evidencia")}</button>
        <details className="group relative">
          <summary className="btn btn-ghost h-9 min-h-9 cursor-pointer list-none border border-neutral-700"><Icon name="download" size={14} />{t("Exportar")}</summary>
          <div className="absolute right-0 top-11 z-20 w-56 rounded-xl border border-neutral-800 bg-neutral-950 p-2 shadow-2xl">
            {(["markdown", "pdf", "docx", "zip"] as const).map((format) => <button key={format} className="btn btn-ghost w-full justify-start" onClick={(event) => { onExport(format); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{format === "markdown" ? t("Markdown") : format === "docx" ? t("Word (.docx)") : format.toUpperCase()}</button>)}
            <label className="mt-1 flex items-start gap-2 border-t border-neutral-800 px-2 pt-2 text-[11px] leading-4 text-neutral-400"><input type="checkbox" className="mt-0.5" checked={includeSnapshot} onChange={(event) => onIncludeSnapshot(event.target.checked)} />{t("Incluir snapshot bruto en el ZIP reproducible")}</label>
          </div>
        </details>
        <button className="btn btn-ghost h-9 min-h-9 border border-neutral-700" onClick={onToggleFullscreen} aria-label={t("Lectura a pantalla completa")}><Icon name={fullscreen ? "minimize" : "maximize"} size={14} /></button>
      </header>
      {error && <div className="border-b border-rose-900/60 bg-rose-950/30 px-4 py-2 text-xs text-rose-200">{error}</div>}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-neutral-800 p-4 lg:block"><div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{t("Contenido")}</div><div className="mb-4 h-1.5 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-indigo-500" style={{ width: `${progress}%` }} /></div>{report.sections.map((section) => <a key={section.id} href={`#${section.id}`} className="mb-1 block rounded-lg px-2 py-1.5 text-xs hover:bg-neutral-900">{section.title}</a>)}</aside>
        <main ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto px-5 py-6 md:px-10" data-testid="database-deep-research-reader-scroll"><div ref={documentRef} className="deep-research-reader-document mx-auto max-w-5xl space-y-7" style={{ "--deep-research-font-size": `${fontSize}px` } as CSSProperties}><ReportCharts charts={report.charts} />{report.sections.length ? report.sections.map((section) => <section key={section.id} id={section.id} className="scroll-mt-5"><h3 className="mb-3 text-xl font-semibold">{section.title}</h3><Markdown content={section.markdown} /></section>) : <Markdown content={report.markdown} />}</div></main>
        {evidenceOpen && <aside data-testid="database-deep-research-evidence-drawer" className="w-80 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950/30 p-4"><h3 className="mb-3 font-semibold">{t("Evidencia")}</h3>{report.evidence.length ? <div className="space-y-2">{report.evidence.map((item) => <article key={item.id} className="rounded-xl border border-neutral-800 p-3"><div className="text-xs font-medium">{item.label}</div><p className="mt-1 text-xs leading-5 text-neutral-500">{item.excerpt}</p><div className="mt-2 text-[10px] text-neutral-500">{item.method && `${t("Método")}: ${item.method} · `}{item.n != null && `n=${item.n} · `}{t("Filas")}: {item.rowIds.length || "—"}</div></article>)}</div> : <p className="text-xs text-neutral-500">{t("No hay evidencia registrada.")}</p>}</aside>}
      </div>
      <ReaderSelectionActions key={report.id} ref={markActionsRef} targetRef={documentRef} scrollRef={scrollRef} contextId={`database-deep-research:${report.id}`} annotations={annotations} highlighterColor={highlighterColor} onCreateAnnotation={onCreateAnnotation} onUpdateComment={onUpdateComment} onDeleteAnnotation={onDeleteAnnotation} onAnnotationError={onAnnotationError} onMarkChange={setHasMark} />
      <FindInPage targetRef={scrollRef} />
    </div>
  );
}

export function DatabaseDeepResearchView({
  settings,
  snapshot,
  onSnapshotChange,
}: {
  settings: import("@shared/types").AppSettings;
  snapshot?: DatabaseDeepResearchSnapshot;
  onSnapshotChange?: (patch: Partial<DatabaseDeepResearchSnapshot>) => void;
}) {
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [details, setDetails] = useState<
    Array<{
      detail: DatabaseDetail;
      rows: DatabaseRow[];
      views: DatabaseSavedView[];
    }>
  >([]);
  const [selectedDatabaseIds, setSelectedDatabaseIds] = useState<string[]>(
    snapshot?.selectedDatabaseIds ?? [],
  );
  const [selectedViewIds, setSelectedViewIds] = useState<string[]>(
    snapshot?.selectedViewIds ?? [],
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [autoReportType, setAutoReportType] = useState(true);
  const [objective, setObjective] = useState("");
  const [reportType, setReportType] = useState<DatabaseDeepResearchReportType>("general");
  const [reportLanguage, setReportLanguage] = useState<PromptLanguage>(() => getActiveLang() as PromptLanguage);
  const [query, setQuery] = useState("");
  const [columnIds, setColumnIds] = useState<string[]>([]);
  const [depth, setDepth] = useState<DatabaseResearchDepth>("deep");
  const [sectionLength, setSectionLength] = useState<DeepResearchSectionLength>("auto");
  const [sectionLengthValid, setSectionLengthValid] = useState(true);
  const [model, setModel] = useState<ModelRef | null>(
    settings.deepResearchModel ?? null,
  );
  // The thinking level for that model, shared with the Research chat's memory.
  const [thinkingEffort, setThinkingEffort] = useResearchEffort(settings, model);
  const [roles, setRoles] = useState<DatabaseResearchSemanticRoles>({});
  const [preview, setPreview] = useState<DatabaseDeepResearchPreview | null>(
    null,
  );
  const [previewSections, setPreviewSections] = useState<PreviewSection[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<DatabaseDeepResearchJob[]>([]);
  const [reports, setReports] = useState<ReaderReport[]>([]);
  const [reportFilter, setReportFilter] = useState<DatabaseDeepResearchReportType[]>(() => Array.isArray(snapshot?.reportFilter) ? snapshot.reportFilter : []);
  const [reportSearch, setReportSearch] = useState(snapshot?.search ?? "");
  const [readStates, setReadStates] = useState<ReadState[]>(() => readStatesFromFilter(snapshot?.readFilter));
  const [sortKey, setSortKey] = useState<"recent" | "oldest" | "title">(snapshot?.sortKey ?? "recent");
  const [viewMode, setViewMode] = useState<"grid" | "list">(snapshot?.viewMode ?? "grid");
  const [selecting, setSelecting] = useState(false);
  const [selectedReports, setSelectedReports] = useState<Set<string>>(new Set());
  const [reader, setReader] = useState<ReaderReport | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [includeSnapshot, setIncludeSnapshot] = useState(false);
  const [savingToNotes, setSavingToNotes] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [annotations, setAnnotations] = useState<WritingDraftAnnotation[]>([]);
  const [highlighterColor, setHighlighterColor] = useState<WritingDraftAnnotationColor | null>(null);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const selectedDetails = useMemo(
    () =>
      details.filter(({ detail }) =>
        selectedDatabaseIds.includes(detail.database.id),
      ),
    [details, selectedDatabaseIds],
  );
  const columns = useMemo(
    () => selectedDetails.flatMap(({ detail }) => detail.columns),
    [selectedDetails],
  );
  const preset = DATABASE_RESEARCH_BUDGETS[depth];
  const input = useMemo<DatabaseDeepResearchJobInput>(
    () => ({
      objective: objective.trim(),
      reportType: autoReportType ? "auto" : reportType,
      requestedReportType: autoReportType ? "auto" : reportType,
      autoConfigure: true,
      language: reportLanguage,
      databaseIds: selectedDatabaseIds,
      viewIds: selectedViewIds,
      filters: { query: query.trim(), columnIds },
      roles,
      model,
      depth,
      sectionLength,
      budget: { ...preset, depth, maxRows: 500_000 },
      includeAttachmentContent: false,
    }),
    [
      objective,
      sectionLength,
      autoReportType,
      reportType,
      reportLanguage,
      selectedDatabaseIds,
      selectedViewIds,
      query,
      columnIds,
      roles,
      model,
      depth,
      preset,
    ],
  );
  const visibleReports = useMemo(
    () => {
      const needle = reportSearch.trim().toLocaleLowerCase();
      const filtered = reports.filter((report) => {
        const matchesSearch = !needle || [report.title, report.summary].some((value) => value.toLocaleLowerCase().includes(needle));
        const matchesType = passesFilter(reportFilter, report.reportType);
        const matchesRead = passesFilter(readStates, report.readAt ? "read" : "unread");
        return matchesSearch && matchesType && matchesRead;
      });
      return filtered.sort((a, b) => sortKey === "title"
        ? a.title.localeCompare(b.title)
        : sortKey === "oldest"
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt));
    },
    [reportFilter, reportSearch, readStates, reports, sortKey],
  );
  // Counted over every report, so a number does not vanish when another filter is on.
  // Only the types the gallery actually holds are offered (plus any still ticked).
  const filterOptions = useMemo(() => {
    const read = new Map<ReadState, number>();
    const types = new Map<string, number>();
    for (const report of reports) {
      const state: ReadState = report.readAt ? "read" : "unread";
      read.set(state, (read.get(state) ?? 0) + 1);
      types.set(report.reportType, (types.get(report.reportType) ?? 0) + 1);
    }
    const readOptions: GalleryFilterOption<ReadState>[] = [
      { value: "unread", label: t("No leídos"), count: read.get("unread") ?? 0 },
      { value: "read", label: t("Leídos"), count: read.get("read") ?? 0 },
    ];
    const typeOptions: GalleryFilterOption<DatabaseDeepResearchReportType>[] = DATABASE_REPORT_TYPES
      .filter((item) => types.has(item.id) || reportFilter.includes(item.id))
      .map((item) => ({ value: item.id, label: t(item.label), count: types.get(item.id) ?? 0 }));
    return { read: readOptions, type: typeOptions };
  }, [reports, reportFilter]);
  const activeFilterCount = readStates.length + reportFilter.length;
  const changeReadStates = (next: ReadState[]) => { setReadStates(next); onSnapshotChange?.({ readFilter: readFilterFromStates(next) }); };
  const changeReportFilter = (next: DatabaseDeepResearchReportType[]) => { setReportFilter(next); onSnapshotChange?.({ reportFilter: next }); };
  const changeSortKey = (next: "recent" | "oldest" | "title") => { setSortKey(next); onSnapshotChange?.({ sortKey: next }); };

  const load = useCallback(async () => {
    const list = await window.nodus.listDatabases();
    setDatabases(list);
    setSelectedDatabaseIds((current) =>
      current.length
        ? current.filter((id) => list.some((db) => db.id === id))
        : list.map((db) => db.id),
    );
    const loaded = await Promise.all(
      list.map(async (database) => {
        const detail = await window.nodus.getDatabaseDetail(database.id);
        if (!detail) return null;
        const [rows, views] = await Promise.all([
          window.nodus.listDatabaseRows(database.id, { limit: 120 }),
          window.nodus.listDatabaseViews(database.id),
        ]);
        return { detail, rows, views };
      }),
    );
    setDetails(
      loaded.filter(Boolean) as Array<{
        detail: DatabaseDetail;
        rows: DatabaseRow[];
        views: DatabaseSavedView[];
      }>,
    );
  }, []);
  const loadJobsAndReports = useCallback(async () => {
    const [loadedJobs, loadedReports] = await Promise.all([
      window.nodus.listDatabaseDeepResearchJobs(),
      window.nodus.listDatabaseDeepResearchReports(),
    ]);
    setJobs(loadedJobs);
    setReports(
      loadedReports.map((report) =>
        normalizeReport(report as DatabaseDeepResearchReport),
      ),
    );
  }, []);
  useEffect(() => {
    void load().catch((error) => setPreviewError(t((error as Error).message)));
    void loadJobsAndReports().catch((error) =>
      setPreviewError(t((error as Error).message)),
    );
  }, [load, loadJobsAndReports]);
  useEffect(
    () =>
      window.nodus.onDatabaseDeepResearchProgress(
        (progress: DatabaseResearchProgress) => {
          setJobs((current) =>
            current.map((job) =>
              job.id === progress.runId
                ? {
                    ...job,
                    status: progress.status,
                    progress: progressPercent(progress.progress),
                    phase: progress.phase ?? progress.step ?? job.phase,
                    error: progress.error ?? job.error,
                  }
                : job,
            ),
          );
          if (
            ["completed", "partial", "failed", "cancelled", "stale"].includes(
              progress.status,
            )
          )
            void loadJobsAndReports();
        },
      ),
    [loadJobsAndReports],
  );
  const makePreview = useCallback(async () => {
    if (!selectedDatabaseIds.length) {
      setPreview(null);
      setPreviewSections([]);
      return;
    }
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const next = await window.nodus.previewDatabaseDeepResearch(input);
      setPreview(next);
      setPreviewSections(next.sections);
      if (next.suggestedRoles) setRoles(next.suggestedRoles);
      if (autoReportType && next.resolvedReportType) setReportType(next.resolvedReportType);
      if (next.warnings?.length) setToast(next.warnings.map((warning) => t(warning)).join(" "));
    } catch (error) {
      setPreviewError(t((error as Error).message));
    } finally {
      setPreviewBusy(false);
    }
  }, [autoReportType, input, selectedDatabaseIds.length]);
  // Advanced planning is opt-in. Opening the composer never starts a preview pass;
  // this keeps the simple flow fast and makes the expensive-looking preview explicit.
  const toggleDatabase = (id: string) =>
    setSelectedDatabaseIds((current) => {
      const next = current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id];
      const allowedColumns = new Set(
        details
          .filter(({ detail }) => next.includes(detail.database.id))
          .flatMap(({ detail }) => detail.columns.map((column) => column.id)),
      );
      const allowedViews = new Set(
        details
          .filter(({ detail }) => next.includes(detail.database.id))
          .flatMap(({ views }) => views.map((view) => view.id)),
      );
      setColumnIds((selected) =>
        selected.filter((columnId) => allowedColumns.has(columnId)),
      );
      setSelectedViewIds((selected) => {
        const sanitized = selected.filter((viewId) => allowedViews.has(viewId));
        onSnapshotChange?.({
          selectedDatabaseIds: next,
          selectedViewIds: sanitized,
        });
        return sanitized;
      });
      setRoles(
        (currentRoles) =>
          Object.fromEntries(
            Object.entries(currentRoles).flatMap(([role, value]) => {
              const kept = (
                Array.isArray(value) ? value : value ? [value] : []
              ).filter((columnId) => allowedColumns.has(columnId));
              return kept.length
                ? [[role, Array.isArray(value) ? kept : kept[0]]]
                : [];
            }),
          ) as DatabaseResearchSemanticRoles,
      );
      return next;
    });
  const toggleView = (id: string) =>
    setSelectedViewIds((current) => {
      const owner = details.find(({ views }) =>
        views.some((view) => view.id === id),
      );
      const siblingIds = new Set(owner?.views.map((view) => view.id) ?? []);
      const next = current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current.filter((value) => !siblingIds.has(value)), id];
      onSnapshotChange?.({ selectedViewIds: next });
      return next;
    });
  const toggleColumn = (id: string) =>
    setColumnIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  const updateSection = (
    index: number,
    field: "title" | "focus",
    value: string,
  ) =>
    setPreviewSections((current) =>
      current.map((section, i) =>
        i === index ? { ...section, [field]: value } : section,
      ),
    );
  const setRole = (
    id: keyof DatabaseResearchSemanticRoles,
    value: string | string[],
  ) =>
    setRoles((current) => ({
      ...current,
      [id]: Array.isArray(value) ? value : value || undefined,
    }));
  const startResearch = async (): Promise<boolean> => {
    if (!objective.trim()) {
      setToast(t("Escribe un objetivo antes de iniciar la investigación."));
      return false;
    }
    if (!selectedDatabaseIds.length) {
      setToast(t("Selecciona al menos una base de datos."));
      return false;
    }
    if (!model) {
      setToast(t("Selecciona un modelo antes de iniciar la investigación."));
      return false;
    }
    if (!sectionLengthValid) {
      setToast(t("Corrige la extensión orientativa de cada sección antes de generar el informe."));
      return false;
    }
    setBusy(true);
    try {
      const job = await window.nodus.enqueueDatabaseDeepResearch({
        ...input,
        model,
        thinkingEffort,
        planSections: previewSections,
      });
      setJobs((current) => [
        job,
        ...current.filter((item) => item.id !== job.id),
      ]);
      setToast(t("Investigación añadida a la cola."));
      void loadJobsAndReports();
      return true;
    } catch (error) {
      setToast(t((error as Error).message));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const clearFinishedJobs = async () => {
    await window.nodus.clearFinishedDatabaseDeepResearchJobs();
    await loadJobsAndReports();
  };
  const cancelJob = async (id: string) => {
    await window.nodus.cancelDatabaseDeepResearchJob(id);
    await loadJobsAndReports();
  };
  const deleteReport = async (id: string) => {
    await window.nodus.deleteDatabaseDeepResearchReport(id);
    setReports((current) => current.filter((report) => report.id !== id));
    if (reader?.id === id) setReader(null);
  };
  const openReport = useCallback(
    async (report: ReaderReport) => {
      const loaded = await window.nodus.getDatabaseDeepResearchReport(
        report.id,
      );
      setReader(
        loaded ? normalizeReport(loaded as DatabaseDeepResearchReport) : report,
      );
      setEvidenceOpen(false);
      onSnapshotChange?.({
        openReportId: report.id,
        reading: snapshot?.openReportId === report.id ? snapshot.reading ?? null : null,
      });
    },
    [onSnapshotChange, snapshot?.openReportId, snapshot?.reading],
  );
  const refreshAnnotations = useCallback(async (reportId: string) => {
    try {
      const next = await window.nodus.listDatabaseDeepResearchReportAnnotations(reportId);
      setAnnotations(next.map(toWritingAnnotation));
      setAnnotationError(null);
    } catch (error) {
      setAnnotationError(t(error instanceof Error ? error.message : String(error)));
    }
  }, []);
  useEffect(() => {
    if (!reader) { setAnnotations([]); return undefined; }
    void refreshAnnotations(reader.id);
    const unsubscribe = window.nodus.onDatabaseDeepResearchReportAnnotationsChanged((id) => {
      if (id === null || id === reader.id) void refreshAnnotations(reader.id);
    });
    return unsubscribe;
  }, [reader?.id, refreshAnnotations]);
  const toggleReportRead = useCallback(async (report: ReaderReport) => {
    try {
      const next = await window.nodus.setDatabaseDeepResearchReportRead(report.id, !report.readAt);
      const updated = next && typeof next === "object" ? normalizeReport(next as DatabaseDeepResearchReport) : { ...report, readAt: report.readAt ? null : new Date().toISOString() };
      setReports((current) => current.map((item) => item.id === report.id ? updated : item));
      setReader((current) => current?.id === report.id ? updated : current);
    } catch (error) {
      setToast(t(error instanceof Error ? error.message : String(error)));
    }
  }, []);
  const createReaderAnnotation = useCallback(async (input: Omit<WritingDraftAnnotationInput, "draftId" | "scope">) => {
    if (!reader) return;
    const annotationInput: DatabaseDeepResearchReportAnnotationInput = { ...input, reportId: reader.id, scope: "source" };
    const created = toWritingAnnotation(await window.nodus.createDatabaseDeepResearchReportAnnotation(annotationInput));
    setAnnotations((current) => [...current.filter((item) => item.id !== created.id), created]);
    setAnnotationError(null);
  }, [reader]);
  const updateReaderComment = useCallback(async (id: string, comment: string) => {
    if (!reader) return;
    const updated = await window.nodus.updateDatabaseDeepResearchReportComment(id, comment);
    if (updated) {
      const next = toWritingAnnotation(updated);
      setAnnotations((current) => current.map((item) => item.id === next.id ? next : item));
    } else await refreshAnnotations(reader.id);
    setAnnotationError(null);
  }, [reader, refreshAnnotations]);
  const deleteReaderAnnotation = useCallback(async (id: string) => {
    await window.nodus.deleteDatabaseDeepResearchReportAnnotation(id);
    setAnnotations((current) => current.filter((item) => item.id !== id));
    setAnnotationError(null);
  }, []);
  useEffect(() => {
    if (!reader && snapshot?.openReportId) {
      const report = reports.find((item) => item.id === snapshot.openReportId);
      if (report) void openReport(report);
    }
  }, [openReport, reader, reports, snapshot?.openReportId]);
  const exportReport = async (format: DatabaseDeepResearchExportFormat) => {
    if (!reader) return;
    if (
      includeSnapshot &&
      format === "zip" &&
      !window.confirm(
        t(
          "El ZIP incluirá el snapshot bruto de las filas seleccionadas. ¿Continuar?",
        ),
      )
    )
      return;
    try {
      const result = await window.nodus.exportDatabaseDeepResearchReport(
        reader.id,
        { format, includeSnapshot: includeSnapshot && format === "zip" },
      );
      if (!result.canceled)
        setToast(tx("Exportado: {path}", { path: result.path ?? "" }));
    } catch (error) {
      setToast(t((error as Error).message));
    }
  };
  if (reader) {
    return (
      <>
        <DatabaseReaderSurface
          report={reader}
          annotations={annotations}
          highlighterColor={highlighterColor}
          fullscreen={fullscreen}
          fontSize={fontSize}
          evidenceOpen={evidenceOpen}
          includeSnapshot={includeSnapshot}
          initialReading={snapshot?.reading ?? null}
          error={annotationError}
          onReadingChange={(reading) => onSnapshotChange?.({ reading })}
          onIncludeSnapshot={setIncludeSnapshot}
          onBack={() => { setReader(null); setFullscreen(false); onSnapshotChange?.({ openReportId: null, reading: null }); }}
          onToggleFullscreen={() => setFullscreen((value) => !value)}
          onFontSize={(delta) => setFontSize((value) => Math.max(14, Math.min(22, value + delta)))}
          onToggleRead={() => void toggleReportRead(reader)}
          onExport={(format) => void exportReport(format)}
          onToggleEvidence={() => setEvidenceOpen((value) => !value)}
          onCopy={() => void navigator.clipboard.writeText(reader.markdown).then(() => setToast(t("Informe copiado.")))}
          onSaveToNotes={() => setSavingToNotes(true)}
          onCreateAnnotation={createReaderAnnotation}
          onUpdateComment={updateReaderComment}
          onDeleteAnnotation={deleteReaderAnnotation}
          onAnnotationError={setAnnotationError}
          onHighlighterChange={setHighlighterColor}
        />
        {savingToNotes && <SaveToNotesModal content={`# ${reader.title}\n\n${reader.markdown}`} defaultTitle={reader.title} kind="writing" source={{ origin: "writing", ref: `database-deep-research:${reader.id}` }} allowProjectLink onClose={() => setSavingToNotes(false)} onSaved={() => setToast(t("Informe guardado en notas."))} />}
      </>
    );
  }

  const queueActive: QueueStripItem[] = jobs
    .filter((job) => ["queued", "running"].includes(job.status))
    .map((job) => {
      const phase = PHASE_LABELS[job.phase as DatabaseResearchStepKind];
      return { id: job.id, title: job.title, status: job.status === "running" ? "running" : "queued", progress: null, percent: job.status === "running" ? progressPercent(job.progress) : null, detail: job.status === "running" && phase ? t(phase) : null, error: null, origin: "app", enqueuedAt: job.createdAt };
    });
  // Partial runs already have a saved report with a visible quality badge.
  // They must not also appear as failed generation jobs.
  const queueFailed: QueueStripItem[] = jobs
    .filter((job) => ["failed", "cancelled", "stale"].includes(job.status))
    .map((job) => ({ id: job.id, title: job.title, status: "failed", progress: null, error: job.error, origin: "app", enqueuedAt: job.createdAt }));

  const allSelected = visibleReports.length > 0 && visibleReports.every((report) => selectedReports.has(report.id));
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="database-deep-research">
      <SectionHeader icon="telescope" title={t("Deep Research")} subtitle={t("Investiga tus bases de datos con evidencia trazable y un lector completo.")} testId="database-deep-research-header" actions={<button className="btn btn-primary" data-testid="database-deep-research-new" onClick={() => setComposerOpen(true)}><Icon name="plus" size={14} />{t("Nuevo informe")}</button>} />
      {queueActive.length > 0 || queueFailed.length > 0 ? <DeepResearchQueueStrip active={queueActive} failed={queueFailed} running={queueActive.some((item) => item.status === "running")} onRemove={(item) => void cancelJob(item.id)} onClearFinished={() => void clearFinishedJobs()} /> : null}
      <SectionToolbar testId="database-deep-research-toolbar">
        <div className="relative min-w-56 flex-1"><Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" /><input className="input input-with-leading-icon h-9 w-full" value={reportSearch} onChange={(event) => { setReportSearch(event.target.value); onSnapshotChange?.({ search: event.target.value }); }} placeholder={t("Buscar entre tus informes…")} aria-label={t("Buscar entre tus informes")} /></div>
        <GalleryFilterMenu label={t("Estado")} icon="eye" options={filterOptions.read} selected={readStates} onChange={changeReadStates} testId="database-deep-research-read-filter" />
        <GalleryFilterMenu label={t("Tipo")} icon="layers" options={filterOptions.type} selected={reportFilter} onChange={changeReportFilter} testId="database-deep-research-type-filter" />
        <GalleryFilterReset count={activeFilterCount} onClear={() => { changeReadStates([]); changeReportFilter([]); }} />
        <GallerySortMenu options={[{ value: "recent", label: t("Más recientes") }, { value: "oldest", label: t("Más antiguos") }, { value: "title", label: t("Por título (A–Z)") }]} value={sortKey} onChange={changeSortKey} testId="database-deep-research-sort" />
        <button className={`btn btn-ghost h-9 min-h-9 border ${selecting ? "border-indigo-500 text-indigo-300" : "border-neutral-700"}`} onClick={() => { setSelecting((value) => !value); setSelectedReports(new Set()); }}>{selecting ? t("Cancelar selección") : t("Seleccionar")}</button>
        <button className="btn btn-ghost h-9 min-h-9 border border-neutral-700" onClick={() => setViewMode((value) => { const next = value === "grid" ? "list" : "grid"; onSnapshotChange?.({ viewMode: next }); return next; })} aria-label={viewMode === "grid" ? t("Vista de lista") : t("Vista de cuadrícula")}><Icon name={viewMode === "grid" ? "list" : "grid"} size={14} /></button>
        {selecting && <><button className="btn btn-ghost h-9 min-h-9" onClick={() => setSelectedReports(allSelected ? new Set() : new Set(visibleReports.map((report) => report.id)))}>{allSelected ? t("Quitar selección") : t("Seleccionar todos")}</button><button className="btn btn-ghost h-9 min-h-9 text-rose-500" disabled={!selectedReports.size} onClick={() => void Promise.all([...selectedReports].map((id) => deleteReport(id))).then(() => { setSelectedReports(new Set()); setSelecting(false); })}>{t("Eliminar")}</button></>}
      </SectionToolbar>
      <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6"><div className={viewMode === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "space-y-2"} data-testid="database-deep-research-library">
        {visibleReports.length ? visibleReports.map((report) => <article key={report.id} className={`group relative rounded-2xl border p-4 transition-colors ${selectedReports.has(report.id) ? "border-indigo-500 bg-indigo-950/20" : "border-neutral-800 bg-neutral-950/20 hover:border-indigo-500/60"}`} data-testid={`database-deep-research-card-${report.id}`}>
          {selecting && <input type="checkbox" className="absolute right-3 top-3" checked={selectedReports.has(report.id)} onChange={() => setSelectedReports((current) => { const next = new Set(current); if (next.has(report.id)) next.delete(report.id); else next.add(report.id); return next; })} aria-label={tx("Seleccionar {title}", { title: report.title })} />}
          <button className="w-full text-left" onClick={() => selecting ? setSelectedReports((current) => { const next = new Set(current); if (next.has(report.id)) next.delete(report.id); else next.add(report.id); return next; }) : void openReport(report)}><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-950/50 text-indigo-300"><Icon name={REPORT_TYPE_ICONS[report.reportType]} size={16} /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className={`truncate text-sm ${report.readAt ? "font-normal text-neutral-500" : "font-semibold"}`}>{report.title}</h2>{report.readAt && <span className="shrink-0 text-[10px] text-emerald-500">{t("Leído")}</span>}</div><div className="mt-1 flex flex-wrap gap-1.5"><span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">{t(DATABASE_REPORT_TYPES.find((item) => item.id === report.reportType)?.label ?? "Investigación general")}</span>{report.qualityStatus === "partial" && <span className="rounded-full bg-violet-950/50 px-2 py-0.5 text-[10px] text-violet-300">{t("Parcial")}</span>}</div><p className="mt-2 line-clamp-3 text-xs leading-5 text-neutral-500">{report.summary}</p><p className="mt-3 text-[10px] text-neutral-500">{formatDate(report.createdAt)}</p></div></div></button>
          {!selecting && <div className="mt-3 flex items-center justify-end gap-1 border-t border-neutral-800 pt-2"><button className="btn btn-ghost h-7 min-h-7 px-2 text-[11px]" onClick={() => void toggleReportRead(report)}>{report.readAt ? t("No leído") : t("Marcar leído")}</button><button className="btn btn-ghost h-7 min-h-7 px-2 text-[11px] text-rose-500" onClick={() => void deleteReport(report.id)}>{t("Eliminar")}</button></div>}
        </article>) : <div className="col-span-full grid min-h-64 place-items-center rounded-2xl border border-dashed border-neutral-800 text-center text-sm text-neutral-500"><div><Icon name="fileText" size={28} className="mx-auto mb-2 opacity-50" />{reportSearch || activeFilterCount > 0 ? t("Ningún informe coincide con los filtros.") : t("Aún no hay informes. Crea el primero y quedará aquí listo para leerse.")}</div></div>}
      </div></main>
      {composerOpen && <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="database-deep-research-composer-title"><div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl" data-testid="database-deep-research-composer"><header className="mb-4 flex items-start justify-between gap-4"><div><h2 id="database-deep-research-composer-title" className="text-base font-semibold">{t("Nuevo informe")}</h2><p className="mt-1 text-xs text-neutral-500">{t("Define el objetivo; las opciones avanzadas son opcionales.")}</p></div><button className="btn btn-ghost h-8 min-h-8" onClick={() => setComposerOpen(false)} aria-label={t("Cerrar")}><Icon name="x" size={14} /></button></header><textarea data-testid="database-deep-research-objective" className="input min-h-28 w-full resize-y py-3" value={objective} onChange={(event) => setObjective(event.target.value)} placeholder={t("¿Qué quieres descubrir, comparar o explicar con estas bases de datos?")} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-500">{t("Tipo de informe")}<select className={`${inputClass} mt-1 h-10`} value={autoReportType ? "auto" : reportType} onChange={(event) => { if (event.target.value === "auto") { setAutoReportType(true); setReportType("general"); } else { setAutoReportType(false); setReportType(event.target.value as DatabaseDeepResearchReportType); } }}><option value="auto">{t("Automático")}</option>{DATABASE_REPORT_TYPES.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}</select></label><label className="text-xs text-neutral-500">{t("Idioma del informe")}<select data-testid="database-deep-research-language" className={`${inputClass} mt-1 h-10`} value={reportLanguage} onChange={(event) => setReportLanguage(event.target.value as PromptLanguage)}>{REPORT_LANGUAGE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label className="text-xs text-neutral-500">{t("Modelo")}<ModelPicker settings={settings} value={model} onChange={setModel} className="mt-1 h-10 w-full" ariaLabel={t("Modelo")} menu /></label><ResearchEffortControl variant="field" label className="mt-1 h-10 w-full text-sm" testId="database-deep-research-thinking" model={model} value={thinkingEffort} onChange={setThinkingEffort} disabled={!model} /><label className="text-xs text-neutral-500">{t("Profundidad")}<select className={`${inputClass} mt-1 h-10`} value={depth} onChange={(event) => setDepth(event.target.value as DatabaseResearchDepth)}>{DEPTHS.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}</select></label><DeepResearchSectionLengthField value={sectionLength} onChange={setSectionLength} onValidityChange={setSectionLengthValid} className="block min-w-0 text-xs text-neutral-500" labelClassName="block text-xs text-neutral-500" selectClassName={`${inputClass} mt-1 h-10 w-full`} testIdPrefix="database-deep-research-section-length" /></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-500">{t("Bases y vistas")}<div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-neutral-800 p-2">{databases.map((database) => <div key={database.id}><label className="flex h-9 items-center gap-2 px-2 text-xs"><input type="checkbox" checked={selectedDatabaseIds.includes(database.id)} onChange={() => toggleDatabase(database.id)} /><span className="truncate">{database.name}</span><span className="ml-auto text-[10px] text-neutral-500">{database.rowCount}</span></label>{selectedDatabaseIds.includes(database.id) && details.find(({ detail }) => detail.database.id === database.id)?.views.map((view) => <label key={view.id} className="ml-5 flex h-8 items-center gap-2 text-[11px] text-neutral-500"><input type="checkbox" checked={selectedViewIds.includes(view.id)} onChange={() => toggleView(view.id)} />{view.name}</label>)}</div>)}</div></label><label className="text-xs text-neutral-500">{t("Filtro de filas y columnas")}<input className={`${inputClass} mt-1 h-10`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Buscar texto dentro de las filas…")} /><div className="mt-2 flex max-h-20 flex-wrap gap-1 overflow-y-auto">{columns.map((column) => <label key={column.id} className="inline-flex h-7 items-center gap-1 rounded border border-neutral-800 px-2 text-[11px]"><input type="checkbox" checked={columnIds.includes(column.id)} onChange={() => toggleColumn(column.id)} />{column.name}</label>)}</div></label></div>
        <button className="mt-4 flex w-full items-center justify-between rounded-xl border border-neutral-800 px-3 py-2 text-left text-xs font-medium" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}><span><Icon name="settings" size={14} className="mr-2 inline text-indigo-300" />{t("Opciones avanzadas")}</span><Icon name={advancedOpen ? "chevronUp" : "chevronDown"} size={14} /></button>
        {advancedOpen && <div className="mt-3 space-y-4 rounded-xl border border-neutral-800 p-3" data-testid="database-deep-research-advanced"><div className="grid gap-3 sm:grid-cols-2">{ROLE_DEFS.map((role) => <label key={role.id} className="text-xs text-neutral-500">{t(role.label)}<select multiple={role.multiple} size={role.multiple ? 3 : undefined} className={`${inputClass} mt-1 h-10`} value={role.multiple ? roleValue(roles, role.id) as string[] : roleValue(roles, role.id) as string} onChange={(event) => setRole(role.id, role.multiple ? Array.from(event.target.selectedOptions, (option) => option.value) : event.target.value)}><option value="">{t("Detectar automáticamente")}</option>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>)}</div><div className="flex items-center justify-between gap-2"><span className="text-xs text-neutral-500">{t("Prepara y edita la estructura antes de encolar.")}</span><button className="btn btn-ghost h-8 min-h-8 border border-neutral-700" onClick={() => void makePreview()} disabled={previewBusy}>{previewBusy ? t("Preparando…") : t("Preparar automáticamente")}</button></div>{preview && <div className="space-y-2" data-testid="database-deep-research-preview">{previewSections.map((section, index) => <div key={`${index}:${section.title}`} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]"><input className="input h-9 text-sm" value={section.title} onChange={(event) => updateSection(index, "title", event.target.value)} aria-label={tx("Título de sección {n}", { n: index + 1 })} /><input className="input h-9 text-sm" value={section.focus} onChange={(event) => updateSection(index, "focus", event.target.value)} aria-label={tx("Foco de sección {n}", { n: index + 1 })} /><span className="self-center text-xs text-neutral-500">{tx("{n} evidencias", { n: section.evidenceCount })}</span></div>)}</div>}<button className="text-xs text-indigo-300 underline" onClick={() => { setAutoReportType(true); setReportType("general"); setRoles({}); setPreview(null); setPreviewSections([]); }}>{t("Usar automático")}</button></div>}
        {(previewError || preview?.warnings?.length) && <div className="mt-3 rounded-xl border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">{previewError ?? (preview?.warnings ?? []).map((warning) => t(warning)).join(" ")}</div>}
        <div className="mt-5 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setComposerOpen(false)}>{t("Cancelar")}</button><button className="btn btn-primary" data-testid="database-deep-research-start" disabled={busy} onClick={() => void startResearch().then((started) => { if (started) setComposerOpen(false); })}>{busy ? t("Encolando…") : t("Iniciar investigación")}</button></div>
      </div></div>}
      {toast && <div role="status" className="fixed bottom-5 right-5 z-50 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm shadow-lg">{toast}<button className="ml-3 text-neutral-500" onClick={() => setToast(null)} aria-label={t("Cerrar")}><Icon name="x" size={14} /></button></div>}
    </div>
  );

}
