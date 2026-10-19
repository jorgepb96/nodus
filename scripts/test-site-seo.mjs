import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSiteMetadata } from './lib/site-metadata.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repoRoot, 'site');
const metadata = loadSiteMetadata(repoRoot);
const isPrerelease = metadata.version.includes('-');

const filesUnder = (directory, predicate = () => true) => {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (predicate(absolute)) files.push(absolute);
    }
  };
  walk(directory);
  return files;
};

const htmlFiles = filesUnder(siteRoot, (file) => file.endsWith('.html'));
const read = (relative) => fs.readFileSync(path.join(siteRoot, relative), 'utf8');
const relativeSitePath = (absolute) => path.relative(siteRoot, absolute).split(path.sep).join('/');

const expectedCanonical = (relative) => {
  if (relative === 'blog/post.html') return `${metadata.siteUrl}/blog/`;
  if (relative.endsWith('/index.html')) return `${metadata.siteUrl}/${relative.slice(0, -'index.html'.length)}`;
  if (relative === 'index.html') return `${metadata.siteUrl}/`;
  return `${metadata.siteUrl}/${relative}`;
};

const jsonLdBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((match) => JSON.parse(match[1]));

test('every public HTML document declares its one clean canonical URL', () => {
  assert.ok(htmlFiles.length >= 25, 'the audit found the published HTML tree');
  for (const file of htmlFiles) {
    const relative = relativeSitePath(file);
    const html = fs.readFileSync(file, 'utf8');
    const canonicals = [...html.matchAll(/<link rel="canonical" href="([^"]+)"\/>/g)].map((match) => match[1]);
    assert.deepEqual(canonicals, [expectedCanonical(relative)], `${relative} has one path-derived canonical`);
    assert.doesNotMatch(canonicals[0], /index\.html|www\.|^http:/, `${relative} uses the canonical host and protocol`);
  }
});

test('all JSON-LD parses and the canonical entities stay consistent', () => {
  for (const file of htmlFiles) {
    const relative = relativeSitePath(file);
    const html = fs.readFileSync(file, 'utf8');
    for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => JSON.parse(match[1]), `${relative} contains valid JSON-LD`);
    }
  }

  const softwareEntities = ['index.html', 'app/index.html', 'cite/index.html'].map((relative) => (
    jsonLdBlocks(read(relative))[0]['@graph'].find((entry) => entry['@id'] === metadata.softwareId)
  ));
  assert.deepEqual(softwareEntities[1], softwareEntities[0], 'the app page reuses the canonical software entity');
  assert.deepEqual(softwareEntities[2], softwareEntities[0], 'the citation page reuses the canonical software entity');

  const homeGraph = jsonLdBlocks(read('index.html'))[0]['@graph'];
  const website = homeGraph.find((entry) => entry['@id'] === metadata.websiteId);
  const software = softwareEntities[0];
  const author = homeGraph.find((entry) => entry['@id'] === metadata.authorId);
  assert.equal(website.name, 'Nodus Research');
  assert.equal(software.name, 'Nodus');
  if (isPrerelease) {
    assert.match(software.softwareVersion, /^\d+\.\d+\.\d+$/, 'a desktop beta does not replace the stable public website release');
  } else {
    assert.equal(software.softwareVersion, metadata.version);
  }
  assert.equal(software.operatingSystem, 'macOS, Windows, Linux');
  assert.equal(software.license, metadata.licenseUrl);
  assert.equal(software.codeRepository, metadata.repository);
  assert.equal(software.identifier.find((item) => item.propertyID === 'Concept DOI').value, metadata.conceptDoi);
  assert.equal(software.identifier.find((item) => item.propertyID === 'Version DOI')?.value, metadata.versionDoi ?? undefined);
  assert.equal(author.url, metadata.orcid);
});

test('release and citation metadata have one generated source of truth', () => {
  if (metadata.versionDoi) assert.notEqual(metadata.conceptDoi, metadata.versionDoi, 'concept and immutable release DOIs stay distinct');
  const citation = fs.readFileSync(path.join(repoRoot, 'CITATION.cff'), 'utf8');
  assert.match(citation, new RegExp(`^version: "${metadata.version.replaceAll('.', '\\.')}"$`, 'm'));
  assert.match(citation, new RegExp(`^date-released: "${metadata.releaseDate}"$`, 'm'));
  assert.match(citation, new RegExp(`^doi: "${metadata.citationDoi.replaceAll('.', '\\.')}"$`, 'm'));

  const publicSoftware = jsonLdBlocks(read('index.html'))[0]['@graph']
    .find((entry) => entry['@id'] === metadata.softwareId);
  const publicVersion = isPrerelease ? publicSoftware.softwareVersion : metadata.version;
  const publicReleaseTag = `v${publicVersion}`;
  for (const relative of ['index.html', 'app/index.html', 'cite/index.html']) {
    assert.ok(read(relative).includes(`"softwareVersion": "${publicVersion}"`), `${relative} has the public softwareVersion`);
    assert.ok(read(relative).includes(`${metadata.repository}/releases/tag/${publicReleaseTag}`), `${relative} has the public release tag`);
    if (isPrerelease) assert.ok(!read(relative).includes(metadata.releaseTag), `${relative} does not advertise a prerelease as stable`);
  }
  const cite = read('cite/index.html');
  for (const value of [publicVersion, publicReleaseTag, metadata.conceptDoi, metadata.versionDoi].filter(Boolean)) {
    assert.ok(cite.includes(value), `/cite/ includes ${value}`);
  }
  assert.match(cite, /generated:citation-formats:start/);
  assert.match(cite, new RegExp(`Version ${publicVersion.replaceAll('.', '\\.')}`));
});

test('public website copy has no stale version, domain or social handles', () => {
  const sources = filesUnder(siteRoot, (file) => /\.(?:html|js|json|md|xml|txt)$/.test(file))
    .filter((file) => !file.includes(`${path.sep}assets${path.sep}fonts${path.sep}`))
    .filter((file) => relativeSitePath(file) !== 'data/announcements.json');
  const combined = sources.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(combined, /\bNodus 4(?:\b|\.)/, 'current public copy is not branded as Nodus 4');
  assert.doesNotMatch(combined, /\bNodus [0-4]\.\d+(?:\.\d+)?\b|\bNodus 5\.0\.[01]\b/, 'current public copy has no obsolete release number');
  assert.doesNotMatch(combined, /drakonis96\.github\.io\/nodus/i, 'the legacy Pages domain is gone');
  assert.doesNotMatch(combined, /(?:twitter|x)\.com\/[A-Za-z0-9_]+/i, 'no obsolete social handle is published');
});

test('high-value pages use the 1200x630 social preview instead of a favicon', () => {
  const highValue = [
    'index.html',
    'about/index.html',
    'app/index.html',
    'research/index.html',
    'zotero/index.html',
    'zotero-plugin/index.html',
    'ai-research/index.html',
    'open-source/index.html',
    'cite/index.html',
    'blog/index.html',
  ];
  for (const relative of highValue) {
    const html = read(relative);
    assert.match(html, new RegExp(`<meta property="og:image" content="${metadata.socialImage.replaceAll('.', '\\.')}"\\/>`), `${relative} uses the social image`);
    assert.match(html, /<meta property="og:image:width" content="1200"\/>/);
    assert.match(html, /<meta property="og:image:height" content="630"\/>/);
    assert.match(html, /<meta property="og:image:alt" content="[^"]+"\/>/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image"\/>/);
    assert.match(html, /<meta name="twitter:image" content="https:\/\/nodusresearch\.com\/assets\/social\/nodus-research-og\.png"\/>/);
    assert.doesNotMatch(html, /(?:og:image|twitter:image)" content="https:\/\/nodusresearch\.com\/favicon/);
  }

  const image = fs.readFileSync(path.join(siteRoot, 'assets/social/nodus-research-og.png'));
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});

test('robots keeps redirects crawlable and advertises the canonical sitemap', () => {
  const robots = read('robots.txt');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.doesNotMatch(robots, /^Disallow: .*index\.html/m);
  assert.doesNotMatch(robots, /^Disallow: \/\s*$/m);
  assert.match(robots, /^Sitemap: https:\/\/nodusresearch\.com\/sitemap\.xml$/m);
});

test('every local HTML link and asset target exists in the generated site', () => {
  for (const file of htmlFiles) {
    const relative = relativeSitePath(file);
    const html = fs.readFileSync(file, 'utf8');
    const canonical = expectedCanonical(relative);
    const baseHref = html.match(/<base href="([^"]+)"\/>/)?.[1];
    const base = baseHref ? new URL(baseHref, canonical) : new URL(canonical);
    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const value = match[1];
      if (!value || value.startsWith('#') || /^(?:mailto:|tel:|data:|javascript:|\/\/)/i.test(value)) continue;
      const resolved = new URL(value, base);
      if (resolved.origin !== metadata.siteUrl) continue;
      const pathname = decodeURIComponent(resolved.pathname);
      const target = pathname.endsWith('/')
        ? path.join(siteRoot, pathname, 'index.html')
        : path.join(siteRoot, pathname);
      assert.ok(fs.existsSync(target), `${relative} links to missing local target ${pathname}`);
    }
  }
});
