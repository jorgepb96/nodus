// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCaptureQueue } from '../../browser-extension/lib/capture-jobs.js';
import type { BrowserCaptureJob, BrowserConnectorCaptureRequest } from '@shared/browserConnector';
import { sanitizeBrowserCaptureRequest } from '../browser-connector/sanitize';
import { saveBrowserCapture, uploadBrowserAttachment } from '../browser-connector/libraryCapture';
import { fetchThroughBrowserSession } from './sessionDownload';

const directory = () => path.join(app.getPath('userData'), 'browser-capture-jobs');
const fileName = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid capture job.');
  return path.join(directory(), `${id}.json`);
};
async function listJobs(): Promise<BrowserCaptureJob[]> {
  await fs.mkdir(directory(), { recursive: true, mode: 0o700 });
  const records = await Promise.all((await fs.readdir(directory())).filter((name) => /^[a-f0-9-]{36}\.json$/.test(name)).map(async (name) => {
    try { return JSON.parse(await fs.readFile(path.join(directory(), name), 'utf8')) as BrowserCaptureJob; } catch { return null; }
  }));
  return records.filter((job): job is BrowserCaptureJob => Boolean(job)).sort((a, b) => b.createdAt - a.createdAt);
}
const queue = createCaptureQueue({
  list: listJobs,
  put: async (job) => {
    await fs.mkdir(directory(), { recursive: true, mode: 0o700 });
    const file = fileName(job.id);
    await fs.writeFile(`${file}.tmp`, JSON.stringify(job), { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  },
  save: saveBrowserCapture,
  canUpload: async () => true,
  upload: async (itemId, attachment) => uploadBrowserAttachment(itemId, await fetchThroughBrowserSession(attachment.url), attachment),
  cleanup: async () => {
    const expired = (await listJobs()).filter((job) => job.status === 'complete').slice(20);
    await Promise.all(expired.map((job) => fs.rm(fileName(job.id), { force: true })));
  },
});
export async function enqueueBrowserCaptures(raw: unknown): Promise<BrowserCaptureJob> {
  if (!Array.isArray(raw) || !raw.length || raw.length > 50) throw new Error('Invalid capture batch.');
  const requests = raw.map((request) => sanitizeBrowserCaptureRequest(request));
  if (requests.some((request) => !request)) throw new Error('Invalid capture request.');
  const job = await queue.enqueue(requests as BrowserConnectorCaptureRequest[]);
  void queue.run(job.id).catch(() => undefined);
  return job;
}
export const listBrowserCaptureJobs = listJobs;
export async function retryBrowserCaptureJob(id: string): Promise<void> {
  fileName(id);
  void queue.run(id, true).catch(() => undefined);
}
export async function resumeBrowserCaptureJobs(): Promise<void> { await queue.resume(); }
