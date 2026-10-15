import { manualIdeaVisible } from '../db/manualIdeaVisibility';
import { getDb } from "../db/database";
import { getActiveVault } from "../vaults/vaultRegistry";
import type { GraphNode, GraphEdge } from "@shared/types";
import type {
  StellarPageRequest,
  StellarPage,
  StellarSession,
  StellarTheme,
} from "@shared/stellarGraph";

const eligible = (id: string) =>
  `(${manualIdeaVisible(id)} OR EXISTS (SELECT 1 FROM idea_occurrences io JOIN works w ON w.nodus_id=io.nodus_id WHERE io.global_id=${id} AND w.archived=0 AND w.deep_status='done'))`;
const edgeScope = `${eligible("e.from_id")} AND ${eligible("e.to_id")} AND (e.source_work IS NULL OR (e.source_work='manual' AND ${manualIdeaVisible('e.from_id')}) OR EXISTS (SELECT 1 FROM works w WHERE w.nodus_id=e.source_work AND w.archived=0 AND w.deep_status='done'))`;
const edgeSelect = `SELECT e.id,e.from_id AS source,e.to_id AS target,e.type,e.basis,e.confidence,
 (SELECT f.verdict FROM edge_feedback f WHERE f.type=e.type AND f.verdict='confirmed' AND ((f.from_id=e.from_id AND f.to_id=e.to_id) OR (f.from_id=e.to_id AND f.to_id=e.from_id)) LIMIT 1) AS verdict FROM visible_edges e`;
/**
 * Ideas nested under a theme, with the same membership the theme lens uses in
 * graphService: the explicit idea↔theme links a deep scan wrote, plus — only for the
 * occurrences no scan ever linked — the themes of the work the idea came from. Both
 * halves stay inside the eligible corpus, so a theme bubble counts exactly the ideas
 * its drill-down opens.
 */
const themeMembers = (theme: string) => `SELECT io.global_id FROM idea_occurrences io
 JOIN works w ON w.nodus_id=io.nodus_id
 WHERE w.archived=0 AND w.deep_status='done' AND (
   EXISTS (SELECT 1 FROM idea_theme_links it WHERE it.global_id=io.global_id AND it.nodus_id=io.nodus_id AND it.theme_id=${theme})
   OR (EXISTS (SELECT 1 FROM work_themes wt WHERE wt.nodus_id=io.nodus_id AND wt.theme_id=${theme})
       AND NOT EXISTS (SELECT 1 FROM idea_theme_links l WHERE l.global_id=io.global_id AND l.nodus_id=io.nodus_id)))
 UNION SELECT it.global_id FROM idea_theme_links it WHERE it.nodus_id='manual' AND it.theme_id=${theme} AND ${manualIdeaVisible('it.global_id')}`;

/** Every theme hub of the vault: those a scan extracted and those the user curated. */
export function stellarThemes(): StellarTheme[] {
  const rows = getDb()
    .prepare(
      `WITH eligible AS (
         SELECT io.nodus_id, io.global_id FROM idea_occurrences io
         JOIN works w ON w.nodus_id=io.nodus_id
         JOIN ideas i ON i.global_id=io.global_id
         WHERE w.archived=0 AND w.deep_status='done' AND i.orphaned_at IS NULL
       ),
       membership AS (
         SELECT it.theme_id,it.global_id FROM idea_theme_links it WHERE it.nodus_id='manual' AND ${manualIdeaVisible('it.global_id')}
         UNION
         SELECT it.theme_id, it.global_id FROM idea_theme_links it
         JOIN eligible e ON e.nodus_id=it.nodus_id AND e.global_id=it.global_id
         UNION
         SELECT wt.theme_id, e.global_id FROM eligible e
         JOIN work_themes wt ON wt.nodus_id=e.nodus_id
         WHERE NOT EXISTS (SELECT 1 FROM idea_theme_links l WHERE l.nodus_id=e.nodus_id AND l.global_id=e.global_id)
       )
       SELECT t.theme_id AS id, t.label, t.pinned,
              COUNT(DISTINCT m.global_id) AS ideaCount,
              (SELECT COUNT(DISTINCT wt.nodus_id) FROM work_themes wt JOIN works w ON w.nodus_id=wt.nodus_id
                WHERE wt.theme_id=t.theme_id AND w.archived=0 AND w.deep_status='done') AS workCount
       FROM themes t LEFT JOIN membership m ON m.theme_id=t.theme_id
       GROUP BY t.theme_id
       ORDER BY ideaCount DESC, t.pinned DESC, t.label`,
    )
    .all() as { id: string; label: string; pinned: number; ideaCount: number; workCount: number }[];
  return rows.map((r) => ({
    id: r.id,
    label: r.label || r.id,
    ideaCount: r.ideaCount,
    workCount: r.workCount,
    curated: r.pinned === 1,
  }));
}
function nodes(ids: string[]): GraphNode[] {
  if (!ids.length) return [];
  const db = getDb();
  const bind = JSON.stringify(ids);
  const ideas = db
    .prepare(
      `SELECT global_id AS id,label,statement,type FROM ideas WHERE global_id IN (SELECT value FROM json_each(?)) AND orphaned_at IS NULL AND ${eligible("ideas.global_id")}`,
    )
    .all(bind) as Pick<GraphNode, "id" | "label" | "statement" | "type">[];
  const works = db
    .prepare(
      `SELECT io.global_id,w.nodus_id,w.year,w.authors_json,w.read_tag,io.confidence FROM idea_occurrences io JOIN works w ON w.nodus_id=io.nodus_id WHERE io.global_id IN (SELECT value FROM json_each(?)) AND w.archived=0 AND (w.deep_status='done' OR ${manualIdeaVisible('io.global_id')})`,
    )
    .all(bind) as {
    global_id: string;
    nodus_id: string;
    year: number;
    authors_json: string;
    read_tag: number;
    confidence: number;
  }[];
  const byId = new Map<string, typeof works>();
  for (const w of works) {
    const list = byId.get(w.global_id) ?? [];
    list.push(w);
    byId.set(w.global_id, list);
  }
  return ideas.map((i) => {
    const ws = byId.get(i.id) ?? [];
    return {
      ...i,
      label: i.label || i.statement || i.id,
      workIds: [...new Set(ws.map((w) => w.nodus_id))],
      workCount: new Set(ws.map((w) => w.nodus_id)).size,
      read: ws.every((w) => w.read_tag === 1),
      themes: [],
      years: ws.map((w) => w.year).filter(Boolean),
      authors: [
        ...new Set(
          ws.flatMap((w) => {
            try {
              return JSON.parse(w.authors_json || "[]") as string[];
            } catch {
              return [];
            }
          }),
        ),
      ],
      maxConfidence: Math.max(0, ...ws.map((w) => w.confidence)),
    };
  });
}
/**
 * The corpus, enumerated once per database state rather than once per page.
 *
 * The renderer pages the whole corpus 200 at a time (src/stellarGraph/context.ts). Each page
 * used to re-run both corpus COUNTs (the edge one pushes every visible edge through the
 * eligibility filter: ~0.5 s on a 115k-edge library) and an OFFSET query that re-filters
 * every row before the page (~0.8 s at offset 100k), for ~580 pages. The id lists only
 * change when the data does, so they are keyed on this connection's total_changes() and
 * SQLite's data_version, which moves when another connection commits.
 */
type CorpusDb = { prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }; pragma(sql: string, options: { simple: true }): unknown };
type CorpusIndex = { nodeIds: string[]; edgeIds: unknown[] };
const corpusIndexes = new WeakMap<object, { key: string; index: CorpusIndex }>();
function corpusIndex(db: CorpusDb, nodeScope: string, links: string): CorpusIndex {
  const changes = (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const key = `${changes}:${String(db.pragma("data_version", { simple: true }))}`;
  const cached = corpusIndexes.get(db);
  if (cached?.key === key) return cached.index;
  const index: CorpusIndex = {
    nodeIds: (db.prepare(`SELECT i.global_id AS id FROM ideas i WHERE ${nodeScope} ORDER BY i.global_id`).all() as { id: string }[]).map(row => row.id),
    edgeIds: (db.prepare(`SELECT e.id FROM visible_edges e WHERE ${links} ORDER BY e.id`).all() as { id: unknown }[]).map(row => row.id),
  };
  corpusIndexes.set(db, { key, index });
  return index;
}
export function stellarPage(req: StellarPageRequest): StellarPage {
  const db = getDb(),
    offset = Math.max(0, Math.floor(req.cursor || 0)),
    limit = Math.min(200, Math.max(1, Math.floor(req.limit || 200)));
  let ids: string[] = [],
    edges: GraphEdge[] = [],
    total = 0;
  if (req.kind === "elements") {
    ids = (req.nodeIds ?? []).slice(0, 200);
    edges = db
      .prepare(
        `${edgeSelect} WHERE ${edgeScope} AND e.id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify((req.edgeIds ?? []).slice(0, 200))) as GraphEdge[];
  } else if (req.kind === "neighbors") {
    const where = `${edgeScope} AND (e.from_id=? OR e.to_id=?)`;
    total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM visible_edges e WHERE ${where}`)
        .get(req.id, req.id) as { n: number }
    ).n;
    edges = db
      .prepare(
        `${edgeSelect} WHERE ${where} ORDER BY CASE WHEN verdict='confirmed' THEN 0 WHEN e.basis='explicit' THEN 1 ELSE 2 END,e.confidence DESC,e.id LIMIT ? OFFSET ?`,
      )
      .all(req.id, req.id, limit, offset) as GraphEdge[];
  } else if (req.kind === "corpus") {
    const nodeScope = `i.orphaned_at IS NULL AND ${eligible("i.global_id")}`;
    const links = `${edgeScope} AND EXISTS (SELECT 1 FROM ideas i WHERE i.global_id=e.from_id AND i.orphaned_at IS NULL) AND EXISTS (SELECT 1 FROM ideas i WHERE i.global_id=e.to_id AND i.orphaned_at IS NULL)`;
    const index = corpusIndex(db, nodeScope, links);
    ids = index.nodeIds.slice(offset, offset + limit);
    const pageEdges = index.edgeIds.slice(offset, offset + limit);
    edges = pageEdges.length
      ? db.prepare(`${edgeSelect} WHERE e.id IN (SELECT value FROM json_each(?)) ORDER BY e.id`).all(JSON.stringify(pageEdges)) as GraphEdge[]
      : [];
    total = Math.max(index.nodeIds.length, index.edgeIds.length);
  } else if (req.kind === "theme") {
    if (!req.id) return { nodes: [], edges: [], total: 0, next: null };
    // Named parameters throughout: the membership subquery binds the theme twice and
    // appears twice in the edge queries, which positional placeholders cannot line up.
    const member = themeMembers("@theme");
    const args = { theme: req.id, limit, offset };
    // Nodes and edges page independently against the same cursor, as `work` does.
    ids = (
      db
        .prepare(
          `SELECT i.global_id AS id FROM ideas i WHERE i.orphaned_at IS NULL AND ${eligible("i.global_id")} AND i.global_id IN (${member}) ORDER BY i.global_id LIMIT @limit OFFSET @offset`,
        )
        .all(args) as { id: string }[]
    ).map((r) => r.id);
    edges = db
      .prepare(
        `${edgeSelect} WHERE ${edgeScope} AND e.from_id IN (${member}) AND e.to_id IN (${member}) ORDER BY e.id LIMIT @limit OFFSET @offset`,
      )
      .all(args) as GraphEdge[];
    const n = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT i.global_id) AS n FROM ideas i WHERE i.orphaned_at IS NULL AND ${eligible("i.global_id")} AND i.global_id IN (${member})`,
        )
        .get({ theme: req.id }) as { n: number }
    ).n;
    const e = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM visible_edges e WHERE ${edgeScope} AND e.from_id IN (${member}) AND e.to_id IN (${member})`,
        )
        .get({ theme: req.id }) as { n: number }
    ).n;
    total = Math.max(n, e);
  } else if (req.kind === "work") {
    const member = `SELECT io.global_id FROM idea_occurrences io WHERE io.nodus_id=?`;
    // Page nodes and edges independently with the same cursor; both exhaust before next=null.
    ids = (
      db
        .prepare(
          `SELECT i.global_id AS id FROM ideas i WHERE i.orphaned_at IS NULL AND ${eligible("i.global_id")} AND i.global_id IN (${member}) ORDER BY i.global_id LIMIT ? OFFSET ?`,
        )
        .all(req.id, limit, offset) as { id: string }[]
    ).map((r) => r.id);
    edges = db
      .prepare(
        `${edgeSelect} WHERE ${edgeScope} AND e.from_id IN (${member}) AND e.to_id IN (${member}) ORDER BY e.id LIMIT ? OFFSET ?`,
      )
      .all(req.id, req.id, limit, offset) as GraphEdge[];
    const n = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT global_id) AS n FROM idea_occurrences WHERE nodus_id=?`,
        )
        .get(req.id) as { n: number }
    ).n;
    const e = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM visible_edges e WHERE ${edgeScope} AND e.from_id IN (${member}) AND e.to_id IN (${member})`,
        )
        .get(req.id, req.id) as { n: number }
    ).n;
    total = Math.max(n, e);
  } else {
    const query = `%${req.search || ""}%`;
    const where = `i.orphaned_at IS NULL AND ${eligible("i.global_id")} AND (i.label LIKE ? OR i.statement LIKE ?) ${req.author ? "AND EXISTS (SELECT 1 FROM idea_occurrences io JOIN works w ON w.nodus_id=io.nodus_id WHERE io.global_id=i.global_id AND w.authors_json LIKE ?)" : ""}`;
    const args: unknown[] = [query, query];
    if (req.author) args.push(`%${req.author}%`);
    total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM ideas i WHERE ${where}`)
        .get(...args) as { n: number }
    ).n;
    ids = (
      db
        .prepare(
          `SELECT i.global_id AS id FROM ideas i WHERE ${where} ORDER BY i.label,i.global_id LIMIT ? OFFSET ?`,
        )
        .all(...args, limit, offset) as { id: string }[]
    ).map((r) => r.id);
  }
  ids = [...new Set([...ids, ...edges.flatMap((e) => [e.source, e.target])])];
  return {
    nodes: nodes(ids),
    edges,
    total,
    next:
      req.kind === "elements" || offset + limit >= total
        ? null
        : offset + limit,
  };
}
export function getStellarSession(key: string) {
  const row = getDb()
    .prepare("SELECT state FROM stellar_sessions WHERE context=?")
    .get(key) as { state: string } | undefined;
  return {
    vaultId: getActiveVault().id,
    session: row ? (JSON.parse(row.state) as StellarSession) : null,
  };
}
export function saveStellarSession(
  vaultId: string,
  key: string,
  state: StellarSession,
) {
  if (getActiveVault().id !== vaultId) return;
  if (state.version !== 1) throw new Error("Unsupported canvas session");
  getDb()
    .prepare(
      "INSERT INTO stellar_sessions(context,state,updated_at) VALUES(?,?,?) ON CONFLICT(context) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at",
    )
    .run(key, JSON.stringify(state), new Date().toISOString());
}
