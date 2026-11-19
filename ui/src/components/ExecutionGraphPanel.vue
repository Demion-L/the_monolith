<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import { PHASE_R, boundsOf, layoutGraph, routeEdges } from '../graph/layout';
import type { Box, Pt } from '../graph/layout';
import {
  ROADMAP_DIAGNOSTIC_LABELS,
  STORY_DIAGNOSTIC_LABELS,
  UNLINKED_LABELS,
  projectExecutionGraph,
} from '../graph/projection';
import type { PhaseNode, StatusView, StoryNode } from '../graph/projection';
import type { Section, StoryState, StructuredRoadmapView, StructuredStoryIndexView } from '../types/dashboard';

const props = defineProps<{
  roadmapText: string | null;
  roadmap?: StructuredRoadmapView;
  storyIndex?: Section<StructuredStoryIndexView>;
  story?: StoryState;
}>();

const graph = computed(() =>
  projectExecutionGraph({ roadmapText: props.roadmapText, roadmap: props.roadmap, storyIndex: props.storyIndex, story: props.story }),
);
/** Automatic constellation layout: deterministic from the projection. */
const auto = computed(() => layoutGraph(graph.value, (r) => UNLINKED_LABELS[r]));

// Positions the user set by dragging (view state only; never written anywhere). Dropped for nodes that no longer exist.
const overrides = shallowRef<Map<string, Pt>>(new Map());
const rects = computed(() => {
  const m = new Map<string, Box>();
  for (const [key, p] of auto.value.pos) {
    const sz = auto.value.size.get(key)!;
    const o = overrides.value.get(key);
    m.set(key, { x: o?.x ?? p.x, y: o?.y ?? p.y, w: sz.w, h: sz.h, ...(sz.round === true ? { round: true } : {}) });
  }
  return m;
});
const edges = computed(() => routeEdges(graph.value.edges, rects.value));

const linkedCount = computed(() => graph.value.edges.length);
const unlinkedCount = computed(() => graph.value.stories.length - linkedCount.value);

// ---- Selection (view-only; nothing is written anywhere) ----
const selectedKey = ref<string | null>(null);
const phaseByKey = computed(() => new Map(graph.value.phases.map((p) => [p.key, p])));
const storyByKey = computed(() => new Map(graph.value.stories.map((s) => [s.key, s])));
const selectedPhase = computed(() => (selectedKey.value === null ? null : (phaseByKey.value.get(selectedKey.value) ?? null)));
const selectedStory = computed(() => (selectedKey.value === null ? null : (storyByKey.value.get(selectedKey.value) ?? null)));
const selectedCurrent = computed(() => graph.value.currentOutside.find((c) => c.key === selectedKey.value) ?? null);

// A new snapshot (Refresh) may no longer contain the selected node: drop it rather than show stale details.
watch(graph, (g) => {
  const exists = (k: string) => g.phases.some((p) => p.key === k) || g.stories.some((s) => s.key === k) || g.currentOutside.some((c) => c.key === k);
  if (selectedKey.value !== null && !exists(selectedKey.value)) selectedKey.value = null;
  if ([...overrides.value.keys()].some((k) => !exists(k))) {
    overrides.value = new Map([...overrides.value].filter(([k]) => exists(k)));
  }
});

function toggle(key: string): void {
  selectedKey.value = selectedKey.value === key ? null : key;
}
function clear(): void {
  selectedKey.value = null;
}

/** Nodes and edges that belong to the selection (for highlighting). */
const related = computed(() => {
  const keys = new Set<string>();
  const edgeKeys = new Set<string>();
  const sel = selectedKey.value;
  if (sel === null) return { keys, edgeKeys };
  keys.add(sel);
  for (const e of graph.value.edges) {
    if (e.from === sel || e.to === sel) {
      keys.add(e.from);
      keys.add(e.to);
      edgeKeys.add(e.key);
    }
  }
  return { keys, edgeKeys };
});

// ---- Camera: pan (tx, ty) and zoom (k) of the canvas only; the page and the details panel never scale ----
const MIN_K = 0.15;
const MAX_K = 2.5;
const DRAG_THRESHOLD = 4; // screen px: below it a press is a click, not a drag
const tx = ref(0);
const ty = ref(0);
const k = ref(1);
const viewport = ref<HTMLElement | null>(null);
const panning = ref(false);
const dragging = ref<string | null>(null);

function clampK(v: number): number {
  return Math.min(MAX_K, Math.max(MIN_K, v));
}
/** Zoom by `factor` keeping the world point under (cx, cy) (viewport pixels) fixed. */
function zoomAt(cx: number, cy: number, factor: number): void {
  const nk = clampK(k.value * factor);
  const f = nk / k.value;
  tx.value = cx - (cx - tx.value) * f;
  ty.value = cy - (cy - ty.value) * f;
  k.value = nk;
}
function center(): Pt {
  const el = viewport.value;
  return { x: (el?.clientWidth ?? 0) / 2, y: (el?.clientHeight ?? 0) / 2 };
}
function zoomIn(): void {
  const c = center();
  zoomAt(c.x, c.y, 1.25);
}
function zoomOut(): void {
  const c = center();
  zoomAt(c.x, c.y, 1 / 1.25);
}
function resetZoom(): void {
  const c = center();
  zoomAt(c.x, c.y, 1 / k.value);
}
function fit(): void {
  const el = viewport.value;
  const b = boundsOf(rects.value.values());
  // No layout (not rendered yet) or nothing to show: keep the camera instead of guessing.
  if (el === null || b === null || el.clientWidth <= 0 || el.clientHeight <= 0) return;
  const pad = 40;
  const w = b.maxX - b.minX + 2 * pad;
  const h = b.maxY - b.minY + 2 * pad;
  const nk = clampK(Math.min(el.clientWidth / w, el.clientHeight / h, 1));
  k.value = nk;
  tx.value = (el.clientWidth - (b.maxX + b.minX) * nk) / 2;
  ty.value = (el.clientHeight - (b.maxY + b.minY) * nk) / 2;
}
/**
 * Initial camera: 100% (nodes at their real, readable size), never shrunk to show everything.
 * A graph that fits the viewport at 100% is centred; a larger one opens on the current phase
 * (else the first phase, else the middle of the graph) and the user pans / zooms / uses Fit.
 */
function home(): void {
  const el = viewport.value;
  const b = boundsOf(rects.value.values());
  if (el === null || b === null || el.clientWidth <= 0 || el.clientHeight <= 0) return;
  const pad = 40;
  const fits = b.maxX - b.minX + 2 * pad <= el.clientWidth && b.maxY - b.minY + 2 * pad <= el.clientHeight;
  const focus = fits
    ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
    : ((): Pt => {
        const star = graph.value.phases.find((p) => p.current) ?? graph.value.phases[0];
        const r = star === undefined ? undefined : rects.value.get(star.key);
        return r === undefined ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: r.x, y: r.y };
      })();
  k.value = 1;
  tx.value = el.clientWidth / 2 - focus.x;
  ty.value = el.clientHeight / 2 - focus.y;
}
function resetLayout(): void {
  overrides.value = new Map();
  home();
}
onMounted(home);
watch(viewport, (el, was) => {
  if (el !== null && was === null) void nextTick(home);
});

/** Ctrl + wheel zooms the canvas towards the cursor and cancels the browser's own page zoom. A plain wheel scrolls the page. */
function onWheel(e: WheelEvent): void {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const r = viewport.value?.getBoundingClientRect();
  const unit = e.deltaMode === 1 ? 0.05 : 0.0015;
  // The camera origin is the padding box: skip the viewport's own border.
  const el = viewport.value;
  zoomAt(e.clientX - (r?.left ?? 0) - (el?.clientLeft ?? 0), e.clientY - (r?.top ?? 0) - (el?.clientTop ?? 0), Math.exp(-e.deltaY * unit));
}

/** Pointer capture is a convenience (moves keep arriving outside the element); a vanished pointer must never break a handler. */
function capture(el: Element | null, id: number, on: boolean): void {
  try {
    if (on) el?.setPointerCapture?.(id);
    else el?.releasePointerCapture?.(id);
  } catch {
    /* the pointer is already gone */
  }
}

// ---- Dragging a node ----
interface Drag { key: string; sx: number; sy: number; origin: Pt; moved: boolean }
let drag: Drag | null = null;
let suppressClick = false;

function onNodeDown(e: PointerEvent, key: string): void {
  if (e.button !== undefined && e.button !== 0) return;
  const r = rects.value.get(key);
  if (r === undefined) return;
  e.stopPropagation(); // a press on a node never pans the canvas
  drag = { key, sx: e.clientX, sy: e.clientY, origin: { x: r.x, y: r.y }, moved: false };
  capture(e.currentTarget as HTMLElement | null, e.pointerId, true);
}
function onNodeMove(e: PointerEvent, key: string): void {
  if (drag === null || drag.key !== key) return;
  const dx = e.clientX - drag.sx;
  const dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  drag.moved = true;
  dragging.value = key;
  overrides.value = new Map(overrides.value).set(key, { x: drag.origin.x + dx / k.value, y: drag.origin.y + dy / k.value });
}
function onNodeUp(e: PointerEvent, key: string): void {
  if (drag === null || drag.key !== key) return;
  e.stopPropagation();
  if (drag.moved) {
    // The click that follows a drag must not select the node. Reset right after it (same task).
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }
  drag = null;
  dragging.value = null;
  capture(e.currentTarget as HTMLElement | null, e.pointerId, false);
}
function onNodeClick(key: string): void {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  toggle(key);
}

// ---- Panning the canvas ----
interface Pan { sx: number; sy: number; tx0: number; ty0: number; moved: boolean }
let pan: Pan | null = null;
function onViewportDown(e: PointerEvent): void {
  if (e.button !== undefined && e.button !== 0) return;
  if ((e.target as HTMLElement | null)?.closest?.('.xg-node') != null) return;
  pan = { sx: e.clientX, sy: e.clientY, tx0: tx.value, ty0: ty.value, moved: false };
  capture(viewport.value, e.pointerId, true);
}
function onViewportMove(e: PointerEvent): void {
  if (pan === null) return;
  const dx = e.clientX - pan.sx;
  const dy = e.clientY - pan.sy;
  if (!pan.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  pan.moved = true;
  panning.value = true;
  tx.value = pan.tx0 + dx;
  ty.value = pan.ty0 + dy;
}
function onViewportUp(e: PointerEvent): void {
  if (pan === null) return;
  // A press on empty canvas without movement clears the selection.
  if (!pan.moved) clear();
  pan = null;
  panning.value = false;
  capture(viewport.value, e.pointerId, false);
}
const ARROW_STEP = 60;
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && selectedKey.value !== null) {
    e.stopPropagation();
    clear();
    return;
  }
  if (e.target !== viewport.value) return; // arrows on a focused node keep their default behaviour
  const step: Record<string, [number, number]> = { ArrowLeft: [ARROW_STEP, 0], ArrowRight: [-ARROW_STEP, 0], ArrowUp: [0, ARROW_STEP], ArrowDown: [0, -ARROW_STEP] };
  const d = step[e.key];
  if (d === undefined) return;
  e.preventDefault();
  tx.value += d[0];
  ty.value += d[1];
}

// ---- Presentation helpers ----
function statusLabel(s: StatusView): string {
  if (s.value === null) return 'STATUS NOT STATED';
  return s.value.length > 28 ? `${s.value.slice(0, 28).trimEnd()}…` : s.value;
}
function phaseHeading(p: PhaseNode): string {
  const id = p.id === null ? 'Phase (no id)' : `Phase ${p.id}`;
  return p.title === null ? id : `${id} · ${p.title}`;
}
const ACCENT = '#5EE6FF';
const AMBER = '#FBBF24';
/** Index of a node in the entrance sequence (phases first, then stories): staggered fade-in. */
const order = computed(() => {
  const m = new Map<string, number>();
  let i = 0;
  for (const p of graph.value.phases) m.set(p.key, i++);
  for (const st of graph.value.stories) m.set(st.key, i++);
  for (const c of graph.value.currentOutside) m.set(c.key, i++);
  return m;
});
function nodeStyle(key: string, color: string): Record<string, string> {
  const r = rects.value.get(key);
  if (r === undefined) return {};
  return { left: `${r.x - r.w / 2}px`, top: `${r.y - r.h / 2}px`, width: `${r.w}px`, height: `${r.h}px`, '--c': color, '--i': String(order.value.get(key) ?? 0) };
}
function auraStyle(key: string): Record<string, string> {
  const r = rects.value.get(key);
  if (r === undefined) return {};
  const pad = AURA_PAD;
  return { left: `${r.x - r.w / 2 - pad}px`, top: `${r.y - r.h / 2 - pad}px`, width: `${r.w + 2 * pad}px`, height: `${r.h + 2 * pad}px` };
}
const AURA_PAD = 60;
const phaseColor = (_p: PhaseNode): string => ACCENT;
/** Only the current story gets another colour (amber); everything else is the one accent. */
const storyColor = (s: StoryNode): string => (s.current ? AMBER : ACCENT);
/**
 * A small dot instead of a filled badge. Only states Core provides are coloured:
 * amber = the CURRENT phase / story (Core's active-phase pointer / story claim), green = a recognised COMPLETED status,
 * light blue = a recognised PLANNED status. Anything else (in progress, unknown, unrecognised) stays grey.
 */
function dotClass(s: StatusView, current = false): string {
  if (current) return 'dot-current';
  const v = s.value;
  if (v === null) return 'dot-none';
  if (!s.recognized) return 'dot-idle';
  if (/^complet/i.test(v)) return 'dot-ok';
  if (/^planned\b/i.test(v)) return 'dot-planned';
  return 'dot-idle';
}
// Edge gradients and the flowing "data packets" (decorative; the geometry is the routed edge).
const FLOW_LIMIT = 120;
const showFlow = computed(() => edges.value.length <= FLOW_LIMIT);
const worldStyle = computed(() => ({ transform: `translate(${tx.value}px, ${ty.value}px) scale(${k.value})` }));

// Regular hexagons (flat-top, side S) as one seamless SVG tile: 3S wide, sqrt(3)·S tall.
const HEX = 20;
const HEX_H = Math.sqrt(3) * HEX;
const hexPath = (() => {
  const s = HEX;
  const h = HEX_H / 2;
  return [
    `M ${s} 0 L ${2 * s} 0`, `M ${s} 0 L ${s / 2} ${h}`, `M ${s / 2} ${h} L ${s} ${2 * h}`, `M 0 ${h} L ${s / 2} ${h}`,
    `M ${2.5 * s} ${h} L ${3 * s} ${h}`, `M ${2 * s} 0 L ${2.5 * s} ${h}`, `M ${2.5 * s} ${h} L ${2 * s} ${2 * h}`,
  ].join(' ');
})();
const HEX_TILES = [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => ({ x: i * 3 * HEX, y: j * HEX_H })));
const hexTransform = computed(() => `translate(${tx.value} ${ty.value}) scale(${k.value})`);

function phaseRelation(s: StoryNode): string {
  const ref = s.phaseRef;
  switch (ref.kind) {
    case 'matched':
      return s.phaseKey !== null
        ? `Matched: nested under phase ${ref.phaseId}, which exists once in the roadmap. A link is drawn.`
        : `Matched to phase ${ref.phaseId} by the story index, but no single phase of that id is displayed; no link is drawn.`;
    case 'unmatched':
      return `Not found: the story index nests this story under "${ref.token}", which matches no roadmap phase.${props.roadmap?.state === 'ok' ? '' : ' The roadmap was not fully readable, so this does not prove the phase does not exist.'}`;
    case 'ambiguous':
      return `Ambiguous: "${ref.token}" matches more than one roadmap phase. No link is drawn.`;
    case 'unverified':
      return `Not confirmed: the roadmap supplied no phase ids, so the nesting under "${ref.token}" cannot be verified. No link is drawn.`;
    case 'outside':
      return 'Outside: the story is not nested under any phase heading in the story index.';
  }
}
function phaseTitleOf(key: string | null): string | null {
  if (key === null) return null;
  const p = phaseByKey.value.get(key);
  return p === undefined ? null : phaseHeading(p);
}
function roadmapStateNote(): string | null {
  return graph.value.roadmapReliable ? null : 'The roadmap was not read completely; matching below is limited accordingly.';
}
</script>

<template>
  <section id="graph" class="panel" aria-labelledby="graph-h">
    <h2 id="graph-h">Project Execution Graph</h2>

    <p class="muted xg-intro">
      A read-only view of the roadmap and the story index. A line is drawn only where the story index confirms that a story belongs to a roadmap phase.
      Statuses are as the documents state them (<span class="prov">REPORTED</span>), not independently verified.
    </p>

    <ul v-if="graph.notices.length > 0" class="xg-notices" data-testid="graph-notices">
      <li v-for="(n, i) in graph.notices" :key="i" :class="`xg-notice xg-${n.tone}`" :data-notice="n.code">
        <span class="sev">{{ n.tone === 'error' ? 'error' : n.tone === 'warn' ? 'warn' : 'info' }}</span>{{ n.text }}
      </li>
    </ul>

    <p v-if="!graph.hasData" class="empty" role="status" data-testid="graph-empty">
      <span class="tag tag-neutral">NO GRAPH DATA</span> Nothing can be drawn from the available sources; see the notices above.
    </p>

    <template v-else>
      <p class="xg-summary muted" data-testid="graph-summary">
        {{ graph.phases.length }} {{ graph.phases.length === 1 ? 'phase' : 'phases' }} ·
        {{ graph.stories.length }} {{ graph.stories.length === 1 ? 'story' : 'stories' }} in the index ·
        {{ linkedCount }} confirmed {{ linkedCount === 1 ? 'link' : 'links' }} ·
        {{ unlinkedCount }} not linked
        <template v-if="graph.stories.length === 0 && graph.phases.length > 0"> · no stories to link</template>
      </p>

      <div class="xg-toolbar" role="toolbar" aria-label="Graph navigation">
        <button type="button" class="btn" data-testid="graph-zoom-out" aria-label="Zoom out" :disabled="k <= MIN_K + 1e-6" @click="zoomOut">−</button>
        <span class="xg-zoom" data-testid="graph-zoom" aria-live="polite">{{ Math.round(k * 100) }}%</span>
        <button type="button" class="btn" data-testid="graph-zoom-in" aria-label="Zoom in" :disabled="k >= MAX_K - 1e-6" @click="zoomIn">+</button>
        <button type="button" class="btn" data-testid="graph-fit" @click="fit">Fit to view</button>
        <button type="button" class="btn" data-testid="graph-reset" :disabled="Math.abs(k - 1) < 1e-6" @click="resetZoom">100%</button>
        <button type="button" class="btn" data-testid="graph-reset-layout" @click="resetLayout">Reset layout</button>
        <button v-if="selectedKey !== null" type="button" class="btn btn-primary" data-testid="graph-clear" @click="clear">Clear selection</button>
      </div>
      <p class="muted xg-hint">Drag a node to move it · drag the background to pan · Ctrl + mouse wheel to zoom the graph. Moving nodes changes only this view.</p>

      <div class="xg-layout">
        <div
          ref="viewport"
          class="xg-viewport"
          :class="{ 'xg-panning': panning, 'xg-dragging': dragging !== null }"
          tabindex="0"
          role="region"
          aria-label="Execution graph: drag to pan, Ctrl + wheel to zoom"
          data-testid="graph-viewport"
          @pointerdown="onViewportDown"
          @pointermove="onViewportMove"
          @pointerup="onViewportUp"
          @pointercancel="onViewportUp"
          @wheel="onWheel"
          @keydown="onKeydown"
        >
          <svg class="xg-bg" aria-hidden="true" data-testid="graph-bg">
            <defs>
              <pattern id="xg-hex" :width="3 * HEX" :height="HEX_H" patternUnits="userSpaceOnUse" :patternTransform="hexTransform">
                <g class="xg-hex-line">
                  <path v-for="t in HEX_TILES" :key="`${t.x},${t.y}`" :d="hexPath" :transform="`translate(${t.x} ${t.y})`" />
                </g>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#xg-hex)" />
          </svg>

          <div class="xg-world" :style="worldStyle" :data-k="k" :data-tx="tx" :data-ty="ty" data-testid="graph-canvas">
            <svg class="xg-edges" width="1" height="1" aria-hidden="true">
              <defs>
                <linearGradient v-for="(e, i) in edges" :id="`xg-g-${i}`" :key="`g-${e.key}`" gradientUnits="userSpaceOnUse" :x1="e.p0.x" :y1="e.p0.y" :x2="e.p1.x" :y2="e.p1.y">
                  <stop offset="0" stop-color="#5ee6ff" stop-opacity="0.6" />
                  <stop offset="1" stop-color="#5ee6ff" stop-opacity="0.22" />
                </linearGradient>
              </defs>
              <template v-for="(e, i) in edges" :key="e.key">
                <path
                  :d="e.d"
                  class="xg-edge"
                  :class="{ 'xg-edge-hot': related.edgeKeys.has(e.key), 'xg-edge-dim': selectedKey !== null && !related.edgeKeys.has(e.key), 'xg-edge-blocked': e.blocked }"
                  :style="related.edgeKeys.has(e.key) ? undefined : { stroke: `url(#xg-g-${i})` }"
                  :data-from="e.from"
                  :data-to="e.to"
                  data-testid="graph-edge"
                />
                <path
                  v-if="showFlow && !(selectedKey !== null && !related.edgeKeys.has(e.key))"
                  :d="e.d"
                  class="xg-edge-flow"
                  :style="{ '--e': String(i) }"
                  data-testid="graph-edge-flow"
                />
              </template>
            </svg>
            <!-- Where a line meets a node's border: a small glowing dot, above the tiles. -->
            <svg class="xg-edge-dots" width="1" height="1" aria-hidden="true">
              <template v-for="e in edges" :key="`d-${e.key}`">
                <circle class="xg-edge-dot" :class="{ 'xg-edge-dot-dim': selectedKey !== null && !related.edgeKeys.has(e.key) }" :cx="e.p0.x" :cy="e.p0.y" r="3" data-testid="graph-edge-dot" />
                <circle class="xg-edge-dot" :class="{ 'xg-edge-dot-dim': selectedKey !== null && !related.edgeKeys.has(e.key) }" :cx="e.p1.x" :cy="e.p1.y" r="3" data-testid="graph-edge-dot" />
              </template>
            </svg>

            <div v-for="h in auto.hubs" :key="h.key" class="xg-hub" :style="{ left: `${h.x - h.r}px`, top: `${h.y - h.r}px`, width: `${h.r * 2}px`, height: `${h.r * 2}px` }" data-testid="graph-group"><span>{{ h.text }}</span></div>

            <template v-for="p in graph.phases" :key="p.key">
              <!-- Decoration only, for the confirmed CURRENT phase: a soft glow. Never clickable, never part of the layout. -->
              <svg
                v-if="p.current"
                class="xg-aura xg-aura-current"
                :class="{ 'xg-aura-selected': selectedKey === p.key, 'xg-dim': selectedKey !== null && !related.keys.has(p.key) }"
                :style="auraStyle(p.key)"
                :viewBox="`${-AURA_PAD} ${-AURA_PAD} ${2 * PHASE_R + 2 * AURA_PAD} ${2 * PHASE_R + 2 * AURA_PAD}`"
                aria-hidden="true"
                data-testid="graph-aura"
              >
                <circle class="xg-aura-glow" :cx="PHASE_R" :cy="PHASE_R" :r="PHASE_R - 14" />
              </svg>
              <button
                type="button"
                class="xg-node xg-phase"
                :class="{ 'xg-current': p.current, 'xg-selected': selectedKey === p.key, 'xg-related': related.keys.has(p.key) && selectedKey !== p.key, 'xg-dim': selectedKey !== null && !related.keys.has(p.key), 'xg-moving': dragging === p.key }"
                :style="nodeStyle(p.key, phaseColor(p))"
                :aria-pressed="selectedKey === p.key"
                :title="phaseHeading(p)"
                :data-key="p.key"
                :data-phase-id="p.id ?? undefined"
                data-testid="graph-phase"
                @pointerdown="onNodeDown($event, p.key)"
                @pointermove="onNodeMove($event, p.key)"
                @pointerup="onNodeUp($event, p.key)"
                @pointercancel="onNodeUp($event, p.key)"
                @click="onNodeClick(p.key)"
              >
                <!-- A transparent disc and three thin rings. Only the current phase's rings turn (slowly, in opposite directions). -->
                <svg class="xg-rings" :viewBox="`0 0 ${2 * PHASE_R} ${2 * PHASE_R}`" aria-hidden="true" data-testid="graph-rings">
                  <circle class="xg-disc" :cx="PHASE_R" :cy="PHASE_R" r="104" />
                  <circle class="xg-ring-static" :cx="PHASE_R" :cy="PHASE_R" r="114" />
                  <circle class="xg-ring xg-ring-ticks" :cx="PHASE_R" :cy="PHASE_R" r="124" stroke-dasharray="2 6" />
                  <circle class="xg-ring xg-ring-arcs rev" :cx="PHASE_R" :cy="PHASE_R" r="133" stroke-dasharray="72 16 34 16" />
                </svg>
                <span class="xg-content">
                  <span class="xg-kind">PHASE<span v-if="p.current" class="tag" data-testid="graph-current-phase">CURRENT</span></span>
                  <span class="xg-title"><span class="xg-id">{{ p.id === null ? 'Phase (no id)' : `Phase ${p.id}` }}</span><template v-if="p.title !== null"> · {{ p.title }}</template></span>
                  <span class="xg-status" :class="{ 'status-unrecognized': !p.status.recognized }" data-testid="graph-status"><i class="xg-dot" :class="dotClass(p.status, p.current)" aria-hidden="true"></i>{{ statusLabel(p.status) }}</span>
                  <span class="xg-meta">
                    <span v-if="p.storyKeys.length > 0" class="xg-count">{{ p.storyKeys.length }} {{ p.storyKeys.length === 1 ? 'story' : 'stories' }}</span>
                    <span v-if="p.duplicateId" class="diag-badge">▲ DUPLICATE ID</span>
                    <span v-if="p.diagnostics.length > 0" class="diag-badge" data-testid="graph-diag-badge">▲ {{ p.diagnostics.length }} {{ p.diagnostics.length === 1 ? 'DIAG' : 'DIAGS' }}</span>
                  </span>
                </span>
              </button>
            </template>

            <button
              v-for="s in graph.stories"
              :key="s.key"
              type="button"
              class="xg-node xg-story"
              :class="{ 'xg-current': s.current, 'xg-selected': selectedKey === s.key, 'xg-related': related.keys.has(s.key) && selectedKey !== s.key, 'xg-dim': selectedKey !== null && !related.keys.has(s.key), 'xg-unlinked': s.phaseKey === null, 'xg-moving': dragging === s.key }"
              :style="nodeStyle(s.key, storyColor(s))"
              :aria-pressed="selectedKey === s.key"
              :title="s.title === null ? s.id : `${s.id} · ${s.title}`"
              :data-key="s.key"
              :data-story-id="s.id"
              data-testid="graph-story"
              @pointerdown="onNodeDown($event, s.key)"
              @pointermove="onNodeMove($event, s.key)"
              @pointerup="onNodeUp($event, s.key)"
              @pointercancel="onNodeUp($event, s.key)"
              @click="onNodeClick(s.key)"
            >
              <span class="xg-bar" aria-hidden="true"></span>
              <span class="xg-kind">STORY<span v-if="s.current" class="tag" data-testid="graph-current-story">CURRENT</span></span>
              <span class="xg-title"><span class="xg-id">{{ s.id }}</span><template v-if="s.title !== null"> · {{ s.title }}</template></span>
              <span class="xg-meta">
                <span class="xg-status" :class="{ 'status-unrecognized': !s.status.recognized }" data-testid="graph-status"><i class="xg-dot" :class="dotClass(s.status, s.current)" aria-hidden="true"></i>{{ statusLabel(s.status) }}</span>
                <span v-if="s.diagnostics.length > 0" class="diag-badge" data-testid="graph-diag-badge">▲ {{ s.diagnostics.length }} {{ s.diagnostics.length === 1 ? 'DIAG' : 'DIAGS' }}</span>
              </span>
            </button>

            <button
              v-for="c in graph.currentOutside"
              :key="c.key"
              type="button"
              class="xg-node xg-story xg-current xg-outside"
              :class="{ 'xg-selected': selectedKey === c.key, 'xg-dim': selectedKey !== null && selectedKey !== c.key, 'xg-moving': dragging === c.key }"
              :style="nodeStyle(c.key, AMBER)"
              :aria-pressed="selectedKey === c.key"
              :data-key="c.key"
              :data-story-id="c.id"
              data-testid="graph-current-outside"
              @pointerdown="onNodeDown($event, c.key)"
              @pointermove="onNodeMove($event, c.key)"
              @pointerup="onNodeUp($event, c.key)"
              @pointercancel="onNodeUp($event, c.key)"
              @click="onNodeClick(c.key)"
            >
              <span class="xg-bar" aria-hidden="true"></span>
              <span class="xg-kind">STORY<span class="tag" data-testid="graph-current-story">CURRENT</span></span>
              <span class="xg-title"><span class="xg-id">{{ c.id }}</span></span>
              <span class="xg-meta"><span class="xg-status"><i class="xg-dot dot-current" aria-hidden="true"></i>NOT IN INDEX</span></span>
            </button>
          </div>
        </div>

        <aside class="xg-details" aria-live="polite" data-testid="graph-details">
          <p v-if="selectedKey === null" class="muted" data-testid="graph-details-empty">Select a phase or a story to see its details. Press Escape to clear the selection.</p>

          <template v-else-if="selectedPhase">
            <h3>{{ phaseHeading(selectedPhase) }}</h3>
            <dl class="xg-dl">
              <dt>Kind</dt><dd>Phase</dd>
              <dt>Id</dt><dd data-testid="detail-id">{{ selectedPhase.id ?? 'not stated' }}</dd>
              <dt>Title</dt><dd>{{ selectedPhase.title ?? 'not stated' }}</dd>
              <dt>Status</dt>
              <dd data-testid="detail-status">{{ selectedPhase.status.value ?? 'STATUS NOT STATED' }} <span class="prov">REPORTED</span>
                <span v-if="selectedPhase.status.value !== null && !selectedPhase.status.recognized" class="diag-badge">UNRECOGNIZED</span></dd>
              <dt>Current phase</dt>
              <dd data-testid="detail-current">{{ selectedPhase.current ? 'Yes — named by the roadmap\'s active-phase pointer' : 'No' }}</dd>
              <dt>Linked stories</dt>
              <dd data-testid="detail-linked">{{ selectedPhase.storyKeys.length }} confirmed by the story index<template v-if="graph.roadmapReliable === false"> (roadmap not fully read)</template></dd>
            </dl>
            <p class="muted xg-note">Only finished stories appear in the story index, so a phase may have more stories than are shown.</p>
            <p v-if="selectedPhase.duplicateId" class="xg-warn" data-testid="detail-duplicate">This phase id occurs more than once in the roadmap; no link is drawn to it.</p>
            <ul v-if="selectedPhase.diagnostics.length > 0" class="diag" data-testid="detail-diagnostics">
              <li v-for="(c, i) in selectedPhase.diagnostics" :key="i" class="sev-warning">{{ ROADMAP_DIAGNOSTIC_LABELS[c] }}</li>
            </ul>
          </template>

          <template v-else-if="selectedStory">
            <h3>{{ selectedStory.id }}<template v-if="selectedStory.title !== null"> · {{ selectedStory.title }}</template></h3>
            <dl class="xg-dl">
              <dt>Kind</dt><dd>Story</dd>
              <dt>Id</dt><dd data-testid="detail-id">{{ selectedStory.id }}<span v-if="selectedStory.idCount > 1" class="diag-badge"> DECLARED {{ selectedStory.idCount }}×</span></dd>
              <dt>Title</dt><dd>{{ selectedStory.title ?? 'not stated' }}</dd>
              <dt>Status</dt>
              <dd data-testid="detail-status">{{ selectedStory.status.value ?? 'STATUS NOT STATED' }} <span class="prov">REPORTED</span>
                <span v-if="selectedStory.status.value !== null && !selectedStory.status.recognized" class="diag-badge">UNRECOGNIZED</span></dd>
              <dt v-if="selectedStory.date !== null">Date</dt><dd v-if="selectedStory.date !== null">{{ selectedStory.date }}</dd>
              <dt>Provenance</dt><dd data-testid="detail-provenance">REPORTED — the story index's own claim; not independently verified</dd>
              <dt>Current story</dt><dd>{{ selectedStory.current ? 'Yes — named by active.md' : 'No' }}</dd>
              <dt>Phase relation</dt><dd data-testid="detail-phase-relation">{{ phaseRelation(selectedStory) }}</dd>
              <dt v-if="phaseTitleOf(selectedStory.phaseKey) !== null">Linked phase</dt>
              <dd v-if="phaseTitleOf(selectedStory.phaseKey) !== null" data-testid="detail-phase">{{ phaseTitleOf(selectedStory.phaseKey) }}</dd>
            </dl>
            <p v-if="selectedStory.idCount > 1" class="xg-warn" data-testid="detail-duplicate">This story id is declared {{ selectedStory.idCount }} times in the story index; no entry is treated as the one story, and no link is drawn.</p>
            <p v-if="roadmapStateNote() !== null && selectedStory.phaseKey === null" class="muted xg-note">{{ roadmapStateNote() }}</p>
            <ul v-if="selectedStory.diagnostics.length > 0" class="diag" data-testid="detail-diagnostics">
              <li v-for="(c, i) in selectedStory.diagnostics" :key="i" class="sev-warning">{{ STORY_DIAGNOSTIC_LABELS[c] }}</li>
            </ul>
          </template>

          <template v-else-if="selectedCurrent">
            <h3>{{ selectedCurrent.id }}</h3>
            <dl class="xg-dl">
              <dt>Kind</dt><dd>Story</dd>
              <dt>Id</dt><dd data-testid="detail-id">{{ selectedCurrent.id }}</dd>
              <dt>Status</dt><dd data-testid="detail-status">Current story per active.md — not completed</dd>
              <dt>Phase relation</dt><dd data-testid="detail-phase-relation">None: the story is not in the story index, so no phase is assigned and no link is drawn.</dd>
            </dl>
          </template>

          <button v-if="selectedKey !== null" type="button" class="btn" data-testid="graph-details-clear" @click="clear">Clear selection</button>
        </aside>
      </div>
    </template>
  </section>
</template>
