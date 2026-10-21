import { describe, it, expect } from 'vitest';
import { createInitialState } from '../coordinatorium/types.js';
import type { CoordinatoriumState, Mission, Checkpoint } from '../coordinatorium/types.js';
import {
  compareStrings,
  selectActiveMissions,
  selectRecentFinishedMissions,
  selectLatestCheckpoint,
  hasCheckpointOrderMismatch,
} from './selectors.js';

function mission(overrides: Partial<Mission> & { id: string }): Mission {
  return {
    title: 'T',
    system: 'S',
    status: 'in_progress',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    summary: null,
    ...overrides,
  };
}

function checkpoint(overrides: Partial<Checkpoint> & { id: string; missionId: string }): Checkpoint {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    summary: 'progress',
    remainingSteps: [],
    context: null,
    ...overrides,
  };
}

function stateWith(missions: Mission[], checkpoints: Checkpoint[] = []): CoordinatoriumState {
  const state = createInitialState();
  for (const m of missions) state.tactical.missions[m.id] = m;
  for (const c of checkpoints) state.tactical.checkpoints[c.id] = c;
  return state;
}

describe('compareStrings', () => {
  it('is a stable ascii comparator, not localeCompare', () => {
    expect(compareStrings('a', 'b')).toBeLessThan(0);
    expect(compareStrings('b', 'a')).toBeGreaterThan(0);
    expect(compareStrings('a', 'a')).toBe(0);
    // ASCII ordering: digits < uppercase < lowercase — a locale-aware
    // comparator could disagree; this pins the deterministic behavior.
    expect(compareStrings('Z', 'a')).toBeLessThan(0);
  });
});

describe('selectActiveMissions', () => {
  it('returns only in_progress missions, sorted by (startedAt, id)', () => {
    const state = stateWith([
      mission({ id: 'MIS-0002', status: 'in_progress', startedAt: '2026-01-02T00:00:00.000Z' }),
      mission({ id: 'MIS-0001', status: 'in_progress', startedAt: '2026-01-01T00:00:00.000Z' }),
      mission({ id: 'MIS-0003', status: 'completed', startedAt: '2026-01-03T00:00:00.000Z' }),
    ]);
    const active = selectActiveMissions(state);
    expect(active.map((m) => m.id)).toEqual(['MIS-0001', 'MIS-0002']);
  });

  it('breaks startedAt ties by id', () => {
    const state = stateWith([
      mission({ id: 'MIS-0002', startedAt: '2026-01-01T00:00:00.000Z' }),
      mission({ id: 'MIS-0001', startedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(selectActiveMissions(state).map((m) => m.id)).toEqual(['MIS-0001', 'MIS-0002']);
  });

  it('returns [] for a project with no active missions', () => {
    const state = stateWith([mission({ id: 'MIS-0001', status: 'completed' })]);
    expect(selectActiveMissions(state)).toEqual([]);
  });
});

describe('selectRecentFinishedMissions', () => {
  it('returns only finished missions, most recently updated first, capped to limit', () => {
    const state = stateWith([
      mission({ id: 'MIS-0001', status: 'completed', updatedAt: '2026-01-01T00:00:00.000Z' }),
      mission({ id: 'MIS-0002', status: 'failed', updatedAt: '2026-01-03T00:00:00.000Z' }),
      mission({ id: 'MIS-0003', status: 'cancelled', updatedAt: '2026-01-02T00:00:00.000Z' }),
      mission({ id: 'MIS-0004', status: 'in_progress', updatedAt: '2026-01-04T00:00:00.000Z' }),
    ]);
    expect(selectRecentFinishedMissions(state, 2).map((m) => m.id)).toEqual(['MIS-0002', 'MIS-0003']);
  });
});

describe('selectLatestCheckpoint', () => {
  it('picks the checkpoint with the highest numeric ordinal, not the latest createdAt', () => {
    const state = stateWith(
      [mission({ id: 'MIS-0001' })],
      [
        checkpoint({ id: 'MIS-0001-CKPT-0001', missionId: 'MIS-0001', createdAt: '2026-01-05T00:00:00.000Z' }),
        checkpoint({ id: 'MIS-0001-CKPT-0002', missionId: 'MIS-0001', createdAt: '2026-01-01T00:00:00.000Z' }),
      ],
    );
    const latest = selectLatestCheckpoint(state, 'MIS-0001');
    expect(latest?.id).toBe('MIS-0001-CKPT-0002');
  });

  it('returns null for a mission with no checkpoints', () => {
    const state = stateWith([mission({ id: 'MIS-0001' })]);
    expect(selectLatestCheckpoint(state, 'MIS-0001')).toBeNull();
  });

  it('ignores an orphan checkpoint whose missionId matches nothing', () => {
    const state = stateWith(
      [mission({ id: 'MIS-0001' })],
      [checkpoint({ id: 'MIS-9999-CKPT-0001', missionId: 'MIS-9999' })],
    );
    expect(selectLatestCheckpoint(state, 'MIS-0001')).toBeNull();
    expect(selectLatestCheckpoint(state, 'MIS-9999')?.id).toBe('MIS-9999-CKPT-0001');
  });

  it('does not let a differently-prefixed checkpoint id collide via a loose regex', () => {
    const state = stateWith(
      [mission({ id: 'MIS-1' }), mission({ id: 'MIS-10' })],
      [checkpoint({ id: 'MIS-10-CKPT-0005', missionId: 'MIS-10' })],
    );
    expect(selectLatestCheckpoint(state, 'MIS-1')).toBeNull();
  });
});

describe('hasCheckpointOrderMismatch', () => {
  it('is true when a non-latest checkpoint has a later createdAt', () => {
    const state = stateWith(
      [mission({ id: 'MIS-0001' })],
      [
        checkpoint({ id: 'MIS-0001-CKPT-0001', missionId: 'MIS-0001', createdAt: '2026-01-05T00:00:00.000Z' }),
        checkpoint({ id: 'MIS-0001-CKPT-0002', missionId: 'MIS-0001', createdAt: '2026-01-01T00:00:00.000Z' }),
      ],
    );
    const latest = selectLatestCheckpoint(state, 'MIS-0001')!;
    expect(hasCheckpointOrderMismatch(state, 'MIS-0001', latest)).toBe(true);
  });

  it('is false when timestamps and ID order agree', () => {
    const state = stateWith(
      [mission({ id: 'MIS-0001' })],
      [
        checkpoint({ id: 'MIS-0001-CKPT-0001', missionId: 'MIS-0001', createdAt: '2026-01-01T00:00:00.000Z' }),
        checkpoint({ id: 'MIS-0001-CKPT-0002', missionId: 'MIS-0001', createdAt: '2026-01-05T00:00:00.000Z' }),
      ],
    );
    const latest = selectLatestCheckpoint(state, 'MIS-0001')!;
    expect(hasCheckpointOrderMismatch(state, 'MIS-0001', latest)).toBe(false);
  });

  it('is false for a single checkpoint', () => {
    const state = stateWith(
      [mission({ id: 'MIS-0001' })],
      [checkpoint({ id: 'MIS-0001-CKPT-0001', missionId: 'MIS-0001' })],
    );
    const latest = selectLatestCheckpoint(state, 'MIS-0001')!;
    expect(hasCheckpointOrderMismatch(state, 'MIS-0001', latest)).toBe(false);
  });
});
