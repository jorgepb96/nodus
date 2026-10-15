import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every user-facing string is authored in Spanish and translated via t()/tx() keyed
// by that Spanish source (see src/i18n.ts). A missing key silently falls back —
// which is exactly the bug the genealogy vault shipped with. This test enforces FULL
// coverage for EVERY translated language: it collects the keys the renderer asks for
// and asserts each has an entry in each table. When you add a new UI string, add its
// translations too, or this fails.
//
// Keys reach t() two ways, and both must be collected or the gap stays invisible:
//   - directly as a literal — including inside a ternary, `t(a ? 'X' : 'Y')`, which
//     is why the argument is scanned rather than just the first token after `t(`;
//   - indirectly from a data table translated at render time, e.g. navigation.ts
//     labels rendered as `t(n.label)`. Those hide best (the Spanish sidebar labels
//     shipped that way), so every such table is listed in INDIRECT_KEY_SOURCES.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-i18n-'));

/** Bundle a TS module so its real exported values can be asserted on. */
function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  // esbuild's own API, not its command line: `node_modules/.bin/esbuild` is a shell
  // script Windows cannot execute, and `node_modules/esbuild/bin/esbuild` is the
  // platform binary on macOS/Linux (handing a Mach-O file to `node` fails). buildSync
  // behaves identically everywhere and keeps this helper synchronous.
  buildSync({
    entryPoints: [path.join(repoRoot, file)],
    outfile: bundle,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    logLevel: 'silent',
  });
  return require(bundle);
}

/**
 * Every language the interface is translated into; Spanish is the source, so it has
 * no table. Add a language here and it inherits every check below.
 */
const TRANSLATIONS = [
  { name: 'English', lang: 'en', file: 'src/i18n.en.ts', export: 'EN' },
  { name: 'French', lang: 'fr', file: 'src/i18n.fr.ts', export: 'FR' },
  { name: 'German', lang: 'de', file: 'src/i18n.de.ts', export: 'DE' },
  { name: 'European Portuguese', lang: 'pt', file: 'src/i18n.pt.ts', export: 'PT' },
  { name: 'Brazilian Portuguese', lang: 'pt-BR', file: 'src/i18n.pt-BR.ts', export: 'PT_BR' },
  { name: 'Italian', lang: 'it', file: 'src/i18n.it.ts', export: 'IT' },
  { name: 'Turkish', lang: 'tr', file: 'src/i18n.tr.ts', export: 'TR' },
  { name: 'Simplified Chinese', lang: 'zh-CN', file: 'src/i18n.zh-CN.ts', export: 'ZH_CN' },
  { name: 'Traditional Chinese', lang: 'zh-TW', file: 'src/i18n.zh-TW.ts', export: 'ZH_TW' },
  { name: 'Japanese', lang: 'ja', file: 'src/i18n.ja.ts', export: 'JA' },
  { name: 'Korean', lang: 'ko', file: 'src/i18n.ko.ts', export: 'KO' },
].map((entry) => ({ ...entry, table: loadModule(entry.file)[entry.export] }));

// Server Web renders through its own adapter: t() there walks the server
// catalogues in src/serverWeb/i18nShim.ts before the desktop tables, so its
// strings legitimately live outside src/i18n.<lang>.ts. hasServerTranslation
// answers, for one locale, whether those catalogues hold a key at all.
const { hasServerTranslation } = loadModule('src/serverWeb/i18nShim.ts');
const SERVER_WEB_DIR = 'src/serverWeb/';
const isServerWebFile = (file) => file.split(path.sep).join('/').startsWith(SERVER_WEB_DIR);

const EN = TRANSLATIONS[0].table;
const enKeys = new Set(Object.keys(EN));

const ISSUE_12_RUNTIME_KEYS = [
  // Reading path payload assembled in Electron and rendered by ReadingPathView.
  'Ruta optimizada por {strategy}: {shown} lecturas priorizadas de {total} obras, agrupadas en fases manejables.',
  'Lecturas fundamentales',
  'Base conceptual y dependencias intelectuales que conviene leer antes de avanzar.',
  'Huecos de investigación',
  'Textos más útiles para cubrir o delimitar huecos detectados en el corpus.',
  'Ampliación de temas secundarios',
  'Lecturas que amplían temas del proyecto sin saturar una sola línea temática.',
  'Contrastar ideas o contradicciones',
  'Documentos conectados con relaciones, refutaciones o contradicciones ya analizadas.',
  'Lecturas pendientes de análisis',
  'Ítems no leídos o poco procesados que conviene analizar para decidir si entran al mapa.',
  'Leídas sin incorporar al mapa',
  'Obras marcadas como leídas en Zotero pero todavía sin análisis profundo suficiente.',
  'Siguientes mejores opciones',
  'Lecturas restantes que todavía aportan señales relevantes para el criterio elegido.',
  // Queue title, progress and states.
  'Descubrir relaciones semánticas',
  'Analizando con IA…',
  'Resumiendo…',
  'Escaneando pares semánticos…',
  'En cola',
  'En curso',
  'Completado',
  'Fallido',
  'Cancelado',
  'Pausado',
  // Vault switching errors returned as successful IPC payloads rather than throws.
  'No se puede cambiar de bóveda con la cola de análisis activa. Pausa o termina los trabajos pendientes antes de cargar otra bóveda.',
  'No se puede cambiar de bóveda mientras se están indexando embeddings de ideas.',
  'No se puede cambiar de bóveda mientras se están indexando pasajes.',
  'No se puede cambiar de bóveda mientras se descubren relaciones semánticas.',
  'Bóveda no encontrada.',
  // Active filter chips.
  'Análisis profundo hecho',
  'Análisis profundo NO hecho',
  'Ideas extraídas',
  'Sin ideas extraídas',
  'Pasajes completos',
  'Pasajes incompletos',
];

// The Cloudflare deployment prose the main process writes and the modal renders through
// tr(): step details, catalogue warnings and every failure. None of them appears inside a
// t() call anywhere, so without this list the whole "Deploy to Cloudflare" flow can ship
// Spanish to the other six languages — which is exactly how it was first published.
const CLOUDFLARE_RUNTIME_KEYS = [
  // Step details.
  'El secreto permanece cifrado en este dispositivo',
  'Recursos creados directamente por Cloudflare',
  'Cloudflare no compartió credenciales de cuenta con Nodus',
  '{name} · protocolo {version}',
  // Pricing-catalogue warnings, shown as the detail of the first step.
  'Se usa el catálogo incluido en esta versión de Nodus. Comprueba los enlaces oficiales antes de contratar un plan.',
  'No se pudo verificar el catálogo actualizado; la estimación usa la copia incluida y muestra siempre la documentación oficial.',
  // Failures raised while estimating, preparing or connecting.
  'El catálogo de precios de Cloudflare no tiene un formato compatible.',
  'La configuración del catálogo de Cloudflare no es compatible.',
  'La plantilla de Nodus Cloud debe ser un repositorio público HTTPS de GitHub o GitLab.',
  'La dirección de Nodus Cloud debe usar HTTPS.',
  'La dirección no puede contener credenciales.',
  'Esta dirección no corresponde a un despliegue compatible de Nodus Cloud.',
  'El Worker respondió con HTTP {status}.',
  'No se pudo inicializar Nodus Cloud (HTTP {status}).',
  'El Worker ya estaba configurado, pero no contiene un espacio para este vault. Usa la conexión avanzada para elegir el espacio correcto.',
  'El Worker ya estaba configurado, pero no publicó su identificador de recuperación. Actualiza la plantilla de Nodus Cloud.',
  'No se pudo preparar la estimación de Cloudflare.',
  'Escribe un correo de administración válido.',
  'La contraseña de Nodus Cloud debe tener al menos 12 caracteres.',
  'Prepara primero el despliegue para crear el código de configuración.',
  'El Worker devolvió una clave de recuperación inesperada; Nodus no guardará esta conexión.',
];

// Why a writing-workshop candidate was retrieved. The sentence is written by the retrieval
// pass in the main process (`electron/ai/writingWorkshop.ts`) and reaches the badge through
// the renderer's `tr()`, so no `t()` call anywhere mentions it and a missing table entry
// would silently show Spanish beside an English interface.
const WORKSHOP_RUNTIME_KEYS = [
  'Recuperado por similitud semántica con esta sección.',
];

test.after(() => rm(outDir, { recursive: true, force: true }));

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (/\.(tsx?)$/.test(e.name) && !e.name.startsWith('i18n')) out.push(p);
  }
  return out;
}

// Data tables whose Spanish values are handed to t() from somewhere else.
const INDIRECT_KEY_SOURCES = [
  { file: 'src/academicInterfaceProfiles.ts', pattern: /\b(?:label|description):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  { file: 'src/components/AcademicInterface.tsx', pattern: /\b(?:title|body|action):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Exploration errors are caught by the workspace and translated through errorText().
  { file: 'src/stellarGraph/exploration.ts', pattern: /throw new Error\((["'])((?:\\.|(?!\1).)*?)\1\)/g },
  // Nodi's notification catalogue. Electron stores the KEY and its values, and the
  // panel renders them through notificationLine() → tx(), so none of these sentences
  // ever appears literally inside a t() call. Leaving one untranslated is what made
  // the centre answer "this message could not be translated".
  { file: 'shared/nodiNotifications.ts', pattern: /^\s{2}\w+:\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // The processing log's catalogue. The main process stores the KEY and its values and the
  // log modal renders them through txIn(), so — exactly like the notifications above — none
  // of these sentences is ever a t() literal. This one matters twice over: the log is written
  // by the pipeline in whichever vault happens to be running, and its reader can pick a
  // different language for the lines, so a sentence with no translation is stuck in Spanish
  // for a log that is meant to be pasted into a GitHub issue.
  { file: 'shared/pipelineLogMessages.ts', pattern: /^\s{2}\w+:\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // The six "Deploy to Cloudflare" step labels. They are written in Electron and the modal
  // renders them as t(step.label), so nothing else can see them.
  { file: 'electron/cloudflare/deployment.ts', pattern: /^ {2}(?:'[\w-]+'|\w+):\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // The cost table's metric names and units, positional arguments of line() and rendered
  // as t(line.metric) / t(line.unit). The service name (first argument) is a brand.
  { file: 'electron/cloudflare/pricing.ts', pattern: /\bline\('[^']*',\s*(')((?:\\.|(?!\1).)*?)\1/g },
  { file: 'electron/cloudflare/pricing.ts', pattern: /\bline\('[^']*',\s*'[^']*',\s*[^,]+,\s*(')((?:\\.|(?!\1).)*?)\1/g },
  // Sidebar + command palette labels, rendered as t(n.label) / t(g.label) in App.tsx.
  { file: 'src/stellarGraph/palette.ts', pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  { file: 'src/stellarGraph/palette.ts', pattern: /^  (?:claim|finding|construct|method|framework): (["'])(?!#)((?:\\.|(?!\1).)*?)\1/gm },
  { file: 'src/navigation.ts', pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // The Bookmarks page's sort options, rendered as t(option.label).
  { file: 'src/components/browser/NodusStartPages.tsx', pattern: /\{ sort: '[\w-]+', label: (["'])((?:\\.|(?!\1).)*?)\1/g },
  // Settings tab labels, rendered as t(tab.label).
  { file: 'src/views/Settings.tsx', pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Nodus Toolkit catalogue: category / operation / output / option / choice labels,
  // operation descriptions and option placeholders, all rendered through t() in the
  // Convert view.
  { file: 'shared/toolkitTypes.ts', pattern: /\b(?:label|description|placeholder):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Nodus Drift: the category names (shared/drift.ts) and the name and description of every
  // sound in the catalogue (shared/driftCatalog.ts). They are Spanish keys handed to t() as
  // t(sound.nameKey) / t(category.nameKey), so none of them is ever a literal inside a t() call.
  { file: 'shared/drift.ts', pattern: /\bnameKey:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  { file: 'shared/driftCatalog.ts', pattern: /\b(?:nameKey|descriptionKey):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Tour steps are plain object literals fed through t() by the tour engine.
  ...['Tour', 'AdvancedTour', 'StudyTour', 'GenealogyTour', 'DatabasesTour', 'TeachingTour', 'PrimarySourcesTour', 'TestimonyTour', 'ProsopographyTour', 'WorldbuildingTour'].map((name) => ({
    file: `src/views/${name}.tsx`,
    pattern: /(?:title|body|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  })),
  // Testimony field and participant-picker labels are Spanish keys passed as JSX
  // props and translated inside the reusable component.
  ...[
    'src/components/testimonies/InterviewAgreement.tsx',
    'src/components/testimonies/InterviewOverview.tsx',
    'src/components/testimonies/InterviewSessions.tsx',
    'src/components/testimonies/NewInterviewModal.tsx',
    'src/views/TestimonyInterviewsView.tsx',
    'src/views/TestimonyParticipantsView.tsx',
  ].map((file) => ({
    file,
    pattern: /\b(?:label|hint)=\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  })),
  // The chat's copy table: one component serves the study and the teaching vault, and
  // the strings that address the reader differ between them, so they reach t() as
  // t(copy.x) / t(starter) instead of as literals. Two patterns: the named fields, and
  // the starter prompts, which are bare entries of the `starters` array.
  { file: 'src/views/StudyChatView.tsx', pattern: /\b(?:title|subtitle|historyEmpty|scopeNote):\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  { file: 'src/views/StudyChatView.tsx', pattern: /^\s{6}(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // Deep Research / Unit design: one component, four artefact names (report, family
  // history, study report, teaching unit). Its copy table reaches t() as t(copy.x) and
  // t(step.title) / t(step.body) for the tutorial cards.
  { file: 'src/views/DeepResearchView.tsx', pattern: /\b(?:heading|subtitle|newAction|composerSubtitle|objectivePlaceholder|missingObjective|queuedToast|deleteTitle|deleteMessage|deletedToast|searchPlaceholder|loading|noMatch|empty|title|body):\s*(["'])((?:\\.|(?!\1).)*?)\1,?$/gm },
  // Why the CSV import suggested a column type, rendered as t(s.reason) in the import modal.
  { file: 'shared/databaseCsv.ts', pattern: /\bpick\([^,]+,\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Column type + rollup function names, rendered as t(columnTypeDef(x).label) / t(f.label).
  { file: 'shared/databases.ts', pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Exam question-type catalogue (label/description) and the builder's validation
  // messages, rendered as t(def.label) / t(issue.message) in ExamBuilderView.
  { file: 'shared/teachingExams.ts', pattern: /\b(?:label|description|message):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Rubric level-set presets and the quality-check messages, rendered as
  // t(preset.label) / t(issue.message) in RubricsView.
  { file: 'shared/teachingRubrics.ts', pattern: /\b(?:label|message):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Assessment presets: the model picker renders t(p.label) / t(p.hint) when creating a
  // gradebook, so those strings never appear literally inside a t() call.
  { file: 'shared/assessment/profiles.ts', pattern: /\b(?:label|hint):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Formula recipe / operation / statistic names and hints, rendered as t(r.label) / t(r.hint).
  { file: 'shared/databaseFormula.ts', pattern: /\b(?:label|hint):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // validateFormula's problems, surfaced through t(problem) in the editor and t(error) in the
  // cell. Only sentences: a returned single word here is a discriminant ('number'), not a key.
  { file: 'shared/databaseFormula.ts', pattern: /\breturn (["'])((?:\\.|(?!\1).)*?\s(?:\\.|(?!\1).)*?)\1;/g },
  // Formula errors written onto a row, surfaced through t(error) in the cell.
  { file: 'shared/databaseFormulaEval.ts', pattern: /\bsetError\([^,]+,[^,]+,\s*(?:problem \?\? )?(["'])((?:\\.|(?!\1).)*?)\1/g },
  // describeFormula stitches its sentence from words, each passed through the injected t().
  { file: 'shared/databaseFormulaEval.ts', pattern: /\bt\((["'])((?:\\.|(?!\1).)*?)\1\)/g },
  // Where a conflicting birth/death year came from ('ficha', 'bautismo'…), rendered as
  // t(v.label) in the ficha's "Hechos en conflicto" section.
  { file: 'shared/conflictDetection.ts', pattern: /\bcollect\([^,]+,[^,]+,\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  { file: 'shared/conflictDetection.ts', pattern: /^\s{2}\w+:\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // Geometry names, rendered as t(GEOMETRY_LABEL[marker.geometryKind]) in the marker
  // sheet. Dynamic, so none of them would be collected.
  { file: 'src/components/world/mapMarkers.tsx', pattern: /^ {2}(?:point|circle|polygon|path): (["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // Cartographic style names, rendered as t(style.label) in the generation panel.
  { file: 'shared/mapPrompt.ts', pattern: /\blabel: (["'])((?:\\.|(?!\1).)*?)\1/g },
  // Distance-unit labels, rendered as t(UNIT_LABEL[unit]) by the scale bar, the ruler and
  // the calibration panel. Every one of them is dynamic, so none would be collected.
  { file: 'src/components/world/mapTools.tsx', pattern: /^ {2}(?:km|mi|m|ft|league|custom): (["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // Map kind names, rendered as t(kind.label) in the map cards, the side panel and the
  // creation modal. They never appear literally inside a t() call.
  { file: 'src/views/WorldMapsView.tsx', pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Database Deep Research report modes are defined in shared code and rendered as
  // t(option.label)/t(option.description) by the database research view. Keep this
  // indirect source explicit so adding a mode cannot silently ship Spanish copy.
  { file: 'shared/databaseDeepResearch.ts', pattern: /\b(?:label|description):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // "Extensión orientativa de cada sección": the option labels and the custom-value
  // validation messages live in shared code because three composers (Deep Research,
  // Database Deep Research and its Server Web twin) render the same control through
  // t(option.label) / t(check.message). Without this entry a new option or a new
  // validation message would ship in Spanish to every other locale.
  { file: 'shared/deepResearchSectionLength.ts', pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  { file: 'shared/deepResearchSectionLength.ts', pattern: /^\s{2}(?:'[\w-]+'|\w+):\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // El vocabulario visible de Testimonios: estados del flujo, del acuerdo y del acceso,
  // usos documentados, papeles, tipos de transcripción y motivos de denegación. TODO
  // llega a la interfaz como t(LABEL[x]) — nunca como literal dentro de un t() — así que
  // sin registrarlo aquí una etiqueta sin traducir pasaría desapercibida, que es
  // exactamente como el vault de genealogía se publicó a medias.
  { file: 'shared/testimonyLabels.ts', pattern: /^\s{2}\w+:\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // El sidebar propio de Testimonios: sus grupos y sus entradas se pintan con t(item.label).
  { file: 'src/components/TestimonySidebar.tsx', pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Las siete vistas guardadas de la tabla de entrevistas, rendidas como t(view.label).
  { file: 'shared/testimonies.ts', pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Worldbuilding character vocabularies (life status, narrative role, event kinds),
  // rendered as t(CHARACTER_*_LABEL[x]) in the grid, the sheet and the AI prompts. The
  // two-space-indent form deliberately skips the `{ id: 'violet', hex: '#7c3aed' }`
  // one-liners in the alias-kind and accent arrays, whose tokens are not keys; their
  // `label:` values are collected by the pattern after it.
  { file: 'shared/characterLabels.ts', pattern: /^\s{2}\w+:\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  { file: 'shared/characterLabels.ts', pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Arc / voice field prompts, rendered as t(field.label) / t(field.hint) in the sheet.
  { file: 'shared/characterLabels.ts', pattern: /\bhint:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Archetype template names and descriptions, rendered as t(entry.label) /
  // t(characterTemplate(id).description) in the creation modal.
  { file: 'shared/characterTemplates.ts', pattern: /\b(?:label|description):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Coherence-check messages, surfaced through t()/tx() in the sheet's Revisar section.
  { file: 'shared/characterChecks.ts', pattern: /\bmessage:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // World section descriptors: the workspace renders t(section.title), t(section.createLabel)
  // and so on, so these literals never appear inside a t() call. Without this the strings
  // pass only because they happened to be direct t() calls before the refactor.
  {
    file: 'src/views/ScenesView.tsx',
    pattern: /\b(?:title|searchPlaceholder|createLabel|emptyLabel|noMatchLabel|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  {
    file: 'src/views/CharactersView.tsx',
    pattern: /\b(?:title|searchPlaceholder|createLabel|emptyLabel|noMatchLabel|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  {
    file: 'src/views/PlacesView.tsx',
    pattern: /\b(?:title|searchPlaceholder|createLabel|emptyLabel|noMatchLabel|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  {
    file: 'src/views/GroupsView.tsx',
    pattern: /\b(?:title|create|search|empty|noMatch|label|generateLabel):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  {
    file: 'src/views/WorldbuildingHome.tsx',
    pattern: /\b(?:label|hint):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  {
    file: 'src/views/WorldChatView.tsx',
    pattern: /^ {2}(?:character|place|group|scene|article):\s*(["'])([A-ZÁÉÍÓÚÑ](?:\\.|(?!\1).)*?)\1,?$/gm,
  },
  {
    file: 'src/components/WorldbuildingSidebar.tsx',
    pattern: /\blabel:\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  {
    file: 'src/components/world/WorldGallery.tsx',
    pattern: /\b(?:title|generateLabel)\s*=\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  {
    file: 'src/views/EncyclopediaView.tsx',
    pattern: /\b(?:title|searchPlaceholder|createLabel|emptyLabel|noMatchLabel|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  {
    file: 'src/views/RulesView.tsx',
    pattern: /\b(?:title|searchPlaceholder|createLabel|emptyLabel|noMatchLabel|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  // The rule vocabularies and the suggestion titles, all rendered through t(MAP[x]).
  { file: 'shared/worldRules.ts', pattern: /^  \w+:\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // Bare array elements (the suggestion titles). TWO capture groups, like every other
  // pattern here: the collector reads the quote from group 1 and the string from group 2,
  // and a one-group pattern makes it read `undefined`.
  { file: 'shared/worldRules.ts', pattern: /^  (["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  {
    file: 'src/views/ArcsView.tsx',
    pattern: /\b(?:title|searchPlaceholder|createLabel|emptyLabel|noMatchLabel|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  {
    file: 'src/views/ConflictsView.tsx',
    pattern: /\b(?:title|searchPlaceholder|createLabel|emptyLabel|noMatchLabel|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  {
    file: 'src/views/ContinuityView.tsx',
    pattern: /\b(?:title|searchPlaceholder|createLabel|emptyLabel|noMatchLabel|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  {
    file: 'src/views/QuestionsView.tsx',
    pattern: /\b(?:title|searchPlaceholder|createLabel|emptyLabel|noMatchLabel|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  // The open-question vocabularies: status, origin, what answering will write, and how
  // urgent it is — every one of them rendered as t(MAP[x]) and invisible otherwise. The
  // `\w+:` form deliberately skips WORLD_PLACEHOLDER_TOKENS, whose entries ('???', 'TBD')
  // are marks the author types, not text to translate.
  { file: 'shared/worldQuestions.ts', pattern: /^  \w+:\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // The severity labels, rendered as t(SEVERITY_LABEL[x]).
  { file: 'src/views/ContinuityView.tsx', pattern: /^  (?:contradiction|warning|gap):\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // The encyclopedia's vocabularies: entry kinds, article categories and the field a link
  // was written in, all rendered as t(MAP[x]).
  { file: 'shared/worldEncyclopedia.ts', pattern: /^  \w+:\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // The scene-day chain: the mode labels, plus the KEYS describeSceneDay() returns. Those
  // keys are handed to t()/tx() through a variable, so nothing else can see them.
  { file: 'shared/worldSceneDays.ts', pattern: /^  \w+:\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  { file: 'shared/worldSceneDays.ts', pattern: /\bkey:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Threads and beats: the four-word vocabularies, all rendered as t(MAP[x]).
  { file: 'shared/worldThreads.ts', pattern: /^  \w+:\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  // The manuscript's own finding: its headline and detail are a KEY plus variables, handed
  // to tx() through a variable, so nothing else can see them.
  { file: 'shared/worldManuscript.ts', pattern: /\bkey:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Continuity: the family and mute-reason labels, and every finding headline. A finding's
  // text is a KEY plus vars precisely so it can be collected here; a finished sentence
  // would stay Spanish in the other six languages.
  { file: 'shared/worldFindings.ts', pattern: /^  \w+:\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  { file: 'shared/worldContinuity.ts', pattern: /\bkey:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  { file: 'shared/worldContinuity.ts', pattern: /\b(?:label|explains):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // Scene status labels, rendered as t(SCENE_STATUS_LABEL[x]).
  { file: 'src/views/ScenesView.tsx', pattern: /^  (?:outline|draft|written):\s*(["'])((?:\\.|(?!\1).)*?)\1,$/gm },
  {
    file: 'src/views/GroupsView.tsx',
    pattern: /\b(?:title|search|create|empty|noMatch|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  {
    file: 'src/views/PlacesView.tsx',
    pattern: /\b(?:title|searchPlaceholder|createLabel|emptyLabel|noMatchLabel|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
  // Place kinds and their picker groups, rendered as t(kind.label) / t(group.group).
  { file: 'shared/placeKinds.ts', pattern: /\b(?:label|group):\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  // The scale warning, surfaced through tx(warning.message, …) in the place sheet.
  { file: 'shared/placeKinds.ts', pattern: /\bmessage:\s*(["'])((?:\\.|(?!\1).)*?)\1/g },
  {
    file: 'src/views/CharactersView.tsx',
    pattern: /\b(?:title|searchPlaceholder|createLabel|emptyLabel|noMatchLabel|label):\s*(["'])((?:\\.|(?!\1).)*?)\1/g,
  },
];

// Literals that sit inside a t() call but are not keys: they index a label map
// whose *values* are the real keys, e.g. t(LABELS[state ?? 'empty']).
const NOT_KEYS = new Set(['none', 'empty']);

/** Yield the balanced argument text of every t()/tx() call in `src`. */
function* translationCallArgs(src) {
  const re = /\bt[x]?\(/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === "'" || c === '"' || c === '`') {
        const quote = c;
        i++;
        while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
      }
      i++;
    }
    yield src.slice(start, i - 1);
  }
}

/** Remove literals that are compared or used as a lookup index, not translated. */
function stripNonKeyLiterals(arg) {
  return arg
    .replace(/(?:===|!==|==|!=)\s*(["'])(?:\\.|(?!\1).)*?\1/g, '')
    .replace(/(["'])(?:\\.|(?!\1).)*?\1\s*(?:===|!==|==|!=)/g, '')
    .replace(/\.(?:includes|startsWith|endsWith|split|join|has|get)\(\s*(["'])(?:\\.|(?!\1).)*?\1\s*\)/g, '')
    .replace(/\[[^\]]*(["'])(?:\\.|(?!\1).)*?\1\s*\]/g, '')
    // A media query steering which label t() returns, e.g.
    // t(matchMedia('(max-width: 760px)').matches ? 'Cerrar' : 'Abrir'). The
    // breakpoint is never UI text; only the labels around it are.
    .replace(/\bmatchMedia\(\s*(["'])(?:\\.|(?!\1).)*?\1\s*\)/g, '');
}

/** Slice the balanced {...} or [...] literal that starts at `openIdx`. */
function sliceBalanced(src, openIdx) {
  const open = src[openIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(openIdx, i + 1); }
    else if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
    }
  }
  return src.slice(openIdx);
}

// A value that reads like a display label (so we translate it) rather than an enum
// key, icon name or css class (which we must not): has a space, or starts uppercase,
// or carries a Spanish diacritic. This keeps 'Fácil'/'Lun'/'Sesión de estudio' and
// drops 'graduation'/'bg-red-500'/'short'/'pending'.
const isDisplayLabel = (v) => /\s/.test(v) || /^[A-ZÁÉÍÓÚÑ¿¡]/.test(v) || /[ñáéíóúÁÉÍÓÚÑ]/.test(v);

// Values a followed map holds that are NOT translatable UI prose and must be dropped,
// or the test would demand a bogus translation: css/gradients/tailwind classes; format
// acronyms (CSV, PDF, EPUB — language-neutral); language endonyms (shown in their own
// name); and the lowercase, punctuation-free keyword blobs used for settings search.
function isNotTranslatable(v) {
  if (/[#(){}]|gradient|linear-|radial-|rgba?\(|\d\s*%|border-|bg-|text-|rounded|shadow|ring-|\bflex\b|\bgrid\b|px-|py-|-\d/.test(v)) return true;
  if (/^[A-Z0-9][A-Z0-9./+-]{1,5}$/.test(v)) return true; // acronyms / format tokens
  if (/^(English|Deutsch|Français|Italiano|Português|Português do Brasil|Türkçe|Español|Nederlands|Polski)$/.test(v)) return true;
  const words = v.trim().split(/\s+/);
  if (words.length >= 4 && !/[A-ZÁÉÍÓÚÑ¿¡.?!:]/.test(v)) return true; // search-keyword blob
  return false;
}

/**
 * Follow the label MAPS/ARRAYS a file hands to t() indirectly — `t(MAP[x])`,
 * `t(cond ? MAP[a] : MAP[b])`, `Object.entries(MAP).map(([, l]) => t(l))`,
 * `ARR.map((x) => t(x))` — and record their display-label string values. This is the
 * pattern that keeps shipping Spanish (DAY_LABELS, TYPE_LABELS, STARTERS, WEEKDAYS…):
 * the literal scan can't see the string because it lives in a const, not in the call.
 */
function collectMapLabels(src, file, record, unescape) {
  const translatedObjectIteration = (name) => {
    const uses = src.matchAll(new RegExp(`\\bObject\\.(?:entries|values)\\(\\s*${name}\\s*\\)`, 'g'));
    for (const use of uses) {
      const start = (use.index ?? 0) + use[0].length;
      const statementEnd = src.indexOf(';', start);
      const end = statementEnd < 0 ? src.length : statementEnd;
      const chain = src.slice(start, end);
      const iteration = /\.(?:map|flatMap|forEach)\s*\(/g.exec(chain);
      if (!iteration) continue;
      const openParen = start + iteration.index + iteration[0].lastIndexOf('(');
      if (/\bt[x]?\s*\(/.test(sliceBalanced(src, openParen))) return true;
    }
    return false;
  };
  const defRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*([[{])/g;
  let m;
  while ((m = defRe.exec(src))) {
    const name = m[1];
    const isArray = m[2] === '[';
    const body = sliceBalanced(src, m.index + m[0].length - 1);
    const consumed =
      new RegExp(`\\bt[x]?\\([^)]*\\b${name}\\s*\\[`).test(src) ||           // t(NAME[..]) incl. ternaries
      new RegExp(`\\bt[x]?\\(\\s*${name}\\s*\\)`).test(src) ||               // t(NAME)
      translatedObjectIteration(name) ||
      // array of primitive strings mapped with a t() in the file: t(element). An array
      // of OBJECTS (contains `{`) is mapped by its fields, not its elements → skip.
      (isArray && !body.includes('{') && new RegExp(`\\b${name}\\.(?:map|flatMap|forEach)\\(`).test(src) && /\bt[x]?\(/.test(src));
    if (consumed) {
      for (const s of body.matchAll(/(["'])((?:\\.|(?!\1).)*?)\1/g)) {
        const v = unescape(s[2]);
        if (isDisplayLabel(v) && !isNotTranslatable(v)) record(v, file);
      }
      continue;
    }
    // Array of OBJECTS mapped with t(x.field), e.g. DESTINATIONS.map(d => t(d.title)):
    // collect only the human-text fields, keyed by field name so non-text fields
    // (icon, view, color) are never demanded.
    if (new RegExp(`\\b${name}\\.(?:map|flatMap|forEach)\\(`).test(src) && /\bt[x]?\(\s*\w+\.\w/.test(src)) {
      for (const s of body.matchAll(/\b(?:label|title|description|hint|subtitle|body|name|text|caption|heading|tooltip|summary)\s*:\s*(["'])((?:\\.|(?!\1).)*?)\1/g)) {
        const v = unescape(s[2]);
        if (isDisplayLabel(v) && !isNotTranslatable(v)) record(v, file);
      }
    }
  }
}

/** Every key the renderer asks t()/tx() for, mapped to the file that asks. */
function collectTranslatableStrings() {
  const found = new Map(); // string -> file
  const record = (val, file) => {
    if (!val || NOT_KEYS.has(val) || !/[a-zA-Z]/.test(val)) return;
    const rel = path.relative(repoRoot, file);
    const seen = found.get(val);
    // A string used by Desktop and by Server Web belongs to the desktop
    // catalogue, so a desktop file always wins the attribution and the string
    // keeps being held to the full per-language requirement below.
    if (seen === undefined || (!isServerWebFile(rel) && isServerWebFile(seen))) {
      found.set(val, rel);
    }
  };
  const unescape = (s) => s
    .replace(/\\n/g, '\n')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\`/g, '`');

  for (const f of walk(path.join(repoRoot, 'src'))) {
    // Bundled mini-apps run in their own iframe and use a private seven-language
    // copy table. scripts/test-toolkit-apps.mjs checks those tables independently.
    if (/[/\\]toolkitApps[/\\]included(?:Roulette|TopicDistributor)\.ts$/.test(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const arg of translationCallArgs(src)) {
      if (arg.length > 600) continue; // a long expression, not a literal key
      for (const m of stripNonKeyLiterals(arg).matchAll(/(["'])((?:\\.|(?!\1).)*?)\1/g)) {
        record(unescape(m[2]), f);
      }
    }
    collectMapLabels(src, f, record, unescape);
  }
  for (const { file, pattern } of INDIRECT_KEY_SOURCES) {
    const full = path.join(repoRoot, file);
    const src = fs.readFileSync(full, 'utf8');
    for (const m of src.matchAll(pattern)) record(unescape(m[2]), full);
  }
  return found;
}

for (const { name, lang, file, table } of TRANSLATIONS) {
  test(`every t()/tx() string and tour step has a ${name} translation`, () => {
    const strings = collectTranslatableStrings();
    const missing = [...strings].filter(([s, f]) => {
      if (s in table) return false;
      // A Server Web string is answered by the server catalogues instead. It
      // still must never reach the renderer untranslated: either this locale
      // or English has to hold it, or the screen shows the Spanish source.
      if (isServerWebFile(f)) {
        return !(hasServerTranslation(lang, s) || hasServerTranslation('en', s));
      }
      return true;
    });
    const report = missing.map(([s, f]) => `  ${f}: ${JSON.stringify(s)}`).join('\n');
    assert.equal(
      missing.length,
      0,
      `Untranslated strings (add to ${file}, or to src/i18n.server.ts for src/serverWeb):\n${report}`
    );
  });
}

// Server Web strings only English can answer. Every other locale would fall
// through to the English safety net there, so a French reader would see English
// on a published surface. The catalogue now covers all seven languages, and this
// ceiling holds it at zero: a new string has to be translated, not left to the
// fallback. Raise it only to record a gap you mean to keep.
const SERVER_WEB_ENGLISH_ONLY_CEILING = 0;

test('Server Web strings left to the English safety net stay a bounded set', () => {
  const strings = collectTranslatableStrings();
  const englishOnly = [...strings].filter(
    ([s, f]) =>
      isServerWebFile(f) &&
      TRANSLATIONS.some(
        ({ lang, table }) => lang !== 'en' && !(s in table) && !hasServerTranslation(lang, s)
      )
  );
  assert.ok(
    englishOnly.length <= SERVER_WEB_ENGLISH_ONLY_CEILING,
    `${englishOnly.length} Server Web strings reach non-English readers in English, above the ${SERVER_WEB_ENGLISH_ONLY_CEILING} recorded here`
  );
});

test('every language table covers exactly the same keys', () => {
  // A key in one table but not another means one language silently falls back.
  for (const { name, table } of TRANSLATIONS.slice(1)) {
    const missing = Object.keys(EN).filter((key) => !(key in table));
    const extra = Object.keys(table).filter((key) => !(key in EN));
    assert.deepEqual(missing, [], `${name} is missing keys English has`);
    assert.deepEqual(extra, [], `${name} has keys English does not`);
  }
});

test('translations keep every {placeholder} intact', () => {
  // tx() substitutes by name, so a translated or dropped placeholder renders literally.
  const names = (value) => [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const { name, table } of TRANSLATIONS) {
    const broken = Object.entries(table).filter(([key, value]) => names(key) !== names(value));
    assert.deepEqual(
      broken.map(([key, value]) => `${JSON.stringify(key)} → ${JSON.stringify(value)}`),
      [],
      `${name} translations changed a {placeholder}`
    );
  }
});

test('no translation is empty', () => {
  for (const { name, table } of TRANSLATIONS) {
    const blank = Object.entries(table).filter(([, value]) => !String(value).trim()).map(([key]) => key);
    assert.deepEqual(blank, [], `${name} has blank translations`);
  }
});

test('graph loading failures reach every locale through the runtime error boundary', () => {
  const { setActiveLang, errorText } = loadModule('src/i18n.ts');
  const key = 'No se pudieron cargar todas las conexiones. Vuelve a intentarlo.';
  for (const { lang, table } of TRANSLATIONS) {
    setActiveLang(lang);
    assert.equal(errorText(new Error(key)), table[key], `${lang}: graph error must use its own translation`);
  }
  setActiveLang('es');
  assert.equal(errorText(new Error(key)), key);
});

test('stored image-generation failures are translated, not flattened or leaked', () => {
  // A failed decorative image keeps its reason in the vault and shows it later, so
  // this is the one class of Electron error the renderer must translate itself. Two
  // things have to hold together, and each one alone shipped a bug: the reason has to
  // survive `localizeIpcPayload` (otherwise it collapses into "the operation could not
  // be completed" and the user learns nothing), and it has to exist in every table
  // (otherwise it leaks Spanish — `ChatGPT no pudo generar la imagen.` carries no
  // diacritic and one function word, so the Spanish detector never caught it).
  const { IMAGE_GENERATION_ERROR_MESSAGES, localizeIpcPayload } = loadModule('shared/uiLanguage.ts');
  assert.ok(IMAGE_GENERATION_ERROR_MESSAGES.length > 0);
  for (const message of IMAGE_GENERATION_ERROR_MESSAGES) {
    assert.equal(
      localizeIpcPayload({ error: message }, 'en').error,
      message,
      `${JSON.stringify(message)} must reach the renderer intact`
    );
  }
  for (const { name, table } of TRANSLATIONS) {
    const missing = IMAGE_GENERATION_ERROR_MESSAGES.filter((key) => !table[key]?.trim());
    assert.deepEqual(missing, [], `${name} is missing image-generation failure reasons`);
  }
});

test('Cloudflare deployment prose has a translation in every language', () => {
  for (const { name, table } of TRANSLATIONS) {
    const missing = CLOUDFLARE_RUNTIME_KEYS.filter((key) => !table[key]?.trim());
    assert.deepEqual(missing, [], `${name} is missing Cloudflare deployment translations`);
  }
});

test('issue #12 runtime UI payloads have a translation in every language', () => {
  for (const { name, table } of TRANSLATIONS) {
    const missing = ISSUE_12_RUNTIME_KEYS.filter((key) => !table[key]?.trim());
    assert.deepEqual(missing, [], `${name} is missing issue #12 runtime UI translations`);
  }
});

test('the writing-workshop retrieval reasons are translated, not printed as written', () => {
  for (const { name, table } of TRANSLATIONS) {
    const missing = WORKSHOP_RUNTIME_KEYS.filter((key) => !table[key]?.trim());
    assert.deepEqual(missing, [], `${name} is missing writing-workshop retrieval reasons`);
  }
  // The badge consults tr(), and the reason reaches the renderer in Spanish.
  const view = fs.readFileSync(path.join(repoRoot, 'src/views/WritingWorkshopView.tsx'), 'utf8');
  assert.match(view, /\{item\.reason && <Badge color="cyan">\{tr\(item\.reason\)\}<\/Badge>\}/,
    'the candidate reason must pass through tr(), never render the stored sentence');
});

test('non-Spanish translations prefer English and preserve unknown dynamic values', () => {
  const { resolveTranslation, setActiveLang, getActiveLang } = loadModule('src/i18n.ts');
  const sparse = { en: { Clave: 'English fallback' }, fr: {}, de: {} };
  assert.equal(resolveTranslation('fr', 'Clave', sparse), 'English fallback');
  assert.equal(resolveTranslation('de', 'Clave', sparse), 'English fallback');
  assert.equal(resolveTranslation('unknown-locale', 'Clave', sparse), 'English fallback');
  assert.equal(resolveTranslation('pt', 'Already readable', { en: {} }), 'Already readable');
  setActiveLang('unknown-locale');
  assert.equal(getActiveLang(), 'en', 'an unknown locale must normalize to English');
  setActiveLang('tr');
  assert.equal(getActiveLang(), 'tr', 'Turkish must survive runtime locale normalization');
  assert.equal(resolveTranslation('tr', 'Idioma'), 'Dil', 'Turkish must use its own table at runtime');

  const { treeKinshipLabel } = loadModule('shared/treeKinship.ts');
  const generatedOnlyInSpanish = { role: 'father', branch: 'paternal', tone: 0, depth: 1, labels: { es: 'Solo español' } };
  assert.equal(treeKinshipLabel(generatedOnlyInSpanish, 'de'), 'Father');
});

test('legacy Spanish Electron errors cannot leak into a non-Spanish interface', () => {
  const { localizeIpcPayload, localizeRuntimeError, uiText } = loadModule('shared/uiLanguage.ts');
  const spanish = 'No se puede cambiar de bóveda mientras hay un análisis activo.';
  for (const language of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'unknown']) {
    const localized = localizeRuntimeError(spanish, language);
    assert.notEqual(localized, spanish, `${language} leaked the Spanish runtime error`);
  }
  assert.equal(uiText('de', { en: 'English fallback' }), 'English fallback');
  assert.equal(uiText('unknown', { en: 'English fallback', es: 'Español' }), 'English fallback');
  // `Archivo no encontrado.` used to belong here as an example of the generic fallback.
  // It is now in shared/mainProcessErrors.ts and names its own cause, so the fallback is
  // shown with a sentence the catalogue genuinely does not know — which is what this
  // assertion was always about: unknown Spanish prose must be replaced, never leaked.
  const payload = localizeIpcPayload({ ok: false, message: 'Archivo no encontrado.', nested: { error: 'La operación falló.' } }, 'en');
  assert.deepEqual(payload, { ok: false, message: 'File not found.', nested: { error: 'The operation could not be completed.' } });
  const rendererTranslated = 'No se puede cambiar de bóveda mientras se están indexando pasajes.';
  assert.equal(localizeIpcPayload({ message: rendererTranslated }, 'en').message, rendererTranslated);

  assert.equal(
    localizeRuntimeError('La fuente cambió repetidamente durante el análisis. La campaña se ha pausado para evitar reintentos indefinidos.', 'en'),
    'The document source kept changing during analysis. Indexing was paused to prevent endless retries.',
  );
  assert.equal(
    localizeRuntimeError('Falta la clave de IA para gemini. Configúrala en Ajustes.', 'en'),
    'The AI key for gemini is missing. Configure it in Settings.',
  );
  assert.equal(
    localizeRuntimeError('Clave de IA inválida. Revísala en Ajustes.', 'en'),
    'The AI key is invalid. Check it in Settings.',
  );
});

// A stored document profile mixes the pipeline's own sentences with the auditor model's prose,
// and `tr()` would replace the second kind with "this message could not be translated" — the
// auditor answers in the prompt language, so its Spanish notes are not a leak, they are the
// finding. `knownText` is the gate that translates the first kind and leaves the second alone.
/**
 * A streamed answer cut at the output ceiling and an empty stream used to collapse
 * into "The operation could not be completed." — the same generic sentence for two
 * different failures. Both are now named, so a truncated route is not mistaken for
 * a provider outage.
 */
test('a truncated stream and an empty stream name their cause in every language', () => {
  const { localizeRuntimeError } = loadModule('shared/uiLanguage.ts');
  const generic = 'The operation could not be completed.';
  const truncated = 'La respuesta de «claude-opus-5-5» (Anthropic) se cortó al alcanzar el límite de 26.000 tokens de salida. Un modelo con razonamiento puede gastar ese presupuesto pensando antes de escribir.';
  const empty = 'Respuesta vacía del proveedor de IA.';
  const refused = 'El modelo se negó a responder a esta solicitud.';
  assert.equal(
    localizeRuntimeError(truncated, 'en'),
    'The response from «claude-opus-5-5» (Anthropic) was cut off at the 26.000-output-token limit. A reasoning model can spend that budget thinking before it writes.',
  );
  assert.equal(localizeRuntimeError(empty, 'en'), 'The AI provider returned an empty response.');
  assert.equal(localizeRuntimeError(refused, 'en'), 'The model declined to answer this request.');
  for (const failure of [truncated, empty, refused]) {
    assert.equal(localizeRuntimeError(failure, 'es'), failure, 'Spanish must keep the message verbatim');
    for (const language of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'unknown']) {
      const localized = localizeRuntimeError(failure, language);
      assert.notEqual(localized, generic, `${language} erased "${failure}" into the generic error`);
      assert.notEqual(localized, failure, `${language} leaked Spanish for "${failure}"`);
    }
  }
});

test('a stored audit translates our sentences and keeps the auditor’s own prose', () => {
  const { knownText, setActiveLang, getActiveLang } = loadModule('src/i18n.ts');
  setActiveLang('en');
  assert.equal(
    knownText('La respuesta de «deepseek-flash» (DeepSeek) se cortó al alcanzar el límite de 5000 tokens de salida y el JSON quedó incompleto. Usa un modelo con mayor límite de salida o reduce el tamaño de la tarea.'),
    'The response from «deepseek-flash» (DeepSeek) was cut off at the 5000-output-token limit and the JSON was left incomplete. Use a model with a higher output limit or reduce the size of the task.',
  );
  assert.equal(knownText('El texto contiene espacios dobles inesperados.'), 'The text contains unexpected double spaces.');
  const auditorsNote = 'El campo «thesis» mezcla la tesis con resultados teóricos.';
  assert.equal(knownText(auditorsNote), auditorsNote, 'a model’s own prose must survive untouched');
  setActiveLang('es');
  assert.equal(getActiveLang(), 'es');
  assert.equal(knownText('El texto contiene espacios dobles inesperados.'), 'El texto contiene espacios dobles inesperados.');
  setActiveLang('en');
});

/**
 * The package installer's failures reach the reader twice: thrown from an IPC handler,
 * where `localizeRuntimeError` catches them, and recorded in the migration journal, where
 * they are shown under a key called `failure` — and `localizeIpcPayload` only walks
 * `message` and `error`. Authored in English, they were the only sentences on that panel
 * that nobody read in their own language, Spanish readers included.
 */
test('capability package failures name their cause in every language', () => {
  const { localizeRuntimeError } = loadModule('shared/uiLanguage.ts');
  const generic = 'The operation could not be completed.';
  const failures = [
    'Actualiza el catálogo de paquetes antes de instalar.',
    'Ese paquete no está en el catálogo.',
    'No se pudo contactar con el origen del paquete. Revisa tu conexión e inténtalo de nuevo.',
    'El origen del paquete respondió vacío.',
    'La descarga supera el tamaño permitido.',
    'La revisión del repositorio no es válida.',
    // The value that failed is carried into the message and must survive the translation.
    'El origen del paquete respondió 503.',
    'Chemistry Studio no publica un paquete para darwin-arm64.',
    'Chemistry Studio no tiene un archivo publicado para darwin-arm64.',
  ];
  for (const failure of failures) {
    assert.equal(localizeRuntimeError(failure, 'es'), failure, `Spanish must keep ${failure} verbatim`);
    for (const language of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'unknown']) {
      const localized = localizeRuntimeError(failure, language);
      assert.notEqual(localized, generic, `${language} erased "${failure}" into the generic error`);
      assert.notEqual(localized, failure, `${language} leaked Spanish for "${failure}"`);
    }
  }
  assert.equal(localizeRuntimeError('El origen del paquete respondió 503.', 'en'), 'The package source returned 503.');
  assert.equal(
    localizeRuntimeError('Chemistry Studio no publica un paquete para darwin-arm64.', 'de'),
    'Chemistry Studio veröffentlicht kein Paket für darwin-arm64.',
  );
  // The journal's own field, which the payload walker would never have reached.
  const handler = fs.readFileSync(path.join(repoRoot, 'electron/ipc/capabilities.ts'), 'utf8');
  assert.match(
    handler,
    /failure: localizeRuntimeError\(entry\.failure, getSettings\(\)\.uiLanguage\)/,
    'the migration journal failure must be localized on its way to the renderer',
  );
});

/**
 * A closed Zotero is the commonest failure the global library has, and its sentence
 * is born in the main process in Spanish. Unlisted here it was not translated but
 * erased: every one of these collapsed into "The operation could not be completed.",
 * which is what the Zotero import dialog showed instead of naming the cause.
 */
test('Zotero and global library failures name their cause in every language', () => {
  const { localizeRuntimeError } = loadModule('shared/uiLanguage.ts');
  const generic = 'The operation could not be completed.';
  const failures = [
    'No se pudo conectar con Zotero: fetch failed',
    'No se pudo conectar con Zotero.',
    'Las credenciales de Zotero han caducado.',
    'Zotero rechazó el acceso a esta biblioteca.',
    'Zotero mantiene temporalmente limitado el acceso.',
    'Zotero respondió HTTP 503.',
    'La biblioteca de Zotero ya no existe: Colecciones de Zotero.',
    'Configura primero la carpeta de copias de seguridad de Nodus.',
  ];
  for (const failure of failures) {
    assert.equal(localizeRuntimeError(failure, 'es'), failure, `Spanish must keep ${failure} verbatim`);
    for (const language of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'unknown']) {
      const localized = localizeRuntimeError(failure, language);
      assert.notEqual(localized, generic, `${language} erased "${failure}" into the generic error`);
      assert.notEqual(localized, failure, `${language} leaked Spanish for "${failure}"`);
    }
  }
  // The transport detail is not prose: it survives the translation untouched.
  assert.equal(localizeRuntimeError('No se pudo conectar con Zotero: fetch failed', 'en'), 'Could not connect to Zotero: fetch failed');
  assert.equal(localizeRuntimeError('Zotero respondió HTTP 503.', 'en'), 'Zotero responded with HTTP 503.');

  // Every Zotero surface reports the cause through one helper, which drops what
  // Electron prefixes onto a rejected invoke: the channel name, and the error class
  // that comes with it when the message needed no translation and was rethrown as is.
  const { zoteroFailureText } = loadModule('src/lib/zoteroConnection.ts');
  assert.equal(
    zoteroFailureText(new Error("Error invoking remote method 'library:zoteroLibraries': Error: Could not connect to Zotero: fetch failed")),
    'Could not connect to Zotero: fetch failed',
  );
  assert.equal(
    zoteroFailureText(new Error("Error invoking remote method 'zotero:libraries': ZoteroRequestError: No se pudo conectar con Zotero: fetch failed")),
    'No se pudo conectar con Zotero: fetch failed',
  );
  assert.equal(zoteroFailureText(new Error('Could not connect to Zotero: fetch failed')), 'Could not connect to Zotero: fetch failed');

  // The import dialog names the cause and, when Zotero itself is silent, the fix.
  const dialog = fs.readFileSync(path.join(repoRoot, 'src/views/GlobalLibraryView.tsx'), 'utf8');
  assert.match(dialog, /setError\(zoteroFailureText\(libraryResult\.reason\)\)/);
  assert.match(dialog, /zoteroConnectionHint\(status\)/);

  // Onboarding: a reachable Zotero that cannot be read is a failure, not a green tick.
  const onboarding = fs.readFileSync(path.join(repoRoot, 'src/views/Onboarding.tsx'), 'utf8');
  assert.doesNotMatch(onboarding, /zoteroLibraries\(\)\.catch/, 'a failed library listing must not be swallowed');
  assert.doesNotMatch(onboarding, /zoteroCollections\(library\)\.catch/, 'a failed collection listing must not be swallowed');
  assert.match(onboarding, /setLibraryError\(zoteroFailureText\(error\)\)/);
  assert.match(onboarding, /ping\.ok && !libraryError/, 'the green "connected" line waits for the collections to load');
});

test('issue #12 queue payloads translate at runtime', () => {
  const runtime = loadModule('src/i18n.ts');
  for (const language of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
    runtime.setActiveLang(language);
    assert.notEqual(runtime.tr('Descubrir relaciones semánticas'), 'Descubrir relaciones semánticas');
    assert.notEqual(runtime.tr('Analizando fragmento 2/5 con IA… (8s)'), 'Analizando fragmento 2/5 con IA… (8s)');
  }
});

test('issue #12 examples pass through localization at their render boundaries', () => {
  const readingPath = fs.readFileSync(path.join(repoRoot, 'src/views/ReadingPathView.tsx'), 'utf8');
  assert.match(readingPath, /t\(phase\.title\)/);
  assert.match(readingPath, /t\(phase\.objective\)/);
  assert.match(readingPath, /localizedReadingReason\(entry\)/);
  assert.doesNotMatch(readingPath, />\{plan\.summary\}</);

  const queue = fs.readFileSync(path.join(repoRoot, 'src/components/QueueBar.tsx'), 'utf8');
  assert.match(queue, /queueTitle\(current\)/);
  assert.match(queue, /tr\(running\.detail\)/);
  assert.match(queue, /t\(STATE_LABELS\[it\.state\]\)/);

  const vaultSwitcher = fs.readFileSync(path.join(repoRoot, 'src/components/VaultSwitcher.tsx'), 'utf8');
  assert.match(vaultSwitcher, /setMessage\(tr\(result\.message\)\)/);
  assert.match(vaultSwitcher, /setAddError\(errorText\(error\)\)/);

  const library = fs.readFileSync(path.join(repoRoot, 'src/views/Library.tsx'), 'utf8');
  assert.match(library, /\{t\(labelFor\(flag\)\)\}/);
});

test('two-language compatibility paths choose English for every non-Spanish UI locale', () => {
  const files = [
    ['electron/copilot/server.ts', /uiLanguage === 'es' \? 'es' : 'en'/],
    ['electron/ipc.ts', /const es = language === 'es'/],
  ];
  for (const [file, expected] of files) {
    assert.match(fs.readFileSync(path.join(repoRoot, file), 'utf8'), expected, `${file} does not fall back to English`);
  }
  const nodi = fs.readFileSync(path.join(repoRoot, 'electron/ai/nodiChat.ts'), 'utf8');
  assert.match(nodi, /const RESPONSE_LANGUAGE/);
  assert.match(nodi, /RESPONSE_LANGUAGE\[settings\.uiLanguage\] \?\? 'English'/);
});

test('the two Portuguese variants are really different', () => {
  // Shipping pt and pt-BR separately only earns its keep if they actually diverge:
  // the risk is one being a copy of the other, or drifting into its vocabulary.
  const PT = TRANSLATIONS.find((t) => t.export === 'PT').table;
  const PT_BR = TRANSLATIONS.find((t) => t.export === 'PT_BR').table;
  const keys = Object.keys(PT);
  const differing = keys.filter((key) => PT[key] !== PT_BR[key]);
  // Many short labels legitimately coincide ("Nome", "Data"), so this is a floor,
  // not a target — it only catches one variant being a copy of the other.
  assert.ok(
    differing.length > keys.length * 0.2,
    `expected the Portuguese variants to diverge substantially, only ${differing.length}/${keys.length} differ`
  );

  // Vocabulary that belongs to exactly one variant. Deliberately excludes words that
  // are legitimate in both: "arquivo" is Brazilian for a computer file but European
  // for an archive/repository, and "transferir" means download in pt and transfer in
  // pt-BR, so neither can be used as a marker.
  const forbidden = {
    PT: [/\bsalvar\b/i, /\busuários?\b/i, /\bconfigurações\b/i, /\bsenhas?\b/i, /\bgerenciar\b/i],
    PT_BR: [/\bficheiros?\b/i, /\becrã\b/i, /\butilizadores?\b/i, /\bpalavra-passe\b/i],
  };
  for (const [variant, patterns] of Object.entries(forbidden)) {
    const table = variant === 'PT' ? PT : PT_BR;
    for (const pattern of patterns) {
      const hits = Object.entries(table).filter(([, value]) => pattern.test(String(value)));
      assert.deepEqual(
        hits.map(([key, value]) => `${JSON.stringify(key)} → ${JSON.stringify(value)}`),
        [],
        `${variant} uses ${pattern} from the other variant`
      );
    }
  }
});

// The languages that in-data labels must also carry. Spanish and English are the
// source pair every table already had.
const IN_DATA_LANGUAGES = ['fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'zh-TW', 'ja', 'ko'];

test('in-data labels are translated alongside the i18n table', () => {
  // These labels ship inside shared/ data rather than the i18n table, so the
  // coverage scan above cannot see them and they rot independently.
  const docTypes = loadModule('shared/archiveDocTypes.ts');
  const { RAW_DOC_TYPES, NATURALEZA, EPOCA, AMBITO, FUNCION, SOPORTE_MONUMENTAL, ESTATUS, SOPORTE_FISICO, GENEALOGIA } = docTypes;
  assert.ok(RAW_DOC_TYPES.length > 150, `expected the full doc-type taxonomy, got ${RAW_DOC_TYPES.length}`);

  // Assert against the source maps, not the expanded `labels`: those are
  // `DOC_TYPE_LABEL_XX[id] ?? labelEn`, so a missing id would silently look fine.
  // A label equal to the English one is legitimate ("Illustration", "Notes").
  const docTypeMaps = { fr: docTypes.DOC_TYPE_LABEL_FR, de: docTypes.DOC_TYPE_LABEL_DE, pt: docTypes.DOC_TYPE_LABEL_PT, 'pt-BR': docTypes.DOC_TYPE_LABEL_PT_BR, it: docTypes.DOC_TYPE_LABEL_IT, tr: docTypes.DOC_TYPE_LABEL_TR, 'zh-CN': docTypes.DOC_TYPE_LABEL_ZH_CN, 'zh-TW': docTypes.DOC_TYPE_LABEL_ZH_TW, ja: docTypes.DOC_TYPE_LABEL_JA, ko: docTypes.DOC_TYPE_LABEL_KO };
  for (const language of IN_DATA_LANGUAGES) {
    const map = docTypeMaps[language];
    assert.ok(map, `no doc-type label map for ${language}`);
    const untranslated = RAW_DOC_TYPES.map((row) => row[0]).filter((id) => !map[id]?.trim());
    assert.deepEqual(untranslated, [], `these document types have no ${language} label and would fall back to English`);
  }

  for (const [dimension, values] of Object.entries({ NATURALEZA, EPOCA, AMBITO, FUNCION, SOPORTE_MONUMENTAL, ESTATUS, SOPORTE_FISICO, GENEALOGIA })) {
    for (const language of IN_DATA_LANGUAGES) {
      const blank = (values ?? []).filter((value) => !value[language]?.trim()).map((value) => value.id);
      assert.deepEqual(blank, [], `facet dimension ${dimension} has values with no ${language} label`);
    }
  }

  const kinship = loadModule('shared/treeKinship.ts');
  const roles = Object.keys(kinship.TREE_KINSHIP_ROLE_LABEL_ES);
  for (const language of IN_DATA_LANGUAGES) {
    const table = kinship.TREE_KINSHIP_ROLE_LABELS[language];
    assert.ok(table, `no kinship role table for ${language}`);
    const missing = roles.filter((role) => !table[role]?.trim());
    assert.deepEqual(missing, [], `these kinship roles have no ${language} label`);
  }

  const { RELEASE_NOTES } = loadModule('shared/releaseNotes.ts');
  const { RELEASE_NOTES_TR } = loadModule('shared/releaseNotes.tr.ts');
  const { RELEASE_NOTES_ZH } = loadModule('shared/releaseNotes.zh-CN.ts');
  const { RELEASE_NOTES_ZH_TW } = loadModule('shared/releaseNotes.zh-TW.ts');
  const { RELEASE_NOTES_JA } = loadModule('shared/releaseNotes.ja.ts');
  const { RELEASE_NOTES_KO } = loadModule('shared/releaseNotes.ko.ts');
  const highlights = RELEASE_NOTES.flatMap((note) => note.highlights.map((h) => [note.version, h]));
  for (const language of IN_DATA_LANGUAGES) {
    const missing = highlights.filter(([, h]) => !h[language]?.trim()).map(([version]) => version);
    assert.deepEqual(missing, [], `these release notes have no ${language} highlight`);
  }
  const missingTurkishSources = RELEASE_NOTES.flatMap((note) =>
    note.highlights.flatMap((_, index) => RELEASE_NOTES_TR[note.version]?.[index]?.trim() ? [] : [`${note.version}#${index}`])
  );
  assert.deepEqual(missingTurkishSources, [], 'Turkish release notes must not silently fall back to English');
  const missingChineseSources = RELEASE_NOTES.flatMap((note) =>
    note.highlights.flatMap((_, index) => RELEASE_NOTES_ZH[note.version]?.[index]?.trim() ? [] : [`${note.version}#${index}`])
  );
  assert.deepEqual(missingChineseSources, [], 'Simplified Chinese release notes must not silently fall back to English');
  const missingTraditionalChineseSources = RELEASE_NOTES.flatMap((note) =>
    note.highlights.flatMap((_, index) => RELEASE_NOTES_ZH_TW[note.version]?.[index]?.trim() ? [] : [`${note.version}#${index}`])
  );
  assert.deepEqual(missingTraditionalChineseSources, [], 'Traditional Chinese release notes must not silently fall back to English');
  const missingJapaneseSources = RELEASE_NOTES.flatMap((note) =>
    note.highlights.flatMap((_, index) => RELEASE_NOTES_JA[note.version]?.[index]?.trim() ? [] : [`${note.version}#${index}`])
  );
  assert.deepEqual(missingJapaneseSources, [], 'Japanese release notes must not silently fall back to English');
  const missingKoreanSources = RELEASE_NOTES.flatMap((note) =>
    note.highlights.flatMap((_, index) => RELEASE_NOTES_KO[note.version]?.[index]?.trim() ? [] : [`${note.version}#${index}`])
  );
  assert.deepEqual(missingKoreanSources, [], 'Korean release notes must not silently fall back to English');
});

test('keys reached indirectly and through ternaries are collected', () => {
  // Without these the scan silently stops seeing whole surfaces and the coverage
  // test above passes while the UI renders Spanish.
  const strings = collectTranslatableStrings();
  for (const key of ['Grafo de estudio', 'Ideas de estudio', 'Explorar']) {
    assert.ok(strings.has(key), `sidebar label "${key}" (navigation.ts) must be collected`);
  }
  assert.ok(strings.has('Proveedores'), 'Settings tab labels must be collected');
  assert.ok(strings.has('Ocultar contraseña'), 'keys inside a t(cond ? … : …) ternary must be collected');
});

test('seeded Spanish data labels are translated on screen, not left raw', () => {
  // The schedule seeds 'Mañana'/'Tarde' into the DB. They are user-editable, so the
  // view must translate them only while untouched — otherwise an English interface
  // shows Spanish in the slot name box.
  const schedule = fs.readFileSync(path.join(repoRoot, 'src/views/StudyScheduleView.tsx'), 'utf8');
  assert.match(schedule, /function periodLabel/, 'the untouched-default translation helper must exist');
  assert.match(schedule, /value=\{periodLabel\(period\)\}/, 'the slot name box must render the translated label');
  for (const key of ['Mañana', 'Tarde', 'Lunes', 'Viernes']) {
    assert.ok(enKeys.has(key), `"${key}" must have an English translation`);
  }
});

test('the study/teaching organization header title is translated', () => {
  // The <h1> of the organization browser (study AND docencia, which reuse the same view)
  // is not a t() literal: it comes back from targetTitle(), which returns either the name
  // the user typed or one of three interface fallbacks. Those fallbacks shipped bare, so
  // an English interface showed "Cursos y asignaturas" under an "ORGANISATION" eyebrow.
  const view = fs.readFileSync(path.join(repoRoot, 'src/views/StudyOrganizationView.tsx'), 'utf8');
  const body = view.slice(view.indexOf('function targetTitle'));
  const fn = body.slice(0, body.indexOf('\n}') + 2);
  assert.ok(fn.includes('function targetTitle'), 'targetTitle must exist');
  for (const key of ['Cursos y asignaturas', 'Documento', 'Selección actual']) {
    assert.match(fn, new RegExp(`t\\('${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`), `targetTitle must return t('${key}'), not the bare literal`);
    for (const { name, table } of TRANSLATIONS) {
      assert.ok(table[key], `"${key}" must be translated into ${name}`);
    }
  }
});

test('genealogy vault-type + section labels are translated', () => {
  // Spot-check the surfaces the user reported: header vault label, tree, relations,
  // archive, tour welcome.
  for (const key of ['Genealogía', 'Árbol genealógico', 'Relaciones sociales', 'Archivo', 'Personas', 'Línea temporal', 'Bienvenido al modo genealogía']) {
    assert.ok(enKeys.has(key), `"${key}" must have an English translation`);
  }
  assert.equal(EN['Genealogía'], 'Genealogy');
  assert.equal(EN['Relaciones sociales'], 'Social relations');
});
