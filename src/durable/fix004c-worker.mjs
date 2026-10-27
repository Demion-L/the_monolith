/**
 * FIX-004C test worker: one independent OS process with its own FsEventStore.
 *
 * Test-only. It is copied next to a transpiled copy of the library by fix004c-process.test.ts and never shipped.
 * Argument: path of a JSON config { id, dir, ctl, hooks, steps, barrierTimeoutMs }.
 *
 * Barriers are files in `ctl`:
 *   <name>.<id>.ready   written by this worker when it has reached the point (it then blocks, synchronously, as a
 *                       SIGSTOP would block it),
 *   <name>.release      written by the parent: releases every worker waiting at <name>,
 *   <name>.<id>.release written by the parent: releases only this worker.
 * A worker that is never released exits with 99 after `barrierTimeoutMs`, so no orphan survives a failed test.
 *
 * Hooks stop the worker around a filesystem call of the real library (`fs.linkSync` / `fs.unlinkSync` / `fs.openSync` /
 * `fs.closeSync` / `fs.readdirSync` are wrapped before the library is imported): { op: 'link'|'unlink'|'open'|'close'|
 * 'readdir', match: <regex on the destination / path>, nth, phase: 'before'|'after', barrier }. Nothing in the library
 * is changed for this.
 *   open    path of the file being opened ('after': the descriptor exists, nothing has been read yet),
 *   close   path the closed descriptor was opened for ('before': the read of that file is complete),
 *   readdir directory being listed ('after': the listing is in hand, nothing has been judged yet).
 */
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { id, dir, ctl } = cfg;
const timeoutMs = cfg.barrierTimeoutMs ?? 30_000;
const hooks = cfg.hooks ?? [];

// Captured before wrapping: the barrier itself must not be hooked.
const exists = fs.existsSync;
const writeFile = fs.writeFileSync;
const appendFile = fs.appendFileSync;
const pause = new Int32Array(new SharedArrayBuffer(4));

function barrier(name) {
  writeFile(join(ctl, `${name}.${id}.ready`), '');
  const t0 = Date.now();
  while (!exists(join(ctl, `${name}.release`)) && !exists(join(ctl, `${name}.${id}.release`))) {
    if (Date.now() - t0 > timeoutMs) process.exit(99);
    Atomics.wait(pause, 0, 0, 2);
  }
}

const counts = hooks.map(() => 0);
// A hook with `since: { link: <regex> }` counts only after a link to a matching destination has completed in THIS
// process: it pins the stop inside the `append` that published that file, not in an earlier read of the same directory.
const armed = hooks.map((h) => !h.since);
const arm = (dest) => hooks.forEach((h, i) => { if (h.since && new RegExp(h.since.link).test(String(dest))) armed[i] = true; });
function wrap(fn, op, targetOf) {
  const orig = fs[fn];
  fs[fn] = function wrapped(...a) {
    const target = String(targetOf(a));
    const hit = [];
    hooks.forEach((h, i) => {
      if (h.op !== op || !armed[i] || !new RegExp(h.match).test(target)) return;
      counts[i]++;
      if (counts[i] === (h.nth ?? 1)) hit.push(h);
    });
    for (const h of hit) if (h.phase === 'before') barrier(h.barrier);
    const r = orig.apply(this, a);
    if (op === 'link') arm(target);
    for (const h of hit) if (h.phase === 'after') barrier(h.barrier);
    return r;
  };
}
wrap('linkSync', 'link', (a) => a[1]);
wrap('unlinkSync', 'unlink', (a) => a[0]);
wrap('readdirSync', 'readdir', (a) => a[0]);

// Every unlink the process attempts (through `ops.unlinkSync` of the library AND direct `fs.unlinkSync` calls: the
// wrapper is installed before the library is imported, so both resolve to it) is recorded for criterion 26.
const origUnlinkRec = fs.unlinkSync;
fs.unlinkSync = function recordedUnlink(...a) {
  appendFile(join(ctl, `${id}.unlinks`), `${String(a[0])}\n`);
  return origUnlinkRec.apply(this, a);
};

// open / close: a descriptor is attributed to the path it was opened for, so that `close` marks "the read is complete".
const fdPath = new Map();
const origOpen = fs.openSync;
fs.openSync = function wrappedOpen(...a) {
  const target = String(a[0]);
  const hit = [];
  hooks.forEach((h, i) => {
    if (h.op !== 'open' || !armed[i] || !new RegExp(h.match).test(target)) return;
    counts[i]++;
    if (counts[i] === (h.nth ?? 1)) hit.push(h);
  });
  for (const h of hit) if (h.phase === 'before') barrier(h.barrier);
  const fd = origOpen.apply(this, a);
  fdPath.set(fd, target);
  for (const h of hit) if (h.phase === 'after') barrier(h.barrier);
  return fd;
};
const origClose = fs.closeSync;
fs.closeSync = function wrappedClose(fd) {
  const target = fdPath.get(fd) ?? '';
  fdPath.delete(fd);
  const hit = [];
  hooks.forEach((h, i) => {
    if (h.op !== 'close' || !armed[i] || !new RegExp(h.match).test(target)) return;
    counts[i]++;
    if (counts[i] === (h.nth ?? 1)) hit.push(h);
  });
  for (const h of hit) if (h.phase === 'before') barrier(h.barrier);
  const r = origClose.call(this, fd);
  for (const h of hit) if (h.phase === 'after') barrier(h.barrier);
  return r;
};
syncBuiltinESMExports();

const { FsEventStore } = await import('./durable/fs-store.js');
const { DurableTasks } = await import('./durable/runtime.js');

const store = new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
const rt = new DurableTasks({ store });

const logFile = join(ctl, `${id}.log`);
const log = (rec) => appendFile(logFile, `${JSON.stringify(rec)}\n`);
const errOf = (e) => ({ name: e?.constructor?.name ?? 'Error', code: e?.code ?? null, message: String(e?.message ?? e).slice(0, 300) });

let lastAttempt = null;
async function run(st) {
  switch (st.op) {
    case 'barrier':
      barrier(st.name);
      return null;
    case 'append':
      return store.append(st.event);
    case 'compact':
      return store.compact(st.taskId, st.throughSeq, st.events);
    case 'prepare': {
      const r = await store.preparePrune(st.tombstone);
      lastAttempt = r.attempt;
      return r;
    }
    case 'decide':
      return store.decidePrune(st.tombstone.taskId, st.attempt ?? lastAttempt, st.outcome, st.outcome === 'commit' ? st.tombstone : undefined, st.by);
    case 'prune':
      return store.prune(st.tombstone, st.requireCommit ? { requireCommit: true } : {});
    case 'sweep':
      return store.sweepCompacted(st.taskId);
    case 'pruneState':
      return store.pruneState(st.taskId);
    case 'readLog': {
      const l = await store.readLog(st.taskId, { rawEvents: true });
      return {
        seqs: l.events.map((e) => e.seq), hashes: l.events.map((e) => e.hash), types: l.events.map((e) => e.type),
        compactedThrough: l.compactedThrough, diagnostics: l.diagnostics.map((d) => d.code), prune: l.prune?.kind ?? null, exists: l.exists,
      };
    }
    case 'rt.createTask': {
      const r = await rt.createTask(st.input);
      return { taskId: r.taskId, created: r.created };
    }
    case 'rt.claim':
      return rt.claim(st.taskId, { owner: st.owner, leaseMs: st.leaseMs });
    case 'rt.effect': {
      // A controlled effect: it appends one line to a file the test owns. No network, no external system.
      const r = await rt.runEffect(st.fence, st.key, async () => {
        appendFile(join(ctl, 'effects.log'), `${id}:${st.key}\n`);
        return { done: true };
      }, { description: 'fix004c controlled effect' });
      return { replayed: r.replayed };
    }
    case 'rt.deliver': {
      const r = await rt.deliver(st.token, st.payload ?? { v: 1 }, { idempotencyKey: st.key });
      return { kind: r.kind };
    }
    case 'rt.state': {
      const s = await rt.getState(st.taskId);
      return { headSeq: s.headSeq, epoch: s.epoch, owner: s.owner ?? null };
    }
    default:
      throw new Error(`unknown step ${st.op}`);
  }
}

for (const [i, st] of cfg.steps.entries()) {
  try {
    const value = await run(st);
    log({ i, op: st.op, ok: true, value: value ?? null });
  } catch (e) {
    log({ i, op: st.op, ok: false, error: errOf(e) });
    if (!st.tolerate) break;
  }
}
log({ done: true });
