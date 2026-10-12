import type Database from 'better-sqlite3';
import { SCHEMA_VERSION } from '../db/migrations';
import { identityColumns, quoteIdentifier, tableColumns } from '../db/rowIdentity';
import { MUTABLE_TABLES } from './outboxTriggers';
import { compareHlc, formatHlc, parseHlc } from '@shared/syncOperations';
import { immersionSessionIdFromAnnotationDocument } from '@shared/readerAnnotations';

/**
 * The owner's side of the relay: take what collaborators wrote, apply it to the canonical
 * vault, and acknowledge.
 *
 * The server never interprets a mutation — it validates a shape and appends. Every decision
 * about what the vault actually contains is made here, on the one machine that knows the
 * schema, has run the migrations, and holds the real database.
 *
 * Conflict policy is the one the rest of Nodus already uses: newest wins by updated_at (or
 * created_at), and a local row that is newer than the incoming one is kept. Nothing here
 * silently drops a change. Deterministically invalid rows are reported and acknowledged so
 * they cannot block the stream; operational failures remain unacknowledged and are retried.
 */

const APPLICABLE = new Set<string>(MUTABLE_TABLES);

export interface IncomingMutation {
  id: string;
  seq: number;
  clientId?: string;
  kind: 'upsert' | 'delete';
  table: string;
  key: unknown[];
  row?: Record<string, unknown> | null;
  schemaVersion?: number;
  createdAt?: string;
  actorId?: string;
  deviceId?: string;
  hlc?: string;
  assets?: { hash: string }[];
  documentHash?: string | null;
  blobHash?: string | null;
  /**
   * Set by a caller that found the mutation deterministically unusable before applying it
   * (an image row that names no asset). Refused and acknowledged like any other poison row,
   * rather than thrown, which would block every later mutation forever.
   */
  refusal?: string;
}

/**
 * One decision, in full: what arrived, where it came from, and what became of it.
 *
 * The counters below say how many; this says which. Nothing here is written to the
 * database by this module — see the note on applyIncomingMutations — so an entry is a
 * plain description the caller may record, show, or ignore.
 */
export interface InboxEntry {
  id: string;
  seq: number;
  clientId?: string;
  table: string;
  key: unknown[];
  kind: 'upsert' | 'delete';
  outcome: 'applied' | 'deleted' | 'keptLocal' | 'refused';
  reason?: string;
  /** Something a person would recognise: a report's objective, a note's title. */
  title?: string | null;
  entityKind?: string | null;
  parentEntityKind?: 'deep_research' | 'immersion' | 'library_document' | null;
  parentEntityId?: string | null;
  parentTitle?: string | null;
  schemaVersion?: number;
  createdAt?: string;
}

export interface InboxSummary {
  applied: number;
  deleted: number;
  keptLocal: number;
  refused: { id: string; reason: string }[];
  retryable: { id: string; reason: string }[];
  /** Highest sequence number safe to acknowledge; everything above it is still owed. */
  cursor: number;
  /** Every decision above, in the order it was made. */
  entries: InboxEntry[];
}

/**
 * A human-readable name for an incoming row, and the kind of thing it is.
 *
 * Pure and query-free on purpose: it runs inside the apply loop, once per mutation, and a
 * lookup here would be a second read of a row the caller already holds. A table it does
 * not know returns nulls, and the inbox falls back to "table · key" — which is honest,
 * and better than inventing a name.
 */
export function titleOf(
  table: string,
  row: Record<string, unknown> | null | undefined,
): { title: string | null; entityKind: string | null } {
  if (!row) return { title: null, entityKind: null };
  const text = (value: unknown): string | null => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed ? trimmed : null;
  };

  if (table === 'writing_saved_drafts') {
    // The one that matters: this is the Deep Research report the phone sends. Its brief
    // carries the objective the user actually typed, which beats a generated title when
    // the row arrives without one.
    let brief: { kind?: unknown; objective?: unknown } = {};
    try {
      if (typeof row.brief_json === 'string') brief = JSON.parse(row.brief_json) as typeof brief;
    } catch {
      // A brief this build cannot parse still has a row, and the row may have a title.
    }
    return {
      title: text(row.title) ?? text(brief.objective),
      entityKind: typeof brief.kind === 'string' ? brief.kind : null,
    };
  }
  if (table === 'notes') return { title: text(row.title), entityKind: 'note' };
  if (table === 'note_folders') return { title: text(row.name), entityKind: 'note_folder' };
  if (table === 'immersion_sessions') return { title: text(row.title) ?? text(row.topic), entityKind: 'immersion' };
  if (table === 'writing_draft_annotations') {
    return {
      title: text(row.comment_text) ?? text(row.selected_text),
      entityKind: immersionSessionIdFromAnnotationDocument(String(row.draft_id ?? ''))
        ? 'immersion_annotation'
        : 'deep_research_annotation',
    };
  }
  return { title: null, entityKind: null };
}

type InboxDescription = Pick<
  InboxEntry,
  'title' | 'entityKind' | 'parentEntityKind' | 'parentEntityId' | 'parentTitle'
>;

/**
 * Describe both the changed row and the durable root it belongs to. Parent metadata is
 * resolved while the row still exists: after a deletion there is deliberately nothing
 * left for the renderer to join against.
 */
function descriptionOf(
  db: Database.Database,
  table: string,
  row: Record<string, unknown> | null | undefined,
): InboxDescription {
  const own = titleOf(table, row);
  if (table !== 'writing_draft_annotations' || !row) return own;
  const draftId = typeof row.draft_id === 'string' ? row.draft_id.trim() : '';
  // Global-library annotations are handled before this path by the external route. Its
  // document metadata lives on disk rather than in writing_saved_drafts.
  if (!draftId || draftId.startsWith('nodus-library:')) return own;
  const immersionId = immersionSessionIdFromAnnotationDocument(draftId);
  if (immersionId) {
    const session = db.prepare('SELECT title, topic FROM immersion_sessions WHERE id = ?').get(immersionId) as Record<string, unknown> | undefined;
    return {
      ...own,
      parentEntityKind: 'immersion',
      parentEntityId: immersionId,
      parentTitle: titleOf('immersion_sessions', session).title,
    };
  }
  const report = db.prepare('SELECT title, brief_json FROM writing_saved_drafts WHERE id = ?').get(draftId) as Record<string, unknown> | undefined;
  return {
    ...own,
    parentEntityKind: 'deep_research',
    parentEntityId: draftId,
    parentTitle: titleOf('writing_saved_drafts', report).title,
  };
}

function timestampOf(row: Record<string, unknown> | null | undefined, fallback?: string): number {
  for (const column of ['updated_at', 'created_at']) {
    const value = row?.[column];
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  const parsedFallback = fallback ? Date.parse(fallback) : NaN;
  return Number.isFinite(parsedFallback) ? parsedFallback : 0;
}

function operationHlc(mutation: IncomingMutation): string {
  if (mutation.hlc && parseHlc(mutation.hlc)) return mutation.hlc;
  const parsed = mutation.createdAt ? Date.parse(mutation.createdAt) : NaN;
  return formatHlc({ wallTime: Number.isFinite(parsed) ? Math.max(0, parsed) : 0, counter: 0,
    deviceId: (mutation.deviceId || mutation.clientId || 'legacy').replace(/[^A-Za-z0-9._:~-]/g, '_').slice(0, 128) || 'legacy' });
}

function normalizedRowKey(key: unknown[]): string {
  return JSON.stringify(key.map((value) => value == null ? null : String(value)));
}

function writeClock(db: Database.Database, mutation: IncomingMutation, rowKey: string, hlc: string): void {
  db.prepare(`INSERT INTO sync_row_clocks (table_name, row_key, hlc, operation_id, actor_id, device_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(table_name, row_key) DO UPDATE SET
      hlc = excluded.hlc, operation_id = excluded.operation_id, actor_id = excluded.actor_id,
      device_id = excluded.device_id, updated_at = excluded.updated_at`)
    .run(mutation.table, rowKey, hlc, mutation.id, mutation.actorId || 'remote', mutation.deviceId || mutation.clientId || 'remote', new Date().toISOString());
}

function writeConflict(db: Database.Database, mutation: IncomingMutation, rowKey: string, incomingHlc: string,
  localClock: { hlc: string; operation_id: string } | undefined, outcome: 'kept_local' | 'applied_remote', losingRow: unknown): void {
  if (!localClock) return;
  const incomingWins = outcome === 'applied_remote';
  db.prepare(`INSERT OR IGNORE INTO sync_conflicts
    (id, table_name, row_key, winning_operation_id, losing_operation_id, winner_hlc, loser_hlc, outcome, losing_row_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(`conflict_${mutation.id}_${localClock.operation_id}`.slice(0, 240), mutation.table, rowKey,
      incomingWins ? mutation.id : localClock.operation_id, incomingWins ? localClock.operation_id : mutation.id,
      incomingWins ? incomingHlc : localClock.hlc, incomingWins ? localClock.hlc : incomingHlc, outcome,
      losingRow == null ? null : JSON.stringify(losingRow), new Date().toISOString());
}

/**
 * Apply a batch, stopping at the first mutation that cannot be applied.
 *
 * Stopping matters: acknowledging past a refusal would drop it from the ledger forever, and
 * the collaborator who wrote it would never learn it had not landed. The cursor therefore
 * only ever advances over mutations that were genuinely handled.
 *
 * This function does NOT write the inbox record itself, and that is deliberate. It has six
 * callers, five of them test scripts passing throwaway databases, and one of those replays
 * the very same batch on purpose to prove a retry is safe. An unconditional write here
 * would manufacture inbox rows during the suite and, on that replay, either collide or
 * resurrect an entry the user had already dealt with. The caller records what it gets back.
 */
export interface ExternalMutationDecision {
  outcome: Extract<InboxEntry['outcome'], 'applied' | 'deleted' | 'keptLocal'>;
  title?: string | null;
  entityKind?: string | null;
  parentEntityKind?: InboxEntry['parentEntityKind'];
  parentEntityId?: string | null;
  parentTitle?: string | null;
}

export function applyIncomingMutations(
  db: Database.Database,
  mutations: IncomingMutation[],
  options: { external?: (mutation: IncomingMutation) => ExternalMutationDecision | null } = {},
): InboxSummary {
  const summary: InboxSummary = { applied: 0, deleted: 0, keptLocal: 0, refused: [], retryable: [], cursor: 0, entries: [] };
  const present = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name)
  );

  /** Describe one decision, borrowing the fields every entry shares from the mutation. */
  const describe = (
    mutation: IncomingMutation,
    outcome: InboxEntry['outcome'],
    extra: {
      reason?: string;
      title?: string | null;
      entityKind?: string | null;
      parentEntityKind?: InboxEntry['parentEntityKind'];
      parentEntityId?: string | null;
      parentTitle?: string | null;
    } = {},
  ): InboxEntry => ({
    id: mutation.id,
    seq: Number(mutation.seq),
    clientId: mutation.clientId,
    table: mutation.table,
    key: mutation.key,
    kind: mutation.kind,
    outcome,
    schemaVersion: mutation.schemaVersion,
    createdAt: mutation.createdAt,
    ...extra,
  });

  const refuse = (mutation: IncomingMutation, reason: string): void => {
    summary.refused.push({ id: mutation.id, reason });
    summary.entries.push(describe(mutation, 'refused', {
      reason,
      // A rejected parent row never existed locally, so preserve the established honest
      // fallback. Annotation rows are the exception: their parent identity is needed to
      // keep a repeated refusal inside the document/report notification it belongs to.
      ...(mutation.table === 'writing_draft_annotations'
        ? descriptionOf(db, mutation.table, mutation.row)
        : {}),
    }));
    // A permanently invalid entry is recorded for the user and acknowledged. Leaving the
    // cursor before it would make one malformed/too-new row block every valid later change
    // forever (head-of-line denial of service).
    summary.cursor = Math.max(summary.cursor, Number(mutation.seq) || 0);
  };

  const retry = (mutation: IncomingMutation, reason: string): void => {
    // Do not create a durable "refused" inbox item and, most importantly, do not advance the
    // cursor. SQLITE_BUSY, a parent row still in flight or an external sidecar failure may be
    // healthy on the next poll; acknowledging it now would discard valid work permanently.
    summary.retryable.push({ id: mutation.id, reason });
  };

  for (const mutation of mutations.slice().sort((a, b) => Number(a.seq) - Number(b.seq))) {
    // A mutation written against a newer schema carries columns this build does not know.
    // Applying it anyway would DROP them, and because the truncated row keeps the newer
    // timestamp the loss would then propagate — the same reasoning mergeSyncPackage uses to
    // refuse a newer package outright.
    if (Number(mutation.schemaVersion) > SCHEMA_VERSION) {
      refuse(mutation, `Procede de un esquema más reciente (v${mutation.schemaVersion} frente a v${SCHEMA_VERSION}). Actualiza Nodus para recibir estos cambios.`);
      continue;
    }
    if (mutation.refusal) {
      refuse(mutation, mutation.refusal);
      continue;
    }
    try {
      const external = options.external?.(mutation) ?? null;
      if (external) {
        if (external.outcome === 'applied') summary.applied += 1;
        else if (external.outcome === 'deleted') summary.deleted += 1;
        else summary.keptLocal += 1;
        summary.entries.push(describe(mutation, external.outcome, external));
        summary.cursor = Number(mutation.seq);
        continue;
      }
    } catch (error) {
      retry(mutation, error instanceof Error ? error.message : String(error));
      break;
    }
    if (!APPLICABLE.has(mutation.table) || !present.has(mutation.table)) {
      refuse(mutation, `La tabla ${mutation.table} no se acepta desde una réplica.`);
      continue;
    }

    const identity = identityColumns(mutation.table, undefined, db);
    if (identity.length !== mutation.key.length) {
      refuse(mutation, 'La clave de fila no coincide con la identidad de esa tabla.');
      continue;
    }
    const where = identity.map((column) => `${quoteIdentifier(column)} IS ?`).join(' AND ');
    const key = mutation.key.map((value) => (value === undefined ? null : value));
    const rowKey = normalizedRowKey(key);
    const incomingHlc = operationHlc(mutation);

    try {
      // The transaction RETURNS its decision, so it is read only after the commit. Counting
      // inside it would credit a mutation whose commit then failed, and the catch below
      // would report that very same mutation as refused — two answers for one decision.
      let localForDescription: Record<string, unknown> | undefined;
      const outcome = db.transaction((): InboxEntry['outcome'] => {
        db.pragma('defer_foreign_keys = ON');
        const local = db.prepare(`SELECT * FROM ${quoteIdentifier(mutation.table)} WHERE ${where}`).get(...key) as Record<string, unknown> | undefined;
        localForDescription = local;
        const localClock = present.has('sync_row_clocks')
          ? db.prepare('SELECT hlc, operation_id FROM sync_row_clocks WHERE table_name = ? AND row_key = ?').get(mutation.table, rowKey) as { hlc: string; operation_id: string } | undefined
          : undefined;
        const clockOrder = localClock ? compareHlc(localClock.hlc, incomingHlc) : null;
        if (localClock && clockOrder !== null && clockOrder > 0) {
          if (present.has('sync_conflicts')) writeConflict(db, mutation, rowKey, incomingHlc, localClock, 'kept_local', mutation.row ?? null);
          return 'keptLocal';
        }

        if (mutation.kind === 'delete') {
          // A local edit made after the remote deletion is the more recent fact, so the row
          // stays — the rule applyIncomingTombstones already applies to package imports.
          if (local && (clockOrder == null || clockOrder === 0) && timestampOf(local) > timestampOf(null, mutation.createdAt)) {
            if (present.has('sync_conflicts')) writeConflict(db, mutation, rowKey, incomingHlc, localClock, 'kept_local', null);
            return 'keptLocal';
          }
          db.prepare(`DELETE FROM ${quoteIdentifier(mutation.table)} WHERE ${where}`).run(...key);
          if (present.has('sync_row_clocks')) writeClock(db, mutation, rowKey, incomingHlc);
          return 'deleted';
        }

        const incoming = mutation.row ?? {};
        if (local && (clockOrder == null || clockOrder === 0) && timestampOf(local) > timestampOf(incoming, mutation.createdAt)) {
          if (present.has('sync_conflicts')) writeConflict(db, mutation, rowKey, incomingHlc, localClock, 'kept_local', incoming);
          return 'keptLocal';
        }
        const localColumns = new Set(tableColumns(mutation.table, db).map((column) => column.name));
        const columns = Object.keys(incoming).filter((column) => localColumns.has(column));
        if (columns.length === 0) {
          return 'keptLocal';
        }
        if (local) {
          // UPDATE the columns the mutation carries, never INSERT OR REPLACE.
          //
          // A mutation never carries binary — images travel on their own channel — so
          // replacing the whole row blanks every column it left out. In practice that meant
          // a collaborator touching a Deep Research report's metadata silently destroyed the
          // owner's copy of its illustration. Measured, not hypothetical: it happened.
          const assignable = columns.filter((column) => !identity.includes(column));
          if (assignable.length === 0) {
            return 'keptLocal';
          }
          db.prepare(
            `UPDATE ${quoteIdentifier(mutation.table)} SET ${assignable.map((column) => `${quoteIdentifier(column)} = ?`).join(', ')} WHERE ${where}`
          ).run([...assignable.map((column) => (incoming[column] === undefined ? null : incoming[column])), ...key]);
        } else {
          db.prepare(
            `INSERT INTO ${quoteIdentifier(mutation.table)} (${columns.map(quoteIdentifier).join(', ')}) ` +
            `VALUES (${columns.map(() => '?').join(', ')})`
          ).run(columns.map((column) => (incoming[column] === undefined ? null : incoming[column])));
        }
        if (present.has('sync_conflicts') && localClock && compareHlc(incomingHlc, localClock.hlc) > 0) {
          writeConflict(db, mutation, rowKey, incomingHlc, localClock, 'applied_remote', local ?? null);
        }
        if (present.has('sync_row_clocks')) writeClock(db, mutation, rowKey, incomingHlc);
        return 'applied';
      })();
      if (outcome === 'applied') summary.applied += 1;
      else if (outcome === 'deleted') summary.deleted += 1;
      else summary.keptLocal += 1;
      const descriptiveRow = localForDescription
        ? { ...localForDescription, ...(mutation.row ?? {}) }
        : mutation.row;
      summary.entries.push(describe(mutation, outcome, descriptionOf(db, mutation.table, descriptiveRow)));
      summary.cursor = Number(mutation.seq);
    } catch (error) {
      retry(mutation, error instanceof Error ? error.message : String(error));
      break;
    }
  }

  return summary;
}
