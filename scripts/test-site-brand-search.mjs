import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repoRoot, 'site');
const read = (relative) => fs.readFileSync(path.join(siteRoot, relative), 'utf8');
const jsonLd = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

test('About establishes the Nodus Research entity without targeting unrelated names', () => {
  const html = read('about/index.html');
  assert.match(html, /<title>About Nodus Research \| Independent Open Source Project<\/title>/);
  assert.match(html, /<h1[^>]*>About Nodus Research<\/h1>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/nodusresearch\.com\/about\/"\/>/);
  assert.match(html, /<meta property="og:site_name" content="Nodus Research"\/>/);
  assert.match(html, /Nodus Research is a personal, independent open-source project/);
  assert.match(html, /not a company, university department or academic research group/i);
  assert.match(html, /currently sells no product or service/i);
  assert.match(html, /not affiliated with, sponsored by or endorsed by any university/i);
  const graph = jsonLd(html)['@graph'];
  assert.ok(graph.some((entry) => entry['@type'] === 'AboutPage'));
  const project = graph.find((entry) => entry['@type'] === 'Project');
  assert.equal(project['@id'], 'https://nodusresearch.com/#project');
  assert.equal(project.name, 'Nodus Research');
  assert.deepEqual(project.alternateName, ['nodusresearch.com']);
  assert.ok(project.sameAs.includes('https://github.com/jorgepb96/nodus'));
  assert.ok(project.sameAs.includes('https://doi.org/10.5281/zenodo.21515531'));
  assert.ok(graph.some((entry) => entry['@type'] === 'FAQPage'));
});

test('the three brand queries have one clear landing page each', () => {
  const home = read('index.html');
  const app = read('app/index.html');
  const apps = read('apps/index.html');

  assert.match(home, /<title>Nodus Research \| Open Source Research Workspace<\/title>/);
  assert.match(home, /<h1 class="hero-name">Nodus Research<\/h1>/);
  assert.match(app, /<title>Nodus App \| Open Source Research Software<\/title>/);
  assert.match(app, /<h1[^>]*>The Nodus App<\/h1>/);
  assert.match(app, /href="\.\.\/apps\/">Explore Nodus Apps<\/a>/);
  assert.match(apps, /<title>Nodus Apps \| Build Local Research and Teaching Tools<\/title>/);
  assert.match(apps, /<h1[^>]*>Nodus Apps<\/h1>/);
  assert.match(apps, /Nodus Apps is not a separate mobile app or subscription service/);
  assert.match(apps, /included in the free Nodus desktop application/);
});

test('Nodus Apps is documented as a real, bounded product feature', () => {
  const html = read('apps/index.html');
  for (const term of ['Research', 'Teaching', 'Study', 'Brainstorm', 'Options wheel', 'Topic distributor', 'Sandboxed execution', 'Temporary participation', 'Exportable source']) {
    assert.match(html, new RegExp(term), `${term} is explained on the Nodus Apps page`);
  }
  const graph = jsonLd(html)['@graph'];
  const software = graph.find((entry) => entry['@type'] === 'SoftwareApplication');
  assert.equal(software.name, 'Nodus Apps');
  assert.equal(software.isPartOf['@id'], 'https://nodusresearch.com/#software');
  assert.equal(software.isPartOf.name, 'Nodus');
});

test('the shared navigation leaves About to the footer and the high-authority pages still point at the entity pages', () => {
  const header = read('site-header.js');
  assert.doesNotMatch(header, /id: 'about'/, 'About is a footer destination, not a header tab');
  for (const [page, hrefs] of [
    ['index.html', ['about/', 'apps/']],
    ['app/index.html', ['../about/', '../apps/']],
    ['cite/index.html', ['../about/', '../apps/']],
    ['blog/index.html', ['../about/', '../apps/']],
  ]) {
    const html = read(page);
    for (const href of hrefs) assert.ok(html.includes(`href="${href}"`), `${page} links to ${href}`);
  }
});
