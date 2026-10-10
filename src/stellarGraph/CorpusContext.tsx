import { useEffect, useRef, useState } from "react";
import type { GraphData } from "@shared/types";
import type { StellarPosition } from "@shared/stellarGraph";
import type { StellarGraphSource } from "./source";
import { loadCorpusContext } from "./context";
import { StellarProgress } from "./StellarProgress";
import { t, tx } from "../i18n";

const cache = new WeakMap<StellarGraphSource, { revision: number; data: GraphData }>();
export interface CorpusLayer {
  data: GraphData;
  positions: Record<string, StellarPosition>;
  opacity: number;
}
export function useCorpusContext(source: StellarGraphSource, foreground: GraphData,
  positions: Record<string, StellarPosition>, active: boolean, contentRevision = 0) {
  const [enabled, setEnabled] = useState(false);
  const [opacity, setOpacity] = useState(0.18);
  const [graph, setGraph] = useState<GraphData>();
  const [layout, setLayout] = useState<Record<string, StellarPosition>>({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(false);
  const previous = useRef<Record<string, StellarPosition>>({});
  const live = useRef({ foreground, positions });
  live.current = { foreground, positions };
  useEffect(() => {
    setGraph(undefined); setLayout({}); previous.current = {};
  }, [source]);
  useEffect(() => {
    if (!enabled || !active) return;
    let cancelled = false;
    setError(false);
    const saved = cache.get(source);
    if (saved?.revision === contentRevision) { setGraph(saved.data); setLoading(false); return; }
    setGraph(undefined);
    setLoading(true); setProgress(0);
    void loadCorpusContext(source, () => cancelled, (n, total) => setProgress(total ? n / total : 1))
      .then(data => {
        if (!data || cancelled) return;
        cache.set(source, { revision: contentRevision, data }); setGraph(data); setLoading(false);
      }).catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [source, enabled, active, contentRevision]);
  // Position the background around the working graph, preserving every working coordinate.
  // New exploration nodes may anchor a new pass; panning, selection and opacity never do.
  const anchors = foreground.nodes.map(node => `${node.id}:${!!positions[node.id]}`).join("|");
  useEffect(() => {
    if (!graph || !enabled || !active) return;
    const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => { previous.current = data.positions; setLayout(data.positions); };
    worker.onerror = () => setError(true);
    worker.postMessage({ ids: [...new Set([...graph.nodes, ...live.current.foreground.nodes].map(node => node.id))],
      edges: graph.edges, positions: { ...previous.current, ...live.current.positions } });
    return () => worker.terminate();
  }, [graph, enabled, active, anchors]);
  return { enabled, setEnabled, opacity, setOpacity, loading, progress, error,
    layer: enabled && graph && Object.keys(layout).length ? { data: graph, positions: layout, opacity } : undefined };
}
export function CorpusContextControls({ context, onFit }: {
  context: ReturnType<typeof useCorpusContext>;
  onFit(): void;
}) {
  return <div className="stellar-context-controls">
    {context.enabled && <>
      <input type="range" min="5" max="40" step="1" value={Math.round(context.opacity * 100)}
        aria-label={t("Intensidad del contexto")} title={t("Intensidad del contexto")}
        onChange={event => context.setOpacity(Number(event.target.value) / 100)} />
      {context.error ? <span role="alert">{t("No se pudo cargar el contexto del corpus.")}</span>
        : <button disabled={!context.layer} onClick={onFit} title={context.layer
          ? tx("{n} ideas · {edges} conexiones en el corpus", { n: context.layer.data.nodes.length.toLocaleString(), edges: context.layer.data.edges.length.toLocaleString() })
          : undefined}>{t("Ver corpus")}</button>}
    </>}
    <button type="button" role="switch" aria-checked={context.enabled}
      title={t("Mostrar el corpus tenue alrededor de las ideas de esta pestaña")}
      onClick={() => context.setEnabled(!context.enabled)}>
      <i aria-hidden="true" />{t("Contexto")}
    </button>
  </div>;
}

export function CorpusContextProgress({ context }: { context: ReturnType<typeof useCorpusContext> }) {
  if (!context.enabled || !context.loading) return null;
  return <StellarProgress progress={context.progress}
    label={tx("Cargando el contexto… {n}%", { n: Math.round(context.progress * 100) })} />;
}
