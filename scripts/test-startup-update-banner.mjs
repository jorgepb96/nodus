import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('the shell uses a startup banner and keeps guides independent of update completion', () => {
  assert.doesNotMatch(app, /StartupUpdateModal|updateSettled/);
  assert.match(app, /useUpdateProgress\(\{ checkOnStartup: true \}\)/);
  assert.match(app, /updateInstallBusy\(updateProgress\) \|\| showStartupProgress \|\| \(updateNoticeKey && deferredUpdate !== updateNoticeKey\)/);
  assert.match(app, /whatsNewSettled && !manualWhatsNewOpen/);
});
