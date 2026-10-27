import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  evaluateFreshness,
  extractWorkItemIds,
  parseActiveStoryClaim,
  parseRoadmapActiveStory,
  parseRoadmapStatuses,
  parseStoryIndexStatuses,
  type FreshnessEvidence,
  type GitSignals,
} from './freshness.js';
import { readGitSignals } from './git-signals.js';
import { collect } from './collect.js';
import { render } from './render.js';
import { runBrief } from './cli.js';

// ---------------------------------------------------------------------------
// Pure evaluation — deterministic evidence, no git, no clock
// ---------------------------------------------------------------------------

const STATE_FILES = new Set(['.monolith/memory/working/active.md', '.monolith/context/maps/roadmap-index.md']);
const LAST = { sha: 'a'.repeat(40), date: '2000-01-02T00:00:00+00:00' };

function commit(subject: string, files: string[] = ['src/x.ts']) {
  return { sha: 'b'.repeat(40), date: '2000-01-03T00:00:00+00:00', subject, files };
}

function evidence(overrides: Partial<FreshnessEvidence> = {}): FreshnessEvidence {
  const git: GitSignals = { status: 'ok', lastStateUpdate: LAST, commitsSince: [], truncated: false };
  return {
    git,
    activeStory: { kind: 'none' },
    roadmapActiveStory: null,
    roadmapStatuses: new Map(),
    storyIndexStatuses: new Map(),
    recordedText: 'WIDGET-001 is recorded here',
    stateFiles: STATE_FILES,
    ...overrides,
  };
}

function gitWith(commitsSince: ReturnType<typeof commit>[], truncated = false): GitSignals {
  return { status: 'ok', lastStateUpdate: LAST, commitsSince, truncated };
}

describe('evaluateFreshness', () => {
  it('1. FRESH only with positive evidence: git readable, state located, nothing beyond state files changed since', () => {
    const r = evaluateFreshness(evidence());
    expect(r.status).toBe('FRESH');
    expect(r.reasons.map((x) => x.code)).toEqual(['NO_ACTIVITY_SINCE_STATE_UPDATE']);
    expect(r.activityCount).toBe(0);
  });

  it('1b. FRESH when every later commit names a work item the state documents mention', () => {
    const r = evaluateFreshness(evidence({ git: gitWith([commit('feat(WIDGET-001): add widget')]) }));
    expect(r.status).toBe('FRESH');
    expect(r.reasons[0].code).toBe('ACTIVITY_RECORDED');
  });

  it('2. STALE on a concrete discrepancy: later commits reference a work item no state document mentions', () => {
    const r = evaluateFreshness(evidence({ git: gitWith([commit('feat(GADGET-002): add gadget'), commit('fix(GADGET-002): follow-up')]) }));
    expect(r.status).toBe('STALE');
    expect(r.unrecordedWork).toEqual(['GADGET-002']);
    expect(r.reasons[0].code).toBe('UNRECORDED_WORK');
    expect(r.reasons[0].message).toContain('GADGET-002');
    expect(r.warnings).toContain('Git activity exists after the last recorded state update, but no active story is recorded.');
  });

  it('3. UNKNOWN when there is not enough data: later commits that name no work item', () => {
    const r = evaluateFreshness(evidence({ git: gitWith([commit('tweak things')]) }));
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasons.map((x) => x.code)).toEqual(['UNATTRIBUTED_ACTIVITY']);
  });

  it('3b. UNKNOWN when no commit ever touched the state documents', () => {
    const r = evaluateFreshness(evidence({ git: { status: 'ok', lastStateUpdate: null, commitsSince: [], truncated: false } }));
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasons[0].code).toBe('STATE_NOT_IN_GIT');
  });

  it('3c. UNKNOWN (not FRESH) when git history was cut at the read limit', () => {
    const r = evaluateFreshness(evidence({ git: gitWith([commit('feat(WIDGET-001): x')], true) }));
    expect(r.status).toBe('UNKNOWN');
    expect(r.reasons[0].code).toBe('GIT_HISTORY_TRUNCATED');
  });

  it('4. no active story is not "project complete", and alone it is neither STALE nor a reason to doubt FRESH', () => {
    const fresh = evaluateFreshness(evidence({ activeStory: { kind: 'none' } }));
    expect(fresh.status).toBe('FRESH');
    expect(fresh.activeStory).toBe('none-recorded');
    expect(fresh.warnings).toEqual([]);

    const unknown = evaluateFreshness(evidence({ git: { status: 'unavailable', reason: 'NOT_A_GIT_REPOSITORY' }, activeStory: { kind: 'none' } }));
    expect(unknown.status).toBe('UNKNOWN');
    expect(unknown.warnings.join(' ')).toContain('does not mean the project is complete');
  });

  it('5. git activity without a state update is a signal, not proof: it is STALE only if it names unrecorded work', () => {
    expect(evaluateFreshness(evidence({ git: gitWith([commit('chore: bump deps')]) })).status).toBe('UNKNOWN');
    expect(evaluateFreshness(evidence({ git: gitWith([commit('chore(NEWTHING-009): start')]) })).status).toBe('STALE');
  });

  it('6. git activity unrelated to the tracked state is ignored: state-file-only commits and plain merges', () => {
    const r = evaluateFreshness(
      evidence({
        git: gitWith([
          commit('docs: update roadmap', ['.monolith/context/maps/roadmap-index.md']),
          commit('Merge branch feature/other', []),
        ]),
      }),
    );
    expect(r.status).toBe('FRESH');
    expect(r.activityCount).toBe(0);
  });

  it('7. contradictory statuses are STALE even with no git at all', () => {
    const r = evaluateFreshness(
      evidence({
        git: { status: 'unavailable', reason: 'GIT_NOT_INSTALLED' },
        activeStory: { kind: 'ids', ids: ['WIDGET-001'] },
        roadmapStatuses: new Map([['WIDGET-001', 'COMPLETED']]),
      }),
    );
    expect(r.status).toBe('STALE');
    expect(r.reasons.map((x) => x.code)).toContain('STATE_CONTRADICTION');
  });

  it('7b. other contradictions: roadmap names an active story that active.md denies; roadmap vs story-index disagree', () => {
    const a = evaluateFreshness(evidence({ activeStory: { kind: 'none' }, roadmapActiveStory: 'WIDGET-001' }));
    expect(a.status).toBe('STALE');
    const b = evaluateFreshness(
      evidence({ roadmapStatuses: new Map([['WIDGET-001', 'COMPLETED']]), storyIndexStatuses: new Map([['WIDGET-001', 'IN PROGRESS']]) }),
    );
    expect(b.status).toBe('STALE');
    expect(b.reasons[0].message).toContain('story-index.md');
  });

  it('7c. consistent "none" on both sides is not a contradiction', () => {
    expect(evaluateFreshness(evidence({ activeStory: { kind: 'none' }, roadmapActiveStory: 'none' })).status).toBe('FRESH');
  });

  it('8/9. git unavailable (any reason) is UNKNOWN, never FRESH', () => {
    for (const reason of ['GIT_NOT_INSTALLED', 'NOT_A_GIT_REPOSITORY', 'GIT_FAILED'] as const) {
      const r = evaluateFreshness(evidence({ git: { status: 'unavailable', reason } }));
      expect(r.status).toBe('UNKNOWN');
      expect(r.reasons[0].code).toBe('GIT_UNAVAILABLE');
    }
  });

  it('an old date alone changes nothing (dates are never compared with "now")', () => {
    const old = { sha: 'c'.repeat(40), date: '1999-01-01T00:00:00+00:00' };
    const r = evaluateFreshness(evidence({ git: { status: 'ok', lastStateUpdate: old, commitsSince: [], truncated: false } }));
    expect(r.status).toBe('FRESH');
  });

  it('lists at most five unrecorded ids and counts the rest', () => {
    const subjects = ['AAA-001', 'AAA-002', 'AAA-003', 'AAA-004', 'AAA-005', 'AAA-006', 'AAA-007'].map((id) => commit(`feat(${id}): x`));
    const r = evaluateFreshness(evidence({ git: gitWith(subjects) }));
    expect(r.unrecordedWork).toHaveLength(7);
    expect(r.reasons[0].message).toContain('and 2 more');
  });
});

describe('state document parsers', () => {
  it('extracts work-item ids and ignores decision records', () => {
    expect(extractWorkItemIds('feat(UI-002D): x; merge(SEC-001B.1-R); see ADR-013 and LOCK-RELEASE-001, F-05')).toEqual([
      'UI-002D',
      'SEC-001B.1-R',
      'LOCK-RELEASE-001',
    ]);
  });

  it('parses the active story claim', () => {
    expect(parseActiveStoryClaim('No active story.\n\nPrevious: **X-001A**')).toEqual({ kind: 'none' });
    expect(parseActiveStoryClaim('WIDGET-001 — in progress')).toEqual({ kind: 'ids', ids: ['WIDGET-001'] });
    expect(parseActiveStoryClaim('something vague')).toEqual({ kind: 'unknown' });
    expect(parseActiveStoryClaim(null)).toEqual({ kind: 'unknown' });
  });

  it('parses roadmap-index and story-index', () => {
    const roadmap = ['Active Story: none', '| Story | Title | Status | Date |', '| ----- | ----- | ------ | ---- |', '| 1.1 | A | COMPLETED | d |', '| X-001A | B | IN PROGRESS | d |'].join('\n');
    expect(parseRoadmapActiveStory(roadmap)).toBe('none');
    expect([...parseRoadmapStatuses(roadmap)]).toEqual([['1.1', 'COMPLETED'], ['X-001A', 'IN PROGRESS']]);
    const index = '### STORY 1.1 — A\n\n**Date:** d\n**Status:** COMPLETED\n\n### X-001A — B\n**Status:** IN PROGRESS\n';
    expect([...parseStoryIndexStatuses(index)]).toEqual([['1.1', 'COMPLETED'], ['X-001A', 'IN PROGRESS']]);
  });
});

// ---------------------------------------------------------------------------
// Real git, deterministic fixtures
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

const ACTIVE = '.monolith/memory/working/active.md';
const ROADMAP = '.monolith/context/maps/roadmap-index.md';

function sh(dir: string, args: string[], day = 1): void {
  const stamp = `2000-01-${String(day).padStart(2, '0')}T12:00:00+00:00`;
  execFileSync('git', args, { cwd: dir, env: { ...GIT_ENV, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp }, stdio: 'ignore' });
}

function write(dir: string, rel: string, content: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

function makeProject(opts: { git: boolean; files?: Record<string, string> }): string {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-fresh-'));
  tempDirs.push(dir);
  write(dir, 'monolith.config.json', JSON.stringify({ project: { name: 'fixture' }, monolithRoot: '.monolith' }));
  write(dir, ACTIVE, '# Active\n\n## Current Story\n\nNo active story.\n\n---\n');
  write(dir, ROADMAP, '# Roadmap\n\n| Story | Title | Status | Date |\n| --- | --- | --- | --- |\n| WIDGET-001 | W | COMPLETED | d |\n\nActive Story: none\n');
  for (const [rel, content] of Object.entries(opts.files ?? {})) write(dir, rel, content);
  if (opts.git) sh(dir, ['init', '-q', '-b', 'main']);
  return dir;
}

function commitAll(dir: string, message: string, day: number): void {
  sh(dir, ['add', '-A'], day);
  sh(dir, ['commit', '-q', '-m', message], day);
}

describe('readGitSignals (real git, fixed dates)', () => {
  it('finds the last state update and the commits after it', () => {
    const dir = makeProject({ git: true });
    commitAll(dir, 'docs: state', 1);
    write(dir, 'src/a.ts', 'export {};\n');
    commitAll(dir, 'feat(GADGET-002): a', 2);
    const g = readGitSignals(dir, [ACTIVE, ROADMAP]);
    expect(g.status).toBe('ok');
    if (g.status !== 'ok') return;
    expect(g.lastStateUpdate?.date.startsWith('2000-01-01')).toBe(true);
    expect(g.commitsSince.map((c) => [c.subject, c.files])).toEqual([['feat(GADGET-002): a', ['src/a.ts']]]);
    expect(g.truncated).toBe(false);
  });

  it('9. not a git repository → unavailable NOT_A_GIT_REPOSITORY', () => {
    const dir = makeProject({ git: false });
    expect(readGitSignals(dir, [ACTIVE])).toEqual({ status: 'unavailable', reason: 'NOT_A_GIT_REPOSITORY' });
  });

  it('8. git not runnable → unavailable GIT_NOT_INSTALLED', () => {
    const dir = makeProject({ git: false });
    vi.stubEnv('PATH', '');
    expect(readGitSignals(dir, [ACTIVE])).toEqual({ status: 'unavailable', reason: 'GIT_NOT_INSTALLED' });
  });

  it('a repository without commits has no state update to compare with', () => {
    const dir = makeProject({ git: true });
    expect(readGitSignals(dir, [ACTIVE])).toEqual({ status: 'ok', lastStateUpdate: null, commitsSince: [], truncated: false });
  });
});

describe('monolith brief — Freshness end to end', () => {
  async function briefOf(dir: string, args: string[] = []) {
    const originalExit = process.exit;
    const out: string[] = [];
    const err: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    let code: number | undefined;
    process.stdout.write = ((c: string) => (out.push(c), true)) as typeof process.stdout.write;
    const origErr = console.error;
    console.error = (...a: unknown[]) => void err.push(a.join(' '));
    process.exit = ((c?: number) => {
      code = c;
      throw new Error('__exit__');
    }) as never;
    try {
      await runBrief(args, dir).catch((e: unknown) => {
        if (!(e instanceof Error) || e.message !== '__exit__') throw e;
      });
    } finally {
      process.exit = originalExit;
      process.stdout.write = write;
      console.error = origErr;
    }
    return { code, stdout: out.join(''), stderr: err.join('') };
  }

  it('10. STALE with COMPLETE: warnings are shown, exit code stays 0, --strict stays 0', async () => {
    const dir = makeProject({ git: true });
    commitAll(dir, 'docs: state', 1);
    write(dir, 'src/a.ts', 'export {};\n');
    commitAll(dir, 'feat(GADGET-002): a', 2);

    for (const args of [[], ['--strict']]) {
      const { code, stdout } = await briefOf(dir, args);
      expect(code).toBe(0);
      const lines = stdout.split('\n');
      expect(lines[0]).toBe('Completeness: COMPLETE');
      expect(lines[1]).toBe('Freshness: STALE');
      expect(stdout).toContain('GADGET-002');
      expect(stdout).toContain('Review project state before relying on this brief.');
      expect(stdout).toContain('Active Story: none recorded (this does not mean the project is complete)');
    }
  });

  it('FRESH is reported when the state is the newest thing in history', async () => {
    const dir = makeProject({ git: true });
    commitAll(dir, 'docs: state', 1);
    const { stdout } = await briefOf(dir);
    expect(stdout.split('\n').slice(0, 2)).toEqual(['Completeness: COMPLETE', 'Freshness: FRESH']);
  });

  it('UNKNOWN outside a git repository, still COMPLETE and exit 0', async () => {
    const dir = makeProject({ git: false });
    const { code, stdout } = await briefOf(dir);
    expect(code).toBe(0);
    expect(stdout.split('\n').slice(0, 2)).toEqual(['Completeness: COMPLETE', 'Freshness: UNKNOWN']);
    expect(stdout).toContain('not inside a git repository');
  });

  it('missing active.md does not make the project look complete or fresh', async () => {
    const dir = makeProject({ git: true });
    rmSync(join(dir, ACTIVE));
    commitAll(dir, 'docs: state', 1);
    const { stdout } = await briefOf(dir);
    expect(stdout).toContain('Freshness: FRESH');
    expect(stdout).toContain('Active Story: unknown');
  });

  it('is deterministic and read-only: two runs are byte-identical and the tree is untouched', async () => {
    const dir = makeProject({ git: true });
    commitAll(dir, 'docs: state', 1);
    const snapshot = () => readdirSync(dir, { recursive: true }).map(String).sort().join('\n');
    const before = snapshot();
    const a = await briefOf(dir);
    const b = await briefOf(dir);
    expect(a.stdout).toBe(b.stdout);
    expect(snapshot()).toBe(before);
  });

  it('the Freshness block is counted in --max-chars like other required content', async () => {
    const dir = makeProject({ git: false });
    const model = await collect(dir);
    const { text, completeness } = render(model, 200);
    expect(text).toContain('Freshness: UNKNOWN');
    expect(text).toContain('BUDGET_EXCEEDED_BY_REQUIRED');
    expect(completeness).toBe('INCOMPLETE');
  });

  it('a model without freshness renders as before (no Freshness line)', async () => {
    const dir = makeProject({ git: false });
    const model = await collect(dir);
    delete model.freshness;
    expect(render(model).text).not.toContain('Freshness');
  });
});
