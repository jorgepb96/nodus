import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('the Teaching web demo is reachable from every live vault demo', () => {
  const teachingHtml = read('site/demo/teaching.html');
  const sharedHeader = read('site/site-header.js');
  assert.match(teachingHtml, /data-nodus-site-header data-base="\.\.\/" data-context="demo"/);
  assert.match(teachingHtml, /src="\.\.\/site-header\.js/);
  // the vault catalogue lives at /nodus/ since the family front page, and the header's Nodus link returns to it
  assert.match(sharedHeader, /\{ id: 'nodus', label: 'Nodus', href: \(base\) => `\$\{base\}nodus\/` \}/);
  assert.match(teachingHtml, /src="teaching-data\.js/);
  assert.match(teachingHtml, /src="teaching-app\.js/);
  assert.match(teachingHtml, /AI for generating teaching content only; AI never evaluates students/);

  for (const page of ['index.html', 'study.html', 'genealogy.html', 'databases.html', 'worldbuilding.html']) {
    const html = read(`site/demo/${page}`);
    assert.match(html, /data-nodus-site-header data-base="\.\.\/" data-context="demo"/, `${page} uses the shared route back to the vault catalogue`);
    assert.match(html, /src="\.\.\/site-header\.js/, `${page} loads the shared navigation`);
    assert.doesNotMatch(html, /Shell in the app · preview/, `${page} no longer labels Teaching as a preview`);
  }
});

test('every live demo uses the same shared site header without a duplicate vault bar', () => {
  const pages = ['index.html', 'teaching.html', 'study.html', 'genealogy.html', 'databases.html', 'worldbuilding.html'];

  for (const page of pages) {
    const html = read(`site/demo/${page}`);
    assert.equal((html.match(/data-nodus-site-header/g) || []).length, 1, `${page} mounts one shared header`);
    assert.equal((html.match(/site-header\.js/g) || []).length, 1, `${page} loads the shared header once`);
    assert.doesNotMatch(html, /class="vault-tabs|class="vault-menu|toggleVaultMenu/, `${page} has no duplicate vault navigation`);
  }
});

test('the browser fixture preserves the important facts from the real app fixture', () => {
  const realFixture = read('electron/db/teachingDemoData.ts');
  const webFixture = read('site/demo/teaching-data.js');
  const webApp = read('site/demo/teaching-app.js');

  for (const marker of ['Lucía', 'Historical source commentary', 'Written test · unit 3']) {
    assert.ok(realFixture.includes(marker), `real fixture contains ${marker}`);
    assert.ok(webFixture.includes(marker), `web fixture contains ${marker}`);
  }
  assert.match(webFixture, /STU_BSQV/);
  for (const weight of ['weight: 30', 'weight: 25', 'weight: 15']) assert.ok(webFixture.includes(weight));
  for (const status of ['not_submitted', 'not_assessed', 'exempt']) assert.ok(webFixture.includes(status));
  for (const surface of ['groups', 'rubrics', 'exams', 'grades', 'planned']) {
    assert.match(webApp, new RegExp(`${surface}:`), `web demo implements the ${surface} route`);
  }
  assert.match(webApp, /feedback previews, not finished tools/);
  assert.doesNotThrow(() => new Function(webFixture));
  assert.doesNotThrow(() => new Function(webApp));
});

test('landing copy describes the current Teaching scope and names Nodus directly', () => {
  // The site was rebuilt in English only in August 2026, so this no longer checks
  // translation keys — only that the Teaching claims themselves stay honest.
  // The Nodus landing moved to site/nodus/ when site/index.html became the family front page.
  const landing = read('site/nodus/index.html');
  assert.match(landing, /href="\.\.\/demo\/teaching\.html"/, 'the landing opens the Teaching demo');
  assert.doesNotMatch(landing, /Tú traes los datos, él hace los números/);
  assert.doesNotMatch(landing, /You bring the data, it runs the numbers/);
  assert.doesNotMatch(landing, /Teaching guide · linked/);
  assert.doesNotMatch(landing, /Open the four live demos/);
  assert.match(landing, /published assessment plan in a gradebook that keeps non-numeric states explicit/);
  assert.match(landing, /AI generates teaching content only, and never grades, profiles or evaluates students/);
});

test('the FAQ documents Teaching availability in every maintained FAQ translation', () => {
  let source = read('site/faq.js');
  source = source.replace('window.renderFaq = renderFaq;', 'window.__FAQ = FAQ; window.__COMPACT = COMPACT; window.renderFaq = renderFaq;');
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: 'site/faq.js' });

  const faq = context.window.__FAQ;
  for (const lang of ['en', 'es', 'fr', 'it', 'de', 'pt', 'tr', 'zh']) {
    assert.equal(faq[lang].length, 20, `${lang} keeps the canonical 20-question FAQ`);
    assert.equal(faq[lang].at(-1).id, 'teaching-mode', `${lang} includes the Teaching question`);
    assert.equal(faq[lang].at(-1).cat, 'features');
  }
  assert.match(faq.en.at(-1).a, /feedback previews in design/);
  assert.match(faq.es.at(-1).a, /vistas previas de feedback en diseño/);
});
