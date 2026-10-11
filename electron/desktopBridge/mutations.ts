import { createHash } from 'node:crypto';
import { getDb, withVaultDatabase } from '../db/database';
import { withOwningVault, getVault } from '../vaults/vaultRegistry';
import worldContent from '../../shared/mobileWorldContentTables.json';
import { applyIncomingMutations, type IncomingMutation } from '../serverSync/mutationInbox';
import { invalidateLiveCorpus } from './liveCorpus';
import { canonicalJson } from '../../shared/canonicalJson';
import { withMobileOperation } from './executionBoundary';
import {applyMobileDatabaseMutation,mobileDatabaseMutationTables,MobileDatabaseMutationError} from './databaseMutations';
import {prepareMobileWorldMutation,finishMobileWorldMutation,MobileWorldMutationError} from './worldMutations';

// Content edits do not grant ACL administration, tools, automation or pipeline operations.
const writable = new Set([...mobileDatabaseMutationTables,'notes', 'note_folders', 'note_links', 'pages', 'page_favorites', 'page_blocks', 'page_links', 'page_document_updates', 'page_revisions', 'page_comments',
  'writing_saved_drafts', 'writing_draft_reads', 'writing_draft_annotations', 'content_translations', 'immersion_sessions',
  'dictionary_entries', 'dictionary_evidence', 'dictionary_versions', 'dictionary_relations']);

export function mobileWorldContentMutationTables(vaultId: string, domains: readonly string[]) {
  if(getVault(vaultId)?.type!==worldContent.family||!domains.includes('writing'))return [];
  return [...worldContent.tables,...(domains.includes('files')?worldContent.fileTables:[])];
}
export async function applyBridgeMutations(vaultId: string, grantId: string, input: unknown, domains: readonly string[] = ['corpus', 'writing']): Promise<unknown> {
  if (!Array.isArray(input) || input.length > 100) throw new Error('invalid_mutations');
  const accepted: string[] = [], duplicate: string[] = [], rejected: Array<{ id: string; reason: string;error_description?:string }> = [];
  const worldTables = new Set(mobileWorldContentMutationTables(vaultId,domains));
  const permitted = new Set([...writable,...worldTables]);
  await withOwningVault(vaultId, () => withVaultDatabase(vaultId, () => {
    const db = getDb();
    db.exec('CREATE TABLE IF NOT EXISTS desktop_bridge_receipts (grant_id TEXT NOT NULL, mutation_id TEXT NOT NULL, payload_hash TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY(grant_id,mutation_id))');
    db.exec('CREATE TABLE IF NOT EXISTS desktop_bridge_creations(grant_id TEXT NOT NULL,mutation_id TEXT NOT NULL,table_name TEXT NOT NULL,row_key TEXT NOT NULL,PRIMARY KEY(grant_id,mutation_id))');
    for (const raw of input) {
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || raw.id.length > 128) throw new Error('invalid_mutation');
      if (!permitted.has(raw.table) || !['upsert', 'delete'].includes(raw.kind) || !Array.isArray(raw.key)) { rejected.push({ id: raw.id, reason: 'table_not_writable' }); continue; }
      if (raw.assets?.length) { rejected.push({ id: raw.id, reason: 'assets_not_uploaded' }); continue; }
      const payload = createHash('sha256').update(canonicalJson(raw)).digest('hex');
      const receipt = db.prepare('SELECT payload_hash FROM desktop_bridge_receipts WHERE grant_id=? AND mutation_id=?').get(grantId, raw.id) as { payload_hash: string } | undefined;
      if (receipt) { if (receipt.payload_hash === payload) duplicate.push(raw.id); else rejected.push({ id: raw.id, reason: 'idempotency_conflict' }); continue; }
      try {db.transaction(() => {
        const creatingScene=worldTables.has(raw.table)&&raw.table==='world_scenes'&&raw.kind==='upsert'&&raw.key.length===1
          &&!db.prepare('SELECT 1 FROM world_scenes WHERE scene_id=?').get(raw.key[0]);
        if(withMobileOperation(()=>applyMobileDatabaseMutation(raw))){
          db.prepare('INSERT INTO desktop_bridge_receipts VALUES(?,?,?,?)').run(grantId,raw.id,payload,new Date().toISOString());accepted.push(raw.id);return;
        }
        const sqlRow=raw.row?Object.fromEntries(Object.entries(raw.row).map(([key,value])=>[key,typeof value==='boolean'?(value?1:0):value])):undefined;
        const mutation: IncomingMutation = { ...raw, row:sqlRow, id: `${grantId}:${raw.id}`, seq: Date.now(), clientId: grantId, actorId: grantId, deviceId: grantId };
        const before = worldTables.has(raw.table) ? withMobileOperation(()=>prepareMobileWorldMutation(raw)) : undefined;
        const result = withMobileOperation(() => applyIncomingMutations(db, [mutation]));
        if (result.refused.length || result.retryable.length || result.keptLocal) {
          rejected.push({ id: raw.id, reason: result.keptLocal ? 'conflict_local_revision' : result.refused[0]?.reason ?? result.retryable[0]?.reason ?? 'not_applied' }); return;
        }
        if(worldTables.has(raw.table))withMobileOperation(()=>finishMobileWorldMutation(raw,before));
        if(creatingScene)db.prepare('INSERT INTO desktop_bridge_creations VALUES(?,?,?,?)').run(grantId,raw.id,raw.table,JSON.stringify(raw.key));
        db.prepare('INSERT INTO desktop_bridge_receipts VALUES(?,?,?,?)').run(grantId, raw.id, payload, new Date().toISOString());
        accepted.push(raw.id);
      })();}catch(error){if(error instanceof MobileDatabaseMutationError)rejected.push({id:raw.id,reason:error.message,error_description:error.description});else if(error instanceof MobileWorldMutationError)rejected.push({id:raw.id,reason:error.message,error_description:error.description});else throw error;}
    }
  }));
  invalidateLiveCorpus(vaultId);
  // This route writes the canonical vault in the same transaction as its receipt.
  // Unlike a Cloud/Server relay, acceptance here also confirms application.
  return { accepted, duplicate, rejected, applied: [...accepted, ...duplicate], cursor: null };
}
