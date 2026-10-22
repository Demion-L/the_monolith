import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, existsSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  resolveMonolithRoot,
  resolveMonolithRootValue,
  normalizeMonolithRoot,
  assertContainedFile,
  RootContainmentError,
  type RootErrorCode,
} from './index.js';
import { runMissionStart, runMissionList } from '../coordinatorium/cli.js';
import { collect } from '../brief/collect.js';
import { runValidate } from '../validate/index.js';
import { scaffoldInstance, planScaffoldConflicts } from '../init/scaffold.js';
import { createInitialState } from '../coordinatorium/types.js';
import type { ProjectConfig } from '../init/types.js';

// Every fixture lives in its own mkdtemp sandbox: <sandbox>/project (the
// project) and <sandbox>/outside (the "other project" an attacker targets).
const sandboxes: string[] = [];

function sandbox(): { project: string; outside: string } {
  const base = mkdtempSync(join(tmpdir(), 'monolith-sec001a-'));
  sandboxes.push(base);
  const project = join(base, 'project');
  const outside = join(base, 'outside');
  mkdirSync(project);
  mkdirSync(outside);
  return { project, outside };
}

function writeConfig(project: string, cfg: unknown): void {
  writeFileSync(join(project, 'monolith.config.json'), JSON.stringify(cfg), 'utf8');
}

function codeOf(fn: () => unknown): RootErrorCode | 'NO_THROW' {
  try {
    fn();
    return 'NO_THROW';
  } catch (err) {
    if (err instanceof RootContainmentError) return err.code;
    throw err;
  }
}

async function asyncCodeOf(fn: () => Promise<unknown>): Promise<RootErrorCode | 'NO_THROW'> {
  try {
    await fn();
    return 'NO_THROW';
  } catch (err) {
    if (err instanceof RootContainmentError) return err.code;
    throw err;
  }
}

function snapshotTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      out.push(full);
      if (e.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out.sort();
}

afterEach(() => {
  vi.restoreAllMocks();
  while (sandboxes.length > 0) {
    const d = sandboxes.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('normalizeMonolithRoot — lexical policy', () => {
  // Threat: config silently relocates the instance, or "default" masks a typo.
  it.each([
    ['.monolith', '.monolith'],
    ['.custom/monolith', '.custom/monolith'],
    ['./.monolith/', '.monolith'],
    ['a//b/./c', 'a/b/c'],
  ])('accepts %s → %s', (input, expected) => {
    expect(normalizeMonolithRoot(input)).toBe(expected);
  });

  // Threat: type confusion → String(value) / join() coercion into a surprising path.
  it.each([[''], [null], [undefined], [42], [true], [['x']], [{ a: 1 }]])('rejects non-string / empty %j', (v) => {
    expect(['ROOT_EMPTY', 'ROOT_INVALID_TYPE']).toContain(codeOf(() => normalizeMonolithRoot(v)));
  });

  // Threat: absolute path ignores projectRoot entirely (resolve() semantics) or is joined unpredictably.
  it.each([['/etc'], ['/tmp/x/.monolith'], ['C:\\evil'], ['\\\\srv\\share'], ['c:evil']])('rejects absolute %s', (v) => {
    expect(codeOf(() => normalizeMonolithRoot(v))).toBe('ROOT_ABSOLUTE');
  });

  // Threat: path normalization bypass — lexical vs kernel resolution diverge through symlinks.
  it.each([['..'], ['../x'], ['a/../../x'], ['a/../b'], ['a\\..\\..\\x'], ['.monolith/..']])('rejects traversal %s', (v) => {
    expect(codeOf(() => normalizeMonolithRoot(v))).toBe('ROOT_TRAVERSAL');
  });

  // Threat: instance files (state.json, lock) scattered directly into the project root.
  it.each([['.'], ['./'], ['.//.']])('rejects root == projectRoot (%s)', (v) => {
    expect(codeOf(() => normalizeMonolithRoot(v))).toBe('ROOT_IS_PROJECT_ROOT');
  });

  it('rejects NUL bytes', () => {
    expect(codeOf(() => normalizeMonolithRoot('a\0b'))).toBe('ROOT_INVALID_TYPE');
  });
});

describe('resolveMonolithRoot — config + realpath containment', () => {
  // Threat: regression of the documented default.
  it('defaults to .monolith when config is absent or key is absent', () => {
    const { project } = sandbox();
    expect(resolveMonolithRoot(project).monolithRoot).toBe('.monolith');
    writeConfig(project, { project: { name: 'x' } });
    const r = resolveMonolithRoot(project);
    expect(r.monolithRoot).toBe('.monolith');
    expect(r.source).toBe('default');
  });

  // Threat: valid nested roots must keep working (no over-blocking).
  it('accepts a custom nested root that does not exist yet', () => {
    const { project } = sandbox();
    writeConfig(project, { monolithRoot: '.custom/monolith' });
    const r = resolveMonolithRoot(project);
    expect(r.monolithRoot).toBe('.custom/monolith');
    expect(r.source).toBe('config');
    expect(existsSync(join(project, '.custom'))).toBe(false); // resolver never creates anything
  });

  // Threat: explicit-but-invalid value silently treated as default.
  it.each([[''], [null], [5], [['a']], [{}]])('fails closed on configured %j', (v) => {
    const { project } = sandbox();
    writeConfig(project, { monolithRoot: v });
    expect(codeOf(() => resolveMonolithRoot(project))).not.toBe('NO_THROW');
  });

  // Threat: symlinked root directory pointing at another project's tree.
  it('rejects a monolithRoot that is a symlink to an outside directory', () => {
    const { project, outside } = sandbox();
    symlinkSync(outside, join(project, '.monolith'));
    expect(codeOf(() => resolveMonolithRoot(project))).toBe('ROOT_SYMLINK_ESCAPE');
  });

  // Threat: not-yet-created root whose nearest existing ancestor escapes.
  it('rejects a nonexistent nested root whose ancestor is a symlink outside', () => {
    const { project, outside } = sandbox();
    symlinkSync(outside, join(project, 'link'));
    writeConfig(project, { monolithRoot: 'link/deep/new/root' });
    expect(codeOf(() => resolveMonolithRoot(project))).toBe('ROOT_SYMLINK_ESCAPE');
  });

  // Threat: over-blocking — symlinks that stay inside the project are legitimate.
  it('allows a symlink whose target stays inside the project', () => {
    const { project } = sandbox();
    mkdirSync(join(project, 'real'));
    symlinkSync(join(project, 'real'), join(project, 'alias'));
    writeConfig(project, { monolithRoot: 'alias/monolith' });
    expect(resolveMonolithRoot(project).monolithRoot).toBe('alias/monolith');
  });

  // Threat: mkdir -p / write through a dangling link creates the target outside.
  it('rejects a dangling symlink root', () => {
    const { project, outside } = sandbox();
    symlinkSync(join(outside, 'does-not-exist'), join(project, '.monolith'));
    expect(codeOf(() => resolveMonolithRoot(project))).toBe('ROOT_UNRESOLVABLE');
  });

  // Threat: ELOOP crash / hang / misclassification as "missing".
  it('rejects a symlink cycle', () => {
    const { project } = sandbox();
    symlinkSync(join(project, 'b'), join(project, 'a'));
    symlinkSync(join(project, 'a'), join(project, 'b'));
    writeConfig(project, { monolithRoot: 'a/monolith' });
    expect(codeOf(() => resolveMonolithRoot(project))).toBe('ROOT_UNRESOLVABLE');
  });

  // Threat: string-prefix containment (project vs project-evil siblings).
  it('does not confuse a sibling directory sharing the project name prefix', () => {
    const { project } = sandbox();
    const sibling = `${project}-evil`;
    mkdirSync(sibling);
    sandboxes.push(sibling);
    symlinkSync(sibling, join(project, '.monolith'));
    expect(codeOf(() => resolveMonolithRoot(project))).toBe('ROOT_SYMLINK_ESCAPE');
  });

  // Threat: corrupted config must not become an escape hatch (default is inside the project).
  it('falls back to the in-project default on unreadable config', () => {
    const { project } = sandbox();
    writeFileSync(join(project, 'monolith.config.json'), '{ nope', 'utf8');
    expect(resolveMonolithRoot(project).monolithRoot).toBe('.monolith');
  });
});

describe('assertContainedFile — fixed files below the root', () => {
  // Threat: symlinked state.json exposes/mutates an outside file.
  it('rejects state.json symlinked outside, and a symlinked intermediate directory', () => {
    const { project, outside } = sandbox();
    mkdirSync(join(project, '.monolith'));
    writeFileSync(join(outside, 'state.json'), '{}');
    symlinkSync(join(outside, 'state.json'), join(project, '.monolith', 'state.json'));
    const root = resolveMonolithRoot(project);
    expect(codeOf(() => assertContainedFile(root, 'state.json'))).toBe('ROOT_SYMLINK_ESCAPE');

    symlinkSync(outside, join(project, '.monolith', 'memory'));
    expect(codeOf(() => assertContainedFile(root, 'memory/working/active.md'))).toBe('ROOT_SYMLINK_ESCAPE');
  });

  it('accepts missing and regular files', () => {
    const { project } = sandbox();
    mkdirSync(join(project, '.monolith'));
    writeFileSync(join(project, '.monolith', 'state.json'), '{}');
    const root = resolveMonolithRoot(project);
    expect(codeOf(() => assertContainedFile(root, 'state.json'))).toBe('NO_THROW');
    expect(codeOf(() => assertContainedFile(root, 'memory/working/active.md'))).toBe('NO_THROW');
  });
});

describe('consumers — one policy, no external side effects', () => {
  function silence(): void {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  }

  // Threat: invalid root creates directories / state outside the project (write path).
  it.each([
    ['relative traversal', '../outside/.monolith', 'ROOT_TRAVERSAL'],
    ['absolute', '__OUTSIDE__', 'ROOT_ABSOLUTE'],
    ['empty', '', 'ROOT_EMPTY'],
    ['null', null, 'ROOT_INVALID_TYPE'],
  ])('mission start refuses %s root and touches nothing outside', async (_n, value, code) => {
    silence();
    const { project, outside } = sandbox();
    const v = value === '__OUTSIDE__' ? join(outside, 'abs') : value;
    writeConfig(project, { monolithRoot: v });
    const before = snapshotTree(outside);
    const got = await asyncCodeOf(() => runMissionStart(['--title', 't', '--system', 's'], project));
    expect(got).toBe(code);
    expect(snapshotTree(outside)).toEqual(before);
    expect(existsSync(join(project, '.monolith'))).toBe(false);
  });

  // Threat: cross-project mutation — a valid foreign state.json is rewritten via a symlinked root.
  it('mission start does not modify a valid foreign state.json reachable via symlinked root', async () => {
    silence();
    const { project, outside } = sandbox();
    const foreign = JSON.stringify(createInitialState());
    writeFileSync(join(outside, 'state.json'), foreign);
    symlinkSync(outside, join(project, '.monolith'));
    const got = await asyncCodeOf(() => runMissionStart(['--title', 't', '--system', 's'], project));
    expect(got).toBe('ROOT_SYMLINK_ESCAPE');
    expect(readFileSync(join(outside, 'state.json'), 'utf8')).toBe(foreign);
    expect(existsSync(join(outside, 'state.json.lock'))).toBe(false);
  });

  // Threat: symlinked state.json file (root dir itself is fine) leaks/mutates outside state.
  it('mission start/list refuse a state.json symlinked outside; foreign file unchanged', async () => {
    silence();
    const { project, outside } = sandbox();
    const foreign = JSON.stringify(createInitialState());
    writeFileSync(join(outside, 'state.json'), foreign);
    mkdirSync(join(project, '.monolith'));
    symlinkSync(join(outside, 'state.json'), join(project, '.monolith', 'state.json'));
    expect(await asyncCodeOf(() => runMissionStart(['--title', 't', '--system', 's'], project))).toBe('ROOT_SYMLINK_ESCAPE');
    expect(await asyncCodeOf(() => runMissionList([], project))).toBe('ROOT_SYMLINK_ESCAPE');
    expect(readFileSync(join(outside, 'state.json'), 'utf8')).toBe(foreign);
  });

  // Threat: a pre-planted lock symlink steering lock I/O elsewhere.
  it('mission start refuses a state.json.lock symlinked outside', async () => {
    silence();
    const { project, outside } = sandbox();
    mkdirSync(join(project, '.monolith'));
    symlinkSync(join(outside, 'lock-target'), join(project, '.monolith', 'state.json.lock'));
    expect(await asyncCodeOf(() => runMissionStart(['--title', 't', '--system', 's'], project))).toBe('ROOT_UNRESOLVABLE');
    expect(existsSync(join(outside, 'lock-target'))).toBe(false);
  });

  // Threat: brief presents external content as project context (read path).
  it('brief throws on a symlinked/invalid root and never reads the outside tree', async () => {
    const { project, outside } = sandbox();
    mkdirSync(join(outside, 'memory/working'), { recursive: true });
    writeFileSync(join(outside, 'memory/working/active.md'), '## Current Story\n\nSECRET-OUTSIDE\n');
    symlinkSync(outside, join(project, '.monolith'));
    await expect(collect(project)).rejects.toMatchObject({ code: 'ROOT_SYMLINK_ESCAPE' });
    writeConfig(project, { monolithRoot: '../outside' });
    await expect(collect(project)).rejects.toMatchObject({ code: 'ROOT_TRAVERSAL' });
  });

  // Threat: active.md / state.json symlinks individually escape while the root is fine.
  it('brief reports PATH_OUTSIDE_PROJECT for symlinked active.md and state.json, without leaking content', async () => {
    const { project, outside } = sandbox();
    writeFileSync(join(outside, 'active.md'), '## Current Story\n\nSECRET-OUTSIDE\n');
    writeFileSync(join(outside, 'state.json'), JSON.stringify(createInitialState()));
    mkdirSync(join(project, '.monolith/memory/working'), { recursive: true });
    symlinkSync(join(outside, 'active.md'), join(project, '.monolith/memory/working/active.md'));
    symlinkSync(join(outside, 'state.json'), join(project, '.monolith/state.json'));
    const model = await collect(project);
    const escapes = model.diagnostics.filter((d) => d.code === 'PATH_OUTSIDE_PROJECT');
    expect(escapes).toHaveLength(2);
    expect(escapes.every((d) => d.severity === 'error')).toBe(true);
    expect(model.story.excerpt).toBeNull();
    expect(model.stateKeeper.status).toBe('unreadable');
    expect(JSON.stringify(model)).not.toContain('SECRET-OUTSIDE');
  });

  // Threat: read/write disagree on the root (mission uses resolve(), brief uses join()).
  it('read/write parity: mission start then brief see the same state for a nested root', async () => {
    silence();
    const { project } = sandbox();
    writeConfig(project, { monolithRoot: '.custom/monolith' });
    await runMissionStart(['--title', 'Parity', '--system', 'core'], project);
    expect(existsSync(join(project, '.custom/monolith/state.json'))).toBe(true);
    const model = await collect(project);
    expect(model.identity.monolithRoot).toBe('.custom/monolith');
    expect(model.stateKeeper.status).toBe('ok');
    expect(model.missions.active.map((m) => m.title)).toEqual(['Parity']);
  });

  // Threat: State Keeper v1/v2 regression via the containment guard.
  it('still reads schemaVersion 1 and 2 state through the guarded paths', async () => {
    const { project } = sandbox();
    mkdirSync(join(project, '.monolith'));
    const v2 = createInitialState();
    writeFileSync(join(project, '.monolith/state.json'), JSON.stringify(v2));
    expect((await collect(project)).stateKeeper.schemaVersionOnDisk).toBe(2);
    const v1 = { schemaVersion: 1, revision: 0, strategic: { systems: {} }, tactical: { missions: {} } };
    writeFileSync(join(project, '.monolith/state.json'), JSON.stringify(v1));
    const m = await collect(project);
    expect(m.stateKeeper.status).toBe('ok');
    expect(m.stateKeeper.schemaVersionOnDisk).toBe(1);
  });

  // Threat: validate keeps using join() on an unvalidated root.
  it('validate fails closed (exit 1) on an escaping root and does not report PASS', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const { project } = sandbox();
    writeConfig(project, { monolithRoot: '../outside' });
    writeFileSync(join(project, 'project.definition.mjs'), 'export const PROJECT_DEFINITION = {};\n');
    await expect(runValidate({ targetDir: project })).rejects.toThrow('exit:1');
    const out = lines.join('\n');
    expect(out).toContain('ROOT_TRAVERSAL');
    expect(out).toContain('Result: FAIL');
  });

  // Threat: programmatic scaffold API writes outside the project (bypasses CLI init, which hardcodes the default).
  describe('scaffold API', () => {
    const base: ProjectConfig = {
      projectName: 'x',
      language: 'typescript',
      packageManager: 'pnpm',
      aiTool: 'claude',
      finalizationProtocol: 'finalize-story',
      protocols: ['finalize-story'],
      monolithRoot: '.monolith',
    };

    it('rejects escaping roots before any write', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const { project, outside } = sandbox();
      const before = snapshotTree(outside);
      for (const bad of ['../outside/x', join(outside, 'abs'), '', '.']) {
        const cfg = { ...base, monolithRoot: bad };
        expect(codeOf(() => planScaffoldConflicts(project, cfg))).not.toBe('NO_THROW');
        expect(await asyncCodeOf(() => scaffoldInstance(project, cfg))).not.toBe('NO_THROW');
      }
      expect(snapshotTree(outside)).toEqual(before);
      expect(readdirSync(project)).toEqual([]);
    });

    it('rejects a symlinked root directory', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const { project, outside } = sandbox();
      symlinkSync(outside, join(project, '.monolith'));
      expect(await asyncCodeOf(() => scaffoldInstance(project, base))).toBe('ROOT_SYMLINK_ESCAPE');
      expect(readdirSync(outside)).toEqual([]);
    });

    // Threat: CLI init compatibility — default init output passes the new validate/brief.
    it('default scaffold remains valid for resolveMonolithRootValue, brief and nested roots', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const { project } = sandbox();
      await scaffoldInstance(project, base);
      expect(resolveMonolithRoot(project).monolithRoot).toBe('.monolith');
      expect((await collect(project)).monolithInitialized).toBe(true);
      const nested = sandbox().project;
      await scaffoldInstance(nested, { ...base, monolithRoot: '.custom/monolith' });
      expect(existsSync(join(nested, '.custom/monolith/memory'))).toBe(true);
      expect(resolveMonolithRootValue(nested, '.custom/monolith').rootAbs).toBe(join(nested, '.custom/monolith'));
    });
  });
});
