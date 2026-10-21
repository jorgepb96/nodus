import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readRepo = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const readSite = (relative) => readRepo(path.join('site', relative));
const pkg = JSON.parse(readRepo('package.json'));

const CONCEPT_DOI = '10.5281/zenodo.21515531';
const VERSION_DOI = pkg.releaseMetadata.versionDoi;
const CITATION_DOI = VERSION_DOI || CONCEPT_DOI;

test('CITATION.cff describes the current Nodus release and its project identity', () => {
  const citation = readRepo('CITATION.cff');

  assert.match(citation, new RegExp(`version: "${pkg.version.replaceAll('.', '\\.') }"`));
  assert.match(citation, new RegExp(`doi: "${CITATION_DOI.replaceAll('.', '\\.')}"`));
  assert.match(citation, new RegExp(`concept DOI is\\s+#?\\s*${CONCEPT_DOI.replaceAll('.', '\\.')}`));
  assert.match(citation, /Nodus is the open-source desktop application developed by the Nodus\s+Research project\./);
  for (const keyword of ['Nodus Research', 'research software', 'academic research', 'Zotero', 'local-first', 'knowledge graph', 'evidence', 'research workspace']) {
    assert.ok(citation.includes(`- "${keyword}"`), `CITATION.cff includes ${keyword}`);
  }
});

test('the citation page identifies the current version and its DOI state', () => {
  const page = readSite('cite/index.html');
  const prerelease = pkg.version.includes('-');
  const publicVersion = prerelease
    ? page.match(/Nodus (\d+\.\d+\.\d+) · archive pending/)?.[1]
    : pkg.version;

  assert.match(page, /<title>Cite Nodus Research \| DOI and Software Citation<\/title>/);
  assert.match(page, /<h1[^>]*>Cite Nodus Research<\/h1>/);
  assert.match(page, /rel="canonical" href="https:\/\/nodusresearch\.com\/cite\/"/);
  assert.match(page, new RegExp(CONCEPT_DOI.replaceAll('.', '\\.')));
  assert.ok(publicVersion, 'the citation page identifies its stable public version');
  if (VERSION_DOI && !prerelease) {
    assert.match(page, new RegExp(VERSION_DOI.replaceAll('.', '\\.')));
    assert.match(page, new RegExp(`Nodus ${publicVersion.replaceAll('.', '\\.')} · version DOI`));
  } else {
    assert.match(page, new RegExp(`Nodus ${publicVersion.replaceAll('.', '\\.')} · archive pending`));
    assert.match(page, /Version DOI pending/);
  }
  assert.match(page, new RegExp(`releases/tag/v${publicVersion.replaceAll('.', '\\.')}`));
  if (prerelease) assert.ok(!page.includes(pkg.version), 'a desktop beta does not replace the stable citation page');
  for (const detail of ['APA', 'BibTeX', 'CITATION.cff', 'ORCID', 'AGPL-3.0-only', 'Zenodo', 'GitHub']) {
    assert.ok(page.includes(detail), `the citation page includes ${detail}`);
  }
});

test('project-level metadata uses the conceptual DOI consistently', () => {
  for (const relative of ['site/index.html', 'site/app/index.html', 'README.md']) {
    const source = readRepo(relative);
    assert.ok(source.includes(CONCEPT_DOI), `${relative} includes the conceptual DOI`);
  }

  const sitemap = readSite('sitemap.xml');
  assert.match(sitemap, /<loc>https:\/\/nodusresearch\.com\/cite\/<\/loc>/);
});

test('the citation page is linked from each standard project footer', () => {
  const pages = [
    'index.html',
    'app/index.html',
    'ai-research/index.html',
    'contribute/index.html',
    'faq/index.html',
    'models/index.html',
    'open-source/index.html',
    'research-atlas/index.html',
    'research/index.html',
    'zotero/index.html',
    'zotero-plugin/index.html',
    'blog/index.html',
  ];

  for (const relative of pages) {
    assert.match(readSite(relative), /<a href="(?:\.\.\/)?cite\/">Cite Nodus<\/a>/, `${relative} links to /cite/`);
  }
});
