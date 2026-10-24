import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const repo = path.resolve(import.meta.dirname, '..');
const file = path.join(repo, `.bench-scan-complete-${process.pid}.mjs`);
await build({ entryPoints: [path.join(repo, 'src/hooks.ts')], outfile: file, bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'silent' });
const dom = new JSDOM('<main id="root"></main>');
const saved = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let listener, renders = 0;
dom.window.nodus = { onQueueProgress(callback) { listener = callback; return () => { listener = null; }; } };
const { useScanComplete } = await import(pathToFileURL(file));
const root = createRoot(document.getElementById('root'));
function View() { useScanComplete(() => { renders++; }); return null; }
const progress = (overrides = {}) => ({ items: [], total: 0, done: 0, failed: 0, maintenanceRunning: false, finishedAt: null, ...overrides });
try {
  await act(() => root.render(React.createElement(View)));
  // Cached summaries complete before the coalescer emits any running state.
  const done = progress({ total: 1, done: 1, items: [{ id: 'cached-summary', state: 'done' }], finishedAt: '2026-10-24T10:00:00.000Z' });
  await act(() => listener(done));
  assert.equal(renders, 1, 'a single finished event refreshes the saved summary and clears the stale pending badge');
  await act(() => listener(done));
  assert.equal(renders, 1, 'the same completion cannot cause repeated reloads');
  await act(() => listener(progress({ items: [{ id: 'deep', state: 'running' }] })));
  await act(() => listener(progress({ items: [{ id: 'deep', state: 'done' }], maintenanceRunning: true })));
  assert.equal(renders, 1, 'required graph maintenance keeps the task active');
  await act(() => listener(progress({ items: [{ id: 'deep', state: 'done' }], finishedAt: '2026-10-24T10:00:01.000Z' })));
  assert.equal(renders, 2);
  await act(() => listener(progress({ items: [{ id: 'cancel', state: 'running' }] })));
  await act(() => listener(progress({ items: [{ id: 'cancel', state: 'cancelled' }] })));
  assert.equal(renders, 3, 'a cancelled job is terminal even though it is neither done nor failed');
  console.log('Real React completion hook: cached single-event jobs, duplicate notifications, maintenance and cancellation passed.');
} finally {
  await act(() => root.unmount());
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  dom.window.close(); fs.rmSync(file, { force: true });
}
