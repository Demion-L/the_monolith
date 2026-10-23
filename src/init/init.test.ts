import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldInstance } from './scaffold.js';
import { SafeWriteError } from '../root/index.js';
import { runValidate } from '../validate/index.js';
import type { ProjectConfig } from './types.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-init-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const CONFIG: ProjectConfig = {
  projectName: 'test-project',
  language: 'typescript',
  packageManager: 'pnpm',
  aiTool: 'claude',
  finalizationProtocol: 'finalize-story',
  protocols: ['finalize-story'],
  monolithRoot: '.monolith',
};

describe('scaffoldInstance — Coordinatorium integration', () => {
  it('writes a valid initial state.json for a newly initialized project', async () => {
    const dir = makeTempDir();
    await scaffoldInstance(dir, CONFIG);

    const statePath = join(dir, '.monolith', 'state.json');
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(state).toEqual({
      schemaVersion: 2,
      revision: 0,
      strategic: { systems: {} },
      tactical: { missions: {}, checkpoints: {} },
    });
  });

  it('never overwrites an existing state.json on re-init', async () => {
    const dir = makeTempDir();
    await scaffoldInstance(dir, CONFIG);

    const statePath = join(dir, '.monolith', 'state.json');
    // Deliberately a legacy (schemaVersion: 1) shape here — this test's
    // only claim is "re-init never touches an existing state.json,
    // regardless of its content/shape", which is actually a stronger
    // check with a legacy-shaped fixture than a current one.
    const mutated = {
      schemaVersion: 1,
      revision: 3,
      strategic: { systems: { core: { note: 'reserved for Strategic Coordinatorium — must survive re-init' } } },
      tactical: { missions: { 'MIS-0001': { id: 'MIS-0001', title: 'keep me', system: 's', status: 'in_progress', startedAt: 'a', updatedAt: 'a', summary: null } } },
    };
    writeFileSync(statePath, JSON.stringify(mutated), 'utf8');
    writeFileSync(join(dir, 'AGENTS.md'), 'user-authored', 'utf8');

    // SEC-001B.2 (DEC-B2-03): files are created without overwriting. A second
    // scaffold over an already scaffolded tree is refused instead of silently
    // rewriting every document (it used to), and nothing existing is touched.
    await expect(scaffoldInstance(dir, CONFIG)).rejects.toBeInstanceOf(SafeWriteError); // re-init

    const onDisk = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(onDisk).toEqual(mutated);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('user-authored');
  });

  it('keeps an existing state.json when it is the only thing present (missions recorded before init), and scaffolds the rest', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.monolith'), { recursive: true });
    const statePath = join(dir, '.monolith', 'state.json');
    const recorded = {
      schemaVersion: 2,
      revision: 5,
      strategic: { systems: {} },
      tactical: { missions: { 'MIS-0001': { id: 'MIS-0001', title: 'keep me', system: 's', status: 'in_progress', startedAt: 'a', updatedAt: 'a', summary: null } }, checkpoints: {} },
    };
    writeFileSync(statePath, JSON.stringify(recorded), 'utf8');

    await scaffoldInstance(dir, CONFIG);

    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual(recorded);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(dir, '.monolith', 'adr', '.gitkeep'))).toBe(true);
  });

  it('does not break existing validate behavior on a freshly scaffolded instance', async () => {
    const dir = makeTempDir();
    // scaffoldInstance only writes template content; project.definition.mjs
    // and monolith.config.json live under projectroot/ in the real templates
    // and are copied by scaffoldInstance itself.
    await scaffoldInstance(dir, CONFIG);

    expect(existsSync(join(dir, 'monolith.config.json'))).toBe(true);
    expect(existsSync(join(dir, 'project.definition.mjs'))).toBe(true);

    const exitSpy = { code: undefined as number | undefined };
    const originalExit = process.exit;
    // runValidate calls process.exit directly; intercept rather than let
    // the test process actually exit.
    process.exit = ((code?: number) => {
      exitSpy.code = code;
      throw new Error('__exit__');
    }) as never;

    try {
      await runValidate({ targetDir: dir, quiet: true }).catch((err: unknown) => {
        if (!(err instanceof Error) || err.message !== '__exit__') throw err;
      });
    } finally {
      process.exit = originalExit;
    }

    expect(exitSpy.code).toBe(0);
  });
});
