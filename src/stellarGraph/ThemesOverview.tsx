import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GraphData, GraphNode } from "@shared/types";
import type { StellarPosition, StellarTheme } from "@shared/stellarGraph";
import { themeName, type StellarGraphSource } from "./source";
import { sortThemes, themeConstellation } from "./themes";
import { CorpusContextProgress, CorpusContextControls, useCorpusContext } from "./CorpusContext";
import { StellarCanvas, type StellarCanvasApi } from "./StellarCanvas";
import { errorText, t, tx } from "../i18n";
import { Icon } from "../components/ui";
import { StellarSearch } from "./StellarSearch";
import { NODE_LABELS } from "./palette";

/**
 * First stop of the graph: every theme of the vault — the ones a scan extracted and the
 * ones the user curated in "Temas principales" — drawn on the same canvas, with the same
 * stars and the same label cards as the ideas they open onto. Equal nodes: what a theme
 * holds is written under its name, not encoded in its size.
 */
export function ThemesOverview({
  source,
  onOpen,
  toolbar,
  sidebar,
  initialIdeaIds,
  onIdeasChange,
  onOpenIdea,
  active,
}: {
  /** A new source identity — a reprocess, a vault change — refetches the hubs. */
  source: StellarGraphSource;
  onOpen(theme: StellarTheme): void;
  toolbar?: ReactNode;
  sidebar?: ReactNode;
  initialIdeaIds?: string[];
  onIdeasChange(ids: string[]): void;
  onOpenIdea(node: GraphNode): void;
  active: boolean;
}) {
  const [themes, setThemes] = useState<StellarTheme[] | null>(null);
  const [ideaCount, setIdeaCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [positions, setPositions] = useState<Record<string, StellarPosition>>({});
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const api = useRef<StellarCanvasApi | null>(null);
  const framed = useRef("");
  const [pinned, setPinned] = useState<GraphNode[]>([]);
  const initialIds = useRef(initialIdeaIds || []);
  useEffect(() => {
    let live = true;
    const restore = async () => {
      const nodes: GraphNode[] = [];
      const ids = [...initialIds.current];
      for (let offset = 0; offset < ids.length; offset += 200) {
        const page = await source.page({ kind: "elements", nodeIds: ids.slice(offset, offset + 200), limit: 200 });
        nodes.push(...page.nodes);
      }
      if (live) setPinned(current => {
        const byId = new Map([...current, ...nodes].map(node => [node.id, node]));
        return initialIds.current.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
      });
    };
    void restore().catch(err => live && setError(errorText(err)));
    return () => { live = false; };
  }, [source]);
  const visibleIds = useMemo(() => new Set(pinned.map(node => node.id)), [pinned]);
  const updateIdeas = (nodes: GraphNode[]) => {
    initialIds.current = nodes.map(node => node.id);
    setPinned(nodes);
    onIdeasChange(initialIds.current);
  };
  useEffect(() => {
    let live = true;
    setError("");
    setThemes(null);
    setIdeaCount(null);
    // Theme memberships overlap. The unfiltered search total counts each corpus idea once.
    void Promise.all([source.themes!(), source.page({ kind: "search", limit: 1 })])
      .then(([list, page]) => {
        if (!live) return;
        setThemes(list);
        setIdeaCount(page.total);
      })
      .catch((err) => live && (setError(errorText(err)), setThemes([])));
    return () => {
      live = false;
    };
  }, [source]);

  const sorted = useMemo(() => sortThemes(themes || []), [themes]);
  const needle = query.trim().toLocaleLowerCase();
  const shown = useMemo(
    () => (needle ? sorted.filter((theme) => themeName(theme).toLocaleLowerCase().includes(needle)) : sorted),
    [sorted, needle],
  );

  // A theme is a node like any other: the canvas draws it, we only say what it is.
  const data = useMemo<GraphData>(
    () => ({
      nodes: [...shown.map<GraphNode>((theme) => ({
        id: theme.id,
        label: themeName(theme) || theme.id,
        type: "theme",
        statement: tx("{n} ideas en este tema", { n: theme.ideaCount.toLocaleString() }),
        workCount: theme.workCount,
        workIds: [],
        read: false,
        themes: [],
        years: [],
        authors: [],
        maxConfidence: 1,
      })), ...pinned],
      edges: [],
    }),
    [shown, pinned],
  );
  const corpusContext = useCorpusContext(source, data, positions, active);
  const byId = useMemo(() => new Map(shown.map((theme) => [theme.id, theme])), [shown]);

  // The rings are decided by the themes on screen, so filtering re-forms the constellation.
  const signature = shown.map((theme) => theme.id).join("|");
  useEffect(() => {
    setPositions(current => ({ ...current, ...themeConstellation(shown) }));
    framed.current = "";
  }, [signature]);
  useEffect(() => {
    // Add near the current viewport, keeping the existing constellation and camera still.
    setPositions(current => {
      const next = { ...current };
      for (const node of pinned) {
        if (next[node.id]) continue;
        let point = { x: camera.x, y: camera.y - 30 / camera.zoom };
        for (let i = 1; i <= 1000; i++) {
          if (Object.values(next).every(p => Math.abs(p.x - point.x) * camera.zoom > 245 || Math.abs(p.y - point.y) * camera.zoom > 95)) break;
          const angle = i * 2.399963, radius = 70 * Math.sqrt(i) / camera.zoom;
          point = { x: camera.x + Math.cos(angle) * radius, y: camera.y + Math.sin(angle) * radius * 0.6 };
        }
        next[node.id] = point;
      }
      return next;
    });
  }, [pinned]);
  useEffect(() => {
    if (!data.nodes.length || framed.current === signature) return;
    if (!data.nodes.every((node) => positions[node.id])) return;
    framed.current = signature;
    // Centre the themes at full size rather than fitting them: zoomed out, a node shrinks
    // to a speck and stops looking like the graph node it is. "Fit all" is one click away.
    const points = data.nodes.map((node) => positions[node.id]);
    setCamera({
      x: Math.round((Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2),
      // Centre what is seen, not what is placed: a label hangs below its node, so the
      // constellation's visual mass sits lower than the nodes it is made of.
      y: Math.round((Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2) + 30,
      zoom: 1,
    });
  }, [data, positions, signature]);
  const bindApi = useCallback((value: StellarCanvasApi | null) => {
    api.current = value;
  }, []);

  return (
    <div className="stellar-workspace stellar-themes" data-testid="stellar-themes" data-theme-count={sorted.length}>
      <header className="stellar-header">
        <div className="stellar-heading">
          <span className="stellar-eyebrow">NODUS / {t("TEMAS")}</span>
          <h2>{t("Los temas de tu corpus. Entra en uno para ver su red.")}</h2>
        </div>
        <div className="stellar-header-actions">
          {toolbar}
          <StellarSearch source={source} disabled={false} visibleIds={visibleIds}
            onChoose={node => { if (!visibleIds.has(node.id)) updateIdeas([...pinned, node]); }}
            onRemove={id => {
              updateIdeas(pinned.filter(node => node.id !== id));
              setPositions(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
            }} />
          <div className="stellar-search">
            <div className="stellar-search-field">
              <Icon name="search" size={14} />
              <input
                className="stellar-themes-filter"
                type="search"
                value={query}
                placeholder={t("Filtrar temas…")}
                aria-label={t("Filtrar temas")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
        </div>
      </header>
      <div className="stellar-body">
        <div className="stellar-stage">
          {active && <StellarCanvas
            data={data}
            context={corpusContext.layer}
            onContextNode={node => { if (!visibleIds.has(node.id)) updateIdeas([...pinned, node]); }}
            positions={positions}
            camera={camera}
            onPositions={setPositions}
            onCamera={setCamera}
            onApi={bindApi}
            onNode={(id) => {
              const theme = byId.get(id);
              if (theme) onOpen(theme);
              else {
                const node = pinned.find(item => item.id === id);
                if (node) onOpenIdea(node);
              }
            }}
            onEdge={() => {}}
            labelPolicy="all"
            nodeMeta={(node) => {
              if (node.type !== "theme") return `${t(NODE_LABELS[node.type] || node.type)} · ${node.workCount} ${t(node.workCount === 1 ? "fuente" : "fuentes")}`;
              const count = byId.get(node.id)?.ideaCount ?? 0;
              return `${t("Tema")} · ${count.toLocaleString()} ${t(count === 1 ? "idea" : "ideas")}`;
            }}
          />}
          <CorpusContextProgress context={corpusContext} />
          <div className="stellar-meta">
            <span className="stellar-live-dot" />
            {themes === null
              ? t("Reuniendo los temas…")
              : `${sorted.length.toLocaleString()} ${t(sorted.length === 1 ? "tema" : "temas")}`}
            {ideaCount !== null && ` · ${tx("{n} ideas únicas en el corpus", { n: ideaCount.toLocaleString() })}`}
          </div>
          <div className="stellar-navigation">
            <CorpusContextControls context={corpusContext} onFit={() => api.current?.fitContext()} />
            <button aria-label={t("Alejar")} title={t("Alejar")} onClick={() => api.current?.zoom(1 / 1.55)}>
              −
            </button>
            <button aria-label={t("Acercar")} title={t("Acercar")} onClick={() => api.current?.zoom(1.55)}>
              +
            </button>
            <button onClick={() => api.current?.fit()}>{t("Encuadrar")}</button>
          </div>
          {error && (
            <div className="stellar-error" role="alert">
              {error}
            </div>
          )}
          {themes !== null && !sorted.length && !pinned.length && !error && (
            <div className="stellar-empty stellar-empty-hint">
              {t("Todavía no hay temas. Analiza obras o añade los tuyos en Herramientas › Temas.")}
            </div>
          )}
          {themes !== null && !!sorted.length && !shown.length && (
            <div className="stellar-empty stellar-empty-hint">{t("Ningún tema coincide con el filtro.")}</div>
          )}
        </div>
        {sidebar}
      </div>
    </div>
  );
}
