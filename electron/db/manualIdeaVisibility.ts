import type Database from 'better-sqlite3';

/** Manual-mode ideas and companion-authored ideas share their untrashed owner
 * predicate. No database is opened at import time. */
export const manualIdeaVisible = (id: string): string => `(EXISTS (
 SELECT 1 FROM notes n WHERE json_valid(n.source_json) AND json_extract(n.source_json,'$.note')='manual-idea'
 AND json_extract(n.source_json,'$.ref')=${id} AND n.trashed_at IS NULL
 AND (json_extract(n.source_json,'$.authoredOn')='mobile' OR EXISTS (
  SELECT 1 FROM settings s WHERE s.key='app' AND json_valid(s.value) AND json_extract(s.value,'$.academicMode')='manual'
 ))
))`;

/** Call only for Manual vaults; Auto candidates also include companion authorship. */
export function activeManualIdeaIds(db: Database.Database): Set<string> {
  const rows = db.prepare(`SELECT i.global_id FROM ideas i WHERE ${manualIdeaVisible('i.global_id')} ORDER BY i.created_at DESC`).all() as { global_id: string }[];
  return new Set(rows.map(row => row.global_id));
}

/** Read consumers retain Auto's historical visibility and respect Manual trash. */
export const academicIdeaAvailable = (id: string): string => `(NOT EXISTS (
 SELECT 1 FROM settings s WHERE s.key='app' AND json_valid(s.value) AND json_extract(s.value,'$.academicMode')='manual'
) OR ${manualIdeaVisible(id)})`;
