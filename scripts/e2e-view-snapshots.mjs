// Real-renderer acceptance test for what a section remembers when you leave it.
//
// The repository tests prove the store and read the wiring; only the running app can
// prove the thing the reader actually notices: that walking out of Deep Research and
// back in lands on the same report, at the same paragraph, with the same gallery
// controls — and that the paragraph is found again by what it says, not by how many
// pixels down the page it happened to be.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-view-snapshots-ui-'));
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

/** The block under the top edge of the reader, as the reader would read it. */
const TOP_BLOCK = `(() => {
  const root = document.querySelector('[data-testid="deep-research-reader-document"]');
  const scroller = root?.closest('main');
  if (!root || !scroller) return null;
  const all = Array.from(root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, figure'));
  const blocks = all.filter((block, index) => index + 1 >= all.length || !block.contains(all[index + 1]));
  const edge = scroller.getBoundingClientRect().top + 1;
  const found = blocks.find((block) => block.getBoundingClientRect().bottom > edge) ?? null;
  return found ? (found.textContent ?? '').trim().slice(0, 80) : null;
})()`;

/**
 * Samples what is painted on every frame until told to stop. A section walking back
 * into a report or a session must never show its gallery on the way: the read of the
 * thing to reopen takes a few frames, and painting the list in the meantime looks
 * like the app opening the list and clicking the item by itself.
 */
const WATCH_SURFACES = (gallery) => `(() => {
  window.__gen = (window.__gen ?? 0) + 1;
  const mine = window.__gen;
  window.__surfaces = [];
  const started = performance.now();
  const tick = () => {
    if (window.__gen !== mine) return;
    if (document.querySelector('${gallery}')) window.__surfaces.push(Math.round(performance.now() - started));
    if (performance.now() - started < 3000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;
const DEEP_GALLERY = 'input[placeholder^="Buscar entre tus informes"]';
const IMMERSION_GALLERY = 'input[placeholder^="Buscar entre tus inmersiones"]';

let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  await page.evaluate(async (version) => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    localStorage.setItem('nodus.mobileTeaserSeen.3.2.4', '1');
    localStorage.setItem('nodus.platformHighlightsSeen.2026-07', '1');
    localStorage.setItem('nodus.tutorialVideosAnnouncementSeen.2026-07', '1');
    localStorage.setItem('nodus.pdfPresenterTutorialSeen.e2js_u-05OA', '1');
    localStorage.setItem('nodus.toolkitBetaGuideSeen.2.4.0', '1');
    await window.nodus.updateSettings({
      onboardingComplete: true,
      basicsTutorialVersion: 999,
      recoverySetupVersion: 999,
      tourComplete: true,
      advancedTourComplete: true,
      uiLanguage: 'es',
      deepResearchModel: { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
      mascotEnabled: false,
      reduceMotion: true,
    });
    await window.nodus.seedDemoData();
  }, require(path.join(repoRoot, 'package.json')).version);
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  const dismissUpdateModal = async () => {
    const updateModal = page.getByTestId('startup-update-modal');
    if (!(await updateModal.count())) return;
    await page.waitForFunction(() => document.querySelector('[data-testid="startup-update-modal"]')?.getAttribute('data-update-status') === 'not-available');
    await updateModal.getByRole('button', { name: 'Entendido', exact: false }).click();
    await updateModal.waitFor({ state: 'detached' });
  };
  await dismissUpdateModal();
  // The demo's report is one screen long, and a place only means something in a
  // document that does not fit on one. This is the demo report with a long body: same
  // brief, same shape, enough of it to scroll.
  await page.evaluate(async () => {
    const drafts = await window.nodus.listWritingWorkshopDrafts();
    const demo = drafts.find((item) => item.brief.kind === 'deep_research');
    if (!demo) throw new Error('the demo supplies no Deep Research report');
    const body = Array.from({ length: 90 }, (_, index) => (
      `## Sección ${index + 1}\n\nPárrafo ${index + 1} del informe largo, escrito para que la lectura ocupe`
      + ' bastante más que una pantalla y el sitio en el que se dejó signifique algo.'
    )).join('\n\n');
    const generationModel = { provider: 'gemini', model: 'gemini-3.1-flash-lite' };
    await window.nodus.saveWritingWorkshopDraft({
      draft: {
        ...demo.draft,
        brief: { ...demo.draft.brief, deepResearchApproach: 'literature_review' },
        title: 'AAA informe largo de prueba',
        draftMarkdown: body,
        deepResearchApproach: 'literature_review',
        generationModel,
      },
      model: generationModel,
    });
  });

  const openDeepResearch = () => page.locator('[data-tour="nav-deepResearch"]').click();
  const readerDocument = page.locator('[data-testid="deep-research-reader-document"]');
  // The gallery sort is a menu, not a select: its trigger carries the current value.
  const sortMenu = (testId) => ({
    choose: async (value) => {
      await page.getByTestId(testId).click();
      await page.getByTestId(`${testId}-menu`).locator(`[data-value="${value}"]`).click();
    },
    value: () => page.getByTestId(testId).getAttribute('data-value'),
  });
  const sortSelect = sortMenu('deep-research-sort');

  // ── The gallery's own controls ──────────────────────────────────────────────
  await openDeepResearch();
  if (process.env.NODUS_E2E_APPROACH_SCREENSHOT || process.env.NODUS_E2E_STRUCTURE_SCREENSHOT || process.env.NODUS_E2E_SINGLE_BLOCK_SCREENSHOT) {
    await page.getByRole('button', { name: 'Nuevo informe', exact: true }).click();
    const composer = page.getByRole('dialog', { name: 'Nuevo informe' });
    await composer.waitFor({ state: 'visible' });
    await composer.locator('textarea').fill('Analiza cómo distintas estrategias de aprendizaje favorecen la memoria a largo plazo.');
    const approachSelector = page.getByTestId('deep-research-approach');
    assert.equal(await approachSelector.locator('option').count(), 7, 'the real composer contains every research approach');
    await approachSelector.selectOption('literature_review');
    assert.match(await page.getByTestId('deep-research-approach-help').innerText(), /líneas de interpretación|métodos/i);
    const versionSelector = page.getByTestId('deep-research-version');
    assert.deepEqual(await versionSelector.locator('option').allTextContents(), [
      'v1 · Recuperación sencilla (por defecto)',
      'v2 · Análisis ampliado (más tokens)',
    ], 'the real composer exposes both reproducible Deep Research versions');
    assert.equal(await versionSelector.inputValue(), 'v1', 'new reports default to lower-cost v1');
    assert.match(await page.getByTestId('deep-research-version-help').innerText(), /menos tokens/i);
    await versionSelector.selectOption('v2');
    const v2Help = page.getByTestId('deep-research-version-help');
    assert.match(await v2Help.innerText(), /consume más tokens/i);
    assert.match(await v2Help.innerText(), /hasta 8 documentos completos/i);
    assert.match(await v2Help.getAttribute('class') ?? '', /text-amber-/, 'v2 cost warning is visually emphasized');
    await versionSelector.selectOption('v1');
    const sectionSelector = page.getByTestId('deep-research-section-limit');
    assert.deepEqual(await sectionSelector.locator('option').allTextContents(), [
      'Secciones: Auto (IA decide)',
      'Bloque único · sin secciones',
      'Máx. 4 secciones',
      'Máx. 5 secciones',
      'Máx. 6 secciones',
      'Máx. 8 secciones',
      'Máx. 10 secciones',
    ], 'the real composer exposes continuous and sectioned structures');
    const languageSelector = page.getByTestId('deep-research-language');
    const modelSelector = composer.locator('select[aria-label="Modelo"]');
    const controlHeights = await Promise.all([versionSelector, sectionSelector, languageSelector, modelSelector].map((locator) => locator.evaluate((element) => element.getBoundingClientRect().height)));
    assert.ok(Math.max(...controlHeights) - Math.min(...controlHeights) <= 2, `all four composer controls are visually balanced (${controlHeights.join(' vs ')} px)`);
    if (process.env.NODUS_E2E_APPROACH_SCREENSHOT) await page.screenshot({ path: process.env.NODUS_E2E_APPROACH_SCREENSHOT });
    if (process.env.NODUS_E2E_STRUCTURE_SCREENSHOT) await composer.screenshot({ path: process.env.NODUS_E2E_STRUCTURE_SCREENSHOT });
    if (process.env.NODUS_E2E_SINGLE_BLOCK_SCREENSHOT) {
      await sectionSelector.selectOption('single');
      assert.match(await page.locator('#deep-research-section-limit-help').innerText(), /narración continua|sin encabezados/i);
      await composer.screenshot({ path: process.env.NODUS_E2E_SINGLE_BLOCK_SCREENSHOT });
    }
    await page.setViewportSize({ width: 600, height: 900 });
    const mobileLayout = await composer.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      controls: [...element.querySelectorAll('#deep-research-section-limit, [data-testid="deep-research-version"], [data-testid="deep-research-language"], select[aria-label="Modelo"]')]
        .map((control) => control.getBoundingClientRect().width),
    }));
    assert.ok(mobileLayout.scrollWidth <= mobileLayout.clientWidth, 'the one-column composer has no horizontal overflow');
    assert.ok(Math.max(...mobileLayout.controls) - Math.min(...mobileLayout.controls) <= 2, `mobile controls share one balanced width (${mobileLayout.controls.join(' vs ')} px)`);
    await page.setViewportSize({ width: 1400, height: 900 });
    if (process.env.NODUS_E2E_VERSION_V1_SCREENSHOT) {
      await versionSelector.selectOption('v1');
      assert.match(await page.getByTestId('deep-research-version-help').innerText(), /pasajes ya extraídos|menos tokens/i);
      await page.screenshot({ path: process.env.NODUS_E2E_VERSION_V1_SCREENSHOT });
    }
    await composer.getByRole('button', { name: 'Cerrar' }).click();
    await composer.waitFor({ state: 'detached' });
  }
  await sortSelect.choose('title');
  const galleryGenerationTags = page.getByTestId('deep-research-generation-tags').first();
  assert.match(await galleryGenerationTags.innerText(), /Gemini 3\.1 Flash Lite/);
  assert.match(await galleryGenerationTags.innerText(), /Revisión de la literatura/);

  // ── A report, and a place inside it ─────────────────────────────────────────
  await page.getByRole('button', { name: 'Leer', exact: true }).first().click();
  await readerDocument.waitFor({ state: 'visible' });
  const generationTags = page.getByTestId('deep-research-generation-tags').first();
  assert.match(await generationTags.innerText(), /Gemini 3\.1 Flash Lite/);
  assert.match(await generationTags.innerText(), /Revisión de la literatura/);
  const reportTitle = await page.locator('header .truncate.text-sm.font-semibold').first().innerText();
  const reportProse = readerDocument.locator('.md');
  const outlineRail = page.getByTestId('deep-research-outline-rail');
  await outlineRail.waitFor({ state: 'visible' });
  assert.equal(await outlineRail.locator('nav button').count(), 90, 'the margin indexes every rendered report heading');
  assert.equal(await outlineRail.locator('[aria-current="location"]').count(), 1, 'one report section is current');
  const markerBounds = await outlineRail.locator('[aria-current="location"] > span[aria-hidden="true"]').evaluate((marker) => {
    const markerBox = marker.getBoundingClientRect();
    const navBox = marker.closest('nav').getBoundingClientRect();
    return { markerLeft: markerBox.left, markerRight: markerBox.right, navLeft: navBox.left, navRight: navBox.right };
  });
  assert.ok(
    markerBounds.markerLeft >= markerBounds.navLeft && markerBounds.markerRight <= markerBounds.navRight,
    'the section marker fits inside the scroll rail without clipping',
  );

  const wrapping = await reportProse.evaluate((element) => {
    const style = getComputedStyle(element);
    return { wordBreak: style.wordBreak, overflowWrap: style.overflowWrap, hyphens: style.hyphens };
  });
  assert.deepEqual(
    wrapping,
    { wordBreak: 'normal', overflowWrap: 'normal', hyphens: 'none' },
    'report prose wraps complete words without automatic hyphenation',
  );
  const initialFontSize = await reportProse.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));

  // A real wheel, not an assignment to scrollTop: the capture deliberately waits for
  // the reader's own hands before it starts overwriting the stored place.
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 1_600);
  await page.waitForTimeout(400);
  const leftAt = await page.evaluate(TOP_BLOCK);
  assert.ok(leftAt, 'the reader is somewhere inside the report');
  const scrolled = await page.evaluate(() => document.querySelector('[data-testid="deep-research-reader-document"]').closest('main').scrollTop);
  assert.ok(scrolled > 200, `the wheel moved the report (scrollTop ${scrolled})`);
  await page.waitForFunction(() => {
    const active = document.querySelector('[data-testid="deep-research-outline-rail"] [aria-current="location"]');
    return active && active.textContent?.trim() !== 'Sección 1';
  });
  assert.notEqual(
    (await outlineRail.locator('[aria-current="location"]').innerText()).trim(),
    'Sección 1',
    'the margin advances as the report scrolls',
  );

  await page.getByTestId('deep-research-font-increase').evaluate((button) => button.click());
  await page.waitForFunction((expected) => {
    const prose = document.querySelector('[data-testid="deep-research-reader-document"] .md');
    return prose && parseFloat(getComputedStyle(prose).fontSize) === expected;
  }, initialFontSize + 1);
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(TOP_BLOCK), leftAt, 'changing type size keeps the visible paragraph in place');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('nodus.deepResearch.readerFontSize')),
    String(initialFontSize + 1),
    'the reader remembers its type size',
  );
  if (process.env.NODUS_E2E_READER_SCREENSHOT) {
    await page.screenshot({ path: process.env.NODUS_E2E_READER_SCREENSHOT });
  }

  // ── Out of the section, and back in ─────────────────────────────────────────
  await page.locator('[data-tour="nav-ideas"]').click();
  await page.waitForSelector('[data-testid="deep-research-reader-document"]', { state: 'detached' });
  await page.evaluate(WATCH_SURFACES(DEEP_GALLERY));
  await openDeepResearch();
  await readerDocument.waitFor({ state: 'visible' });
  assert.deepEqual(
    await page.evaluate(() => window.__surfaces),
    [],
    'the gallery is never painted on the way back to an open report',
  );

  const backAt = await page.evaluate(TOP_BLOCK);
  assert.equal(backAt, leftAt, 'the report reopens at the paragraph it was left on');
  const backTitle = await page.locator('header .truncate.text-sm.font-semibold').first().innerText();
  assert.equal(backTitle, reportTitle, 'and it is the same report');
  assert.equal(
    await readerDocument.locator('.md').evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    initialFontSize + 1,
    'and the chosen type size survives reopening the report',
  );

  // The same place after a resize, which is the whole reason it is a block and not a
  // pixel offset: the text rewraps and the offset it was read at no longer exists.
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.locator('[data-tour="nav-ideas"]').click();
  await page.waitForSelector('[data-testid="deep-research-reader-document"]', { state: 'detached' });
  await openDeepResearch();
  await readerDocument.waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(TOP_BLOCK), leftAt, 'a narrower window still finds the same paragraph');

  // ── Back to the gallery, with its controls as they were left ────────────────
  await page.getByRole('button', { name: 'Volver a la galería' }).click();
  await page.getByTitle('Vista lista').click();
  await page.waitForSelector('.space-y-2 [data-anchor-id]');
  await page.locator('[data-tour="nav-ideas"]').click();
  await openDeepResearch();
  await readerDocument.waitFor({ state: 'detached' });
  assert.equal(await sortSelect.value(), 'title', 'the ordering survives leaving the section');
  const listActive = await page.evaluate(() => Boolean(document.querySelector('.space-y-2 [data-anchor-id]')));
  assert.ok(listActive, 'and so does the list/grid choice');
  const firstCard = await page.evaluate(() => document.querySelector('[data-anchor-id]')?.textContent?.includes('AAA informe largo'));
  assert.ok(firstCard, 'the ordering is the restored one, not the default');

  // ── Inmersión: the session that was open, open again ────────────────────────
  //
  // The session carries its own progress, so the only thing lost on the way out is
  // that it was open at all. Reopening it is a read, and it lands on the same step.
  await page.locator('[data-tour="nav-immersion"]').click();
  const immersionExit = page.getByRole('button', { name: 'Salir', exact: true });
  await page.locator('[data-anchor-id]').first().click();
  await immersionExit.waitFor({ state: 'visible' });
  const step = await page.locator('header .text-\\[11px\\]').first().innerText();
  await page.locator('[data-tour="nav-ideas"]').click();
  await immersionExit.waitFor({ state: 'detached' });
  await page.evaluate(WATCH_SURFACES(IMMERSION_GALLERY));
  await page.locator('[data-tour="nav-immersion"]').click();
  await immersionExit.waitFor({ state: 'visible' });
  assert.deepEqual(
    await page.evaluate(() => window.__surfaces),
    [],
    'nor on the way back to an open session',
  );
  assert.equal(await page.locator('header .text-\\[11px\\]').first().innerText(), step, 'the immersion reopens on the step it was left on');

  // And leaving the player is leaving it: the gallery does not reopen it by itself.
  await immersionExit.click();
  await page.locator('[data-tour="nav-ideas"]').click();
  await page.locator('[data-tour="nav-immersion"]').click();
  await immersionExit.waitFor({ state: 'detached' });

  // ── A restart: what was a preference, and what was only a place ─────────────
  //
  // Reloading the window throws the entire renderer away, module-level snapshot store
  // included, which is what the reader gets on the next launch. Everything above this
  // line is remembered by that store; only the ordering, the read filter and the
  // grid/list choice are expected to come back from disk.
  const immersionSort = sortMenu('immersion-sort');
  await immersionSort.choose('title');
  await page.getByTitle('Vista lista').click();

  // A search and an open report, which are a question and a place: neither is a
  // preference, and neither may come back a launch later to hide the gallery.
  await openDeepResearch();
  await page.locator('input[placeholder^="Buscar entre tus informes"]').fill('AAA informe largo');
  await page.getByRole('button', { name: 'Leer', exact: true }).first().click();
  await readerDocument.waitFor({ state: 'visible' });

  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await dismissUpdateModal();

  await openDeepResearch();
  await readerDocument.waitFor({ state: 'detached' });
  assert.equal(await sortSelect.value(), 'title', 'the ordering survives the restart');
  assert.ok(
    await page.evaluate(() => Boolean(document.querySelector('.space-y-2 [data-anchor-id]'))),
    'and so does the list/grid choice',
  );
  assert.equal(
    await page.locator('input[placeholder^="Buscar entre tus informes"]').inputValue(),
    '',
    'the search box does not come back with them',
  );

  await page.locator('[data-tour="nav-immersion"]').click();
  await page.locator('[data-anchor-id]').first().waitFor({ state: 'visible' });
  assert.equal(await immersionSort.value(), 'title', 'Inmersión reopens on its own stored ordering');
  assert.ok(
    await page.evaluate(() => Boolean(document.querySelector('.space-y-2 [data-anchor-id]'))),
    'and on its own stored layout',
  );

  assert.deepEqual(pageErrors.map((error) => error.message), [], 'no renderer errors');
  console.log('View snapshots e2e passed.');
} finally {
  await app?.close();
  await rm(userData, { recursive: true, force: true });
}
