import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  symlinkSync,
  truncateSync,
  existsSync,
  readdirSync,
  statSync,
  lstatSync,
} from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { readState, mutateState, stateFilePath, trustedDirectoryTarget, MAX_STATE_BYTES } from './state-keeper.js';
import { acquireLock, MAX_LOCK_BYTES } from './lock.js';
import { createInitialState } from './types.js';
import { StateFileError, LockUnsafeError, LockTimeoutError } from './errors.js';
import { MAX_ACTIVE_CONTEXT_BYTES } from '../brief/collect.js';
import { MAX_MARKDOWN_DOC_BYTES } from '../brief/docs.js';

// SEC-001B.1: bounded, non-blocking reads for state.json, the lock record,
// active.md and brief's Markdown documents. Every fixture is a throwaway
// mkdtemp project. Scenarios that would HANG on a regression (FIFOs) run the
// REAL compiled CLI in a child with a hard timeout, so a blocking read kills
// the child, never the vitest worker. Reads are bounded and non-blocking;
// this does NOT close check-then-use races (SEC-001B.2/3).

const REPO = resolve(__dirname, '..', '..');
const TSC = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');
const CHILD_TIMEOUT_MS = 8000;

const dirs: string[] = [];
let compiledCli: string;

function tmp(prefix = 'monolith-sec001b1-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** <sandbox>/project (with .monolith/…) and <sandbox>/outside. */
function project() {
  const base = tmp();
  const proj = join(base, 'project');
  const outside = join(base, 'outside');
  const mon = join(proj, '.monolith');
  mkdirSync(join(mon, 'memory', 'working'), { recursive: true });
  mkdirSync(join(mon, 'protocols'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(proj, 'monolith.config.json'), JSON.stringify({ monolithRoot: '.monolith' }));
  return {
    proj,
    mon,
    outside,
    state: join(mon, 'state.json'),
    lock: join(mon, 'state.json.lock'),
    active: join(mon, 'memory', 'working', 'active.md'),
  };
}

function mkfifo(path: string): void {
  execFileSync('mkfifo', [path]);
}

function sparse(path: string, bytes: number): void {
  writeFileSync(path, '');
  truncateSync(path, bytes);
}

interface CliRun {
  code: number | null;
  out: string;
  timedOut: boolean;
}

function cli(cwd: string, ...args: string[]): CliRun {
  const r = spawnSync(process.execPath, [compiledCli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  return {
    code: r.status,
    out: `${r.stdout}${r.stderr}`,
    timedOut: r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT',
  };
}

function listing(dir: string): string[] {
  return readdirSync(dir).sort();
}

beforeAll(() => {
  const outDir = tmp('monolith-sec001b1-build-');
  execFileSync(
    process.execPath,
    [TSC, '-p', join(REPO, 'tsconfig.json'), '--outDir', outDir, '--tsBuildInfoFile', join(outDir, 'tsbuildinfo')],
    { cwd: REPO, stdio: 'pipe' },
  );
  compiledCli = join(outDir, 'cli', 'index.js');
}, 120_000);

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('limits are the approved ones', () => {
  it('has the documented values', () => {
    expect(MAX_LOCK_BYTES).toBe(256);
    expect(MAX_ACTIVE_CONTEXT_BYTES).toBe(256 * 1024);
    expect(MAX_MARKDOWN_DOC_BYTES).toBe(1024 * 1024);
    expect(MAX_STATE_BYTES).toBe(16 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// state.json — read side
// ---------------------------------------------------------------------------

describe('state.json reads (state-keeper)', () => {
  it('a FIFO at state.json fails fast through the real CLI (mission list)', () => {
    const p = project();
    mkfifo(p.state);
    const r = cli(p.proj, 'mission', 'list');
    expect(r.timedOut).toBe(false);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/FILE_NOT_REGULAR/);
    expect(statSync(p.state).isFIFO()).toBe(true);
  });

  it('a FIFO at state.json: mission start refuses and leaves no lock or temp file behind', () => {
    const p = project();
    mkfifo(p.state);
    const r = cli(p.proj, 'mission', 'start', '--title', 't', '--system', 's');
    expect(r.timedOut).toBe(false);
    expect(r.code).not.toBe(0);
    expect(listing(p.mon).filter((n) => n.startsWith('state.json'))).toEqual(['state.json']);
  });

  it('readState rejects an over-limit state.json with FILE_TOO_LARGE before reading it', async () => {
    const p = project();
    sparse(p.state, MAX_STATE_BYTES + 1);
    const err = await readState(trustedDirectoryTarget(p.mon)).catch((e) => e);
    expect(err).toBeInstanceOf(StateFileError);
    expect((err as StateFileError).fileCode).toBe('FILE_TOO_LARGE');
  });

  it('readState accepts a state.json of exactly the limit (boundary), content is validated normally', async () => {
    const p = project();
    const state = createInitialState();
    const base = JSON.stringify({ ...state, strategic: { systems: { pad: '' } } }, null, 2) + '\n';
    const pad = 'x'.repeat(MAX_STATE_BYTES - Buffer.byteLength(base, 'utf8'));
    const text = JSON.stringify({ ...state, strategic: { systems: { pad } } }, null, 2) + '\n';
    expect(Buffer.byteLength(text, 'utf8')).toBe(MAX_STATE_BYTES);
    writeFileSync(p.state, text);
    const read = await readState(trustedDirectoryTarget(p.mon));
    expect((read.strategic.systems as { pad: string }).pad.length).toBe(pad.length);
  });

  it('a corrupted state.json is still StateCorruptedError (not masked as empty)', async () => {
    const p = project();
    writeFileSync(p.state, '{ not json');
    await expect(readState(trustedDirectoryTarget(p.mon))).rejects.toMatchObject({ code: 'STATE_CORRUPTED' });
    writeFileSync(p.state, '');
    await expect(readState(trustedDirectoryTarget(p.mon))).rejects.toMatchObject({ code: 'STATE_CORRUPTED' });
  });

  it('an absent state.json is still the initial state, and is not created by a read', async () => {
    const p = project();
    expect((await readState(trustedDirectoryTarget(p.mon))).revision).toBe(0);
    expect(existsSync(p.state)).toBe(false);
  });

  it('symlink escape / dangling / loop at state.json are refused through the CLI without side effects', () => {
    const escape = project();
    writeFileSync(join(escape.outside, 'state.json'), JSON.stringify(createInitialState()));
    symlinkSync(join(escape.outside, 'state.json'), escape.state);
    const dangling = project();
    symlinkSync(join(dangling.outside, 'missing.json'), dangling.state);
    const loop = project();
    symlinkSync(loop.state, loop.state);
    for (const p of [escape, dangling, loop]) {
      const r = cli(p.proj, 'mission', 'start', '--title', 't', '--system', 's');
      expect(r.timedOut).toBe(false);
      expect(r.code).not.toBe(0);
      expect(listing(p.mon).filter((n) => n.includes('lock') || n.includes('tmp'))).toEqual([]);
    }
    expect(readFileSync(join(escape.outside, 'state.json'), 'utf8')).toBe(JSON.stringify(createInitialState()));
    expect(listing(dangling.outside)).toEqual([]);
  });

  it('an internal symlink that stays inside the project is refused too (unified read policy, SEC-001B.1-R)', () => {
    const p = project();
    writeFileSync(join(p.mon, 'real-state.json'), JSON.stringify(createInitialState()));
    symlinkSync(join(p.mon, 'real-state.json'), p.state);
    const r = cli(p.proj, 'mission', 'list');
    expect(r.timedOut).toBe(false);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/FILE_SYMLINK/);
  });
});

// ---------------------------------------------------------------------------
// state.json — write side
// ---------------------------------------------------------------------------

describe('state.json size is enforced before the atomic write', () => {
  function padFor(bytes: number): string {
    // mutateState bumps revision to 1 on an initial state; size the pad so the
    // serialized result lands exactly on `bytes`.
    const s = createInitialState();
    s.revision = 1;
    const withEmpty = JSON.stringify({ ...s, strategic: { systems: { pad: '' } } }, null, 2) + '\n';
    return 'x'.repeat(bytes - Buffer.byteLength(withEmpty, 'utf8'));
  }

  it('writes exactly 16 MiB, then refuses 16 MiB + 1 without touching state.json or leaving a temp file', async () => {
    const p = project();
    const exact = padFor(MAX_STATE_BYTES);
    await mutateState(trustedDirectoryTarget(p.mon), (d) => {
      (d.strategic.systems as Record<string, unknown>).pad = exact;
    });
    expect(statSync(p.state).size).toBe(MAX_STATE_BYTES);
    const before = readFileSync(p.state);

    // next mutation: revision 2 serializes one byte longer than revision 1 only
    // if digits grow; use an explicit +1 pad instead of relying on that.
    const err = await mutateState(trustedDirectoryTarget(p.mon), (d) => {
      (d.strategic.systems as Record<string, unknown>).pad = exact + 'x';
    }).catch((e) => e);
    expect(err).toBeInstanceOf(StateFileError);
    expect((err as StateFileError).fileCode).toBe('FILE_TOO_LARGE');
    expect(readFileSync(p.state).equals(before)).toBe(true);
    expect(listing(p.mon).filter((n) => n.includes('.tmp.') || n.endsWith('.lock'))).toEqual([]);
  }, 60_000);

  it('a refused first write creates no state.json at all', async () => {
    const p = project();
    const err = await mutateState(trustedDirectoryTarget(p.mon), (d) => {
      (d.strategic.systems as Record<string, unknown>).pad = padFor(MAX_STATE_BYTES) + 'x';
    }).catch((e) => e);
    expect(err).toBeInstanceOf(StateFileError);
    expect(existsSync(p.state)).toBe(false);
    expect(listing(p.mon).filter((n) => n.startsWith('state.json'))).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// lock
// ---------------------------------------------------------------------------

describe('lock reads', () => {
  it('a FIFO lock is refused with a diagnostic, never acquired, never deleted (real CLI, no hang)', () => {
    const p = project();
    mkfifo(p.lock);
    const r = cli(p.proj, 'mission', 'start', '--title', 't', '--system', 's');
    expect(r.timedOut).toBe(false);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/FILE_NOT_REGULAR/);
    expect(statSync(p.lock).isFIFO()).toBe(true);
    expect(existsSync(p.state)).toBe(false);
  });

  it('an over-limit lock is LockUnsafeError (FILE_TOO_LARGE) at once and is left untouched', async () => {
    const p = project();
    writeFileSync(p.lock, `${process.pid}:${'a'.repeat(MAX_LOCK_BYTES)}`);
    const started = Date.now();
    const err = await acquireLock(p.lock, { timeoutMs: 3000, retryDelayMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(LockUnsafeError);
    expect((err as LockUnsafeError).fileCode).toBe('FILE_TOO_LARGE');
    expect(Date.now() - started).toBeLessThan(1500);
    expect(readFileSync(p.lock, 'utf8').length).toBeGreaterThan(MAX_LOCK_BYTES);
  });

  it('a lock of exactly 256 bytes is within bounds (content-level handling, as before)', async () => {
    const p = project();
    const content = `abc:${'a'.repeat(MAX_LOCK_BYTES - 4)}`;
    expect(content.length).toBe(MAX_LOCK_BYTES);
    writeFileSync(p.lock, content);
    const err = await acquireLock(p.lock, { timeoutMs: 200, retryDelayMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect(readFileSync(p.lock, 'utf8')).toBe(content);
  });

  it('an unreadable-as-record lock (garbage) times out with a diagnostic and is never deleted', async () => {
    const p = project();
    writeFileSync(p.lock, 'garbage');
    const err = await acquireLock(p.lock, { timeoutMs: 200, retryDelayMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect((err as Error).message).toMatch(/malformed/);
    expect(readFileSync(p.lock, 'utf8')).toBe('garbage');
  });

  it('a live owner is still protected: valid lock of this (live) pid times out and survives', async () => {
    const p = project();
    writeFileSync(p.lock, `${process.pid}:livenonce`);
    const err = await acquireLock(p.lock, { timeoutMs: 200, retryDelayMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(LockTimeoutError);
    expect(err).not.toBeInstanceOf(LockUnsafeError);
    expect(readFileSync(p.lock, 'utf8')).toBe(`${process.pid}:livenonce`);
  });

  it('a dead owner is still recovered (valid record, dead pid)', async () => {
    const p = project();
    const dead = spawnSync(process.execPath, ['-e', '0']);
    writeFileSync(p.lock, `${dead.pid}:deadnonce`);
    const release = await acquireLock(p.lock, { timeoutMs: 2000, retryDelayMs: 20 });
    release();
    expect(existsSync(p.lock)).toBe(false);
  });

  it('a dangling / looping symlink at the lock path is refused, not followed or deleted', async () => {
    const p = project();
    symlinkSync(join(p.outside, 'nope'), p.lock);
    const err = await acquireLock(p.lock, { timeoutMs: 300, retryDelayMs: 20 }).catch((e) => e);
    // SEC-001B.1-R: a symlink is a structural fault — refused at once (no waiting
    // out a timeout), never followed, replaced or deleted.
    expect(err).toBeInstanceOf(LockUnsafeError);
    expect((err as LockUnsafeError).fileCode).toBe('FILE_SYMLINK');
    expect(lstatSync(p.lock).isSymbolicLink()).toBe(true);
    expect(listing(p.outside)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// brief
// ---------------------------------------------------------------------------

describe('monolith brief reads', () => {
  it('FIFO state.json: brief completes, reports INCOMPLETE; --strict exits 2', () => {
    const p = project();
    mkfifo(p.state);
    const r = cli(p.proj, 'brief');
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Completeness: INCOMPLETE/);
    expect(r.out).toMatch(/STATE_UNREADABLE|FILE_NOT_REGULAR/);
    const s = cli(p.proj, 'brief', '--strict');
    expect(s.timedOut).toBe(false);
    expect(s.code).toBe(2);
  });

  it('over-limit state.json: brief reports FILE_TOO_LARGE, INCOMPLETE', () => {
    const p = project();
    sparse(p.state, MAX_STATE_BYTES + 1);
    const r = cli(p.proj, 'brief');
    expect(r.timedOut).toBe(false);
    expect(r.out).toMatch(/FILE_TOO_LARGE/);
    expect(r.out).toMatch(/Completeness: INCOMPLETE/);
  });

  it('FIFO active.md: brief completes without hanging and names the problem', () => {
    const p = project();
    mkfifo(p.active);
    const r = cli(p.proj, 'brief');
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/FILE_NOT_REGULAR/);
  });

  it('over-limit active.md is rejected (FILE_TOO_LARGE); exactly the limit is read', () => {
    const p = project();
    sparse(p.active, MAX_ACTIVE_CONTEXT_BYTES + 1);
    const big = cli(p.proj, 'brief');
    expect(big.timedOut).toBe(false);
    expect(big.out).toMatch(/FILE_TOO_LARGE/);

    const head = '## Current Story\n\nBOUNDARY-STORY\n';
    writeFileSync(p.active, head + ' '.repeat(MAX_ACTIVE_CONTEXT_BYTES - head.length));
    expect(statSync(p.active).size).toBe(MAX_ACTIVE_CONTEXT_BYTES);
    const ok = cli(p.proj, 'brief', '--max-chars', '20000');
    expect(ok.out).toMatch(/BOUNDARY-STORY/);
    expect(ok.out).not.toMatch(/FILE_TOO_LARGE/);
  });

  it('active.md as symlink escape / dangling / loop is not read', () => {
    const escape = project();
    writeFileSync(join(escape.outside, 'a.md'), '## Current Story\n\nOUTSIDE-SECRET\n');
    symlinkSync(join(escape.outside, 'a.md'), escape.active);
    const dangling = project();
    symlinkSync(join(dangling.outside, 'missing.md'), dangling.active);
    const loop = project();
    symlinkSync(loop.active, loop.active);
    for (const p of [escape, dangling, loop]) {
      const r = cli(p.proj, 'brief');
      expect(r.timedOut).toBe(false);
      expect(r.out).not.toMatch(/OUTSIDE-SECRET/);
    }
  });

  it('an internal active.md symlink is not read either (unified read policy, SEC-001B.1-R)', () => {
    const p = project();
    writeFileSync(join(p.mon, 'real-active.md'), '## Current Story\n\nINTERNAL-SECRET\n');
    symlinkSync(join(p.mon, 'real-active.md'), p.active);
    const r = cli(p.proj, 'brief');
    expect(r.timedOut).toBe(false);
    expect(r.out).not.toMatch(/INTERNAL-SECRET/);
    expect(r.out).toMatch(/ACTIVE_MD_MISSING[^\n]*FILE_SYMLINK|FILE_SYMLINK/);
  });

  it('Markdown documents: a FIFO named *.md never blocks; an over-limit .md is reported; boundary is read', () => {
    const p = project();
    const prot = join(p.mon, 'protocols');
    mkfifo(join(prot, 'fifo.md'));
    sparse(join(prot, 'huge.md'), MAX_MARKDOWN_DOC_BYTES + 1);
    const head = '---\nid: edge-doc\nenforcement: mandatory\ntitle: Edge Doc\n---\n';
    writeFileSync(join(prot, 'edge.md'), head + ' '.repeat(MAX_MARKDOWN_DOC_BYTES - head.length));
    expect(statSync(join(prot, 'edge.md')).size).toBe(MAX_MARKDOWN_DOC_BYTES);
    const r = cli(p.proj, 'brief', '--max-chars', '20000');
    expect(r.timedOut).toBe(false);
    expect(r.out).toMatch(/huge\.md/);
    expect(r.out).toMatch(/FILE_TOO_LARGE/);
    expect(r.out).toMatch(/Edge Doc/);
    expect(r.out).toMatch(/Completeness: INCOMPLETE/);
  });

  it('brief never writes: the project tree is identical before and after (failure paths included)', () => {
    const p = project();
    mkfifo(p.state);
    mkfifo(p.active);
    const snap = () => [listing(p.mon), listing(join(p.mon, 'memory', 'working'))];
    const before = snap();
    cli(p.proj, 'brief', '--strict');
    expect(snap()).toEqual(before);
  });
});

describe('validate still runs against the real project (SEC-002 unaffected)', () => {
  it('validate on a project with a FIFO state.json does not hang', () => {
    const p = project();
    mkfifo(p.state);
    const r = cli(p.proj, 'validate');
    expect(r.timedOut).toBe(false);
  });
});
