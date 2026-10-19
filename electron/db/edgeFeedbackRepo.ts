import { getDb } from './database';
import type { EdgeFeedback, EdgeFeedbackVerdict, EdgeFeedbackView } from '@shared/types';

/**
 * Audit verdicts over derived relations. A verdict is keyed by the idea pair +
 * relation type so it survives rescans (edge rows are deleted and recreated by
 * every pipeline pass, their ids are not stable). Rejections hide the pair in
 * both directions via the visible_edges view; confirmations are annotations.
 */

/** Set (upsert), or clear when verdict is null, the verdict for a pair+type. */
export function setEdgeFeedback(
  fromId: string,
  toId: string,
  type: string,
  verdict: EdgeFeedbackVerdict | null,
  note = ''
): void {
  const db = getDb();
  if (verdict === null) {
    // Clear whichever direction holds the verdict.
    db.prepare('DELETE FROM edge_feedback WHERE type = ? AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))').run(
      type,
      fromId,
      toId,
      toId,
      fromId
    );
    return;
  }
  // One row per undirected pair: replace any existing verdict in either direction.
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM edge_feedback WHERE type = ? AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))').run(
      type,
      fromId,
      toId,
      toId,
      fromId
    );
    db.prepare('INSERT INTO edge_feedback (from_id, to_id, type, verdict, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      fromId,
      toId,
      type,
      verdict,
      note,
      new Date().toISOString()
    );
  });
  tx();
}

/** Verdict for a pair+type, direction-agnostic. */
export function getEdgeFeedback(fromId: string, toId: string, type: string): EdgeFeedback | null {
  const row = getDb()
    .prepare(
      'SELECT * FROM edge_feedback WHERE type = ? AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))'
    )
    .get(type, fromId, toId, toId, fromId) as EdgeFeedback | undefined;
  return row ?? null;
}

/** All verdicts, newest first, with idea labels for display. */
export function listEdgeFeedback(): EdgeFeedbackView[] {
  return getDb()
    .prepare(
      `SELECT f.*, COALESCE(a.label, f.from_id) AS from_label, COALESCE(b.label, f.to_id) AS to_label
         FROM edge_feedback f
         LEFT JOIN ideas a ON a.global_id = f.from_id
         LEFT JOIN ideas b ON b.global_id = f.to_id
        ORDER BY f.created_at DESC`
    )
    .all() as EdgeFeedbackView[];
}

/** Map keyed `${from}|${to}|${type}` (both directions) → verdict, for annotating graphs. */
export function edgeFeedbackMap(): Map<string, EdgeFeedbackVerdict> {
  const rows = getDb().prepare('SELECT from_id, to_id, type, verdict FROM edge_feedback').all() as {
    from_id: string;
    to_id: string;
    type: string;
    verdict: EdgeFeedbackVerdict;
  }[];
  const map = new Map<string, EdgeFeedbackVerdict>();
  for (const r of rows) {
    map.set(`${r.from_id}|${r.to_id}|${r.type}`, r.verdict);
    map.set(`${r.to_id}|${r.from_id}|${r.type}`, r.verdict);
  }
  return map;
}
