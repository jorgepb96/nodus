// Screenshot the Nodus Bookmarks sort popover and favourite stars, from the real
// component and its real stylesheets, without booting Electron or a vault.
//
// Captures: the page in its default order (newest first) with two starred cards;
// the sort popover open; "Favorites only" after a click on a real star, which must
// add that bookmark to the list; the list view; and a narrow window.
//
// Output goes to $OUT (default /tmp).
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const OUT = process.env.OUT ?? '/tmp';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-bookmarks-sort-'));
// The app's own compiled stylesheet goes first, as in the app: its Tailwind
// preflight (border-box sizing above all) is what the page is laid out against.
execFileSync(path.join(repoRoot, 'node_modules/.bin/tailwindcss'),
  ['-i', 'src/index.css', '-o', path.join(tmp, 'app.css'), '--minify'],
  { cwd: repoRoot, stdio: 'inherit' });
const appCss = await readFile(path.join(tmp, 'app.css'), 'utf8');
await build({
  entryPoints: [path.join(repoRoot, 'visual-tests/bookmarks-sort-harness.tsx')],
  outfile: path.join(tmp, 'page.js'),
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@shared': path.join(repoRoot, 'shared') },
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl', '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
  logLevel: 'error',
});
// The component imports NodusBookmarks.css, which pulls in the public Atlas sheet:
// esbuild emits both, bundled, as page.css beside the script.
const css = await readFile(path.join(tmp, 'page.css'), 'utf8');
// Inline, as a module script loaded by src= is refused on file://.
const js = (await readFile(path.join(tmp, 'page.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
const page = path.join(tmp, 'page.html');
await writeFile(page, `<!doctype html>
<html lang="es"><head><meta charset="UTF-8" /><title>Nodus Bookmarks sort</title>
<style>${appCss}</style><style>${css}</style><style>html, body { margin: 0; background: #08060f; }</style>
</head><body><div id="root"></div><script type="module">${js}</script></body></html>`);

const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: CHROME });
const tab = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const failures = [];
tab.on('pageerror', (error) => failures.push(error.message));

const titles = () => tab.locator('.bookmark-card h2 button').allTextContents();
const shot = async (file) => {
  await tab.screenshot({ path: path.join(OUT, file) });
  console.log('[shot]', path.join(OUT, file));
};
const expectTitles = async (expected, why) => {
  const actual = await titles();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${why}: ${JSON.stringify(actual)}`);
};

await tab.goto(`file://${page}`, { waitUntil: 'load' });
await tab.locator('[data-testid="browser-bookmarks-sort"]').waitFor();
// Bring the search bar just under the fixed site header, so the action row, the
// sort pill and the first cards share one frame.
const frame = () => tab.evaluate(() => {
  const scroller = document.querySelector('.nodus-start-page');
  const search = document.querySelector('.atlas-searchbar');
  if (scroller && search) scroller.scrollTop += search.getBoundingClientRect().top - 110;
});
await frame();
await expectTitles(['arXiv', 'Revistas', 'JSTOR', 'Biblioteca Digital Hispánica', 'Archivos nacionales', 'Europeana'], 'default order is newest first');
if (await tab.locator('.atlas-access').count() !== 0) throw new Error('a card still shows the Saved tag');
await shot('marcadores-orden-por-defecto.png');

await tab.locator('[data-testid="browser-bookmarks-sort"]').click();
await tab.locator('[data-testid="browser-bookmarks-sort-menu"]').waitFor();
await frame();
await shot('marcadores-orden-globito.png');

await tab.locator('[data-sort="alpha"]').click();
await expectTitles(['Archivos nacionales', 'arXiv', 'Biblioteca Digital Hispánica', 'Europeana', 'JSTOR', 'Revistas'], 'A-Z interleaves folders and bookmarks');

// Star arXiv through the real button, then look at favourites only.
await tab.locator('.bookmark-card', { hasText: 'arXiv' }).locator('[data-testid="browser-bookmark-favorite"]').click();
await tab.locator('[data-testid="browser-bookmarks-sort"]').click();
await tab.locator('[data-sort="favorites-only"]').click();
await expectTitles(['arXiv', 'Europeana', 'JSTOR', 'PARES'], 'favourites only spans the collection, A-Z');
await frame();
await shot('marcadores-solo-favoritos.png');

// List view: the same items, one row each, and the choice survives a reload.
await tab.locator('[data-testid="browser-bookmarks-sort"]').click();
await tab.locator('[data-sort="recent"]').click();
await tab.locator('[data-testid="browser-bookmarks-view"] [data-view="list"]').click();
await tab.locator('[data-testid="browser-bookmarks-list"]').waitFor();
await expectTitles(['arXiv', 'Revistas', 'JSTOR', 'Biblioteca Digital Hispánica', 'Archivos nacionales', 'Europeana'], 'the list keeps the chosen order');
const rows = await tab.locator('.bookmark-list .bookmark-card').evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().height)));
if (rows.some((height) => height > 80)) throw new Error(`a list row is as tall as a card: ${rows}`);
// Folder rows carry fewer actions than website rows; the shared columns must still line up.
const columns = await tab.locator('.bookmark-list .bookmark-card .atlas-geo').evaluateAll((cells) => [...new Set(cells.map((cell) => Math.round(cell.getBoundingClientRect().left)))]);
if (columns.length !== 1) throw new Error(`the address column is ragged: ${columns}`);
await frame();
await shot('marcadores-lista.png');

// A narrow window: the action row wraps rather than squeezing the sort pill.
await tab.setViewportSize({ width: 820, height: 900 });
await frame();
const pill = await tab.locator('[data-testid="browser-bookmarks-sort"]').evaluate((button) => button.scrollWidth <= button.clientWidth + 1);
if (!pill) throw new Error('the sort pill is clipped in a narrow window');
await shot('marcadores-ventana-estrecha.png');

await tab.setViewportSize({ width: 560, height: 900 });
await frame();
await shot('marcadores-lista-movil.png');

await browser.close();
await rm(tmp, { recursive: true, force: true });
if (failures.length) throw new Error(`page errors:\n${failures.join('\n')}`);
