// SPDX-License-Identifier: AGPL-3.0-only
// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
import { extensionTestChromium } from './lib/browserExtensionTestRuntime.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/browser-connector'); await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, root, plugins: [react()], resolve: { alias: { '@shared': path.join(root, 'shared') } }, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ executablePath: extensionTestChromium(), headless: true });
try {
  for (const dark of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } }); const page = await context.newPage(); const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/visual-tests/browser-capture-review-harness.html`);
    await page.locator('[data-testid="browser-capture-title"]').waitFor();
    if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.getByRole('button', { name: 'Second book Ada Lovelace', exact: false }).click();
    await page.locator('[data-testid="browser-capture-title"]').fill('Second book corrected');
    await page.getByRole('button', { name: 'First paper Ada Lovelace', exact: false }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="browser-capture-title"]').value === 'First paper');
    assert.equal(await page.locator('[data-testid="browser-capture-title"]').inputValue(), 'First paper');
    await page.getByRole('button', { name: 'Second book corrected Ada Lovelace', exact: false }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="browser-capture-title"]').value === 'Second book corrected');
    assert.equal(await page.locator('[data-testid="browser-capture-title"]').inputValue(), 'Second book corrected');
    await page.screenshot({ path: path.join(output, `desktop-review-${dark ? 'dark' : 'light'}.png`) });
    await page.locator('[data-testid="browser-capture-save"]').click();
    await page.locator('[data-testid="browser-connector-success"]').waitFor();
    await page.waitForFunction(() => window.captured.length === 2);
    const requests = await page.evaluate(() => window.captured);
    assert.deepEqual(requests.map((entry) => entry.metadata.title), ['First paper', 'Second book corrected']);
    assert.deepEqual(requests.map((entry) => entry.tags), [['paper-tag'], ['book-tag']]);
    assert.equal(requests[1].metadata.creators[0].creatorType, 'editor');
    await page.getByRole('button', { name: 'Listo', exact: true }).click(); await page.locator('#reopen').click();
    await page.locator('[data-testid="browser-capture-jobs"]').waitFor();
    assert.match(await page.locator('[data-testid="browser-capture-jobs"]').textContent(), /2\/2 referencias/);
    assert.deepEqual(errors, []); await context.close();
  }
  console.log('Integrated capture review passed: independent edits, tags, editor roles and persistent history in light and dark.');
} finally { await browser.close(); await server.close(); }
