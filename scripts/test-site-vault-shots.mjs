/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The vault windows on the home page. Each scene used to draw an app view with SVG
and CSS; it now shows the real thing — the screenshots the README ships — inside
a window frame whose three controls are the desktop's own colours. A vault with
more than one view carries them all and steps through them with arrows.

These checks pin what a visitor gets: real images that exist in the published
tree, the same set the mirror script produces, a window that looks like a window,
and carousel controls that are only there when there is something to step to.
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SHOT_HEIGHT, SHOT_WIDTH, SITE_SHOTS } from './build-site-screenshots.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const readSite = (relative) => fs.readFileSync(path.join(site, relative), 'utf8');

const home = read('site/index.html');
const css = read('site/assets/css/home.css');

/* One chunk per vault scene, so a check on one window cannot accidentally count
   another scene's markup. Splitting on the section tag rather than on comments
   keeps this reading the structure the browser sees, not the editor's notes. */
const scenes = home
  .split('<section class="scene"')
  .slice(1)
  .map((chunk) => chunk.slice(0, chunk.indexOf('</section>')));

/** The figures and arrows of one window, read the same way wherever it sits: the
 *  four vault scenes and the five mode cards carry the same markup. */
function figuresOf(chunk) {
  return [...chunk.matchAll(/<figure class="(shot[^"]*)"[^>]*>([\s\S]*?)<\/figure>/g)].map((match) => {
    const block = match[2];
    const image = block.match(/<img src="([^"]+)" width="(\d+)" height="(\d+)"[^>]*alt="([^"]*)"/);
    return {
      classes: match[1],
      ariaHidden: /aria-hidden="true"/.test(match[0]),
      src: image?.[1],
      width: Number(image?.[2]),
      height: Number(image?.[3]),
      alt: image?.[4],
      text: block.match(/<span class="shot-text">([\s\S]*?)<\/span>/)?.[1],
      step: block.match(/<span class="shot-step">([^<]+)<\/span>/)?.[1],
      lazy: /\bloading="lazy"/.test(block),
      async: /\bdecoding="async"/.test(block),
    };
  });
}

function arrowsOf(chunk) {
  return [...chunk.matchAll(/<button class="shot-arrow (\w+)"([^>]*)>/g)].map((match) => ({
    side: match[1],
    attributes: match[2],
  }));
}

const windows = scenes
  .filter((scene) => scene.includes('<div class="frame" data-shots>'))
  .map((scene) => {
    const vault = scene.match(/<div class="frame-bar"><i><\/i><i><\/i><i><\/i><span>Nodus Research · ([^<]+)<\/span>/)?.[1];
    return {
      scene,
      vault,
      figures: figuresOf(scene),
      arrows: arrowsOf(scene),
      shotsLabel: scene.match(/<div class="shots"[^>]*aria-label="([^"]+)"/)?.[1],
      carouselRole: /<div class="shots"[^>]*aria-roledescription="carousel"/.test(scene),
    };
  });

/* "More ways to work with Nodus": an inner window per mode, inside one outer
   carousel of modes. A chunk per slide, so the counts stay per mode. */
// The section now holds a <section> per mode, so the block ends where the wrap closes,
// not at the first </section> (which would be the first mode's own).
const modesBlock = home.slice(
  home.indexOf('<div class="modes"'),
  home.indexOf('\n  </div>\n</section>', home.indexOf('<div class="modes"')),
);
const modeSlides = [...modesBlock.matchAll(/<section class="mode-slide" data-sections-item="([^"]+)"([^>]*)>([\s\S]*?)<\/section>/g)].map((match) => ({
  key: match[1],
  hidden: / hidden/.test(match[2]),
  body: match[3],
  figures: figuresOf(match[3]),
  arrows: arrowsOf(match[3]),
  ribbon: match[3].includes('<span class="mode-ribbon"') ? match[3].slice(match[3].indexOf('<span class="mode-ribbon"'), match[3].indexOf('</span>\n              </span>') + 25) : null,
  bar: match[3].match(/<div class="frame-bar"><i><\/i><i><\/i><i><\/i><span>([^<]+)<\/span>/)?.[1],
  shotsLabel: match[3].match(/<div class="shots"[^>]*aria-label="([^"]+)"/)?.[1],
  carouselRole: /<div class="shots"[^>]*aria-roledescription="carousel"/.test(match[3]),
}));
const modeShots = modeSlides.flatMap((slide) => slide.figures.map((figure) => ({ ...figure, section: slide.key })));
const modeTabs = [...modesBlock.matchAll(/<button class="mode-tab" type="button" data-sections-jump="([^"]+)"([^>]*)>/g)].map((match) => ({
  key: match[1],
  current: /aria-current="true"/.test(match[2]),
}));
const modeSections = [...modesBlock.matchAll(/<article class="mode-info[^"]*"([^>]*)>([\s\S]*?)<\/article>/g)].map((match) => ({
  key: match[1].match(/data-shots-section="([^"]+)"/)?.[1],
  body: match[2],
  title: match[2].match(/<h3>([^<]+)<\/h3>/)?.[1],
  copy: match[2].match(/<p[^>]*>([^<]+)<\/p>/)?.[1],
  link: match[2].match(/<a class="arrow-link" href="([^"]+)"/)?.[1],
  hidden: / hidden>/.test(match[0]),
}));

test('every main vault scene shows a window of real screenshots', () => {
  assert.deepEqual(
    windows.map((window) => window.vault),
    ['Academic vault', 'Teaching vault', 'Study vault', 'Databases vault'],
    'the four vault scenes each carry a window, in the order they appear on the page',
  );

  for (const window of windows) {
    assert.ok(window.figures.length > 0, `${window.vault}: the window holds at least one screenshot`);
    // Only the window that actually steps through views calls itself a carousel.
    if (window.figures.length > 1) {
      assert.ok(window.carouselRole, `${window.vault}: a window you can step through says so`);
      assert.ok(window.shotsLabel, `${window.vault}: the carousel has a label for screen readers`);
    } else {
      assert.ok(!window.carouselRole, `${window.vault}: one screenshot is not a carousel`);
      assert.equal(window.shotsLabel, undefined, `${window.vault}: a single view needs no carousel label`);
    }
    for (const figure of window.figures) {
      assert.match(figure.src ?? '', /^assets\/screenshots\/[a-z-]+\.webp$/, `${window.vault}: ${figure.src} is a mirrored site asset`);
      assert.ok(!figure.src?.includes('docs/'), `${window.vault}: the page never reaches into repository documentation`);
      assert.ok(fs.existsSync(path.join(site, figure.src)), `${window.vault}: ${figure.src} exists in the published tree`);
      // A relative src would resolve against the page and copy the assets tree in
      // under the deploy; an absolute one would leave the site folder entirely.
      assert.ok(!figure.src?.startsWith('/') && !figure.src?.startsWith('..'), `${window.vault}: ${figure.src} is site-relative`);
      // The screenshots are read as text by anyone who cannot see them, and the
      // README's own description is what they get.
      assert.ok((figure.alt ?? '').length > 24, `${window.vault}: "${figure.alt}" describes what the screenshot shows`);
      assert.ok((figure.text ?? '').length > 20, `${window.vault}: the caption says what the view is`);
      assert.equal(figure.width, SHOT_WIDTH, `${window.vault}: the reserved width matches the mirrored file`);
      assert.equal(figure.height, SHOT_HEIGHT, `${window.vault}: the reserved height matches the mirrored file`);
      assert.ok(figure.async, `${window.vault}: screenshots decode off the main thread`);
    }
  }
});

test('the files on disk are exactly the ones the mirror script produces', () => {
  const referenced = new Set([...windows, { figures: modeShots }].flatMap((window) => window.figures.map((figure) => figure.src)));
  const mirrored = SITE_SHOTS.map((shot) => `assets/screenshots/${shot.target}`);

  for (const target of mirrored) {
    assert.ok(referenced.has(target), `${target} is mirrored but no window shows it`);
  }
  for (const reference of referenced) {
    assert.ok(mirrored.includes(reference), `${reference} is shown but the mirror script does not produce it`);
  }

  for (const entry of fs.readdirSync(path.join(site, 'assets', 'screenshots'))) {
    if (entry === 'README.md') continue;
    assert.ok(mirrored.includes(`assets/screenshots/${entry}`), `site/assets/screenshots/${entry} is not shown anywhere`);
    const bytes = fs.statSync(path.join(site, 'assets', 'screenshots', entry)).size;
    assert.ok(bytes > 8_000, `${entry} looks empty (${bytes} bytes)`);
    // The README originals run 100-200 KB each. A 2x copy belongs in that range:
    // anything larger means the resize was skipped and the home page pays for it.
    assert.ok(bytes < 250_000, `${entry} is too heavy for the home page (${bytes} bytes)`);
  }

  for (const shot of SITE_SHOTS) {
    assert.ok(
      fs.existsSync(path.join(root, shot.source)),
      `${shot.source} is the original capture; the mirror cannot be rebuilt without it`,
    );
  }
});

test('the academic vault carries all six of its README views, and steps through them', () => {
  const academic = windows[0];
  assert.equal(academic.figures.length, 6, 'the academic window shows its six views');
  assert.deepEqual(
    academic.figures.map((figure) => figure.src),
    [
      'assets/screenshots/academic-demo.webp',
      'assets/screenshots/academic-theme-relations.webp',
      'assets/screenshots/academic-argument-map.webp',
      'assets/screenshots/academic-deep-research.webp',
      'assets/screenshots/academic-podcast.webp',
      'assets/screenshots/academic-immersion.webp',
    ],
    'the order is the order the README introduces them in',
  );
  assert.deepEqual(
    academic.figures.map((figure) => figure.step),
    ['01 / 06', '02 / 06', '03 / 06', '04 / 06', '05 / 06', '06 / 06'],
    'each view says where it sits in the set',
  );

  // The first view is the page's resting state: it is what a visitor sees before
  // any script runs, and what they keep if no script ever runs.
  assert.match(academic.figures[0].classes, /\bis-active\b/, 'the first view is the one that shows');
  assert.ok(!academic.figures[0].ariaHidden, 'the visible view is part of the page');
  for (const figure of academic.figures.slice(1)) {
    assert.ok(!figure.classes.includes('is-active'), 'only one view shows at a time');
    assert.ok(figure.ariaHidden, 'a view nobody can see is out of the accessibility tree');
    assert.ok(figure.lazy, 'the views behind the first load when the window reaches the screen');
  }

  assert.deepEqual(academic.arrows.map((arrow) => arrow.side).sort(), ['next', 'prev'], 'the window has both arrows');
  for (const arrow of academic.arrows) {
    assert.match(arrow.attributes, /\bhidden\b/, 'an arrow the script never lights up must not sit there inert');
    assert.match(arrow.attributes, /aria-label="[^"]+screenshot"/, 'each arrow says where it goes');
    assert.match(arrow.attributes, /data-shots-(prev|next)/, 'each arrow is a hook for the carousel');
  }
  assert.equal(
    (academic.scene.match(/<button class="shot-arrow[^>]*>[\s\S]*?<\/button>/g) ?? [])
      .filter((button) => button.includes('<svg')).length,
    2,
    'both arrows are drawn with an icon',
  );
});

test('the other vaults include their expanded, distinct feature galleries', () => {
  const counts = [7, 7, 6];
  for (const [index, window] of windows.slice(1).entries()) {
    const count = counts[index];
    assert.equal(window.figures.length, count, `${window.vault} has ${count} useful views`);
    assert.equal(window.arrows.length, 2, `${window.vault} has previous and next controls`);
    assert.deepEqual(window.figures.map((figure) => figure.step), Array.from({ length: count }, (_, i) => `${String(i + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`));
    assert.ok(window.figures[0].classes.includes('is-active'));
    for (const figure of window.figures.slice(1)) {
      assert.ok(figure.ariaHidden);
      assert.ok(figure.lazy);
    }
  }
  for (const feature of ['teaching-exams', 'teaching-grades', 'study-questions', 'study-courses', 'study-calendar', 'databases-board']) {
    assert.ok(home.includes(`assets/screenshots/${feature}.webp`), `${feature} is shown on the homepage`);
  }
  const hashes = SITE_SHOTS.map(({ target }) => createHash('sha256').update(fs.readFileSync(path.join(site, 'assets/screenshots', target))).digest('hex'));
  assert.equal(new Set(hashes).size, hashes.length, 'each slide uses a distinct capture');
});

test('"More ways to work with Nodus" nests a window of screens inside each mode', () => {
  const counts = { genealogy: 6, worldbuilding: 7, 'primary-sources': 2, testimony: 2, prosopography: 2 };
  assert.equal(modeSlides.length, 5, 'the outer carousel has one slide per mode');
  assert.equal(modeSlides.filter((slide) => !slide.hidden).length, 1, 'one mode is showing at a time');
  assert.equal(modeSlides[0].hidden, false, 'the outer carousel rests on the first mode');
  assert.deepEqual(modeSlides.map((slide) => slide.key), modeTabs.map((tab) => tab.key), 'the tabs name the modes in order');
  assert.equal(modeTabs.filter((tab) => tab.current).length, 1, 'exactly one tab is current');
  assert.match(modesBlock, /<button class="mode-step prev"[^>]*data-sections-prev/, 'the outer carousel can be stepped backwards');
  assert.match(modesBlock, /<button class="mode-step next"[^>]*data-sections-next/, 'and forwards');
  assert.equal(modeSections.length, 5, 'every mode keeps the copy that describes it');
  assert.equal(modeSections.filter((section) => !section.hidden).length, 1, 'the copy of the showing mode is the one visible');
  assert.deepEqual(modeSections.map((section) => section.key), modeSlides.map((slide) => slide.key), 'the copy follows the same order');

  for (const slide of modeSlides) {
    const count = counts[slide.key];
    assert.ok(count, `${slide.key} is a mode this section is expected to show`);
    // The inner carousel: its own window, its own arrows, its own counter.
    assert.equal(slide.figures.length, count, `${slide.key} carries ${count} screens of its own`);
    assert.equal(slide.arrows.length, 2, `${slide.key} has its own pair of arrows`);
    assert.ok(slide.carouselRole && /screenshot/.test(slide.shotsLabel ?? ''), `${slide.key} announces its own carousel`);
    assert.ok(slide.bar?.endsWith('vault'), `${slide.key} labels its own window`);
    assert.deepEqual(
      slide.figures.map((figure) => figure.step),
      Array.from({ length: count }, (_, i) => `${String(i + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`),
      `${slide.key} numbers its own screens`,
    );
    assert.equal(slide.figures.filter((figure) => figure.classes.includes('is-active')).length, 1, `${slide.key} shows one screen`);
    assert.ok(slide.figures[0].classes.includes('is-active'), `${slide.key} rests on its first screen`);
    for (const figure of slide.figures) {
      assert.equal(figure.width, SHOT_WIDTH);
      assert.equal(figure.height, SHOT_HEIGHT);
      assert.ok(figure.src.startsWith('assets/screenshots/'), `${slide.key} shows its own copy of the capture`);
      assert.ok(figure.alt.length > 24 && figure.text.length > 20, `${figure.src} is described and captioned`);
      assert.ok(figure.async);
    }
    for (const figure of slide.figures.slice(1)) {
      assert.ok(figure.ariaHidden, `${slide.key} hides the screens that are not showing`);
      assert.ok(figure.lazy);
    }
  }
  for (const section of modeSections) {
    assert.ok(section.title, `${section.key} keeps its title`);
    assert.ok(section.copy?.length > 80, `${section.key} keeps its description`);
  }
  assert.deepEqual(modeSections.filter((section) => section.link).map((section) => section.key), ['genealogy', 'worldbuilding'], 'the two modes with a demo of their own keep the link');
  // Each of the five windows is a carousel in its own right; none of them is flat.
  assert.equal(modesBlock.match(/<div class="frame" data-shots>/g).length, 5, 'there is one window per mode, not one window over all of them');
});

test('the preliminary modes wear the app\'s own phase, in the corner and in words', () => {
  const preliminary = modeSlides.filter((slide) => slide.ribbon);
  assert.deepEqual(preliminary.map((slide) => slide.key), ['primary-sources', 'testimony', 'prosopography'], 'the three modes the app marks pre-alpha are the tagged ones');
  for (const slide of preliminary) {
    assert.match(slide.ribbon, /tabindex="0"/, `${slide.key}'s tag can be reached without a mouse`);
    assert.match(slide.ribbon, /<span class="mode-ribbon-band">Pre-alpha<\/span>/, `${slide.key} prints the phase on the ribbon`);
    const describedBy = slide.ribbon.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(describedBy, `${slide.key}'s tag points at its note`);
    assert.ok(slide.ribbon.includes(`id="${describedBy}"`), `${slide.key}'s note is the element its tag describes`);
    assert.match(slide.ribbon, /not usable for real work yet/i, `${slide.key} says what pre-alpha means on hover`);
  }
  const copy = modeSections.filter((section) => /mode-phase/.test(section.body));
  assert.deepEqual(copy.map((section) => section.key), ['primary-sources', 'testimony', 'prosopography'], 'and the same three say it in words under their copy');
  assert.match(copy[0].body, /<b>Pre-alpha<\/b>[^<]*not usable for real work yet/i, 'the words repeat what the app badge says');
  const ids = [...modesBlock.matchAll(/id="(more-phase-[a-z-]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'each mode\'s note has an id of its own');

  assert.match(css, /\.mode-ribbon-band \{[^}]*transform: rotate\(45deg\)/, 'the tag is a diagonal band');
  assert.match(css, /\.mode-ribbon:hover \.mode-ribbon-tip,\s*\.mode-ribbon:focus \.mode-ribbon-tip \{ opacity: 1/, 'hovering or focusing the tag raises the note');
  assert.match(css, /\.mode-slide\[hidden\] \{ display: none; \}/, 'the modes that are not showing take no space');
  // nodus.css pads every <section> by up to 148px, which pushed the window down
  // inside its column while the copy stayed at the top: the slide has to undo it.
  assert.match(css, /\.mode-slide \{ padding: 0; \}/, 'a slide carries no section padding, so the window sits level with its copy');
});

test('the drawn app views left with the graphics they belonged to', () => {  /* Matched as class names, not as words: "rubrics" is still the word the teaching
     scene uses for the real feature, and that copy is not going anywhere. */
  const drawn = ['graph-svg', 'grid-table', 'mark-pill', 'rubric', 'week', 'flash', 'db-cols', 'bars-axis', 'evidence'];
  for (const name of drawn) {
    assert.ok(!home.includes(`class="${name}`), `site/index.html no longer draws the ${name} view`);
    assert.ok(!css.includes(`.${name}`), `home.css no longer styles the ${name} view`);
  }
});

test('the window wears the three colours a desktop window wears', () => {  // The order is the order the controls appear in: close, minimise, zoom.
  const controls = [
    ['1', '#ff5f57'],
    ['2', '#febc2e'],
    ['3', '#28c840'],
  ];
  for (const [position, colour] of controls) {
    assert.match(
      css,
      new RegExp(`\\.frame-bar i:nth-child\\(${position}\\)\\s*\\{\\s*background:\\s*${colour};`),
      `the ${position === '1' ? 'first' : position === '2' ? 'second' : 'third'} control is ${colour}`,
    );
  }
  assert.match(css, /\.frame-bar i \{[^}]*border-radius: 50%/, 'the controls are round');
  // The dot that used to be a grey placeholder must not still paint over them.
  assert.ok(!/\.frame-bar i \{[^}]*background: var\(--membrane-2\)/.test(css), 'the three controls are coloured, not grey');
});

test('the carousel is a row of screenshots that swaps in place, with real arrows', () => {
  const script = readSite('assets/js/vault-shots.js');
  assert.match(home, /<script src="assets\/js\/vault-shots\.js\?v=/, 'the page loads the carousel');
  assert.match(css, /\.shots \{ position: relative; display: grid;/, 'the views stack in one cell, so a swap cannot shift the layout');
  assert.match(css, /\.shot\.is-active \{ opacity: 1;/, 'the current view is the opaque one');
  assert.match(css, /\.shot img \{[^}]*aspect-ratio: 16 \/ 10/, 'every screenshot keeps the 16:10 window it was captured in');
  // The screenshot is what the window is for. A caption laid over it — the scrim
  // that came first — hid a strip of the app on every view, so the caption is a
  // bar under the image and nothing is drawn on top of the shot itself.
  assert.match(css, /\.shot figcaption \{[^}]*flex: 1 1 auto/, 'the caption is in the flow, under the image');
  assert.doesNotMatch(css, /\.shot figcaption \{[^}]*position: absolute/, 'the caption is not laid over the screenshot');
  assert.doesNotMatch(css, /\.shot figcaption \{[^}]*linear-gradient/, 'no scrim darkens the bottom of the screenshot');
  // `hidden` is how the markup keeps the arrows out of a script-less page, and
  // display: grid would otherwise beat the browser's own [hidden] rule.
  assert.match(css, /\.shot-arrow\[hidden\] \{ display: none; \}/, 'a hidden arrow is really hidden');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.shot \{ transition: none; \}/, 'the swap respects reduced motion');

  // Wrapping in both directions, so neither end is a dead end.
  assert.match(script, /index = \(target \+ slides\.length\) % slides\.length/, 'the carousel wraps around');
  assert.match(script, /previous\.hidden = false/, 'the arrows appear only once the carousel is live');
  assert.match(script, /if \(slides\.length < 2 \|\| !previous \|\| !next\) return;/, 'a single view never becomes a carousel');
  assert.match(script, /event\.key === 'ArrowLeft'/, 'the left arrow key steps back');
  assert.match(script, /event\.key === 'ArrowRight'/, 'the right arrow key steps forward');
  // A swipe must not fire on a vertical drag: that is the page being scrolled.
  assert.match(script, /Math\.abs\(dx\) < Math\.abs\(dy\)\) return;/, 'a scroll is not a swipe');
});

test('every window carries the control that opens it in the gallery view', () => {
  const bars = [...home.matchAll(/<div class="frame-bar">([\s\S]*?)<\/div>/g)].map((match) => ({
    vault: match[1].match(/<span>Nodus Research · ([^<]+)<\/span>/)?.[1],
    zoom: match[1].match(/<button class="frame-zoom" type="button" data-shot-zoom aria-label="([^"]+)" hidden>([\s\S]*?)<\/button>/),
  }));
  assert.equal(bars.length, 9, 'the four vault windows and the five mode windows all have a bar');
  for (const bar of bars) {
    assert.ok(bar.vault, `the window labels itself (${bar.vault})`);
    assert.ok(bar.zoom, `${bar.vault}: the bar carries the control that opens the view`);
    assert.match(bar.zoom[1], new RegExp(bar.vault.toLowerCase()), `${bar.vault}: the control names the window it belongs to`);
    assert.match(bar.zoom[2], /<svg/, `${bar.vault}: the control is drawn with an icon`);
  }
  // `hidden` is the script-less page's resting state, exactly as the arrows are:
  // a control that cannot do anything is not left sitting there to be clicked.
  const zoomLabels = bars.map((bar) => bar.zoom?.[1]);
  assert.equal(new Set(zoomLabels).size, zoomLabels.length, 'no two windows share one label');
});

test('the gallery view shows the window over the blurred page, and hands it back', () => {
  const script = readSite('assets/js/vault-shots.js');
  // The view is the page's own window, not a second design: the bar, the caption
  // and the arrows are the classes the page already styles.
  assert.match(script, /'<div class="shot-viewer-stage"><div class="frame">'/, 'the view carries the window frame the page draws');
  assert.match(script, /overlay\.className = 'shot-viewer'/, 'the view builds its own overlay');
  assert.match(script, /overlay\.setAttribute\('role', 'dialog'\)/, 'and announces itself as a dialog');
  assert.match(script, /frame\.querySelector\('\[data-shot-zoom\]'\)/, 'the control in the bar is what opens it');
  assert.match(script, /button\.hidden = false/, 'the control appears only once the view behind it can be built');
  // Cloned from the figure the carousel is showing, so the caption, the counter and
  // the image cannot drift from the window they came from.
  assert.match(script, /const figure = slides\[index\]\.cloneNode\(true\);/, 'the view shows the window\'s own figure');
  assert.match(script, /if \(source\) source\.show\(index\);/, 'the window follows the view back to the page');
  assert.match(script, /if \(event\.target === overlay\) close\(\);/, 'the backdrop closes it');
  assert.match(script, /event\.key === 'Escape'/, 'Escape closes it');
  assert.match(script, /document\.body\.style\.overflow = 'hidden'/, 'the page behind it does not scroll');

  // The veil is the download dialog's own: the same dim and the same blur.
  assert.match(css, /\.shot-viewer \{[^}]*background: rgba\(4, 3, 8, 0\.82\)/, 'the page behind the view is dimmed');
  assert.match(css, /\.shot-viewer \{[^}]*backdrop-filter: blur\(10px\)/, 'and blurred');
  assert.match(css, /\.shot-viewer \.frame \{ box-shadow: var\(--shadow\); \}/, 'the view is the window, raised off the page');
  // Never taller than the screen: the width is capped by the height the window needs.
  assert.match(css, /\.shot-viewer-stage \{[^}]*width: min\(100%, 1080px, calc\(\(100dvh - 190px\) \* 1\.6\)\)/, 'the whole window fits the screen');
  assert.match(css, /\.frame-zoom\[hidden\] \{ display: none; \}/, 'a hidden control is really hidden');
});

test('every window is one size, and a mode is described beside its window', () => {
  const script = readSite('assets/js/vault-shots.js');
  // One pair of columns gives every app window on the page its width: the four
  // vault windows and the five mode windows take the same wide one, so none of
  // them is a size of its own.
  assert.match(
    css,
    /\.scene-inner, \.mode-body \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.5fr\)/,
    'the scenes and the modes share one pair of columns',
  );
  assert.match(
    css,
    /\.scene\[data-flip\] \.scene-inner,\s*\.mode-body \{ grid-template-columns: minmax\(0, 1\.5fr\) minmax\(0, 1fr\); \}/,
    'the window takes the wide column and the copy the one at its right',
  );
  assert.match(css, /\.scene-inner, \.mode-body \{ grid-template-columns: minmax\(0, 1fr\); \}/,
    'and both fold to a single column when there is no room for two');

  // The labels are a centred row that wraps while there is room for two rows, and
  // only becomes a row you scroll once the columns have folded: on a desktop window
  // of any size all five are on screen.
  assert.match(css, /\.mode-nav \{[^}]*justify-content: center/, 'the tabs and their arrows sit in the middle');
  assert.match(css, /\.mode-tabs \{[^}]*flex-wrap: wrap[^}]*min-width: 0;/, 'the labels wrap rather than hide');
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.mode-tabs \{ flex-wrap: nowrap; overflow-x: auto/,
    'they only become a scroller once the layout has one column');
  assert.match(css, /\.mode-copy \{ min-width: 0; \}/, 'the copy takes its column, left-aligned like a scene\'s');

  // The pre-alpha tag is sewn into the corner the new control takes, so the window
  // that carries the tag is what moves the control clear of it.
  assert.match(script, /if \(frame\.querySelector\('\.mode-ribbon'\)\) frame\.classList\.add\('has-ribbon'\);/, 'a pre-alpha window notes the tag in its corner');
  assert.match(css, /\.frame\.has-ribbon \.frame-zoom \{ margin-right: 54px; \}/, 'and the control steps clear of it');
});
