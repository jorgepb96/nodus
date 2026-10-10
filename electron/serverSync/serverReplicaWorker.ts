import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { applySnapshotToReplica } from './replicaApply';
import { ASSET_SOURCES, type SnapshotAssetRef } from './serverSnapshot';

export interface ReplicaWorkerRequest { file: string; database: string; schemaVersion: number }
export interface ReplicaWorkerResult { revision: string | null; assets: SnapshotAssetRef[] }
const MAX_JSON_BYTES = 256 * 1024 * 1024;

export function importReplicaSnapshot(input: ReplicaWorkerRequest): ReplicaWorkerResult {
  if (fs.statSync(input.file).size > 512 * 1024 * 1024) throw new Error('El snapshot supera el límite de descarga de 512 MiB.');
  const raw = fs.readFileSync(input.file);
  const decoded = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw, { maxOutputLength: MAX_JSON_BYTES }) : raw;
  if (decoded.length > MAX_JSON_BYTES) throw new Error('El snapshot supera el límite de importación de 256 MiB.');
  const snapshot = JSON.parse(decoded.toString('utf8')) as {
    format?: string; schemaVersion?: number; revision?: string; tables?: Record<string, unknown>; assets?: SnapshotAssetRef[];
  };
  if (!snapshot || typeof snapshot !== 'object' || snapshot.format !== 'nodus.server-snapshot'
    || !snapshot.tables || typeof snapshot.tables !== 'object' || Array.isArray(snapshot.tables)) throw new Error('El snapshot remoto no tiene un formato válido.');
  if (!Number.isSafeInteger(snapshot.schemaVersion) || Number(snapshot.schemaVersion) > input.schemaVersion) throw new Error('El snapshot requiere una versión de Nodus más reciente o tiene un esquema inválido.');
  let rows = 0;
  for (const value of Object.values(snapshot.tables)) {
    if (!Array.isArray(value) || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('El snapshot contiene tablas inválidas.');
    rows += value.length;
    if (rows > 2_000_000) throw new Error('El snapshot supera el límite de dos millones de filas.');
  }
  if (snapshot.assets && (!Array.isArray(snapshot.assets) || snapshot.assets.length > 10000)) throw new Error('El snapshot supera el límite de diez mil imágenes.');
  for (const asset of snapshot.assets ?? []) {
    const source=ASSET_SOURCES.find((entry)=>entry.table===asset.table);
    if (!source || !Array.isArray(asset.key) || asset.key.length!==source.keyColumns.length
      || asset.key.some((key)=>typeof key!=='string' || key.length>512) || !/^[0-9a-f]{64}$/.test(asset.hash)
      || (asset.thumbHash && !/^[0-9a-f]{64}$/.test(asset.thumbHash))) throw new Error('El snapshot contiene referencias de imágenes inválidas.');
  }
  const refs=JSON.stringify(snapshot.assets ?? []);
  if (Buffer.byteLength(refs)>2*1024*1024) throw new Error('Las referencias de imágenes superan 2 MiB.');
  const db = new Database(input.database, { fileMustExist: true });
  try {
    db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 1000');
    db.transaction(()=>{
      applySnapshotToReplica(db, snapshot);
      db.exec('CREATE TABLE IF NOT EXISTS sync_snapshot_assets(id INTEGER PRIMARY KEY CHECK(id=1),refs TEXT NOT NULL)');
      db.prepare('INSERT OR REPLACE INTO sync_snapshot_assets VALUES(1,?)').run(refs);
    })();
    return { revision: typeof snapshot.revision === 'string' ? snapshot.revision : null, assets: snapshot.assets ?? [] };
  } finally { db.close(); }
}

process.parentPort?.on('message', (event) => {
  try { process.parentPort?.postMessage({ ok: true, result: importReplicaSnapshot(event.data as ReplicaWorkerRequest) }); }
  catch (error) { process.parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
});
