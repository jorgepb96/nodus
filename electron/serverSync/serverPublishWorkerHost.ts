import fs from 'node:fs';
import path from 'node:path';
import { utilityProcess } from 'electron';
import type { SnapshotAsset } from './serverSnapshot';
import type { BuiltServerLibraryPublication } from './serverLibrary';
import type { VaultSummary } from '@shared/types';
import type { VaultServerConfig } from './serverSyncShared';
import type { CloudflarePublishResult } from './cloudflarePublisher';
import type { VectorKind, VectorSetSummary } from './serverVectors';
import { ServerHttpError } from './serverNetwork';
import type {
  CloudflarePublishWorkerRequest,
  ServerPublishWorkerRequest,
  ServerPublishWorkerResponse,
  ServerSnapshotWorkerRequest,
} from './serverPublishWorkerTypes';

let nextRequestId = 1;
const WORKER_TIMEOUT_MS = 30 * 60_000;
const activeCloudflarePublications = new Set<() => void>();

export function cancelCloudflarePublications(): void {
  for (const cancel of activeCloudflarePublications) cancel();
}

function workerFile(): string {
  return process.env.NODUS_SERVER_PUBLISH_WORKER_FILE
    || path.join(__dirname, 'serverPublishWorker.js');
}

export interface CompressedServerSnapshot {
  compressed: Buffer;
  rawBytes: number;
  revision: string;
  counts: Record<string, number>;
  assets: SnapshotAsset[];
  schemaVersion: number;
  personal: import('@shared/serverPublication').ServerPersonalImportEnvelope | null;
  vectors: Array<{
    kind: VectorKind;
    revision: string;
    compressed: Buffer;
    summary: VectorSetSummary;
  }>;
}

export function serverPublishWorkerAvailable(): boolean {
  return process.env.NODUS_DISABLE_SERVER_PUBLISH_WORKER !== '1' && fs.existsSync(workerFile());
}

/** One short-lived utility process per snapshot releases the native SQLite connection and
 * the large V8 heap as soon as the compressed payload crosses back to the main process. */
export async function buildServerSnapshotInUtility(
  input: Omit<ServerSnapshotWorkerRequest, 'kind' | 'id'>,
): Promise<CompressedServerSnapshot> {
  const message = await runUtility({ kind: 'build', id: nextRequestId++, ...input });
  if (message.kind !== 'done') throw new Error('El publicador auxiliar devolvió una respuesta inesperada.');
  return {
    ...message,
    compressed: Buffer.from(message.compressed),
    assets: message.assets.map((asset) => ({
      ...asset,
      data: Buffer.from(asset.data),
      thumbData: asset.thumbData ? Buffer.from(asset.thumbData) : null,
    })),
    vectors: message.vectors.map((vector) => ({ ...vector, compressed: Buffer.from(vector.compressed) })),
  };
}

export async function publishVaultToCloudflareInUtility(input: {
  vaultPath: string;
  vault: VaultSummary;
  config: VaultServerConfig;
  token: string;
  library: BuiltServerLibraryPublication | null;
}): Promise<CloudflarePublishResult> {
  const request: CloudflarePublishWorkerRequest = {
    kind: 'publish-cloudflare',
    id: nextRequestId++,
    ...input,
  };
  const message = await runUtility(request);
  if (message.kind !== 'cloudflare-done') throw new Error('El publicador Cloudflare auxiliar devolvió una respuesta inesperada.');
  return message.result;
}

function runUtility(request: ServerPublishWorkerRequest): Promise<ServerPublishWorkerResponse> {
  if (!serverPublishWorkerAvailable()) {
    return Promise.reject(new Error('El proceso auxiliar de publicación no está disponible. Reinstala o actualiza Nodus.'));
  }
  const child = utilityProcess.fork(workerFile(), [], {
    serviceName: 'Nodus Server publisher',
    stdio: 'inherit',
  });
  return new Promise<ServerPublishWorkerResponse>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error('El proceso auxiliar de publicación superó el límite de 30 minutos.')),
      WORKER_TIMEOUT_MS,
    );
    timeout.unref?.();
    const finish = (error?: Error, result?: ServerPublishWorkerResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      activeCloudflarePublications.delete(cancel);
      child.kill();
      if (error) reject(error);
      else resolve(result!);
    };
    const cancel = () => finish(new Error('La publicación de Cloudflare se ha detenido.'));
    if (request.kind === 'publish-cloudflare') activeCloudflarePublications.add(cancel);
    child.on('message', (message: ServerPublishWorkerResponse) => {
      if (!message || message.id !== request.id) return;
      if (message.kind === 'error') {
        finish(message.status ? new ServerHttpError(message.status, message.error) : new Error(message.error));
        return;
      }
      finish(undefined, message);
    });
    child.once('error', (error) => finish(new Error(String(error))));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`El proceso auxiliar de publicación terminó con código ${code}.`));
    });
    child.postMessage(request);
  });
}
