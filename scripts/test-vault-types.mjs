import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// shared/vaultTypes.ts is dependency-free, so a plain esbuild bundle is enough.
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-vaulttypes-'));
const bundle = path.join(outDir, 'vaultTypes.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/vaultTypes.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const vt = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('academic is the default and every declared type round-trips', () => {
  assert.equal(vt.DEFAULT_VAULT_TYPE, 'academic');
  for (const def of vt.VAULT_TYPES) {
    assert.ok(vt.isVaultType(def.id), `${def.id} recognised`);
    assert.equal(vt.normalizeVaultType(def.id), def.id);
    assert.equal(vt.getVaultTypeDef(def.id).id, def.id);
  }
});

test('unknown / missing values normalise to academic', () => {
  for (const bad of [undefined, null, '', 'nope', 42, {}]) {
    assert.equal(vt.isVaultType(bad), false);
    assert.equal(vt.normalizeVaultType(bad), 'academic');
    assert.equal(vt.getVaultTypeDef(bad).id, 'academic');
  }
});

test('Focus is available and visible by default in every selectable vault', () => {
  for (const { id } of vt.availableVaultTypes()) {
    assert.equal(vt.isViewAllowedForVaultType('studyFocus', id), true, `${id}: Focus opens`);
    assert.equal(vt.defaultHiddenViewsForType(id).includes('studyFocus'), false, `${id}: Focus starts visible`);
  }
  assert.deepEqual(vt.effectiveSidebarHidden(['studyFocus'], true, 'estudio'), ['studyFocus'], 'manual hiding remains respected');
});

test('shipped and preview vaults are selectable; announced future vaults remain gated', () => {
  const ids = vt.availableVaultTypes().map((d) => d.id);
  assert.deepEqual(ids, ['academic', 'genealogy', 'prosopography', 'estudio', 'primary_sources', 'databases', 'testimonios', 'worldbuilding', 'docencia']);
  assert.equal(vt.getVaultTypeDef('genealogy').available, true);
  assert.equal(vt.getVaultTypeDef('estudio').available, true);
  assert.equal(vt.getVaultTypeDef('databases').available, true);
  assert.equal(vt.getVaultTypeDef('prosopography').available, true);
  assert.equal(vt.PRIMARY_SOURCES_RELEASE_ENABLED, true);
  assert.equal(vt.getVaultTypeDef('primary_sources').available, true);
  // docencia (teaching) and worldbuilding both graduated from a preview shell into
  // real workspaces, so no type is a preview any more. The mechanism stays — it is how
  // a type gets announced before it exists — but the list is empty, and putting a type
  // back into it means writing its sidebar and Inicio too (see PREVIEW_VAULT_TYPES).
  for (const graduated of ['docencia', 'worldbuilding', 'testimonios']) {
    assert.equal(vt.getVaultTypeDef(graduated).available, true);
    assert.equal(vt.isPreviewVaultType(graduated), false);
    assert.equal(vt.isViewAllowedForVaultType('home', graduated), true);
    assert.equal(vt.isViewAllowedForVaultType('settings', graduated), true);
  }
  assert.deepEqual(vt.PREVIEW_VAULT_TYPES, []);
  // Ya no queda ningún tipo con la puerta echada: los tres verticales que llegaron
  // detrás —primary_sources, prosopography y testimonios— están terminados y elegibles.
  assert.deepEqual(vt.VAULT_TYPES.filter((d) => !d.available).map((d) => d.id), [],
    'un tipo marcado como no disponible tiene que decir por qué en esta prueba');
  assert.deepEqual(vt.VAULT_TYPES.map((d) => d.id), ['academic', 'genealogy', 'prosopography', 'estudio', 'primary_sources', 'databases', 'testimonios', 'worldbuilding', 'docencia']);
});

test('the vault picker derives selectable modes from the canonical registry', async () => {
  // One picker, shared by the switcher's creation modal and the first-run chooser.
  const picker = await readFile(path.join(repoRoot, 'src/components/vaultTypeUi.tsx'), 'utf8');
  const switcher = await readFile(path.join(repoRoot, 'src/components/VaultSwitcher.tsx'), 'utf8');
  assert.match(picker, /VAULT_TYPES\.filter\(\(type\) => type\.available\)/);
  assert.match(picker, /const CREATE_VAULT_TYPES: VaultType\[\] = \[\s*'academic', 'primary_sources', 'testimonios',\s*'databases', 'docencia', 'estudio',\s*'genealogy', 'prosopography', 'worldbuilding',\s*\]/s);
  assert.doesNotMatch(picker, /COMING_SOON_VAULT_TYPES[^\n]*estudio/);
  assert.match(picker, /type === 'primary_sources' \|\| type === 'prosopography' \|\| type === 'testimonios'\) return 'pre-alpha'/);
  assert.match(picker, /type === 'worldbuilding'\) return 'alpha'/);
  assert.match(picker, /type === 'estudio' \|\| type === 'genealogy' \|\| type === 'databases' \|\| type === 'docencia'\) return 'beta'/);
  assert.doesNotMatch(picker, /type === 'primary_sources'[^\\n]*return 'beta'/);
  assert.doesNotMatch(picker, /type === '(?:estudio|genealogy)'\) return '(?:pre-alpha|alpha)'/);
  assert.match(picker, /data-testid="vault-phase-notice"/);
  assert.match(picker, /data-testid="vault-preview-notice"/);
  assert.match(picker, />PREVIEW<\/span>/);
  assert.match(picker, /className=\{`relative flex h-28 flex-col/);
  assert.match(picker, /line-clamp-2 min-h-\[2\.5em\]/);
  assert.doesNotMatch(picker, /case '(?:worldbuilding|docencia)': return t\('Preview de un espacio/);
  assert.match(picker, /Icon name="bug"/);
  assert.match(picker, /data-testid="vault-phase-tooltip"/);
  assert.match(picker, /tooltipOpen && createPortal/);
  assert.match(picker, /className="pointer-events-none fixed z-\[90\]/);
  assert.match(picker, /window\.innerWidth - width - 8/);
  assert.match(picker, /window\.innerHeight - 8/);
  assert.match(switcher, /className=\{`card-modal max-h-\[90vh\]/, 'vault creation and management dialogs use an opaque surface');
  assert.doesNotMatch(switcher, /className=\{`card max-h-\[90vh\]/, 'translucent cards must not be used as modal panels');
});

test('the worldbuilding sidebar keeps its full announced shape, with only the built sections live', async () => {
  const [sidebar, app, english] = await Promise.all([
    readFile(path.join(repoRoot, 'src/components/WorldbuildingSidebar.tsx'), 'utf8'),
    Promise.resolve(readSource('@shell')),
    readFile(path.join(repoRoot, 'src/i18n.en.ts'), 'utf8'),
  ]);
  // The whole promised structure stays visible while it is built one section at a time.
  for (const label of ['Enciclopedia', 'Personajes', 'Lugares', 'Facciones', 'Culturas', 'Cronología', 'Familias', 'Dinastías', 'Research chat', 'Reglas del mundo', 'Conflictos', 'Arcos narrativos', 'Continuidad', 'Preguntas abiertas', 'Escenas', 'Manuscrito']) {
    assert.match(sidebar, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label} appears in the worldbuilding sidebar`);
  }
  const navigation = await readFile(path.join(repoRoot, 'src/navigation.ts'), 'utf8');
  assert.match(navigation, /\{ id: 'notes', label: 'Nodus Scriptor', icon: 'notebook', group: 'tools' \}/, 'universal notes moved to tools while the specialised Manuscript stays in this sidebar');
  // Every announced section is now wired up: nothing in this sidebar is inert. Enciclopedia, Personajes and
  // Lugares are this vault's own views; Cronología, Mapa, Relaciones and Familias are the
  // records views reused over the shared ontology; Scriptor is universal in Tools.
  // Every announced item now navigates. The inert branch stays in the component because it
  // is how the NEXT announced section gets shown before it is built (the teaching sidebar
  // uses it too), but nothing in this vault is inert any more — so the property asserted
  // here is the positive one, not the existence of a disabled button.
  assert.equal(
    [...sidebar.matchAll(/\{ label: '[^']+', icon: '[^']+'(, view: '\w+')? \}/g)].filter((m) => !m[1]).length,
    0,
    'no worldbuilding sidebar item is inert any more'
  );
  assert.deepEqual(
    [...sidebar.matchAll(/\bview: '(\w+)'/g)].map((m) => m[1]).sort(),
    ['arcs', 'characters', 'conflicts', 'continuity', 'cultures', 'dynasties', 'encyclopedia', 'factions', 'manuscript', 'map', 'places', 'questions', 'relations', 'rules', 'scenes', 'search', 'timeline', 'tree', 'worldChat']
  );
  // The transverse Scriptor route is allowed too, although Tools supplies its button.
  // Every wired view must actually be allowed for the vault type, or the sidebar offers a
  // button that navigates to a section the scoping then refuses to render.
  for (const view of ['arcs', 'characters', 'conflicts', 'continuity', 'cultures', 'dynasties', 'encyclopedia', 'factions', 'manuscript', 'map', 'notes', 'places', 'questions', 'relations', 'rules', 'scenes', 'search', 'timeline', 'tree', 'worldChat']) {
    assert.equal(
      vt.isViewAllowedForVaultType(view, 'worldbuilding'),
      true,
      `${view} is wired in the sidebar and must be allowed for worldbuilding`
    );
  }
  assert.match(app, /<WorldbuildingSidebar[\s\S]*?activeView=\{view\}[\s\S]*?onNavigate=/);
  assert.ok(!vt.defaultHiddenViewsForType('worldbuilding').includes('search'), 'worldbuilding search is visible by default');
  // Its own Inicio, and the generic academic home must not also render for it.
  assert.match(app, /if \(ctx\.isWorldbuilding\) \{\s*return \(\s*<WorldbuildingHome/);
  // The academic home is reached only after every vault flag has declined it,
  // worldbuilding's among them.
  assert.match(app, /if \(ctx\.isWorldbuilding\)[\s\S]*return \(\s*<HomeView/);
  assert.match(english, /'World chat'/);
  // The world graph was dropped: the encyclopedia's A–Z plus its backlinks answer what a
  // node-and-edge picture of a fictional world was ever going to answer.
  assert.doesNotMatch(sidebar, /Grafo del mundo/);
});

test('an empty worldbuilding home offers the complete local demo through the typed IPC bridge', async () => {
  const [app, home, offer, ipc, preload, types] = await Promise.all([
    Promise.resolve(readSource('@shell')),
    readFile(path.join(repoRoot, 'src/views/WorldbuildingHome.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/HomeView.tsx'), 'utf8'),
    Promise.resolve(readSource('@main')),
    Promise.resolve(readSource('@bridge')),
    Promise.resolve(readSource('@api')),
  ]);
  assert.match(app, /const loadWorldbuildingDemo = useCallback/);
  assert.match(app, /const showDemoOffer = hasData === false && !settings\.demoMode;/);
  assert.match(home, /<DemoOfferCard\s+variant="worldbuilding"/s);
  assert.match(offer, /variant\?:[^;]*'worldbuilding'/);
  assert.match(offer, /Cargar demo de worldbuilding/);
  assert.match(ipc, /data:seedWorldbuildingDemo/);
  assert.match(preload, /seedWorldbuildingDemoData: \(\) => ipcRenderer\.invoke\('data:seedWorldbuildingDemo'\)/);
  assert.match(types, /seedWorldbuildingDemoData\(\): Promise<boolean>/);
});

test('the characters section belongs to worldbuilding alone', () => {
  assert.deepEqual(vt.VAULT_TYPE_SCOPED_VIEWS.characters, ['worldbuilding']);
  assert.deepEqual(vt.VAULT_TYPE_SCOPED_VIEWS.places, ['worldbuilding'], 'Lugares is worldbuilding-only');
  // Factions and cultures are two filtered views of ONE collection (world_groups), but
  // each still needs its own scoped view id.
  assert.deepEqual(vt.VAULT_TYPE_SCOPED_VIEWS.factions, ['worldbuilding']);
  assert.deepEqual(vt.VAULT_TYPE_SCOPED_VIEWS.cultures, ['worldbuilding']);
  assert.deepEqual(vt.VAULT_TYPE_SCOPED_VIEWS.dynasties, ['worldbuilding']);
  assert.deepEqual(vt.VAULT_TYPE_SCOPED_VIEWS.scenes, ['worldbuilding']);
  // Genealogy keeps its own Personas and its own Mapa; the fiction places view must not
  // appear there, and vice versa.
  assert.equal(vt.isViewAllowedForVaultType('places', 'genealogy'), false);
  assert.equal(vt.isViewAllowedForVaultType('characters', 'worldbuilding'), true);
  for (const other of ['academic', 'genealogy', 'estudio', 'databases', 'docencia']) {
    assert.equal(vt.isViewAllowedForVaultType('characters', other), false, `characters must not leak into ${other}`);
  }
  // And genealogy's Personas must not leak the other way.
  assert.equal(vt.isViewAllowedForVaultType('persons', 'worldbuilding'), false);
  // The worldbuilding sidebar renders its own groups, so the research/authoring
  // universals are hidden by default — but Notes stays, because the sidebar links it.
  const hidden = vt.defaultHiddenViewsForType('worldbuilding');
  assert.ok(hidden.includes('library'), 'the Zotero library is hidden by default');
  assert.ok(hidden.includes('writing'), 'the writing workshop is hidden by default');
  assert.ok(!hidden.includes('notes'), 'Notes stays available: the sidebar points at it');
  assert.ok(!hidden.includes('characters'), 'the characters section is never hidden by default');
});

test('the worldbuilding prompt pack makes the author the source of truth', () => {
  const pack = vt.vaultTypePromptPack('worldbuilding');
  assert.match(pack, /WORLDBUILDING/);
  assert.match(pack, /autor es la fuente de verdad/i);
  // The three instructions whose absence produced unusable output in the other vaults:
  // no invention, verbatim pronouns, and hands off an invented calendar.
  assert.match(pack, /no introduzcas hechos/i);
  assert.match(pack, /pronombres/);
  assert.match(pack, /calendario/);
});

test('the header vault entry point uses a stable localized label', async () => {
  const app = await Promise.resolve(readSource('@shell'));
  // The right-rail Bóvedas button is gone; the centred badge is the permanent way in,
  // with the command palette as the last resort when the badge has nowhere to sit.
  assert.match(app, /data-testid="header-vault-badge"/);
  // The private practice profile names its workspace instead; both labels are localized
  // constants, never the vault's own name.
  assert.match(app, /\{activeVault\.learningWorkspace\s*\?\s*learningText\('workspace',\s*settings\.uiLanguage\)\s*:\s*vaultTypeLabel\(activeVault\.type\)\}/);
  assert.match(app, /id: 'act:vaults', label: t\('Bóvedas'\)/);
  // The badge must not be hidden below a breakpoint now that nothing else opens the panel.
  assert.doesNotMatch(app, /header-vault-badge[^"]*\bhidden\b/);
  assert.doesNotMatch(app, /label=\{activeVault\?\.name \?\? t\('Bóveda'\)\}/);
});

test('databases mode: table/analysis/chat views scoped to it + data-analyst prompt pack', () => {
  for (const v of ['databases', 'dbAnalysis', 'dbChat', 'dbDeepResearch']) {
    assert.equal(vt.isViewAllowedForVaultType(v, 'databases'), true, `${v} allowed for databases`);
    assert.equal(vt.isViewAllowedForVaultType(v, 'academic'), false, `${v} hidden for academic`);
    assert.equal(vt.isViewAllowedForVaultType(v, 'genealogy'), false, `${v} hidden for genealogy`);
  }
  const hidden = vt.defaultHiddenViewsForType('databases');
  for (const h of ['search', 'library', 'graph', 'ideas', 'authors', 'writing', 'projects', 'deepResearch']) {
    assert.ok(hidden.includes(h), `${h} hidden in databases mode`);
  }
  assert.ok(!hidden.includes('notes'), 'notes stays visible in databases mode');
  assert.match(vt.vaultTypePromptPack('databases'), /MODO BASES DE DATOS/);
});

test('the tree view is scoped to genealogy only', () => {
  assert.equal(vt.isViewAllowedForVaultType('tree', 'genealogy'), true);
  assert.equal(vt.isViewAllowedForVaultType('tree', 'primary_sources'), false);
  assert.equal(vt.isViewAllowedForVaultType('tree', 'academic'), false);
  // Genealogy also gets the shared records views + map.
  for (const v of ['persons', 'timeline', 'archive', 'map']) {
    assert.equal(vt.isViewAllowedForVaultType(v, 'genealogy'), true);
  }
  // Map is shared with primary_sources; tree is not.
  assert.equal(vt.isViewAllowedForVaultType('map', 'primary_sources'), true);
  assert.equal(vt.isViewAllowedForVaultType('map', 'academic'), false);
});

test('genealogy hides argumentative + idea-graph authoring views, keeps records + Deep Research', () => {
  const hidden = vt.defaultHiddenViewsForType('genealogy');
  // Argumentative/idea-graph surfaces AND the idea-graph authoring tools (Writing,
  // Projects) are hidden; they'd run empty in genealogy.
  for (const h of ['argument', 'debate', 'immersion', 'hypothesis', 'reading', 'research', 'gaps', 'ideas', 'authors', 'graph', 'writing', 'projects']) {
    assert.ok(hidden.includes(h), `${h} hidden in genealogy`);
  }
  // Deep Research STAYS (it has a genealogy pipeline over the archive/library), and so
  // do the records/genealogy views + generic notes.
  for (const kept of ['deepResearch', 'persons', 'tree', 'timeline', 'archive', 'map', 'notes', 'library']) {
    assert.ok(!hidden.includes(kept), `${kept} stays visible in genealogy`);
  }
  assert.match(vt.vaultTypePromptPack('genealogy'), /MODO GENEALOGÍA/);
});

test('vaultTypeImagePrompt steers image aesthetics by type', () => {
  assert.match(vt.vaultTypeImagePrompt('genealogy'), /family archive|heritage/i);
  assert.match(vt.vaultTypeImagePrompt('primary_sources'), /archival|documentary/i);
  assert.equal(vt.vaultTypeImagePrompt('academic'), '');
  assert.equal(vt.vaultTypeImagePrompt('estudio'), '');
});

test('primary_sources uses a dedicated documentary shell and keeps optional authoring views hidden', () => {
  const hidden = vt.defaultHiddenViewsForType('primary_sources');
  for (const optional of ['library', 'writing', 'deepResearch']) {
    assert.ok(hidden.includes(optional), `${optional} is optional and hidden by default`);
  }
  for (const kept of ['search', 'archive', 'persons', 'timeline', 'map', 'relations', 'notes', 'toolkit']) {
    assert.ok(!hidden.includes(kept), `${kept} stays visible in primary_sources`);
  }
  assert.match(vt.vaultTypePromptPack('primary_sources'), /FUENTES PRIMARIAS/);
  assert.match(vt.vaultTypePromptPack('primary_sources'), /transcripción, observación e inferencia/i);
  assert.match(vt.vaultTypePromptPack('primary_sources'), /propuesta pendiente de revisión/i);
});

test('academic hides only what an immature corpus cannot feed; estudio uses its dedicated learning workspace', () => {
  // The Hypothesis lab and the Reading path answer with noise until the corpus has
  // been analysed in depth, which reads as broken rather than empty. Everything else
  // an academic vault owns stays visible.
  assert.deepEqual(vt.defaultHiddenViewsForType('academic'), ['hypothesis', 'reading']);
  for (const kept of ['search', 'library', 'graph', 'argument', 'ideas', 'authors', 'immersion', 'debate', 'research', 'deepResearch', 'writing', 'projects', 'notes', 'toolkit']) {
    assert.ok(!vt.defaultHiddenViewsForType('academic').includes(kept), `${kept} stays visible in academic`);
  }
  const estudioHidden = vt.defaultHiddenViewsForType('estudio');
  for (const hidden of ['search', 'library', 'graph', 'debate', 'deepResearch', 'writing']) {
    assert.ok(estudioHidden.includes(hidden), `${hidden} replaced by a study-specific surface`);
  }
  // The Workspace is where notes are linked to courses, subjects and materials, so it is
  // shown by default, as in docencia; a user who hides it keeps it hidden.
  assert.ok(!estudioHidden.includes('notes'), 'the Workspace is visible by default in estudio');
  assert.ok(vt.effectiveSidebarHidden(['notes'], true, 'estudio').includes('notes'), 'hiding it by hand is respected');
  assert.ok(!vt.defaultHiddenViewsForType('docencia').includes('notes'), 'the Workspace is visible by default in docencia too');
  assert.ok(vt.effectiveSidebarHidden(['notes'], true, 'docencia').includes('notes'), 'and hiding it there is respected as well');
  for (const kept of ['studyCourses', 'studySchedule', 'studySearch', 'studyLibrary', 'studyRecordings', 'studyChat', 'studyQuestions']) {
    assert.ok(!estudioHidden.includes(kept), `${kept} stays visible in estudio`);
  }
});

test('pedagogical Deep Research stays exclusive to study', () => {
  assert.equal(vt.isViewAllowedForVaultType('studyDeepResearch', 'estudio'), true);
  assert.equal(vt.isViewAllowedForVaultType('studyDeepResearch', 'docencia'), false);
  assert.equal(vt.isViewAllowedForVaultType('studyDeepResearch', 'academic'), false);
  assert.equal(vt.isViewAllowedForVaultType('studyDeepResearch', 'genealogy'), false);
});

test('all dedicated study views are scoped to estudio', () => {
  const studyViews = [
    'studyCourses',
    'studySchedule',
    'studySearch',
    'studyLibrary',
    'studyRecordings',
    'studyChat',
    'studyQuestions',
    'studyReview',
  ];
  for (const view of studyViews) {
    assert.equal(vt.isViewAllowedForVaultType(view, 'estudio'), true, `${view} allowed in estudio`);
    for (const other of ['academic', 'genealogy', 'primary_sources', 'databases']) {
      assert.equal(vt.isViewAllowedForVaultType(view, other), false, `${view} hidden in ${other}`);
    }
  }
});

test('teaching reuses the study organisation and analysis surfaces but hides the research universals', () => {
  for (const view of [
    'studyCourses', 'studySchedule', 'studyCalendar', 'studyLibrary', 'studyRecordings',
    'studyChat', 'studyIdeas', 'studyGraph', 'studyQuestions', 'studySearch',
  ]) {
    assert.equal(vt.isViewAllowedForVaultType(view, 'estudio'), true, `${view} allowed in estudio`);
    assert.equal(vt.isViewAllowedForVaultType(view, 'docencia'), true, `${view} allowed in docencia`);
  }
  // The study-only surfaces stay exclusive to estudio and never leak into teaching.
  for (const view of ['studyReview', 'studyDeepResearch']) {
    assert.equal(vt.isViewAllowedForVaultType(view, 'estudio'), true, `${view} allowed in estudio`);
    assert.equal(vt.isViewAllowedForVaultType(view, 'docencia'), false, `${view} hidden in docencia`);
  }
  assert.equal(vt.isViewAllowedForVaultType('teachingUnits', 'docencia'), true);
  for (const other of ['academic', 'estudio', 'genealogy', 'databases']) {
    assert.equal(vt.isViewAllowedForVaultType('teachingUnits', other), false, `teachingUnits hidden in ${other}`);
  }
  // Teaching hides the same research/authoring universals the study mode hides.
  const hidden = vt.defaultHiddenViewsForType('docencia');
  assert.ok(!hidden.includes('studySearch'), 'teaching exposes the shared study search');
  for (const h of ['search', 'library', 'graph', 'ideas', 'authors', 'writing', 'projects', 'deepResearch']) {
    assert.ok(hidden.includes(h), `${h} hidden in docencia`);
  }
  assert.match(vt.vaultTypePromptPack('docencia'), /MODO DOCENCIA/);
});

test('the teaching sidebar keeps the Tools group and never duplicates its own sections', async () => {
  const app = await Promise.resolve(readSource('@shell'));
  const branch = /if \(isDocencia\) \{([\s\S]*?)\n              \}/.exec(app);
  assert.ok(branch, 'the docencia sidebar branch must exist');
  const body = branch[1];
  assert.match(body, /<TeachingSidebar/, 'the teaching sections come from TeachingSidebar');
  // Only the tools group may come from the generic nav: rendering explore/analyze there
  // would print Question bank, Rubrics and Exams a second time.
  assert.match(body, /navGroups\.filter\(\(group\) => group\.id === 'tools'\)/);
  assert.ok(!/navGroups\.map/.test(body), 'the docencia branch must not render every nav group');
  // The Toolkit is a universal view, so it must not be hidden for teaching.
  assert.ok(!vt.defaultHiddenViewsForType('docencia').includes('toolkit'), 'toolkit must stay visible in teaching');
});

test('every section the teaching sidebar navigates to is allowed for docencia', async () => {
  const sidebar = await readFile(path.join(repoRoot, 'src/components/TeachingSidebar.tsx'), 'utf8');
  const views = [...sidebar.matchAll(/\bview:\s*'([A-Za-z]+)'/g)].map((match) => match[1]);
  assert.ok(views.length >= 10);
  for (const view of views) {
    assert.equal(vt.isViewAllowedForVaultType(view, 'docencia'), true, `${view} is wired but not allowed`);
  }
  for (const view of ['studyChat', 'studyIdeas', 'studyGraph', 'teachingUnits']) {
    assert.ok(views.includes(view), `${view} is reachable`);
  }
});

test('defaultHiddenViewsForType returns a fresh copy (no shared mutation)', () => {
  const a = vt.defaultHiddenViewsForType('estudio');
  a.push('mutated');
  assert.ok(!vt.defaultHiddenViewsForType('estudio').includes('mutated'));
});

test('prompt pack: academic empty, estudio carries a persona directive', () => {
  assert.equal(vt.vaultTypePromptPack('academic'), '');
  assert.match(vt.vaultTypePromptPack('estudio'), /MODO ESTUDIO/);
});

test('records views are scoped to primary_sources + genealogy only', () => {
  for (const view of ['persons', 'timeline', 'archive']) {
    assert.equal(vt.isViewAllowedForVaultType(view, 'primary_sources'), true, `${view} allowed for primary_sources`);
    assert.equal(vt.isViewAllowedForVaultType(view, 'genealogy'), true, `${view} allowed for genealogy`);
    assert.equal(vt.isViewAllowedForVaultType(view, 'academic'), false, `${view} hidden for academic`);
    assert.equal(vt.isViewAllowedForVaultType(view, 'estudio'), false, `${view} hidden for estudio`);
  }
  // Universal views are allowed everywhere.
  assert.equal(vt.isViewAllowedForVaultType('library', 'academic'), true);
  assert.equal(vt.isViewAllowedForVaultType('graph', 'genealogy'), true);
});

test('viewsDisallowedForType lists the scoped views not applicable to a type', () => {
  const all = ['home', 'library', 'persons', 'timeline', 'archive', 'settings'];
  assert.deepEqual(vt.viewsDisallowedForType(all, 'academic'), ['persons', 'timeline', 'archive']);
  assert.deepEqual(vt.viewsDisallowedForType(all, 'primary_sources'), []);
});

test('effectiveSidebarHidden: preset when untouched, user choice once customised', () => {
  // Untouched → the type preset drives visibility.
  assert.deepEqual(vt.effectiveSidebarHidden([], false, 'estudio'), vt.defaultHiddenViewsForType('estudio'));
  assert.deepEqual(vt.effectiveSidebarHidden([], false, 'academic'), ['hypothesis', 'reading']);
  // Customised → the user's explicit set wins, regardless of type.
  assert.deepEqual(vt.effectiveSidebarHidden(['graph'], true, 'estudio'), ['graph']);
  assert.deepEqual(vt.effectiveSidebarHidden([], true, 'estudio'), []);
});
