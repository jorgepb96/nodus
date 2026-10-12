import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

// The video tutorials are the one place Nodus embeds a remote frame, and the one place
// the tutorial's twelve languages are served from a table that is NOT the i18n one.
// Both facts are load-bearing, so they are pinned here.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = async (file) => readSource(file);

// shared/tutorialVideos.ts only imports types, so a plain esbuild bundle is enough.
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tutorial-videos-'));
const bundle = path.join(outDir, 'tutorialVideos.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'shared/tutorialVideos.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' }
);
const catalogue = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

// ── the catalogue ───────────────────────────────────────────────────────────────

test('the published tutorials keep their ids, shelves and vault mapping', () => {
  assert.deepEqual(
    catalogue.TUTORIAL_VIDEOS.map((video) => [video.id, video.youtubeId, video.order, video.category]),
    [
      ['essentials', 'QqSY1_DeDRM', 1, 'introduction'],
      ['academic', 'Z-5CpJBVV_I', 2, 'vaults'],
      ['genealogy', 'UPz7bqN5znE', 3, 'vaults'],
      ['databases', '4ooNmZVx0dA', 4, 'vaults'],
      ['teaching', '5LsojBiM348', 5, 'vaults'],
      ['nodi', '5OTe5CtefME', 6, 'features'],
      ['toolkit', '-xhDw_Y0vpA', 7, 'features'],
      ['pdf-presenter', 'e2js_u-05OA', 7.5, 'features'],
      ['word', 'GFVOJ0JNPMw', 8, 'integrations'],
      ['zotero', 'lMWW8JJrl2c', 9, 'integrations'],
      ['mcp', 'qa2xPiOmV2c', 10, 'integrations'],
    ]
  );
  // Exactly one tutorial is an `introduction`: the first-run guide shows that one alone,
  // so a second would silently make the guide pick between them.
  assert.deepEqual(catalogue.TUTORIAL_VIDEOS.filter((v) => v.category === 'introduction').map((v) => v.id), ['essentials']);
  assert.equal(catalogue.TUTORIAL_INTRO_VIDEO_ID, 'essentials');
  assert.equal(catalogue.tutorialVideo(catalogue.TUTORIAL_INTRO_VIDEO_ID).youtubeId, 'QqSY1_DeDRM');

  // Four vault tours can now be replaced by a video. The remaining dedicated tours
  // still expose the route as a disabled "coming soon" placeholder.
  for (const [type, id] of [['academic', 'academic'], ['genealogy', 'genealogy'], ['databases', 'databases'], ['docencia', 'teaching']]) {
    assert.equal(catalogue.tutorialVideoForVault(type).id, id, `${type} is covered by the ${id} video`);
  }
  for (const type of ['estudio', 'primary_sources', 'prosopography', 'worldbuilding', 'testimonios']) {
    assert.equal(catalogue.tutorialVideoForVault(type), undefined, `${type} has no video yet`);
  }
  assert.equal(catalogue.tutorialVideoForVault(undefined), undefined);
  // Every video that names a vault sits on the vaults shelf, and vice versa: the tabs
  // and the tours would otherwise disagree about what a "vault tutorial" is.
  for (const video of catalogue.TUTORIAL_VIDEOS) {
    assert.equal(Boolean(video.vaultType), video.category === 'vaults', `${video.id} disagrees about its shelf`);
  }
});

test('the shelves are ordered vaults → features → integrations, behind the introduction', () => {
  assert.deepEqual(catalogue.TUTORIAL_CATEGORIES, ['introduction', 'vaults', 'features', 'integrations']);
  const shelves = catalogue.tutorialVideoShelves(catalogue.TUTORIAL_VIDEOS, { language: 'en' });
  assert.deepEqual(shelves.map((shelf) => shelf.category), ['introduction', 'vaults', 'features', 'integrations']);
  assert.deepEqual(shelves.map((shelf) => shelf.videos.map((video) => video.id)), [
    ['essentials'],
    ['academic', 'genealogy', 'databases', 'teaching'],
    ['nodi', 'toolkit', 'pdf-presenter'],
    ['word', 'zotero', 'mcp'],
  ]);
  // A tab narrows to one shelf; the empty ones are dropped rather than left as headings
  // with nothing under them.
  const vaults = catalogue.tutorialVideoShelves(catalogue.TUTORIAL_VIDEOS, { language: 'en', category: 'vaults' });
  assert.deepEqual(vaults.map((shelf) => shelf.category), ['vaults']);
  // No filter at all is the default state, and it hides nothing.
  assert.equal(
    catalogue.tutorialVideoShelves(catalogue.TUTORIAL_VIDEOS).flatMap((shelf) => shelf.videos).length,
    catalogue.TUTORIAL_VIDEOS.length,
  );
});

test('search reads titles, descriptions and shelf names, accents and all', () => {
  const find = (query, language = 'es') => catalogue
    .tutorialVideoShelves(catalogue.TUTORIAL_VIDEOS, { language, query })
    .flatMap((shelf) => shelf.videos.map((video) => video.id));
  assert.deepEqual(find('zotero'), ['zotero']);
  // Accent- and case-insensitive: a Spanish reader typing on a US layout still finds it.
  assert.deepEqual(find('genealogia'), ['genealogy']);
  assert.deepEqual(find('GENEALOGÍA'), ['genealogy']);
  // Words may arrive in any order, and the shelf name is searchable too.
  assert.deepEqual(find('integraciones word'), ['word']);
  assert.deepEqual(find('word integraciones'), ['word']);
  // The description counts: "rúbricas" appears only in the teaching video's body.
  assert.deepEqual(find('rubricas'), ['teaching']);
  // English copy for an English reader, and no cross-language false positives.
  assert.deepEqual(find('gradebook', 'en'), ['teaching']);
  assert.deepEqual(find('cuaderno de notas', 'en'), []);
  // An empty or whitespace query is not a filter.
  assert.equal(find('  ').length, catalogue.TUTORIAL_VIDEOS.length);
  // Nothing matched is an empty list, never an exception.
  assert.deepEqual(find('qwertyuiop'), []);
});

test('embeds go to the no-cookie host, in the tutorial language', () => {
  const video = catalogue.tutorialVideo('essentials');
  const url = new URL(catalogue.youtubeEmbedUrl(video, 'ja'));
  assert.equal(url.origin, 'https://www.youtube-nocookie.com');
  assert.equal(url.pathname, '/embed/QqSY1_DeDRM');
  assert.equal(url.searchParams.get('hl'), 'ja');
  assert.equal(url.searchParams.get('rel'), '0', 'the end screen stays on this channel');
  assert.equal(catalogue.youtubeWatchUrl(video), 'https://www.youtube.com/watch?v=QqSY1_DeDRM');
  assert.equal(catalogue.TUTORIAL_VIDEO_EMBED_ORIGIN, 'https://www.youtube-nocookie.com');
});

test('every language the cinematic guide offers has full video copy', async () => {
  const tutorial = await read('src/views/BasicsTutorial.tsx');
  // The languages are declared once, in the guide's own picker. Read them from there so
  // adding a fifteenth language fails here instead of silently serving it English.
  const codes = [...tutorial.matchAll(/\{ code: '([\w-]+)', label:/g)].map((match) => match[1]);
  assert.equal(codes.length, 14, `the guide offers fourteen languages, found ${codes.length}`);

  const spanish = catalogue.tutorialVideoCopy('es');
  for (const code of codes) {
    const copy = catalogue.tutorialVideoCopy(code);
    for (const key of ['chooseTitle', 'chooseLede', 'gridTitle', 'gridLede', 'more', 'watched', 'markUnwatched', 'openExternal', 'hosting', 'close', 'play', 'tourVideo', 'allCategories', 'searchPlaceholder', 'searchLabel', 'noMatches', 'startHere', 'startHereLede']) {
      assert.ok(typeof copy[key] === 'string' && copy[key].trim().length > 0, `${code}.${key} is missing`);
    }
    for (const option of ['videoOption', 'textOption', 'whereVaults', 'whereSettings']) {
      assert.ok(copy[option].title.trim().length > 0, `${code}.${option}.title is missing`);
      assert.ok(copy[option].body.trim().length > 0, `${code}.${option}.body is missing`);
    }
    assert.ok(copy.videoOption.badge.trim().length > 0, `${code} does not mark the recommended option`);
    // The shelves are headings, tabs AND search terms, so a missing one is invisible
    // until someone types in that language.
    for (const shelf of catalogue.TUTORIAL_CATEGORIES) {
      assert.ok(copy.categories[shelf]?.trim().length > 0, `${code}.categories.${shelf} is missing`);
    }
    for (const video of catalogue.TUTORIAL_VIDEOS) {
      assert.ok(copy.videos[video.id]?.title.trim().length > 0, `${code}.videos.${video.id}.title is missing`);
      assert.ok(copy.videos[video.id]?.body.trim().length > 0, `${code}.videos.${video.id}.body is missing`);
    }
    if (code === 'es') continue;
    // A table that merely falls back to Spanish would satisfy every check above.
    assert.notEqual(copy.more, spanish.more, `${code} falls back to the Spanish "more on the way"`);
    assert.notEqual(copy.videos.essentials.title, spanish.videos.essentials.title, `${code} falls back to Spanish video titles`);
    assert.notEqual(copy.whereSettings.body, spanish.whereSettings.body, `${code} falls back to the Spanish "all the tutorials are in Settings"`);
  }
});

test('every language names all four shelves, and names them apart', () => {
  for (const code of catalogue.TUTORIAL_COPY_LANGUAGES) {
    const names = catalogue.TUTORIAL_CATEGORIES.map((shelf) => catalogue.tutorialVideoCopy(code).categories[shelf]);
    assert.equal(new Set(names).size, 4, `${code} reuses a shelf name, so two tabs read the same`);
  }
});

test('the copy tells the reader where the rest of the tutorials are', () => {
  // The promise the first-run screen makes: each vault's video at creation, and ALL of
  // them in Settings. Both halves have to survive a translation pass.
  const en = catalogue.tutorialVideoCopy('en');
  assert.match(en.whereSettings.body, /Settings/);
  for (const shelf of ['Introduction', 'Vaults', 'Features', 'Integrations']) {
    assert.match(en.whereSettings.body, new RegExp(shelf), `the English copy does not name ${shelf}`);
  }
  assert.match(en.whereVaults.body, /create/i);
  const es = catalogue.tutorialVideoCopy('es');
  assert.match(es.whereSettings.body, /Ajustes/);
  for (const shelf of ['Introducción', 'Bóvedas', 'Funciones', 'Integraciones']) {
    assert.match(es.whereSettings.body, new RegExp(shelf), `the Spanish copy does not name ${shelf}`);
  }
  // The section really is called "Ayuda"/"Help": pointing at a tab that does not exist
  // is worse than saying nothing.
  assert.match(es.chooseLede, /Ajustes → Ayuda/);
  assert.match(en.chooseLede, /Settings → Help/);
});

test('"more tutorials on the way" is promised in every language', () => {
  for (const code of ['es', 'en', 'fr', 'tr', 'de', 'it', 'pt', 'pt-BR', 'zh', 'ja', 'ru', 'uk']) {
    assert.ok(catalogue.tutorialVideoCopy(code).more.length > 0, `${code} says nothing about more tutorials`);
  }
  assert.match(catalogue.tutorialVideoCopy('en').more, /more/i);
  assert.match(catalogue.tutorialVideoCopy('es').more, /próximamente/i);
  // An unknown code must not crash the grid; English is the documented fallback.
  assert.equal(catalogue.tutorialVideoCopy('xx').more, catalogue.tutorialVideoCopy('en').more);
});

// ── the surfaces ────────────────────────────────────────────────────────────────

test('the CSP admits the tutorial embed and nothing wider', async () => {
  const html = await read('index.html');
  assert.match(
    html,
    /frame-src[^;]*https:\/\/www\.youtube-nocookie\.com;/,
    'frame-src names the no-cookie host',
  );
  // frame-src overrides child-src for frames, so youtube.com proper must stay out: the
  // watch page is opened in the system browser, never framed.
  assert.doesNotMatch(html, /frame-src[^;]*https:\/\/www\.youtube\.com/);
});

test('the grid never reaches Google until a video is opened', async () => {
  const grid = await read('src/components/TutorialVideos.tsx');
  // Posters are local: a gradient, or a WebP dropped into src/assets/tutorials/. A
  // remote thumbnail would make the mere sight of the grid a request to Google.
  assert.doesNotMatch(grid, /ytimg|img\.youtube|<img/);
  assert.match(grid, /video\.poster/);
  assert.match(grid, /import\.meta\.glob<string>\('\.\.\/assets\/tutorials\/\*/);
  // The one request the grid does make is the catalogue, and it goes through the main
  // process — the renderer's CSP knows nothing about that host.
  assert.match(grid, /window\.nodus\.getTutorialCatalogue\(\)/);
  const html = await read('index.html');
  assert.doesNotMatch(html, /connect-src[^;]*nodusresearch/);
  // The iframe only exists inside the player, which is mounted on click.
  assert.match(grid, /\{playing && <TutorialVideoPlayer/);
  assert.match(grid, /allowFullScreen/, 'the player can go fullscreen');
  assert.match(grid, /allow="autoplay; encrypted-media; fullscreen; picture-in-picture"/);
  assert.match(grid, /void markWatched\(video\.id\)/, 'opening a video marks it watched');
  assert.match(grid, /unmarkWatched/, 'and the user can undo that');
  assert.match(grid, /openExternal\(youtubeWatchUrl\(video\)\)/, 'the browser stays available as a fallback');
});

test('the watched flags are app-wide, like the tutorial version they sit next to', async () => {
  const [types, defaults, prefs] = await Promise.all([
    read('@api'),
    read('electron/db/settingsRepo.ts'),
    read('electron/db/appPrefs.ts'),
  ]);
  assert.match(types, /tutorialVideosWatched: string\[\]/);
  assert.match(defaults, /tutorialVideosWatched: \[\]/);
  assert.match(prefs, /'tutorialVideosWatched'/, 'a video watched in one vault stays watched in the others');
});

test('the cinematic guide offers video or text, and both complete it', async () => {
  const tutorial = await read('src/views/BasicsTutorial.tsx');
  // The choice is the third gate: it must come AFTER the two mandatory ones, so the
  // cards and the grid are already in the chosen language.
  const languageGate = tutorial.indexOf("if (!tutorialLanguage) return");
  const styleGate = tutorial.indexOf('if (!styleChosen) return');
  const modeGate = tutorial.indexOf('if (!learnMode) return');
  assert.ok(languageGate > 0 && styleGate > languageGate && modeGate > styleGate, 'language → Nodi → learning mode');
  assert.match(tutorial, /data-testid="basics-tutorial-mode"/);
  assert.match(tutorial, /data-testid="tutorial-mode-video"/);
  assert.match(tutorial, /data-testid="tutorial-mode-text"/);
  assert.match(tutorial, /tutorial-mode-option recommended/, 'the video path is the recommended one');
  assert.match(tutorial, /data-testid="basics-tutorial-videos"/);
  // Skippable from the video screen, and completable from it too.
  assert.match(tutorial, /data-testid="tutorial-mode-switch-text"/);
  const videoScreen = tutorial.slice(tutorial.indexOf('basics-tutorial-videos'));
  assert.match(videoScreen.slice(0, 1400), /data-testid="basics-tutorial-complete"/);
  assert.match(videoScreen.slice(0, 1400), /\{skipDialog\}/);
  // The deck's arrow keys must not run while the grid or the gates are on screen.
  assert.match(tutorial, /if \(!tutorialLanguage \|\| !styleChosen \|\| learnMode !== 'text'\) return;/);
});

test('the first-run video screen shows the introduction ALONE', async () => {
  const [tutorial, component] = await Promise.all([
    read('src/views/BasicsTutorial.tsx'),
    read('src/components/TutorialVideos.tsx'),
  ]);
  // One tutorial, large — not the catalogue. A brand-new install has no vault yet, so
  // the vault videos would be cards about places the reader cannot go.
  assert.match(tutorial, /<TutorialVideoFeature video=\{introVideo\} language=\{activeLanguage\} \/>/);
  assert.doesNotMatch(tutorial, /<TutorialVideoGrid/, 'the guide must not fall back to the full grid');
  assert.match(tutorial, /tutorialVideo\(TUTORIAL_INTRO_VIDEO_ID\) \?\? TUTORIAL_VIDEOS\[0\]/, 'the intro video is compiled in, not fetched');
  // …and the screen SAYS where the others are, rather than leaving the reader to find out.
  assert.match(component, /data-testid="tutorial-video-where"/);
  assert.match(component, /copy\.whereVaults\.title/);
  assert.match(component, /copy\.whereSettings\.title/);
  assert.match(component, /copy\.startHere/);
});

test('Settings holds the whole catalogue, with tabs and a search box', async () => {
  const [settings, component] = await Promise.all([
    read('src/views/Settings.tsx'),
    read('src/components/TutorialVideos.tsx'),
  ]);
  assert.match(settings, /<TutorialVideoGrid language=\{settings\.uiLanguage\} variant="panel" showFilters \/>/);
  const gridAt = settings.indexOf('<TutorialVideoGrid');
  const replayAt = settings.indexOf('basics-tutorial-replay');
  assert.ok(gridAt > 0 && gridAt < replayAt, 'the videos come before the replay buttons');

  // Tabs filter, they do not hide: "All" is the initial state and every shelf present in
  // the catalogue gets a tab.
  assert.match(component, /const \[category, setCategory\] = useState<TutorialCategory \| null>\(null\)/);
  assert.match(component, /const \[query, setQuery\] = useState\(''\)/);
  assert.match(component, /data-testid="tutorial-videos-tab-all"/);
  assert.match(component, /data-testid=\{`tutorial-videos-tab-\$\{shelf\}`\}/);
  assert.match(component, /data-testid="tutorial-videos-search"/);
  // Clicking the active tab clears the filter, so a tab is never a dead end.
  assert.match(component, /setCategory\(\(current\) => \(current === shelf \? null : shelf\)\)/);
  // Filters only apply where they are rendered; every other host still shows everything.
  assert.match(component, /category: showFilters \? category : null, query: showFilters \? query : ''/);
  assert.match(component, /data-testid="tutorial-videos-empty"/, 'an empty search says so');

  const css = await read('src/components/tutorialVideos.css');
  assert.match(css, /\.light \.tutorial-videos-panel \.tutorial-video-card/, 'the Settings grid is remapped for light mode');
  assert.match(css, /\.light \.tutorial-videos-panel \.tutorial-videos-tabs button\.active/, 'and so are the new tabs');
  assert.match(css, /\.light \.tutorial-videos-panel \.tutorial-videos-search input/);
  assert.match(css, /\.light \.tutorial-video-player/);
});

test('the videos are announced once to installs that predate them', async () => {
  const [guide, app] = await Promise.all([
    read('src/components/TutorialVideosGuide.tsx'),
    read('src/App.tsx'),
  ]);
  // The announcement shows the videos rather than describing them: the same grid and
  // the same in-app player, in the update tours' cinematic chrome.
  assert.match(guide, /className="toolkit-guide-cinema tutorial-videos-guide"/);
  assert.match(guide, /data-testid="tutorial-videos-update-tour"/);
  assert.match(guide, /<TutorialVideoGrid language=\{uiLanguage\} variant="panel" showHeading=\{false\} \/>/);
  // Shown once, and only to someone who finished the guide back when it was text-only.
  assert.match(guide, /if \(previousTutorialVersion <= 0\) return false;/);
  assert.match(guide, /localStorage\.getItem\(SEEN_KEY\) !== '1'/);
  // Marked seen on dismissal, never merely on mount.
  assert.match(guide, /const finish = \(\) => \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*markTutorialVideosAnnouncementSeen\(\);/);

  // Completing the cinematic guide answers the same question, so it settles the
  // announcement too — a fresh install must never be told about a choice it just made.
  assert.match(await read('src/app/StartupGate.tsx'), /markTutorialVideosAnnouncementSeen\(\);\s*\n\s*await window\.nodus\.updateSettings\(\{ basicsTutorialVersion: BASICS_TUTORIAL_VERSION \}\)/);
  // It queues behind the other one-time tours and ahead of the Nodi choice, so two
  // modals never fight for the foreground.
  const order = ['<WhatsNewModal', '<PlatformHighlightsUpdateTour', '<ToolkitBetaUpdateTour', '<TutorialVideosUpdateTour', '<NodiStyleModal'].map((tag) => app.indexOf(tag));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the videos announcement sits between the toolkit tour and the Nodi choice');
  assert.match(app, /startupGuidesSettled && !manualWhatsNewOpen/);
});

test('the announcement speaks every interface language', async () => {
  const [guide, types] = await Promise.all([
    read('src/components/TutorialVideosGuide.tsx'),
    read('@api'),
  ]);
  // Read the languages from the type itself, so a new UI language fails here.
  const declared = types.match(/export type AppLanguage = ([^;]+);/)[1]
    .split('|').map((code) => code.trim().replace(/'/g, ''));
  assert.equal(declared.length, 12);
  const table = guide.slice(guide.indexOf('const COPY: Record<AppLanguage, AnnouncementCopy>'), guide.indexOf('export function markTutorialVideosAnnouncementSeen'));
  for (const code of declared) {
    assert.match(table, new RegExp(`\\n  '?${code}'?: \\{`), `${code} has no announcement copy`);
  }
  // Ten distinct summaries: a table that quietly reused one language would pass every
  // per-key check above.
  // Languages the other catalogues render keep single quotes; a generated table may
  // use double quotes, so both are read.
  const summaries = [...table.matchAll(/\n {4}summary: (['"])(.+)\1,/g)].map((match) => match[2]);
  assert.equal(summaries.length, 12);
  assert.equal(new Set(summaries).size, 12, 'one of the languages falls back to another');
});

test('a vault tour with a video offers three ways in', async () => {
  const [engine, tour, app] = await Promise.all([
    read('src/views/tourEngine.tsx'),
    read('src/views/Tour.tsx'),
    read('src/App.tsx'),
  ]);
  assert.match(engine, /vaultType\?: VaultType/);
  assert.match(engine, /data-testid="tour-watch-video"/);
  assert.match(engine, /tutorialVideoCopy\(getActiveLang\(\)\)\.tourVideo/);
  // "Sí, enséñame" stays, demoted to secondary, and "Ahora no" is untouched: three
  // options, with the video recommended.
  assert.match(engine, /Sí, enséñame/);
  assert.match(engine, /Ahora no/);
  assert.match(engine, /video \? 'btn btn-ghost border border-neutral-700' : 'btn btn-primary'/);
  // Three buttons do not fit side by side in a 360px card: they overflowed it and each
  // label broke into three lines. The opening step stacks them full-width instead, in
  // every vault — the layout the rest of the videos will land on.
  assert.match(engine, /isInvitation \? 'flex flex-col gap-3' : 'flex items-center justify-between'/);
  assert.match(engine, /isInvitation \? 'flex flex-col gap-2' : 'flex gap-2'/);
  assert.match(engine, /const isInvitation = isFirst && !started/);
  assert.match(engine, /if \(isInvitation\) return;/);
  assert.match(engine, /showUnavailableVideo\?: boolean/);
  assert.match(engine, /showUnavailableVideo = true/);
  assert.match(engine, /disabled=\{!video\}/);
  assert.match(engine, /t\('Próximamente'\)/);
  assert.match(engine, /className=\{`w-full \$\{video \?/);
  // Escape must reach the player, not dismiss the tour behind it.
  assert.match(engine, /if \(watchingVideo\) return;/);
  assert.match(tour, /vaultType="academic"/);
  // Every dedicated vault tour declares its type, so each gains the option the day its
  // own video is published — without a release and without touching the engine.
  for (const [file, type] of [
    ['src/views/StudyTour.tsx', 'estudio'],
    ['src/views/GenealogyTour.tsx', 'genealogy'],
    ['src/views/DatabasesTour.tsx', 'databases'],
    ['src/views/TeachingTour.tsx', 'docencia'],
    ['src/views/PrimarySourcesTour.tsx', 'primary_sources'],
    ['src/views/ProsopographyTour.tsx', 'prosopography'],
    ['src/views/WorldbuildingTour.tsx', 'worldbuilding'],
    ['src/views/TestimonyTour.tsx', 'testimonios'],
  ]) {
    assert.match(await read(file), new RegExp(`vaultType="${type}"`), `${file} declares its vault type`);
  }
  for (const file of [
    'src/views/PrimarySourcesTour.tsx',
    'src/views/ProsopographyTour.tsx',
    'src/views/WorldbuildingTour.tsx',
    'src/views/TestimonyTour.tsx',
    'src/views/StudyTour.tsx',
  ]) {
    assert.match(await read(file), /showUnavailableVideo/, `${file} keeps the future video button visible`);
  }
  assert.match(app, /<ProsopographyTour/);
  assert.match(app, /<WorldbuildingTour/);
  assert.match(app, /!isWorldbuilding && !isProsopography && !isTestimonios/);
  for (const type of ['academic', 'genealogy', 'databases', 'docencia']) {
    assert.ok(catalogue.tutorialVideoForVault(type), `the ${type} tour has a video to offer`);
  }
  assert.match(engine, /tutorialVideoForVault\(vaultType, catalogue\)/);
  // The player's badge is the shelf, not "Tutorial 3": the published titles stopped
  // being numbered, and a catalogue that grows would renumber itself.
  const grid = await read('src/components/TutorialVideos.tsx');
  assert.doesNotMatch(grid, /tutorialWord/);
  assert.match(grid, /copy\.categories\[video\.category\]/);
});

// ── the catalogue: untrusted input from the network ─────────────────────────────

test('the published catalogue can add tutorials and update copy', () => {
  const { videos, rejected } = catalogue.parseTutorialCatalogue({
    videos: [
      { id: 'essentials', youtubeId: 'QqSY1_DeDRM', order: 1, category: 'introduction', icon: 'network' },
      {
        id: 'study', youtubeId: 'abcdefghijk', order: 6, category: 'vaults', icon: 'graduation', vaultType: 'estudio',
        copy: { es: { title: 'La bóveda de estudio', body: 'Asignaturas, apuntes y repaso.' }, en: { title: 'The study vault', body: 'Subjects, notes and revision.' } },
      },
    ],
  });
  assert.equal(rejected, 0);
  assert.equal(videos.length, 2);
  const merged = catalogue.mergeTutorialCatalogue(videos);
  // The new entry lands on its shelf, after the vault videos this build already ships —
  // never at the end of the whole list.
  assert.deepEqual(merged.map((video) => video.id), [
    'essentials',
    'academic', 'genealogy', 'databases', 'teaching', 'study',
    'nodi', 'toolkit', 'pdf-presenter',
    'word', 'zotero', 'mcp',
  ]);
  // A new vault video reaches that vault's tour with no code change.
  assert.equal(catalogue.tutorialVideoForVault('estudio', merged).youtubeId, 'abcdefghijk');
  // Its own copy is used, in the reader's language, falling back to English.
  const study = merged.find((video) => video.id === 'study');
  assert.equal(catalogue.videoCopyFor(study, 'es').title, 'La bóveda de estudio');
  assert.equal(catalogue.videoCopyFor(study, 'ja').title, 'The study vault');
  // …and it is searchable and filterable like the compiled-in ones.
  const shelves = catalogue.tutorialVideoShelves(merged, { language: 'es', category: 'vaults', query: 'apuntes' });
  assert.deepEqual(shelves.map((shelf) => shelf.videos.map((video) => video.id)), [['study']]);
  // Built-in videos keep the compiled translations.
  assert.equal(catalogue.videoCopyFor(merged[0], 'ja').title, catalogue.tutorialVideoCopy('ja').videos.essentials.title);
});

test('an entry that forgets its shelf still lands on one', () => {
  const { videos } = catalogue.parseTutorialCatalogue({
    videos: [
      // Naming a vault is the strongest signal there is.
      { id: 'sources', youtubeId: 'QqSY1_DeDRM', order: 1, vaultType: 'primary_sources', copy: { en: { title: 'Sources', body: 'x' } } },
      // Anything else is a feature until a later file says otherwise.
      { id: 'whatever', youtubeId: 'QqSY1_DeDRM', order: 2, copy: { en: { title: 'Whatever', body: 'x' } } },
      // A built-in keeps its own shelf rather than being demoted.
      { id: 'essentials', youtubeId: 'QqSY1_DeDRM', order: 3 },
      // Junk in `category` is junk, not a new shelf.
      { id: 'bogus', youtubeId: 'QqSY1_DeDRM', order: 4, category: 'javascript:alert(1)', copy: { en: { title: 'Bogus', body: 'x' } } },
    ],
  });
  assert.deepEqual(
    videos.map((video) => [video.id, video.category]),
    [['sources', 'vaults'], ['whatever', 'features'], ['essentials', 'introduction'], ['bogus', 'features']],
  );
});

test('the catalogue cannot smuggle in anything the app would render blindly', () => {
  const { videos, rejected } = catalogue.parseTutorialCatalogue({
    videos: [
      { id: 'evil', youtubeId: 'https://evil.example/x', order: 1, copy: { en: { title: 'x', body: 'y' } } },
      { id: 'Evil Slug', youtubeId: 'QqSY1_DeDRM', order: 2, copy: { en: { title: 'x', body: 'y' } } },
      { id: 'nocopy', youtubeId: 'QqSY1_DeDRM', order: 3 },
      { id: 'essentials', youtubeId: 'QqSY1_DeDRM', order: 4 },
      { id: 'essentials', youtubeId: 'QqSY1_DeDRM', order: 5 },
    ],
  });
  // Rejected: a non-YouTube id, a non-slug id, a new entry with no copy, and a duplicate.
  assert.equal(rejected, 4);
  assert.deepEqual(videos.map((video) => video.id), ['essentials']);

  // A poster is never taken from the file: a remote CSS value could fetch an image and
  // break the promise that an unopened grid makes no requests.
  const injected = catalogue.parseTutorialCatalogue({
    videos: [{
      id: 'poster', youtubeId: 'QqSY1_DeDRM', order: 1, icon: '"><script>', poster: 'url(https://evil.example/pixel.png)',
      copy: { en: { title: 'x', body: 'y' } },
    }],
  });
  assert.equal(injected.videos.length, 1);
  assert.doesNotMatch(injected.videos[0].poster, /url\(|evil/);
  assert.equal(injected.videos[0].icon, 'play', 'an icon outside the allowlist falls back');

  // Junk of every shape yields an empty list rather than an exception.
  for (const raw of [null, undefined, 42, 'nope', {}, { videos: 'nope' }, [], [null, 7, 'x']]) {
    assert.deepEqual(catalogue.parseTutorialCatalogue(raw).videos, []);
  }
});

test('a broken catalogue can never hide a tutorial the app already ships', () => {
  // Half-written file, wrong ids, empty list: the built-in ten survive all of it.
  for (const remote of [[], catalogue.parseTutorialCatalogue({ videos: [{ id: 'x' }] }).videos]) {
    assert.deepEqual(
      catalogue.mergeTutorialCatalogue(remote).map((video) => video.id),
      catalogue.TUTORIAL_VIDEOS.map((video) => video.id)
    );
  }
});

test('the published file matches what this build ships', async () => {
  const published = JSON.parse(await read('site/tutorials.json'));
  const { videos, rejected } = catalogue.parseTutorialCatalogue(published);
  assert.equal(rejected, 0, 'every entry in site/tutorials.json passes the app\'s own validation');
  assert.deepEqual(
    videos.map((video) => [video.id, video.youtubeId, video.order, video.category, video.vaultType ?? null]),
    catalogue.TUTORIAL_VIDEOS.map((video) => [video.id, video.youtubeId, video.order, video.category, video.vaultType ?? null]),
    'site/tutorials.json and the built-in list agree'
  );
  assert.equal(catalogue.TUTORIAL_CATALOGUE_URL, 'https://nodusresearch.com/tutorials.json');
});

test('the catalogue is fetched in the main process, cached, and never fatal', async () => {
  const [main, ipc, preload] = await Promise.all([
    read('electron/tutorialCatalogue.ts'),
    read('@main'),
    read('@bridge'),
  ]);
  assert.match(ipc, /h\('tutorials:catalogue', async \(\) => getTutorialCatalogue\(\)\)/);
  assert.match(preload, /getTutorialCatalogue: \(\) => ipcRenderer\.invoke\('tutorials:catalogue'\)/);
  assert.match(main, /net\.fetch\(url, \{ signal: controller\.signal \}\)/, 'uses Electron\'s net stack, so the app proxy applies');
  assert.match(main, /\$\{catalogueUrl\(\)\}\?t=/, 'and busts the GitHub Pages cache');
  // The URL is overridable so a verification run can serve a catalogue of its own, but
  // it must default to the published one — an unset env var cannot change production.
  assert.match(main, /process\.env\.NODUS_TUTORIAL_CATALOGUE_URL \|\| TUTORIAL_CATALOGUE_URL/);
  assert.match(main, /FETCH_TIMEOUT_MS = 4_000/);
  assert.match(main, /controller\.abort\(\)/);
  assert.match(main, /readCache\(\)/);
  assert.match(main, /return \[\.\.\.TUTORIAL_VIDEOS\]/, 'the built-in list is the last resort');
  // A failed check must not be remembered as done for the rest of the run.
  // A fallen-back (offline) check is forgotten so the next open retries; behaviour is
  // covered by test-tutorial-catalogue-retry.mjs.
  assert.match(main, /if \(fellBack && inFlight === attempt\) inFlight = null;/);
});

test('a packaged renderer still gets the real player, not YouTube error 153', async () => {
  const main = await read('electron/main.ts');
  assert.match(main, /installMediaRequestHeaders\(session\.defaultSession\.webRequest, app\.getVersion\(\)\)/);
  assert.doesNotMatch(main, /\.onBeforeSendHeaders\(/, 'another listener in main would replace the media rules');
  const out = path.join(outDir, 'mediaRequestHeaders.cjs');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
    path.join(repoRoot, 'electron/mediaRequestHeaders.ts'), '--bundle', '--platform=node', '--format=cjs',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`, `--outfile=${out}`,
  ], { cwd: repoRoot, stdio: 'inherit' });
  let active;
  let registrations = 0;
  const webRequest = { onBeforeSendHeaders(filter, listener) { active = { filter, listener }; registrations++; } };
  require(out).installMediaRequestHeaders(webRequest, '5.7.3');
  assert.equal(registrations, 1, 'Electron uses only the last listener, so the rules must share it');
  assert.deepEqual(active.filter.urls, ['https://www.youtube-nocookie.com/*', '*://*.tile.openstreetmap.org/*']);
  const original = { 'User-Agent': 'Clean Chromium', Accept: '*/*' };
  function headers(url) {
    let response;
    active.listener({ url, requestHeaders: original }, result => { response = result.requestHeaders; });
    return response;
  }
  assert.deepEqual(headers('https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ'), {
    ...original, Referer: 'https://nodusresearch.com/',
  });
  assert.deepEqual(headers('https://a.tile.openstreetmap.org/3/4/5.png'), {
    ...original, 'User-Agent': 'Nodus/5.7.3 (+https://nodusresearch.com)', Referer: 'https://nodusresearch.com/',
  });
  assert.deepEqual(headers('https://example.com/'), original, 'unrelated hosts keep their headers');
  assert.deepEqual(headers('https://tile.openstreetmap.org.example.com/'), original);
  assert.deepEqual(original, { 'User-Agent': 'Clean Chromium', Accept: '*/*' }, 'incoming headers are not mutated');
});

test('PDF Presenter queues after release notes and before every other startup announcement', async () => {
  const app = await read('src/App.tsx');
  assert.match(app, /whatsNewSettled && !pdfPresenterTutorialSettled && !manualWhatsNewOpen && \(\s*<PdfPresenterTutorialAnnouncement/);
  for (const component of ['MobileTeaserGuide', 'PlatformHighlightsUpdateTour', 'ToolkitBetaUpdateTour', 'TutorialVideosUpdateTour']) {
    assert.match(app, new RegExp(`whatsNewSettled && pdfPresenterTutorialSettled &&[^\\n]+\\(\\s*<${component}`));
  }
  const wiki = await read('site/wiki/wiki.js');
  assert.match(wiki, /'pdf-presenter': \['Features', 'PDF Presenter'\]/);
});
