# nodusresearch.com as the home of the Nodus family

Date: 2026-11-17
Status: draft for approval
Branch: `site/nodus-ecosystem`

## Intent

Nodus has grown from one desktop app into a family: two desktop apps (Nodus
Research and Nodus Imago) and four iPhone/iPad companions (Nodus Link, Nodus
Reader, Nodus Presenter and Nodus Drift). The website still presents only the
first one. The site should become the home of the whole family: a front page
that shows every app and sends visitors to a page for each, all with the same
layout and visual quality as today's homepage.

## Goals

- `/` becomes a family front page: the two desktop apps first, each with a
  short description, a few screenshots and a link to its page; then the four
  mobile apps, each with phone screenshots and a link to its page.
- Today's homepage moves unchanged in content to `/nodus/` and becomes the
  Nodus Research page.
- New pages `/imago/`, `/link/`, `/reader/`, `/presenter/` and `/drift/`, each
  following the structure of today's homepage: hero, sections that alternate
  text with screenshot carousels, an open-source band and the shared footer.
- Desktop screenshots keep today's macOS window frame (coloured traffic-light
  buttons). Mobile screenshots get an equivalent iPhone frame, so both families
  look like they belong together.
- Everything is reviewed on a local server before anything is pushed.

## Non-goals

- No subdomains (`imago.nodusresearch.com` etc.). The user chose paths:
  subdomains would need one GitHub Pages site per subdomain or a routing Worker,
  and split search ranking across several sites.
- No static site generator and no new build system. The site stays hand-written
  HTML/CSS/JS in `site/`, deployed by `.github/workflows/pages.yml`.
- No localisation. The site is English only (see `site/i18n-complete.js`).
- No rewrite of the Nodus Research content. It moves to `/nodus/`; only paths,
  canonical URLs and metadata change.
- No changes to existing pages such as `/research/`, `/app/`, `/apps/`,
  `/demo/`, `/zotero/`, `/zotero-plugin/`, `/wiki/`, `/blog/`, `/faq/`,
  `/models/`, `/research-atlas/` or the `/<app>/privacy/` pages, other than
  links that point at the old homepage.

## Anti-goals

- Breaking any URL the apps or stores rely on. The apps link to
  `https://nodusresearch.com/`, `/app`, `/drift`, `/reader`, `/presenter`,
  `/zotero-plugin`, `/data/…`, `/tutorials.json`, `/models`, `/wiki` and the
  App Store privacy pages `/<app>/privacy/`. All must keep resolving. Today
  `/drift/`, `/reader/`, `/presenter/` and `/link/` only contain `privacy/`;
  adding an `index.html` to each makes those app links land on a real page
  instead of a 404.
- A front page that looks like a generic app grid. It must keep the site's
  identity: the organism canvas, Fraunces/Inter type, dark violet palette,
  scroll reveals and window-framed screenshots.
- Shipping invented claims. App descriptions come from each app's README and
  stated platforms and channels (App Store, TestFlight, GitHub releases).

## Approaches considered

1. **Extend the existing static site (chosen).** Add pages to `site/`, reuse
   `nodus.css`, `home.css`, `site-header.js`, `site-footer.js` and the
   screenshot carousel. No new tooling, same deployment, existing URLs untouched.
2. **Static site generator (Astro, Eleventy).** Templates would remove some
   duplication across the six app pages, but the whole site, its build scripts
   (blog, sitemap, metadata, download totals) and its 16 site tests would have
   to be redone. Too much cost for the benefit.
3. **Separate repository for the website.** Would break the scripts that
   generate the blog, sitemap and download totals from this repo, and the Pages
   deployment. Rejected.

## URL map

```
/                      NEW  family front page
/nodus/                MOVED today's homepage (Nodus Research)
/imago/                NEW  Nodus Imago
/link/                 NEW  Nodus Link       (/link/privacy/ unchanged)
/reader/               NEW  Nodus Reader     (/reader/privacy/ unchanged)
/presenter/            NEW  Nodus Presenter  (/presenter/privacy/ unchanged)
/drift/                NEW  Nodus Drift      (/drift/privacy/ unchanged)
everything else        unchanged
```

## Pages

### `/` family front page

- Hero in today's style: Nodus mark, "Nodus" family title, one line on what the
  family is (open-source, local-first tools for research, teaching and study),
  and two calls to action: see the desktop apps, see the mobile apps.
- **Desktop** (`#desktop`): two large alternating rows, one per app.
  - Nodus Research: research, study and teaching; the main vaults (Academic,
    Genealogy, Databases, Study, Teaching) in one line each; 3–4 screenshots in
    the macOS window carousel; links "Explore Nodus Research" → `/nodus/`,
    "Download", "Try the live demo" → `/demo/`.
  - Nodus Imago: photographs and visual sources for historians, art historians
    and archivists; 3–4 screenshots in the macOS window carousel; links
    "Explore Nodus Imago" → `/imago/`, "Download" → Imago releases.
- **Mobile** (`#mobile`): four apps, each with an iPhone-framed screenshot (or
  a small carousel), name, one-line description, platforms and a link to its
  page. Layout: a 2×2 grid on wide screens, a single column on phones.
- Open-source band: every Nodus app is free and open source (AGPL-3.0; Drift
  MIT), no accounts, data stays on your device. Links to each repository.
- Shared footer.

### `/nodus/` Nodus Research

`site/index.html` moved to `site/nodus/index.html`:

- Relative paths gain one level (`assets/…` → `../assets/…`, `favicon.ico` →
  `../favicon.ico`, `demo/` → `../demo/`, etc.).
- `canonical` and `og:url` become `https://nodusresearch.com/nodus/`.
- The generated JSON-LD block (`scripts/build-site-metadata.mjs`) is split: the
  `WebSite` and creator `Person` stay on `/`; the `SoftwareApplication` for
  Nodus Research moves to `/nodus/`.
- The hero text stays as it is.

### `/imago/`, `/link/`, `/reader/`, `/presenter/`, `/drift/`

Same skeleton as `/nodus/`: hero (app mark, name, tagline, primary call to
action), 3–5 feature sections, each with a short text and a screenshot
carousel, an open-source band and the footer. The accent colour in the hero
(`data-accent`) may vary per app.

| Page | Frame | Content source | Primary call to action |
|---|---|---|---|
| Imago | macOS window | `nodus-imago` README | Download (GitHub releases) |
| Link | iPhone | `nodus-mobile` README and `docs/mobile-0.1.0` | Repository (no public store link yet) |
| Reader | iPhone (iPad/Mac shots optional) | `nodus-reader` README | TestFlight public beta |
| Presenter | iPhone | `nodus-presenter` README | App Store |
| Drift | iPhone | `nodus-drift` README | TestFlight public beta |

Imago's screenshots show photographs by Jean Laurent from public collections.
Its page carries the same credit line as the Imago README, linking to
`nodus-imago/docs/screenshots/README.md`.

## Shared pieces

- **Phone frame.** A CSS-only iPhone frame (rounded body, screen inset, Dynamic
  Island), the mobile counterpart of today's window frame. It lives in
  `nodus.css` (or a new `apps.css` loaded by the app pages) and works inside
  the existing carousel.
- **Header.** The logo goes to `/`. The nav gains "Nodus" (`/nodus/`), "Imago"
  (`/imago/`) and "Mobile" (`/#mobile`), ahead of the current items. The
  existing items keep their order. *(Builder's call; adjust after review.)*
- **Footer.** Gains a "Family" column listing all six app pages.
- **Screenshots.** Copied from the app repositories into
  `site/assets/screenshots/<app>/` and converted to WebP at the sizes the
  current carousel uses. Sources:
  - Imago: `nodus-imago/docs/screenshots/readme-*.png`
  - Link: `nodus-mobile/docs/mobile-0.1.0/appstore/screenshots/iphone-en-*.png`
  - Reader: `nodus-reader/design/screens/iPhone-*.png`
  - Presenter: `nodus-presenter/Screenshots/iphone*.png`
  - Drift: `nodus-drift/screenshots/*` (App Store finals first)

  Screenshots that show private or test data are left out.

## Site build and tests

- `scripts/build-sitemap.mjs`: add the six app pages; `/` stays first.
- `scripts/build-site-metadata.mjs`: write the JSON-LD to both pages as
  described above.
- Site tests (`npm run site:verify`, 115 passing on `main` today): the tests
  that read the homepage (hero figure, vault shots, toolkit, SEO, layout,
  shared header/footer, brand search, citation, canonical redirects) are
  retargeted to `site/nodus/index.html` where they test Nodus Research
  content, and to `site/index.html` where they test site-wide things (brand,
  `WebSite` metadata, header and footer).
- New tests: every app page exists, has a unique title, description and
  canonical URL, loads the shared header and footer, and every local link and
  image resolves; the `/<app>/privacy/` pages still exist.

## Review and release

- Work happens on `site/nodus-ecosystem`. Nothing is pushed until the user
  approves the result.
- Preview: a static server over `site/` on localhost, viewed in the browser
  pane at desktop and phone widths.
- When approved: push, open a PR, merge with admin rights (as with earlier
  site changes), and check the live site after the Pages workflow runs.

## Left to the builder

- Exact copy for the front page and the five new pages, written from the app
  READMEs in the site's existing voice.
- Which screenshots go where and how many per carousel.
- Per-app accent colours.
- Whether the phone frame lives in `nodus.css` or a new stylesheet.
