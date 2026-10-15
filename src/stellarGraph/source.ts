import type { GraphData, IdeaDetail, EdgeDetail } from "@shared/types";
import type {
  StellarPage,
  StellarPageRequest,
  StellarSession,
  StellarTheme,
} from "@shared/stellarGraph";
import type { KnowledgeViewSource } from "../views/knowledgeViewSource";
export interface StellarGraphSource {
  key: string;
  readOnly?: boolean;
  page(request: StellarPageRequest): Promise<StellarPage>;
  /** Theme hubs for the first tab. A source without themes keeps a blank first canvas. */
  themes?(): Promise<StellarTheme[]>;
  idea?(id: string): Promise<IdeaDetail | null>;
  edge?(id: string): Promise<EdgeDetail | null>;
  restore?(): Promise<StellarSession | null>;
  save?(state: StellarSession): Promise<void>;
  /** Drop derived data after the linked corpus changes, keeping the source identity. */
  invalidate?(): void;
}
export function cleanGraph(data: GraphData): GraphData {
  const nodes = data.nodes.filter(
    (n) => n.type !== "theme" && n.type !== "author",
  );
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: data.edges.filter(
      (e) => e.verdict !== "rejected" && ids.has(e.source) && ids.has(e.target),
    ),
  };
}
export function memorySource(
  key: string,
  get: () => Promise<GraphData>,
): StellarGraphSource {
  let cached: Promise<GraphData> | undefined;
  const graphData = () => {
    if (!cached) {
      const pending = get().then(cleanGraph);
      cached = pending;
      void pending.catch(() => { if (cached === pending) cached = undefined; });
    }
    return cached;
  };
  return {
    key,
    invalidate() { cached = undefined; },
    async page(req) {
      const graph = await graphData();
      let ns = graph.nodes,
        es = graph.edges;
      if (req.kind === "search") {
        const q = (req.search || "").toLocaleLowerCase();
        ns = ns.filter((n) =>
          `${n.label} ${n.statement || ""} ${n.themes.join(" ")}`
            .toLocaleLowerCase()
            .includes(q),
        );
        if (req.author) ns = ns.filter(n => n.authors.some(author => author.toLocaleLowerCase().includes(req.author!.toLocaleLowerCase())));
        es = [];
      }
      if (req.kind === "neighbors") {
        es = es
          .filter((e) => e.source === req.id || e.target === req.id)
          .sort(compareEdges);
        ns = [];
      }
      if (req.kind === "theme") {
        // Memory sources have no theme table: the label a node carries is its identity.
        ns = ns.filter((n) => n.themes.includes(req.id!));
        const ids = new Set(ns.map((n) => n.id));
        es = es.filter((e) => ids.has(e.source) && ids.has(e.target));
      }
      if (req.kind === "work") {
        ns = ns.filter((n) => n.workIds?.includes(req.id!));
        const ids = new Set(ns.map((n) => n.id));
        es = es.filter((e) => ids.has(e.source) && ids.has(e.target));
      }
      if (req.kind === "elements") {
        ns = ns.filter((n) => req.nodeIds?.includes(n.id));
        es = es.filter((e) => req.edgeIds?.includes(e.id));
      }
      const offset = req.cursor || 0,
        limit = Math.min(req.limit || 200, 200),
        total = Math.max(ns.length, es.length);
      ns = ns.slice(offset, offset + limit);
      es = es.slice(offset, offset + limit);
      const ids = new Set([
        ...ns.map((n) => n.id),
        ...es.flatMap((e) => [e.source, e.target]),
      ]);
      return {
        nodes: graph.nodes.filter((n) => ids.has(n.id)),
        edges: es,
        total,
        next: offset + limit < total ? offset + limit : null,
      };
    },
    async themes() {
      const graph = await graphData();
      const counts = new Map<string, number>();
      const works = new Map<string, Set<string>>();
      for (const node of graph.nodes)
        for (const label of new Set(node.themes)) {
          counts.set(label, (counts.get(label) ?? 0) + 1);
          const ws = works.get(label) ?? new Set<string>();
          for (const id of node.workIds ?? []) ws.add(id);
          works.set(label, ws);
        }
      return [...counts]
        .map(([label, ideaCount]) => ({
          id: label,
          label,
          ideaCount,
          workCount: works.get(label)?.size ?? 0,
          curated: false,
        }))
        // Theme labels come from the vault and can be missing in imported data.
        .sort((a, b) => b.ideaCount - a.ideaCount || themeName(a).localeCompare(themeName(b)));
    },
  };
}
/** A theme label safe to sort and match on, whatever the payload holds. */
export const themeName = (theme: { label?: string | null }) => String(theme.label ?? "");
export function compareEdges(
  a: GraphData["edges"][number],
  b: GraphData["edges"][number],
) {
  const rank = (e: typeof a) =>
    e.verdict === "confirmed" ? 0 : e.basis === "explicit" ? 1 : 2;
  return (
    rank(a) - rank(b) || b.confidence - a.confidence || a.id.localeCompare(b.id)
  );
}
export function desktopSource(
  source: KnowledgeViewSource,
  context: string,
): StellarGraphSource {
  let vaultId = "";
  const adapter =
    source.key === "academic"
      ? {
          key: context,
          page: (r: StellarPageRequest) => window.nodus.stellarPage(r),
          themes: () => window.nodus.stellarThemes(),
        }
      : memorySource(context, () => source.getGraph("ideas"));
  return {
    ...adapter,
    idea: source.getIdeaDetail,
    edge: source.getEdgeDetail,
    async restore() {
      const saved = await window.nodus.getStellarSession(context);
      vaultId = saved.vaultId;
      return saved.session;
    },
    async save(state) {
      if (vaultId)
        await window.nodus.saveStellarSession(vaultId, context, state);
    },
  };
}

/** Work graphs keep their scope, but load no visible topology until the user chooses an idea. */
export function workScopedSource(source: StellarGraphSource, workId: string): StellarGraphSource {
  const scoped = memorySource(`${source.key}:work:${workId}`, async () => {
    const nodes = new Map<string, GraphData["nodes"][number]>();
    const edges = new Map<string, GraphData["edges"][number]>();
    let cursor: number | null = 0;
    do {
      const page = await source.page({ kind: "work", id: workId, cursor });
      page.nodes.forEach(node => nodes.set(node.id, node));
      page.edges.forEach(edge => edges.set(edge.id, edge));
      cursor = page.next;
    } while (cursor !== null);
    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  });
  return { ...source, ...scoped, themes: undefined,
    invalidate() { source.invalidate?.(); scoped.invalidate?.(); } };
}
