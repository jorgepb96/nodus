// Nodus Bookmarks: the pure hierarchy plus the architectural boundaries that
// keep it separate from Chromium browsing data and untrusted websites.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-bookmarks-'));
const bundle = path.join(dir, 'bookmarks.cjs');
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'shared/browserBookmarks.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: 'inherit' });
const require = createRequire(import.meta.url);
const model = require(bundle);
let sequence = 0;
const id = () => `test-${++sequence}`;
const now = '2026-08-19T18:00:00.000Z';

function sample() {
  let store = model.emptyBrowserBookmarkStore();
  const research = model.insertBrowserBookmarkFolder(store, { name: 'Research' }, id(), now); store = research.store;
  const archives = model.insertBrowserBookmarkFolder(store, { name: 'Archives', parentId: research.folder.id }, id(), now); store = archives.store;
  const france = model.insertBrowserBookmarkFolder(store, { name: 'France', parentId: archives.folder.id }, id(), now); store = france.store;
  const gallica = model.insertBrowserBookmark(store, { title: 'Gallica', url: 'https://gallica.bnf.fr/', description: 'French digital library', parentId: france.folder.id }, id(), now); store = gallica.store;
  return { store, research: research.folder, archives: archives.folder, france: france.folder, gallica: gallica.bookmark };
}

/**
 * The collection the Netscape exporter is hardest to get right on: a nested tree
 * with an empty branch, Unicode in titles and URLs, a cached favicon, every
 * character HTML escapes in both a title and a description, and a URL that keeps
 * query parameters and a fragment.
 */
function richStore() {
  let store = model.emptyBrowserBookmarkStore();
  const folder = (name, parentId) => { const made = model.insertBrowserBookmarkFolder(store, { name, parentId }, id(), now); store = made.store; return made.folder; };
  const save = (draft) => { const made = model.insertBrowserBookmark(store, draft, id(), now); store = made.store; return made.bookmark; };
  const research = folder('Recherche & Sources', null);
  const archives = folder('Archives «presse»', research.id);
  const empty = folder('Vide (à trier)', research.id);
  const first = save({
    title: 'A & B "quoted" <tag> O\'Hara',
    url: 'https://example.org/search?q=amour&lang=fr&page=2#results',
    description: 'Ligne 1 & 2 <b>gras</b> "citée"',
    parentId: archives.id,
  });
  const second = save({
    title: '中国古代文献 · 漢籍',
    url: 'https://example.cn/古籍?卷=一&index=2',
    faviconDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    parentId: archives.id,
  });
  const third = save({ title: 'Émile Zola — Œuvres', url: 'https://fr.wikisource.org/wiki/Auteur:Émile_Zola', parentId: null });
  return { store, research, archives, empty, first, second, third };
}

/** The tree as the file describes it: hierarchy, order, titles, URLs and icons. */
const project = (source, parentId = null) => model.browserBookmarkChildren(source, parentId).map((ref) => {
  if (ref.kind === 'folder') {
    const folder = source.folders.find((entry) => entry.id === ref.id);
    return { folder: folder.name, children: project(source, ref.id) };
  }
  const bookmark = source.bookmarks.find((entry) => entry.id === ref.id);
  return { title: bookmark.title, url: bookmark.url, description: bookmark.description, faviconDataUrl: bookmark.faviconDataUrl };
});

test('nested folders retain hierarchy, order and metadata', () => {
  const value = sample();
  assert.deepEqual(model.browserBookmarkFolderPath(value.store, value.france.id), ['Research', 'Archives', 'France']);
  assert.equal(value.gallica.parentId, value.france.id);
  assert.equal(value.gallica.description, 'French digital library');
  assert.equal(value.gallica.createdAt, now);
});

test('moves and manual ordering are stable', () => {
  let { store, research, gallica } = sample();
  const jstor = model.insertBrowserBookmark(store, { title: 'JSTOR', url: 'https://www.jstor.org/', parentId: research.id }, id(), now); store = jstor.store;
  store = model.moveBrowserBookmarkNode(store, { kind: 'bookmark', id: gallica.id }, research.id, 0, now);
  assert.deepEqual(model.browserBookmarkChildren(store, research.id).slice(0, 2), [
    { kind: 'bookmark', id: gallica.id }, { kind: 'folder', id: store.folders.find((f) => f.name === 'Archives').id },
  ]);
  store = model.moveBrowserBookmarkNode(store, { kind: 'bookmark', id: jstor.bookmark.id }, research.id, 0, now);
  assert.equal(model.browserBookmarkChildren(store, research.id)[0].id, jstor.bookmark.id);
});

test('cyclic folder moves and excessive nesting are rejected', () => {
  const { store, research, france } = sample();
  assert.throws(() => model.moveBrowserBookmarkNode(store, { kind: 'folder', id: research.id }, france.id, 0), /descend|misma/i);
  let deep = model.emptyBrowserBookmarkStore(); let parentId = null;
  for (let i = 0; i < model.MAX_BOOKMARK_FOLDER_DEPTH; i += 1) { const made = model.insertBrowserBookmarkFolder(deep, { name: `L${i}`, parentId }, id(), now); deep = made.store; parentId = made.folder.id; }
  assert.throws(() => model.insertBrowserBookmarkFolder(deep, { name: 'Too deep', parentId }, id(), now), /profunda/i);
});

test('duplicate URLs ignore fragments and trailing slash', () => {
  let store = model.emptyBrowserBookmarkStore();
  const first = model.insertBrowserBookmark(store, { title: 'Example', url: 'https://example.org/path/#one' }, id(), now); store = first.store;
  const second = model.insertBrowserBookmark(store, { title: 'Again', url: 'https://example.org/path#two' }, id(), now);
  assert.equal(second.duplicate.id, first.bookmark.id);
  assert.equal(second.store.bookmarks.length, 1);
});

test('unsafe bookmark and favicon values fail closed', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'nodus-library://item/1', 'nodus://bookmarks', 'data:text/html,x']) assert.equal(model.sanitizeBookmarkUrl(url), null);
  assert.equal(model.sanitizeBookmarkUrl('https://user:pass@example.org/x'), 'https://example.org/x');
  assert.equal(model.sanitizeFaviconDataUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(model.sanitizeFaviconDataUrl('https://evil.test/icon.png'), null);
});

test('search includes title, domain, description and every folder name', () => {
  const { store, gallica } = sample();
  for (const query of ['gallica', 'bnf.fr', 'digital library', 'archives', 'france']) {
    assert.deepEqual(model.searchBrowserBookmarks(store, query).map((hit) => hit.bookmark.id), [gallica.id], query);
  }
});

test('delete folder recursively removes descendants but not siblings', () => {
  let { store, archives } = sample();
  const keep = model.insertBrowserBookmark(store, { title: 'Keep', url: 'https://example.org/' }, id(), now); store = keep.store;
  store = model.deleteBrowserBookmarkNode(store, { kind: 'folder', id: archives.id });
  assert.equal(store.folders.some((folder) => folder.id === archives.id), false);
  assert.deepEqual(store.bookmarks.map((bookmark) => bookmark.id), [keep.bookmark.id]);
});

test('JSON roundtrip preserves IDs, hierarchy, order and descriptions', () => {
  const { store } = sample();
  const restored = model.parseBrowserBookmarksJson(model.exportBrowserBookmarksJson(store));
  assert.deepEqual(restored.folders, store.folders);
  assert.deepEqual(restored.bookmarks, store.bookmarks);
});

test('standard Netscape HTML roundtrip and malformed imports are safe', () => {
  const { store } = sample();
  const parsed = model.parseBrowserBookmarksHtml(model.exportBrowserBookmarksHtml(store), id, now);
  assert.equal(parsed.store.bookmarks.length, 1);
  assert.equal(parsed.store.folders.length, 3);
  assert.deepEqual(model.browserBookmarkFolderPath(parsed.store, parsed.store.bookmarks[0].parentId), ['Research', 'Archives', 'France']);
  const hostile = model.parseBrowserBookmarksHtml('<DL><DT><A HREF="javascript:alert(1)">Bad</A><DT><A HREF="https://safe.example/">Safe</A></DL>', id, now);
  assert.equal(hostile.invalidUrls, 1);
  assert.deepEqual(hostile.store.bookmarks.map((bookmark) => bookmark.title), ['Safe']);
  assert.throws(() => model.parseBrowserBookmarksJson('{broken'), /no es válido/i);
});

test('the HTML export is a UTF-8 Netscape file with Unix ADD_DATE and escaped text', () => {
  const { store, first, second } = richStore();
  const html = model.exportBrowserBookmarksHtml(store);
  const lines = html.split('\n');
  assert.equal(lines[0], '<!DOCTYPE NETSCAPE-Bookmark-file-1>');
  assert.match(lines[1], /charset=UTF-8/i);
  assert.equal(lines[2], '<TITLE>Nodus Bookmarks</TITLE>');
  assert.equal(lines[3], '<H1>Nodus Bookmarks</H1>');
  assert.equal(lines[4], '<DL><p>');
  assert.ok(html.endsWith('</DL><p>\n'), 'the file must close its root list and end with a newline');
  assert.ok(!html.startsWith('\ufeff'), 'a BOM would be read as part of the first tag');
  assert.equal(Buffer.from(html, 'utf8').toString('utf8'), html, 'the payload must survive a UTF-8 round trip');

  // ADD_DATE is Unix seconds, derived from the bookmark's creation time.
  const stamp = String(Math.floor(Date.parse(first.createdAt) / 1000));
  assert.match(html, new RegExp(`<DT><A HREF="https://example\\.org/search\\?q=amour&amp;lang=fr&amp;page=2#results" ADD_DATE="${stamp}"[^>]*>`));
  const icon = model.sanitizeFaviconDataUrl(second.faviconDataUrl);
  assert.ok(html.includes(`ICON="${icon}"`), 'a cached favicon is carried as a data URL, ready for the browser to store');
  assert.equal((html.match(/ADD_DATE="\d{10}"/g) ?? []).length, 6,
    'every folder and bookmark carries a 10-digit ADD_DATE');

  // Escaping: query separators, quotes and angle brackets never leak raw markup.
  assert.match(html, /q=amour&amp;lang=fr&amp;page=2#results/, 'query parameters must survive, escaped');
  assert.ok(!html.includes('q=amour&lang=fr'), 'an unescaped & would break the attribute');
  assert.ok(html.includes('A &amp; B &quot;quoted&quot; &lt;tag&gt; O&#39;Hara'), 'titles must be escaped');
  assert.ok(html.includes('Ligne 1 &amp; 2 &lt;b&gt;gras&lt;/b&gt; &quot;citée&quot;'), 'descriptions must be escaped');
  // Unicode is written as itself, not as numeric entities.
  assert.ok(html.includes('中国古代文献 · 漢籍'));
  assert.ok(html.includes('Émile Zola — Œuvres'));
  assert.ok(html.includes('Archives «presse»'));
});

test('the HTML export keeps folder depth, sibling order and empty folders', () => {
  const { store, research, archives, empty } = richStore();
  const html = model.exportBrowserBookmarksHtml(store);
  const at = (needle) => html.indexOf(needle);
  const depth = (line) => line.length - line.trimStart().length;

  // A folder two levels deep indents its children four spaces per level.
  const rootFolder = html.match(/^ *<DT><H3 ADD_DATE="\d+">Recherche &amp; Sources<\/H3>$/m)?.[0];
  const nestedFolder = html.match(/^ *<DT><H3 ADD_DATE="\d+">Archives «presse»<\/H3>$/m)?.[0];
  const deepBookmark = html.match(/^ *<DT><A HREF="https:\/\/example\.org\/search[^\n]*$/m)?.[0];
  assert.ok(rootFolder && nestedFolder && deepBookmark, 'all three levels must be present');
  assert.equal(depth(nestedFolder) - depth(rootFolder), 4);
  assert.equal(depth(deepBookmark) - depth(nestedFolder), 4);

  // Siblings keep the manual order they had in the collection.
  assert.ok(at('Recherche &amp; Sources') < at('Archives «presse»'));
  assert.ok(at('A &amp; B &quot;quoted&quot;') < at('中国古代文献'), 'bookmarks keep their order inside the folder');
  assert.ok(at('Émile Zola') > at('Recherche &amp; Sources'), 'a root bookmark follows the root folder that precedes it');

  // A folder with nothing in it is still exported, as an empty list.
  assert.match(html, /<DT><H3 ADD_DATE="\d+">Vide \(à trier\)<\/H3>\n *<DL><p>\n *<\/DL><p>/);
  assert.equal(model.browserBookmarkChildren(store, empty.id).length, 0);
  assert.ok(at(research.id) < 0 && at(archives.id) < 0, 'ids are never written into the file');
  const escaped = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  for (const bookmark of store.bookmarks) {
    assert.ok(html.includes(`<A HREF="${escaped(bookmark.url)}"`), `${bookmark.title} must keep its exact stored URL`);
  }
});

test('the HTML export round-trips hierarchy, order, Unicode and escaped text', () => {
  const { store } = richStore();
  const parsed = model.parseBrowserBookmarksHtml(model.exportBrowserBookmarksHtml(store), id, now);
  assert.equal(parsed.invalidUrls, 0);
  assert.deepEqual(project(parsed.store), project(store),
    'a browser-importable file must carry the same tree, order, titles, URLs and descriptions');
});

test('the export covers the whole collection whatever the page is showing', () => {
  const { store } = richStore();
  // A search that matches nothing, plus a folder the page happens to have open:
  // both are view state and must never reach the file.
  assert.equal(model.searchBrowserBookmarks(store, 'zzz-no-match').length, 0);
  const html = model.exportBrowserBookmarksHtml(store);
  assert.equal((html.match(/<DT><A HREF=/g) ?? []).length, store.bookmarks.length);
  assert.equal((html.match(/<DT><H3 /g) ?? []).length, store.folders.length);

  const pages = readFileSync(path.join(repoRoot, 'src/components/browser/NodusStartPages.tsx'), 'utf8');
  assert.match(pages, /window\.nodus\.exportBrowserBookmarks\('html'\)/,
    'the toolbar must ask the trusted process for the export, passing only the format');
  const filterbar = pages.indexOf('className="atlas-filterbar"');
  const exportButton = pages.indexOf('data-testid="browser-bookmarks-export-html"');
  const breadcrumbs = pages.indexOf('className="bookmark-breadcrumbs"');
  assert.ok(filterbar >= 0 && exportButton > filterbar && breadcrumbs > exportButton,
    'the download action belongs in the toolbar, before the breadcrumbs');
  const button = pages.slice(exportButton, pages.indexOf('</button>', exportButton));
  assert.doesNotMatch(button, /query|folderId/,
    'the export must not be gated on a search or an open folder');
  assert.match(button, /<Icon name="download"/);
  for (const attribute of ['title', 'aria-label']) {
    assert.ok(pages.includes(`${attribute}={t('Exportar todos los marcadores como HTML compatible con Chrome, Edge, Firefox, Brave y Opera')}`),
      `the visible tooltip and the accessible name must both be translated (${attribute})`);
  }
  assert.match(pages.slice(exportButton, exportButton + 700), /disabled=\{exporting\}/,
    'a second click while the dialog is open must not open another one');
  assert.match(pages, /if \(exporting\) return;/);
  assert.match(pages, /result\.canceled[\s\S]{0,80}onNotice\(t\('Exportación cancelada\.'\)\)/,
    'cancelling the native dialog is reported, not swallowed');
  assert.match(pages, /catch \(cause\)[\s\S]{0,120}onNotice\(cause instanceof Error \? cause\.message : String\(cause\)\)/,
    'a failed export must surface its error in the notice area');
});

test('the suggested file name is dated in local time and the JSON backup is kept', () => {
  assert.equal(model.browserBookmarksExportFileName('html', new Date(2026, 8, 15, 12, 0)), 'nodus-bookmarks-2026-09-15.html');
  assert.equal(model.browserBookmarksExportFileName('html', new Date(2026, 0, 1, 12, 0)), 'nodus-bookmarks-2026-01-01.html');
  assert.equal(model.browserBookmarksExportFileName('json', new Date(2026, 11, 31, 12, 0)), 'nodus-bookmarks-2026-12-31.json');
  // Late evening local time is the case a UTC stamp gets wrong.
  const late = new Date(2026, 8, 15, 23, 30);
  const named = model.browserBookmarksExportFileName('html', late);
  assert.equal(named, 'nodus-bookmarks-2026-09-15.html');
  if (late.toISOString().slice(0, 10) !== '2026-09-15') assert.notEqual(named.slice(15, 25), late.toISOString().slice(0, 10));
  assert.match(model.browserBookmarksExportFileName('html'), /^nodus-bookmarks-\d{4}-\d{2}-\d{2}\.html$/);

  const ipc = readFileSync(path.join(repoRoot, 'electron/ipc/browser.ts'), 'utf8');
  const start = ipc.indexOf("h('browser:bookmarks:export'");
  const handler = ipc.slice(start, ipc.indexOf("h('browser:", start + 10));
  assert.match(handler, /assertUiSender\(event, getWindow\)/);
  assert.match(handler, /defaultPath: browserBookmarksExportFileName\(format\)/,
    'the native dialog must offer the dated name');
  assert.match(handler, /format === 'json' \? exportBrowserBookmarksJson\(store\) : exportBrowserBookmarksHtml\(store\)/,
    'the existing JSON export is still served by the same handler');
  assert.match(handler, /fsp\.writeFile\(selected\.filePath, payload, \{ encoding: 'utf8', mode: 0o600 \}\)/);
  assert.match(handler, /fileName: path\.basename\(selected\.filePath\)/);
  assert.doesNotMatch(handler, /bookmarks\.replace|bookmarks\.save|normalizeBrowserBookmarkStore/,
    'exporting must never write back into the stored collection');

  const manager = readFileSync(path.join(repoRoot, 'src/components/browser/BrowserBookmarksManager.tsx'), 'utf8');
  assert.match(manager, /exportBrowserBookmarks\('json'\)/, 'the JSON backup button stays');
  assert.match(manager, /exportBrowserBookmarks\('html'\)/);
});

test('the export and the import are the same format, in both directions', () => {
  const { store } = richStore();
  const written = model.exportBrowserBookmarksHtml(store);
  // Parsing with the collection's own clock: the file dates are the data, so a
  // file that survives the trip has to come back out byte for byte.
  const reread = model.parseBrowserBookmarksHtml(written, id, now);
  assert.equal(model.exportBrowserBookmarksHtml(reread.store), written,
    'what the export writes must be what the import reads, with nothing lost in between');
});

test('a browser-written Netscape file imports with its folders, order and icons', () => {
  // Shaped like a real Chrome/Edge/Firefox export: comment header, attributes the
  // format allows but Nodus never writes, an empty folder, entities and a favicon.
  const source = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    '    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000001" PERSONAL_TOOLBAR_FOLDER="true">Marcadores</H3>',
    '    <DL><p>',
    '        <DT><A HREF="https://es.wikipedia.org/wiki/Historia" ADD_DATE="1700000002" ICON="data:image/png;base64,iVBORw0KGgo=">Wikipedia &amp; historia</A>',
    '        <DT><H3 ADD_DATE="1700000003" LAST_MODIFIED="1700000004">Archivo</H3>',
    '        <DL><p>',
    '            <DT><A HREF="https://archive.org/details/tractatus?q=logic&amp;page=3" ADD_DATE="1700000005">Tractatus &lt;1921&gt;</A>',
    '            <DD>Escaneo original',
    '        </DL><p>',
    '    </DL><p>',
    '    <DT><H3 ADD_DATE="1700000006">Otros marcadores</H3>',
    '    <DL><p>',
    '    </DL><p>',
    '</DL><p>',
    '',
  ].join('\n');
  const parsed = model.parseBrowserBookmarksHtml(source, id, now);
  assert.equal(parsed.invalidUrls, 0);
  assert.equal(parsed.truncated, false);
  const folders = parsed.store.folders.map((folder) => folder.name);
  assert.deepEqual(folders, ['Marcadores', 'Archivo', 'Otros marcadores']);
  const byTitle = (title) => parsed.store.bookmarks.find((bookmark) => bookmark.title === title);
  assert.ok(byTitle('Wikipedia & historia'), 'entities in a title must decode');
  assert.equal(byTitle('Wikipedia & historia').url, 'https://es.wikipedia.org/wiki/Historia');
  assert.equal(byTitle('Wikipedia & historia').faviconDataUrl, 'data:image/png;base64,iVBORw0KGgo=',
    'the ICON a browser wrote must be kept as the cached favicon');
  assert.ok(byTitle('Tractatus <1921>'), 'escaped angle brackets must come back as text, not markup');
  assert.equal(byTitle('Tractatus <1921>').description, 'Escaneo original');
  assert.equal(byTitle('Tractatus <1921>').url, 'https://archive.org/details/tractatus?q=logic&page=3');
  assert.deepEqual(model.browserBookmarkFolderPath(parsed.store, byTitle('Tractatus <1921>').parentId), ['Marcadores', 'Archivo']);
  assert.deepEqual(model.browserBookmarkFolderPath(parsed.store, byTitle('Wikipedia & historia').parentId), ['Marcadores']);
  assert.equal(byTitle('Tractatus <1921>').parentId !== byTitle('Wikipedia & historia').parentId, true,
    'the nested branch must stay nested');
  const empty = parsed.store.folders.find((folder) => folder.name === 'Otros marcadores');
  assert.deepEqual(model.browserBookmarkChildren(parsed.store, empty.id), [],
    'a folder with an empty list imports as an empty folder');
  assert.equal((model.exportBrowserBookmarksHtml(parsed.store).match(/<DT><A HREF=/g) ?? []).length, 2,
    'and re-exporting it stays a valid file');
});

test('the Bookmarks page imports through the same trusted preview and commit pair', () => {
  const pages = readFileSync(path.join(repoRoot, 'src/components/browser/NodusStartPages.tsx'), 'utf8');
  assert.match(pages, /window\.nodus\.previewBrowserBookmarksImport\(\)/);
  assert.match(pages, /window\.nodus\.commitBrowserBookmarksImport\(importPreview\.token\)/,
    'committing must reuse the token the preview returned, not re-read the file');
  assert.match(pages, /if \(importBusy\.current\) return;/, 'a second click must not open a second picker');
  assert.match(pages, /if \(!preview\) onNotice\(t\('Importación cancelada\.'\)\)/,
    'cancelling the picker is reported, not swallowed');
  assert.match(pages, /catch \(cause\)[\s\S]{0,120}onNotice\(cause instanceof Error \? cause\.message : String\(cause\)\)/);

  const exportButton = pages.indexOf('data-testid="browser-bookmarks-export-html"');
  const importButton = pages.indexOf('data-testid="browser-bookmarks-import-html"');
  const breadcrumbs = pages.indexOf('className="bookmark-breadcrumbs"');
  assert.ok(importButton > exportButton && breadcrumbs > importButton,
    'the import action belongs in the toolbar, next to the export');
  const button = pages.slice(importButton, pages.indexOf('</button>', importButton));
  assert.doesNotMatch(button, /query|folderId/, 'importing must not be gated on the view');
  assert.match(button, /<Icon name="upload"/);
  assert.match(button, /disabled=\{importing\}/);
  for (const attribute of ['title', 'aria-label']) {
    assert.ok(pages.includes(`${attribute}={t('Importar marcadores desde un archivo HTML de Chrome, Edge, Firefox, Brave u Opera')}`),
      `the visible tooltip and the accessible name must both be translated (${attribute})`);
  }
  // The summary is shown, and nothing is written until it is confirmed.
  const preview = pages.slice(importButton, pages.indexOf('{deleteConfirmation &&'));
  assert.match(preview, /importPreview && <ConfirmModal/);
  assert.match(preview, /importPreview\.duplicates/);
  assert.match(preview, /confirmLabel=\{importing \? t\('Importando…'\) : t\('Importar sin sobrescribir'\)\}/);
  assert.match(preview, /onConfirm=\{\(\) => void commitImport\(\)\}/);
  assert.doesNotMatch(pages, /window\.nodus\.(?!previewBrowserBookmarksImport|commitBrowserBookmarksImport)[A-Za-z]*BookmarkImport/,
    'importing must not grow a third channel');

  const ipc = readFileSync(path.join(repoRoot, 'electron/ipc/browser.ts'), 'utf8');
  const previewHandler = ipc.indexOf("h('browser:bookmarks:previewImport'");
  assert.ok(previewHandler >= 0);
  assert.match(ipc.slice(previewHandler, previewHandler + 700), /assertUiSender\(event, getWindow\)/);
  assert.match(ipc.slice(previewHandler, previewHandler + 700), /showImportOpenDialog/,
    'the picker must stay behind the shared privacy-gated open dialog');
  assert.doesNotMatch(ipc, /h\('browser:bookmarks:import'/, 'no second import channel may be added');
});

test('imports merge without overwriting and report duplicates', () => {
  const { store } = sample();
  let incoming = model.emptyBrowserBookmarkStore();
  incoming = model.insertBrowserBookmark(incoming, { title: 'Duplicate', url: 'https://gallica.bnf.fr/' }, id(), now).store;
  incoming = model.insertBrowserBookmark(incoming, { title: 'New', url: 'https://openalex.org/' }, id(), now).store;
  const merged = model.mergeBrowserBookmarkStores(store, incoming, id, now);
  assert.equal(merged.summary.duplicates, 1);
  assert.equal(merged.summary.bookmarks, 1);
  assert.equal(merged.store.bookmarks.length, 2);
});

test('a 1,000 bookmark collection remains searchable and normalizable', () => {
  const raw = model.emptyBrowserBookmarkStore();
  raw.bookmarks = Array.from({ length: 1_000 }, (_, index) => ({ id: `bulk-${index}`, title: `Resource ${index}`, url: `https://example.org/${index}`, description: index === 777 ? 'needle research' : '', faviconDataUrl: null, parentId: null, order: index, createdAt: now, updatedAt: now }));
  const normalized = model.normalizeBrowserBookmarkStore(raw);
  assert.equal(normalized.bookmarks.length, 1_000);
  assert.equal(model.searchBrowserBookmarks(normalized, 'needle').length, 1);
});

test('bookmarks use Nodus auxiliary persistence and never Chromium storage', () => {
  const repository = readFileSync(path.join(repoRoot, 'electron/browser/bookmarks.ts'), 'utf8');
  assert.match(repository, /app\.getPath\('userData'\)/);
  assert.match(repository, /browser-bookmarks\.json/);
  assert.doesNotMatch(repository, /localStorage|sessionStorage|cookies|browserSession/);
  const backup = readFileSync(path.join(repoRoot, 'electron/export/exportImport.ts'), 'utf8');
  assert.match(backup, /GLOBAL_AUXILIARY_FILES[^\n]+browser-bookmarks\.json/);
  const browsingData = readFileSync(path.join(repoRoot, 'electron/browser/storage.ts'), 'utf8');
  const lifecycle = readFileSync(path.join(repoRoot, 'electron/browser/lifecycle.ts'), 'utf8');
  assert.doesNotMatch(browsingData, /browserBookmarks|browser-bookmarks\.json/);
  assert.doesNotMatch(lifecycle, /browserBookmarks|browser-bookmarks\.json/);
});

/**
 * A root folder with two subfolders and four bookmarks saved on different days,
 * plus one starred bookmark filed inside a subfolder. Titles mix case and accents
 * so the alphabetical sorts cannot pass on byte order alone.
 */
function datedStore() {
  let store = model.emptyBrowserBookmarkStore();
  const day = (n) => `2026-08-${String(n).padStart(2, '0')}T12:00:00.000Z`;
  const folder = (name, parentId, n) => { const made = model.insertBrowserBookmarkFolder(store, { name, parentId }, id(), day(n)); store = made.store; return made.folder; };
  const save = (title, host, n, extra = {}) => { const made = model.insertBrowserBookmark(store, { title, url: `https://${host}.example/`, ...extra }, id(), day(n)); store = made.store; return made.bookmark; };
  const zebra = folder('Zebra folder', null, 3);
  const archive = folder('archivo', null, 6);
  const europeana = save('Europeana', 'europeana', 1, { favorite: true });
  const arxiv = save('arXiv', 'arxiv', 5);
  const eloy = save('Éloy', 'eloy', 2);
  const brepols = save('Brepols', 'brepols', 4, { favorite: true });
  const hidden = save('Gallica', 'gallica', 7, { parentId: zebra.id, favorite: true });
  return { store, zebra, archive, europeana, arxiv, eloy, brepols, hidden };
}

const labels = (store, refs) => refs.map((ref) => (ref.kind === 'folder'
  ? `[${store.folders.find((entry) => entry.id === ref.id).name}]`
  : store.bookmarks.find((entry) => entry.id === ref.id).title));

test('favourites are stored, toggled, kept through JSON, and absent means not starred', () => {
  const value = datedStore();
  assert.equal(value.europeana.favorite, true);
  assert.equal(value.arxiv.favorite, false);
  const unstarred = model.updateBrowserBookmark(value.store, value.europeana.id, { favorite: false }, now);
  assert.equal(unstarred.bookmarks.find((entry) => entry.id === value.europeana.id).favorite, false);
  const starred = model.updateBrowserBookmark(unstarred, value.arxiv.id, { favorite: true }, now);
  assert.equal(starred.bookmarks.find((entry) => entry.id === value.arxiv.id).favorite, true);
  // An edit that does not mention the star leaves it alone.
  const renamed = model.updateBrowserBookmark(starred, value.arxiv.id, { title: 'arXiv.org' }, now);
  assert.equal(renamed.bookmarks.find((entry) => entry.id === value.arxiv.id).favorite, true);

  const roundTrip = model.parseBrowserBookmarksJson(model.exportBrowserBookmarksJson(renamed));
  assert.deepEqual(roundTrip.bookmarks.filter((entry) => entry.favorite).map((entry) => entry.title).sort(), ['Brepols', 'Gallica', 'arXiv.org']);

  // Stores written before favourites existed have no field; a hand-edited one may hold junk.
  const legacy = JSON.parse(JSON.stringify(value.store));
  delete legacy.bookmarks[0].favorite;
  legacy.bookmarks[1].favorite = 'yes';
  const normalized = model.normalizeBrowserBookmarkStore(legacy, now);
  assert.equal(normalized.bookmarks[0].favorite, false);
  assert.equal(normalized.bookmarks[1].favorite, false);
});

test('the Bookmarks page sorts by date, by name, folders first, and by favourites', () => {
  const { store } = datedStore();
  const sorted = (sort) => labels(store, model.sortBrowserBookmarkItems(store, null, sort));
  assert.equal(model.DEFAULT_BROWSER_BOOKMARK_SORT, 'recent');
  assert.deepEqual(sorted('recent'), ['[archivo]', 'arXiv', 'Brepols', '[Zebra folder]', 'Éloy', 'Europeana']);
  assert.deepEqual(sorted('oldest'), ['Europeana', 'Éloy', '[Zebra folder]', 'Brepols', 'arXiv', '[archivo]']);
  assert.deepEqual(sorted('alpha'), ['[archivo]', 'arXiv', 'Brepols', 'Éloy', 'Europeana', '[Zebra folder]']);
  assert.deepEqual(sorted('alpha-desc'), ['[Zebra folder]', 'Europeana', 'Éloy', 'Brepols', 'arXiv', '[archivo]']);
  assert.deepEqual(sorted('folders-alpha'), ['[archivo]', '[Zebra folder]', 'arXiv', 'Brepols', 'Éloy', 'Europeana']);
  assert.deepEqual(sorted('folders-alpha-desc'), ['[Zebra folder]', '[archivo]', 'Europeana', 'Éloy', 'Brepols', 'arXiv']);
  // Favourites A-Z on top; the rest of the folder stays newest first.
  assert.deepEqual(sorted('favorites-first'), ['Brepols', 'Europeana', '[archivo]', 'arXiv', '[Zebra folder]', 'Éloy']);
  // Only favourites: the whole collection, including one filed in a subfolder, and no folders.
  assert.deepEqual(sorted('favorites-only'), ['Brepols', 'Europeana', 'Gallica']);
  assert.deepEqual(labels(store, model.sortBrowserBookmarkItems(store, store.folders[0].id, 'favorites-only')), ['Brepols', 'Europeana', 'Gallica']);
});

test('sorting is display only and never rewrites the manual order', () => {
  const { store } = datedStore();
  const before = JSON.stringify(store);
  for (const sort of model.BROWSER_BOOKMARK_SORTS) model.sortBrowserBookmarkItems(store, null, sort);
  assert.equal(JSON.stringify(store), before);
  assert.equal(model.isBrowserBookmarkSort('recent'), true);
  assert.equal(model.isBrowserBookmarkSort('newest'), false, 'an unknown stored value falls back to the default');
});

test('the Bookmarks page offers the sort popover and a favourite star instead of the Saved tag', () => {
  const pages = readFileSync(path.join(repoRoot, 'src/components/browser/NodusStartPages.tsx'), 'utf8');
  const styles = readFileSync(path.join(repoRoot, 'src/components/browser/NodusBookmarks.css'), 'utf8');
  const bookmarksPage = pages.slice(pages.indexOf('export function NodusBookmarksPage('), pages.indexOf('type AtlasFacetKey'));
  const filterbar = bookmarksPage.slice(bookmarksPage.indexOf('<div className="atlas-filterbar">'), bookmarksPage.indexOf('data-testid="browser-bookmarks-import-html"'));
  assert.match(filterbar, /<BookmarkSortMenu sort=\{sort\} onSort=\{setSort\} \/>\s*<BookmarkViewToggle view=\{view\} onView=\{setView\} \/>/,
    'the sort pill and the view toggle sit in the action row');
  assert.doesNotMatch(filterbar, /Research Atlas/, 'the Atlas is in the site header, so the action row does not repeat it');
  assert.match(styles, /\.bookmarks-main \.atlas-filterbar \{ flex-wrap:wrap; \}/,
    'the Bookmarks action row wraps instead of squeezing its pills');
  assert.match(pages, /localStorage\.getItem\(BOOKMARK_VIEW_STORAGE_KEY\) === 'list' \? 'list' : 'cards'/, 'cards is the default view');
  assert.match(pages, /<div className="bookmark-list" data-testid="browser-bookmarks-list">/);
  assert.match(styles, /\.bookmark-list \.bookmark-card \.atlas-description \{ display:none; \}/);
  assert.match(pages, /role="menuitemradio"/);
  for (const sort of ['recent', 'oldest', 'alpha', 'alpha-desc', 'folders-alpha', 'folders-alpha-desc', 'favorites-first', 'favorites-only']) {
    assert.match(pages, new RegExp(`\\{ sort: '${sort}', label: `), `the menu offers ${sort}`);
  }
  assert.match(pages, /sortBrowserBookmarkItems\(store, folderId, sort\)/);
  assert.match(pages, /localStorage\.getItem\(BOOKMARK_SORT_STORAGE_KEY\)/, 'the chosen order survives reopening the page');
  assert.doesNotMatch(bookmarksPage, /t\('Guardado'\)/, 'bookmark cards no longer carry the Saved tag');
  assert.match(bookmarksPage, /data-testid="browser-bookmark-favorite"[\s\S]{0,200}aria-pressed=\{entry\.favorite\}/);
  assert.match(bookmarksPage, /updateBrowserBookmark\(entry\.id, \{ favorite: !entry\.favorite \}\)/);
  assert.match(styles, /\.bookmark-star\.is-favorite \{ color:#facc15; \}/, 'a starred bookmark turns yellow');
  assert.match(styles, /\.bookmark-star\.is-favorite svg \{ fill:currentColor; \}/);
});

test('trusted Bookmarks UI reuses Atlas styling and avoids native prompt dialogs', () => {
  const styles = readFileSync(path.join(repoRoot, 'src/components/browser/NodusBookmarks.css'), 'utf8');
  const pages = readFileSync(path.join(repoRoot, 'src/components/browser/NodusStartPages.tsx'), 'utf8');
  const manager = readFileSync(path.join(repoRoot, 'src/components/browser/BrowserBookmarksManager.tsx'), 'utf8');
  const browserView = readFileSync(path.join(repoRoot, 'src/views/NodusBrowserView.tsx'), 'utf8');
  const ipc = readFileSync(path.join(repoRoot, 'electron/ipc/browser.ts'), 'utf8');
  assert.match(styles, /@import url\([^)]*research-atlas\.css/);
  assert.match(pages, /site\/assets\/js\/organism\.js/,
    'the local start pages must load the exact Nodus Research organism engine');
  assert.match(pages, /NodusOrganismFactory\.create\(canvas\)/,
    'Atlas and Bookmarks must instantiate the shared live WebGL field');
  assert.match(styles, /\.nodus-site-organism\.awake/);
  assert.doesNotMatch(pages, /nodus-site-mesh-links|<svg viewBox="0 0 1200 760"/,
    'a hand-drawn static mesh is not visual parity with Research Atlas');
  assert.doesNotMatch(pages, /nodus-start-light|useLightTheme/);
  assert.doesNotMatch(styles, /nodus-start-light/,
    'the public Nodus Research design has no light variant, so neither local start page may invent one');
  assert.match(pages, /isSaved \? t\('Guardado'\) : t\('Guardar'\)/);
  assert.match(pages, /búsqueda global/);
  assert.match(pages, /data-testid="nodus-site-header"/);
  assert.match(pages, /data-testid="nodus-site-footer"/);
  assert.match(pages, /label="Atlas" url=\{NODUS_RESEARCH_ATLAS_URL\}/,
    'the Atlas navigation item must open the public online Atlas');
  assert.doesNotMatch(pages, /label="Atlas" url=\{NODUS_RESEARCH_ATLAS_START_URL\}/);
  assert.match(pages, /page !== 'bookmarks' && <[\s\S]*atlas-engine-wrap/,
    'Bookmarks must omit the Atlas engine selector so the full control is search');
  assert.match(styles, /\.atlas-searchbar\.is-bookmarks\s*\{\s*grid-template-columns:minmax\(0,1fr\) 52px/);
  assert.match(styles, /\.bookmarks-main \.atlas-grid\s*\{\s*align-items:start/,
    'bookmark rows must not stretch short cards to match taller neighbours');
  assert.match(styles, /\.bookmarks-main \.atlas-card\s*\{\s*min-height:0;\s*padding:20px/,
    'bookmark cards must override the Atlas minimum height and excess padding');
  assert.match(styles, /\.bookmarks-main \.bookmark-card\s*\{\s*height:171px/,
    'website and folder cards must keep the same compact desktop height');
  assert.match(styles, /\.bookmark-card \.atlas-description[\s\S]{0,180}text-overflow:ellipsis/,
    'long bookmark copy must truncate instead of making one card taller');
  assert.match(pages, /resolveBrowserBookmarkFavicons\(missingFaviconKey\.split\('\\n'\)\)/,
    'visible bookmarks must ask the trusted browser process to fill missing favicons');
  assert.match(ipc, /browser:bookmarks:resolveFavicons/);
  const favicon = readFileSync(path.join(repoRoot, 'electron/browser/favicon.ts'), 'utf8');
  assert.match(favicon, /discoverFaviconUrls/);
  assert.match(favicon, /new URL\('\/favicon\.ico', origin\)/,
    'favicon discovery must retain the conventional site icon fallback');
  assert.match(pages, /className="card lit atlas-card bookmark-card"[\s\S]{0,260}openBrowserTab\(entry\.url\)/,
    'clicking a website card must open its bookmark');
  assert.match(pages, /className=\{`card lit atlas-card bookmark-card[\s\S]{0,300}setFolderId\(entry\.id\)/,
    'clicking a folder card must open that folder');
  assert.equal((pages.match(/data-testid="browser-bookmark-card-delete"/g) ?? []).length, 2,
    'folder and website cards must each expose their own delete button');
  assert.match(pages, /deleteBrowserBookmarkNode\(deleteConfirmation\.ref\)/);
  assert.match(pages, /<ConfirmModal[\s\S]{0,700}danger[\s\S]{0,700}onConfirm=\{\(\) => void remove\(\)\}/,
    'card deletion must use a destructive confirmation modal');
  const siteHeader = pages.indexOf('<NodusSiteHeader page={page} />');
  const atlasGrid = pages.indexOf('<div className="atlas-grid">{children}</div>', siteHeader);
  const siteFooter = pages.indexOf('<NodusSiteFooter />', atlasGrid);
  assert.ok(siteHeader >= 0 && atlasGrid > siteHeader && siteFooter > atlasGrid,
    'Atlas and Bookmarks must render inside the same Nodus Research site shell');
  assert.match(pages, /navigateBrowserStartPage\('atlas'\)/);
  assert.match(pages, /navigateBrowserStartPage\('bookmarks'\)/);
  const localNavigation = ipc.indexOf("h('browser:navigateStartPage'");
  assert.ok(localNavigation >= 0);
  assert.match(ipc.slice(localNavigation, localNavigation + 550), /assertUiSender\(event, getWindow\)/);
  assert.match(ipc.slice(localNavigation, localNavigation + 550), /page === 'atlas'[\s\S]*page === 'bookmarks'/);
  assert.doesNotMatch(manager, /window\.(?:prompt|confirm)\(/);
  assert.doesNotMatch(browserView, /window\.(?:prompt|confirm)\(/);
  assert.match(browserView, /setBookmarksManager\(false\)[\s\S]{0,180}setReturnToBookmarksManager\(true\)/);
  const omniboxStart = browserView.indexOf('data-testid="browser-omnibox-shell"');
  const bookmarkButton = browserView.indexOf('data-testid="browser-add-bookmark"');
  const omniboxEnd = browserView.indexOf('</div>', bookmarkButton);
  const managerButton = browserView.indexOf('dataTestId="browser-bookmarks-manager-button"');
  assert.ok(omniboxStart >= 0 && bookmarkButton > omniboxStart && omniboxEnd > bookmarkButton,
    'the page bookmark action must live inside the navigation bar');
  assert.ok(managerButton > omniboxEnd,
    'the separate toolbar bookmark icon must only open the bookmark manager');
});

test('home-page preferences expose Atlas, Bookmarks, custom and blank modes', () => {
  const shared = readFileSync(path.join(repoRoot, 'shared/browser.ts'), 'utf8');
  const quickSettings = readFileSync(path.join(repoRoot, 'src/views/NodusBrowserView.tsx'), 'utf8');
  assert.match(shared, /BrowserHomeMode = 'start' \| 'bookmarks' \| 'blank' \| 'custom'/);
  assert.match(quickSettings, /\['start', 'bookmarks', 'blank', 'custom'\]/);
  assert.match(quickSettings, /Nodus Bookmarks/);
});

test('Browser toolbar orders actions, downloads, restart and settings, with safe clear-all access', () => {
  const browserView = readFileSync(path.join(repoRoot, 'src/views/NodusBrowserView.tsx'), 'utf8');
  const manager = browserView.indexOf('dataTestId="browser-bookmarks-manager-button"');
  const history = browserView.indexOf('dataTestId="browser-history-button"', manager);
  const actions = browserView.indexOf('dataTestId="browser-actions"', history);
  const downloads = browserView.indexOf('dataTestId="browser-downloads"', actions);
  const restart = browserView.indexOf('dataTestId="browser-restart"', downloads);
  const settings = browserView.indexOf('dataTestId="browser-settings"', restart);
  assert.ok(manager >= 0 && history > manager && actions > history && downloads > actions && restart > downloads && settings > restart,
    'the bookmark manager and history must remain separate, followed by actions, downloads, restart and settings');

  const quickComponent = browserView.indexOf('function BrowserQuickSettings');
  const quickSettings = browserView.indexOf('data-testid="browser-quick-settings"', quickComponent);
  const clearAllButton = browserView.indexOf('data-testid="browser-quick-clear-all"', quickSettings);
  const clearAllCall = browserView.indexOf('window.nodus.clearAllBrowserData()', quickComponent);
  const confirmation = browserView.indexOf("title={t('¿Borrar todos los datos de navegación?')}", quickSettings);
  assert.ok(quickComponent >= 0 && quickSettings > quickComponent && clearAllButton > quickSettings
    && clearAllCall > quickComponent && confirmation > quickSettings,
    'quick Browser settings must expose the existing clear-all operation behind a trusted confirmation');
  assert.match(browserView.slice(quickComponent), /setBrowserOverlayVisible\(true\)[\s\S]*setBrowserOverlayVisible\(false\)/,
    'the confirmation must hide and restore the native web view');
  assert.match(browserView.slice(confirmation), /Nodus Bookmarks will be preserved/);
});

test('all bookmark mutations are trusted-UI IPC and the remote preload only permits gesture-gated navigation', () => {
  const ipc = readFileSync(path.join(repoRoot, 'electron/ipc/browser.ts'), 'utf8');
  for (const channel of ['bookmarks:create', 'bookmarks:update', 'bookmarks:delete', 'bookmarks:move', 'bookmarks:previewImport', 'bookmarks:export']) {
    const start = ipc.indexOf(`h('browser:${channel}'`); assert.ok(start >= 0, channel);
    assert.match(ipc.slice(start, start + 500), /assertUiSender\(event, getWindow\)/, channel);
  }
  const remote = readFileSync(path.join(repoRoot, 'electron/preload/browserPage.ts'), 'utf8');
  assert.doesNotMatch(remote, /browser:bookmarks:(?:create|update|delete|move|previewImport|export)/);
  assert.doesNotMatch(remote, /from ['"][^'"]*browserBookmarks['"]/);
  assert.doesNotMatch(remote, /exposeInMainWorld\s*\(/);
  assert.match(remote, /event\.isTrusted !== true/);
  assert.match(remote, /ipcRenderer\.send\('nodus-browser:page:openBookmarks'\)/);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
