import {
  useCallback,
  useId,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { openEvidenceAtPage } from '../evidenceJump';
import type { GraphData, GraphNode, IdeaDetail, EdgeDetail } from "@shared/types";
import type { StellarSession, StellarPosition, StellarTheme } from "@shared/stellarGraph";
import {
  NodeDetailPanel,
  type DetailLoading,
} from "../components/NodeDetailPanel";
import { StellarProgress } from "./StellarProgress";
import { CorpusContextProgress, CorpusContextControls, useCorpusContext } from "./CorpusContext";
import { StellarCanvas, ZOOM_STEP, type StellarCanvasApi } from "./StellarCanvas";
import { Exploration } from "./exploration";
import { workScopedSource, type StellarGraphSource } from "./source";
import { StellarSearch } from "./StellarSearch";
import { STELLAR_LAYOUT_VERSION } from "./layout";
import { relation, relationColor, RELATIONS } from "./palette";
import { ThemesOverview } from "./ThemesOverview";
import { capRelations, neighbourhood } from "./themes";
import { errorText, t, tx } from "../i18n";
import { Icon } from "../components/ui";
import type { StellarGraphTabDescriptor, StellarTabSnapshot, StellarWorkspaceSnapshot } from "./snapshot";
const EMPTY: GraphData = { nodes: [], edges: [] };
/** A node label is ~230px wide; below this much room between ideas they overlap and hide. */
const LABEL_ROOM = 250;
/**
 * Zoom at which a theme actually reads. The layout's scale is arbitrary — only how far
 * apart neighbouring ideas end up matters — so measure the typical gap on a sample and
 * open close enough for labels to fit beside their node.
 */
function readableZoom(
  nodes: GraphData["nodes"],
  positions: Record<string, StellarPosition>,
) {
  // Stride across the whole graph: consecutive ids come from the same work and land in
  // the same cluster, so the first N nodes would measure a clump, not the layout.
  const stride = Math.max(1, Math.floor(nodes.length / 300));
  const sample = nodes.filter((_, i) => i % stride === 0).flatMap(node => positions[node.id] ? [positions[node.id]] : []);
  if (sample.length < 8) return 1;
  const gaps = sample.map(point => {
    let best = Infinity;
    for (const other of sample) {
      if (other === point) continue;
      best = Math.min(best, Math.hypot(point.x - other.x, point.y - other.y));
    }
    return best;
  }).filter(Number.isFinite).sort((a, b) => a - b);
  // A sample is sparser than the whole graph, and nearest-neighbour distance grows as
  // 1/√density, so scale the measurement back to what the full layout actually looks like.
  const density = Math.sqrt(sample.length / Math.max(sample.length, nodes.length));
  const typical = (gaps[Math.floor(gaps.length / 2)] || LABEL_ROOM) * density;
  // Never closer than "a handful of ideas on screen": past that you are reading one node.
  return Math.max(0.6, Math.min(1.15, LABEL_ROOM / typical));
}
/** A whole theme at once is unreadable: start with the strongest few relations per idea. */
const DEFAULT_CHILD_LIMIT = 6;
/** Open the entire theme; neighbourhood exploration is an explicit choice. */
const DEFAULT_DEPTH = 0;
/** Past this many ideas the spiral packing stops reading and the force layout takes over. */
const FORCE_LAYOUT_FROM = 300;
export interface StellarWorkspaceProps {
  source: StellarGraphSource;
  workId?: string;
  initialSeed?: string;
  initialEdge?: string;
  initialSearch?: string;
  navigationKey?: number;
  snapshot?: StellarWorkspaceSnapshot;
  onSnapshotChange?(snapshot: StellarWorkspaceSnapshot): void;
  author?: string;
  title?: string;
  toolbar?: ReactNode;
  /** Optional right-hand panel occupying the same layout slot as idea details. */
  sidebar?: ReactNode;
  onOpenIdea?(id: string): void;
  onEditIdea?(id: string): void;
  openEvidence?(ref: string, location: string | null, quote?: string): void;
  saveIdea?(detail: IdeaDetail): Promise<void>;
  saveEdge?(detail: EdgeDetail): Promise<void>;
  audit?: boolean;
  baseline?: boolean;
  /** Native mobile hosts own the app chrome instead of the browser fullscreen API. */
  onFullscreenChange?(fullscreen: boolean): Promise<void>;
}
export function StellarWorkspace(props: StellarWorkspaceProps) {
  return <StellarTabs key={`${props.source.key}:${props.workId || "corpus"}`} {...props} />;
}

function StellarTabs(props: StellarWorkspaceProps) {
  const source = useMemo(() => props.workId ? workScopedSource(props.source, props.workId) : props.source, [props.source, props.workId]);
  const scope = `${props.source.key}:${props.workId || "corpus"}`;
  const [saved] = useState(() => props.snapshot?.scope === scope ? props.snapshot : undefined);
  const { initialSeed, initialEdge, initialSearch, author, navigationKey } = props;
  const themed = !!source.themes;
  const targeted = !!(initialSeed || initialEdge || initialSearch || author);
  const [tabs, setTabs] = useState<StellarGraphTabDescriptor[]>(
    saved?.tabs || (themed
      ? [{ id: 1, label: "", mode: "themes" }, ...(targeted ? [{ id: 2, label: "", initialSeed, initialEdge, initialSearch, author }] : [])]
      : [{ id: 1, label: "", initialSeed, initialEdge, initialSearch, author }]),
  );
  const [active, setActive] = useState(saved?.active || (themed && targeted ? 2 : 1));
  const nextId = useRef(saved?.nextId || (themed && targeted ? 3 : 2));
  const targetKey = JSON.stringify([initialSeed, initialEdge, initialSearch, author, navigationKey]);
  const lastTarget = useRef(saved?.targetKey || targetKey);
  const tabStates = useRef<Record<number, StellarTabSnapshot>>({ ...saved?.states });
  const snapshotCallback = useRef(props.onSnapshotChange);
  snapshotCallback.current = props.onSnapshotChange;
  const currentSnapshot = useRef({ tabs, active, scope });
  currentSnapshot.current = { tabs, active, scope };
  const publishSnapshot = useCallback(() => {
    const current = currentSnapshot.current;
    snapshotCallback.current?.({ ...current, targetKey: lastTarget.current, nextId: nextId.current,
      states: Object.fromEntries(current.tabs.flatMap(tab => tabStates.current[tab.id] ? [[tab.id, tabStates.current[tab.id]]] : [])) });
  }, []);
  useEffect(() => {
    if (targetKey === lastTarget.current) return;
    lastTarget.current = targetKey;
    if (!initialSeed && !initialEdge && !initialSearch && !author) return;
    const id = nextId.current++;
    setTabs(current => [...current, { id, label: "", initialSeed, initialEdge, initialSearch, author }]);
    setActive(id);
  }, [targetKey, initialSeed, initialEdge, initialSearch, author]);
  useEffect(publishSnapshot, [tabs, active, publishSnapshot]);
  const tabsId = useId();
  const host = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === host.current);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.fullscreenElement !== host.current) return;
      event.preventDefault(); event.stopPropagation();
      void document.exitFullscreen().catch(() => setFullscreenError(true));
    };
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("fullscreenchange", update); document.removeEventListener("keydown", escape, true); };
  }, []);
  const toggleFullscreen = async () => {
    setFullscreenError(false);
    try {
      if (props.onFullscreenChange) { await props.onFullscreenChange(!fullscreen); setFullscreen(!fullscreen); return; }
      if (document.fullscreenElement === host.current) await document.exitFullscreen();
      else await host.current?.requestFullscreen();
    } catch { setFullscreenError(true); }
  };
  const addTab = () => {
    const id = nextId.current++;
    setTabs(current => [...current, { id, label: "" }]);
    setActive(id);
  };
  const openTheme = (theme: StellarTheme) => {
    const id = nextId.current++;
    setTabs(current => [...current, { id, themeId: theme.id, themeLabel: theme.label, label: theme.label }]);
    setActive(id);
  };
  /** A saved canvas belongs to the theme it was captured in, never to the next one. */
  const restoredState = (tab: StellarGraphTabDescriptor) =>
    saved?.tabs.find(item => item.id === tab.id)?.themeId === tab.themeId
      ? saved?.states[tab.id]
      : undefined;
  const tabName = (tab: StellarGraphTabDescriptor) =>
    tab.label || (tab.mode === "themes" ? t("Temas") : tx("Grafo {n}", { n: tab.id }));
  const closeTab = (id: number) => {
    if (id === tabs[0]?.id || !tabs.some(tab => tab.id === id)) return;
    delete tabStates.current[id];
    const index = tabs.findIndex(tab => tab.id === id);
    const remaining = tabs.filter(tab => tab.id !== id);
    setTabs(remaining);
    if (active === id) setActive(remaining[Math.min(index, remaining.length - 1)].id);
  };
  return <div className="stellar-tabs-workspace" ref={host} data-testid="stellar-tabs-workspace">
    <div className="stellar-tabs-header">
      <div className="stellar-tabs" role="tablist" aria-label={t("Grafos abiertos")}>
        {tabs.map(tab => <div className={`stellar-tab ${active === tab.id ? "active" : ""}`} key={tab.id}>
          <button role="tab" id={`${tabsId}-tab-${tab.id}`} aria-controls={`${tabsId}-panel-${tab.id}`} aria-selected={active === tab.id}
            tabIndex={active === tab.id ? 0 : -1} onClick={() => setActive(tab.id)} onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = tabs.findIndex(item => item.id === tab.id);
              const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              setActive(tabs[next].id); document.getElementById(`${tabsId}-tab-${tabs[next].id}`)?.focus();
            }} title={tabName(tab)}><Icon name={tab.mode === "themes" ? "layers" : "map"} size={14} /><span>{tabName(tab)}</span></button>
          {tab.id !== tabs[0].id && <button className="stellar-tab-close" aria-label={tx("Cerrar grafo {n}", { n: tab.id })} onClick={() => closeTab(tab.id)}>×</button>}
        </div>)}
      </div>
      <button className="stellar-new-tab" onClick={addTab} title={t("Nuevo grafo")} aria-label={t("Nuevo grafo")}><Icon name="plus" size={18} /></button>
      <button className="stellar-fullscreen" onClick={() => void toggleFullscreen()} aria-pressed={fullscreen} title={t(fullscreen ? "Salir de pantalla completa" : "Pantalla completa")}>
        <Icon name={fullscreen ? "minimize" : "maximize"} size={15} />{t(fullscreen ? "Salir de pantalla completa" : "Pantalla completa")}
      </button>
    </div>
    {fullscreenError && <p role="alert">{t("No se pudo activar la pantalla completa.")}</p>}
    {tabs.map(tab => <div key={tab.id} role="tabpanel" id={`${tabsId}-panel-${tab.id}`} aria-labelledby={`${tabsId}-tab-${tab.id}`} className={active === tab.id ? "stellar-tab-panel" : "hidden"}>
      {tab.mode === "themes" && <div className="stellar-hub-panel">
        <ThemesOverview source={source} toolbar={props.toolbar} sidebar={active === tab.id ? props.sidebar : undefined} initialIdeaIds={tab.hubIdeaIds} active={active === tab.id}
          onIdeasChange={hubIdeaIds => setTabs(current => current.map(item => item.id === tab.id ? { ...item, hubIdeaIds } : item))}
          onOpenIdea={node => {
            const id = nextId.current++;
            setTabs(current => [...current, { id, label: node.label, initialSeed: node.id }]);
            setActive(id);
          }} onOpen={openTheme} />
      </div>}
      {tab.mode !== "themes" && <StellarGraphTab {...props} key={tab.themeId || "canvas"} source={source} active={active === tab.id}
            initialSeed={tab.initialSeed} initialEdge={tab.initialEdge}
            initialSearch={tab.initialSearch} author={tab.author}
            themeId={tab.themeId} themeLabel={tab.themeLabel}
            onBack={tab.themeId ? () => setActive(tabs[0].id) : undefined}
            initialState={restoredState(tab)}
            onTabSnapshot={state => { tabStates.current[tab.id] = state; publishSnapshot(); }}
            onTitleChange={label => setTabs(current => current.map(item => item.id === tab.id ? { ...item, label: item.themeLabel || label } : item))} />}
    </div>)}
  </div>;
}

function StellarGraphTab({
  source,
  workId,
  initialSeed,
  initialEdge,
  initialSearch,
  author,
  themeId,
  themeLabel,
  onBack,
  title,
  toolbar,
  sidebar,
  onOpenIdea,
  onEditIdea,
  openEvidence,
  saveIdea,
  saveEdge,
  audit,
  active,
  onTitleChange,
  initialState,
  onTabSnapshot,
}: StellarWorkspaceProps & {
  active: boolean;
  /** Theme this tab has drilled into: its ideas load as the visible baseline. */
  themeId?: string;
  themeLabel?: string;
  onBack?(): void;
  onTitleChange(label: string): void;
  initialState?: StellarTabSnapshot;
  onTabSnapshot(state: StellarTabSnapshot): void;
}) {
  const [engine, setEngine] = useState<Exploration | null>(null),
    [data, setData] = useState<GraphData>(EMPTY);
  const [positions, setPositions] = useState<Record<string, StellarPosition>>(
      {},
    ),
    [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [limit, setLimit] = useState(25),
    [speed, setSpeed] = useState(1),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [animating, setAnimating] = useState(false),
    [showSources, setShowSources] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [activeEdge, setActiveEdge] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [idea, setIdea] = useState<IdeaDetail | null>(null),
    [edge, setEdge] = useState<EdgeDetail | null>(null),
    [detailLoading, setDetailLoading] = useState<DetailLoading | null>(null);
  const [playbackNotice, setPlaybackNotice] = useState("");
  const [childLimit, setChildLimit] = useState(initialState?.childLimit ?? DEFAULT_CHILD_LIMIT);
  const [customChildLimit, setCustomChildLimit] = useState(
    ![0, 3, 6, 10].includes(initialState?.childLimit ?? DEFAULT_CHILD_LIMIT),
  );
  const [depth, setDepth] = useState(initialState?.depth ?? DEFAULT_DEPTH);
  const [focal, setFocal] = useState<string | null>(null);
  const framedFocal = useRef<string | null>(null);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [layoutProgress, setLayoutProgress] = useState(1);
  const [focusRequest, setFocusRequest] = useState(0);
  const [width, setWidth] = useState(390),
    [font, setFont] = useState(14),
    [follow, setFollow] = useState(true),
    [reload, setReload] = useState(0);
  const selectionEpoch = useRef(0);
  const titleCallback = useRef(onTitleChange);
  titleCallback.current = onTitleChange;
  const tabSnapshotCallback = useRef(onTabSnapshot);
  tabSnapshotCallback.current = onTabSnapshot;
  const [searchQuery, setSearchQuery] = useState(initialState?.search ?? initialSearch ?? "");
  const api = useRef<StellarCanvasApi | null>(null),
    detailSeq = useRef(0),
    life = useRef(0),
    stepping = useRef(false),
    count = useRef(0),
    fitOnce = useRef(false),
    latestSession = useRef<StellarSession | null>(initialState?.session || null),
    ready = useRef(false);
  const bindApi = useCallback((value: StellarCanvasApi | null) => {
    api.current = value;
  }, []);
  const frameStep = useCallback((id: string | null) => {
    setActiveEdge(id);
    setFollow(true);
    // Transport intent must reframe even when the relation has not changed.
    setFocusRequest(value => value + 1);
  }, []);
  const manualCamera = useCallback(() => {
    setFollow(false);
    setPlaying(false);
    setAnimating(false);
    engine?.interrupt();
  }, [engine]);
  useEffect(() => {
    const generation = ++life.current;
    ready.current = false;
    setLoading(true);
    setBusy(false);
    stepping.current = false;
    setPlaying(false);
    setEngine(null);
    setData(EMPTY);
    setError("");
    setPositions({});
    setActiveEdge(null);
    setFocusRequest(0);
    setProgress({ loaded: 0, total: 0 });
    setLayoutProgress(1);
    fitOnce.current = false;
    const e = new Exploration(source);
    void (async () => {
      const saved = latestSession.current;
      if (generation !== life.current) return;
      if (saved?.version === 1) {
        await e.restore(saved);
        if (generation !== life.current) return;
        setPositions(saved.positions || {});
        setCamera(saved.camera);
        setLimit(saved.limit);
        setSpeed(saved.speed);
        fitOnce.current = true;
      }
      if (themeId) {
        // Restored sessions keep only node ids, so the theme's relations are reloaded too.
        await e.baseline(themeId, "theme", (loaded, total) => {
          if (generation === life.current) setProgress({ loaded, total });
        });
        if (generation !== life.current) return;
        fitOnce.current = !!saved;
      }
      if (initialSeed && !saved) {
        e.ingest(
          await source.page({ kind: "elements", nodeIds: [initialSeed] }),
        );
        await e.add(initialSeed, 25);
      }
      if (initialEdge && !saved) {
        const page = await source.page({
          kind: "elements",
          edgeIds: [initialEdge],
        });
        e.ingest(page);
        for (const n of page.nodes)
          if (!e.seeds.includes(n.id)) e.seeds.push(n.id);
        for (const edge of page.edges)
          if (!e.history.includes(edge.id)) e.history.push(edge.id);
        e.cursor = e.history.length;
      }
      if (generation !== life.current) return;
      setEngine(e);
      setData(e.visible());
      if (themeId) titleCallback.current(themeLabel || "");
      else if (initialSeed && !saved) titleCallback.current(e.nodes.get(initialSeed)?.label || "");
      ready.current = true;
      setLoading(false);
    })().catch((err) => {
      if (generation === life.current) {
        setError(errorText(err));
        setLoading(false);
      }
    });
    return () => {
      e.cancel();
      life.current++;
      ready.current = false;
    };
  }, [source, workId, themeId, themeLabel, initialSeed, initialEdge, reload]);
  useEffect(() => {
    if (!engine || !ready.current) return;
    const state: StellarSession = {
      version: 1,
      layoutVersion: STELLAR_LAYOUT_VERSION,
      seeds: [...engine.seeds],
      pinnedNodes: [...engine.baselineNodes],
      removedNodes: [...engine.removedNodes],
      history: [...engine.history],
      cursor: engine.cursor,
      activeSeed: engine.activeSeed,
      positions,
      camera,
      limit,
      speed,
    };
    latestSession.current = state;
    tabSnapshotCallback.current({ session: state, search: searchQuery, childLimit, depth });
  }, [engine, data, positions, camera, limit, speed, searchQuery, childLimit, depth]);
  useEffect(() => {
    if (!active) {
      engine?.interrupt();
      setPlaying(false);
      setAnimating(false);
    }
  }, [active, engine]);
  useEffect(() => {
    if (
      !fitOnce.current &&
      data.nodes.length &&
      data.nodes.every((n) => positions[n.id])
    ) {
      if (themeId && layoutProgress < 1) return;
      // Whole-theme mode fits every idea; a neighbourhood opens around its focus.
      if (themeId && depth) {
        fitOnce.current = true;
        const degree = new Map<string, number>();
        for (const edge of data.edges)
          for (const end of [edge.source, edge.target])
            degree.set(end, (degree.get(end) || 0) + 1);
        const busiest = data.nodes.reduce((best, node) =>
          (degree.get(node.id) || 0) > (degree.get(best.id) || 0) ? node : best, data.nodes[0]);
        api.current?.focus(busiest.id, readableZoom(data.nodes, positions));
        return;
      }
      fitOnce.current = true;
      if (!follow || !focusRequest) api.current?.fit();
    }
  }, [positions, data, follow, focusRequest, themeId, depth, layoutProgress]);
  const next = useCallback(async () => {
    if (!engine || stepping.current) return;
    stepping.current = true;
    setPlaybackNotice("");
    setBusy(true);
    const generation = life.current,
      selection = selectionEpoch.current;
    try {
      const e = await engine.next();
      if (generation !== life.current) return;
      setData(engine.visible());
      if (e === undefined) {
        setPlaying(false);
        return;
      }
      if (!e) {
        setPlaying(false);
        frameStep(engine.history[engine.cursor - 1] || null);
        setPlaybackNotice(t("Fin del recorrido"));
        setMessage(t("Has llegado al final de las conexiones disponibles."));
        return;
      }
      if (selection === selectionEpoch.current) {
        frameStep(e.id);
        setAnimating(true);
      }
      setMessage(
        `${engine.nodes.get(e.source)?.label} → ${t(relation(e.type).label)} → ${engine.nodes.get(e.target)?.label} · ${t(e.verdict === "confirmed" ? "Confirmada" : e.basis === "explicit" ? "Extraída de la fuente · Sin validar" : "Inferida · Sin validar")}`,
      );
      count.current++;
      if (limit > 0 && count.current >= limit) {
        setPlaying(false);
        setPlaybackNotice(t("Límite alcanzado"));
        setMessage(
          t(
            "Límite alcanzado. Puedes continuar con Siguiente o iniciar otra reproducción.",
          ),
        );
      }
    } catch (err) {
      setError(errorText(err));
      setPlaying(false);
    } finally {
      if (generation === life.current) { stepping.current = false; setBusy(false); }
    }
  }, [engine, limit, frameStep]);
  useEffect(() => {
    if (!animating) return;
    const timer = setTimeout(() => setAnimating(false), 1700);
    return () => clearTimeout(timer);
  }, [animating, activeEdge]);
  useEffect(() => {
    if (!playing || busy) return;
    const timer = setTimeout(() => void next(), 3500 / speed);
    return () => clearTimeout(timer);
  }, [playing, busy, next, speed, data]);
  const closeDetail = () => {
    selectionEpoch.current++;
    engine?.interrupt();
    detailSeq.current++;
    setPlaying(false);
    setAnimating(false);
    setFollow(false);
    setActiveEdge(null);
    setShowSources(false);
    setMessage("");
    setSelected(null);
    setIdea(null);
    setEdge(null);
    setDetailLoading(null);
  };
  const openNode = useCallback(
    (id: string) => {
      if (!engine) return;
      selectionEpoch.current++;
      engine.interrupt();
      setPlaying(false);
      setAnimating(false);
      setSelected(id);
      if (themeId) setFocal(id);
      setFollow(false);
      setActiveEdge(null);
      setEdge(null);
      setIdea(null);
      const n = engine.nodes.get(id);
      const seq = ++detailSeq.current;
      if (!source.idea) {
        onOpenIdea?.(id);
        return;
      }
      setDetailLoading({
        kind: "idea",
        id,
        label: n?.label || id,
        type: n?.type,
      });
      void source
        .idea(id)
        .then((d) => {
          if (seq === detailSeq.current) {
            setIdea(d);
            setDetailLoading(null);
          }
        })
        .catch((err) => {
          if (seq === detailSeq.current) {
            setError(errorText(err));
            setDetailLoading(null);
          }
        });
    },
    [engine, source, onOpenIdea, themeId],
  );
  const openEdge = (id: string) => {
    selectionEpoch.current++;
    engine?.interrupt();
    setPlaying(false);
    setAnimating(false);
    setSelected(null);
    setIdea(null);
    setEdge(null);
    frameStep(id);
    const seq = ++detailSeq.current,
      e = engine?.edges.get(id);
    setMessage(
      e
        ? `${engine?.nodes.get(e.source)?.label} · ${t(relation(e.type).label)} → ${engine?.nodes.get(e.target)?.label}`
        : "",
    );
    if (!source.edge) return;
    setDetailLoading({ kind: "edge", id, label: e?.type || id });
    void source
      .edge(id)
      .then((d) => {
        if (seq === detailSeq.current) {
          setEdge(d);
          setDetailLoading(null);
        }
      })
      .catch((err) => {
        if (seq === detailSeq.current) {
          setError(errorText(err));
          setDetailLoading(null);
        }
      });
  };
  const start = async (id: string, node?: GraphNode) => {
    if (!engine || stepping.current) return;
    const generation = life.current;
    stepping.current = true;
    setBusy(true); setError(""); setPlaying(false); setAnimating(false);
    setActiveEdge(null); setFollow(false); setPlaybackNotice("");
    if (node) engine.ingest({ nodes: [node], edges: [] });
    try {
      const found = await engine.add(id, limit);
      if (generation !== life.current || found === undefined) return;
      fitOnce.current = false;
      count.current = 0;
      setData(engine.visible());
      onTitleChange(engine.nodes.get(id)?.label || "");
      setMessage(tx("{n} conexiones directas cargadas. Añade otra idea con +.", { n: found }));
    } catch (err) {
      if (generation === life.current) setError(errorText(err));
    } finally {
      if (generation === life.current) { stepping.current = false; setBusy(false); }
    }
  };
  const clearCanvas = () => {
    life.current++; engine?.clear();
    stepping.current = false; count.current = 0; fitOnce.current = false;
    latestSession.current = null;
    setBusy(false); setPlaying(false); setAnimating(false); setFollow(false);
    setData(EMPTY); setPositions({}); setCamera({ x: 0, y: 0, zoom: 1 });
    setActiveEdge(null); setFocusRequest(0); setShowSources(false);
    setMessage(t("Lienzo vacío. Busca una idea para empezar.")); setError(""); setPlaybackNotice("");
    closeDetail(); onTitleChange("");
  };
  const removeNode = (id: string) => {
    if (!engine) return;
    life.current++; engine.remove(id); stepping.current = false;
    setBusy(false); setPlaying(false); setAnimating(false); setActiveEdge(null); setFollow(false);
    setData(engine.visible());
    setPositions(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    closeDetail(); setPlaybackNotice(""); setMessage(t("Idea retirada del lienzo."));
  };
  // Choose the ideas using all connections, then simplify only the lines between them.
  const scoped = useMemo(
    () => themeId ? neighbourhood(data, focal, depth) : data,
    [themeId, data, focal, depth],
  );
  const view = useMemo(
    () => themeId
      ? capRelations(scoped, childLimit, [
          ...(engine?.history.slice(0, engine.cursor) || []),
          ...(activeEdge ? [activeEdge] : []),
        ])
      : scoped,
    [themeId, scoped, childLimit, engine, activeEdge],
  );
  const corpusContext = useCorpusContext(source, view, positions, active);
  // Until an idea is selected, neighbourhood mode starts at the most connected idea.
  useEffect(() => {
    if (!themeId || focal || !data.nodes.length) return;
    const degree = new Map<string, number>();
    for (const edge of data.edges)
      for (const end of [edge.source, edge.target])
        degree.set(end, (degree.get(end) || 0) + 1);
    setFocal(data.nodes.reduce((best, node) =>
      (degree.get(node.id) || 0) > (degree.get(best.id) || 0) ? node : best, data.nodes[0]).id);
  }, [themeId, focal, data]);
  const hiddenRelations = scoped.edges.length - view.edges.length;
  // A walked neighbourhood is a handful of ideas: frame it rather than keeping the camera
  // wherever the previous step left it.
  useEffect(() => {
    const frameKey = depth ? `${focal}:${depth}` : "all";
    if (!themeId || !focal || framedFocal.current === frameKey || layoutProgress < 1) return;
    if (!view.nodes.length || !view.nodes.every(node => positions[node.id])) return;
    framedFocal.current = frameKey;
    api.current?.fit();
  }, [themeId, focal, depth, view, positions, layoutProgress]);
  const visibleIds = useMemo(() => new Set(view.nodes.map(node => node.id)), [view.nodes]);
  const connections = useMemo(
    () =>
      selected
        ? view.edges.filter(
            (e) => e.source === selected || e.target === selected,
          )
        : [],
    [view, selected],
  );
  const step = activeEdge ? view.edges.find(e => e.id === activeEdge) : undefined;
  return (
    <div className={`stellar-workspace ${themeId ? "stellar-theme-view" : ""}`} data-testid="stellar-workspace"
      data-node-count={view.nodes.length} data-edge-count={view.edges.length} data-theme={themeId}>
      <header className="stellar-header">
        {onBack && (
          <nav className="stellar-breadcrumb" aria-label={t("Navegación del grafo")}>
            <button onClick={onBack} aria-label={t("Volver a los temas")} title={t("Volver a los temas")}>
              <Icon name="arrowLeft" size={14} />{t("Temas")}
            </button>
            <span aria-hidden="true">/</span>
          </nav>
        )}
        <div className="stellar-heading">
          <span className="stellar-eyebrow">NODUS / {t(themeId ? "TEMA" : "CONSTELACIÓN")}</span>
          <h2>{themeLabel || title || t("Sigue una idea. Descubre sus conexiones.")}</h2>
        </div>
        <div className="stellar-header-actions">
          {toolbar}
          <StellarSearch source={source} author={author} initialQuery={searchQuery} onQueryChange={setSearchQuery}
            disabled={busy || loading} visibleIds={visibleIds} onRemove={removeNode} onChoose={node => {
              closeDetail();
              void start(node.id, node);
            }} />
        </div>
      </header>
      <div className="stellar-body">
        <div className="stellar-stage">
          {active && <StellarCanvas
            layout={themeId && view.nodes.length > FORCE_LAYOUT_FROM ? "force" : "spiral"}
            onLayoutProgress={setLayoutProgress}
            data={view}
            context={corpusContext.layer}
            onContextNode={node => {
              if (busy || loading) return;
              closeDetail();
              const position = corpusContext.layer?.positions[node.id];
              if (position) setPositions(current => ({ ...current, [node.id]: position }));
              void start(node.id, node).then(() => { if (themeId) setFocal(node.id); });
            }}
            positions={positions}
            camera={camera}
            selected={activeEdge ? null : selected}
            activeEdge={activeEdge}
            followActive={follow}
            focusRequest={focusRequest}
            focusSeed={engine?.activeSeed}
            animate={animating}
            onPositions={setPositions}
            onCamera={setCamera}
            onNode={openNode}
            onEdge={openEdge}
            onBackground={closeDetail}
            onApi={bindApi}
            onManualCamera={manualCamera}
            sources={
              showSources && idea
                ? Array.from(
                    new Map(
                      [
                        ...idea.occurrences.map((o) => ({
                          id: o.nodus_id,
                          label: o.work.title,
                        })),
                        ...idea.evidence.map((e) => ({
                          id: e.nodus_id,
                          label: e.source_ref || e.nodus_id,
                        })),
                      ].map((s) => [s.id, s]),
                    ).values(),
                  ).slice(0, 8)
                : []
            }
            onSource={(id) => {
              const ev = idea?.evidence.find((e) => e.nodus_id === id);
              if (openEvidence)
                openEvidence(ev?.source_ref || id, ev?.location || null);
              else if (window.nodus)
                void openEvidenceAtPage(id, {
                  location: ev?.location || null,
                  sourceRef: ev?.source_ref || null,
                  pageNumber: ev?.page_number || null,
                });
            }}
          />}
          <div className="stellar-meta">
            <span className="stellar-live-dot" />
            {loading
              ? themeId
                ? tx("Cargando el tema… {n} ideas", { n: progress.loaded.toLocaleString() })
                : t("Preparando constelación…")
              : themeId
                ? tx("{n} de {total} ideas del tema · {edges} relaciones", {
                    n: view.nodes.length.toLocaleString(),
                    total: data.nodes.length.toLocaleString(),
                    edges: view.edges.length.toLocaleString(),
                  })
                : `${view.nodes.length.toLocaleString()} ${t("ideas")} · ${view.edges.length.toLocaleString()} ${t("relaciones")}`}{" "}
            {/* The budget's toll is only meaningful once the whole theme is on screen;
                while walking it, "N of M ideas" already says what is being left out. */}
            {!loading && hiddenRelations > 0 && (!themeId || !depth) &&
              <span> · {tx("{n} ocultas por el límite", { n: hiddenRelations.toLocaleString() })}</span>}
            {workId && <span> / {t("Grafo de la obra")}</span>}
          </div>
          {!loading && !error && !view.nodes.length && !corpusContext.layer && (
            <div className="stellar-empty stellar-empty-hint">
              {t(themeId
                ? "Este tema todavía no anida ninguna idea analizada."
                : "Busca una idea arriba para empezar a explorar.")}
            </div>
          )}
          {(loading || layoutProgress < 1) && !!themeId
            ? <StellarProgress
                label={loading
                  ? tx("Cargando el tema… {n} ideas", { n: progress.loaded.toLocaleString() })
                  : tx("Distribuyendo la constelación… {n}%", { n: Math.round(layoutProgress * 100) })}
                progress={loading ? (progress.total ? progress.loaded / progress.total : 0) : layoutProgress} />
            : <CorpusContextProgress context={corpusContext} />}
          {error && (
            <div className="stellar-error" role="alert">
              {error}
              <button
                onClick={() => {
                  setError("");
                  setReload((v) => v + 1);
                }}
              >
                {t("Reintentar")}
              </button>
            </div>
          )}
          <div className="stellar-navigation">
            <CorpusContextControls context={corpusContext} onFit={() => api.current?.fitContext()} />
            <button title={t("Alejar")} onClick={() => api.current?.zoom(1 / ZOOM_STEP)}>
              −
            </button>
            <button
              title={t("Acercar")}
              onClick={() => api.current?.zoom(ZOOM_STEP)}
            >
              +
            </button>
            <button
              onClick={() => {
                manualCamera();
                api.current?.fit();
              }}
            >
              {t("Encuadrar")}
            </button>
            {!themeId && <button
              disabled={!engine?.activeSeed}
              onClick={() => {
                manualCamera();
                if (engine?.activeSeed) api.current?.focus(engine.activeSeed);
              }}
            >
              {t("Semilla")}
            </button>}
            <button
              disabled={busy || loading || !data.nodes.length}
              title={t("Reorganizar las posiciones del canvas")}
              onClick={() => {
                engine?.interrupt();
                setPlaying(false);
                setAnimating(false);
                setFollow(false);
                fitOnce.current = false;
                setPositions({});
              }}
            >{t("Reorganizar")}</button>
            {!themeId && <button disabled={loading || (!data.nodes.length && !busy)} onClick={clearCanvas} title={t("Quitar todas las ideas y conexiones del lienzo")}>{t("Limpiar")}</button>}
          </div>
          <div className="stellar-player">
            <div className="stellar-player-line">
              {!themeId && <>
              <button
                disabled={!engine?.cursor || busy}
                onClick={() => {
                  setPlaying(false);
                  engine?.previous();
                  setData(engine!.visible());
                  frameStep(engine?.history[engine.cursor - 1] || null);
                  setAnimating(false);
                  setPlaybackNotice("");
                  setMessage(t("Pulsa Play o Siguiente para seguir sus conexiones."));
                }}
              >
                ← {t("Anterior")}
              </button>
              <button
                className="stellar-play"
                disabled={!engine?.activeSeed || loading || (busy && !playing)}
                onClick={() => {
                  if (!playing) {
                    count.current = 0;
                    frameStep(engine?.history[engine.cursor - 1] || null);
                    setPlaying(true);
                    void next();
                  } else {
                    setAnimating(false);
                    engine?.interrupt();
                    setPlaying(false);
                  }
                }}
              >
                {playing ? "Ⅱ" : "▶"} {playing ? t("Pausa") : t("Play")}
              </button>
              <button
                disabled={!engine?.activeSeed || busy}
                onClick={() => {
                  setPlaying(false);
                  void next();
                }}
              >
                {t("Siguiente")} →
              </button>
              <span className="stellar-divider" />
              </>}
              {themeId && <>
                <label>
                  {t("Mostrar ideas")}
                  <select
                    aria-label={t("Mostrar ideas")}
                    value={depth}
                    onChange={(e) => { framedFocal.current = null; setDepth(Number(e.target.value)); }}
                  >
                    <option value={0}>{t("Todo el tema")}</option>
                    <option value={1}>{t("A 1 conexión")}</option>
                    <option value={2}>{tx("A {n} conexiones", { n: 2 })}</option>
                    <option value={3}>{tx("A {n} conexiones", { n: 3 })}</option>
                  </select>
                </label>
                <label>
                  {t("Conexiones por idea")}
                  <select
                    aria-label={t("Conexiones por idea")}
                    value={customChildLimit ? "custom" : childLimit}
                    onChange={(e) => {
                      const custom = e.target.value === "custom";
                      setCustomChildLimit(custom);
                      setChildLimit(custom ? childLimit || DEFAULT_CHILD_LIMIT : Number(e.target.value));
                    }}
                  >
                    <option value={0}>{t("Todas")}</option>
                    {[3, 6, 10].map(n => <option key={n} value={n}>{tx("Hasta {n}", { n })}</option>)}
                    <option value="custom">{t("Personalizar…")}</option>
                  </select>
                </label>
                {customChildLimit && <input
                  aria-label={t("Máximo de conexiones por idea")}
                  type="number"
                  min="1"
                  max="1000"
                  value={childLimit}
                  onChange={(e) => setChildLimit(Math.max(1, Math.min(1000, Number(e.target.value) || DEFAULT_CHILD_LIMIT)))}
                />}
              </>}
              {!themeId && <>
              <label>
                {t("Relaciones por idea")}
                <input
                  aria-label={t("Límite de relaciones")}
                  type="number"
                  min="1"
                  max="1000000"
                  disabled={limit === 0}
                  value={limit || 25}
                  onChange={(e) =>
                    setLimit(
                      Math.max(
                        1,
                        Math.min(1000000, Number(e.target.value) || 25),
                      ),
                    )
                  }
                />
              </label>
              <button
                className={limit === 0 ? "active" : ""}
                aria-pressed={limit === 0}
                title={t("Sin límite")}
                onClick={() => setLimit((v) => (v === 0 ? 25 : 0))}
              >
                ∞
              </button>
              <select
                aria-label={t("Velocidad")}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                <option value={0.5}>0,5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
              </>}
            </div>
            {themeId && depth > 0 && focal && <div className="stellar-theme-focus" title={engine?.nodes.get(focal)?.label}>
              {tx("Explorando alrededor de: {idea}", { idea: engine?.nodes.get(focal)?.label || "…" })}
            </div>}
            {!themeId && <div className="stellar-player-selection">
            {selected && !step ? (
              <div className="stellar-node-actions" aria-label={t("Acciones de la idea seleccionada")}>
                <span className="stellar-selected-name" title={engine?.nodes.get(selected)?.label}>
                  <i aria-hidden="true" />{engine?.nodes.get(selected)?.label}
                </span>
                <small title={t("conexiones visibles")}>{connections.length} {t("conexiones")}</small>
                <button className="stellar-primary" disabled={busy} onClick={() => void start(selected)}
                  title={t("Expandir desde aquí")} aria-label={t("Expandir desde aquí")}>
                  {t("Expandir")} ↗
                </button>
                <button onClick={() => removeNode(selected)} aria-label={t("Quitar idea del lienzo")} title={t("Quitar idea del lienzo")}>− {t("Quitar")}</button>
                <button className={showSources ? "active" : ""} aria-pressed={showSources}
                  aria-label={t(showSources ? "Ocultar fuentes" : "Mostrar fuentes")}
                  title={t(showSources ? "Ocultar fuentes" : "Mostrar fuentes")}
                  onClick={() => setShowSources(value => !value)}>{t("Fuentes")}</button>
              </div>
            ) : step ? (
              <div className="stellar-step" aria-label={t("Conexión actual")} aria-live="polite">
                <div className="stellar-step-meta">
                  <span>{engine?.cursor ? `${t("Paso")} ${engine.cursor}` : t("Relación seleccionada")}</span>
                  <span>{t(step.verdict === "confirmed" ? "Confirmada" : step.basis === "explicit" ? "Extraída de la fuente" : "Inferida")}</span>
                  {playbackNotice && <span>{playbackNotice}</span>}
                  {!follow && <button onClick={() => frameStep(activeEdge)}>{t("Ver conexión")} ↗</button>}
                </div>
                <div className="stellar-step-ideas">
                  <button className="stellar-step-node" title={engine?.nodes.get(step.source)?.statement || engine?.nodes.get(step.source)?.label}
                    data-step-node={step.source} onClick={() => openNode(step.source)}>{engine?.nodes.get(step.source)?.label}</button>
                  <button className="stellar-step-relation" style={{ color: relationColor(step.type) }} onClick={() => openEdge(step.id)}>
                    <span>{t(relation(step.type).label)}</span>
                    <svg width="28" height="8" viewBox="0 0 28 8" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                      <path d="M1 4h26m-3-3 3 3-3 3" />
                    </svg>
                  </button>
                  <button className="stellar-step-node" title={engine?.nodes.get(step.target)?.statement || engine?.nodes.get(step.target)?.label}
                    data-step-node={step.target} onClick={() => openNode(step.target)}>{engine?.nodes.get(step.target)?.label}</button>
                </div>
              </div>
            ) : <p aria-live="polite">
              {busy
                ? t("Descubriendo la siguiente conexión…")
                : message || t("Elige una idea para empezar a investigar.")}
              <span>{engine?.cursor || 0} / {engine?.history.length || 0}</span>
            </p>}
            </div>}
          </div>
          <details className="stellar-legend">
            <summary>{t("Relaciones y evidencia")}</summary>
            <div>
              {Object.entries(RELATIONS)
                .filter(([type]) => view.edges.some((e) => e.type === type))
                .map(([type, r]) => (
                  <span key={type}>
                    <i style={{ background: relationColor(type) }} />
                    {t(r.label)}
                  </span>
                ))}
              <small>
                {t("Trazo continuo: explícita · Discontinuo: inferida")}
              </small>
              <small>{t("Exploración por capas. Una conexión guardada no equivale a una afirmación validada; revisa su dirección y evidencia.")}</small>
            </div>
          </details>
        </div>
        {active && sidebar ? sidebar : (idea || edge || detailLoading) && (
          <NodeDetailPanel
            readOnly={source.readOnly}
            edgeLabel={edge ? relation(engine?.edges.get(edge.edge.id)?.type || edge.edge.type).label : undefined}
            edgeContext={edge ? t(edge.feedback?.verdict === "confirmed" ? "Relación confirmada mediante revisión del usuario." : "Relación pendiente de validación. La confianza es una puntuación del sistema: comprueba la dirección, la justificación y los pasajes originales.") : undefined}
            ideaDetail={idea}
            edgeDetail={edge}
            loading={detailLoading}
            width={width}
            fontSize={font}
            onWidthChange={setWidth}
            onFontChange={(delta) =>
              setFont((f) => Math.max(12, Math.min(20, f + delta)))
            }
            onClose={closeDetail}
            relations={connections.map((e) => {
              const id = e.source === selected ? e.target : e.source;
              return {
                id,
                edgeId: e.id,
                direction: e.source === selected ? "outgoing" : "incoming",
                label: engine?.nodes.get(id)?.label || id,
                relLabel: t(relation(e.type).label),
                relColor: relation(e.type).color,
                isBridge: false,
              };
            })}
            onOpenIdea={openNode}
            onEditIdea={onEditIdea}
            onOpenEvidence={openEvidence}
            onSaveIdea={saveIdea}
            onSaveEdge={saveEdge}
            showEdgeAudit={audit}
            onEdgeFeedback={() => {
              closeDetail();
              setReload((v) => v + 1);
            }}
          />
        )}
      </div>
    </div>
  );
}
