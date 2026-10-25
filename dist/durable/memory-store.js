/**
 * In-memory `EventStore`. For tests of application logic built on Durable
 * State and for embedding where durability is not wanted. It implements the
 * same contract as the filesystem store (the shared conformance suite runs
 * against both), but nothing survives the process.
 */
import { LogCorruptError, TaskPrunedError, TombstoneCommittedError } from './errors.js';
export class MemoryEventStore {
    tasks = new Map();
    async readLog(taskId, opts = {}) {
        const entry = this.tasks.get(taskId);
        if (!entry)
            return { exists: false, tombstone: null, events: [], compactedThrough: 0, diagnostics: [] };
        if (entry.tombstone) {
            const diagnostics = entry.events.length > 0 ? [{ code: 'PRUNE_INCOMPLETE', taskId, name: 'events' }] : [];
            return { exists: true, tombstone: structuredClone(entry.tombstone), events: [], compactedThrough: 0, diagnostics };
        }
        const after = opts.afterSeq ?? 0;
        return { exists: true, tombstone: null, events: structuredClone(entry.events.filter((e) => e.seq > after)), compactedThrough: 0, diagnostics: [] };
    }
    async append(event) {
        let entry = this.tasks.get(event.taskId);
        if (entry?.tombstone)
            throw new TaskPrunedError(event.taskId);
        if (!entry) {
            entry = { events: [], tombstone: null, refs: new Map() };
            this.tasks.set(event.taskId, entry);
        }
        if (event.seq !== entry.events.length + 1)
            return 'conflict';
        entry.events.push(structuredClone(event));
        return 'appended';
    }
    async listTaskIds() {
        return [...this.tasks.keys()].sort();
    }
    /** Nothing to pack in memory; verifies the events are the stored ones so the contract is still exercised. */
    async compact(taskId, throughSeq, events) {
        const entry = this.tasks.get(taskId);
        if (!entry || entry.tombstone)
            throw new TaskPrunedError(taskId);
        for (const e of events) {
            const stored = entry.events[e.seq - 1];
            if (!stored || stored.hash !== e.hash || e.seq > throughSeq) {
                throw new LogCorruptError(taskId, e.seq, 'compaction input does not match the stored log');
            }
        }
        return { segment: null, packedEvents: 0, removedFiles: 0 };
    }
    async markPruned(tombstone) {
        const entry = this.tasks.get(tombstone.taskId);
        if (!entry)
            throw new LogCorruptError(tombstone.taskId, null, 'cannot prune an unknown task');
        if (entry.tombstone && entry.tombstone.headHash !== tombstone.headHash) {
            throw new LogCorruptError(tombstone.taskId, null, 'a different tombstone already exists');
        }
        if (!entry.tombstone)
            entry.tombstone = structuredClone(tombstone);
    }
    async withdrawTombstone(tombstone) {
        const entry = this.tasks.get(tombstone.taskId);
        if (!entry?.tombstone)
            return;
        const last = entry.events[entry.events.length - 1];
        if (!last || last.seq !== tombstone.headSeq || last.hash !== tombstone.headHash) {
            throw new TombstoneCommittedError(tombstone.taskId, 'the data of the pruned task is no longer complete; the tombstone cannot be withdrawn');
        }
        entry.tombstone = null;
    }
    async pinReference(parentId, childId, at) {
        const entry = this.tasks.get(parentId);
        if (!entry)
            return 'parent-missing';
        if (entry.tombstone)
            return 'parent-pruned';
        if (!entry.refs.has(childId))
            entry.refs.set(childId, at);
        return 'pinned';
    }
    async listReferences(parentId) {
        const entry = this.tasks.get(parentId);
        return entry ? [...entry.refs].map(([childId, at]) => ({ childId, at })).sort((a, b) => (a.childId < b.childId ? -1 : 1)) : [];
    }
    async prune(tombstone) {
        await this.markPruned(tombstone);
        const entry = this.tasks.get(tombstone.taskId);
        const removed = entry.events.length;
        entry.events = [];
        entry.refs.clear();
        return { removedFiles: removed };
    }
}
