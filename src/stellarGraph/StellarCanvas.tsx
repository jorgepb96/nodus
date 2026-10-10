import { routeConnection, type Obstacle } from "./routing";
import { useEffect, useRef, useState } from "react";
import type { GraphData } from "@shared/types";
import type { StellarPosition, StellarSession } from "@shared/stellarGraph";
import { StellarGPU } from "./gpu";
import { hash } from "./layout";
import { arrowGeometry, frameConnection, interpolateCamera } from "./presentation";
import { NODE_COLORS, NODE_LABELS, RELATIONS, relation, relationColor, nodeColor } from "./palette";
import { t } from "../i18n";
import "./stellar.css";
import type { CorpusLayer } from "./CorpusContext";
import { useCanvasPinch } from '../hooks/useCanvasPinch';
import { pinchWorldCamera } from '@shared/touchCamera';
type Camera = StellarSession["camera"];
export interface StellarCanvasApi {
  fit(): void;
  fitContext(): void;
  /** `zoom` overrides the current level — a dense theme has to open closer to read. */
  focus(id: string, zoom?: number): void;
  zoom(factor: number): void;
}
interface Props {
  data: GraphData;
  context?: CorpusLayer;
  onContextNode?(node: GraphData["nodes"][number]): void;
  positions: Record<string, StellarPosition>;
  camera: Camera;
  selected?: string | null;
  activeEdge?: string | null;
  followActive?: boolean;
  focusRequest?: number;
  focusSeed?: string | null;
  animate?: boolean;
  onPositions(p: Record<string, StellarPosition>): void;
  onCamera(c: Camera): void;
  onNode(id: string): void;
  onEdge(id: string): void;
  onBackground?(): void;
  onApi?(api: StellarCanvasApi | null): void;
  onManualCamera?(): void;
  sources?: { id: string; label: string }[];
  onSource?(id: string): void;
  /** "force" spreads a whole theme by its topology; "spiral" packs a growing canvas. */
  layout?: "spiral" | "force";
  /** Overrides the "TYPE · N sources" line under a node, for canvases of something else. */
  nodeMeta?(node: GraphData["nodes"][number]): string;
  /**
   * "cull" (default) drops labels that would collide, which is right for a canvas of
   * thousands. "all" keeps every one: on a canvas of a few named things — the themes hub —
   * a node with no name is useless, and their spacing is chosen so they fit.
   */
  labelPolicy?: "cull" | "all";
  onLayoutProgress?(progress: number): void;
}
/** Zoom range and step. A 25% step is imperceptible on a canvas this size. */
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.55;
const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
const parseColor = (value: string, fallback: number[]) => {
  const color = value.trim();
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const expanded = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
    if (/^[0-9a-f]{6}$/i.test(expanded))
      return [1, 3, 5].map((i) => parseInt(expanded.slice(i - 1, i + 1), 16) / 255);
  }
  const match = color.match(/^rgba?\(([^)]+)\)$/i);
  if (match) {
    const channels = match[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean).slice(0, 3);
    if (channels.length === 3) {
      const values = channels.map((channel) => {
        const number = Number.parseFloat(channel);
        return channel.endsWith("%") ? number / 100 : number / 255;
      });
      if (values.every((channel) => Number.isFinite(channel))) return values;
    }
  }
  const srgb = color.match(/^color\(srgb\s+([^)]*)\)$/i);
  if (srgb) {
    const channels = srgb[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean).slice(0, 3);
    if (channels.length === 3) {
      const values = channels.map((channel) => {
        const number = Number.parseFloat(channel);
        return channel.endsWith("%") ? number / 100 : number;
      });
      if (values.every((channel) => Number.isFinite(channel))) return values;
    }
  }
  return fallback;
};
const fallbackColor = (value: string) => parseColor(value, [0.65, 0.73, 0.98]);
interface CanvasPalette {
  light: boolean;
  star: number[];
  context: number[];
  nodes: Record<string, number[]>;
  edges: Record<string, number[]>;
  edgeDefault: number[];
}
export function StellarCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    live = useRef(props);
  live.current = props;
  const [size, setSize] = useState({ w: 1000, h: 700, footer: 150 }),
    [error, setError] = useState(""),
    [generation, setGeneration] = useState(0);
  const palette = useRef<CanvasPalette>({
    light: false,
    star: fallbackColor("#a4bbfa"),
    context: fallbackColor("#a6a8d1"),
    nodes: Object.fromEntries(Object.entries(NODE_COLORS).map(([type, color]) => [type, fallbackColor(color)])),
    edges: Object.fromEntries(Object.entries(RELATIONS).map(([type, value]) => [type, fallbackColor(value.color)])),
    edgeDefault: fallbackColor("#adb8d9"),
  });
  const worker = useRef<Worker>(),
    seq = useRef(0),
    paint = useRef<() => void>(() => {});
  const drag = useRef<{
    id: string | null;
    x: number;
    y: number;
    cx: number;
    cy: number;
    moved: boolean;
  } | null>(null);
  const boxes = useRef<Obstacle[]>([]);
  // Coordinates the user chose by hand outlive any relayout.
  const pinned = useRef(new Set<string>());
  const routes = useRef<{ id: string; points: StellarPosition[] }[]>([]);
  const cameraFrame = useRef(0);
  const stopCamera = () => cancelAnimationFrame(cameraFrame.current);
  const pinchCamera = useRef(props.camera);
  const pinching = useCanvasPinch(host, () => {
    stopCamera(); drag.current = null; pinchCamera.current = live.current.camera;
    live.current.onManualCamera?.();
  }, (start, next) => live.current.onCamera(pinchWorldCamera(pinchCamera.current, start, next, size)));
  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    stopCamera();
    if (!props.followActive || (!props.activeEdge && !props.focusRequest)) return;
    const edge = props.data.edges.find(e => e.id === props.activeEdge);
    const seed = props.focusSeed && props.positions[props.focusSeed];
    const a = edge ? props.positions[edge.source] : seed, b = edge ? props.positions[edge.target] : seed;
    if (!a || !b) return;
    const from = live.current.camera, target = frameConnection(a, b, size.w, size.h, size.footer + 150);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      live.current.onCamera(target);
      return;
    }
    const started = performance.now();
    const tick = () => {
      const progress = Math.min(1, (performance.now()-started)/550);
      live.current.onCamera(interpolateCamera(from, target, progress));
      if (progress < 1) cameraFrame.current = requestAnimationFrame(tick);
    };
    cameraFrame.current = requestAnimationFrame(tick);
    return stopCamera;
  }, [props.activeEdge, props.followActive, props.focusRequest, props.focusSeed, props.positions, size.w, size.h, size.footer]);
  useEffect(() => {
    const el = host.current!;
    const player = el.parentElement?.querySelector(".stellar-player");
    const obs = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight, footer: player?.getBoundingClientRect().height || 0 });
    });
    obs.observe(el);
    if (player) obs.observe(player);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    const w = new Worker(new URL("./layout.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.request !== seq.current) return;
      const ids = new Set(live.current.data.nodes.map(node => node.id));
      // A force run streams successive frames, so each one must win over the previous
      // result; the spiral pass runs once and must never move an existing node.
      const merged = data.mode === "force"
        ? { ...live.current.positions, ...data.positions }
        : { ...data.positions, ...live.current.positions };
      for (const id of pinned.current)
        if (live.current.positions[id]) merged[id] = live.current.positions[id];
      live.current.onPositions(Object.fromEntries(Object.entries(merged).filter(([id]) => ids.has(id))) as Record<string, StellarPosition>);
      live.current.onLayoutProgress?.(data.mode === "force" ? data.progress : 1);
    };
    w.onerror = () =>
      setError(
        t("No se pudo calcular la distribución. Vuelve a abrir el canvas."),
      );
    return () => {
      seq.current++;
      w.terminate();
    };
  }, []);
  useEffect(() => {
    // Only a new request invalidates the running one. A force pass streams many frames,
    // and bumping the sequence on every render would discard all but the first of them —
    // leaving the layout frozen part-way. Clear and Re-arrange empty the positions, which
    // does post a new request and so does supersede whatever was in flight.
    if (!props.data.nodes.some((n) => !props.positions[n.id])) return;
    const request = ++seq.current;
    // Only the force pass takes long enough to report; the spiral one lands in one go.
    props.onLayoutProgress?.(props.layout === "force" ? 0 : 1);
    worker.current?.postMessage({
      request,
      mode: props.layout === "force" ? "force" : "spiral",
      ids: props.data.nodes.map((n) => n.id),
      edges: props.data.edges,
      positions: props.positions,
    });
  }, [props.data, props.positions, props.layout]);
  useEffect(() => {
    const api: StellarCanvasApi = {
      fitContext() {
        stopCamera();
        const p = live.current;
        if (!p.context) return;
        const points = p.context.data.nodes.flatMap(node => {
          const pos = p.positions[node.id] || p.context!.positions[node.id];
          return pos ? [pos] : [];
        });
        if (!points.length) return;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const pos of points) {
          x0 = Math.min(x0, pos.x); y0 = Math.min(y0, pos.y);
          x1 = Math.max(x1, pos.x); y1 = Math.max(y1, pos.y);
        }
        p.onManualCamera?.();
        p.onCamera({ x: (x0 + x1) / 2, y: (y0 + y1) / 2,
          zoom: clampZoom(Math.min(1, (size.w - 160) / Math.max(400, x1 - x0),
            (size.h - size.footer - 160) / Math.max(300, y1 - y0))) });
      },
      fit() {
        stopCamera();
        const ps = live.current.data.nodes.flatMap((n) =>
          live.current.positions[n.id] ? [live.current.positions[n.id]] : [],
        );
        if (!ps.length) return;
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -Infinity,
          y1 = -Infinity;
        for (const p of ps) {
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, p.y);
          y1 = Math.max(y1, p.y);
        }
        live.current.onCamera({
          x: (x0 + x1) / 2,
          y: (y0 + y1) / 2,
          zoom: Math.min(
            1.1,
            (size.w - 260) / Math.max(400, x1 - x0 + 300),
            (size.h - 200) / Math.max(300, y1 - y0 + 200),
          ),
        });
      },
      focus(id, zoom) {
        stopCamera();
        const p = live.current.positions[id];
        if (p)
          live.current.onCamera({
            ...p,
            zoom: zoom ?? Math.max(0.8, live.current.camera.zoom),
          });
      },
      zoom(factor) {
        stopCamera();
        live.current.onManualCamera?.();
        const c = live.current.camera;
        live.current.onCamera({ ...c, zoom: clampZoom(c.zoom * factor) });
      },
    };
    props.onApi?.(api);
    return () => props.onApi?.(null);
  }, [size.w, size.h, props.onApi]);
  useEffect(() => {
    const el = canvas.current!;
    const readPalette = () => {
      // Custom properties retain color-mix() as text. Resolve an actual color
      // property in this workspace so WebGL receives the same light/dark and
      // vault palette as the labels, instead of silently using bright fallbacks.
      const probe = document.createElement("span");
      probe.style.display = "none";
      (host.current || el.parentElement || document.body).appendChild(probe);
      const read = (name: string, fallback: string) => {
        probe.style.color = `var(${name}, ${fallback})`;
        return parseColor(getComputedStyle(probe).color, fallbackColor(fallback));
      };
      const background = read("--stellar-bg", "#0a0a0a");
      palette.current = {
        light: background[0] * .2126 + background[1] * .7152 + background[2] * .0722 > .55,
        star: read("--stellar-canvas-star", "#a4bbfa"),
        context: read("--stellar-canvas-context", "#a6a8d1"),
        nodes: Object.fromEntries(Object.entries(NODE_COLORS).map(([type, color]) => [type, read(`--stellar-node-${type}`, color)])),
        edges: Object.fromEntries(Object.entries(RELATIONS).map(([type, value]) => [type, read(`--stellar-edge-${type}`, value.color)])),
        edgeDefault: read("--stellar-accent-soft", "#adb8d9"),
      };
      probe.remove();
    };
    readPalette();
    const themeObserver = new MutationObserver(() => {
      readPalette();
      paint.current();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    let gpu: StellarGPU;
    try {
      gpu = new StellarGPU(el);
    } catch (e) {
      themeObserver.disconnect();
      setError(String(e));
      return;
    }
    let raf = 0, until = 0, revealAt = 0;
    let lastAnimatedEdge: string | null | undefined;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const render = () => {
      // Unmount detaches the ref during commit but this loop's rAF is only
      // cancelled by the passive cleanup after paint, so one in-flight frame
      // can still run with host.current === null.
      const hostEl = host.current;
      if (!hostEl) return;
      const p = live.current,
        dpr = Math.min(devicePixelRatio, 2),
        w = hostEl.clientWidth,
        h = hostEl.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      const screen = (pos: StellarPosition) => ({
        x: (pos.x - p.camera.x) * p.camera.zoom + w / 2,
        y: (pos.y - p.camera.y) * p.camera.zoom + h / 2,
      });
      const lines: number[] = [],
        stars: number[] = [],
        paths: typeof routes.current = [];
      const vertex = (
        out: number[],
        v: StellarPosition,
        color: number[],
        alpha: number,
        size = 1,
      ) => out.push(v.x * dpr, v.y * dpr, ...color, alpha, size * dpr);
      const neighborhood = new Set<string>(p.selected ? [p.selected] : []);
      const active = p.data.edges.find(e => e.id === p.activeEdge);
      if (active) { neighborhood.add(active.source); neighborhood.add(active.target); }
      for (const e of p.data.edges)
        if (e.source === p.selected || e.target === p.selected) {
          neighborhood.add(e.source);
          neighborhood.add(e.target);
        }
      for (let i = 0; i < 80; i++) {
        const x = hash(`sky-x${i}`) * w,
          y = hash(`sky-y${i}`) * h;
        vertex(
          stars,
          { x, y },
          palette.current.star,
          0.25,
          2 + hash(`s${i}`) * 3,
        );
      }
      if (p.context) {
        const focus = new Set(p.data.nodes.map(node => node.id));
        const focusEdges = new Set(p.data.edges.map(edge => edge.id));
        const near = new Set<string>();
        const position = (id: string) => p.positions[id] || p.context!.positions[id];
        const opacity = p.context.opacity;
        for (const edge of p.context.data.edges) {
          if (focusEdges.has(edge.id)) continue;
          const a = position(edge.source), b = position(edge.target);
          if (!a || !b) continue;
          const bridge = focus.has(edge.source) || focus.has(edge.target);
          if (bridge) { near.add(edge.source); near.add(edge.target); }
          const s = screen(a), target = screen(b);
          if (Math.max(s.x, target.x) < 0 || Math.min(s.x, target.x) > w ||
              Math.max(s.y, target.y) < 0 || Math.min(s.y, target.y) > h) continue;
          // A separate inexpensive pass: background links do not route around labels,
          // capture clicks or join playback. Stronger bridges reveal outside connections.
          const color = bridge ? (palette.current.edges[edge.type] || palette.current.edgeDefault) : palette.current.context;
          const alpha = opacity * (bridge ? 1.6 : .58);
          vertex(lines, s, color, alpha); vertex(lines, target, color, alpha);
        }
        for (const node of p.context.data.nodes) {
          if (focus.has(node.id)) continue;
          const pos = position(node.id);
          if (!pos) continue;
          const s = screen(pos);
          if (s.x < -20 || s.x > w + 20 || s.y < -20 || s.y > h + 20) continue;
          const bridge = near.has(node.id);
          vertex(stars, s, palette.current.nodes[node.type] || palette.current.edgeDefault, opacity * (bridge ? 2 : 1),
            (bridge ? 34 : 20) * Math.max(.35, Math.min(1, p.camera.zoom)));
          vertex(stars, s, palette.current.context, opacity * (bridge ? 2 : 1), bridge ? 6 : 3);
        }
      }
      for (const e of p.data.edges) {
        const a = p.positions[e.source],
          b = p.positions[e.target];
        if (!a || !b) continue;
        const s = screen(a),
          t = screen(b);
        if (
          Math.max(s.x, t.x) < -80 ||
          Math.min(s.x, t.x) > w + 80 ||
          Math.max(s.y, t.y) < -80 ||
          Math.min(s.y, t.y) > h + 80
        )
          continue;
        const hot =
          e.id === p.activeEdge ||
          e.source === p.selected ||
          e.target === p.selected;
        const current = e.id === p.activeEdge;
        const color = palette.current.edges[e.type] || palette.current.edgeDefault;
        const alpha = active ? current ? 1 : .12 : p.selected && !hot ? .1 : hot ? 1 : .68;
        const steps = current ? 32 : p.camera.zoom < 0.3 ? 1 : 20;
        const points = routeConnection(
          s,
          t,
          hash(e.id) > 0.5 ? 1 : -1,
          !current && p.camera.zoom > 0.12
            ? boxes.current.filter(
                (box) => box.id !== e.source && box.id !== e.target && box.id !== `label:${e.source}` && box.id !== `label:${e.target}`,
              )
            : [],
          steps,
        );
        for (let i = 1; i < points.length; i++) {
          if (e.basis === "inferred" && i % 3 === 0) continue;
          vertex(
            lines,
            points[i - 1],
            color,
            alpha, current ? 2.7 : 1.2,
          );
          vertex(
            lines,
            points[i],
            color,
            alpha, current ? 2.7 : 1.2,
          );
        }
        // Arrowhead retains the original direction even during reverse traversal.
        if (p.camera.zoom > 0.35 || hot) {
          const arrow = arrowGeometry(points)!;
          const { angle, tip } = arrow;
          for (const turn of [-0.55, 0.55]) {
            vertex(lines, tip, color, alpha, current ? 2.7 : 1.2);
            vertex(
              lines,
              {
                x: tip.x - Math.cos(angle + turn) * (current ? 12 : 8),
                y: tip.y - Math.sin(angle + turn) * (current ? 12 : 8),
              },
              color,
              alpha, current ? 2.7 : 1.2,
            );
          }
        }
        if (p.animate && e.id === p.activeEdge && !reduce.matches) {
          const phase = Math.max(0, Math.min(1, (performance.now()-revealAt)/1000)),
            idx = Math.max(0, Math.min(steps, Math.floor(phase * steps)));
          vertex(stars, points[idx], color, 1, 35);
        }
        paths.push({ id: e.id, points });
      }
      routes.current = paths;
      for (const n of p.data.nodes) {
        const pos = p.positions[n.id];
        if (!pos) continue;
        const s = screen(pos);
        if (s.x < -150 || s.x > w + 150 || s.y < -100 || s.y > h + 100)
          continue;
        const color = palette.current.nodes[n.type] || palette.current.edgeDefault;
        const featured = active && (n.id === active.source || n.id === active.target);
        const alpha = (active || p.selected) && !neighborhood.has(n.id) ? 0.18 : 1;
        vertex(
          stars,
          s,
          color,
          alpha,
          (featured || n.id === p.selected ? 130 : 96) *
            (featured ? 1 : Math.max(0.025, Math.min(1.3, p.camera.zoom))),
        );
        vertex(stars, s, palette.current.light ? color : [1, 1, 1], alpha,
          featured ? 14 : Math.max(2, 12 * Math.min(1.3, p.camera.zoom)));
      }
      gpu.draw(el.width, el.height, lines, stars, p.camera.zoom < 0.3 && !active);
      if (performance.now() < until && !reduce.matches)
        raf = requestAnimationFrame(render);
    };
    paint.current = () => {
      cancelAnimationFrame(raf);
      if (live.current.animate && lastAnimatedEdge !== live.current.activeEdge) {
        lastAnimatedEdge = live.current.activeEdge;
        revealAt = performance.now() + (live.current.followActive ? 550 : 0);
        until = revealAt + 1000;
      }
      if (!live.current.animate) { until = 0; lastAnimatedEdge = null; }
      raf = requestAnimationFrame(render);
    };
    paint.current();
    const lost = (e: Event) => {
      e.preventDefault();
      stopCamera();
      setError(
        t("Se ha interrumpido la aceleración gráfica. Recupera el canvas para continuar."),
      );
    };
    el.addEventListener("webglcontextlost", lost);
    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      gpu.dispose();
      el.removeEventListener("webglcontextlost", lost);
    };
  }, [generation]);
  useEffect(
    () => paint.current(),
    [
      props.data,
      props.context,
      props.positions,
      props.camera,
      props.selected,
      props.activeEdge,
      props.animate,
      size,
    ],
  );
  useEffect(() => {
    const el = host.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      stopCamera();
      props.onManualCamera?.();
      const c = live.current.camera,
        r = el.getBoundingClientRect(),
        x = e.clientX - r.left - size.w / 2,
        y = e.clientY - r.top - size.h / 2;
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= 40) {
        const zoom = clampZoom(c.zoom * Math.exp(-e.deltaY * 0.0045));
        live.current.onCamera({
          x: c.x + x / c.zoom - x / zoom,
          y: c.y + y / c.zoom - y / zoom,
          zoom,
        });
      } else
        live.current.onCamera({
          ...c,
          x: c.x + e.deltaX / c.zoom,
          y: c.y + e.deltaY / c.zoom,
        });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [size, props.onManualCamera]);
  const local = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const active = props.data.edges.find(e => e.id === props.activeEdge);
  const featured = new Set(active ? [active.source, active.target] : []);
  const closeNodes = new Set<string>(props.selected ? [props.selected] : featured);
  for (const e of props.data.edges)
    if (e.source === props.selected || e.target === props.selected) {
      closeNodes.add(e.source); closeNodes.add(e.target);
    }
  const labels = props.data.nodes.flatMap(n => {
    const p = props.positions[n.id];
    if (!p) return [];
    const x = (p.x-props.camera.x)*props.camera.zoom+size.w/2;
    const y = (p.y-props.camera.y)*props.camera.zoom+size.h/2;
    const labelX = featured.has(n.id) ? Math.max(Math.min(120, size.w/2), Math.min(size.w-Math.min(120, size.w/2), x)) : x;
    return x > -150 && x < size.w+150 && y > -80 && y < size.h+80 ? [{ n, x, y, labelX, labelY: y+22 }] : [];
  }).sort((a,b) => Number(featured.has(b.n.id))-Number(featured.has(a.n.id)) || Number(closeNodes.has(b.n.id))-Number(closeNodes.has(a.n.id)));
  const from = active && labels.find(n => n.n.id === active.source), to = active && labels.find(n => n.n.id === active.target);
  if (from && to && Math.abs(from.labelX-to.labelX)<250 && Math.abs(from.y-to.y)<125) {
    const upper = from.y <= to.y ? from : to, lower = upper === from ? to : from;
    upper.labelY = upper.y-100; lower.labelY = lower.y+25;
  }
  // Keep a visible node's full caption above the bottom edge and transport controls.
  const captionBottom = size.h - (size.footer ? size.footer + 32 : 8);
  for (const label of labels) {
    const height = featured.has(label.n.id) ? 87 : 52;
    if (label.y < 0 || label.y > captionBottom) continue;
    if (label.labelY + height > captionBottom) label.labelY = label.y - height - 16;
    label.labelY = Math.max(8, label.labelY);
  }
  const occupied: { x: number; y: number }[] = [];
  const visibleLabels = labels.filter(({n,labelX,labelY}) => {
    // Manual panning can put an endpoint behind the controls even with follow paused.
    // Hide captions outside the readable area instead of letting them cover the toolbar.
    const height = featured.has(n.id) ? 87 : 52;
    if (labelY < 0 || labelY + height > captionBottom) return false;
    if (props.labelPolicy === "all") return true;
    if (props.camera.zoom < .12 && !closeNodes.has(n.id)) return false;
    if (!featured.has(n.id) && occupied.some(p => Math.abs(p.x-labelX)<245 && Math.abs(p.y-labelY)<100)) return false;
    occupied.push({x:labelX,y:labelY}); return true;
  });
  const contextLabels: { n: GraphData["nodes"][number]; x: number; y: number }[] = [];
  if (props.context && props.camera.zoom >= .22) {
    const ids = new Set(props.data.nodes.map(node => node.id));
    const near = new Set<string>();
    for (const edge of props.context.data.edges) {
      if (ids.has(edge.source)) near.add(edge.target);
      if (ids.has(edge.target)) near.add(edge.source);
    }
    const occupiedContext = visibleLabels.map(label => ({ x: label.labelX, y: label.labelY }));
    for (const n of [...props.context.data.nodes].sort((a, b) => Number(near.has(b.id)) - Number(near.has(a.id)))) {
      if (ids.has(n.id)) continue;
      const pos = props.positions[n.id] || props.context.positions[n.id];
      if (!pos) continue;
      const x = (pos.x - props.camera.x) * props.camera.zoom + size.w / 2;
      const y = (pos.y - props.camera.y) * props.camera.zoom + size.h / 2 + 12;
      if (x < 95 || x > size.w - 95 || y < 75 || y + 32 > captionBottom) continue;
      if (occupiedContext.some(p => Math.abs(p.x - x) < 245 && Math.abs(p.y - y) < 90)) continue;
      contextLabels.push({ n, x, y }); occupiedContext.push({ x, y });
      if (contextLabels.length >= 24) break;
    }
  }
  boxes.current = [
    ...visibleLabels.map(({ n, labelX, labelY }) => ({
      id: `label:${n.id}`,
      x: labelX - 115,
      y: labelY,
      width: 230,
      height: 85,
    })),
    ...labels.map(({ n, x, y }) => ({
      id: n.id,
      x: x - 15,
      y: y - 15,
      width: 30,
      height: 30,
    })),
  ];
  return (
    <div
      ref={host}
      className="stellar-canvas"
      data-testid="stellar-canvas"
      data-context-nodes={props.context?.data.nodes.length || 0}
      data-context-edges={props.context?.data.edges.length || 0}
      tabIndex={0}
      aria-label={t(
        "Canvas de ideas. Arrastra para navegar; usa la rueda para ampliar.",
      )}
      onPointerDown={(e) => {
        if (pinching.current) return;
        if (e.button !== 0) return;
        const button = (e.target as HTMLElement).closest<HTMLElement>(
          "[data-node]",
        );
        const pos = local(e);
        drag.current = {
          id:
            button?.dataset.node ||
            (props.camera.zoom < 0.3
              ? labels.reduce<{ id: string | null; distance: number }>(
                  (best, item) => {
                    const distance = Math.hypot(item.x - pos.x, item.y - pos.y);
                    return distance < best.distance
                      ? { id: item.n.id, distance }
                      : best;
                  },
                  { id: null, distance: 8 },
                ).id
              : null),
          ...pos,
          cx: props.camera.x,
          cy: props.camera.y,
          moved: false,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (pinching.current) return;
        const d = drag.current;
        if (!d) return;
        const p = local(e),
          dx = p.x - d.x,
          dy = p.y - d.y;
        if (Math.hypot(dx, dy) > 4) d.moved = true;
        if (!d.moved) return;
        stopCamera();
        props.onManualCamera?.();
        if (d.id) {
          pinned.current.add(d.id);
          props.onPositions({
            ...props.positions,
            [d.id]: {
              x: props.camera.x + (p.x - size.w / 2) / props.camera.zoom,
              y: props.camera.y + (p.y - size.h / 2) / props.camera.zoom,
            },
          });
        } else
          props.onCamera({
            ...props.camera,
            x: d.cx - dx / props.camera.zoom,
            y: d.cy - dy / props.camera.zoom,
          });
      }}
      onPointerUp={(e) => {
        if (pinching.current) { drag.current = null; return; }
        const d = drag.current;
        drag.current = null;
        if (!d || d.moved) return;
        if (d.id) {
          props.onNode(d.id);
          return;
        }
        const p = local(e);
        let nearest: string | null = null,
          best = 9;
        for (const route of routes.current)
          for (let i = 1; i < route.points.length; i++) {
            const a = route.points[i - 1],
              b = route.points[i],
              dx = b.x - a.x,
              dy = b.y - a.y,
              u = Math.max(
                0,
                Math.min(
                  1,
                  ((p.x - a.x) * dx + (p.y - a.y) * dy) /
                    (dx * dx + dy * dy || 1),
                ),
              ),
              dist = Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
            if (dist < best) {
              best = dist;
              nearest = route.id;
            }
          }
        if (nearest) props.onEdge(nearest);
        else props.onBackground?.();
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <canvas ref={canvas} aria-hidden="true" />
      <div className="stellar-labels">
        {contextLabels.map(({ n, x, y }) => <button key={`context:${n.id}`}
          className="stellar-context-label" data-context-node={n.id}
          style={{ left: x, top: y, opacity: Math.min(.85, .35 + (props.context?.opacity || 0)) }}
          title={n.statement || n.label} onPointerDown={event => event.stopPropagation()}
          onClick={() => props.onContextNode?.(n)}>{n.label}</button>)}
        {labels
          .filter(
            ({ n, x, y }) => x >= 0 && x <= size.w && y >= 0 && y <= size.h &&
              (props.labelPolicy === "all" || props.camera.zoom >= 0.3 || n.id === props.selected || featured.has(n.id)),
          )
          .map(({ n, x, y }) => (
            <button
              key={n.id}
              data-node={n.id}
              className={`stellar-hit ${n.id === props.selected ? "selected" : ""}`}
              style={{ left: x, top: y }}
              title={n.label}
              aria-label={n.label}
              // Native button activation covers keyboard and VoiceOver. Pointer
              // activation is already handled by the canvas's drag recognizer.
              onClick={(e) => { if (e.detail === 0) props.onNode(n.id); }}
            />
          ))}
        {visibleLabels.map(({ n, labelX, labelY }) => (
          <button
            key={`label:${n.id}`}
            data-node={n.id}
            className={`stellar-node-label ${featured.has(n.id) ? "featured" : (props.selected || active) && !closeNodes.has(n.id) ? "dim" : ""}`}
            data-endpoint={active?.source === n.id ? "source" : active?.target === n.id ? "target" : undefined}
            title={n.statement || n.label}
            aria-label={`${featured.has(n.id) ? t(active?.source === n.id ? "Origen" : "Destino") : props.nodeMeta ? props.nodeMeta(n) : `${t(NODE_LABELS[n.type] || n.type)} · ${n.workCount} ${t(n.workCount === 1 ? "fuente" : "fuentes")}`} · ${n.label}`}
            style={
              {
                left: labelX,
                top: labelY,
                "--node-color": nodeColor(n.type),
              } as React.CSSProperties
            }
            onClick={(e) => { if (e.detail === 0) props.onNode(n.id); }}
          >
            <small aria-hidden="true">
              {featured.has(n.id)
                ? t(active?.source === n.id ? "Origen" : "Destino")
                : props.nodeMeta
                  ? props.nodeMeta(n)
                  : `${t(NODE_LABELS[n.type] || n.type)} · ${n.workCount} ${t(n.workCount === 1 ? "fuente" : "fuentes")}`}
            </small>
            <span aria-hidden="true">{n.label}</span>
          </button>
        ))}
        {props.data.edges
          .filter(
            (e) =>
              props.activeEdge ? e.id === props.activeEdge :
              e.source === props.selected || e.target === props.selected,
          )
          .slice(0, 16)
          .map((e) => {
            const a = props.positions[e.source],
              b = props.positions[e.target];
            if (!a || !b) return null;
            const x =
                ((a.x + b.x) / 2 - props.camera.x) * props.camera.zoom +
                size.w / 2,
              y =
                ((a.y + b.y) / 2 - props.camera.y) * props.camera.zoom +
                size.h / 2;
            return (
              <button
                key={`edge:${e.id}`}
                className="stellar-edge-label"
                style={{ left: x, top: y, color: relationColor(e.type) }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => props.onEdge(e.id)}
              >
                {t(relation(e.type).label)}
              </button>
            );
          })}
        {props.selected &&
          props.positions[props.selected] &&
          props.sources?.map((source, i) => {
            const p = props.positions[props.selected!],
              angle =
                -Math.PI * 0.9 +
                (i * Math.PI * 2) / Math.max(3, props.sources!.length),
              x =
                (p.x - props.camera.x) * props.camera.zoom +
                size.w / 2 +
                Math.cos(angle) * 180,
              y =
                (p.y - props.camera.y) * props.camera.zoom +
                size.h / 2 +
                Math.sin(angle) * 150;
            return (
              <button
                className="stellar-source-ring"
                key={source.id}
                style={{ left: x, top: y }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => props.onSource?.(source.id)}
                title={source.label}
              >
                <i />
                <span>{source.label}</span>
              </button>
            );
          })}
      </div>
      {error && (
        <div className="stellar-error" role="alert">
          {error}
          <button
            onClick={() => {
              setError("");
              setGeneration((g) => g + 1);
            }}
          >
            {t("Recuperar canvas")}
          </button>
        </div>
      )}
    </div>
  );
}
