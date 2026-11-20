/** GOV-EVOLUTION Phase 3: Development History read model (KAIROS scenario: finished missions only). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDashboardModel } from './index.js';
import { buildDevelopmentHistory, MAX_HISTORY_CHECKPOINTS_PER_MISSION, MAX_HISTORY_MISSIONS } from './history.js';
import type { CoordinatoriumState } from '../coordinatorium/types.js';

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hist-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ts = (n: number, s = 0) => `2026-02-${String(n).padStart(2, '0')}T10:00:${String(s).padStart(2, '0')}.000Z`;
type S = CoordinatoriumState;

function state(over: Partial<S['tactical']> = {}): S {
  return { schemaVersion: 3, revision: 1, strategic: { systems: {} }, tactical: { missions: {}, checkpoints: {}, ...over } };
}
function mis(n: number, status: 'in_progress' | 'completed' | 'failed' | 'cancelled', extra: { storyId?: string; summary?: string | null } = {}) {
  const id = `MIS-${String(n).padStart(4, '0')}`;
  return { id, title: `Mission ${n}`, system: 'kairos', status, startedAt: ts(n), updatedAt: ts(n, 30), summary: extra.summary ?? null, ...(extra.storyId ? { storyId: extra.storyId } : {}) };
}
function ckpt(n: number, k: number, summary = `progress ${n}.${k}`) {
  const missionId = `MIS-${String(n).padStart(4, '0')}`;
  return { id: `${missionId}-CKPT-${String(k).padStart(4, '0')}`, missionId, createdAt: ts(n, 10 + k), summary, remainingSteps: ['next'], context: null };
}
function kairos(): S {
  const missions = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`MIS-000${n}`, mis(n, 'completed', { storyId: n <= 5 ? `K-${n}` : undefined, summary: `done ${n}` })]));
  const checkpoints = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => ckpt(n, 1)).map((c) => [c.id, c]));
  return state({ missions, checkpoints });
}

describe('buildDevelopmentHistory', () => {
  it('shows completed missions and their checkpoints with no active mission', () => {
    const h = buildDevelopmentHistory(kairos());
    expect(h.counts).toEqual({ in_progress: 0, completed: 7, failed: 0, cancelled: 0 });
    expect(h.totalMissions).toBe(7);
    expect(h.totalCheckpoints).toBe(7);
    expect(h.missions.map((m) => m.id)).toEqual(['MIS-0007', 'MIS-0006', 'MIS-0005', 'MIS-0004', 'MIS-0003', 'MIS-0002', 'MIS-0001']);
    const m1 = h.missions[6];
    expect(m1).toMatchObject({ status: 'completed', storyId: 'K-1', summary: 'done 1', checkpointCount: 1 });
    expect(m1.checkpoints[0]).toMatchObject({ id: 'MIS-0001-CKPT-0001', summary: 'progress 1.1', remainingSteps: ['next'] });
  });

  it('never invents links or checkpoints', () => {
    const h = buildDevelopmentHistory(kairos());
    expect(h.missions[0].storyId).toBeNull(); // MIS-0007 has no recorded story
    const bare = buildDevelopmentHistory(state({ missions: { 'MIS-0001': mis(1, 'failed') } }));
    expect(bare.missions[0]).toMatchObject({ checkpointCount: 0, checkpoints: [], storyId: null, status: 'failed' });
  });

  it('covers active, failed and cancelled missions and orders checkpoints by id ordinal', () => {
    const c2 = ckpt(1, 2);
    const c10 = { ...ckpt(1, 10), createdAt: ts(1, 1) }; // earlier timestamp, higher ordinal
    const h = buildDevelopmentHistory(
      state({
        missions: { 'MIS-0001': mis(1, 'in_progress'), 'MIS-0002': mis(2, 'failed'), 'MIS-0003': mis(3, 'cancelled') },
        checkpoints: { [c10.id]: c10, [c2.id]: c2 },
      }),
    );
    expect(h.counts).toEqual({ in_progress: 1, completed: 0, failed: 1, cancelled: 1 });
    expect(h.missions.find((m) => m.id === 'MIS-0001')!.checkpoints.map((c) => c.id)).toEqual(['MIS-0001-CKPT-0002', 'MIS-0001-CKPT-0010']);
  });

  it('recent events come from recorded timestamps, newest first, bounded', () => {
    const h = buildDevelopmentHistory(kairos());
    expect(h.recent).toHaveLength(10);
    expect(h.recent[0]).toMatchObject({ kind: 'mission_finished', missionId: 'MIS-0007', result: 'completed' });
    expect(h.recent[1]).toMatchObject({ kind: 'checkpoint', missionId: 'MIS-0007', checkpointId: 'MIS-0007-CKPT-0001' });
    const times = h.recent.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('counts checkpoints of unknown missions as orphans without attaching them anywhere', () => {
    const o = ckpt(9, 1);
    const h = buildDevelopmentHistory(state({ missions: { 'MIS-0001': mis(1, 'completed') }, checkpoints: { [o.id]: o } }));
    expect(h.orphanCheckpoints).toBe(1);
    expect(h.missions[0].checkpointCount).toBe(0);
    expect(h.recent.every((e) => e.missionId === 'MIS-0001')).toBe(true);
  });

  it('is bounded and says so', () => {
    const missions = Object.fromEntries(Array.from({ length: MAX_HISTORY_MISSIONS + 5 }, (_, i) => [`MIS-${String(i + 1).padStart(4, '0')}`, { ...mis(1, 'completed'), id: `MIS-${String(i + 1).padStart(4, '0')}`, startedAt: `2026-03-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z` }]));
    const many = Array.from({ length: MAX_HISTORY_CHECKPOINTS_PER_MISSION + 3 }, (_, k) => ckpt(MAX_HISTORY_MISSIONS + 5, k + 1));
    const h = buildDevelopmentHistory(state({ missions: { ...missions }, checkpoints: Object.fromEntries(many.map((c) => [c.id, c])) }));
    expect(h.missions).toHaveLength(MAX_HISTORY_MISSIONS);
    expect(h.truncated).toBe(true);
    expect(h.totalMissions).toBe(MAX_HISTORY_MISSIONS + 5);
    const m1 = h.missions.find((m) => m.id === `MIS-${String(MAX_HISTORY_MISSIONS + 5).padStart(4, '0')}`)!;
    expect(m1.checkpointCount).toBe(MAX_HISTORY_CHECKPOINTS_PER_MISSION + 3);
    expect(m1.checkpoints).toHaveLength(MAX_HISTORY_CHECKPOINTS_PER_MISSION);
    expect(m1.checkpointsTruncated).toBe(true);
  });

  it('is deterministic and does not mutate its input', () => {
    const s = kairos();
    const before = JSON.stringify(s);
    expect(buildDevelopmentHistory(s)).toEqual(buildDevelopmentHistory(s));
    expect(JSON.stringify(s)).toBe(before);
  });

  it('absent state is an empty history', () => {
    expect(buildDevelopmentHistory(null)).toMatchObject({ missions: [], totalMissions: 0, truncated: false, recent: [] });
  });
});

describe('readDashboardModel — history section', () => {
  function project(s: S | null): void {
    writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify({ project: { name: 'KAIROS-fixture' } }));
    mkdirSync(join(dir, '.monolith'), { recursive: true });
    if (s) writeFileSync(join(dir, '.monolith/state.json'), JSON.stringify(s));
  }

  it('KAIROS scenario: 7 completed missions + 7 checkpoints, 0 active — history visible, checkpoints tab data unchanged', () => {
    project(kairos());
    const m = readDashboardModel(dir);
    expect(m.currentMissions.data!.active).toEqual([]);
    expect(m.checkpoints.data!.byActiveMission).toEqual([]); // the legacy section is untouched
    expect(m.history!.data!.counts.completed).toBe(7);
    expect(m.history!.data!.missions.flatMap((x) => x.checkpoints)).toHaveLength(7);
    expect(m.history!.sources[0].status).toBe('available');
  });

  it('does not touch the state file and is deterministic', () => {
    project(kairos());
    const before = readFileSync(join(dir, '.monolith/state.json'), 'utf8');
    expect(readDashboardModel(dir)).toEqual(readDashboardModel(dir));
    expect(readFileSync(join(dir, '.monolith/state.json'), 'utf8')).toBe(before);
  });

  it('absent state: empty history; corrupt state: not available (never an empty list)', () => {
    project(null);
    expect(readDashboardModel(dir).history!.data).toMatchObject({ missions: [], totalMissions: 0 });
    writeFileSync(join(dir, '.monolith/state.json'), '{not json');
    const m = readDashboardModel(dir);
    expect(m.history!.data).toBeNull();
    expect(m.history!.sources[0].status).toBe('corrupt');
  });
});
