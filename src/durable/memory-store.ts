/**
 * In-memory `EventStore`. For tests of application logic built on Durable
 * State and for embedding where durability is not wanted. It implements the
 * same contract as the filesystem store (the shared conformance suite runs
 * against both), including the prune decision register (ADR-019) and the
 * canonical-input rules of compaction (Design A, section 40), but nothing
 * survives the process. There is no version marker: it belongs to the
 * filesystem layout.
 */

import {
  LogCorruptError,
  PruneAttemptLimitError,
  PruneDecisionCorruptError,
  RetentionRefusedError,
  StoreIoError,
  TaskPrunedError,
  TombstoneCommittedError,
} from './errors.js';
import { serializeEvent } from './log.js';
import { MAX_PRUNE_ATTEMPTS } from './register.js';
import type {
  CompactionResult,
  DecisionBy,
  EventStore,
  LogRead,
  PruneOutcome,
  PruneState,
  StoreDiagnostic,
  TaskEvent,
  Tombstone,
} from './types.js';

interface Attempt {
  tombstone: Tombstone;
  /** `null`: no decision yet. Once set it is never changed or removed (ADR-019). */
  decision: { outcome: PruneOutcome; by?: DecisionBy } | null;
}

interface Entry {
  events: TaskEvent[];
  /** The decision register: attempts in order, `attempts[n - 1]` is attempt `n`. Never shrinks. */
  attempts: Attempt[];
  /** `tombstone.json`: published from the `commit`. */
  tombstone: Tombstone | null;
  /** child id -> time the reference was pinned */
  refs: Map<string, string>;
}

export interface MemoryStoreOptions {
  /** @internal lowers `MAX_PRUNE_ATTEMPTS` so a test need not write a thousand attempts. */
  maxPruneAttempts?: number;
}

const MAX_WRITE_RESOLVE = 3;

export class MemoryEventStore implements EventStore {
  private readonly tasks = new Map<string, Entry>();
  private readonly maxAttempts: number;

  constructor(opts: MemoryStoreOptions = {}) {
    this.maxAttempts = opts.maxPruneAttempts ?? MAX_PRUNE_ATTEMPTS;
  }

  // ----- the register ---------------------------------------------------------------------------------------------

  private derive(taskId: string): PruneState {
    const entry = this.tasks.get(taskId);
    if (!entry) return { kind: 'missing' };
    const commitAt = entry.attempts.findIndex((a) => a.decision?.outcome === 'commit');
    if (commitAt >= 0) {
      return {
        kind: 'committed',
        attempt: commitAt + 1,
        tombstone: structuredClone((entry.attempts[commitAt] as Attempt).tombstone),
        residue: entry.events.length + entry.refs.size,
        durability: 'NOT_GUARANTEED',
      };
    }
    const m = entry.attempts.length;
    if (m === 0) return { kind: 'live', attempt: 0 };
    const last = entry.attempts[m - 1] as Attempt;
    if (last.decision) return { kind: 'live', attempt: m };
    return { kind: 'preparing', attempt: m, tombstone: structuredClone(last.tombstone) };
  }

  private refusal(taskId: string, st: PruneState): Error {
    switch (st.kind) {
      case 'corrupt':
        return new PruneDecisionCorruptError(taskId, 'register', st.file ?? null, st.attempt ?? null);
      case 'legacy':
        return new PruneDecisionCorruptError(taskId, 'legacy-tombstone-unmigrated');
      case 'missing':
        return new PruneDecisionCorruptError(taskId, 'task-dir-missing');
      case 'unreadable':
        return new StoreIoError(`the prune state of task "${taskId}" cannot be read now.`);
      default:
        return new TaskPrunedError(taskId);
    }
  }

  async pruneState(taskId: string): Promise<PruneState> {
    return this.derive(taskId);
  }

  async preparePrune(tombstone: Tombstone): Promise<{ attempt: number; created: boolean }> {
    const taskId = tombstone.taskId;
    const st = this.derive(taskId);
    if (st.kind === 'missing') throw new LogCorruptError(taskId, null, 'cannot prune an unknown task');
    if (st.kind === 'preparing') return { attempt: st.attempt as number, created: false };
    if (st.kind !== 'live') throw this.refusal(taskId, st);
    const entry = this.tasks.get(taskId) as Entry;
    const n = entry.attempts.length + 1;
    if (n > this.maxAttempts) throw new PruneAttemptLimitError(taskId, this.maxAttempts);
    entry.attempts.push({ tombstone: structuredClone(tombstone), decision: null });
    return { attempt: n, created: true };
  }

  async decidePrune(taskId: string, attempt: number, outcome: PruneOutcome, tombstone?: Tombstone, by?: DecisionBy): Promise<PruneOutcome> {
    const entry = this.tasks.get(taskId);
    const a = entry?.attempts[attempt - 1];
    if (!entry || !a) throw new LogCorruptError(taskId, null, `there is no prepare for prune attempt ${attempt}; a decision needs one`);
    if (outcome !== 'commit' && outcome !== 'abort') throw new LogCorruptError(taskId, null, 'a prune decision is either "commit" or "abort"');
    if (outcome === 'commit' && (!tombstone || JSON.stringify(sortKeys(tombstone)) !== JSON.stringify(sortKeys(a.tombstone)))) {
      throw new LogCorruptError(taskId, null, 'a commit must carry the tombstone of its attempt');
    }
    if (!a.decision) a.decision = outcome === 'abort' ? { outcome, ...(by ? { by } : {}) } : { outcome };
    return a.decision.outcome;
  }

  // ----- adapters of the pre-register operations ------------------------------------------------------------------

  async markPruned(tombstone: Tombstone): Promise<void> {
    const st = this.derive(tombstone.taskId);
    if (st.kind === 'preparing' || st.kind === 'committed') {
      if ((st.tombstone as Tombstone).headHash !== tombstone.headHash) throw new LogCorruptError(tombstone.taskId, null, 'a different tombstone already exists');
      return;
    }
    await this.preparePrune(tombstone);
  }

  async withdrawTombstone(tombstone: Tombstone): Promise<void> {
    const taskId = tombstone.taskId;
    const st = this.derive(taskId);
    if (st.kind === 'live' || st.kind === 'missing') return;
    if (st.kind === 'committed') throw new TombstoneCommittedError(taskId, 'the prune is committed; the tombstone cannot be withdrawn');
    if (st.kind !== 'preparing') throw this.refusal(taskId, st);
    if ((st.tombstone as Tombstone).headHash !== tombstone.headHash) throw new LogCorruptError(taskId, null, 'a different tombstone exists; refusing to withdraw it');
    const w = await this.decidePrune(taskId, st.attempt as number, 'abort', undefined, 'creator');
    if (w === 'commit') throw new TombstoneCommittedError(taskId, 'the prune is committed; the tombstone cannot be withdrawn');
  }

  async prune(tombstone: Tombstone, opts: { requireCommit?: boolean } = {}): Promise<{ removedFiles: number }> {
    const taskId = tombstone.taskId;
    let st = this.derive(taskId);
    if (st.kind === 'missing') throw new LogCorruptError(taskId, null, 'cannot prune an unknown task');
    if (st.kind === 'live' || st.kind === 'preparing') {
      if (opts.requireCommit) throw new RetentionRefusedError(taskId, 'no prune decision has been committed for it');
      if (st.kind === 'live' && (st.attempt ?? 0) > 0) throw new RetentionRefusedError(taskId, 'its last prune attempt was aborted by a task that needs it');
      if (st.kind === 'preparing' && (st.tombstone as Tombstone).headHash !== tombstone.headHash) throw new LogCorruptError(taskId, null, 'a different tombstone already exists');
      const { attempt } = await this.preparePrune(tombstone);
      const entry = this.tasks.get(taskId) as Entry;
      const tomb = (entry.attempts[attempt - 1] as Attempt).tombstone;
      if (tomb.headHash !== tombstone.headHash) throw new LogCorruptError(taskId, null, 'a different tombstone already exists');
      const w = await this.decidePrune(taskId, attempt, 'commit', tomb, 'pruner');
      if (w === 'abort') throw new RetentionRefusedError(taskId, 'the prune attempt was aborted by a task that needs it');
      st = this.derive(taskId);
    }
    if (st.kind !== 'committed') throw this.refusal(taskId, st);
    if ((st.tombstone as Tombstone).headHash !== tombstone.headHash) throw new LogCorruptError(taskId, null, 'a different tombstone already exists');
    const entry = this.tasks.get(taskId) as Entry;
    entry.tombstone = structuredClone(st.tombstone as Tombstone);
    const removed = entry.events.length;
    entry.events = [];
    entry.refs.clear();
    return { removedFiles: removed };
  }

  /** G2 (section 24.2): the register is asked AFTER a write became visible; nothing visible is ever taken back. */
  private async settle(taskId: string, by: DecisionBy): Promise<'CONFIRMED' | 'PRUNED' | PruneState | 'UNKNOWN'> {
    for (let i = 0; i < MAX_WRITE_RESOLVE; i++) {
      const st = this.derive(taskId);
      if (st.kind === 'live') return 'CONFIRMED';
      if (st.kind === 'committed') return 'PRUNED';
      if (st.kind === 'preparing') {
        await this.decidePrune(taskId, st.attempt as number, 'abort', undefined, by);
        continue;
      }
      return st.kind === 'corrupt' || st.kind === 'legacy' ? st : 'UNKNOWN';
    }
    return 'UNKNOWN';
  }

  // ----- EventStore -----------------------------------------------------------------------------------------------

  async readLog(taskId: string, opts: { afterSeq?: number; rawEvents?: boolean } = {}): Promise<LogRead> {
    const entry = this.tasks.get(taskId);
    if (!entry) return { exists: false, tombstone: null, events: [], compactedThrough: 0, diagnostics: [] };
    const st = this.derive(taskId);
    const hidden = st.kind === 'committed' || (st.kind === 'preparing' && !opts.rawEvents);
    if (hidden) {
      const diagnostics: StoreDiagnostic[] = entry.events.length > 0 ? [{ code: 'PRUNE_INCOMPLETE', taskId, name: 'events' }] : [];
      return { exists: true, tombstone: structuredClone(st.tombstone as Tombstone), prune: st, events: [], compactedThrough: 0, diagnostics };
    }
    const after = opts.afterSeq ?? 0;
    return {
      exists: true,
      tombstone: null,
      ...(st.kind === 'live' ? {} : { prune: st }),
      events: structuredClone(entry.events.filter((e) => e.seq > after)),
      compactedThrough: 0,
      diagnostics: [],
    };
  }

  async append(event: TaskEvent): Promise<'appended' | 'conflict'> {
    let entry = this.tasks.get(event.taskId);
    // AV: a task is created by its first event only; a later event never creates one (Design A, section 31.1).
    if (!entry && event.seq > 1) throw new PruneDecisionCorruptError(event.taskId, 'task-dir-missing');
    if (entry) {
      const st = this.derive(event.taskId);
      if (st.kind === 'committed') throw new TaskPrunedError(event.taskId);
      if (event.seq > entry.events.length + 1) throw new LogCorruptError(event.taskId, event.seq, 'predecessor event is missing; refusing to publish past a hole');
    }
    if (!entry) {
      entry = { events: [], attempts: [], tombstone: null, refs: new Map() };
      this.tasks.set(event.taskId, entry);
    }
    if (event.seq <= entry.events.length) {
      // The slot is taken: the same event again is adopted, a different one is a conflict (canonical identity).
      if (serializeEvent(entry.events[event.seq - 1] as TaskEvent) !== serializeEvent(event)) return 'conflict';
    } else {
      entry.events.push(structuredClone(event));
    }
    const g2 = await this.settle(event.taskId, 'append');
    if (g2 === 'CONFIRMED') return 'appended';
    if (g2 === 'PRUNED') throw new TaskPrunedError(event.taskId);
    if (g2 === 'UNKNOWN') throw new StoreIoError(`the prune state of task "${event.taskId}" could not be settled after the append.`);
    throw this.refusal(event.taskId, g2);
  }

  async listTaskIds(): Promise<string[]> {
    return [...this.tasks.keys()].sort();
  }

  /**
   * Nothing to pack in memory. The input is still checked against the canonical log exactly as the filesystem store checks
   * it (CC-1, CC-2): every event must equal the stored one byte for byte, and a slot that has no stored event is refused.
   */
  async compact(taskId: string, throughSeq: number, events: TaskEvent[]): Promise<CompactionResult> {
    const entry = this.tasks.get(taskId);
    if (!entry) throw new PruneDecisionCorruptError(taskId, 'task-dir-missing');
    const st = this.derive(taskId);
    if (st.kind === 'committed') throw new TaskPrunedError(taskId);
    for (const e of events) {
      const stored = entry.events[e.seq - 1];
      if (!stored) throw new LogCorruptError(taskId, e.seq, 'compaction input slot has no canonical event');
      if (e.seq > throughSeq || serializeEvent(stored) !== serializeEvent(e)) throw new LogCorruptError(taskId, e.seq, 'compaction input is not the canonical log');
    }
    const g2 = await this.settle(taskId, 'compact');
    if (g2 === 'PRUNED') throw new TaskPrunedError(taskId);
    if (g2 === 'UNKNOWN') throw new StoreIoError(`the prune state of task "${taskId}" could not be settled after the compaction.`);
    if (g2 !== 'CONFIRMED') throw this.refusal(taskId, g2);
    return { segment: null, packedEvents: 0, removedFiles: 0 };
  }

  async pinReference(parentId: string, childId: string, at: string): Promise<'pinned' | 'parent-pruned' | 'parent-missing'> {
    const entry = this.tasks.get(parentId);
    if (!entry) return 'parent-missing';
    const before = this.derive(parentId);
    if (before.kind === 'committed') return 'parent-pruned';
    if (!entry.refs.has(childId)) entry.refs.set(childId, at);
    const g2 = await this.settle(parentId, 'pin');
    if (g2 === 'CONFIRMED') return 'pinned';
    if (g2 === 'PRUNED') return 'parent-pruned';
    if (g2 === 'UNKNOWN') throw new StoreIoError(`the prune state of task "${parentId}" could not be settled after the pin.`);
    throw this.refusal(parentId, g2);
  }

  async listReferences(parentId: string): Promise<Array<{ childId: string; at: string }>> {
    const entry = this.tasks.get(parentId);
    return entry ? [...entry.refs].map(([childId, at]) => ({ childId, at })).sort((a, b) => (a.childId < b.childId ? -1 : 1)) : [];
  }
}

function sortKeys(o: object): object {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
}
