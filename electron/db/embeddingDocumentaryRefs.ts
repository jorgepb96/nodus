import type Database from 'better-sqlite3';
import type { EmbeddingIndexContext } from '@shared/embeddingIndexes';
import { contractForProfile, indexRow, profileFingerprint } from './embeddingIndexesRepo';

export function recordDocumentaryIndexReference(db: Database.Database, shared: Database.Database, vaultId: string, context: EmbeddingIndexContext, indexKey: string, documentId: string): void {
  const revision = shared.prepare('SELECT embedding_ready,identity_json FROM documentary_revisions WHERE index_key=?').get(indexKey) as { embedding_ready: number; identity_json: string } | undefined;
  if (!revision?.embedding_ready) throw new Error('documentary_embedding_revision_unavailable');
  const identity = JSON.parse(revision.identity_json);
  if (identity.embedding?.provider !== context.profile.provider || identity.embedding?.model !== context.profile.model
    || identity.embedding?.parameters?.embeddingProfile !== profileFingerprint(context.profile)) throw new Error('embedding_contract_mismatch');
  const dim = Number(identity.embedding.dimensions);
  contractForProfile(context.profile, dim);
  const row = indexRow(db, context.indexId);
  if (context.generation !== row.generation && context.generation !== row.staging_generation) throw new Error('embedding_index_generation_retired');
  const expected = row.generation === context.generation ? row.dimensions : row.staging_dimensions;
  if (expected !== null && expected !== dim) throw new Error('embedding_contract_dimension_mismatch');
  if (row.generation === context.generation && row.dimensions === null) db.prepare('UPDATE embedding_indexes SET dimensions=? WHERE id=?').run(dim, row.id);
  if (row.staging_generation === context.generation && row.staging_dimensions === null) db.prepare('UPDATE embedding_indexes SET staging_dimensions=? WHERE id=?').run(dim, row.id);
  // Shared ownership is published first. A crash between the two leaves an extra owner,
  // never a vault reference to data the collector thinks it may destroy.
  shared.prepare('INSERT OR IGNORE INTO documentary_embedding_index_owners(vault_id,index_id,generation,index_key) VALUES(?,?,?,?)')
    .run(vaultId, context.indexId, context.generation, indexKey);
  db.prepare('INSERT OR IGNORE INTO embedding_index_documentary_refs(index_id,generation,index_key,document_id) VALUES(?,?,?,?)')
    .run(context.indexId, context.generation, indexKey, documentId);
}

export function documentaryIndexStorage(shared: Database.Database, vaultId: string, indexId: string): { sharedBytes: number; reclaimableBytes: number } {
  const rows = shared.prepare(`SELECT p.index_key,COALESCE(SUM(length(p.vector)),0)+COALESCE(SUM(length(p.vector_json)),0) bytes
    FROM documentary_passages p WHERE p.index_key IN (SELECT index_key FROM documentary_embedding_index_owners WHERE vault_id=? AND index_id=?) GROUP BY p.index_key`)
    .all(vaultId, indexId) as Array<{ index_key: string; bytes: number }>;
  const protectedKey = shared.prepare('SELECT 1 FROM documentary_embedding_index_owners WHERE index_key=? AND (vault_id<>? OR index_id<>?) LIMIT 1');
  let reclaimableBytes = 0;
  for (const row of rows) if (!protectedKey.get(row.index_key, vaultId, indexId)) reclaimableBytes += row.bytes;
  return { sharedBytes: rows.reduce((sum, row) => sum + row.bytes, 0), reclaimableBytes };
}

export function releaseDocumentaryIndexReferences(shared: Database.Database, vaultId: string, indexId: string): void {
  shared.transaction(() => {
    const keys = shared.prepare('SELECT DISTINCT index_key FROM documentary_embedding_index_owners WHERE vault_id=? AND index_id=?').all(vaultId, indexId) as Array<{ index_key: string }>;
    shared.prepare('DELETE FROM documentary_embedding_index_owners WHERE vault_id=? AND index_id=?').run(vaultId, indexId);
    for (const { index_key: key } of keys) {
      if (shared.prepare('SELECT 1 FROM documentary_embedding_index_owners WHERE index_key=? LIMIT 1').get(key)) continue;
      // Citation text, locators, lexical rows and immutable evidence keep their identities.
      shared.prepare('UPDATE documentary_passages SET vector=NULL,vector_json=NULL WHERE index_key=?').run(key);
      shared.prepare('UPDATE documentary_revisions SET embedding_ready=0 WHERE index_key=?').run(key);
    }
  }).immediate();
}
