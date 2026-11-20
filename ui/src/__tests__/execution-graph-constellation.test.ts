import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import ExecutionGraphPanel from '../components/ExecutionGraphPanel.vue';
import { HUB_R, PHASE_H, PHASE_R, PHASE_W, STORY_H, STORY_W, edgePoint, layoutGraph, routeEdges } from '../graph/layout';
import type { Box } from '../graph/layout';
import { UNLINKED_LABELS, projectExecutionGraph } from '../graph/projection';
import { parseRoadmapPhases } from '../../../src/readmodel/roadmap';
import { parseStoryIndex } from '../../../src/readmodel/story-index';
import type { Section, StructuredStoryIndexView } from '../../../src/readmodel/types';

// ---- builders (Core's real parsers) ----
function roadmapDoc(n: number, active?: number): string {
  const body = Array.from({ length: n }, (_, i) => `### Phase ${i + 1} — Title ${i + 1}\n\n**Status:** COMPLETED\n`).join('\n');
  return `## Phases\n\n${body}\n## Current Focus\n\n${active === undefined ? '' : `Active Phase: ${active} — x\n`}`;
}
/** counts[i] = stories in phase i+1; `extra` adds unlinked stories (unknown phase 999 and outside any phase). */
function storyDoc(counts: number[], extra = { unmatched: 0, outside: 0 }): string {
  const parts: string[] = [];
  if (extra.outside > 0) parts.push(Array.from({ length: extra.outside }, (_, k) => `### O-${k + 1} — outside\n\n**Status:** COMPLETED\n`).join('\n'));
  parts.push(...counts.map((c, i) => `## Phase ${i + 1} — N\n\n${Array.from({ length: c }, (_, k) => `### S-${i + 1}-${k + 1} — Story ${k + 1} of phase ${i + 1}\n\n**Status:** COMPLETED\n`).join('\n')}`));
  if (extra.unmatched > 0) parts.push(`## Phase 999 — Ghost\n\n${Array.from({ length: extra.unmatched }, (_, k) => `### U-${k + 1} — lost\n\n**Status:** COMPLETED\n`).join('\n')}`);
  return parts.join('\n');
}
const SRC = { id: 'storyIndex' as const, path: 'x', status: 'available' as const, code: null };
function build(counts: number[], extra?: { unmatched: number; outside: number }, active?: number) {
  const text = roadmapDoc(counts.length, active);
  const roadmap = parseRoadmapPhases(text);
  const ids = roadmap.phases.flatMap((p) => (p.id === null ? [] : [p.id]));
  const storyIndex: Section<StructuredStoryIndexView> = { data: parseStoryIndex(storyDoc(counts, extra), ids, true), sources: [SRC] };
  return { text, roadmap, storyIndex };
}
function project(counts: number[], extra?: { unmatched: number; outside: number }) {
  const b = build(counts, extra);
  return projectExecutionGraph({ roadmapText: b.text, roadmap: b.roadmap, storyIndex: b.storyIndex, story: { kind: 'active', ids: ['CUR-1'], excerpt: null } });
}
function boxes(counts: number[], extra?: { unmatched: number; outside: number }) {
  const g = project(counts, extra);
  const l = layoutGraph(g, (r) => UNLINKED_LABELS[r]);
  const m = new Map<string, Box>();
  for (const [k, p] of l.pos) m.set(k, { ...p, ...l.size.get(k)! });
  return { g, l, m };
}
/** Boxes overlap as rectangles; a phase (round) is a disc, so it is tested as one. */
const overlaps = (a: Box, b: Box, pad = 0): boolean => {
  if (a.round === true && b.round === true) return Math.hypot(a.x - b.x, a.y - b.y) < (a.w + b.w) / 2 + pad;
  if (a.round === true || b.round === true) {
    const [d, r] = a.round === true ? [a, b] : [b, a];
    const nx = Math.max(r.x - r.w / 2, Math.min(d.x, r.x + r.w / 2));
    const ny = Math.max(r.y - r.h / 2, Math.min(d.y, r.y + r.h / 2));
    return Math.hypot(d.x - nx, d.y - ny) < d.w / 2 + pad;
  }
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad;
};

const CONFIGS: Array<[string, number[], { unmatched: number; outside: number }?]> = [
  ['one phase, one story', [1]],
  ['one phase, 5 stories', [5]],
  ['one phase, 30 stories (several rings)', [30]],
  ['5 mixed phases', [3, 0, 9, 1, 14]],
  ['12 phases with 0..11 stories', Array.from({ length: 12 }, (_, i) => i)],
  ['linked + unlinked groups', [4, 6], { unmatched: 7, outside: 5 }],
  ['100 phases (row packing)', Array.from({ length: 100 }, (_, i) => i % 6)],
];

describe('Constellation layout', () => {
  it('places satellites around their phase on a ring, at equal distance, never on top of the star', () => {
    const { g, m } = boxes([5]);
    const star = m.get('phase:0')!;
    const d = g.phases[0]!.storyKeys.map((k) => Math.hypot(m.get(k)!.x - star.x, m.get(k)!.y - star.y));
    expect(d).toHaveLength(5);
    for (const x of d) expect(x).toBeCloseTo(d[0]!, 6);
    expect(d[0]!).toBeGreaterThan(Math.hypot(PHASE_W, PHASE_H) / 2);
    // Around, not in a row: the angles are spread over the full circle.
    const angles = g.phases[0]!.storyKeys.map((k) => Math.atan2(m.get(k)!.y - star.y, m.get(k)!.x - star.x));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI);
  });

  it.each(CONFIGS)('has no overlapping nodes: %s', (_n, counts, extra) => {
    const { m } = boxes(counts, extra);
    const list = [...m.values()];
    const bad: string[] = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (overlaps(list[i]!, list[j]!)) bad.push(`${i}/${j}`);
    expect(bad).toEqual([]);
  });

  it.each(CONFIGS)('keeps clusters apart: the discs that enclose each phase with its satellites never intersect: %s', (_n, counts, extra) => {
    const { g, m } = boxes(counts, extra);
    const half = Math.hypot(STORY_W, STORY_H) / 2;
    const discs = g.phases.map((p) => {
      const c = m.get(p.key)!;
      const r = Math.max(PHASE_R, ...p.storyKeys.map((k) => Math.hypot(m.get(k)!.x - c.x, m.get(k)!.y - c.y) + half));
      return { c, r };
    });
    const bad: string[] = [];
    for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
      if (Math.hypot(discs[i]!.c.x - discs[j]!.c.x, discs[i]!.c.y - discs[j]!.c.y) < discs[i]!.r + discs[j]!.r) bad.push(`${i}/${j}`);
    }
    expect(bad).toEqual([]);
  });

  it('puts unlinked stories into separate labelled clusters, apart from every phase cluster', () => {
    const { g, l, m } = boxes([4, 6], { unmatched: 7, outside: 5 });
    expect(l.hubs.map((h) => h.text)).toEqual([
      `${UNLINKED_LABELS.unmatched} (7)`,
      `${UNLINKED_LABELS.outside} (5)`,
      'Current story — not in the story index',
    ]);
    for (const h of l.hubs) {
      for (const [k, b] of m) if (!k.startsWith('story:') || g.stories.find((s) => s.key === k)?.phaseKey !== null) expect(Math.hypot(b.x - h.x, b.y - h.y)).toBeGreaterThan(HUB_R + Math.min(STORY_W, STORY_H) / 2);
    }
  });

  it('is deterministic and does not depend on the number of stories being five', () => {
    const a = boxes([2, 17, 3]).l;
    const b = boxes([2, 17, 3]).l;
    expect([...a.pos]).toEqual([...b.pos]);
    expect(boxes([40]).m.size).toBe(42);
  });
});

describe('Constellation edges', () => {
  it.each(CONFIGS)('no edge touches a foreign node and all edges meet node borders: %s', (_n, counts, extra) => {
    const { g, m } = boxes(counts, extra);
    const laid = routeEdges(g.edges, m);
    expect(laid).toHaveLength(g.edges.length);
    const crossings: string[] = [];
    const notOnBorder: string[] = [];
    const list = [...m.entries()];
    for (const e of laid) {
      if (e.blocked) crossings.push(`${e.key} blocked`);
      for (let i = 1; i < 120; i++) {
        const p = edgePoint(e, i / 120);
        for (const [k, b] of list) if (k !== e.from && k !== e.to && overlaps({ x: p.x, y: p.y, w: 0, h: 0 }, b)) crossings.push(`${e.key} crosses ${k}`);
      }
      // endpoints sit on the borders of their own nodes, not at their centres (and not over their text)
      const a = m.get(e.from)!;
      const b = m.get(e.to)!;
      const onBorder = (p: { x: number; y: number }, r: Box) =>
        r.round === true
          ? Math.abs(Math.hypot(p.x - r.x, p.y - r.y) - r.w / 2) < 1e-6
          : Math.abs(Math.abs(p.x - r.x) - r.w / 2) < 1e-6 || Math.abs(Math.abs(p.y - r.y) - r.h / 2) < 1e-6;
      if (!onBorder(e.p0, a) || !onBorder(e.p1, b)) notOnBorder.push(e.key);
    }
    expect(crossings).toEqual([]);
    expect(notOnBorder).toEqual([]);
  });

  it('bends around a node that was moved into the way, and reports it when it cannot', () => {
    const m = new Map<string, Box>([
      ['a', { x: 0, y: 0, w: 100, h: 50 }],
      ['b', { x: 600, y: 0, w: 100, h: 50 }],
      ['x', { x: 300, y: 0, w: 100, h: 50 }],
    ]);
    const [e] = routeEdges([{ key: 'a>b', from: 'a', to: 'b' }], m);
    expect(e!.c).not.toBeNull();
    expect(e!.blocked).toBe(false);
    for (let i = 1; i < 40; i++) expect(overlaps({ ...edgePoint(e!, i / 40), w: 0, h: 0 }, m.get('x')!)).toBe(false);
    // Walled in on every side: no clear route exists, the edge says so (it is drawn dashed) instead of pretending.
    const walls = new Map(m);
    for (let i = 0; i < 12; i++) walls.set(`w${i}`, { x: 300, y: -500 + i * 100, w: 100, h: 100 });
    expect(routeEdges([{ key: 'a>b', from: 'a', to: 'b' }], walls)[0]!.blocked).toBe(true);
  });
});

describe('Hexagonal background', () => {
  it('is a regular, seamless honeycomb tile', () => {
    const w = mountPanel([2]);
    const pat = w.get('pattern');
    const W = Number(pat.attributes('width'));
    const H = Number(pat.attributes('height'));
    const S = W / 3;
    expect(H).toBeCloseTo(Math.sqrt(3) * S, 6);
    const segs = [...pat.get('path').attributes('d')!.matchAll(/M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)/g)].map((m) => m.slice(1).map(Number) as [number, number, number, number]);
    expect(segs.length).toBeGreaterThan(5);
    // every segment is a full hexagon side, or the half of one that the tile border cuts
    for (const [x1, y1, x2, y2] of segs) expect([S, S / 2].some((l) => Math.abs(Math.hypot(x2 - x1, y2 - y1) - l) < 1e-6)).toBe(true);
    // seamless: what leaves the tile on one side re-enters at the same place on the opposite side
    const pts = segs.flatMap(([x1, y1, x2, y2]) => [[x1, y1], [x2, y2]] as const);
    const at = (f: (p: readonly number[]) => boolean, g: (p: readonly number[]) => number) => [...new Set(pts.filter(f).map(g).map((v) => v.toFixed(4)))].sort();
    expect(at((p) => Math.abs(p[0]!) < 1e-9, (p) => p[1]!)).toEqual(at((p) => Math.abs(p[0]! - W) < 1e-9, (p) => p[1]!));
    expect(at((p) => Math.abs(p[1]!) < 1e-9, (p) => p[0]!)).toEqual(at((p) => Math.abs(p[1]! - H) < 1e-9, (p) => p[0]!));
  });

  it('follows the camera: it pans and scales together with the graph', async () => {
    const w = mountPanel([2]);
    const vp = w.get('[data-testid="graph-viewport"]');
    await vp.trigger('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    await vp.trigger('pointermove', { clientX: 60, clientY: 40, pointerId: 1 });
    await vp.trigger('pointerup', { clientX: 60, clientY: 40, pointerId: 1 });
    expect(w.get('pattern').attributes('patternTransform')).toBe('translate(50 30) scale(1)');
  });
});

// ---- component ----
function mountPanel(counts: number[], extra?: { unmatched: number; outside: number }, story?: { ids: string[] }) {
  const b = build(counts, extra, 1);
  return mount(ExecutionGraphPanel, {
    props: { roadmapText: b.text, roadmap: b.roadmap, storyIndex: b.storyIndex, story: story === undefined ? undefined : { kind: 'active', ids: story.ids, excerpt: null } },
    attachTo: document.body,
  });
}
afterEach(() => document.body.replaceChildren());

const px = (v: string) => parseFloat(v);
const pos = (w: VueWrapper, testid: string, i = 0) => {
  const st = (w.findAll(`[data-testid="${testid}"]`)[i]!.element as HTMLElement).style;
  return { x: px(st.left), y: px(st.top) };
};
const edgeD = (w: VueWrapper) => w.findAll('[data-testid="graph-edge"]').map((e) => e.attributes('d'));
const cam = (w: VueWrapper) => {
  const a = w.get('[data-testid="graph-canvas"]').attributes();
  return { k: Number(a['data-k']), tx: Number(a['data-tx']), ty: Number(a['data-ty']) };
};
async function drag(w: VueWrapper, testid: string, i: number, dx: number, dy: number) {
  const n = w.findAll(`[data-testid="${testid}"]`)[i]!;
  await n.trigger('pointerdown', { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
  await n.trigger('pointermove', { clientX: 300 + dx, clientY: 300 + dy, pointerId: 1 });
  await n.trigger('pointerup', { clientX: 300 + dx, clientY: 300 + dy, pointerId: 1 });
}
async function sizeViewport(w: VueWrapper, width: number, height: number) {
  await new Promise((r) => setTimeout(r, 0)); // let the initial fit (skipped without layout) happen first
  const el = w.get('[data-testid="graph-viewport"]').element;
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
}

describe('Dragging nodes', () => {
  it('moves a Phase with the pointer; its edges follow; other nodes stay', async () => {
    const w = mountPanel([3, 2]);
    const before = { p0: pos(w, 'graph-phase', 0), p1: pos(w, 'graph-phase', 1), s: pos(w, 'graph-story', 0) };
    const d0 = edgeD(w);
    await drag(w, 'graph-phase', 0, 80, 40);
    const after = pos(w, 'graph-phase', 0);
    expect(after.x).toBeCloseTo(before.p0.x + 80, 6);
    expect(after.y).toBeCloseTo(before.p0.y + 40, 6);
    expect(pos(w, 'graph-phase', 1)).toEqual(before.p1);
    expect(pos(w, 'graph-story', 0)).toEqual(before.s);
    const d1 = edgeD(w);
    expect(d1).toHaveLength(d0.length);
    // all three edges of phase 1 changed; the two of phase 2 did not
    expect(d1.map((d, i) => d !== d0[i])).toEqual([true, true, true, false, false]);
  });

  it('moves a Story; only its edge follows', async () => {
    const w = mountPanel([3, 2]);
    const before = pos(w, 'graph-story', 1);
    const d0 = edgeD(w);
    await drag(w, 'graph-story', 1, -60, 90);
    const after = pos(w, 'graph-story', 1);
    expect(after.x).toBeCloseTo(before.x - 60, 6);
    expect(after.y).toBeCloseTo(before.y + 90, 6);
    expect(edgeD(w).map((d, i) => d !== d0[i])).toEqual([false, true, false, false, false]);
  });

  it('keeps the edge on the node borders after a move (no line over the cards)', async () => {
    const w = mountPanel([2]);
    await drag(w, 'graph-story', 0, 200, -150);
    const e = w.get('[data-testid="graph-edge"]').attributes('d')!;
    const [x0, y0, x1, y1] = e.match(/-?[\d.]+/g)!.map(Number) as [number, number, number, number, ...number[]];
    const ph = pos(w, 'graph-phase', 0);
    const st = pos(w, 'graph-story', 0);
    const inBox = (x: number, y: number, p: { x: number; y: number }, bw: number, bh: number) => x > p.x + 0.5 && x < p.x + bw - 0.5 && y > p.y + 0.5 && y < p.y + bh - 0.5;
    // the phase end is on the outer ring (a circle), not inside the disc
    expect(Math.hypot(x0 - (ph.x + PHASE_R), y0 - (ph.y + PHASE_R))).toBeGreaterThanOrEqual(PHASE_R - 0.5);
    expect(inBox(x1 ?? 0, y1 ?? 0, st, STORY_W, STORY_H)).toBe(false);
  });

  it('draws edges below the cards (they live in an earlier layer)', () => {
    const w = mountPanel([2]);
    const world = w.get('[data-testid="graph-canvas"]').element;
    const kids = [...world.children];
    expect(kids.indexOf(world.querySelector('svg.xg-edges')!)).toBeLessThan(kids.indexOf(world.querySelector('.xg-node')!));
  });

  it('a click selects, a drag does not; the click after a drag is swallowed once', async () => {
    const w = mountPanel([2]);
    const s = () => w.findAll('[data-testid="graph-story"]')[0]!;
    // tiny wobble below the threshold = a click
    await s().trigger('pointerdown', { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    await s().trigger('pointermove', { clientX: 102, clientY: 101, pointerId: 1 });
    await s().trigger('pointerup', { clientX: 102, clientY: 101, pointerId: 1 });
    await s().trigger('click');
    expect(s().classes()).toContain('xg-selected');
    await s().trigger('click');
    expect(s().classes()).not.toContain('xg-selected');
    const before = pos(w, 'graph-story', 0);
    expect(before).toEqual(pos(w, 'graph-story', 0)); // the wobble did not move it
    // real drag, then the browser's click
    await drag(w, 'graph-story', 0, 50, 50);
    await s().trigger('click');
    expect(s().classes()).not.toContain('xg-selected');
    expect(w.find('[data-testid="graph-details-empty"]').exists()).toBe(true);
    // the next genuine click works again
    await new Promise((r) => setTimeout(r, 5));
    await s().trigger('click');
    expect(s().classes()).toContain('xg-selected');
  });

  it('selection and the details panel keep working for a moved node', async () => {
    const w = mountPanel([2]);
    await drag(w, 'graph-story', 0, 30, 30);
    await new Promise((r) => setTimeout(r, 5));
    await w.findAll('[data-testid="graph-story"]')[0]!.trigger('click');
    expect(w.get('[data-testid="detail-phase-relation"]').text()).toContain('Matched');
    expect(w.find('[data-testid="graph-details"]').exists()).toBe(true);
  });

  it('moves a node by 1/zoom of the pointer distance when zoomed', async () => {
    const w = mountPanel([1]);
    await w.get('[data-testid="graph-zoom-in"]').trigger('click');
    const k = cam(w).k;
    expect(k).toBeCloseTo(1.25, 6);
    const b = pos(w, 'graph-story', 0);
    await drag(w, 'graph-story', 0, 100, 0);
    expect(pos(w, 'graph-story', 0).x).toBeCloseTo(b.x + 100 / k, 6);
  });

  it('changes nothing outside the view: no request, no mutation of props', async () => {
    const b = build([2]);
    const snap = JSON.stringify([b.roadmap, b.storyIndex]);
    const w = mount(ExecutionGraphPanel, { props: { roadmapText: b.text, roadmap: b.roadmap, storyIndex: b.storyIndex }, attachTo: document.body });
    await drag(w, 'graph-story', 0, 70, 70);
    expect(JSON.stringify([b.roadmap, b.storyIndex])).toBe(snap);
  });
});

describe('Panning the canvas', () => {
  it('drags the whole canvas on a press on empty space; no node moves', async () => {
    const w = mountPanel([2]);
    const before = pos(w, 'graph-story', 0);
    const vp = w.get('[data-testid="graph-viewport"]');
    await vp.trigger('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    await vp.trigger('pointermove', { clientX: 70, clientY: 50, pointerId: 1 });
    expect(vp.classes()).toContain('xg-panning');
    await vp.trigger('pointerup', { clientX: 70, clientY: 50, pointerId: 1 });
    expect(cam(w)).toMatchObject({ tx: 60, ty: 40 });
    expect(pos(w, 'graph-story', 0)).toEqual(before);
    expect(vp.classes()).not.toContain('xg-panning');
  });

  it('a press on a node never pans the canvas', async () => {
    const w = mountPanel([2]);
    await drag(w, 'graph-story', 0, 90, 90);
    expect(cam(w)).toMatchObject({ tx: 0, ty: 0 });
  });

  it('a click on empty space clears the selection, a pan does not', async () => {
    const w = mountPanel([2]);
    const vp = w.get('[data-testid="graph-viewport"]');
    await w.findAll('[data-testid="graph-story"]')[0]!.trigger('click');
    await vp.trigger('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    await vp.trigger('pointermove', { clientX: 60, clientY: 10, pointerId: 1 });
    await vp.trigger('pointerup', { clientX: 60, clientY: 10, pointerId: 1 });
    expect(w.find('[data-testid="graph-details-empty"]').exists()).toBe(false);
    await vp.trigger('pointerdown', { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    await vp.trigger('pointerup', { clientX: 10, clientY: 10, pointerId: 1 });
    expect(w.find('[data-testid="graph-details-empty"]').exists()).toBe(true);
  });

  it('ignores the right mouse button; arrow keys pan the focused canvas', async () => {
    const w = mountPanel([2]);
    const vp = w.get('[data-testid="graph-viewport"]');
    await vp.trigger('pointerdown', { clientX: 10, clientY: 10, button: 2, pointerId: 1 });
    await vp.trigger('pointermove', { clientX: 90, clientY: 10, pointerId: 1 });
    expect(cam(w).tx).toBe(0);
    await vp.trigger('keydown', { key: 'ArrowLeft' });
    expect(cam(w).tx).toBe(60);
  });
});

describe('Zoom', () => {
  const wheel = async (w: VueWrapper, init: WheelEventInit) => {
    const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    w.get('[data-testid="graph-viewport"]').element.dispatchEvent(ev);
    await nextTick();
    return ev;
  };

  it('Ctrl + wheel zooms the canvas and cancels the browser page zoom', async () => {
    const w = mountPanel([2]);
    const ev = await wheel(w, { ctrlKey: true, deltaY: -200, clientX: 100, clientY: 100 });
    expect(ev.defaultPrevented).toBe(true);
    expect(cam(w).k).toBeGreaterThan(1);
  });

  it('zooms out for a positive delta and stays within limits', async () => {
    const w = mountPanel([2]);
    await wheel(w, { ctrlKey: true, deltaY: 300, clientX: 0, clientY: 0 });
    expect(cam(w).k).toBeLessThan(1);
    for (let i = 0; i < 60; i++) await wheel(w, { ctrlKey: true, deltaY: 500, clientX: 0, clientY: 0 });
    expect(cam(w).k).toBeCloseTo(0.15, 6);
    for (let i = 0; i < 120; i++) await wheel(w, { ctrlKey: true, deltaY: -500, clientX: 0, clientY: 0 });
    expect(cam(w).k).toBeCloseTo(2.5, 6);
    await w.vm.$nextTick();
    expect(w.get('[data-testid="graph-zoom-in"]').attributes('disabled')).toBeDefined();
  });

  it('a plain wheel does not zoom and is not cancelled (the page scrolls)', async () => {
    const w = mountPanel([2]);
    const ev = await wheel(w, { deltaY: -200, clientX: 100, clientY: 100 });
    expect(ev.defaultPrevented).toBe(false);
    expect(cam(w).k).toBe(1);
  });

  it('zooms about the cursor: the world point under the pointer does not move', async () => {
    const w = mountPanel([3]);
    for (const [cx, cy, dy] of [[250, 120, -300], [40, 400, -150], [600, 90, 220]] as const) {
      const c0 = cam(w);
      const world = { x: (cx - c0.tx) / c0.k, y: (cy - c0.ty) / c0.k };
      await wheel(w, { ctrlKey: true, deltaY: dy, clientX: cx, clientY: cy });
      const c1 = cam(w);
      expect(c1.k).not.toBe(c0.k);
      expect((cx - c1.tx) / c1.k).toBeCloseTo(world.x, 6);
      expect((cy - c1.ty) / c1.k).toBeCloseTo(world.y, 6);
    }
  });

  it('only the graph canvas scales: the page, the details panel and the sidebar-side UI are not transformed', async () => {
    const w = mountPanel([2]);
    await wheel(w, { ctrlKey: true, deltaY: -400, clientX: 50, clientY: 50 });
    expect(w.get('[data-testid="graph-details"]').attributes('style')).toBeUndefined();
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(document.body.getAttribute('style')).toBeNull();
    expect(w.get('[data-testid="graph-viewport"]').attributes('style')).toBeUndefined();
    expect(w.get('[data-testid="graph-canvas"]').attributes('style')).toContain('scale(');
  });

  it('listens only inside the canvas: a Ctrl + wheel elsewhere in the panel is untouched', async () => {
    const w = mountPanel([2]);
    const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -200 });
    w.get('[data-testid="graph-details"]').element.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(cam(w).k).toBe(1);
  });

  it('buttons zoom about the centre; 100% resets the zoom', async () => {
    const w = mountPanel([2]);
    await sizeViewport(w, 800, 500);
    const c0 = { x: (400 - cam(w).tx) / cam(w).k, y: (250 - cam(w).ty) / cam(w).k };
    await w.get('[data-testid="graph-zoom-in"]').trigger('click');
    await w.get('[data-testid="graph-zoom-in"]').trigger('click');
    expect(w.get('[data-testid="graph-zoom"]').text()).toBe('156%');
    expect((400 - cam(w).tx) / cam(w).k).toBeCloseTo(c0.x, 6);
    await w.get('[data-testid="graph-zoom-out"]').trigger('click');
    await w.get('[data-testid="graph-reset"]').trigger('click');
    expect(cam(w).k).toBeCloseTo(1, 6);
    expect(w.get('[data-testid="graph-zoom"]').text()).toBe('100%');
  });
});

describe('Fit and Reset layout', () => {
  it('Fit to view brings every node into the viewport, centred', async () => {
    const w = mountPanel([6, 3, 9], { unmatched: 4, outside: 2 });
    await sizeViewport(w, 900, 600);
    await drag(w, 'graph-story', 0, 700, 700); // scatter one node far away
    await w.get('[data-testid="graph-fit"]').trigger('click');
    const { k, tx, ty } = cam(w);
    expect(k).toBeLessThan(1);
    for (const n of w.findAll('.xg-node')) {
      const st = (n.element as HTMLElement).style;
      const l = px(st.left) * k + tx;
      const t = px(st.top) * k + ty;
      expect(l).toBeGreaterThanOrEqual(-0.5);
      expect(t).toBeGreaterThanOrEqual(-0.5);
      expect(l + px(st.width) * k).toBeLessThanOrEqual(900.5);
      expect(t + px(st.height) * k).toBeLessThanOrEqual(600.5);
    }
  });

  it('Reset layout restores the automatic positions and keeps all data and the selection', async () => {
    const w = mountPanel([3, 2], undefined, { ids: ['CUR-1'] });
    await sizeViewport(w, 900, 600);
    const orig = [pos(w, 'graph-phase', 0), pos(w, 'graph-story', 2)];
    await drag(w, 'graph-phase', 0, 120, 80);
    await drag(w, 'graph-story', 2, -50, 60);
    expect(pos(w, 'graph-phase', 0)).not.toEqual(orig[0]);
    await new Promise((r) => setTimeout(r, 5));
    await w.findAll('[data-testid="graph-story"]')[3]!.trigger('click');
    await w.get('[data-testid="graph-reset-layout"]').trigger('click');
    expect([pos(w, 'graph-phase', 0), pos(w, 'graph-story', 2)]).toEqual(orig);
    expect(w.findAll('[data-testid="graph-story"]')).toHaveLength(5);
    expect(w.findAll('[data-testid="graph-edge"]')).toHaveLength(5);
    expect(w.findAll('[data-testid="graph-current-outside"]')).toHaveLength(1);
    expect(w.find('[data-testid="graph-details-empty"]').exists()).toBe(false);
  });

  it('a new snapshot keeps the positions of nodes that still exist and drops moved state of the gone ones', async () => {
    const b = build([3]);
    const w = mount(ExecutionGraphPanel, { props: { roadmapText: b.text, roadmap: b.roadmap, storyIndex: b.storyIndex }, attachTo: document.body });
    await drag(w, 'graph-story', 0, 40, 40);
    const moved = pos(w, 'graph-story', 0);
    const same = build([3]);
    await w.setProps({ roadmapText: same.text, roadmap: same.roadmap, storyIndex: same.storyIndex });
    expect(pos(w, 'graph-story', 0)).toEqual(moved);
    const fewer = build([1]);
    await w.setProps({ roadmapText: fewer.text, roadmap: fewer.roadmap, storyIndex: fewer.storyIndex });
    expect(w.findAll('[data-testid="graph-story"]')).toHaveLength(1);
  });
});

describe('Constellation keeps the data guarantees', () => {
  it('still draws only confirmed edges, keeps diagnostics and the current story', () => {
    const w = mountPanel([2], { unmatched: 2, outside: 1 }, { ids: ['CUR-1'] });
    expect(w.findAll('[data-testid="graph-edge"]')).toHaveLength(2);
    expect(w.findAll('[data-testid="graph-story"]')).toHaveLength(5);
    expect(w.findAll('[data-testid="graph-current-outside"]')).toHaveLength(1);
    expect(w.text()).toContain('Phase not found in the roadmap (2)');
    expect(w.text()).toContain('Not nested under any phase (1)');
  });

  it('one cyan accent; only the current story is amber; status is a small dot, not a badge', () => {
    const w = mountPanel([2], undefined, { ids: ['CUR-1'] });
    const c = (el: Element) => (el as HTMLElement).style.getPropertyValue('--c');
    expect(c(w.findAll('[data-testid="graph-phase"]')[0]!.element)).toBe('#5EE6FF');
    expect(c(w.findAll('[data-testid="graph-story"]')[0]!.element)).toBe('#5EE6FF');
    expect(c(w.get('[data-testid="graph-current-outside"]').element)).toBe('#FBBF24');
    const st = w.findAll('[data-testid="graph-story"]')[0]!;
    expect(st.find('.status-badge').exists()).toBe(false);
    expect(st.find('.xg-dot.dot-ok').exists()).toBe(true);
  });

  it('maps statuses to dots: completed green, in progress cyan, planned light blue, anything else grey; unknown stays visible', () => {
    const road = roadmapDoc(1);
    const idx = '## Phase 1 — N\n\n### A-1 — a\n**Status:** COMPLETED\n\n### A-2 — b\n**Status:** IN PROGRESS\n\n### A-3 — c\n**Status:** PLANNED\n\n### A-4 — d\n**Status:** Mystery\n\n### A-5 — e\n';
    const r = parseRoadmapPhases(road);
    const w = mount(ExecutionGraphPanel, { props: { roadmapText: road, roadmap: r, storyIndex: { data: parseStoryIndex(idx, ['1'], true), sources: [SRC] } }, attachTo: document.body });
    const dots = w.findAll('[data-testid="graph-story"]').map((n) => n.find('.xg-dot').classes().find((x) => x.startsWith('dot-')));
    expect(dots).toEqual(['dot-ok', 'dot-progress', 'dot-planned', 'dot-idle', 'dot-none']);
    expect(w.findAll('[data-testid="graph-story"]')[3]!.find('.status-unrecognized').exists()).toBe(true);
    expect(w.findAll('[data-testid="graph-story"]')[4]!.text()).toContain('STATUS NOT STATED');
  });

  it('keeps provenance off the graph (it lives in the details panel)', async () => {
    const w = mountPanel([1]);
    expect(w.get('[data-testid="graph-canvas"]').text()).not.toContain('REPORTED');
    await w.findAll('[data-testid="graph-story"]')[0]!.trigger('click');
    expect(w.get('[data-testid="detail-provenance"]').text()).toContain('REPORTED');
  });
});

describe('Node size (readability)', () => {
  const size = (el: Element) => {
    const st = (el as HTMLElement).style;
    return [px(st.width), px(st.height)];
  };

  it('uses the dimensions: Phase disc 270×270, Story 230×105, Current story like a Story', () => {
    expect([PHASE_W, PHASE_H, STORY_W, STORY_H, PHASE_R]).toEqual([270, 270, 230, 105, 135]);
    const w = mountPanel([2], undefined, { ids: ['CUR-1'] });
    expect(size(w.get('[data-testid="graph-phase"]').element)).toEqual([270, 270]);
    expect(size(w.get('[data-testid="graph-story"]').element)).toEqual([230, 105]);
    expect(size(w.get('[data-testid="graph-current-outside"]').element)).toEqual([230, 105]);
    expect(PHASE_W * PHASE_H).toBeGreaterThan(STORY_W * STORY_H * 2); // the star dominates
  });

  it('keeps satellites outside the star and nodes apart with the larger cards', () => {
    const { g, m } = boxes([6, 1]);
    for (const p of g.phases) {
      const star = m.get(p.key)!;
      for (const k of p.storyKeys) expect(overlaps(star, m.get(k)!, 20)).toBe(false);
    }
  });

  it('opens at 100% — the larger cards are not shrunk to fit — and Reset layout returns to it', async () => {
    const w = mountPanel([6, 6, 6]);
    await sizeViewport(w, 700, 400);
    await w.get('[data-testid="graph-reset-layout"]').trigger('click');
    expect(cam(w).k).toBe(1);
    // the graph does not fit 700×400 at 100%: it opens on the current phase (Phase 1), centred
    const ph = w.findAll('[data-testid="graph-phase"]')[0]!.element as HTMLElement;
    const cx = px(ph.style.left) + px(ph.style.width) / 2 + cam(w).tx;
    const cy = px(ph.style.top) + px(ph.style.height) / 2 + cam(w).ty;
    expect([Math.round(cx), Math.round(cy)]).toEqual([350, 200]);
    // Fit is still available as an explicit choice and does shrink
    await w.get('[data-testid="graph-fit"]').trigger('click');
    expect(cam(w).k).toBeLessThan(1);
  });

  it('centres a graph that fits at 100% instead of anchoring it to a phase', async () => {
    const w = mountPanel([1]);
    await sizeViewport(w, 1200, 900);
    await w.get('[data-testid="graph-reset-layout"]').trigger('click');
    expect(cam(w).k).toBe(1);
    const els = w.findAll('.xg-node').map((n) => n.element as HTMLElement);
    const left = Math.min(...els.map((e) => px(e.style.left))) + cam(w).tx;
    const right = Math.max(...els.map((e) => px(e.style.left) + px(e.style.width))) + cam(w).tx;
    expect(Math.abs(left - (1200 - right))).toBeLessThan(1);
  });
});

describe('Pointer capture robustness', () => {
  it('a vanished pointer (setPointerCapture throws) does not break dragging or panning', async () => {
    const w = mountPanel([2]);
    const boom = () => { throw new DOMException('No active pointer', 'NotFoundError'); };
    for (const el of [...w.findAll('.xg-node'), w.get('[data-testid="graph-viewport"]')]) {
      Object.assign(el.element, { setPointerCapture: boom, releasePointerCapture: boom });
    }
    const before = pos(w, 'graph-story', 0);
    await drag(w, 'graph-story', 0, 40, 40);
    expect(pos(w, 'graph-story', 0).x).toBeCloseTo(before.x + 40, 6);
    const vp = w.get('[data-testid="graph-viewport"]');
    await vp.trigger('pointerdown', { clientX: 5, clientY: 5, button: 0, pointerId: 1 });
    await vp.trigger('pointermove', { clientX: 35, clientY: 5, pointerId: 1 });
    await vp.trigger('pointerup', { clientX: 35, clientY: 5, pointerId: 1 });
    expect(cam(w).tx).toBe(30);
  });
});

describe('Phase disc with rings', () => {
  it('is a transparent disc inside rings; no octagon, no filled badge', () => {
    const w = mountPanel([2]);
    const rings = w.get('[data-testid="graph-rings"]');
    expect(rings.findAll('circle')).toHaveLength(4);
    expect(rings.find('.xg-disc').exists()).toBe(true);
    expect(rings.findAll('.xg-ring')).toHaveLength(2);
    expect(rings.find('.xg-ring-ticks').attributes('stroke-dasharray')).toBe('2 6'); // the ring with ticks
    expect(rings.find('.xg-ring-arcs').attributes('stroke-dasharray')).toMatch(/^\d+ \d+ \d+ \d+$/); // the ring with gaps
    expect(rings.find('polygon').exists()).toBe(false);
    for (const r of rings.findAll('circle')) expect(Number(r.attributes('r'))).toBeLessThanOrEqual(PHASE_R);
  });

  it('the phase is a circle for the pointer: round button, and its text block does not catch clicks in the corners', () => {
    const css = readFileSync(resolve(__dirname, '../styles/main.css'), 'utf8');
    expect(css).toMatch(/:root \.xg-viewport \.xg-phase[^{]*\{[^}]*border-radius: 50%/s);
    expect(css).toMatch(/\.xg-content \{ pointer-events: none;/);
    expect(css).toMatch(/\.xg-rings \{[^}]*pointer-events: none/s);
  });

  it('the outermost ring is on the node radius, so edges end on it', () => {
    const w = mountPanel([2]);
    const outer = Math.max(...w.get('[data-testid="graph-rings"]').findAll('circle').map((c) => Number(c.attributes('r'))));
    expect(PHASE_R - outer).toBeLessThan(4);
  });

  it('rings turn only for the CURRENT phase, in opposite directions, 40–90 s per turn, and not for reduced motion', () => {
    const css = readFileSync(resolve(__dirname, '../styles/main.css'), 'utf8');
    expect(css).toMatch(/\.xg-current \.xg-ring \{[^}]*animation: xg-spin (\d+)s linear infinite/);
    const d1 = Number(/\.xg-current \.xg-ring \{[^}]*animation: xg-spin (\d+)s/.exec(css)![1]);
    const d2 = Number(/\.xg-current \.xg-ring\.rev \{[^}]*animation-duration: (\d+)s/.exec(css)![1]);
    for (const d of [d1, d2]) { expect(d).toBeGreaterThanOrEqual(40); expect(d).toBeLessThanOrEqual(90); }
    expect(css).toMatch(/\.xg-current \.xg-ring\.rev \{[^}]*animation-direction: reverse/);
    expect(css).toMatch(/@keyframes xg-spin \{ to \{ transform: rotate\(360deg\); \} \}/);
    expect(css).not.toMatch(/\.xg-phase:not\(\.xg-current\) [^{]*\{[^}]*animation:/); // inactive phases stay still
    const block = css.split('@media (prefers-reduced-motion: reduce)').map((x) => x.split('\n}')[0]!).find((x) => x.includes('xg-ring'));
    expect(block).toMatch(/animation: none/);
    expect(block).toMatch(/xg-edge-flow/);
  });

  it('only the confirmed CURRENT phase gets the soft aura; there is no aura for the others', () => {
    const w = mountPanel([1, 1, 1]); // active phase = 1 (see build())
    expect(w.findAll('[data-testid="graph-aura"]')).toHaveLength(1);
    const phases = w.findAll('[data-testid="graph-phase"]');
    expect(phases.map((p) => p.classes().includes('xg-current'))).toEqual([true, false, false]);
    const none = mount(ExecutionGraphPanel, { props: { roadmapText: roadmapDoc(2), roadmap: parseRoadmapPhases(roadmapDoc(2)) }, attachTo: document.body });
    expect(none.findAll('[data-testid="graph-aura"]')).toHaveLength(0);
    expect(none.findAll('.xg-current')).toHaveLength(0);
  });

  it('the aura is decoration only and follows the phase when it is dragged', async () => {
    const w = mountPanel([2]);
    const aura = w.get('[data-testid="graph-aura"]');
    expect(aura.attributes('aria-hidden')).toBe('true');
    expect(aura.element.tagName.toLowerCase()).toBe('svg');
    expect(aura.find('button').exists()).toBe(false);
    const auraPos = () => { const st = (aura.element as unknown as HTMLElement).style; return [px(st.left), px(st.top)]; };
    const a0 = auraPos();
    await drag(w, 'graph-phase', 0, 70, 30);
    expect(auraPos()).toEqual([a0[0]! + 70, a0[1]! + 30]);
  });

  it('the aura is fill-only and its pulse animates opacity only, in 3–4 s, off for reduced motion', () => {
    const css = readFileSync(resolve(__dirname, '../styles/main.css'), 'utf8');
    const glow = css.split('\n').filter((l) => l.startsWith('.xg-aura') && l.includes('.xg-aura-glow'));
    expect(glow.join('\n')).not.toMatch(/stroke-width|stroke-dash|stroke:\s*#/);
    const m = /@keyframes xg-pulse-aura \{(.*?)\}\s*\}/s.exec(css);
    expect(m![1]).toMatch(/fill-opacity/);
    expect(m![1]).not.toMatch(/transform|scale|width|height|left|top|translate/);
    const d = Number(/animation: xg-pulse-aura ([\d.]+)s/.exec(css)![1]);
    expect(d).toBeGreaterThanOrEqual(3);
    expect(d).toBeLessThanOrEqual(4);
  });
});

describe('Edge attachment to the disc', () => {
  const phase: Box = { x: 0, y: 0, w: PHASE_W, h: PHASE_H, round: true };
  const story = (x: number, y: number): Box => ({ x, y, w: STORY_W, h: STORY_H });

  it('ends on the outer ring for any direction (never inside, never short of it)', () => {
    const bad: string[] = [];
    for (let deg = 0; deg < 360; deg += 7) {
      const a = (deg * Math.PI) / 180;
      const [e] = routeEdges([{ key: 'k', from: 'p', to: 's' }], new Map([['p', phase], ['s', story(900 * Math.cos(a), 900 * Math.sin(a))]]));
      if (Math.abs(Math.hypot(e!.p0.x, e!.p0.y) - PHASE_R) > 1e-6) bad.push(String(deg));
    }
    expect(bad).toEqual([]);
  });

  it('is a smooth cubic Bézier with a gentle, consistent curve when nothing is in the way', () => {
    const [e] = routeEdges([{ key: 'k', from: 'p', to: 's' }], new Map([['p', phase], ['s', story(800, 0)]]));
    expect(e!.d).toMatch(/^M [-\d.e]+ [-\d.e]+ C /);
    expect(e!.c).not.toBeNull();
    expect(e!.blocked).toBe(false);
    // the curve bows by at most ~8% of the edge length
    const mid = edgePoint(e!, 0.5);
    expect(Math.abs(mid.y)).toBeGreaterThan(5);
    expect(Math.abs(mid.y)).toBeLessThan(100);
    const [f] = routeEdges([{ key: 'k', from: 'p', to: 's' }], new Map([['p', phase], ['s', story(0, -800)]]));
    // same rotational sense for another direction: the bow is on the same side of the travel direction
    const side = (edge: typeof e, dx: number, dy: number) => { const m = edgePoint(edge!, 0.5); const ex = dx / Math.hypot(dx, dy); const ey = dy / Math.hypot(dx, dy); return Math.sign(ex * m.y - ey * m.x); };
    expect(side(e, 1, 0)).toBe(side(f, 0, -1));
  });

  it('keeps the first story-end on the story border', () => {
    const [e] = routeEdges([{ key: 'k', from: 'p', to: 's' }], new Map([['p', phase], ['s', story(800, 300)]]));
    const sb = { x: 800, y: 300, w: STORY_W, h: STORY_H };
    const onSide = Math.abs(Math.abs(e!.p1.x - sb.x) - sb.w / 2) < 1e-6 || Math.abs(Math.abs(e!.p1.y - sb.y) - sb.h / 2) < 1e-6;
    expect(onSide).toBe(true);
  });
});

describe('Live edges, glass tiles, HUD corners and the calm background', () => {
  const css = readFileSync(resolve(__dirname, '../styles/main.css'), 'utf8');
  const skin = readFileSync(resolve(__dirname, '../styles/skins/cosmic-glass.css'), 'utf8');

  it('every confirmed edge is drawn twice: a dim gradient line and an animated packet on top', () => {
    const w = mountPanel([3, 2]);
    const base = w.findAll('[data-testid="graph-edge"]');
    const flow = w.findAll('[data-testid="graph-edge-flow"]');
    expect(base).toHaveLength(5);
    expect(flow).toHaveLength(5);
    expect(flow.map((f) => f.attributes('d'))).toEqual(base.map((b) => b.attributes('d')));
    expect(base[0]!.attributes('style')).toContain('url(#xg-g-0)');
    const g = w.get('linearGradient#xg-g-0');
    expect(g.attributes('gradientUnits')).toBe('userSpaceOnUse');
    const stops = g.findAll('stop').map((x) => Number(x.attributes('stop-opacity')));
    expect(stops[0]).toBeGreaterThan(stops[1]!); // fades towards the node
    expect(css).toMatch(/\.xg-edge-flow \{[^}]*stroke-dasharray: 4 120; animation: xg-flow 3s linear infinite/);
    expect(css).toMatch(/@keyframes xg-flow \{ to \{ stroke-dashoffset: -124; \} \}/);
  });

  it('the packets stop for the edges outside a selection and the base lines are dimmed', async () => {
    const w = mountPanel([3, 2]);
    await w.findAll('[data-testid="graph-phase"]')[0]!.trigger('click');
    expect(w.findAll('[data-testid="graph-edge-flow"]')).toHaveLength(3);
    expect(w.findAll('[data-testid="graph-edge"]').filter((e) => e.classes().includes('xg-edge-dim'))).toHaveLength(2);
  });

  it('a very large graph draws the base lines only (no per-edge animation)', () => {
    const w = mountPanel([130]);
    expect(w.findAll('[data-testid="graph-edge"]')).toHaveLength(130);
    expect(w.findAll('[data-testid="graph-edge-flow"]')).toHaveLength(0);
  });

  it('tiles are glass with a faint cyan frame, HUD corners and monospace text, in every skin', () => {
    expect(skin).toMatch(/\[data-skin="cosmic-glass"\] button,/); // the reason for the override
    expect(css).toMatch(/:root \.xg-viewport \.xg-node \{ background: linear-gradient\(180deg, rgba\(30, 70, 90, 0\.55\), rgba\(12, 28, 38, 0\.75\)\);/);
    expect(css).toMatch(/\.xg-node \{[^}]*backdrop-filter: blur\(6px\)/s);
    expect(css).toMatch(/border-radius: 2px/);
    expect(css).toMatch(/\.xg-node::before, \.xg-node::after \{[^}]*width: 10px; height: 10px; border: 1px solid var\(--c\)/s);
    expect(css).toMatch(/\.xg-node::before \{ top: -1px; left: -1px; border-right: 0; border-bottom: 0; \}/);
    expect(css).toMatch(/\.xg-node::after \{ bottom: -1px; right: -1px; border-left: 0; border-top: 0; \}/);
    expect(css).toMatch(/"JetBrains Mono", "IBM Plex Mono"/);
  });

  it('text is light grey, not pure white; status is a small coloured dot', () => {
    expect(css).toMatch(/\.xg-title \{[^}]*font-family: system-ui[^}]*font-size: 14\.5px; font-weight: 500;[^}]*color: #e8f4fb/);
    expect(css).toMatch(/\.xg-kind \{[^}]*color: #5ee6ff;/);
    expect(css).toMatch(/\.dot-ok \{ background: #4ade80; \}/);
    expect(css).toMatch(/\.dot-current \{ background: #fbbf24;/);
    expect(css).toMatch(/\.dot-planned \{ background: #7cb8ff; \}/);
    expect(css).toMatch(/\.dot-idle \{ background: #8a97a6; \}/);
  });

  it('the canvas is near-black with a centre glow, a vignette, faint scan lines and a barely visible grid', () => {
    const vp = /\.xg-viewport \{[^}]*\}/s.exec(css)![0];
    expect(vp).toMatch(/radial-gradient\(ellipse at center, rgba\(40, 90, 120, 0\.18\), transparent 65%\), #05080d/);
    expect(css).toMatch(/\.xg-viewport::before \{[^}]*radial-gradient\(ellipse at center, transparent 50%, #03060a 100%\)/s);
    const scan = /\.xg-viewport::after \{[^}]*rgba\(255, 255, 255, (0\.\d+)\)/s.exec(css);
    expect(Number(scan![1])).toBeGreaterThanOrEqual(0.02);
    expect(Number(scan![1])).toBeLessThanOrEqual(0.03);
    const hex = Number(/\.xg-hex-line \{[^}]*opacity: ([\d.]+)/.exec(css)![1]);
    expect(hex).toBeGreaterThanOrEqual(0.03);
    expect(hex).toBeLessThanOrEqual(0.05);
  });

  it('nodes appear one after another, 50–80 ms apart', () => {
    const delay = /animation-delay: min\(calc\(var\(--i, 0\) \* (\d+)ms\)/.exec(css);
    expect(Number(delay![1])).toBeGreaterThanOrEqual(50);
    expect(Number(delay![1])).toBeLessThanOrEqual(80);
    const w = mountPanel([2], undefined, { ids: ['CUR-1'] });
    const idx = w.findAll('.xg-node').map((n) => Number((n.element as HTMLElement).style.getPropertyValue('--i')));
    expect(idx).toEqual([0, 1, 2, 3]); // phase, its two stories, the current story
  });

  it('the toolbar uses the same language: transparent, 1px frame, monospace', () => {
    expect(css).toMatch(/:root \.xg-toolbar button \{[^}]*background: transparent; border: 1px solid rgba\(94, 230, 255, 0\.28\)[^}]*font-family: "JetBrains Mono"/s);
  });

  it('glows only on accents: hover, selection and the current phase', () => {
    const glows = css.split('\n').filter((l) => /box-shadow: 0 0 \d+px/.test(l) && l.includes('.xg-'));
    for (const l of glows) expect(l).toMatch(/hover|selected|current/);
  });
});

describe('Tile depth: lit surface, top bar, joint dots', () => {
  const css = readFileSync(resolve(__dirname, '../styles/main.css'), 'utf8');

  it('the tile is a tinted, lit surface that hangs over the grid (dark outline, drop shadow, soft glow, top highlight)', () => {
    const node = /\.xg-node \{[^}]*\}/s.exec(css)![0];
    expect(node).toMatch(/linear-gradient\(180deg, rgba\(30, 70, 90, 0\.55\), rgba\(12, 28, 38, 0\.75\)\)/);
    expect(node).toMatch(/border: 1px solid color-mix\(in srgb, var\(--c\) 35%/);
    expect(node).toMatch(/box-shadow: 0 0 0 1px rgba\(0, 0, 0, 0\.6\), 0 8px 30px rgba\(0, 0, 0, 0\.5\), 0 0 20px color-mix\(.*?transparent\), inset 0 1px 0 rgba\(255, 255, 255, 0\.06\)/);
  });

  it('hover and selection light the border to full accent with a stronger glow', () => {
    expect(css).toMatch(/\.xg-node:hover:not\(:disabled\),\s*:root \.xg-viewport \.xg-node\.xg-selected \{ border-color: var\(--c\); box-shadow: 0 0 0 1px rgba\(0, 0, 0, 0\.6\), 0 0 30px color-mix\(in srgb, var\(--c\) 30%/);
  });

  it('every story tile has the bright top bar that fades towards the sides', () => {
    const w = mountPanel([2], undefined, { ids: ['CUR-1'] });
    const tiles = [...w.findAll('[data-testid="graph-story"]'), w.get('[data-testid="graph-current-outside"]')];
    for (const t of tiles) expect(t.find('.xg-bar').exists()).toBe(true);
    expect(w.get('[data-testid="graph-phase"]').find('.xg-bar').exists()).toBe(false); // the phase is a disc, not a panel
    expect(css).toMatch(/\.xg-bar \{[^}]*top: 0; left: 0; right: 0; height: 2px;[^}]*linear-gradient\(90deg, transparent, var\(--c\), transparent\)/);
  });

  it('a glowing dot (r=3, accent) sits where each line meets a border, above the tiles', () => {
    const w = mountPanel([3, 2]);
    const dots = w.findAll('[data-testid="graph-edge-dot"]');
    expect(dots).toHaveLength(10);
    for (const d of dots) expect(d.attributes('r')).toBe('3');
    const edge = w.findAll('[data-testid="graph-edge"]')[0]!.attributes('d')!;
    const nums = edge.match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
    const first = dots.slice(0, 2).map((d) => [Number(d.attributes('cx')), Number(d.attributes('cy'))]);
    expect(first[0]![0]).toBeCloseTo(nums[0]!, 6);
    expect(first[0]![1]).toBeCloseTo(nums[1]!, 6);
    expect(first[1]![0]).toBeCloseTo(nums[nums.length - 2]!, 6);
    expect(first[1]![1]).toBeCloseTo(nums[nums.length - 1]!, 6);
    expect(css).toMatch(/\.xg-edge-dot \{ fill: #5ee6ff; filter: drop-shadow\(0 0 4px #5ee6ff\); \}/);
    expect(css).toMatch(/\.xg-edge-dots \{[^}]*pointer-events: none; z-index: 2;/);
    const world = w.get('[data-testid="graph-canvas"]').element;
    expect(world.querySelector('svg.xg-edge-dots')).not.toBeNull();
  });

  it('the dots follow a dragged node and fade for edges outside the selection', async () => {
    const w = mountPanel([2]);
    const story = () => w.findAll('[data-testid="graph-edge-dot"]')[1]!;
    const before = [Number(story().attributes('cx')), Number(story().attributes('cy'))];
    await drag(w, 'graph-story', 0, 90, 60);
    expect([Number(story().attributes('cx')), Number(story().attributes('cy'))]).not.toEqual(before);
    await new Promise((r) => setTimeout(r, 5)); // the click that follows a drag is swallowed once
    await w.findAll('[data-testid="graph-story"]')[1]!.trigger('click');
    const dim = w.findAll('[data-testid="graph-edge-dot"]').filter((d) => d.classes().includes('xg-edge-dot-dim'));
    expect(dim).toHaveLength(2); // the other story's edge: both its dots
  });

  it('the canvas edges fall into darkness (#03060a) and the grid is fainter', () => {
    expect(css).toMatch(/\.xg-viewport::before \{[^}]*transparent 50%, #03060a 100%/s);
    const hex = Number(/\.xg-hex-line \{[^}]*opacity: ([\d.]+)/.exec(css)![1]);
    expect(hex).toBeLessThanOrEqual(0.03);
  });
});

describe('Final polish: readable titles, expressive CURRENT, status colours, tighter layout', () => {
  const css = readFileSync(resolve(__dirname, '../styles/main.css'), 'utf8');

  it('phase title is 15–20% larger than before (14px -> 16.5px) and the disc is not resized', () => {
    const size = Number(/\.xg-phase \.xg-title \{ font-size: ([\d.]+)px/.exec(css)![1]);
    expect(size / 14).toBeGreaterThanOrEqual(1.15);
    expect(size / 14).toBeLessThanOrEqual(1.2);
    expect(PHASE_W).toBe(270);
    expect(PHASE_R).toBe(135);
  });

  it('CURRENT on the phase is a filled, glowing chip; it only exists for the confirmed current phase', () => {
    expect(css).toMatch(/\.xg-phase\.xg-current \.xg-kind \.tag \{[^}]*background: #5ee6ff[^}]*box-shadow: 0 0 14px/);
    const w = mountPanel([1, 1]);
    expect(w.findAll('[data-testid="graph-current-phase"]')).toHaveLength(1);
  });

  it('titles use the UI font; the id and technical labels stay monospace', () => {
    expect(css).toMatch(/\.xg-title \{ font-family: system-ui/);
    expect(css).toMatch(/\.xg-id \{ font-family: "JetBrains Mono"/);
    expect(css).toMatch(/\.xg-kind \{[^}]*\}/); // labels inherit the node's monospace
    const w = mountPanel([1], undefined, { ids: ['CUR-1'] });
    const st = w.get('[data-testid="graph-story"]');
    expect(st.get('.xg-title .xg-id').text()).toBe('S-1-1');
    expect(st.get('.xg-title').text()).toBe('S-1-1 · Story 1 of phase 1');
    expect(w.get('[data-testid="graph-phase"] .xg-id').text()).toBe('Phase 1');
    expect(w.get('[data-testid="graph-phase"] .xg-title').text()).toBe('Phase 1 · Title 1');
    expect(w.get('[data-testid="graph-current-outside"] .xg-id').text()).toBe('CUR-1');
  });

  it('colours only Core-provided states: green completed, amber current, light blue planned, amber diagnostics (never red for a status)', () => {
    expect(css).toMatch(/\.dot-ok \{ background: #4ade80; \}/);
    expect(css).toMatch(/\.dot-current \{ background: #fbbf24;/);
    expect(css).toMatch(/\.dot-planned \{ background: #7cb8ff; \}/);
    expect(css).toMatch(/\.xg-meta \.diag-badge \{[^}]*color: #fbbf24/);
    expect(css).not.toMatch(/\.xg-status\.status-unrecognized \{[^}]*#f87171/);
    const road = roadmapDoc(2, 1).replace('Phase 2 — Title 2\n\n**Status:** COMPLETED', 'Phase 2 — Title 2\n\n**Status:** PLANNED');
    const r = parseRoadmapPhases(road);
    const w = mount(ExecutionGraphPanel, { props: { roadmapText: road, roadmap: r, story: { kind: 'active', ids: ['CUR-1'], excerpt: null } }, attachTo: document.body });
    const dot = (i: number) => w.findAll('[data-testid="graph-phase"]')[i]!.find('.xg-dot').classes();
    expect(dot(0)).toContain('dot-current'); // the phase Core named as active, whatever its reported status says
    expect(dot(1)).toContain('dot-planned');
    expect(w.get('[data-testid="graph-current-outside"] .xg-dot').classes()).toContain('dot-current');
  });

  it('a completed story that is not current is green; a story with diagnostics shows a red count; nothing is coloured on a guess', () => {
    const idx = '## Phase 1 — N\n\n### A-1 — a\n**Status:** COMPLETED\n\n### A-1 — dup\n**Status:** COMPLETED\n\n### A-2 — b\n**Status:** Mystery\n';
    const road = roadmapDoc(1, 1);
    const w = mount(ExecutionGraphPanel, { props: { roadmapText: road, roadmap: parseRoadmapPhases(road), storyIndex: { data: parseStoryIndex(idx, ['1'], true), sources: [SRC] } }, attachTo: document.body });
    const tiles = w.findAll('[data-testid="graph-story"]');
    expect(tiles[0]!.find('.xg-dot').classes()).toContain('dot-ok');
    expect(tiles[0]!.find('[data-testid="graph-diag-badge"]').exists()).toBe(true); // duplicate id diagnostic from Core
    expect(tiles[2]!.find('.xg-dot').classes()).toContain('dot-idle'); // unrecognised status: grey, never guessed
    expect(tiles[2]!.find('.status-unrecognized').exists()).toBe(true);
  });

  it('a phase with Core diagnostics shows them on the node', () => {
    const road = '## Phases\n\n### Phase 1 — A\n\n**Status:** COMPLETED\n\n### Phase 1 — B\n\n**Status:** COMPLETED\n';
    const w = mount(ExecutionGraphPanel, { props: { roadmapText: road, roadmap: parseRoadmapPhases(road) }, attachTo: document.body });
    for (const p of w.findAll('[data-testid="graph-phase"]')) expect(p.find('[data-testid="graph-diag-badge"]').exists() || p.text().includes('DUPLICATE ID')).toBe(true);
  });

  it('layout is tighter than before (first ring closer to the star) yet nothing overlaps and no edge crosses a node', () => {
    const { g, m } = boxes([5]);
    const star = m.get('phase:0')!;
    const d = Math.hypot(m.get(g.phases[0]!.storyKeys[0]!)!.x - star.x, m.get(g.phases[0]!.storyKeys[0]!)!.y - star.y);
    expect(d).toBeLessThan(322); // before this refinement
    expect(d).toBeGreaterThan(PHASE_R + 100);
    const bad: string[] = [];
    for (const e of routeEdges(g.edges, m)) {
      if (e.blocked) bad.push(`${e.key} blocked`);
      for (let i = 1; i < 120; i++) {
        const p = edgePoint(e, i / 120);
        for (const [k, b] of m) if (k !== e.from && k !== e.to && overlaps({ x: p.x, y: p.y, w: 0, h: 0 }, b)) bad.push(`${e.key} crosses ${k}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
