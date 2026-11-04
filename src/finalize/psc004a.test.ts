/**
 * PSC-004A — "No active story" next to a structural `**Story:**` field is a
 * contradiction. The Brief must not read it as a confirmed `none`, and DOCSYNC
 * must not finalize it (neither as the story nor as "none"). Synthetic fixtures only.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldInstance } from '../init/scaffold.js';
import { activeStoryIdentity, applyFinalization, planFinalization } from './core.js';
import { parseProposal, type FinalizationProposal } from './proposal.js';
import { evaluateFreshness, parseActiveStoryClaim, type FreshnessEvidence } from '../brief/freshness.js';
import { reconcile } from '../brief/reconcile.js';
import type { ProjectConfig } from '../init/types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const F = '```';
const CONTRADICTORY = 'No active story recorded.\n\n**Story:** S-1';
const CONFIG: ProjectConfig = { projectName: 'fin-psc4a', language: 'typescript', packageManager: 'pnpm', aiTool: 'claude', finalizationProtocol: 'finalize-story', protocols: ['finalize-story'], monolithRoot: '.monolith' };
const W = '.monolith/memory/working/';
const EV = (story: string): string => `---\ntype: working\n---\n\n**Status:** PASS\n**Date:** 2026-11-02\n**Story:** ${story}\n`;
const doc = (current: string): string => `# Active\n\n## Current Story\n\n${current}\n\n---\n\n## Last Finalization\n\nNo finalization recorded yet.\n\n---\n`;

async function instance(id: string, active: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-psc4a-'));
  dirs.push(dir);
  await scaffoldInstance(dir, CONFIG);
  writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify(CONFIG, null, 2));
  writeFileSync(join(dir, W + 'integrity-result.md'), EV(id));
  writeFileSync(join(dir, W + 'governance-result.md'), EV(id));
  writeFileSync(join(dir, W + 'active.md'), active);
  return dir;
}

function proposal(id: string): FinalizationProposal {
  const r = parseProposal({
    schemaVersion: 1,
    story: { id, title: 'T', phase: 'phase-1', phaseHeading: 'Phase 1 — T', slug: `story-${id.toLowerCase()}`, date: '2026-11-02' },
    expectedCurrentStory: { contains: id },
    work: { objective: 'o', implementationSummary: 'i', filesChanged: ['a'], tests: 't', keyDecisions: 'k', adrs: [], lessons: 'l' },
    summary: 's',
    keyOutputs: ['x'],
    history: { phaseName: 'P', decision: 'd', build: 'b' },
  });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.proposal;
}
const check = (dir: string, p: FinalizationProposal) => planFinalization(dir, p).checks.find((c) => c.id === 'expected-state')!;

const base: FreshnessEvidence = {
  git: { status: 'ok', lastStateUpdate: { sha: 'a'.repeat(40), date: '2026-11-01T00:00:00Z' }, commitsSince: [], truncated: false },
  activeStory: { kind: 'unknown' },
  roadmapActiveStory: null,
  roadmapStatuses: new Map(),
  storyIndexStatuses: new Map(),
  recordedText: '',
  stateFiles: new Set(),
};

describe('PSC-004A Brief: "no active story" + **Story:** field', () => {
  it('is not a confirmed none (nor an identity) in either reader', () => {
    const claim = parseActiveStoryClaim(CONTRADICTORY);
    expect(claim.kind).toBe('unknown');
    expect(claim).toEqual({ kind: 'unknown', contradiction: ['S-1'] });
    expect(activeStoryIdentity(CONTRADICTORY).ok).toBe(false);
  });

  it.each([
    ['duplicate fields', 'No active story.\n**Story:** S-1\n**Story:** S-2'],
    ['malformed field', 'No active story.\n**Story:** — none'],
    ['CRLF', 'No active story recorded.\r\n\r\n**Story:** S-1\r\n'],
    ['leading comment before the declaration', '<!-- note -->\nNo active story recorded.\n**Story:** S-1'],
  ])('%s → contradiction, never none', (_n, body) => {
    const claim = parseActiveStoryClaim(body);
    expect(claim.kind).toBe('unknown');
    expect(claim.kind === 'unknown' && claim.contradiction !== undefined).toBe(true);
    expect(activeStoryIdentity(body).ok).toBe(false);
  });

  it('a field hidden in a fence or comment is not a contradiction: plain none stays none', () => {
    expect(parseActiveStoryClaim(`No active story recorded.\n${F}\n**Story:** S-1\n${F}`)).toEqual({ kind: 'none' });
    expect(parseActiveStoryClaim('No active story recorded.\n<!-- **Story:** S-1 -->')).toEqual({ kind: 'none' });
    expect(parseActiveStoryClaim('No active story recorded.\n\nPrevious recorded story: **S-0 — t** (COMPLETED 2026-10-01)')).toEqual({ kind: 'none' });
  });

  it('ordinary forms keep working', () => {
    expect(parseActiveStoryClaim('No active story recorded.')).toEqual({ kind: 'none' });
    expect(parseActiveStoryClaim('**Story:** S-1 — title')).toEqual({ kind: 'ids', ids: ['S-1'] });
    expect(parseActiveStoryClaim('**Story:** S-1 — title\n\nNo active story was planned before this one.')).toEqual({ kind: 'ids', ids: ['S-1'] });
  });

  it('Freshness: STALE with a named STATE_CONTRADICTION, never FRESH even with clean git', () => {
    const clean = evaluateFreshness({ ...base, activeStory: parseActiveStoryClaim('No active story recorded.') });
    expect(clean.status).toBe('FRESH');
    const r = evaluateFreshness({ ...base, activeStory: parseActiveStoryClaim(CONTRADICTORY) });
    expect(r.status).toBe('STALE');
    expect(r.activeStory).toBe('unknown');
    const c = r.reasons.find((x) => x.code === 'STATE_CONTRADICTION');
    expect(c?.message).toContain('"S-1"');
    expect(c?.documents).toEqual(['active.md']);
  });

  it('existing contradictions are preserved alongside it', () => {
    const r = evaluateFreshness({ ...base, activeStory: parseActiveStoryClaim(CONTRADICTORY), roadmapStatuses: new Map([['X-001', 'DONE']]), storyIndexStatuses: new Map([['X-001', 'IN_PROGRESS']]) });
    expect(r.reasons.filter((x) => x.code === 'STATE_CONTRADICTION')).toHaveLength(2);
    const none = evaluateFreshness({ ...base, activeStory: { kind: 'none' }, roadmapActiveStory: 'S-9' });
    expect(none.status).toBe('STALE');
  });

  it('Reconcile reports it as a confirmed mismatch and the active story as unknown', () => {
    const ev: FreshnessEvidence = { ...base, activeStory: parseActiveStoryClaim(CONTRADICTORY) };
    const report = reconcile(ev, evaluateFreshness(ev));
    expect(report.findings.some((f) => f.kind === 'confirmed' && f.code === 'STATE_CONTRADICTION')).toBe(true);
    expect(report.findings.some((f) => f.code === 'ACTIVE_STORY_UNKNOWN')).toBe(true);
  });
});

describe('PSC-004A DOCSYNC: a contradictory Current Story cannot be finalized', () => {
  it('as the named story: NOT_READY, apply REFUSED, active.md untouched', async () => {
    const dir = await instance('S-1', doc(CONTRADICTORY));
    const p = proposal('S-1');
    const before = readFileSync(join(dir, W + 'active.md'), 'utf8');
    const c = check(dir, p);
    expect(c.status).toBe('FAIL');
    expect(c.detail).toContain('contradictory');
    const pl = planFinalization(dir, p);
    expect(pl.status).toBe('NOT_READY');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('REFUSED');
    expect(readFileSync(join(dir, W + 'active.md'), 'utf8')).toBe(before);
  });

  it.each([
    ['valid field', CONTRADICTORY],
    ['duplicate fields', 'No active story.\n**Story:** S-1\n**Story:** S-2'],
    ['malformed field', 'No active story.\n**Story:** — none'],
  ])('as expected "none" (%s): FAIL, nothing written', async (_n, body) => {
    const dir = await instance('S-1', doc(body));
    const p = { ...proposal('S-1'), expectedCurrentStory: 'none' as const };
    const before = readFileSync(join(dir, W + 'active.md'), 'utf8');
    const c = check(dir, p);
    expect(c.status).toBe('FAIL');
    expect(c.detail).toContain('contradictory');
    const pl = planFinalization(dir, p);
    expect(pl.status).toBe('NOT_READY');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('REFUSED');
    expect(readFileSync(join(dir, W + 'active.md'), 'utf8')).toBe(before);
  });

  it('plain "No active story" still satisfies expected "none"; plain **Story:** still finalizes', async () => {
    const none = await instance('S-1', doc('No active story recorded.'));
    expect(check(none, { ...proposal('S-1'), expectedCurrentStory: 'none' as const }).status).toBe('PASS');
    const fenced = await instance('S-1', doc(`No active story recorded.\n${F}\n**Story:** S-1\n${F}`));
    expect(check(fenced, { ...proposal('S-1'), expectedCurrentStory: 'none' as const }).status).toBe('PASS');

    const dir = await instance('S-1', doc('**Story:** S-1 — real'));
    const p = proposal('S-1');
    const pl = planFinalization(dir, p);
    expect(pl.status).toBe('READY');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('FINALIZED');
  });
});
