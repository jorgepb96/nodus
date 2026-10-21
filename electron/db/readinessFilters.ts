// SQL predicates for the library's status presets.
//
// These MUST agree with `deriveWorkStatus` in src/libraryStatus.ts: the row shows
// a pill and the preset filters by the same word, so a reader who clicks
// "Incompleto" must get exactly the rows whose pill says "Incompleto".
//
// The only transient state with no SQL predicate is `running`: it exists solely in
// the live queue, and the renderer overlays it. Persisted `pending` markers DO have
// a predicate, so a work waiting to resume is filterable instead of leaking into
// "Incompleto" (which is what happened while it had none).
//
// Semantic freshness is evaluated here. `idea_embedding_text_hash` is registered on
// the connection (see database.ts) from the same pure helper the embedding pipeline
// uses, so the hash SQL compares against is the one the app itself would compute.
import type { WorkReadiness } from '@shared/types';
import { currentEmbeddingConfig } from './ideasRepo';
import { IDEA_EMBEDDING_THEME_LABELS_SQL } from './ideaEmbeddingText';

type Readiness = Exclude<WorkReadiness, 'running'>;

/** Accepted by the queue but not executing; outranks failure to match deriveWorkStatus. */
const PENDING = `(w.light_status = 'pending' OR w.deep_status = 'pending' OR w.summary_status = 'pending')`;

/** Any of the three AI passes reported a failure. */
const FAILED = `(w.light_status = 'failed' OR w.deep_status = 'failed' OR w.deep_error IS NOT NULL OR w.summary_status = 'failed')`;

/** Nothing has been attempted yet. */
const UNSTARTED = `(w.light_status = 'none' AND w.deep_status = 'none')`;

const EFFECTIVE_SOURCE = `COALESCE(w.resolved_source_type, w.source_type)`;

/** The deep pass finished, but it only ever saw the abstract. */
const ABSTRACT_ONLY = `(w.deep_status = 'done' AND w.source_type IN ('abstract_only', 'none') AND ${EFFECTIVE_SOURCE} IN ('abstract_only', 'none'))`;

/** Extraction was attempted and there was nothing usable to read. */
const NO_TEXT = `(
  w.deep_status = 'skipped_no_text'
  OR w.summary_status = 'skipped_no_text'
  OR ${EFFECTIVE_SOURCE} IN ('none', 'abstract_only')
)`;

/**
 * One idea's embedding is current for the configured provider/model and its exact
 * source text. Mirrors `getWorkEmbeddingStatuses` in embeddingPipeline.ts.
 */
const IDEA_EMBEDDING_CURRENT = `(
  i.embedding IS NOT NULL
  AND i.embedding_provider = @readyProv
  AND i.embedding_model = @readyModel
  AND i.embedding_dim > 0
  AND i.embedding_dim = length(i.embedding) / 4
  AND i.embedding_text_hash = idea_embedding_text_hash(
    i.type, i.label, i.statement,
    ${IDEA_EMBEDDING_THEME_LABELS_SQL}
  )
)`;

/**
 * Every idea of the work is embedded and current. Mirrors embeddingPipeline's
 * `complete` flag: a work with no ideas is not "missing" its semantic index, so the
 * predicate is vacuously true when there are none.
 */
const SEMANTIC_COMPLETE = `(
  NOT EXISTS (
    SELECT 1 FROM idea_occurrences io
    JOIN embedding_read_ideas i ON i.global_id = io.global_id
    WHERE io.nodus_id = w.nodus_id
      AND NOT ${IDEA_EMBEDDING_CURRENT}
  )
)`;

/**
 * Every passage of the work is embedded with the CURRENT provider/model and
 * still matches the text it was cut from. Mirrors passagesRepo's 'complete'.
 *
 * Phrased as "has passages, and none of them is stale" rather than the
 * SUM(...) = COUNT(*) form used elsewhere in this repo: a bare HAVING with no
 * GROUP BY is rejected by SQLite as a non-aggregate query.
 */
const PASSAGE_IS_CURRENT = `(
  p.embedding IS NOT NULL
  AND p.embedding_provider = @readyProv
  AND p.embedding_model    = @readyModel
  AND p.embedding_dim > 0
  AND (
    (w.resolved_text_hash IS NOT NULL AND p.content_hash = w.resolved_text_hash)
    OR (w.resolved_text_hash IS NULL AND (w.deep_hash IS NULL OR p.content_hash = w.deep_hash))
  )
)`;

/**
 * Read the vectors where they live, through `embedding_read_passages`.
 *
 * Passage embeddings moved out of the source row into `embedding_index_values`, and that view
 * is the compatibility projection presenting them under the old column names (see
 * embeddingIndexSchema.ts); `worksRepo`'s passages/!passages filters and `passagesRepo`'s
 * status reads already go through it. Reading the base table instead finds `embedding IS NULL`
 * on every row of an indexed vault, so PASSAGE_IS_CURRENT was false for every passage: "Listo"
 * returned nothing at all and "Incompleto" returned the entire analysable corpus.
 */
const PASSAGES_COMPLETE = `(
  EXISTS (SELECT 1 FROM embedding_read_passages p WHERE p.nodus_id = w.nodus_id)
  AND NOT EXISTS (
    SELECT 1 FROM embedding_read_passages p
     WHERE p.nodus_id = w.nodus_id
       AND NOT ${PASSAGE_IS_CURRENT}
  )
)`;

/** Everything the JS precedence chain rules out before it considers ready/incomplete. */
const ANALYSABLE = `NOT ${PENDING} AND NOT ${FAILED} AND NOT ${UNSTARTED} AND NOT ${ABSTRACT_ONLY} AND NOT ${NO_TEXT}`;

/** Ready = all five steps, matching READY_STEPS. */
const READY_CORE = `w.light_status = 'done' AND w.deep_status = 'done'
  AND (w.resolved_text_hash IS NULL OR w.deep_hash = w.resolved_text_hash)
  AND ${SEMANTIC_COMPLETE} AND w.summary_status = 'done' AND ${PASSAGES_COMPLETE}`;

/**
 * The WHERE fragment for a readiness preset, plus the bound parameters it needs.
 * Returns null for values with no SQL expression.
 */
export function readinessWhere(readiness: Readiness): { sql: string; params: Record<string, string> } | null {
  const needsEmbedding = readiness === 'ready' || readiness === 'incomplete';
  const params: Record<string, string> = {};
  if (needsEmbedding) {
    const config = currentEmbeddingConfig();
    params.readyProv = config.provider;
    params.readyModel = config.model;
  }

  switch (readiness) {
    case 'pending':
      return { sql: PENDING, params };
    case 'failed':
      return { sql: `NOT ${PENDING} AND ${FAILED}`, params };
    case 'unstarted':
      return { sql: `NOT ${PENDING} AND NOT ${FAILED} AND ${UNSTARTED}`, params };
    case 'abstractOnly':
      return { sql: `NOT ${PENDING} AND NOT ${FAILED} AND NOT ${UNSTARTED} AND ${ABSTRACT_ONLY}`, params };
    case 'noText':
      return { sql: `NOT ${PENDING} AND NOT ${FAILED} AND NOT ${UNSTARTED} AND NOT ${ABSTRACT_ONLY} AND ${NO_TEXT}`, params };
    case 'ready':
      return { sql: `${ANALYSABLE} AND ${READY_CORE}`, params };
    case 'incomplete':
      return { sql: `${ANALYSABLE} AND NOT (${READY_CORE})`, params };
    default:
      return null;
  }
}
