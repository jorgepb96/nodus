import { isManualAcademic } from '../ai/academicMode';
import { scheduleManualIndex } from '../ai/manualIdeaIndex';
import { setIdeaThemeLinks } from './themesRepo';
import { updateWorkspaceNote } from './workspaceRepo';
// Manual ideas: user-authored ideas that live in the graph just like analysed
// ideas (occurrences, anchored evidence, edges, embedding) but are owned by a
// note. The owning note carries the idea id in `source.ref` and the marker in
// `source.note`; deleting the note purges the idea and everything indexed for it.
import type {
  AutoIndexResult,
  IdeaCandidate,
  ManualIdeaPayload,
  Note,
} from '@shared/types';
import { getDb } from './database';
import * as ideas from './ideasRepo';
import { createNote, getNote } from './notesRepo';
import { embed } from '../ai/aiClient';

// Mirrors MANUAL_IDEA_MARKER in shared/types.ts (kept local so the electron build
// doesn't need to resolve a runtime @shared import).
const MANUAL_IDEA_MARKER = 'manual-idea';

// Sentinel stored in edges.source_work so note-authored connections can be told
// apart from analysis edges (which carry a real work nodus_id) and replaced
// wholesale on each save without disturbing derived edges.
const MANUAL_EDGE_SOURCE = 'manual';

export function createManualIdea(input: { folderId: string | null; title?: string }): {
  note: Note;
  globalId: string;
} {
  return getDb().transaction(() => {
  const title = input.title?.trim() || 'Idea sin título';
  const idea = ideas.createIdea({ type: 'claim', label: title, statement: '', embedding: null });
  const note = createNote({
    title,
    content: '',
    kind: 'idea',
    folderId: input.folderId,
    source: { origin: 'idea', ref: idea.global_id, note: MANUAL_IDEA_MARKER },
  });
  scheduleManualIndex();
  return { note, globalId: idea.global_id };
  })();
}

export function saveManualIdea(p: ManualIdeaPayload): void {
  const db = getDb();
  const gid = p.globalId;
  const owner = getNote(p.noteId);
  if (!owner || owner.trashedAt || owner.source?.note !== MANUAL_IDEA_MARKER || owner.source.ref !== gid) {
    throw new Error('La idea no pertenece a esta nota.');
  }
  const tx = db.transaction(() => {
    const title = p.title.trim() || 'Idea sin título';
    if (!p.linksOnly) {
      if (isManualAcademic()) updateWorkspaceNote(p.noteId, { title, contentMarkdown: p.summary });
      else db.prepare('UPDATE ideas SET label = ?, statement = ? WHERE global_id = ?').run(title, p.summary, gid);
    }

    if (p.themes !== undefined) setIdeaThemeLinks(MANUAL_EDGE_SOURCE, gid, p.themes, 1, 'explicit');

    // Works that develop the idea.
    db.prepare('DELETE FROM idea_occurrences WHERE global_id = ?').run(gid);
    for (const w of p.works) {
      if (!w.nodusId) continue;
      ideas.upsertOccurrence(gid, w.nodusId, 'principal', w.development ?? '', 1);
    }

    // Anchored evidence (quote + optional location, optionally tied to a work).
    db.prepare('DELETE FROM evidence WHERE global_id = ?').run(gid);
    for (const e of p.evidence) {
      if (!e.quote.trim()) continue;
      ideas.addEvidence(gid, e.nodusId ?? '', e.quote.trim(), e.location?.trim() || null, 'explicit');
    }

    // Only this note's outgoing edges are editable here. Preserve stable edge IDs.
    const outgoing = db.prepare('SELECT id, to_id, type FROM edges WHERE source_work=? AND from_id=?')
      .all(MANUAL_EDGE_SOURCE, gid) as Array<{ id: string; to_id: string; type: string }>;
    for (const edge of outgoing) {
      if (p.connections.some(c => !c.incoming && c.toId === edge.to_id && c.type === edge.type)) continue;
      db.prepare('DELETE FROM edge_traces WHERE edge_id=?').run(edge.id);
      db.prepare('DELETE FROM edges WHERE id=?').run(edge.id);
    }
    for (const c of p.connections) {
      if (c.incoming || !c.toId || c.toId === gid) continue;
      ideas.addEdge({
        from_id: gid,
        to_id: c.toId,
        type: c.type,
        basis: c.basis,
        confidence: c.confidence,
        source_work: MANUAL_EDGE_SOURCE,
      });
    }
  });
  tx();
  scheduleManualIndex();
}

/** Purge a manual idea and everything indexed for it. Called when its note is deleted. */
export function deleteManualIdea(globalId: string): void {
  ideas.deleteIdea(globalId);
}

export async function autoIndexManualIdea(input: {
  globalId: string;
  title: string;
  summary: string;
  excludeIds?: string[];
}): Promise<AutoIndexResult> {
  if (isManualAcademic()) {
    scheduleManualIndex(true);
    return { indexed: false, message: 'Indexación en segundo plano.', suggestions: [] };
  }
  const text = `${input.title}\n\n${input.summary}`.trim();
  if (!text) {
    return { indexed: false, message: 'Añade un título o resumen antes de indexar.', suggestions: [] };
  }
  let vector: number[] | null = null;
  try {
    vector = await embed(text, undefined, { role: 'document' });
  } catch (e) {
    return { indexed: false, message: e instanceof Error ? e.message : String(e), suggestions: [] };
  }
  if (!vector) {
    return {
      indexed: false,
      message: 'No hay proveedor de embeddings configurado. Configúralo en Ajustes para indexar.',
      suggestions: [],
    };
  }
  ideas.updateIdeaEmbedding(input.globalId, text, vector);
  const exclude = [input.globalId, ...(input.excludeIds ?? [])];
  const suggestions = ideas.findSimilarIdeas(vector, 0.3, 12, { excludeIds: exclude }) as IdeaCandidate[];
  return { indexed: true, message: null, suggestions };
}

export function searchIdeaCandidates(query: string, excludeIds: string[] = [], limit = 20): IdeaCandidate[] {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const excludeSql = excludeIds.length ? `AND global_id NOT IN (${excludeIds.map(() => '?').join(',')})` : '';
  return getDb()
    .prepare(
      `SELECT global_id, type, label, statement
         FROM ideas
        WHERE (label LIKE ? ESCAPE '\\' OR statement LIKE ? ESCAPE '\\')
          AND orphaned_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM notes n WHERE json_valid(n.source_json)
            AND json_extract(n.source_json,'$.note')='manual-idea'
            AND json_extract(n.source_json,'$.ref')=ideas.global_id AND n.trashed_at IS NOT NULL)
          ${excludeSql}
        ORDER BY length(label) ASC
        LIMIT ?`
    )
    .all(like, like, ...excludeIds, limit) as IdeaCandidate[];
}
