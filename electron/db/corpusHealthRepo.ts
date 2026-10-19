// Corpus health: the operational state of a (now large) library, framed as the
// concrete next things worth doing rather than as another chart. Each "bucket"
// is a lens over the works table — works with no text, works analysed only
// lightly, priority works still missing deep analysis, and texts worth
// recovering — plus the embedding/passage indexing backlog.
import type { CorpusHealth, CorpusHealthBucket, CorpusHealthWork } from '@shared/types';
import { getDb } from './database';
import { HEALTH_BUCKET_WHERE } from './corpusHealthBuckets';
import { currentEmbeddingConfig } from './ideasRepo';
import { workPassageStatuses } from './passagesRepo';

const SAMPLE_SIZE = 6;

interface CountRow {
  n: number;
}
interface SampleRow {
  nodus_id: string;
  title: string | null;
  year: number | null;
  zotero_key: string | null;
}

function bucket(where: string): CorpusHealthBucket {
  const db = getDb();
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM works WHERE ${where}`).get() as CountRow;
  const rows = db
    .prepare(
      `SELECT nodus_id, title, year, zotero_key FROM works
        WHERE ${where}
        ORDER BY year IS NULL, year DESC, title ASC
        LIMIT ${SAMPLE_SIZE}`
    )
    .all() as SampleRow[];
  const sample: CorpusHealthWork[] = rows.map((r) => ({
    nodus_id: r.nodus_id,
    title: r.title || '(sin título)',
    year: r.year,
    zotero_key: r.zotero_key,
  }));
  return { count: n, sample };
}

export function getCorpusHealth(): CorpusHealth {
  const db = getDb();
  const { n: totalWorks } = db
    .prepare('SELECT COUNT(*) AS n FROM works WHERE archived = 0')
    .get() as CountRow;

  // Idea embedding backlog, grouped by work so we can also report incomplete works.
  const config = currentEmbeddingConfig();
  const ideaRows = db
    .prepare(
      `SELECT io.nodus_id AS nodus_id,
              COUNT(DISTINCT i.global_id) AS total,
              COUNT(DISTINCT CASE
                WHEN i.embedding IS NOT NULL
                 AND i.embedding_provider = ?
                 AND i.embedding_model = ?
                THEN i.global_id END) AS embedded
         FROM idea_occurrences io
         JOIN embedding_read_ideas i ON i.global_id = io.global_id
         JOIN works w ON w.nodus_id = io.nodus_id AND w.archived = 0
        GROUP BY io.nodus_id`
    )
    .all(config.provider, config.model) as { nodus_id: string; total: number; embedded: number }[];

  let totalIdeas = 0;
  let embeddedIdeas = 0;
  let incompleteWorks = 0;
  for (const row of ideaRows) {
    totalIdeas += row.total;
    embeddedIdeas += row.embedded;
    if (row.embedded < row.total) incompleteWorks += 1;
  }

  // Passage index backlog, restricted to works that actually have text — a work
  // with no source can never be indexed, so it isn't "pending".
  const textWorks = db
    .prepare(
      `SELECT nodus_id FROM works
        WHERE archived = 0
          AND (source_type IS NULL OR source_type NOT IN ('none', 'abstract_only'))`
    )
    .all() as { nodus_id: string }[];
  const textWorkIds = textWorks.map((w) => w.nodus_id);
  const passagesPendingWorks = textWorkIds.length
    ? workPassageStatuses(textWorkIds).filter((s) => s.status !== 'complete').length
    : 0;

  return {
    totalWorks,
    withoutText: bucket(HEALTH_BUCKET_WHERE.withoutText),
    lightOnly: bucket(HEALTH_BUCKET_WHERE.lightOnly),
    deepPriority: bucket(HEALTH_BUCKET_WHERE.deepPriority),
    pdfsToRecover: bucket(HEALTH_BUCKET_WHERE.pdfsToRecover),
    embeddings: {
      totalIdeas,
      embeddedIdeas,
      pendingIdeas: Math.max(0, totalIdeas - embeddedIdeas),
      incompleteWorks,
      passagesPendingWorks,
    },
  };
}
