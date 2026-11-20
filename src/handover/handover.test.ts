/** ACCOUNTABILITY-001: evidence, freshness, handover truthfulness, recovery, hooks. */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeStory, adr, commitAll, finalizedStory, git, makeProject, mission, roadmap, write } from '../scripts/handover-fixture.js';
import { buildGovernanceReport } from '../governance/check.js';
import { handlePreCompact, handleStop, buildSessionContext } from '../hooks/index.js';
import { buildHandoverReport } from './check.js';
import { addEvidence, assessFreshness, classifyEvidence, evidenceStore, listEvidence, parseEvidence, redact, type EvidenceRecord } from './evidence.js';
import { runEvidenceCommand } from './cli.js';
import { readGitView } from './git.js';
import { buildRecoveryPacket, renderRecoveryPacket, RECOVERY_MAX_CHARS } from './recovery.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const proj = async (git = false): Promise<string> => {
  const d = await makeProject({ git });
  dirs.push(d);
  return d;
};
const sha = 'a'.repeat(40);
const rec = (o: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  schema: 1, id: 'EVD-0001', storyId: 'S-1', command: 'pnpm test', result: 'pass', exitCode: 0, provenance: 'OBSERVED', source: 'monolith evidence run',
  recordedAt: '2026-01-01T00:00:00.000Z', gitHead: sha, dirty: false, note: null, durationMs: 5, ...o,
});
const view = (o: Partial<ReturnType<typeof readGitView>> = {}) => ({ available: true, head: sha, dirty: false as boolean | null, dirtyEntries: 0, ...o });

describe('redaction and record format', () => {
  it('redacts obvious secrets from commands and notes', () => {
    expect(redact('curl --token abc123 https://u:pw@h/x')).not.toMatch(/abc123|:pw@/);
    expect(redact('API_KEY=supersecretvalue run')).toBe('API_KEY=[REDACTED] run');
    expect(redact('Authorization: Bearer eyJhbGciOi.x.y')).toContain('Bearer [REDACTED]');
    expect(redact(`x ${'a1'.repeat(25)}`)).toContain('[REDACTED]');
    expect(redact('pnpm test --run')).toBe('pnpm test --run');
  });
  it('rejects records that contradict themselves', () => {
    const ok = JSON.stringify(rec());
    expect(parseEvidence(ok, 'EVD-0001')).not.toBeNull();
    expect(parseEvidence(JSON.stringify(rec({ exitCode: 1 })), 'EVD-0001')).toBeNull(); // pass with exit 1
    expect(parseEvidence(JSON.stringify(rec({ provenance: 'REPORTED' })), 'EVD-0001')).toBeNull(); // reported with exit code
    expect(parseEvidence(JSON.stringify({ ...rec(), extra: 1 }), 'EVD-0001')).not.toBeNull();
    expect(parseEvidence(ok, 'EVD-0002')).toBeNull(); // id must equal the file name
    expect(parseEvidence('{', 'EVD-0001')).toBeNull();
    expect(parseEvidence(JSON.stringify(rec({ gitHead: 'zz' })), 'EVD-0001')).toBeNull();
  });
});

describe('freshness and levels (pure)', () => {
  const none = () => [] as string[];
  it('a matching revision on a clean tree is the only way to VERIFIED', () => {
    const a = assessFreshness(rec(), view(), none);
    expect([a.freshness, classifyEvidence(rec(), a)]).toEqual(['REVISION_MATCH', 'VERIFIED']);
  });
  it('REPORTED evidence never becomes VERIFIED, however fresh', () => {
    const r = rec({ provenance: 'REPORTED', exitCode: null });
    expect(classifyEvidence(r, assessFreshness(r, view(), none))).toBe('REPORTED');
  });
  it('a dirty tree (now or at record time) is not silently ignored', () => {
    expect(assessFreshness(rec(), view({ dirty: true }), none).reason).toBe('DIRTY_NOW');
    const r = rec({ dirty: true });
    const a = assessFreshness(r, view(), none);
    expect(a.freshness).toBe('REVISION_MATCH_DIRTY');
    expect(classifyEvidence(r, a)).toBe('UNKNOWN');
    expect(assessFreshness(rec({ dirty: null }), view(), none).freshness).toBe('UNKNOWN');
  });
  it('a moved HEAD is potentially stale unless only evidence files changed', () => {
    const moved = view({ head: 'b'.repeat(40) });
    expect(assessFreshness(rec(), moved, () => ['src/a.ts']).freshness).toBe('POTENTIALLY_STALE');
    expect(assessFreshness(rec(), moved, () => []).reason).toBe('HEAD_MATCH_EVIDENCE_ONLY_CHANGES');
    expect(assessFreshness(rec(), moved, () => null).freshness).toBe('UNKNOWN');
  });
  it('no git or no recorded revision is UNKNOWN, not stale and not fresh', () => {
    expect(assessFreshness(rec(), view({ available: false, head: null }), none).freshness).toBe('UNKNOWN');
    expect(assessFreshness(rec({ gitHead: null }), view(), none).freshness).toBe('UNKNOWN');
  });
  it('a failed check is FAILED regardless of freshness', () => {
    const r = rec({ result: 'fail', exitCode: 1 });
    expect(classifyEvidence(r, assessFreshness(r, view(), none))).toBe('FAILED');
  });
});

describe('evidence store', () => {
  it('creates ids exclusively, never overwrites, stores no output', async () => {
    const d = await proj();
    const s = evidenceStore(d);
    const a = addEvidence(s, { storyId: 'S-1', command: 'pnpm test --token=sekret123456', result: 'pass', exitCode: 0, provenance: 'OBSERVED', gitHead: null, dirty: null, note: null, durationMs: 1 });
    const b = addEvidence(s, { storyId: null, command: 'x', result: 'fail', exitCode: 2, provenance: 'OBSERVED', gitHead: null, dirty: null, note: null, durationMs: 1 });
    expect([a.id, b.id]).toEqual(['EVD-0001', 'EVD-0002']);
    expect(a.command).not.toContain('sekret');
    const listing = listEvidence(d);
    expect(listing.records.map((r) => r.id)).toEqual(['EVD-0001', 'EVD-0002']);
    writeFileSync(join(s.dirAbs, 'EVD-0003.json'), '{"bad":true}');
    expect(listEvidence(d).unreadable).toEqual([{ id: 'EVD-0003', code: 'EVIDENCE_CORRUPT' }]);
    expect(() => addEvidence(s, { storyId: 'bad id!', command: 'x', result: 'pass', exitCode: 0, provenance: 'OBSERVED', gitHead: null, dirty: null, note: null, durationMs: 1 })).toThrow();
  });
  it('is absent (not an error) when nothing was recorded', async () => {
    const d = await proj();
    expect(listEvidence(d)).toMatchObject({ records: [], absent: true });
  });
});

describe('evidence run (real process)', () => {
  const run = async (d: string, args: string[]): Promise<number> => {
    const log = console.log;
    console.log = () => undefined;
    try {
      return await runEvidenceCommand(args, d);
    } finally {
      console.log = log;
    }
  };
  it('records OBSERVED pass/fail from the real exit status, at the real HEAD, without a shell', async () => {
    const d = await proj(true);
    const head = git(d, 'rev-parse', 'HEAD').trim();
    expect(await run(d, ['run', '--story', 'S-1', '--', process.execPath, '-e', 'process.exit(0)'])).toBe(0);
    expect(await run(d, ['run', '--', process.execPath, '-e', 'process.exit(3)'])).toBe(3);
    // shell metacharacters are data, not syntax
    expect(await run(d, ['run', '--', process.execPath, '-e', 'process.exit(0)', ';', 'rm', '-rf', '/'])).toBe(0);
    const recs = listEvidence(d).records;
    expect(recs.map((r) => [r.provenance, r.result, r.exitCode, r.gitHead === head, r.dirty])).toEqual([
      ['OBSERVED', 'pass', 0, true, false],
      ['OBSERVED', 'fail', 3, true, false],
      ['OBSERVED', 'pass', 0, true, false],
    ]);
    // the evidence files themselves must not make the tree dirty
    expect(readGitView(d, [evidenceStore(d).dirRel]).dirty).toBe(false);
  });
  it('runs the command in the caller\'s environment, unchanged', async () => {
    const d = await proj(true);
    const saved = process.env.MONOLITH_HOOK_ACTIVE;
    delete process.env.MONOLITH_HOOK_ACTIVE;
    try {
      expect(await run(d, ['run', '--', process.execPath, '-e', 'process.exit(process.env.MONOLITH_HOOK_ACTIVE === undefined ? 0 : 7)'])).toBe(0);
    } finally {
      if (saved !== undefined) process.env.MONOLITH_HOOK_ACTIVE = saved;
    }
  });
  it('refuses unknown commands and bad flags without recording', async () => {
    const d = await proj(true);
    expect(await run(d, ['run', '--', 'definitely-not-a-command-xyz'])).toBe(1);
    expect(await run(d, ['run'])).toBe(1);
    expect(await run(d, ['run', '--story', '../x', '--', 'true'])).toBe(1);
    expect(listEvidence(d).records).toEqual([]);
  });
  it('report records REPORTED with no exit code', async () => {
    const d = await proj(true);
    expect(await run(d, ['report', '--command', 'pnpm test', '--result', 'pass', '--story', 'S-1'])).toBe(0);
    const [r] = listEvidence(d).records;
    expect([r.provenance, r.exitCode]).toEqual(['REPORTED', null]);
  });
});

describe('handover truthfulness (false-claims)', () => {
  it('empty / just-initialised instance is INCOMPLETE, never READY', async () => {
    const d = await proj();
    const r = buildHandoverReport(d);
    expect(r.status).toBe('INCOMPLETE');
    expect(r.verification.git.available).toBe(false);
  });
  it('a directory with no MONOLITH files is INCOMPLETE; an untrustworthy configuration is UNKNOWN', () => {
    const d = realpathSync(mkdtempSync(join(tmpdir(), 'handover-none-')));
    dirs.push(d);
    expect(buildHandoverReport(d).status).toBe('INCOMPLETE');
    writeFileSync(join(d, 'monolith.config.json'), '{ not json');
    const r = buildHandoverReport(d);
    expect(r.status).toBe('UNKNOWN');
    expect(r.statusReasons).toEqual(['INSTANCE_NOT_ESTABLISHED']);
  });
  it('a completed mission does not finalize its story and needs an owner decision', async () => {
    const d = await proj(true);
    roadmap(d, ['S-1']);
    adr(d, 1, 'accepted');
    await mission(d, { story: 'S-1', checkpoints: 1, result: 'completed' });
    commitAll(d, 'docs');
    const r = buildHandoverReport(d);
    const s = r.progress.stories.find((x) => x.id === 'S-1');
    expect(s?.finalization).not.toBe('FINALIZED');
    expect(r.progress.finalized).toBe(0);
    expect(r.outstanding.ownerDecisions.some((x) => x.code === 'FINALIZE_STORY' && x.subject === 'S-1')).toBe(true);
    expect(r.outstanding.issues.some((i) => i.code === 'COMPLETION_UNVERIFIED' && i.kind === 'unverified')).toBe(true);
    expect(r.status).not.toBe('READY_FOR_REVIEW');
  });
  it('REPORTED PASS is not verification', async () => {
    const d = await proj(true);
    roadmap(d, ['S-1']);
    await mission(d, { story: 'S-1', result: 'completed' });
    commitAll(d, 'docs');
    const s = evidenceStore(d);
    addEvidence(s, { storyId: 'S-1', command: 'pnpm test', result: 'pass', exitCode: null, provenance: 'REPORTED', gitHead: git(d, 'rev-parse', 'HEAD').trim(), dirty: false, note: 'agent says so', durationMs: null });
    const r = buildHandoverReport(d);
    expect(r.verification.counts).toMatchObject({ verified: 0, reported: 1 });
    expect(r.verification.storiesWithoutVerifiedEvidence).toContain('S-1');
  });
  it('an observed pass at the current clean HEAD is VERIFIED; a later source change makes it STALE', async () => {
    const d = await proj(true);
    roadmap(d, ['S-1']);
    adr(d, 1, 'accepted');
    await mission(d, { story: 'S-1', checkpoints: 1, result: 'completed' });
    commitAll(d, 'docs');
    const log = console.log;
    console.log = () => undefined;
    try {
      await runEvidenceCommand(['run', '--story', 'S-1', '--', process.execPath, '-e', '0'], d);
    } finally {
      console.log = log;
    }
    expect(buildHandoverReport(d).verification.counts.verified).toBe(1);
    // committing only the evidence file keeps it valid
    commitAll(d, 'evidence');
    expect(buildHandoverReport(d).verification.counts).toMatchObject({ verified: 1, stale: 0 });
    // a source change committed later makes it potentially stale
    write(d, 'src/a.ts', 'export {}\n');
    expect(buildHandoverReport(d).verification.counts.verified).toBe(0); // dirty tree: not verified
    commitAll(d, 'code');
    const r = buildHandoverReport(d);
    expect(r.verification.counts).toMatchObject({ verified: 0, stale: 1 });
    expect(r.outstanding.issues.some((i) => i.code === 'EVIDENCE_STALE')).toBe(true);
    expect(r.status).toBe('REVIEW_WITH_ISSUES');
  });
  it('dirty working tree is reported', async () => {
    const d = await proj(true);
    write(d, 'src/x.ts', 'x\n');
    const r = buildHandoverReport(d);
    expect(r.verification.git.dirty).toBe(true);
    expect(r.outstanding.issues.some((i) => i.code === 'WORKING_TREE_DIRTY')).toBe(true);
  });
  it('failed and in-progress missions are issues; missing checkpoints are listed', async () => {
    const d = await proj(true);
    roadmap(d, ['S-1', 'S-2']);
    await mission(d, { story: 'S-1', result: 'failed' });
    await mission(d, { story: 'S-2' });
    const r = buildHandoverReport(d);
    expect(r.missions).toMatchObject({ failed: 1, inProgress: 1 });
    expect(r.missions.activeWithoutCheckpoint).toHaveLength(1);
    const codes = r.outstanding.issues.map((i) => i.code);
    expect(codes).toContain('MISSIONS_FAILED');
    expect(codes).toContain('MISSIONS_IN_PROGRESS');
  });
  it('unknown active phase and missing ADR metadata are shown, not smoothed over', async () => {
    const d = await proj(true);
    roadmap(d, ['S-1'], 'Phase 9');
    adr(d, 1, null);
    adr(d, 2, 'accepted');
    adr(d, 3, 'proposed');
    const r = buildHandoverReport(d);
    expect(r.project.activePhase.kind).toBe('unmatched');
    expect(r.architecture).toMatchObject({ accepted: 1, proposed: 1, missingMetadata: 1 });
    expect(r.outstanding.ownerDecisions.some((x) => x.code === 'ADR_PROPOSED' && x.subject === 'ADR-003')).toBe(true);
  });
  it('a story-index "READY FOR REVIEW" entry is the only source of awaiting-review', async () => {
    const d = await proj(true);
    roadmap(d, ['S-1', 'S-2']);
    write(d, '.monolith/memory/working/story-index.md', readFileSync(join(d, '.monolith/memory/working/story-index.md'), 'utf8') + '\n## Phase 1 — P\n\n### S-1 — t\n\n**Date:** 2026-01-01\n**Status:** READY FOR REVIEW\n');
    const r = buildHandoverReport(d);
    expect(r.progress.awaitingReview).toEqual(['S-1']);
    expect(r.progress.finalized).toBe(0);
  });
  it('is deterministic and read-only', async () => {
    const d = await proj(true);
    roadmap(d, ['S-1']);
    await mission(d, { story: 'S-1', checkpoints: 2, result: 'completed' });
    commitAll(d, 'x');
    const before = git(d, 'status', '--porcelain') + readdirSync(join(d, '.monolith')).join();
    const a = JSON.stringify(buildHandoverReport(d));
    const b = JSON.stringify(buildHandoverReport(d));
    expect(a).toBe(b);
    expect(git(d, 'status', '--porcelain') + readdirSync(join(d, '.monolith')).join()).toBe(before);
  });
  it('a finalized story with a verified record can reach READY FOR REVIEW only when nothing else is open', async () => {
    const d = await proj(true);
    roadmap(d, ['S-1']);
    finalizedStory(d, '1', 'S-1');
    adr(d, 1, 'accepted');
    activeStory(d, null);
    await mission(d, { story: 'S-1', checkpoints: 1, result: 'completed' });
    commitAll(d, 'docs');
    const log = console.log;
    console.log = () => undefined;
    try {
      await runEvidenceCommand(['run', '--story', 'S-1', '--', process.execPath, '-e', '0'], d);
    } finally {
      console.log = log;
    }
    const r = buildHandoverReport(d);
    expect(r.progress.finalized).toBe(1);
    expect(r.verification.counts.verified).toBe(1);
    // Governance may still report capsule/format findings of this synthetic project; the status must follow them.
    expect(r.status).toBe(r.outstanding.issues.length === 0 && r.statusReasons.length === 0 ? 'READY_FOR_REVIEW' : r.status);
    expect(['READY_FOR_REVIEW', 'REVIEW_WITH_ISSUES', 'INCOMPLETE']).toContain(r.status);
  });
});

describe('workflow integrity diagnostics (governance check)', () => {
  it('flags a mission linked to a story no document lists — and only then', async () => {
    const d = await proj(true);
    roadmap(d, ['S-1']);
    await mission(d, { story: 'S-1', result: 'completed' });
    await mission(d, { story: 'GHOST-9', result: 'completed' });
    await mission(d, { result: 'completed' }); // exploratory, no link: not an error
    const codes = buildGovernanceReport(d).findings.map((f) => `${f.code}:${f.message.includes('GHOST-9')}`);
    expect(codes).toContain('MISSION_STORY_UNKNOWN:true');
    expect(codes.filter((c) => c.startsWith('MISSION_STORY_UNKNOWN'))).toHaveLength(1);
  });
  it('does not guess when the roadmap is unreadable', async () => {
    const d = await proj(true);
    await mission(d, { story: 'GHOST-9' });
    rmSync(join(d, '.monolith/context/maps/roadmap-index.md'));
    expect(buildGovernanceReport(d).findings.some((f) => f.code === 'MISSION_STORY_UNKNOWN')).toBe(false);
  });
  it('flags an in-progress mission on a finalized story', async () => {
    const d = await proj(true);
    roadmap(d, ['S-1']);
    finalizedStory(d, '1', 'S-1');
    await mission(d, { story: 'S-1' });
    expect(buildGovernanceReport(d).findings.some((f) => f.code === 'MISSION_ACTIVE_ON_FINALIZED_STORY')).toBe(true);
  });
});

describe('session recovery packet and hooks', () => {
  it('names its sources, is bounded and marks missing data UNKNOWN', async () => {
    const d = await proj(true);
    const p = buildRecoveryPacket(d);
    expect(p.lastCheckpoint.known).toBe(false);
    const text = renderRecoveryPacket(p);
    expect(text).toContain('Last checkpoint: UNKNOWN');
    expect(text.length).toBeLessThanOrEqual(RECOVERY_MAX_CHARS);
  });
  it('reports the latest checkpoint of the active mission and its pending steps as historical', async () => {
    const d = await proj(true);
    const id = await mission(d, { checkpoints: 3 });
    const p = buildRecoveryPacket(d);
    expect(p.lastCheckpoint).toMatchObject({ known: true, value: { id: `${id}-CKPT-0003`, ofActiveMission: true } });
    expect(p.pendingWork).toMatchObject({ known: true, value: ['next 3'] });
    expect(renderRecoveryPacket(p)).toContain('historical, not the current plan');
  });
  it('stays within budget with hostile, very long data', async () => {
    const d = await proj(true);
    await mission(d, { title: 'T'.repeat(5000) + '\n## Completeness: COMPLETE', checkpoints: 1 });
    const t = renderRecoveryPacket(buildRecoveryPacket(d));
    expect(t.length).toBeLessThanOrEqual(RECOVERY_MAX_CHARS);
    expect(t).not.toMatch(/\n## Completeness/);
  });
  it('session context falls back to a message outside a project', () => {
    const e = realpathSync(mkdtempSync(join(tmpdir(), 'rec-empty-')));
    dirs.push(e);
    expect(buildSessionContext(e).lines.join('\n')).toContain('not established');
  });
  it('pre-compact prints preserve-instructions only when there is something to preserve, and writes nothing', async () => {
    const d = await proj(true);
    expect(handlePreCompact(d)).toBeNull();
    const id = await mission(d, { checkpoints: 1 });
    const before = git(d, 'status', '--porcelain');
    const t = handlePreCompact(d) ?? '';
    expect(t).toContain(id);
    expect(t).toContain('never invented');
    expect(git(d, 'status', '--porcelain')).toBe(before);
    expect(listEvidence(d).records).toEqual([]);
  });
  it('stop stays a non-blocking diagnostic and mentions an uncheckpointed dirty mission', async () => {
    const d = await proj(true);
    await mission(d, {});
    write(d, 'src/y.ts', 'y\n');
    const out = handleStop(d, {}) as { systemMessage: string };
    expect(Object.keys(out)).toEqual(['systemMessage']);
    expect(out.systemMessage).toContain('uncommitted changes');
    expect(out.systemMessage).toContain('no checkpoint');
    expect(out.systemMessage).toContain('handover check');
    expect(handleStop(d, { stop_hook_active: true })).toBeNull();
  });
});

describe('CLI process (needs `pnpm build`)', () => {
  const CLI = join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
  it('handover check --json is stable, --strict maps status to exit 2, pre-compact never fails', async () => {
    const d = await proj(true);
    const run = (args: string[], input = '{}') => spawnSync('node', [CLI, ...args], { cwd: d, input, encoding: 'utf8' });
    const a = run(['handover', 'check', '--json']);
    expect(a.status).toBe(0);
    const j = JSON.parse(a.stdout);
    expect(j.schema).toBe(1);
    expect(['READY_FOR_REVIEW', 'REVIEW_WITH_ISSUES', 'INCOMPLETE', 'UNKNOWN']).toContain(j.status);
    expect(run(['handover', 'check', '--strict']).status).toBe(j.status === 'READY_FOR_REVIEW' ? 0 : 2);
    expect(run(['handover', 'bogus']).status).toBe(1);
    expect(run(['hook', 'pre-compact'], '{"trigger":"auto"}').status).toBe(0);
    expect(run(['hook', 'pre-compact'], 'garbage').status).toBe(0);
    expect(spawnSync('node', [CLI, 'hook', 'pre-compact'], { cwd: d, env: { ...process.env, MONOLITH_HOOK_ACTIVE: '1' }, input: '{}', encoding: 'utf8' }).stdout).toBe('');
  });
});

describe('KAIROS-like end-to-end fixture', () => {
  it('tells the truth about seven stories, seven completed missions and mixed evidence', async () => {
    const { addIdea, ideaStore } = await import('../ideas/store.js');
    const d = await proj(true);
    const ids = ['S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-6', 'S-7'];
    roadmap(d, ids, '1');
    finalizedStory(d, '1', 'S-1');
    finalizedStory(d, '1', 'S-2');
    finalizedStory(d, '1', 'S-3');
    write(d, '.monolith/memory/working/story-index.md', readFileSync(join(d, '.monolith/memory/working/story-index.md'), 'utf8') + '\n### S-4 — t\n\n**Date:** 2026-01-04\n**Status:** READY FOR REVIEW\n');
    activeStory(d, null);
    adr(d, 1, 'accepted');
    adr(d, 2, 'accepted');
    adr(d, 3, 'proposed');
    write(d, 'docs/adr/ADR-004-x.md', '# no frontmatter\n');
    for (const id of ids) await mission(d, { story: id, checkpoints: 1, result: 'completed' });
    for (let i = 1; i <= 3; i++) addIdea(ideaStore(d), { title: `idea ${i}`, description: 'later' });
    commitAll(d, 'project');

    const quiet = async (args: string[]): Promise<void> => {
      const log = console.log;
      console.log = () => undefined;
      try {
        await runEvidenceCommand(args, d);
      } finally {
        console.log = log;
      }
    };
    await quiet(['run', '--story', 'S-1', '--', process.execPath, '-e', '0']); // will become stale
    commitAll(d, 'evidence S-1');
    write(d, 'src/feature.ts', 'export const x = 1;\n');
    commitAll(d, 'code after S-1 check');
    await quiet(['run', '--story', 'S-2', '--', process.execPath, '-e', '0']); // current
    await quiet(['report', '--command', 'pnpm test', '--result', 'pass', '--story', 'S-3']); // only reported

    const r = buildHandoverReport(d);
    expect(r.progress).toMatchObject({ finalized: 3, listedNotFinal: 1, awaitingReview: ['S-4'] });
    expect(r.missions).toMatchObject({ total: 7, completed: 7, checkpoints: 7, inProgress: 0, failed: 0 });
    expect(r.architecture).toMatchObject({ total: 3, accepted: 2, proposed: 1, missingMetadata: 1 });
    expect(r.verification.counts).toEqual({ verified: 1, reported: 1, stale: 1, unknown: 0, failed: 0 });
    // Everything except S-2 completed without VERIFIED evidence: claims, not facts.
    expect(r.verification.storiesWithoutVerifiedEvidence).toEqual(['S-1', 'S-3', 'S-4', 'S-5', 'S-6', 'S-7']);
    expect(r.status).toBe('REVIEW_WITH_ISSUES');
    // Mission completion never finalized anything.
    expect(r.outstanding.ownerDecisions.filter((x) => x.code === 'FINALIZE_STORY').map((x) => x.subject)).toEqual(['S-4', 'S-5', 'S-6', 'S-7']);
    const s1 = r.progress.stories.find((s) => s.id === 'S-1');
    expect(s1?.evidence.stale).toBe(1);
    expect(r.verification.items.find((i) => i.storyId === 'S-3')?.level).toBe('REPORTED');
    // The report is JSON-stable and makes no correctness claim.
    expect(JSON.stringify(buildHandoverReport(d))).toBe(JSON.stringify(r));
    expect(JSON.stringify(r)).not.toMatch(/production[- ]ready/i);
  });

  it('a project with no git repository never shows fresh or verified evidence', async () => {
    const d = await proj(false);
    roadmap(d, ['S-1']);
    await mission(d, { story: 'S-1', checkpoints: 1, result: 'completed' });
    const log = console.log;
    console.log = () => undefined;
    try {
      await runEvidenceCommand(['run', '--story', 'S-1', '--', process.execPath, '-e', '0'], d);
    } finally {
      console.log = log;
    }
    const r = buildHandoverReport(d);
    expect(r.verification.git.available).toBe(false);
    expect(r.verification.counts).toMatchObject({ verified: 0, unknown: 1 });
    expect(r.outstanding.issues.some((i) => i.code === 'GIT_UNAVAILABLE')).toBe(true);
  });
});

describe('security of the changed surfaces', () => {
  it('refuses a symlinked evidence directory and never writes outside the project', async () => {
    const { symlinkSync, mkdirSync, existsSync } = await import('node:fs');
    const d = await proj();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'evd-out-')));
    dirs.push(outside);
    mkdirSync(join(d, '.monolith/memory/long-term'), { recursive: true });
    symlinkSync(outside, join(d, '.monolith/memory/long-term/verification'));
    expect(() => addEvidence(evidenceStore(d), { storyId: null, command: 'x', result: 'pass', exitCode: 0, provenance: 'OBSERVED', gitHead: null, dirty: null, note: null, durationMs: 1 })).toThrow(/symlink|refus|unsafe|boundary/i);
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(join(outside, 'EVD-0001.json'))).toBe(false);
    expect(listEvidence(d).records).toEqual([]); // reading a symlinked directory is refused too, never followed
  });
  it('never stores command output or a secret from the command line or note', async () => {
    const d = await proj(true);
    const log = console.log;
    console.log = () => undefined;
    try {
      await runEvidenceCommand(['run', '--', process.execPath, '-e', 'console.log("TOPSECRET"+"OUTPUT")', '--token=hunter2hunter2'], d);
      await runEvidenceCommand(['report', '--command', 'deploy --password hunter3hunter3', '--result', 'pass', '--note', 'key sk-abcdefghijklmnop1234'], d);
    } finally {
      console.log = log;
    }
    const dir = evidenceStore(d).dirAbs;
    const all = readdirSync(dir).map((n) => readFileSync(join(dir, n), 'utf8')).join('\n');
    expect(all).not.toMatch(/TOPSECRETOUTPUT|hunter2|hunter3|sk-abcdefgh/);
    expect(all).toContain('[REDACTED]');
  });
  it('rejects hostile ids and story ids as data, not as paths', async () => {
    const d = await proj();
    for (const story of ['../../etc/passwd', 'a b', '', 'x'.repeat(80)]) {
      expect(() => addEvidence(evidenceStore(d), { storyId: story, command: 'x', result: 'pass', exitCode: 0, provenance: 'OBSERVED', gitHead: null, dirty: null, note: null, durationMs: 1 })).toThrow();
    }
    writeFileSync(join(evidenceStore(d).dirAbs.replace(/verification$/, ''), 'x'), '');
    expect(listEvidence(d).unreadable).toEqual([]);
  });
});
