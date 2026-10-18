import { editorReferenceCatalog, type EditorReferenceOptions } from '@shared/editorReferences';
import { getDb } from './database';
import { getSettings } from './settingsRepo';
import { manualIdeaVisible } from './manualIdeaVisibility';

export function listEditorReferences(options?:EditorReferenceOptions) {
  const db = getDb();
  const rows = (sql: string) => db.prepare(sql).all() as Array<Record<string, unknown>>;
  if (options?.onlyWorks) {
    const terms = String(options.search ?? '').trim().slice(0, 200).split(/\s+/).filter(Boolean);
    const clauses = terms.map(() => "(title LIKE ? ESCAPE '\\' OR authors_json LIKE ? ESCAPE '\\' OR CAST(year AS TEXT) LIKE ? ESCAPE '\\' OR doi LIKE ? ESCAPE '\\')");
    const params = terms.flatMap(term => Array(4).fill('%' + term.replace(/[\\%_]/g, '\\$&') + '%'));
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(options.limit) || 50)));
    const works = db.prepare(`SELECT nodus_id, title, year, item_type, authors_json, creators_json, doi FROM works WHERE archived=0${clauses.length ? ' AND ' + clauses.join(' AND ') : ''} ORDER BY title COLLATE NOCASE, nodus_id LIMIT ?`).all(...params, limit) as Array<Record<string, unknown>>;
    return editorReferenceCatalog({ works });
  }
  // No text documents, blobs or embeddings cross IPC. Use the same visibility
  // predicate as Ideas; the active database provides the vault boundary.
  return editorReferenceCatalog({
    ideas: rows(`SELECT global_id, label, substr(statement,1,180) AS statement FROM ideas WHERE orphaned_at IS NULL ${getSettings().academicMode === 'manual' ? `AND ${manualIdeaVisible('ideas.global_id')}` : ''}`),
    authors: rows('SELECT author_id, name, affiliation FROM authors'),
    passages: options?.includePassages?db.prepare('SELECT p.passage_id, substr(p.text,1,160) AS text, p.page_label, p.page_number FROM passages p JOIN works w ON w.nodus_id=p.nodus_id WHERE w.archived=0 AND p.text LIKE ? LIMIT 50').all('%'+String(options.search??'').slice(0,200)+'%') as Array<Record<string,unknown>>:[],
    works: rows('SELECT nodus_id, title, year, item_type, authors_json, creators_json, doi FROM works WHERE archived = 0'),
    notes: rows('SELECT id, title, source_json FROM notes WHERE trashed_at IS NULL'),
    study_docs: rows('SELECT id, title, substr(description,1,180) AS description FROM study_docs WHERE deleted_at IS NULL AND archived_at IS NULL'),
    study_materials: rows('SELECT id, title, substr(description,1,180) AS description FROM study_materials WHERE deleted_at IS NULL AND archived_at IS NULL'),
  });
}
