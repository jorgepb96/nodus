import type { PassageDetail, WorkPassageStatus } from '@shared/types';
import { getDb } from './database';
import { assertPassagePublication, type PassagePublication } from './passagePublications';
import { currentEmbeddingConfig, embeddingTextHash, encodeEmbedding } from './ideasRepo';
import { scanSimilar } from './vectorScan';

export interface PassageInsert {
  text: string;
  pageLabel: string | null;
  sourceRef?: string | null;
  pageNumber?: number | null;
  embedding: number[] | null;
}

export interface SimilarPassage {
  passage_id: string;
  nodus_id: string;
  text: string;
  page_label: string | null;
  source_ref: string | null;
  page_number: number | null;
  similarity: number;
  title: string;
  authors_json: string;
  year: number | null;
  zotero_key: string;
}

const PASSAGE_FTS_STOPWORDS = new Set([
  'para', 'como', 'desde', 'hasta', 'entre', 'sobre', 'este', 'esta', 'estos', 'estas',
  'cuál', 'cual', 'cómo', 'como', 'qué', 'que', 'quién', 'quien', 'donde', 'cuando',
  'with', 'from', 'into', 'this', 'that', 'what', 'which', 'where', 'when', 'during',
]);

const PASSAGE_MATCHES_RESOLVED_TEXT = `(
  (w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
  OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash))
)`;

/** Literal passage lane for names, procedures and phrases that dense retrieval can
 * blur. The query is constructed from quoted prefix tokens, never raw FTS syntax. */
export function lexicalPassageSearch(
  query: string,
  limit: number,
  opts: { nodusIds?: string[] } = {},
): SimilarPassage[] {
  if (limit <= 0 || opts.nodusIds?.length === 0) return [];
  const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}+/gu, '').toLocaleLowerCase();
  const tokens = fold(query).match(/[\p{L}\p{N}]+/gu) ?? [];
  // FTS5 has no language stemmer in this index. Prefix roots recover predictable
  // inflection/OCR variants such as distribuyó/distribución and
  // gratuitamente/gratuita without ever accepting raw FTS syntax from the user.
  const rootFor = (token: string) => /^\d+$/u.test(token)
    ? token
    : token.length >= 8 ? token.slice(0, 7) : token;
  const unique = [...new Set(tokens
    .filter((token) => (token.length >= 4 || /^\d+$/u.test(token)) && !PASSAGE_FTS_STOPWORDS.has(token))
    .map(rootFor))]
    .slice(0, 32);
  const ftsQuery = unique.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' OR ');
  if (!ftsQuery) return [];
  const scope = opts.nodusIds ? new Set(opts.nodusIds) : null;
  const wanted = Math.max(limit, limit * 4);
  // Rank on the full-text index alone, then read passages in that order until enough pass.
  // Joining first made SQLite read every match's row — its text, then its embedding blob to
  // reach source_ref — and sort them all before the LIMIT: 14,437 matches of a common word
  // held the main process for 1.1 s. Ties keep the index order, as the sorted join did.
  //
  // The ranking is read a page at a time, and only inside the scope: every match's id used to
  // come back to JavaScript (100,000 of them for a common word) to be filtered by scope here,
  // although nearly every search is satisfied by its first `wanted` rows. bm25 is computed over
  // the whole index whatever the WHERE, so the order is the same; the index's nodus_id is kept
  // equal to the passage's by its triggers.
  const db = getDb();
  const rankedPage = db.prepare(`SELECT passage_id FROM passages_fts WHERE passages_fts MATCH ?${scope ? ' AND nodus_id IN (SELECT value FROM json_each(?))' : ''}
    ORDER BY bm25(passages_fts), rowid LIMIT ? OFFSET ?`).pluck();
  const pageSize = Math.max(wanted * 2, 64);
  const scopeJson = scope ? [JSON.stringify([...scope])] : [];
  const read = db.prepare(
    `SELECT p.passage_id,p.nodus_id,p.text,p.page_label,p.source_ref,p.page_number,
            w.title,w.authors_json,w.year,w.zotero_key
       FROM passages p
       JOIN works w ON w.nodus_id=p.nodus_id
      WHERE p.passage_id IN (SELECT value FROM json_each(?)) AND w.archived=0
        AND ${PASSAGE_MATCHES_RESOLVED_TEXT}`
  );
  const rows: Array<Omit<SimilarPassage, 'similarity'>> = [];
  for (let offset = 0; rows.length < wanted; offset += pageSize) {
    const ranked = rankedPage.all(ftsQuery, ...scopeJson, pageSize, offset) as string[];
    for (let start = 0; start < ranked.length && rows.length < wanted; start += 64) {
      const batch = ranked.slice(start, start + 64);
      const found = new Map((read.all(JSON.stringify(batch)) as Array<Omit<SimilarPassage, 'similarity'>>).map(row => [row.passage_id, row]));
      for (const id of batch) {
        const row = found.get(id);
        if (row && (!scope || scope.has(row.nodus_id))) rows.push(row);
        if (rows.length === wanted) break;
      }
    }
    if (ranked.length < pageSize) break;
  }
  // BM25 alone rewards a very frequent generic term. Re-rank its bounded candidate
  // pool by how many distinct roots from this one atomic question the passage
  // actually covers, with a small proximity and original-rank tie-breaker.
  return rows.map((row, index) => {
    const passageTokens = fold(row.text).match(/[\p{L}\p{N}]+/gu) ?? [];
    const positions = unique.map((root) => passageTokens
      .map((token, at) => token.startsWith(root) ? at : -1)
      .filter((at) => at >= 0));
    const covered = positions.filter((items) => items.length > 0).length;
    let closePairs = 0;
    for (let left = 0; left < positions.length - 1; left += 1) {
      if (!positions[left].length || !positions[left + 1].length) continue;
      if (positions[left].some((a) => positions[left + 1].some((b) => Math.abs(a - b) <= 12))) closePairs += 1;
    }
    const coverage = covered / Math.max(1, unique.length);
    const proximity = closePairs / Math.max(1, unique.length - 1);
    const originalRank = 1 / (index + 1);
    return { row, score: coverage * 0.72 + proximity * 0.18 + originalRank * 0.10 };
  }).sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, score }) => ({ ...row, similarity: Math.min(1, score) }));
}

/** Replace one work atomically so interrupted/reprocessed runs never mix chunks. */
export function replaceWorkPassages(nodusId: string, contentHash: string, rows: PassageInsert[], prepared?: { publication: PassagePublication; embeddingProvider: string; embeddingModel: string }): void {
  const db = getDb();
  const config = currentEmbeddingConfig();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO passages (
       passage_id, nodus_id, chunk_index, text, page_label, source_ref, page_number, char_len, content_hash,
       embedding, embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    if (prepared) {
      assertPassagePublication(nodusId, prepared.publication);
      if (config.provider !== prepared.embeddingProvider || config.model !== prepared.embeddingModel) throw new Error('documentary_embedding_configuration_changed');
    }
    // Passage ids are positional (`<work>#<chunk>`), and the current document profile's
    // supports point at them. A rebuild that re-extracted the source (an evicted
    // extraction cache, a newer extractor) moves the chunk boundaries, so the same id
    // now names different text. Say so instead of leaving the profile current.
    const previous = db.prepare('SELECT chunk_index, text FROM passages WHERE nodus_id = ?').all(nodusId) as Array<{ chunk_index: number; text: string }>;
    const moved = previous.length > 0 && (previous.length !== rows.length
      || previous.some((old) => rows[old.chunk_index]?.text !== old.text));
    if (moved) {
      db.prepare(`UPDATE document_profile_state
           SET status=CASE WHEN status='current' THEN 'stale' ELSE status END,
               stale_reason='passages_changed', updated_at=?
         WHERE nodus_id=? AND current_version_id IS NOT NULL`).run(now, nodusId);
    }
    db.prepare('DELETE FROM passages WHERE nodus_id = ?').run(nodusId);
    rows.forEach((row, chunkIndex) => {
      const embedding = row.embedding;
      insert.run(
        `${nodusId}#${chunkIndex}`,
        nodusId,
        chunkIndex,
        row.text,
        row.pageLabel,
        row.sourceRef ?? null,
        row.pageNumber ?? null,
        row.text.length,
        contentHash,
        embedding ? encodeEmbedding(embedding) : null,
        embedding ? config.provider : null,
        embedding ? config.model : null,
        embedding?.length ?? null,
        embedding ? embeddingTextHash(row.text) : null,
        now
      );
    });
  })();
}

export function findSimilarPassages(
  queryEmbedding: number[],
  threshold: number,
  limit: number,
  opts: { nodusIds?: string[] } = {}
): SimilarPassage[] {
  if (limit <= 0 || opts.nodusIds?.length === 0) return [];
  const config = currentEmbeddingConfig();
  const nodusIds = [...new Set(opts.nodusIds ?? [])];
  const scoped = nodusIds.length
    ? ` AND p.nodus_id IN (${nodusIds.map(() => '?').join(',')})`
    : '';
  return getDb()
    .prepare(
      `SELECT * FROM (
         SELECT p.passage_id, p.nodus_id, p.text, p.page_label, p.source_ref, p.page_number,
                w.title, w.authors_json, w.year, w.zotero_key,
                vec_cosine(p.embedding, ?) AS similarity
           FROM passages p
           JOIN works w ON w.nodus_id = p.nodus_id
          WHERE p.embedding IS NOT NULL
            AND w.archived = 0
            AND ${PASSAGE_MATCHES_RESOLVED_TEXT}
            AND p.embedding_provider = ?
            AND p.embedding_model = ?
            AND p.embedding_dim = ?${scoped}
       ) WHERE similarity >= ?
       ORDER BY similarity DESC
       LIMIT ?`
    )
    .all(encodeEmbedding(queryEmbedding), config.provider, config.model, queryEmbedding.length, ...nodusIds, threshold, limit) as SimilarPassage[];
}

/**
 * The same search as `findSimilarPassages`, paged so it does not hold the main
 * process for the whole scan (see ./vectorScan.ts). Used by the long generations —
 * Deep Research runs one of these per probe and per section, and the passage index
 * is the largest table of all.
 *
 * Ranking reads ids only; the text and its work are fetched for the winners alone,
 * instead of dragging every passage in the corpus through SQLite's sorter.
 */
export async function findSimilarPassagesPaged(
  queryEmbedding: number[],
  threshold: number,
  limit: number,
  opts: { nodusIds?: string[] } = {}
): Promise<SimilarPassage[]> {
  if (limit <= 0 || opts.nodusIds?.length === 0) return [];
  const config = currentEmbeddingConfig();
  const nodusIds = [...new Set(opts.nodusIds ?? [])];
  const scoped = nodusIds.length ? ` AND p.nodus_id IN (${nodusIds.map(() => '?').join(',')})` : '';
  const ranked = await scanSimilar<{ passage_id: string; content_hash: string; rid: number; similarity: number }>({
    table: 'passages',
    sql: `SELECT p.passage_id, p.content_hash, p.rowid AS rid, vec_scan(p.embedding) AS similarity
            FROM passages p
            JOIN works w ON w.nodus_id = p.nodus_id
           WHERE p.rowid > ? AND p.rowid <= ?
             AND p.embedding IS NOT NULL
             AND w.archived = 0
             AND ${PASSAGE_MATCHES_RESOLVED_TEXT}
             AND p.embedding_provider = ?
             AND p.embedding_model = ?
             AND p.embedding_dim = ?${scoped}`,
    params: [config.provider, config.model, queryEmbedding.length, ...nodusIds],
    query: queryEmbedding,
    threshold,
    limit,
  });
  if (ranked.length === 0) return [];

  const byId = new Map(ranked.map((row) => [row.passage_id, {
    similarity: row.similarity,
    contentHash: row.content_hash,
  }]));
  const rows = getDb()
    .prepare(
      `SELECT p.passage_id, p.nodus_id, p.text, p.page_label, p.source_ref, p.page_number, p.content_hash,
              w.title, w.authors_json, w.year, w.zotero_key
         FROM passages p
         JOIN works w ON w.nodus_id = p.nodus_id
        WHERE p.passage_id IN (${ranked.map(() => '?').join(',')})
          AND w.archived = 0
          AND ${PASSAGE_MATCHES_RESOLVED_TEXT}`
    )
    .all(...ranked.map((row) => row.passage_id)) as Array<Omit<SimilarPassage, 'similarity'> & { content_hash: string }>;
  // Back into the ranked order the scan produced; the IN clause has none of its own.
  return rows
    .filter((row) => byId.get(row.passage_id)?.contentHash === row.content_hash)
    .map(({ content_hash: _contentHash, ...row }) => ({
      ...row,
      similarity: byId.get(row.passage_id)?.similarity ?? 0,
    }))
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * How many passages carry an embedding for the current provider/model (0 ⇒ the full text
 * is not indexed for semantic search, so findSimilarPassages can only return nothing).
 * Mirrors embeddedIdeaCount; both let a caller tell "no matches" apart from "no index".
 */
export function embeddedPassageCount(): number {
  const config = currentEmbeddingConfig();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count
         FROM passages p
         JOIN works w ON w.nodus_id = p.nodus_id
        WHERE p.embedding IS NOT NULL
          AND w.archived = 0
          AND ${PASSAGE_MATCHES_RESOLVED_TEXT}
          AND p.embedding_provider = ?
          AND p.embedding_model = ?`
    )
    .get(config.provider, config.model) as { count: number };
  return row.count;
}

export function getPassageDetail(passageId: string): PassageDetail | null {
  const row = getDb()
    .prepare(
      `SELECT p.passage_id, p.nodus_id, p.text, p.page_label, p.source_ref, p.page_number, p.chunk_index,
              w.title, w.authors_json, w.year, w.zotero_key
         FROM passages p
         JOIN works w ON w.nodus_id = p.nodus_id
        WHERE p.passage_id = ?
          AND ${PASSAGE_MATCHES_RESOLVED_TEXT}`
    )
    .get(passageId) as
    | {
        passage_id: string;
        nodus_id: string;
        text: string;
        page_label: string | null;
        source_ref: string | null;
        page_number: number | null;
        chunk_index: number;
        title: string;
        authors_json: string;
        year: number | null;
        zotero_key: string;
      }
    | undefined;
  if (!row) return null;
  let authors: string[] = [];
  try {
    authors = JSON.parse(row.authors_json || '[]');
  } catch {
    // Stored work metadata remains usable even if legacy author JSON is malformed.
  }
  return {
    passage_id: row.passage_id,
    nodus_id: row.nodus_id,
    text: row.text,
    page_label: row.page_label,
    source_ref: row.source_ref,
    page_number: row.page_number,
    chunk_index: row.chunk_index,
    work: { title: row.title, authors, year: row.year, zotero_key: row.zotero_key },
  };
}

/** Lightweight status based on the last deep-scan content hash and current model. */
export function workPassageStatuses(nodusIds?: string[]): WorkPassageStatus[] {
  const ids = [...new Set(nodusIds ?? [])];
  const where = ids.length ? `WHERE w.nodus_id IN (${ids.map(() => '?').join(',')})` : '';
  const config = currentEmbeddingConfig();
  const rows = getDb()
    .prepare(
      `SELECT w.nodus_id, w.deep_hash, w.resolved_text_hash,
              COUNT(p.passage_id) AS total_passages,
              SUM(CASE WHEN ${PASSAGE_MATCHES_RESOLVED_TEXT}
                       THEN 1 ELSE 0 END) AS text_current_passages,
              SUM(CASE WHEN p.embedding IS NOT NULL
                         AND p.embedding_dim > 0
                       THEN 1 ELSE 0 END) AS embedded_passages,
              SUM(CASE WHEN p.embedding IS NOT NULL
                         AND p.embedding_provider = ?
                         AND p.embedding_model = ?
                         AND p.embedding_dim > 0
                       THEN 1 ELSE 0 END) AS model_current_passages,
              SUM(CASE WHEN ${PASSAGE_MATCHES_RESOLVED_TEXT}
                         AND p.embedding IS NOT NULL
                         AND p.embedding_provider = ?
                         AND p.embedding_model = ?
                         AND p.embedding_dim > 0
                       THEN 1 ELSE 0 END) AS current_passages
         FROM works w
         LEFT JOIN passages p ON p.nodus_id = w.nodus_id
         ${where}
        GROUP BY w.nodus_id, w.deep_hash, w.resolved_text_hash`
    )
    .all(config.provider, config.model, config.provider, config.model, ...ids) as {
    nodus_id: string;
    deep_hash: string | null;
    resolved_text_hash: string | null;
    total_passages: number;
    text_current_passages: number | null;
    embedded_passages: number | null;
    model_current_passages: number | null;
    current_passages: number | null;
  }[];
  return rows.map((row) => {
    const totalPassages = Number(row.total_passages ?? 0);
    const current = Number(row.current_passages ?? 0);
    const textCurrent = Number(row.text_current_passages ?? 0);
    const embedded = Number(row.embedded_passages ?? 0);
    const modelCurrent = Number(row.model_current_passages ?? 0);
    const status = totalPassages === 0 ? 'missing' : current === totalPassages ? 'complete' : 'outdated';
    const textChanged = totalPassages > 0 && textCurrent !== totalPassages;
    // Only call this a model change when every passage still has a vector. Missing
    // vectors are a different repair condition and must not accuse Settings.
    const modelChanged = totalPassages > 0 && embedded === totalPassages && modelCurrent !== totalPassages;
    const outdatedReason = status !== 'outdated'
      ? null
      : textChanged && modelChanged
        ? 'text_and_model_changed'
        : textChanged
          ? 'text_changed'
          : modelChanged
            ? 'model_changed'
            : 'missing_embeddings';
    return {
      nodus_id: row.nodus_id,
      totalPassages,
      status,
      outdatedReason,
    };
  });
}

export function clearAllPassages(): void {
  getDb().prepare('DELETE FROM passages').run();
}
