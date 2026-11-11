/**
 * KA-001 — independent knowledge attribution, tested against real git.
 *
 * Scenario (STC): a strategy document is committed that belongs to no story.
 * Without a registration the commit is UNATTRIBUTED_ACTIVITY (freshness UNKNOWN);
 * naming the active story's id would be a false attribution. A registered idea
 * that declares the document's `paths` explains exactly that commit.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { collect } from './collect.js';
import { reconcile, renderReconciliation } from './reconcile.js';
import { artifactPathsCover, invalidArtifactPath, parseIdea, serializeIdea, validateNewIdea } from '../ideas/format.js';
import { parseAddArgs } from '../ideas/cli.js';
import type { Idea } from '../ideas/types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'F',
  GIT_AUTHOR_EMAIL: 'f@example.invalid',
  GIT_COMMITTER_NAME: 'F',
  GIT_COMMITTER_EMAIL: 'f@example.invalid',
};
let day = 0;
const sh = (dir: string, args: string[]): void => {
  const stamp = new Date(Date.UTC(2000, 1, 1, 12, 0, ++day)).toISOString();
  execFileSync('git', args, { cwd: dir, env: { ...ENV, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp }, stdio: 'ignore' });
};
const put = (dir: string, rel: string, content: string): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
};
const commit = (dir: string, msg: string): void => {
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', msg]);
};

const DOC = 'docs/vision/agent-arena.md';
const idea = (n: number, paths?: string[]): string => {
  const i: Idea = { id: `IDEA-${String(n).padStart(3, '0')}`, title: 'Agent Arena', description: 'strategy', createdAt: '2026-11-01T00:00:00.000Z', status: 'inbox' };
  if (paths) i.paths = paths;
  return serializeIdea(i);
};
const IDEA_DIR = '.monolith/memory/long-term/ideas';

/** Baseline commit: state documents (+ optional ideas) — this is the "last state update". */
function project(ideas: Record<number, string[] | undefined> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-ka001-'));
  dirs.push(dir);
  put(dir, 'monolith.config.json', JSON.stringify({ project: { name: 'fx' }, monolithRoot: '.monolith' }));
  put(dir, '.monolith/memory/working/active.md', '# Active\n\n## Current Story\n\n**Story:** STC-005 — Active\n\n---\n');
  put(dir, '.monolith/context/maps/roadmap-index.md', '# Roadmap\n\nActive Story: STC-005\n\n| Story | Title | Status | Date |\n| --- | --- | --- | --- |\n| STC-005 | A | IN PROGRESS | d |\n');
  put(dir, '.monolith/memory/working/story-index.md', '# Stories\n');
  put(dir, '.monolith/context/boot/HANDOFF.md', '# Handoff\n\nSTC-005 in progress.\n');
  for (const [n, paths] of Object.entries(ideas)) put(dir, `${IDEA_DIR}/IDEA-${String(n).padStart(3, '0')}.md`, idea(Number(n), paths));
  sh(dir, ['init', '-q', '-b', 'main']);
  commit(dir, 'docs: STC-005 state');
  return dir;
}

async function verdict(dir: string) {
  const m = await collect(dir);
  return { fresh: m.freshness!, report: reconcile(m.freshnessEvidence!, m.freshness!) };
}

describe('KA-001 independent knowledge attribution (real git)', () => {
  it('registered knowledge, covered path, no work item → FRESH, active story untouched, explained in reconcile', async () => {
    const dir = project({ 1: [DOC] });
    put(dir, DOC, '# Agent Arena\n');
    commit(dir, 'docs(vision): agent arena paper IDEA-001');
    const { fresh, report } = await verdict(dir);
    expect(fresh.status).toBe('FRESH');
    expect(fresh.activeStory).toBe('recorded'); // STC-005 stays the active story
    expect(fresh.reasons.map((r) => r.message).join(' ')).toContain('independent knowledge');
    expect(report.independentKnowledge).toEqual([{ ideaIds: ['IDEA-001'], commits: [expect.stringContaining('agent arena paper')] }]);
    expect(report.untrackedWork).toEqual([]);
    expect(renderReconciliation(report, 6000).text).toContain('registered independent knowledge');
  });

  it('without any registration the same commit stays UNATTRIBUTED_ACTIVITY (UNKNOWN) — existing behaviour', async () => {
    const dir = project();
    put(dir, DOC, '# x\n');
    commit(dir, 'docs(vision): agent arena paper IDEA-001');
    const { fresh } = await verdict(dir);
    expect(fresh.status).toBe('UNKNOWN');
    expect(fresh.reasons.some((r) => r.code === 'UNATTRIBUTED_ACTIVITY')).toBe(true);
  });

  it('an unknown idea id is not accepted', async () => {
    const dir = project({ 1: [DOC] });
    put(dir, DOC, '# x\n');
    commit(dir, 'docs(vision): paper IDEA-099');
    const { fresh, report } = await verdict(dir);
    expect(fresh.status).toBe('UNKNOWN');
    expect(JSON.stringify(report.findings)).toContain('IDEA-099 is not a registered idea in this commit');
  });

  it('an idea without paths attributes nothing', async () => {
    const dir = project({ 1: undefined });
    put(dir, DOC, '# x\n');
    commit(dir, 'docs: paper IDEA-001');
    expect((await verdict(dir)).fresh.status).toBe('UNKNOWN');
  });

  it('foreign files cannot ride along under a knowledge id', async () => {
    const dir = project({ 1: [DOC] });
    put(dir, DOC, '# x\n');
    put(dir, 'src/payments.ts', 'export const secret = 1;\n');
    commit(dir, 'docs(vision): paper IDEA-001');
    const { fresh, report } = await verdict(dir);
    expect(fresh.status).toBe('UNKNOWN');
    expect(JSON.stringify(report.findings)).toContain('src/payments.ts');
    expect(report.independentKnowledge).toEqual([]);
  });

  it('late registration does not legalise an older commit', async () => {
    const dir = project();
    put(dir, DOC, '# x\n');
    commit(dir, 'docs(vision): paper IDEA-001'); // idea does not exist yet
    put(dir, `${IDEA_DIR}/IDEA-001.md`, idea(1, [DOC]));
    commit(dir, 'chore(ideas): register IDEA-001 afterwards');
    const { fresh, report } = await verdict(dir);
    expect(fresh.status).toBe('UNKNOWN');
    expect(report.independentKnowledge).toEqual([]);
  });

  it('a commit that registers or widens the idea is not attributed by its own registration', async () => {
    const dir = project({ 1: ['docs/other.md'] });
    put(dir, `${IDEA_DIR}/IDEA-001.md`, idea(1, ['docs/other.md', DOC]));
    put(dir, DOC, '# x\n');
    commit(dir, 'docs: widen IDEA-001 and add the paper');
    const { fresh, report } = await verdict(dir);
    expect(fresh.status).toBe('UNKNOWN');
    expect(JSON.stringify(report.findings)).toContain('inside the MONOLITH root');
  });

  it('work-item semantics are unchanged: an unrecorded work item is still STALE even with a knowledge id', async () => {
    const dir = project({ 1: [DOC] });
    put(dir, DOC, '# x\n');
    commit(dir, 'docs(NEW-007): paper IDEA-001');
    expect((await verdict(dir)).fresh.status).toBe('STALE');
  });

  it('covered directory prefix works, a lookalike prefix does not', async () => {
    const dir = project({ 1: ['docs/vision/'] });
    put(dir, 'docs/vision/a/b.md', '# x\n');
    commit(dir, 'docs: IDEA-001');
    expect((await verdict(dir)).fresh.status).toBe('FRESH');
    put(dir, 'docs/vision-extra/c.md', '# y\n');
    commit(dir, 'docs: more IDEA-001');
    expect((await verdict(dir)).fresh.status).toBe('UNKNOWN');
  });
});

describe('KA-001 idea format (backward compatible)', () => {
  const base: Idea = { id: 'IDEA-001', title: 't', description: 'd', createdAt: '2026-11-01T00:00:00.000Z', status: 'inbox' };
  it('an idea without paths serialises exactly as before and old files parse', () => {
    expect(serializeIdea(base)).not.toContain('paths');
    expect(parseIdea('IDEA-001', serializeIdea(base)).paths).toBeUndefined();
  });
  it('paths round-trip, and an unknown extra key does not break older readers either way', () => {
    const t = serializeIdea({ ...base, paths: ['a.md', 'dir/'] });
    expect(parseIdea('IDEA-001', t).paths).toEqual(['a.md', 'dir/']);
  });
  it.each(['../x', '/abs', 'a/../b', 'a//b', './a', 'a\\b', 'docs/*.md', 'C:/x', ' a', 'a\n', '', 'a/./b'])('rejects unsafe path %j', (p) => {
    expect(invalidArtifactPath(p)).not.toBeNull();
    expect(() => validateNewIdea({ title: 't', description: 'd', paths: [p] })).toThrow();
  });
  it('coverage is exact for files and prefix-with-slash for directories', () => {
    expect(artifactPathsCover(['a.md', 'd/'], 'a.md')).toBe(true);
    expect(artifactPathsCover(['a.md'], 'a.md.bak')).toBe(false);
    expect(artifactPathsCover(['d/'], 'd/x/y.md')).toBe(true);
    expect(artifactPathsCover(['d/'], 'dd/x.md')).toBe(false);
  });
  it('a corrupt paths field makes the idea unreadable, never partially trusted', () => {
    const t = serializeIdea({ ...base, paths: ['a.md'] }).replace('["a.md"]', '["../x"]');
    expect(() => parseIdea('IDEA-001', t)).toThrow();
  });
  it('--path is repeatable on add; other flags still may not repeat', () => {
    expect(parseAddArgs(['--title', 't', '--description', 'd', '--path', 'a.md', '--path', 'b/']).paths).toEqual(['a.md', 'b/']);
    expect(() => parseAddArgs(['--title', 't', '--title', 'u', '--description', 'd'])).toThrow();
  });
});

describe('KA-001 review hardening (independent review round 1)', () => {
  it('H1: a rename out of the MONOLITH root or src/ into covered docs is not knowledge', async () => {
    const dir = project({ 1: ['docs/'] });
    put(dir, 'src/foo.ts', 'export {};\n');
    commit(dir, 'feat(OLD-001): foo'); // pre-existing code, then state update
    put(dir, '.monolith/memory/working/story-index.md', '# Stories\n\nOLD-001 recorded\n');
    commit(dir, 'docs: state OLD-001');
    mkdirSync(join(dir, 'docs'), { recursive: true });
    sh(dir, ['mv', 'src/foo.ts', 'docs/foo.md']);
    commit(dir, 'docs: move IDEA-001');
    const { fresh, report } = await verdict(dir);
    expect(fresh.status).toBe('UNKNOWN');
    expect(report.independentKnowledge).toEqual([]);
    sh(dir, ['mv', '.monolith/context/boot/HANDOFF.md', 'docs/handoff.md']);
    commit(dir, 'docs: move2 IDEA-001');
    expect((await verdict(dir)).report.independentKnowledge).toEqual([]);
  });

  it('M1: non-ASCII / quoted paths cannot be judged and are not attributed; quotes are not valid in paths', async () => {
    const dir = project({ 1: ['docs/'] });
    put(dir, 'docs/caf\u00e9 \\"q\\".md', '# x\n');
    commit(dir, 'docs: odd name IDEA-001');
    expect((await verdict(dir)).fresh.status).toBe('UNKNOWN');
    expect(invalidArtifactPath('"docs/')).not.toBeNull();
  });

  it('M2: one invalid idea id among several rejects the commit', async () => {
    const dir = project({ 1: [DOC] });
    put(dir, DOC, '# x\n');
    commit(dir, 'docs: paper IDEA-001 IDEA-999');
    const { fresh, report } = await verdict(dir);
    expect(fresh.status).toBe('UNKNOWN');
    expect(JSON.stringify(report.findings)).toContain('IDEA-999');
  });
});
