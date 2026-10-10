import { deleteDocumentVisuals } from '../capabilities/documentStore';
import { getActiveVault } from '../vaults/vaultRegistry';
import { v4 as uuid } from 'uuid';
import type {
  ModelRef,
  WritingWorkshopBrief,
  WritingWorkshopDraft,
  WritingWorkshopKind,
  WritingWorkshopSavedDraft,
  WritingWorkshopSaveDraftRequest,
  WritingWorkshopSelection,
} from '@shared/types';
import type { DeepResearchApproach } from '@shared/deepResearchApproaches';
import { normalizeDeepResearchApproach } from '@shared/deepResearchApproaches';
import { getDb } from './database';
import { deleteDecorativeImageRow, getDecorativeImage } from './decorativeImagesRepo';
import { deleteAnnotationsForWritingDraft } from './writingAnnotationsRepo';
import { deleteCompleteGuideArtifacts } from './completeGuideRepo';
import { relabelSavedDraft } from '../citations/liveCitations';

interface SavedWritingDraftRow {
  id: string;
  title: string;
  brief_json: string;
  selection_json: string;
  model_json: string | null;
  draft_json: string;
  created_at: string;
  updated_at: string;
  /** From the LEFT JOIN below: when this report was marked read, or null. */
  read_at?: string | null;
}

interface SavedWritingDraftSummaryRow {
  id: string;
  title: string;
  brief_json: string;
  model_json: string | null;
  abstract_snippet: string | null;
  abstract_length: number;
  generated_at: string | null;
  stats_json: string | null;
  content_chars: number;
  created_at: string;
  updated_at: string;
  read_at: string | null;
}

export interface WritingWorkshopDraftSummary {
  id: string;
  title: string;
  kind: WritingWorkshopKind;
  objective: string;
  audience: string | null;
  tone: WritingWorkshopBrief['tone'] | null;
  language: WritingWorkshopBrief['language'] | null;
  model: ModelRef | null;
  deepResearchApproach: DeepResearchApproach;
  abstractSnippet: string;
  generatedAt: string | null;
  stats: WritingWorkshopDraft['stats'] | null;
  contentChars: number;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListWritingWorkshopDraftSummariesOptions {
  query?: string;
  kind?: WritingWorkshopKind;
  sort?: 'newest' | 'oldest' | 'title';
  limit: number;
  offset: number;
}

/** Every list goes through the same join, so a report can never be listed without
 *  knowing whether it has been read — which is what made the badge and the button in
 *  the gallery disagree the one time it was fetched separately. */
const SELECT_DRAFTS =
  'SELECT d.*, r.updated_at AS read_at FROM writing_saved_drafts d ' +
  'LEFT JOIN writing_draft_reads r ON r.draft_id = d.id';

const INVALID_DRAFT_CATALOG = 'No se pudieron cargar todos los documentos guardados. Hay registros con un formato inválido; se conserva su contenido.';

/** Count and paginated discovery must not silently discard an unreadable row. */
function requireReadableDraftCatalog(): void {
  const invalid = getDb().prepare(`SELECT id FROM writing_saved_drafts
    WHERE CASE WHEN json_valid(brief_json) THEN json_type(brief_json) != 'object' ELSE 1 END
       OR CASE WHEN json_valid(draft_json) THEN json_type(draft_json) != 'object' ELSE 1 END
       OR CASE WHEN model_json IS NULL THEN 0 WHEN json_valid(model_json) THEN json_type(model_json) != 'object' ELSE 1 END
    LIMIT 1`).get();
  if (invalid) throw new Error(INVALID_DRAFT_CATALOG);
}

/**
 * Every read of a saved report goes through here, which is why the citation labels
 * are refreshed here and nowhere else: the reader, the exports, the archive and the
 * MCP tools all inherit it from this one place. The stored row is never written
 * back — the report on disk stays exactly as it was written, and the names it shows
 * are re-derived from the corpus each time it is opened.
 */
function toSavedDraft(row: SavedWritingDraftRow): WritingWorkshopSavedDraft | null {
  try {
    return relabelSavedDraft({
      id: row.id,
      title: row.title,
      brief: JSON.parse(row.brief_json) as WritingWorkshopBrief,
      selection: JSON.parse(row.selection_json) as WritingWorkshopSelection,
      model: row.model_json ? (JSON.parse(row.model_json) as ModelRef) : null,
      draft: JSON.parse(row.draft_json) as WritingWorkshopDraft,
      image: getDecorativeImage('deep_research', row.id),
      readAt: row.read_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch {
    // One corrupt local record must not prevent opening the rest of the workshop.
    return null;
  }
}

export function listWritingWorkshopDrafts(options: { requireComplete?: boolean } = {}): WritingWorkshopSavedDraft[] {
  if (options.requireComplete) requireReadableDraftCatalog();
  const rows = getDb()
    .prepare(`${SELECT_DRAFTS} ORDER BY d.updated_at DESC, d.created_at DESC`)
    .all() as SavedWritingDraftRow[];
  const drafts = rows.map(toSavedDraft);
  // Consultation must distinguish damaged records from a genuinely empty vault.
  // Legacy internal callers may still request the intact subset explicitly.
  if (options.requireComplete && drafts.some(draft => draft === null)) {
    throw new Error(INVALID_DRAFT_CATALOG);
  }
  return drafts.filter((draft): draft is WritingWorkshopSavedDraft => draft !== null);
}

function toDraftSummary(row: SavedWritingDraftSummaryRow): WritingWorkshopDraftSummary | null {
  try {
    const brief = JSON.parse(row.brief_json) as WritingWorkshopBrief;
    const abstract = (row.abstract_snippet ?? '').replace(/\s+/g, ' ').trim();
    return {
      id: row.id,
      title: row.title,
      kind: brief.kind,
      objective: brief.objective,
      audience: brief.audience ?? null,
      tone: brief.tone ?? null,
      language: brief.language ?? null,
      model: row.model_json ? (JSON.parse(row.model_json) as ModelRef) : null,
      deepResearchApproach: normalizeDeepResearchApproach(brief.deepResearchApproach),
      abstractSnippet: row.abstract_length > 500 ? `${abstract}…` : abstract,
      generatedAt: row.generated_at,
      stats: row.stats_json ? (JSON.parse(row.stats_json) as WritingWorkshopDraft['stats']) : null,
      contentChars: row.content_chars,
      readAt: row.read_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

/**
 * Compact, bounded catalogue for MCP and other remote readers.
 *
 * The gallery needs whole reports because it renders them locally. An MCP list does
 * not: returning every `draft_json` made a modest archive exceed the transport's 1 MB
 * response ceiling. SQLite extracts only the fields needed for discovery here; the
 * full report stays behind `getWritingWorkshopDraft`.
 */
export function listWritingWorkshopDraftSummaries(
  options: ListWritingWorkshopDraftSummariesOptions
): { drafts: WritingWorkshopDraftSummary[]; total: number } {
  requireReadableDraftCatalog();
  const where = ['json_valid(d.brief_json)', 'json_valid(d.draft_json)'];
  const values: Array<string | number> = [];
  if (options.kind) {
    where.push("json_extract(d.brief_json, '$.kind') = ?");
    values.push(options.kind);
  }
  const query = options.query?.trim().toLowerCase();
  if (query) {
    where.push(
      "(instr(lower(d.title), ?) > 0 OR instr(lower(COALESCE(json_extract(d.brief_json, '$.objective'), '')), ?) > 0)"
    );
    values.push(query, query);
  }
  const predicate = `WHERE ${where.join(' AND ')}`;
  const countRow = getDb()
    .prepare(`SELECT COUNT(*) AS total FROM writing_saved_drafts d ${predicate}`)
    .get(...values) as { total: number };
  const orderBy =
    options.sort === 'oldest'
      ? 'd.updated_at ASC, d.created_at ASC'
      : options.sort === 'title'
        ? 'd.title COLLATE NOCASE ASC, d.updated_at DESC'
        : 'd.updated_at DESC, d.created_at DESC';
  const rows = getDb()
    .prepare(
      `SELECT d.id, d.title, d.brief_json, d.model_json,
              substr(COALESCE(json_extract(d.draft_json, '$.abstract'), ''), 1, 500) AS abstract_snippet,
              length(COALESCE(json_extract(d.draft_json, '$.abstract'), '')) AS abstract_length,
              COALESCE(json_extract(d.draft_json, '$.generatedAt'), d.created_at) AS generated_at,
              json_extract(d.draft_json, '$.stats') AS stats_json,
              length(COALESCE(json_extract(d.draft_json, '$.draftMarkdown'), '')) AS content_chars,
              d.created_at, d.updated_at, r.updated_at AS read_at
         FROM writing_saved_drafts d
         LEFT JOIN writing_draft_reads r ON r.draft_id = d.id
         ${predicate}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`
    )
    .all(...values, options.limit, options.offset) as SavedWritingDraftSummaryRow[];
  const drafts = rows.map(toDraftSummary);
  if (drafts.some(draft => draft === null)) throw new Error(INVALID_DRAFT_CATALOG);
  return {
    drafts: drafts as WritingWorkshopDraftSummary[],
    total: countRow.total,
  };
}

export function countWritingWorkshopDrafts(kind?: WritingWorkshopKind): number {
  requireReadableDraftCatalog();
  const kindPredicate = kind ? " AND json_extract(brief_json, '$.kind') = ?" : '';
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS total FROM writing_saved_drafts WHERE json_valid(brief_json)${kindPredicate}`)
    .get(...(kind ? [kind] : [])) as { total: number };
  return row.total;
}

export function saveWritingWorkshopDraft(request: WritingWorkshopSaveDraftRequest): WritingWorkshopSavedDraft {
  const now = new Date().toISOString();
  const id = uuid();
  const title = request.title?.trim() || request.draft.title.trim() || 'Borrador sin título';
  getDb()
    .prepare(
      `INSERT INTO writing_saved_drafts (
         id, title, brief_json, selection_json, model_json, draft_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      title,
      JSON.stringify(request.draft.brief),
      JSON.stringify(request.draft.selection),
      request.model ? JSON.stringify(request.model) : null,
      JSON.stringify(request.draft),
      now,
      now
    );
  const saved = getWritingWorkshopDraft(id);
  if (!saved) throw new Error('No se pudo guardar el borrador');
  return saved;
}

export function getWritingWorkshopDraft(id: string): WritingWorkshopSavedDraft | null {
  const row = getDb().prepare(`${SELECT_DRAFTS} WHERE d.id = ?`).get(id) as SavedWritingDraftRow | undefined;
  if (!row) return null;
  const draft = toSavedDraft(row);
  if (!draft) throw new Error(INVALID_DRAFT_CATALOG);
  return draft;
}

/**
 * Mark a saved report read, or take the mark back.
 *
 * Returns the report as it now stands, or null when there is no such report — the
 * gallery can have a stale id after a delete on another machine, and inserting a read
 * mark for a report that is gone would leave a row nothing ever reads.
 *
 * There is no foreign key, deliberately: `writing_saved_drafts` rows also arrive by
 * merge and by the ledger, and a constraint would decide the order those two have to
 * land in. The delete below is what keeps a mark from outliving its report.
 */
export function setWritingWorkshopDraftRead(id: string, read: boolean): WritingWorkshopSavedDraft | null {
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM writing_saved_drafts WHERE id = ?').get(id);
  if (!exists) return null;
  if (read) {
    db.prepare(
      'INSERT INTO writing_draft_reads (draft_id, updated_at) VALUES (?, ?) ' +
        'ON CONFLICT(draft_id) DO UPDATE SET updated_at = excluded.updated_at'
    ).run(id, new Date().toISOString());
  } else {
    db.prepare('DELETE FROM writing_draft_reads WHERE draft_id = ?').run(id);
  }
  return getWritingWorkshopDraft(id);
}

export function deleteWritingWorkshopDraft(id: string): boolean {
  deleteDocumentVisuals(getActiveVault().id, { kind: 'deep-research', id });
  deleteDecorativeImageRow('deep_research', id);
  deleteAnnotationsForWritingDraft(id);
  deleteCompleteGuideArtifacts(id);
  // Before the report, so a mark can never be left pointing at nothing.
  getDb().prepare('DELETE FROM writing_draft_reads WHERE draft_id = ?').run(id);
  return getDb().prepare('DELETE FROM writing_saved_drafts WHERE id = ?').run(id).changes > 0;
}
