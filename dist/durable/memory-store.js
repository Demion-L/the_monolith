/**
 * In-memory `EventStore`. For tests of application logic built on Durable
 * State and for embedding where durability is not wanted. It implements the
 * same contract as the filesystem store (the shared conformance suite runs
 * against both), including the prune decision register (ADR-019) and the
 * canonical-input rules of compaction (Design A, section 40), but nothing
 * survives the process. There is no version marker: it belongs to the
 * filesystem layout.
 */
import { LogCorruptError, PruneAttemptLimitError, PruneDecisionCorruptError, RetentionRefusedError, StoreIoError, TaskPrunedError, TombstoneCommittedError, } from './errors.js';
import { tombstoneProblem } from './prune-check.js';
import { takeMemorySeams } from './seams.js';
import { serializeEvent } from './log.js';
import { MAX_PRUNE_ATTEMPTS } from './register.js';
const MAX_WRITE_RESOLVE = 3;
export class MemoryEventStore {
    tasks = new Map();
    maxAttempts;
    constructor() {
        this.maxAttempts = takeMemorySeams().maxPruneAttempts ?? MAX_PRUNE_ATTEMPTS;
    }
    // ----- the register ---------------------------------------------------------------------------------------------
    derive(taskId) {
        const entry = this.tasks.get(taskId);
        if (!entry)
            return { kind: 'missing' };
        const commitAt = entry.attempts.findIndex((a) => a.decision?.outcome === 'commit');
        if (commitAt >= 0) {
            return {
                kind: 'committed',
                attempt: commitAt + 1,
                tombstone: structuredClone(entry.attempts[commitAt].tombstone),
                residue: entry.events.length + entry.refs.size,
                durability: 'NOT_GUARANTEED',
            };
        }
        const m = entry.attempts.length;
        if (m === 0)
            return { kind: 'live', attempt: 0 };
        const last = entry.attempts[m - 1];
        if (last.decision)
            return { kind: 'live', attempt: m };
        return { kind: 'preparing', attempt: m, tombstone: structuredClone(last.tombstone) };
    }
    refusal(taskId, st) {
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
    async pruneState(taskId) {
        return this.derive(taskId);
    }
    /** F-1: the log is that of a finished task whose head is the one the tombstone names. No `await` between check and write. */
    assertPrunable(entry, tombstone) {
        const problem = tombstoneProblem(tombstone.taskId, entry.events, tombstone);
        if (problem !== null)
            throw new RetentionRefusedError(tombstone.taskId, problem);
    }
    async preparePrune(tombstone) {
        const taskId = tombstone.taskId;
        const st = this.derive(taskId);
        if (st.kind === 'missing')
            throw new LogCorruptError(taskId, null, 'cannot prune an unknown task');
        if (st.kind === 'preparing')
            return { attempt: st.attempt, created: false };
        if (st.kind !== 'live')
            throw this.refusal(taskId, st);
        const entry = this.tasks.get(taskId);
        const n = entry.attempts.length + 1;
        if (n > this.maxAttempts)
            throw new PruneAttemptLimitError(taskId, this.maxAttempts);
        this.assertPrunable(entry, tombstone); // synchronous up to the push: nothing can append in between
        entry.attempts.push({ tombstone: structuredClone(tombstone), decision: null });
        return { attempt: n, created: true };
    }
    async decidePrune(taskId, attempt, outcome, tombstone, by) {
        const entry = this.tasks.get(taskId);
        const a = entry?.attempts[attempt - 1];
        if (!entry || !a)
            throw new LogCorruptError(taskId, null, `there is no prepare for prune attempt ${attempt}; a decision needs one`);
        if (outcome !== 'commit' && outcome !== 'abort')
            throw new LogCorruptError(taskId, null, 'a prune decision is either "commit" or "abort"');
        if (outcome === 'commit' && (!tombstone || JSON.stringify(sortKeys(tombstone)) !== JSON.stringify(sortKeys(a.tombstone)))) {
            throw new LogCorruptError(taskId, null, 'a commit must carry the tombstone of its attempt');
        }
        if (!a.decision && outcome === 'commit')
            this.assertPrunable(entry, a.tombstone);
        if (!a.decision)
            a.decision = outcome === 'abort' ? { outcome, ...(by ? { by } : {}) } : { outcome };
        return a.decision.outcome;
    }
    // ----- adapters of the pre-register operations ------------------------------------------------------------------
    async markPruned(tombstone) {
        const st = this.derive(tombstone.taskId);
        if (st.kind === 'preparing' || st.kind === 'committed') {
            if (st.tombstone.headHash !== tombstone.headHash)
                throw new LogCorruptError(tombstone.taskId, null, 'a different tombstone already exists');
            return;
        }
        await this.preparePrune(tombstone);
    }
    async withdrawTombstone(tombstone) {
        const taskId = tombstone.taskId;
        const st = this.derive(taskId);
        if (st.kind === 'live' || st.kind === 'missing')
            return;
        if (st.kind === 'committed')
            throw new TombstoneCommittedError(taskId, 'the prune is committed; the tombstone cannot be withdrawn');
        if (st.kind !== 'preparing')
            throw this.refusal(taskId, st);
        if (st.tombstone.headHash !== tombstone.headHash)
            throw new LogCorruptError(taskId, null, 'a different tombstone exists; refusing to withdraw it');
        const w = await this.decidePrune(taskId, st.attempt, 'abort', undefined, 'creator');
        if (w === 'commit')
            throw new TombstoneCommittedError(taskId, 'the prune is committed; the tombstone cannot be withdrawn');
    }
    async prune(tombstone, opts = {}) {
        const taskId = tombstone.taskId;
        let st = this.derive(taskId);
        if (st.kind === 'missing')
            throw new LogCorruptError(taskId, null, 'cannot prune an unknown task');
        if (st.kind === 'live' || st.kind === 'preparing') {
            if (opts.requireCommit)
                throw new RetentionRefusedError(taskId, 'no prune decision has been committed for it');
            if (st.kind === 'live' && (st.attempt ?? 0) > 0)
                throw new RetentionRefusedError(taskId, 'its last prune attempt was aborted by a task that needs it');
            if (st.kind === 'preparing' && st.tombstone.headHash !== tombstone.headHash)
                throw new LogCorruptError(taskId, null, 'a different tombstone already exists');
            // `st` was read before `preparePrune` re-derives: only the attempt seen here (or the first) may be committed.
            const expected = st.kind === 'preparing' ? st.attempt : 1;
            const opened = await this.preparePrune(tombstone);
            const attempt = opened.attempt;
            if (attempt !== expected) {
                if (opened.created)
                    await this.decidePrune(taskId, attempt, 'abort', undefined, 'pruner');
                throw new RetentionRefusedError(taskId, 'its prune attempt was aborted by a task that needs it');
            }
            const entry = this.tasks.get(taskId);
            const tomb = entry.attempts[attempt - 1].tombstone;
            if (tomb.headHash !== tombstone.headHash)
                throw new LogCorruptError(taskId, null, 'a different tombstone already exists');
            const w = await this.decidePrune(taskId, attempt, 'commit', tomb, 'pruner');
            if (w === 'abort')
                throw new RetentionRefusedError(taskId, 'the prune attempt was aborted by a task that needs it');
            st = this.derive(taskId);
        }
        if (st.kind !== 'committed')
            throw this.refusal(taskId, st);
        if (st.tombstone.headHash !== tombstone.headHash)
            throw new LogCorruptError(taskId, null, 'a different tombstone already exists');
        const entry = this.tasks.get(taskId);
        entry.tombstone = structuredClone(st.tombstone);
        const removed = entry.events.length;
        entry.events = [];
        entry.refs.clear();
        return { removedFiles: removed };
    }
    /** G2 (section 24.2): the register is asked AFTER a write became visible; nothing visible is ever taken back. */
    async settle(taskId, by) {
        for (let i = 0; i < MAX_WRITE_RESOLVE; i++) {
            const st = this.derive(taskId);
            if (st.kind === 'live')
                return 'CONFIRMED';
            if (st.kind === 'committed')
                return 'PRUNED';
            if (st.kind === 'preparing') {
                await this.decidePrune(taskId, st.attempt, 'abort', undefined, by);
                continue;
            }
            return st.kind === 'corrupt' || st.kind === 'legacy' ? st : 'UNKNOWN';
        }
        return 'UNKNOWN';
    }
    // ----- EventStore -----------------------------------------------------------------------------------------------
    async readLog(taskId, opts = {}) {
        const entry = this.tasks.get(taskId);
        if (!entry)
            return { exists: false, tombstone: null, events: [], compactedThrough: 0, diagnostics: [] };
        const st = this.derive(taskId);
        const hidden = st.kind === 'committed' || (st.kind === 'preparing' && !opts.rawEvents);
        if (hidden) {
            const diagnostics = entry.events.length > 0 ? [{ code: 'PRUNE_INCOMPLETE', taskId, name: 'events' }] : [];
            return { exists: true, tombstone: structuredClone(st.tombstone), prune: st, events: [], compactedThrough: 0, diagnostics };
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
    async append(event) {
        let entry = this.tasks.get(event.taskId);
        // AV: a task is created by its first event only; a later event never creates one (Design A, section 31.1).
        if (!entry && event.seq > 1)
            throw new PruneDecisionCorruptError(event.taskId, 'task-dir-missing');
        if (entry) {
            const st = this.derive(event.taskId);
            if (st.kind === 'committed')
                throw new TaskPrunedError(event.taskId);
            if (event.seq > entry.events.length + 1)
                throw new LogCorruptError(event.taskId, event.seq, 'predecessor event is missing; refusing to publish past a hole');
        }
        if (!entry) {
            entry = { events: [], attempts: [], tombstone: null, refs: new Map() };
            this.tasks.set(event.taskId, entry);
        }
        let created = false;
        if (event.seq <= entry.events.length) {
            // The slot is taken: the same event again is adopted, a different one is a conflict (canonical identity).
            if (serializeEvent(entry.events[event.seq - 1]) !== serializeEvent(event))
                return 'conflict';
        }
        else {
            entry.events.push(structuredClone(event));
            created = true;
        }
        const g2 = await this.settle(event.taskId, 'append');
        if (g2 === 'CONFIRMED')
            return created ? 'appended' : 'adopted';
        if (g2 === 'PRUNED')
            throw new TaskPrunedError(event.taskId);
        if (g2 === 'UNKNOWN')
            throw new StoreIoError(`the prune state of task "${event.taskId}" could not be settled after the append.`);
        throw this.refusal(event.taskId, g2);
    }
    async listTaskIds() {
        return [...this.tasks.keys()].sort();
    }
    /**
     * Nothing to pack in memory. The input is still checked against the canonical log exactly as the filesystem store checks
     * it (CC-1, CC-2): every event must equal the stored one byte for byte, and a slot that has no stored event is refused.
     */
    async compact(taskId, throughSeq, events) {
        const entry = this.tasks.get(taskId);
        // The same order as the filesystem store: K0 (pruned), nothing to pack, the shape of the input, the task must exist
        // (compaction never creates one), then every slot against the canonical event (K2).
        if (entry && this.derive(taskId).kind === 'committed')
            throw new TaskPrunedError(taskId);
        if (events.length === 0)
            return { segment: null, packedEvents: 0, removedFiles: 0 };
        const first = events[0];
        const last = events[events.length - 1];
        if (last.seq !== throughSeq || last.seq - first.seq + 1 !== events.length || events.some((e, i) => e.seq !== first.seq + i)) {
            throw new LogCorruptError(taskId, first.seq, 'compaction input is not a contiguous range ending at throughSeq');
        }
        if (!entry)
            throw new PruneDecisionCorruptError(taskId, 'task-dir-missing');
        for (const e of events) {
            const stored = entry.events[e.seq - 1];
            if (!stored)
                throw new LogCorruptError(taskId, e.seq, 'compaction input slot has no canonical event');
            if (serializeEvent(stored) !== serializeEvent(e))
                throw new LogCorruptError(taskId, e.seq, 'compaction input is not the canonical log');
        }
        const g2 = await this.settle(taskId, 'compact');
        if (g2 === 'PRUNED')
            throw new TaskPrunedError(taskId);
        if (g2 === 'UNKNOWN')
            throw new StoreIoError(`the prune state of task "${taskId}" could not be settled after the compaction.`);
        if (g2 !== 'CONFIRMED')
            throw this.refusal(taskId, g2);
        return { segment: null, packedEvents: 0, removedFiles: 0 };
    }
    async pinReference(parentId, childId, at) {
        const entry = this.tasks.get(parentId);
        if (!entry)
            return 'parent-missing';
        const before = this.derive(parentId);
        if (before.kind === 'committed')
            return 'parent-pruned';
        if (!entry.refs.has(childId))
            entry.refs.set(childId, at);
        const g2 = await this.settle(parentId, 'pin');
        if (g2 === 'CONFIRMED')
            return 'pinned';
        if (g2 === 'PRUNED')
            return 'parent-pruned';
        if (g2 === 'UNKNOWN')
            throw new StoreIoError(`the prune state of task "${parentId}" could not be settled after the pin.`);
        throw this.refusal(parentId, g2);
    }
    async listReferences(parentId) {
        const entry = this.tasks.get(parentId);
        return entry ? [...entry.refs].map(([childId, at]) => ({ childId, at })).sort((a, b) => (a.childId < b.childId ? -1 : 1)) : [];
    }
}
function sortKeys(o) {
    return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
}
