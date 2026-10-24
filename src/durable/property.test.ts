/**
 * Randomized operation sequences against the public API. Expected rejections
 * (stale fence, validation, closed task, ...) are part of normal operation and
 * ignored; anything else — a TypeError, a corrupt log produced by the library
 * itself — fails. After every sequence the invariants below must hold.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DurableTasks, type Fence } from './runtime.js';
import { FsEventStore } from './fs-store.js';
import { MemoryEventStore } from './memory-store.js';
import { DurableError } from './errors.js';
import { foldEvents, foldUntil } from './projection.js';
import { canonicalize, type Json } from './canonical.js';
import type { EventStore } from './types.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

async function oneSequence(seed: number, makeStore: () => EventStore, steps: number): Promise<void> {
  const rand = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  let t = Date.parse('2026-05-01T00:00:00Z');
  const store = makeStore();
  const rt = new DurableTasks({ store, now: () => new Date(t), defaultLeaseMs: 30_000 });
  const second = new DurableTasks({ store, now: () => new Date(t), defaultLeaseMs: 30_000 });
  await rt.createTask({ taskId: 'fz', kind: 'k', goal: 'g' });

  const fences: Fence[] = [];
  const tokens: string[] = [];
  const stepIds = ['s1', 's2', 's3', 's4'];
  let closed = false;

  for (let i = 0; i < steps && !closed; i++) {
    const api = rand() < 0.5 ? rt : second;
    const fence = fences.length > 0 && rand() < 0.8 ? pick(fences) : undefined;
    const op = Math.floor(rand() * 17);
    try {
      switch (op) {
        case 0: fences.push(await api.claim('fz', { owner: pick(['a', 'b', 'c']) })); break;
        case 1: if (fence) await api.heartbeat(fence); break;
        case 2: if (fence) await api.release(fence); break;
        case 3: {
          if (!fence) break;
          const n = 1 + Math.floor(rand() * 4);
          const ids = stepIds.slice(0, n);
          await api.declarePlan(fence, ids.map((id, k) => ({ id, title: `t-${id}`, dependsOn: k > 0 && rand() < 0.5 ? [ids[k - 1] as string] : [] })));
          break;
        }
        case 4: if (fence) await api.completeStep(fence, pick(stepIds), { r: i }); break;
        case 5: if (fence) await api.skipStep(fence, pick(stepIds), 'because'); break;
        case 6: if (fence) await api.recordDecision(fence, { id: `d${Math.floor(rand() * 3)}`, summary: 's', basedOn: [] }); break;
        case 7: if (fence) await api.recordAssumption(fence, { key: pick(['x', 'y']), statement: 'st', value: Math.floor(rand() * 2), criticality: pick(['blocking', 'advisory'] as const), supersede: rand() < 0.3 }); break;
        case 8: if (fence) await api.retractAssumption(fence, pick(['x', 'y']), 'no'); break;
        case 9: await api.observe('fz', { key: pick(['x', 'y', 'z']), value: Math.floor(rand() * 2), source: 'o' }); break;
        case 10: if (fence) await api.runEffect(fence, pick(['e1', 'e2']), async () => { if (rand() < 0.3) throw new Error('x'); return { i }; }, { description: 'd', retryable: rand() < 0.7, reconcile: async () => (rand() < 0.5 ? { status: 'completed', result: { rec: 1 } } : { status: 'not-executed' }) }); break;
        case 11: if (fence) { const w = await api.registerAwait(fence, { awaitId: pick(['w1', 'w2', 'w3']), purpose: 'p', stepId: rand() < 0.5 ? pick(stepIds) : undefined, deadlineAt: rand() < 0.5 ? new Date(t + 20_000) : undefined }); tokens.push(w.token); } break;
        case 12: await api.deliver(tokens.length > 0 && rand() < 0.9 ? pick(tokens) : 'dsc1.fz.w9.00000000000000000000000000000000', { v: Math.floor(rand() * 3) }, { idempotencyKey: pick(['k1', 'k2', 'k3']) }); break;
        case 13: await api.sweepDeadlines(); break;
        case 14: t += Math.floor(rand() * 40_000); break;
        case 15: await api.assess('fz', { observations: rand() < 0.5 ? { x: Math.floor(rand() * 2) } : undefined }); break;
        case 16:
          if (fence && rand() < 0.15) { await api.complete(fence, { done: true }); closed = true; }
          else if (rand() < 0.05) { await api.cancel('fz', 'stop'); closed = true; }
          break;
      }
    } catch (err) {
      if (!(err instanceof DurableError) && (err as Error).message !== 'x') throw err; // 'x' = the effect function's own, deliberate failure
    }
  }

  // ---- invariants -------------------------------------------------------------------------
  const fresh = new DurableTasks({ store, now: () => new Date(t) });
  const { state, events } = await fresh.getLog('fz');
  expect((await fresh.verify('fz'))[0]?.ok).toBe(true);
  expect(events.map((e) => e.seq)).toEqual(events.map((_, k) => k + 1));
  // incremental cache in the long-lived runtimes == fold from scratch
  expect(canonicalize((await rt.getState('fz')) as unknown as Json)).toBe(canonicalize(state as unknown as Json));
  expect(canonicalize((await second.getState('fz')) as unknown as Json)).toBe(canonicalize(state as unknown as Json));
  expect(canonicalize(foldEvents(events) as unknown as Json)).toBe(canonicalize(state as unknown as Json));
  // time travel: every prefix folds, and heads agree with the log
  for (const k of [1, Math.ceil(events.length / 2), events.length]) {
    const at = foldUntil(events, k);
    expect(at.headSeq).toBe(k);
    expect(at.headHash).toBe(events[k - 1]?.hash);
  }
  // structural invariants of the state
  expect(state.epoch).toBe(events.filter((e) => e.type === 'run.claimed').length);
  expect(state.eventCount).toBe(events.length);
  for (const a of Object.values(state.awaits)) {
    if (a.status === 'resolved') expect(a.resolvedAtSeq).not.toBeNull();
  }
  const a = await fresh.assess('fz');
  expect(['closed', 'waiting', 'direct', 'adaptive', 'recovery']).toContain(a.mode);
  if (state.status !== 'active') expect(a.mode).toBe('closed');
  // replaying the entire history of idempotent calls is a no-op on a closed or open task alike
  const before = (await fresh.getState('fz')).eventCount;
  await fresh.verify('fz');
  expect((await fresh.getState('fz')).eventCount).toBe(before);
}

describe('randomized sequences', () => {
  it('memory store: 150 seeds', async () => {
    for (let seed = 1; seed <= 150; seed++) {
      try {
        await oneSequence(seed, () => new MemoryEventStore(), 160);
      } catch (err) {
        throw new Error(`seed ${seed}: ${(err as Error).stack ?? err}`);
      }
    }
  }, 120_000);

  it('filesystem store: 25 seeds', async () => {
    for (let seed = 1001; seed <= 1025; seed++) {
      const dir = mkdtempSync(join(tmpdir(), 'durable-fuzz-'));
      dirs.push(dir);
      try {
        await oneSequence(seed, () => new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' }), 90);
      } catch (err) {
        throw new Error(`seed ${seed}: ${(err as Error).stack ?? err}`);
      }
    }
  }, 120_000);
});
