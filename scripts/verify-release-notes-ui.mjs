// Start with: npx vite --config visual-tests/vite.release-notes.config.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { loadReleaseNotes } from './generate-release-notes.mjs';
const { releaseNoteSections, RELEASE_SECTION_LABELS, RELEASE_EMPTY_SECTION } = await loadReleaseNotes();
const compiled = await build({ entryPoints: ['shared/releaseNotes.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { RELEASE_NOTES } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const current = RELEASE_NOTES[0];
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
assert.equal(current.version, pkg.version);
// Independently authored order for v5.8.1: Scriptor, two enhancements and five fixes.
assert.equal(current.version, '5.8.1');
const expected = current.highlights;
assert.deepEqual(expected.map(h => h.category), ['new','enhancement','enhancement','fix','fix','fix','fix','fix']);
const output = `artifacts/release-${current.version}`;
const baseUrl = process.env.NODUS_RELEASE_NOTES_URL ?? 'http://127.0.0.1:5198';
// The modal caps its own height and scrolls its body, and the shell pins html/body/#root
// to the viewport with `overflow: hidden`, so a full-page screenshot would otherwise stop
// at the fold. Releasing all three lets the document grow to the whole release.
const LIFT_SCROLL_CAP = 'html,body,#root{height:auto!important;overflow:visible!important}'
  + '.whats-new-backdrop{position:static!important;display:block!important;padding:24px!important}'
  + '.whats-new-cinema{max-height:none!important;margin:0 auto!important}'
  + '.whats-new-scroll{overflow:visible!important}';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['light', 'dark']) for (const lang of ['es','en','fr','de','pt','pt-BR','it','tr','zh-CN','zh-TW','ja','ko']) {
    await page.goto(`${baseUrl}/visual-tests/release-notes-harness.html?theme=${theme}&lang=${lang}`);
    const release = page.getByTestId('whats-new-selected-release');
    await release.waitFor();
    assert.equal(await release.locator('.whats-new-release-version').textContent(), `v${current.version}`);
    assert.deepEqual(await release.locator('li > span:last-child').allTextContents(), expected.map(highlight => highlight[lang]), `${theme}/${lang}: rendered order and every translation`);
    assert.deepEqual(await release.locator('li [data-testid^="whats-new-scope-"]').evaluateAll(items => items.map(item => item.getAttribute('data-testid').replace('whats-new-scope-', ''))), expected.map(highlight => highlight.scope));
    assert.deepEqual(await release.locator('.whats-new-category-title').allTextContents(), Object.values(RELEASE_SECTION_LABELS[lang]));
    assert.equal(await release.locator('svg, img').count(), expected.length, 'every entry has an icon');
    if (lang === 'es') await page.screenshot({ path: `${output}/modal-${theme}.png`, animations: 'disabled' });
    await page.getByTestId('whats-new-version-trigger').click();
    assert.equal(await page.getByTestId('whats-new-version-5.8.0').count(), 1, `${theme}/${lang}: the release just superseded stays in the picker`);
    assert.equal(await page.getByTestId('whats-new-version-5.7.0').count(), 1);
    assert.equal(await page.getByTestId('whats-new-version-5.6.0').count(), 1);
    assert.equal(await page.getByTestId('whats-new-version-5.3.2').count(), 0);
  }
  // Exercise every historical v5 release in every language through the actual picker.
  // The published text and scope are checked by the data suite, here we check placement.
  for (const lang of ['es','en','fr','de','pt','pt-BR','it','tr','zh-CN','zh-TW','ja','ko']) {
    await page.goto(`${baseUrl}/visual-tests/release-notes-harness.html?theme=light&lang=${lang}`);
    for (const note of RELEASE_NOTES.filter(note => note.version.startsWith('5.') && note.version !== current.version)) {
      await page.getByTestId('whats-new-version-trigger').click();
      await page.getByTestId(`whats-new-version-${note.version}`).click();
      const release = page.getByTestId('whats-new-selected-release');
      assert.deepEqual(await release.locator('.whats-new-category-title').allTextContents(), Object.values(RELEASE_SECTION_LABELS[lang]));
      for (const section of releaseNoteSections(note)) {
        const rendered = release.locator(`[data-category="${section.category}"]`);
        assert.deepEqual(await rendered.locator('li > span:last-child').allTextContents(), section.highlights.map(h => h[lang]));
        if (!section.highlights.length) assert.equal(await rendered.locator('.whats-new-category-empty').textContent(), RELEASE_EMPTY_SECTION[lang]);
      }
    }
    await page.getByTestId('whats-new-version-trigger').click();
    await page.getByTestId('whats-new-version-4.2.5').click();
    assert.equal(await page.locator('.whats-new-category-title').count(), 0, 'v4 keeps its original layout');
  }
  // Confirm the modal remains scrollable on a small window.
  await page.setViewportSize({ width: 800, height: 650 });
  await page.goto(`${baseUrl}/visual-tests/release-notes-harness.html?theme=dark&lang=es`);
  await page.getByTestId('whats-new-selected-release').waitFor();
  assert.ok(await page.locator('.whats-new-scroll').evaluate(el => el.scrollHeight > el.clientHeight));
  await page.locator('.whats-new-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
  assert.equal(await page.getByTestId('whats-new-footer-support-paypal').isVisible(), true);
  await page.screenshot({ path: `${output}/modal-small.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const theme of ['light', 'dark']) {
    await page.goto(`${baseUrl}/visual-tests/release-notes-harness.html?theme=${theme}&lang=es`);
    await page.getByTestId('whats-new-selected-release').waitFor();
    await page.addStyleTag({ content: LIFT_SCROLL_CAP });
    await page.screenshot({ path: `${output}/modal-${theme}-full.png`, animations: 'disabled', fullPage: true });
    if (theme === 'light') for (const scope of new Set(expected.map(h => h.scope))) {
      await page.getByTestId(`whats-new-scope-${scope}`).first().screenshot({ path: `${output}/icon-${scope}.png`, animations: 'disabled' });
    }
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(`${output}/modal-order-es.md`, `# Novedades de Nodus ${current.version}\n\n${releaseNoteSections(current).map(section => `## ${RELEASE_SECTION_LABELS.es[section.category]}\n\n` + section.highlights.map(highlight => `- [${highlight.scope}] ${highlight.es}`).join('\n\n')).join('\n\n')}\n`);
  console.log(`PASS: ${current.highlights.length} release notes in exact displayed order, all twelve languages in light/dark, v5.8.1 active, all historical v5 sections translated and v4 layout unchanged and unpublished v5.3.2 absent.`);
} finally { await browser.close(); }
