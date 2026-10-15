import type Database from 'better-sqlite3';

const PREFIX = 'nodus_vector_scan_';

/** Every table a similarity scan reads, the vector tables and the ones their filters join. A scan
 *  whose statement reads a table missing here is answered without the worker's cache keys (it
 *  falls back to `PRAGMA data_version`), so forgetting one costs speed, never a stale answer. */
export const VECTOR_SCAN_TABLES = [
  'archive_item_persons', 'archive_items', 'document_profile_state', 'document_vectors',
  'idea_occurrences', 'ideas', 'passages', 'work_summaries', 'works',
] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * A write counter per scanned table, kept by triggers in the vault itself so a write from any
 * connection moves it in the same transaction.
 *
 * The vector-scan worker keyed its cached vectors on `PRAGMA data_version`, which moves on ANY
 * commit to the file: one settings row, one citation receipt or one chat message threw away
 * 100,000 cached vectors and the filtered rows, and the next scan paid ~1.7 s to rebuild them
 * (measured 2026-10-09 on 100k passages at 1024 dimensions). These counters move only when a
 * table the scan actually reads is written.
 */
export function ensureVectorScanGenerationTriggers(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS vector_scan_generations (name TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 0)');
  const present = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
  const register = db.prepare('INSERT OR IGNORE INTO vector_scan_generations (name, generation) VALUES (?, 0)');
  for (const table of VECTOR_SCAN_TABLES) {
    if (!present.has(table)) continue;
    register.run(table);
    for (const operation of ['insert', 'update', 'delete'] as const) {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS ${quoteIdentifier(`${PREFIX}${operation}_${table}`)}
        AFTER ${operation.toUpperCase()} ON ${quoteIdentifier(table)}
        BEGIN
          UPDATE vector_scan_generations SET generation = generation + 1 WHERE name = '${table}';
        END
      `);
    }
  }
}
