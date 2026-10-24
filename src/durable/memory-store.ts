/**
 * In-memory `EventStore`. For tests of application logic built on Durable
 * State and for embedding where durability is not wanted. It implements the
 * same contract as the filesystem store (the shared conformance suite runs
 * against both), but nothing survives the process.
 */

import { LogCorruptError, TaskPrunedError } from './errors.js';
import type { CompactionResult, EventStore, LogRead, TaskEvent, Tombstone } from './types.js';

interface Entry {
  events: TaskEvent[];
  tombstone: Tombstone | null;
}

export class MemoryEventStore implements EventStore {
  private readonly tasks = new Map<string, Entry>();

  async readLog(taskId: string, opts: { afterSeq?: number } = {}): Promise<LogRead> {
    const entry = this.tasks.get(taskId);
    if (!entry) return { exists: false, tombstone: null, events: [], compactedThrough: 0, diagnostics: [] };
    if (entry.tombstone) return { exists: true, tombstone: structuredClone(entry.tombstone), events: [], compactedThrough: 0, diagnostics: [] };
    const after = opts.afterSeq ?? 0;
    return { exists: true, tombstone: null, events: structuredClone(entry.events.filter((e) => e.seq > after)), compactedThrough: 0, diagnostics: [] };
  }

  async append(event: TaskEvent): Promise<'appended' | 'conflict'> {
    let entry = this.tasks.get(event.taskId);
    if (entry?.tombstone) throw new TaskPrunedError(event.taskId);
    if (!entry) {
      entry = { events: [], tombstone: null };
      this.tasks.set(event.taskId, entry);
    }
    if (event.seq !== entry.events.length + 1) return 'conflict';
    entry.events.push(structuredClone(event));
    return 'appended';
  }

  async listTaskIds(): Promise<string[]> {
    return [...this.tasks.keys()].sort();
  }

  /** Nothing to pack in memory; verifies the events are the stored ones so the contract is still exercised. */
  async compact(taskId: string, throughSeq: number, events: TaskEvent[]): Promise<CompactionResult> {
    const entry = this.tasks.get(taskId);
    if (!entry || entry.tombstone) throw new TaskPrunedError(taskId);
    for (const e of events) {
      const stored = entry.events[e.seq - 1];
      if (!stored || stored.hash !== e.hash || e.seq > throughSeq) {
        throw new LogCorruptError(taskId, e.seq, 'compaction input does not match the stored log');
      }
    }
    return { segment: null, packedEvents: 0, removedFiles: 0 };
  }

  async prune(tombstone: Tombstone): Promise<{ removedFiles: number }> {
    const entry = this.tasks.get(tombstone.taskId);
    if (!entry) throw new LogCorruptError(tombstone.taskId, null, 'cannot prune an unknown task');
    const removed = entry.events.length;
    entry.events = [];
    entry.tombstone = structuredClone(tombstone);
    return { removedFiles: removed };
  }
}
