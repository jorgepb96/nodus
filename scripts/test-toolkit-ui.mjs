import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { bridgeSourceText, mainSourceText, readSource } from './ipc-channel-census.mjs';

// Nodus Toolkit — the Herramientas section (hub + per-tool pages). These checks
// cover the wiring that no e2e step can see cheaply: that the view is registered
// in the canonical nav tables, that it stays universal across vault types, and
// that the hub's cards keep the structure the design requires (identical
// shape, centred icons and availability states). The real rendering is asserted by
// the toolkit steps in scripts/e2e-smoke.mjs.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = async (file) => readSource(file);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-toolkit-ui-'));
test.after(() => rm(outDir, { recursive: true, force: true }));

/** Bundle a TS module so its real exported values can be asserted on. */
function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

const navigation = loadModule('src/navigation.ts');
const vaultTypes = loadModule('shared/vaultTypes.ts');

test('the toolkit is a real sidebar section in its own group', () => {
  const item = navigation.NAV_ITEMS.find((n) => n.id === 'toolkit');
  assert.ok(item, 'toolkit is registered in NAV_ITEMS');
  assert.equal(item.group, 'tools', 'toolkit belongs to the tools group');
  assert.equal(item.icon, 'tools');

  const group = navigation.NAV_GROUPS.find((g) => g.id === 'tools');
  assert.ok(group, 'the tools group is declared');
  assert.equal(group.label, 'Herramientas');
  assert.equal(
    navigation.NAV_GROUPS.at(-1).id,
    'tools',
    'Herramientas renders after Explorar · Analizar · Escribir'
  );
});

test('every sidebar icon stays unique so a collapsed sidebar keeps sections apart', () => {
  const icons = navigation.NAV_ITEMS.map((n) => n.icon);
  // Views scoped to different vault types never coexist, so only the toolkit's
  // own icon has to be globally unique — it shows in every vault.
  assert.equal(icons.filter((icon) => icon === 'tools').length, 1, 'the tools icon belongs to the toolkit alone');
});

test('the toolkit and pin icons exist in the shared catalogue', async () => {
  const ui = await read('src/components/ui.tsx');
  for (const icon of ['tools', 'swap', 'shield', 'scanText', 'presentation', 'languages', 'chevronLeft', 'pin', 'drift']) {
    assert.match(ui, new RegExp(`\\n\\s{2}${icon}: '`), `${icon} is defined in ICON_PATHS`);
  }
});

test('the toolkit shows in every vault type, including databases and study', () => {
  for (const type of ['academic', 'genealogy', 'estudio', 'databases', 'primary_sources']) {
    assert.equal(
      vaultTypes.isViewAllowedForVaultType('toolkit', type),
      true,
      `the toolkit is universal (${type})`
    );
    assert.equal(
      vaultTypes.defaultHiddenViewsForType(type).includes('toolkit'),
      false,
      `the toolkit is not hidden by default (${type})`
    );
  }
  // groupedNav must surface the tools group for a default (uncustomised) sidebar.
  const groups = navigation.groupedNav([], [...vaultTypes.defaultHiddenViewsForType('databases'), ...vaultTypes.viewsDisallowedForType(navigation.NAV_ITEMS.map(item => item.id),'databases')]);
  const tools = groups.find((g) => g.id === 'tools');
  assert.ok(tools, 'the tools group survives the databases preset');
  // Order is part of the contract: Compass sits directly below Radar.
  assert.deepEqual(tools.items.map((n) => n.id), ['browser', 'radar', 'compass', 'studyFocus', 'toolkit', 'notes']);
});

test('pinned Toolkit pages become reorderable sidebar shortcuts with their catalogue icons', () => {
  const pinned = navigation.pinnedToolkitSidebarItems(['apps', 'ocr', 'apps', 'unknown']);
  assert.deepEqual(
    pinned.map(({ id, label, icon, toolkitPage }) => ({ id, label, icon, toolkitPage })),
    [
      { id: 'toolkit:apps', label: 'Nodus Apps', icon: 'grid', toolkitPage: 'apps' },
      { id: 'toolkit:ocr', label: 'OCR Workspace', icon: 'scanText', toolkitPage: 'ocr' },
    ],
  );

  const defaultTools = navigation.groupedNav([], ['workspace','notes'], ['apps', 'ocr']).find((group) => group.id === 'tools');
  assert.deepEqual(
    defaultTools.items.map((item) => item.id),
    ['browser', 'radar', 'compass', 'studyFocus', 'toolkit', 'toolkit:apps', 'toolkit:ocr'],
    'new pins start beside the Nodus Tools catalogue',
  );

  const reordered = navigation.groupedNav(
    ['browser', 'toolkit:ocr', 'radar', 'toolkit', 'toolkit:apps', 'compass'],
    ['workspace','notes'],
    ['apps', 'ocr'],
  ).find((group) => group.id === 'tools');
  assert.deepEqual(
    reordered.items.map((item) => item.id),
    ['browser', 'toolkit:ocr', 'radar', 'toolkit', 'toolkit:apps', 'compass', 'studyFocus'],
    'the Settings order applies to parent sections and pinned tools together',
  );
});

test('the Toolkit hub, real sidebar and Settings editor share the pin contract', async () => {
  const [view, app, settings, defaults, appPrefs] = await Promise.all([
    read('src/views/ToolkitView.tsx'),
    read('src/App.tsx'),
    read('src/views/Settings.tsx'),
    read('shared/defaultAppSettings.ts'),
    read('electron/db/appPrefs.ts'),
  ]);
  assert.match(view, /onTogglePinned=\{\(\) => void togglePinned\(tool\.page\)\}/);
  assert.match(app, /settings\?\.toolkitPinnedPages \?\? \[\]/, 'the real sidebar resolves the saved pins');
  assert.match(app, /setToolkitPage\(n\.toolkitPage\)[\s\S]*?setView\('toolkit'\)/, 'a shortcut opens its nested Toolkit page');
  assert.match(settings, /groupedNav\(sidebarOrder, \[\], toolkitPinnedPages\)/, 'Settings uses the real Tools group');
  assert.match(settings, /toolkitPinnedPages=\{settings\.toolkitPinnedPages\}/, 'Settings receives the persistent pin set');
  assert.match(defaults, /toolkitPinnedPages: \['drift'\]/, 'a new profile starts with Nodus Drift pinned, as Nodus Browser is in the sidebar; a saved profile keeps its own pins');
  assert.match(appPrefs, /'toolkitPinnedPages'/, 'pins follow the user when switching vaults');
});

test('the hub renders every built tool including Nodus Translate', async () => {
  const view = await read('src/views/ToolkitView.tsx');
  assert.ok(view.includes('data-testid="toolkit-home"'), 'the hub is addressable');
  // The cards receive their testid as a prop; ToolCard is what stamps it onto the DOM.
  assert.match(view, /data-testid=\{testid\}/, 'ToolCard exposes its testid to the DOM');

  // The catalogue is data, not markup: the hub cards and the nested sidebar
  // buttons both render from TOOLKIT_TOOLS, so they cannot describe a different
  // set of tools from each other.
  assert.deepEqual(
    navigation.TOOLKIT_TOOLS.map((tool) => `toolkit-card-${tool.testid}`),
    ['toolkit-card-apps', 'toolkit-card-browser', 'toolkit-card-compass', 'toolkit-card-convert', 'toolkit-card-drift', 'toolkit-card-focus', 'toolkit-card-protect', 'toolkit-card-radar', 'toolkit-card-scriptor', 'toolkit-card-translate', 'toolkit-card-aiocr', 'toolkit-card-presenter']
  );
  assert.deepEqual(
    navigation.TOOLKIT_TOOLS.map((tool) => tool.name),
    ['Nodus Apps', 'Nodus Browser', 'Nodus Compass', 'Nodus Convert', 'Nodus Drift', 'Nodus Focus', 'Nodus Protect', 'Nodus Radar', 'Nodus Scriptor', 'Nodus Translate', 'OCR Workspace', 'PDF Presenter'],
    'brand names stay untranslated'
  );
  assert.match(view, /name=\{tool\.name\}/, 'the card shows the brand name verbatim, never through t()');
  assert.match(view, /description=\{t\(tool\.description\)\}/, 'only the description is translated');
  assert.match(view, /data-testid=\{`\$\{testid\}-pin`\}/, 'every card exposes its pin control');
  assert.match(view, /aria-pressed=\{pinned\}/, 'pin state is accessible');
  assert.match(view, /toolkitPinnedPages:/, 'pinning persists the selected Toolkit page');
  assert.match(view, /sidebarOrder: isPinned/, 'unpinning retires stale order entries');

  // Every tool is built and openable; none is coming soon.
  assert.deepEqual(
    navigation.TOOLKIT_TOOLS.filter((tool) => tool.state === 'soon').map((tool) => tool.page),
    [],
    'no tool is marked coming soon'
  );
  assert.deepEqual(
    navigation.TOOLKIT_TOOLS.filter((tool) => tool.state === 'wip').map((tool) => tool.page),
    ['apps', 'browser', 'compass', 'convert', 'drift', 'studyFocus', 'protect', 'radar', 'workspace', 'translate', 'ocr', 'presenter'],
    'every tool uses the in-development badge'
  );
  assert.match(view, /const disabled = state === 'soon'/);
  assert.match(view, /onClick=\{disabled \? undefined : onOpen\}/, 'a coming-soon card has no click handler');
  // The built cards open their real workspaces, not placeholders.
  assert.match(view, /<ToolkitAppsView onBack=/, 'Nodus Apps renders the functional catalogue');
  assert.match(view, /<ToolkitConvertView onBack=/, 'Nodus Convert renders the functional converter');
  assert.match(view, /<ToolkitDriftView onBack=/, 'Nodus Drift renders its own page inside Tools');
  assert.match(view, /<ToolkitProtectView onBack=/, 'Nodus Protect renders the functional protection flow');
  assert.match(view, /<ToolkitTranslateView onBack=/, 'Nodus Translate renders the functional translation workspace');
  assert.match(view, /<ToolkitPresenterView onBack=/, 'PDF Presenter renders the functional library');
  assert.match(view, /<ToolkitAiOcrView onBack=/, 'OCR Workspace renders the functional library');
  // Any page other than the built ones falls back to the catalogue rather than
  // rendering an empty pane.
  assert.match(view, /page === 'drift'/, 'Nodus Drift has its own routed page');
  assert.match(view, /page === 'protect'/, 'Protect has its own routed workspace');
  assert.match(view, /page === 'translate'/, 'Translate has its own routed workspace');
  assert.match(view, /page === 'presenter'/, 'PDF Presenter has its own routed workspace');
  assert.match(view, /page === 'ocr'/, 'OCR Workspace has its own routed workspace');
});

test('file Toolkit apps keep the shared hero while Drift owns its ambient workspace', async () => {
  const hero = await read('src/components/ToolkitAppHero.tsx');
  for (const marker of ['rounded-3xl', 'border-amber-200', 'bg-gradient-to-br', 'from-amber-50', 'via-white', 'to-indigo-50', 'btn btn-primary']) {
    assert.ok(hero.includes(marker), `the shared hero keeps the Apps visual marker ${marker}`);
  }

  const views = [
    ['src/views/ToolkitAppsView.tsx', 'toolkit-apps-hero'],
    ['src/views/ToolkitConvertView.tsx', 'toolkit-convert-hero'],
    ['src/views/ToolkitProtectView.tsx', 'toolkit-protect-hero'],
    ['src/views/ToolkitTranslateView.tsx', 'toolkit-translate-hero'],
    ['src/views/ToolkitPresenterView.tsx', 'toolkit-presenter-hero'],
    ['src/views/ToolkitAiOcrView.tsx', 'toolkit-aiocr-hero'],
  ];
  for (const [file, testId] of views) {
    const source = await read(file);
    assert.match(source, /<ToolkitAppHero\b/, `${file} uses the one shared first-screen header`);
    assert.ok(source.includes(`heroTestId="${testId}"`), `${file} exposes its hero for visual regression checks`);
  }

  const drift = await read('src/views/ToolkitDriftView.tsx');
  assert.doesNotMatch(drift, /ToolkitAppHero/);
  assert.match(drift, /drift-workspace theme-workspace-surface/);
  assert.match(drift, /data-testid="toolkit-drift-hero"/);

  const presenter = await read('src/views/ToolkitPresenterView.tsx');
  assert.equal((presenter.match(/data-testid="presenter-import"/g) ?? []).length, 0, 'Presenter does not duplicate the import action below its hero');
  assert.equal((presenter.match(/actionTestId="presenter-import"/g) ?? []).length, 1, 'Presenter keeps one primary import action in its hero');
});

test('Translate exposes balanced text panes, resilient Zotero controls and persistent history', async () => {
  const [view, preload, ipc, history, shared] = await Promise.all([
    read('src/views/ToolkitTranslateView.tsx'),
    Promise.resolve(bridgeSourceText()),
    Promise.resolve(mainSourceText()),
    read('electron/toolkit/translate/history.ts'),
    read('shared/toolkitTranslateTypes.ts'),
  ]);
  assert.match(view, /translate-source-text[^>]+w-full/, 'the source textarea fills its grid column');
  assert.match(view, /grid gap-6 lg:grid-cols-2/, 'source and result use balanced columns with a visible gutter');
  assert.match(view, /\['history', 'Historial', 'clock'\]/, 'history is a first-class fourth section');
  assert.match(view, /input input-with-leading-icon w-full/, 'Zotero search reserves space for its icon');
  assert.match(view, /translate-zotero-reconnect/, 'a failed Zotero connection can be retried explicitly');
  assert.match(view, /disposed = true/, 'stale Zotero searches cannot overwrite a newer result');
  for (const marker of ['listTranslateHistory', 'removeTranslateHistory']) {
    assert.ok(preload.includes(marker), `preload exposes ${marker}`);
    assert.ok(view.includes(marker), `renderer uses ${marker}`);
  }
  assert.match(ipc, /shell\.trashItem/, 'deleting a generated document uses the recoverable OS Trash');
  assert.match(history, /history\.json/, 'history is persisted below userData');
  assert.match(shared, /interface TranslateHistoryEntry/, 'history has a shared typed contract');
});

test('Protect exposes the complete local workflow and the secure preload boundary', async () => {
  const [view, preload, ipc, shared] = await Promise.all([
    read('src/views/ToolkitProtectView.tsx'),
    Promise.resolve(bridgeSourceText()),
    Promise.resolve(mainSourceText()),
    read('shared/protectTypes.ts'),
  ]);
  for (const marker of ['protect-home', 'Proteger documentos', 'Verificar una copia trazable', 'Guardar como…', 'Guardar en esta bóveda', 'Compartir']) {
    assert.ok(view.includes(marker), `Protect includes ${marker}`);
  }
  assert.match(view, /data-testid="toolkit-protect-back"/);
  assert.match(view, /maxLength=\{120\}/, 'trace labels are capped');
  assert.match(view, /verifyPayloadCache/, 'passphrase retries reuse the loaded bytes');
  assert.match(view, /\(pixel\.flags & 1\) !== 0/, 'verification derives open/keyed mode from the frozen IDPS flag');
  assert.match(preload, /webUtils\.getPathForFile/, 'dropped File objects become trusted native paths only in preload');
  assert.match(ipc, /protect\.invalidateProtectVaultReferences\(\)/, 'switching vault revokes main-process source capabilities');
  for (const typeName of ['ProtectSourceRef', 'ProtectSourceSummary', 'ProtectFilePayload', 'ProtectArtifact', 'ProtectVaultCopySummary']) {
    assert.ok(shared.includes(`interface ${typeName}`) || shared.includes(`type ${typeName}`), `${typeName} is shared`);
  }
});

test('Toolkit tools remain nested destinations even when pinned into the sidebar', async () => {
  const app = await read('@shell');
  // The tools are NOT views: the optional shortcuts are namespaced ids and open
  // the existing nested page, so vault-type allow-lists never need to grow.
  const toolPages = new Set(navigation.TOOLKIT_TOOLS.filter((tool) => !navigation.isToolkitStandalonePage(tool.page)).map((tool) => tool.page));
  assert.ok(
    !navigation.NAV_ITEMS.some((n) => toolPages.has(n.id)),
    'the tools stay out of the canonical nav table'
  );
  assert.doesNotMatch(app, /toolkitSubNav/, 'the sidebar does not render nested tool buttons');
  assert.match(app, /if \(n\.id === 'toolkit'\) setToolkitPage\('home'\);/, 'the section button opens the catalogue');
  assert.match(app, /'toolkitPage' in n[\s\S]*?toolkitPage === n\.toolkitPage/, 'only the shortcut for the open tool is highlighted');
  assert.match(app, /n\.id !== 'toolkit' \|\| toolkitPage === 'home'/, 'the catalogue entry is inactive inside a tool');
});

test('the hub cards share one shape and omit development labels', async () => {
  const view = await read('src/views/ToolkitView.tsx');
  // One ToolCard component renders every card, so they cannot drift apart.
  assert.equal((view.match(/<ToolCard\b/g) ?? []).length, 1, 'a single ToolCard renders the whole catalogue');
  assert.match(view, /grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3/, 'the cards adapt from one to three columns');
  assert.match(view, /className=\{`toolkit-card flex h-full w-full flex-col/, 'each card fills its grid cell');
  assert.match(view, /h-12 w-12 shrink-0 items-center justify-center/, 'the card icon sits in a fixed centred tile');
  assert.doesNotMatch(view, /t\('En desarrollo'\)/, 'available apps do not show a development label');
  assert.match(view, /disabled && \(/, 'only unavailable tools render a status label');
  // The spin/transform clash that made a previous spinner bob instead of rotate.
  assert.ok(!/animate-spin[^"'`]*-translate-y/.test(view), 'no spinner shares an element with a transform');
});

test('a tool page returns to the hub and keeps the shared hero action row uniform', async () => {
  const [view, convert, protect, hero, app] = await Promise.all([
    read('src/views/ToolkitView.tsx'),
    read('src/views/ToolkitConvertView.tsx'),
    read('src/views/ToolkitProtectView.tsx'),
    read('src/components/ToolkitAppHero.tsx'),
    read('@shell'),
  ]);
  // Each workspace configures the shared back-to-hub control without restyling it.
  assert.ok(convert.includes('backTestId="toolkit-back"'), 'the Convert back control exists');
  assert.ok(protect.includes('backTestId="toolkit-protect-back"'), 'the Protect back control exists');
  assert.match(hero, /<Icon name="arrowLeft"/, 'back uses the shared arrow icon');
  assert.match(hero, /Nodus Toolkit/, 'the visible back label names its destination for screen readers');
  assert.match(view, /onBack=\{\(\) => onNavigate\('home'\)\}/, 'the hub passes a back handler to the tool');
  // Header actions are icon-only buttons of one height; the toolkit must not be
  // the odd one out.
  assert.match(app, /<HeaderAction[\s\S]*?icon="tools"[\s\S]*?label=\{t\('Herramientas'\)\}/, 'the header exposes the toolkit');
  assert.match(app, /title=\{t\('Abrir Nodus Toolkit'\)\}/);
  assert.match(
    app,
    /toolkit: \([^)]*\) => <ToolkitView page=\{toolkitPage\} onNavigate=\{setToolkitPage\} onOpenView=\{setView\} settings=\{settings\} vaultType=\{activeVault\?\.type\} \/>/,
    'every vault renders the same generic Toolkit whose active page App owns'
  );
  assert.doesNotMatch(app, /PrimarySourcesToolkitView/, 'there is no primary-source Toolkit fork');
  assert.match(app, /const ToolkitView = lazy\(/, 'the view is code-split like its siblings');
});

test('Convert leads with the formats it accepts, then offers a grouped searchable menu', async () => {
  const convert = await read('src/views/ToolkitConvertView.tsx');
  const toolkit = loadModule('shared/toolkitTypes.ts');

  // The empty state advertises what can be dropped — a dropzone with no catalogue
  // is the blind guess this redesign removes.
  assert.ok(convert.includes('data-testid="toolkit-formats"'), 'the supported-formats panel is addressable');
  assert.match(convert, /\{\(!hasFiles \|\| availableOps\.length === 0\) && <SupportedFormats \/>\}/,
    'the catalogue shows on the empty state and again when nothing matches');
  // Every category contributes to the panel, and the checksum operation's
  // "any file" case is stated rather than silently dropped.
  assert.equal(toolkit.TOOLKIT_CATEGORIES.length, 5, 'all five families are catalogued');
  assert.ok(toolkit.TOOLKIT_OPS.some((op) => op.inputExts.length === 0), 'an any-file operation exists');
  assert.match(convert, /anyFile: ops\.some\(\(op\) => op\.inputExts\.length === 0\)/, 'the panel marks the any-file family');

  // The operation menu replaced the category rail: categories are group headers
  // inside one searchable popover, not a pre-filter the user has to guess first.
  assert.ok(!convert.includes('toolkit-cat-'), 'the category rail is gone');
  assert.ok(convert.includes('data-testid="toolkit-op-picker"'), 'the conversion menu has a trigger');
  assert.ok(convert.includes('data-testid="toolkit-op-search"'), 'the menu has a search box');
  assert.match(convert, /opsForInputs\(files\)/, 'the menu offers operations from every category, not one');
  assert.match(convert, /createPortal\(/, 'the menu is portaled out of the overflow-hidden shell');
  // Accent-insensitive search, or "imagenes" finds nothing under "Imágenes".
  assert.match(convert, /normalize\('NFD'\)/, 'search folds accents');

  // Only compatible operations are listed, so the menu can never offer a failure.
  const forPdf = toolkit.opsForInputs(['/tmp/a.pdf']).map((op) => op.id);
  assert.ok(forPdf.includes('pdf-to-txt') && forPdf.includes('ocr-pdf-searchable'), 'a PDF spans several categories');
  assert.ok(!forPdf.includes('heic-convert'), 'an incompatible operation is never offered');
  assert.ok(!forPdf.includes('pdf-merge'), 'a merge needing two inputs is withheld from a single file');
  assert.deepEqual(toolkit.opsForInputs([]), [], 'nothing is offered before a file is added');
});

test('a batch reports its progress on a bar, and says why a file failed', async () => {
  const convert = await read('src/views/ToolkitConvertView.tsx');
  const { jobOverallProgress, jobCurrentFile } = loadModule('shared/toolkitTypes.ts');

  const file = (inputPath, status, pct = null, error = null) => ({ inputPath, status, pct, outputPaths: [], error });
  const snapshot = (files, activeIndex, done, extra = {}) => ({
    jobId: 'j', files, activeIndex, done, total: files.length, cancelled: false, finished: false, ...extra,
  });

  // A batch advances by completed files…
  const batch = [file('/a.pdf', 'done'), file('/b.pdf', 'processing', 0.5), file('/c.pdf', 'pending'), file('/d.pdf', 'pending')];
  assert.equal(jobOverallProgress(snapshot(batch, 1, 1)), 0.375, '1 done + half of the second, out of 4');

  // …and a single long file still moves, instead of sitting at 0 until it flips
  // to 100 — the whole point of the bar for a slow OCR run.
  const solo = [file('/scan.pdf', 'processing', 0.4)];
  assert.equal(jobOverallProgress(snapshot(solo, 0, 0)), 0.4, 'intra-file progress drives the bar');
  assert.equal(jobOverallProgress(snapshot(solo, 0, 0, { finished: true })), 1, 'a finished job reads full');
  assert.equal(
    jobOverallProgress(snapshot(batch, 1, 1, { finished: true, cancelled: true })),
    0.25,
    'a cancelled job reports what it actually got through, not 100 %'
  );
  assert.equal(jobOverallProgress(snapshot([], -1, 0)), 0, 'an empty batch never divides by zero');

  // The ordinal and the file name must come from the same file. Between two files
  // activeIndex still points at the one that just finished, which used to render
  // as "Procesando 2 de 5" beside the name of file 1.
  const between = [file('/a.pdf', 'done'), file('/b.pdf', 'pending'), file('/c.pdf', 'pending')];
  const current = jobCurrentFile(snapshot(between, 0, 1));
  assert.equal(current.file.inputPath, '/b.pdf', 'the next pending file is the one being announced');
  assert.equal(current.ordinal, 2, 'its ordinal matches its own position');
  assert.equal(jobCurrentFile(snapshot(between, 0, 1, { finished: true })), null, 'a finished job announces no file');

  // The view renders that as an accessible bar, and no longer swallows the reason
  // a file failed.
  assert.ok(convert.includes('data-testid="toolkit-progress"'), 'the progress card is addressable');
  assert.match(convert, /role="progressbar"/, 'the bar is exposed to assistive tech');
  assert.match(convert, /aria-valuenow=\{Math\.round\(overallPct \* 100\)\}/, 'the bar reports its real value');
  assert.match(convert, /\{tr\(fp\.error\)\}/, 'a failed file shows its (localised) reason, not just a red pill');
});

test('leaving the page never stops the batch, and coming back restores it', async () => {
  // The promise driving a conversion lives in the module-level background store,
  // not in the component, so unmounting the view (navigating to another section)
  // must not touch the work in flight.
  const store = loadModule('src/backgroundJobs.ts');
  const { TOOLKIT_JOB_KEY, startToolkitJob, getBackgroundJob, subscribeBackgroundJob, clearBackgroundJob } = store;

  const seen = [];
  let emit;
  let settle;
  globalThis.window = {
    nodus: {
      runToolkitJob: (_request, handlers) => {
        emit = handlers.onProgress;
        return new Promise((resolve) => { settle = resolve; });
      },
    },
  };

  const request = { opId: 'pdf-to-txt', inputPaths: ['/a.pdf', '/b.pdf'], outputFormat: 'txt', options: {}, outputDir: null, mergedName: null, zipOutput: false, zipName: null, openFolderOnDone: false };
  const unsubscribe = subscribeBackgroundJob(TOOLKIT_JOB_KEY, (job) => seen.push(job?.progress?.done ?? null));
  startToolkitJob(request);
  await new Promise((r) => setImmediate(r));

  emit({ jobId: 'j', files: [], activeIndex: 0, done: 1, total: 2, cancelled: false, finished: false });
  assert.equal(getBackgroundJob(TOOLKIT_JOB_KEY).progress.done, 1);

  // "Leaving the page": every subscriber goes away.
  unsubscribe();
  assert.equal(
    clearBackgroundJob(TOOLKIT_JOB_KEY),
    false,
    'a running job is never dropped from the store — that would orphan the work'
  );

  // Work continues while nothing is listening, and the store keeps recording it.
  emit({ jobId: 'j', files: [], activeIndex: 1, done: 2, total: 2, cancelled: false, finished: true });
  settle({ jobId: 'j', files: [], cancelled: false, zipPath: null });
  await new Promise((r) => setImmediate(r));

  const after = getBackgroundJob(TOOLKIT_JOB_KEY);
  assert.equal(after.progress.done, 2, 'progress advanced with no subscriber attached');
  assert.equal(after.status, 'completed', 'the job ran to completion after the view unmounted');
  // "Coming back": a fresh subscriber is handed the finished job immediately.
  let onReturn = null;
  subscribeBackgroundJob(TOOLKIT_JOB_KEY, (job) => { onReturn = job; })();
  assert.equal(onReturn.status, 'completed');
  assert.deepEqual(onReturn.request.inputPaths, ['/a.pdf', '/b.pdf'], 'the batch is recoverable from the job itself');
  delete globalThis.window;

  // …which is exactly what the view seeds itself from. Without this the user
  // returns to the empty "drop files here" state with a stray progress card, and
  // loses the "Mostrar" links to the outputs that were just produced.
  const convert = await read('src/views/ToolkitConvertView.tsx');
  assert.match(convert, /function restoredRequest\(\)/, 'the view can read the in-flight job request');
  for (const [state, field] of [
    ['files', 'inputPaths'], ['opId', 'opId'], ['outputFormat', 'outputFormat'], ['options', 'options'],
    ['outputDir', 'outputDir'], ['zipOverride', 'zipOutput'], ['openOnDone', 'openFolderOnDone'],
  ]) {
    assert.match(
      convert,
      new RegExp(`\\[${state}, set\\w+\\] = useState[^\\n]*restoredRequest\\(\\)\\?\\.${field}`),
      `${state} is restored from the running job`
    );
  }
});

test('Nodi documents the toolkit with its real, honest state', async () => {
  const docs = await read('shared/nodiDocumentation.ts');
  assert.match(docs, /## Herramientas \(Nodus Toolkit\)/);
  // The Toolkit surfaces can all be opened now; the guide and roadmap say so.
  assert.match(docs, /Nodus Convert ya funciona/, 'the guide states Convert works');
  assert.match(docs, /PDF Presenter ya se puede abrir/, 'the guide states the presenter library is available');
  assert.match(docs, /OCR Workspace ya se puede abrir/, 'the guide states the OCR workspace is available');
  assert.match(docs, /determinista y 100 % offline/, 'the guide states the privacy/offline principle');
  // The roadmap line must no longer list the Toolkit as merely planned.
  assert.ok(
    !/El roadmap también contempla Nodus Toolkit/.test(docs),
    'the toolkit is no longer described as only a roadmap item'
  );
});
