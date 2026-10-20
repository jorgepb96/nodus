// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { downloadVerifiedNodusAsset } from '../ai/nodusLocalAi';
import { TTS_MODELS, ttsModelBytes, type TtsModelDefinition, type TtsModelStatus } from '@shared/ttsModels';

/**
 * Downloads, verifies and removes Ming checkpoints under `models/<id>/`. A checkpoint counts
 * as installed only once every asset matched its pinned size and SHA-256 and `ready.json` was
 * written, so status checks are a single small read rather than re-hashing gigabytes. A
 * transfer belongs to the main process: closing Settings does not stop it, and reopening it
 * joins the running job.
 */
interface ActiveDownload {
  controller: AbortController;
  downloadedBytes: number;
  totalBytes: number;
  listeners: Set<(status: TtsModelStatus) => void>;
  promise: Promise<void>;
}

const active = new Map<string, ActiveDownload>();

export class TtsModelStore {
  constructor(readonly root: string, private inUse: (modelId: string) => boolean = () => false) {}

  dir(modelId: string): string {
    return path.join(this.root, modelId);
  }

  async isReady(model: TtsModelDefinition): Promise<boolean> {
    try {
      const marker = JSON.parse(await fs.readFile(path.join(this.dir(model.id), 'ready.json'), 'utf8')) as { files?: string[] };
      return model.assets.every((asset) => marker.files?.includes(`${asset.file}:${asset.sha256}`));
    } catch { return false; }
  }

  async status(model: TtsModelDefinition): Promise<TtsModelStatus> {
    const job = active.get(model.id);
    const totalBytes = ttsModelBytes(model);
    if (job) {
      return { id: model.id, downloaded: false, downloading: true, downloadedBytes: job.downloadedBytes, totalBytes, progress: totalBytes ? job.downloadedBytes / totalBytes : 0 };
    }
    const downloaded = await this.isReady(model);
    return { id: model.id, downloaded, downloading: false, downloadedBytes: downloaded ? totalBytes : 0, totalBytes, progress: downloaded ? 1 : 0 };
  }

  async statuses(): Promise<TtsModelStatus[]> {
    return Promise.all(TTS_MODELS.filter((model) => !model.unpublished).map((model) => this.status(model)));
  }

  download(model: TtsModelDefinition, onProgress?: (status: TtsModelStatus) => void): Promise<void> {
    if (model.unpublished || !model.assets.length) return Promise.reject(new Error('TTS_MODEL_UNAVAILABLE'));
    const running = active.get(model.id);
    if (running) return this.follow(running, onProgress);
    const controller = new AbortController();
    const totalBytes = ttsModelBytes(model);
    const job: ActiveDownload = { controller, downloadedBytes: 0, totalBytes, listeners: new Set(), promise: Promise.resolve() };
    const emit = () => {
      const status: TtsModelStatus = { id: model.id, downloaded: false, downloading: true, downloadedBytes: job.downloadedBytes, totalBytes, progress: totalBytes ? job.downloadedBytes / totalBytes : 0 };
      for (const listener of job.listeners) { try { listener(status); } catch { /* observers never own the transfer */ } }
    };
    let lastEmit = 0;
    job.promise = (async () => {
      const dir = this.dir(model.id);
      await fs.mkdir(dir, { recursive: true });
      for (const asset of model.assets) {
        await downloadVerifiedNodusAsset(asset.url, path.join(dir, asset.file), asset.bytes, asset.sha256, (bytes) => {
          job.downloadedBytes += bytes;
          const now = Date.now();
          // ~4 events a second is plenty for a progress bar and keeps IPC traffic negligible.
          if (now - lastEmit > 250) { lastEmit = now; emit(); }
        }, controller.signal);
      }
      const marker = path.join(dir, 'ready.json');
      await fs.writeFile(`${marker}.tmp`, JSON.stringify({ files: model.assets.map((asset) => `${asset.file}:${asset.sha256}`) }));
      await fs.rename(`${marker}.tmp`, marker);
    })().finally(() => {
      active.delete(model.id);
    });
    active.set(model.id, job);
    return this.follow(job, onProgress);
  }

  cancel(modelId: string): void {
    active.get(modelId)?.controller.abort();
  }

  async remove(model: TtsModelDefinition): Promise<void> {
    if (active.has(model.id)) throw new Error('TTS_MODEL_DOWNLOADING');
    if (this.inUse(model.id)) throw new Error('TTS_MODEL_IN_USE');
    await fs.rm(this.dir(model.id), { recursive: true, force: true });
  }

  private follow(job: ActiveDownload, onProgress?: (status: TtsModelStatus) => void): Promise<void> {
    if (!onProgress) return job.promise;
    job.listeners.add(onProgress);
    return job.promise.finally(() => job.listeners.delete(onProgress));
  }
}
