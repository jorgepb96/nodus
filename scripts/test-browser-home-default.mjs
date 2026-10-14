// Nodus Browser Home defaults to the user's bookmarks until they set an address of
// their own. The interesting part is the existing profiles: every one of them had the
// old default ('start') seeded into app-prefs.json without ever choosing it, so the
// real getSettings() runs here against a temporary profile file rather than a regex
// over the source.
//
// The vault database, the secret store and the v23 recovery pass are stubbed: the
// first two need native modules, and the recovery pass reads every vault on disk.
// None of them touches the Browser keys.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = mkdtempSync(path.join(os.tmpdir(), 'nodus-browser-home-'));
const profileDir = path.join(outDir, 'profile');
const prefsFile = path.join(profileDir, 'app-prefs.json');

const stubs = {
  electron: `module.exports = { app: { getPath: () => ${JSON.stringify(profileDir)} } };`,
  './database': `
    const rows = new Map();
    globalThis.__nodusSettingsRows = rows;
    exports.getDb = () => ({ name: ${JSON.stringify(path.join(profileDir, 'fixture.sqlite'))}, prepare: (sql) => ({
      get: (key) => rows.has(key) ? { value: rows.get(key) } : undefined,
      run: (key, value) => { rows.set(key, value); },
    }) });`,
  '../secrets/secretStore': 'exports.providerKeyMap = () => ({}); exports.lockedApiKeyProviders = () => [];',
  './modelPrefsRecovery': `
    const { readGlobalPrefsRaw } = require('./appPrefs');
    exports.recoverV23SharedModelPrefs = () => readGlobalPrefsRaw();
    exports.recoverV23VaultEmbeddingSelection = () => ({});`,
};

const bundle = path.join(outDir, 'settingsRepo.cjs');
await build({
  entryPoints: [path.join(repoRoot, 'electron/db/settingsRepo.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  outfile: bundle,
  logLevel: 'silent',
  tsconfig: path.join(repoRoot, 'tsconfig.json'),
  plugins: [{
    name: 'stubs',
    setup(api) {
      api.onResolve({ filter: /^(electron|\.\/database|\.\.\/secrets\/secretStore|\.\/modelPrefsRecovery)$/ }, (args) => (
        { path: args.path, namespace: 'stub' }
      ));
      // The recovery stub reaches the real appPrefs module, the same instance settingsRepo uses.
      api.onResolve({ filter: /^\.\/appPrefs$/, namespace: 'stub' }, () => (
        { path: path.join(repoRoot, 'electron/db/appPrefs.ts') }
      ));
      api.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
    },
  }],
});
const repo = require(bundle);

function withProfile(prefs) {
  globalThis.__nodusSettingsRows.clear();
  writeFileSync(prefsFile, JSON.stringify(prefs));
}
const storedPrefs = () => JSON.parse(readFileSync(prefsFile, 'utf8'));

test('a new profile opens Bookmarks as Home and records that it is past the switch', () => {
  // No app-prefs.json yet: the first read seeds it.
  globalThis.__nodusSettingsRows.clear();
  const settings = repo.getSettings();
  assert.equal(settings.browserHomeMode, 'bookmarks');
  assert.equal(storedPrefs().browserHomeMode, 'bookmarks');
  assert.equal(storedPrefs().browserHomeDefaultVersion, 1);
});

test('an existing profile carrying the old seeded default moves to Bookmarks once', () => {
  withProfile({ browserHomeMode: 'start', browserHomeUrl: '' });
  assert.equal(repo.getSettings().browserHomeMode, 'bookmarks');
  assert.equal(storedPrefs().browserHomeMode, 'bookmarks');
  assert.equal(storedPrefs().browserHomeDefaultVersion, 1);
});

test('choosing the Research Atlas after the switch sticks', () => {
  withProfile({ browserHomeMode: 'start', browserHomeDefaultVersion: 1 });
  assert.equal(repo.getSettings().browserHomeMode, 'start');
  repo.updateSettings({ browserHomeMode: 'start' });
  assert.equal(repo.getSettings().browserHomeMode, 'start');
});

test('a custom address and a blank page are hand-made choices and survive', () => {
  withProfile({ browserHomeMode: 'custom', browserHomeUrl: 'https://example.org/' });
  const custom = repo.getSettings();
  assert.equal(custom.browserHomeMode, 'custom');
  assert.equal(custom.browserHomeUrl, 'https://example.org/');

  withProfile({ browserHomeMode: 'blank' });
  assert.equal(repo.getSettings().browserHomeMode, 'blank');
});

test('Home falls back to Bookmarks when the custom address is empty', () => {
  const ipc = readFileSync(path.join(repoRoot, 'electron/ipc/browser.ts'), 'utf8');
  const homeUrl = ipc.slice(ipc.indexOf('const homeUrl = ()'), ipc.indexOf('let restartInFlight'));
  assert.ok(homeUrl.length > 0, 'homeUrl() is still where this test expects it');
  // Every branch that is not an explicit Atlas, blank page or valid custom address
  // ends on the bookmarks page.
  assert.match(homeUrl, /return NODUS_BOOKMARKS_URL;\s*\};\s*$/);
  assert.doesNotMatch(homeUrl, /: 'about:blank'/, 'about:blank is no longer the catch-all');
});
