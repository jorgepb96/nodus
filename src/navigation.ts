import type { CorpusHealthBucketId, ResearchContextSelection } from '@shared/types';
import type { LibraryScope } from '@shared/libraryTypes';
import { type VaultType, normalizeVaultType } from '@shared/vaultTypes';
import type { ToolkitToolPage } from '@shared/toolkitNavigation';

export type View = 'researchChat' | 'home' | 'search' | 'testimonyInterviews' | 'testimonyParticipants' | 'testimonyContrasts' | 'library' | 'graph' | 'argument' | 'ideas' | 'dictionary' | 'authors' | 'persons' | 'prosopSearch' | 'prosopPopulation' | 'prosopPersons' | 'prosopSources' | 'prosopAnalysis' | 'prosopNetworks' | 'encyclopedia' | 'continuity' | 'conflicts' | 'arcs' | 'rules' | 'questions' | 'worldChat' | 'manuscript' | 'characters' | 'places' | 'factions' | 'cultures' | 'dynasties' | 'scenes' | 'timeline' | 'tree' | 'relations' | 'map' | 'archive' | 'pages' | 'databases' | 'dbSearch' | 'dbAnalysis' | 'dbChat' | 'dbDeepResearch' | 'studyCourses' | 'studySchedule' | 'studyCalendar' | 'studySearch' | 'studyLibrary' | 'studyRecordings' | 'studyChat' | 'studyIdeas' | 'studyGraph' | 'studyQuestions' | 'studyFocus' | 'studyReview' | 'studyDeepResearch' | 'teachingGroups' | 'teachingGrades' | 'teachingExams' | 'teachingRubrics' | 'teachingUnits' | 'immersion' | 'gaps' | 'debate' | 'research' | 'hypothesis' | 'reading' | 'writing' | 'deepResearch' | 'projects' | 'notes' | 'workspace' | 'browser' | 'radar' | 'compass' | 'toolkit' | 'settings';

export type GraphPresetId = 'overview' | 'contradictions' | 'gaps' | 'reading' | 'unread' | 'authors';

/** Sidebar section groups, in render order. Home and Settings are pinned outside
 * any group (first/last); every other section belongs to exactly one group.
 * Reordering (in Settings) happens within a group. */
export type NavGroupId = 'explore' | 'analyze' | 'create' | 'tools';

export interface NavItem {
  id: View;
  label: string;
  icon: string;
  /** Pinned sections (home, settings) have no group. */
  group?: NavGroupId;
}

export interface NavGroupDef {
  id: NavGroupId;
  label: string;
}

export const NAV_GROUPS: NavGroupDef[] = [
  { id: 'explore', label: 'Explorar' },
  { id: 'analyze', label: 'Analizar' },
  { id: 'create', label: 'Crear' },
  { id: 'tools', label: 'Herramientas' },
];

// Canonical sidebar sections in their default order, grouped. Home is always
// rendered first and Settings always last; neither can be moved or hidden. The
// rest can be reordered (within their group) and shown/hidden from Settings.
// Every icon is unique so sections stay distinguishable when the sidebar is
// collapsed to icons.
export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Inicio', icon: 'home' },
  // Explorar — recorrer el corpus, el grafo y sus ideas/autores.
  { id: 'search', label: 'Buscar', icon: 'search', group: 'explore' },
  { id: 'library', label: 'Biblioteca', icon: 'book', group: 'explore' },
  { id: 'graph', label: 'Grafo', icon: 'network', group: 'explore' },
  { id: 'argument', label: 'Mapa de argumentos', icon: 'layers', group: 'explore' },
  { id: 'ideas', label: 'Ideas', icon: 'bulb', group: 'explore' },
  { id: 'authors', label: 'Autores', icon: 'graduation', group: 'explore' },
  // Prosopography uses dedicated views: its persons and sources must never fall
  // through to the genealogical dossier or generic archive.
  { id: 'prosopSearch', label: 'Buscar', icon: 'search', group: 'explore' },
  { id: 'prosopPopulation', label: 'Población', icon: 'users', group: 'explore' },
  { id: 'prosopPersons', label: 'Personas', icon: 'user', group: 'explore' },
  { id: 'prosopSources', label: 'Fuentes', icon: 'archive', group: 'explore' },
  { id: 'prosopAnalysis', label: 'Análisis', icon: 'chartBar', group: 'analyze' },
  { id: 'prosopNetworks', label: 'Redes', icon: 'network', group: 'analyze' },
  // Records views — shown only for primary-source / genealogy vaults (see VAULT_TYPE_SCOPED_VIEWS).
  { id: 'persons', label: 'Personas', icon: 'users', group: 'explore' },
  { id: 'timeline', label: 'Línea temporal', icon: 'clock', group: 'explore' },
  { id: 'tree', label: 'Árbol genealógico', icon: 'tree', group: 'explore' },
  // 'link', y no el icono de red, porque el Grafo se quedó con ese: las dos secciones
  // conviven en una bóveda genealógica y dos iconos iguales en la misma barra no
  // distinguen nada cuando está plegada a iconos.
  { id: 'relations', label: 'Relaciones sociales', icon: 'link', group: 'explore' },
  { id: 'map', label: 'Mapa', icon: 'map', group: 'explore' },
  { id: 'archive', label: 'Archivo', icon: 'archive', group: 'explore' },
  // Worldbuilding mode — shown only for the 'worldbuilding' vault type. It shares the
  // 'users' icon with Personas and Grupos, which never coexist with it in one vault.
  { id: 'encyclopedia', label: 'Enciclopedia', icon: 'book', group: 'explore' },
  { id: 'characters', label: 'Personajes', icon: 'users', group: 'explore' },
  { id: 'places', label: 'Lugares', icon: 'map', group: 'explore' },
  { id: 'factions', label: 'Facciones', icon: 'network', group: 'explore' },
  { id: 'cultures', label: 'Culturas', icon: 'languages', group: 'explore' },
  { id: 'dynasties', label: 'Dinastías', icon: 'shield', group: 'explore' },
  { id: 'rules', label: 'Reglas del mundo', icon: 'lock', group: 'analyze' },
  { id: 'conflicts', label: 'Conflictos', icon: 'scale', group: 'analyze' },
  { id: 'arcs', label: 'Arcos narrativos', icon: 'route', group: 'analyze' },
  { id: 'continuity', label: 'Continuidad', icon: 'check', group: 'analyze' },
  { id: 'questions', label: 'Preguntas abiertas', icon: 'help', group: 'analyze' },
  { id: 'researchChat', label: 'Research chat', icon: 'chat', group: 'analyze' },
  { id: 'worldChat', label: 'Research chat', icon: 'chat', group: 'analyze' },
  { id: 'scenes', label: 'Escenas', icon: 'image', group: 'create' },
  { id: 'manuscript', label: 'Manuscrito', icon: 'edit', group: 'create' },
  // Databases mode — shown only for the 'databases' vault type (see VAULT_TYPE_SCOPED_VIEWS).
  // The database list itself is rendered dynamically in the sidebar; these two are the
  // fixed Analysis and Chat sections. The table workspace ('databases' view) is reached
  // by clicking a database in the list, so it is not a nav button.
  { id: 'pages', label: 'Páginas', icon: 'notebook', group: 'explore' },
  { id: 'dbSearch', label: 'Buscar', icon: 'search', group: 'explore' },
  { id: 'dbAnalysis', label: 'Análisis', icon: 'chartBar', group: 'analyze' },
  { id: 'dbChat', label: 'Research chat', icon: 'chat', group: 'analyze' },
  { id: 'dbDeepResearch', label: 'Deep Research', icon: 'telescope', group: 'analyze' },
  // Testimonios — historia oral. Solo tres secciones propias: lo demás que un archivo
  // de entrevistas necesita (grabaciones, transcripciones, códigos, acuerdos) vive
  // dentro del dossier de cada entrevista, no en el menú.
  { id: 'testimonyInterviews', label: 'Entrevistas', icon: 'microphone', group: 'explore' },
  { id: 'testimonyParticipants', label: 'Participantes', icon: 'users', group: 'explore' },
  { id: 'testimonyContrasts', label: 'Contrastes', icon: 'scale', group: 'analyze' },
  // Study mode — scoped to the 'estudio' vault type.
  { id: 'studyCourses', label: 'Cursos y asignaturas', icon: 'graduation', group: 'explore' },
  { id: 'studySchedule', label: 'Horarios', icon: 'clock', group: 'explore' },
  { id: 'studyCalendar', label: 'Calendario', icon: 'calendar', group: 'explore' },
  { id: 'studySearch', label: 'Buscar en el estudio', icon: 'search', group: 'explore' },
  { id: 'studyLibrary', label: 'Materiales de estudio', icon: 'book', group: 'explore' },
  { id: 'studyRecordings', label: 'Grabaciones', icon: 'microphone', group: 'explore' },
  { id: 'studyChat', label: 'Research chat', icon: 'chat', group: 'analyze' },
  { id: 'studyIdeas', label: 'Ideas de estudio', icon: 'bulb', group: 'analyze' },
  { id: 'studyGraph', label: 'Grafo de estudio', icon: 'network', group: 'analyze' },
  { id: 'studyQuestions', label: 'Banco de preguntas', icon: 'help', group: 'analyze' },
  { id: 'studyReview', label: 'Revisión', icon: 'flashcards', group: 'analyze' },
  { id: 'studyDeepResearch', label: 'Investigación de estudio', icon: 'telescope', group: 'analyze' },
  // Teaching mode — surfaces scoped to the 'docencia' vault type.
  { id: 'teachingGroups', label: 'Grupos', icon: 'users', group: 'explore' },
  { id: 'teachingGrades', label: 'Calificaciones', icon: 'chartBar', group: 'analyze' },
  { id: 'teachingExams', label: 'Exámenes', icon: 'notebook', group: 'analyze' },
  { id: 'teachingRubrics', label: 'Rúbricas', icon: 'table', group: 'analyze' },
  { id: 'teachingUnits', label: 'Diseño de unidades', icon: 'compass', group: 'create' },
  // Analizar — superficies derivadas del grafo y síntesis.
  { id: 'dictionary', label: 'Diccionario', icon: 'thesaurus', group: 'analyze' },
  { id: 'immersion', label: 'Inmersión', icon: 'target', group: 'analyze' },
  // 'gaps' NO tiene entrada propia: los huecos son una pestaña dentro del Estado de la
  // cuestión, porque solo significan algo mirando qué le falta a una pregunta concreta.
  // Sigue siendo una vista enrutable —Inicio, Buscar y el tour navegan a ella— y aterriza
  // en esa pestaña; ver src/app/views/corpus.tsx.
  // 'debate' NO tiene entrada propia, por la misma razón que 'gaps': un debate solo
  // significa algo junto a lo que el corpus cubre y a lo que le falta. Sigue siendo una
  // vista enrutable —Inicio, Buscar y el tour avanzado navegan a ella— y aterriza en su
  // pestaña; ver src/app/views/corpus.tsx.
  { id: 'research', label: 'Estado de la cuestión', icon: 'strata', group: 'analyze' },
  { id: 'hypothesis', label: 'Hipótesis', icon: 'flask', group: 'analyze' },
  { id: 'reading', label: 'Ruta de lectura', icon: 'route', group: 'analyze' },
  { id: 'deepResearch', label: 'Deep Research', icon: 'telescope', group: 'analyze' },
  // Herramientas — consultar la web, seguir novedades y procesar archivos.
  // Vistas universales: disponibles en todos los tipos de vault.
  { id: 'browser', label: 'Nodus Browser', icon: 'globe', group: 'tools' },
  { id: 'radar', label: 'Nodus Radar', icon: 'radar', group: 'tools' },
  { id: 'compass', label: 'Nodus Compass', icon: 'compass', group: 'tools' },
  { id: 'studyFocus', label: 'Nodus Focus', icon: 'focus', group: 'tools' },
  { id: 'toolkit', label: 'Nodus Tools', icon: 'tools', group: 'tools' },
  // One Scriptor shortcut per vault; stable route ids preserve links and snapshots.
  { id: 'workspace', label: 'Nodus Scriptor', icon: 'notebook', group: 'tools' },
  { id: 'notes', label: 'Nodus Scriptor', icon: 'notebook', group: 'tools' },
  { id: 'settings', label: 'Ajustes', icon: 'settings' },
];

/** Pages inside the Herramientas section. The toolkit keeps a SINGLE entry in the
 * View union — pinned tools use namespaced sidebar shortcut ids instead — so that
 * adding a tool never expands the vault-type allow-lists. 'home' is the catalogue. */
export type ToolkitPage = 'home' | ToolkitToolPage;

export type ToolkitStandalonePage = Extract<View, 'browser' | 'radar' | 'compass' | 'workspace' | 'notes' | 'studyFocus'>;
export type ToolkitCatalogPage = ToolkitToolPage | ToolkitStandalonePage;

export function isToolkitStandalonePage(page: ToolkitCatalogPage): page is ToolkitStandalonePage {
  return page === 'browser' || page === 'radar' || page === 'compass' || page === 'workspace' || page === 'notes' || page === 'studyFocus';
}

export function scriptorViewForVault(vaultType: unknown): 'workspace' | 'notes' | 'studyFocus' {
  return normalizeVaultType(vaultType) === 'academic' ? 'workspace' : 'notes';
}

export interface ToolkitToolDef {
  page: ToolkitCatalogPage;
  /** Marca de la herramienta; NO se traduce. */
  name: string;
  /** Clave i18n (español) de la descripción de la tarjeta. */
  description: string;
  icon: string;
  /** 'wip' = navegable pero en construcción; 'soon' = todavía no existe. */
  state: 'wip' | 'soon';
  /** Sufijo del data-testid de la tarjeta del hub. */
  testid: string;
}

/** Single source of truth for the toolkit catalogue. */
export const TOOLKIT_TOOLS = ([
  { page: 'backups', name: 'Backups', description: 'Exporta tu trabajo en Markdown, CSV o JSON y crea copias completas de Nodus.', icon: 'download', state: 'wip', testid: 'backups' },
  {
    page: 'workspace',
    name: 'Nodus Scriptor',
    description: 'Redacta, organiza y revisa artículos, tesis, notas y documentos.',
    icon: 'notebook',
    state: 'wip',
    testid: 'scriptor',
  },
  {
    page: 'studyFocus', name: 'Nodus Focus', icon: 'focus', state: 'wip', testid: 'focus',
    description: 'Concentra tu trabajo con un temporizador y un espacio que se adapta a cada bóveda.',
  },
  {
    page: 'apps',
    name: 'Nodus Apps',
    description: 'Crea herramientas para investigar, estudiar o enseñar con IA; adáptalas hablando y compártelas por QR.',
    icon: 'grid',
    state: 'wip',
    testid: 'apps',
  },
  {
    page: 'browser',
    name: 'Nodus Browser',
    description: 'Navega por la web y guarda fuentes para tu investigación.',
    icon: 'globe',
    state: 'wip',
    testid: 'browser',
  },
  {
    page: 'compass',
    name: 'Nodus Compass',
    description: 'Descubre literatura académica en fuentes abiertas.',
    icon: 'compass',
    state: 'wip',
    testid: 'compass',
  },
  {
    page: 'radar',
    name: 'Nodus Radar',
    description: 'Sigue fuentes y descubre novedades para tu investigación.',
    icon: 'radar',
    state: 'wip',
    testid: 'radar',
  },
  {
    page: 'convert',
    name: 'Nodus Convert',
    description: 'Convierte documentos, PDF e imágenes, con OCR ligero y utilidades de texto, de uno en uno o en lote.',
    icon: 'swap',
    state: 'wip',
    testid: 'convert',
  },
  {
    page: 'drift',
    name: 'Nodus Drift',
    description: 'Combina sonidos ambiente para acompañar la lectura, el estudio y el descanso, sin conexión.',
    icon: 'drift',
    state: 'wip',
    testid: 'drift',
  },
  {
    page: 'protect',
    name: 'Nodus Protect',
    description: 'Oculta datos, añade marcas de agua y crea o verifica copias trazables, siempre mediante procesamiento local.',
    icon: 'shield',
    state: 'wip',
    testid: 'protect',
  },
  {
    page: 'translate',
    name: 'Nodus Translate',
    description: 'Traduce texto, documentos y adjuntos de Zotero con el modelo que elijas, incluido un modo PDF facsímil.',
    icon: 'languages',
    state: 'wip',
    testid: 'translate',
  },
  {
    page: 'presenter',
    name: 'PDF Presenter',
    description: 'Presenta PDF y presentaciones externas como diapositivas, con vista del presentador, notas del orador y anotaciones en directo.',
    icon: 'presentation',
    state: 'wip',
    testid: 'presenter',
  },
  {
    page: 'ocr',
    name: 'OCR Workspace',
    description: 'OCR asistido por IA para escaneados difíciles, con revisión página a página e integración con tus bóvedas.',
    icon: 'scanText',
    state: 'wip',
    testid: 'aiocr',
  },
] satisfies ToolkitToolDef[]).sort((a, b) => a.name.localeCompare(b.name, 'en'));

export type ToolkitSidebarId = `toolkit:${ToolkitToolPage}`;

/** A pinned Toolkit page behaves like a sidebar item without becoming a View. */
export interface ToolkitSidebarNavItem {
  id: ToolkitSidebarId;
  label: string;
  icon: string;
  group: 'tools';
  toolkitPage: ToolkitToolPage;
}

export type SidebarNavItem = NavItem | ToolkitSidebarNavItem;

export function toolkitSidebarId(page: ToolkitToolPage): ToolkitSidebarId {
  return `toolkit:${page}`;
}

/** Derive sidebar shortcuts from the canonical Toolkit catalogue (including icons). */
export function pinnedToolkitSidebarItems(pages: unknown): ToolkitSidebarNavItem[] {
  const pinned = new Set(Array.isArray(pages) ? pages : []);
  return TOOLKIT_TOOLS
    .filter((tool): tool is typeof tool & { page: ToolkitToolPage } => !isToolkitStandalonePage(tool.page) && pinned.has(tool.page))
    .map((tool) => ({
      id: toolkitSidebarId(tool.page),
      label: tool.name,
      icon: tool.icon,
      group: 'tools' as const,
      toolkitPage: tool.page,
    }));
}

const VAULT_TYPE_LABELS: Partial<Record<VaultType, Partial<Record<View, string>>>> = {
  estudio: {
    notes: 'Nodus Scriptor',
  },
  docencia: {
    studyCourses: 'Cursos, asignaturas y grupos',
    studySearch: 'Buscar',
    studyLibrary: 'Materiales',
    studyChat: 'Research chat',
    studyIdeas: 'Ideas',
    studyGraph: 'Grafo',
    notes: 'Nodus Scriptor',
  },
  primary_sources: {
    timeline: 'Cronología',
    relations: 'Relaciones',
  },
  worldbuilding: {
    timeline: 'Cronología',
    relations: 'Relaciones',
    tree: 'Familias',
  },
};

/** The translated label key appropriate to the active vault mode. */
export function navItemLabel(item: NavItem, vaultType: string | undefined): string {
  return VAULT_TYPE_LABELS[normalizeVaultType(vaultType)]?.[item.id] ?? item.label;
}

/**
 * Resolve the sidebar items for a user-defined order. Home is pinned first and
 * Settings is pinned last; neither is ever part of the saved order. Any sections
 * missing from `sidebarOrder` (e.g. a view added in a newer version) are appended
 * in their default order so the list always stays complete.
 */
export function orderedNav(sidebarOrder: string[]): NavItem[] {
  const home = NAV_ITEMS.find((n) => n.id === 'home');
  const settings = NAV_ITEMS.find((n) => n.id === 'settings');
  const rest = NAV_ITEMS.filter((n) => n.id !== 'home' && n.id !== 'settings');
  const remaining = new Map(rest.map((n) => [n.id, n] as const));
  const ordered: NavItem[] = [];
  for (const id of sidebarOrder) {
    const item = remaining.get(id as View);
    if (item) {
      ordered.push(item);
      remaining.delete(id as View);
    }
  }
  for (const n of rest) if (remaining.has(n.id)) ordered.push(n);
  return [...(home ? [home] : []), ...ordered, ...(settings ? [settings] : [])];
}

export interface NavGroup extends NavGroupDef {
  items: SidebarNavItem[];
}

export interface StandardNavGroup extends NavGroupDef {
  items: NavItem[];
}

/**
 * Dedicated workspaces replace the generic research navigation instead of merely
 * hiding it by default. Keep their fixed top-level view ids here so both the real
 * sidebar and its Settings editor can exclude sections belonging to another mode.
 */
const DEDICATED_VAULT_NAV_IDS: Partial<Record<ReturnType<typeof normalizeVaultType>, View[]>> = {
  prosopography: [
    'prosopSearch', 'prosopPopulation', 'prosopPersons', 'prosopSources',
    'prosopAnalysis', 'prosopNetworks', 'researchChat', 'notes', 'browser', 'radar', 'compass', 'toolkit',
  ],
  primary_sources: [
    'search', 'archive', 'persons', 'timeline', 'map', 'relations', 'researchChat', 'notes', 'browser', 'radar', 'compass', 'toolkit',
  ],
  estudio: [
    'studyCourses', 'studySchedule', 'studyCalendar', 'studySearch', 'studyLibrary',
    'studyRecordings', 'studyChat', 'studyIdeas', 'studyGraph', 'studyQuestions',
    'studyReview', 'studyFocus', 'studyDeepResearch', 'notes', 'browser', 'radar', 'compass', 'toolkit',
  ],
  docencia: [
    'studyCourses', 'teachingGroups', 'studySchedule', 'studyCalendar', 'studyLibrary',
    'studyRecordings', 'studyChat', 'studyIdeas', 'studyGraph', 'studyQuestions',
    'teachingRubrics', 'teachingExams', 'teachingGrades', 'teachingUnits', 'notes', 'browser', 'radar', 'compass', 'toolkit',
  ],
  databases: ['pages', 'dbSearch', 'dbAnalysis', 'dbChat', 'dbDeepResearch', 'notes', 'browser', 'radar', 'compass', 'toolkit'],
  // Las ocho entradas acordadas del vault de Testimonios, menos Inicio y Ajustes, que
  // van fijas fuera de los grupos. Es una lista CERRADA a propósito: la regla de diseño
  // del vault es que solo sale al menú lo que atraviesa varias entrevistas.
  testimonios: ['search', 'testimonyInterviews', 'testimonyParticipants', 'testimonyContrasts', 'researchChat', 'notes', 'browser', 'radar', 'compass', 'toolkit'],
  worldbuilding: [
    'encyclopedia', 'characters', 'places', 'factions', 'cultures', 'timeline', 'map',
    'relations', 'tree', 'dynasties', 'worldChat', 'rules', 'conflicts', 'arcs',
    'continuity', 'questions', 'notes', 'scenes', 'manuscript', 'browser', 'radar', 'compass', 'toolkit',
  ],
};

/** Strict top-level navigation allow-list for dedicated vault workspaces. */
export function dedicatedVaultNavIds(vaultType: unknown): View[] | null {
  const ids = DEDICATED_VAULT_NAV_IDS[normalizeVaultType(vaultType)];
  return ids ? [...new Set<View>([...ids, 'studyFocus'])] : null;
}

/** Put a bounded set of sidebar items in the user's saved relative order. */
export function orderSidebarItems<T extends { id: string }>(items: readonly T[], sidebarOrder: string[]): T[] {
  const position = new Map(sidebarOrder.map((id, index) => [id, index]));
  return items
    .map((item, defaultIndex) => ({ item, defaultIndex, savedIndex: position.get(item.id) }))
    .sort((a, b) => {
      if (a.savedIndex !== undefined && b.savedIndex !== undefined) return a.savedIndex - b.savedIndex;
      if (a.savedIndex !== undefined) return -1;
      if (b.savedIndex !== undefined) return 1;
      return a.defaultIndex - b.defaultIndex;
    })
    .map(({ item }) => item);
}

/**
 * Group the (visible, ordered) sidebar sections for rendering. Groups appear in
 * {@link NAV_GROUPS} order; within each group the items keep the user's saved
 * order. Home and Settings are pinned outside groups and are not returned here.
 * Empty groups (all sections hidden) are dropped.
 */
export function groupedNav(sidebarOrder: string[], sidebarHidden: string[]): StandardNavGroup[];
export function groupedNav(
  sidebarOrder: string[],
  sidebarHidden: string[],
  toolkitPinnedPages: unknown,
): NavGroup[];
export function groupedNav(
  sidebarOrder: string[],
  sidebarHidden: string[],
  toolkitPinnedPages?: unknown,
): NavGroup[] {
  const hidden = new Set(sidebarHidden);
  const base = orderedNav(sidebarOrder).filter((n) => n.id !== 'home' && n.id !== 'settings');
  const pinned = pinnedToolkitSidebarItems(toolkitPinnedPages ?? []);
  const toolkitIndex = base.findIndex((item) => item.id === 'toolkit');
  const combined: SidebarNavItem[] = [...base];
  combined.splice(toolkitIndex >= 0 ? toolkitIndex + 1 : combined.length, 0, ...pinned);
  // Once a shortcut has been moved in Settings its saved position wins. A newly
  // pinned shortcut has no saved position yet and starts directly after Nodus Tools.
  const ordered = pinned.some((item) => sidebarOrder.includes(item.id))
    ? orderSidebarItems(combined, sidebarOrder)
    : combined;
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: ordered
      .filter((n) => n.group === g.id && !hidden.has(n.id)),
  })).filter((g) => g.items.length > 0);
}

export interface GraphNavigationTarget {
  nonce: number;
  preset?: GraphPresetId;
  nodeId?: string;
  edgeId?: string;
  workId?: string;
  workTitle?: string;
  zoteroKey?: string;
  theme?: string;
  search?: string;
  openTutor?: boolean;
  label?: string;
}

export interface AssistantNavigationTarget {
  nonce: number;
  prompt?: string;
  title?: string;
  selection?: ResearchContextSelection;
}

/** Navigation into the Library that pre-applies a filter (e.g. a corpus-health bucket). */
export interface LibraryNavigationTarget {
  nonce: number;
  /** Explicit scope for contextual entry points; ordinary navigation remembers the user's last scope. */
  scope?: LibraryScope;
  healthBucket?: CorpusHealthBucketId;
  /** Open a transverse Library item, entering its clean reader when available. */
  readerItemId?: string;
  /** Physical 1-based page the reader must jump to once the item is open. */
  readerPage?: number | null;
  readerAttachmentId?: string | null;
  /** Open the installed/downloadable CSL style manager. */
  citationStyles?: boolean;
}

/**
 * Navigation into the study library that opens one material. A citation adds the
 * point it was anchored to, so the viewer opens at that page or slide instead of
 * at the beginning of the file.
 */
export interface StudyMaterialNavigationTarget {
  id: string;
  pageNumber?: number | null;
  slideNumber?: number | null;
}

/** Navigation into Ideas that opens the complete detail panel for one idea. */
export interface IdeaNavigationTarget {
  nonce: number;
  ideaId: string;
}

export interface AuthorNavigationTarget {
  nonce: number;
  authorId: string;
  name: string;
}

export type PendingGraphNavigationTarget = Omit<GraphNavigationTarget, 'nonce'>;
export type PendingAssistantNavigationTarget = Omit<AssistantNavigationTarget, 'nonce'>;
export type PendingLibraryNavigationTarget = Omit<LibraryNavigationTarget, 'nonce'>;
export type PendingIdeaNavigationTarget = Omit<IdeaNavigationTarget, 'nonce'>;
export type PendingAuthorNavigationTarget = Omit<AuthorNavigationTarget, 'nonce'>;

export const ASSISTANT_CONTEXTS: Record<'idea' | 'gap' | 'contradiction' | 'reading', ResearchContextSelection> = {
  idea: {
    ideas: true,
    themes: true,
    contradictions: false,
    gaps: false,
    readingPath: false,
    authors: false,
    documents: false,
    passages: true,
    graph: true,
    graphParts: {
      ideaNodes: true,
      themeNodes: true,
      ideaEdges: true,
      authorGraph: false,
    },
  },
  gap: {
    ideas: true,
    themes: true,
    contradictions: false,
    gaps: true,
    readingPath: true,
    authors: false,
    documents: false,
    passages: true,
    graph: true,
    graphParts: {
      ideaNodes: true,
      themeNodes: true,
      ideaEdges: true,
      authorGraph: false,
    },
  },
  contradiction: {
    ideas: true,
    themes: true,
    contradictions: true,
    gaps: true,
    readingPath: false,
    authors: false,
    documents: true,
    passages: true,
    graph: true,
    graphParts: {
      ideaNodes: true,
      themeNodes: true,
      ideaEdges: true,
      authorGraph: false,
    },
  },
  reading: {
    ideas: true,
    themes: true,
    contradictions: true,
    gaps: true,
    readingPath: true,
    authors: true,
    documents: true,
    passages: true,
    graph: true,
    graphParts: {
      ideaNodes: true,
      themeNodes: true,
      ideaEdges: true,
      authorGraph: true,
    },
  },
};

/** Keep existing route IDs and histories while exposing one common chat entry. */
export function researchChatView(vaultType: unknown): View {
  switch (normalizeVaultType(vaultType)) {
    case 'databases': return 'dbChat';
    case 'estudio': case 'docencia': return 'studyChat';
    case 'worldbuilding': return 'worldChat';
    default: return 'researchChat';
  }
}
