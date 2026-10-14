// The startup sequence is an ordered list of guards, and the order IS the
// behaviour: swap two entries and a user meets the recovery wizard before the
// guide that picks their language. It used to be a run of early returns in
// App.tsx, where the same invariant was only the order the lines happened to be in.
import assert from 'node:assert/strict';
import test from 'node:test';
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
