import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { SafeWriteError } from '../root/index.js';
import { InitConflictError, runInit } from './index.js';
import { planScaffoldConflicts, scaffoldInstance } from './scaffold.js';
import type { ProjectConfig } from './types.js';

// SEC-001B.2 / DEC-B2-03: the confirmed vulnerability — `init` wrote through a
// pre-existing symlink (a dangling one defeated the existsSync preflight) — and
// the rest of the scaffold write policy. Every scenario runs in a temporary
// tree; `outside` must never change.
let base: string;
let project: string;
let outside: string;

const CONFIG: ProjectConfig = {
  projectName: 'p',
  language: 'typescript',
  packageManager: 'pnpm',
  aiTool: 'claude',
  finalizationProtocol: 'finalize-story',
  protocols: ['finalize-story'],
  monolithRoot: '.monolith',
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'monolith-scaffold-'));
  project = join(base, 'project');
  outside = join(base, 'outside');
  mkdirSync(project);
  mkdirSync(outside);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      out.push(relative(dir, full) + (e.isSymbolicLink() ? ' -> link' : ''));
      if (e.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out.sort();
}

async function failure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

describe('a pre-existing symlink at a template target (the confirmed vulnerability)', () => {
  it('dangling CLAUDE.md -> outside/victim: init is refused before anything is written, nothing is created outside', async () => {
    symlinkSync(join(outside, 'victim.txt'), join(project, 'CLAUDE.md'));
    const before = tree(project);
    expect(planScaffoldConflicts(project, CONFIG)).toContain('CLAUDE.md'); // existsSync() said "free" here
    const err = await failure(runInit({ targetDir: project, yes: true }));
    expect(err).toBeInstanceOf(InitConflictError);
    expect(existsSync(join(outside, 'victim.txt'))).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
    expect(tree(project)).toEqual(before); // no half-scaffolded instance
  });

  it('even without the preflight, scaffoldInstance itself refuses (containment inside the API) and creates nothing outside', async () => {
    symlinkSync(join(outside, 'victim.txt'), join(project, 'CLAUDE.md'));
    const err = await failure(scaffoldInstance(project, CONFIG));
    expect(err).toBeInstanceOf(SafeWriteError);
    expect((err as SafeWriteError).code).toBe('WRITE_TARGET_SYMLINK');
    expect(existsSync(join(outside, 'victim.txt'))).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
    expect(lstatSync(join(project, 'CLAUDE.md')).isSymbolicLink()).toBe(true);
    // The failure says that earlier files were published: init is not transactional.
    expect((err as SafeWriteError).message).toMatch(/not transactional/);
  });

  it('a symlink to an existing file outside is not written through either', async () => {
    writeFileSync(join(outside, 'precious'), 'keep me');
    symlinkSync(join(outside, 'precious'), join(project, 'AGENTS.md'));
    expect(planScaffoldConflicts(project, CONFIG)).toContain('AGENTS.md');
    const err = await failure(scaffoldInstance(project, CONFIG));
    expect(err).toBeInstanceOf(SafeWriteError);
    expect(readFileSync(join(outside, 'precious'), 'utf8')).toBe('keep me');
  });

  it('a symlinked state.json is a conflict (only a REGULAR existing state.json is tolerated)', async () => {
    mkdirSync(join(project, '.monolith'));
    symlinkSync(join(outside, 'state.json'), join(project, '.monolith', 'state.json'));
    expect(planScaffoldConflicts(project, CONFIG)).toContain(join('.monolith', 'state.json'));
    const err = await failure(scaffoldInstance(project, CONFIG));
    expect(err).toBeInstanceOf(SafeWriteError);
    expect(existsSync(join(outside, 'state.json'))).toBe(false);
  });
});

describe('symlinks and special files in parent components', () => {
  it('a symlinked directory inside the instance tree pointing outside: refused, outside stays empty', async () => {
    mkdirSync(join(project, '.monolith'));
    symlinkSync(outside, join(project, '.monolith', 'memory'));
    expect(planScaffoldConflicts(project, CONFIG)).toContain(join('.monolith', 'memory'));
    const err = await failure(scaffoldInstance(project, CONFIG));
    expect(err).toBeInstanceOf(SafeWriteError);
    expect((err as SafeWriteError).code).toBe('WRITE_PARENT_SYMLINK');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('a symlinked monolithRoot is refused even when it stays INSIDE the project (W-SYM)', async () => {
    mkdirSync(join(project, 'real'));
    symlinkSync(join(project, 'real'), join(project, '.monolith'));
    expect(planScaffoldConflicts(project, CONFIG).length).toBeGreaterThan(0);
    const err = await failure(runInit({ targetDir: project, yes: true }));
    expect(err).toBeInstanceOf(InitConflictError);
    expect(readdirSync(join(project, 'real'))).toEqual([]);
  });

  it('a regular file where a directory is needed is refused', async () => {
    writeFileSync(join(project, '.monolith'), 'i am a file');
    expect(planScaffoldConflicts(project, CONFIG).length).toBeGreaterThan(0);
    const err = await failure(scaffoldInstance(project, CONFIG));
    expect(err).toBeInstanceOf(SafeWriteError);
    expect((err as SafeWriteError).code).toBe('WRITE_PARENT_NOT_DIRECTORY');
  });
});

describe('FIFOs and special files', () => {
  it('a FIFO at a target is refused without blocking', async () => {
    execFileSync('mkfifo', [join(project, 'AGENTS.md')]);
    expect(planScaffoldConflicts(project, CONFIG)).toContain('AGENTS.md');
    const err = await failure(scaffoldInstance(project, CONFIG));
    expect(err).toBeInstanceOf(SafeWriteError);
    expect((err as SafeWriteError).code).toBe('WRITE_TARGET_NOT_REGULAR');
    expect(lstatSync(join(project, 'AGENTS.md')).isFIFO()).toBe(true);
  });

  it('a FIFO as a .gitkeep is refused', async () => {
    mkdirSync(join(project, '.monolith', 'adr'), { recursive: true });
    execFileSync('mkfifo', [join(project, '.monolith', 'adr', '.gitkeep')]);
    expect(planScaffoldConflicts(project, CONFIG)).toContain(join('.monolith', 'adr', '.gitkeep'));
  });
});

describe('a target that appears after the preflight', () => {
  it('is not overwritten: creation is exclusive and the file keeps its content', async () => {
    expect(planScaffoldConflicts(project, CONFIG)).toEqual([]);
    writeFileSync(join(project, '.gitkeep-probe'), 'x'); // unrelated, to prove the tree is live
    mkdirSync(join(project, '.monolith', 'adr'), { recursive: true });
    writeFileSync(join(project, '.monolith', 'adr', '.gitkeep'), 'user content');
    const err = await failure(scaffoldInstance(project, CONFIG));
    expect(err).toBeInstanceOf(SafeWriteError);
    expect((err as SafeWriteError).code).toBe('WRITE_TARGET_EXISTS');
    expect(readFileSync(join(project, '.monolith', 'adr', '.gitkeep'), 'utf8')).toBe('user content');
  });
});

describe('modes and residue on a successful init', () => {
  it('state.json is 0600, documents follow the umask, no temporary names remain', async () => {
    const old = process.umask(0o022);
    try {
      await scaffoldInstance(project, CONFIG);
    } finally {
      process.umask(old);
    }
    expect(lstatSync(join(project, '.monolith', 'state.json')).mode & 0o777).toBe(0o600);
    expect(lstatSync(join(project, 'CLAUDE.md')).mode & 0o777).toBe(0o644);
    expect(lstatSync(join(project, '.monolith', 'adr', '.gitkeep')).mode & 0o777).toBe(0o644);
    expect(tree(project).filter((n) => /\.tmp\./.test(n))).toEqual([]);
  });

  it('every published file is complete and has a single link', async () => {
    await scaffoldInstance(project, CONFIG);
    const files = tree(project).filter((n) => !lstatSync(join(project, n.replace(' -> link', ''))).isDirectory());
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(lstatSync(join(project, f)).nlink, f).toBe(1);
  });

  it('returns platform findings as data and counts template files as before', async () => {
    const result = await scaffoldInstance(project, CONFIG);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.filesCreated).toBeGreaterThan(20);
  });
});
