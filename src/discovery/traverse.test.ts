import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_TRAVERSAL_LIMITS,
  TraversalError,
  traverseProject,
  type TraversalDiagnosticCode,
  type TraversalFs,
  type TraversalResult,
} from './traverse.js';

// DISCOVERY-001B-1 — safe bounded traversal. Every fixture is a throwaway mkdtemp tree outside the
// repository. Nothing here claims protection against a concurrent swap of a directory (SEC-001B.3,
// TM-C): the DIR_CHANGED tests show that a swap INSIDE the listing window is detected, no more.

const sandboxes: string[] = [];

afterEach(() => {
  while (sandboxes.length > 0) {
    const dir = sandboxes.pop() as string;
    try {
      chmodRecursiveBack(dir);
    } catch {
      // best effort
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function chmodRecursiveBack(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) {
      try {
        chmodSync(p, 0o755);
      } catch {
        /* ignore */
      }
      chmodRecursiveBack(p);
    }
  }
}

function sandbox(): { base: string; project: string; outside: string } {
  const base = mkdtempSync(join(tmpdir(), 'monolith-trav-'));
  sandboxes.push(base);
  const project = join(base, 'project');
  const outside = join(base, 'outside');
  mkdirSync(project);
  mkdirSync(outside);
  return { base, project, outside };
}

function put(root: string, rel: string, data = 'x'): void {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, data);
}

const paths = (r: TraversalResult): string[] => r.entries.map((e) => e.path);
const codes = (r: TraversalResult): TraversalDiagnosticCode[] => r.diagnostics.map((d) => d.code);
function mkfifo(path: string): boolean {
  try {
    execFileSync('mkfifo', [path]);
    return true;
  } catch {
    return false;
  }
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

/** Snapshot of every path, size and mtime: the walk must leave it unchanged. */
function snapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = lstatSync(p);
      out.push(`${p}|${st.isDirectory() ? 'd' : st.isSymbolicLink() ? 'l' : 'f'}|${st.size}|${st.mtimeMs}`);
      if (st.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out;
}

describe('functional', () => {
  it('an empty project is COMPLETE with no entries', () => {
    const { project } = sandbox();
    const r = traverseProject(project);
    expect(r.completeness).toBe('COMPLETE');
    expect(r.entries).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect(r.reproducible).toBe(true);
  });

  it('lists nested directories and files with project-relative POSIX paths and kinds', () => {
    const { project } = sandbox();
    put(project, 'package.json');
    put(project, 'src/a/b/c.ts');
    put(project, 'src/z.ts');
    mkdirSync(join(project, 'empty'));
    const r = traverseProject(project);
    expect(r.completeness).toBe('COMPLETE');
    expect(r.entries).toEqual([
      { path: 'empty', kind: 'directory' },
      { path: 'package.json', kind: 'file' },
      { path: 'src', kind: 'directory' },
      { path: 'src/a', kind: 'directory' },
      { path: 'src/a/b', kind: 'directory' },
      { path: 'src/a/b/c.ts', kind: 'file' },
      { path: 'src/z.ts', kind: 'file' },
    ]);
    expect(r.stats).toMatchObject({ entries: 7, files: 3, directories: 4, symlinks: 0, other: 0 });
    for (const e of r.entries) {
      expect(e.path.startsWith('/')).toBe(false);
      expect(e.path.split('/')).not.toContain('..');
    }
  });

  it('orders by UTF-16 code units, not by locale (uppercase before lowercase, "-" before ".")', () => {
    const { project } = sandbox();
    for (const n of ['b', 'B', 'a-b', 'a.b', 'ä', 'Z']) put(project, n);
    expect(paths(traverseProject(project))).toEqual(['B', 'Z', 'a-b', 'a.b', 'b', 'ä']);
  });

  it('a repeated scan of an unchanged tree is deeply equal; the result holds no absolute path', () => {
    const { project } = sandbox();
    for (let i = 0; i < 40; i++) put(project, `d${i % 5}/f${i}.txt`);
    const one = traverseProject(project);
    const two = traverseProject(project);
    expect(two).toEqual(one);
    expect(JSON.stringify(one)).not.toContain(project);
    expect(JSON.stringify(one)).not.toContain(tmpdir());
  });

  it('the result does not depend on the order in which the file system lists a directory', () => {
    const { project } = sandbox();
    for (const n of ['c', 'a', 'b']) put(project, `${n}/x`);
    const real = traverseProject(project);
    const reversing: TraversalFs = {
      lstat: (p) => lstatSync(p, { bigint: true }),
      stat: (p) => (lstatSync(p, { bigint: true })),
      opendir: (p) => {
        const names = readdirSync(p, { withFileTypes: true }).reverse();
        let i = 0;
        return { readSync: () => names[i++] ?? null, closeSync: () => undefined };
      },
    };
    expect(traverseProject(project, { fs: reversing })).toEqual(real);
  });

  it('handles Unicode, spaces, markup characters and 255-byte names', () => {
    const { project } = sandbox();
    const long = 'x'.repeat(255);
    const names = ['日本語.txt', 'с пробелом.md', 'emoji-🙂.ts', '{{PROJECT_NAME}}.md', '`tick`|pipe.md', long];
    for (const n of names) put(project, n);
    const r = traverseProject(project);
    expect(r.completeness).toBe('COMPLETE');
    expect(paths(r).sort()).toEqual([...names].sort());
  });

  it('a relative or missing root is refused with a typed error', () => {
    expect(() => traverseProject(join(tmpdir(), 'monolith-does-not-exist-xyz'))).toThrow(TraversalError);
    const { project } = sandbox();
    put(project, 'file');
    expect(() => traverseProject(join(project, 'file'))).toThrow(TraversalError);
    expect(() => traverseProject('relative/dir')).toThrow(TraversalError);
  });
});

describe('exclusions', () => {
  it('excludes the standard dependency/build directories at any depth, with a diagnostic', () => {
    const { project } = sandbox();
    put(project, 'keep.ts');
    for (const d of ['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.venv', 'venv', '__pycache__', 'target', 'vendor']) {
      put(project, `${d}/inner/file.js`);
      put(project, `packages/p/${d}/inner/file.js`);
    }
    put(project, '.claude/worktrees/w1/file');
    put(project, '.claude/keep.md');
    const r = traverseProject(project);
    expect(paths(r)).toEqual(['.claude', '.claude/keep.md', 'keep.ts', 'packages', 'packages/p']);
    expect(r.completeness).toBe('COMPLETE');
    const excluded = r.diagnostics.filter((d) => d.code === 'EXCLUDED_DIR');
    expect(excluded.length).toBeGreaterThan(0);
    expect(excluded.some((d) => d.path === '.claude/worktrees')).toBe(true);
  });

  it('a FILE named like an excluded directory is an ordinary file', () => {
    const { project } = sandbox();
    put(project, 'build', 'not a directory');
    expect(paths(traverseProject(project))).toEqual(['build']);
  });

  it('excludes .monolith by default and its contents are never listed', () => {
    const { project } = sandbox();
    put(project, '.monolith/state.json');
    put(project, '.monolith/context/maps/project-map.proposal.md');
    put(project, 'a.ts');
    const r = traverseProject(project);
    expect(paths(r)).toEqual(['a.ts']);
    expect(codes(r)).toContain('MONOLITH_ROOT_EXCLUDED');
  });

  it('excludes the CONFIGURED monolithRoot, not the literal name .monolith', () => {
    const { project } = sandbox();
    writeFileSync(join(project, 'monolith.config.json'), JSON.stringify({ monolithRoot: 'tools/brain' }));
    put(project, 'tools/brain/state.json');
    put(project, 'tools/other.ts');
    put(project, '.monolith/legit-user-dir/file.md'); // not the instance root any more: an ordinary directory
    const r = traverseProject(project);
    expect(paths(r)).toContain('.monolith/legit-user-dir/file.md');
    expect(paths(r)).toContain('tools/other.ts');
    expect(paths(r).some((p) => p.startsWith('tools/brain'))).toBe(false);
    expect(paths(r)).toContain('monolith.config.json');
  });

  it('writing a proposal into the instance does not change a later scan (idempotence across publication)', () => {
    const { project } = sandbox();
    put(project, 'a.ts');
    put(project, '.monolith/state.json');
    const before = traverseProject(project);
    put(project, '.monolith/context/maps/project-map.proposal.md', 'proposal');
    put(project, '.monolith/state.json', 'changed by a mission');
    expect(traverseProject(project)).toEqual(before);
  });

  it('a config whose monolithRoot escapes the project fails closed (ROOT_UNSAFE), no walk', () => {
    const { project } = sandbox();
    writeFileSync(join(project, 'monolith.config.json'), JSON.stringify({ monolithRoot: '../elsewhere' }));
    expect(() => traverseProject(project)).toThrowError(expect.objectContaining({ code: 'ROOT_UNSAFE' }));
    writeFileSync(join(project, 'monolith.config.json'), '{ broken');
    expect(() => traverseProject(project)).toThrowError(expect.objectContaining({ code: 'ROOT_UNSAFE' }));
  });

  it('does not enter a nested repository or worktree (a directory holding .git, file or directory)', () => {
    const { project } = sandbox();
    put(project, 'nested/.git/HEAD');
    put(project, 'nested/src/a.ts');
    put(project, 'wt/.git', 'gitdir: ../elsewhere');
    put(project, 'wt/b.ts');
    put(project, 'ok/c.ts');
    const r = traverseProject(project);
    expect(paths(r)).toEqual(['nested', 'ok', 'ok/c.ts', 'wt']);
    expect(r.diagnostics.filter((d) => d.code === 'NESTED_REPO_SKIPPED').map((d) => d.path).sort()).toEqual(['nested', 'wt']);
  });
});

describe('security', () => {
  it('lists a symlink to an external directory but never follows it; the target is never named', () => {
    const { project, outside } = sandbox();
    put(outside, 'secret/token.txt', 'TOP-SECRET');
    symlinkSync(join(outside, 'secret'), join(project, 'link'));
    put(project, 'a.ts');
    const r = traverseProject(project);
    expect(r.entries).toEqual([{ path: 'a.ts', kind: 'file' }, { path: 'link', kind: 'symlink' }]);
    expect(r.stats.symlinks).toBe(1);
    expect(codes(r)).toContain('SYMLINK_SKIPPED');
    expect(r.completeness).toBe('COMPLETE'); // scope policy, not a failure
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(JSON.stringify(r)).not.toContain('token.txt');
  });

  it('does not follow a symlink to an internal directory (its contents appear once, under the real path)', () => {
    const { project } = sandbox();
    put(project, 'real/file.ts');
    symlinkSync(join(project, 'real'), join(project, 'alias'));
    const r = traverseProject(project);
    expect(paths(r)).toEqual(['alias', 'real', 'real/file.ts']);
    expect(r.entries.find((e) => e.path === 'alias')?.kind).toBe('symlink');
  });

  it('a symlink cycle and a dangling link terminate and are reported as links', () => {
    const { project } = sandbox();
    mkdirSync(join(project, 'a'));
    symlinkSync(project, join(project, 'a', 'up'));
    symlinkSync(join(project, 'nowhere'), join(project, 'dangling'));
    symlinkSync(join(project, 'loop2'), join(project, 'loop1'));
    symlinkSync(join(project, 'loop1'), join(project, 'loop2'));
    const r = traverseProject(project);
    expect(r.entries.filter((e) => e.kind === 'symlink').map((e) => e.path)).toEqual(['a/up', 'dangling', 'loop1', 'loop2']);
    expect(r.completeness).toBe('COMPLETE');
  });

  it('a symlinked project root is accepted as the explicit root the caller chose', () => {
    const { base, project } = sandbox();
    put(project, 'a.ts');
    const via = join(base, 'via');
    symlinkSync(project, via);
    expect(paths(traverseProject(via))).toEqual(['a.ts']);
  });

  it('a FIFO is listed as "other" and is never opened (the walk does not block)', () => {
    const { project } = sandbox();
    if (!mkfifo(join(project, 'pipe'))) return; // mkfifo unavailable: documented limitation
    put(project, 'a.ts');
    const r = traverseProject(project);
    expect(r.entries).toEqual([{ path: 'a.ts', kind: 'file' }, { path: 'pipe', kind: 'other' }]);
    expect(r.stats.other).toBe(1);
  });

  it.skipIf(isRoot)('an unreadable directory is DIR_UNREADABLE (PARTIAL); siblings are still found', () => {
    const { project } = sandbox();
    put(project, 'ok/a.ts');
    put(project, 'locked/b.ts');
    chmodSync(join(project, 'locked'), 0o000);
    const r = traverseProject(project);
    expect(r.completeness).toBe('PARTIAL');
    expect(paths(r)).toEqual(['locked', 'ok', 'ok/a.ts']);
    expect(r.diagnostics.find((d) => d.code === 'DIR_UNREADABLE')?.path).toBe('locked');
  });

  it('permission errors from the file system (injected EACCES/EPERM/ENOENT/EIO) are typed diagnostics, never exceptions', () => {
    const { project } = sandbox();
    put(project, 'eacces/x');
    put(project, 'eperm/x');
    put(project, 'gone/x');
    put(project, 'eio/x');
    put(project, 'fine/x');
    const failing: Record<string, string> = { eacces: 'EACCES', eperm: 'EPERM', gone: 'ENOENT', eio: 'EIO' };
    const fs: TraversalFs = {
      lstat: (p) => lstatSync(p, { bigint: true }),
      stat: (p) => lstatSync(p, { bigint: true }),
      opendir: (p) => {
        const code = failing[p.split('/').pop() as string];
        if (code) throw Object.assign(new Error(code), { code });
        const names = readdirSync(p, { withFileTypes: true });
        let i = 0;
        return { readSync: () => names[i++] ?? null, closeSync: () => undefined };
      },
    };
    const r = traverseProject(project, { fs });
    expect(r.completeness).toBe('PARTIAL');
    const byPath = Object.fromEntries(r.diagnostics.map((d) => [d.path, d.code]));
    expect(byPath).toMatchObject({ eacces: 'DIR_UNREADABLE', eperm: 'DIR_UNREADABLE', gone: 'DIR_VANISHED', eio: 'DIR_ERROR' });
    expect(paths(r)).toContain('fine/x');
  });

  it('a directory replaced between the identity check and the end of listing is DIR_CHANGED; its contents are discarded', () => {
    const { project } = sandbox();
    put(project, 'victim/inside.ts');
    put(project, 'other/x.ts');
    let lstats = 0;
    const fs: TraversalFs = {
      stat: (p) => lstatSync(p, { bigint: true }),
      lstat: (p) => {
        const st = lstatSync(p, { bigint: true });
        if (p.endsWith('/victim')) {
          lstats++;
          if (lstats >= 2) return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, dev: st.dev, ino: st.ino + 1n };
        }
        return st;
      },
      opendir: (p) => {
        const names = readdirSync(p, { withFileTypes: true });
        let i = 0;
        return { readSync: () => names[i++] ?? null, closeSync: () => undefined };
      },
    };
    const r = traverseProject(project, { fs });
    expect(r.completeness).toBe('PARTIAL');
    expect(r.diagnostics.find((d) => d.code === 'DIR_CHANGED')?.path).toBe('victim');
    expect(paths(r)).not.toContain('victim/inside.ts');
    expect(paths(r)).toContain('other/x.ts');
  });

  it('a directory on another file system is not entered (MOUNT_SKIPPED)', () => {
    const { project } = sandbox();
    put(project, 'mnt/inside.ts');
    put(project, 'here/a.ts');
    const fs: TraversalFs = {
      stat: (p) => lstatSync(p, { bigint: true }),
      lstat: (p) => {
        const st = lstatSync(p, { bigint: true });
        return p.endsWith('/mnt') ? { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, dev: st.dev + 1n, ino: st.ino } : st;
      },
      opendir: (p) => {
        const names = readdirSync(p, { withFileTypes: true });
        let i = 0;
        return { readSync: () => names[i++] ?? null, closeSync: () => undefined };
      },
    };
    const r = traverseProject(project, { fs });
    expect(paths(r)).toEqual(['here', 'here/a.ts', 'mnt']);
    expect(codes(r)).toContain('MOUNT_SKIPPED');
    expect(r.completeness).toBe('COMPLETE');
  });

  it('fails closed without O_NOFOLLOW / O_NONBLOCK (UNSUPPORTED_PLATFORM)', () => {
    const { project } = sandbox();
    expect(() => traverseProject(project, { platformFlags: { nonBlock: 1 } })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_PLATFORM' }));
    expect(() => traverseProject(project, { platformFlags: { noFollow: 1 } })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_PLATFORM' }));
  });

  it('writes nothing into the examined tree (paths, sizes and mtimes identical before and after)', () => {
    const { project } = sandbox();
    put(project, 'a/b/c.ts');
    put(project, '.monolith/state.json');
    put(project, 'node_modules/x/y.js');
    symlinkSync(join(project, 'a'), join(project, 'ln'));
    const before = snapshot(project);
    traverseProject(project);
    traverseProject(project, { limits: { maxEntries: 2 } });
    expect(snapshot(project)).toEqual(before);
  });

  it('does not read file content: a file whose name would be a secret is only a name', () => {
    const { project } = sandbox();
    put(project, '.env', 'SECRET=1');
    const r = traverseProject(project);
    expect(JSON.stringify(r)).not.toContain('SECRET=1');
  });
});

describe('limits and partial results', () => {
  it('maxDepth: a directory at the limit is listed but not entered (LIMIT_DEPTH, PARTIAL)', () => {
    const { project } = sandbox();
    put(project, 'a/b/c/d/e.ts');
    const r = traverseProject(project, { limits: { maxDepth: 3 } });
    expect(paths(r)).toEqual(['a', 'a/b', 'a/b/c']);
    expect(r.completeness).toBe('PARTIAL');
    expect(r.diagnostics.find((d) => d.code === 'LIMIT_DEPTH')?.path).toBe('a/b/c');
  });

  it('a chain deeper than the default limit of 32 terminates with LIMIT_DEPTH', () => {
    const { project } = sandbox();
    put(project, `${Array.from({ length: 40 }, (_, i) => `d${i}`).join('/')}/leaf.txt`);
    const r = traverseProject(project);
    expect(r.completeness).toBe('PARTIAL');
    expect(r.entries.length).toBe(DEFAULT_TRAVERSAL_LIMITS.maxDepth);
    expect(codes(r)).toContain('LIMIT_DEPTH');
  });

  it('maxEntries: stops with LIMIT_ENTRIES, PARTIAL, breadth-first and deterministic', () => {
    const { project } = sandbox();
    for (let i = 0; i < 6; i++) put(project, `d${i}/f.ts`);
    const one = traverseProject(project, { limits: { maxEntries: 8 } });
    const two = traverseProject(project, { limits: { maxEntries: 8 } });
    expect(one.completeness).toBe('PARTIAL');
    expect(codes(one)).toContain('LIMIT_ENTRIES');
    expect(one.stats.examined).toBe(9);
    expect(one).toEqual(two);
    // all top-level directories are present before any second level is reached
    expect(paths(one).filter((p) => !p.includes('/'))).toEqual(['d0', 'd1', 'd2', 'd3', 'd4', 'd5']);
  });

  it('maxEntriesPerDir: an over-full directory is opaque, counted at a fixed cost, not enumerated', () => {
    const { project } = sandbox();
    for (let i = 0; i < 12; i++) put(project, `big/f${i}`);
    put(project, 'small/a');
    const r = traverseProject(project, { limits: { maxEntriesPerDir: 10 } });
    expect(paths(r)).toEqual(['big', 'small', 'small/a']);
    expect(r.completeness).toBe('PARTIAL');
    expect(r.diagnostics.find((d) => d.code === 'LIMIT_DIR_ENTRIES')?.path).toBe('big');
  });

  it('a directory with exactly maxEntriesPerDir entries is listed in full', () => {
    const { project } = sandbox();
    for (let i = 0; i < 10; i++) put(project, `d/f${i}`);
    const r = traverseProject(project, { limits: { maxEntriesPerDir: 10 } });
    expect(r.completeness).toBe('COMPLETE');
    expect(r.entries.length).toBe(11);
  });

  it('an over-full directory does not load the directory: reading stops one entry past the cap', () => {
    const { project } = sandbox();
    put(project, 'x');
    let reads = 0;
    const fs: TraversalFs = {
      stat: (p) => lstatSync(p, { bigint: true }),
      lstat: (p) => lstatSync(p, { bigint: true }),
      opendir: () => ({
        readSync: () => {
          reads++;
          return reads > 1_000_000 ? null : ({ name: `n${reads}`, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false } as never);
        },
        closeSync: () => undefined,
      }),
    };
    const r = traverseProject(project, { fs, limits: { maxEntriesPerDir: 50 } });
    expect(reads).toBe(51);
    expect(codes(r)).toContain('LIMIT_DIR_ENTRIES');
  });

  it('time budget: LIMIT_DEADLINE, PARTIAL, flagged not reproducible, and the walk really stops', () => {
    const { project } = sandbox();
    for (let i = 0; i < 20; i++) put(project, `f${i}`);
    let t = 0;
    const r = traverseProject(project, { limits: { deadlineMs: 5 }, now: () => t++ });
    expect(r.completeness).toBe('PARTIAL');
    expect(r.reproducible).toBe(false);
    expect(codes(r)).toContain('LIMIT_DEADLINE');
    // `examined` counts entries READ (the whole root listing is charged at once); the walk stops inside it.
    expect(r.stats.entries).toBeLessThan(20);
  });

  it('an unrepresentable name (control character, invalid UTF-8; an over-long name cannot be created on this file system, so that branch is covered by the helper only) is excluded and reported', () => {
    const { project } = sandbox();
    put(project, 'ok.ts');
    put(project, 'new\nline.ts');
    writeFileSync(Buffer.concat([Buffer.from(project + '/bad-'), Buffer.from([0xff, 0xfe]), Buffer.from('.ts')]), 'x');
    const r = traverseProject(project);
    expect(paths(r)).toEqual(['ok.ts']);
    expect(r.completeness).toBe('PARTIAL');
    expect(r.diagnostics.filter((d) => d.code === 'NAME_UNREPRESENTABLE').length).toBe(2); // one per excluded name
  });

  it('keeps diagnostics bounded: many symlinks give at most 20 listed paths plus one total', () => {
    const { project } = sandbox();
    for (let i = 0; i < 60; i++) symlinkSync(join(project, 'none'), join(project, `l${String(i).padStart(2, '0')}`));
    const r = traverseProject(project);
    const mine = r.diagnostics.filter((d) => d.code === 'SYMLINK_SKIPPED');
    expect(mine.length).toBe(21);
    expect(mine.find((d) => d.count !== undefined)?.count).toBe(60);
    expect(r.stats.symlinks).toBe(60);
  });

  it('rejects non-positive or non-integer limits', () => {
    const { project } = sandbox();
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => traverseProject(project, { limits: { maxEntries: bad } })).toThrowError(expect.objectContaining({ code: 'INVALID_LIMITS' }));
    }
  });
});

describe('robustness', () => {
  it('closes every directory handle, including after a read error and after a limit stop', () => {
    const { project } = sandbox();
    put(project, 'a/x');
    put(project, 'b/x');
    put(project, 'c/x');
    let open = 0;
    let maxOpen = 0;
    let opened = 0;
    let closed = 0;
    const fs: TraversalFs = {
      stat: (p) => lstatSync(p, { bigint: true }),
      lstat: (p) => lstatSync(p, { bigint: true }),
      opendir: (p) => {
        opened++;
        open++;
        maxOpen = Math.max(maxOpen, open);
        const names = readdirSync(p, { withFileTypes: true });
        let i = 0;
        return {
          readSync: () => {
            if (p.endsWith('/b')) throw Object.assign(new Error('boom'), { code: 'EIO' });
            return names[i++] ?? null;
          },
          closeSync: () => {
            closed++;
            open--;
          },
        };
      },
    };
    const r = traverseProject(project, { fs });
    expect(codes(r)).toContain('DIR_ERROR');
    expect(opened).toBe(closed);
    expect(maxOpen).toBe(1);

    opened = closed = 0;
    traverseProject(project, { fs, limits: { maxEntries: 2 } });
    expect(opened).toBe(closed);
  });

  it('a failing close does not lose the listing or throw', () => {
    const { project } = sandbox();
    put(project, 'a');
    const fs: TraversalFs = {
      stat: (p) => lstatSync(p, { bigint: true }),
      lstat: (p) => lstatSync(p, { bigint: true }),
      opendir: (p) => {
        const names = readdirSync(p, { withFileTypes: true });
        let i = 0;
        return {
          readSync: () => names[i++] ?? null,
          closeSync: () => {
            throw new Error('close failed');
          },
        };
      },
    };
    expect(paths(traverseProject(project, { fs }))).toEqual(['a']);
  });

  it('a file system that reports no entry type (DT_UNKNOWN) is classified without following links', () => {
    const { project, outside } = sandbox();
    put(project, 'f');
    mkdirSync(join(project, 'd'));
    symlinkSync(outside, join(project, 'l'));
    const fs: TraversalFs = {
      stat: (p) => lstatSync(p, { bigint: true }),
      lstat: (p) => lstatSync(p, { bigint: true }),
      opendir: (p) => {
        const names = readdirSync(p, { withFileTypes: true }).map((d) => ({ name: d.name, isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false }));
        let i = 0;
        return { readSync: () => (names[i++] as never) ?? null, closeSync: () => undefined };
      },
    };
    expect(traverseProject(project, { fs }).entries).toEqual([
      { path: 'd', kind: 'directory' },
      { path: 'f', kind: 'file' },
      { path: 'l', kind: 'symlink' },
    ]);
  });

  it('handles a wide, deep synthetic tree within the default limits', () => {
    const { project } = sandbox();
    for (let d = 0; d < 20; d++) for (let f = 0; f < 100; f++) put(project, `pkg${d}/src/f${f}.ts`);
    const r = traverseProject(project);
    expect(r.completeness).toBe('COMPLETE');
    expect(r.stats.files).toBe(2000);
    expect(existsSync(project)).toBe(true);
  });
});

describe('source constraints (ADR-021 gates G1, G12)', () => {
  it('src/discovery contains no readdirSync, child_process, eval, dynamic import, network, write or content read', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts') || false) continue;
      const code = readFileSync(join(dir, name), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join('\n');
      for (const banned of [/readdirSync/, /child_process/, /\beval\s*\(/, /new Function\s*\(/, /\bimport\s*\(/, /\bfetch\s*\(/, /from ['"](http|https|net|dgram|dns)['"]/, /writeFileSync|appendFileSync|createWriteStream|mkdirSync|unlinkSync|rmSync|renameSync|\bwriteSync/, /readFileSync|readFile\b|createReadStream/]) {
        if (banned.test(code)) offenders.push(`${name}: ${banned}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DISCOVERY-001B-1-F — remediation of the independent review (F-01 … F-10)
// ---------------------------------------------------------------------------

type Ident = { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; dev: bigint; ino: bigint };

interface Probe {
  fs: TraversalFs;
  /** Entries returned by `readSync` across all handles (the real work done). */
  reads: () => number;
  opened: string[];
  open: () => number;
}

/** Real file system behind a seam that counts reads/opens and can permute, hide types or fail. */
function probedFs(opts: {
  order?: (names: import('fs').Dirent[], dir: string) => import('fs').Dirent[];
  unknownType?: boolean;
  lstat?: (p: string, real: Ident, calls: Map<string, number>) => Ident;
  opendirError?: (p: string) => string | undefined;
  readError?: (p: string, index: number) => string | undefined;
} = {}): Probe {
  let reads = 0;
  let open = 0;
  const opened: string[] = [];
  const calls = new Map<string, number>();
  const fs: TraversalFs = {
    stat: (p) => lstatSync(p, { bigint: true }),
    lstat: (p) => {
      calls.set(p, (calls.get(p) ?? 0) + 1);
      const real = lstatSync(p, { bigint: true });
      return opts.lstat ? opts.lstat(p, real, calls) : real;
    },
    opendir: (p) => {
      const bad = opts.opendirError?.(p);
      if (bad) throw Object.assign(new Error(bad), { code: bad });
      opened.push(p);
      open++;
      let names = readdirSync(p, { withFileTypes: true });
      if (opts.order) names = opts.order(names, p);
      let i = 0;
      return {
        readSync: () => {
          const bad = opts.readError?.(p, i);
          if (bad) throw Object.assign(new Error(bad), { code: bad });
          const d = names[i++];
          if (!d) return null;
          reads++;
          return opts.unknownType ? ({ name: d.name, isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false } as never) : d;
        },
        closeSync: () => {
          open--;
        },
      };
    },
  };
  return { fs, reads: () => reads, opened, open: () => open };
}

/** A seeded, reproducible shuffle of what `readSync` returns for each directory (seed 0 reverses). */
function permutedOrder(seed: number): NonNullable<Parameters<typeof probedFs>[0]>['order'] {
  return (names) => {
    if (seed === 0) return [...names].reverse();
    let state = seed * 2654435761 >>> 0;
    const next = (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const out = [...names];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
}

describe('F-01 bounded work: every listing is charged', () => {
  it('a nested repository is recognised without being listed: its entries are never read, and it cannot cause PARTIAL', () => {
    const { project } = sandbox();
    for (let d = 0; d < 30; d++) {
      mkdirSync(join(project, `n${String(d).padStart(2, '0')}/.git`), { recursive: true });
      for (let f = 0; f < 50; f++) put(project, `n${String(d).padStart(2, '0')}/f${f}`);
    }
    const probe = probedFs();
    const r = traverseProject(project, { fs: probe.fs, limits: { maxEntries: 100, maxEntriesPerDir: 40 } });
    expect(probe.opened).toEqual([project]); // only the root was ever opened
    expect(probe.reads()).toBe(30);
    expect(r.stats.examined).toBe(30);
    expect(r.completeness).toBe('COMPLETE');
    expect(codes(r).filter((c) => c === 'NESTED_REPO_SKIPPED').length).toBeGreaterThan(0);
    expect(codes(r)).not.toContain('LIMIT_DIR_ENTRIES');
  });

  it('a nested repository whose .git is a FILE (worktree) is skipped without listing, even when over the per-directory cap', () => {
    const { project } = sandbox();
    for (let f = 0; f < 40; f++) put(project, `wt/f${f}`);
    put(project, 'wt/.git', 'gitdir: elsewhere');
    put(project, 'ok.ts');
    const probe = probedFs();
    const r = traverseProject(project, { fs: probe.fs, limits: { maxEntriesPerDir: 10 } });
    expect(probe.opened).toEqual([project]);
    expect(paths(r)).toEqual(['ok.ts', 'wt']);
    expect(r.completeness).toBe('COMPLETE');
    expect(codes(r)).toContain('NESTED_REPO_SKIPPED');
  });

  it('actual reads never exceed maxEntries + 1, and `examined` is exactly the number of entries read', () => {
    const { project } = sandbox();
    for (let d = 0; d < 20; d++) for (let f = 0; f < 40; f++) put(project, `d${String(d).padStart(2, '0')}/f${f}`);
    for (const maxEntries of [1, 19, 20, 21, 59, 60, 61, 100, 400, 819, 820, 821]) {
      const probe = probedFs();
      const r = traverseProject(project, { fs: probe.fs, limits: { maxEntries, maxEntriesPerDir: 1000 } });
      expect(probe.reads()).toBeLessThanOrEqual(maxEntries + 1);
      expect(r.stats.examined).toBe(probe.reads());
      expect(r.completeness).toBe(maxEntries >= 820 ? 'COMPLETE' : 'PARTIAL');
      expect(probe.open()).toBe(0);
    }
  });

  it('a directory that does not fit in the remaining budget is not enumerated at all (no order-dependent prefix)', () => {
    const { project } = sandbox();
    for (let f = 0; f < 6; f++) put(project, `a/f${f}`);
    // root: 1 entry, a: 6 entries; budget 5 leaves 4 for `a`, which has 6.
    const r = traverseProject(project, { limits: { maxEntries: 5 } });
    expect(paths(r)).toEqual(['a']);
    expect(codes(r)).toContain('LIMIT_ENTRIES');
    expect(r.stats.examined).toBe(6); // 1 + (4 + the one that proved it does not fit)
    expect(r.completeness).toBe('PARTIAL');
  });

  it('the entries of a listing that is later discarded as DIR_CHANGED, or fails half-way, are still charged', () => {
    const { project } = sandbox();
    for (let f = 0; f < 5; f++) put(project, `victim/f${f}`);
    for (let f = 0; f < 5; f++) put(project, `flaky/f${f}`);
    const probe = probedFs({
      lstat: (p, real, calls) => (p.endsWith('/victim') && (calls.get(p) ?? 0) >= 2 ? { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, dev: real.dev, ino: real.ino + 1n } : real),
      readError: (p, i) => (p.endsWith('/flaky') && i === 3 ? 'EIO' : undefined),
    });
    const r = traverseProject(project, { fs: probe.fs });
    expect(codes(r)).toEqual(expect.arrayContaining(['DIR_CHANGED', 'DIR_ERROR']));
    expect(probe.reads()).toBe(2 + 5 + 3);
    expect(r.stats.examined).toBe(10);
  });

  it('handles are closed when the budget or the per-directory cap stops the listing', () => {
    const { project } = sandbox();
    for (let f = 0; f < 30; f++) put(project, `big/f${f}`);
    put(project, 'small/a');
    const probe = probedFs();
    traverseProject(project, { fs: probe.fs, limits: { maxEntriesPerDir: 10 } });
    traverseProject(project, { fs: probe.fs, limits: { maxEntries: 5 } });
    expect(probe.open()).toBe(0);
  });
});

describe('F-03 determinism of the SET, not only of the order', () => {
  function tree(project: string): void {
    for (const d of ['a', 'b', 'c', 'd']) for (let f = 0; f < 3; f++) put(project, `${d}/${d}${f}.ts`);
    for (const n of ['w', 'x', 'y', 'z']) put(project, `${n}.ts`);
  }

  const variants: [string, Record<string, number>][] = [
    ['maxEntries', { maxEntries: 17 }],
    ['maxEntries (another cut)', { maxEntries: 11 }],
    ['maxPathBytes (cuts inside a directory)', { maxPathBytes: 60 }],
    ['maxEntriesPerDir', { maxEntriesPerDir: 3 }],
  ];

  for (const [label, limits] of variants) {
    it(`under ${label}, every read order of every directory yields the same entries, diagnostics and completeness`, () => {
      const { project } = sandbox();
      tree(project);
      const base = traverseProject(project, { limits });
      expect(base.completeness).toBe('PARTIAL');
      for (let seed = 0; seed < 40; seed++) {
        const r = traverseProject(project, { fs: probedFs({ order: permutedOrder(seed) }).fs, limits });
        expect(paths(r)).toEqual(paths(base));
        expect(r.diagnostics).toEqual(base.diagnostics);
        expect(r.completeness).toBe(base.completeness);
        expect(r.stats).toEqual(base.stats);
      }
    });
  }
});

describe('F-03 opaque directory accounting', () => {
  // root holds `big` (12 files, opaque at cap 10) and `small` (1 file): root = 2 reads.
  function fixture(): string {
    const { project } = sandbox();
    for (let i = 0; i < 12; i++) put(project, `big/f${i}`);
    put(project, 'small/a');
    return project;
  }

  it('an opaque directory costs exactly maxEntriesPerDir + 1', () => {
    const r = traverseProject(fixture(), { limits: { maxEntriesPerDir: 10 } });
    expect(r.stats.examined).toBe(2 + 11 + 1);
    expect(r.diagnostics.find((d) => d.code === 'LIMIT_DIR_ENTRIES')?.path).toBe('big');
  });

  it('a directory with exactly maxEntriesPerDir entries costs its entries, one more is opaque', () => {
    const { project } = sandbox();
    for (let i = 0; i < 10; i++) put(project, `d/f${i}`);
    const exact = traverseProject(project, { limits: { maxEntriesPerDir: 10 } });
    expect(exact.stats.examined).toBe(1 + 10);
    expect(codes(exact)).not.toContain('LIMIT_DIR_ENTRIES');
    put(project, 'd/extra');
    const over = traverseProject(project, { limits: { maxEntriesPerDir: 10 } });
    expect(over.stats.examined).toBe(1 + 11);
    expect(codes(over)).toContain('LIMIT_DIR_ENTRIES');
  });

  it('the total budget decides on the boundary: 14 suffices for everything, 13 stops before `small`, 12 stops inside `big`', () => {
    const project = fixture();
    const at = (maxEntries: number): TraversalResult => traverseProject(project, { limits: { maxEntriesPerDir: 10, maxEntries } });
    const ok = at(14);
    expect(codes(ok)).not.toContain('LIMIT_ENTRIES');
    expect(paths(ok)).toEqual(['big', 'small', 'small/a']);
    const short = at(13);
    expect(codes(short)).toContain('LIMIT_ENTRIES');
    expect(paths(short)).toEqual(['big', 'small']); // `small` did not fit the one entry left over
    expect(short.stats.examined).toBe(14);
    const early = at(12);
    expect(codes(early)).toContain('LIMIT_ENTRIES');
    expect(early.stats.examined).toBe(13); // big was charged in full, then the walk stopped
    expect(paths(early)).toEqual(['big', 'small']);
  });

  it('several opaque directories are each charged; they and ordinary directories combine without drift', () => {
    const { project } = sandbox();
    for (const d of ['o1', 'o2', 'o3']) for (let i = 0; i < 12; i++) put(project, `${d}/f${i}`);
    put(project, 'ok/a');
    put(project, 'ok/b');
    const r = traverseProject(project, { limits: { maxEntriesPerDir: 10 } });
    expect(r.stats.examined).toBe(4 + 3 * 11 + 2);
    expect(r.diagnostics.filter((d) => d.code === 'LIMIT_DIR_ENTRIES').map((d) => d.path)).toEqual(['o1', 'o2', 'o3']);
    expect(paths(r)).toEqual(['ok', 'ok/a', 'ok/b', 'o1', 'o2', 'o3'].sort());
  });
});

describe('F-03 device boundary', () => {
  // A seam shows that a changed `dev` is acted on; it does not prove the behaviour on every real mount.
  const dirIdent = (dev: bigint, ino: bigint): Ident => ({ isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, dev, ino });

  it('a directory whose dev changes while it is listed (same inode) is DIR_CHANGED', () => {
    const { project } = sandbox();
    put(project, 'victim/inside.ts');
    const probe = probedFs({ lstat: (p, real, calls) => (p.endsWith('/victim') && (calls.get(p) ?? 0) >= 2 ? dirIdent(real.dev + 1n, real.ino) : real) });
    const r = traverseProject(project, { fs: probe.fs });
    expect(r.diagnostics.find((d) => d.code === 'DIR_CHANGED')?.path).toBe('victim');
    expect(paths(r)).not.toContain('victim/inside.ts');
    expect(r.completeness).toBe('PARTIAL');
  });

  it('the project root whose dev changes while it is listed is DIR_CHANGED', () => {
    const { project } = sandbox();
    put(project, 'a.ts');
    let statCalls = 0;
    const base = probedFs();
    const fs: TraversalFs = {
      ...base.fs,
      stat: (p) => {
        const real = lstatSync(p, { bigint: true });
        return ++statCalls >= 2 ? dirIdent(real.dev + 1n, real.ino) : real;
      },
    };
    const r = traverseProject(project, { fs });
    expect(codes(r)).toContain('DIR_CHANGED');
    expect(r.entries).toEqual([]);
  });

  it('a directory on another dev is listed as an entry but never opened', () => {
    const { project } = sandbox();
    put(project, 'mnt/inside.ts');
    const probe = probedFs({ lstat: (p, real) => (p.endsWith('/mnt') ? dirIdent(real.dev + 1n, real.ino) : real) });
    const r = traverseProject(project, { fs: probe.fs });
    expect(paths(r)).toEqual(['mnt']);
    expect(probe.opened).toEqual([project]);
  });
});

describe('F-02 bounded retained path text (maxPathBytes)', () => {
  function fixture(): string {
    const { project } = sandbox();
    for (const n of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) put(project, n);
    return project;
  }

  it('is measured in UTF-8 bytes of the kept paths and reported in stats', () => {
    const { project } = sandbox();
    put(project, 'é.ts'); // 5 bytes, 4 characters
    put(project, 'dir/ab');
    const r = traverseProject(project);
    expect(r.stats.pathBytes).toBe(Buffer.byteLength('dir') + Buffer.byteLength('dir/ab') + Buffer.byteLength('é.ts'));
    expect(r.stats.pathBytes).toBe(r.entries.reduce((n, e) => n + Buffer.byteLength(e.path), 0));
  });

  it('exactly at the limit is COMPLETE, one byte below is PARTIAL with LIMIT_PATH_BYTES and the walk stops', () => {
    const project = fixture(); // 4 paths of 4 bytes
    const exact = traverseProject(project, { limits: { maxPathBytes: 16 } });
    expect(exact.completeness).toBe('COMPLETE');
    expect(exact.stats.pathBytes).toBe(16);
    const below = traverseProject(project, { limits: { maxPathBytes: 15 } });
    expect(below.completeness).toBe('PARTIAL');
    expect(codes(below)).toContain('LIMIT_PATH_BYTES');
    expect(paths(below)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(below.stats.pathBytes).toBe(12);
  });

  it('a path-byte cut is a deterministic prefix: reproducible stays true and a repeat is identical', () => {
    const project = fixture();
    const one = traverseProject(project, { limits: { maxPathBytes: 9 } });
    expect(one.reproducible).toBe(true);
    expect(traverseProject(project, { limits: { maxPathBytes: 9 } })).toEqual(one);
    expect(paths(one)).toEqual(['a.ts', 'b.ts']);
  });

  it('long paths hit the boundary before maxEntries would, and the default boundary is finite', () => {
    const { project } = sandbox();
    const long = 'x'.repeat(200);
    for (let i = 0; i < 50; i++) put(project, `${String(i).padStart(2, '0')}${long}`);
    const r = traverseProject(project, { limits: { maxPathBytes: 2_000 } });
    expect(r.entries.length).toBeLessThan(50);
    expect(r.stats.pathBytes).toBeLessThanOrEqual(2_000);
    expect(codes(r)).toContain('LIMIT_PATH_BYTES');
    expect(DEFAULT_TRAVERSAL_LIMITS.maxPathBytes).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_TRAVERSAL_LIMITS.maxPathBytes)).toBe(true);
  });

  it('rejects a non-positive maxPathBytes', () => {
    const { project } = sandbox();
    expect(() => traverseProject(project, { limits: { maxPathBytes: 0 } })).toThrowError(expect.objectContaining({ code: 'INVALID_LIMITS' }));
  });
});

describe('F-04 an entry whose type cannot be determined is never given a type', () => {
  const failures: [string, Error][] = [
    ['ENOENT', Object.assign(new Error('x'), { code: 'ENOENT' })],
    ['EACCES', Object.assign(new Error('x'), { code: 'EACCES' })],
    ['EPERM', Object.assign(new Error('x'), { code: 'EPERM' })],
    ['EIO', Object.assign(new Error('x'), { code: 'EIO' })],
    ['ENOTDIR', Object.assign(new Error('x'), { code: 'ENOTDIR' })],
    ['EWEIRD', Object.assign(new Error('x'), { code: 'EWEIRD' })],
  ];
  for (const [code, err] of failures) {
    it(`DT_UNKNOWN + lstat ${code}: ENTRY_UNCLASSIFIED, PARTIAL, not reproducible, the cause is kept, no entry`, () => {
      const { project } = sandbox();
      put(project, 'ghost');
      put(project, 'fine');
      const probe = probedFs({
        unknownType: true,
        lstat: (p, real) => {
          if (p.endsWith('/ghost')) throw err;
          return real;
        },
      });
      const r = traverseProject(project, { fs: probe.fs });
      expect(r.completeness).toBe('PARTIAL');
      expect(r.reproducible).toBe(false);
      expect(paths(r)).toEqual(['fine']);
      const d = r.diagnostics.find((x) => x.code === 'ENTRY_UNCLASSIFIED');
      expect(d?.path).toBe('ghost');
      expect(d?.message).toContain(code);
    });
  }

  it('an error without a code does not leak its message (which may hold an absolute path)', () => {
    const { project } = sandbox();
    put(project, 'ghost');
    const probe = probedFs({
      unknownType: true,
      lstat: (p, real) => {
        if (p.endsWith('/ghost')) throw new Error(`boom at ${p}`);
        return real;
      },
    });
    const r = traverseProject(project, { fs: probe.fs });
    expect(r.completeness).toBe('PARTIAL');
    expect(JSON.stringify(r)).not.toContain(project);
    expect(r.diagnostics.find((x) => x.code === 'ENTRY_UNCLASSIFIED')?.message).toContain('unknown error');
  });
});

describe('F-05 `reproducible` means: same tree + same limits => same result', () => {
  function run(opts: Parameters<typeof traverseProject>[1], setup?: (project: string) => void): TraversalResult {
    const { project } = sandbox();
    put(project, 'a/x');
    put(project, 'b/y');
    setup?.(project);
    return traverseProject(project, opts);
  }
  const eio = (p: string): string | undefined => (p.endsWith('/a') ? 'EIO' : undefined);

  it('a complete walk is reproducible', () => {
    const r = run({});
    expect([r.completeness, r.reproducible]).toEqual(['COMPLETE', true]);
  });

  it.each([
    ['maxDepth', { limits: { maxDepth: 1 } }],
    ['maxEntries', { limits: { maxEntries: 3 } }],
    ['maxEntriesPerDir', { limits: { maxEntriesPerDir: 1 } }],
    ['maxPathBytes', { limits: { maxPathBytes: 3 } }],
  ] as const)('a deterministic %s cut is PARTIAL and still reproducible', (_n, opts) => {
    const r = run(opts);
    expect(r.completeness).toBe('PARTIAL');
    expect(r.reproducible).toBe(true);
  });

  it('an unreadable directory (EACCES) on an unchanged tree is PARTIAL and reproducible', () => {
    const r = run({ fs: probedFs({ opendirError: (p) => (p.endsWith('/a') ? 'EACCES' : undefined) }).fs });
    expect(codes(r)).toContain('DIR_UNREADABLE');
    expect(r.reproducible).toBe(true);
  });

  it.each([
    ['DIR_ERROR (EIO on open)', { opendirError: eio }, 'DIR_ERROR'],
    ['DIR_ERROR (EIO on read)', { readError: (p: string, i: number) => (p.endsWith('/a') && i === 0 ? 'EIO' : undefined) }, 'DIR_ERROR'],
    ['DIR_VANISHED (ENOENT on open)', { opendirError: (p: string) => (p.endsWith('/a') ? 'ENOENT' : undefined) }, 'DIR_VANISHED'],
    [
      'DIR_CHANGED',
      { lstat: (p: string, real: Ident, calls: Map<string, number>) => (p.endsWith('/a') && (calls.get(p) ?? 0) >= 2 ? { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, dev: real.dev, ino: real.ino + 1n } : real) },
      'DIR_CHANGED',
    ],
  ] as const)('%s is not reproducible', (_n, seam, code) => {
    const r = run({ fs: probedFs(seam as never).fs });
    expect(codes(r)).toContain(code);
    expect(r.completeness).toBe('PARTIAL');
    expect(r.reproducible).toBe(false);
  });

  it('the time budget is not reproducible (and an unclassifiable entry, see F-04)', () => {
    let t = 0;
    const r = run({ limits: { deadlineMs: 1 }, now: () => t++ });
    expect(r.reproducible).toBe(false);
  });

  it('a walk without any unstable diagnostic is reproducible even with scope-policy diagnostics', () => {
    const r = run({}, (project) => {
      mkdirSync(join(project, 'node_modules'));
      symlinkSync(join(project, 'a'), join(project, 'l'));
    });
    expect(r.completeness).toBe('COMPLETE');
    expect(r.reproducible).toBe(true);
  });
});

describe('F-07 nested repository is policy, not a resource event', () => {
  it('a nested repository larger than maxEntriesPerDir is NESTED_REPO_SKIPPED and does not make the result PARTIAL', () => {
    const { project } = sandbox();
    mkdirSync(join(project, 'sub/.git'), { recursive: true });
    for (let f = 0; f < 30; f++) put(project, `sub/f${f}`);
    const r = traverseProject(project, { limits: { maxEntriesPerDir: 10 } });
    expect(codes(r)).toEqual(['NESTED_REPO_SKIPPED']);
    expect(r.completeness).toBe('COMPLETE');
    expect(paths(r)).toEqual(['sub']);
  });
});

describe('F-09 root errors fail closed before any listing', () => {
  it('a root that is a file, missing or relative is ROOT_UNSAFE', () => {
    const { base, project } = sandbox();
    put(project, 'file');
    for (const root of [join(project, 'file'), join(base, 'nope'), 'relative/dir']) {
      expect(() => traverseProject(root)).toThrowError(expect.objectContaining({ code: 'ROOT_UNSAFE' }));
    }
  });

  it.skipIf(isRoot)('an unreadable root is ROOT_UNSAFE (not a diagnostic), and nothing is listed', () => {
    const { project } = sandbox();
    put(project, 'a');
    chmodSync(project, 0o000);
    const probe = probedFs();
    try {
      expect(() => traverseProject(project, { fs: probe.fs })).toThrowError(expect.objectContaining({ code: 'ROOT_UNSAFE' }));
    } finally {
      chmodSync(project, 0o755);
    }
    expect(probe.opened).toEqual([]);
  });
});

describe('F-10 unrepresentable names: a reason class, never the name', () => {
  it('names the class and the parent, not the bytes', () => {
    const { project } = sandbox();
    put(project, 'sub/ok.ts');
    put(project, 'new\nline.ts');
    writeFileSync(Buffer.concat([Buffer.from(join(project, 'sub') + '/secret-'), Buffer.from([0xff, 0xfe]), Buffer.from('.ts')]), 'x');
    const r = traverseProject(project);
    const list = r.diagnostics.filter((d) => d.code === 'NAME_UNREPRESENTABLE');
    expect(list.map((d) => d.path).sort()).toEqual(['.', 'sub']);
    expect(list.find((d) => d.path === '.')?.message).toContain('control character');
    expect(list.find((d) => d.path === 'sub')?.message).toContain('U+FFFD');
    const text = JSON.stringify(r.diagnostics);
    expect(text).not.toContain('secret-');
    expect(text).not.toContain('line.ts');
    expect(text).not.toContain('\ufffd');
  });
});
