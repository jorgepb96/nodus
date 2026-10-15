/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The Toolkit section: the Nodus Presenter hero, the projected slide the stage shows,
and the row of tools under it. These checks pin the three things a reader gets —
an entry with the same badge as the rest, a slide that looks like a Nodus deck
instead of a placeholder, and a single row that scrolls instead of wrapping.
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const home = read('site/index.html');
const css = read('site/assets/css/home.css');
const script = read('site/assets/js/home.js');

const toolkit = home.slice(home.indexOf('<section id="tools"'), home.indexOf('</section>', home.indexOf('<section id="tools"')));

test('the Nodus Presenter wears the same badge as the tools under it', () => {
  const hero = toolkit.slice(toolkit.indexOf('<article class="tool-hero'));
  assert.match(hero, /<span class="pic"><svg viewBox="0 0 24 24">/, 'the hero carries an icon');
  assert.match(hero, /<span class="pic">[\s\S]{0,220}?<\/svg><\/span>\s*<span class="kicker">Presenting<\/span>/, 'the icon sits above its kicker');
  assert.match(hero, /<h3>Nodus Presenter<\/h3>/);
  // The tools under it are the reference: same badge, same glyph weight.
  assert.equal(toolkit.match(/<span class="pic">/g).length, 6, 'the hero and the five tool cards all carry one');
  assert.match(css, /\.tool-hero \.pic \{[^}]*width: 44px; height: 44px;/, 'the hero badge is the bigger one');
  assert.match(css, /\.tool-hero \.pic svg \{[^}]*stroke-width: 1\.7/, 'and draws its glyph like the rest');
});

test('the stage presents a Nodus cover instead of placeholder text', () => {
  const slide = toolkit.slice(toolkit.indexOf('id="stage-slide"'), toolkit.indexOf('class="stage-tools"'));
  assert.doesNotMatch(slide, /Your document, page by page/, 'the placeholder is gone');
  assert.match(slide, /<div class="slide-deck">/, 'the slide holds one deck the zoom tool can scale whole');
  assert.match(slide, /<img class="slide-mark" src="assets\/nodus-logo.svg"/, 'the cover carries the Nodus mark');
  assert.match(slide, /<strong>Nodus<\/strong>/, 'and the name');
  const points = [...slide.matchAll(/<li>([^<]+)<\/li>/g)].map((match) => match[1]);
  assert.equal(points.length, 3, 'three points, briefly');
  for (const point of points) assert.ok(point.length > 30 && point.length < 90, `"${point}" stays a line`);
  // The mascot is the app's own character, generated into the page, standing.
  assert.match(slide, /<!-- generated:nodi-cover:start -->[\s\S]*<!-- generated:nodi-cover:end -->/, 'the cover reserves the generated block');
  assert.match(slide, /<div class="slide-nodi" aria-hidden="true">\s*<svg class="nodi-svg" viewBox="0 0 270 300" width="270" height="300" data-state="idle"/, 'the character stands on it, and is decoration');
  assert.match(slide, /id="wns-char-bodyG"/, 'and it is the component the build script renders, not a drawing');
  assert.match(css, /\.stage-slide \{[^}]*background: #04050a;/, 'the projected slide is black');
  assert.match(css, /\.slide-nodi \.nodi-svg \{ height: clamp\(112px, 13vw, 176px\);/, 'the mascot is sized to the slide');
  // The stage still hands the tools something to act on.
  assert.match(slide, /id="stage-canvas"[\s\S]*class="stage-spot"[\s\S]*class="stage-laser"/, 'the drawing canvas, the spotlight and the laser are still there');
  assert.match(slide, /<span class="stage-page">Slide \d+ of \d+<\/span>/, 'and the deck still has its page label');
});

test('the tools under the stage turn like a ring, one card focused', () => {
  assert.equal(toolkit.match(/<div class="tool-cards reveal">/g).length, 1, 'the row is one element, and it is the thing that fades in');
  assert.equal(toolkit.match(/<article class="card lit tool-card"/g).length, 5, 'with the five tools in it');
  // The cards must NOT carry .reveal: its `transform: none` beats the ring's
  // transform, and the ring would paint all five cards on top of each other.
  assert.equal(toolkit.match(/<article class="card lit tool-card reveal"/g), null, 'a card carries no reveal of its own');

  // home.js solves where every card stands; the CSS only reads it back.
  assert.match(css, /\.tool-cards \{[^}]*position: relative;/, 'the ring positions its cards');
  assert.match(css, /\.tool-cards \{[^}]*overflow: hidden;/, 'the waiting cards are clipped, so the page never scrolls sideways');
  assert.match(css, /\.tool-cards \{[^}]*margin-inline: calc\(var\(--gut, 24px\) \* -1\);/, 'the clip happens out in the page margins, where the look wants it');
  assert.match(css, /\.tool-cards \.tool-card \{[^}]*position: absolute;/, 'a card is placed by the ring, not by the flow');
  assert.match(css, /\.tool-cards \.tool-card \{[^}]*transform: translateX\(var\(--x, 0px\)\) scale\(var\(--scale, 1\)\);/, 'it stands where the ring put it, at the size the ring gave it');
  assert.equal(/rotateY|perspective/.test(css), false, 'and it is not tilted: a rotated card rasterises its text soft');
  assert.match(css, /\.tool-cards \.tool-card \{[^}]*height: var\(--stage-h, 340px\);/, 'every card is the same height, whatever its text');
  assert.match(css, /\.tool-cards \.tool-card \.tags \{ margin-top: auto; \}/, 'so the tags and the link keep to the bottom');
  assert.match(css, /\.tool-cards\.is-dragging \.tool-card \{ transition: none; \}/, 'a drag follows the pointer, the settle animates');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.tool-cards \.tool-card \{ transition: none; \}/, 'the turning stops for reduced motion');

  assert.match(script, /function tools\(\)/, 'home.js turns the ring');
  assert.match(script, /let position = 0;/, 'one number is the whole state: the card the middle is on');
  // The air between two cards is solved for, not guessed: half of each card plus the
  // constant gap, so a shrunken card cannot drift closer to its neighbour.
  assert.match(script, /const GAP = 22;/, 'the gap between two cards is a constant');
  assert.match(script, /\+ \(cardWidth \* LOOK\[level - 1\]\.scale\) \/ 2 \+ GAP \+ \(cardWidth \* LOOK\[level\]\.scale\) \/ 2;/, 'and the offsets are solved from it');
  assert.match(script, /function lookAt\(distance\)/, 'what a card looks like is a function of how far it is from the middle');
  assert.match(script, /x: lerp\(offsets\[low\], offsets\[high\], t\)/, 'interpolated, so a drag half a card along shows half a card of travel');
  assert.match(script, /if \(distance > n \/ 2\) distance -= n;/, 'distance is measured the short way round');
  assert.match(script, /function measure\(\)/, 'the ring measures its cards');
  assert.match(script, /ring\.classList\.add\('is-measuring'\);/, 'at their natural height for one frame');
  assert.match(script, /ring\.style\.setProperty\('--stage-h', `\$\{tallest\}px`\);/, 'and hands the tallest to all of them');
  assert.match(script, /document\.fonts\.ready\.then\(measure\)/, 'again once the webfont has settled');

  // A drag follows the pointer and lands on the nearest card.
  assert.match(script, /if \(moved <= 6\) return;/, 'a shaky hand is not a drag');
  assert.match(script, /position = startPosition - dx \/ stride\(\);/, 'the ring follows the pointer while it is dragged');
  assert.match(script, /position = Math\.round\(position\);/, 'and settles on the nearest card when it is let go');
  assert.match(script, /function turn\(by\)/, 'every other way of moving it goes through one turn');

  // Capture must wait for the drag to start: capturing on pointerdown retargets the
  // click that ends a plain press to the ring, and no card under it ever hears one.
  const press = script.slice(script.indexOf("addEventListener('pointerdown'"), script.indexOf("addEventListener('pointermove'"));
  assert.equal(/setPointerCapture/.test(press), false, 'a plain press does not capture the pointer');
  const move = script.slice(script.indexOf("addEventListener('pointermove'"), script.indexOf('function settle'));
  assert.match(move, /setPointerCapture\(event\.pointerId\)/, 'the pointer is captured for the drag, not for the press');

  assert.match(script, /const away = wrap\(cards\.indexOf\(card\)/, 'clicking a waiting card measures the short way to it');
  assert.match(script, /if \(moved > 6\) \{\s*event\.preventDefault\(\)/, 'and the click that ended a drag does not count');
  assert.match(script, /event\.key === 'ArrowLeft'[\s\S]{0,90}event\.key === 'ArrowRight'/, 'the arrow keys turn it');

  // One trackpad swipe is dozens of wheel events plus a tail of inertia: it turns
  // the ring once, and a click during that tail still lands where it was aimed.
  assert.match(script, /if \(Math\.abs\(event\.deltaX\) <= Math\.abs\(event\.deltaY\)\) return;/, 'a vertical wheel stays a page scroll');
  assert.match(script, /if \(Math\.abs\(wheelTotal\) < WHEEL_STEP\) return;/, 'a sideways gesture has to pass a threshold to count');
  assert.match(script, /forgetWheel\(\);\s*wheelBlocked = Date\.now\(\) \+ WHEEL_QUIET;\s*turn\(by\);/, 'and then the rest of the gesture is its tail, not a second turn');
  assert.match(script, /if \(Date\.now\(\) < wheelBlocked\) \{ forgetWheel\(\); return; \}/, 'a gesture still in flight cannot turn it again');
  assert.match(script, /wheelBlocked = Date\.now\(\) \+ 400;\s*position = Math\.round\(position\) \+ by;/, 'a click jumps straight to its card and ignores the trackpad tail');
  assert.equal(/setInterval|\bautoplay\b/i.test(script), false, 'and nothing turns it on its own');
  assert.match(script, /opening\(\);\s*stage\(\);\s*tools\(\);/, 'the ring is wired on load');
});
