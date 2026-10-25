import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repoRoot, 'site');
const read = (relative) => fs.readFileSync(path.join(siteRoot, relative), 'utf8');
const graph = (relative) => JSON.parse(
  read(relative).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1],
)['@graph'];

test('project and application remain distinct in structured data', () => {
  const home = graph('index.html');
  const website = home.find((entry) => entry['@type'] === 'WebSite');
  const software = home.find((entry) => entry['@type'] === 'SoftwareApplication');

  assert.equal(website.name, 'Nodus Research');
  assert.deepEqual(website.alternateName, ['nodusresearch.com']);
  assert.equal(software.name, 'Nodus');
  assert.equal(Object.hasOwn(software, 'alternateName'), false);
  assert.equal(software.isPartOf['@id'], website['@id']);

  for (const page of ['app/index.html', 'cite/index.html']) {
    const app = graph(page).find((entry) => entry['@type'] === 'SoftwareApplication');
    assert.equal(app.name, 'Nodus', `${page} uses the application name`);
    assert.equal(Object.hasOwn(app, 'alternateName'), false, `${page} does not claim the project name as an app alias`);
  }
});

test('public identity copy records independence and current status', () => {
  const home = read('index.html');
  const about = read('about/index.html');

  for (const [page, html] of [['home', home], ['About', about]]) {
    assert.match(html, /personal, independent open-source project/i, `${page} states the project's nature and independence`);
    assert.match(html, /sells no product or service/i, `${page} states that there is no current commercial offer`);
  }
  assert.match(about, /not affiliated with, sponsored by or endorsed by any university, research group, company or other software project/i);
  assert.match(about, /AGPL-3\.0-only governs reuse and redistribution by others/i);
});

test('the generic legal notice is transparent but excluded from search results', () => {
  const legal = read('legal/index.html');
  const sitemap = read('sitemap.xml');

  assert.match(legal, /<meta name="robots" content="noindex, follow, noarchive"\/>/);
  assert.match(legal, /not affiliated with, sponsored by or endorsed by any university, research group, company or other software project/i);
  assert.match(legal, /does not represent Nodus Research as a company, university department or academic research group/);
  assert.match(legal, /This status is separate from the software licence/);
  assert.doesNotMatch(sitemap, /\/legal\//, 'a noindex legal notice is not placed in the sitemap');
});

test('site footers preserve the independence statement and legal notice', () => {
  const pages = [
    'index.html',
    'about/index.html',
    'app/index.html',
    'apps/index.html',
    'cite/index.html',
    'research/index.html',
    'zotero/index.html',
    'ai-research/index.html',
    'open-source/index.html',
    'research-atlas/index.html',
    'contribute/index.html',
    'faq/index.html',
    'models/index.html',
    'blog/index.html',
  ];

  for (const page of pages) {
    const html = read(page);
    assert.match(html, /A personal, independent open-source project\./, `${page} carries the footer identity`);
    assert.match(html, />Legal notice<\/a>/, `${page} links the legal notice`);
  }
});

test('the repository keeps its identity generic and makes no public donation solicitation', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const notice = fs.readFileSync(path.join(repoRoot, 'NAME_NOTICE.md'), 'utf8');
  const publicIdentity = `${readme}\n${notice}\n${read('index.html')}\n${read('about/index.html')}`;

  assert.doesNotMatch(publicIdentity, /(?:®|™)/);
  assert.doesNotMatch(readme, /paypal\.me|ko-fi\.com/i);
  assert.match(readme, /personal, independent open-source project/i);
  assert.match(notice, /Nodus Research is independent/);
});
