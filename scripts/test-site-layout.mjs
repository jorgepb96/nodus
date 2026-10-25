import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repoRoot, 'site');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('the public website is isolated from repository documentation', () => {
  for (const relative of [
    '.nojekyll',
    'CNAME',
    'index.html',
    'faq.js',
    'i18n-complete.js',
    'nodi.js',
    'nodi-widget.css',
    'nodi-widget.js',
    'site-header.css',
    'site-header.js',
    'site-footer.js',
    'tutorials.json',
    'assets/nodus-logo.svg',
    'data/github-release-downloads.json',
    'demo/index.html',
  ]) {
    assert.ok(fs.existsSync(path.join(siteRoot, relative)), `site/${relative} exists`);
  }

  for (const formerSiteEntry of [
    '.nojekyll',
    'index.html',
    'faq.js',
    'i18n-complete.js',
    'nodi.js',
    'nodi-widget.css',
    'nodi-widget.js',
    'tutorials.json',
    'assets',
    'data',
    'demo',
  ]) {
    assert.ok(
      !fs.existsSync(path.join(repoRoot, 'docs', formerSiteEntry)),
      `docs/${formerSiteEntry} is reserved for repository documentation`,
    );
  }
});

test('every static HTML link resolves inside the website tree', () => {
  const htmlFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.name.endsWith('.html')) htmlFiles.push(absolute);
    }
  };
  visit(siteRoot);

  for (const htmlFile of htmlFiles) {
    const source = fs.readFileSync(htmlFile, 'utf8');
    const baseHref = source.match(/<base\s+href="([^"]+)"/i)?.[1];
    const referenceBase = baseHref
      ? path.resolve(path.dirname(htmlFile), baseHref)
      : path.dirname(htmlFile);
    const sourceWithoutBase = source.replace(/<base\s+href="[^"]+"[^>]*>/i, '');
    const references = [...sourceWithoutBase.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
    for (const reference of references) {
      if (
        !reference
        || reference.startsWith('#')
        || reference.startsWith('//')
        || reference.includes('${')
        || /^[a-z][a-z\d+.-]*:/i.test(reference)
      ) continue;

      const pathname = reference.split(/[?#]/, 1)[0];
      if (!pathname) continue;
      const resolved = pathname.startsWith('/')
        ? path.resolve(siteRoot, `.${pathname}`)
        : path.resolve(referenceBase, pathname);
      assert.ok(
        resolved === siteRoot || resolved.startsWith(`${siteRoot}${path.sep}`),
        `${path.relative(repoRoot, htmlFile)} keeps ${reference} inside site/`,
      );
      const target = pathname.endsWith('/') ? path.join(resolved, 'index.html') : resolved;
      assert.ok(
        fs.existsSync(target),
        `${path.relative(repoRoot, htmlFile)} references existing ${reference}`,
      );
    }
  }
});

test('the dedicated Pages worker owns the website and its scheduled cache refresh', () => {
  const pagesWorkflow = read('.github/workflows/pages.yml');
  const releaseWorkflow = read('.github/workflows/release.yml');

  assert.match(pagesWorkflow, /run:\s*npm run site:artifact/);
  assert.match(pagesWorkflow, /path:\s*pages-artifact\b/);
  assert.match(pagesWorkflow, /ref:\s*main\b/, 'every Pages event deploys the canonical branch');
  assert.doesNotMatch(pagesWorkflow, /ref:\s*\$\{\{.*github\.ref/, 'manual runs cannot publish a legacy branch');
  assert.match(pagesWorkflow, /actions\/deploy-pages@v5/);
  assert.match(pagesWorkflow, /node scripts\/github-release-downloads\.mjs/);
  assert.match(pagesWorkflow, /schedule:\s*\n(?:\s*#.*\n)*\s*- cron: '[^']+'/, 'the download counters refresh daily');
  const push = pagesWorkflow.match(/\n  push:\n    branches: \[main\]\n    paths:\n((?:\s+(?:#.*|- '[^']+')\n)+)/);
  assert.ok(push, 'a merge into main that changes the site deploys it without a manual run');
  for (const file of ['site/**', 'scripts/build-blog-pages.mjs', 'scripts/build-blog-feed.mjs',
    'scripts/build-site-metadata.mjs', 'scripts/build-sitemap.mjs', 'scripts/build-pages-artifact.mjs',
    'scripts/github-release-downloads.mjs', 'scripts/lib/site-metadata.mjs', 'package.json', 'CITATION.cff']) {
    assert.ok(push[1].includes(`- '${file}'`), `${file} feeds the deployed site, so changing it must redeploy`);
  }
  assert.doesNotMatch(pagesWorkflow, /git push|git commit/, 'generated data must not bypass the CLA gate on main');
  assert.doesNotMatch(pagesWorkflow, /repos\/\$\{GITHUB_REPOSITORY\}\/pages/);
  assert.doesNotMatch(releaseWorkflow, /pages\/builds|github-release-downloads|docs\/data\//);
});
