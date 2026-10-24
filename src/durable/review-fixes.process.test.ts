/**
 * DURABLE-FIX-001 — regression tests that need REAL OS processes: races that a single event loop cannot
 * produce (D-1 across processes, D-7 prune vs. child creation). Interleavings are forced with file barriers,
 * never with sleeps that the assertion depends on.
 *
 * Same technique as process.test.ts: the library is transpiled once into a temp directory and the
 * children import that copy.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';
import ts from 'typescript';
import { DurableTasks } from './runtime.js';
import { FsEventStore } from './fs-store.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');
let build: string;
const dirs: string[] = [];
const kids: ChildProcess[] = [];

function compileTree(from: string, to: string): void {
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, e.name);
    if (e.isDirectory()) {
      compileTree(src, join(to, e.name));
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      mkdirSync(to, { recursive: true });
      const out = ts.transpileModule(readFileSync(src, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      writeFileSync(join(to, e.name.replace(/\.ts$/, '.js')), out.outputText);
    }
  }
}

const CHILD = `
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DurableTasks, FsEventStore } from './durable/index.js';

const [dir, mode, ctl, id, extra] = process.argv.slice(2);
const store = new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' });
const rt = new DurableTasks({ store });
const touch = (name) => writeFileSync(join(ctl, name), '');
const has = (name) => existsSync(join(ctl, name));
const until = async (pred, ms = 15000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('barrier timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const say = (s) => process.stdout.write(s + '\\n');

if (mode === 'effect-race') {
  // Both processes hold the SAME fence (extra = fence JSON) and call runEffect at the same moment.
  const fence = JSON.parse(extra);
  touch('ready.' + id);
  await until(() => has('ready.0') && has('ready.1'));
  try {
    const out = await rt.runEffect(fence, 'pay-1', async () => {
      touch('exec.' + id);
      touch('entered.' + id);
      // stay inside fn until the peer has been in fn too (the defect) or the parent released us
      await until(() => has('entered.' + (id === '0' ? '1' : '0')) || has('release'));
      return { by: id };
    }, { description: 'pay' });
    say('RESULT OK replayed=' + out.replayed);
  } catch (e) {
    say('RESULT ' + (e.code ?? e.name));
  }
} else if (mode === 'effect-crash') {
  // claim, announce an effect, start it, and block forever inside fn (the parent SIGKILLs us there)
  const fence = await rt.claim('job1', { owner: 'worker-a', leaseMs: 300 });
  touch('claimed');
  await rt.runEffect(fence, 'charge', async () => {
    touch('exec.crashing');
    touch('entered.crashing');
    await new Promise(() => {});
  }, { description: 'charge' });
} else if (mode === 'effect-takeover') {
  const fence = await rt.claim('job1', { owner: 'worker-b' });
  try {
    await rt.runEffect(fence, 'charge', async () => {
      touch('exec.takeover');
      return { again: true };
    }, { description: 'charge' });
    say('RESULT OK');
  } catch (e) {
    say('RESULT ' + (e.code ?? e.name));
  }
}
`;

beforeAll(() => {
  build = mkdtempSync(join(tmpdir(), 'durable-fix-build-'));
  writeFileSync(join(build, 'package.json'), '{"type":"module"}');
  compileTree(join(srcRoot, 'durable'), join(build, 'durable'));
  compileTree(join(srcRoot, 'root'), join(build, 'root'));
  writeFileSync(join(build, 'child.mjs'), CHILD);
});

afterAll(() => rmSync(build, { recursive: true, force: true }));
afterEach(() => {
  for (const k of kids.splice(0)) if (k.exitCode === null && k.signalCode === null) k.kill('SIGKILL');
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const tmp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};
const openRt = (dir: string): DurableTasks => new DurableTasks({ store: new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' }) });

interface Child {
  proc: ChildProcess;
  lines: string[];
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** Resolves with the first line that starts with `prefix`. */
  line: (prefix: string) => Promise<string>;
}
function spawnChild(args: string[]): Child {
  const proc = spawn(process.execPath, [join(build, 'child.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  kids.push(proc);
  const lines: string[] = [];
  const waiters: Array<{ prefix: string; resolve: (l: string) => void }> = [];
  let buf = '';
  let stderr = '';
  proc.stdout!.on('data', (d) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      lines.push(l);
      for (const w of [...waiters]) if (l.startsWith(w.prefix)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(l));
    }
  });
  proc.stderr!.on('data', (d) => (stderr += d));
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    proc.on('close', (code, signal) => {
      if (code && stderr) lines.push(`STDERR ${stderr.slice(0, 500)}`);
      resolve({ code, signal });
    }),
  );
  return {
    proc,
    lines,
    done,
    line: (prefix) =>
      new Promise((resolve, reject) => {
        const hit = lines.find((l) => l.startsWith(prefix));
        if (hit) return resolve(hit);
        waiters.push({ prefix, resolve });
        void done.then(() => reject(new Error(`child exited before printing "${prefix}": ${lines.join(' | ')}`)));
      }),
  };
}
async function waitFor(pred: () => boolean, ms = 15_000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for a condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}
const execCount = (ctl: string): number => readdirSync(ctl).filter((n) => n.startsWith('exec.')).length;

describe('D-1 across real processes', () => {
  it('two processes holding one fence and calling runEffect together: fn runs in exactly one of them', async () => {
    const dir = tmp('durable-d1-');
    const ctl = tmp('durable-d1-ctl-');
    const rt = openRt(dir);
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const fence = await rt.claim('job1', { owner: 'shared-owner' });

    const a = spawnChild([dir, 'effect-race', ctl, '0', JSON.stringify(fence)]);
    const b = spawnChild([dir, 'effect-race', ctl, '1', JSON.stringify(fence)]);
    // The first RESULT to appear is the refused caller (on the defective code nobody finishes until both
    // are inside fn, which releases them). Releasing the winner after that is deterministic.
    await Promise.race([a.line('RESULT'), b.line('RESULT')]);
    writeFileSync(join(ctl, 'release'), '');
    await Promise.all([a.done, b.done]);

    const results = [...a.lines, ...b.lines].filter((l) => l.startsWith('RESULT'));
    expect(results).toHaveLength(2);
    expect(execCount(ctl)).toBe(1);
    expect(results.filter((l) => l.startsWith('RESULT OK'))).toHaveLength(1);
    expect(results.filter((l) => /RESULT EFFECT_(CONFLICT|IN_DOUBT)/.test(l))).toHaveLength(1);

    const log = await openRt(dir).getLog('job1');
    expect(log.events.filter((e) => e.type === 'effect.intended')).toHaveLength(1);
    expect(log.events.filter((e) => e.type === 'effect.completed')).toHaveLength(1);
    expect((await openRt(dir).verify('job1'))[0]).toMatchObject({ ok: true });
  }, 60_000);

  it('a process killed inside fn, then a new owner: the effect is in doubt and fn is not run again', async () => {
    const dir = tmp('durable-d1-');
    const ctl = tmp('durable-d1-ctl-');
    await openRt(dir).createTask({ taskId: 'job1', kind: 'k', goal: 'g' });

    const first = spawnChild([dir, 'effect-crash', ctl, 'a']);
    await waitFor(() => existsSync(join(ctl, 'entered.crashing')));
    first.proc.kill('SIGKILL');
    await first.done;
    await new Promise((r) => setTimeout(r, 400)); // the 300 ms lease of the dead worker runs out

    const second = spawnChild([dir, 'effect-takeover', ctl, 'b']);
    await second.done;
    expect(second.lines.find((l) => l.startsWith('RESULT'))).toBe('RESULT EFFECT_IN_DOUBT');
    expect(execCount(ctl)).toBe(1);

    const state = await openRt(dir).getState('job1');
    expect(state.effects['charge']).toMatchObject({ status: 'intended', intendedEpoch: 1 });
    const a = await openRt(dir).assess('job1');
    expect(a.mode).toBe('recovery');
    expect(a.reasons.map((r) => r.code)).toContain('EFFECT_IN_DOUBT');
  }, 60_000);
});
