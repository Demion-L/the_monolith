import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRoadmapPhases, MAX_ROADMAP_PHASES, MAX_PHASE_DETAILS_CHARS, MAX_PHASE_GOAL_CHARS } from './roadmap.js';

const root = join(__dirname, '..', '..');
const real = readFileSync(join(root, '.monolith/context/maps/roadmap-index.md'), 'utf8');
const template = readFileSync(join(root, 'templates/default-instance/monolith/context/maps/roadmap-index.md'), 'utf8');

const codes = (r: ReturnType<typeof parseRoadmapPhases>) => r.diagnostics.map((d) => d.code);

describe('parseRoadmapPhases — real documents', () => {
  it('MONOLITH roadmap: ordered phases, explicit statuses, goal, details', () => {
    const r = parseRoadmapPhases(real);
    expect(r.state).toBe('ok');
    expect(r.phases.map((p) => p.id)).toEqual(['1', '2+']);
    expect(r.phases[0].title).toBe('Cognitive Core & First Evidence');
    expect(r.phases[0].status).toEqual({ value: 'IN PROGRESS', recognized: true, provenance: 'REPORTED' });
    expect(r.phases[0].goal).toMatch(/^Establish the core cognitive architecture/);
    expect(r.phases[0].details).toContain('| 1.1 | Cognitive Core Foundation');
    expect(r.phases[0].details).toContain('#### Work merged to `main` after CONTEXT-001A');
    expect(r.phases[0].details).not.toContain('**Status:**');
    expect(r.phases[0].details).not.toContain('**Goal:**');
    // no heading title -> null, not invented
    expect(r.phases[1].title).toBeNull();
    expect(r.phases[1].status.value).toBe('NOT DEFINED');
    expect(r.phases[1].goal).toBeNull();
    expect(r.phases[1].details).toBeNull();
  });

  it('MONOLITH roadmap: explicit Active Phase pointer resolves to phase 1', () => {
    expect(parseRoadmapPhases(real).activePhase).toEqual({ kind: 'phase', id: '1' });
  });

  it('MONOLITH roadmap: Completion Summary row is not a phase, story or status', () => {
    const r = parseRoadmapPhases(real);
    expect(r.phases).toHaveLength(2);
    expect(r.phases.some((p) => p.details?.includes('5 recorded as stories'))).toBe(false);
  });

  it('template: placeholder phase kept verbatim, PLANNED, no active phase', () => {
    const r = parseRoadmapPhases(template);
    expect(r.state).toBe('ok');
    expect(r.phases).toHaveLength(1);
    expect(r.phases[0].id).toBe('1');
    expect(r.phases[0].title).toBe('(Add phase name)');
    expect(r.phases[0].status).toEqual({ value: 'PLANNED', recognized: true, provenance: 'REPORTED' });
    expect(r.phases[0].details).toContain('STORY 1.1');
    expect(r.activePhase).toEqual({ kind: 'none' });
  });

  it('is deterministic and free of side effects', () => {
    expect(parseRoadmapPhases(real)).toEqual(parseRoadmapPhases(real));
  });
});

describe('parseRoadmapPhases — statuses', () => {
  const doc = (body: string) => `## Phases\n\n${body}\n\n## Current Focus\n\nActive Phase: —\n`;

  it('missing status is not invented', () => {
    const r = parseRoadmapPhases(doc('### Phase 1 — A\n\nNo status here.'));
    expect(r.phases[0].status).toEqual({ value: null, recognized: false, provenance: 'REPORTED' });
    expect(codes(r)).toContain('PHASE_STATUS_MISSING');
  });

  it('unknown status is preserved, flagged unrecognized, with a diagnostic', () => {
    const r = parseRoadmapPhases(doc('### Phase 1 — A\n\n**Status:** On  hold'));
    expect(r.phases[0].status).toEqual({ value: 'On hold', recognized: false, provenance: 'REPORTED' });
    expect(r.diagnostics).toContainEqual({ code: 'PHASE_STATUS_UNRECOGNIZED', severity: 'warn', phaseIndex: 0 });
  });

  it('status recognition is case-insensitive but the value stays verbatim', () => {
    const r = parseRoadmapPhases(doc('### Phase 1 — A\n\n**Status:** in progress'));
    expect(r.phases[0].status.value).toBe('in progress');
    expect(r.phases[0].status.recognized).toBe(true);
  });

  it('empty status and contradicting duplicate statuses are not guessed', () => {
    const e = parseRoadmapPhases(doc('### Phase 1 — A\n\n**Status:**'));
    expect(e.phases[0].status.value).toBeNull();
    expect(codes(e)).toContain('PHASE_STATUS_EMPTY');
    const c = parseRoadmapPhases(doc('### Phase 1 — A\n\n**Status:** PLANNED\n**Status:** COMPLETE'));
    expect(c.phases[0].status.value).toBeNull();
    expect(codes(c)).toContain('PHASE_STATUS_CONFLICT');
  });

  it('status is never derived from position or stories', () => {
    const r = parseRoadmapPhases(doc('### Phase 1 — A\n\n| 1.1 | x | COMPLETED | 2026 |\n\n### Phase 2 — B\n\nStories done: all.'));
    expect(r.phases.map((p) => p.status.value)).toEqual([null, null]);
    expect(r.activePhase).toEqual({ kind: 'none' });
  });

  it('a **Status:** inside a code fence is ignored', () => {
    const r = parseRoadmapPhases(doc('### Phase 1 — A\n\n```\n**Status:** COMPLETE\n```'));
    expect(r.phases[0].status.value).toBeNull();
  });
});

describe('parseRoadmapPhases — active phase', () => {
  const phases = '## Phases\n\n### Phase 1 — A\n\n**Status:** PLANNED\n\n### Phase 2 — B\n\n**Status:** PLANNED\n\n';
  const focus = `${phases}## Current Focus\n\n`;

  it('absent pointer -> not_declared; first unfinished phase is never chosen', () => {
    expect(parseRoadmapPhases(phases).activePhase).toEqual({ kind: 'not_declared' });
  });

  it('explicit pointer', () => {
    expect(parseRoadmapPhases(`${focus}Active Phase: 2 — B\n`).activePhase).toEqual({ kind: 'phase', id: '2' });
    expect(parseRoadmapPhases(`${focus}Active Phase: 2\n`).activePhase).toEqual({ kind: 'phase', id: '2' });
  });

  it('pointer to a non-existent phase is unmatched, not a false binding', () => {
    const r = parseRoadmapPhases(`${focus}Active Phase: 9 — Z\n`);
    expect(r.activePhase).toEqual({ kind: 'unmatched' });
    expect(codes(r)).toContain('ACTIVE_PHASE_UNMATCHED');
  });

  it('contradicting pointers are ambiguous', () => {
    const r = parseRoadmapPhases(`${focus}Active Phase: 1\n\nActive Phase: 2\n`);
    expect(r.activePhase).toEqual({ kind: 'ambiguous' });
    expect(codes(r)).toContain('ACTIVE_PHASE_CONFLICT');
  });

  it('repeated identical pointers are not a conflict', () => {
    expect(parseRoadmapPhases(`${focus}Active Phase: 1\nActive Phase: 1 — A\n`).activePhase).toEqual({ kind: 'phase', id: '1' });
  });

  it('pointer to a duplicated id is ambiguous', () => {
    const r = parseRoadmapPhases('## Phases\n\n### Phase 1 — A\n\n### Phase 1 — B\n\n## Current Focus\n\nActive Phase: 1\n');
    expect(r.activePhase).toEqual({ kind: 'ambiguous' });
    expect(codes(r)).toEqual(expect.arrayContaining(['PHASE_ID_DUPLICATE', 'ACTIVE_PHASE_AMBIGUOUS_ID']));
    expect(r.phases).toHaveLength(2);
  });

  it('pointer inside a code fence or HTML comment does not count', () => {
    const r = parseRoadmapPhases(`${phases}## Current Focus\n\n\`\`\`\nActive Phase: 1\n\`\`\`\n<!-- Active Phase: 2 -->\n`);
    expect(r.activePhase).toEqual({ kind: 'not_declared' });
  });

  describe('scope: only ## Current Focus', () => {
    it('valid pointer in Current Focus', () => {
      expect(parseRoadmapPhases(`${phases}## Current Focus\n\nActive Phase: 2 — B\n`).activePhase).toEqual({ kind: 'phase', id: '2' });
    });
    it('historical pointer inside a phase body is ignored', () => {
      const r = parseRoadmapPhases('## Phases\n\n### Phase 1 — A\n\n**Status:** PLANNED\n\nActive Phase: 1\n\n### Phase 2 — B\n');
      expect(r.activePhase).toEqual({ kind: 'not_declared' });
      expect(r.phases[0].details).toContain('Active Phase: 1');
    });
    it('pointer in another section or in a table is ignored, Current Focus still wins', () => {
      const r = parseRoadmapPhases(`${phases}## Notes\n\nActive Phase: 1\n\n| Active Phase: 1 | x |\n\n## Current Focus\n\nActive Phase: 2\n\n## Archive\n\nActive Phase: 1\n`);
      expect(r.activePhase).toEqual({ kind: 'phase', id: '2' });
    });
    it('only a stray pointer outside Current Focus -> not_declared', () => {
      expect(parseRoadmapPhases(`${phases}## Notes\n\nActive Phase: 1\n`).activePhase).toEqual({ kind: 'not_declared' });
    });
    it('two contradicting pointers inside Current Focus -> ambiguous', () => {
      const r = parseRoadmapPhases(`${phases}## Current Focus\n\nActive Phase: 1\nActive Phase: 2\n`);
      expect(r.activePhase).toEqual({ kind: 'ambiguous' });
      expect(codes(r)).toContain('ACTIVE_PHASE_CONFLICT');
    });
    it('no Current Focus section -> not_declared', () => {
      expect(parseRoadmapPhases(phases).activePhase).toEqual({ kind: 'not_declared' });
    });
    it('duplicated phase ids make the pointer ambiguous', () => {
      const r = parseRoadmapPhases('## Phases\n\n### Phase 1 — A\n\n### Phase 1 — B\n\n## Current Focus\n\nActive Phase: 1\n');
      expect(r.activePhase).toEqual({ kind: 'ambiguous' });
    });
  });

  it('duplicate ## Phases sections: first ends at the next ## heading, duplicate reported', () => {
    const r = parseRoadmapPhases('## Phases\n\n### Phase 1 — A\n\n## Phases\n\n### Phase 2 — B\n');
    expect(r.phases.map((p) => p.id)).toEqual(['1']);
    expect(codes(r)).toContain('PHASES_SECTION_DUPLICATED');
    expect(r.state).toBe('partial');
  });

  it('flags a pointer to a phase that reports itself complete, without overriding it', () => {
    const r = parseRoadmapPhases('## Phases\n\n### Phase 1 — A\n\n**Status:** COMPLETE\n\n## Current Focus\n\nActive Phase: 1\n');
    expect(r.activePhase).toEqual({ kind: 'phase', id: '1' });
    expect(codes(r)).toContain('ACTIVE_PHASE_REPORTED_COMPLETE');
  });
});

describe('parseRoadmapPhases — failure modes are distinguishable', () => {
  it('empty document', () => {
    const r = parseRoadmapPhases('  \n\n');
    expect(r.state).toBe('empty');
    expect(r.phases).toEqual([]);
  });

  it('Phases section without phases', () => {
    const r = parseRoadmapPhases('# Roadmap\n\n## Phases\n\nTBD\n');
    expect(r.state).toBe('no_phases');
    expect(codes(r)).toContain('NO_PHASES_FOUND');
  });

  it('unrecognizable structure is not an empty success', () => {
    const r = parseRoadmapPhases('# Roadmap\n\nJust some prose.\n\n| a | b |\n| - | - |\n| 1 | IN PROGRESS |\n');
    expect(r.state).toBe('unrecognized');
    expect(r.phases).toEqual([]);
    expect(codes(r)).toContain('PHASES_SECTION_MISSING');
  });

  it('phase headings outside ## Phases are not phases', () => {
    const r = parseRoadmapPhases('# R\n\n### Phase 1 — A\n\n**Status:** PLANNED\n');
    expect(r.state).toBe('unrecognized');
    expect(codes(r)).toContain('PHASE_HEADING_MALFORMED');
  });

  it('partially recognised: malformed heading next to a good phase', () => {
    const r = parseRoadmapPhases('## Phases\n\n### Phase 1 — A\n\n**Status:** PLANNED\n\n### Phase\n\n**Status:** COMPLETE\n');
    expect(r.state).toBe('partial');
    expect(r.phases).toHaveLength(1);
    expect(codes(r)).toContain('PHASE_HEADING_MALFORMED');
  });

  it('broken tables and extra sections do not create phases', () => {
    const r = parseRoadmapPhases(
      '## Phases\n\n### Phase 1 — A\n\n**Status:** PLANNED\n\n| a | b\n|--|\n| 1 | IN PROGRESS\n\n### Notes\n\nfree text\n\n## Appendix\n\n### Phase 7 — hidden\n',
    );
    expect(r.state).toBe('ok');
    expect(r.phases.map((p) => p.id)).toEqual(['1']);
    expect(r.phases[0].details).toContain('| 1 | IN PROGRESS');
    expect(r.phases[0].details).not.toContain('free text');
  });

  it('CRLF line endings', () => {
    const r = parseRoadmapPhases('## Phases\r\n\r\n### Phase 1 — A\r\n\r\n**Status:** PLANNED\r\n**Goal:** g\r\n');
    expect(r.phases[0].status.value).toBe('PLANNED');
    expect(r.phases[0].goal).toBe('g');
  });
});

describe('parseRoadmapPhases — large roadmaps (parser capacity is not a display limit)', () => {
  const build = (n: number, active?: number): string =>
    `## Phases\n\n${Array.from({ length: n }, (_, i) => `### Phase ${i + 1} — Title ${i + 1}\n\n**Status:** ${i + 1 === n ? 'IN PROGRESS' : i % 7 === 0 ? 'Odd (custom)' : 'COMPLETED'}\n**Goal:** goal ${i + 1}\n`).join('\n')}\n## Current Focus\n\n${active === undefined ? '' : `Active Phase: ${active} — x\n`}`;

  it.each([10, 200, 500, 2003])('reads all %i phases, whole and in document order', (n) => {
    const r = parseRoadmapPhases(build(n, n));
    expect(r.state).toBe('ok');
    expect(r.phases).toHaveLength(n);
    expect(r.phases.map((p) => p.id)).toEqual(Array.from({ length: n }, (_, i) => String(i + 1)));
    expect(codes(r)).not.toContain('PHASES_TRUNCATED');
    expect(r.activePhase).toEqual({ kind: 'phase', id: String(n) });
  });

  it('keeps unrecognised statuses unrecognised at scale and an undeclared active phase undeclared', () => {
    const r = parseRoadmapPhases(build(2003));
    expect(r.activePhase).toEqual({ kind: 'not_declared' });
    expect(r.phases[0].status).toMatchObject({ value: 'Odd (custom)', recognized: false });
    expect(r.phases[1].status).toMatchObject({ value: 'COMPLETED', recognized: true });
  });

  it('is fast enough on 2003 phases', () => {
    const text = build(2003, 2003);
    const t = Date.now();
    parseRoadmapPhases(text);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('parseRoadmapPhases — bounds and hostile text', () => {
  it('caps the number of phases and reports it', () => {
    const body = Array.from({ length: MAX_ROADMAP_PHASES + 5 }, (_, i) => `### Phase ${i + 1} — P\n\n**Status:** PLANNED\n`).join('\n');
    const r = parseRoadmapPhases(`## Phases\n\n${body}`);
    expect(r.phases).toHaveLength(MAX_ROADMAP_PHASES);
    expect(r.state).toBe('partial');
    expect(codes(r)).toContain('PHASES_TRUNCATED');
  });

  it('caps details', () => {
    const r = parseRoadmapPhases(`## Phases\n\n### Phase 1 — A\n\n**Status:** PLANNED\n\n${'x'.repeat(MAX_PHASE_DETAILS_CHARS * 2)}\n`);
    expect(r.phases[0].details).toHaveLength(MAX_PHASE_DETAILS_CHARS);
    expect(codes(r)).toContain('PHASE_DETAILS_TRUNCATED');
  });

  it('HTML-like text is carried as inert data', () => {
    const r = parseRoadmapPhases('## Phases\n\n### Phase 1 — <img src=x onerror=alert(1)>\n\n**Status:** <b>X</b>\n**Goal:** <script>1</script>\n');
    expect(r.phases[0].title).toBe('<img src=x onerror=alert(1)>');
    expect(r.phases[0].status.recognized).toBe(false);
    expect(r.phases[0].goal).toBe('<script>1</script>');
  });

  it('handles a large document quickly', () => {
    const big = `## Phases\n\n### Phase 1 — A\n\n**Status:** PLANNED\n\n${'| a | b | c |\n'.repeat(20000)}`;
    const t = Date.now();
    parseRoadmapPhases(big);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('parseRoadmapPhases — goalTruncated', () => {
  const doc = (goalLine: string | null) => `## Phases\n\n### Phase 1 — A\n\n**Status:** PLANNED\n${goalLine === null ? '' : goalLine + '\n'}`;

  it('missing goal: null, not truncated', () => {
    const p = parseRoadmapPhases(doc(null)).phases[0];
    expect(p.goal).toBeNull();
    expect(p.goalTruncated).toBe(false);
  });
  it('short goal: not truncated', () => {
    const p = parseRoadmapPhases(doc('**Goal:** short')).phases[0];
    expect(p.goal).toBe('short');
    expect(p.goalTruncated).toBe(false);
  });
  it('goal of exactly the limit: not truncated', () => {
    const g = 'x'.repeat(MAX_PHASE_GOAL_CHARS);
    const p = parseRoadmapPhases(doc(`**Goal:** ${g}`)).phases[0];
    expect(p.goal).toBe(g);
    expect(p.goalTruncated).toBe(false);
  });
  it('goal over the limit: capped and flagged', () => {
    const g = 'x'.repeat(MAX_PHASE_GOAL_CHARS + 1);
    const p = parseRoadmapPhases(doc(`**Goal:** ${g}`)).phases[0];
    expect(p.goal).toBe('x'.repeat(MAX_PHASE_GOAL_CHARS));
    expect(p.goalTruncated).toBe(true);
  });
  it('rest of the phase is unchanged and the flag is per phase', () => {
    const long = 'y'.repeat(MAX_PHASE_GOAL_CHARS + 50);
    const r = parseRoadmapPhases(`## Phases\n\n### Phase 1 — A\n\n**Status:** PLANNED\n**Goal:** ${long}\n\nBody\n\n### Phase 2 — B\n\n**Status:** PLANNED\n**Goal:** ok\n`);
    expect(r.phases.map((p) => p.goalTruncated)).toEqual([true, false]);
    expect(r.phases[0].status.value).toBe('PLANNED');
    expect(r.phases[0].details).toBe('Body');
    expect(r.phases[0].title).toBe('A');
  });
});
