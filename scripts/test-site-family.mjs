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
