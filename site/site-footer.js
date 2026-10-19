/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The one footer shared by the surfaces whose page body is rendered client-side:
the documentation reader and the live demos. The marketing pages keep their
static footer; this component repeats the same columns and the same About
destination at the bottom, where it belongs.

Hosts opt in with a placeholder element:
  <div data-nodus-site-footer data-base="../"></div>

  data-base    path back to site/ from the current page ('' at the root)
*/
(function () {
  'use strict';

  const REPO = 'https://github.com/jorgepb96/nodus';

  function markup(base) {
    const root = base || './';
    return `<footer class="site-foot">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <a class="logo" href="${root}"><img src="${base}assets/nodus-logo.svg" alt=""/> Nodus Research</a>
        <p>A personal, independent open-source project. Nodus is its local-first desktop application.</p>
      </div>
      <div class="foot-col">
        <h3>Research</h3>
        <a href="${base}research-atlas/">Research Atlas</a>
        <a href="${base}research/">Academic research</a>
        <a href="${base}zotero/">Nodus and Zotero</a>
        <a href="${base}ai-research/">AI for research</a>
      </div>
      <div class="foot-col">
        <h3>Learn</h3>
        <a href="${base}wiki/">Wiki</a>
        <a href="${base}blog/">Blog</a>
        <a href="${base}faq/">FAQ</a>
        <a href="${base}models/">Model guide</a>
        <a href="${base}demo/">Live demos</a>
      </div>
      <div class="foot-col">
        <h3>Project</h3>
        <a href="${base}about/">About Nodus Research</a>
        <a href="${base}cite/">Cite Nodus</a>
        <a href="${base}legal/">Legal notice</a>
        <a href="${base}contribute/">Support Nodus</a>
        <a href="${REPO}" target="_blank" rel="noopener">GitHub</a>
      </div>
    </div>
    <div class="foot-base">
      <span>© 2026 Jorge Pérez Burgueño and Nodus contributors.</span>
      <a href="${base}privacy/">Website privacy</a>
      <a href="${base}cookies/">Cookies</a>
      <a href="${REPO}/blob/main/LICENSE" target="_blank" rel="noopener">AGPL-3.0-only</a>
    </div>
  </div>
</footer>`;
  }

  document.querySelectorAll('[data-nodus-site-footer]').forEach((host) => {
    // Replace, rather than fill, the placeholder: the footer has to remain a
    // direct child of <body> for the design system's stacking rule to reach it.
    host.outerHTML = markup(host.dataset.base || '');
  });
})();
