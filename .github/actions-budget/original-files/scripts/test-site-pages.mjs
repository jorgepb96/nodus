import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.join(repoRoot, 'site');
const read = (relative) => fs.readFileSync(path.join(siteRoot, relative), 'utf8');

test('the site has every destination the navigation promises', () => {
  for (const entry of ['index.html', 'about/index.html', 'app/index.html', 'apps/index.html', 'research-atlas/index.html', 'zotero-plugin/index.html', 'wiki/index.html', 'blog/index.html', 'cite/index.html', 'legal/index.html', 'contribute/index.html', 'faq/index.html']) {
    assert.ok(fs.existsSync(path.join(siteRoot, entry)), `site/${entry} exists`);
  }
  const home = read('index.html');
  for (const href of ['about/', 'app/', 'apps/', 'research-atlas/', 'zotero-plugin/', 'wiki/', 'blog/', 'cite/', 'legal/', 'contribute/', 'faq/']) {
    assert.ok(home.includes(`href="${href}"`), `the home page links to ${href}`);
  }
});

test('the home page presents the four main vaults, the rest, and the toolkit', () => {
  const home = read('index.html');
  // one scene per main vault, each retuning the background to its own accent
  for (const [name, accent] of [
    ['Academic', '#818cf8'],
    ['Teaching', '#fb923c'],
    ['Study', '#2dd4bf'],
    ['Databases', '#ff5f7e'],
  ]) {
    assert.ok(home.includes(`data-accent="${accent}"`), `the ${name} scene tunes the organism to ${accent}`);
  }
  assert.equal((home.match(/<section class="scene"/g) ?? []).length, 4, 'four vault scenes, no more');

  for (const name of ['Genealogy', 'Worldbuilding', 'Primary Sources', 'Testimony', 'Prosopography']) {
    assert.ok(home.includes(`<h3>${name}</h3>`), `the remaining vaults include ${name}`);
  }
  // the six tools the desktop app actually ships (src/navigation.ts TOOLKIT_TOOLS)
  for (const tool of ['PDF Presenter', 'Nodus Apps', 'Nodus Convert', 'Nodus Protect', 'Nodus Translate', 'OCR Workspace']) {
    assert.ok(home.includes(`<h3>${tool}</h3>`), `the toolkit section includes ${tool}`);
  }
  // every vault mode ships today, so no page may still call one of them unreleased
  assert.doesNotMatch(home, /Building|On the roadmap|Coming soon|are being built/, 'no vault is described as unreleased');
  assert.doesNotMatch(home, /at no extra cost/, 'the toolkit no longer needs the price disclaimer');
  // the vault demos advertised on the home page must exist
  for (const demo of ['index', 'teaching', 'study', 'databases', 'genealogy', 'worldbuilding']) {
    const href = demo === 'index' ? 'demo/' : `demo/${demo}.html`;
    assert.ok(home.includes(href), `the home page links the ${demo} demo`);
    assert.ok(fs.existsSync(path.join(siteRoot, 'demo', `${demo}.html`)), `site/demo/${demo}.html exists`);
  }
});

test('the way into the app sits with the licence band, not in a section of its own', () => {
  const home = read('index.html');
  // The page used to close on a second "Point it at your own library" statement
  // carrying the same two buttons. One call to action, in the band that already
  // says the app is free and local-first.
  assert.ok(!home.includes('class="final'), 'the separate closing section is gone');
  assert.ok(!home.includes('Point it at your own library'), 'and so is its heading');

  const band = home.slice(home.indexOf('<section class="band'));
  const section = band.slice(0, band.indexOf('</section>'));
  assert.match(section, /Free to use\. Yours to keep\./, 'the band still makes its statement');
  assert.match(section, /<div class="ctas">/, 'the band carries the buttons');
  assert.match(section, /href="demo\/"/, 'one of them opens the live demo');
  assert.match(section, /data-download/, 'the other one downloads the app');
  assert.equal((section.match(/data-download/g) ?? []).length, 1, 'the app is offered once, not twice');
});

test('the band pills hold one line while they fit, and give way as the window narrows', () => {
  const css = fs.readFileSync(path.join(siteRoot, 'assets', 'css', 'nodus.css'), 'utf8');
  const pills = css.match(/\.band \.pills \{[^}]*\}/)?.[0];
  const pill = css.match(/\.band \.pill \{[^}]*\}/)?.[0];
  assert.ok(pills && pill, 'the band pills are still styled');
  // One row until it cannot be one row: the row wraps, and each pill gives back
  // type and padding against the viewport before a pill is pushed to a line alone.
  assert.match(pills, /flex-wrap: wrap/);
  assert.match(pills, /justify-content: center/);
  assert.match(pill, /font-size: clamp\(/);
  assert.match(pill, /padding: clamp\([^)]*\) clamp\(/);
  // A pill is one label; it must never wrap its own text into two lines.
  assert.match(pill, /white-space: nowrap/);
});

test('every live demo can switch directly to every other demo vault', () => {
  const demoPages = ['index.html', 'teaching.html', 'study.html', 'databases.html', 'genealogy.html', 'worldbuilding.html'];
  const switcher = read('demo/vault-switcher.js');

  for (const page of demoPages) {
    assert.match(read(`demo/${page}`), /src="vault-switcher\.js\?v=/, `${page} loads the shared vault switcher`);
    assert.ok(switcher.includes(`page: '${page}'`), `${page} is offered by the vault panel`);
  }
  assert.match(switcher, /aria-expanded="false" aria-haspopup="menu"/, 'the centred badge exposes its menu state');
  assert.match(switcher, /role="menuitem"/, 'each demo vault is keyboard reachable');
  assert.match(switcher, /event\.key === 'Escape'/, 'Escape closes the vault panel');
  for (const icon of ['network', 'presentation', 'graduation', 'table', 'tree', 'globe']) {
    assert.match(switcher, new RegExp(`icon: '${icon}'`), `the switcher uses the app's ${icon} icon`);
  }
  assert.doesNotMatch(switcher, /symbol:/, 'no substitute text symbols remain in the switcher');
});

test('the academic web demo mirrors the current desktop navigation', () => {
  const app = read('demo/app.js');
  for (const group of ['Explore', 'Analyze', 'Write', 'Tools']) {
    assert.ok(app.includes(`{ group: '${group}' }`), `the academic demo includes the ${group} group`);
  }
  for (const [id, label] of [
    ['research', 'State of the art'],
    ['workspace', 'Workspace'],
    ['browser', 'Nodus Browser'],
    ['toolkit', 'Nodus Toolkit'],
  ]) {
    assert.match(app, new RegExp(`id: '${id}', label: '${label}'`), `${label} is a current sidebar destination`);
  }
  for (const obsolete of [
    "{ id: 'study', label: 'Study'",
    "{ id: 'gaps', label: 'Gaps'",
    "{ id: 'debate', label: 'Debates'",
    "{ id: 'coverage', label: 'Coverage'",
    "{ id: 'notes', label: 'Notes'",
  ]) {
    assert.ok(!app.includes(obsolete), `${obsolete} is no longer a standalone sidebar entry`);
  }
  assert.match(app, /aria-label="State of the art views"/, 'coverage, debates and gaps live in one tabbed workspace');
});

test('no page of the site loads a third-party tracker', () => {
  // the site carries no analytics container, and a page added later must not
  // quietly bring one back, so the whole tree is checked rather than page by page
  const pages = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) pages.push(full);
    }
  };
  walk(siteRoot);
  assert.ok(pages.length >= 12, 'the walk found the pages of the site');

  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    const name = path.relative(siteRoot, page);
    assert.doesNotMatch(html, /googletagmanager\.com/, `${name} loads no Tag Manager container`);
    assert.doesNotMatch(html, /google-analytics\.com|gtag\(/, `${name} loads no Google Analytics`);
    assert.doesNotMatch(html, /dataLayer/, `${name} declares no analytics dataLayer`);
    assert.doesNotMatch(html, /Google Tag Manager/, `${name} keeps no leftover GTM markers`);
  }
});

test('the tutorial gallery lives in the wiki and is generated from the file the desktop app also reads', () => {
  const script = read('wiki/wiki.js');
  assert.match(script, /fetch\('\.\.\/tutorials\.json'\)/);
  assert.match(script, /id: 'videos'/, 'the wiki exposes a Video tutorials page');
  assert.doesNotMatch(read('assets/js/home.js'), /tutorials\.json/, 'the home page no longer carries the gallery');
  const tutorials = JSON.parse(read('tutorials.json'));
  const titled = [...script.matchAll(/^\s{2}(?:'([a-z-]+)'|([a-z]+)): \[/gm)].map((match) => match[1] ?? match[2]);
  for (const video of tutorials.videos) {
    assert.ok(titled.includes(video.id), `the wiki gives the ${video.id} tutorial an English title`);
    assert.match(video.youtubeId, /^[\w-]{11}$/, `${video.id} has a valid YouTube id`);
  }
  assert.match(script, /youtube-nocookie\.com\/embed\//, 'the modal player uses the no-cookie host');
  assert.match(script, /\$\('iframe', modal\)\.src = ''/, 'closing the modal stops playback');
});

test('the FAQ moved to its own page with every question intact', () => {
  const data = read('faq/faq-data.js');
  const window = {};
  new Function('window', data)(window);
  assert.ok(window.FAQ_ENTRIES.length >= 20, 'every published question survived the move');
  const ids = window.FAQ_ENTRIES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'question ids are unique, so each one is linkable');

  const categories = new Set(window.FAQ_CATEGORIES.map((category) => category.id));
  assert.ok(categories.has('all'), 'the category row starts with All');
  for (const entry of window.FAQ_ENTRIES) {
    assert.ok(entry.q && entry.a, `${entry.id} has a question and an answer`);
    assert.ok(categories.has(entry.cat), `${entry.id} uses a declared category`);
  }
});

test('the blog engine ships with an index, static pages, a renderer and a template, and no stray posts', () => {
  for (const entry of ['blog/index.html', 'blog/post.html', 'blog/blog.js', 'blog/markdown.js', 'blog/posts.json', 'blog/feed.xml']) {
    assert.ok(fs.existsSync(path.join(siteRoot, entry)), `site/${entry} exists`);
  }
  assert.ok(fs.existsSync(path.join(siteRoot, 'blog/posts/_template.md')), 'the post template documents how to add one');

  const index = JSON.parse(read('blog/posts.json'));
  assert.ok(Array.isArray(index.posts), 'posts.json exposes a posts array');
  assert.ok(index.$comment.includes('posts/<slug>.md'), 'posts.json documents its own format');

  // every listed post must have its Markdown, and every Markdown file must be listed
  const files = fs.readdirSync(path.join(siteRoot, 'blog/posts'))
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .map((name) => name.replace(/\.md$/, ''));
  for (const post of index.posts) {
    assert.ok(files.includes(post.slug), `posts/${post.slug}.md exists`);
    assert.match(post.date, /^\d{4}-\d{2}-\d{2}$/, `${post.slug} has an ISO date`);
    assert.ok(post.title && post.summary, `${post.slug} has a title and a summary`);
    if (!post.draft) {
      assert.ok(fs.existsSync(path.join(siteRoot, 'blog', post.slug, 'index.html')), `blog/${post.slug}/index.html is generated`);
    }
  }
  for (const slug of files) {
    assert.ok(index.posts.some((post) => post.slug === slug), `posts/${slug}.md is listed in posts.json`);
  }

  // the feed is generated, so it must agree with the index it was generated from
  const feed = read('blog/feed.xml');
  const published = index.posts.filter((post) => !post.draft);
  assert.equal((feed.match(/<item>/g) ?? []).length, published.length, 'feed.xml is in step with posts.json — run npm run blog:feed');
});

test('the blog renders Markdown without letting a post inject markup', () => {
  const window = {};
  new Function('window', read('blog/markdown.js'))(window);
  const { render } = window.NodusMarkdown;

  const basics = render('## Heading\n\nText with `code`, **bold** and a [link](https://example.com).\n\n- one\n- two\n');
  assert.match(basics.html, /<h2 id="heading">Heading<\/h2>/);
  assert.match(basics.html, /<code>code<\/code>/);
  assert.match(basics.html, /<strong>bold<\/strong>/);
  assert.match(basics.html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener">link<\/a>/);
  assert.match(basics.html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.deepEqual(basics.headings, [{ level: 2, text: 'Heading', id: 'heading' }]);

  // a digit surrounded by spaces must never be mistaken for a code-span placeholder
  assert.match(render('It takes 5 minutes.').html, /It takes 5 minutes\./);
  // raw HTML in a post is escaped, never executed
  assert.match(render('<script>alert(1)</script>').html, /&lt;script&gt;/);
  assert.doesNotMatch(render('<img src=x onerror=alert(1)>').html, /<img src=x/);
});

test('the source files carry no stray NUL bytes', () => {
  // markdown.js delimits its code-span placeholders with NUL escapes; writing the
  // byte itself would make git treat the file as binary.
  for (const relative of ['blog/markdown.js', 'blog/blog.js', 'assets/js/organism.js', 'assets/js/site.js', 'assets/js/home.js', 'assets/js/research-atlas.js']) {
    assert.ok(!fs.readFileSync(path.join(siteRoot, relative)).includes(0), `site/${relative} is plain text`);
  }
});

test('the organism degrades for visitors who cannot or do not want to run it', () => {
  const organism = read('assets/js/organism.js');
  assert.match(organism, /prefers-reduced-motion: reduce/, 'reduced motion is honoured');
  assert.match(organism, /organism-fallback/, 'a static background replaces the canvas');
  assert.match(organism, /document\.hidden.*organism\.stop|if \(document\.hidden\) organism\.stop\(\)/s, 'a hidden tab stops the loop');
  assert.match(read('assets/css/nodus.css'), /\.organism-fallback \{/, 'the fallback is styled');

  const site = read('assets/js/site.js');
  assert.match(site, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/, 'reveals and the cursor respect reduced motion');

  // every page that paints the organism has to provide its canvas
  for (const page of ['index.html', 'about/index.html', 'app/index.html', 'apps/index.html', 'cite/index.html', 'research-atlas/index.html', 'faq/index.html', 'blog/index.html', 'blog/post.html', 'contribute/index.html', 'wiki/index.html', 'research/index.html', 'zotero/index.html', 'ai-research/index.html', 'open-source/index.html']) {
    assert.ok(read(page).includes('<canvas id="organism" aria-hidden="true"></canvas>'), `${page} carries the organism canvas`);
  }

  // Legal documents deliberately use a sober, static document layout.
  for (const page of ['legal/index.html', 'privacy/index.html', 'cookies/index.html']) {
    assert.ok(!read(page).includes('<canvas id="organism"'), `${page} carries no decorative organism canvas`);
  }
});

test('the home page opens with the mark forming, and can never strand a visitor', () => {
  const home = read('index.html');
  const css = read('assets/css/home.css');
  const script = read('assets/js/home.js');

  // armed before the first paint, so the page never flashes and then hides
  assert.match(home, /classList\.add\('intro-armed'\)/, 'the opening is armed inline in <head>');
  assert.match(home, /min-width: 701px/, 'the opening is never armed in a mobile viewport');
  assert.match(home, /prefers-reduced-motion: reduce/, 'reduced motion never arms the opening');
  // the same inline script owns a watchdog, so a missing home.js cannot leave a blank page
  assert.match(home, /setTimeout\(function \(\) \{[\s\S]*?intro-done[\s\S]*?\}, 6000\)/, 'the inline watchdog reveals the page on its own');
  assert.match(css, /body \{[\s\S]*?radial-gradient[\s\S]*?background-attachment: fixed;/, 'a finished-looking background exists before WebGL starts');
  assert.match(css, /#organism \{ transition-duration: 0\.3s; \}/, 'the live field replaces the static paint quickly');
  assert.match(script, /organism-assembled/, 'the release starts only after the field has finished assembling the mark');
  assert.match(script, /const onAssembled = \(\) => \{\s*if \(finished\) return;\s*release\(\);\s*\};/, 'the completed mark returns to the node flow immediately');
  assert.doesNotMatch(script, /engine\.pulse\(innerWidth/, 'the completed mark flows away instead of exploding outward');
  assert.match(read('assets/js/organism.js'), /dataset\.formation === 'on' && openingIsArmed/, 'mobile and unarmed visits never assemble a hidden N');
  assert.match(css, /\.hero \{[\s\S]*?-webkit-user-select: none;[\s\S]*?user-select: none;/, 'visible hero copy cannot be accidentally selected');
  // And neither can the rest of the page: the whole homepage is a surface, not a
  // document. The rule lives in home.css, which only the homepage loads, so inner
  // pages keep their text selectable — and the escape hatch for a field is there
  // for whenever the homepage grows one.
  assert.match(css, /body \{\s*-webkit-user-select: none;\s*user-select: none;\s*\}/, 'nothing on the home page can be selected');
  assert.match(css, /input,\s*textarea,\s*select,\s*\[contenteditable\] \{\s*-webkit-user-select: text;\s*user-select: text;\s*\}/, 'a field would still take text');
  for (const page of ['research/index.html', 'faq/index.html', 'contribute/index.html']) {
    assert.doesNotMatch(read(page), /home\.css/, `${page} does not turn the rule on for itself`);
  }

  // three separately masked lines, one per beat of the motto
  assert.equal((home.match(/<span class="line"><i>/g) ?? []).length, 3, 'the motto is three animated lines');
  assert.match(css, /\.hero-title \.line \{ display: block; overflow: hidden;/, 'each line is masked');
  for (const nth of [1, 2, 3]) {
    assert.match(css, new RegExp(`\\.hero-title \\.line:nth-child\\(${nth}\\) > i \\{ animation-delay:`), `line ${nth} has its own delay`);
  }

  // the rest of the page waits behind the mark
  assert.match(css, /\.intro-armed[\s\S]*?main > section,[\s\S]*?\{ opacity: 0; \}/, 'the page below the hero is held back');
  assert.match(css, /html\.intro-armed \{ overflow: hidden; \}/, 'scroll is locked while it plays');
  assert.match(css, /scrollbar-gutter: stable/, 'locking scroll must not shift the layout');
  assert.match(css, /@media \(max-width: 700px\), \(hover: none\) and \(pointer: coarse\) \{\s*\.hero \.n-mark \{ animation: none; \}/, 'the N mark stays still on mobile devices');

  // and it is always escapable
  assert.match(script, /skip\.className = 'intro-skip'/, 'a skip control is offered');
  assert.match(script, /if \(scrollY > 40 \|\| location\.hash\) \{ finish\(\); return; \}/, 'a deep link skips the sequence');
  assert.match(script, /addEventListener\('keydown', onKey\)/, 'any key ends it');
});

test('Nodus Research is the project and Nodus is the application', () => {
  const home = read('index.html');
  assert.match(home, /<title>Nodus Research \| Open Source Research Workspace<\/title>/);
  assert.match(home, /<h1 class="hero-name">Nodus Research<\/h1>/);
  assert.match(home, /<meta property="og:site_name" content="Nodus Research"\/>/);

  const structuredData = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const website = structuredData['@graph'].find((entry) => entry['@type'] === 'WebSite');
  const software = structuredData['@graph'].find((entry) => entry['@type'] === 'SoftwareApplication');
  assert.equal(website.name, 'Nodus Research');
  assert.deepEqual(website.alternateName, ['nodusresearch.com']);
  assert.equal(software.name, 'Nodus');
  assert.equal(Object.hasOwn(software, 'alternateName'), false);
  assert.equal(software.url, 'https://nodusresearch.com/app/');

  for (const page of ['app/index.html', 'research/index.html', 'zotero/index.html', 'ai-research/index.html', 'open-source/index.html']) {
    const html = read(page);
    assert.match(html, /<meta property="og:site_name" content="Nodus Research"\/>/, `${page} names the project as its site`);
    assert.match(html, /<a class="logo" href="\.\.\/"><img[^>]+\/> Nodus Research<\/a>/, `${page} links its footer brand to the project home`);
  }

  const app = read('app/index.html');
  assert.match(app, /Nodus is the desktop application developed within the Nodus Research project\./);
  const appStructuredData = JSON.parse(app.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(appStructuredData['@graph'].find((entry) => entry['@type'] === 'SoftwareApplication')['@id'], 'https://nodusresearch.com/#software');

  const research = read('research/index.html');
  assert.match(research, /<h1[^>]*>Academic Research with Nodus Research<\/h1>/);
  for (const page of ['research/index.html', 'zotero/index.html', 'ai-research/index.html', 'open-source/index.html']) {
    assert.match(read(page), /<a href="\.\.\/">Nodus Research<\/a>[\s\S]*?<span class="sep"/, `${page} uses the project name in its breadcrumb`);
  }
});

// The long-form product and topic pages, and the URL each one is published at.
const TOPIC_PAGES = [
  ['about/index.html', 'https://nodusresearch.com/about/'],
  ['app/index.html', 'https://nodusresearch.com/app/'],
  ['apps/index.html', 'https://nodusresearch.com/apps/'],
  ['research/index.html', 'https://nodusresearch.com/research/'],
  ['zotero/index.html', 'https://nodusresearch.com/zotero/'],
  ['zotero-plugin/index.html', 'https://nodusresearch.com/zotero-plugin/'],
  ['ai-research/index.html', 'https://nodusresearch.com/ai-research/'],
  ['open-source/index.html', 'https://nodusresearch.com/open-source/'],
];

test('the topic pages are indexable, canonical and described only once each', () => {
  const titles = new Set();
  const descriptions = new Set();

  for (const [page, url] of TOPIC_PAGES) {
    const html = read(page);
    assert.ok(html.includes(`<link rel="canonical" href="${url}"/>`), `${page} declares its canonical URL`);
    assert.ok(html.includes(`<meta property="og:url" content="${url}"/>`), `${page} declares its Open Graph URL`);
    assert.match(html, /<meta name="twitter:card"/, `${page} carries Twitter card metadata`);
    // a stray noindex here would quietly undo the whole point of the page
    assert.doesNotMatch(html, /content="[^"]*noindex/, `${page} is not marked noindex`);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${page} has exactly one h1`);
    assert.ok((html.match(/<h2[ >]/g) ?? []).length >= 3, `${page} builds a real heading hierarchy`);

    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    const description = html.match(/<meta name="description" content="([^"]+)"/)[1];
    assert.ok(!titles.has(title), `${page} has a title of its own`);
    assert.ok(!descriptions.has(description), `${page} has a description of its own`);
    titles.add(title);
    descriptions.add(description);

    // structured data has to parse, or search engines silently drop it
    for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => JSON.parse(block[1]), `${page} ships valid JSON-LD`);
    }
    assert.match(html, /"@type": "BreadcrumbList"/, `${page} declares its place in the hierarchy`);
  }
});

test('the topic pages are linked from the home page and to each other', () => {
  const home = read('index.html');
  for (const href of ['about/', 'app/', 'apps/', 'research/', 'zotero/', 'zotero-plugin/', 'ai-research/', 'open-source/']) {
    assert.ok(home.includes(`href="${href}"`), `the home page links to /${href}`);
  }
  // descriptive anchors, not "click here" — the anchor text is the link's whole signal
  assert.match(home, /Nodus for academic research/, 'the home page names the research page');

  const links = {
    'about/index.html': ['../app/', '../apps/', '../cite/', '../open-source/'],
    'app/index.html': ['../about/', '../apps/', '../research/', '../zotero/', '../zotero-plugin/', '../ai-research/', '../open-source/', '../faq/', '../wiki/'],
    'apps/index.html': ['../about/', '../app/#download', '../research/'],
    'research/index.html': ['../about/', '../apps/', '../zotero/', '../ai-research/', '../open-source/'],
    'zotero/index.html': ['../about/', '../apps/', '../research/', '../zotero-plugin/', '../open-source/'],
    'zotero-plugin/index.html': ['../about/', '../app/', '../research/', '../zotero/', '../ai-research/', '../open-source/'],
    'ai-research/index.html': ['../about/', '../apps/', '../research/', '../zotero/', '../zotero-plugin/#workflows', '../open-source/'],
    'open-source/index.html': ['../about/', '../apps/', '../research/', '../zotero/', '../ai-research/'],
  };
  for (const [page, required] of Object.entries(links)) {
    const html = read(page);
    for (const href of required) {
      assert.ok(html.includes(`href="${href}"`), `${page} links to ${href}`);
    }
    assert.ok(html.includes('href="../"'), `${page} links back to the canonical home page`);
  }
});

test('internal navigation only advertises canonical directory URLs', () => {
  const publishedSources = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:html|js)$/.test(entry.name)) publishedSources.push(fs.readFileSync(absolute, 'utf8'));
    }
  };
  visit(siteRoot);
  publishedSources.push(fs.readFileSync(path.join(repoRoot, 'scripts', 'build-blog-pages.mjs'), 'utf8'));

  for (const source of publishedSources) {
    assert.doesNotMatch(source, /href\s*=\s*["'][^"']*index\.html/i, 'no rendered or generated link points to an index filename');
  }

  const header = read('site-header.js');
  assert.match(header, /href: \(base\) => base \|\| '\.\/'/, 'the shared Home link resolves to the canonical directory');
  assert.match(header, /pathname\.endsWith\('\/index\.html'\)[\s\S]*?location\.replace/, 'GitHub Pages index aliases are replaced client-side');

  const demoSwitcher = read('demo/vault-switcher.js');
  assert.match(demoSwitcher, /\{ page: 'index\.html', href: '\.\/'/, 'the academic demo advertises its directory URL');
  assert.match(demoSwitcher, /href="\$\{vault\.href \|\| vault\.page\}"/, 'the demo switcher uses a canonical override when one exists');
});

test('the sitemap lists every static page of the site', () => {
  const sitemap = read('sitemap.xml');
  for (const url of [
    'https://nodusresearch.com/',
    'https://nodusresearch.com/about/',
    'https://nodusresearch.com/research-atlas/',
    'https://nodusresearch.com/app/',
    'https://nodusresearch.com/apps/',
    'https://nodusresearch.com/research/',
    'https://nodusresearch.com/zotero/',
    'https://nodusresearch.com/zotero-plugin/',
    'https://nodusresearch.com/ai-research/',
    'https://nodusresearch.com/open-source/',
    'https://nodusresearch.com/wiki/',
    'https://nodusresearch.com/faq/',
    'https://nodusresearch.com/cite/',
    'https://nodusresearch.com/contribute/',
  ]) {
    assert.ok(sitemap.includes(`<loc>${url}</loc>`), `the sitemap lists ${url}`);
  }
  // robots must keep the whole site crawlable and point at that sitemap
  const robots = read('robots.txt');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.doesNotMatch(robots, /^Disallow: \/\s*$/m, 'nothing blocks the crawlers');
  assert.match(robots, /Sitemap: https:\/\/nodusresearch\.com\/sitemap\.xml/);
});

test('the app page documents the current desktop builds and available vaults', () => {
  const app = read('app/index.html');
  for (const asset of [
    'Nodus-mac-arm64.dmg',
    'Nodus-mac-x64.dmg',
    'Nodus-win-x64.exe',
    'Nodus-linux-x86_64.AppImage',
    'Nodus-linux-amd64.deb',
    'Nodus-linux-x86_64.rpm',
  ]) {
    assert.match(app, new RegExp(`https://github\\.com/jorgepb96/nodus/releases/latest/download/${asset.replaceAll('.', '\\.')}`), `${asset} uses the stable release URL`);
  }
  for (const vault of ['Academic', 'Teaching', 'Study', 'Databases', 'Genealogy', 'Worldbuilding', 'Primary Sources', 'Testimony', 'Prosopography']) {
    assert.match(app, new RegExp(`\\b${vault}\\b`), `${vault} is represented on the app page`);
  }
  assert.match(app, /"@type": "SoftwareApplication"/, 'the app page identifies the downloadable software');
  assert.match(app, /"operatingSystem": "macOS, Windows, Linux"/, 'structured data names every supported platform');
});

test('every page is reachable by keyboard and readable by a screen reader', () => {
  for (const page of ['index.html', 'about/index.html', 'app/index.html', 'apps/index.html', 'cite/index.html', 'legal/index.html', 'research-atlas/index.html', 'faq/index.html', 'blog/index.html', 'blog/post.html', 'contribute/index.html', 'research/index.html', 'zotero/index.html', 'zotero-plugin/index.html', 'ai-research/index.html', 'open-source/index.html']) {
    const html = read(page);
    assert.match(html, /class="skip-link" href="#/, `${page} offers a skip link`);
    assert.match(html, /<html lang="en">/, `${page} declares its language`);
    assert.match(html, /<meta name="description"/, `${page} has a description`);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${page} has exactly one h1`);
  }
});

test('Support Nodus takes the money the app takes, and names people only', () => {
  const html = read('contribute/index.html');
  const script = read('contribute/contribute.js');
  const settings = read('../src/views/Settings.tsx');
  const funding = read('../.github/FUNDING.yml');

  // The three ways in are the destinations the desktop app already opens, so a
  // renamed handle can never survive on one surface and rot on the other.
  for (const url of ['https://ko-fi.com/nodus_app', 'https://paypal.me/Jorgepb96']) {
    assert.ok(html.includes(`href="${url}"`), `the page links to ${url}`);
    assert.ok(settings.includes(url), `the desktop app opens the same ${url}`);
  }
  assert.match(html, /href="https:\/\/github\.com\/sponsors\/jorgepb96"/, 'the page links to GitHub Sponsors');
  assert.match(funding, /^github: jorgepb96$/m, 'the sponsor account matches the funding file');

  // The owner opens the wall whatever the counts say, and no assistant or
  // platform account is ever presented as one of the people who built Nodus.
  assert.match(script, /const OWNER = OWNER_LOGIN\.toLowerCase\(\)/, 'the owner is named once and compared in one case');
  assert.match(script, /const OWNER_LOGIN = 'jorgepb96'/, 'the owner login is spelled the way GitHub spells it');
  assert.match(script, /Number\(b\.login\.toLowerCase\(\) === OWNER\)[\s\S]*?Number\(a\.login\.toLowerCase\(\) === OWNER\)/,
    'the owner is ranked ahead of every contribution count');
  const source = script.match(/const NOT_PEOPLE = (\/[^\n]+?\/i);/)?.[1];
  assert.ok(source, 'the script filters the accounts that are not people');
  const notPeople = new RegExp(source.slice(1, source.lastIndexOf('/')), 'i');
  for (const login of ['claude', 'chatgpt', 'github', 'Claude', 'openai', 'copilot']) {
    assert.ok(notPeople.test(login), `${login} is never shown as a contributor`);
  }
  for (const login of ['jorgepb96', 'oguzkarayemis', 'sbvelinga', 'mbradaschia', 'githubber']) {
    assert.ok(!notPeople.test(login), `${login} is a person and must stay visible`);
  }
  assert.match(script, /if \(!people\.length\) return false/, 'an unknown list is reported, never shown as zero');

  // The issues card is the community's: the owner's own issues and pull requests
  // are excluded by the query itself, so the total and the faces agree on who
  // counts. The contributor wall is the opposite case and still opens with them.
  assert.match(script, /repo:jorgepb96\/nodus -author:\$\{OWNER_LOGIN\}/,
    'the issues query leaves the owner out at the source');
  assert.match(script, /ISSUES_CACHE = 'nodus-issues-community'/,
    'the cache key changed with what the card counts');
});

test('the hero planet is generated by code, and never shipped as a picture', () => {
  const html = read('contribute/index.html');
  const script = read('contribute/planet.js');
  const styles = read('contribute/planet.css');

  assert.match(html, /class="hero-planet nodus-planet" data-nodus-planet data-blend="true"/,
    'the hero mounts the planet component');
  assert.match(html, /planet\.js\?v=[^"]+/, 'the page loads the component that draws it');
  assert.match(html, /planet\.css\?v=[^"]+/, 'and the styles that size it');

  // The surface is a fragment shader and the orbit is SVG: both are code, so the
  // planet costs a shader and never a download.
  assert.match(script, /gl\.shaderSource\(s,source\)[\s\S]*gl\.compileShader\(s\)/, 'the surface is compiled from source');
  assert.match(script, /precision highp float/, 'the fragment shader is the real one');
  assert.match(script, /<svg class="np-orbit"/, 'the orbit is drawn as SVG');
  assert.match(script, /window\.NodusPlanet=\{mount,init\}/, 'the component keeps its public API');
  assert.match(styles, /\.nodus-planet \{/, 'the component ships its own scoped styles');

  // A bitmap would betray the rule this test exists to protect: neither the
  // component nor the element that mounts it may reach for a picture. (The page
  // as a whole still names its favicon, which is not the planet.)
  for (const [name, source] of [['the script', script], ['the styles', styles]]) {
    assert.doesNotMatch(source, /\.(?:png|jpe?g|webp|avif|gif)(?:[?"')\s]|$)/i,
      `${name} carries no bitmap`);
  }
  const mount = html.slice(html.indexOf('class="hero-planet'), html.indexOf('class="hero-planet') + 260);
  assert.doesNotMatch(mount, /<img|url\(/, 'the component is mounted on an empty host element');
});

test('every page shows the planet at the Support Nodus size, fixed behind the page', () => {
  const styles = read('contribute/planet.css');
  const support = read('contribute/contribute.css');

  // One measure, declared once and read by every placement. The Support Nodus
  // hero is the look the rest of the site is measured against, and the reading
  // pages used to carry a smaller copy of it (min(680px, 54vw)) that each page
  // drifted away from.
  assert.match(styles, /:root \{ --planet-size: min\(780px, 64vw\); \}/, 'the shared measure is declared once');
  assert.doesNotMatch(`${styles}\n${support}`, /min\(680px/, 'the smaller planet is gone');
  assert.match(support, /\.support-hero \.hero-planet \{[^}]*width: var\(--planet-size\);[^}]*\}/,
    'the Support Nodus hero reads the shared measure');

  const shared = styles.match(/\.has-planet > \.page-planet, \.atlas-main > \.page-planet \{[^}]*\}/)?.[0];
  assert.ok(shared, 'the decoration on the reading pages is still placed');
  assert.match(shared, /width: var\(--planet-size\)/, 'and shows the same size as Support Nodus');
  // A backdrop is fixed to the window, not to the hero it happens to sit in:
  // scrolling used to carry the planet up the page with the rest of the hero.
  assert.match(shared, /position: fixed/, 'the planet stays put while the page scrolls');

  // ...and the graphic never lands on the reading surface. Lifting the sections
  // is what keeps the FAQ filter bar clear of the sphere.
  assert.match(styles, /main > section \{ position: relative; z-index: 1; \}/,
    'the sections of a planet page ride above the planet');

  // Every page that mounts the component loads the stylesheet that places it.
  for (const page of ['contribute/index.html', 'faq/index.html', 'about/index.html', 'blog/index.html', 'research-atlas/index.html']) {
    assert.match(read(page), /planet\.css\?v=[^"]+/, `${page} loads the planet styles`);
    assert.match(read(page), /planet\.js\?v=[^"]+/, `${page} loads the planet component`);
  }
});

test('the research atlas holds its five facets on one row on a desktop screen', () => {
  const css = read('assets/css/research-atlas.css');

  // A pill is as wide as the value picked in it — the chosen value replaces the
  // facet's own name — so a wrapping row re-flowed on every selection and dropped
  // the last pill, and "Clear filters" with it, onto a line of its own.
  const desktop = css.match(/@media \(min-width: 861px\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(desktop, 'the atlas states what its filter row does on a desktop screen');
  assert.match(desktop, /\.atlas-filterbar \{ flex-wrap: nowrap; \}/, 'the facets hold one row');
  // Narrow layouts keep wrapping: below the breakpoint the row cannot hold them.
  assert.match(css, /\.atlas-filterbar \{[\s\S]*?flex-wrap: wrap;[\s\S]*?\}/, 'the narrow layouts still wrap');

  // The row is only able to hold them because it is wider than the search field,
  // which keeps its own measure and stays centred in it...
  assert.match(css, /\.atlas-intro \{ width: min\(100%, 1040px\)/, 'the intro column is sized for the facet row');
  assert.match(css, /\.atlas-searchbar \{[\s\S]*?width: min\(100%, 920px\);[\s\S]*?margin-inline: auto;/, 'the field keeps its measure');
  // ...and because a pill gives way inside itself instead of pushing its
  // neighbour down: it follows the width the row hands it, keeps its name, and
  // ellipsizes the value, which refuses to shrink past a readable stub.
  assert.match(desktop, /\.atlas-facet-button \{ width: 100%; \}/, 'a pill follows the width it is given');
  assert.match(desktop, /\.atlas-facet-value \{ min-width: 2\.4em; \}/, 'a value keeps a readable stub');
  assert.match(css, /\.atlas-facet-button \{[\s\S]*?max-width: 225px/, 'a pill is still capped');
  assert.match(css, /\.atlas-facet-value \{[^}]*text-overflow: ellipsis/, 'its value ellipsizes instead of overflowing');
  assert.match(css, /\.atlas-reset \{[\s\S]*?flex: 0 0 auto; white-space: nowrap;/, 'Clear filters keeps its one line');

  // The row is handed a width, so the pill's floor has to live on the box the
  // row actually hands it to. A flex item will not shrink past its contents
  // unless told to, and this one wraps a button declared `width: 100%`, whose
  // content size resolves back to its own width — which is how the row's
  // minimum came to be five unshrunk pills and the row overflowed its
  // container below ~1015px, cut at both edges because it is centred.
  const wrapper = css.match(/\.atlas-facet \{[^}]*\}/)?.[0];
  assert.ok(wrapper, 'the facet wrapper states its own size');
  assert.match(wrapper, /min-width: 0/, 'the wrapper may be handed a smaller width than its pill wants');
  assert.match(desktop, /\.atlas-facet \{ min-width: calc\(2\.6em \+ 2\.4em \+ 54px\); \}/,
    'and it stops shrinking where the pill stops being usable');
  // The label is the facet's stable name, so it gives way after the value: a
  // smaller shrink weight is what keeps two pills from both reading "Co…".
  assert.match(desktop, /\.atlas-facet-label \{ min-width: 2\.6em; flex-shrink: \.35; \}/,
    'the label outlasts the value when the row is squeezed');
});

test('the atlas engine opens a list the page draws, not one the system paints', () => {
  const css = read('assets/css/research-atlas.css');
  const page = read('research-atlas/index.html');
  const script = read('assets/js/research-atlas.js');
  const bookmarks = fs.readFileSync(path.join(repoRoot, 'src', 'components', 'browser', 'NodusBookmarks.css'), 'utf8');

  // The engine list ("Directory", "Google", …) was a <select>, and the platform
  // painted its popup from its own appearance setting: a dark page opened a
  // light menu, and `color-scheme: dark` reached the closed control and every
  // <option>'s computed style without reaching the popup. No <select> may come
  // back, because no declaration on the page can dress one.
  assert.doesNotMatch(page, /<select/, 'the atlas no longer hands a popup to the platform');
  assert.match(page, /<div class="atlas-engine-menu"[^>]*role="listbox"/, 'the engine list is the page\'s own');
  assert.match(page, /id="atlas-engine"[^>]*aria-haspopup="listbox"/, 'the control announces the list it opens');

  // Drawn here, so it is dark by construction: the same dark surface the facet
  // panels use, and its own tick instead of the platform's checkmark.
  assert.match(css, /\.atlas-engine-menu \{[\s\S]*?background: rgba\(10,8,19,\.97\)/,
    'the engine list carries the atlas surface');
  assert.match(css, /\.atlas-engine-menu \{[\s\S]*?border: 1px solid var\(--membrane\)/,
    'and the atlas border');
  assert.match(css, /\.atlas-engine-tick \{[\s\S]*?opacity: 0;/, 'the tick is drawn, hidden by default');
  assert.match(css, /\.atlas-engine-option\.is-selected \.atlas-engine-tick \{ opacity: 1; \}/,
    'and shown on the chosen engine');
  assert.match(css, /\.atlas-engine-menu \{[^}]*z-index: 70/, 'the list rides above the facet row');
  assert.match(css, /\.atlas-searchbar \{[\s\S]*?position: relative; z-index: 20;/,
    'the bar its list hangs from is raised with it');
  assert.doesNotMatch(css, /#fff|#111/, 'no light menu is left in the atlas styles');

  // The list is built from one list of engines, and the choice decides what the
  // field promises to do.
  assert.match(script, /const ENGINES = \[/, 'the engines live in one list');
  assert.match(script, /function renderEngineMenu\(\)/, 'the list is rendered from it');
  assert.match(script, /function chooseEngine\(value\)/, 'choosing one is a single path');

  // That stylesheet also reaches the app: its start pages read it directly
  // (NodusBookmarks.css imports it) and dress their facet buttons with the same
  // pill. The app has no engine control of its own, only a static label.
  assert.match(bookmarks, /@import url\('\.\.\/\.\.\/\.\.\/site\/assets\/css\/research-atlas\.css'\)/,
    'the in-app start pages import the atlas stylesheet');
  assert.match(bookmarks, /--raised: ?#100d1c;/, 'the imported tokens resolve inside the app as well');
});

test('every stylesheet the site serves actually parses', () => {
  // Nothing else here parses CSS. Every other assertion about these files is a
  // regular expression, so a sheet with an unbalanced brace satisfies all of
  // them and ships — which is exactly what happened: a stray `}` left in
  // research-atlas.css passed this whole file, and was caught only by the app's
  // Vite build, which is not on the site's own path to production.
  const require = createRequire(import.meta.url);
  const { parse } = require('postcss');
  const stylesheets = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.css')) stylesheets.push(full);
    }
  };
  walk(path.join(siteRoot, 'assets/css'));
  assert.ok(stylesheets.length > 0, 'the site ships stylesheets to check');
  for (const sheet of stylesheets) {
    const relative = path.relative(siteRoot, sheet);
    assert.doesNotThrow(() => parse(fs.readFileSync(sheet, 'utf8'), { from: sheet }),
      `site/${relative} parses`);
  }
});
