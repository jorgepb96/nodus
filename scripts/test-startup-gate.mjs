// The startup sequence is an ordered list of guards, and the order IS the
// behaviour: swap two entries and a user meets the recovery wizard before the
// guide that picks their language. It used to be a run of early returns in
// App.tsx, where the same invariant was only the order the lines happened to be in.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readSource } from './ipc-channel-census.mjs';

const EXPECTED_ORDER = [
  'load-error',
  'settings-loading',
  'basics-tutorial',
  'first-vault',
  'academic-learning-welcome',
  'recovery-status-unknown',
  'recovery-setup',
  'onboarding',
];

test('retired announcements cannot reach new or existing installs through the renderer bundle', async () => {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
    entryPoints: ['src/App.tsx'],
    bundle: true,
    format: 'esm',
    write: false,
    metafile: true,
    packages: 'external',
    external: ['*.css'],
    loader: { '.svg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl', '.jpg': 'dataurl' },
    plugins: [{
      name: 'external-vite-resource-urls',
      setup(builder) {
        builder.onResolve({ filter: /\?/ }, (args) => ({ path: args.path, external: true }));
      },
    }],
    logLevel: 'silent',
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.every((input) => !input.startsWith('archive/')), 'historical announcements must stay outside the application');
  for (const component of ['WhatsNewModal', 'PlatformHighlightsGuide', 'ToolkitBetaGuide', 'TutorialVideos', 'NodiStyleModal', 'LibraryTutorialModal', 'ResearchPreparationWelcome']) {
    assert.ok(inputs.includes(`src/components/${component}.tsx`), `${component} must remain available`);
  }
  const code = result.outputFiles[0].text;
  for (const announcement of ['pdf-presenter-tutorial-announcement', 'mobile-teaser-guide', 'platform-highlights-update-tour', 'toolkit-beta-update-tour', 'tutorial-videos-update-tour']) {
    assert.ok(!code.includes(announcement), `${announcement} can still render from the application bundle`);
  }
  for (const seenKey of ['nodus.pdfPresenterTutorialSeen', 'nodus.mobileTeaserSeen', 'nodus.platformHighlightsSeen', 'nodus.toolkitBetaGuideSeen', 'nodus.tutorialVideosAnnouncementSeen']) {
    assert.ok(!code.includes(seenKey), `${seenKey} still participates in startup`);
  }
});

test('the startup guards keep their order', async () => {
  const source = readSource('src/app/StartupGate.tsx');
  const ids = [...source.matchAll(/^\s{4}id: '([a-z-]+)',$/gm)].map((match) => match[1]);
  assert.deepEqual(ids, EXPECTED_ORDER);
  // And the exported list, which is what the shape of the file promises.
  assert.match(source, /export const STARTUP_GUARD_ORDER/);
});

test('App.tsx delegates the whole sequence and keeps no early return of its own', async () => {
  const app = readSource('src/App.tsx');
  assert.match(app, /const startupGate = resolveStartupGate\(\{/);
  assert.match(app, /if \(startupGate\) return startupGate;/);
  // The components each guard renders live with the guard, not with the shell.
  for (const marker of ['<BasicsTutorial', '<FirstVaultSetup', '<RecoverySetupWizard', '<Onboarding']) {
    assert.ok(!app.includes(marker), `${marker} still renders from App.tsx`);
  }
});

test('only one guard can own the screen', async () => {
  const source = readSource('src/app/StartupGate.tsx');
  // First match wins, by construction: both loops return on the first true predicate.
  assert.match(source, /for \(const guard of UNSETTLED_GUARDS\) \{\s*\n\s*if \(guard\.when\(state\)\) return guard\.render\(state\);/);
  assert.match(source, /for \(const guard of SETTLED_GUARDS\) \{\s*\n\s*if \(guard\.when\(settled\)\) return guard\.render\(settled\);/);
});

test('the render language is set once settings are known and before any guard renders', async () => {
  const source = readSource('src/app/StartupGate.tsx');
  const settledLoop = source.indexOf('for (const guard of SETTLED_GUARDS)');
  const setLang = source.indexOf('setActiveLang(settled.settings.uiLanguage)');
  const unsettledLoop = source.indexOf('for (const guard of UNSETTLED_GUARDS)');
  assert.ok(unsettledLoop > 0 && setLang > unsettledLoop, 'the language is set after the guards that run without settings');
  assert.ok(setLang < settledLoop, 'and before any guard that reads settings renders');
});
