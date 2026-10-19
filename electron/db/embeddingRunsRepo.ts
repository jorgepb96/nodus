import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { EmbeddingIndexRun, EmbeddingItemOutcome, EmbeddingRunReason } from '@shared/embeddingRuns';

export const EMBEDDING_RUNS_SQL = `
CREATE TABLE IF NOT EXISTS embedding_index_runs (
 id TEXT PRIMARY KEY, index_id TEXT NOT NULL REFERENCES embedding_indexes(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL, reason TEXT NOT NULL,last_reason TEXT NOT NULL,state TEXT NOT NULL,
 reviewed INTEGER NOT NULL DEFAULT 0,reused INTEGER NOT NULL DEFAULT 0,computed INTEGER NOT NULL DEFAULT 0,
 excluded INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,provider_inputs INTEGER NOT NULL DEFAULT 0,
 started_at TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT
);
CREATE INDEX IF NOT EXISTS embedding_index_runs_recent ON embedding_index_runs(index_id,started_at DESC,id);
CREATE TABLE IF NOT EXISTS embedding_index_run_items (
 run_id TEXT NOT NULL REFERENCES embedding_index_runs(id) ON DELETE CASCADE,family TEXT NOT NULL,entity_id TEXT NOT NULL,
 text_hash TEXT NOT NULL,outcome TEXT NOT NULL,reason TEXT,PRIMARY KEY(run_id,family,entity_id)
);
CREATE TABLE IF NOT EXISTS embedding_index_run_events (
 id INTEGER PRIMARY KEY,run_id TEXT NOT NULL REFERENCES embedding_index_runs(id) ON DELETE CASCADE,
 reason TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL
);`;
const now = () => new Date().toISOString();
function serialize(row: Record<string, unknown>): EmbeddingIndexRun {
  return { id: String(row.id), indexId: String(row.index_id), generation: Number(row.generation), reason: row.reason as EmbeddingRunReason,
    lastReason: row.last_reason as EmbeddingRunReason, state: row.state as EmbeddingIndexRun['state'],
    reviewed: Number(row.reviewed), reused: Number(row.reused), computed: Number(row.computed), excluded: Number(row.excluded),
    failed: Number(row.failed), providerInputs: Number(row.provider_inputs), startedAt: String(row.started_at), updatedAt: String(row.updated_at), error: row.error as string | null };
}
export function listEmbeddingRuns(db: Database.Database, indexId?: string, limit = 30): EmbeddingIndexRun[] {
  return (db.prepare('SELECT * FROM embedding_index_runs WHERE (? IS NULL OR index_id=?) ORDER BY started_at DESC,rowid DESC LIMIT ?')
    .all(indexId ?? null, indexId ?? null, Math.max(1, Math.min(100, limit))) as Array<Record<string, unknown>>).map(serialize);
}
export function changeEmbeddingRun(db: Database.Database, id: string, state: EmbeddingIndexRun['state'], reason?: EmbeddingRunReason, error: string | null = null): void {
  db.prepare('UPDATE embedding_index_runs SET state=?,last_reason=COALESCE(?,last_reason),updated_at=?,error=? WHERE id=?').run(state, reason ?? null, now(), error, id);
  if (reason) db.prepare('INSERT INTO embedding_index_run_events(run_id,reason,state,created_at) VALUES(?,?,?,?)').run(id, reason, state, now());
}
export function beginEmbeddingRun(db: Database.Database, indexId: string, generation: number, reason: EmbeddingRunReason): string {
  const previous = listEmbeddingRuns(db, indexId, 1)[0];
  if (['resume', 'retry'].includes(reason) && previous?.generation === generation && previous.state !== 'complete') {
    changeEmbeddingRun(db, previous.id, 'running', reason); return previous.id;
  }
  const id = randomUUID(), at = now();
  db.prepare('INSERT INTO embedding_index_runs(id,index_id,generation,reason,last_reason,state,started_at,updated_at) VALUES(?,?,?,?,?,\'running\',?,?)')
    .run(id, indexId, generation, reason, reason, at, at);
  db.prepare('INSERT INTO embedding_index_run_events(run_id,reason,state,created_at) VALUES(?,?,\'running\',?)').run(id, reason, at);
  return id;
}
export function recordEmbeddingRunItem(db: Database.Database, runId: string, family: string, entityId: string, textHash: string, outcome: EmbeddingItemOutcome, reason?: string): void {
  db.transaction(() => {
    const old = db.prepare('SELECT outcome,text_hash FROM embedding_index_run_items WHERE run_id=? AND family=? AND entity_id=?').get(runId, family, entityId) as { outcome: EmbeddingItemOutcome; text_hash: string } | undefined;
    if (old?.outcome === 'computed' && outcome === 'reused' && old.text_hash === textHash) return;
    if (old?.outcome === outcome && old.text_hash === textHash) return;
    db.prepare('INSERT INTO embedding_index_run_items VALUES(?,?,?,?,?,?) ON CONFLICT(run_id,family,entity_id) DO UPDATE SET text_hash=excluded.text_hash,outcome=excluded.outcome,reason=excluded.reason')
      .run(runId, family, entityId, textHash, outcome, reason ?? null);
    db.prepare('UPDATE embedding_index_runs SET reviewed=reviewed+?,updated_at=? WHERE id=?').run(old ? 0 : 1, now(), runId);
    for (const [field, delta] of [[old?.outcome, -1], [outcome, 1]] as const) if (field && field !== 'pending')
      db.prepare(`UPDATE embedding_index_runs SET ${field}=${field}+? WHERE id=?`).run(delta, runId);
  })();
}
export function recordEmbeddingProviderInputs(db: Database.Database, id: string, count: number): void {
  db.prepare('UPDATE embedding_index_runs SET provider_inputs=provider_inputs+?,updated_at=? WHERE id=?').run(count, now(), id);
}
