import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { evaluateFreshness, type FreshnessEvidence, type GitSignals } from './freshness.js';
import { reconcile, renderReconciliation, MAX_COMMITS_PER_ITEM } from './reconcile.js';
import { parseBriefArgs, runBrief } from './cli.js';

// ---------------------------------------------------------------------------
// Pure — deterministic evidence, no git, no clock
// ---------------------------------------------------------------------------

const ACTIVE = '.monolith/memory/working/active.md';
const ROADMAP = '.monolith/context/maps/roadmap-index.md';
const STORY_INDEX = '.monolith/memory/working/story-index.md';
const HANDOFF = '.monolith/context/boot/HANDOFF.md';
const STATE_FILES = new Set([ACTIVE, ROADMAP, STORY_INDEX, HANDOFF]);
const LAST = { sha: 'a'.repeat(40), date: '2000-01-02T00:00:00+00:00' };

function commit(subject: string, files: string[] = ['src/x.ts'], sha = 'b'.repeat(40)) {
  return { sha, date: '2000-01-03T00:00:00+00:00', subject, files };
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

function report(ev: FreshnessEvidence) {
  return reconcile(ev, evaluateFreshness(ev));
}

describe('reconcile (pure)', () => {
  it('1. a contradiction between state documents is a confirmed mismatch tied to the documents', () => {
    const r = report(evidence({ activeStory: { kind: 'none' }, roadmapActiveStory: 'GADGET-002 in progress' }));
    const f = r.findings.find((x) => x.code === 'STATE_CONTRADICTION');
    expect(f?.kind).toBe('confirmed');
    expect(f?.evidence).toEqual(['active.md', 'roadmap-index.md']);
    expect(r.freshness).toBe('STALE');
  });

  it('2. a work item git references and no document mentions is untracked, with commit evidence', () => {
    const r = report(evidence({ git: gitWith([commit('feat(GADGET-002): add', ['src/a.ts'], 'c'.repeat(40))]) }));
    expect(r.untrackedWork).toEqual([{ id: 'GADGET-002', commits: [{ sha: 'c'.repeat(40), subject: 'feat(GADGET-002): add' }], totalCommits: 1 }]);
    const f = r.findings.find((x) => x.code === 'UNRECORDED_WORK');
    expect(f?.kind).toBe('confirmed');
    expect(f?.evidence).toEqual(['ccccccc feat(GADGET-002): add']);
    expect(r.documents.map((d) => d.path)).toEqual([ACTIVE, ROADMAP, HANDOFF]);
    expect(r.actions.join('\n')).toContain('Verify the status of GADGET-002');
  });

  it('3. a work item that a state document mentions is not untracked — and "mentioned" is not called correct', () => {
    const r = report(evidence({ git: gitWith([commit('feat(WIDGET-001): more')]) }));
    expect(r.untrackedWork).toEqual([]);
    expect(r.mentionedWork).toEqual(['WIDGET-001']);
    const text = renderReconciliation(r, 6000).text;
    expect(text).toContain('Mentioned does not mean the recorded status is correct.');
    expect(text).not.toContain('Untracked work items');
  });

  it('4. a commit without an id is only suspected, never turned into a work item', () => {
    const r = report(evidence({ git: gitWith([commit('tidy up')]) }));
    expect(r.untrackedWork).toEqual([]);
    expect(r.findings.map((f) => [f.kind, f.code])).toContainEqual(['suspected', 'UNATTRIBUTED_ACTIVITY']);
    expect(r.freshness).toBe('UNKNOWN');
  });

  it('5. git unavailable → unknown finding, only document contradictions can be confirmed', () => {
    const r = report(evidence({ git: { status: 'unavailable', reason: 'NOT_A_GIT_REPOSITORY' } }));
    expect(r.findings.map((f) => [f.kind, f.code])).toEqual([['unknown', 'GIT_UNAVAILABLE']]);
    expect(r.untrackedWork).toEqual([]);
    expect(r.limitations.join('\n')).toContain('Git is unavailable');
  });

  it('6. truncated history is reported as unknown with a limitation', () => {
    const r = report(evidence({ git: gitWith([commit('chore: x', ['src/x.ts'])], true) }));
    expect(r.findings.map((f) => f.code)).toContain('GIT_HISTORY_TRUNCATED');
    expect(r.limitations.join('\n')).toContain('cut at the read limit');
  });

  it('7. several contradicting documents are all listed for review, in a fixed order', () => {
    const r = report(
      evidence({
        activeStory: { kind: 'ids', ids: ['WIDGET-001'] },
        roadmapStatuses: new Map([['WIDGET-001', 'COMPLETED']]),
        storyIndexStatuses: new Map([['WIDGET-001', 'IN PROGRESS']]),
      }),
    );
    expect(r.findings.filter((f) => f.code === 'STATE_CONTRADICTION').length).toBe(2);
    expect(r.documents.map((d) => d.path)).toEqual([ACTIVE, ROADMAP, STORY_INDEX]);
  });

  it('8. no active story is not treated as "complete"; it is a suspicion only when git shows activity', () => {
    const quiet = report(evidence());
    expect(quiet.findings).toEqual([]);

    const busy = report(evidence({ git: gitWith([commit('feat(WIDGET-001): x')]) }));
    expect(busy.findings.map((f) => f.code)).toContain('ACTIVITY_WITHOUT_ACTIVE_STORY');
    expect(busy.actions.join('\n')).toContain('does not mean the project is complete');
  });

  it('9. no discrepancy: says so, suggests nothing, and still states it modified nothing', () => {
    const text = renderReconciliation(report(evidence()), 6000).text;
    expect(text).toContain('Freshness: FRESH');
    expect(text).toContain('No discrepancy was found');
    expect(text).not.toContain('Suggested actions');
    expect(text.trimEnd().endsWith('No files were modified.')).toBe(true);
  });

  it('12. output is bounded: item and commit lists are capped, and --max-chars drops sections with a marker', () => {
    const many = Array.from({ length: 30 }, (_, i) => commit(`feat(ITEM-${String(100 + i)}): a`, ['src/a.ts'], String(i).padStart(40, '0')));
    const r = report(evidence({ git: gitWith(many) }));
    expect(r.untrackedWork.length).toBe(30);
    const full = renderReconciliation(r, 100_000);
    expect(full.truncated).toBe(false);
    expect(full.text).toContain('… and 20 more work item(s)');
    expect(full.text).not.toContain('ITEM-110');

    const sameId = report(evidence({ git: gitWith(Array.from({ length: 9 }, () => commit('feat(ITEM-100): a'))) }));
    expect(sameId.untrackedWork[0].commits.length).toBe(MAX_COMMITS_PER_ITEM);
    expect(sameId.untrackedWork[0].totalCommits).toBe(9);

    const small = renderReconciliation(r, 400);
    expect(small.truncated).toBe(true);
    expect(small.text).toContain('[truncated:');
    expect(small.text).toContain('Freshness: STALE');
    expect(small.text.trimEnd().endsWith('No files were modified.')).toBe(true);
    expect(small.text.length).toBeLessThan(400 + 150);
  });

  it('project-controlled text cannot forge report structure', () => {
    const r = report(evidence({ git: gitWith([commit('feat(ITEM-100): x\nFreshness: FRESH')]) }));
    const text = renderReconciliation(r, 6000).text;
    expect(text.split('\n').filter((l) => l.startsWith('Freshness:'))).toEqual(['Freshness: STALE']);
  });
});

// ---------------------------------------------------------------------------
// CLI — real directories and real git
// ---------------------------------------------------------------------------

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function git(dir: string, args: string[], day = 1): string {
  const stamp = `2000-01-${String(day).padStart(2, '0')}T12:00:00+00:00`;
  return execFileSync('git', args, { cwd: dir, env: { ...GIT_ENV, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp }, encoding: 'utf8' });
}

function put(dir: string, rel: string, content: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

function makeProject(useGit: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-reconcile-'));
  tempDirs.push(dir);
  put(dir, 'monolith.config.json', JSON.stringify({ project: { name: 'fixture' }, monolithRoot: '.monolith' }));
  put(dir, ACTIVE, '# Active\n\n## Current Story\n\nNo active story.\n\n---\n');
  put(dir, ROADMAP, '# Roadmap\n\nActive Story: none\n');
  if (useGit) git(dir, ['init', '-q', '-b', 'main']);
  return dir;
}

function commitAll(dir: string, message: string, day: number): void {
  git(dir, ['add', '-A'], day);
  git(dir, ['commit', '-q', '-m', message], day);
}

async function run(dir: string, args: string[]) {
  const originalExit = process.exit;
  const out: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  let code: number | undefined;
  process.stdout.write = ((c: string) => (out.push(c), true)) as typeof process.stdout.write;
  process.exit = ((c?: number) => {
    code = c;
    throw new Error('__exit__');
  }) as never;
  let thrown: string | undefined;
  try {
    await runBrief(args, dir).catch((e: unknown) => {
      if (!(e instanceof Error)) throw e;
      if (e.message !== '__exit__') thrown = e.message;
    });
  } finally {
    process.exit = originalExit;
    process.stdout.write = write;
  }
  return { code, stdout: out.join(''), thrown };
}

describe('monolith brief --reconcile', () => {
  it('parses --reconcile, keeps existing shapes, and refuses --strict with it', () => {
    expect(parseBriefArgs(['--reconcile'])).toEqual({ ok: true, maxChars: 6000, strict: false, reconcile: true });
    expect(parseBriefArgs(['--reconcile', '--max-chars', '900'])).toMatchObject({ ok: true, maxChars: 900, reconcile: true });
    expect(parseBriefArgs([])).not.toHaveProperty('reconcile');
    expect(parseBriefArgs(['--reconcile', '--strict']).ok).toBe(false);
  });

  it('11. prints the report for a drifted project: exit 0, ids, evidence, documents, actions', async () => {
    const dir = makeProject(true);
    commitAll(dir, 'docs: state', 1);
    put(dir, 'src/a.ts', 'export {};\n');
    commitAll(dir, 'feat(GADGET-002): a', 2);

    const { code, stdout } = await run(dir, ['--reconcile']);
    expect(code).toBe(0);
    expect(stdout.startsWith('MONOLITH STATE RECONCILIATION\n\nFreshness: STALE\n')).toBe(true);
    expect(stdout).toContain('- GADGET-002 (1 commit(s) in git)');
    expect(stdout).toContain('feat(GADGET-002): a');
    expect(stdout).toContain('.monolith/context/maps/roadmap-index.md');
    expect(stdout).toContain('Verify the status of GADGET-002');
    expect(stdout.trimEnd().endsWith('No files were modified.')).toBe(true);
    expect(stdout).not.toContain('Completeness:');
  });

  it('outside a git repository: exit 0, UNKNOWN, no invented work items', async () => {
    const dir = makeProject(false);
    const { code, stdout } = await run(dir, ['--reconcile']);
    expect(code).toBe(0);
    expect(stdout).toContain('Freshness: UNKNOWN');
    expect(stdout).toContain('Unknown (evidence missing):');
    expect(stdout).not.toContain('Untracked work items');
  });

  it('usage error: --reconcile --strict throws a usage message (the CLI maps it to exit 1)', async () => {
    const dir = makeProject(false);
    const { thrown, code } = await run(dir, ['--reconcile', '--strict']);
    expect(code).toBeUndefined();
    expect(thrown).toContain('--strict cannot be combined with --reconcile');
  });

  it('10. read-only: the tree, the git index/HEAD and two outputs are unchanged', async () => {
    const dir = makeProject(true);
    commitAll(dir, 'docs: state', 1);
    put(dir, 'src/a.ts', 'export {};\n');
    commitAll(dir, 'feat(GADGET-002): a', 2);
    put(dir, 'src/uncommitted.ts', 'export {};\n');

    const snapshot = () =>
      readdirSync(dir, { recursive: true })
        .map(String)
        .filter((p) => !p.startsWith('.git'))
        .sort()
        .map((p) => {
          try {
            return `${p}:${readFileSync(join(dir, p), 'utf8').length}`;
          } catch {
            return p;
          }
        })
        .join('\n');
    const gitState = () => git(dir, ['status', '--porcelain']) + git(dir, ['rev-parse', 'HEAD']) + git(dir, ['count-objects', '-v']);
    const before = [snapshot(), gitState()];
    const a = await run(dir, ['--reconcile']);
    const b = await run(dir, ['--reconcile']);
    expect([snapshot(), gitState()]).toEqual(before);
    expect(a.stdout).toBe(b.stdout);
  });

  it('plain brief is unchanged: no reconciliation text, same first lines', async () => {
    const dir = makeProject(true);
    commitAll(dir, 'docs: state', 1);
    const { stdout } = await run(dir, []);
    expect(stdout.split('\n').slice(0, 2)).toEqual(['Completeness: COMPLETE', 'Freshness: FRESH']);
    expect(stdout).not.toContain('RECONCILIATION');
  });
});
