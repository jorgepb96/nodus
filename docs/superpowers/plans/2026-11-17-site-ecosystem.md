# Nodus family website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn nodusresearch.com into the home of the Nodus family: a front page at `/`, today's homepage at `/nodus/`, and pages for Imago, Link, Reader, Presenter and Drift.

**Architecture:** Hand-written static pages in `site/`, reusing `nodus.css`, `home.css`, the organism canvas, `site.js`, `home.js` reveals and the `vault-shots.js` carousel. One new stylesheet, `site/assets/css/family.css`, holds the phone frame and the front-page grids. No build system changes beyond the sitemap and JSON-LD scripts.

**Tech Stack:** HTML, CSS, vanilla JS, Node test runner (`node --test`), GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-11-17-site-ecosystem-design.md`

## Global Constraints

- English only; the site's existing voice and type (Fraunces headings, Inter body).
- Every app page: unique `<title>`, `meta description`, `canonical` and `og:url` of the form `https://nodusresearch.com/<slug>/`.
- Every page loads `site-header.js` with the right `data-base` and `data-page`.
- Keep resolving: `/`, `/app/`, `/apps/`, `/research/`, `/demo/`, `/data/…`, `/tutorials.json`, `/models/`, `/wiki/`, `/zotero-plugin/`, `/<app>/privacy/`.
- Licences as stated: Nodus Research, Imago, Link, Reader, Presenter AGPL-3.0-only; Drift MIT.
- Channels as stated: Imago and Research → GitHub releases; Presenter → App Store `https://apps.apple.com/us/app/nodus-presenter/id6818107823`; Reader → TestFlight `https://testflight.apple.com/join/SjCk8AZ1`; Drift → TestFlight `https://testflight.apple.com/join/kAXnsjJS`; Link → repository `https://github.com/jorgepb96/nodus-mobile`.
- Imago page carries the Jean Laurent credit line linking to `https://github.com/jorgepb96/nodus-imago/blob/main/docs/screenshots/README.md`.
- Nothing is pushed until the user approves the local preview.

## Review Focus

1. Links elsewhere on the site to homepage anchors (`./#vaults`, `../#tools`, `/#more-vaults`) must now point at `/nodus/#…`; the front page has no such anchors. → test in Task 1.
2. Every relative asset and link inside the moved page resolves from its new depth. → resolver test in Task 1, reused for every page in Task 7.
3. The download modal (`data-download`) on `/nodus/` still opens and lists the same platforms. → checked in Task 8 preview.
4. At 375 px wide no page scrolls horizontally, and phone frames scale down. → checked in Task 8 preview.
5. App links `/drift`, `/reader`, `/presenter`, `/link` (no trailing slash, used by the iOS apps) reach the new pages. → Task 7 test asserts `site/<slug>/index.html` exists; GitHub Pages adds the slash.

---

### Task 1: Move today's homepage to `/nodus/`

**Files:**
- Move: `site/index.html` → `site/nodus/index.html`
- Create: `site/index.html` (temporary stub, replaced in Task 6)
- Modify: `scripts/build-site-metadata.mjs` (JSON-LD split), `scripts/build-sitemap.mjs` (`STATIC_PAGES`)
- Modify tests: `scripts/test-site-{hero-figure,toolkit,vault-shots,layout,pages,seo,name-risk,brand-search,citation,shared-header}.mjs`
- Create: `scripts/lib/site-links.mjs`

**Interfaces:**
- Produces: `localReferences(htmlPath: string): string[]` and `assertLocalReferencesResolve(htmlPath: string): void` in `scripts/lib/site-links.mjs` — collect every `href`/`src` in a page that is relative or starts with `/`, strip query and hash, resolve against the page (or `site/` for `/…`), and assert the file exists (a trailing `/` means `index.html`). Used by Task 7.
- Produces: generated-block names `homepage-jsonld` (on `site/index.html`: `Person` + `WebSite`) and `nodus-jsonld` (on `site/nodus/index.html`: `SoftwareApplication`, `url` `https://nodusresearch.com/nodus/`).

- [ ] **Step 1:** Write `scripts/test-site-family.mjs` with `test('the Nodus Research page lives at /nodus/ and its links resolve')`: asserts `site/nodus/index.html` exists, its canonical is `https://nodusresearch.com/nodus/`, it contains `data-base="../"`, and `assertLocalReferencesResolve('site/nodus/index.html')` passes. Add `test('no page links to homepage-only anchors at the root')`: no file under `site/` (excluding `site/nodus/`) contains `href` values matching `^(\./|(\.\./)+|/)#(vaults|more-vaults|tools|what-nodus-is)`.
- [ ] **Step 2:** Run `node --test scripts/test-site-family.mjs` — expect FAIL (no `site/nodus/`).
- [ ] **Step 3:** `git mv site/index.html site/nodus/index.html`; prefix every relative `href`/`src` with `../` (except `#…`, `http…`, `mailto:`); set canonical and `og:url`; header placeholder `data-base="../" data-page="nodus"`; rename its JSON-LD markers to `nodus-jsonld`. Retarget the root-anchor links found by the Step 1 test to `nodus/#…` with the right depth. Create a minimal `site/index.html` (title "Nodus Research | Open-source research software", canonical `https://nodusresearch.com/`, `homepage-jsonld` markers, link to `nodus/`).
- [ ] **Step 4:** Update `build-site-metadata.mjs` to write both blocks; run `npm run -s site:metadata`. Add `{ file: 'nodus/index.html', url: '/nodus/', sources: ['site/nodus/index.html', 'package.json', 'scripts/build-site-metadata.mjs'] }` to `STATIC_PAGES` after `/`; run `npm run -s site:sitemap`.
- [ ] **Step 5:** Retarget the homepage-content tests (hero figure, toolkit, vault shots, name risk, citation, pages, layout, seo) from `site/index.html` to `site/nodus/index.html`; keep site-wide assertions (`WebSite` JSON-LD, brand name in root title) on `site/index.html`. In `test-site-shared-header.mjs` add `['site/nodus/index.html', 'nodus', '../']`.
- [ ] **Step 6:** Run `npm run -s site:verify` — expect all pass, including the new file.
- [ ] **Step 7:** Commit `site: move the Nodus Research homepage to /nodus/`.

### Task 2: Shared header, footer and family stylesheet

**Files:**
- Modify: `site/site-header.js`, `site/site-footer.js`, `site/nodus/index.html` (static footer)
- Create: `site/assets/css/family.css`
- Test: `scripts/test-site-shared-header.mjs`, `scripts/test-site-shared-footer.mjs`

**Interfaces:**
- Produces: header `data-page` ids `family`, `nodus`, `imago`, `link`, `reader`, `presenter`, `drift`. Nav order: `Nodus` (`${base}nodus/`), `Imago` (`${base}imago/`), `Mobile` (`${base}#mobile`), then the current items minus `Home`. Logo `aria-label="Nodus, home"`, text "Nodus".
- Produces CSS classes in `family.css`: `.phone` (frame) > `.phone-screen` > `img`; `.phone.is-ipad` variant; `.phone-shots` (carousel host, same `data-shots` contract as `.frame`); `.family-desktop`, `.family-mobile` (front-page grids, 2 columns ≥ 900 px, 1 below); `.app-hero-mark` (app logo in hero).
- Produces footer column "Family" with links to `nodus/`, `imago/`, `link/`, `reader/`, `presenter/`, `drift/` — in `site-footer.js` and in every static footer created later.

- [ ] **Step 1:** Extend the header and footer tests: nav contains the three new items in that order; footer contains the six family links and each target has an `index.html` (the existing existence loop covers it once pages exist; until Tasks 3–6 land, assert only the markup).
- [ ] **Step 2:** Run both tests — expect FAIL.
- [ ] **Step 3:** Implement the header and footer changes; write `family.css`. Phone frame: aspect from the image, `border-radius: 44px`, 10 px dark bezel with the site's `--line` border, Dynamic Island pill 28 % wide at the top, soft shadow matching `.frame`. `vault-shots.js` must drive `.phone-shots` without changes; if it keys on `.frame`, add the selector there.
- [ ] **Step 4:** Run `npm run -s site:verify` — expect PASS.
- [ ] **Step 5:** Commit `site: family navigation, footer and phone frame`.

### Task 3: Screenshots for the new pages

**Files:**
- Create: `site/assets/screenshots/{imago,link,reader,presenter,drift}/*.webp`
- Create: `site/assets/screenshots/family/README.md` (source and rights for each file)

- [ ] **Step 1:** Convert with `cwebp -q 82` (or `sips` → PNG then `cwebp` if needed). Desktop shots at 1280 × 800; phone shots at 600 px wide keeping aspect. Picks:
  - Imago: `gallery`, `detail-search`, `visual-map`, `compare-overlay`, `then-and-now`, `network`, `record`, `authorities` from `nodus-imago/docs/screenshots/readme-*.png`.
  - Link: `iphone-en-1-home` … `iphone-en-5-dictionary` from `nodus-mobile/docs/mobile-0.1.0/appstore/screenshots/`.
  - Reader: `iPhone-Library`, `iPhone-Reader`, `iPhone-NowPlaying`, `iPhone-Collections`, `iPhone-Models` from `nodus-reader/design/screens/`.
  - Presenter: `iphone-slides`, `iphone-tools`, `iphone16promax-dark-estudio`, `iphone16promax-magnifier-build3`, `iphone16promax-video-controls` from `nodus-presenter/Screenshots/`.
  - Drift: App Store finals and device shots from `nodus-drift/screenshots/` (open each; skip TestFlight notes, debug states and anything showing personal data).
- [ ] **Step 2:** Open every chosen file and drop any with private data, test banners or broken states.
- [ ] **Step 3:** Commit `site: screenshots for the Nodus family pages`.

### Task 4: `/imago/`

**Files:** Create `site/imago/index.html`; modify `scripts/build-sitemap.mjs`.

- [ ] **Step 1:** Add to `test-site-family.mjs` a table-driven `test('app page <slug>')` over `APP_PAGES = ['imago','link','reader','presenter','drift']`: file exists, canonical `https://nodusresearch.com/<slug>/`, unique title and description across the six pages and `/`, header `data-page="<slug>"`, includes `family.css`, `assertLocalReferencesResolve` passes. Run — expect FAIL for all five.
- [ ] **Step 2:** Build the page on the `/nodus/` skeleton: hero (Imago mark from `nodus-imago/build/icon-mark.svg`, "Nodus Imago", tagline "Explore images. Discover history.", Download → `https://github.com/jorgepb96/nodus-imago/releases/latest`, Source → repo); four scenes with macOS-window carousels — Catalogue & describe (gallery, record), Search by words, likeness or detail (detail-search, visual-map), Compare & place (compare-overlay, then-and-now), Analyse & link (network, authorities); open-source band (AGPL-3.0-only, local AI or chosen provider, macOS/Windows/Linux); credit line; static footer with the Family column. Copy written from the Imago README.
- [ ] **Step 3:** Add `imago/index.html` to `STATIC_PAGES`; `npm run -s site:sitemap`.
- [ ] **Step 4:** `node --test scripts/test-site-family.mjs` — Imago passes, the four mobile pages still fail.
- [ ] **Step 5:** Commit `site: Nodus Imago page`.

### Task 5: `/link/`, `/reader/`, `/presenter/`, `/drift/`

**Files:** Create `site/{link,reader,presenter,drift}/index.html`; modify `scripts/build-sitemap.mjs`.

- [ ] **Step 1:** Build each on the Imago skeleton with `.phone-shots` instead of `.frame`; 3 scenes each; hero call to action per Global Constraints; a "Privacy" link to `privacy/`; platforms line (Link: iPhone · iPad; Reader: iPhone · iPad · Mac coming soon; Presenter: iPhone · iPad, iOS 18; Drift: iPhone · iPad, iOS 17). Copy from each README; Link's page notes it works with Nodus Research 5.18 or later on the desktop.
- [ ] **Step 2:** Add the four pages to `STATIC_PAGES`; `npm run -s site:sitemap`.
- [ ] **Step 3:** `npm run -s site:verify` — all pass.
- [ ] **Step 4:** Commit `site: pages for the Nodus mobile apps`.

### Task 6: Front page `/`

**Files:** Replace `site/index.html`.

- [ ] **Step 1:** Add to `test-site-family.mjs`: `test('front page presents the family')` — contains `id="desktop"` and `id="mobile"`, links to all six app pages, `WebSite` JSON-LD present, `assertLocalReferencesResolve('site/index.html')` passes. Run — expect FAIL.
- [ ] **Step 2:** Build: organism canvas and hero in the homepage style ("Nodus", line "Open-source, local-first tools for research, teaching and study.", buttons to `#desktop` and `#mobile`); `#desktop` with two alternating scenes (Nodus Research: vault list + 4-shot carousel from existing `assets/screenshots/*.webp`, links to `nodus/`, `demo/`, releases; Imago: 4-shot carousel, links to `imago/`, releases); `#mobile` with `.family-mobile` 2×2 cards, each a `.phone` with one screenshot, name, one line, platforms and link to its page; open-source band; static footer with Family column. Title stays brand-led: "Nodus Research | Open-source research software".
- [ ] **Step 3:** `npm run -s site:metadata && npm run -s site:verify` — all pass.
- [ ] **Step 4:** Commit `site: Nodus family front page`.

### Task 7: Whole-site checks

- [ ] **Step 1:** Extend `test-site-family.mjs`: every `site/<app>/privacy/index.html` for drift, link, presenter, reader still exists; sitemap lists `/`, `/nodus/` and the five app pages.
- [ ] **Step 2:** `npm run -s site:verify` and `npm run -s site:build` — both succeed.
- [ ] **Step 3:** Commit `site: tests for the family pages`.

### Task 8: Local preview with the user

- [ ] **Step 1:** Serve `site/` on `http://127.0.0.1:4173` (`python3 -m http.server 4173 --bind 127.0.0.1 --directory site`) in the background.
- [ ] **Step 2:** Walk `/`, `/nodus/`, `/imago/` and the four mobile pages at 1280 px and 375 px in the browser pane: no console errors, no 404s in network, carousels move, download modal opens on `/nodus/`, no horizontal scroll at 375 px.
- [ ] **Step 3:** Hand over to the user for review. No push until they approve.
