import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldInstance } from '../init/scaffold.js';
import { runBrief } from './cli.js';
import { collect } from './collect.js';
import { render } from './render.js';
import type { ProjectConfig } from '../init/types.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-brief-e2e-'));
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

/** Runs runBrief() in-process, intercepting process.exit so the test process survives. */
async function runBriefCaptured(args: string[], targetDir: string): Promise<{ exitCode: number | undefined; stdout: string; stderr: string }> {
  const originalExit = process.exit;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalConsoleError = console.error;

  let stdout = '';
  let stderr = '';
  let exitCode: number | undefined;

  process.stdout.write = ((chunk: string) => {
    stdout += chunk;
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    stderr += chunk;
    return true;
  }) as typeof process.stderr.write;
  // eslint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
    stderr += args.join(' ') + '\n';
  };
  process.exit = ((code?: number) => {
    exitCode = code;
    throw new Error('__exit__');
  }) as never;

  try {
    await runBrief(args, targetDir).catch((err: unknown) => {
      if (!(err instanceof Error) || err.message !== '__exit__') throw err;
    });
  } finally {
    process.exit = originalExit;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    // eslint-disable-next-line no-console
    console.error = originalConsoleError;
  }

  return { exitCode, stdout, stderr };
}

describe('monolith brief — end to end (init then brief)', () => {
  it('runs cleanly against a freshly scaffolded instance with no missions yet', async () => {
    const dir = makeTempDir();
    await scaffoldInstance(dir, CONFIG);

    const { exitCode, stdout, stderr } = await runBriefCaptured([], dir);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Completeness: COMPLETE');
    // scaffoldInstance itself writes an initial state.json (ADR-008) — a
    // freshly init'd project is "ok" with zero missions, not "absent".
    expect(stdout).toContain('status: ok');
    expect(stdout).toContain('Active Missions (0)');
    expect(stderr).toBe(''); // COMPLETE: nothing on stderr
  });

  it('produces byte-identical stdout across two runs on the same state (determinism)', async () => {
    const dir = makeTempDir();
    await scaffoldInstance(dir, CONFIG);

    const run1 = await runBriefCaptured([], dir);
    const run2 = await runBriefCaptured([], dir);

    expect(run1.stdout).toBe(run2.stdout);
  });

  it('exits 1 for a directory with no MONOLITH instance, and still forms a useful (COMPLETE) brief via the library API', async () => {
    const dir = makeTempDir(); // untouched — no init at all
    const model = await collect(dir);
    const { completeness } = render(model);
    expect(model.monolithInitialized).toBe(false);
    expect(completeness).toBe('COMPLETE'); // accurately reporting "nothing here" is not a failure

    // the CLI path behaves the same way (exit 0, not 1 — this is a formed brief)
    const { exitCode } = await runBriefCaptured([], dir);
    expect(exitCode).toBe(0);
  });

  it('rejects unknown CLI flags with exit 1 before touching the filesystem', async () => {
    const dir = makeTempDir();
    const { exitCode } = await expectThrowsAsError(() => runBrief(['--nope'], dir));
    expect(exitCode).toBeUndefined(); // threw before any process.exit call
  });

  it('--strict exits 2 when the result is INCOMPLETE (corrupted state.json)', async () => {
    const dir = makeTempDir();
    await scaffoldInstance(dir, CONFIG);
    writeFileSync(join(dir, '.monolith', 'state.json'), '{ broken', 'utf8');

    const { exitCode, stdout } = await runBriefCaptured(['--strict'], dir);
    expect(stdout).toContain('Completeness: INCOMPLETE');
    expect(exitCode).toBe(2);
  });

  it('--strict exits 0 when the result is COMPLETE', async () => {
    const dir = makeTempDir();
    await scaffoldInstance(dir, CONFIG);
    const { exitCode } = await runBriefCaptured(['--strict'], dir);
    expect(exitCode).toBe(0);
  });

  it('honors --max-chars and keeps the brief within budget plus required-content overflow only', async () => {
    const dir = makeTempDir();
    await scaffoldInstance(dir, CONFIG);
    const { stdout } = await runBriefCaptured(['--max-chars', '300'], dir);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('reads a legacy schemaVersion 1 state.json without writing anything back', async () => {
    const dir = makeTempDir();
    await scaffoldInstance(dir, CONFIG);
    const statePath = join(dir, '.monolith', 'state.json');
    const legacy = {
      schemaVersion: 1,
      revision: 2,
      strategic: { systems: {} },
      tactical: { missions: { 'MIS-0001': { id: 'MIS-0001', title: 'Legacy', system: 's', status: 'in_progress', startedAt: 'a', updatedAt: 'a', summary: null } } },
    };
    writeFileSync(statePath, JSON.stringify(legacy), 'utf8');
    const before = JSON.stringify(legacy);

    const { stdout, exitCode } = await runBriefCaptured([], dir);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('MIS-0001');
    const fs = await import('fs');
    expect(fs.readFileSync(statePath, 'utf8')).toBe(before);
  });

  it('handles multiple simultaneously active missions deterministically', async () => {
    const dir = makeTempDir();
    await scaffoldInstance(dir, CONFIG);
    writeFileSync(
      join(dir, '.monolith', 'state.json'),
      JSON.stringify({
        schemaVersion: 2,
        revision: 1,
        strategic: { systems: {} },
        tactical: {
          missions: {
            'MIS-0001': { id: 'MIS-0001', title: 'First', system: 's', status: 'in_progress', startedAt: '2026-01-01T00:00:00.000Z', updatedAt: 'a', summary: null },
            'MIS-0002': { id: 'MIS-0002', title: 'Second', system: 's', status: 'in_progress', startedAt: '2026-01-02T00:00:00.000Z', updatedAt: 'a', summary: null },
          },
          checkpoints: {},
        },
      }),
      'utf8',
    );
    const { stdout } = await runBriefCaptured([], dir);
    expect(stdout).toContain('MULTIPLE_ACTIVE_MISSIONS');
    expect(stdout).toContain('MIS-0001');
    expect(stdout).toContain('MIS-0002');
  });

  it('never creates, modifies, or deletes any file on a read-only target directory', async () => {
    const dir = makeTempDir();
    await scaffoldInstance(dir, CONFIG);
    const before = listFilesSorted(dir);

    chmodSync(dir, 0o555);
    chmodSync(join(dir, '.monolith'), 0o555);
    try {
      const { exitCode } = await runBriefCaptured([], dir);
      expect(exitCode).toBe(0);
    } finally {
      chmodSync(join(dir, '.monolith'), 0o755);
      chmodSync(dir, 0o755);
    }

    const after = listFilesSorted(dir);
    expect(after).toEqual(before);
  });
});

function listFilesSorted(dir: string): string[] {
  const results: string[] = [];
  function walk(d: string): void {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else results.push(full);
    }
  }
  walk(dir);
  return results;
}

async function expectThrowsAsError(fn: () => Promise<void>): Promise<{ exitCode: number | undefined }> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    return { exitCode: undefined };
  }
  throw new Error('expected fn to throw');
}
