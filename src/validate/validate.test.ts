import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, truncateSync, existsSync, readdirSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { runValidate } from './index.js';
import { checkProjectFile, readProjectFile, MAX_PROJECT_FILE_BYTES } from '../root/index.js';
import { scaffoldInstance } from '../init/scaffold.js';
import type { ProjectConfig } from '../init/types.js';

// SEC-002: `monolith validate` must never execute project-controlled code.
// Every fixture is an isolated mkdtemp sandbox: <sandbox>/project and
// <sandbox>/outside. Process-level scenarios (FIFO, exit codes, --quiet) run the
// REAL CLI, compiled once into a temp dir, so a regression that blocks cannot
// hang the vitest worker — the child is killed by a timeout instead.

const REPO = resolve(__dirname, '..', '..');
const TSC = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');
const CHILD_TIMEOUT_MS = 8000;

const sandboxes: string[] = [];
let compiledCli: string;

function sandbox(): { base: string; project: string; outside: string } {
  const base = mkdtempSync(join(tmpdir(), 'monolith-sec002-'));
  sandboxes.push(base);
  const project = join(base, 'project');
  const outside = join(base, 'outside');
  mkdirSync(project);
  mkdirSync(outside);
  return { base, project, outside };
}

const INSTANCE_DIRS = ['memory', 'context', 'protocols', 'skills', 'governance', 'learning', 'tests'];

/** Minimal instance that passes every check except what a test overrides. */
function validProject(definitionSource = 'export const PROJECT_DEFINITION = {};\n') {
  const s = sandbox();
  writeFileSync(join(s.project, 'monolith.config.json'), JSON.stringify({ monolithRoot: '.monolith' }));
  writeFileSync(join(s.project, 'project.definition.mjs'), definitionSource);
  for (const d of INSTANCE_DIRS) mkdirSync(join(s.project, '.monolith', d), { recursive: true });
  return s;
}

function mkfifo(path: string): void {
  execFileSync('mkfifo', [path]);
}

interface CliRun {
  code: number | null;
  stdout: string;
  timedOut: boolean;
}

function runCli(project: string, args: string[] = []): CliRun {
  const r = spawnSync(process.execPath, [compiledCli, 'validate', ...args], {
    cwd: project,
    encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  return { code: r.status, stdout: r.stdout, timedOut: r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' };
}

/** Run `runValidate` in-process with exit/console intercepted. */
async function validateInProcess(project: string, quiet = false): Promise<{ code: number | undefined; out: string }> {
  const lines: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  let code: number | undefined;
  const exit = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c;
    throw new Error('__exit__');
  }) as never);
  try {
    await runValidate({ targetDir: project, quiet });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== '__exit__') throw err;
  } finally {
    log.mockRestore();
    exit.mockRestore();
  }
  return { code, out: lines.join('\n') };
}

beforeAll(() => {
  const outDir = mkdtempSync(join(tmpdir(), 'monolith-sec002-build-'));
  sandboxes.push(outDir);
  execFileSync(process.execPath, [TSC, '-p', join(REPO, 'tsconfig.json'), '--outDir', outDir, '--tsBuildInfoFile', join(outDir, 'tsbuildinfo')], {
    cwd: REPO,
    stdio: 'pipe',
  });
  compiledCli = join(outDir, 'cli', 'index.js');
}, 120_000);

afterAll(() => {
  for (const d of sandboxes) rmSync(d, { recursive: true, force: true });
});

describe('SEC-002: validate is static', () => {
  // T1 — the original PoC: a harmless side-effecting payload must not run.
  it('T1: a harmless payload in project.definition.mjs is not executed', () => {
    const { project, outside } = validProject();
    const marker = join(outside, 'EXECUTED');
    writeFileSync(
      join(project, 'project.definition.mjs'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'x');\nexport const PROJECT_DEFINITION = {};\n`,
    );
    const run = runCli(project);
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  // T2 — top-level await: under the old import() an unsettled TLA killed the process (exit 13) or hung.
  it('T2: a file with a never-settling top-level await is not executed', () => {
    const { project, outside } = validProject();
    const marker = join(outside, 'EXECUTED');
    writeFileSync(
      join(project, 'project.definition.mjs'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'x');\nawait new Promise(() => {});\n`,
    );
    const run = runCli(project);
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  // T3 — syntax is out of scope by design (Option A).
  it('T3: a syntactically invalid .mjs passes the file check only', async () => {
    const { project } = validProject('export const = ;;; {{{\n');
    const r = await validateInProcess(project);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Result: PASS');
  });

  // T4
  it('T4: a missing project.definition.mjs is FAIL', async () => {
    const { project } = validProject();
    rmSync(join(project, 'project.definition.mjs'));
    const r = await validateInProcess(project);
    expect(r.code).toBe(1);
    expect(r.out).toContain('missing project.definition.mjs');
  });

  // T5
  it('T5: a corrupted monolith.config.json is FAIL (invalid JSON, non-object, missing field)', async () => {
    for (const body of ['{ not json', '[]', '{}']) {
      const { project } = validProject();
      writeFileSync(join(project, 'monolith.config.json'), body);
      const r = await validateInProcess(project);
      expect(r.code, body).toBe(1);
      expect(r.out, body).toContain('Configuration');
      expect(r.out, body).toContain('FAIL');
    }
  });

  // T6
  it('T6: a project.definition.mjs symlinked outside the project is FAIL and is never executed', async () => {
    const { project, outside } = validProject();
    const marker = join(outside, 'EXECUTED');
    writeFileSync(join(outside, 'evil.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'x');\n`);
    rmSync(join(project, 'project.definition.mjs'));
    symlinkSync(join(outside, 'evil.mjs'), join(project, 'project.definition.mjs'));
    const r = await validateInProcess(project);
    expect(r.code).toBe(1);
    expect(r.out).toContain('FILE_SYMLINK');
    expect(existsSync(marker)).toBe(false);
  });

  // T7 — SEC-001B.1-R: validate reads under the unified policy; a symlink is refused even when it
  // stays inside the project (dangling or not). Symlinks elsewhere in the project are not inspected.
  it('T7: an internal symlink is refused, dangling or not (FILE_SYMLINK)', async () => {
    const { project } = validProject();
    writeFileSync(join(project, 'real.mjs'), 'export const PROJECT_DEFINITION = {};\n');
    rmSync(join(project, 'project.definition.mjs'));
    symlinkSync(join(project, 'real.mjs'), join(project, 'project.definition.mjs'));
    const live = await validateInProcess(project);
    expect(live.code).toBe(1);
    expect(live.out).toContain('FILE_SYMLINK');

    rmSync(join(project, 'real.mjs'));
    const dangling = await validateInProcess(project);
    expect(dangling.code).toBe(1);
    expect(dangling.out).toContain('FILE_SYMLINK');
  });

  // T8 — a FIFO as the definition: open() on a FIFO without a writer blocks forever unless guarded.
  it('T8: a FIFO as project.definition.mjs does not block the process', () => {
    const { project } = validProject();
    rmSync(join(project, 'project.definition.mjs'));
    mkfifo(join(project, 'project.definition.mjs'));
    const run = runCli(project);
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('FILE_NOT_REGULAR');
  });

  // T9 — the same for the other two root files that validate reads.
  it('T9: a FIFO as monolith.config.json or AGENTS.md does not block the process', () => {
    const cfg = validProject();
    rmSync(join(cfg.project, 'monolith.config.json'));
    mkfifo(join(cfg.project, 'monolith.config.json'));
    const cfgRun = runCli(cfg.project);
    expect(cfgRun.timedOut).toBe(false);
    expect(cfgRun.code).toBe(1);

    const agents = validProject();
    mkfifo(join(agents.project, 'AGENTS.md'));
    const agentsRun = runCli(agents.project);
    expect(agentsRun.timedOut).toBe(false);
    expect(agentsRun.code).toBe(1);
    expect(agentsRun.stdout).toContain('AGENTS.md (FILE_NOT_REGULAR)');
  });

  // T10 — a character device must not be read as a regular file. /dev is used as the "project" so
  // that /dev/zero is genuinely inside the root (an internal device node cannot be created without
  // privileges). Were it read, the 1 MiB cap would still stop it, so assert the specific code.
  it.skipIf(process.platform !== 'linux' || !existsSync('/dev/zero'))('T10: a device node is rejected as not-regular and never read', () => {
    for (const make of [checkProjectFile, readProjectFile]) {
      const r = make('/dev', 'zero');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('FILE_NOT_REGULAR');
    }
  });

  // T11 — size is judged on the open descriptor before any byte is read.
  it('T11: an oversized file is rejected before its content is read; the 1 MiB boundary and empty files behave', async () => {
    const huge = validProject();
    // A 2 GiB sparse file: if validate tried to read it, this test would take memory and time.
    truncateSync(join(huge.project, 'project.definition.mjs'), 2 * 1024 * 1024 * 1024);
    const t0 = Date.now();
    const r = await validateInProcess(huge.project);
    expect(Date.now() - t0).toBeLessThan(CHILD_TIMEOUT_MS);
    expect(r.code).toBe(1);
    expect(r.out).toContain('FILE_TOO_LARGE');

    const edge = validProject();
    truncateSync(join(edge.project, 'project.definition.mjs'), MAX_PROJECT_FILE_BYTES);
    expect((await validateInProcess(edge.project)).code).toBe(0);
    truncateSync(join(edge.project, 'project.definition.mjs'), MAX_PROJECT_FILE_BYTES + 1);
    expect((await validateInProcess(edge.project)).code).toBe(1);

    const empty = validProject('');
    const e = await validateInProcess(empty.project);
    expect(e.code).toBe(1);
    expect(e.out).toContain('FILE_EMPTY');
  });

  // T12 — CLI contract preserved.
  it('T12: --quiet prints nothing on PASS; on FAIL prints failing rows only; exit codes 0/1', () => {
    const ok = validProject();
    const pass = runCli(ok.project, ['--quiet']);
    expect(pass.code).toBe(0);
    expect(pass.stdout).toBe('');

    const bad = validProject();
    rmSync(join(bad.project, 'project.definition.mjs'));
    const fail = runCli(bad.project, ['--quiet']);
    expect(fail.code).toBe(1);
    expect(fail.stdout).toMatch(/^Configuration\s+FAIL\s+missing project\.definition\.mjs\n$/);
  });

  // T13
  it('T13: a freshly scaffolded project passes validate through the real CLI', async () => {
    const { project } = sandbox();
    const config: ProjectConfig = {
      projectName: 'sec002',
      language: 'typescript',
      packageManager: 'pnpm',
      aiTool: 'claude',
      finalizationProtocol: 'finalize-story',
      protocols: ['finalize-story'],
      monolithRoot: '.monolith',
    };
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await scaffoldInstance(project, config);
    vi.restoreAllMocks();
    const run = runCli(project);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Result: PASS');
    expect(runCli(project, ['--quiet'])).toMatchObject({ code: 0, stdout: '' });
  });

  // T14 — diagnostics must state only what was verified (D-1: no PROJECT_DEFINITION export check).
  it('T14: PASS says the .mjs was checked as a file only and claims nothing about syntax, exports or safety', async () => {
    const { project } = validProject('// no exports at all\n');
    const r = await validateInProcess(project);
    expect(r.code).toBe(0); // D-1: a missing PROJECT_DEFINITION export is no longer an error
    expect(r.out).toContain('checked as a file only');
    expect(r.out).toContain('not parsed or executed');
    expect(r.out).not.toMatch(/syntax|PROJECT_DEFINITION|safe|loadable|valid JavaScript/i);
  });

  // T15 — SEC-001A behaviour is unchanged and the boundary also covers the other root files.
  it('T15: SEC-001A regressions — escaping monolithRoot, escaping/non-file root files, no writes', async () => {
    const escaping = validProject();
    writeFileSync(join(escaping.project, 'monolith.config.json'), JSON.stringify({ monolithRoot: '../outside' }));
    const e = await validateInProcess(escaping.project);
    expect(e.code).toBe(1);
    expect(e.out).toContain('ROOT_TRAVERSAL');

    const agents = validProject();
    writeFileSync(join(agents.outside, 'agents.md'), '# {{PROJECT_NAME}}\n');
    symlinkSync(join(agents.outside, 'agents.md'), join(agents.project, 'AGENTS.md'));
    const a = await validateInProcess(agents.project);
    expect(a.code).toBe(1);
    expect(a.out).toContain('AGENTS.md (FILE_SYMLINK)');

    const cfg = validProject();
    writeFileSync(join(cfg.outside, 'cfg.json'), JSON.stringify({ monolithRoot: '.monolith' }));
    rmSync(join(cfg.project, 'monolith.config.json'));
    symlinkSync(join(cfg.outside, 'cfg.json'), join(cfg.project, 'monolith.config.json'));
    const c = await validateInProcess(cfg.project);
    expect(c.code).toBe(1);
    expect(c.out).toContain('FILE_SYMLINK');

    const dir = validProject();
    rmSync(join(dir.project, 'project.definition.mjs'));
    mkdirSync(join(dir.project, 'project.definition.mjs'));
    expect((await validateInProcess(dir.project)).out).toContain('FILE_NOT_REGULAR');

    // validate never creates or changes anything
    const ok = validProject();
    const before = readdirSync(ok.project).sort();
    await validateInProcess(ok.project);
    expect(readdirSync(ok.project).sort()).toEqual(before);
  });

  // T16-T18 — the instance-tree placeholder scan (<monolithRoot>/**) uses the same bounded reader.
  it('T16: a FIFO inside the instance tree does not block validate; Templates FAIL, exit 1', () => {
    const { project } = validProject();
    mkfifo(join(project, '.monolith', 'memory', 'trap'));
    const run = runCli(project);
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('.monolith/memory/trap (FILE_NOT_REGULAR)');
  });

  it('T17: an oversized file inside the instance tree is rejected before its content is read', async () => {
    const { project } = validProject();
    // 2 GiB sparse: reading it would cost memory and time (or throw ERR_STRING_TOO_LONG).
    const huge = join(project, '.monolith', 'memory', 'huge.bin');
    writeFileSync(huge, '');
    truncateSync(huge, 2 * 1024 * 1024 * 1024);
    const t0 = Date.now();
    const r = await validateInProcess(project);
    expect(Date.now() - t0).toBeLessThan(CHILD_TIMEOUT_MS);
    expect(r.code).toBe(1);
    expect(r.out).toContain('.monolith/memory/huge.bin (FILE_TOO_LARGE)');
  });

  it('T18: instance scan still finds placeholders in regular files; a symlink in the instance is reported (FILE_SYMLINK) and never read', async () => {
    const hit = validProject();
    writeFileSync(join(hit.project, '.monolith', 'memory', 'tpl.md'), '# {{PROJECT_NAME}}\n');
    const h = await validateInProcess(hit.project);
    expect(h.code).toBe(1);
    expect(h.out).toContain('unreplaced placeholders');
    expect(h.out).toContain('.monolith/memory/tpl.md');

    const link = validProject();
    writeFileSync(join(link.outside, 'ext.md'), '# {{PROJECT_NAME}}\n');
    symlinkSync(join(link.outside, 'ext.md'), join(link.project, '.monolith', 'memory', 'ext.md'));
    const l = await validateInProcess(link.project);
    expect(l.code).toBe(1);
    expect(l.out).toContain('.monolith/memory/ext.md (FILE_SYMLINK)');
    expect(l.out).not.toContain('unreplaced placeholders');
  });
});
