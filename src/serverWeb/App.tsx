import { useEditorialShellFocus } from "../components/workspace/editorialFocus";
import {
  lazy,
  Suspense,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  normalizeVaultType,
  VAULT_TYPE_COLORS,
  type VaultType,
} from "@shared/vaultTypes";
import type { AppLanguage } from "@shared/types";
import type { StellarWorkspaceSnapshot } from "../stellarGraph/snapshot";
import {
  dedicatedVaultNavIds,
  groupedNav,
  navItemLabel,
  NAV_ITEMS,
  scriptorViewForVault,
  type NavItem,
  type View,
} from "../navigation";
import { HoverLabelButton, Icon } from "../components/ui";
import { APP_THEME_DEFINITIONS_STORAGE_KEY, APP_THEME_STORAGE_KEY, applyAppTheme as applyRuntimeAppTheme, applyVaultAccent, isBuiltInTheme } from "../theme/themeBoot";
import { vaultTypeIcon, vaultTypeLabel } from "../components/vaultTypeUi";
import { WorldbuildingSidebar } from "../components/WorldbuildingSidebar";
import { ProsopographySidebar } from "../components/ProsopographySidebar";
import { TestimonySidebar } from "../components/TestimonySidebar";
import { PrimarySourcesSidebar } from "../components/PrimarySourcesSidebar";
import { StudySidebar } from "../components/StudySidebar";
import { TeachingSidebar } from "../components/TeachingSidebar";
import nodusLogo from "../assets/nodus-logo.svg";
import nodusLogoGold from "../assets/nodus-logo-gold.svg";
import nodusLogoCrimson from "../assets/nodus-logo-crimson.svg";
import nodusLogoTeal from "../assets/nodus-logo-teal.svg";
import nodusLogoOrange from "../assets/nodus-logo-orange.svg";
import nodusLogoViolet from "../assets/nodus-logo-violet.svg";
import nodusLogoCyan from "../assets/nodus-logo-cyan.svg";
import { NodusHeaderLogo } from "../components/NodusHeaderLogo";
import { api, ApiError } from "./api";
import { flushServerEditors } from "./editorNavigation";
import {
  ConversationServerView,
  DeepResearchServerView,
  DictionaryServerView,
  PrivateNotesServerView,
} from "./PersonalViews";
import { StateOfArtServerView } from "./StateOfArtServerView";
import { DatabaseAnalysisServerView } from "./DatabaseAnalysisServerView";
import { DatabaseDeepResearchServerView } from "./DatabaseDeepResearchServerView";
import { SearchServerView } from "./academic/SearchServerView";
import {
  AcademicDetailExplorer,
  type AcademicTarget,
} from "./academic/AcademicDetailExplorer";
import { ServerSettingsView, type TabId } from "./settings";
import { blankProfile } from "./settings/ServerSettingsView";
import { ToolsServerView } from "./ToolsServerView";
import { ServerVaultManager, surfaceForView, VaultSurfaceView } from "./vaults";
import { NativeContentAuthoring } from "./vaults/NativeContentAuthoring";
import { AcademicToolsServerView } from "./AcademicToolsServerView";
import {
  LibraryDetail as ServerLibraryDetail,
  PublishedLibraryView as ServerPublishedLibraryView,
} from "./LibraryServerView";
import { PrimarySourcesMapView } from "../views/PrimarySourcesMapView";
import { PrimarySourcesTimelineView } from "../views/PrimarySourcesTimelineView";
import { PrimarySourcesRelationsView } from "../views/PrimarySourcesRelationsView";
import { PrimarySourcesPersonsView } from "../views/PrimarySourcesPersonsView";
import { PrimarySourcesSearchView } from "../views/PrimarySourcesSearchView";
import { PrimarySourcesArchiveServerView } from "./PrimarySourcesArchiveServerView";
import type {
  PrimarySourceMapWorkspace,
  PrimarySourceRelationsWorkspace,
  PrimarySourceSearchRequest,
  PrimarySourceSearchResponse,
  PrimarySourceTimelineWorkspace,
  PrimarySourcePersonDossier,
  PrimarySourcePersonFilter,
  PrimarySourcePersonSummary,
} from "@shared/primarySourcesTypes";
import type {
  JsonRecord,
  MeResponse,
  PageResponse,
  PortableProfileValues,
  Space,
  SpaceSummary,
} from "./types";
import { placeHeaderBadge, type HeaderBadgePlacement } from "../headerLayout";
import { errorText, getActiveLang, setActiveLang, t } from "./i18nShim";

type ServerView = View | "assistant" | "nodi";
type Route =
  | { kind: "view"; view: ServerView }
  | { kind: "detail"; view: View; collection: string; id: string }
  | { kind: "library-detail"; view: "library"; id: string };

type CollectionMeta = { collection: string; label: string; icon: string };

const IdeasServerView = lazy(() =>
  import("./advanced").then((module) => ({ default: module.IdeasServerView })),
);
const AuthorsServerView = lazy(() =>
  import("./advanced").then((module) => ({
    default: module.AuthorsServerView,
  })),
);
const GraphServerView = lazy(() =>
  import("./advanced").then((module) => ({ default: module.GraphServerView })),
);

const VIEW_COLLECTIONS: Partial<Record<View, CollectionMeta>> = {
  ideas: { collection: "ideas", label: "Ideas", icon: "bulb" },
  argument: {
    collection: "ideas",
    label: "Mapa de argumentos",
    icon: "layers",
  },
  authors: { collection: "authors", label: "Autores", icon: "graduation" },
  research: {
    collection: "themes",
    label: "Estado de la cuestión",
    icon: "strata",
  },
  hypothesis: { collection: "gaps", label: "Hipótesis", icon: "flask" },
  persons: { collection: "persons", label: "Personas", icon: "users" },
  characters: { collection: "persons", label: "Personajes", icon: "users" },
  prosopPersons: { collection: "persons", label: "Personas", icon: "user" },
  // Participant identities are deliberately not part of the testimony
  // publication contract. Keep the Desktop tab routable without aliasing it to
  // the public persons collection (which would leak genealogy/prosopography
  // records when a testimony vault is selected).
  testimonyParticipants: {
    collection: "testimony-participants",
    label: "Participantes",
    icon: "users",
  },
  places: { collection: "places", label: "Lugares", icon: "map" },
  map: { collection: "places", label: "Mapa", icon: "map" },
  timeline: { collection: "events", label: "Línea temporal", icon: "clock" },
  relations: {
    collection: "relationships",
    label: "Relaciones sociales",
    icon: "link",
  },
  tree: {
    collection: "relationships",
    label: "Árbol genealógico",
    icon: "tree",
  },
  factions: { collection: "world-groups", label: "Facciones", icon: "network" },
  cultures: {
    collection: "world-groups",
    label: "Culturas",
    icon: "languages",
  },
  dynasties: { collection: "world-groups", label: "Dinastías", icon: "shield" },
  scenes: { collection: "world-scenes", label: "Escenas", icon: "image" },
  manuscript: { collection: "world-scenes", label: "Manuscrito", icon: "edit" },
  encyclopedia: {
    collection: "world-articles",
    label: "Enciclopedia",
    icon: "book",
  },
  arcs: {
    collection: "world-threads",
    label: "Arcos narrativos",
    icon: "route",
  },
  continuity: {
    collection: "world-threads",
    label: "Continuidad",
    icon: "check",
  },
  conflicts: {
    collection: "world-threads",
    label: "Conflictos",
    icon: "scale",
  },
  rules: { collection: "world-rules", label: "Reglas del mundo", icon: "lock" },
  questions: {
    collection: "world-questions",
    label: "Preguntas abiertas",
    icon: "help",
  },
  studyCourses: {
    collection: "study-courses",
    label: "Cursos y asignaturas",
    icon: "graduation",
  },
  studyLibrary: {
    collection: "study-materials",
    label: "Materiales de estudio",
    icon: "book",
  },
  studyRecordings: {
    collection: "study-materials",
    label: "Grabaciones",
    icon: "microphone",
  },
  studySchedule: {
    collection: "study-plans",
    label: "Horarios",
    icon: "clock",
  },
  studyCalendar: {
    collection: "study-plans",
    label: "Calendario",
    icon: "calendar",
  },
  studyReview: {
    collection: "study-plans",
    label: "Revisión",
    icon: "flashcards",
  },
  studyQuestions: {
    collection: "study-questions",
    label: "Banco de preguntas",
    icon: "help",
  },
  studyIdeas: {
    collection: "study-questions",
    label: "Ideas de estudio",
    icon: "bulb",
  },
  studyGraph: {
    collection: "study-questions",
    label: "Grafo de estudio",
    icon: "network",
  },
  teachingGroups: {
    collection: "study-courses",
    label: "Grupos",
    icon: "users",
  },
  teachingExams: {
    collection: "teaching-exams",
    label: "Exámenes",
    icon: "notebook",
  },
  teachingRubrics: {
    collection: "teaching-rubrics",
    label: "Rúbricas",
    icon: "table",
  },
  teachingGrades: {
    collection: "teaching-rubrics",
    label: "Calificaciones",
    icon: "chartBar",
  },
  teachingUnits: {
    collection: "teaching-exams",
    label: "Diseño de unidades",
    icon: "compass",
  },
  archive: { collection: "archive-items", label: "Archivo", icon: "archive" },
  prosopSources: {
    collection: "archive-items",
    label: "Fuentes",
    icon: "archive",
  },
  testimonyInterviews: {
    collection: "testimony-interviews",
    label: "Entrevistas",
    icon: "microphone",
  },
  testimonyContrasts: {
    collection: "testimony-contrasts",
    label: "Contrastes",
    icon: "scale",
  },
  pages: { collection: "database-pages", label: "Páginas", icon: "notebook" },
  databases: {
    collection: "databases",
    label: "Bases de datos",
    icon: "table",
  },
  dbAnalysis: { collection: "databases", label: "Análisis", icon: "chartBar" },
};

const STANDARD_VIEW_IDS: View[] = [
  "search",
  "library",
  "graph",
  "argument",
  "ideas",
  "authors",
  "dictionary",
  "immersion",
  "research",
  "hypothesis",
  "reading",
  "deepResearch",
  "workspace",
];

const GENEALOGY_VIEW_IDS: View[] = [
  "search",
  "library",
  "persons",
  "timeline",
  "tree",
  "relations",
  "map",
  "archive",
  "deepResearch",
  "notes",
];

const SERVER_TOOL_VIEWS = new Set<View>([
  "studyFocus", // Timer and per-vault focus history are desktop-only.
  "browser",
  "radar",
  "compass",
]);
const ACTIVE_VAULT_STORAGE_KEY = "nodus-server-active-vault";
const SERVER_NAV_COLLAPSED_STORAGE_KEY = "nodus-server-nav-collapsed";
const SERVER_COLLAPSED_GROUPS_STORAGE_KEY = "nodus-server-collapsed-groups";
// The header brand row -- logo, "Nodus Server" and the BETA tag -- measures 138px,
// and the pinned chevron reserves 24px more on the right. At the old 176px default
// that left 6px of slack and the row read as flush against both edges.
const SERVER_SIDEBAR_DEFAULT_WIDTH = 200;
const SERVER_SIDEBAR_MIN_WIDTH = 64;
const SERVER_SIDEBAR_MAX_WIDTH = 360;
// Desktop switches to icon-only navigation at this width. Keep the same
// threshold in the web shell so a resized sidebar never has a half-clipped
// label state that Desktop cannot produce.
const SERVER_SIDEBAR_COMPACT_THRESHOLD = 144;

function routeFromLocation(): Route {
  // `/app` remains a compatibility alias for bookmarks created by older Server
  // versions. New navigation is rooted at `/`, which is the canonical web app.
  const parts = window.location.pathname
    .replace(/^\/app(?:\/|$)/, "/")
    .split("/")
    .filter(Boolean);
  if (parts[0] === "detail" && parts[1] && parts[2] && parts[3]) {
    return {
      kind: "detail",
      view: parts[1] as View,
      collection: decodeURIComponent(parts[2]),
      id: decodeURIComponent(parts[3]),
    };
  }
  if (parts[0] === "library" && parts[1])
    return {
      kind: "library-detail",
      view: "library",
      id: decodeURIComponent(parts[1]),
    };
  if (parts[0] === "view" && parts[1]) {
    const requested = parts[1] as ServerView;
    return {
      kind: "view",
      view:
        requested === "writing" || requested === "projects"
          ? "workspace"
          : requested,
    };
  }
  if (parts[0] === "search") return { kind: "view", view: "search" };
  if (parts[0] === "library") return { kind: "view", view: "library" };
  return { kind: "view", view: "home" };
}

async function navigate(path: string) {
  if (!await flushServerEditors()) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function viewPath(view: ServerView): string {
  const canonical =
    view === "writing" || view === "projects" ? "workspace" : view;
  return canonical === "home" ? "/" : `/view/${canonical}`;
}

function text(value: unknown, fallback = "Sin título"): string {
  if (value === null || value === undefined || value === "") return t(fallback);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return JSON.stringify(value);
}

function titleFor(row: JsonRecord): string {
  return text(
    row.title ??
      row.label ??
      row.name ??
      row.full_name ??
      row.display_name ??
      row.subject ??
      row.id,
  );
}

function recordId(row: JsonRecord, fallback: string): string {
  const preferred =
    row.id ??
    row.nodus_id ??
    row.global_id ??
    row.person_id ??
    row.author_id ??
    row.theme_id ??
    row.event_id ??
    row.place_id ??
    row.group_id ??
    row.article_id ??
    row.scene_id ??
    row.rule_id ??
    row.question_id ??
    row.interview_id ??
    row.database_id;
  if (preferred !== null && preferred !== undefined && preferred !== "")
    return String(preferred);
  const discovered = Object.entries(row).find(
    ([key, value]) =>
      /(?:^id$|_id$)/.test(key) &&
      (typeof value === "string" || typeof value === "number"),
  )?.[1];
  return discovered === undefined ? fallback : String(discovered);
}

function pageItems(page: PageResponse | undefined): JsonRecord[] {
  if (!page) return [];
  if (Array.isArray(page.items)) return page.items;
  const firstArray = Object.values(page).find(Array.isArray);
  return Array.isArray(firstArray) ? (firstArray as JsonRecord[]) : [];
}

function logoFor(type: VaultType): string {
  if (type === "genealogy") return nodusLogoGold;
  if (type === "databases") return nodusLogoCrimson;
  if (type === "estudio") return nodusLogoTeal;
  if (type === "docencia") return nodusLogoOrange;
  if (type === "worldbuilding") return nodusLogoViolet;
  if (type === "testimonios") return nodusLogoCyan;
  return nodusLogo;
}

function visibleNav(type: VaultType): NavItem[] {
  const dedicated = dedicatedVaultNavIds(type);
  const allowed = new Set<View>(
    dedicated ??
      (type === "genealogy" ? GENEALOGY_VIEW_IDS : STANDARD_VIEW_IDS),
  );
  allowed.add('toolkit');
  return NAV_ITEMS.filter(
    (item) =>
      !SERVER_TOOL_VIEWS.has(item.id) &&
      (item.id === "home" || item.id === "settings" || allowed.has(item.id)),
  );
}

/** Map a published search collection back to the Desktop surface that owns it.
 * Search is global, but its result must never land on the academic detail renderer
 * for a genealogy, study, worldbuilding or database row. */
function searchDetailView(collection: string, type: VaultType): View | null {
  const key = collection.toLowerCase();
  if (key === "persons" || key === "character_profiles") {
    if (type === "prosopography") return "prosopPersons";
    if (type === "testimonios") return "testimonyParticipants";
    return "persons";
  }
  if (key === "places") return "places";
  if (key === "events") return "timeline";
  if (key === "relationships") return "relations";
  if (key.startsWith("world_groups") || key === "world-groups")
    return "factions";
  if (key.startsWith("world_scenes") || key === "world-scenes") return "scenes";
  if (key.startsWith("world_articles") || key === "world-articles")
    return "encyclopedia";
  if (key.startsWith("world_threads") || key === "world-threads") return "arcs";
  if (key.startsWith("world_rules") || key === "world-rules") return "rules";
  if (key.startsWith("world_questions") || key === "world-questions")
    return "questions";
  if (key === "study_courses" || key === "study-courses") return "studyCourses";
  if (key === "study_materials" || key === "study-materials")
    return "studyLibrary";
  if (key === "study_questions" || key === "study-questions")
    return "studyQuestions";
  if (key === "study_ideas" || key === "study-ideas") return "studyIdeas";
  if (key === "teaching_exams" || key === "teaching-exams")
    return "teachingExams";
  if (key === "teaching_rubrics" || key === "teaching-rubrics")
    return "teachingRubrics";
  if (key === "archive_items" || key === "archive-items")
    return type === "prosopography" ? "prosopSources" : "archive";
  if (
    [
      "archive_repositories",
      "archive-repositories",
      "archive_description_units",
      "archive-units",
      "archive_excerpts",
      "archive-excerpts",
      "archive_source_analyses",
      "source-analyses",
    ].includes(key)
  )
    return type === "prosopography" ? "prosopSources" : "archive";
  if (key === "testimony_interviews" || key === "testimony-interviews")
    return "testimonyInterviews";
  if (
    [
      "testimony_transcripts",
      "testimony-transcripts",
      "testimony_codes",
      "testimony-codes",
    ].includes(key)
  )
    return "testimonyInterviews";
  if (key === "testimony_contrasts" || key === "testimony-contrasts")
    return "testimonyContrasts";
  if (key === "db_databases" || key === "databases") return "databases";
  if (key === "pages" || key === "database-pages") return "pages";
  return null;
}

function Loading() {
  return (
    <div
      className="flex h-full items-center justify-center gap-2 text-sm text-neutral-500"
      role="status"
      data-testid="loading"
    >
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-700 border-t-indigo-400" />
      {t("Cargando…")}
    </div>
  );
}

/** Keep the Server action rail identical to Desktop: an icon by default, with a
 * discoverable label on hover/focus. The label remains in the accessibility tree. */
function ServerHeaderAction({
  icon,
  label,
  title,
  onClick,
  className = "",
  showLabel = false,
  dataTestId,
}: {
  icon: string;
  label: string;
  title?: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  showLabel?: boolean;
  dataTestId?: string;
}) {
  return (
    <HoverLabelButton
      icon={icon}
      label={label}
      title={title}
      onClick={onClick}
      showLabel={showLabel}
      data-testid={dataTestId}
      className={`server-header-action btn-ghost h-9 min-h-9 min-w-9 ${className}`}
    />
  );
}

/** Exact Desktop Home intro markup, kept local so the Server bundle does not pull
 * the native-only Home data pipeline and its privileged bridge dependencies. */
function HomeIntroCard({
  eyebrow,
  title,
  description,
  icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <header className="server-home-intro rounded-2xl border border-indigo-800/60 bg-indigo-950/25 p-6">
      <div className="mb-2 flex items-center gap-2 text-indigo-300">
        <Icon name={icon} size={20} />
        <span className="text-xs font-semibold uppercase tracking-[0.2em]">
          {eyebrow}
        </span>
      </div>
      <h1 className="text-2xl font-semibold text-neutral-100">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
        {description}
      </p>
    </header>
  );
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="server-unavailable" data-testid="empty-state">
      <div>
        <Icon name="inbox" size={32} className="mx-auto text-neutral-600" />
        <h2 className="mt-3 text-lg font-semibold text-neutral-200">{title}</h2>
        {detail && (
          <p className="mt-2 text-sm leading-6 text-neutral-500">{detail}</p>
        )}
      </div>
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const expired = error instanceof ApiError && error.status === 401;
  return (
    <div
      className="m-6 rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-300"
      role="alert"
      data-testid="error-state"
    >
      <strong>
        {t(
          expired
            ? "La sesión ha caducado."
            : "No se ha podido cargar esta vista.",
        )}
      </strong>
      <p className="mt-1 opacity-80">
        {errorText(error)}
      </p>
      {expired ? (
        <a
          href={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
          className="btn mt-3"
        >
          {t("Iniciar sesión")}
        </a>
      ) : (
        onRetry && (
          <button className="btn btn-ghost mt-3" onClick={onRetry}>
            {t("Reintentar")}
          </button>
        )
      )}
    </div>
  );
}

function PublishedWorldHome({
  active,
  summary: _summary,
  onOpen,
}: {
  active: Space;
  summary: SpaceSummary;
  onOpen: (view: View) => void;
}) {
  const native =
    active.storageKind === "server_native" || active.authorityMode === "server";
  const [entries, setEntries] = useState<JsonRecord[]>([]);
  const [people, setPeople] = useState<JsonRecord[]>([]);
  useEffect(() => {
    let mounted = true;
    const load =
      active.storageKind === "server_native" ||
      active.authorityMode === "server"
        ? Promise.all([
            api.nativeContentList(active.id, "world_articles", {
              limit: "200",
            }),
            api.nativeContentList(active.id, "persons", { limit: "200" }),
          ]).then(
            ([entryPage, peoplePage]) =>
              [entryPage.rows, peoplePage.rows] as const,
          )
        : Promise.all([
            api.collection(active.id, "world-entries", { limit: "200" }),
            api.collection(active.id, "persons", { limit: "200" }),
          ]).then(
            ([entryPage, peoplePage]) =>
              [pageItems(entryPage), pageItems(peoplePage)] as const,
          );
    void load
      .then(([nextEntries, nextPeople]) => {
        if (!mounted) return;
        setEntries(nextEntries);
        setPeople(nextPeople);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [active.authorityMode, active.id, active.storageKind]);
  const profiles = new Map(
    people.map((person) => [String(person.person_id), person]),
  );
  const protagonists = people.filter(
    (person) =>
      String(
        profiles.get(String(person.person_id))?.narrative_role ??
          person.narrative_role ??
          "",
      ) === "protagonist",
  ).length;
  const alive = people.filter(
    (person) => String(person.life_status ?? person.status ?? "") === "alive",
  ).length;
  const recent = [...people]
    .sort((a, b) =>
      String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")),
    )
    .slice(0, 6);
  return (
    <div
      className="h-full overflow-y-auto p-6 server-view-padding"
      data-testid="worldbuilding-overview"
    >
      <div className="mx-auto max-w-5xl">
        <HomeIntroCard
          eyebrow={`${t("Vault de worldbuilding")} · ${t(native ? "Nativo del servidor" : "Publicado")}`}
          title={active.name}
          description={
            active.description ||
            t(
              native
                ? "Crea y organiza personajes, lugares y lore directamente en Nodus Server."
                : "Personajes, lugares y lore del mundo publicados para consulta.",
            )
          }
          icon="globe"
        />
        <div
          className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"
          data-testid="overview-metrics"
        >
          <Metric
            label={t("Personajes")}
            value={people.length}
            onClick={() => onOpen("characters")}
          />
          <Metric
            label={t("Protagonistas")}
            value={protagonists}
            onClick={() => onOpen("characters")}
          />
          <Metric
            label={t("Con vida")}
            value={alive}
            onClick={() => onOpen("characters")}
          />
          <Metric
            label={t("En la enciclopedia")}
            value={entries.length}
            onClick={() => onOpen("encyclopedia")}
          />
        </div>
        <section className="mt-6 rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/40">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <h2 className="text-sm font-semibold">
              {t("Personajes recientes")}
            </h2>
            <button
              className="text-xs text-indigo-400"
              onClick={() => onOpen("characters")}
            >
              {t("Ver todos")}
            </button>
          </div>
          {recent.length ? (
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {recent.map((person) => (
                <button
                  key={String(person.person_id)}
                  className="rounded-lg border border-neutral-200 p-3 text-left hover:border-indigo-300 dark:border-neutral-800"
                  onClick={() => onOpen("characters")}
                >
                  <strong className="block truncate text-sm">
                    {text(person.display_name ?? person.name, "Personaje")}
                  </strong>
                  <span className="mt-1 block line-clamp-2 text-xs text-neutral-500">
                    {text(
                      person.biography ?? person.notes,
                      native ? "Personaje del servidor" : "Personaje publicado",
                    )}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="p-6 text-center text-xs text-neutral-500">
              {t("Todavía no hay personajes.")}
              {native ? ` ${t("Crea el primero desde Personajes.")}` : ""}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function PublishedGenealogyHome({
  active,
  summary,
  onOpen,
}: {
  active: Space;
  summary: SpaceSummary;
  onOpen: (view: View) => void;
}) {
  const native =
    active.storageKind === "server_native" || active.authorityMode === "server";
  const counts = summary.counts || active.counts || {};
  const tile = (label: string, value: unknown, view: View, icon: string) => (
    <button
      className="server-record-card flex items-center gap-3"
      onClick={() => onOpen(view)}
    >
      <span className="server-record-icon">
        <Icon name={icon} />
      </span>
      <span>
        <strong className="block text-lg">
          {Number(value || 0).toLocaleString()}
        </strong>
        <small className="text-xs text-neutral-500">{t(label)}</small>
      </span>
    </button>
  );
  return (
    <div
      className="h-full overflow-y-auto p-6 server-view-padding"
      data-testid="genealogy-overview"
    >
      <div className="mx-auto max-w-5xl">
        <HomeIntroCard
          eyebrow={`${t("Vault de genealogía")} · ${t(native ? "Nativo del servidor" : "Publicado")}`}
          title={active.name}
          description={
            active.description ||
            t(
              native
                ? "Construye personas, parentescos, acontecimientos y lugares directamente en Server."
                : "Personas, parentescos, acontecimientos y lugares publicados para consulta.",
            )
          }
          icon="tree"
        />
        <div
          className="mt-5 grid gap-3 sm:grid-cols-4"
          data-testid="overview-metrics"
        >
          {tile("Personas", counts.persons, "persons", "users")}
          {tile("Vínculos de parentesco", counts.relationships, "tree", "tree")}
          {tile("Eventos", counts.events, "timeline", "clock")}
          {tile("Lugares", counts.places, "map", "map")}
        </div>
        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          {tile(
            native ? "Documentos" : "Documentos publicados",
            summary.assets,
            "archive",
            "archive",
          )}
          <article className="server-record-card flex items-center gap-3">
            <span className="server-record-icon">
              <Icon name="lock" />
            </span>
            <span>
              <strong className="block text-sm">
                {t("Sugerencias de parentesco")}
              </strong>
              <small className="text-xs text-neutral-500">
                {t("Privadas de la cuenta")}
              </small>
            </span>
          </article>
        </section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded-lg border border-neutral-800 px-3 py-3 text-left hover:border-indigo-700"
      onClick={onClick}
    >
      <div className="text-xl font-semibold tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="truncate text-xs text-neutral-500">{label}</div>
    </button>
  );
}

function Sidebar({
  type,
  activeView,
  compact,
  collapsedGroups,
  sidebarOrder,
  sidebarHidden,
  onToggleGroup,
  onNavigate,
}: {
  type: VaultType;
  activeView: View;
  compact: boolean;
  collapsedGroups: Set<string>;
  sidebarOrder: string[];
  sidebarHidden: string[];
  onToggleGroup: (id: string) => void;
  onNavigate: (view: View) => void;
}) {
  const items = visibleNav(type);
  const home = items.find((item) => item.id === "home")!;
  const settings = items.find((item) => item.id === "settings")!;
  const allowed = new Set(items.map((item) => item.id));
  const groups = groupedNav(sidebarOrder, [
    "library",
    ...sidebarHidden,
    ...NAV_ITEMS.filter((item) => !allowed.has(item.id)).map((item) => item.id),
    ...SERVER_TOOL_VIEWS,
  ]);
  const button = (item: NavItem) => {
    const active = activeView === item.id || (['workspace','notes'].includes(activeView) && ['workspace','notes'].includes(item.id));
    const label = t(navItemLabel(item, type));
    return (
      <button
        key={item.id}
        data-tour={`nav-${item.id}`}
        data-testid={`nav-${item.id}`}
        onClick={() => onNavigate(item.id)}
        aria-current={active ? "page" : undefined}
        aria-label={compact ? label : undefined}
        title={compact ? label : undefined}
        className={`server-sidebar-nav-item flex items-center rounded-lg py-2 text-left text-sm transition-colors ${compact ? "justify-center px-2" : "gap-2 px-3"} ${active ? "is-active bg-indigo-600 text-white" : "text-neutral-400 hover:bg-neutral-900"}`}
      >
        <Icon name={item.icon} className="shrink-0 opacity-70" />
        <span className={compact ? "sr-only" : undefined}>{label}</span>
      </button>
    );
  };
  const canonicalHome = NAV_ITEMS.find((item) => item.id === "home")!;
  const canonicalLibrary = NAV_ITEMS.find((item) => item.id === "library")!;
  const canonicalSettings = NAV_ITEMS.find((item) => item.id === "settings")!;
  const renderGroups = (selected: typeof groups) =>
    selected.map((group) => {
      const collapsed = !compact && collapsedGroups.has(group.id);
      const active = group.items.some((item) => item.id === activeView);
      return (
        <div
          key={group.id}
          className={`${compact ? "mt-1 border-t border-neutral-800/70 pt-1" : "mt-2"} flex flex-col gap-1`}
        >
          {!compact && (
            <button
              className={`server-sidebar-nav-group flex items-center gap-1 px-3 pt-1 pb-0.5 text-left text-[10px] font-semibold uppercase tracking-wider ${active && collapsed ? "text-indigo-400" : "text-neutral-600 hover:text-neutral-400"}`}
              aria-expanded={!collapsed}
              aria-label={`${t(collapsed ? "Mostrar" : "Ocultar")} ${t("grupo")} ${t(group.label)}`}
              onClick={() => onToggleGroup(group.id)}
            >
              <Icon
                name="chevronRight"
                size={11}
                className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
              />
              {t(group.label)}
            </button>
          )}
          {!collapsed && group.items.map(button)}
        </div>
      );
    });
  const specialized =
    type === "worldbuilding" ? (
      <WorldbuildingSidebar
        compact={compact}
        activeView={activeView}
        sidebarOrder={sidebarOrder}
        sidebarHidden={[...sidebarHidden, ...SERVER_TOOL_VIEWS]}
        onNavigate={(view) => onNavigate(view)}
      />
    ) : type === "prosopography" ? (
      <ProsopographySidebar
        compact={compact}
        activeView={activeView}
        sidebarOrder={sidebarOrder}
        sidebarHidden={[...sidebarHidden, ...SERVER_TOOL_VIEWS]}
        onNavigate={(view) => onNavigate(view)}
      />
    ) : type === "testimonios" ? (
      <TestimonySidebar
        compact={compact}
        activeView={activeView}
        sidebarOrder={sidebarOrder}
        sidebarHidden={[...sidebarHidden, ...SERVER_TOOL_VIEWS]}
        onNavigate={(view) => onNavigate(view)}
      />
    ) : type === "primary_sources" ? (
      <PrimarySourcesSidebar
        compact={compact}
        activeView={activeView}
        sidebarOrder={sidebarOrder}
        sidebarHidden={[...sidebarHidden, ...SERVER_TOOL_VIEWS]}
        onNavigate={(view) => onNavigate(view)}
      />
    ) : type === "estudio" ? (
      <StudySidebar
        compact={compact}
        activeView={activeView}
        sidebarOrder={sidebarOrder}
        sidebarHidden={[...sidebarHidden, ...SERVER_TOOL_VIEWS]}
        onNavigate={(view) => onNavigate(view)}
      />
    ) : type === "docencia" ? (
      <TeachingSidebar
        compact={compact}
        activeView={activeView}
        sidebarOrder={sidebarOrder}
        sidebarHidden={[...sidebarHidden, ...SERVER_TOOL_VIEWS]}
        onNavigate={(view) => onNavigate(view)}
      />
    ) : null;
  if (specialized) {
    const remaining =
      type === "estudio"
        ? groups.filter(
            (group) => group.id !== "explore" && group.id !== "tools",
          )
        : [];
    return (
      <div className="vault-sidebar-scroll mr-[6px] flex h-full min-h-0 flex-col gap-1 overflow-y-auto p-2">
        {button(canonicalHome)}
        {button(canonicalLibrary)}
        {specialized}
        {renderGroups(remaining)}
        {renderGroups(groups.filter(group => group.id === 'tools'))}
        <div className="mt-auto border-t border-neutral-800/70 pt-2">
          {button(canonicalSettings)}
        </div>
      </div>
    );
  }
  return (
    <div className="vault-sidebar-scroll mr-[6px] flex h-full min-h-0 flex-col gap-1 overflow-y-auto p-2">
      {button(home)}
      {allowed.has("library") && button(canonicalLibrary)}
      {renderGroups(groups)}
      <div className="mt-auto border-t border-neutral-800/70 pt-2">
        {button(settings)}
      </div>
    </div>
  );
}

const VAULT_HOME_METRICS: Record<string, Array<[string, string]>> = {
  genealogy: [
    ["persons", "Personas"],
    ["places", "Lugares"],
    ["events", "Eventos"],
    ["relationships", "Relaciones"],
  ],
  prosopography: [],
  primary_sources: [
    ["archive_items", "Fuentes"],
    ["archive_description_units", "Unidades"],
    ["archive_excerpts", "Extractos"],
    ["archive_source_analyses", "Análisis"],
  ],
  testimonios: [
    ["testimony_interviews", "Entrevistas"],
    ["testimony_transcripts", "Transcripciones"],
    ["testimony_codes", "Códigos"],
    ["testimony_contrasts", "Contrastes"],
  ],
  databases: [
    ["db_databases", "Bases de datos"],
    ["db_rows", "Registros"],
    ["db_views", "Vistas"],
    ["db_cells", "Valores"],
  ],
  estudio: [
    ["study_courses", "Cursos"],
    ["study_materials", "Materiales"],
    ["study_calendar_events", "Eventos"],
    ["study_questions", "Preguntas"],
  ],
  docencia: [
    ["teaching_exams", "Exámenes"],
    ["teaching_rubrics", "Rúbricas"],
    ["study_courses", "Cursos"],
    ["study_materials", "Materiales"],
  ],
  worldbuilding: [
    ["persons", "Personas"],
    ["places", "Lugares"],
    ["world_groups", "Grupos"],
    ["world_scenes", "Escenas"],
  ],
};

function Home({
  active,
  summary,
  onOpen,
  onRefresh,
}: {
  active: Space;
  summary: SpaceSummary;
  onOpen: (view: View) => void;
  onRefresh?: () => Promise<void>;
}) {
  const type = normalizeVaultType(active.vaultType || active.vault?.type);
  const native =
    active.storageKind === "server_native" || active.authorityMode === "server";
  if (type === "worldbuilding")
    return (
      <PublishedWorldHome active={active} summary={summary} onOpen={onOpen} />
    );
  if (type === "genealogy")
    return (
      <PublishedGenealogyHome
        active={active}
        summary={summary}
        onOpen={onOpen}
      />
    );
  const counts = summary.counts || active.counts || {};
  const cards = visibleNav(type)
    .filter((item) => item.group === "explore")
    .slice(0, 6);
  const configured =
    type === "academic"
      ? [
          ["works", "Obras"],
          ["authors", "Autores"],
          ["ideas", "Ideas"],
          ["themes", "Temas"],
        ]
      : VAULT_HOME_METRICS[type] || [];
  const metrics = configured
    .filter(([key]) => counts[key] !== undefined)
    .map(([key, label]) => [t(label), counts[key]] as const);
  return (
    <div
      className="h-full overflow-y-auto p-6 server-view-padding"
      data-testid="overview-view"
    >
      <div className="mx-auto max-w-5xl">
        <div className="relative">
          <HomeIntroCard
            eyebrow={`${t(vaultTypeLabel(type))} · ${t(native ? "Nativo del servidor" : "Publicado")}`}
            title={active.name}
            description={
              active.description ||
              t(
                native
                  ? "Trabaja directamente en esta bóveda sin depender de Nodus Desktop."
                  : "Consulta el conocimiento publicado con el mismo espacio de trabajo de Nodus Desktop.",
              )
            }
            icon={vaultTypeIcon(type)}
          />
          {onRefresh && (
            <button
              className="btn btn-ghost absolute right-4 top-4 gap-1.5 text-xs"
              onClick={() => void onRefresh()}
              data-testid="overview-refresh"
            >
              <Icon name="sync" size={13} />
              {t("Actualizar")}
            </button>
          )}
        </div>
        <div
          className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"
          data-testid="overview-metrics"
        >
          {metrics.map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-neutral-800 px-3 py-2"
            >
              <div className="truncate text-xs text-neutral-500">{label}</div>
              <div className="text-lg font-semibold tabular-nums">
                {Number(value).toLocaleString()}
              </div>
            </div>
          ))}
          {metrics.length === 0 && (
            <div className="rounded-lg border border-neutral-800 px-3 py-2">
              <div className="text-xs text-neutral-500">
                {t(type === "prosopography" ? "Datos privados" : "Recursos")}
              </div>
              <div className="text-lg font-semibold">
                {type === "prosopography" ? "—" : summary.assets || 0}
              </div>
            </div>
          )}
        </div>
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-neutral-300">
                {t("Explorar la bóveda")}
              </div>
              <p className="mt-1 text-xs text-neutral-600">
                {t("Las mismas secciones y jerarquía que en Desktop.")}
              </p>
            </div>
            <span className="rounded-full border border-teal-800/60 bg-teal-950/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-teal-300">
              {t(native ? "Editable" : "Solo lectura")}
            </span>
          </div>
          <div className="server-record-grid">
            {cards.map((item) => (
              <button
                key={item.id}
                className="server-record-card flex items-center gap-3"
                onClick={() => onOpen(item.id)}
                data-testid={`overview-card-${item.id}`}
              >
                <span className="server-record-icon">
                  <Icon name={item.icon} />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm text-neutral-200">
                    {t(item.label)}
                  </strong>
                  <small className="block truncate text-xs text-neutral-600">
                    {t(native ? "Abrir sección" : "Abrir sección publicada")}
                  </small>
                </span>
                <Icon
                  name="chevronRight"
                  size={14}
                  className="text-neutral-700"
                />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ViewFrame({
  eyebrow,
  title,
  description,
  icon,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto p-6 server-view-padding">
      <div className="mx-auto max-w-5xl">
        <HomeIntroCard
          eyebrow={eyebrow}
          title={title}
          description={description}
          icon={icon}
        />
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

type ServerTableColumn = { key: string; label: string; width?: string };

const COLLECTION_TABLE_COLUMNS: Partial<Record<View, ServerTableColumn[]>> = {
  argument: [
    { key: "label", label: "Idea" },
    { key: "type", label: "Tipo", width: "8rem" },
    { key: "statement", label: "Enunciado" },
    { key: "confidence", label: "Confianza", width: "7rem" },
  ],
  research: [
    { key: "label", label: "Tema" },
    { key: "description", label: "Descripción" },
    { key: "idea_count", label: "Ideas", width: "6rem" },
    { key: "updated_at", label: "Actualizado", width: "10rem" },
  ],
  hypothesis: [
    { key: "title", label: "Hipótesis" },
    { key: "description", label: "Descripción" },
    { key: "status", label: "Estado", width: "8rem" },
    { key: "confidence", label: "Confianza", width: "7rem" },
  ],
  persons: [
    { key: "display_name", label: "Nombre" },
    { key: "summary", label: "Resumen" },
    { key: "birth_date", label: "Nacimiento", width: "9rem" },
    { key: "occupation", label: "Ocupación", width: "11rem" },
  ],
  characters: [
    { key: "display_name", label: "Personaje" },
    { key: "summary", label: "Resumen" },
    { key: "role", label: "Rol", width: "9rem" },
    { key: "status", label: "Estado", width: "8rem" },
  ],
  places: [
    { key: "name", label: "Lugar" },
    { key: "description", label: "Descripción" },
    { key: "type", label: "Tipo", width: "9rem" },
    { key: "coordinates", label: "Coordenadas", width: "10rem" },
  ],
  timeline: [
    { key: "title", label: "Evento" },
    { key: "description", label: "Descripción" },
    { key: "start_date", label: "Inicio", width: "9rem" },
    { key: "end_date", label: "Fin", width: "9rem" },
  ],
  relations: [
    { key: "label", label: "Relación" },
    { key: "from_person", label: "Origen" },
    { key: "to_person", label: "Destino" },
    { key: "type", label: "Tipo", width: "9rem" },
  ],
  factions: [
    { key: "name", label: "Facción" },
    { key: "description", label: "Descripción" },
    { key: "type", label: "Tipo", width: "9rem" },
    { key: "status", label: "Estado", width: "8rem" },
  ],
  cultures: [
    { key: "name", label: "Cultura" },
    { key: "description", label: "Descripción" },
    { key: "region", label: "Región", width: "10rem" },
    { key: "status", label: "Estado", width: "8rem" },
  ],
  scenes: [
    { key: "title", label: "Escena" },
    { key: "summary", label: "Resumen" },
    { key: "status", label: "Estado", width: "8rem" },
    { key: "updated_at", label: "Actualizada", width: "10rem" },
  ],
  encyclopedia: [
    { key: "title", label: "Artículo" },
    { key: "summary", label: "Resumen" },
    { key: "category", label: "Categoría", width: "10rem" },
    { key: "updated_at", label: "Actualizado", width: "10rem" },
  ],
  questions: [
    { key: "title", label: "Pregunta" },
    { key: "description", label: "Contexto" },
    { key: "status", label: "Estado", width: "8rem" },
    { key: "priority", label: "Prioridad", width: "8rem" },
  ],
};

function inferredColumns(view: View, items: JsonRecord[]): ServerTableColumn[] {
  const configured = COLLECTION_TABLE_COLUMNS[view];
  if (configured) return configured;
  const preferred = [
    "title",
    "name",
    "label",
    "display_name",
    "description",
    "summary",
    "type",
    "status",
    "updated_at",
  ];
  const keys = [...new Set(items.flatMap((item) => Object.keys(item)))].filter(
    (key) =>
      items.some((item) => item[key] != null && typeof item[key] !== "object"),
  );
  const ordered = [
    ...preferred.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !preferred.includes(key)),
  ].slice(0, 4);
  return ordered.map((key, index) => ({
    key,
    label: key.replace(/_/g, " "),
    width: index > 1 ? "10rem" : undefined,
  }));
}

function CollectionDetailPanel({
  spaceId,
  collection,
  id,
  icon,
}: {
  spaceId: string;
  collection: string;
  id: string;
  icon: string;
}) {
  const [data, setData] = useState<JsonRecord>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    setData(undefined);
    setError(undefined);
    void api.detail(spaceId, collection, id).then(setData).catch(setError);
  }, [collection, id, spaceId]);
  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading />;
  const nested = Object.values(data).find(
    (value) => value && typeof value === "object" && !Array.isArray(value),
  ) as JsonRecord | undefined;
  const item = nested || data;
  return (
    <div className="h-full overflow-auto p-5">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-start gap-3 border-b border-neutral-200 pb-5 dark:border-neutral-800">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name={icon} size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">{titleFor(item)}</h2>
            <p className="mt-1 text-xs text-neutral-500">
              {t("Registro publicado · solo lectura")}
            </p>
          </div>
        </header>
        <dl className="server-desktop-record mt-5">
          {Object.entries(item)
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key, value]) => (
              <div key={key}>
                <dt>{key.replace(/_/g, " ")}</dt>
                <dd>
                  {typeof value === "object" ? (
                    <pre>{JSON.stringify(value, null, 2)}</pre>
                  ) : (
                    text(value)
                  )}
                </dd>
              </div>
            ))}
        </dl>
      </div>
    </div>
  );
}

function CollectionView({ spaceId, view }: { spaceId: string; view: View }) {
  const meta = VIEW_COLLECTIONS[view]!;
  const [page, setPage] = useState<PageResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [query, setQuery] = useState("");
  const [openTabs, setOpenTabs] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setPage(await api.collection(spaceId, meta.collection, { limit: "100" }));
    } catch (next) {
      setError(next);
    } finally {
      setLoading(false);
    }
  }, [spaceId, meta.collection]);
  useEffect(() => {
    void load();
  }, [load]);
  const items = pageItems(page);
  const filtered = items.filter(
    (item) =>
      !query.trim() ||
      Object.values(item).some(
        (value) =>
          typeof value !== "object" &&
          text(value, "").toLowerCase().includes(query.trim().toLowerCase()),
      ),
  );
  const columns = inferredColumns(view, items);
  const openItem = (item: JsonRecord, index: number) => {
    const id = recordId(item, String(index));
    const label = titleFor(item);
    setOpenTabs((tabs) =>
      tabs.some((tab) => tab.id === id) ? tabs : [...tabs, { id, label }],
    );
    setActiveId(id);
  };
  const closeTab = (id: string) => {
    setOpenTabs((tabs) => tabs.filter((tab) => tab.id !== id));
    if (activeId === id) setActiveId(null);
  };
  const template = `${columns.map((column, index) => column.width || (index === 0 ? "minmax(260px,1.4fr)" : "minmax(180px,1fr)")).join(" ")} 2rem`;
  const collectionLabel = t(meta.label);
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="collection-workspace"
    >
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name={meta.icon} size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{collectionLabel}</h1>
            <p className="text-[11px] text-neutral-500">
              {page?.total ?? items.length} {t("registros publicados")}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-end gap-1 overflow-x-auto">
          <button
            className={`flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs ${!activeId ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" : "border-transparent text-neutral-500"}`}
            onClick={() => setActiveId(null)}
          >
            <Icon name="table" size={13} /> {collectionLabel}
          </button>
          {openTabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 ${activeId === tab.id ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" : "border-transparent text-neutral-500"}`}
            >
              <button
                className="flex h-full max-w-64 items-center gap-2 px-3 text-xs"
                onClick={() => setActiveId(tab.id)}
              >
                <Icon name={meta.icon} size={13} />
                <span className="truncate">{tab.label}</span>
              </button>
              <button
                className="mr-1 grid h-6 w-6 place-items-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-800"
                onClick={() => closeTab(tab.id)}
                aria-label={`${t("Cerrar")} ${tab.label}`}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
      </header>
      {activeId ? (
        <div className="min-h-0 flex-1">
          <CollectionDetailPanel
            spaceId={spaceId}
            collection={meta.collection}
            id={activeId}
            icon={meta.icon}
          />
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-neutral-200 p-3 dark:border-neutral-800">
            <div className="relative">
              <Icon
                name="search"
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
              />
              <input
                className="input input-with-leading-icon w-full"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`${t("Buscar en")} ${collectionLabel.toLocaleLowerCase(getActiveLang())}…`}
              />
            </div>
          </div>
          <div
            className="min-h-0 flex-1 overflow-auto"
            data-testid="record-list"
          >
            <div className="min-w-[980px]">
              <div
                className="grid h-10 items-center border-b border-neutral-200 px-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:text-neutral-600"
                style={{ gridTemplateColumns: template }}
              >
                {columns.map((column) => (
                  <span key={column.key} className="truncate">
                    {t(column.label)}
                  </span>
                ))}
                <span />
              </div>
              {error ? (
                <ErrorState error={error} onRetry={() => void load()} />
              ) : loading ? (
                <Loading />
              ) : filtered.length === 0 ? (
                <EmptyState
                  title={`${t("No hay")} ${collectionLabel.toLocaleLowerCase(getActiveLang())} ${t("publicados")}`}
                />
              ) : (
                filtered.map((item, index) => (
                  <button
                    key={recordId(item, String(index))}
                    className="grid min-h-[62px] w-full items-center border-b border-neutral-100 px-4 py-2.5 text-left text-xs hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55"
                    style={{ gridTemplateColumns: template }}
                    onClick={() => openItem(item, index)}
                  >
                    {columns.map((column, columnIndex) => (
                      <span
                        key={column.key}
                        className={`${columnIndex === 0 ? "font-medium text-neutral-900 dark:text-neutral-200" : "text-neutral-500"} line-clamp-2 min-w-0 pr-4`}
                      >
                        {text(
                          item[column.key],
                          columnIndex === 0 ? titleFor(item) : "—",
                        )}
                      </span>
                    ))}
                    <Icon
                      name="chevronRight"
                      size={14}
                      className="text-neutral-400"
                    />
                  </button>
                ))
              )}
            </div>
          </div>
          <footer className="flex h-10 shrink-0 items-center border-t border-neutral-200 px-3 text-xs text-neutral-500 dark:border-neutral-800">
            {filtered.length} / {page?.total ?? items.length}
          </footer>
        </>
      )}
    </div>
  );
}

function DetailView({
  spaceId,
  route,
}: {
  spaceId: string;
  route: Extract<Route, { kind: "detail" }>;
}) {
  const [data, setData] = useState<JsonRecord>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await api.detail(spaceId, route.collection, route.id));
    } catch (next) {
      setError(next);
    } finally {
      setLoading(false);
    }
  }, [spaceId, route.collection, route.id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => void load()} />;
  const nested = Object.values(data || {}).find(
    (value) => value && typeof value === "object" && !Array.isArray(value),
  ) as JsonRecord | undefined;
  const item = nested || data || {};
  return (
    <div className="h-full overflow-y-auto p-6 server-view-padding">
      <div className="mx-auto max-w-5xl">
        <button
          className="mb-4 flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-200"
          onClick={() =>
            history.length > 1 ? history.back() : navigate(viewPath(route.view))
          }
        >
          <Icon name="chevronLeft" size={13} />
          {t("Volver")}
        </button>
        <HomeIntroCard
          eyebrow={t("Registro publicado")}
          title={titleFor(item)}
          description={text(
            item.abstract || item.description || item.summary,
            "Consulta de metadatos en modo solo lectura.",
          )}
          icon={VIEW_COLLECTIONS[route.view]?.icon || "book"}
        />
        <article className="mt-5 rounded-xl border border-neutral-800 bg-neutral-950/45 p-4">
          <h2 className="mb-3 text-sm font-semibold">{t("Detalles")}</h2>
          <dl className="server-detail-list">
            {Object.entries(item)
              .filter(
                ([, value]) =>
                  value !== null &&
                  value !== undefined &&
                  typeof value !== "object",
              )
              .slice(0, 20)
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replace(/_/g, " ")}</dt>
                  <dd>{text(value)}</dd>
                </div>
              ))}
          </dl>
        </article>
      </div>
    </div>
  );
}

function UnavailableView({ view }: { view: View }) {
  const item = NAV_ITEMS.find((entry) => entry.id === view);
  return (
    <ViewFrame
      eyebrow="Nodus Server"
      title={t(item?.label || "Sección")}
      description={t(
        "Esta superficie conserva su posición y apariencia de Desktop, pero sus acciones dependen de edición local o IA y están desactivadas en Server.",
      )}
      icon={item?.icon || "lock"}
    >
      <div className="server-unavailable rounded-xl border border-neutral-800 bg-neutral-950/30">
        <div>
          <Icon name="lock" size={30} className="mx-auto text-neutral-600" />
          <h2 className="mt-3 text-sm font-semibold text-neutral-300">
            {t(
              "Disponible solo para consulta cuando exista contenido publicado",
            )}
          </h2>
          <p className="mt-2 text-xs leading-5 text-neutral-600">
            {t(
              "Nodus Server nunca ejecuta escrituras del vault ni herramientas de IA desde esta vista.",
            )}
          </p>
        </div>
      </div>
    </ViewFrame>
  );
}

export default function App() {
  const graphSnapshot = useRef<{ spaceId: string; snapshot: StellarWorkspaceSnapshot }>();
  const [route, setRoute] = useState<Route>(routeFromLocation);
  const [me, setMe] = useState<MeResponse>();
  const [profile, setProfile] = useState<PortableProfileValues>();
  const [language, setLanguage] = useState<AppLanguage>("en");
  const [activeId, setActiveId] = useState("");
  const [summary, setSummary] = useState<SpaceSummary>();
  const [error, setError] = useState<unknown>();
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    localStorage.getItem("nodus-web-theme") === "light" ? "light" : "dark",
  );
  const [appTheme, setAppTheme] = useState<string>(
    () => localStorage.getItem("nodus-app-theme") || "default",
  );
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    Math.max(
      SERVER_SIDEBAR_MIN_WIDTH,
      Math.min(
        SERVER_SIDEBAR_MAX_WIDTH,
        Number(localStorage.getItem("nodus-server-sidebar-width")) ||
          SERVER_SIDEBAR_DEFAULT_WIDTH,
      ),
    ),
  );
  const [navCollapsed, setNavCollapsed] = useState(
    () => localStorage.getItem(SERVER_NAV_COLLAPSED_STORAGE_KEY) === "1",
  );
  const [drawer, setDrawer] = useState(false);
  const editorialFocus = useEditorialShellFocus();
  const [pendingView, setPendingView] = useState<View | null>(null);
  const [vaultsOpen, setVaultsOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem(SERVER_COLLAPSED_GROUPS_STORAGE_KEY) || "[]",
      );
      return new Set(
        Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === "string")
          : [],
      );
    } catch {
      return new Set();
    }
  });
  setActiveLang(language);
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
  const [headerLogoEl, setHeaderLogoEl] = useState<HTMLElement | null>(null);
  const [headerActionsEl, setHeaderActionsEl] = useState<HTMLElement | null>(
    null,
  );
  const [vaultBadgeEl, setVaultBadgeEl] = useState<HTMLElement | null>(null);
  const [vaultBadgePlacement, setVaultBadgePlacement] =
    useState<HeaderBadgePlacement | null>(null);
  const profileThemeRef =
    useRef<PortableProfileValues["appearance"]["theme"]>("system");
  const viewHostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let approvedPath = location.pathname + location.search + location.hash;
    let sequence = 0;
    const listener = async () => {
      const requestedPath = location.pathname + location.search + location.hash;
      const request = ++sequence;
      const saved = await flushServerEditors();
      if (request !== sequence) return;
      if (!saved) { history.replaceState({}, '', approvedPath); return; }
      approvedPath = requestedPath;
      setRoute(routeFromLocation());
    };
    addEventListener("popstate", listener);
    return () => removeEventListener("popstate", listener);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("nodus-web-theme", theme);
  }, [theme]);
  useEffect(() => {
    // Colour palette lives in runtime CSS variables; `data-theme` above remains
    // reserved for light/dark mode on this build.
    // Keep the boot-time cached palette in place until the portable profile has
    // arrived. Applying a custom id with an empty definition list would make
    // themeBoot correctly fail closed to the default, briefly (and sometimes
    // permanently for a slow/failed profile request) repainting the app with
    // the default palette.
    // Built-in palettes can be applied immediately, even when a basic Server
    // has no profile row yet. Custom palettes still wait for their definitions
    // from the profile so themeBoot can fail closed safely instead of treating
    // an unloaded custom theme as the default.
    if (!profile && !isBuiltInTheme(appTheme)) return;
    const customThemes = profile?.appearance.customThemes ?? [];
    applyRuntimeAppTheme(appTheme, customThemes);
    localStorage.setItem(APP_THEME_STORAGE_KEY, appTheme);
    localStorage.setItem(APP_THEME_DEFINITIONS_STORAGE_KEY, JSON.stringify(customThemes));
  }, [appTheme, profile?.appearance.customThemes]);
  const summarySequence = useRef(0);
  const refreshSpaces = useCallback(async () => {
    const value = await api.me();
    setMe(value);
    setActiveId((current) => {
      if (value.spaces?.some((space) => space.id === current)) return current;
      const remembered = localStorage.getItem(ACTIVE_VAULT_STORAGE_KEY) || "";
      return value.spaces?.some((space) => space.id === remembered)
        ? remembered
        : value.spaces?.[0]?.id || "";
    });
  }, []);
  useEffect(() => {
    refreshSpaces().catch(setError);
  }, [refreshSpaces]);
  useEffect(() => {
    const listener = (event: Event) => {
      const requested = (event as CustomEvent<{ activeId?: string }>).detail
        ?.activeId;
      void refreshSpaces()
        .then(() => {
          if (requested) {
            localStorage.setItem(ACTIVE_VAULT_STORAGE_KEY, requested);
            setActiveId(requested);
          }
        })
        .catch(setError);
    };
    addEventListener("nodus-vaults-updated", listener);
    return () => removeEventListener("nodus-vaults-updated", listener);
  }, [refreshSpaces]);
  useEffect(() => {
    const resolveTheme = (
      preferred: PortableProfileValues["appearance"]["theme"],
    ) =>
      preferred === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : preferred;
    api
      .profilePreferences()
      .then((response) => {
        if (!response.profile.values) return;
        setProfile(response.profile.values);
        setLanguage(response.profile.values.appearance.uiLanguage || "en");
        profileThemeRef.current = response.profile.values.appearance.theme;
        setTheme(resolveTheme(response.profile.values.appearance.theme));
        setAppTheme(response.profile.values.appearance.appTheme || "default");
      })
      .catch(() => undefined);
    const listener = (event: Event) => {
      const next = (event as CustomEvent<PortableProfileValues>).detail;
      if (next) {
        setProfile(next);
        setLanguage(next.appearance.uiLanguage || "en");
        profileThemeRef.current = next.appearance.theme;
        setTheme(resolveTheme(next.appearance.theme));
        setAppTheme(next.appearance.appTheme || "default");
      }
    };
    addEventListener("nodus-profile-updated", listener);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onSystemTheme = () => {
      if (profileThemeRef.current === "system")
        setTheme(resolveTheme("system"));
    };
    media.addEventListener?.("change", onSystemTheme);
    return () => {
      removeEventListener("nodus-profile-updated", listener);
      media.removeEventListener?.("change", onSystemTheme);
    };
  }, []);
  const spaces = me?.spaces || [];
  const active = useMemo(
    () => spaces.find((space) => space.id === activeId) || spaces[0],
    [spaces, activeId],
  );
  const type = normalizeVaultType(active?.vaultType || active?.vault?.type);
  useEffect(() => applyVaultAccent(type), [type]);
  const activeView = route.view;
  useEffect(() => {
    if (graphSnapshot.current?.spaceId !== active?.id) graphSnapshot.current = undefined;
  }, [active?.id]);
  const primarySourcesLoader = useMemo(
    () =>
      active?.id && type === "primary_sources"
        ? {
            getPrimarySourceMapWorkspace: () =>
              api.primarySources.map(
                active.id,
              ) as unknown as Promise<PrimarySourceMapWorkspace>,
            getPrimarySourceTimelineWorkspace: () =>
              api.primarySources.timeline(
                active.id,
              ) as unknown as Promise<PrimarySourceTimelineWorkspace>,
            getPrimarySourceRelationsWorkspace: () =>
              api.primarySources.relations(
                active.id,
              ) as unknown as Promise<PrimarySourceRelationsWorkspace>,
            listPrimarySourcePersons: (
              query: string,
              filter: PrimarySourcePersonFilter,
            ) =>
              api.primarySources
                .persons(active.id, { q: query, filter })
                .then(
                  (response) =>
                    (response.people ?? []) as PrimarySourcePersonSummary[],
                ),
            getPrimarySourcePersonDossier: (id: string) =>
              api.primarySources
                .person(active.id, id)
                .then(
                  (response) =>
                    response as unknown as PrimarySourcePersonDossier,
                ),
            searchPrimarySourceCorpus: (request: PrimarySourceSearchRequest) =>
              api.primarySources.search(active.id, {
                q: request.query,
                ...request.filters,
              }) as unknown as Promise<PrimarySourceSearchResponse>,
          }
        : undefined,
    [active?.id, type],
  );
  useEffect(() => {
    if (!active?.id) return;
    const sequence = ++summarySequence.current;
    localStorage.setItem(ACTIVE_VAULT_STORAGE_KEY, active.id);
    setSummary(undefined);
    setError(undefined);
    api
      .space(active.id)
      .then((value) => {
        if (sequence === summarySequence.current) setSummary(value);
      })
      .catch((next) => {
        if (sequence === summarySequence.current) setError(next);
      });
    return () => {
      summarySequence.current += 1;
    };
  }, [active?.id]);
  const openView = (view: View) => {
    if (SERVER_TOOL_VIEWS.has(view)) return;
    if (view === activeView) {
      setDrawer(false);
      return;
    }
    setPendingView(view);
    navigate(viewPath(view));
    setDrawer(false);
  };
  useEffect(() => {
    if (!pendingView || pendingView !== activeView) return undefined;
    const host = viewHostRef.current;
    if (!host) return undefined;
    let observer: MutationObserver | undefined;
    const finishWhenContentIsReady = () => {
      if (host.querySelector('[data-testid="loading"]')) return;
      setPendingView((current) =>
        current === pendingView ? null : current,
      );
      observer?.disconnect();
    };
    const frame = requestAnimationFrame(() => {
      observer = new MutationObserver(finishWhenContentIsReady);
      observer.observe(host, { childList: true, subtree: true });
      finishWhenContentIsReady();
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [activeView, pendingView]);
  const resize = (event: ReactPointerEvent) => {
    const start = event.clientX;
    const initial = sidebarWidth;
    const move = (next: PointerEvent) =>
      setSidebarWidth(
        Math.max(
          SERVER_SIDEBAR_MIN_WIDTH,
          Math.min(SERVER_SIDEBAR_MAX_WIDTH, initial + next.clientX - start),
        ),
      );
    const up = () => {
      document.body.classList.remove("is-resizing-sidebar");
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
    };
    document.body.classList.add("is-resizing-sidebar");
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
  };
  const resizeWithKeyboard = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    const requested =
      event.key === "Home"
        ? SERVER_SIDEBAR_MIN_WIDTH
        : event.key === "End"
          ? SERVER_SIDEBAR_MAX_WIDTH
          : event.key === "ArrowLeft"
            ? sidebarWidth - 8
            : event.key === "ArrowRight"
              ? sidebarWidth + 8
              : null;
    if (requested === null) return;
    event.preventDefault();
    setSidebarWidth(
      Math.max(
        SERVER_SIDEBAR_MIN_WIDTH,
        Math.min(SERVER_SIDEBAR_MAX_WIDTH, requested),
      ),
    );
  };
  useEffect(() => {
    localStorage.setItem("nodus-server-sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);
  useEffect(() => {
    localStorage.setItem(
      SERVER_NAV_COLLAPSED_STORAGE_KEY,
      navCollapsed ? "1" : "0",
    );
  }, [navCollapsed]);
  useEffect(() => {
    localStorage.setItem(
      SERVER_COLLAPSED_GROUPS_STORAGE_KEY,
      JSON.stringify([...collapsedGroups]),
    );
  }, [collapsedGroups]);
  // The right rail grows when a label is revealed and the left rail follows the
  // user-resizable sidebar. Measure both rails just like Desktop so the centred
  // vault chip never ends up underneath an expanded action.
  useLayoutEffect(() => {
    if (!headerEl || !headerLogoEl || !headerActionsEl || !vaultBadgeEl) {
      setVaultBadgePlacement(null);
      return undefined;
    }
    const measure = () => {
      setVaultBadgePlacement((previous) => {
        const next = placeHeaderBadge({
          headerWidth: headerEl.clientWidth,
          logoWidth: headerLogoEl.offsetWidth,
          actionsWidth: headerActionsEl.offsetWidth,
          badgeWidth: vaultBadgeEl.offsetWidth,
        });
        if (
          previous &&
          previous.fits === next.fits &&
          Math.abs(previous.left - next.left) < 0.5
        )
          return previous;
        return next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const box of [headerEl, headerLogoEl, headerActionsEl, vaultBadgeEl])
      observer.observe(box);
    return () => observer.disconnect();
  }, [headerEl, headerLogoEl, headerActionsEl, vaultBadgeEl]);
  if (error && !me)
    return (
      <div className="h-full">
        <ErrorState error={error} />
      </div>
    );
  if (!me) return <Loading />;
  if (spaces.length === 0)
    return (
      <EmptyState
        title={t("No tienes bóvedas asignadas")}
        detail={t("Solicita acceso a un administrador de Nodus Server.")}
      />
    );
  if (error && !summary) return <ErrorState error={error} />;
  // Switching vaults updates `activeId` before the new summary request resolves. Never
  // render the new vault's shell with the previous vault's counts for that intermediate
  // frame: besides visibly flashing wrong metrics, fast consumers could mistake it for
  // the new vault's published state.
  if (!active || !summary || summary.space?.id !== active.id)
    return <Loading />;
  const isNativeVault =
    active.storageKind === "server_native" || active.authorityMode === "server";
  const canAuthorNative =
    isNativeVault && (active.role === "owner" || active.role === "writer");
  const wrapNativeSurface = (surface: string, child: ReactNode) =>
    isNativeVault ? (
      <NativeContentAuthoring
        spaceId={active.id}
        surface={surface}
        revision={Number(summary.space?.revision ?? active.revision ?? 0)}
        csrfToken={me.csrfToken}
        canWrite={canAuthorNative}
        onChanged={() => {
          void refreshSpaces();
          void api.space(active.id).then(setSummary);
        }}
      >
        {child}
      </NativeContentAuthoring>
    ) : (
      child
    );
  const content = (() => {
    if (route.kind === "library-detail")
      return (
        <ServerLibraryDetail
          spaceId={active.id}
          id={route.id}
          csrfToken={me.csrfToken}
          onBack={() =>
            history.length > 1 ? history.back() : openView("library")
          }
        />
      );
    if (
      route.kind === "detail" &&
      ["ideas", "works", "authors"].includes(route.collection)
    ) {
      const kind =
        route.collection === "ideas"
          ? "idea"
          : route.collection === "works"
            ? "work"
            : "author";
      return (
        <AcademicDetailExplorer
          key={`${kind}:${route.id}`}
          spaceId={active.id}
          origin={t(route.view === "search" ? "Buscar" : "Inicio")}
          initialTarget={
            { kind, id: route.id, label: route.id } as AcademicTarget
          }
          onOrigin={() => history.back()}
        />
      );
    }
    if (route.kind === "detail" && surfaceForView(type, route.view)) {
      const surface = surfaceForView(type, route.view)!;
      return wrapNativeSurface(
        surface,
        <VaultSurfaceView
          key={`${active.id}:${route.view}:${route.collection}:${route.id}`}
          spaceId={active.id}
          surface={surface}
          vaultType={type}
          view={route.view}
          initialId={route.id}
          initialCollection={route.collection}
          onOrigin={() => openView(route.view)}
          onOpenRecord={(collection, id) =>
            navigate(
              `/detail/${route.view}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
            )
          }
        />,
      );
    }
    if (route.kind === "detail")
      return <DetailView spaceId={active.id} route={route} />;
    if (route.view === "home")
      return (
        <Home
          active={active}
          summary={summary}
          onOpen={openView}
          onRefresh={async () => {
            const next = await api.space(active.id);
            setSummary(next);
          }}
        />
      );
    if (route.view === "search" && type === "primary_sources")
      return (
        <>
          <span className="hidden" data-testid="academic-search-view" />
          <PrimarySourcesSearchView
            loader={primarySourcesLoader}
            onOpenSource={(target) =>
              navigate(
                `/detail/archive/archive-items/${encodeURIComponent(target.itemId)}`,
              )
            }
            onOpenNote={() => undefined}
            onNavigate={openView}
          />
        </>
      );
    if (route.view === "search")
      return (
        <SearchServerView
          spaceId={active.id}
          vaultType={type}
          onNavigate={(collection, id) => {
            const owner = searchDetailView(collection, type);
            navigate(
              `/detail/${owner || "search"}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
            );
          }}
        />
      );
    if (
      route.view === "prosopSearch" ||
      route.view === "studySearch" ||
      route.view === "dbSearch"
    ) {
      return (
        <SearchServerView
          key={`${active.id}:${route.view}`}
          spaceId={active.id}
          vaultType={type}
          onNavigate={(collection, id) => {
            const owner = searchDetailView(collection, type);
            navigate(
              `/detail/${owner || "search"}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
            );
          }}
        />
      );
    }
    if (route.view === "studyChat")
      return (
        <ConversationServerView
          key={active.id}
          spaceId={active.id}
          csrfToken={me.csrfToken}
          mode="study"
        />
      );
    if (
      route.view === "studyIdeas" ||
      route.view === "studyGraph" ||
      route.view === "studyQuestions" ||
      route.view === "studyReview"
    ) {
      const surface = surfaceForView(type, route.view);
      return surface ? (
        wrapNativeSurface(
          surface,
          <VaultSurfaceView
            key={`${active.id}:${route.view}`}
            spaceId={active.id}
            surface={surface}
            vaultType={type}
            view={route.view}
            onOrigin={() => openView("home")}
            onOpenRecord={(collection, id) =>
              navigate(
                `/detail/${route.view}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
              )
            }
          />,
        )
      ) : (
        <UnavailableView view={route.view} />
      );
    }
    if (route.view === "dbChat")
      return (
        <ConversationServerView
          key={active.id}
          spaceId={active.id}
          csrfToken={me.csrfToken}
          mode="database"
        />
      );
    if (route.view === "dbAnalysis")
      return <DatabaseAnalysisServerView key={active.id} spaceId={active.id} />;
    if (route.view === "dbDeepResearch")
      return (
        <DatabaseDeepResearchServerView
          key={active.id}
          spaceId={active.id}
          csrfToken={me.csrfToken}
        />
      );
    if (route.view === "worldChat")
      return (
        <ConversationServerView
          key={active.id}
          spaceId={active.id}
          csrfToken={me.csrfToken}
          mode="world"
        />
      );
    if (route.view === "studyDeepResearch")
      return (
        <DeepResearchServerView
          key={active.id}
          spaceId={active.id}
          csrfToken={me.csrfToken}
          initialReportId={
            new URLSearchParams(location.search).get("report") || undefined
          }
        />
      );
    if (route.view === "library")
      return (
        <ServerPublishedLibraryView
          spaceId={active.id}
          onOpen={(id) => navigate(`/library/${encodeURIComponent(id)}`)}
        />
      );
    if (route.view === "ideas")
      return wrapNativeSurface(
        "academic-ideas",
        <IdeasServerView key={active.id} spaceId={active.id} />,
      );
    if (route.view === "authors")
      return wrapNativeSurface(
        "academic-authors",
        <AuthorsServerView key={active.id} spaceId={active.id} />,
      );
    if (route.view === "graph")
      return (
        <GraphServerView
          key={active.id}
          spaceId={active.id}
          csrfToken={me.csrfToken}
          initialSeedId={
            new URLSearchParams(location.search).get("seed") || undefined
          }
          snapshot={graphSnapshot.current?.spaceId === active.id ? graphSnapshot.current.snapshot : undefined}
          onSnapshotChange={snapshot => { graphSnapshot.current = { spaceId: active.id, snapshot }; }}
          onOpenIdea={(id) =>
            navigate(`/detail/ideas/ideas/${encodeURIComponent(id)}`)
          }
        />
      );
    if (["argument", "hypothesis", "reading", "immersion"].includes(route.view))
      return (
        <AcademicToolsServerView
          key={active.id}
          spaceId={active.id}
          csrfToken={me.csrfToken}
          tool={
            route.view as "argument" | "hypothesis" | "reading" | "immersion"
          }
        />
      );
    if (route.view === "dictionary")
      return (
        <DictionaryServerView
          key={active.id}
          spaceId={active.id}
          csrfToken={me.csrfToken}
        />
      );
    if (route.view === "deepResearch")
      return (
        <DeepResearchServerView
          key={active.id}
          spaceId={active.id}
          csrfToken={me.csrfToken}
          initialReportId={
            new URLSearchParams(location.search).get("report") || undefined
          }
        />
      );
    if (
      route.view === "research" ||
      route.view === "debate" ||
      route.view === "gaps"
    )
      return wrapNativeSurface(
        route.view === "gaps" ? "academic-gaps" : "academic-themes",
        <StateOfArtServerView
          key={`${active.id}:${route.view}`}
          spaceId={active.id}
          csrfToken={me.csrfToken}
          initialTab={
            route.view === "debate"
              ? "debate"
              : route.view === "gaps"
                ? "gaps"
                : "map"
          }
        />,
      );
    if (route.view === 'toolkit') {
      const scriptorView = scriptorViewForVault(type);
      const pinned = !profile?.workspace.sidebarHidden.includes(scriptorView);
      return <ToolsServerView pinned={pinned} onOpen={() => void navigate(`/view/${scriptorView}`)} onTogglePinned={async () => {
        const current = profile ?? { ...blankProfile(theme,(await api.aiPreferences()).preferences) };
        const hidden = current.workspace.sidebarHidden;
        const next = {
          ...current,
          appearance: profile ? current.appearance : {...current.appearance,uiLanguage:language,appTheme},
          workspace: {...current.workspace,scriptorSidebarVersion:1,sidebarCustomized:true,sidebarHidden:pinned ? [...new Set([...hidden,'workspace','notes'])] : hidden.filter(id => id !== 'workspace' && id !== 'notes')},
        };
        const result = await api.updateProfilePreferences(next,me.csrfToken);
        if (result.profile.values) window.dispatchEvent(new CustomEvent('nodus-profile-updated',{detail:result.profile.values}));
      }} />;
    }
    if (route.view === "workspace" || route.view === "notes")
      return (
        <PrivateNotesServerView
          userId={me.user?.id ?? 'authenticated'}
          key={active.id}
          spaceId={active.id}
          csrfToken={me.csrfToken}
        />
      );
    if (route.view === "assistant")
      return (
        <ConversationServerView
          key={active.id}
          spaceId={active.id}
          csrfToken={me.csrfToken}
          mode="assistant"
        />
      );
    if (route.view === "nodi")
      return (
        <ConversationServerView
          key={active.id}
          spaceId={active.id}
          csrfToken={me.csrfToken}
          mode="nodi"
        />
      );
    if (route.view === "settings") {
      // Keep the tab in the URL authoritative even when Settings is already
      // mounted.  Without a key, clicking the account glyph while viewing (for
      // example) Providers changed the URL but left the old tab on screen.
      const settingsTab =
        new URLSearchParams(location.search).get("tab") || "server";
      const settingsFocus =
        new URLSearchParams(location.search).get("focus") || "";
      return (
        <ServerSettingsView
          key={`${settingsTab}:${settingsFocus}`}
          csrfToken={me.csrfToken}
          isAdmin={me.user?.role === "admin"}
          theme={theme}
          initialTab={settingsTab as TabId}
          onThemeChange={setTheme}
          onAppThemeChange={setAppTheme}
          onLanguageChange={setLanguage}
        />
      );
    }
    if (type === "primary_sources" && route.view === "timeline")
      return (
        <>
          <span
            className="hidden"
            data-testid="vault-surface-genealogy-timeline"
          />
          <PrimarySourcesTimelineView loader={primarySourcesLoader} />
        </>
      );
    if (type === "primary_sources" && route.view === "archive")
      return (
        <div data-testid="vault-surface-archive-items" className="h-full">
          <PrimarySourcesArchiveServerView
            spaceId={active.id}
            onOpen={(id) =>
              navigate(
                `/detail/archive/archive-items/${encodeURIComponent(id)}`,
              )
            }
          />
        </div>
      );
    if (type === "primary_sources" && route.view === "map")
      return (
        <>
          <span className="hidden" data-testid="vault-surface-genealogy-map" />
          <PrimarySourcesMapView loader={primarySourcesLoader} />
        </>
      );
    if (type === "primary_sources" && route.view === "relations")
      return (
        <>
          <span className="hidden" data-testid="vault-surface-relationships" />
          <PrimarySourcesRelationsView loader={primarySourcesLoader} />
        </>
      );
    if (type === "primary_sources" && route.view === "persons")
      return (
        <>
          <span className="hidden" data-testid="vault-surface-persons" />
          <PrimarySourcesPersonsView
            loader={primarySourcesLoader}
            readOnly
            onOpenExcerpt={(itemId) =>
              navigate(
                `/detail/archive/archive-items/${encodeURIComponent(itemId)}`,
              )
            }
          />
        </>
      );
    if (surfaceForView(type, route.view as View)) {
      const surface = surfaceForView(type, route.view as View)!;
      return wrapNativeSurface(
        surface,
        <VaultSurfaceView
          key={`${active.id}:${route.view}`}
          spaceId={active.id}
          surface={surface}
          vaultType={type}
          view={route.view as View}
          onOpenRecord={(collection, id) =>
            navigate(
              `/detail/${route.view}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
            )
          }
        />,
      );
    }
    if (VIEW_COLLECTIONS[route.view as View])
      return <CollectionView spaceId={active.id} view={route.view as View} />;
    return <UnavailableView view={route.view as View} />;
  })();
  return (
    <div
      className={`server-desktop-surface h-full min-h-0 min-w-0 flex flex-col overflow-hidden ${type}`}
      data-theme={theme}
      style={
        {
          "--vault-accent": VAULT_TYPE_COLORS[type],
          "--server-sidebar-width": `${sidebarWidth}px`,
        } as React.CSSProperties
      }
      data-testid="app-shell"
      data-surface="server"
      data-editorial-focus={editorialFocus.active ? "true" : undefined}
    >
      <header
        ref={setHeaderEl}
        className="app-titlebar relative flex h-11 shrink-0 items-center border-b border-neutral-800"
        data-platform="web"
      >
        <button
          ref={setHeaderLogoEl}
          data-testid="sidebar-header-toggle"
          className={`server-header-logo relative flex h-full shrink-0 items-center justify-center text-lg font-semibold tracking-tight transition-colors hover:bg-neutral-900/70 focus-visible:bg-neutral-900/70 ${sidebarWidth > SERVER_SIDEBAR_COMPACT_THRESHOLD ? "pl-2 pr-6" : "px-2"}`}
          style={{ width: sidebarWidth }}
          onClick={() => {
            if (matchMedia("(max-width: 760px)").matches)
              setDrawer((value) => !value);
            else setNavCollapsed((value) => !value);
          }}
          title={t(
            matchMedia("(max-width: 760px)").matches
              ? drawer
                ? "Cerrar navegación"
                : "Abrir navegación"
              : navCollapsed
                ? "Mostrar el menú lateral"
                : "Ocultar el menú lateral",
          )}
          aria-label={t("Alternar navegación")}
          aria-controls="server-sidebar-navigation"
          aria-expanded={
            matchMedia("(max-width: 760px)").matches ? drawer : !navCollapsed
          }
        >
          <span
            data-testid="sidebar-header-brand"
            className="flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <NodusHeaderLogo
              src={logoFor(type)}
              className="h-6 w-6"
              data-testid="nodus-logo"
              data-vault-logo={type}
            />
            <span
              className={`server-header-brand-text ${sidebarWidth <= SERVER_SIDEBAR_COMPACT_THRESHOLD ? "sr-only" : ""}`}
            >
              Nodus Server
            </span>
            {sidebarWidth > SERVER_SIDEBAR_COMPACT_THRESHOLD && (
              <span className="server-header-beta">BETA</span>
            )}
          </span>
          {sidebarWidth > SERVER_SIDEBAR_COMPACT_THRESHOLD && (
            <Icon
              name={navCollapsed ? "chevronRight" : "chevronLeft"}
              size={14}
              className="server-header-chevron absolute right-2 text-neutral-600"
            />
          )}
        </button>
        <button
          ref={setVaultBadgeEl}
          data-vault-trigger
          data-tour="vault-badge"
          data-testid="header-vault-badge"
          data-badge-fits={
            vaultBadgePlacement ? String(vaultBadgePlacement.fits) : undefined
          }
          aria-label={t("Bóveda activa")}
          aria-expanded={vaultsOpen}
          onClick={() => setVaultsOpen((value) => !value)}
          title={t("Bóveda activa")}
          style={{
            left: vaultBadgePlacement ? `${vaultBadgePlacement.left}px` : "50%",
            visibility: vaultBadgePlacement?.fits ? "visible" : "hidden",
          }}
          className="header-vault-badge absolute top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-indigo-700/60 bg-indigo-950/30 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-200 transition-colors hover:border-indigo-500 hover:bg-indigo-900/40"
        >
          <Icon name={vaultTypeIcon(type)} size={13} />
          <span className="hidden xl:inline">{t(vaultTypeLabel(type))}</span>
          <Icon
            name="chevronDown"
            size={12}
            className={vaultsOpen ? "rotate-180" : ""}
          />
        </button>
        <div className="flex-1" />
        <div
          ref={setHeaderActionsEl}
          className="header-action-rail flex min-w-0 items-center justify-end gap-0.5 overflow-hidden pr-4"
          data-testid="header-actions"
        >
          <button
            className="server-mobile-menu rounded-lg p-2 text-neutral-400 hover:bg-neutral-900"
            onClick={() => setDrawer(true)}
            aria-label={t("Abrir navegación")}
          >
            <Icon name="menu" />
          </button>
          <ServerHeaderAction
            icon="search"
            label={t("Comandos")}
            title={t("Paleta de comandos")}
            onClick={() => openView("search")}
            dataTestId="header-search"
            className={
              activeView === "search" ? "bg-indigo-600 text-white" : ""
            }
          />
          <ServerHeaderAction
            icon="chat"
            label={t("Asistente")}
            title={t("Abrir asistente de investigación")}
            onClick={() => navigate("/view/assistant")}
            dataTestId="header-assistant"
            className={
              activeView === "assistant" ? "bg-indigo-600 text-white" : ""
            }
          />
          <ServerHeaderAction
            icon="user"
            label={t("Mi cuenta")}
            title={t("Mi cuenta")}
            onClick={() => {
              setDrawer(false);
              navigate("/view/settings?tab=server");
            }}
            dataTestId="header-account"
          />
          <ServerHeaderAction
            icon={theme === "dark" ? "sun" : "moon"}
            label={t(theme === "dark" ? "Usar tema claro" : "Usar tema oscuro")}
            title={t(theme === "dark" ? "Usar tema claro" : "Usar tema oscuro")}
            onClick={() =>
              setTheme((value) => (value === "dark" ? "light" : "dark"))
            }
            dataTestId="theme-toggle"
          />
          <ServerHeaderAction
            icon="settings"
            label={t("Ajustes")}
            title={t("Ajustes")}
            onClick={() => navigate("/view/settings?tab=server")}
            dataTestId="header-settings"
            className={
              activeView === "settings" ? "bg-indigo-600 text-white" : ""
            }
          />
        </div>
        {vaultsOpen && active && (
          <ServerVaultManager
            spaces={spaces}
            active={active}
            isAdmin={me.user?.role === "admin"}
            csrfToken={me.csrfToken}
            onSelect={async (id) => {
              if (!await flushServerEditors()) return;
              localStorage.setItem(ACTIVE_VAULT_STORAGE_KEY, id);
              setActiveId(id);
              setVaultsOpen(false);
              navigate("/");
            }}
            onChanged={refreshSpaces}
            onAddVault={(kind) => {
              setVaultsOpen(false);
              navigate(
                `/view/settings?tab=server&focus=${
                  kind === "native" ? "new-vault" : "connected-vault"
                }`,
              );
            }}
            onClose={() => setVaultsOpen(false)}
          />
        )}
      </header>
      <div className="flex min-h-0 min-w-0 flex-1">
        <nav
          id="server-sidebar-navigation"
          className={`server-desktop-nav relative shrink-0 overflow-hidden border-r border-neutral-800 ${(editorialFocus.active ? !editorialFocus.navigationOpen : navCollapsed) ? "hidden" : ""}`}
          data-testid="resizable-sidebar"
          data-sidebar-compact={
            sidebarWidth <= SERVER_SIDEBAR_COMPACT_THRESHOLD ? "true" : "false"
          }
          data-drawer={drawer ? "true" : "false"}
        >
          <Sidebar
            type={type}
            activeView={
              (activeView === "debate" || activeView === "gaps"
                ? "research"
                : activeView) as View
            }
            compact={sidebarWidth <= SERVER_SIDEBAR_COMPACT_THRESHOLD}
            collapsedGroups={collapsedGroups}
            sidebarOrder={profile?.workspace.sidebarOrder || []}
            sidebarHidden={profile?.workspace.sidebarHidden || []}
            onToggleGroup={(id) =>
              setCollapsedGroups((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onNavigate={openView}
          />
          <button
            data-testid="sidebar-resize-handle"
            type="button"
            className="server-sidebar-resizer"
            onPointerDown={resize}
            onKeyDown={resizeWithKeyboard}
            onDoubleClick={() => setSidebarWidth(SERVER_SIDEBAR_DEFAULT_WIDTH)}
            aria-label={t("Cambiar el ancho del menú lateral")}
            title={t(
              "Arrastra para cambiar el ancho. Usa las flechas o doble clic para restablecerlo.",
            )}
          />
        </nav>
        <main className="server-main min-h-0 min-w-0 flex-1" id="main-content">
          <div
            ref={viewHostRef}
            className="server-view-host relative min-h-0 flex-1 overflow-hidden"
            data-loading-view={
              pendingView === activeView ? pendingView : undefined
            }
            aria-busy={pendingView === activeView ? true : undefined}
          >
            <Suspense fallback={<Loading />}>{content}</Suspense>
            {pendingView === activeView && (
              <div
                className="server-view-loading-overlay"
                role="status"
                aria-label={t("Cargando…")}
                data-testid="view-loading-spinner"
              >
                <span className="server-view-loading-spinner" aria-hidden="true" />
                <span className="sr-only">{t("Cargando…")}</span>
              </div>
            )}
          </div>
        </main>
      </div>
      {drawer && (
        <button
          className="server-drawer-scrim"
          aria-label={t("Cerrar navegación")}
          onClick={() => setDrawer(false)}
        />
      )}
    </div>
  );
}
