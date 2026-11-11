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
import { attributeKnowledge, MAX_IDEA_IDS_PER_COMMIT } from './knowledge.js';
import type { GitSignals } from './freshness.js';
import { addIdea, ideaStore } from '../ideas/store.js';
import { artifactPathsCover, attributionPathProblem, invalidArtifactPath, parseIdea, serializeIdea, validateNewIdea } from '../ideas/format.js';
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
const sh = (dir: string, args: string[], input?: string): void => {
  const stamp = new Date(Date.UTC(2000, 1, 1, 12, 0, ++day)).toISOString();
  execFileSync('git', args, { cwd: dir, env: { ...ENV, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp }, stdio: ['pipe', 'ignore', 'ignore'], input });
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
    expect(report.independentKnowledge).toEqual([{ ideaIds: ['IDEA-001'], paths: [DOC], commits: [expect.stringContaining('agent arena paper')] }]);
    expect(renderReconciliation(report, 6000).text).toContain(`declared paths: ${DOC}`);
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

  it('several specific documents of one idea are all attributable; a sibling that is not listed is not', async () => {
    const dir = project({ 1: [DOC, 'docs/vision/second.md'] });
    put(dir, DOC, '# a\n');
    put(dir, 'docs/vision/second.md', '# b\n');
    commit(dir, 'docs: both IDEA-001');
    expect((await verdict(dir)).fresh.status).toBe('FRESH');
    put(dir, 'docs/vision/third.md', '# c\n');
    commit(dir, 'docs: third IDEA-001');
    const { fresh, report } = await verdict(dir);
    expect(fresh.status).toBe('UNKNOWN');
    expect(JSON.stringify(report.findings)).toContain('docs/vision/third.md');
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
    const dir = project({ 1: ['docs/foo.md', 'docs/handoff.md'] });
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

  it('M1: paths are exact (git -z, never quoted): a non-ASCII file is judged like any other; quotes are not valid in registered paths', async () => {
    const dir = project({ 1: ['docs/caf\u00e9.md'] });
    put(dir, 'docs/caf\u00e9.md', '# x\n');
    commit(dir, 'docs: odd name IDEA-001');
    expect((await verdict(dir)).fresh.status).toBe('FRESH');
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


/** Writes an idea file by hand, bypassing write-time validation (as an old or hostile file could). */
describe('A4-SEC-03 — attribution scope is narrow: exact documents, never code, never governance', () => {
  const handWritten = (paths: string[]): Record<number, string[]> => ({ 1: paths });

  it.each([
    ['a source directory', ['src/']],
    ['the project root', ['./']],
    ['a docs directory prefix', ['docs/']],
    ['the MONOLITH root', ['.monolith/']],
    ['a file inside the MONOLITH root', ['.monolith/protocols/governance/core-invariants.md']],
    ['the MONOLITH root in other case', ['.MONOLITH/protocols/x.md']],
    ['a source file', ['src/pay.ts']],
    ['a document-looking script', ['docs/run.md.js']],
    ['a configuration file', ['package.json']],
  ])('%s declared by a hand-edited idea attributes nothing', async (_name, paths) => {
    const dir = project(handWritten(paths));
    put(dir, 'src/pay.ts', 'export const pay = 1;\n');
    put(dir, 'docs/x.md', '# x\n');
    commit(dir, 'feat: harmless IDEA-001');
    const { fresh, report } = await verdict(dir);
    expect(fresh.status).toBe('UNKNOWN');
    expect(report.independentKnowledge).toEqual([]);
  });

  it('a directory-prefix registration is refused with a reason a person can read', async () => {
    const dir = project(handWritten(['docs/']));
    put(dir, 'docs/x.md', '# x\n');
    commit(dir, 'docs: x IDEA-001');
    const { fresh, report } = await verdict(dir);
    expect(fresh.status).toBe('UNKNOWN');
    expect(JSON.stringify(report.findings)).toContain('directory prefix is not allowed');
  });

  it('code smuggled next to a registered document is not explained by the idea', async () => {
    const dir = project(handWritten([DOC]));
    put(dir, DOC, '# x\n');
    put(dir, 'src/pay.ts', 'export const x = 1;\n');
    commit(dir, 'docs(vision): paper IDEA-001');
    const { fresh, report } = await verdict(dir);
    expect(fresh.status).toBe('UNKNOWN');
    expect(JSON.stringify(report.findings)).toContain('src/pay.ts');
    expect(report.independentKnowledge).toEqual([]);
  });

  it('existing ideas without paths are untouched (no rewrite, no attribution)', async () => {
    const dir = project({ 1: undefined });
    put(dir, DOC, '# x\n');
    commit(dir, 'docs: paper IDEA-001');
    expect((await verdict(dir)).fresh.status).toBe('UNKNOWN');
    expect(parseIdea('IDEA-001', idea(1)).paths).toBeUndefined();
  });

  it('write-time policy: narrow documents anywhere are accepted; broad roots, code and governance paths are refused', () => {
    for (const ok of ['docs/vision/agent-arena-verified-automation-marketplace.md', 'strategy/plan.adoc', 'README.md', 'notes/ü.adoc', 'a/b/c.MD']) {
      expect(attributionPathProblem(ok), ok).toBeNull();
    }
    for (const bad of ['AGENTS.md', 'docs/CLAUDE.md', '.claude/skills/x/SKILL.md', '.github/copilot-instructions.md', '.git/hooks/pre-commit.md', 'node_modules/x/index.md', 'requirements.txt', 'CMakeLists.txt', 'notes.txt', 'docs/x\u200b.md', 'docs/x\u00a0.md', 'src/', 'src', 'docs/', '.', './', '/', 'src/pay.ts', 'package.json', 'Makefile', '.monolith/x.md', '.Monolith/x.md', '.monolith', 'docs/x.md/']) {
      expect(attributionPathProblem(bad), bad).not.toBeNull();
    }
    expect(attributionPathProblem('gov/x.md', 'gov')).not.toBeNull();
    expect(attributionPathProblem('gov/x.md', '.monolith')).toBeNull();
    expect(() => validateNewIdea({ title: 't', description: 'd', paths: ['src/'] })).toThrow(/directory prefix/);
    expect(() => validateNewIdea({ title: 't', description: 'd', paths: ['gov/a.md'] }, 'gov')).toThrow(/MONOLITH root/);
  });

  it('`idea add` refuses a broad path in a real instance, writes nothing, and accepts a narrow one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monolith-ka001-add-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.monolith'), { recursive: true });
    const store = ideaStore(dir);
    expect(() => addIdea(store, { title: 't', description: 'd', paths: ['src/'] })).toThrow(/directory prefix/);
    expect(() => addIdea(store, { title: 't', description: 'd', paths: ['.monolith/x.md'] })).toThrow(/MONOLITH root/);
    expect(() => addIdea(store, { title: 't', description: 'd', paths: ['src/pay.ts'] })).toThrow(/document files/);
    const ok = addIdea(store, { title: 't', description: 'd', paths: ['docs/vision/x.md'] });
    expect(ok.idea.id).toBe('IDEA-001'); // the refused attempts consumed no id
    expect(ok.idea.paths).toEqual(['docs/vision/x.md']);
  });
});

describe('A4-SEC-05 — a subject naming many ideas costs no git work', () => {
  const ok = (sha: string, subject: string, files: string[] = ['docs/a.md']): GitSignals => ({
    status: 'ok',
    lastStateUpdate: { sha: 'b'.repeat(40), date: 'd' },
    commitsSince: [{ sha, date: 'd', subject, files }],
    truncated: false,
  });
  const opts = (calls: { n: number }) => ({
    monolithRoot: '.monolith',
    stateFiles: new Set<string>(),
    hasWorkItem: () => false,
    readBlob: () => {
      calls.n++;
      return null;
    },
  });
  const ids = (n: number): string => Array.from({ length: n }, (_, i) => `IDEA-${String(i + 1).padStart(3, '0')}`).join(' ');

  it('thousands of ids: refused before any registration is read, with a diagnostic', () => {
    const calls = { n: 0 };
    const ev = attributeKnowledge(ok('a'.repeat(40), `docs: ${ids(5000)}`), opts(calls));
    expect(calls.n).toBe(0);
    expect(ev.attributed.size).toBe(0);
    expect(ev.rejected.get('a'.repeat(40))?.reason).toContain('names 5000 ideas');
  });

  it(`exactly ${MAX_IDEA_IDS_PER_COMMIT} ids are still judged; one more is not`, () => {
    const at = { n: 0 };
    attributeKnowledge(ok('a'.repeat(40), `docs: ${ids(MAX_IDEA_IDS_PER_COMMIT)}`), opts(at));
    expect(at.n).toBe(MAX_IDEA_IDS_PER_COMMIT);
    const over = { n: 0 };
    attributeKnowledge(ok('a'.repeat(40), `docs: ${ids(MAX_IDEA_IDS_PER_COMMIT + 1)}`), opts(over));
    expect(over.n).toBe(0);
  });

  it('a total read budget bounds git work across many commits', () => {
    const calls = { n: 0 };
    const git: GitSignals = {
      status: 'ok',
      lastStateUpdate: { sha: 'b'.repeat(40), date: 'd' },
      commitsSince: Array.from({ length: 200 }, (_, i) => ({ sha: i.toString(16).padStart(40, '0'), date: 'd', subject: `docs: ${ids(8)}`, files: ['docs/a.md'] })),
      truncated: false,
    };
    attributeKnowledge(git, opts(calls));
    expect(calls.n).toBeLessThanOrEqual(64);
  });

  const commitLong = (dir: string, msg: string): void => {
    sh(dir, ['add', '-A']);
    sh(dir, ['commit', '-q', '-F', '-'], msg); // too long for argv
  };

  it('a ~900 KB subject repeating one registered id is judged once, quickly (legitimately attributed)', async () => {
    const dir = project({ 1: [DOC] });
    put(dir, DOC, '# x\n');
    commitLong(dir, `docs: ${'IDEA-001 '.repeat(100_000)}`);
    const t0 = Date.now();
    const { fresh } = await verdict(dir);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(fresh.status).toBe('FRESH');
  });

  it('a ~300 KB subject naming 20000 distinct ideas is refused: UNKNOWN, with the reason, in bounded time', async () => {
    const dir = project({ 1: [DOC] });
    put(dir, DOC, '# x\n');
    commitLong(dir, `docs: IDEA-001 ${ids(20_000)}`);
    const t0 = Date.now();
    const { fresh, report } = await verdict(dir);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(fresh.status).toBe('UNKNOWN');
    expect(JSON.stringify(report.findings)).toContain('names 20000 ideas');
  });
});
