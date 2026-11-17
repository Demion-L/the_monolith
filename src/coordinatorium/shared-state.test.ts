/**
 * BETA-020 Phase 2 — acceptance tests for the shared operational state.
 *
 * These run the REAL compiled CLI as independent OS processes against REAL git
 * repositories with REAL linked worktrees (created in a temp dir, outside every
 * actual project). Nothing about git, locking or the file system is mocked.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { collect } from '../brief/collect.js';
import { render } from '../brief/render.js';
import { readDashboardModel } from '../readmodel/index.js';
import { adoptState, planAdoption } from './adopt.js';
import { resolveStateLocation } from './state-location.js';
import { StateAdoptError } from './errors.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSC = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');

const dirs: string[] = [];
function tmp(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

let cli: string;

beforeAll(() => {
  const outDir = tmp('monolith-p2-build-');
  execFileSync(process.execPath, [TSC, '-p', join(REPO, 'tsconfig.json'), '--outDir', outDir, '--tsBuildInfoFile', join(outDir, 'tsbuildinfo')], {
    cwd: REPO,
    stdio: 'pipe',
  });
  cli = join(outDir, 'cli', 'index.js');
}, 180_000);

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
}

interface Repo {
  main: string;
  a: string;
  b: string;
  common: string;
  statePath: string;
}

/** A repository with its main worktree and two linked worktrees (A and B). */
function makeRepo(): Repo {
  const base = tmp('monolith-p2-repo-');
  const main = join(base, 'main');
  mkdirSync(main);
  git(main, ['init', '-q', '-b', 'main']);
  writeFileSync(join(main, 'README.md'), 'x\n');
  git(main, ['add', '-A']);
  git(main, ['commit', '-q', '-m', 'init']);
  const a = join(base, 'wt-a');
  const b = join(base, 'wt-b');
  git(main, ['worktree', 'add', '-q', '-b', 'branch-a', a]);
  git(main, ['worktree', 'add', '-q', '-b', 'branch-b', b]);
  const common = realpathSync(join(main, '.git'));
  return { main, a, b, common, statePath: join(common, 'monolith', 'state.json') };
}

interface Run { code: number | null; out: string; err: string }
function run(cwd: string, args: string[]): Run {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 30_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function runAsync(cwd: string, args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as {
  schemaVersion: number;
  revision: number;
  tactical: { missions: Record<string, { status: string; storyId?: string }>; checkpoints: Record<string, unknown> };
};
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

function stateDoc(revision: number, missions: string[], schemaVersion = 3): string {
  const ms: Record<string, unknown> = {};
  for (const id of missions) {
    ms[id] = { id, title: `Mission ${id}`, system: 's', status: 'in_progress', startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', summary: null };
  }
  return JSON.stringify({ schemaVersion, revision, strategic: { systems: {} }, tactical: { missions: ms, checkpoints: {} } }, null, 2);
}
function putLocal(worktree: string, content: string): string {
  const p = join(worktree, '.monolith', 'state.json');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

// ---------------------------------------------------------------------------
// A. Two worktrees share one state
// ---------------------------------------------------------------------------

describe('A. two worktrees, one operational state', () => {
  it('both resolve the same canonical state; missions and checkpoints are visible across worktrees; revision is monotonic', () => {
    const r = makeRepo();

    // Same canonical path from the main worktree and both linked ones.
    const locs = [r.main, r.a, r.b].map((d) => resolveStateLocation(d));
    expect(new Set(locs.map((l) => l.statePath))).toEqual(new Set([r.statePath]));
    expect(locs.every((l) => l.kind === 'git-common-dir')).toBe(true);
    // `.git` is a FILE in a linked worktree — the resolver must not rely on it being a directory.
    expect(statSync(join(r.a, '.git')).isFile()).toBe(true);

    const revisions: number[] = [];
    const rev = () => readJson(r.statePath).revision;

    // 1. Mission created in A is visible in B.
    const start = run(r.a, ['mission', 'start', '--title', 'Created in A', '--system', 'sys']);
    expect(start.code, start.err).toBe(0);
    revisions.push(rev());
    const listB = run(r.b, ['mission', 'list']);
    expect(listB.out).toContain('MIS-0001');
    expect(listB.out).toContain('Created in A');

    // 2. Checkpoint added in B is visible in A.
    const cp = run(r.b, ['mission', 'checkpoint', 'MIS-0001', '--summary', 'written in B', '--remaining', 'next']);
    expect(cp.code, cp.err).toBe(0);
    revisions.push(rev());
    const cpsA = run(r.a, ['mission', 'checkpoints', 'MIS-0001']);
    expect(cpsA.out).toContain('written in B');

    // 3. Finishing in B is reflected in A and in the main worktree.
    const fin = run(r.b, ['mission', 'finish', 'MIS-0001', '--result', 'completed', '--summary', 'done']);
    expect(fin.code, fin.err).toBe(0);
    revisions.push(rev());
    for (const wt of [r.a, r.main]) {
      const out = run(wt, ['mission', 'list']).out;
      expect(out).toContain('Active missions (0)');
      expect(out).toMatch(/Finished missions \(1\)[\s\S]*MIS-0001\s+\[completed\]/);
    }

    // 4. Revision strictly increases.
    expect(revisions).toEqual([1, 2, 3]);

    // 5. No competing local state was created anywhere.
    for (const wt of [r.main, r.a, r.b]) expect(existsSync(join(wt, '.monolith', 'state.json'))).toBe(false);
    const doc = readJson(r.statePath);
    expect(doc.schemaVersion).toBe(3);
  });

  it('`state status` reports the same provenance from every worktree', () => {
    const r = makeRepo();
    run(r.a, ['mission', 'start', '--title', 'T', '--system', 's']);
    const outs = [r.main, r.a, r.b].map((d) => run(d, ['state', 'status']).out);
    for (const out of outs) {
      expect(out).toContain(`canonical state:      ${r.statePath}`);
      expect(out).toContain('worktrees:            3');
      expect(out).toContain('mode:                 shared');
      expect(out).toContain('revision=1');
      expect(out).toContain('0.2.0-beta.1');
    }
    const identity = outs.map((o) => /repository identity:\s+(\S+)/.exec(o)?.[1]);
    expect(new Set(identity).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B. Concurrency across processes and worktrees
// ---------------------------------------------------------------------------

describe('B. concurrent writers in different worktrees', () => {
  it('loses no update, corrupts nothing and never duplicates a confirmed operation', async () => {
    const r = makeRepo();
    const cwds = [r.main, r.a, r.b];
    const N = 12;
    const starts = await Promise.all(
      Array.from({ length: N }, (_, i) => runAsync(cwds[i % 3], ['mission', 'start', '--title', `M${i}`, '--system', 'conc'])),
    );
    for (const s of starts) expect(s.code, s.err).toBe(0);
    const ids = starts.map((s) => /Started mission (MIS-\d+)/.exec(s.out)?.[1]);
    expect(new Set(ids).size).toBe(N); // no duplicate id handed out

    let doc = readJson(r.statePath); // valid JSON
    expect(Object.keys(doc.tactical.missions)).toHaveLength(N); // none lost
    expect(doc.revision).toBe(N); // exactly one bump per confirmed write

    const K = 9;
    const cps = await Promise.all(
      Array.from({ length: K }, (_, i) => runAsync(cwds[i % 3], ['mission', 'checkpoint', 'MIS-0001', '--summary', `c${i}`])),
    );
    for (const c of cps) expect(c.code, c.err).toBe(0);
    doc = readJson(r.statePath);
    expect(Object.keys(doc.tactical.checkpoints)).toHaveLength(K);
    expect(doc.revision).toBe(N + K);
    // The lock and temp files are cleaned up; only state.json remains.
    expect(readdirSync(join(r.common, 'monolith')).filter((f) => f !== 'state.json')).toEqual([]);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// C. Isolation is explicit
// ---------------------------------------------------------------------------

describe('C. state.mode "isolated"', () => {
  it('keeps one independent state per worktree and says so in the diagnostics', () => {
    const r = makeRepo();
    for (const wt of [r.a, r.b]) writeFileSync(join(wt, 'monolith.config.json'), JSON.stringify({ state: { mode: 'isolated' } }));

    expect(run(r.a, ['mission', 'start', '--title', 'only in A', '--system', 's']).code).toBe(0);
    expect(run(r.b, ['mission', 'list']).out).toContain('No missions.');
    expect(existsSync(join(r.a, '.monolith', 'state.json'))).toBe(true);
    expect(existsSync(join(r.b, '.monolith', 'state.json'))).toBe(false);
    expect(existsSync(r.statePath)).toBe(false); // nothing leaked into the shared location

    const status = run(r.a, ['state', 'status']).out;
    expect(status).toContain('mode:                 isolated (ISOLATED_MODE)');
    expect(status).not.toContain('WARNING'); // isolation is a choice, not a split-brain
  });

  it('an invalid state.mode fails closed instead of guessing', () => {
    const r = makeRepo();
    writeFileSync(join(r.a, 'monolith.config.json'), JSON.stringify({ state: { mode: 'sharedd' } }));
    const res = run(r.a, ['mission', 'start', '--title', 't', '--system', 's']);
    expect(res.code).toBe(1);
    expect(res.err).toContain('state.mode must be');
    expect(existsSync(r.statePath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. Split-brain is detected, listed and left alone
// ---------------------------------------------------------------------------

describe('D. split-brain', () => {
  it('lists every source, writes nothing, chooses nothing, and never reports consistency as verified', async () => {
    const r = makeRepo();
    const pa = putLocal(r.a, stateDoc(31, ['MIS-0001']));
    const pb = putLocal(r.b, stateDoc(33, ['MIS-0001', 'MIS-0005']));
    const before = [sha(pa), sha(pb)];

    // CLI read: warning on stderr names both files with their revisions.
    const list = run(r.main, ['mission', 'list']);
    expect(list.err).toContain('WARNING');
    expect(list.err).toContain(pa);
    expect(list.err).toContain(pb);
    expect(list.err).toContain('revision=31');
    expect(list.err).toContain('revision=33');
    expect(list.err).toContain(r.statePath);
    expect(list.err).toContain('Consistency is NOT verified');

    // CLI write: refused, because it would start an EMPTY shared state next to them.
    const start = run(r.a, ['mission', 'start', '--title', 'x', '--system', 's']);
    expect(start.code).toBe(1);
    expect(start.err).toContain('monolith state adopt');
    expect(existsSync(join(r.common, 'monolith'))).toBe(false);

    // Brief: INCOMPLETE with an explicit diagnostic (not a silent empty list).
    const model = await collect(r.a);
    expect(model.diagnostics.find((d) => d.code === 'STATE_SPLIT_BRAIN')).toMatchObject({ severity: 'error' });
    expect(render(model).completeness).toBe('INCOMPLETE');

    // Read model: same facts as data, with no absolute path.
    const dash = readDashboardModel(r.a);
    expect(dash.diagnostics.notes).toContainEqual({ code: 'STATE_SPLIT_BRAIN', severity: 'warn' });
    const view = dash.diagnostics.state!;
    expect(view).toMatchObject({ mode: 'shared', location: 'git-common-dir', statePath: '<git-common-dir>/monolith/state.json' });
    expect(view.splitBrain.canonicalMissingWithLocalData).toBe(true);
    expect(view.splitBrain.localStates.map((s) => s.revision).sort()).toEqual([31, 33]);
    expect(JSON.stringify(dash)).not.toContain(r.main);

    // Nothing was merged, deleted or rewritten.
    expect([sha(pa), sha(pb)]).toEqual(before);
  });

  it('an empty scaffold is not a competing state; with a canonical state present the split is a warning, not a block', () => {
    const r = makeRepo();
    putLocal(r.a, stateDoc(0, []));
    expect(run(r.a, ['mission', 'start', '--title', 'ok', '--system', 's']).code).toBe(0);
    expect(run(r.a, ['mission', 'list']).err).toBe('');

    putLocal(r.b, stateDoc(5, ['MIS-0009']));
    const list = run(r.a, ['mission', 'list']);
    expect(list.err).toContain('WARNING');
    expect(list.err).toContain('split-brain');
    expect(run(r.a, ['mission', 'start', '--title', 'still works', '--system', 's']).code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E. Explicit adoption
// ---------------------------------------------------------------------------

describe('E. monolith state adopt', () => {
  it('without --apply it previews and writes nothing; --apply is the explicit permission', () => {
    const r = makeRepo();
    const src = putLocal(r.b, stateDoc(33, ['MIS-0001', 'MIS-0005']));
    const before = sha(src);

    const preview = run(r.a, ['state', 'adopt', src]);
    expect(preview.code, preview.err).toBe(0);
    expect(preview.out).toContain('nothing was written');
    expect(preview.out).toContain(`source:       ${src}`);
    expect(preview.out).toContain('revision=33');
    expect(preview.out).toContain(`destination:  ${r.statePath}`);
    expect(preview.out).toContain('absent');
    expect(preview.out).toContain('Add --apply');
    expect(existsSync(join(r.common, 'monolith'))).toBe(false);
    expect(sha(src)).toBe(before);

    const applied = run(r.a, ['state', 'adopt', src, '--apply']);
    expect(applied.code, applied.err).toBe(0);
    expect(applied.out).toContain('State adopted.');
    const doc = readJson(r.statePath);
    expect(Object.keys(doc.tactical.missions)).toEqual(['MIS-0001', 'MIS-0005']);
    expect(doc.revision).toBe(34); // max(dest, source) + 1
    expect(sha(src)).toBe(before); // source preserved byte for byte

    // Now visible from every worktree, and writes work again.
    expect(run(r.main, ['mission', 'list']).out).toContain('MIS-0005');
    expect(run(r.a, ['mission', 'start', '--title', 'next', '--system', 's']).out).toContain('MIS-0006');
  });

  it('replacing an existing destination keeps a byte-exact backup and verifies the result', async () => {
    const r = makeRepo();
    run(r.a, ['mission', 'start', '--title', 'existing', '--system', 's']);
    const existingBytes = readFileSync(r.statePath);
    const src = putLocal(r.b, stateDoc(40, ['MIS-0007']));

    const plan = planAdoption(resolveStateLocation(r.a), src, { upgradeV2: false });
    expect(plan.warnings.join(' ')).toContain('REPLACES');
    expect(plan.resultingRevision).toBe(41);

    const res = await adoptState(resolveStateLocation(r.a), src, { apply: true, upgradeV2: false });
    expect(res.applied).toBe(true);
    expect(res.backupPath).not.toBeNull();
    expect(readFileSync(res.backupPath!).equals(existingBytes)).toBe(true);
    const doc = readJson(r.statePath);
    expect(Object.keys(doc.tactical.missions)).toEqual(['MIS-0007']);
    expect(doc.revision).toBe(41);
  });

  it('refuses without destroying anything: missing, corrupt, unsupported and same-file sources', async () => {
    const r = makeRepo();
    run(r.a, ['mission', 'start', '--title', 'keep me', '--system', 's']);
    const destBefore = sha(r.statePath);
    const loc = resolveStateLocation(r.a);

    const corrupt = join(r.b, 'corrupt.json');
    writeFileSync(corrupt, '{ not json');
    const v1 = join(r.b, 'v1.json');
    writeFileSync(v1, stateDoc(1, [], 1));

    for (const bad of [join(r.b, 'does-not-exist.json'), corrupt, v1, r.statePath]) {
      await expect(adoptState(loc, bad, { apply: true, upgradeV2: true }), bad).rejects.toBeInstanceOf(StateAdoptError);
    }
    expect(sha(r.statePath)).toBe(destBefore);
    expect(readdirSync(join(r.common, 'monolith')).sort()).toEqual(['state.json']); // no backup of a refused adoption
  });

  it('a schemaVersion 2 source needs the explicit --upgrade-v2; it is relabelled, validated and the source is kept', () => {
    const r = makeRepo();
    const src = putLocal(r.a, stateDoc(31, ['MIS-0001'], 2));
    const before = sha(src);

    const plain = run(r.a, ['state', 'adopt', src, '--apply']);
    expect(plain.code).toBe(1);
    expect(plain.err).toContain('--upgrade-v2');
    expect(existsSync(r.statePath)).toBe(false);

    // The same file is refused by the runtime itself — no adapter.
    const status = run(r.b, ['state', 'status']).out;
    expect(status).toContain('schema=2');
    expect(status).toContain('incompatible-schema');

    const preview = run(r.a, ['state', 'adopt', src, '--upgrade-v2']);
    expect(preview.out).toContain('schemaVersion 2 -> 3');
    expect(existsSync(r.statePath)).toBe(false);

    const up = run(r.a, ['state', 'adopt', src, '--upgrade-v2', '--apply']);
    expect(up.code, up.err).toBe(0);
    const doc = readJson(r.statePath);
    expect(doc.schemaVersion).toBe(3);
    expect(Object.keys(doc.tactical.missions)).toEqual(['MIS-0001']);
    expect(sha(src)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// F. Integration: CLI, Brief, Read Model, Dashboard API, schema v3 / storyId
// ---------------------------------------------------------------------------

describe('F. one resolver everywhere; schema v3 with storyId', () => {
  it('mission --story is stored, shown and format-checked; brief and read model see the same shared state from any worktree', async () => {
    const r = makeRepo();
    const bad = run(r.a, ['mission', 'start', '--title', 't', '--system', 's', '--story', 'bad id!']);
    expect(bad.code).toBe(1);
    expect(existsSync(r.statePath)).toBe(false);

    const ok = run(r.a, ['mission', 'start', '--title', 'Linked', '--system', 's', '--story', 'BETA-020']);
    expect(ok.code, ok.err).toBe(0);
    expect(ok.out).toContain('storyId:    BETA-020');
    run(r.b, ['mission', 'start', '--title', 'Unlinked', '--system', 's']); // no storyId: still valid, never guessed
    const doc = readJson(r.statePath);
    expect(doc.tactical.missions['MIS-0001'].storyId).toBe('BETA-020');
    expect('storyId' in doc.tactical.missions['MIS-0002']).toBe(false);
    expect(run(r.main, ['mission', 'show', 'MIS-0001']).out).toContain('storyId:    BETA-020');

    // Brief
    const fromA = render(await collect(r.a));
    const fromB = render(await collect(r.b));
    for (const b of [fromA, fromB]) {
      expect(b.text).toContain('story BETA-020');
      expect(b.text).toContain('<git-common-dir>/monolith/state.json');
      expect(b.text).toContain('MIS-0002');
    }

    // Read model: identical state sections from both worktrees.
    const dA = readDashboardModel(r.a);
    const dB = readDashboardModel(r.b);
    expect(dA.currentMissions).toEqual(dB.currentMissions);
    expect(dA.currentMissions.data!.active.map((m) => [m.id, m.storyId])).toEqual([['MIS-0001', 'BETA-020'], ['MIS-0002', undefined]]);
    expect(dA.projectOverview.data).toMatchObject({ stateRevision: 2, stateSchemaVersionOnDisk: 3, activeMissionCount: 2 });
    expect(dA.diagnostics.state).toMatchObject({ mode: 'shared', revision: 2, schemaVersion: 3, worktreeCount: 3, monolithVersion: '0.2.0-beta.1' });
    expect(dA.diagnostics.state!.splitBrain.detected).toBe(false);
  });

  it('GET /api/dashboard serves the shared state', async () => {
    const r = makeRepo();
    run(r.a, ['mission', 'start', '--title', 'Via API', '--system', 's', '--story', 'BETA-020']);
    const { startDashboardServer } = await import('../http/index.js');
    const server = await startDashboardServer({ projectRoot: r.b });
    try {
      const body = await new Promise<string>((resolve, reject) => {
        import('http').then(({ request }) => {
          const req = request({ host: '127.0.0.1', port: server.port, path: '/api/dashboard', agent: false }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (d: Buffer) => chunks.push(d));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          });
          req.on('error', reject);
          req.end();
        });
      });
      const dto = JSON.parse(body) as ReturnType<typeof readDashboardModel>;
      expect(dto).toEqual(readDashboardModel(r.b));
      expect(dto.currentMissions.data!.active[0]).toMatchObject({ title: 'Via API', storyId: 'BETA-020' });
    } finally {
      await server.close();
    }
  });

  it('a project that is not a git repository keeps a local state and says so', () => {
    const dir = tmp('monolith-p2-nogit-');
    expect(run(dir, ['mission', 'start', '--title', 'local', '--system', 's']).code).toBe(0);
    expect(existsSync(join(dir, '.monolith', 'state.json'))).toBe(true);
    const status = run(dir, ['state', 'status']).out;
    expect(status).toContain('mode:                 local (NOT_A_GIT_REPOSITORY)');
  });

  it('an old schemaVersion at the canonical path is reported, not read, and left untouched', () => {
    const r = makeRepo();
    mkdirSync(join(r.common, 'monolith'));
    writeFileSync(r.statePath, stateDoc(9, ['MIS-0001'], 2));
    const before = sha(r.statePath);
    const res = run(r.a, ['mission', 'list']);
    expect(res.code).toBe(1);
    expect(res.err).toContain('Incompatible state schemaVersion');
    expect(run(r.a, ['mission', 'start', '--title', 't', '--system', 's']).code).toBe(1);
    expect(sha(r.statePath)).toBe(before);
  });
});
