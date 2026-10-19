import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { EMBEDDING_TEXT_RECIPE_VERSIONS } from '@shared/embeddingIndexes';

/** Physical source rows keep their identity/text. Vectors live only in embedding_index_values.
 * The compatibility views let existing SQL joins retain their shape without copying a corpus
 * when the active head changes. All write-through triggers are scoped to the active profile. */
export const EMBEDDING_FAMILIES = [
  { table: 'ideas', id: 'global_id', content: ['type', 'label', 'statement', 'orphaned_at'] },
  { table: 'work_summaries', id: 'nodus_id', content: ['summary'] },
  { table: 'passages', id: 'passage_id', content: ['text', 'content_hash'] },
  { table: 'document_vectors', id: 'vector_id', content: ['text', 'text_hash'] },
  { table: 'project_chapter_chunks', id: 'id', content: ['text'] },
  { table: 'project_chapter_ideas', id: 'id', content: ['type', 'label', 'statement'] },
  { table: 'notes', id: 'id', content: ['title', 'content', 'trashed_at'] },
  { table: 'archive_items', id: 'item_id', content: ['title', 'description', 'extracted_text', 'doc_type'] },
  { table: 'study_docs', id: 'id', content: ['title', 'content_markdown', 'deleted_at', 'archived_at'] },
  { table: 'study_materials', id: 'id', content: ['title', 'description', 'metadata_json', 'bibliography_json', 'extracted_text', 'visual_description', 'deleted_at', 'archived_at'] },
  { table: 'study_ideas', id: 'id', content: ['type', 'label', 'statement'] },
  { table: 'testimony_segment_embeddings', id: 'segment_id', content: [] },
] as const;

export const EMBEDDING_INDEX_SQL = `
  CREATE TABLE IF NOT EXISTS embedding_indexes (
    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, profile_json TEXT NOT NULL,
    generation INTEGER NOT NULL DEFAULT 1, staging_generation INTEGER, staging_dimensions INTEGER,
    legacy INTEGER NOT NULL DEFAULT 0, dimensions INTEGER,
    preparation TEXT NOT NULL DEFAULT 'idle', completed INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at TEXT NOT NULL,
    verified_revision INTEGER NOT NULL DEFAULT -1, documentary_revision INTEGER NOT NULL DEFAULT -1, recipe_stamp TEXT NOT NULL DEFAULT '',
    value_revision INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS embedding_indexes_fingerprint ON embedding_indexes(fingerprint);
  CREATE TABLE IF NOT EXISTS embedding_index_generations (
    index_id TEXT NOT NULL REFERENCES embedding_indexes(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL,value_revision INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(index_id,generation)
  );
  CREATE TABLE IF NOT EXISTS embedding_index_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), active_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, pending_id TEXT, epoch INTEGER NOT NULL DEFAULT 0,
    corpus_revision INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO embedding_index_state(singleton) VALUES(1);
  CREATE TABLE IF NOT EXISTS embedding_index_values (
    index_id TEXT NOT NULL REFERENCES embedding_indexes(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL, family TEXT NOT NULL, entity_id TEXT NOT NULL,
    text_hash TEXT NOT NULL, contract_json TEXT NOT NULL, embedding BLOB NOT NULL, recipe_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, PRIMARY KEY(index_id,generation,family,entity_id)
  );
  CREATE INDEX IF NOT EXISTS embedding_index_values_entity ON embedding_index_values(family,entity_id);
  CREATE TABLE IF NOT EXISTS embedding_index_documentary_refs (
    index_id TEXT NOT NULL REFERENCES embedding_indexes(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL, index_key TEXT NOT NULL, document_id TEXT NOT NULL,
    PRIMARY KEY(index_id,generation,index_key)
  );
  CREATE TRIGGER IF NOT EXISTS embedding_values_insert AFTER INSERT ON embedding_index_values BEGIN
    INSERT INTO embedding_index_generations VALUES(NEW.index_id,NEW.generation,1) ON CONFLICT(index_id,generation) DO UPDATE SET value_revision=value_revision+1;
    UPDATE embedding_indexes SET value_revision=value_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.index_id;
  END;
  CREATE TRIGGER IF NOT EXISTS embedding_values_update AFTER UPDATE ON embedding_index_values BEGIN
    INSERT INTO embedding_index_generations VALUES(NEW.index_id,NEW.generation,1) ON CONFLICT(index_id,generation) DO UPDATE SET value_revision=value_revision+1;
    UPDATE embedding_indexes SET value_revision=value_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.index_id;
  END;
  CREATE TRIGGER IF NOT EXISTS embedding_values_delete AFTER DELETE ON embedding_index_values BEGIN
    UPDATE embedding_index_generations SET value_revision=value_revision+1 WHERE index_id=OLD.index_id AND generation=OLD.generation;
    UPDATE embedding_indexes SET value_revision=value_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=OLD.index_id;
  END;
`;

const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
export function embeddingReadTable(table: string): string {
  return EMBEDDING_FAMILIES.some(family => family.table === table) ? `embedding_read_${table}` : table;
}

function legacyIndex(db: Database.Database, provider: string, model: string, dim: number): string {
  const profile = { provider, model, endpoint: 'legacy:unknown', modelRevision: null, recipeVersion: 0 };
  const fingerprint = createHash('sha256').update(JSON.stringify({ ...profile, dim })).digest('hex');
  const id = `legacy-${fingerprint}`;
  db.prepare(`INSERT OR IGNORE INTO embedding_indexes(id,fingerprint,profile_json,legacy,dimensions,updated_at) VALUES(?,?,?,?,?,?)`)
    .run(id, fingerprint, JSON.stringify(profile), 1, dim || null, new Date().toISOString());
  return id;
}

/** Called inside the protected schema migration, never from a reader or a listing request. */
export function migrateEmbeddingIndexes(db: Database.Database): void {
  db.exec(EMBEDDING_INDEX_SQL);
  const settings = db.prepare("SELECT value FROM settings WHERE key='app'").get() as { value: string } | undefined;
  let selection: { embeddingProvider?: string; embeddingModel?: string } = {};
  try { selection = settings ? JSON.parse(settings.value) : {}; } catch { /* preserved in recovery snapshot */ }
  const inserted = db.prepare(`INSERT OR IGNORE INTO embedding_index_values
    (index_id,generation,family,entity_id,text_hash,contract_json,embedding,created_at) VALUES(?,1,?,?,?,?,?,?)`);
  for (const family of EMBEDDING_FAMILIES) {
    const columns = db.pragma(`table_info(${q(family.table)})`) as Array<{ name: string }>;
    const names = new Set(columns.map(column => column.name));
    if (!names.has('embedding')) continue;
    const testimony = family.table === 'testimony_segment_embeddings';
    const metadata = [family.id, 'embedding', 'embedding_provider', 'embedding_model', 'embedding_dim', 'embedding_text_hash', 'text_hash', ...(testimony ? ['model', 'dim'] : [])].filter(column => names.has(column));
    const source = db.prepare(`SELECT rowid AS migration_cursor,${metadata.map(q).join(',')} FROM ${q(family.table)} WHERE rowid>? AND embedding IS NOT NULL AND length(embedding)>0 ORDER BY rowid LIMIT 128`);
    let records = 0, bytes = 0;
    const inventories = new Map<string, { records: number; bytes: number }>();
    let cursor = -1;
    for (;;) {
      const rows = source.all(cursor) as Array<Record<string, unknown>>;
      if (!rows.length) break;
      for (const row of rows) {
        cursor = Number(row.migration_cursor);
        const blob = row.embedding as Buffer;
        const combined = testimony ? String(row.model) : '';
        const provider = String(row.embedding_provider ?? (testimony ? combined.split('/')[0] : 'unknown'));
        const model = String(row.embedding_model ?? (testimony ? combined.slice(combined.indexOf('/') + 1) : 'unknown'));
        const dim = Number(row.embedding_dim ?? (testimony ? row.dim : blob.byteLength / 4));
        const id = legacyIndex(db, provider, model, dim);
        const contract = { provider, model, dim, protocol: 'legacy_locked', task: 'unknown', preprocessing: 'unknown', normalization: 'unknown', quantization: 'float32', configVersion: 'legacy-local' };
        inserted.run(id, family.table, String(row[family.id]), String(row.embedding_text_hash ?? row.text_hash ?? ''), JSON.stringify(contract), blob, new Date().toISOString());
        const inventory = inventories.get(id) ?? { records: 0, bytes: 0 };
        inventory.records++; inventory.bytes += blob.byteLength; inventories.set(id, inventory);
        records++; bytes += blob.byteLength;
      }
    }
    let copiedRecords = 0, copiedBytes = 0;
    for (const [id, expected] of inventories) {
      const actual = db.prepare('SELECT COUNT(*) n,COALESCE(SUM(length(embedding)),0) bytes FROM embedding_index_values WHERE index_id=? AND family=?').get(id, family.table) as { n: number; bytes: number };
      if (actual.n !== expected.records || actual.bytes !== expected.bytes) throw new Error(`embedding_migration_inventory_mismatch:${family.table}`);
      copiedRecords += actual.n; copiedBytes += actual.bytes;
    }
    if (records !== copiedRecords || bytes !== copiedBytes) throw new Error('embedding_migration_inventory_mismatch');
    // Testimony's carrier schema requires a non-null blob. Its empty carrier contains no vector.
    db.exec(`UPDATE ${q(family.table)} SET embedding=${testimony ? "X''" : 'NULL'} WHERE embedding IS NOT NULL`);
    installEmbeddingFamily(db, family, columns.map(column => column.name));
  }
  // Unknown historical semantics are retained, never relabelled as a modern contract.
  // A recoverable legacy set remains listed, but is not silently activated.
  if (selection.embeddingModel) db.prepare('UPDATE embedding_index_state SET enabled=1 WHERE singleton=1').run();
  for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    const ref = operation === 'DELETE' ? 'OLD' : 'NEW';
    db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_theme_links_${operation} AFTER ${operation === 'UPDATE' ? 'UPDATE OF global_id,theme_id' : operation} ON idea_theme_links
      ${operation === 'UPDATE' ? 'WHEN OLD.global_id IS NOT NEW.global_id OR OLD.theme_id IS NOT NEW.theme_id' : ''} BEGIN
      DELETE FROM embedding_index_values WHERE family='ideas' AND entity_id ${operation === 'UPDATE' ? 'IN (OLD.global_id,NEW.global_id)' : `= ${ref}.global_id`}
        ${operation === 'DELETE' ? `AND NOT EXISTS(SELECT 1 FROM idea_theme_links WHERE global_id=OLD.global_id AND theme_id=OLD.theme_id)`
          : operation === 'INSERT' ? `AND (SELECT COUNT(*) FROM idea_theme_links WHERE global_id=NEW.global_id AND theme_id=NEW.theme_id)=1` : ''};
      UPDATE embedding_index_state SET corpus_revision=corpus_revision+1;
    END;`);
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_theme_labels AFTER UPDATE OF label ON themes WHEN OLD.label IS NOT NEW.label BEGIN
    DELETE FROM embedding_index_values WHERE family='ideas' AND entity_id IN (SELECT global_id FROM idea_theme_links WHERE theme_id=NEW.theme_id);
    UPDATE embedding_index_state SET corpus_revision=corpus_revision+1;
  END;`);
  for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    const ref = operation === 'DELETE' ? 'OLD' : 'NEW';
    db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_testimony_segment_${operation} AFTER ${operation} ON testimony_transcript_segments BEGIN
      DELETE FROM embedding_index_values WHERE family='testimony_segment_embeddings' AND entity_id=${ref}.id;
      UPDATE embedding_index_state SET corpus_revision=corpus_revision+1;
    END;`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_testimony_agreement_${operation} AFTER ${operation} ON testimony_agreements BEGIN
      DELETE FROM embedding_index_values WHERE family='testimony_segment_embeddings' AND entity_id IN
        (SELECT segment_id FROM testimony_segment_embeddings WHERE interview_id=${ref}.interview_id);
      UPDATE embedding_index_state SET corpus_revision=corpus_revision+1;
    END;`);
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_work_title AFTER UPDATE OF title,archived ON works
    WHEN OLD.title IS NOT NEW.title OR OLD.archived IS NOT NEW.archived BEGIN
      DELETE FROM embedding_index_values WHERE
        (family='work_summaries' AND entity_id=NEW.nodus_id) OR
        (family='passages' AND entity_id IN (SELECT passage_id FROM passages WHERE nodus_id=NEW.nodus_id)) OR
        (family='document_vectors' AND entity_id IN (SELECT vector_id FROM document_vectors WHERE nodus_id=NEW.nodus_id));
      UPDATE embedding_index_state SET corpus_revision=corpus_revision+1;
    END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_primary_policy AFTER UPDATE ON primary_source_policies BEGIN
    DELETE FROM embedding_index_values WHERE family='archive_items';
    UPDATE embedding_index_state SET corpus_revision=corpus_revision+1;
  END;`);
  for (const operation of ['UPDATE', 'DELETE']) {
    const ref = operation === 'DELETE' ? 'OLD' : 'NEW';
    db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_archive_policy_${operation} AFTER ${operation} ON archive_item_profiles BEGIN
      DELETE FROM embedding_index_values WHERE family='archive_items' AND entity_id=${ref}.item_id;
      UPDATE embedding_index_state SET corpus_revision=corpus_revision+1;
    END;`);
  }
  const studySources = [
    ['study_docs', 'document', 'id'], ['study_materials', 'material', 'id'], ['study_transcripts', 'transcript', 'id'],
    ['study_transcript_segments', 'transcript', 'transcript_id'], ['study_questions', 'question', 'id'], ['study_assessments', 'exam', 'id'],
  ];
  for (const [table, kind, field] of studySources) for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    const ref = operation === 'DELETE' ? 'OLD' : 'NEW';
    // Restrict UPDATE to content/availability columns; vector write-through and a read receipt
    // must not delete the fragments that were just embedded.
    const names = new Set((db.pragma(`table_info(${q(table)})`) as Array<{ name: string }>).map(column => column.name));
    const content = ['title', 'content_markdown', 'description', 'extracted_text', 'visual_description', 'text', 'prompt', 'answer_json', 'options_json', 'explanation', 'source_excerpt', 'deleted_at', 'archived_at', 'status'].filter(column => names.has(column));
    const update = operation === 'UPDATE' ? `UPDATE OF ${content.map(q).join(',')}` : operation;
    const changed = operation === 'UPDATE' ? `WHEN ${content.map(column => `OLD.${q(column)} IS NOT NEW.${q(column)}`).join(' OR ')}` : '';
    const prefix = `'${kind}:'||${ref}.${q(field)}`;
    db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_study_source_${table}_${operation} AFTER ${update} ON ${q(table)} ${changed} BEGIN
      DELETE FROM embedding_index_values WHERE family='study_search' AND
        (entity_id=${prefix} OR substr(entity_id,1,length(${prefix})+1)=${prefix}||':');
      UPDATE embedding_index_state SET corpus_revision=corpus_revision+1;
    END;`);
  }
  for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    const ref = operation === 'DELETE' ? 'OLD' : 'NEW';
    db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_exam_members_${operation} AFTER ${operation} ON study_assessment_items BEGIN
      DELETE FROM embedding_index_values WHERE family='study_search' AND entity_id='exam:'||${ref}.assessment_id;
      UPDATE embedding_index_state SET corpus_revision=corpus_revision+1;
    END;`);
  }
  for (const operation of ['UPDATE OF prompt', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_exam_question_${operation === 'DELETE' ? 'delete' : 'update'}
    BEFORE ${operation} ON study_questions BEGIN
      DELETE FROM embedding_index_values WHERE family='study_search' AND entity_id IN
        (SELECT 'exam:'||assessment_id FROM study_assessment_items WHERE question_id=OLD.id);
    END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_recording_source BEFORE UPDATE OF title,archived_at,deleted_at ON study_recordings BEGIN
    DELETE FROM embedding_index_values WHERE family='study_search' AND EXISTS
      (SELECT 1 FROM study_transcripts t WHERE t.recording_id=OLD.id AND substr(entity_id,1,length(t.id)+12)='transcript:'||t.id||':');
    UPDATE embedding_index_state SET corpus_revision=corpus_revision+1;
  END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_settings_policy AFTER UPDATE OF value ON settings WHEN NEW.key='app' AND json_valid(OLD.value) AND json_valid(NEW.value) AND
      (json_extract(OLD.value,'$.testimonyAllowExternalProviders') IS NOT json_extract(NEW.value,'$.testimonyAllowExternalProviders')
      OR json_extract(OLD.value,'$.promptLanguage') IS NOT json_extract(NEW.value,'$.promptLanguage')) BEGIN
    DELETE FROM embedding_index_values WHERE family='testimony_segment_embeddings' AND json_extract(NEW.value,'$.testimonyAllowExternalProviders') IS NOT 1
      AND index_id IN (SELECT id FROM embedding_indexes WHERE json_extract(profile_json,'$.provider') NOT IN ('nodus','ollama','lmstudio'));
    UPDATE embedding_index_state SET corpus_revision=corpus_revision+1;
  END;`);
}

function installEmbeddingFamily(db: Database.Database, family: typeof EMBEDDING_FAMILIES[number], columns: string[]): void {
  const testimony = family.table === 'testimony_segment_embeddings';
  const replaced = new Set(testimony ? ['embedding', 'model', 'dim'] : ['embedding', 'embedding_provider', 'embedding_model', 'embedding_dim', 'embedding_text_hash']);
  if (family.table === 'study_materials') for (const column of ['index_status', 'indexed_at', 'index_error']) replaced.add(column);
  const projected = columns.filter(column => !replaced.has(column)).map(column => `s.${q(column)}`);
  projected.push('v.embedding AS embedding');
  if (testimony) projected.push("json_extract(i.profile_json,'$.provider')||'/'||json_extract(i.profile_json,'$.model') AS model", 'length(v.embedding)/4 AS dim');
  else {
    for (const [column, value] of [
      ['embedding_provider', "CASE WHEN v.embedding IS NOT NULL THEN json_extract(i.profile_json,'$.provider') END"], ['embedding_model', "CASE WHEN v.embedding IS NOT NULL THEN json_extract(i.profile_json,'$.model') END"],
      ['embedding_dim', 'length(v.embedding)/4'], ['embedding_text_hash', 'v.text_hash'],
    ]) if (columns.includes(column)) projected.push(`${value} AS ${column}`);
  }
  if (family.table === 'study_materials') projected.push("CASE WHEN v.embedding IS NOT NULL THEN 'indexed' WHEN s.index_status='indexed' THEN 'pending' ELSE s.index_status END AS index_status", 'v.created_at AS indexed_at', 'CASE WHEN v.embedding IS NULL THEN s.index_error END AS index_error');
  db.exec(`CREATE VIEW IF NOT EXISTS embedding_read_${family.table} AS SELECT s.rowid AS rowid,${projected.join(',')}
    FROM ${q(family.table)} s
    LEFT JOIN embedding_indexes i ON i.id=nodus_embedding_index()
    LEFT JOIN embedding_index_values v ON v.index_id=i.id AND v.generation=nodus_embedding_generation()
      AND v.family='${family.table}' AND v.entity_id=s.${q(family.id)} AND v.recipe_version=${EMBEDDING_TEXT_RECIPE_VERSIONS[family.table]};`);
  const provider = testimony ? "substr(NEW.model,1,instr(NEW.model,'/')-1)" : columns.includes('embedding_provider') ? 'NEW.embedding_provider' : "'unknown'";
  const model = testimony ? "substr(NEW.model,instr(NEW.model,'/')+1)" : columns.includes('embedding_model') ? 'NEW.embedding_model' : "'unknown'";
  const textHash = columns.includes('embedding_text_hash') ? "COALESCE(NEW.embedding_text_hash,'')" : columns.includes('text_hash') ? 'NEW.text_hash' : "''";
  // Trigger writes are the narrow compatibility boundary for existing producers. They never
  // choose the largest group and cannot write to an inactive/staging index.
  for (const operation of ['INSERT', 'UPDATE OF embedding'] as const) db.exec(`
    CREATE TRIGGER IF NOT EXISTS embedding_capture_${family.table}_${operation === 'INSERT' ? 'insert' : 'update'}
    AFTER ${operation} ON ${q(family.table)} WHEN NEW.embedding IS NOT NULL AND length(NEW.embedding)>0 BEGIN
      SELECT CASE WHEN nodus_embedding_vector_valid(NEW.embedding)=0 THEN RAISE(ABORT,'embedding_vector_invalid') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM embedding_indexes i JOIN embedding_index_state h ON h.active_id=i.id
        WHERE h.enabled=1 AND i.legacy=0 AND json_extract(i.profile_json,'$.provider')=${provider}
        AND json_extract(i.profile_json,'$.model')=${model} AND i.id=nodus_embedding_index()
        AND i.generation=nodus_embedding_generation()) THEN RAISE(ABORT,'embedding_index_configuration_changed') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM embedding_indexes i JOIN embedding_index_state h ON h.active_id=i.id
        WHERE i.dimensions IS NOT NULL AND i.dimensions*4<>length(NEW.embedding)) THEN RAISE(ABORT,'embedding_contract_dimension_mismatch') END;
      UPDATE embedding_indexes SET dimensions=length(NEW.embedding)/4 WHERE id=(SELECT active_id FROM embedding_index_state) AND dimensions IS NULL;
      INSERT OR REPLACE INTO embedding_index_values(index_id,generation,family,entity_id,text_hash,contract_json,embedding,created_at,recipe_version)
        SELECT i.id,i.generation,'${family.table}',NEW.${q(family.id)},${textHash},
          nodus_embedding_contract(i.profile_json,length(NEW.embedding)/4),NEW.embedding,strftime('%Y-%m-%dT%H:%M:%fZ','now'),${EMBEDDING_TEXT_RECIPE_VERSIONS[family.table]}
        FROM embedding_indexes i JOIN embedding_index_state h ON h.active_id=i.id;
      UPDATE ${q(family.table)} SET embedding=${testimony ? "X''" : 'NULL'} WHERE ${q(family.id)}=NEW.${q(family.id)};
    END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_delete_${family.table} AFTER DELETE ON ${q(family.table)} BEGIN
    DELETE FROM embedding_index_values WHERE family='${family.table}' AND entity_id=OLD.${q(family.id)};
    UPDATE embedding_index_state SET corpus_revision=corpus_revision+1; END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_source_insert_${family.table} AFTER INSERT ON ${q(family.table)} BEGIN
    UPDATE embedding_index_state SET corpus_revision=corpus_revision+1; END;`);
  const content = family.content.filter(column => columns.includes(column));
  if (content.length) db.exec(`CREATE TRIGGER IF NOT EXISTS embedding_invalidate_${family.table}
    BEFORE UPDATE OF ${content.map(q).join(',')} ON ${q(family.table)}
    WHEN ${content.map(column => `OLD.${q(column)} IS NOT NEW.${q(column)}`).join(' OR ')} BEGIN
      DELETE FROM embedding_index_values WHERE family='${family.table}' AND entity_id=OLD.${q(family.id)};
      UPDATE embedding_index_state SET corpus_revision=corpus_revision+1; END;`);
}
