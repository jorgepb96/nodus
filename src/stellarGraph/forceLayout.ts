import type { StellarPosition } from "@shared/stellarGraph";
import { hash } from "./layout";

/** Target distance between two linked ideas, in canvas units. Labels are 230 wide. */
const IDEAL = 260;
/**
 * Weight of the far field. Full-strength long-range repulsion (1) is what textbook
 * Fruchterman-Reingold uses, but with only ~2 relations per idea it overwhelms attraction
 * and stretches every relation across the drawing; at 0 the graph collapses into clumps.
 * Tuned on a real 3.8k-idea theme for relations about as long as the gap between
 * unrelated neighbours — which is what makes a connection legible on screen.
 */
const FAR_FIELD = Number(typeof process !== 'undefined' ? process.env.NODUS_FAR_FIELD ?? 0.08 : 0.08);
/** No two ideas end up closer than this, so every node keeps room for its label. */
const MIN_GAP = Number(typeof process !== 'undefined' ? process.env.NODUS_MIN_GAP ?? 240 : 240);

export interface ForceLayoutOptions {
  iterations?: number;
  /** Called with 0…1 and the positions so far, so the canvas can draw the graph settling. */
  onProgress?(fraction: number, positions: Record<string, StellarPosition>): void;
  /** How many iterations between progress frames. */
  progressEvery?: number;
}

/**
 * Deterministic force-directed layout for a whole theme.
 *
 * The spiral packing in `placeNodes` is right for a canvas the user grows one idea at a
 * time, but it ignores topology: a few thousand ideas land in a uniform disc where no
 * relation is legible. Here linked ideas pull together and everything else pushes apart
 * (Fruchterman–Reingold, with repulsion limited to a neighbourhood grid so the cost stays
 * near-linear), which is what makes clusters — and therefore connections — visible.
 *
 * Ideas with no relation inside the theme are not part of the simulation: they would just
 * inflate the cloud. They are parked on an outer ring, still present and still clickable.
 */
export function forceLayout(
  ids: string[],
  edges: { source: string; target: string }[],
  existing: Record<string, StellarPosition> = {},
  options: ForceLayoutOptions = {},
): Record<string, StellarPosition> {
  const member = new Set(ids);
  // Canonical order everywhere: floating-point sums accumulated in a different order
  // diverge over hundreds of iterations, and the same graph must always look the same.
  const links = edges
    .filter((e) => member.has(e.source) && member.has(e.target))
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  const linked = new Set<string>();
  for (const edge of links) {
    linked.add(edge.source);
    linked.add(edge.target);
  }
  // Sorting makes the result depend on the graph, never on arrival order.
  const core = ids.filter((id) => linked.has(id)).sort();
  const loose = ids.filter((id) => !linked.has(id)).sort();
  const index = new Map(core.map((id, i) => [id, i]));
  const n = core.length;
  const positions: Record<string, StellarPosition> = {};
  if (!n) return ring(loose, 0, positions);

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const side = IDEAL * Math.sqrt(n);
  for (let i = 0; i < n; i++) {
    const id = core[i];
    const seeded = existing[id];
    if (seeded) {
      x[i] = seeded.x;
      y[i] = seeded.y;
    } else {
      // A phyllotaxis seed spreads the start evenly, so the first frames already read.
      const radius = (side / 2) * Math.sqrt((i + 0.5) / n);
      const angle = i * 2.399963 + hash(id) * 0.4;
      x[i] = Math.cos(angle) * radius;
      y[i] = Math.sin(angle) * radius * 0.78;
    }
  }

  const from = new Int32Array(links.length);
  const to = new Int32Array(links.length);
  for (let e = 0; e < links.length; e++) {
    from[e] = index.get(links[e].source)!;
    to[e] = index.get(links[e].target)!;
  }
  const degree = new Float64Array(n);
  for (let e = 0; e < links.length; e++) {
    degree[from[e]]++;
    degree[to[e]]++;
  }

  const iterations = options.iterations ?? Math.max(90, Math.min(220, Math.round(10000 / Math.sqrt(n))));
  const every = options.progressEvery ?? Math.max(1, Math.round(iterations / 12));
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const cell = IDEAL;
  // Two grids: the fine one gives exact repulsion between close ideas, the coarse one
  // approximates every distant idea by its cell's centre of mass. Without that far field
  // there is nothing to expand the graph — local repulsion cancels out in any even
  // arrangement — and the whole theme collapses into unreadable clumps.
  // The coarse grid tracks the frame, so its cost stays flat however the graph spreads.
  const coarse = Math.max(IDEAL * 4, side / 6);
  // Fruchterman-Reingold confines the drawing: without a frame the far field expands the
  // graph until relations stretch across the whole canvas.
  const bound = side * 0.75;
  const buckets = new Map<number, number[]>();
  const farX: number[] = [];
  const farY: number[] = [];
  const farWeight: number[] = [];
  const farKey: number[] = [];

  for (let step = 0; step < iterations; step++) {
    const temperature = (side / 10) * (1 - step / iterations) + 1;
    dx.fill(0);
    dy.fill(0);

    buckets.clear();
    farX.length = 0;
    farY.length = 0;
    farWeight.length = 0;
    farKey.length = 0;
    const coarseIndex = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const key = cellKey(Math.floor(x[i] / cell), Math.floor(y[i] / cell));
      const list = buckets.get(key);
      if (list) list.push(i);
      else buckets.set(key, [i]);
      const ck = cellKey(Math.floor(x[i] / coarse), Math.floor(y[i] / coarse));
      let slot = coarseIndex.get(ck);
      if (slot === undefined) {
        slot = farX.length;
        coarseIndex.set(ck, slot);
        farX.push(0);
        farY.push(0);
        farWeight.push(0);
        farKey.push(ck);
      }
      farX[slot] += x[i];
      farY[slot] += y[i];
      farWeight[slot]++;
    }
    for (let c = 0; c < farX.length; c++) {
      farX[c] /= farWeight[c];
      farY[c] /= farWeight[c];
    }

    for (let i = 0; i < n; i++) {
      const cx = Math.floor(x[i] / cell);
      const cy = Math.floor(y[i] / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++)
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const list = buckets.get(cellKey(gx, gy));
          if (!list) continue;
          // Cap the neighbours read per cell: a pile-up must not become quadratic.
          const limit = Math.min(list.length, 32);
          for (let k = 0; k < limit; k++) {
            const j = list[k];
            if (j === i) continue;
            let ox = x[i] - x[j];
            let oy = y[i] - y[j];
            let distance = Math.hypot(ox, oy);
            if (distance < 0.01) {
              // Two ideas exactly on top of each other need a deterministic nudge.
              ox = (hash(core[i]) - 0.5) * 0.1 || 0.05;
              oy = (hash(core[j]) - 0.5) * 0.1 || 0.05;
              distance = Math.hypot(ox, oy);
            }
            const force = (IDEAL * IDEAL) / distance;
            dx[i] += (ox / distance) * force;
            dy[i] += (oy / distance) * force;
          }
        }
      const own = cellKey(Math.floor(x[i] / coarse), Math.floor(y[i] / coarse));
      for (let c = 0; c < farX.length; c++) {
        if (farKey[c] === own) continue;
        const ox = x[i] - farX[c];
        const oy = y[i] - farY[c];
        const distance = Math.hypot(ox, oy) || 0.01;
        const force = (FAR_FIELD * farWeight[c] * IDEAL * IDEAL) / distance;
        dx[i] += (ox / distance) * force;
        dy[i] += (oy / distance) * force;
      }
    }

    // Attraction along the relations that survive inside the theme.
    for (let e = 0; e < links.length; e++) {
      const a = from[e];
      const b = to[e];
      const ox = x[a] - x[b];
      const oy = y[a] - y[b];
      const distance = Math.hypot(ox, oy) || 0.01;
      const force = (distance * distance) / IDEAL;
      const fx = (ox / distance) * force;
      const fy = (oy / distance) * force;
      dx[a] -= fx;
      dy[a] -= fy;
      dx[b] += fx;
      dy[b] += fy;
    }

    // Gravity only holds components that share no relation inside the frame.
    for (let i = 0; i < n; i++) {
      const pull = 0.0018 / (1 + degree[i] * 0.25);
      dx[i] -= x[i] * pull;
      dy[i] -= y[i] * pull;
    }

    for (let i = 0; i < n; i++) {
      const length = Math.hypot(dx[i], dy[i]) || 1;
      const capped = Math.min(length, temperature);
      x[i] += (dx[i] / length) * capped;
      y[i] += (dy[i] / length) * capped;
      const radius = Math.hypot(x[i], y[i]);
      if (radius > bound) {
        x[i] = (x[i] / radius) * bound;
        y[i] = (y[i] / radius) * bound;
      }
    }

    // Collision: forces alone leave ideas piled on top of each other wherever the graph
    // is dense, and a label needs room beside its node. Pushing overlapping pairs apart
    // to a guaranteed gap is what keeps relations short AND ideas readable at once.
    // Two relaxation passes: one pass only half-resolves a pile-up.
    for (let pass = 0; pass < 2; pass++) {
    buckets.clear();
    for (let i = 0; i < n; i++) {
      const key = cellKey(Math.floor(x[i] / cell), Math.floor(y[i] / cell));
      const list = buckets.get(key);
      if (list) list.push(i);
      else buckets.set(key, [i]);
    }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(x[i] / cell);
      const cy = Math.floor(y[i] / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++)
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const list = buckets.get(cellKey(gx, gy));
          if (!list) continue;
          // No cap here: a missed pair is an idea left buried under another.
          for (let k = 0; k < list.length; k++) {
            const j = list[k];
            if (j <= i) continue;
            const ox = x[i] - x[j];
            const oy = y[i] - y[j];
            const distance = Math.hypot(ox, oy);
            if (distance >= MIN_GAP) continue;
            const push = (MIN_GAP - distance) / 2;
            const ux = distance > 0.01 ? ox / distance : (hash(core[i]) - 0.5) || 1;
            const uy = distance > 0.01 ? oy / distance : (hash(core[j]) - 0.5) || 1;
            x[i] += ux * push;
            y[i] += uy * push;
            x[j] -= ux * push;
            y[j] -= uy * push;
          }
        }
    }
    }

    if (options.onProgress && (step % every === every - 1 || step === iterations - 1))
      options.onProgress((step + 1) / iterations, snapshot(core, x, y, loose, side));
  }
  return snapshot(core, x, y, loose, side);
}

/** Exact cell key (no hashing collisions) for any coordinate inside ±32k cells. */
const cellKey = (gx: number, gy: number) => (gx + 32768) * 65536 + (gy + 32768);

function snapshot(
  core: string[],
  x: Float64Array,
  y: Float64Array,
  loose: string[],
  side: number,
): Record<string, StellarPosition> {
  const positions: Record<string, StellarPosition> = {};
  let radius = 0;
  for (let i = 0; i < core.length; i++) {
    positions[core[i]] = { x: Math.round(x[i]), y: Math.round(y[i]) };
    radius = Math.max(radius, Math.hypot(x[i], y[i]));
  }
  return ring(loose, Math.max(radius, side / 2) + IDEAL * 1.6, positions);
}

/** Ideas with no relation inside the theme: an outer belt, never mixed into the core. */
function ring(
  loose: string[],
  radius: number,
  positions: Record<string, StellarPosition>,
): Record<string, StellarPosition> {
  if (!loose.length) return positions;
  const base = Math.max(radius, IDEAL * 1.6);
  const perTurn = Math.max(12, Math.floor((2 * Math.PI * base) / IDEAL));
  for (let i = 0; i < loose.length; i++) {
    const turn = Math.floor(i / perTurn);
    const angle = ((i % perTurn) / perTurn) * Math.PI * 2 + turn * 0.35;
    const r = base + turn * IDEAL;
    positions[loose[i]] = { x: Math.round(Math.cos(angle) * r), y: Math.round(Math.sin(angle) * r * 0.82) };
  }
  return positions;
}
