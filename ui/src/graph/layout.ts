import type { GraphProjection, UnlinkedReason } from './projection';
import { UNLINKED_ORDER } from './projection';

/**
 * Constellation layout (UI-008B redesign): Phase = star, Story = satellite.
 *
 * Pure and deterministic: positions depend only on the projection (counts and order), never on fixed
 * coordinates. Every cluster is a star with its confirmed stories on concentric rings; unlinked stories form
 * their own labelled clusters. Clusters are packed so that no two clusters overlap.
 * Geometry carries no meaning: an edge exists only because the projection says Core confirmed it.
 *
 * All coordinates are CENTRE coordinates in the "world" space of the canvas.
 */

export const PHASE_W = 270;
export const PHASE_H = 270;
/** The phase is a disc with rings; its outermost ring touches this radius (edges end there). */
export const PHASE_R = PHASE_W / 2;
export const STORY_W = 230;
export const STORY_H = 105;
export const HUB_R = 85;

const DIAG = Math.hypot(STORY_W, STORY_H); // ~253: any two satellites at least this far apart cannot overlap
const SPACING = DIAG + 84; // gaps wide enough for an edge to pass between neighbours
const RING_GAP = DIAG + 104; // free band between rings, so edges can travel around a ring
const PHASE_CLEAR = PHASE_R + DIAG / 2 + 26;
const HUB_CLEAR = HUB_R + DIAG / 2 + 30;
const CLUSTER_PAD = 30;
const CLUSTER_GAP = 40;
/** Above this many clusters the spiral search is replaced by row packing (keeps layout O(n)). */
const SPIRAL_LIMIT = 80;

export interface Pt { x: number; y: number }
/** Centre-based box. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** A disc of diameter `w` inscribed in the box (the phase node); absent = plain rectangle. */
  round?: boolean;
}
export interface Hub { key: string; text: string; x: number; y: number; r: number }

export interface GraphLayout {
  /** Centre of every node. */
  pos: Map<string, Pt>;
  size: Map<string, { w: number; h: number; round?: boolean }>;
  hubs: Hub[];
}

interface Cluster {
  centerKey: string | null;
  hub: { key: string; text: string } | null;
  sats: string[];
  R: number;
  local: Pt[];
  /** Cluster centre once packed. */
  at: Pt;
}

function rings(n: number, r0: number): { pts: Pt[]; outer: number } {
  const pts: Pt[] = [];
  let remaining = n;
  let k = 0;
  let r = r0;
  while (remaining > 0) {
    const cap = Math.max(1, Math.floor((2 * Math.PI * r) / SPACING));
    const m = Math.min(remaining, cap);
    // Alternate rings are rotated by half a step so that radial neighbours do not line up.
    const off = -Math.PI / 2 + (k % 2) * (Math.PI / m);
    for (let i = 0; i < m; i++) {
      const a = off + (2 * Math.PI * i) / m;
      pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    remaining -= m;
    k++;
    r += RING_GAP;
  }
  return { pts, outer: r - RING_GAP };
}

function makeCluster(centerKey: string | null, hub: Cluster['hub'], sats: string[]): Cluster {
  const clear = centerKey !== null ? PHASE_CLEAR : HUB_CLEAR;
  const { pts, outer } = rings(sats.length, clear);
  const core = centerKey !== null ? PHASE_R : HUB_R;
  const R = (sats.length === 0 ? core : outer + DIAG / 2) + CLUSTER_PAD;
  return { centerKey, hub, sats, R, local: pts, at: { x: 0, y: 0 } };
}

function packSpiral(cs: Cluster[]): void {
  const placed: Cluster[] = [];
  for (const c of cs) {
    if (placed.length === 0) {
      c.at = { x: 0, y: 0 };
      placed.push(c);
      continue;
    }
    let done = false;
    for (let d = 0; !done; d += 40) {
      const steps = Math.max(8, Math.ceil((2 * Math.PI * d) / 60));
      for (let j = 0; j < steps && !done; j++) {
        const a = (2 * Math.PI * j) / steps;
        const p = { x: d * Math.cos(a), y: d * Math.sin(a) };
        if (placed.every((o) => Math.hypot(p.x - o.at.x, p.y - o.at.y) >= o.R + c.R + CLUSTER_GAP)) {
          c.at = p;
          done = true;
        }
      }
    }
    placed.push(c);
  }
}

function packRows(cs: Cluster[]): void {
  const total = cs.reduce((a, c) => a + 2 * c.R + CLUSTER_GAP, 0);
  const rowW = Math.max(1200, Math.sqrt(total) * 220);
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const c of cs) {
    if (x > 0 && x + 2 * c.R > rowW) {
      x = 0;
      y += rowH + CLUSTER_GAP;
      rowH = 0;
    }
    c.at = { x: x + c.R, y: y + c.R };
    x += 2 * c.R + CLUSTER_GAP;
    rowH = Math.max(rowH, 2 * c.R);
  }
}

export function layoutGraph(g: GraphProjection, labelFor: (r: UnlinkedReason) => string): GraphLayout {
  const clusters: Cluster[] = [];
  for (const p of g.phases) clusters.push(makeCluster(p.key, null, p.storyKeys));
  for (const reason of UNLINKED_ORDER) {
    const members = g.stories.filter((s) => s.unlinkedReason === reason);
    if (members.length > 0) clusters.push(makeCluster(null, { key: `group:${reason}`, text: `${labelFor(reason)} (${members.length})` }, members.map((s) => s.key)));
  }
  if (g.currentOutside.length > 0) {
    clusters.push(makeCluster(null, { key: 'group:current', text: 'Current story — not in the story index' }, g.currentOutside.map((c) => c.key)));
  }

  if (clusters.length <= SPIRAL_LIMIT) packSpiral(clusters);
  else packRows(clusters);

  const pos = new Map<string, Pt>();
  const size = new Map<string, { w: number; h: number; round?: boolean }>();
  const hubs: Hub[] = [];
  for (const c of clusters) {
    if (c.centerKey !== null) {
      pos.set(c.centerKey, { ...c.at });
      size.set(c.centerKey, { w: PHASE_W, h: PHASE_H, round: true });
    } else if (c.hub !== null) {
      hubs.push({ key: c.hub.key, text: c.hub.text, x: c.at.x, y: c.at.y, r: HUB_R });
    }
    c.sats.forEach((k, i) => {
      pos.set(k, { x: c.at.x + c.local[i]!.x, y: c.at.y + c.local[i]!.y });
      size.set(k, { w: STORY_W, h: STORY_H });
    });
  }
  return { pos, size, hubs };
}

// ---------------------------------------------------------------------------------------------------------
// Edges: boundary-to-boundary, with a simple obstacle-avoiding bend. Recomputed from the current boxes, so it
// is the same code for the automatic layout and after a node was dragged.
// ---------------------------------------------------------------------------------------------------------

export interface LaidEdge {
  key: string;
  from: string;
  to: string;
  d: string;
  p0: Pt;
  /** Quadratic control point; `null` = straight line (or a polyline, see `pts`). */
  c: Pt | null;
  p1: Pt;
  /** Grid-routed polyline (p0 … p1), used only when no straight line or simple bend is clear. */
  pts: Pt[] | null;
  /** No clear route was found: the edge crosses a foreign node (only possible with nodes dragged on top of each other). */
  blocked: boolean;
}

/** Gentle, consistent curvature first (a fraction of the edge length), then a straight line, then wider bends. */
const CURVE = 0.08;
const OFFSETS = [CURVE, -CURVE, 0, 55, -55, 110, -110, 170, -170, 240, -240, 330, -330];
const SAMPLES = 28;
const OBSTACLE_PAD = 6;

function clip(box: Box, toward: Pt): Pt {
  const dx = toward.x - box.x;
  const dy = toward.y - box.y;
  if (dx === 0 && dy === 0) return { x: box.x, y: box.y };
  // A disc meets the line at its radius; a rectangle at the first side it reaches.
  const t =
    box.round === true
      ? Math.min(box.w / 2 / Math.hypot(dx, dy), 1)
      : Math.min((dx === 0 ? Infinity : box.w / 2 / Math.abs(dx)), (dy === 0 ? Infinity : box.h / 2 / Math.abs(dy)), 1);
  return { x: box.x + dx * t, y: box.y + dy * t };
}

/** The quadratic bend written as the equivalent cubic Bézier (same curve, the form designers expect). */
function cubic(p0: Pt, c: Pt, p1: Pt): string {
  const c1 = { x: p0.x + (2 / 3) * (c.x - p0.x), y: p0.y + (2 / 3) * (c.y - p0.y) };
  const c2 = { x: p1.x + (2 / 3) * (c.x - p1.x), y: p1.y + (2 / 3) * (c.y - p1.y) };
  return `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p1.x} ${p1.y}`;
}

export function edgePoint(e: Pick<LaidEdge, 'p0' | 'c' | 'p1' | 'pts'>, t: number): Pt {
  if (e.pts !== null) {
    const seg = e.pts.slice(1).map((q, i) => Math.hypot(q.x - e.pts![i]!.x, q.y - e.pts![i]!.y));
    let want = seg.reduce((a, b) => a + b, 0) * t;
    for (let i = 0; i < seg.length; i++) {
      if (want <= seg[i]! || i === seg.length - 1) {
        const f = seg[i]! === 0 ? 0 : Math.min(1, want / seg[i]!);
        const a = e.pts[i]!;
        const b = e.pts[i + 1]!;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
      want -= seg[i]!;
    }
  }
  if (e.c === null) return { x: e.p0.x + (e.p1.x - e.p0.x) * t, y: e.p0.y + (e.p1.y - e.p0.y) * t };
  const u = 1 - t;
  return {
    x: u * u * e.p0.x + 2 * u * t * e.c.x + t * t * e.p1.x,
    y: u * u * e.p0.y + 2 * u * t * e.c.y + t * t * e.p1.y,
  };
}

function inside(p: Pt, b: Box, pad: number): boolean {
  return Math.abs(p.x - b.x) < b.w / 2 + pad && Math.abs(p.y - b.y) < b.h / 2 + pad;
}


// ---- Fallback: A* on a coarse grid around the edge, then line-of-sight simplification ----
const CELL = 20;
const GRID_MARGIN = 360;
const GRID_PAD = 12;
const GRID_MAX_CELLS = 90000;

function gridRoute(a: Box, b: Box, fromKey: string, toKey: string, all: [string, Box][]): Pt[] | null {
  const minX = Math.min(a.x, b.x) - GRID_MARGIN;
  const minY = Math.min(a.y, b.y) - GRID_MARGIN;
  const cols = Math.ceil((Math.max(a.x, b.x) + GRID_MARGIN - minX) / CELL) + 1;
  const rows = Math.ceil((Math.max(a.y, b.y) + GRID_MARGIN - minY) / CELL) + 1;
  if (cols * rows > GRID_MAX_CELLS) return null;
  const blocked = new Uint8Array(cols * rows);
  const range = (o: Box, pad: number): [number, number, number, number] => [
    Math.max(0, Math.floor((o.x - o.w / 2 - pad - minX) / CELL)),
    Math.min(cols - 1, Math.floor((o.x + o.w / 2 + pad - minX) / CELL)),
    Math.max(0, Math.floor((o.y - o.h / 2 - pad - minY) / CELL)),
    Math.min(rows - 1, Math.floor((o.y + o.h / 2 + pad - minY) / CELL)),
  ];
  for (const [k, o] of all) {
    if (k === fromKey || k === toKey) continue;
    const [c0, c1, r0, r1] = range(o, GRID_PAD);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) blocked[r * cols + c] = 1;
  }
  for (const o of [a, b]) {
    const [c0, c1, r0, r1] = range(o, 0);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) blocked[r * cols + c] = 0;
  }
  const cellOf = (p: Pt): number => Math.min(rows - 1, Math.max(0, Math.floor((p.y - minY) / CELL))) * cols + Math.min(cols - 1, Math.max(0, Math.floor((p.x - minX) / CELL)));
  const centre = (i: number): Pt => ({ x: minX + ((i % cols) + 0.5) * CELL, y: minY + (Math.floor(i / cols) + 0.5) * CELL });
  const start = cellOf(a);
  const goal = cellOf(b);
  const g = new Float64Array(cols * rows).fill(Infinity);
  const from = new Int32Array(cols * rows).fill(-1);
  const heur = (i: number): number => {
    const dx = Math.abs((i % cols) - (goal % cols));
    const dy = Math.abs(Math.floor(i / cols) - Math.floor(goal / cols));
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  // binary min-heap of [f, index]
  const heap: [number, number][] = [];
  const push = (f: number, i: number): void => {
    heap.push([f, i]);
    let n = heap.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (heap[p]![0] <= heap[n]![0]) break;
      [heap[p], heap[n]] = [heap[n]!, heap[p]!];
      n = p;
    }
  };
  const pop = (): number => {
    const top = heap[0]![1];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1;
        const r = l + 1;
        let m = n;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === n) break;
        [heap[m], heap[n]] = [heap[n]!, heap[m]!];
        n = m;
      }
    }
    return top;
  };
  g[start] = 0;
  push(heur(start), start);
  let found = false;
  while (heap.length > 0) {
    const cur = pop();
    if (cur === goal) { found = true; break; }
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (blocked[ni]) continue;
        if (dx !== 0 && dy !== 0 && (blocked[cy * cols + nx] || blocked[ny * cols + cx])) continue; // no corner cutting
        const ng = g[cur]! + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
        if (ng < g[ni]!) {
          g[ni] = ng;
          from[ni] = cur;
          push(ng + heur(ni), ni);
        }
      }
    }
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let i = goal; i !== -1; i = from[i]!) cells.push(i);
  cells.reverse();
  const way: Pt[] = cells.map(centre);
  way[0] = { x: a.x, y: a.y };
  way[way.length - 1] = { x: b.x, y: b.y };
  const free = (p: Pt, q: Pt): boolean => {
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 6));
    for (let i = 0; i <= n; i++) {
      const x = p.x + ((q.x - p.x) * i) / n;
      const y = p.y + ((q.y - p.y) * i) / n;
      if (blocked[cellOf({ x, y })]) return false;
    }
    return true;
  };
  // string pulling: keep only the waypoints that are needed
  const kept: Pt[] = [way[0]!];
  let i = 0;
  while (i < way.length - 1) {
    let j = way.length - 1;
    while (j > i + 1 && !free(way[i]!, way[j]!)) j--;
    kept.push(way[j]!);
    i = j;
  }
  // waypoints that fall inside the end nodes themselves are not part of the visible line
  while (kept.length > 2 && inside(kept[1]!, a, 0)) kept.splice(1, 1);
  while (kept.length > 2 && inside(kept[kept.length - 2]!, b, 0)) kept.splice(kept.length - 2, 1);
  const first = kept.length > 1 ? kept[1]! : { x: b.x, y: b.y };
  const last = kept.length > 1 ? kept[kept.length - 2]! : { x: a.x, y: a.y };
  const out = [...kept];
  out[0] = clip(a, first);
  out[out.length - 1] = clip(b, last);
  return out;
}

export function routeEdges(edges: { key: string; from: string; to: string }[], boxes: Map<string, Box>): LaidEdge[] {
  const all = [...boxes.entries()];
  const out: LaidEdge[] = [];
  for (const e of edges) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    if (a === undefined || b === undefined) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    let best: LaidEdge | null = null;
    for (const o of OFFSETS) {
      const off = Math.abs(o) < 1 ? o * len : o; // fractions are relative to the edge length
      const c = off === 0 ? null : { x: mid.x + nx * off * 2, y: mid.y + ny * off * 2 };
      const p0 = clip(a, c ?? { x: b.x, y: b.y });
      const p1 = clip(b, c ?? { x: a.x, y: a.y });
      const cand: LaidEdge = {
        key: e.key, from: e.from, to: e.to, p0, c, p1, pts: null, blocked: false,
        d: c === null ? `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}` : cubic(p0, c, p1),
      };
      const minX = Math.min(p0.x, p1.x, c?.x ?? p0.x) - OBSTACLE_PAD;
      const maxX = Math.max(p0.x, p1.x, c?.x ?? p0.x) + OBSTACLE_PAD;
      const minY = Math.min(p0.y, p1.y, c?.y ?? p0.y) - OBSTACLE_PAD;
      const maxY = Math.max(p0.y, p1.y, c?.y ?? p0.y) + OBSTACLE_PAD;
      const near = all.filter(([k, o]) => k !== e.from && k !== e.to && o.x + o.w / 2 >= minX && o.x - o.w / 2 <= maxX && o.y + o.h / 2 >= minY && o.y - o.h / 2 <= maxY);
      let clear = true;
      if (near.length > 0) {
        for (let i = 1; i < SAMPLES && clear; i++) {
          const p = edgePoint(cand, i / SAMPLES);
          if (near.some(([, o]) => inside(p, o, OBSTACLE_PAD))) clear = false;
        }
      }
      if (clear) {
        best = cand;
        break;
      }
      if (best === null) best = { ...cand, blocked: true };
    }
    if (best!.blocked) {
      const pts = gridRoute(a, b, e.from, e.to, all);
      if (pts !== null) {
        best = { key: e.key, from: e.from, to: e.to, p0: pts[0]!, c: null, p1: pts[pts.length - 1]!, pts, blocked: false, d: `M ${pts.map((q) => `${q.x} ${q.y}`).join(' L ')}` };
      }
    }
    out.push(best!);
  }
  return out;
}

export function boundsOf(boxes: Iterable<Box>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let r: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const b of boxes) {
    const x0 = b.x - b.w / 2;
    const x1 = b.x + b.w / 2;
    const y0 = b.y - b.h / 2;
    const y1 = b.y + b.h / 2;
    r = r === null ? { minX: x0, minY: y0, maxX: x1, maxY: y1 } : { minX: Math.min(r.minX, x0), minY: Math.min(r.minY, y0), maxX: Math.max(r.maxX, x1), maxY: Math.max(r.maxY, y1) };
  }
  return r;
}
