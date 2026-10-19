import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const hostedPages = [
  'site/wiki/index.html',
  'site/demo/index.html',
  'site/demo/teaching.html',
  'site/demo/study.html',
  'site/demo/genealogy.html',
  'site/demo/databases.html',
  'site/demo/worldbuilding.html',
];

test('the wiki and every live demo mount the shared footer below their own shell', () => {
  for (const relative of hostedPages) {
    const html = read(relative);
    const host = html.indexOf('data-nodus-site-footer');
    assert.ok(host >= 0, `${relative} mounts the shared footer`);
    assert.match(html, /data-nodus-site-footer data-base="\.\.\/"/, `${relative} points the footer back at the site root`);
    assert.match(html, /site-footer\.js\?v=[^"]+/, `${relative} loads the shared footer component`);
    if (relative.startsWith('site/demo/')) {
      assert.ok(host > html.indexOf('<div class="demo-frame">'), `${relative} puts the footer after the app frame`);
    } else {
      assert.ok(host > html.indexOf('class="layout"'), `${relative} puts the footer after the documentation shell`);
    }
  }
});

test('the shared footer keeps About and Support at the bottom, and nothing else owns them', () => {
  const footer = read('site/site-footer.js');
  assert.match(footer, /href="\$\{base\}about\/">About Nodus Research/, 'About is a footer destination');
  assert.match(footer, /href="\$\{base\}contribute\/">Support Nodus/, 'Support keeps its full name in the footer');
  assert.match(footer, /class="site-foot"/);
  assert.doesNotMatch(read('site/site-header.js'), /id: 'about'/, 'the header no longer repeats About');
  for (const target of [...footer.matchAll(/href="\$\{base\}([a-z-]+)\/"/g)].map((match) => match[1])) {
    assert.ok(fs.existsSync(path.join(repoRoot, 'site', target, 'index.html')), `the footer links to an existing site/${target}/`);
  }
});

test('both stylesheets style the footer they host', () => {
  assert.match(read('site/assets/css/nodus.css'), /footer\.site-foot \{/);
  assert.match(read('site/site-header.css'), /\.site-foot \.foot-grid \{/);
  assert.match(read('site/site-header.css'), /\.site-foot \.foot-base \{/);
});

test('the demo frame grows into a page that can carry the footer', () => {
  // The footer sits after the frame, so the page must be allowed to grow past
  // one viewport and the frame must not be vertically centred over it.
  const demoStyles = read('site/demo/demo.css');
  assert.match(demoStyles, /grid-template-rows: auto auto auto;/);
  assert.match(demoStyles, /align-content: start;/);
  assert.match(demoStyles, /align-self: start;/);
  // On a phone the demo keeps its full-screen shell, but the page itself still
  // has to scroll past it: the footer is the only place About remains.
  const mobileStyles = read('site/demo/mobile.css');
  assert.match(mobileStyles, /body\.demo-page \{[\s\S]*?height: auto;[\s\S]*?min-height: 100dvh;[\s\S]*?overflow-x: hidden;/);
  assert.doesNotMatch(mobileStyles, /overscroll-behavior-y: contain;/, 'reaching the end of the app scroll hands the page to the footer');
});
