// Browsing History: pure retention/search behavior plus its local-only boundary.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-history-'));
const bundle = path.join(dir, 'history.cjs');
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'shared/browserHistory.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: 'inherit' });
const require = createRequire(import.meta.url);
const model = require(bundle);
const NOW = Date.parse('2026-08-19T20:00:00.000Z');

function visit(store, id, url, title, ageDays = 0, retention = 'forever') {
  return model.insertBrowserHistoryVisit(store, {
    title,
    url,
    visitedAt: new Date(NOW - ageDays * 86_400_000).toISOString(),
  }, id, retention, NOW);
}

test('history records title, safe URL, domain and visit time locally', () => {
  const store = visit(model.emptyBrowserHistoryStore(), 'one', 'https://user:pass@example.org/path?q=1#part', ' Example page ');
  assert.deepEqual(store.entries[0], {
    id: 'one',
    title: 'Example page',
    url: 'https://example.org/path?q=1#part',
    domain: 'example.org',
    visitedAt: '2026-08-19T20:00:00.000Z',
  });
});

test('unsafe and internal schemes are never written to history', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'nodus://bookmarks', 'nodus-library://item/1', 'data:text/html,x']) {
    assert.equal(model.sanitizeBrowserHistoryUrl(url), null, url);
  }
  assert.equal(visit(model.emptyBrowserHistoryStore(), 'bad', 'file:///tmp/a', 'Bad').entries.length, 0);
});

test('retention policies prune old visits and 30 days is the default', () => {
  assert.equal(model.DEFAULT_BROWSER_HISTORY_RETENTION, '30d');
  let store = model.emptyBrowserHistoryStore();
  store = visit(store, 'recent', 'https://recent.example/', 'Recent', 6);
  store = visit(store, 'week-old', 'https://week.example/', 'Week old', 8);
  store = visit(store, 'month-old', 'https://month.example/', 'Month old', 31);
  store = visit(store, 'year-old', 'https://year.example/', 'Year old', 366);
  assert.deepEqual(model.pruneBrowserHistory(store, '7d', NOW).entries.map((entry) => entry.id), ['recent']);
  assert.deepEqual(model.pruneBrowserHistory(store, '30d', NOW).entries.map((entry) => entry.id), ['recent', 'week-old']);
  assert.deepEqual(model.pruneBrowserHistory(store, '90d', NOW).entries.map((entry) => entry.id), ['recent', 'week-old', 'month-old']);
  assert.deepEqual(model.pruneBrowserHistory(store, '1y', NOW).entries.map((entry) => entry.id), ['recent', 'week-old', 'month-old']);
  assert.equal(model.pruneBrowserHistory(store, 'forever', NOW).entries.length, 4);
  assert.equal(model.pruneBrowserHistory(store, 'none', NOW).entries.length, 0);
});

test('do-not-save rejects new visits and search covers title, URL and domain', () => {
  let store = visit(model.emptyBrowserHistoryStore(), 'one', 'https://archive.example/path', 'National Archive');
  store = visit(store, 'two', 'https://journals.example/article', 'Research article');
  assert.equal(model.insertBrowserHistoryVisit(store, { title: 'Private', url: 'https://private.example/' }, 'three', 'none', NOW).entries.length, 0);
  for (const query of ['national', 'archive.example', '/path']) {
    assert.deepEqual(model.searchBrowserHistory(store, query).map((entry) => entry.id), ['one']);
  }
});

test('individual deletion is isolated and normalization caps pathological stores', () => {
  let store = visit(model.emptyBrowserHistoryStore(), 'one', 'https://one.example/', 'One');
  store = visit(store, 'two', 'https://two.example/', 'Two');
  store = model.deleteBrowserHistoryEntry(store, 'one');
  assert.deepEqual(store.entries.map((entry) => entry.id), ['two']);
  const oversized = model.normalizeBrowserHistoryStore({
    version: 1,
    entries: Array.from({ length: model.MAX_BROWSER_HISTORY_ENTRIES + 20 }, (_, index) => ({
      id: `id-${index}`, title: `Title ${index}`, url: `https://example.org/${index}`, visitedAt: new Date(NOW - index).toISOString(),
    })),
  });
  assert.equal(oversized.entries.length, model.MAX_BROWSER_HISTORY_ENTRIES);
});

test('history is private app data excluded from backup, sync and Chromium storage', () => {
  const repository = readFileSync(path.join(repoRoot, 'electron/browser/history.ts'), 'utf8');
  const backup = readFileSync(path.join(repoRoot, 'electron/export/exportImport.ts'), 'utf8');
  const remote = readFileSync(path.join(repoRoot, 'electron/preload/browserPage.ts'), 'utf8');
  assert.match(repository, /app\.getPath\('userData'\)/);
  assert.match(repository, /browser-history\.json/);
  assert.doesNotMatch(repository, /browserSession|localStorage|indexedDB|cookies/);
  const auxiliary = backup.match(/const GLOBAL_AUXILIARY_FILES = \[[^;]+;/)?.[0] ?? '';
  assert.doesNotMatch(auxiliary, /browser-history\.json/);
  assert.doesNotMatch(remote, /browser:history|getBrowserHistory|deleteBrowserHistory/i);
});

test('only trusted Nodus UI can list, delete or clear history', () => {
  const ipc = readFileSync(path.join(repoRoot, 'electron/ipc/browser.ts'), 'utf8');
  for (const channel of ['history:get', 'history:delete', 'history:clear']) {
    const start = ipc.indexOf(`h('browser:${channel}'`);
    assert.ok(start >= 0, channel);
    assert.match(ipc.slice(start, start + 420), /assertUiSender\(event, getWindow\)/, channel);
  }
  const tabs = readFileSync(path.join(repoRoot, 'electron/browser/tabs.ts'), 'utf8');
  assert.match(tabs, /'did-finish-load'[\s\S]{0,420}recordBrowserHistoryVisit/);
});

test('clear-all and close policy affect history without coupling it to Bookmarks', () => {
  const ipc = readFileSync(path.join(repoRoot, 'electron/ipc/browser.ts'), 'utf8');
  const clearStart = ipc.indexOf("h('browser:clearAllData'");
  const clearEnd = ipc.indexOf("h('browser:history:get'", clearStart);
  const clearAll = ipc.slice(clearStart, clearEnd);
  assert.match(clearAll, /history\.clear\(\)/);
  assert.doesNotMatch(clearAll, /bookmarks\.(?:clear|delete|replace)/);
  const lifecycle = readFileSync(path.join(repoRoot, 'electron/browser/lifecycle.ts'), 'utf8');
  assert.match(lifecycle, /clearBrowserHistoryOnCloseIfConfigured\(\)/);
  const settings = readFileSync(path.join(repoRoot, 'shared/defaultAppSettings.ts'), 'utf8');
  assert.match(settings, /browserHistoryRetention: '30d'/);
  assert.match(settings, /browserClearHistoryOnClose: false/);
});

test('toolbar, modal, search, deletion and retention controls use trusted compact UI', () => {
  const view = readFileSync(path.join(repoRoot, 'src/views/NodusBrowserView.tsx'), 'utf8');
  const managerButton = view.indexOf('dataTestId="browser-bookmarks-manager-button"');
  const historyButton = view.indexOf('dataTestId="browser-history-button"', managerButton);
  const actions = view.indexOf('dataTestId="browser-actions"', historyButton);
  assert.ok(managerButton >= 0 && historyButton > managerButton && actions > historyButton);
  const modal = readFileSync(path.join(repoRoot, 'src/components/browser/BrowserHistoryManager.tsx'), 'utf8');
  for (const marker of [
    'data-testid="browser-history-manager"',
    'data-testid="browser-history-search"',
    'data-testid="browser-history-retention"',
    'data-testid="browser-history-clear-on-close"',
    'data-testid="browser-history-entry"',
    'data-testid="browser-history-clear"',
  ]) assert.match(modal, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(modal, /Do not save history/);
  assert.match(modal, /Never delete/);
  assert.match(modal, /Nodus Bookmarks will not be changed/);
  assert.match(modal, /setBrowserOverlayVisible\(true\)[\s\S]*setBrowserOverlayVisible\(false\)/);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
