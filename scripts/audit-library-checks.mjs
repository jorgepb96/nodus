// Library-wide sanity checks beyond the idea-graph references in
// audit-graph-integrity.mjs: graph shape and provenance, themes, embeddings,
// summaries, passages (citable text) and the Documentary Index.
//
// Every entry is plain read-only SQL. `severity` decides what a nonzero count means:
//   error — an invariant the write path is supposed to guarantee; nonzero is a bug.
//   warn  — legitimate but noteworthy state (stale, leftover, quality), not corruption.
// Each `why` names the code the invariant comes from, so a failing check can be traced
// back to its writer. The configured embedding model is read from the vault's own
// `settings` row (key 'app'); embedding keys are not shared app-prefs, so the vault
// value is authoritative (electron/db/appPrefs.ts SHARED_MODEL_KEYS).
//
// FTS comparisons use EXCEPT on the *_fts_content tables: a correlated NOT EXISTS on
// their unindexed columns takes minutes on a large vault; EXCEPT takes milliseconds.

const CFG_PROVIDER = `(SELECT json_extract(value,'$.embeddingProvider') FROM settings WHERE key='app')`;
const CFG_MODEL = `(SELECT json_extract(value,'$.embeddingModel') FROM settings WHERE key='app')`;
// A support points at the wrong passage when the passage is in another source (and
// the quote's source has passages), or lacks the quote's start while a passage of the
// quote's own source contains it. Case-insensitive (Unicode, via contains_ci), like quoteOffset: a short quote
// ("Hydrocarbon, 66") otherwise matches an exact-case copy in a back-of-book index far
// from the quote's page. Shared with scripts/repair-library-integrity.mjs.
export const WRONG_SUPPORT_PREDICATE = `(u.source_ref IS NOT NULL AND p.source_ref IS NOT u.source_ref
        AND EXISTS (SELECT 1 FROM passages q WHERE q.nodus_id = u.nodus_id AND q.source_ref = u.source_ref))
     OR (NOT contains_ci(p.text, substr(u.quote, 1, 40))
        AND EXISTS (SELECT 1 FROM passages q WHERE q.nodus_id = u.nodus_id AND q.source_ref IS u.source_ref
                      AND contains_ci(q.text, substr(u.quote, 1, 40))))`;

/** Unicode case-insensitive containment (SQLite's lower() folds ASCII only). Register
 *  on any connection that evaluates WRONG_SUPPORT_PREDICATE. */
export function registerAuditFunctions(db) {
  db.function('contains_ci', { deterministic: true }, (haystack, needle) =>
    haystack != null && needle != null && String(haystack).toLocaleLowerCase().includes(String(needle).toLocaleLowerCase()) ? 1 : 0);
}
const CURRENT_VERSIONS = `SELECT current_version_id FROM document_profile_state WHERE current_version_id IS NOT NULL`;

export const LIBRARY_CHECKS = [
  // ── Graph shape and provenance ────────────────────────────────────────────
  {
    group: 'graph', severity: 'error', label: 'self-loop edges',
    why: 'deepScan internal relations have no from===to guard when fusion maps two labels to one idea (deepScan.ts internal-relation loop; addEdge accepts it)',
    count: `SELECT COUNT(*) AS n FROM edges WHERE from_id = to_id`,
    detail: `SELECT w.title, e.id, e.from_id, e.type FROM edges e
      LEFT JOIN works w ON w.nodus_id = e.source_work WHERE e.from_id = e.to_id`,
  },
  {
    group: 'graph', severity: 'error', label: 'edge owner ≠ trace method',
    why: "addEdge's dedupe branch overwrites the trace but keeps source_work; purgeDeepData deletes by source_work (deep) or by method (reprocess/bridge), so these are never cleaned up or are cleaned up wrongly",
    count: `SELECT COUNT(*) AS n FROM edges e JOIN edge_traces et ON et.edge_id = e.id
      WHERE (et.method = 'deep' AND e.source_work IS NULL)
         OR (et.method IN ('bridge','reprocess') AND e.source_work IS NOT NULL)`,
    detail: `SELECT w.title, e.id, et.method, e.source_work FROM edges e
      JOIN edge_traces et ON et.edge_id = e.id LEFT JOIN works w ON w.nodus_id = e.source_work
      WHERE (et.method = 'deep' AND e.source_work IS NULL)
         OR (et.method IN ('bridge','reprocess') AND e.source_work IS NOT NULL)`,
  },
  {
    group: 'graph', severity: 'error', label: 'edges without a trace',
    why: 'every addEdge caller passes a trace; the existing check only covers traces→edges',
    count: `SELECT COUNT(*) AS n FROM edges e WHERE NOT EXISTS (SELECT 1 FROM edge_traces et WHERE et.edge_id = e.id)`,
  },
  {
    group: 'graph', severity: 'error', label: 'symmetric edges not canonical',
    why: 'canonicalEdgeEndpoints stores symmetric types with from_id < to_id (ideasRepo.ts); dedupe relies on it',
    count: `SELECT COUNT(*) AS n FROM edges
      WHERE type IN ('contradicts','shares_method','measures_same','variant_of')
        AND from_id > to_id AND COALESCE(source_work,'') <> 'manual'`,
  },
  {
    group: 'graph', severity: 'error', label: 'edge owner → missing work',
    why: 'source_work is not FK-enforced',
    count: `SELECT COUNT(*) AS n FROM edges e
      WHERE e.source_work IS NOT NULL AND e.source_work <> 'manual'
        AND NOT EXISTS (SELECT 1 FROM works w WHERE w.nodus_id = e.source_work)`,
  },
  {
    group: 'graph', severity: 'error', label: 'graph rows → missing works',
    why: 'nodus_id on occurrences/evidence/gaps/external_refs/work_idea_synthesis is not FK-enforced',
    count: `SELECT COUNT(*) AS n FROM (
        SELECT nodus_id FROM idea_occurrences UNION ALL SELECT nodus_id FROM evidence
        UNION ALL SELECT nodus_id FROM gaps UNION ALL SELECT nodus_id FROM external_refs
        UNION ALL SELECT nodus_id FROM work_idea_synthesis
      ) r WHERE NOT EXISTS (SELECT 1 FROM works w WHERE w.nodus_id = r.nodus_id)`,
  },
  {
    group: 'graph', severity: 'error', label: 'evidence without its occurrence',
    why: 'deepScan only adds evidence for an idea it just recorded as occurring in that work',
    count: `SELECT COUNT(*) AS n FROM evidence ev WHERE ev.global_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = ev.global_id AND io.nodus_id = ev.nodus_id)`,
  },
  {
    group: 'graph', severity: 'error', label: 'dormant ideas still occurring',
    why: 'upsertOccurrence revives an idea; a dormant idea with occurrences means the sweep ran on stale state',
    count: `SELECT COUNT(DISTINCT io.global_id) AS n FROM idea_occurrences io
      JOIN ideas i ON i.global_id = io.global_id WHERE i.orphaned_at IS NOT NULL`,
  },
  {
    group: 'graph', severity: 'error', label: 'unheld active ideas',
    why: 'the dormancy sweep keeps a zero-occurrence idea active only if an edge holds it or it is a manual idea (ideasRepo.ts dormancy sweep)',
    count: `SELECT COUNT(*) AS n FROM ideas i WHERE i.orphaned_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = i.global_id)
      AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.from_id = i.global_id)
      AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.to_id = i.global_id)
      AND NOT EXISTS (SELECT 1 FROM notes n WHERE json_extract(n.source_json,'$.note') = 'manual-idea'
                        AND json_extract(n.source_json,'$.ref') = i.global_id)`,
  },
  {
    group: 'graph', severity: 'error', label: 'manual-idea notes → dead idea',
    why: 'the dormancy/prune code spares ideas referenced by a manual-idea note',
    count: `SELECT COUNT(*) AS n FROM notes n
      LEFT JOIN ideas i ON i.global_id = json_extract(n.source_json,'$.ref')
      WHERE json_extract(n.source_json,'$.note') = 'manual-idea'
        AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)`,
  },
  {
    group: 'graph', severity: 'error', label: 'research coverage → dead idea',
    why: 'pruneDormantIdeas does not clean research_coverage_links (only deleteIdea does)',
    count: `SELECT COUNT(*) AS n FROM research_coverage_links r
      LEFT JOIN ideas i ON i.global_id = r.ref_id
      WHERE r.kind = 'idea' AND (i.global_id IS NULL OR i.orphaned_at IS NOT NULL)`,
  },
  {
    group: 'graph', severity: 'warn', label: 'duplicate active ideas',
    why: 'fusion never compares new ideas from the same scan with each other (fusion.ts applyFusionPlan)',
    count: `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ideas WHERE orphaned_at IS NULL
      GROUP BY type, lower(trim(statement)) HAVING COUNT(*) > 1)`,
    detail: `SELECT group_concat(global_id, ' = ') AS ids, substr(min(statement), 1, 70) AS statement
      FROM ideas WHERE orphaned_at IS NULL GROUP BY type, lower(trim(statement)) HAVING COUNT(*) > 1`,
  },
  {
    group: 'graph', severity: 'warn', label: 'deep analysis older than text',
    why: 'the text was re-resolved after the deep scan; deepScan re-runs when the hash changes',
    count: `SELECT COUNT(*) AS n FROM works WHERE archived = 0 AND deep_status = 'done'
      AND resolved_text_hash IS NOT NULL AND deep_hash IS NOT resolved_text_hash`,
    detail: `SELECT title, deep_at, text_resolved_at FROM works WHERE archived = 0 AND deep_status = 'done'
      AND resolved_text_hash IS NOT NULL AND deep_hash IS NOT resolved_text_hash`,
  },
  {
    group: 'graph', severity: 'warn', label: 'leftover deep-scan checkpoints',
    why: 'cleared only on a successful commit; these are from a rescan that failed or was abandoned',
    count: `SELECT COUNT(*) AS n FROM scan_checkpoints sc JOIN works w ON w.nodus_id = sc.nodus_id
      WHERE w.deep_status = 'done' AND w.deep_queued = 0`,
    detail: `SELECT w.title, COUNT(*) AS rows_, min(sc.created_at) AS since FROM scan_checkpoints sc
      JOIN works w ON w.nodus_id = sc.nodus_id WHERE w.deep_status = 'done' AND w.deep_queued = 0 GROUP BY w.nodus_id`,
  },

  // ── Themes ────────────────────────────────────────────────────────────────
  {
    group: 'themes', severity: 'error', label: 'unpinned themes with no links',
    why: 'pruneOrphanThemes deletes unpinned themes nothing references (themesRepo.ts)',
    count: `SELECT COUNT(*) AS n FROM themes t WHERE t.pinned = 0
      AND NOT EXISTS (SELECT 1 FROM idea_theme_links l WHERE l.theme_id = t.theme_id)
      AND NOT EXISTS (SELECT 1 FROM work_themes wt WHERE wt.theme_id = t.theme_id)`,
  },
  {
    group: 'themes', severity: 'error', label: 'duplicate theme labels',
    why: 'getOrCreateTheme matches on the normalised label',
    count: `SELECT COUNT(*) AS n FROM (SELECT 1 FROM themes GROUP BY lower(trim(label)) HAVING COUNT(*) > 1)`,
  },

  // ── Embeddings (ideas, summaries, passages, document vectors) ──────────────
  {
    group: 'embeddings', severity: 'error', label: 'embedding size ≠ dim',
    why: 'search filters on embedding_dim = query length, so a mismatched row silently drops out',
    count: `SELECT COUNT(*) AS n FROM (
        SELECT embedding, embedding_dim FROM ideas WHERE embedding IS NOT NULL
        UNION ALL SELECT embedding, embedding_dim FROM work_summaries WHERE embedding IS NOT NULL
        UNION ALL SELECT embedding, embedding_dim FROM passages WHERE embedding IS NOT NULL
        UNION ALL SELECT embedding, embedding_dim FROM document_vectors WHERE embedding IS NOT NULL
      ) WHERE embedding_dim IS NOT length(embedding) / 4 OR length(embedding) % 4 <> 0`,
  },
  {
    group: 'embeddings', severity: 'error', label: 'embedding metadata without vector',
    why: 'ideaNeedsEmbedding / summaryNeedsEmbedding treat metadata as describing a stored vector',
    count: `SELECT COUNT(*) AS n FROM (
        SELECT embedding, embedding_model FROM ideas UNION ALL SELECT embedding, embedding_model FROM work_summaries
        UNION ALL SELECT embedding, embedding_model FROM passages
      ) WHERE embedding IS NULL AND embedding_model IS NOT NULL`,
  },
  {
    group: 'embeddings', severity: 'warn', label: 'embedded with another model',
    why: 'legitimate right after an embedding-model switch, until a reindex',
    count: `SELECT (SELECT COUNT(*) FROM ideas WHERE orphaned_at IS NULL AND embedding IS NOT NULL
                      AND (embedding_provider IS NOT ${CFG_PROVIDER} OR embedding_model IS NOT ${CFG_MODEL}))
          + (SELECT COUNT(*) FROM work_summaries WHERE embedding IS NOT NULL
                      AND (embedding_provider IS NOT ${CFG_PROVIDER} OR embedding_model IS NOT ${CFG_MODEL}))
          + (SELECT COUNT(*) FROM passages WHERE embedding_provider IS NOT ${CFG_PROVIDER} OR embedding_model IS NOT ${CFG_MODEL})
          + (SELECT COUNT(*) FROM document_vectors WHERE version_id IN (${CURRENT_VERSIONS})
                      AND (embedding_provider IS NOT ${CFG_PROVIDER} OR embedding_model IS NOT ${CFG_MODEL})) AS n`,
  },
  {
    group: 'embeddings', severity: 'warn', label: 'stale idea embeddings',
    why: "the embedded text includes the idea's theme labels; re-theming makes it stale until re-embedded (same predicate as readinessFilters.ts)",
    needs: 'idea_embedding_text_hash',
    count: `SELECT COUNT(*) AS n FROM ideas i WHERE i.orphaned_at IS NULL AND i.embedding IS NOT NULL
      AND EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = i.global_id)
      AND i.embedding_text_hash IS NOT idea_embedding_text_hash(i.type, i.label, i.statement,
        COALESCE((SELECT GROUP_CONCAT(DISTINCT t.label) FROM idea_theme_links it
                  JOIN themes t ON t.theme_id = it.theme_id WHERE it.global_id = i.global_id), ''))`,
    detail: `SELECT w.title, COUNT(DISTINCT i.global_id) AS stale FROM ideas i
      JOIN idea_occurrences io ON io.global_id = i.global_id JOIN works w ON w.nodus_id = io.nodus_id
      WHERE i.orphaned_at IS NULL AND i.embedding IS NOT NULL
      AND i.embedding_text_hash IS NOT idea_embedding_text_hash(i.type, i.label, i.statement,
        COALESCE((SELECT GROUP_CONCAT(DISTINCT t.label) FROM idea_theme_links it
                  JOIN themes t ON t.theme_id = it.theme_id WHERE it.global_id = i.global_id), ''))
      GROUP BY w.nodus_id ORDER BY stale DESC`,
  },

  // ── Summaries ─────────────────────────────────────────────────────────────
  {
    group: 'summaries', severity: 'error', label: 'done summary without row',
    why: 'summaryScan writes the row and the done status in one transaction',
    count: `SELECT COUNT(*) AS n FROM works w WHERE w.summary_status = 'done'
      AND NOT EXISTS (SELECT 1 FROM work_summaries s WHERE s.nodus_id = w.nodus_id)`,
  },
  {
    group: 'summaries', severity: 'error', label: 'summary rows → missing work',
    why: 'FK cascade only holds on connections with foreign_keys ON',
    count: `SELECT COUNT(*) AS n FROM work_summaries s WHERE NOT EXISTS (SELECT 1 FROM works w WHERE w.nodus_id = s.nodus_id)`,
  },
  {
    group: 'summaries', severity: 'error', label: 'summary hash out of sync',
    why: 'written together in summaryScan; a mismatch hides the work from semantic work search (workSummariesRepo EXISTS filter)',
    count: `SELECT COUNT(*) AS n FROM works w JOIN work_summaries s USING (nodus_id)
      WHERE w.summary_status = 'done' AND w.summary_hash IS NOT s.content_hash`,
  },
  {
    group: 'summaries', severity: 'error', label: 'done summary incomplete',
    why: 'setSummaryResult always sets hash + time and clears the error on done; summaryScan rejects empty output',
    count: `SELECT (SELECT COUNT(*) FROM works WHERE summary_status = 'done'
                      AND (summary_hash IS NULL OR summary_at IS NULL OR summary_error IS NOT NULL))
          + (SELECT COUNT(*) FROM work_summaries WHERE trim(summary) = '') AS n`,
  },
  {
    group: 'summaries', severity: 'warn', label: 'done summary not embedded',
    why: 'summaryScan defers the embedding if the provider is down; the work is invisible to semantic work search until then',
    count: `SELECT COUNT(*) AS n FROM works w JOIN work_summaries s USING (nodus_id)
      WHERE w.summary_status = 'done' AND (s.embedding IS NULL OR s.embedding_text_hash IS NULL)`,
  },

  // ── Passages (citable text) ───────────────────────────────────────────────
  {
    group: 'passages', severity: 'error', label: 'passages → missing work',
    why: 'passages.nodus_id is not FK-enforced on a plain connection',
    count: `SELECT COUNT(*) AS n FROM passages p WHERE NOT EXISTS (SELECT 1 FROM works w WHERE w.nodus_id = p.nodus_id)`,
  },
  {
    group: 'passages', severity: 'error', label: 'passages without embedding',
    why: 'passageEmbeddingPipeline refuses to publish a chunk set with a missing vector',
    count: `SELECT COUNT(*) AS n FROM passages WHERE embedding IS NULL`,
  },
  {
    group: 'passages', severity: 'error', label: 'passage chunk set malformed',
    why: 'replaceWorkPassages writes one atomic set per work: ids nodus_id#i, chunks 0..n-1, one content hash, one model',
    count: `SELECT (SELECT COUNT(*) FROM (SELECT nodus_id FROM passages GROUP BY nodus_id
                      HAVING COUNT(DISTINCT content_hash) > 1 OR MIN(chunk_index) <> 0
                          OR MAX(chunk_index) + 1 <> COUNT(*) OR COUNT(DISTINCT embedding_model) > 1))
          + (SELECT COUNT(*) FROM passages WHERE passage_id <> nodus_id || '#' || chunk_index) AS n`,
  },
  {
    group: 'passages', severity: 'error', label: 'passages_fts out of sync',
    why: 'kept 1:1 by the passages_document_fts triggers; lexical search joins FTS back to passages',
    count: `SELECT (SELECT COUNT(*) FROM (SELECT c0 FROM passages_fts_content EXCEPT SELECT passage_id FROM passages))
          + (SELECT COUNT(*) FROM (SELECT passage_id FROM passages EXCEPT SELECT c0 FROM passages_fts_content)) AS n`,
  },
  {
    group: 'passages', severity: 'error', label: 'NUL bytes in citable text',
    why: 'U+0000 from a PDF text layer; SQLite length/substr/instr and FTS snippets stop at it, truncating the citable text (combineSegments now replaces it)',
    count: `SELECT (SELECT COUNT(*) FROM passages WHERE instr(CAST(text AS BLOB), x'00') > 0)
          + (SELECT COUNT(*) FROM evidence WHERE instr(CAST(quote AS BLOB), x'00') > 0) AS n`,
    detail: `SELECT w.title, COUNT(*) AS passages FROM passages p JOIN works w USING (nodus_id)
      WHERE instr(CAST(p.text AS BLOB), x'00') > 0 GROUP BY p.nodus_id ORDER BY passages DESC`,
  },
  {
    group: 'passages', severity: 'warn', label: 'stale passages',
    why: 'the text was re-resolved; passages stay hidden from search until reindexed (PASSAGE_MATCHES_RESOLVED_TEXT)',
    count: `SELECT COUNT(DISTINCT p.nodus_id) AS n FROM passages p JOIN works w USING (nodus_id)
      WHERE w.archived = 0 AND NOT ((w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
        OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash)))`,
  },

  // ── Documentary Index ─────────────────────────────────────────────────────
  {
    group: 'documentary index', severity: 'error', label: 'current version pointer broken',
    why: 'current_version_id must name a current version of the same work, and only one version per work is current',
    count: `SELECT (SELECT COUNT(*) FROM document_profile_state s
                      LEFT JOIN document_profile_versions v ON v.version_id = s.current_version_id
                      WHERE s.current_version_id IS NOT NULL
                        AND (v.version_id IS NULL OR v.nodus_id <> s.nodus_id OR v.state <> 'current'))
          + (SELECT COUNT(*) FROM document_profile_state WHERE status = 'current' AND current_version_id IS NULL)
          + (SELECT COUNT(*) FROM (SELECT nodus_id FROM document_profile_versions WHERE state = 'current'
                      GROUP BY nodus_id HAVING COUNT(*) > 1)) AS n`,
  },
  {
    group: 'documentary index', severity: 'error', label: 'profile FTS out of sync',
    why: 'document_profiles_fts is maintained by hand (no triggers); document_sections_fts must mirror current sections',
    count: `SELECT (SELECT COUNT(*) FROM (SELECT c0, c1 FROM document_profiles_fts_content
                      EXCEPT SELECT nodus_id, current_version_id FROM document_profile_state WHERE current_version_id IS NOT NULL))
          + (SELECT COUNT(*) FROM (SELECT nodus_id, current_version_id FROM document_profile_state WHERE current_version_id IS NOT NULL
                      EXCEPT SELECT c0, c1 FROM document_profiles_fts_content))
          + (SELECT COUNT(*) FROM (SELECT c0, c1 FROM document_sections_fts_content
                      EXCEPT SELECT section_id, nodus_id FROM document_sections WHERE version_id IN (${CURRENT_VERSIONS})))
          + (SELECT COUNT(*) FROM (SELECT section_id, nodus_id FROM document_sections WHERE version_id IN (${CURRENT_VERSIONS})
                      EXCEPT SELECT c0, c1 FROM document_sections_fts_content)) AS n`,
  },
  {
    group: 'documentary index', severity: 'error', label: 'current idea links → dead idea',
    why: 'alignIdeas only links ideas occurring in the work; a deep rescan does not regenerate the profile',
    count: `SELECT COUNT(*) AS n FROM document_idea_links d
      JOIN document_profile_state s ON s.current_version_id = d.version_id
      LEFT JOIN ideas i ON i.global_id = d.global_id
      WHERE i.global_id IS NULL OR i.orphaned_at IS NOT NULL
         OR NOT EXISTS (SELECT 1 FROM idea_occurrences io WHERE io.global_id = d.global_id AND io.nodus_id = d.nodus_id)`,
  },
  {
    group: 'documentary index', severity: 'error', label: 'section page range inverted',
    why: "documentProfile takes source_ref from the start offset but the end page from the end offset, so a section crossing attachments gets the next attachment's page",
    count: `SELECT COUNT(*) AS n FROM document_sections
      WHERE page_start_number IS NOT NULL AND page_end_number IS NOT NULL AND page_end_number < page_start_number`,
    detail: `SELECT w.title, s.title AS section, s.page_start_number, s.page_end_number FROM document_sections s
      JOIN works w ON w.nodus_id = s.nodus_id
      WHERE s.page_start_number IS NOT NULL AND s.page_end_number IS NOT NULL AND s.page_end_number < s.page_start_number`,
  },
  {
    group: 'documentary index', severity: 'error', label: 'support → wrong passage',
    why: 'passageForQuote used to pick by fuzzy word overlap across the whole document; flagged when the linked passage is in another source, or lacks the quote while a passage of its source has it',
    count: `SELECT COUNT(*) AS n FROM document_profile_support u
      JOIN document_profile_state s ON s.current_version_id = u.version_id
      JOIN passages p ON p.passage_id = u.passage_id
      WHERE ${WRONG_SUPPORT_PREDICATE}`,
    detail: `SELECT w.title, COUNT(*) AS supports FROM document_profile_support u
      JOIN document_profile_state s ON s.current_version_id = u.version_id
      JOIN passages p ON p.passage_id = u.passage_id JOIN works w ON w.nodus_id = u.nodus_id
      WHERE ${WRONG_SUPPORT_PREDICATE}
      GROUP BY u.nodus_id ORDER BY supports DESC`,
  },
  {
    group: 'documentary index', severity: 'error', label: 'checkpoints on superseded failed jobs',
    why: 'checkpoints are cleared only on success, and enqueue copies the last failed job\'s checkpoints into every new job — even after a later success, and keyed without the model',
    count: `SELECT COUNT(*) AS n FROM document_index_checkpoints c JOIN document_index_jobs f ON f.job_id = c.job_id
      WHERE f.status IN ('failed','cancelled')
        AND EXISTS (SELECT 1 FROM document_index_jobs k WHERE k.nodus_id = f.nodus_id AND k.vault_id = f.vault_id
                      AND k.status = 'completed' AND k.updated_at > f.updated_at)`,
    detail: `SELECT w.title, f.status, COUNT(*) AS checkpoints FROM document_index_checkpoints c
      JOIN document_index_jobs f ON f.job_id = c.job_id JOIN works w ON w.nodus_id = f.nodus_id
      WHERE f.status IN ('failed','cancelled')
        AND EXISTS (SELECT 1 FROM document_index_jobs k WHERE k.nodus_id = f.nodus_id AND k.vault_id = f.vault_id
                      AND k.status = 'completed' AND k.updated_at > f.updated_at)
      GROUP BY f.job_id`,
  },
  {
    group: 'documentary index', severity: 'error', label: 'current profile on changed text',
    why: 'the works_document_profile_stale_deep trigger ignores resolved_text_hash, so a re-resolved text leaves the profile "current"',
    count: `SELECT COUNT(*) AS n FROM document_profile_state s JOIN works w USING (nodus_id)
      WHERE s.status = 'current' AND (w.resolved_text_hash IS NULL
        OR EXISTS (SELECT 1 FROM library_analysis_provenance p WHERE p.work_id = s.nodus_id
                     AND p.component = 'documentProfile' AND p.document_fingerprint IS NOT w.resolved_text_hash))`,
  },
];
