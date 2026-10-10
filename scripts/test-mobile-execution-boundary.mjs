import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-mobile-boundary-'));
installRuntimeHooks(directory);
const { withMobileOperation, isMobileOperation, assertDesktopPreparation } = createRequire(import.meta.url)('../electron/desktopBridge/executionBoundary.ts');
test('mobile writes cannot start extraction or indexing, including deferred side effects', async () => {
  assert.equal(isMobileOperation(), false); assert.doesNotThrow(assertDesktopPreparation);
  await withMobileOperation(async () => {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(isMobileOperation(), true); assert.throws(assertDesktopPreparation, /desktop_preparation_required/);
  });
  assert.equal(isMobileOperation(), false); assert.doesNotThrow(assertDesktopPreparation);
});
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
