import type Database from 'better-sqlite3';
import { quoteIdentifier } from '../db/rowIdentityCore';

/** Schema and data change atomically. A killed worker rolls back trigger removal too. */
export function withOutboxSuppressed<T>(db: Database.Database, work: () => T): T {
  return db.transaction(() => {
    const triggers = db.prepare(`SELECT name,sql FROM sqlite_master WHERE type='trigger'
      AND (name LIKE 'nodus_outbox_up_%' OR name LIKE 'nodus_outbox_del_%')`).all() as { name: string; sql: string | null }[];
    for (const trigger of triggers) db.exec(`DROP TRIGGER ${quoteIdentifier(trigger.name)}`);
    const result = work();
    for (const trigger of triggers) if (trigger.sql) db.exec(trigger.sql);
    return result;
  })();
}
