/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The one navigation shared by the home page, the wiki, the blog, the Research
Atlas, the FAQ, the About page, contribute and every live demo.

Hosts opt in with a placeholder element:
  <div data-nodus-site-header data-base="../" data-page="wiki" data-context="wiki"></div>

  data-base    path back to site/ from the current page ('' at the root)
  data-page    home | wiki | blog | atlas | faq | models | contribute | demo — marks the current item
  data-context 'wiki' adds the docs menu button
*/
(function () {
  'use strict';

  /* GitHub Pages serves both /section/ and /section/index.html with a 200 and
     offers no repository-level redirect rules. Keep explicit index requests
     from lingering as duplicate browser/search URLs until the custom domain is
     fronted by a service that can issue the preferred HTTP 301/308. */
  if (/^https?:$/.test(location.protocol) && location.pathname.endsWith('/index.html')) {
    location.replace(`${location.pathname.slice(0, -'index.html'.length)}${location.search}${location.hash}`);
    return;
  }

  const REPO = 'https://github.com/jorgepb96/nodus';

  const LOGO_STAR = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .67.42l1.88 3.8 4.2.62c.61.09.86.84.41 1.28l-3.04 2.96.72 4.18a.75.75 0 0 1-1.09.79L8 12.35l-3.76 1.97a.75.75 0 0 1-1.08-.79l.72-4.18L.83 6.37a.75.75 0 0 1 .41-1.28l4.2-.61L7.32.67A.75.75 0 0 1 8 .25Z"/></svg>';
  const LOGO_GH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';

  const PAGES = [
    { id: 'home', label: 'Home', href: (base) => base || './' },
    // Nodus Browser reveals this prepared slot from its isolated preload. It is
    // hidden everywhere else, so a normal web visitor never sees a local-only
    // destination or a custom-protocol prompt that cannot work in their browser.
    { id: 'bookmarks', label: 'Bookmarks', href: () => '#nodus-bookmarks', browserOnly: true },
    { id: 'wiki', label: 'Wiki', href: (base) => `${base}wiki/` },
    { id: 'blog', label: 'Blog', href: (base) => `${base}blog/` },
    { id: 'atlas', label: 'Atlas', href: (base) => `${base}research-atlas/` },
    { id: 'faq', label: 'FAQ', href: (base) => `${base}faq/` },
    // Use-case guides — local models, embeddings, Research Chat + Dictionary,
    // Deep Research + Immersion. About lives only in the site footer now.
    { id: 'models', label: 'Models', href: (base) => `${base}models/` },
    { id: 'contribute', label: 'Support', href: (base) => `${base}contribute/` },
  ];

  function markup(base, page, context) {
    const isWiki = context === 'wiki';
    const links = PAGES.map((item) => {
      const current = item.id === page ? ' aria-current="page"' : '';
      const browserOnly = item.browserOnly ? ' data-nodus-browser-bookmarks hidden' : '';
      return `<a class="link" href="${item.href(base)}"${current}${browserOnly}>${item.label}</a>`;
    }).join('');

    return `<nav class="nav${isWiki ? ' wiki-nav' : ''}" id="site-header">
      ${isWiki ? `<button id="nav-toggle" class="wiki-menu-toggle" type="button" aria-label="Open documentation menu" aria-controls="wiki-sidebar" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>
        </svg>
      </button>` : ''}
      <a class="logo" href="${base || './'}" aria-label="Nodus Research, home">
        <img class="mark" src="${base}assets/nodus-logo.svg" alt=""/> Nodus Research
      </a>
      <button class="nav-toggle" id="site-nav-toggle" type="button" aria-label="Open menu" aria-controls="site-nav-links" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <div class="links" id="site-nav-links">
        ${links}
        <span class="nav-sep" aria-hidden="true"></span>
        <a class="gh-badge" href="${REPO}" target="_blank" rel="noopener" title="Star Nodus on GitHub">
          ${LOGO_GH}<span class="lbl">Star</span>
          <span class="stars">${LOGO_STAR}<span id="star-count" aria-label="Stars on GitHub">·</span></span>
        </a>
        <a class="release-downloads" id="release-downloads" data-state="loading" href="${REPO}/releases" target="_blank" rel="noopener" aria-describedby="release-downloads-tooltip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span class="download-value" id="release-download-count">—</span>
          <span class="download-word">downloads</span>
          <span class="download-tooltip" id="release-downloads-tooltip" role="tooltip">Package downloads from GitHub Releases · updated daily</span>
        </a>
        <a class="btn primary" href="${base}demo/">Try the live demo</a>
      </div>
    </nav>`;
  }

  function init(host, base) {
    const nav = host.querySelector('#site-header');
    const toggle = host.querySelector('#site-nav-toggle');
    const links = host.querySelector('#site-nav-links');

    // one place decides what "open" means, so the label, the ARIA state and the
    // panel can never drift apart no matter which gesture closed the menu
    const isOpen = () => links.classList.contains('open');
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      links.classList.toggle('open', open);
    };

    toggle.addEventListener('click', () => setOpen(!isOpen()));
    links.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen()) {
        setOpen(false);
        toggle.focus();
      }
    });
    // a press anywhere outside the panel dismisses it, the way every other menu
    // on the web behaves. pointerdown rather than click: the menu is gone before
    // the press lands, so the first tap outside also reaches what it aimed at.
    document.addEventListener('pointerdown', (event) => {
      if (!isOpen()) return;
      if (links.contains(event.target) || toggle.contains(event.target)) return;
      setOpen(false);
    });

    const syncBorder = () => nav.classList.toggle('scrolled', scrollY > 24);
    addEventListener('scroll', syncBorder, { passive: true });
    // Reading the scroll offset immediately after writing the header into the
    // page forces a synchronous layout; let the frame settle and read it then.
    requestAnimationFrame(syncBorder);

    // live counters, both best-effort: the header reads fine without them
    const starTarget = host.querySelector('#star-count');
    fetch(`https://api.github.com/repos/jorgepb96/nodus`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        const value = result && Number(result.stargazers_count);
        if (!Number.isFinite(value)) return;
        starTarget.textContent = value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
        starTarget.setAttribute('aria-label', `${value} stars on GitHub`);
      })
      .catch(() => {});

    const downloads = host.querySelector('#release-downloads');
    fetch(`${base}data/github-release-downloads.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        const total = result && Number(result.total);
        if (!Number.isFinite(total)) throw new Error('invalid release download stats');
        const formatted = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(total);
        host.querySelector('#release-download-count').textContent = formatted;
        downloads.setAttribute('aria-label', `${formatted} downloads`);
        downloads.setAttribute('data-state', 'ready');
      })
      .catch(() => downloads.setAttribute('data-state', 'error'));

    /* The chip counts what the releases page holds, but a visitor who clicks it
       wants the builds: where the page ships the download dialog it opens that
       one, the same the Download button opens, and it announces itself as a
       dialog opener. The href stays the honest destination for the pages
       without a dialog, for a modifier click that asks for the releases page in
       a new tab, and for JavaScript that never ran — so the click is only taken
       over while there is a dialog to answer it. */
    const opensDialog = () => typeof window.openDl === 'function';
    /* The dialog is published by site.js, which boots on DOMContentLoaded: this
       component runs earlier, on a deferred script, so the chip waits for the
       same moment to say what it does. Where the page never publishes one, the
       chip says nothing and stays the plain link to the releases page. */
    const announceDialog = () => {
      if (opensDialog()) downloads.setAttribute('aria-haspopup', 'dialog');
    };
    if (document.readyState === 'complete') announceDialog();
    else document.addEventListener('DOMContentLoaded', announceDialog);
    downloads.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!opensDialog()) return;
      event.preventDefault();
      window.openDl();
    });
  }

  document.querySelectorAll('[data-nodus-site-header]').forEach((host) => {
    const base = host.dataset.base || '';
    host.innerHTML = markup(base, host.dataset.page || '', host.dataset.context || 'page');
    init(host, base);
  });
})();
