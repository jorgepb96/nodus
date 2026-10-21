// Regenerate site/sitemap.xml from the static pages of the site.
// Dates come from the content that owns each URL, never from build time.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSiteMetadata } from './lib/site-metadata.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const STATIC_PAGES = [
  { file: 'index.html', url: '/', sources: ['site/index.html', 'package.json', 'scripts/build-site-metadata.mjs'] },
  { file: 'about/index.html', url: '/about/', sources: ['site/about/index.html'] },
  { file: 'research-atlas/index.html', url: '/research-atlas/', sources: ['site/research-atlas/index.html', 'site/data/research-atlas.json', 'site/assets/js/research-atlas.js'] },
  { file: 'app/index.html', url: '/app/', sources: ['site/app/index.html', 'package.json', 'scripts/build-site-metadata.mjs'] },
  { file: 'apps/index.html', url: '/apps/', sources: ['site/apps/index.html'] },
  { file: 'research/index.html', url: '/research/', sources: ['site/research/index.html'] },
  { file: 'zotero/index.html', url: '/zotero/', sources: ['site/zotero/index.html'] },
  { file: 'zotero-plugin/index.html', url: '/zotero-plugin/', sources: ['site/zotero-plugin/index.html', 'zotero-plugin/manifest.json'] },
  { file: 'ai-research/index.html', url: '/ai-research/', sources: ['site/ai-research/index.html'] },
  { file: 'open-source/index.html', url: '/open-source/', sources: ['site/open-source/index.html', 'LICENSE', 'PRIVACY.md'] },
  { file: 'cite/index.html', url: '/cite/', sources: ['site/cite/index.html', 'package.json', 'CITATION.cff', 'scripts/build-site-metadata.mjs'] },
  { file: 'demo/index.html', url: '/demo/', sources: ['site/demo/index.html', 'site/demo/app.js', 'site/demo/data.js'] },
  { file: 'demo/study.html', url: '/demo/study.html', sources: ['site/demo/study.html', 'site/demo/study-app.js', 'site/demo/study-data.js'] },
  { file: 'demo/teaching.html', url: '/demo/teaching.html', sources: ['site/demo/teaching.html', 'site/demo/teaching-app.js', 'site/demo/teaching-data.js'] },
  { file: 'demo/worldbuilding.html', url: '/demo/worldbuilding.html', sources: ['site/demo/worldbuilding.html', 'site/demo/worldbuilding-app.js', 'site/demo/worldbuilding-data.js'] },
  { file: 'demo/databases.html', url: '/demo/databases.html', sources: ['site/demo/databases.html', 'site/demo/databases-app.js', 'site/demo/databases-data.js'] },
  { file: 'demo/genealogy.html', url: '/demo/genealogy.html', sources: ['site/demo/genealogy.html', 'site/demo/genealogy-app.js', 'site/demo/genealogy-data.js'] },
  { file: 'blog/index.html', url: '/blog/', sources: ['site/blog/index.html', 'site/blog/posts.json'] },
  { file: 'wiki/index.html', url: '/wiki/', sources: ['site/wiki/index.html', 'site/wiki/content.json', 'site/wiki/wiki.js'] },
  { file: 'faq/index.html', url: '/faq/', sources: ['site/faq/index.html', 'site/faq/faq-data.js', 'site/faq/faq.js'] },
  { file: 'models/index.html', url: '/models/', sources: ['site/models/index.html', 'site/models/models-data.js', 'site/models/models.js'] },
  { file: 'contribute/index.html', url: '/contribute/', sources: ['site/contribute/index.html', 'site/data/contributors.json'] },
];

export function gitLastModified(paths, root = repoRoot) {
  try {
    const date = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...paths], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
  }
}

export function sitemapPages(root = repoRoot) {
  const blogIndex = JSON.parse(fs.readFileSync(path.join(root, 'site/blog/posts.json'), 'utf8'));
  const pages = STATIC_PAGES.map((page) => ({
    ...page,
    lastmod: gitLastModified(page.sources, root),
  }));

  for (const post of blogIndex.posts || []) {
    if (post.draft) continue;
    const modified = post.modified || post.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(modified)) {
      throw new Error(`Blog post ${post.slug} needs an ISO modified date.`);
    }
    pages.push({
      file: `blog/${post.slug}/index.html`,
      url: `/blog/${post.slug}/`,
      sources: [`site/blog/posts/${post.slug}.md`, 'site/blog/posts.json'],
      lastmod: modified,
      generated: true,
    });
  }
  return pages;
}

const escapeXml = (value) => String(value).replace(/[&<>"']/g, (character) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]
));

export function buildSitemap(root = repoRoot) {
  const metadata = loadSiteMetadata(root);
  const pages = sitemapPages(root);
  const missing = pages.filter((page) => !fs.existsSync(path.join(root, 'site', page.file)));
  if (missing.length) throw new Error(`Missing pages: ${missing.map((page) => page.file).join(', ')}`);

  const entries = pages.map(({ url, lastmod }) => {
    const lastmodTag = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${escapeXml(`${metadata.siteUrl}${url}`)}</loc>${lastmodTag}\n  </url>`;
  }).join('\n');

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
  fs.writeFileSync(path.join(root, 'site/sitemap.xml'), sitemap);
  return pages;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const pages = buildSitemap();
  console.log(`site/sitemap.xml written with ${pages.length} URLs.`);
}
