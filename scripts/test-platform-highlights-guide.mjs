import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('new installs learn MCP, Nodus Server, Zotero and the current six-tool catalogue', async () => {
  const [guide, tutorial, navigation, icon] = await Promise.all([
    read('src/components/PlatformHighlightsGuide.tsx'),
    read('src/views/BasicsTutorial.tsx'),
    read('src/navigation.ts'),
    read('src/assets/brands/zotero.svg'),
  ]);

  assert.match(guide, /PLATFORM_HIGHLIGHTS_TUTORIAL_VERSION = 5/);
  assert.match(tutorial, /BASICS_TUTORIAL_VERSION = PLATFORM_HIGHLIGHTS_TUTORIAL_VERSION/);
  assert.match(tutorial, /\.\.\.platformHighlightSlides\('es'\)/);
  assert.match(tutorial, /\.\.\.platformHighlightSlides\('en'\)/);
  assert.match(tutorial, /\.\.\.platformHighlightSlides\(language\)/);

  for (const concept of ['MCP', 'Nodus Server', 'Nodus for Zotero', 'Nodus para Zotero', 'Nodus Apps', 'Nodus Presenter', 'OCR Workspace']) {
    assert.match(guide, new RegExp(concept), `missing platform tutorial concept: ${concept}`);
  }
  for (const tool of ['Nodus Apps', 'Nodus Convert', 'Nodus Protect', 'Nodus Translate', 'Nodus Presenter', 'OCR Workspace']) {
    assert.match(navigation, new RegExp(tool));
  }
  for (const language of ['es', 'en', 'fr', 'tr', 'de', 'it', 'pt', 'zh', 'ja', 'ru', 'uk']) {
    assert.match(guide, new RegExp(`  ${language}: \\{`));
  }
  assert.match(guide, /  'pt-BR': \{/);

  // This is Zotero's real official symbolic Z, not a generic book glyph.
  assert.match(icon, /13\.863 2\.73 13\.027 1/);
  assert.match(guide, /import zoteroLogo from '\.\.\/assets\/brands\/zotero\.svg'/);
  assert.match(guide, /<img src=\{zoteroLogo\} alt="Zotero" \/>/);
});

test('existing users get the cinematic summary after the Nodus Presenter announcement and only mark it seen on completion', async () => {
  const [guide, app, styles] = await Promise.all([
    read('src/components/PlatformHighlightsGuide.tsx'),
    read('src/App.tsx'),
    read('src/index.css'),
  ]);

  assert.match(guide, /nodus\.platformHighlightsSeen\.2026-07/);
  assert.match(guide, /previousTutorialVersion <= 0/);
  assert.match(guide, /previousTutorialVersion >= PLATFORM_HIGHLIGHTS_TUTORIAL_VERSION/);
  assert.match(guide, /data-testid="platform-highlights-update-tour"/);
  assert.match(guide, /data-testid="platform-highlights-tour-complete"/);
  assert.match(guide, /const finish = \(\) => \{[\s\S]*markSeen\(\);[\s\S]*onSettled\(\);[\s\S]*\};/);
  assert.equal((guide.match(/markSeen\(\);/g) ?? []).length, 1, 'seen state is written only by the explicit finish action');

  assert.match(app, /<PlatformHighlightsUpdateTour/);
  assert.match(app, /whatsNewSettled && pdfPresenterTutorialSettled && mobileTeaserSettled && !platformHighlightsSettled/);
  assert.match(app, /platformHighlightsSettled && !toolkitBetaTourSettled/);
  assert.ok(app.indexOf('<WhatsNewModal') < app.indexOf('<PlatformHighlightsUpdateTour'));
  assert.ok(app.indexOf('<PlatformHighlightsUpdateTour') < app.indexOf('<ToolkitBetaUpdateTour'));
  assert.ok(app.indexOf('<PlatformHighlightsUpdateTour') < app.indexOf('<NodiStyleModal'));

  assert.match(styles, /\.platform-guide-hero/);
  assert.match(styles, /\.platform-guide-zotero-brand/);
  assert.match(styles, /\.platform-guide-tool-grid/);
});
