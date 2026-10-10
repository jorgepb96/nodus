import { createHash } from 'node:crypto';
import { getDb, withVaultDatabase } from '../db/database';
import { withOwningVault } from '../vaults/vaultRegistry';
import { applyIncomingMutations, type IncomingMutation } from '../serverSync/mutationInbox';
import { invalidateLiveCorpus } from './liveCorpus';
import { canonicalJson } from '../../shared/canonicalJson';
import { withMobileOperation } from './executionBoundary';

// Content edits do not grant ACL administration, tools, automation or pipeline operations.
const writable = new Set(['notes', 'note_folders', 'note_links', 'pages', 'page_blocks', 'page_links', 'page_document_updates', 'page_revisions', 'page_comments',
  'writing_saved_drafts', 'writing_draft_reads', 'writing_draft_annotations', 'content_translations', 'immersion_sessions',
  'dictionary_entries', 'dictionary_evidence', 'dictionary_versions', 'dictionary_relations', 'world_scene_text', 'world_scene_snapshots', 'world_chapter_breaks']);

export async function applyBridgeMutations(vaultId: string, grantId: string, input: unknown): Promise<unknown> {
  if (!Array.isArray(input) || input.length > 100) throw new Error('invalid_mutations');
  const accepted: string[] = [], duplicate: string[] = [], rejected: Array<{ id: string; reason: string }> = [];
  await withOwningVault(vaultId, () => withVaultDatabase(vaultId, () => {
    const db = getDb();
    db.exec('CREATE TABLE IF NOT EXISTS desktop_bridge_receipts (grant_id TEXT NOT NULL, mutation_id TEXT NOT NULL, payload_hash TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY(grant_id,mutation_id))');
    for (const raw of input) {
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || raw.id.length > 128) throw new Error('invalid_mutation');
      if (!writable.has(raw.table) || !['upsert', 'delete'].includes(raw.kind) || !Array.isArray(raw.key)) { rejected.push({ id: raw.id, reason: 'table_not_writable' }); continue; }
      if (raw.assets?.length) { rejected.push({ id: raw.id, reason: 'assets_not_uploaded' }); continue; }
      const payload = createHash('sha256').update(canonicalJson(raw)).digest('hex');
      const receipt = db.prepare('SELECT payload_hash FROM desktop_bridge_receipts WHERE grant_id=? AND mutation_id=?').get(grantId, raw.id) as { payload_hash: string } | undefined;
      if (receipt) { if (receipt.payload_hash === payload) duplicate.push(raw.id); else rejected.push({ id: raw.id, reason: 'idempotency_conflict' }); continue; }
      db.transaction(() => {
        const mutation: IncomingMutation = { ...raw, id: `${grantId}:${raw.id}`, seq: Date.now(), clientId: grantId, actorId: grantId, deviceId: grantId };
        const result = withMobileOperation(() => applyIncomingMutations(db, [mutation]));
        if (result.refused.length || result.retryable.length || result.keptLocal) {
          rejected.push({ id: raw.id, reason: result.keptLocal ? 'conflict_local_revision' : result.refused[0]?.reason ?? result.retryable[0]?.reason ?? 'not_applied' }); return;
        }
        db.prepare('INSERT INTO desktop_bridge_receipts VALUES(?,?,?,?)').run(grantId, raw.id, payload, new Date().toISOString());
        accepted.push(raw.id);
      })();
    }
  }));
  invalidateLiveCorpus(vaultId);
  // This route writes the canonical vault in the same transaction as its receipt.
  // Unlike a Cloud/Server relay, acceptance here also confirms application.
  return { accepted, duplicate, rejected, applied: [...accepted, ...duplicate], cursor: null };
}
