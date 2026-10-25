import { getDb } from './database';
import type { ResearchRunContext, ResearchRunSummary } from '@shared/researchHarness';

export interface ResearchRunRecord {
  summary: ResearchRunSummary;
  context: ResearchRunContext;
  request: unknown;
  requestKey: string;
  checkpoint: Record<string, unknown>;
  stages: Record<string, unknown>;
  result?: unknown;
  conversationId?: string;
  artifactId?: string;
}
export function saveResearchRun(record: ResearchRunRecord): void {
  getDb().prepare(`INSERT INTO research_harness_runs(id,mode,status,conversation_id,artifact_id,summary_json,record_json,updated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, artifact_id=excluded.artifact_id, summary_json=excluded.summary_json,record_json=excluded.record_json,updated_at=excluded.updated_at`)
    .run(record.summary.id, record.context.mode, record.summary.status, record.conversationId ?? null, record.artifactId ?? null, JSON.stringify(record.summary), JSON.stringify(record), record.summary.updatedAt);
}
export function getResearchRun(id: string): ResearchRunRecord | null {
  if (typeof id !== 'string' || id.length > 100) throw new Error('Invalid research run');
  const row = getDb().prepare('SELECT record_json FROM research_harness_runs WHERE id=?').get(id) as { record_json: string } | undefined;
  return row ? JSON.parse(row.record_json) as ResearchRunRecord : null;
}
export function listResearchRuns(conversationId?: string, entryId?: string): ResearchRunSummary[] {
  const rows = getDb().prepare(`SELECT summary_json FROM research_harness_runs WHERE (? IS NULL OR conversation_id=?) AND (? IS NULL OR json_extract(record_json,'$.context.entryId')=?) ORDER BY updated_at DESC LIMIT 50`).all(conversationId ?? null, conversationId ?? null, entryId ?? null, entryId ?? null) as Array<{ summary_json: string }>;
  return rows.map(row => JSON.parse(row.summary_json) as ResearchRunSummary);
}
export function deleteResearchRuns(owner: { conversationId?: string; artifactId?: string; entryId?: string }): void {
  if (owner.conversationId) getDb().prepare('DELETE FROM research_harness_runs WHERE conversation_id=?').run(owner.conversationId);
  if (owner.artifactId) getDb().prepare('DELETE FROM research_harness_runs WHERE artifact_id=?').run(owner.artifactId);
  if (owner.entryId) getDb().prepare("DELETE FROM research_harness_runs WHERE mode='dictionary' AND json_extract(record_json,'$.context.entryId')=?").run(owner.entryId);
}
