// Nodus Drift: how it is wired into the application.
//
// These are source-level checks for the things a rendering test cannot see cheaply: where
// the provider sits, that nothing in it depends on navigation, that the audio context is
// only ever built inside an explicit play path, that nothing talks to the network, that the
// header and the popover keep their contracts. The behaviour itself is asserted by
// test-drift-engine.mjs and test-drift-provider.mjs (which render the real provider) and by
// scripts/e2e-drift.mjs (the real app).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadTs, repoRoot } from './drift-test-utils.mjs';

const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8');
/** The code without its comments, so prose cannot fool (or trip) a scan. */
const code = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const DRIFT_RENDERER_FILES = [
  'src/components/drift/DriftProvider.tsx',
  'src/components/drift/DriftSoundCard.tsx',
  'src/components/drift/DriftMeditatingNodi.tsx',
  'src/components/drift/DriftPresets.tsx',
  'src/components/drift/DriftSortMenu.tsx',
  'src/components/drift/driftSort.ts',
  'src/components/drift/DriftMiniPlayer.tsx',
  'src/components/drift/driftState.ts',
  'src/components/drift/audio/DriftAudioEngine.ts',
  'src/components/drift/audio/loopBuffer.ts',
  'src/components/drift/audio/noise.ts',
  'src/components/drift/audio/binaural.ts',
  'src/views/ToolkitDriftView.tsx',
];

// ── one provider per window ────────────────────────────────────────────────

test('the provider wraps the whole app at the root, beside the other window-level providers', () => {
  const main = read('src/main.tsx');
  assert.match(main, /import \{ DriftProvider \} from '\.\/components\/drift\/DriftProvider';/);
  const open = (name) => main.indexOf(`<${name}`);
  const order = ['React.StrictMode', 'AudioPlayerProvider', 'BrowserMediaProvider', 'DriftProvider', 'StudyFocusProvider', 'App'].map(open);
  assert.ok(order.every((index) => index >= 0), 'every provider is mounted');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'DriftProvider sits inside the providers and outside <App />');
  const close = (name) => main.indexOf(`</${name}>`);
  assert.ok(close('DriftProvider') > main.indexOf('<App />'), 'and closes after it');
});

test('it belongs to the window, not to a view: nothing in it depends on navigation, vaults or popovers', () => {
  const provider = code('src/components/drift/DriftProvider.tsx');
  for (const forbidden of [/activeVault|vaultId|useVault|switchVault/, /toolkitPage|setToolkitPage|setView|\bview\b/, /anchorEl|BrowserMedia|popover/i, /useBrowserMedia/, /\bkey=/]) {
    assert.doesNotMatch(provider, forbidden, `the provider must not mention ${forbidden}`);
  }
  // it is not mounted anywhere else, so navigating cannot build a second one
  const users = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry.name) && /<DriftProvider[\s>]/.test(read(full))) users.push(full);
    }
  };
  walk('src');
  assert.deepEqual(users, ['src/main.tsx']);
});

test('the engine is built in an effect and disposed by its cleanup, once per provider instance', () => {
  const provider = code('src/components/drift/DriftProvider.tsx');
  assert.equal((provider.match(/new DriftAudioEngine\(/g) ?? []).length, 1);
  assert.match(provider, /useEffect\(\(\) => \{\s*const created = new DriftAudioEngine\(/, 'created inside an effect, not during render or at module level');
  assert.match(provider, /return \(\) => \{[\s\S]*?void created\.dispose\(\);[\s\S]*?\};\s*\}, \[loadCatalog, apply\]\);/, 'and disposed in its cleanup, depending only on stable callbacks');
  assert.match(provider, /if \(engineRef\.current === created\) engineRef\.current = null;/, 'a stale cleanup cannot clear a newer engine');
  assert.doesNotMatch(provider, /useMemo\(\(\) => new DriftAudioEngine|useRef\(new DriftAudioEngine|useState\(\(\) => new DriftAudioEngine/, 'never at render time (StrictMode would build two)');
});

test('restoring the saved mix builds nothing audible: it goes through restore(), which never plays', () => {
  const provider = code('src/components/drift/DriftProvider.tsx');
  assert.match(provider, /created\.restore\(\{ ids: saved\.selection, volumes: saved\.volumes, master: saved\.master \}\);/);
  const effect = provider.slice(provider.indexOf('const created = new DriftAudioEngine('), provider.indexOf('}, [loadCatalog, apply]);'));
  assert.doesNotMatch(effect, /playAll|selectSound|retrySound|resume\(|createContext\(\)/, 'the start-up effect starts nothing');
  // and the persisted model has no play flag to restore
  assert.doesNotMatch(code('src/components/drift/driftState.ts'), /isPlaying|playing:|wantPlaying|loading:/);
});

// ── audio starts only when it is asked to ──────────────────────────────────

test('an AudioContext is built in exactly one place: the engine\'s context factory', () => {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (/drift|Drift/.test(full) && /\.(tsx?)$/.test(entry.name)) {
        for (const match of code(full).matchAll(/new (?:window\.)?(?:webkit)?AudioContext\(([^)]*)\)/g)) found.push([full, match[1]]);
      }
    }
  };
  walk('src');
  assert.deepEqual(found, [['src/components/drift/DriftProvider.tsx', "{ latencyHint: 'playback' }"]]);
  const provider = code('src/components/drift/DriftProvider.tsx');
  assert.match(provider, /createContext: \(\) => new AudioContext\(/, 'inside the factory the engine calls on the first explicit play');
});

test('only an explicit order starts anything: select, retry and play, never volume, favourites, search or navigation', () => {
  const provider = code('src/components/drift/DriftProvider.tsx');
  /** The text of one action: from its declaration to the next declaration at the same indent. */
  const body = (name) => {
    const start = provider.indexOf(`const ${name} = useCallback(`);
    assert.ok(start >= 0, `${name} exists`);
    const next = provider.indexOf('\n  const ', start + 10);
    return provider.slice(start, next < 0 ? undefined : next);
  };
  assert.equal((provider.match(/\.selectSound\(/g) ?? []).length, 1);
  assert.equal((provider.match(/\.playAll\(/g) ?? []).length, 1);
  assert.equal((provider.match(/\.retrySound\(/g) ?? []).length, 1);
  assert.match(body('toggleSound'), /\.selectSound\(/);
  assert.match(body('play'), /\.playAll\(\)/);
  for (const name of ['setVolume', 'setMaster', 'toggleFavorite', 'setFilter', 'removeSound', 'clear', 'pause', 'dismissNotice']) {
    assert.doesNotMatch(body(name), /selectSound|playAll|retrySound/, `${name} must not start audio`);
  }
  // the view and the mini player only call those actions
  const view = code('src/views/ToolkitDriftView.tsx');
  assert.doesNotMatch(view, /AudioContext|\.play\(\)|new Audio|<audio/);
  assert.match(view, /useEffect\(\(\) => \{ void loadCatalog\(\)\.catch\(\(\) => undefined\); \}, \[loadCatalog\]\);/, 'opening the page only asks for the catalogue');
});

test('the seventh voice and unavailable sounds never reach the engine from the interface', () => {
  const provider = code('src/components/drift/DriftProvider.tsx');
  const toggle = provider.slice(provider.indexOf('const toggleSound = useCallback('));
  assert.match(toggle, /entry\.availability !== 'available'\) return;/, 'only an available entry is operative');
  assert.match(toggle, /planDriftSelection\(/, 'the shared limit policy is consulted first');
  assert.match(toggle, /if \(plan\.reason === 'limit'\) setLimitNotice\(Date\.now\(\)\);\s*return;/, 'a refused voice raises the notice and stops there');
});

// ── offline and contained ──────────────────────────────────────────────────

test('nothing in Drift\'s renderer code touches the network or Browser', () => {
  for (const file of DRIFT_RENDERER_FILES) {
    const source = code(file).replace("'https://github.com/remvze/moodist'", "'moodist-credit'");
    assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|https?:\/\/|new Audio\(|<audio|HTMLMediaElement|MediaElementAudioSource|createMediaStream/, `${file}: no network, no media element`);
    assert.doesNotMatch(source, /setBrowserDeviceVolume|getBrowserDeviceVolume|browserMediaCommand|setBrowserTabMuted|getBrowserMedia|onBrowserMediaChanged/, `${file}: no Browser media channel`);
    assert.doesNotMatch(source, /require\(|from 'node:|from "node:|ipcRenderer|electron/, `${file}: no Node or Electron`);
  }
});

test('the bridge calls are Drift audio and the explicit Moodist credit link', () => {
  const calls = new Set();
  for (const file of DRIFT_RENDERER_FILES) for (const match of code(file).matchAll(/window\.nodus\.(\w+)/g)) calls.add(match[1]);
  assert.deepEqual([...calls].sort(), ['getDriftCatalog', 'openExternal', 'readDriftAudio']);
});

test('the saved state has one home and one key, never inside a vault', () => {
  const state = read('src/components/drift/driftState.ts');
  assert.match(state, /export const DRIFT_STORAGE_KEY = 'nodus:drift:v1';/);
  for (const file of DRIFT_RENDERER_FILES.filter((f) => f !== 'src/components/drift/driftState.ts')) {
    assert.doesNotMatch(read(file), /nodus:drift:v1/, `${file} must go through driftState`);
  }
  const provider = code('src/components/drift/DriftProvider.tsx');
  assert.doesNotMatch(provider, /updateSettings|getSettings|sessionStorage|indexedDB/, 'not in settings, not in a vault database');
  assert.match(provider, /window\.addEventListener\('pagehide', flush\)/);
  assert.match(provider, /window\.addEventListener\('beforeunload', flush\)/);
  assert.match(provider, /flush\(\);\s*\};\s*\}, \[\]\);/, 'a pending write is flushed on unmount');
});

// ── the page ───────────────────────────────────────────────────────────────

test('sound toggles, favourites and voice controls are independent siblings', () => {
  const card = read('src/components/drift/DriftSoundCard.tsx');
  const body = card.slice(card.indexOf('const body = <>'), card.indexOf('  return (', card.indexOf('const body = <>')));
  assert.doesNotMatch(body, /<button|onClick|<input/);
  assert.match(card, /aria-pressed=\{selected\}/);
  assert.match(card, /aria-disabled="true"/);
  assert.match(card, /data-testid=\{`drift-card-\$\{sound.id\}-favorite`\}/);
  assert.doesNotMatch(card, /stopPropagation/);
  assert.match(read('src/components/drift/drift.css'), /:focus-visible/);
});

test('every slider is labelled, every toggle is pressed-aware, notices are live regions', () => {
  const sources = { card: read('src/components/drift/DriftSoundCard.tsx'), view: read('src/views/ToolkitDriftView.tsx'), mini: read('src/components/drift/DriftMiniPlayer.tsx') };
  for (const [name, source] of Object.entries(sources)) {
    const sliders = source.match(/<input\s[^>]*type="range"[\s\S]*?\/>/g) ?? [];
    assert.ok(sliders.length > 0, `${name} has sliders`);
    for (const slider of sliders) assert.match(slider, /aria-label=/, `${name}: a slider without a label`);
  }
  const view = sources.view;
  assert.match(view, /aria-pressed=\{drift\.filter === filter\.id\}/, 'filters');
  assert.match(view, /aria-pressed=\{active\}/, 'the mix play toggle');
  assert.match(view, /data-testid="drift-limit-notice" role="status"/);
  assert.match(view, /data-testid="drift-catalog-error" role="alert"/);
  assert.match(sources.card, /data-testid=\{`drift-error-\$\{voice\.id\}`\} role="alert"/);
  assert.match(read('src/components/drift/drift.css'), /grid-template-columns: repeat\(auto-fill,minmax\(165px,1fr\)\)/, 'a grid that adapts from one column to several without a breakpoint or a horizontal scrollbar');
  assert.doesNotMatch(view, /overflow-x-(scroll|auto)|w-\[\d{4,}px\]|min-w-\[\d{3,}px\]/, 'nothing forces a horizontal scroll');
});

test('Play and Clear are disabled with nothing selected, and the empty state is useful', () => {
  const view = read('src/views/ToolkitDriftView.tsx');
  assert.match(view, /data-testid="drift-mix-toggle"[\s\S]*?disabled=\{count === 0\}/);
  assert.match(view, /data-testid="drift-clear"[\s\S]*?disabled=\{count === 0\}/);
  assert.match(view, /data-testid="drift-mix-empty"/);
  const mini = read('src/components/drift/DriftMiniPlayer.tsx');
  assert.match(mini, /data-testid="drift-mini-toggle"[\s\S]*?disabled=\{count === 0\}/);
  assert.match(mini, /data-testid="drift-mini-clear"[\s\S]*?disabled=\{count === 0\}/);
});

test('search folds accents and case; unavailable sounds are not operative cards', () => {
  const view = read('src/views/ToolkitDriftView.tsx');
  assert.match(view, /normalizeDriftSearch\(query\)/);
  assert.match(view, /const operative = visible\.filter\(\(sound\) => sound\.availability === 'available'\);/);
  assert.match(view, /const unavailable = visible\.filter\(\(sound\) => sound\.availability !== 'available'\);/);
  assert.match(view, /<details data-testid="drift-unavailable"/, 'explained, collapsed, and with no play or download control');
  assert.doesNotMatch(view, /download|descargar|href=/i);
});

// ── the header ─────────────────────────────────────────────────────────────

test('the media button shows with Browser sessions OR a Drift selection, and opens Drift through real navigation', () => {
  const app = read('src/App.tsx');
  assert.match(app, /if \(!hasBrowser && !hasDrift\) return null;/);
  assert.match(app, /const hasDrift = drift\.selection\.length > 0;/, 'a paused mix keeps its button');
  assert.match(app, /data-testid="browser-media-header-action"/, 'the existing test id is kept');
  assert.match(app, /onOpenDrift=\{\(\) => \{[\s\S]*?setToolkitPage\('drift'\);\s*setView\('toolkit'\);\s*\}\}/, 'the same state the Tools button uses');
  const header = app.slice(app.indexOf('function BrowserMediaHeaderAction('));
  assert.doesNotMatch(header, /window\.location|window\.open|new BrowserWindow|history\.push/);
  assert.match(header, /panel: <DriftMiniPlayer onOpenDrift=\{\(\) => \{ setAnchor\(null\); onOpenDrift\(\); \}\} \/>/, 'the popover closes as it navigates');
  assert.match(app, /focusKeep=\{focusKeep\}/, 'Study Focus keeps its say over whether the button stays');
  assert.doesNotMatch(app, /Mod\+D|shortcut.*[Dd]rift|drift.*shortcut/i, 'no global shortcut is added');
});

test('there is one popover and one backdrop; the Drift panel is content, not a second popover', () => {
  const media = read('src/components/browser/BrowserMedia.tsx');
  assert.equal((media.match(/fixed inset-0 z-\[130\]/g) ?? []).length, 1, 'one backdrop');
  assert.equal((media.match(/export function BrowserMediaPopover/g) ?? []).length, 1);
  const mini = read('src/components/drift/DriftMiniPlayer.tsx');
  assert.doesNotMatch(mini, /createPortal|fixed inset-0|position: 'fixed'|backdrop/i);
  const app = read('src/App.tsx');
  assert.equal((app.match(/<BrowserMediaPopover/g) ?? []).length, 1);
});

test('the popover keeps its two-effect lifecycle: only opening or closing it restarts anything', () => {
  const media = read('src/components/browser/BrowserMedia.tsx');
  const popover = media.slice(media.indexOf('export function BrowserMediaPopover'), media.indexOf('function MediaRow'));
  const deps = [...popover.matchAll(/\}, \[([^\]]*)\]\);/g)].map((match) => match[1]);
  assert.deepEqual(deps, ['anchorEl', 'anchorEl'], 'both effects depend on the anchor and on nothing else, so a media or Drift update cannot restart them');
  assert.match(popover, /const onCloseRef = useRef\(onClose\)/);
  // choosing a tab is local state plus a callback: it cannot reach a playback API
  const chooser = popover.slice(popover.indexOf('const chooseTab'), popover.indexOf('return createPortal('));
  assert.doesNotMatch(chooser, /nodus\.|playAll|pauseAll|browserMediaCommand/);
  assert.match(popover, /role="tablist"[\s\S]*?role="tab"[\s\S]*?aria-selected=\{tab === id\}/);
  assert.match(popover, /role=\{drift \? 'tabpanel' : undefined\}/);
  assert.match(popover, /event\.key === 'ArrowRight' \|\| event\.key === 'End'/, 'arrow keys move between the tabs');
});

test('the Drift volume moves the Drift bus and nothing else', () => {
  const mini = code('src/components/drift/DriftMiniPlayer.tsx');
  assert.match(mini, /drift\.setMaster\(Number\(event\.currentTarget\.value\) \/ 100\)/);
  assert.doesNotMatch(mini, /window\.nodus|BrowserDeviceVolume/);
  const media = read('src/components/browser/BrowserMedia.tsx');
  const deviceVolume = code('src/components/browser/useDeviceVolume.ts');
  assert.match(media, /changeVolume \} = useDeviceVolume\(Boolean\(anchorEl\)\)/, 'the Browser slider uses the device-volume hook');
  assert.match(media, /changeVolume\(Number\(event\.currentTarget\.value\)\)/, 'only its slider input requests a device-volume change');
  assert.equal(((media + deviceVolume).match(/setBrowserDeviceVolume\(/g) ?? []).length, 1, 'the device-volume hook owns the only system-volume write in the Browser controls');
  for (const file of DRIFT_RENDERER_FILES) {
    assert.doesNotMatch(code(file), /setBrowserDeviceVolume|useDeviceVolume/, `${file} cannot change the system volume`);
  }
});

test('which tab a popover opens on', () => {
  const { defaultMediaTab } = loadTs('src/components/browser/mediaTab.ts');
  assert.equal(defaultMediaTab(true, false, null), 'browser', 'only Browser');
  assert.equal(defaultMediaTab(true, false, 'drift'), 'browser', 'a stale choice does not override the only source');
  assert.equal(defaultMediaTab(false, true, null), 'drift', 'only Drift');
  assert.equal(defaultMediaTab(false, true, 'browser'), 'drift');
  assert.equal(defaultMediaTab(true, true, null), 'browser', 'both, nothing chosen yet');
  assert.equal(defaultMediaTab(true, true, 'drift'), 'drift', 'both: the last one chosen');
  assert.equal(defaultMediaTab(true, true, 'browser'), 'browser');
});

// ── navigation ─────────────────────────────────────────────────────────────

test('Drift is a Tools page: pinnable as toolkit:drift, never a View, never in a vault list', () => {
  const navigation = loadTs('src/navigation.ts');
  const toolkit = loadTs('shared/toolkitNavigation.ts');
  assert.ok(toolkit.TOOLKIT_TOOL_PAGES.includes('drift'));
  const tool = navigation.TOOLKIT_TOOLS.find((entry) => entry.page === 'drift');
  assert.deepEqual(tool, {
    page: 'drift', name: 'Nodus Drift', description: 'Combina sonidos ambiente para acompañar la lectura, el estudio y el descanso, sin conexión.',
    icon: 'drift', state: 'wip', testid: 'drift',
  });
  assert.equal(navigation.toolkitSidebarId('drift'), 'toolkit:drift');
  assert.deepEqual(navigation.pinnedToolkitSidebarItems(['drift']).map(({ id, label, icon, toolkitPage }) => ({ id, label, icon, toolkitPage })), [
    { id: 'toolkit:drift', label: 'Nodus Drift', icon: 'drift', toolkitPage: 'drift' },
  ]);
  // a restart re-reads settings through the normaliser: known, unique, in order
  assert.deepEqual(toolkit.normalizeToolkitToolPages(['drift', 'drift', 'ocr', 'nope', 7, null]), ['drift', 'ocr']);
  assert.deepEqual(toolkit.normalizeToolkitToolPages(undefined), []);
  // and the default a new profile starts from is pinned, and is one the normaliser keeps
  assert.match(read('shared/defaultAppSettings.ts'), /toolkitPinnedPages: \['drift'\],/, 'a new profile starts with Nodus Drift pinned');
  assert.deepEqual(toolkit.normalizeToolkitToolPages(['drift']), ['drift'], 'the default survives the normaliser every load runs it through');
  // alphabetical, after Convert and before Focus and Protect
  const names = navigation.TOOLKIT_TOOLS.map((entry) => entry.name);
  assert.equal(names.indexOf('Nodus Drift'), names.indexOf('Nodus Convert') + 1);
  assert.equal(names.indexOf('Nodus Focus'), names.indexOf('Nodus Drift') + 1);
  assert.equal(names.indexOf('Nodus Protect'), names.indexOf('Nodus Focus') + 1);

  const source = read('src/navigation.ts');
  assert.doesNotMatch(source.slice(source.indexOf('export type View ='), source.indexOf('\n', source.indexOf('export type View ='))), /'drift'/);
  assert.ok(!navigation.NAV_ITEMS.some((item) => item.id === 'drift'));
  assert.doesNotMatch(source.slice(source.indexOf('export type ToolkitStandalonePage')), /^.*ToolkitStandalonePage = .*'drift'/m);
  const dedicated = source.slice(source.indexOf('const DEDICATED_VAULT_NAV_IDS'));
  assert.ok(dedicated.length > 200, 'the dedicated vault lists were found');
  assert.doesNotMatch(dedicated.slice(0, dedicated.indexOf('\n};')), /'drift'/, 'no vault-type list in navigation.ts mentions it');
  assert.doesNotMatch(read('shared/vaultTypes.ts'), /'drift'/, 'nor does the vault-type module: Tools is universal');
});

test('the Tools page routes to the view and back to the catalogue', () => {
  const view = read('src/views/ToolkitView.tsx');
  assert.match(view, /import \{ ToolkitDriftView \} from '\.\/ToolkitDriftView';/);
  assert.match(view, /if \(page === 'drift'\) return <ToolkitDriftView onBack=\{\(\) => onNavigate\('home'\)\} settings=\{settings\} \/>/);
  const page = read('src/views/ToolkitDriftView.tsx');
  assert.match(page, /data-testid="toolkit-drift-back"/);
  assert.match(page, /title=\{t\('Volver a herramientas'\)\}/);
  assert.match(page, /data-testid="toolkit-drift-hero"/);
  assert.doesNotMatch(page, /ToolkitAppHero/);
  assert.match(page, /DriftMeditatingNodi/);

});

test('the standalone workspace keeps the empty playback action disabled', () => {
  const page = read('src/views/ToolkitDriftView.tsx');
  assert.match(page, /data-testid="drift-mix-toggle"[\s\S]*?disabled=\{count === 0\}/);
  assert.match(read('src/components/drift/drift.css'), /button:disabled/);
  for (const other of ['Convert', 'Presenter', 'AiOcr', 'Protect', 'Translate', 'Apps']) {
    assert.doesNotMatch(read(`src/views/Toolkit${other}View.tsx`), /drift-workspace/);
  }
});

test('the popover tabs stay legible in the light theme: the selected tab is not white text on a remapped light pill', () => {
  const media = read('src/components/browser/BrowserMedia.tsx');
  const selected = /tab === id \? '([^']+)'/.exec(media)?.[1];
  assert.ok(selected, 'the selected-tab classes were found');
  assert.doesNotMatch(selected, /\btext-white\b/, '.light remaps bg-neutral-700 to a light grey; white text would vanish on it');
  const css = read('src/index.css');
  const colorOf = (utility, property) => new RegExp(`\\.light \\.${utility.replace(/[/.:]/g, '\\$&')}[^{]*\\{[^}]*?${property}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1];
  const background = colorOf('bg-neutral-700', 'background-color');
  const text = colorOf('text-neutral-100', 'color');
  assert.ok(selected.includes('bg-neutral-700') && selected.includes('text-neutral-100'), 'the pill pairs two utilities that both have a light remap');
  assert.ok(background && text, `the light remaps exist (${background}, ${text})`);
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(background), luminance(text)].sort((a, b) => b - a);
  const contrast = (lighter + 0.05) / (darker + 0.05);
  assert.ok(contrast >= 4.5, `the selected tab reads at ${contrast.toFixed(1)}:1 in the light theme (needs 4.5)`);
  // and the guard can fail: white on that light grey is the mistake it exists to catch
  const white = (1 + 0.05) / (luminance(background) + 0.05);
  assert.ok(white < 4.5, `white on ${background} would be only ${white.toFixed(1)}:1`);
});

test('the icons Drift asks the renderer for exist', () => {
  const ui = read('src/components/ui.tsx');
  const block = ui.slice(ui.indexOf('const ICON_PATHS'), ui.indexOf('export const ICON_NAMES'));
  const icons = new Set([...block.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((match) => match[1]));
  const used = new Set();
  for (const file of DRIFT_RENDERER_FILES) {
    for (const match of read(file).matchAll(/(?:name|icon)="([a-zA-Z]+)"|icon: '([a-zA-Z]+)'|<Icon name=\{[^}]*'([a-zA-Z]+)'/g)) used.add(match[1] ?? match[2] ?? match[3]);
    for (const match of read(file).matchAll(/(?:'|")(volume|refresh|alert|pause|play|check|lock|trash|external|drift|star|x|search|info|warning)(?:'|")/g)) used.add(match[1]);
  }
  for (const name of used) assert.ok(icons.has(name), `icon ${name} is missing from ICON_PATHS`);
  assert.ok(used.has('drift') && used.size > 8);
});

test('Drift theme: sliders follow the accent in both modes', () => {
  const css = read('src/theme/theme-components.css');
  assert.match(css, /html\.theme-active\.dark \.toolkit-workspace input\[type='range'\] \{ accent-color: var\(--a-500\); \}/);
  assert.match(css, /html\.theme-active\.light \.toolkit-workspace input\[type='range'\] \{ accent-color: var\(--a-600\); \}/);
});
