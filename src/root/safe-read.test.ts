import { afterEach, describe, expect, it } from 'vitest';
import { linkSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync, existsSync, readdirSync, lstatSync } from 'fs';
import { execFileSync } from 'child_process';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readBoundedFile,
  readBoundedFileStable,
  readConfigFile,
  readProjectFile,
  checkProjectFile,
  isReadSecurityViolation,
  READ_SECURITY_CODES,
  resolveMonolithRoot,
  type ProjectFileErrorCode,
} from './index.js';
import { readState, mutateState, projectTarget, trustedDirectoryTarget, stateFilePath } from '../coordinatorium/state-keeper.js';
import { acquireLock } from '../coordinatorium/lock.js';
import { LockUnsafeError } from '../coordinatorium/errors.js';
import { collect } from '../brief/collect.js';
import { runValidate } from '../validate/index.js';
import { vi } from 'vitest';

// SEC-001B.1-R — the unified safe read contract. One policy for every MONOLITH-managed file:
// explicit boundary, no symlink in any component below it, regular single-link files only, bounded,
// identity-checked, typed errors, no implicit cwd, fail closed. Every fixture is a throwaway mkdtemp
// project. Nothing here claims protection against a concurrent swap of a directory (SEC-001B.3).

const SECRET = 'TOP-SECRET-TOKEN-4f9c';
const sandboxes: string[] = [];

afterEach(() => {
  while (sandboxes.length > 0) rmSync(sandboxes.pop() as string, { recursive: true, force: true });
});

interface Sandbox {
  base: string;
  project: string;
  outside: string;
  mon: string;
}

function sandbox(): Sandbox {
  const base = mkdtempSync(join(tmpdir(), 'monolith-sec001b1r-'));
  sandboxes.push(base);
  const project = join(base, 'project');
  const outside = join(base, 'outside');
  const mon = join(project, '.monolith');
  mkdirSync(join(mon, 'memory', 'working'), { recursive: true });
  mkdirSync(join(mon, 'context', 'maps'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(project, 'monolith.config.json'), JSON.stringify({ monolithRoot: '.monolith' }));
  writeFileSync(join(project, '.env'), `API_KEY=${SECRET}\n`);
  mkdirSync(join(project, 'private'));
  writeFileSync(join(project, 'private', 'notes.md'), `# private\n${SECRET}\n`);
  return { base, project, outside, mon };
}

function mkfifo(path: string): void {
  execFileSync('mkfifo', [path]);
}

/** Every file the core reads under the strict policy, relative to the project root. */
const MANAGED: Array<{ name: string; rel: string }> = [
  { name: 'monolith.config.json', rel: 'monolith.config.json' },
  { name: 'state.json', rel: '.monolith/state.json' },
  { name: 'active.md', rel: '.monolith/memory/working/active.md' },
  { name: 'roadmap-index.md', rel: '.monolith/context/maps/roadmap-index.md' },
  { name: 'state.json.lock', rel: '.monolith/state.json.lock' },
  { name: 'AGENTS.md', rel: 'AGENTS.md' },
  { name: 'project.definition.mjs', rel: 'project.definition.mjs' },
];

function place(s: Sandbox, rel: string, content: string): string {
  const abs = join(s.project, rel);
  rmSync(abs, { force: true });
  writeFileSync(abs, content);
  return abs;
}

function expectRefused(r: { ok: boolean; code?: ProjectFileErrorCode }, code: ProjectFileErrorCode): void {
  expect(r.ok).toBe(false);
  expect(r.code).toBe(code);
  expect(JSON.stringify(r)).not.toContain(SECRET);
}

describe('typed security codes', () => {
  it('classifies the layout faults as security violations, and nothing else', () => {
    for (const c of READ_SECURITY_CODES) expect(isReadSecurityViolation(c)).toBe(true);
    for (const c of ['FILE_MISSING', 'FILE_EMPTY', 'FILE_TOO_LARGE', 'FILE_CHANGED', 'FILE_UNREADABLE', 'FILE_UNRESOLVABLE'] as const) {
      expect(isReadSecurityViolation(c)).toBe(false);
    }
  });
});

describe('every managed source × every layout attack', () => {
  for (const { name, rel } of MANAGED) {
    describe(name, () => {
      it('regular file: read normally (policy is strict, not hostile)', () => {
        const s = sandbox();
        place(s, rel, 'hello\n');
        const r = readProjectFile(s.project, rel, { allowEmpty: true });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.content).toBe('hello\n');
      });

      it('symlink to a private .env inside the project: refused, content never read', () => {
        const s = sandbox();
        rmSync(join(s.project, rel), { force: true });
        symlinkSync(join(s.project, '.env'), join(s.project, rel));
        const r = readProjectFile(s.project, rel, { allowEmpty: true });
        expectRefused(r, 'FILE_SYMLINK');
        expectRefused(checkProjectFile(s.project, rel, { allowEmpty: true }), 'FILE_SYMLINK');
      });

      it('symlink to a private markdown file inside the project: refused', () => {
        const s = sandbox();
        rmSync(join(s.project, rel), { force: true });
        symlinkSync(join(s.project, 'private', 'notes.md'), join(s.project, rel));
        expectRefused(readProjectFile(s.project, rel, { allowEmpty: true }), 'FILE_SYMLINK');
      });

      it('symlink leaving the project: refused as a symlink', () => {
        const s = sandbox();
        writeFileSync(join(s.outside, 'x'), SECRET);
        rmSync(join(s.project, rel), { force: true });
        symlinkSync(join(s.outside, 'x'), join(s.project, rel));
        expectRefused(readProjectFile(s.project, rel, { allowEmpty: true }), 'FILE_SYMLINK');
      });

      it('dangling symlink: FILE_SYMLINK, not "missing"', () => {
        const s = sandbox();
        rmSync(join(s.project, rel), { force: true });
        symlinkSync(join(s.project, 'does-not-exist'), join(s.project, rel));
        expectRefused(readProjectFile(s.project, rel, { allowEmpty: true }), 'FILE_SYMLINK');
      });

      it('symlink loop: FILE_SYMLINK', () => {
        const s = sandbox();
        rmSync(join(s.project, rel), { force: true });
        symlinkSync(join(s.project, rel), join(s.project, rel));
        expectRefused(readProjectFile(s.project, rel, { allowEmpty: true }), 'FILE_SYMLINK');
      });

      it('hardlink to a private file: refused (nlink > 1), content never read', () => {
        const s = sandbox();
        rmSync(join(s.project, rel), { force: true });
        linkSync(join(s.project, '.env'), join(s.project, rel));
        expectRefused(readProjectFile(s.project, rel, { allowEmpty: true }), 'FILE_HARDLINKED');
      });

      it('FIFO: refused without being opened (never blocks)', () => {
        const s = sandbox();
        rmSync(join(s.project, rel), { force: true });
        mkfifo(join(s.project, rel));
        expectRefused(readProjectFile(s.project, rel, { allowEmpty: true }), 'FILE_NOT_REGULAR');
      });

      it('missing file: FILE_MISSING', () => {
        const s = sandbox();
        rmSync(join(s.project, rel), { force: true });
        expectRefused(readProjectFile(s.project, rel, { allowEmpty: true }), 'FILE_MISSING');
      });

      it('oversized file: FILE_TOO_LARGE; exactly the limit is read', () => {
        const s = sandbox();
        const abs = place(s, rel, '');
        truncateSync(abs, 65);
        expectRefused(readProjectFile(s.project, rel, { maxBytes: 64, allowEmpty: true }), 'FILE_TOO_LARGE');
        truncateSync(abs, 64);
        expect(readProjectFile(s.project, rel, { maxBytes: 64, allowEmpty: true }).ok).toBe(true);
      });

      it('empty file: FILE_EMPTY unless allowed', () => {
        const s = sandbox();
        place(s, rel, '');
        expectRefused(readProjectFile(s.project, rel), 'FILE_EMPTY');
        expect(readProjectFile(s.project, rel, { allowEmpty: true }).ok).toBe(true);
      });
    });
  }
});

describe('symlink in an intermediate directory', () => {
  it('a symlinked directory inside the project: refused for files below it', () => {
    const s = sandbox();
    mkdirSync(join(s.project, 'real-memory', 'working'), { recursive: true });
    writeFileSync(join(s.project, 'real-memory', 'working', 'active.md'), '## Current Story\n');
    rmSync(join(s.mon, 'memory'), { recursive: true });
    symlinkSync(join(s.project, 'real-memory'), join(s.mon, 'memory'));
    expectRefused(readProjectFile(s.project, '.monolith/memory/working/active.md', { allowEmpty: true }), 'FILE_SYMLINK');
  });

  it('a symlinked directory leaving the project: refused', () => {
    const s = sandbox();
    mkdirSync(join(s.outside, 'maps'));
    writeFileSync(join(s.outside, 'maps', 'roadmap-index.md'), SECRET);
    rmSync(join(s.mon, 'context'), { recursive: true });
    symlinkSync(s.outside, join(s.mon, 'context'));
    expectRefused(readProjectFile(s.project, '.monolith/context/maps/roadmap-index.md', { allowEmpty: true }), 'FILE_SYMLINK');
  });

  it('the instance root itself being a symlink: state.json below it is refused, not read', async () => {
    const s = sandbox();
    mkdirSync(join(s.project, 'elsewhere'));
    writeFileSync(join(s.project, 'elsewhere', 'state.json'), SECRET);
    rmSync(s.mon, { recursive: true });
    symlinkSync(join(s.project, 'elsewhere'), s.mon);
    const err = await readState(projectTarget(s.project, s.mon)).catch((e) => e);
    expect(err.fileCode).toBe('FILE_SYMLINK');
    expect(String(err.message)).not.toContain(SECRET);
  });

  it('an intermediate component that is a regular file: FILE_UNRESOLVABLE, not a crash', () => {
    const s = sandbox();
    writeFileSync(join(s.project, 'blocker'), 'x');
    expectRefused(readProjectFile(s.project, 'blocker/inner.md', { allowEmpty: true }), 'FILE_UNRESOLVABLE');
  });

  it('a missing intermediate directory is a missing file', () => {
    const s = sandbox();
    expectRefused(readProjectFile(s.project, '.monolith/nope/active.md', { allowEmpty: true }), 'FILE_MISSING');
  });
});

describe('special files', () => {
  it('a unix socket: FILE_NOT_REGULAR', async () => {
    const s = sandbox();
    const sock = join(s.project, '.monolith', 'state.json');
    const server = createServer();
    await new Promise<void>((res) => server.listen(sock, res));
    try {
      expectRefused(readProjectFile(s.project, '.monolith/state.json', { allowEmpty: true }), 'FILE_NOT_REGULAR');
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });

  it('a character device: FILE_NOT_REGULAR (boundary /dev, never opened)', () => {
    const r = readBoundedFile('/dev/null', 'null', { boundary: '/dev', allowEmpty: true }, true);
    expectRefused(r, 'FILE_NOT_REGULAR');
  });

  it('a directory: FILE_NOT_REGULAR', () => {
    const s = sandbox();
    expectRefused(readProjectFile(s.project, '.monolith/memory', { allowEmpty: true }), 'FILE_NOT_REGULAR');
  });
});

describe('boundary errors', () => {
  it('an empty project root fails closed and never falls back to the cwd', () => {
    // This repository's cwd has a monolith.config.json — it must NOT be read.
    expectRefused(readProjectFile('', 'monolith.config.json', { allowEmpty: true }), 'READ_BOUNDARY_INVALID');
    const cfg = readConfigFile('');
    expect(cfg.status).toBe('unreadable');
    expect(() => resolveMonolithRoot('')).toThrow(/ROOT_CONFIG_INVALID/);
  });

  it('a relative project root is refused (no implicit cwd)', () => {
    expectRefused(readProjectFile('.', 'package.json', { allowEmpty: true }), 'READ_BOUNDARY_INVALID');
    expectRefused(readProjectFile('relative/dir', 'x', { allowEmpty: true }), 'READ_BOUNDARY_INVALID');
  });

  it('a relative file path is refused even if it would resolve under the cwd', () => {
    const s = sandbox();
    expect(existsSync('package.json')).toBe(true);
    expectRefused(readBoundedFile('package.json', 'rel', { boundary: s.project }, true), 'READ_BOUNDARY_INVALID');
  });

  it('a missing boundary option (JS caller) is refused', () => {
    const s = sandbox();
    const r = readBoundedFile(join(s.project, 'monolith.config.json'), 'x', {} as never, true);
    expectRefused(r, 'READ_BOUNDARY_INVALID');
  });

  it('a boundary that does not exist, or is a file, is refused', () => {
    const s = sandbox();
    expectRefused(readProjectFile(join(s.base, 'nope'), 'x', { allowEmpty: true }), 'READ_BOUNDARY_INVALID');
    expectRefused(readProjectFile(join(s.project, 'monolith.config.json'), 'x', { allowEmpty: true }), 'READ_BOUNDARY_INVALID');
  });

  it('a path outside the boundary: FILE_OUTSIDE_PROJECT (".." and sibling-prefix included)', () => {
    const s = sandbox();
    writeFileSync(join(s.outside, 'o.md'), SECRET);
    expectRefused(readProjectFile(s.project, '../outside/o.md', { allowEmpty: true }), 'FILE_OUTSIDE_PROJECT');
    mkdirSync(join(s.base, 'project-evil'));
    writeFileSync(join(s.base, 'project-evil', 'e.md'), SECRET);
    expectRefused(readBoundedFile(join(s.base, 'project-evil', 'e.md'), 'e', { boundary: s.project, allowEmpty: true }, true), 'FILE_OUTSIDE_PROJECT');
  });

  it('the boundary itself is not a readable file', () => {
    const s = sandbox();
    expectRefused(readBoundedFile(s.project, 'root', { boundary: s.project }, true), 'FILE_OUTSIDE_PROJECT');
  });

  it('a trusted-directory read takes the directory as its boundary: a symlink at the file is still refused', async () => {
    const s = sandbox();
    symlinkSync(join(s.project, '.env'), stateFilePath(s.mon));
    const err = await readState(trustedDirectoryTarget(s.mon)).catch((e) => e);
    expect(err.fileCode).toBe('FILE_SYMLINK');
  });

  it('readState requires an explicit scope — a plain path is refused', async () => {
    const s = sandbox();
    for (const bad of [s.mon, undefined, {}, { scope: 'project', stateDir: s.mon }, { scope: 'other', stateDir: s.mon }]) {
      const err = await readState(bad as never).catch((e) => e);
      expect(err.fileCode, JSON.stringify(bad)).toBe('READ_BOUNDARY_INVALID');
    }
  });
});

describe('fail closed without the required platform capabilities', () => {
  it('no O_NOFOLLOW → READ_UNSUPPORTED_PLATFORM, nothing is opened or read', () => {
    const s = sandbox();
    const abs = place(s, '.monolith/state.json', 'x');
    const r = readBoundedFile(abs, 'state', { boundary: s.project, platformFlags: { noFollow: undefined, nonBlock: 2048 } }, true);
    expectRefused(r, 'READ_UNSUPPORTED_PLATFORM');
  });

  it('no O_NONBLOCK → READ_UNSUPPORTED_PLATFORM', () => {
    const s = sandbox();
    const abs = place(s, '.monolith/state.json', 'x');
    const r = readBoundedFile(abs, 'state', { boundary: s.project, platformFlags: { noFollow: 131072, nonBlock: 0 } }, true);
    expectRefused(r, 'READ_UNSUPPORTED_PLATFORM');
  });
});

describe('identity of the opened file', () => {
  function target(s: Sandbox): string {
    return place(s, '.monolith/state.json', 'ORIGINAL');
  }

  it('a file replaced between the check and the open is FILE_CHANGED (and the replacement is not read)', () => {
    const s = sandbox();
    const abs = target(s);
    const r = readBoundedFile(
      abs,
      'state',
      {
        boundary: s.project,
        afterInspect: () => {
          writeFileSync(`${abs}.new`, 'REPLACEMENT');
          renameSync(`${abs}.new`, abs);
        },
      },
      true,
    );
    expectRefused(r, 'FILE_CHANGED');
  });

  it('a file replaced by a symlink between the check and the open is refused (O_NOFOLLOW), the target not read', () => {
    const s = sandbox();
    const abs = target(s);
    const r = readBoundedFile(
      abs,
      'state',
      {
        boundary: s.project,
        afterInspect: () => {
          rmSync(abs);
          symlinkSync(join(s.project, '.env'), abs);
        },
      },
      true,
    );
    expectRefused(r, 'FILE_SYMLINK');
  });

  it('a file replaced by a FIFO between the check and the open does not block and is refused', () => {
    const s = sandbox();
    const abs = target(s);
    const r = readBoundedFile(
      abs,
      'state',
      {
        boundary: s.project,
        afterInspect: () => {
          rmSync(abs);
          mkfifo(abs);
        },
      },
      true,
    );
    expectRefused(r, 'FILE_NOT_REGULAR');
  });

  it('a hardlink created after the check is caught on the descriptor', () => {
    const s = sandbox();
    const abs = target(s);
    const r = readBoundedFile(
      abs,
      'state',
      { boundary: s.project, afterInspect: () => linkSync(abs, join(s.outside, 'alias')) },
      true,
    );
    expectRefused(r, 'FILE_HARDLINKED');
  });

  it('the stable reader retries FILE_CHANGED and then reports it rather than guessing', () => {
    const s = sandbox();
    const abs = target(s);
    let swaps = 0;
    const r = readBoundedFileStable(
      abs,
      'state',
      {
        boundary: s.project,
        afterInspect: () => {
          swaps++;
          writeFileSync(`${abs}.new`, `V${swaps}`);
          renameSync(`${abs}.new`, abs);
        },
      },
      true,
    );
    expectRefused(r, 'FILE_CHANGED');
    expect(swaps).toBe(3);
  });

  it('a persistent hardlink stays refused after the transient-window retries', () => {
    const s = sandbox();
    const abs = target(s);
    linkSync(abs, join(s.outside, 'alias'));
    const t0 = Date.now();
    const r = readBoundedFileStable(abs, 'state', { boundary: s.project }, true);
    expectRefused(r, 'FILE_HARDLINKED');
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('managed consumers use the same policy', () => {
  it('readConfigFile: a config symlinked to .env is unreadable, never parsed, never defaulted', () => {
    const s = sandbox();
    rmSync(join(s.project, 'monolith.config.json'));
    symlinkSync(join(s.project, '.env'), join(s.project, 'monolith.config.json'));
    const r = readConfigFile(s.project);
    expect(r.status).toBe('unreadable');
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(() => resolveMonolithRoot(s.project)).toThrow(/ROOT_CONFIG_INVALID/);
  });

  it('brief (collect): active.md symlinked to a private file is not presented as project context', async () => {
    const s = sandbox();
    symlinkSync(join(s.project, 'private', 'notes.md'), join(s.mon, 'memory', 'working', 'active.md'));
    const model = await collect(s.project);
    expect(JSON.stringify(model)).not.toContain(SECRET);
    expect(model.story.excerpt).toBeNull();
    expect(model.diagnostics.some((d) => d.code === 'ACTIVE_MD_MISSING' && d.message.includes('FILE_SYMLINK'))).toBe(true);
  });

  it('brief (collect): state.json symlinked to .env is unreadable, never parsed', async () => {
    const s = sandbox();
    symlinkSync(join(s.project, '.env'), join(s.mon, 'state.json'));
    const model = await collect(s.project);
    expect(JSON.stringify(model)).not.toContain(SECRET);
    expect(model.diagnostics.some((d) => d.code === 'STATE_UNREADABLE' && d.message.includes('FILE_SYMLINK'))).toBe(true);
  });

  it('brief (collect): a protocol/ADR document under a symlinked directory is not read', async () => {
    const s = sandbox();
    mkdirSync(join(s.project, 'private-adr'));
    writeFileSync(join(s.project, 'private-adr', 'a.md'), `---\nid: x\nstatus: accepted\n---\n# ADR\n${SECRET}\n`);
    mkdirSync(join(s.mon, 'protocols'), { recursive: true });
    symlinkSync(join(s.project, 'private-adr'), join(s.mon, 'protocols', 'linked'));
    const model = await collect(s.project);
    expect(JSON.stringify(model)).not.toContain(SECRET);
  });

  it('lock: a symlinked or hardlinked lock is LockUnsafeError at once, left untouched', async () => {
    const s = sandbox();
    const lock = join(s.mon, 'state.json.lock');
    symlinkSync(join(s.project, '.env'), lock);
    const a = await acquireLock(lock, { timeoutMs: 200, retryDelayMs: 10 }).catch((e) => e);
    expect(a).toBeInstanceOf(LockUnsafeError);
    expect(a.fileCode).toBe('FILE_SYMLINK');
    expect(lstatSync(lock).isSymbolicLink()).toBe(true);
    rmSync(lock);

    linkSync(join(s.project, '.env'), lock);
    const b = await acquireLock(lock, { timeoutMs: 200, retryDelayMs: 10 }).catch((e) => e);
    expect(b).toBeInstanceOf(LockUnsafeError);
    expect(b.fileCode).toBe('FILE_HARDLINKED');
    expect(lstatSync(lock).nlink).toBe(2);
  });

  it('validate: roadmap-index.md symlinked to a private file is reported unreadable, not scanned', async () => {
    const s = sandbox();
    for (const d of ['memory', 'context', 'protocols', 'skills', 'governance', 'learning', 'tests']) {
      mkdirSync(join(s.mon, d), { recursive: true });
    }
    writeFileSync(join(s.project, 'project.definition.mjs'), 'export const PROJECT_DEFINITION = {};\n');
    symlinkSync(join(s.project, 'private', 'notes.md'), join(s.mon, 'context', 'maps', 'roadmap-index.md'));
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__exit__');
    }) as never);
    try {
      await runValidate({ targetDir: s.project }).catch(() => undefined);
    } finally {
      log.mockRestore();
      exit.mockRestore();
    }
    const out = lines.join('\n');
    expect(out).toContain('roadmap-index.md (FILE_SYMLINK)');
    expect(out).not.toContain(SECRET);
  });

  it('validate: an empty or relative targetDir is refused, the cwd is never assumed', async () => {
    for (const dir of ['', '.', 'relative']) {
      const lines: string[] = [];
      let code: number | undefined;
      const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
      const exit = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
        code = c;
      }) as never);
      try {
        await runValidate({ targetDir: dir });
      } finally {
        log.mockRestore();
        exit.mockRestore();
      }
      expect(code, dir).toBe(1);
      expect(lines.join('\n')).toContain('explicit absolute path');
    }
  });
});

describe('compatibility with SEC-001B.2 safe writes', () => {
  it('state written by the safe-write primitive (0600, one link, renamed into place) reads back, across rewrites', async () => {
    const s = sandbox();
    const target = projectTarget(s.project, s.mon);
    for (let i = 1; i <= 3; i++) {
      await mutateState(target, (d) => {
        d.revision = d.revision; // bumped by mutateState
      });
      const st = await readState(target);
      expect(st.revision).toBe(i);
      expect(lstatSync(stateFilePath(s.mon)).nlink).toBe(1);
    }
    expect(readdirSync(s.mon).filter((n) => n.includes('.tmp.') || n.includes('.creating.'))).toEqual([]);
  });

  it('a lock published by link() and released leaves nothing behind, and a following read-modify-write works', async () => {
    const s = sandbox();
    const lock = join(s.mon, 'state.json.lock');
    const release = await acquireLock(lock, { timeoutMs: 1000 });
    expect(lstatSync(lock).nlink).toBe(1); // the staging name is gone once publication finished
    release();
    expect(existsSync(lock)).toBe(false);
    await mutateState(projectTarget(s.project, s.mon), () => undefined);
    expect((await readState(projectTarget(s.project, s.mon))).revision).toBe(1);
  });

  it('writes keep their typed errors for a symlinked or hardlinked destination (NOT_PUBLISHED, nothing replaced)', async () => {
    const s = sandbox();
    symlinkSync(join(s.project, '.env'), stateFilePath(s.mon));
    const a = await mutateState(projectTarget(s.project, s.mon), () => undefined).catch((e) => e);
    expect(a.name).toBe('SafeWriteError');
    expect(a.code).toBe('WRITE_TARGET_SYMLINK');
    expect(a.publication).toBe('NOT_PUBLISHED');
    rmSync(stateFilePath(s.mon));

    linkSync(join(s.project, '.env'), stateFilePath(s.mon));
    const b = await mutateState(projectTarget(s.project, s.mon), () => undefined).catch((e) => e);
    expect(b.code).toBe('WRITE_TARGET_HARDLINKED');
    expect(b.publication).toBe('NOT_PUBLISHED');
  });
});
