/**
 * Real OS processes: concurrency between processes, SIGKILL at the worst
 * moment, and the end-to-end demonstration (scripts/durable-demo.ts).
 *
 * The library is transpiled once into a temp directory and the children
 * import that copy (same technique as the Coordinatorium process tests).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import ts from 'typescript';
import { DurableTasks } from './runtime.js';
import { FsEventStore } from './fs-store.js';

const initStore = (s: FsEventStore): FsEventStore => (s.initializeProtocolSync(), s);

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');
let build: string;
const dirs: string[] = [];

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

beforeAll(() => {
  build = mkdtempSync(join(tmpdir(), 'durable-build-'));
  writeFileSync(join(build, 'package.json'), '{"type":"module"}');
  compileTree(join(srcRoot, 'durable'), join(build, 'durable'));
  compileTree(join(srcRoot, 'root'), join(build, 'root'));
  mkdirSync(join(build, 'scripts'), { recursive: true });
  const demo = join(srcRoot, 'scripts', 'durable-demo.ts');
  writeFileSync(
    join(build, 'scripts', 'durable-demo.js'),
    ts.transpileModule(readFileSync(demo, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
  );
  writeFileSync(
    join(build, 'child.mjs'),
    `
import { unlinkSync } from 'fs';
import { DurableTasks, FsEventStore } from './durable/index.js';
const [dir, mode, idx] = process.argv.slice(2);
const target = { scope: 'trusted-directory', dir };
const killInWindow = {
  unlinkSync: (p, ...r) => {
    if (String(p).includes('.tmp.')) process.kill(process.pid, 'SIGKILL'); // between link() and unlink(tmp)
    return unlinkSync(p, ...r);
  },
};
const store = new FsEventStore({ target, durability: 'file', ...(mode === 'killwindow' ? { ops: killInWindow } : {}) });
const rt = new DurableTasks({ store });
if (mode === 'observe') {
  for (let i = 0; i < Number(process.argv[5] ?? 20); i++) await rt.observe('job1', { key: 'p' + idx + '-' + i, value: i, source: 'p' + idx });
  console.log('DONE');
} else if (mode === 'claim') {
  try { await rt.claim('job1', { owner: 'owner' + idx }); console.log('WON'); } catch (e) { console.log('LOST ' + e.code); }
} else if (mode === 'killwindow') {
  await rt.observe('job1', { key: 'k' + idx, value: 1 });
  console.log('SURVIVED');
} else if (mode === 'compactor') {
  let packed = 0;
  for (let i = 0; i < 60; i++) {
    const st = await rt.getState('job1');
    packed += await rt.compact('job1', { throughSeq: st.headSeq - 15 });
    await new Promise((r) => setTimeout(r, 10));
  }
  console.log('PACKED ' + packed);
} else if (mode === 'reader') {
  for (let i = 0; i < 80; i++) {
    const [r] = await new DurableTasks({ store }).verify('job1');
    if (!r.ok) { console.log('BAD ' + r.error); process.exit(3); }
    await rt.getState('job1');
  }
  console.log('READ-OK');
} else if (mode === 'deliver') {
  const [, , , , token, key] = process.argv.slice(2);
  const r = await rt.deliver(token, { v: 1 }, { idempotencyKey: key });
  console.log(r.kind);
}
`,
  );
});

afterAll(() => rmSync(build, { recursive: true, force: true }));
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'durable-proc-'));
  dirs.push(d);
  return d;
};

interface Done {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
}
function run(args: string[]): Promise<Done> {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [join(build, 'child.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    c.stdout.on('data', (d) => (stdout += d));
    c.on('close', (code, signal) => resolve({ code, signal, stdout }));
  });
}
const openRt = (dir: string): DurableTasks => new DurableTasks({ store: initStore(new FsEventStore({ target: { scope: 'trusted-directory', dir }, durability: 'file' })) });

describe('multiple OS processes', () => {
  it('6 processes appending 20 events each lose nothing and keep one valid chain', async () => {
    const dir = tmp();
    const rt = openRt(dir);
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const results = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => run([dir, 'observe', String(i), '20'])));
    expect(results.every((r) => r.code === 0 && r.stdout.includes('DONE'))).toBe(true);
    const s = await openRt(dir).getState('job1');
    expect(Object.keys(s.observations)).toHaveLength(120);
    expect(s.headSeq).toBe(121);
    expect((await openRt(dir).verify())[0]).toMatchObject({ ok: true, headSeq: 121 });
  }, 60_000);

  it('8 processes racing to claim one task: exactly one wins', async () => {
    const dir = tmp();
    await openRt(dir).createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => run([dir, 'claim', String(i)])));
    expect(results.filter((r) => r.stdout.includes('WON'))).toHaveLength(1);
    expect(results.filter((r) => r.stdout.includes('LOST LEASE_HELD'))).toHaveLength(7);
    expect((await openRt(dir).getState('job1')).epoch).toBe(1);
  }, 60_000);

  it('the same delivery from 8 processes is accepted once, the rest are duplicates', async () => {
    const dir = tmp();
    const rt = openRt(dir);
    await rt.createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const f = await rt.claim('job1', { owner: 'o' });
    const w = await rt.registerAwait(f, { awaitId: 'a', purpose: 'p' });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => run([dir, 'deliver', String(i), '0', w.token, 'same-key'])));
    expect(results.filter((r) => r.stdout.trim() === 'accepted')).toHaveLength(1);
    expect(results.filter((r) => r.stdout.trim() === 'duplicate')).toHaveLength(7);
    expect((await openRt(dir).getState('job1')).awaits['a']?.status).toBe('resolved');
  }, 60_000);
});

describe('maintenance racing with traffic (real processes)', () => {
  it('3 writers, a compactor and 2 readers run together: nothing lost, no reader ever sees a broken log', async () => {
    const dir = tmp();
    await openRt(dir).createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const results = await Promise.all([
      run([dir, 'observe', 'a', '150']),
      run([dir, 'observe', 'b', '150']),
      run([dir, 'observe', 'c', '150']),
      run([dir, 'compactor', '0']),
      run([dir, 'reader', '0']),
      run([dir, 'reader', '1']),
    ]);
    for (const r of results) expect(r.code, r.stdout).toBe(0);
    expect(results[3]?.stdout).toMatch(/PACKED \d+/);
    expect(results[4]?.stdout).toContain('READ-OK');
    const rt = openRt(dir);
    const s = await rt.getState('job1');
    expect(s.headSeq).toBe(451);
    expect(Object.keys(s.observations)).toHaveLength(450);
    expect((await rt.verify('job1'))[0]).toMatchObject({ ok: true, headSeq: 451 });
    const segs = readdirSync(join(dir, 'tasks', 'job1', 'segments'));
    expect(segs.length).toBeGreaterThan(0); // compaction really happened while writers ran
  }, 120_000);
});

describe('SIGKILL at the worst moment', () => {
  it('a writer killed between link() and unlink(tmp) leaves a complete event with two names; nothing is lost and nothing wedges', async () => {
    const dir = tmp();
    await openRt(dir).createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    const r = await run([dir, 'killwindow', '0']);
    expect(r.signal).toBe('SIGKILL');
    expect(r.stdout).not.toContain('SURVIVED');

    const eventsDir = join(dir, 'tasks', 'job1', 'events');
    const files = readdirSync(eventsDir).sort();
    expect(files.some((n) => n.includes('.tmp.'))).toBe(true); // the orphaned staging name
    expect(statSync(join(eventsDir, '000000002.json')).nlink).toBe(2);

    // A fresh process: the event the dead writer published is part of the log…
    const rt = openRt(dir);
    const s = await rt.getState('job1');
    expect(s.observations['k0']?.value).toBe(1);
    // …the residue is repaired…
    expect(readdirSync(eventsDir).some((n) => n.includes('.tmp.'))).toBe(false);
    expect(statSync(join(eventsDir, '000000002.json')).nlink).toBe(1);
    // …and the task continues.
    await rt.observe('job1', { key: 'next', value: 2 });
    expect((await openRt(dir).verify())[0]).toMatchObject({ ok: true, headSeq: 3 });
  }, 30_000);

  it('a storm: processes killed at random points; the log stays valid and writable, acknowledged events survive', async () => {
    const dir = tmp();
    await openRt(dir).createTask({ taskId: 'job1', kind: 'k', goal: 'g' });
    for (let round = 0; round < 6; round++) {
      const kids = [0, 1, 2, 3].map((i) => {
        const c = spawn(process.execPath, [join(build, 'child.mjs'), dir, 'observe', `r${round}p${i}`, '500'], { stdio: 'ignore' });
        return new Promise<void>((resolve) => c.on('close', () => resolve()));
      });
      await new Promise((r) => setTimeout(r, 120 + round * 20));
      // kill them all, wherever they are
      spawnSync('pkill', ['-9', '-f', `${join(build, 'child.mjs')} ${dir}`]);
      await Promise.all(kids);

      const rt = openRt(dir);
      const [report] = await rt.verify('job1');
      expect(report?.ok, `round ${round}: ${report?.error}`).toBe(true);
      await rt.observe('job1', { key: `alive-${round}`, value: round }); // never wedged
    }
    const s = await openRt(dir).getState('job1');
    expect(Object.keys(s.observations).filter((k) => k.startsWith('alive-'))).toHaveLength(6);
    expect(s.eventCount).toBe(s.headSeq);
    // every process wrote distinct keys: each one that exists carries its own value
    for (const o of Object.values(s.observations)) if (o.key.startsWith('r')) expect(typeof o.value).toBe('number');
  }, 120_000);
});

describe('end-to-end demonstration (separate processes, SIGKILL, days of waiting)', () => {
  for (const [scenario, outcome, status] of [
    ['direct', 'completed', 'completed'],
    ['adaptive', 'completed', 'completed'],
    ['recovery', 'recovered-and-stopped', 'cancelled'],
  ] as const) {
    it(`scenario ${scenario}`, () => {
      const dir = tmp();
      const r = spawnSync(process.execPath, [join(build, 'scripts', 'durable-demo.js'), 'run', '--dir', dir, '--scenario', scenario], { encoding: 'utf8' });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const line = /DEMO (.*)/.exec(r.stdout);
      const demo = JSON.parse((line as RegExpExecArray)[1] as string);
      expect(demo).toMatchObject({ scenario, outcome: { outcome }, status, verified: true });
      expect(r.stdout).toContain('request sent; the process is killed');
      expect(r.stdout).toContain('contradicting answer for globex: conflict');
      expect(r.stdout).toContain('research request for initech: already sent earlier');
      expect(r.stdout).toContain(`mode=${scenario}`);
      void relative;
    }, 60_000);
  }
});
