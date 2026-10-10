import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { utilityProcess } from 'electron';
import type Database from 'better-sqlite3';
import { beginReplicaImportWait } from '../db/replicaImportWait';
import type { ReplicaWorkerResult } from './serverReplicaWorker';

const active = new Set<() => void>();
export function cancelReplicaImports(): void { for (const cancel of active) cancel(); }

/** Download to disk; large buffers, decompression, JSON and SQLite stay off the UI thread. */
export async function importReplicaSnapshotInUtility(response: Response, db: Database.Database, schemaVersion: number, connections: Database.Database[] = [db]): Promise<ReplicaWorkerResult> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nodus-replica-'));
  const file = path.join(directory, 'snapshot');
  const abort = new AbortController();
  const cancel = () => abort.abort(new Error('La importación de la réplica se ha cancelado.'));
  active.add(cancel);
  const timeout = setTimeout(() => abort.abort(new Error('La descarga del snapshot ha superado el plazo máximo.')), 120_000);
  try {
    if (!response.body) throw new Error('El snapshot remoto está vacío.');
    const reader = response.body.getReader();
    const cancelReader = () => { void reader.cancel(abort.signal.reason).catch(() => undefined); };
    abort.signal.addEventListener('abort', cancelReader, { once: true });
    const output = await fs.promises.open(file, 'wx', 0o600);
    try {
      let bytes = 0;
      for (;;) {
        abort.signal.throwIfAborted();
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 512 * 1024 * 1024) throw new Error('El snapshot supera el límite de descarga de 512 MiB.');
        await output.writeFile(chunk.value);
      }
      abort.signal.throwIfAborted();
    } finally { void reader.cancel().catch(() => undefined); await output.close(); abort.signal.removeEventListener('abort', cancelReader); }
    clearTimeout(timeout);
    const workerFile = process.env.NODUS_SERVER_REPLICA_WORKER_FILE || path.join(__dirname, 'serverReplicaWorker.js');
    if (!fs.existsSync(workerFile) || !utilityProcess?.fork) throw new Error('El proceso auxiliar de réplica no está disponible. Reinstala o actualiza Nodus.');
    // WAL readers continue during import. Main-process writers fail promptly rather
    // than blocking Electron's event loop waiting for the worker's transaction.
    const finishWait = beginReplicaImportWait(db.name,connections);
    try {
      return await new Promise<ReplicaWorkerResult>((resolve, reject) => {
        const child = utilityProcess.fork(workerFile, [], { serviceName: 'Nodus replica import', stdio: 'pipe' });
        let finished = false;
        const deadline = setTimeout(() => finish(new Error('La importación del snapshot ha superado el plazo máximo de dos minutos.')), 120_000);
        const onAbort = () => finish(abort.signal.reason);
        function finish(error?: Error, result?: ReplicaWorkerResult): void {
          if (finished) return; finished = true; clearTimeout(deadline); abort.signal.removeEventListener('abort', onAbort); child.kill();
          if (error) reject(error); else if (result) resolve(result); else reject(new Error('El proceso auxiliar no devolvió un resultado.'));
        }
        abort.signal.addEventListener('abort', onAbort, { once: true });
        child.once('exit', (code) => finish(new Error(`El proceso auxiliar de réplica terminó sin completar la importación (${code}).`)));
        child.on('message', (message: { ok?: boolean; error?: string; result?: ReplicaWorkerResult }) => {
          if (message.ok && message.result) finish(undefined, message.result);
          else finish(new Error(message.error || 'No se pudo importar el snapshot.'));
        });
        if (abort.signal.aborted) onAbort(); else child.postMessage({ file, database: db.name, schemaVersion });
      });
    } finally { finishWait(); }
  } finally { clearTimeout(timeout); active.delete(cancel); await fs.promises.rm(directory, { recursive: true, force: true }); }
}
