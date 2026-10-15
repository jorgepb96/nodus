import Database from 'better-sqlite3';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { buildServerPersonalImport, buildServerSnapshot } from './serverSnapshot';
import type { ServerPublishWorkerRequest, ServerPublishWorkerResponse } from './serverPublishWorkerTypes';
import { publishVaultToCloudflare } from './cloudflarePublisher';
import { buildVectorSet } from './serverVectors';
import { ServerHttpError } from './serverNetwork';

const gzipAsync = promisify(gzip);

async function build(request: ServerPublishWorkerRequest): Promise<ServerPublishWorkerResponse> {
  const db = new Database(request.vaultPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    db.pragma('busy_timeout = 5000');
    if (request.kind === 'publish-cloudflare') {
      const result = await publishVaultToCloudflare(request.config, request.token, request.vault, db, request.library);
      return { kind: 'cloudflare-done', id: request.id, result };
    }
    const snapshot = buildServerSnapshot(request.vault, request.settings, db, request.library);
    const personal = buildServerPersonalImport(
      request.vault,
      request.settings,
      db,
      request.publisherId,
      request.libraryAnnotations || [],
    );
    const compressed = await gzipAsync(snapshot.buffer, { level: 1 });
    const vectors = [];
    for (const kind of request.vectorKinds) {
      const built = buildVectorSet(db, kind);
      if (!built) continue;
      vectors.push({
        kind,
        revision: `${built.summary.provider}|${built.summary.model}|${built.summary.dim}|${built.summary.count}`,
        compressed: await gzipAsync(built.buffer, { level: 1 }),
        summary: built.summary,
      });
    }
    return {
      kind: 'done',
      id: request.id,
      compressed,
      rawBytes: snapshot.buffer.byteLength,
      revision: snapshot.revision,
      counts: snapshot.counts,
      assets: snapshot.assets,
      schemaVersion: snapshot.schemaVersion,
      personal,
      vectors,
    };
  } finally {
    db.close();
  }
}

process.parentPort?.on('message', (event) => {
  const request = event.data as ServerPublishWorkerRequest;
  void build(request).then(
    (response) => process.parentPort?.postMessage(response),
    (error) => process.parentPort?.postMessage({
      kind: 'error',
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
      status: error instanceof ServerHttpError ? error.status : undefined,
    } satisfies ServerPublishWorkerResponse),
  );
});
