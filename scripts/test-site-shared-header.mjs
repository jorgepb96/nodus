import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const headerScript = read('site/site-header.js');
const headerStyles = read('site/site-header.css');
const systemStyles = read('site/assets/css/nodus.css');

// Pages that carry the site design system and get the header from nodus.css.
const systemPages = [
  ['site/index.html', 'home', ''],
  ['site/research-atlas/index.html', 'atlas', '../'],
  ['site/research/index.html', 'research', '../'],
  ['site/zotero/index.html', 'zotero', '../'],
  ['site/ai-research/index.html', 'ai-research', '../'],
  ['site/open-source/index.html', 'open-source', '../'],
  ['site/faq/index.html', 'faq', '../'],
  ['site/models/index.html', 'models', '../'],
  ['site/blog/index.html', 'blog', '../'],
  ['site/blog/post.html', 'blog', '../'],
  ['site/contribute/index.html', 'contribute', '../'],
  // the wiki carries the design system as well; it only adds a docs layout on top
  ['site/wiki/index.html', 'wiki', '../'],
];

// Pages that are not part of the marketing site and load site-header.css instead.
const standalonePages = [
  ['site/demo/index.html', 'demo', '../'],
  ['site/demo/teaching.html', 'demo', '../'],
  ['site/demo/study.html', 'demo', '../'],
  ['site/demo/genealogy.html', 'demo', '../'],
  ['site/demo/databases.html', 'demo', '../'],
  ['site/demo/worldbuilding.html', 'demo', '../'],
];

test('every page mounts the one shared header and marks its own destination', () => {
  for (const [relative, page, base] of [...systemPages, ...standalonePages]) {
    const html = read(relative);
    assert.match(
      html,
      new RegExp(`data-nodus-site-header data-base="${base.replace(/\//g, '\\/').replace(/\./g, '\\.')}"[^>]*data-page="${page}"`),
      `${relative} mounts the shared header as the ${page} page`,
    );
    assert.match(html, new RegExp(`src="${base.replace(/\//g, '\\/').replace(/\./g, '\\.')}site-header\\.js\\?v=[^"]+"`), `${relative} loads the shared header component`);
    assert.doesNotMatch(html, /class="site-nav"|id="site-stars"/, `${relative} has no legacy duplicate header`);
    assert.doesNotMatch(html, /api\.github\.com\/repos\/jorgepb96\/nodus/, `${relative} delegates header data loading to the component`);
  }
});

test('the design-system pages take the header from nodus.css, and only the others load site-header.css', () => {
  for (const [relative] of systemPages) {
    const html = read(relative);
    assert.match(html, /assets\/css\/nodus\.css\?v=[^"]+/, `${relative} loads the design system`);
    assert.doesNotMatch(html, /site-header\.css/, `${relative} must not load the standalone header styles as well`);
  }
  for (const [relative] of standalonePages) {
    const html = read(relative);
    assert.match(html, /site-header\.css\?v=[^"]+/, `${relative} loads the standalone header styles`);
    assert.doesNotMatch(html, /assets\/css\/nodus\.css/, `${relative} keeps its own stylesheet`);
  }
});

test('the shared component owns every control visible in the header', () => {
  for (const token of [
    'class="gh-badge"',
    'id="release-downloads"',
    'id="site-nav-toggle"',
    'Try the live demo',
  ]) assert.ok(headerScript.includes(token), `shared header includes ${token}`);
  assert.equal((headerScript.match(/return `<nav class="nav/g) ?? []).length, 1);
  assert.match(headerScript, /class="nav\$\{isWiki \? ' wiki-nav' : ''\}" id="site-header"/);
  assert.match(headerScript, /data-nodus-browser-bookmarks hidden/, 'Bookmarks is an inert prepared slot in ordinary browsers');
  // The downloads chip counts what the releases page holds, but a click on it
  // asks for the builds: the header hands the click to the dialog the Download
  // button opens, and only while that dialog exists — the href stays the
  // destination for the pages without one and for a modifier-click that asks
  // for the releases page in a new tab. The chip only calls itself a dialog
  // opener on the pages that can answer with one.
  assert.match(headerScript, /const opensDialog = \(\) => typeof window\.openDl === 'function';/,
    'the chip falls back to the releases link where the page has no dialog');
  assert.match(headerScript, /downloads\.setAttribute\('aria-haspopup', 'dialog'\)/,
    'and only calls itself a dialog opener where the page publishes one');
  assert.match(headerScript, /if \(event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey\) return;/,
    'a modifier-click keeps its meaning: the releases page, in a new tab');
  // Destination order is part of the design, so it is asserted as a whole
  // rather than one label at a time. The browser-only Bookmarks slot sits
  // immediately ahead of Wiki, the way the Nodus Browser start page orders them.
  const destinations = [...headerScript.matchAll(/\{ id: '([a-z]+)', label: '([^']+)'/g)].map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(
    destinations,
    [
      'home:Home',
      'bookmarks:Bookmarks',
      'wiki:Wiki',
      'blog:Blog',
      'atlas:Atlas',
      'faq:FAQ',
      'models:Models',
      'contribute:Support',
    ],
    'the header reads Home, Wiki, Blog, Atlas, FAQ, Models, Support',
  );
});

test('the redesign is English only, so the header carries no language switcher', () => {
  for (const token of ['lang-trigger', 'lang-menu', 'data-i18n', 'LANGUAGES']) {
    assert.ok(!headerScript.includes(token), `shared header no longer ships ${token}`);
  }
  for (const [relative] of systemPages) {
    assert.doesNotMatch(read(relative), /data-i18n/, `${relative} carries no translation hooks`);
  }
});

test('both header stylesheets keep the same fixed dimensions and breakpoint', () => {
  // nodus.css drives the marketing pages, site-header.css the wiki and demos:
  // they must not drift apart or the chrome jumps when a visitor moves between them.
  assert.match(systemStyles, /--nav-h:\s*62px;/);
  assert.match(headerStyles, /\.nav \{[\s\S]*?height: 62px;/);
  for (const styles of [systemStyles, headerStyles]) {
    assert.match(styles, /@media \(max-width: 1320px\) \{[\s\S]*?\.nav-toggle \{ display: block/);
    assert.match(styles, /\.nav \.links > a\.link\[aria-current="page"\]/);
    // The active destination keeps the brand violet in both. In nodus.css it used
    // to read --accent, which the page retunes per section: that turned the wiki's
    // underline orange (on the Teaching manual) and the FAQ's cyan.
    const underline = styles.match(/\.nav \.links > a\.link\[aria-current="page"\]::after \{[\s\S]*?\n\}/)?.[0];
    assert.ok(underline, 'both stylesheets underline the active destination');
    assert.match(underline, /background: (?:var\(--violet-2\)|#a78bfa)/,
      'the underline is the site violet, never the section accent');
    // The browser-only Bookmarks slot is removed with the hidden attribute, and a
    // class that sets `display` outranks the user-agent rule for it, so both
    // stylesheets have to neutralize it or the demo pages show a dead link.
    assert.match(styles, /\[hidden\] \{ display: none !important; \}/);
    // The downloads tooltip grows leftwards from the chip, the last item before
    // the window edge, so its width is capped by the room the window has and not
    // by a fixed measure: no viewport can push its tail off the edge. It also
    // has to take its own line breaking back — the chip is a single row and
    // `white-space` inherits — or the sentence spills out of a box the cap has
    // made narrower than itself instead of wrapping inside it.
    const tooltip = styles.match(/\.download-tooltip \{[\s\S]*?\n\}/)?.[0];
    assert.ok(tooltip, 'both stylesheets place the downloads tooltip');
    assert.match(tooltip, /right: 0;/);
    assert.match(tooltip, /max-width: min\(360px, 80vw, calc\(100vw - 2 \* clamp\(14px, 3vw, 30px\)\)\);/,
      'the tooltip is capped by the window, not by a fixed width');
    assert.match(tooltip, /white-space: normal;/,
      'the tooltip wraps rather than inheriting the chip\'s single row');
  }
  // the demo shell has to reserve the row the fixed header occupies
  assert.match(read('site/demo/demo.css'), /body\.demo-page > \[data-nodus-site-header\] \{ display: block; height: 62px; \}/);
  // the wiki offsets its own shell by the shared header variable rather than a copy
  assert.match(read('site/wiki/wiki.css'), /padding-top: var\(--nav-h\)/);
});

test('the home page ships the download dialog the chip hands its click to', () => {
  // The chip only takes the click over while the page has a dialog to answer it
  // (`window.openDl`, defined by site.js around #dl-overlay), so the page that
  // carries that dialog is what the chip's promise rests on. On the pages
  // without one the chip stays the link to the releases page it has always been.
  const home = read('site/index.html');
  assert.match(home, /id="dl-overlay"/, 'the home page carries the download dialog');
  assert.match(home, /assets\/js\/site\.js\?v=[^"]+/, 'and the script that opens it');
  for (const [relative] of standalonePages) {
    assert.doesNotMatch(read(relative), /id="dl-overlay"/, `${relative} has no dialog for the chip to open`);
  }
});
