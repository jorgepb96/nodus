// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The site is the home of the Nodus family: a front page at /, Nodus Research
// at /nodus/, and one page per app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertLocalReferencesResolve } from './lib/site-links.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repoRoot, 'site');
const read = (relative) => fs.readFileSync(path.join(siteRoot, relative), 'utf8');
const canonical = (html) => html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(absolute);
    return /\.(html|js)$/.test(entry.name) ? [absolute] : [];
  });
}

test('the Nodus Research page lives at /nodus/ and its links resolve', () => {
  assert.ok(fs.existsSync(path.join(siteRoot, 'nodus/index.html')), 'site/nodus/index.html exists');
  const page = read('nodus/index.html');
  assert.equal(canonical(page), 'https://nodusresearch.com/nodus/');
  assert.match(page, /data-nodus-site-header data-base="\.\.\/" data-page="nodus"/);
  assertLocalReferencesResolve('site/nodus/index.html');
});

test('no page links to homepage-only anchors at the root', () => {
  const rootAnchor = /href="(?:\.\/|(?:\.\.\/)+|\/)#(?:vaults|more-vaults|tools|what-nodus-is)"/;
  const offenders = htmlFiles(siteRoot)
    .filter((file) => !file.startsWith(path.join(siteRoot, 'nodus') + path.sep))
    .filter((file) => rootAnchor.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(siteRoot, file));
  assert.deepEqual(offenders, []);
});

test('the family stylesheet frames phones the way home.css frames windows', () => {
  const css = read('assets/css/family.css');
  for (const selector of ['.phone ', '.phone .shot img', '.phone .shots::before', '.phone-still', '.family-mobile', '.app-card', '.app-mark']) {
    assert.ok(css.includes(selector), `family.css styles ${selector.trim()}`);
  }
  assert.match(css, /@media \(max-width: 700px\)/, 'phones shrink on small screens');
  assert.match(css, /\.family-mobile \{ grid-template-columns: minmax\(0, 1fr\); \}/, 'the mobile cards stack below 900px');
});

const APP_PAGES = [
  { slug: 'imago', page: 'imago' },
  { slug: 'link', page: 'mobile' },
  { slug: 'reader', page: 'mobile' },
  { slug: 'presenter', page: 'mobile' },
  { slug: 'drift', page: 'mobile' },
];
const metaContent = (html, name) => html.match(new RegExp(`<meta (?:name|property)="${name}" content="([^"]+)"`))?.[1];

for (const { slug, page } of APP_PAGES) {
  test(`app page ${slug}`, () => {
    const relative = `${slug}/index.html`;
    assert.ok(fs.existsSync(path.join(siteRoot, relative)), `site/${relative} exists`);
    const html = read(relative);
    assert.equal(canonical(html), `https://nodusresearch.com/${slug}/`);
    assert.equal(metaContent(html, 'og:url'), `https://nodusresearch.com/${slug}/`);
    assert.match(html, new RegExp(`data-nodus-site-header data-base="\\.\\./" data-page="${page}"`));
    assert.match(html, /href="\.\.\/assets\/css\/family\.css\?v=/);
    assert.ok(html.includes('<canvas id="organism" aria-hidden="true"></canvas>'));
    assert.ok(fs.existsSync(path.join(siteRoot, 'assets/social', `${slug}-og.jpg`)), 'its social image exists');
    assertLocalReferencesResolve(`site/${relative}`);
  });
}

test('every family page has its own title and description', () => {
  const pages = ['index.html', 'nodus/index.html', ...APP_PAGES.map(({ slug }) => `${slug}/index.html`)];
  const titles = pages.map((relative) => read(relative).match(/<title>([^<]+)<\/title>/)?.[1]);
  const descriptions = pages.map((relative) => metaContent(read(relative), 'description'));
  assert.equal(new Set(titles).size, pages.length, 'titles are unique');
  assert.equal(new Set(descriptions).size, pages.length, 'descriptions are unique');
});

test('the App Store privacy pages are still published', () => {
  for (const slug of ['drift', 'link', 'presenter', 'reader']) {
    assert.ok(fs.existsSync(path.join(siteRoot, slug, 'privacy/index.html')), `site/${slug}/privacy/ exists`);
  }
});

test('front page presents the family', () => {
  const home = read('index.html');
  assert.match(home, /id="desktop"/);
  assert.match(home, /id="mobile"/);
  for (const slug of ['nodus', 'imago', 'link', 'reader', 'presenter', 'drift']) {
    assert.ok(home.includes(`href="${slug}/"`), `the front page links to /${slug}/`);
  }
  assert.match(home, /"@type": "WebSite"/);
  assertLocalReferencesResolve('site/index.html');
});

test('the header and the footers lead to every app', () => {
  const header = read('site-header.js');
  const destinations = [...header.matchAll(/\{ id: '([a-z]+)', label: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(destinations.slice(0, 3), ['nodus', 'imago', 'mobile']);
  assert.match(header, /href: \(base\) => `\$\{base\}#mobile`/);
  const footers = [read('site-footer.js'), read('index.html'), read('nodus/index.html')];
  for (const footer of footers) {
    for (const slug of ['nodus', 'imago', 'link', 'reader', 'presenter', 'drift']) {
      assert.match(footer, new RegExp(`href="(?:\\$\\{base\\}|\\.\\./)?${slug}/">Nodus `), `footer links to ${slug}`);
    }
  }
});

test('the sitemap lists the front page, Nodus Research and every app page', () => {
  const sitemap = read('sitemap.xml');
  for (const url of ['/', '/nodus/', '/imago/', '/link/', '/reader/', '/presenter/', '/drift/']) {
    assert.ok(sitemap.includes(`<loc>https://nodusresearch.com${url}</loc>`), `sitemap lists ${url}`);
  }
});

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'filter', 'use', 'symbol', 'pattern', 'text', 'tspan', 'title', 'desc', 'animate', 'animatetransform']);
function unbalancedTags(html) {
  const stack = [];
  const problems = [];
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  for (const [, closing, name, selfClosing] of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
    const tag = name.toLowerCase();
    if (VOID_TAGS.has(tag) || SVG_TAGS.has(tag) || tag.startsWith('fe') || selfClosing) continue;
    if (!closing) stack.push(tag);
    else if (stack.at(-1) === tag) stack.pop();
    else problems.push(`</${tag}> closes <${stack.at(-1)}>`);
  }
  return [...problems, ...stack.filter((tag) => !['html', 'head', 'body'].includes(tag)).map((tag) => `<${tag}> never closes`)];
}

test('every family page closes the elements it opens', () => {
  for (const relative of ['index.html', 'nodus/index.html', ...APP_PAGES.map(({ slug }) => `${slug}/index.html`)]) {
    assert.deepEqual(unbalancedTags(read(relative)), [], `${relative} is well formed`);
  }
});

test('the front page offers desktop, mobile and plugin downloads, each in its own dialog', () => {
  const home = read('index.html');
  const triggers = [...home.matchAll(/data-download="([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(triggers, ['dl-overlay', 'mobile', 'plugins']);
  assert.match(home, /<div class="dl-overlay" id="dl-overlay">/, 'the default dialog keeps the id the header chip opens');
  assert.match(home, /<div class="dl-overlay" id="dl-mobile" data-dialog="mobile">/);
  assert.match(home, /<div class="dl-overlay" id="dl-plugins" data-dialog="plugins">/);
  for (const asset of ['Nodus-Imago-mac-arm64.dmg', 'Nodus-Imago-mac-x64.dmg', 'Nodus-Imago-win-x64.exe', 'Nodus-Imago-linux-x86_64.AppImage', 'Nodus-Imago-linux-amd64.deb', 'Nodus-Imago-linux-x86_64.rpm']) {
    assert.match(home, new RegExp(`data-repo="jorgepb96/nodus-imago" data-asset="${asset.replaceAll('.', '\\.')}"`), `the desktop dialog offers ${asset}`);
  }
  for (const href of ['https://apps.apple.com/us/app/nodus-presenter/id6818107823', 'https://testflight.apple.com/join/SjCk8AZ1', 'https://testflight.apple.com/join/kAXnsjJS', 'nodus-zotero.xpi', 'chromewebstore.google.com']) {
    assert.ok(home.includes(href), `a dialog links to ${href}`);
  }
});

test('site.js opens named dialogs and only lets the header chip use the default one', () => {
  const site = read('assets/js/site.js');
  assert.match(site, /document\.querySelectorAll\('\.dl-overlay'\)/);
  assert.match(site, /find\(trigger\.dataset\.download\)\.open\(\)/);
  assert.match(site, /if \(dialogs\.has\('dl-overlay'\)\) window\.openDl =/);
  assert.match(site, /data-repo/);
});

const PAGE_GLYPHS = { 'index.html': 'n', 'imago/index.html': 'i', 'link/index.html': 'l', 'reader/index.html': 'r', 'presenter/index.html': 'p', 'drift/index.html': 'd' };

function loadGlyphs() {
  const source = read('assets/js/organism.js');
  const start = source.indexOf('  const STROKE_HALF');
  const end = source.indexOf('  /* ------------------------------------------------------------ the organism */');
  // eslint-disable-next-line no-new-func
  return new Function(`${source.slice(start, end)}; return { glyphPoints, GLYPHS };`)();
}

test('every app letter is drawn in the logo language, inside the area the N uses', () => {
  const { glyphPoints, GLYPHS } = loadGlyphs();
  assert.deepEqual(Object.keys(GLYPHS).sort(), ['d', 'i', 'l', 'n', 'p', 'r']);
  for (const name of Object.keys(GLYPHS)) {
    const points = glyphPoints(900, name);
    assert.ok(points.length > 600, `${name} has enough points to read as a letter`);
    assert.ok(points.some((point) => point[2] === 1), `${name} ends in the logo's discs`);
    for (const [x, y] of points) {
      assert.ok(x >= -0.32 && x <= 0.32 && y >= -0.36 && y <= 0.36, `${name} stays inside the N's area`);
    }
  }
  assert.deepEqual(glyphPoints(900, 'unknown'), glyphPoints(900, 'n'), 'an unknown letter falls back to the N');
});

test('each family page opens with its own letter', () => {
  const nodus = read('nodus/index.html');
  assert.match(nodus, /<body data-formation="on">/, '/nodus/ keeps the N, the default');
  for (const [relative, glyph] of Object.entries(PAGE_GLYPHS)) {
    const html = read(relative);
    assert.match(html, new RegExp(`<body data-formation="on" data-glyph="${glyph}">`), `${relative} forms "${glyph}"`);
    assert.match(html, /root\.classList\.add\('intro-armed'\)/, `${relative} arms the opening`);
    assert.match(html, /assets\/js\/home\.js\?v=/, `${relative} loads the opening sequence`);
  }
});

test('each launcher icon leads to its app', () => {
  const home = read('index.html');
  const icons = home.slice(home.indexOf('<div class="launchers">'), home.indexOf('<p class="meta">'));
  for (const [slug, page] of [['research', 'nodus/'], ['imago', 'imago/'], ['link', 'link/'], ['reader', 'reader/'], ['presenter', 'presenter/'], ['drift', 'drift/']]) {
    assert.match(icons, new RegExp(`<a class="icon-link" href="${page}"><img class="app-icon" src="assets/family/icons/${slug}\\.webp`), `the ${slug} icon links to /${page}`);
  }
  assert.match(icons, /<a class="icon-link" href="zotero-plugin\/" aria-label="Zotero plugin">/);
  assert.match(icons, /<a class="icon-link" href="https:\/\/chromewebstore\.google\.com\/detail\/[^"]+" target="_blank" rel="noopener" aria-label="Chrome extension on the Chrome Web Store">/);
  assert.match(read('assets/css/family.css'), /\.launcher-icons \{[^}]*justify-content: center;/);
});
