// Generate one crawlable HTML document per published Markdown post.
// Run after adding or editing a post: npm run blog:build
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadSiteMetadata, personEntity } from './lib/site-metadata.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blogRoot = path.join(repoRoot, 'site', 'blog');
const metadata = loadSiteMetadata(repoRoot);
const SITE = metadata.siteUrl;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
));

const index = JSON.parse(fs.readFileSync(path.join(blogRoot, 'posts.json'), 'utf8'));
const posts = (Array.isArray(index.posts) ? index.posts : [])
  .filter((post) => post && post.slug && post.title && post.date && !post.draft)
  .sort((a, b) => String(b.date).localeCompare(String(a.date)));

const rendererSource = fs.readFileSync(path.join(blogRoot, 'markdown.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(rendererSource, sandbox, { filename: 'site/blog/markdown.js' });
const { render } = sandbox.window.NodusMarkdown;

const formatDate = (value) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

for (const [position, post] of posts.entries()) {
  const markdownPath = path.join(blogRoot, 'posts', `${post.slug}.md`);
  if (!fs.existsSync(markdownPath)) {
    console.error(`Missing Markdown for: ${post.slug}`);
    process.exit(1);
  }

  const source = fs.readFileSync(markdownPath, 'utf8');
  const article = render(source).html;
  const words = source.split(/\s+/).filter(Boolean).length;
  const minutes = post.reading || Math.max(1, Math.round(words / 220));
  const canonical = `${SITE}/blog/${post.slug}/`;
  const image = post.cover ? new URL(post.cover, `${SITE}/blog/`).href : metadata.socialImage;
  const imageAlt = post.coverAlt || 'Nodus Research with a screenshot of the Nodus academic knowledge graph';
  const modified = post.modified || post.date;
  const next = posts[position + 1];
  const articleId = `${canonical}#article`;
  const webpageId = `${canonical}#webpage`;
  const breadcrumbId = `${canonical}#breadcrumb`;
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      personEntity(metadata),
      {
        '@type': 'BreadcrumbList',
        '@id': breadcrumbId,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: metadata.projectName, item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog/` },
          { '@type': 'ListItem', position: 3, name: post.title, item: canonical },
        ],
      },
      {
        '@type': 'WebPage',
        '@id': webpageId,
        url: canonical,
        name: post.title,
        isPartOf: { '@id': metadata.websiteId },
        breadcrumb: { '@id': breadcrumbId },
        mainEntity: { '@id': articleId },
      },
      {
        '@type': 'BlogPosting',
        '@id': articleId,
        url: canonical,
        headline: post.title,
        description: post.summary,
        datePublished: post.date,
        dateModified: modified,
        mainEntityOfPage: { '@id': webpageId },
        isPartOf: { '@id': metadata.websiteId },
        image: { '@type': 'ImageObject', url: image, caption: imageAlt },
        keywords: post.tags || [],
        author: { '@id': metadata.authorId },
        publisher: { '@id': metadata.authorId },
        about: { '@id': metadata.softwareId },
      },
    ],
  }).replaceAll('<', '\\u003c');

  const html = `<!--
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

Generated from posts/${post.slug}.md by scripts/build-blog-pages.mjs.
-->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<base href="../"/>
<title>${escapeHtml(post.title)} · Nodus Blog</title>
<meta name="description" content="${escapeHtml(post.summary)}"/>
<meta property="og:type" content="article"/>
<meta property="og:site_name" content="Nodus Research"/>
<meta property="og:title" content="${escapeHtml(post.title)}"/>
<meta property="og:description" content="${escapeHtml(post.summary)}"/>
<meta property="og:url" content="${canonical}"/>
<meta property="og:image" content="${escapeHtml(image)}"/>
<meta property="og:image:alt" content="${escapeHtml(imageAlt)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(post.title)}"/>
<meta name="twitter:description" content="${escapeHtml(post.summary)}"/>
<meta name="twitter:image" content="${escapeHtml(image)}"/>
<meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}"/>
<meta name="author" content="${escapeHtml(metadata.authorName)}"/>
<meta property="article:published_time" content="${escapeHtml(post.date)}"/>
<meta property="article:modified_time" content="${escapeHtml(modified)}"/>
${(post.tags || []).map((tag) => `<meta property="article:tag" content="${escapeHtml(tag)}"/>`).join('\n')}
<link rel="canonical" href="${canonical}"/>
<link rel="icon" href="../favicon.ico" sizes="any"/>
<link rel="icon" type="image/png" href="../favicon.png" sizes="512x512"/>
<link rel="icon" type="image/svg+xml" href="../assets/nodus-logo.svg"/>
<link rel="apple-touch-icon" href="../apple-touch-icon.png"/>
<link rel="alternate" type="application/rss+xml" title="Nodus Blog" href="feed.xml"/>
<link rel="preload" as="font" type="font/woff2" href="../assets/fonts/inter-latin.woff2" crossorigin/>
<link rel="preload" as="font" type="font/woff2" href="../assets/fonts/fraunces-latin.woff2" crossorigin/>
<link rel="stylesheet" href="../assets/css/nodus.css?v=20260928s"/>
<link rel="stylesheet" href="blog.css?v=20260817"/>
<script type="application/ld+json">${structuredData}</script>
</head>
<body data-quiet>

<a class="skip-link" href="#article">Skip to the post</a>
<canvas id="organism" aria-hidden="true"></canvas>
<div id="scroll-progress" aria-hidden="true"></div>

<div data-nodus-site-header data-base="../" data-page="blog"></div>
<script defer src="../site-header.js?v=20261109a"></script>

<main id="main" data-accent="#c084fc" data-second="#a78bfa" data-energy="0.22">
  <article class="post-page">
    <header class="post-head">
      <div class="wrap-narrow scrim">
        <a class="post-back" href="./">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>
          All posts
        </a>
        <div class="post-tags">${(post.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        <h1 class="display">${escapeHtml(post.title)}</h1>
        <p class="post-meta">By ${escapeHtml(metadata.authorName)} · <time datetime="${escapeHtml(post.date)}">${formatDate(post.date)}</time> · ${minutes} min read</p>
      </div>
    </header>

    <div class="wrap-narrow">
      ${post.cover ? `<figure class="post-cover"><img src="${escapeHtml(post.cover)}" alt="${escapeHtml(post.coverAlt || '')}"/></figure>` : ''}
      <div class="prose" id="article" tabindex="-1">
${article}
      </div>

      <nav class="post-foot" aria-label="More blog posts">
        <a class="btn" href="./">← All posts</a>
${next ? `        <a class="btn" href="${encodeURIComponent(next.slug)}/">${escapeHtml(next.title)} →</a>\n` : ''}      </nav>
    </div>
  </article>
</main>

<footer class="site-foot">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <a class="logo" href="../"><img src="../assets/nodus-logo.svg" alt=""/> Nodus Research</a>
        <p>A personal, independent open-source project. Nodus is its local-first desktop application.</p>
      </div>
      <div class="foot-col">
        <h3>Product</h3>
        <a href="../#vaults">The four vaults</a>
        <a href="../#tools">Nodus Toolkit</a>
        <a href="../apps/">Nodus Apps</a>
        <a href="../demo/">Live demos</a>
      </div>
      <div class="foot-col">
        <h3>Learn</h3>
        <a href="../wiki/">Wiki</a>
        <a href="./">Blog</a>
        <a href="../faq/">FAQ</a>
      </div>
      <div class="foot-col">
        <h3>Project</h3>
        <a href="../about/">About Nodus Research</a>
        <a href="../cite/">Cite Nodus</a>
        <a href="../legal/">Legal notice</a>
        <a href="../contribute/">Contribute</a>
        <a href="https://github.com/jorgepb96/nodus" target="_blank" rel="noopener">GitHub</a>
        <a href="https://github.com/jorgepb96/nodus/releases" target="_blank" rel="noopener">Releases</a>
      </div>
    </div>
    <div class="foot-base">
      <span>© 2026 Jorge Pérez Burgueño and Nodus contributors.</span>
      <a href="../privacy/">Website privacy</a>
      <a href="../cookies/">Cookies</a>
      <a href="https://github.com/jorgepb96/nodus/blob/main/LICENSE" target="_blank" rel="noopener">AGPL-3.0-only</a>
    </div>
  </div>
</footer>

<script src="../assets/js/organism.js?v=20260820a"></script>
<script src="../assets/js/site.js?v=20260815"></script>
<script src="../assets/js/back-to-top.js?v=20260817b"></script>
</body>
</html>
`;

  const output = path.join(blogRoot, post.slug, 'index.html');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html);
}

console.log(`Generated ${posts.length} static blog page${posts.length === 1 ? '' : 's'}.`);
