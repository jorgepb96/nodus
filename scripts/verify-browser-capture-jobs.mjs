// SPDX-License-Identifier: AGPL-3.0-only
// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-browser-capture-jobs')) process.exit(0);
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-capture-jobs-'));
installRuntimeHooks(path.join(scratch, 'profile'));
const require = createRequire(import.meta.url);
const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
const library = require(path.join(repoRoot, 'electron/library/libraryService.ts'));
const browser = require(path.join(repoRoot, 'electron/browser/sessionDownload.ts'));
const jobs = require(path.join(repoRoot, 'electron/browser/captureJobs.ts'));
let offline = true;
browser.fetchThroughBrowserSession = async () => {
  if (offline) throw new Error('Synthetic browser session temporarily unavailable');
  return new TextEncoder().encode('Synthetic browser attachment for capture queue verification.');
};
const waitFor = async (id, status) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const job = (await jobs.listBrowserCaptureJobs()).find((entry) => entry.id === id);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.fail(`Capture job did not become ${status}`);
};
try {
  settings.updateSettings({ autoBackupFolder: path.join(scratch, 'backups') });
  library.getGlobalLibraryStatus();
  library.setGlobalLibrarySettings({ ...library.getGlobalLibrarySettings(), autoPrepareAttachments: false });
  const job = await jobs.enqueueBrowserCaptures([{
    pageUrl: 'https://example.test/article', metadataSource: 'generic', metadataReviewed: true,
    metadata: { title: 'Synthetic capture job', itemType: 'report', creators: [], year: null, isbn: [], issn: [], tags: ['reviewed'] },
    attachments: [{ url: 'http://127.0.0.1:1/private.txt', title: 'Session file', fileName: 'session.txt', mimeType: 'text/plain', role: 'original' }],
  }]);
  const failed = await waitFor(job.id, 'failed');
  const itemId = failed.entries[0].result.itemId;
  assert.equal(library.listGlobalLibraryItems().total, 1);
  assert.equal(failed.entries[0].request, null, 'a saved reference must not be retried');
  offline = false; await jobs.retryBrowserCaptureJob(job.id);
  const complete = await waitFor(job.id, 'complete');
  assert.equal(library.listGlobalLibraryItems().total, 1);
  assert.equal(complete.entries[0].result.itemId, itemId);
  assert.equal(library.getGlobalLibraryItem(itemId).attachments.length, 1);
  const persisted = JSON.parse(await readFile(path.join(scratch, 'profile/browser-capture-jobs', `${job.id}.json`), 'utf8'));
  assert.equal(persisted.status, 'complete');
  // Rewind to an uncertain upload acknowledgement, as after a process crash.
  persisted.status = 'downloading'; persisted.entries[0].uploads[0].status = 'downloading';
  await writeFile(path.join(scratch, 'profile/browser-capture-jobs', `${job.id}.json`), JSON.stringify(persisted));
  await jobs.resumeBrowserCaptureJobs(); await waitFor(job.id, 'complete');
  assert.equal(library.getGlobalLibraryItem(itemId).attachments.length, 1, 'attachment replay must deduplicate identical bytes');
  assert.equal(library.listGlobalLibraryItems().total, 1);
  console.log('Desktop capture queue persisted progress, retried session files and replayed an uncertain upload without duplicate items or attachments.');
} finally { library.closeGlobalLibrary(); await rm(scratch, { recursive: true, force: true }); }
