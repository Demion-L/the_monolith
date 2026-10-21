import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import ts from 'typescript';
import { readState, mutateState, validateState, stateFilePath } from './state-keeper.js';
import { createInitialState } from './types.js';
import { StateCorruptedError, StateSchemaError } from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coordinatorium-state-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Initial state creation
// ---------------------------------------------------------------------------

describe('readState', () => {
  it('returns a fresh initial state when state.json does not exist, without creating it', async () => {
    const dir = makeTempDir();
    const state = await readState(dir);
    expect(state).toEqual(createInitialState());
    expect(readdirSync(dir)).toEqual([]); // no side-effect write
  });

  it('throws StateCorruptedError on malformed JSON and never overwrites it', async () => {
    const dir = makeTempDir();
    writeFileSync(stateFilePath(dir), '{ this is not json', 'utf8');
    await expect(readState(dir)).rejects.toBeInstanceOf(StateCorruptedError);
    // File must be untouched.
    expect(readFileSync(stateFilePath(dir), 'utf8')).toBe('{ this is not json');
  });

  it('throws StateSchemaError on an unsupported schemaVersion', async () => {
    const dir = makeTempDir();
    writeFileSync(stateFilePath(dir), JSON.stringify({ ...createInitialState(), schemaVersion: 99 }), 'utf8');
    await expect(readState(dir)).rejects.toBeInstanceOf(StateSchemaError);
  });
});

describe('validateState', () => {
  it('rejects a non-object root', () => {
    expect(() => validateState(null)).toThrow(StateSchemaError);
    expect(() => validateState([1, 2])).toThrow(StateSchemaError);
  });

  it('rejects a mission with an invalid status', () => {
    const bad = {
      ...createInitialState(),
      tactical: { missions: { 'MIS-0001': { id: 'MIS-0001', title: 't', system: 's', status: 'bogus', startedAt: 'x', updatedAt: 'x', summary: null } } },
    };
    expect(() => validateState(bad)).toThrow(StateSchemaError);
  });

  it('accepts a well-formed state and round-trips it', () => {
    const good = createInitialState();
    expect(validateState(good)).toEqual(good);
  });
});

// ---------------------------------------------------------------------------
// Mutation: atomicity, revisions, preservation
// ---------------------------------------------------------------------------

describe('mutateState', () => {
  it('persists atomically and leaves no temp files behind', async () => {
    const dir = makeTempDir();
    await mutateState(dir, (draft) => {
      draft.tactical.missions['MIS-0001'] = {
        id: 'MIS-0001', title: 'x', system: 'y', status: 'in_progress',
        startedAt: 'a', updatedAt: 'a', summary: null,
      };
    });
    const entries = readdirSync(dir);
    expect(entries).toEqual(['state.json']);
    const onDisk = JSON.parse(readFileSync(stateFilePath(dir), 'utf8'));
    expect(onDisk.tactical.missions['MIS-0001'].title).toBe('x');
  });

  it('increments revision monotonically across successive mutations', async () => {
    const dir = makeTempDir();
    const r1 = await mutateState(dir, () => undefined);
    const r2 = await mutateState(dir, () => undefined);
    const r3 = await mutateState(dir, () => undefined);
    expect([r1.state.revision, r2.state.revision, r3.state.revision]).toEqual([1, 2, 3]);
  });

  it('never writes if the mutator throws', async () => {
    const dir = makeTempDir();
    await mutateState(dir, (draft) => {
      draft.tactical.missions['MIS-0001'] = {
        id: 'MIS-0001', title: 'kept', system: 'y', status: 'in_progress',
        startedAt: 'a', updatedAt: 'a', summary: null,
      };
    });
    await expect(
      mutateState(dir, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const state = await readState(dir);
    expect(state.revision).toBe(1);
    expect(state.tactical.missions['MIS-0001'].title).toBe('kept');
  });

  it('preserves existing state fields it does not touch', async () => {
    const dir = makeTempDir();
    await mutateState(dir, (draft) => {
      draft.strategic.systems['core'] = { note: 'reserved for Strategic Coordinatorium' };
    });
    await mutateState(dir, (draft) => {
      draft.tactical.missions['MIS-0001'] = {
        id: 'MIS-0001', title: 'x', system: 'y', status: 'in_progress',
        startedAt: 'a', updatedAt: 'a', summary: null,
      };
    });
    const state = await readState(dir);
    expect(state.strategic.systems['core']).toEqual({ note: 'reserved for Strategic Coordinatorium' });
    expect(state.revision).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Concurrency — real, independent OS processes. Not mocked.
//
// We transpile the coordinatorium sources (via the `typescript` package,
// already a devDependency) into plain ESM .mjs files once, then spawn N
// separate `node` child processes that each call startMission against the
// SAME state directory at the same time. No in-process faking of locking.
// ---------------------------------------------------------------------------

const COORDINATORIUM_MODULES = ['types', 'errors', 'lock', 'state-keeper', 'mission'];

function transpileCoordinatoriumTo(destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const name of COORDINATORIUM_MODULES) {
    const source = readFileSync(join(__dirname, `${name}.ts`), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: `${name}.ts`,
    });
    let js = outputText;
    for (const mod of COORDINATORIUM_MODULES) {
      js = js.split(`'./${mod}.js'`).join(`'./${mod}.mjs'`).split(`"./${mod}.js"`).join(`"./${mod}.mjs"`);
    }
    writeFileSync(join(destDir, `${name}.mjs`), js, 'utf8');
  }

  const childScript = `
import { startMission } from './mission.mjs';
const [stateDir, idx] = process.argv.slice(2);
const mission = await startMission(stateDir, { title: 'Concurrent mission ' + idx, system: 'concurrency-test' });
process.stdout.write(JSON.stringify(mission));
`;
  writeFileSync(join(destDir, 'start-mission-child.mjs'), childScript, 'utf8');
}

function runChild(moduleDir: string, stateDir: string, idx: number): Promise<{ id: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(moduleDir, 'start-mission-child.mjs'), stateDir, String(idx)]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`child ${idx} exited with ${code}: ${stderr}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        reject(new Error(`child ${idx} produced non-JSON stdout: ${stdout} / stderr: ${stderr}`));
      }
    });
  });
}

describe('concurrency (independent processes)', () => {
  it(
    'loses no updates and produces unique mission IDs under concurrent writers',
    async () => {
      const stateDir = makeTempDir();
      const moduleDir = makeTempDir();
      transpileCoordinatoriumTo(moduleDir);

      const N = 8;
      const missions = await Promise.all(
        Array.from({ length: N }, (_, i) => runChild(moduleDir, stateDir, i)),
      );

      const ids = missions.map((m) => m.id);
      expect(new Set(ids).size).toBe(N); // all unique — no collisions

      const state = await readState(stateDir);
      expect(Object.keys(state.tactical.missions)).toHaveLength(N);
      expect(state.revision).toBe(N); // no lost updates
    },
    30_000,
  );
});
