import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMissionCheckpoint, runMissionCurrent, runMissionEnroll, runMissionFinish, runMissionHandoff } from './cli.js';
import { buildHandoverReport } from '../handover/check.js';
import { scaffoldInstance } from '../init/scaffold.js';

let base: string;
let main: string;
let wtB: string;
let out: string[];
const git = (cwd: string, ...a: string[]): void => void execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, stdio: 'ignore' });

beforeEach(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'enroll-cli-')));
  main = join(base, 'main');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await scaffoldInstance(main, { projectName: 'F', language: 'typescript', packageManager: 'pnpm', aiTool: 'claude', finalizationProtocol: 'finalize-story', protocols: ['finalize-story'], monolithRoot: '.monolith' });
  const cfg = JSON.parse(readFileSync(join(main, 'monolith.config.json'), 'utf8'));
  cfg.execution = { mode: 'managed' };
  writeFileSync(join(main, 'monolith.config.json'), JSON.stringify(cfg));
  git(main, 'add', '.');
  git(main, 'commit', '-qm', 'init');
  wtB = join(base, 'wt-b');
  git(main, 'worktree', 'add', '-q', '-b', 'feature-b', wtB);
  out = [];
  vi.mocked(console.log).mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});

describe('mission enroll / current / handoff (CLI)', () => {
  it('enroll is idempotent and returns CREATED then REUSED (exit 0)', async () => {
    expect(await runMissionEnroll(['--json', '--agent', 'codex'], main)).toBe(0);
    expect(await runMissionEnroll(['--json', '--agent', 'codex'], main)).toBe(0);
    const [a, b] = out.map((l) => JSON.parse(l));
    expect(a).toMatchObject({ status: 'CREATED', missionId: 'MIS-0001' });
    expect(b).toMatchObject({ status: 'REUSED', missionId: 'MIS-0001' });
  });

  it('enroll exits 3 on CONFLICT', async () => {
    await runMissionEnroll(['--story', 'S-1'], main);
    expect(await runMissionEnroll(['--story', 'S-2'], main)).toBe(3);
  });

  it('cross-agent: B cannot checkpoint/finish A\'s mission; handoff then works; history and handover show it', async () => {
    await runMissionEnroll([], main);
    await runMissionEnroll([], wtB);
    await expect(runMissionFinish(['MIS-0001', '--result', 'completed'], wtB)).rejects.toThrow(/owned by another execution context/);
    await expect(runMissionCheckpoint(['MIS-0001', '--summary', 'x'], wtB)).rejects.toThrow(/refused and nothing was changed/);
    out.length = 0;
    await runMissionCurrent([], wtB);
    expect(out.join('\n')).toContain('MIS-0002');
    expect(out.join('\n')).toContain('Other context: MIS-0001');
    expect(out.join('\n')).toContain('UNKNOWN');
    await runMissionHandoff(['MIS-0001', '--reason', 'owner crashed'], wtB);
    await runMissionCheckpoint(['MIS-0001', '--summary', 'continued by B'], wtB);
    const report = buildHandoverReport(wtB);
    expect(report.execution.mode).toBe('managed');
    expect(report.execution.enforcement).toBe('configured-hook-not-found');
    expect(report.execution.activeContexts.map((c) => [c.missionId, c.relation])).toEqual(expect.arrayContaining([['MIS-0001', 'this-worktree'], ['MIS-0002', 'this-worktree']]));
    expect(report.outstanding.issues.map((i) => i.code)).toContain('EXECUTION_ENFORCEMENT_UNCONFIRMED');
  });

  it('handover flags untracked implementation in managed mode: dirty tree and no owned mission', async () => {
    writeFileSync(join(main, 'changed.ts'), 'x');
    const r = buildHandoverReport(main);
    expect(r.execution.untrackedImplementation).toBe(true);
    expect(r.outstanding.issues.map((i) => i.code)).toContain('UNTRACKED_IMPLEMENTATION');
    await runMissionEnroll([], main);
    expect(buildHandoverReport(main).execution.untrackedImplementation).toBe(false);
  });

  it('handoff needs a reason', async () => {
    await runMissionEnroll([], main);
    await expect(runMissionHandoff(['MIS-0001'], wtB)).rejects.toThrow(/Usage/);
  });
});
