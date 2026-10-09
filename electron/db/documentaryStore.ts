import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { DocumentaryIndexIdentity, ResearchCorpusDocument } from '@shared/researchCorpus';
import { documentaryIndexKey } from '../ai/researchCorpusScope';
import { decodeDocumentaryVector, encodeDocumentaryVector } from './documentaryVectors';

export interface DocumentaryChunk {
  text: string;
  pageLabel: string | null;
  pageNumber: number | null;
  sourceRef: string | null;
  pageEnd?: number;
  /** Where each page begins in a page-crossing chunk's text. */
  pageStarts?: Array<{ page: number; offset: number }>;
}
export interface DocumentaryJob {
  id: string;
  document_id: string;
  identity_json: string;
  payload_json: string;
  stage: 'extract' | 'chunk' | 'lexical' | 'embed';
  state: 'queued' | 'running' | 'paused' | 'cancelled' | 'failed' | 'complete';
  attempts: number;
  lease_token: string | null;
  lease_until: number | null;
}

export type DocumentaryPreference = 'enabled' | 'paused' | 'managed-zotero-disabled' | 'legacy-vectors-converted';

/** A profile-owned durable store, independent from rebuildable library catalogs
 * and vault analyses. Callers choose its path; construction never discovers one. */
export class DocumentaryStore {
  readonly db: Database.Database;
  constructor(filename: string, readonly = false) {
    this.db = new Database(filename, { readonly, fileMustExist: readonly });
    if (readonly) {
      this.db.pragma('busy_timeout = 5000');
      // A semantic search reads every vector in scope, about 4 KB each: mapped, the pages are read
      // in place instead of copied through a 2 MB page cache on every search.
      this.db.pragma('mmap_size = 1073741824');
      this.db.pragma('cache_size = -32768');
      return;
    }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documentary_revisions (
        index_key TEXT PRIMARY KEY, document_id TEXT NOT NULL, identity_json TEXT NOT NULL,
        text TEXT, chunks_json TEXT, lexical_ready INTEGER NOT NULL DEFAULT 0,
        embedding_ready INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS documentary_publications (
        document_id TEXT PRIMARY KEY, document_json TEXT NOT NULL, index_keys_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS documentary_current (document_id TEXT PRIMARY KEY, index_key TEXT NOT NULL REFERENCES documentary_revisions(index_key));
      CREATE TABLE IF NOT EXISTS documentary_desired (document_id TEXT PRIMARY KEY, index_key TEXT NOT NULL REFERENCES documentary_revisions(index_key));
      CREATE TABLE IF NOT EXISTS documentary_attachment_heads (
        document_id TEXT NOT NULL, attachment_id TEXT NOT NULL,
        desired_key TEXT NOT NULL REFERENCES documentary_revisions(index_key),
        current_key TEXT REFERENCES documentary_revisions(index_key),
        PRIMARY KEY(document_id,attachment_id)
      );
      CREATE TABLE IF NOT EXISTS documentary_passages (
        id TEXT PRIMARY KEY, index_key TEXT NOT NULL REFERENCES documentary_revisions(index_key),
        document_id TEXT NOT NULL, ordinal INTEGER NOT NULL, text TEXT NOT NULL, locator_json TEXT NOT NULL, vector_json TEXT
      );
      CREATE INDEX IF NOT EXISTS documentary_passages_revision ON documentary_passages(index_key, ordinal);
      -- Covers the per-source revision lookup. Its flags and date are stored after the text and
      -- chunk JSON, so reading them from the table walked hundreds of megabytes of overflow pages.
      CREATE INDEX IF NOT EXISTS documentary_revisions_document ON documentary_revisions(document_id, index_key, identity_json, lexical_ready, embedding_ready, created_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS documentary_fts USING fts5(id UNINDEXED,text,tokenize='unicode61 remove_diacritics 2');
      CREATE TABLE IF NOT EXISTS documentary_jobs (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL, identity_json TEXT NOT NULL, payload_json TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'extract', state TEXT NOT NULL DEFAULT 'queued', priority INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
        available_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT
      );
      CREATE INDEX IF NOT EXISTS documentary_jobs_claim ON documentary_jobs(state, available_at, priority);
      CREATE TABLE IF NOT EXISTS documentary_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documentary_source_owners (
        vault_id TEXT NOT NULL, document_id TEXT NOT NULL, PRIMARY KEY(vault_id,document_id)
      );
      CREATE TABLE IF NOT EXISTS documentary_mcp_choices (
        vault_id TEXT NOT NULL, notebook_id TEXT NOT NULL, endpoint TEXT NOT NULL,
        PRIMARY KEY(vault_id,notebook_id)
      );
    `);
    // Vectors are Float32 blobs; `vector_json` only survives on rows written before, until
    // convertLegacyVectors() rewrites them.
    const passageColumns = new Set((this.db.prepare('PRAGMA table_info(documentary_passages)').all() as { name: string }[]).map(column => column.name));
    if (!passageColumns.has('vector')) this.db.exec('ALTER TABLE documentary_passages ADD COLUMN vector BLOB');
    // A write counter per revision, for the retrieval worker's vector cache
    // (documentaryVectorCache.ts): any insert, update or delete of a revision's passages moves it.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documentary_vector_generations (index_key TEXT PRIMARY KEY, generation INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS documentary_vector_generation_insert AFTER INSERT ON documentary_passages BEGIN
        INSERT INTO documentary_vector_generations VALUES (NEW.index_key,1) ON CONFLICT(index_key) DO UPDATE SET generation=generation+1;
      END;
      CREATE TRIGGER IF NOT EXISTS documentary_vector_generation_update AFTER UPDATE ON documentary_passages BEGIN
        INSERT INTO documentary_vector_generations VALUES (OLD.index_key,1) ON CONFLICT(index_key) DO UPDATE SET generation=generation+1;
        INSERT INTO documentary_vector_generations VALUES (NEW.index_key,1) ON CONFLICT(index_key) DO UPDATE SET generation=generation+1;
      END;
      CREATE TRIGGER IF NOT EXISTS documentary_vector_generation_delete AFTER DELETE ON documentary_passages BEGIN
        INSERT INTO documentary_vector_generations VALUES (OLD.index_key,1) ON CONFLICT(index_key) DO UPDATE SET generation=generation+1;
      END;
    `);
  }
  /** Rewrite the next `limit` legacy JSON vectors after `afterRowid` as blobs and return
   * the cursor to continue from, or null once none remain. A cursor, not a count: counting
   * the remaining rows read the whole table (3 s on a real 54 k-passage store) per batch. */
  convertLegacyVectors(afterRowid = 0, limit = 100): number | null {
    return this.db.transaction(() => {
      const rows = this.db.prepare('SELECT rowid,vector_json FROM documentary_passages WHERE rowid>? AND vector_json IS NOT NULL ORDER BY rowid LIMIT ?')
        .all(afterRowid, limit) as { rowid: number; vector_json: string }[];
      const update = this.db.prepare('UPDATE documentary_passages SET vector=?,vector_json=NULL WHERE rowid=?');
      for (const row of rows) update.run(encodeDocumentaryVector(JSON.parse(row.vector_json) as number[]), row.rowid);
      if (rows.length < limit) { this.setPreference('legacy-vectors-converted', true); return null; }
      return rows[rows.length - 1].rowid;
    }).immediate();
  }
  /** Remove every published and working derivative, fencing in-flight leases. */
  removeDocument(documentId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM documentary_fts WHERE id IN (SELECT id FROM documentary_passages WHERE document_id=?)').run(documentId);
      for (const table of ['documentary_passages', 'documentary_publications', 'documentary_current', 'documentary_desired', 'documentary_attachment_heads', 'documentary_jobs', 'documentary_revisions']) {
        this.db.prepare(`DELETE FROM ${table} WHERE document_id=?`).run(documentId);
      }
      if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='documentary_requests'").get()) {
        const prefix = `embedding:${documentId}:`;
        const jobs = this.db.prepare('SELECT document_id FROM documentary_requests WHERE source_id=? OR document_id=? OR substr(document_id,1,?)=?').all(documentId, documentId, prefix.length, prefix) as { document_id: string }[];
        for (const job of jobs) {
          for (const table of ['documentary_embedding_chunks', 'documentary_embedding_attempts']) if (this.db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table)) this.db.prepare(`DELETE FROM ${table} WHERE operation=?`).run(job.document_id);
          this.db.prepare('DELETE FROM documentary_requests WHERE document_id=?').run(job.document_id);
        }
      }
    }).immediate();
  }
  close(): void { this.db.close(); }
  setPreference(key: DocumentaryPreference, value: boolean): void {
    this.db.prepare('INSERT INTO documentary_preferences VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
  }
  preference(key: DocumentaryPreference): boolean {
    return (this.db.prepare('SELECT value FROM documentary_preferences WHERE key=?').get(key) as { value: string } | undefined)?.value === 'true';
  }
  enqueue(identity: DocumentaryIndexIdentity, payload: unknown, priority = 0, now = Date.now()): string {
    const id = documentaryIndexKey(identity);
    this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO documentary_revisions(index_key,document_id,identity_json,created_at) VALUES (?,?,?,?)')
        .run(id, identity.documentId, JSON.stringify(identity), now);
      this.db.prepare(`INSERT OR IGNORE INTO documentary_jobs(id,document_id,identity_json,payload_json,priority,available_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(id, identity.documentId, JSON.stringify(identity), JSON.stringify(payload), priority, now, now, now);
      this.db.prepare('INSERT INTO documentary_desired VALUES (?,?) ON CONFLICT(document_id) DO UPDATE SET index_key=excluded.index_key').run(identity.documentId, id);
      this.db.prepare(`INSERT INTO documentary_attachment_heads(document_id,attachment_id,desired_key) VALUES (?,?,?)
        ON CONFLICT(document_id,attachment_id) DO UPDATE SET desired_key=excluded.desired_key`).run(identity.documentId, identity.attachmentId ?? '', id);
    }).immediate();
    return id;
  }
  claim(now = Date.now(), leaseMs = 60000, jobId: string | null = null): DocumentaryJob | null {
    if (this.preference('paused')) return null;
    return this.db.transaction(() => {
      this.db.prepare(`UPDATE documentary_jobs SET state='queued',attempts=MAX(0,attempts-1),
        lease_token=NULL,lease_until=NULL,updated_at=? WHERE state='running' AND lease_until<=?`).run(now, now);
      const job = this.db.prepare(`SELECT * FROM documentary_jobs WHERE state='queued' AND available_at<=? AND attempts<3 AND (? IS NULL OR id=?)
        ORDER BY priority + ((? - created_at) / 60000) DESC, created_at, id LIMIT 1`).get(now, jobId, jobId, now) as DocumentaryJob | undefined;
      if (!job) return null;
      const token = randomUUID();
      this.db.prepare(`UPDATE documentary_jobs SET state='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?`)
        .run(token, now + leaseMs, now, job.id);
      return { ...job, state: 'running' as const, attempts: job.attempts + 1, lease_token: token, lease_until: now + leaseMs };
    }).immediate();
  }
  renew(job: DocumentaryJob, now = Date.now(), leaseMs = 60000): boolean {
    return this.db.prepare(`UPDATE documentary_jobs SET lease_until=?,updated_at=? WHERE id=? AND lease_token=? AND state='running' AND lease_until>?`)
      .run(now + leaseMs, now, job.id, job.lease_token, now).changes === 1;
  }
  private assertLease(job: DocumentaryJob, now: number): void {
    if (!this.db.prepare(`SELECT 1 FROM documentary_jobs WHERE id=? AND lease_token=? AND state='running' AND lease_until>?`)
      .get(job.id, job.lease_token, now)) throw new Error('documentary_lease_lost');
  }
  private stage(job: DocumentaryJob, stage: DocumentaryJob['stage'], now: number): void {
    this.db.prepare('UPDATE documentary_jobs SET stage=?,updated_at=? WHERE id=?').run(stage, now, job.id);
    job.stage = stage;
  }
  saveExtraction(job: DocumentaryJob, text: string, now = Date.now()): void {
    this.db.transaction(() => {
      this.assertLease(job, now);
      this.db.prepare('UPDATE documentary_revisions SET text=? WHERE index_key=?').run(text, job.id);
      this.stage(job, 'chunk', now);
    }).immediate();
  }
  saveChunks(job: DocumentaryJob, chunks: DocumentaryChunk[], now = Date.now()): void {
    this.db.transaction(() => {
      this.assertLease(job, now);
      this.db.prepare('UPDATE documentary_revisions SET chunks_json=? WHERE index_key=?').run(JSON.stringify(chunks), job.id);
      this.stage(job, 'lexical', now);
    }).immediate();
  }
  publishLexical(job: DocumentaryJob, now = Date.now()): void {
    this.db.transaction(() => {
      this.assertLease(job, now);
      const row = this.db.prepare('SELECT chunks_json FROM documentary_revisions WHERE index_key=?').get(job.id) as { chunks_json: string | null };
      if (!row.chunks_json) throw new Error('documentary_chunks_missing');
      const chunks: DocumentaryChunk[] = JSON.parse(row.chunks_json);
      if (!chunks.length) throw new Error('documentary_text_empty');
      this.db.prepare('DELETE FROM documentary_fts WHERE id IN (SELECT id FROM documentary_passages WHERE index_key=?)').run(job.id);
      this.db.prepare('DELETE FROM documentary_passages WHERE index_key=?').run(job.id);
      const insert = this.db.prepare('INSERT INTO documentary_passages(id,index_key,document_id,ordinal,text,locator_json) VALUES (?,?,?,?,?,?)');
      const fts = this.db.prepare('INSERT INTO documentary_fts(id,text) VALUES (?,?)');
      chunks.forEach(({ text, ...locator }, ordinal) => {
        const id = `${job.id}:${ordinal}`;
        insert.run(id, job.id, job.document_id, ordinal, text, JSON.stringify(locator));
        fts.run(id, text);
      });
      this.db.prepare('UPDATE documentary_revisions SET lexical_ready=1 WHERE index_key=?').run(job.id);
      const identity: DocumentaryIndexIdentity = JSON.parse(job.identity_json);
      this.db.prepare(`UPDATE documentary_attachment_heads SET current_key=?
        WHERE document_id=? AND attachment_id=? AND desired_key=?`).run(job.id, job.document_id, identity.attachmentId ?? '', job.id);
      // A slower obsolete build may finish after a newer revision was requested.
      // Keep its immutable evidence, but never replace the requested revision.
      if (this.db.prepare('SELECT 1 FROM documentary_desired WHERE document_id=? AND index_key=?').get(job.document_id, job.id)) {
        this.db.prepare(`INSERT INTO documentary_current VALUES (?,?) ON CONFLICT(document_id) DO UPDATE SET index_key=excluded.index_key`).run(job.document_id, job.id);
      }
      this.stage(job, 'embed', now);
    }).immediate();
  }
  publishEmbeddings(job: DocumentaryJob, vectors: number[][], now = Date.now()): void {
    const identity: DocumentaryIndexIdentity = JSON.parse(job.identity_json);
    const dim = identity.embedding?.dimensions;
    if (!dim || vectors.some(vector => vector.length !== dim || vector.some(value => !Number.isFinite(value)))) throw new Error('documentary_embedding_space_mismatch');
    this.db.transaction(() => {
      this.assertLease(job, now);
      const rows = this.db.prepare('SELECT id FROM documentary_passages WHERE index_key=? ORDER BY ordinal').all(job.id) as { id: string }[];
      if (rows.length !== vectors.length || !rows.length) throw new Error('documentary_embedding_count_mismatch');
      const update = this.db.prepare('UPDATE documentary_passages SET vector=?,vector_json=NULL WHERE id=?');
      rows.forEach((row, index) => update.run(encodeDocumentaryVector(vectors[index]), row.id));
      this.db.prepare('UPDATE documentary_revisions SET embedding_ready=1 WHERE index_key=?').run(job.id);
      this.complete(job, now);
    }).immediate();
  }
  complete(job: DocumentaryJob, now = Date.now()): void {
    this.assertLease(job, now);
    this.db.prepare("UPDATE documentary_jobs SET state='complete',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now, job.id);
  }
  fail(job: DocumentaryJob, errorCode: string, now = Date.now()): void {
    this.db.transaction(() => {
      this.assertLease(job, now);
      this.db.prepare(`UPDATE documentary_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
        error=?,available_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?`)
        .run(errorCode.slice(0, 120), now + 1000 * 2 ** job.attempts, now, job.id);
    }).immediate();
  }
  interrupt(job: DocumentaryJob, now = Date.now()): void {
    this.db.transaction(() => {
      this.assertLease(job, now);
      this.db.prepare(`UPDATE documentary_jobs SET state='queued',attempts=MAX(0,attempts-1),
        available_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?`).run(now, now, job.id);
    }).immediate();
  }
  cancel(id: string): void { this.db.prepare("UPDATE documentary_jobs SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE id=? AND state<>'complete'").run(id); }
  retry(id: string): void { this.db.prepare("UPDATE documentary_jobs SET state='queued',attempts=0,error=NULL,available_at=? WHERE id=? AND state IN ('failed','cancelled')").run(Date.now(), id); }
  getJob(id: string): DocumentaryJob | null { return this.db.prepare('SELECT * FROM documentary_jobs WHERE id=?').get(id) as DocumentaryJob ?? null; }
  /** A job's index identity alone: its payload can hold a whole extracted text. */
  jobIdentity(id: string): DocumentaryIndexIdentity | null {
    const row = this.db.prepare('SELECT identity_json FROM documentary_jobs WHERE id=?').get(id) as { identity_json: string } | undefined;
    return row ? JSON.parse(row.identity_json) as DocumentaryIndexIdentity : null;
  }
  /** `jobIdentity` for many jobs, in one statement. Absent ids are absent from the map. */
  jobIdentities(ids: string[]): Map<string, DocumentaryIndexIdentity> {
    const rows = this.db.prepare('SELECT id,identity_json FROM documentary_jobs WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify([...new Set(ids)])) as Array<{ id: string; identity_json: string }>;
    return new Map(rows.map(row => [row.id, JSON.parse(row.identity_json) as DocumentaryIndexIdentity]));
  }
  /** The revisions of many documents without their text, each document's in the order
   *  `embedding_ready DESC, created_at DESC`, with the revision each was built from. */
  revisionsOf(documentIds: string[]): Map<string, Array<{ index_key: string; identity_json: string; embedding_ready: number; lexical_ready: number; revision: string | null }>> {
    const rows = this.db.prepare(`SELECT document_id,index_key,identity_json,embedding_ready,lexical_ready,json_extract(identity_json,'$.revision') revision
      FROM documentary_revisions WHERE document_id IN (SELECT value FROM json_each(?)) ORDER BY document_id,embedding_ready DESC,created_at DESC`)
      .all(JSON.stringify([...new Set(documentIds)])) as Array<{ document_id: string; index_key: string; identity_json: string; embedding_ready: number; lexical_ready: number; revision: string | null }>;
    const byDocument = new Map<string, Array<Omit<typeof rows[number], 'document_id'>>>();
    for (const { document_id: documentId, ...row } of rows) {
      const list = byDocument.get(documentId);
      if (list) list.push(row); else byDocument.set(documentId, [row]);
    }
    return byDocument;
  }
  /** Chunks per revision: passages counted on their index for a published revision, the chunk
   *  JSON's length for one still being built. One statement for each kind. */
  chunkCounts(rows: Array<{ index_key: string; lexical_ready: number }>): Map<string, number> {
    const published = rows.filter(row => row.lexical_ready).map(row => row.index_key);
    const building = rows.filter(row => !row.lexical_ready).map(row => row.index_key);
    const counts = new Map<string, number>();
    if (published.length) for (const row of this.db.prepare('SELECT index_key,COUNT(*) n FROM documentary_passages WHERE index_key IN (SELECT value FROM json_each(?)) GROUP BY index_key').all(JSON.stringify(published)) as Array<{ index_key: string; n: number }>) counts.set(row.index_key, row.n);
    if (building.length) for (const row of this.db.prepare('SELECT index_key,json_array_length(chunks_json) n FROM documentary_revisions WHERE index_key IN (SELECT value FROM json_each(?))').all(JSON.stringify(building)) as Array<{ index_key: string; n: number | null }>) counts.set(row.index_key, row.n ?? 0);
    return counts;
  }
  revision(id: string): { text: string | null; chunks_json: string | null; lexical_ready: number; embedding_ready: number } | null {
    return this.db.prepare('SELECT text,chunks_json,lexical_ready,embedding_ready FROM documentary_revisions WHERE index_key=?').get(id) as ReturnType<DocumentaryStore['revision']> ?? null;
  }
  /** Switch the whole document only after all selected attachment chunks exist. */
  publishDocument(document: ResearchCorpusDocument, indexKeys: string[]): void {
    this.db.transaction(() => {
      if (!indexKeys.length || new Set(indexKeys).size !== indexKeys.length) throw new Error('documentary_publication_incomplete');
      for (const key of indexKeys) {
        const row = this.db.prepare('SELECT identity_json,lexical_ready FROM documentary_revisions WHERE index_key=?').get(key) as { identity_json: string; lexical_ready: number } | undefined;
        const identity: DocumentaryIndexIdentity | undefined = row && JSON.parse(row.identity_json);
        if (!row?.lexical_ready || identity?.documentId !== document.id || identity.revision !== document.revision) throw new Error('documentary_publication_incomplete');
      }
      this.db.prepare(`INSERT INTO documentary_publications VALUES (?,?,?) ON CONFLICT(document_id)
        DO UPDATE SET document_json=excluded.document_json,index_keys_json=excluded.index_keys_json`)
        .run(document.id, JSON.stringify(document), JSON.stringify(indexKeys));
    }).immediate();
  }
  publishedDocument(document: ResearchCorpusDocument): ResearchCorpusDocument | null {
    const row = this.db.prepare('SELECT document_json,index_keys_json FROM documentary_publications WHERE document_id=?').get(document.id) as { document_json: string; index_keys_json: string } | undefined;
    return row ? DocumentaryStore.fromPublication(document, row) : null;
  }
  /** `publishedDocument` for many documents, in one statement: an inventory asked once per source. */
  publishedDocuments(documents: ResearchCorpusDocument[]): Map<string, ResearchCorpusDocument> {
    const rows = this.db.prepare('SELECT document_id,document_json,index_keys_json FROM documentary_publications WHERE document_id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(documents.map(document => document.id))) as Array<{ document_id: string; document_json: string; index_keys_json: string }>;
    const byId = new Map(rows.map(row => [row.document_id, row]));
    const published = new Map<string, ResearchCorpusDocument>();
    for (const document of documents) {
      const row = byId.get(document.id);
      const pinned = row && DocumentaryStore.fromPublication(document, row);
      if (pinned) published.set(document.id, pinned);
    }
    return published;
  }
  private static fromPublication(document: ResearchCorpusDocument, row: { document_json: string; index_keys_json: string }): ResearchCorpusDocument | null {
    const published: ResearchCorpusDocument = JSON.parse(row.document_json);
    // An old revision may survive replacement, but never permission revocation
    // or removal of any file contributing to that revision.
    if (published.permissionRevision !== document.permissionRevision || published.attachments?.some(attachment => !document.attachments?.some(current => current.id === attachment.id))) return null;
    return { ...document, indexedSource: { revision: published.revision, attachmentId: published.attachmentId,
      attachments: published.attachments, indexKeys: JSON.parse(row.index_keys_json) } };
  }
  lexicalSearch(query: string, indexKeys: string[], limit: number): Array<{ id: string; document_id: string; index_key: string; text: string; locator_json: string }> {
    if (!indexKeys.length || limit <= 0) return [];
    const terms = [...new Set(query.match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, 32).map(term => `"${term}"`).join(' OR ');
    if (!terms) return [];
    return this.db.prepare(`SELECT p.id,p.document_id,p.index_key,p.text,p.locator_json FROM documentary_fts f JOIN documentary_passages p ON p.id=f.id
      WHERE documentary_fts MATCH ? AND p.index_key IN (SELECT value FROM json_each(?)) ORDER BY bm25(documentary_fts),p.id LIMIT ?`)
      .all(terms, JSON.stringify(indexKeys), limit) as ReturnType<DocumentaryStore['lexicalSearch']>;
  }
  semanticSearch(query: number[], indexKeys: string[], limit: number, threshold = -1): ReturnType<DocumentaryStore['lexicalSearch']> {
    if (!indexKeys.length || !query.length || limit <= 0) return [];
    if (!this.registerSimilarity(query)) return [];
    // Materialized so the similarity is computed once per passage (a flattened subquery
    // computed it again for the ORDER BY) and the sort carries ids, not texts and vectors.
    return this.db.prepare(`WITH scored AS MATERIALIZED (
      SELECT id,documentary_similarity(vector,vector_json) similarity FROM documentary_passages
      WHERE (vector IS NOT NULL OR vector_json IS NOT NULL) AND index_key IN (SELECT value FROM json_each(?)))
      SELECT p.id,p.document_id,p.index_key,p.text,p.locator_json FROM scored JOIN documentary_passages p ON p.id=scored.id
      WHERE scored.similarity>=? ORDER BY scored.similarity DESC,scored.id LIMIT ?`).all(JSON.stringify(indexKeys), threshold, limit) as ReturnType<DocumentaryStore['lexicalSearch']>;
  }
  /** Each scored passage of `indexKeys` at or above `threshold`, unordered: the scores
   *  `semanticSearch` ranks by, for a caller that ranks them with others. */
  semanticScores(query: number[], indexKeys: string[], threshold = -1): Array<{ id: string; similarity: number }> {
    if (!indexKeys.length || !query.length || !this.registerSimilarity(query)) return [];
    return this.db.prepare(`WITH scored AS MATERIALIZED (
      SELECT id,documentary_similarity(vector,vector_json) similarity FROM documentary_passages
      WHERE (vector IS NOT NULL OR vector_json IS NOT NULL) AND index_key IN (SELECT value FROM json_each(?)))
      SELECT id,similarity FROM scored WHERE similarity>=?`).all(JSON.stringify(indexKeys), threshold) as Array<{ id: string; similarity: number }>;
  }
  private registerSimilarity(query: number[]): boolean {
    const norm = Math.sqrt(query.reduce((sum, value) => sum + value * value, 0));
    if (!norm) return false;
    this.db.function('documentary_similarity', (blob: Uint8Array | null, json: string | null) => {
      const vector: ArrayLike<number> = blob ? decodeDocumentaryVector(blob) : JSON.parse(json!) as number[];
      if (vector.length !== query.length) return -2;
      // A blob holds float32s, whose squares cannot overflow a double: any NaN or infinity in it
      // makes the sum of squares non-finite, so one test after the loop rejects exactly the
      // vectors a separate pass over every element did. Legacy JSON doubles keep that pass.
      if (!blob) for (let index = 0; index < vector.length; index++) if (!Number.isFinite(vector[index])) return -2;
      let dot = 0, magnitude = 0;
      for (let index = 0; index < vector.length; index++) { dot += vector[index] * query[index]; magnitude += vector[index] ** 2; }
      if (!Number.isFinite(magnitude)) return -2;
      return magnitude ? dot / (norm * Math.sqrt(magnitude)) : -2;
    });
    return true;
  }
  adjacentPassages(id: string, indexKeys: string[], radius = 1): ReturnType<DocumentaryStore['lexicalSearch']> {
    if (!indexKeys.length || radius < 0 || radius > 3) return [];
    return this.db.prepare(`SELECT p.id,p.document_id,p.index_key,p.text,p.locator_json FROM documentary_passages p
      JOIN documentary_passages origin ON origin.index_key=p.index_key
      WHERE origin.id=? AND p.index_key IN (SELECT value FROM json_each(?)) AND ABS(p.ordinal-origin.ordinal)<=? ORDER BY p.ordinal`)
      .all(id, JSON.stringify(indexKeys), radius) as ReturnType<DocumentaryStore['lexicalSearch']>;
  }
  physicalPages(indexKeys: string[], from: number, to: number, limit: number, attachmentId?: string): ReturnType<DocumentaryStore['lexicalSearch']> {
    if (!indexKeys.length || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from > 3 || limit < 1 || limit > 500) return [];
    return this.db.prepare(`SELECT p.id,p.document_id,p.index_key,p.text,p.locator_json FROM documentary_passages p
      JOIN documentary_revisions r ON r.index_key=p.index_key
      WHERE p.index_key IN (SELECT value FROM json_each(?))
      AND json_extract(p.locator_json,'$.pageNumber') <= ?
      AND COALESCE(json_extract(p.locator_json,'$.pageEnd'),json_extract(p.locator_json,'$.pageNumber')) >= ?
      AND (? IS NULL OR json_extract(r.identity_json,'$.attachmentId')=?)
      ORDER BY p.index_key,p.ordinal LIMIT ?`).all(JSON.stringify(indexKeys), to, from, attachmentId ?? null, attachmentId ?? null, limit) as ReturnType<DocumentaryStore['lexicalSearch']>;
  }
}
