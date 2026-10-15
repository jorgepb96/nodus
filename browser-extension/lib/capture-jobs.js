// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/** Durable, resumable capture pipeline shared by Chrome and the desktop Browser.
 * Persist BEFORE starting work and after each acknowledgement. Replaying a lost
 * acknowledgement is safe: Library metadata and attachment bytes are deduplicated.
 * Every job has its own storage key; an unrelated job can never erase its progress.
 */
export function createCaptureQueue(adapter) {
  const active = new Map();
  const persist = async (job) => {
    job.updatedAt = Date.now();
    await adapter.put(structuredClone(job));
  };
  async function enqueue(requests, properties = {}) {
    if (!requests.length || requests.length > 50) throw new Error('Invalid capture batch.');
    const job = {
      id: crypto.randomUUID(), title: requests[0].metadata.title,
      createdAt: Date.now(), updatedAt: Date.now(), status: 'queued', ...properties,
      entries: requests.map((request) => ({ title: request.metadata.title, request: structuredClone(request), result: null, error: null, uploads: [] })),
    };
    for (const [index, entry] of job.entries.entries()) entry.request.captureRequestId = `${job.id}:${index}`;
    await persist(job);
    return job;
  }
  async function process(id, retry) {
    const job = (await adapter.list()).find((entry) => entry.id === id);
    if (!job || job.status === 'complete') return job;
    for (const entry of job.entries) {
      if (entry.error && !retry) continue;
      entry.error = null;
      if (!entry.result && entry.request) {
        job.status = 'saving';
        await persist(job);
        try {
          entry.result = await adapter.save(entry.request, job);
          entry.uploads = (entry.result.pendingUploads || []).slice(0, 8).map((attachment) => ({ attachment, status: 'queued', error: null }));
          // A saved reference never needs to be submitted again on upload retry.
          entry.request = null;
          await persist(job);
        } catch (error) {
          entry.error = error.message || String(error);
          await persist(job);
          continue;
        }
      }
      for (const upload of entry.uploads) {
        if (upload.status === 'complete' || (upload.status === 'failed' && !retry)) continue;
        upload.error = null;
        try {
          if (!(await adapter.canUpload(upload.attachment, job))) {
            upload.status = 'needs-permission';
            await persist(job);
            continue;
          }
        } catch (error) {
          upload.status = 'failed'; upload.error = error.message || String(error);
          await persist(job);
          continue;
        }
        upload.status = 'downloading'; job.status = 'downloading';
        await persist(job);
        try {
          const result = await adapter.upload(entry.result.itemId, upload.attachment, job);
          entry.result.attachmentCount = result.attachmentCount;
          upload.status = 'complete';
          entry.result.warnings = (entry.result.warnings || []).filter((warning) => warning !== `${upload.attachment.title || upload.attachment.url}: ${upload.attachment.reason}`);
        } catch (error) {
          upload.status = 'failed'; upload.error = error.message || String(error);
        }
        await persist(job);
      }
    }
    job.status = job.entries.some((entry) => entry.error || entry.uploads.some((upload) => upload.status === 'failed'))
      ? 'failed' : job.entries.some((entry) => entry.uploads.some((upload) => upload.status !== 'complete')) ? 'needs-permission' : 'complete';
    await persist(job);
    if (adapter.cleanup) await adapter.cleanup(job);
    return job;
  }
  function run(id, retry = false) {
    if (!active.has(id)) {
      const promise = process(id, retry).finally(() => active.delete(id));
      active.set(id, promise);
    }
    return active.get(id);
  }
  async function resume() {
    const jobs = await adapter.list();
    return Promise.allSettled(jobs.filter((job) => !['complete', 'failed'].includes(job.status)).map((job) => run(job.id)));
  }
  return { enqueue, run, resume, list: adapter.list };
}
