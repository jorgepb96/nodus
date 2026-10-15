// The colour palette is per vault by default and profile-wide only while the user
// asks for it. That scope decides which store a setting travels to, so it is worth
// exercising the real split rather than reading the source: a mistake here silently
// writes a palette into the wrong store, or drops it from both.
//
// `electron` stays external and is served by a stub in the temp directory, because
// `appPrefs.ts` imports it only to build the userData path. Everything under test
// takes what it needs as arguments, so no stub behaviour is exercised.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-appearance-scope-'));
const electronStub = path.join(outDir, 'node_modules/electron');
await mkdir(electronStub, { recursive: true });
await writeFile(path.join(electronStub, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' }));
await writeFile(path.join(electronStub, 'index.js'), "module.exports = { app: { getPath: () => '/nonexistent-nodus-profile' } };\n");

const bundle = path.join(outDir, 'appPrefs.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/db/appPrefs.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    '--external:electron', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const prefs = require(bundle);

const palette = { appTheme: 'pine-grove', customThemes: [] };

test('the appearance keys are not unconditionally global', () => {
  assert.ok(!prefs.GLOBAL_PREF_KEYS.includes('appTheme'), 'appTheme is not always global');
  assert.ok(!prefs.GLOBAL_PREF_KEYS.includes('customThemes'), 'customThemes is not always global');
  // The switch itself must be global: a policy that differed per vault would
  // contradict the thing it configures.
  assert.ok(prefs.GLOBAL_PREF_KEYS.includes('shareAppThemeAcrossVaults'));
  assert.deepEqual([...prefs.SHARED_APPEARANCE_KEYS], ['appTheme', 'customThemes']);
});

test('only an explicit true shares the palette', () => {
  assert.equal(prefs.sharesAppThemeAcrossVaults({}), false, 'absent means per vault');
  assert.equal(prefs.sharesAppThemeAcrossVaults({ shareAppThemeAcrossVaults: false }), false);
  assert.equal(prefs.sharesAppThemeAcrossVaults({ shareAppThemeAcrossVaults: 'true' }), false, 'a hand-edited string does not switch the scope');
  assert.equal(prefs.sharesAppThemeAcrossVaults({ shareAppThemeAcrossVaults: true }), true);
});

test('the shared key list follows the scope', () => {
  assert.ok(!prefs.sharedKeysFor(false).includes('appTheme'));
  assert.ok(!prefs.sharedKeysFor(false).includes('customThemes'));
  assert.ok(prefs.sharedKeysFor(true).includes('appTheme'));
  assert.ok(prefs.sharedKeysFor(true).includes('customThemes'));
  // Keys that were global before this setting keep travelling either way.
  for (const key of ['theme', 'uiLanguage', 'favorites']) {
    assert.ok(prefs.sharedKeysFor(false).includes(key), `${key} stays global`);
    assert.ok(prefs.sharedKeysFor(true).includes(key), `${key} stays global`);
  }
});

test('per vault, the palette is written to the vault and never to the profile file', () => {
  const { global, local } = prefs.splitGlobalPatch(palette, false);
  assert.deepEqual(global, {}, 'nothing about the palette reaches the shared store');
  assert.equal(local.appTheme, 'pine-grove');
  assert.ok(Array.isArray(local.customThemes));
});

test('shared, the palette reaches the profile file and stays in the vault as a fallback', () => {
  const { global, local } = prefs.splitGlobalPatch(palette, true);
  assert.equal(global.appTheme, 'pine-grove', 'the shared store carries the palette');
  assert.ok(Array.isArray(global.customThemes));
  // Mirrored, not moved: this is what lets a vault restore its own palette when the
  // setting is turned off again instead of falling through to the default.
  assert.equal(local.appTheme, 'pine-grove');
  assert.ok(Array.isArray(local.customThemes));
});

test('unconditional keys keep moving out of the vault blob', () => {
  const { global, local } = prefs.splitGlobalPatch({ uiLanguage: 'fr', theme: 'light' }, false);
  assert.equal(global.uiLanguage, 'fr');
  assert.equal(global.theme, 'light');
  assert.equal('uiLanguage' in local, false);
  assert.equal('theme' in local, false);
});

test('the scope helper recognises only the palette keys', () => {
  assert.equal(prefs.isSharedAppearanceKey('appTheme'), true);
  assert.equal(prefs.isSharedAppearanceKey('customThemes'), true);
  assert.equal(prefs.isSharedAppearanceKey('theme'), false);
  assert.equal(prefs.isSharedAppearanceKey('uiLanguage'), false);
});

test('the setting ships off, is exposed in Appearance, and is translated everywhere', async () => {
  const [types, settingsRepo, settingsView, defaults] = await Promise.all([
    read('shared/types.ts'),
    read('electron/db/settingsRepo.ts'),
    read('src/views/Settings.tsx'),
    read('shared/defaultAppSettings.ts'),
  ]);
  assert.match(types, /shareAppThemeAcrossVaults: boolean/);
  assert.match(defaults, /shareAppThemeAcrossVaults: false/);
  // The renderer must send the switch with the palette scope it implies, so the
  // route of a palette written in the same patch follows the NEW scope.
  assert.match(settingsRepo, /const sharesAfter = patch\.shareAppThemeAcrossVaults \?\? sharesBefore/);
  assert.match(settingsRepo, /splitGlobalPatch\(patch, sharesAfter\)/);
  // Naming a palette while switching the sharing on must not be overwritten by the
  // palette that happens to be on screen.
  assert.match(settingsRepo, /sharesAfter && !sharesBefore && patch\.appTheme === undefined/);
  assert.match(settingsView, /data-testid="share-app-theme"/);
  assert.match(settingsView, /checked=\{settings\.shareAppThemeAcrossVaults\}/);
  assert.match(settingsView, /patch\(\{ shareAppThemeAcrossVaults: e\.target\.checked \}\)/);
  assert.match(settingsView, /t\('Usar la misma paleta en todas las bóvedas'\)/);
});

test('a vault never inherits the palette of another vault', async () => {
  const settingsRepo = await read('electron/db/settingsRepo.ts');
  // The palette is read from the vault unless it is shared: no branch may copy the
  // profile palette into a vault that has none, which is the state every vault is in
  // while the palette is shared.
  const adoption = /merged\.appTheme = coerceAppTheme\(/;
  assert.equal(adoption.test(settingsRepo), false, 'getSettings never adopts the profile palette');
});

test('both surfaces offer the same palettes through one picker', async () => {
  const [picker, settingsView, vaultSwitcher] = await Promise.all([
    read('src/components/ThemePalettePicker.tsx'),
    read('src/views/Settings.tsx'),
    read('src/components/VaultSwitcher.tsx'),
  ]);
  assert.match(settingsView, /<ThemePalettePicker/);
  assert.match(vaultSwitcher, /<ThemePalettePicker/);
  assert.match(picker, /export function themePickerOptions/);
  // The wizard chooses a palette; editing and deleting themes stay in Settings.
  assert.match(vaultSwitcher, /testId="vault-new-palette"/);
  assert.equal(/onEditCustom=\{/.test(vaultSwitcher), false, 'the wizard only chooses a palette');
  assert.match(picker, /onEditCustom\?: \(theme: CustomAppTheme\) => void/);
});

test('the new-vault wizard inherits the shared switch and applies the choice to the new vault', async () => {
  const vaultSwitcher = await read('src/components/VaultSwitcher.tsx');
  // Inherited, not reset: the wizard opens on the value the profile already uses.
  assert.match(vaultSwitcher, /checked=\{addSharesPalette \?\? addAppearance\?\.shareAppThemeAcrossVaults \?\? false\}/);
  assert.match(vaultSwitcher, /data-testid="vault-new-share-palette"/);
  assert.match(vaultSwitcher, /current\.shareAppThemeAcrossVaults/);
  // The palette belongs to the vault just created, so it is written after the switch
  // to it — never before, which would land it on the previous vault.
  const switchAt = vaultSwitcher.indexOf('await window.nodus.switchVault(created.vault.id)');
  const applyAt = vaultSwitcher.indexOf('if (addPalette !== null || addSharesPalette !== null)');
  assert.ok(switchAt >= 0 && applyAt > switchAt, 'the palette is applied once the new vault is active');
  assert.match(vaultSwitcher, /appTheme: addPalette/);
  assert.match(vaultSwitcher, /shareAppThemeAcrossVaults: addSharesPalette/);
});
