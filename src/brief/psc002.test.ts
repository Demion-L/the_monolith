/**
 * PSC-002 — Parser contract consistency & diagnostic integrity.
 *
 * Synthetic fixtures only. Each block states the invariant it pins.
 *   INV-1/2  structural identity wins; free text never promotes a story
 *   INV-3    code fences and HTML comments carry no structural claims
 *   INV-4    idea ids (IDEA-NNN) are not work items
 *   INV-5    unknown is not stale
 *   INV-6    real contradictions are preserved
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
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
} from './freshness.js';
import { reconcile } from './reconcile.js';
import { collect } from './collect.js';

const FENCE = '```';

const LAST = { sha: 'a'.repeat(40), date: '2000-01-02T00:00:00+00:00' };
const STATE_FILES = new Set(['.monolith/memory/working/active.md', '.monolith/context/maps/roadmap-index.md']);

function evidence(overrides: Partial<FreshnessEvidence> = {}): FreshnessEvidence {
  return {
    git: { status: 'ok', lastStateUpdate: LAST, commitsSince: [], truncated: false },
    activeStory: { kind: 'none' },
    roadmapActiveStory: null,
    roadmapStatuses: new Map(),
    storyIndexStatuses: new Map(),
    recordedText: '',
    stateFiles: STATE_FILES,
    ...overrides,
  };
}

const contradictionsOf = (ev: FreshnessEvidence) => evaluateFreshness(ev).reasons.filter((r) => r.code === 'STATE_CONTRADICTION');

// ---------------------------------------------------------------------------
// INV-1 / INV-2 — structural identity
// ---------------------------------------------------------------------------

describe('PSC-002 structural story identity (INV-1, INV-2)', () => {
  const body = (id: string, other: string) =>
    [`**Story:** ${id}`, '', `История ${other} уже завершена.`, '', `${FENCE}text`, 'STORY-010', FENCE, '', '<!-- STORY-020 -->'].join('\n');

  it('takes the id of the single **Story:** field, not ids found in prose, fences or comments', () => {
    expect(parseActiveStoryClaim(body('STORY-002', 'STORY-001'))).toEqual({ kind: 'ids', ids: ['STORY-002'] });
  });

  it('accepts the short DOCSYNC id grammar (S-2), which the free-text extractor could never see', () => {
    expect(parseActiveStoryClaim(body('S-2', 'S-1'))).toEqual({ kind: 'ids', ids: ['S-2'] });
  });

  it('takes only the first token of the field line (title ids are not identity)', () => {
    expect(parseActiveStoryClaim('**Story:** WIDGET-002 — follow-up to WIDGET-001')).toEqual({ kind: 'ids', ids: ['WIDGET-002'] });
  });

  it('a completed story merely mentioned in prose is NOT a STATE_CONTRADICTION', () => {
    const claim = parseActiveStoryClaim(body('STORY-002', 'STORY-001'));
    const ev = evidence({
      activeStory: claim,
      roadmapStatuses: new Map([['STORY-001', 'COMPLETED'], ['STORY-002', 'IN PROGRESS']]),
      storyIndexStatuses: new Map([['STORY-001', 'COMPLETED']]),
    });
    expect(contradictionsOf(ev)).toEqual([]);
    expect(evaluateFreshness(ev).status).toBe('FRESH');
  });

  it('S-1/S-10 are distinct ids (no prefix confusion)', () => {
    const claim = parseActiveStoryClaim(body('S-10', 'S-1'));
    expect(claim).toEqual({ kind: 'ids', ids: ['S-10'] });
    const ev = evidence({ activeStory: claim, roadmapStatuses: new Map([['S-1', 'COMPLETED']]) });
    expect(contradictionsOf(ev)).toEqual([]);
  });

  it('duplicate or conflicting **Story:** fields → unknown (fail closed, as DOCSYNC does)', () => {
    expect(parseActiveStoryClaim('**Story:** STORY-002\n**Story:** STORY-002')).toEqual({ kind: 'unknown' });
    expect(parseActiveStoryClaim('**Story:** STORY-002\n**Story:** STORY-003')).toEqual({ kind: 'unknown' });
  });

  it('malformed **Story:** field → unknown, never a guess from the rest of the text', () => {
    expect(parseActiveStoryClaim('**Story:** — see STORY-001')).toEqual({ kind: 'unknown' });
  });

  it('a **Story:** line inside a fence or comment is not identity', () => {
    expect(parseActiveStoryClaim(`${FENCE}\n**Story:** STORY-009\n${FENCE}\n<!--\n**Story:** STORY-008\n-->`)).toEqual({ kind: 'unknown' });
  });
});

// ---------------------------------------------------------------------------
// INV-5 / historical documents
// ---------------------------------------------------------------------------

describe('PSC-002 unknown is not stale; historical documents (INV-5)', () => {
  it('prose that merely mentions a completed story, with no structural field, is unknown and never STALE', () => {
    const claim = parseActiveStoryClaim('Working on cleanup after STORY-001 and STORY-002 landed.');
    expect(claim).toEqual({ kind: 'unknown' });
    const ev = evidence({ activeStory: claim, roadmapStatuses: new Map([['STORY-001', 'COMPLETED'], ['STORY-002', 'COMPLETED']]) });
    expect(evaluateFreshness(ev).status).not.toBe('STALE');
  });

  it('several competing ids in free text without a structural field → unknown', () => {
    expect(parseActiveStoryClaim('STORY-001 and STORY-002 are both under review')).toEqual({ kind: 'unknown' });
  });

  it('historical document whose first line is a bold declaration of one id is still read (compatibility)', () => {
    expect(parseActiveStoryClaim('**WIDGET-001 — Some title**\nStatus: implemented')).toEqual({ kind: 'ids', ids: ['WIDGET-001'] });
    expect(parseActiveStoryClaim('**WIDGET-001** — in progress\n\nafter WIDGET-000')).toEqual({ kind: 'ids', ids: ['WIDGET-001'] });
  });

  it('"No active story" wins, even with ids in a following paragraph, fence or comment', () => {
    expect(parseActiveStoryClaim('No active story.\n\nPrevious: **X-001A**')).toEqual({ kind: 'none' });
    expect(parseActiveStoryClaim('<!-- note -->\nNo active story recorded.')).toEqual({ kind: 'none' });
  });

  it('empty, comment-only and fence-only sections are unknown', () => {
    expect(parseActiveStoryClaim('')).toEqual({ kind: 'unknown' });
    expect(parseActiveStoryClaim('<!-- STORY-001 -->')).toEqual({ kind: 'unknown' });
    expect(parseActiveStoryClaim(`${FENCE}\nSTORY-001\n${FENCE}`)).toEqual({ kind: 'unknown' });
    expect(parseActiveStoryClaim(null)).toEqual({ kind: 'unknown' });
  });
});

// ---------------------------------------------------------------------------
// INV-6 — real contradictions are preserved
// ---------------------------------------------------------------------------

describe('PSC-002 confirmed contradictions are preserved (INV-6)', () => {
  it('structural active story that roadmap-index marks COMPLETED → STALE', () => {
    const ev = evidence({
      activeStory: parseActiveStoryClaim('**Story:** STORY-002 — title'),
      roadmapStatuses: new Map([['STORY-002', 'COMPLETED']]),
    });
    const r = evaluateFreshness(ev);
    expect(r.status).toBe('STALE');
    expect(r.reasons[0]).toMatchObject({ code: 'STATE_CONTRADICTION', documents: ['active.md', 'roadmap-index.md'] });
  });

  it('structural active story that story-index marks DONE → STALE', () => {
    const ev = evidence({ activeStory: { kind: 'ids', ids: ['S-2'] }, storyIndexStatuses: new Map([['S-2', 'DONE']]) });
    expect(evaluateFreshness(ev).status).toBe('STALE');
  });

  it('roadmap and story-index disagree about one id → STALE', () => {
    const ev = evidence({ roadmapStatuses: new Map([['STORY-005', 'COMPLETED']]), storyIndexStatuses: new Map([['STORY-005', 'IN PROGRESS']]) });
    expect(evaluateFreshness(ev).status).toBe('STALE');
  });

  it('roadmap names an active story while active.md confirms none → STALE', () => {
    const ev = evidence({ activeStory: parseActiveStoryClaim('No active story recorded.'), roadmapActiveStory: 'STORY-007 — x' });
    expect(evaluateFreshness(ev).status).toBe('STALE');
  });

  it('historical leading-id claim against a COMPLETED record is still a contradiction', () => {
    const ev = evidence({ activeStory: parseActiveStoryClaim('**WIDGET-001** — in progress'), roadmapStatuses: new Map([['WIDGET-001', 'COMPLETED']]) });
    expect(evaluateFreshness(ev).status).toBe('STALE');
  });
});

// ---------------------------------------------------------------------------
// INV-3 — Markdown context awareness
// ---------------------------------------------------------------------------

describe('PSC-002 Markdown context in Roadmap / Story Index parsers (INV-3)', () => {
  const roadmap = [
    'Active Story: none',
    '',
    '| Story | Title | Status | Date |',
    '| --- | --- | --- | --- |',
    '| REAL-001 | Real | IN PROGRESS | d |',
    '',
    `${FENCE}markdown`,
    'Active Story: FAKE-001',
    '| FAKE-001 | Example | COMPLETED | d |',
    FENCE,
    '',
    '<!--',
    '| HIDDEN-001 | Old | COMPLETED | d |',
    'Active Story: HIDDEN-002',
    '-->',
    '<!-- | INLINE-001 | x | COMPLETED | d | -->',
  ].join('\n');

  it('Active Story: inside a fence or comment is ignored', () => {
    expect(parseRoadmapActiveStory(roadmap)).toBe('none');
    expect(parseRoadmapActiveStory(`${FENCE}\nActive Story: FAKE-001\n${FENCE}\n`)).toBeNull();
    expect(parseRoadmapActiveStory('<!-- Active Story: FAKE-001 -->')).toBeNull();
  });

  it('status rows inside a fence or comment are ignored', () => {
    expect([...parseRoadmapStatuses(roadmap)]).toEqual([['REAL-001', 'IN PROGRESS']]);
  });

  it('story-index entries inside a fence or comment are ignored', () => {
    const index = [
      '### REAL-001 — Real',
      '**Status:** IN PROGRESS',
      '',
      `${FENCE}markdown`,
      '### FAKE-001 — Example',
      '**Status:** COMPLETED',
      FENCE,
      '<!--',
      '### HIDDEN-001 — Old',
      '**Status:** COMPLETED',
      '-->',
    ].join('\n');
    expect([...parseStoryIndexStatuses(index)]).toEqual([['REAL-001', 'IN PROGRESS']]);
  });

  it('a fence example cannot manufacture a contradiction through the whole pipeline', () => {
    const ev = evidence({
      activeStory: { kind: 'ids', ids: ['FAKE-001'] },
      roadmapActiveStory: parseRoadmapActiveStory(roadmap),
      roadmapStatuses: parseRoadmapStatuses(roadmap),
    });
    expect(contradictionsOf(ev)).toEqual([]);
  });

  it('content after a closed fence / comment is read normally; an unterminated one hides the rest (fail closed)', () => {
    expect(parseRoadmapActiveStory(`${FENCE}\nx\n${FENCE}\nActive Story: REAL-002`)).toBe('REAL-002');
    expect(parseRoadmapActiveStory('<!-- c -->Active Story: REAL-003')).toBe('REAL-003');
    expect(parseRoadmapActiveStory(`${FENCE}\nActive Story: REAL-004`)).toBeNull();
  });

  it('a ~~~ fence and a longer closing fence are honoured; a shorter one does not close', () => {
    expect(parseRoadmapActiveStory('~~~\nActive Story: X-1\n~~~\n')).toBeNull();
    expect(parseRoadmapActiveStory('````\n```\nActive Story: X-1\n````\nActive Story: REAL-005')).toBe('REAL-005');
  });
});

// ---------------------------------------------------------------------------
// INV-4 — typed identity boundaries (IDEA-*)
// ---------------------------------------------------------------------------

describe('PSC-002 IDEA namespace (INV-4)', () => {
  it('IDEA-NNN is an idea id, not a work item', () => {
    expect(extractWorkItemIds('chore(ideas): capture IDEA-002; see IDEA-001 and IDEA-999')).toEqual([]);
  });

  it('only the exact idea grammar is excluded: real stories sharing the prefix survive', () => {
    expect(extractWorkItemIds('feat(IDEA-001A): store; fix(IDEA-001D): reservations; IDEA-002')).toEqual(['IDEA-001A', 'IDEA-001D']);
    expect(extractWorkItemIds('IDEA-001B.1 and IDEA-003-R')).toEqual(['IDEA-001B.1', 'IDEA-003-R']);
  });

  it('look-alike prefixes and real ids are unaffected', () => {
    expect(extractWorkItemIds('MYIDEA-002, XIDEA-003, NOIDEA-004')).toEqual(['MYIDEA-002', 'XIDEA-003', 'NOIDEA-004']); // different prefix = different namespace
    expect(extractWorkItemIds('feat(WIDGET-001): x; GADGET-002; UI-002D')).toEqual(['WIDGET-001', 'GADGET-002', 'UI-002D']);
  });

  it('a commit naming only an idea id is not "unrecorded work"', () => {
    const git = {
      status: 'ok' as const,
      lastStateUpdate: LAST,
      commitsSince: [{ sha: 'c'.repeat(40), date: '2000-01-03T00:00:00+00:00', subject: 'chore(ideas): capture IDEA-002 Decision Lineage', files: ['.monolith/memory/long-term/ideas/IDEA-002.md'] }],
      truncated: false,
    };
    const ev = evidence({ git, recordedText: 'WIDGET-001' });
    const result = evaluateFreshness(ev);
    expect(result.unrecordedWork).toEqual([]);
    expect(result.reasons.map((r) => r.code)).not.toContain('UNRECORDED_WORK');
    const report = reconcile(ev, result);
    expect(report.untrackedWork).toEqual([]);
    expect(report.findings.map((f) => f.code)).not.toContain('UNRECORDED_WORK');
  });

  it('the same commit alongside a real unrecorded item reports only the real item', () => {
    const c = (subject: string) => ({ sha: 'c'.repeat(40), date: '2000-01-03T00:00:00+00:00', subject, files: ['src/x.ts'] });
    const git = { status: 'ok' as const, lastStateUpdate: LAST, commitsSince: [c('feat(GADGET-002): IDEA-002 idea'), c('chore: IDEA-001')], truncated: false };
    const ev = evidence({ git });
    expect(reconcile(ev, evaluateFreshness(ev)).untrackedWork.map((u) => u.id)).toEqual(['GADGET-002']);
  });
});

// ---------------------------------------------------------------------------
// End to end: read-only, deterministic, same verdict on re-run
// ---------------------------------------------------------------------------

describe('PSC-002 end to end through collect()', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });
  const ACTIVE = '.monolith/memory/working/active.md';
  const ROADMAP = '.monolith/context/maps/roadmap-index.md';
  const INDEX = '.monolith/memory/working/story-index.md';

  function put(dir: string, rel: string, content: string): void {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }

  it('prose mention of a completed story and a fenced fake status do not yield STALE; files are untouched; re-run is identical', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'monolith-psc002-'));
    dirs.push(dir);
    put(dir, 'monolith.config.json', JSON.stringify({ project: { name: 'fixture' }, monolithRoot: '.monolith' }));
    put(dir, ACTIVE, `# Active\n\n## Current Story\n\n**Story:** STORY-002 — Current\n\nSTORY-001 is finished.\n\n${FENCE}\nSTORY-010\n${FENCE}\n\n<!-- STORY-020 -->\n\n---\n`);
    put(dir, ROADMAP, `Active Story: STORY-002\n\n| Story | Title | Status | Date |\n| --- | --- | --- | --- |\n| STORY-001 | Done | COMPLETED | d |\n| STORY-002 | Now | IN PROGRESS | d |\n\n${FENCE}\n| STORY-002 | Example | COMPLETED | d |\n${FENCE}\n`);
    put(dir, INDEX, `### STORY-001 — Done\n**Status:** COMPLETED\n\n### STORY-002 — Now\n**Status:** IN PROGRESS\n`);
    const before = [ACTIVE, ROADMAP, INDEX].map((p) => readFileSync(join(dir, p), 'utf8'));

    const a = await collect(dir);
    const b = await collect(dir);
    expect(a.freshness.reasons.map((r) => r.code)).not.toContain('STATE_CONTRADICTION');
    expect(a.freshness.status).not.toBe('STALE');
    expect(a.freshness.activeStory).toBe('recorded');
    expect(a.freshness).toEqual(b.freshness);
    expect([ACTIVE, ROADMAP, INDEX].map((p) => readFileSync(join(dir, p), 'utf8'))).toEqual(before);
  });

  it('an unreadable (missing) state document contributes no claim and no contradiction', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'monolith-psc002-'));
    dirs.push(dir);
    put(dir, 'monolith.config.json', JSON.stringify({ project: { name: 'fixture' }, monolithRoot: '.monolith' }));
    put(dir, ACTIVE, '# Active\n\n## Current Story\n\n**Story:** STORY-002\n\n---\n');
    const m = await collect(dir);
    expect(m.freshness.reasons.map((r) => r.code)).not.toContain('STATE_CONTRADICTION');
  });
});
