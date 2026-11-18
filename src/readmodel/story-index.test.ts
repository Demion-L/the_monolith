import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseStoryIndex, readDashboardModel, ROADMAP_REL, STORY_INDEX_REL } from './index.js';
import type { StructuredStoryIndexView } from './index.js';

const codes = (v: StructuredStoryIndexView): string[] => v.diagnostics.map((d) => d.code);

const FIVE = `# Story Index

## Purpose

Text.

# Stories

## Phase 1 — Cognitive Core

### STORY 1.1 — First
**Date:** 2026-06-26
**Status:** COMPLETED

### STORY 1.3 — Second
**Date:** 2026-06-28
**Status:** COMPLETED

## Phase 2 — Coordination

### COORDINATORIUM-001 — Third
**Date:** 2026-10-21
**Status:** COMPLETED

### CONTEXT-001A — Fourth
**Date:** 2026-10-22
**Status:** COMPLETED

### UI-006 — Fifth
**Date:** 2026-11-01
**Status:** COMPLETED
`;

describe('parseStoryIndex', () => {
  it('1. parses a correct document with five stories', () => {
    const v = parseStoryIndex(FIVE, ['1', '2']);
    expect(v.state).toBe('ok');
    expect(v.stories).toHaveLength(5);
    expect(v.diagnostics).toEqual([]);
    expect(v.stories[0]).toEqual({
      id: 'STORY 1.1', idStatus: 'unique', title: 'First', date: '2026-06-26',
      status: { value: 'COMPLETED', recognized: true, provenance: 'REPORTED' },
      phase: { kind: 'matched', phaseId: '1', token: '1' },
    });
  });

  it('2. accepts the different Story ID formats verbatim', () => {
    const doc = ['## Phase 1', '### STORY 1.1 — a', '### STORY 2.3.1 — b', '### BETA-020 — c', '### SEC-001B.1-R — d', '### UI-002D — e', '### CORE-GRAPH-002 — f']
      .map((l) => (l.startsWith('###') ? `${l}\n**Status:** COMPLETED\n` : `${l}\n`)).join('\n');
    const v = parseStoryIndex(doc, ['1']);
    expect(v.stories.map((s) => s.id)).toEqual(['STORY 1.1', 'STORY 2.3.1', 'BETA-020', 'SEC-001B.1-R', 'UI-002D', 'CORE-GRAPH-002']);
    expect(v.state).toBe('ok');
  });

  it('3. nests stories structurally under their phase heading', () => {
    const v = parseStoryIndex(FIVE, ['1', '2']);
    expect(v.stories.map((s) => s.phase.kind === 'matched' && s.phase.phaseId)).toEqual(['1', '1', '2', '2', '2']);
  });

  it('4. matches phase ids strictly (no fuzzy, no title, no order)', () => {
    const doc = '## Phase 1 — Core\n### UI-001 — a\n**Status:** COMPLETED\n';
    expect(parseStoryIndex(doc, ['1.0']).stories[0].phase).toEqual({ kind: 'unmatched', token: '1' });
    expect(parseStoryIndex(doc, ['Core']).stories[0].phase).toEqual({ kind: 'unmatched', token: '1' });
    expect(parseStoryIndex(doc, ['phase 1']).stories[0].phase).toEqual({ kind: 'unmatched', token: '1' });
    expect(parseStoryIndex(doc, ['x', '1']).stories[0].phase.kind).toBe('matched');
  });

  it('5. reports an unknown phase as unmatched and keeps the token', () => {
    const v = parseStoryIndex('## Phase 9 — X\n### UI-001 — a\n**Status:** COMPLETED\n', ['1']);
    expect(v.stories[0].phase).toEqual({ kind: 'unmatched', token: '9' });
    expect(codes(v)).toContain('STORY_PHASE_UNMATCHED');
  });

  it('6. reports an ambiguous phase (duplicated in the Roadmap) and keeps the token', () => {
    const v = parseStoryIndex('## Phase 1 — X\n### UI-001 — a\n**Status:** COMPLETED\n', ['1', '1']);
    expect(v.stories[0].phase).toEqual({ kind: 'ambiguous', token: '1' });
    expect(codes(v)).toContain('STORY_PHASE_AMBIGUOUS');
  });

  it('reports containment as unverified when the Roadmap supplies no ids', () => {
    const v = parseStoryIndex('## Phase 1 — X\n### UI-001 — a\n**Status:** COMPLETED\n', null);
    expect(v.stories[0].phase).toEqual({ kind: 'unverified', token: '1' });
    expect(codes(v)).toContain('STORY_PHASE_UNVERIFIED');
  });

  it('a partial Roadmap never yields unmatched: absence is unverified, an exact match stays matched', () => {
    const doc = '## Phase 9 — X\n### UI-001 — a\n**Status:** COMPLETED\n## Phase 1 — Y\n### UI-002 — b\n**Status:** COMPLETED\n';
    const v = parseStoryIndex(doc, ['1'], false);
    expect(v.stories[0].phase).toEqual({ kind: 'unverified', token: '9' });
    expect(v.stories[1].phase).toEqual({ kind: 'matched', phaseId: '1', token: '1' });
    expect(codes(v)).toContain('STORY_PHASE_UNVERIFIED');
    expect(codes(v)).not.toContain('STORY_PHASE_UNMATCHED');
    expect(parseStoryIndex(doc, ['1'], true).stories[0].phase.kind).toBe('unmatched');
  });

  it('7. a story outside any phase section has no phase and is reported', () => {
    const v = parseStoryIndex('# Stories\n### UI-001 — a\n**Status:** COMPLETED\n\n## Phase 1\n### UI-002 — b\n**Status:** COMPLETED\n\n## Notes\n### UI-003 — c\n**Status:** COMPLETED\n', ['1']);
    expect(v.stories.map((s) => s.phase.kind)).toEqual(['outside', 'matched', 'outside']);
    expect(codes(v).filter((c) => c === 'STORY_OUTSIDE_PHASE')).toHaveLength(2);
  });

  it('8. duplicate story ids are never first-wins: all entries stay and are flagged', () => {
    const v = parseStoryIndex('## Phase 1\n### UI-001 — a\n**Status:** COMPLETED\n### UI-001 — b\n**Status:** PLANNED\n### UI-002 — c\n**Status:** COMPLETED\n', ['1']);
    expect(v.stories.map((s) => [s.id, s.idStatus, s.title])).toEqual([
      ['UI-001', 'duplicate', 'a'], ['UI-001', 'duplicate', 'b'], ['UI-002', 'unique', 'c'],
    ]);
    expect(v.diagnostics.filter((d) => d.code === 'STORY_ID_DUPLICATE').map((d) => d.storyIndex)).toEqual([0, 1]);
  });

  it('9. a missing status is null, never defaulted', () => {
    const v = parseStoryIndex('## Phase 1\n### UI-001 — a\n**Date:** 2026-01-01\n', ['1']);
    expect(v.stories[0].status).toEqual({ value: null, recognized: false, provenance: 'REPORTED' });
    expect(codes(v)).toContain('STORY_STATUS_MISSING');
  });

  it('10. an unknown status is kept verbatim, unrecognized, still REPORTED', () => {
    const v = parseStoryIndex('## Phase 1\n### UI-001 — a\n**Status:** shipped  maybe\n', ['1']);
    expect(v.stories[0].status).toEqual({ value: 'shipped maybe', recognized: false, provenance: 'REPORTED' });
    expect(codes(v)).toContain('STORY_STATUS_UNRECOGNIZED');
  });

  it('keeps empty and conflicting statuses apart from missing ones', () => {
    const empty = parseStoryIndex('## Phase 1\n### UI-001 — a\n**Status:**\n', ['1']);
    expect(codes(empty)).toContain('STORY_STATUS_EMPTY');
    const conflict = parseStoryIndex('## Phase 1\n### UI-001 — a\n**Status:** COMPLETED\n**Status:** PLANNED\n', ['1']);
    expect(conflict.stories[0].status.value).toBeNull();
    expect(codes(conflict)).toContain('STORY_STATUS_CONFLICT');
  });

  it('11. an empty document is reported as empty', () => {
    for (const t of ['', '  \n\t\n']) {
      const v = parseStoryIndex(t, ['1']);
      expect(v).toEqual({ state: 'empty', stories: [], diagnostics: [{ code: 'DOCUMENT_EMPTY', severity: 'warn', storyIndex: null }] });
    }
  });

  it('12. a corrupted document is never an empty success', () => {
    const garbage = parseStoryIndex('\u0000\u0001 ### not a heading\n}{ ~~~ \u0000', ['1']);
    expect(garbage.state).toBe('unrecognized');
    expect(codes(garbage)).toContain('STORIES_NOT_FOUND');
    const broken = parseStoryIndex('## Phase\n### lowercase-id — x\n### UI-001 — ok\n**Status:** COMPLETED\n', ['1']);
    expect(broken.state).toBe('partial');
    expect(codes(broken)).toEqual(expect.arrayContaining(['PHASE_HEADING_MALFORMED', 'STORY_HEADING_MALFORMED']));
    expect(broken.stories).toHaveLength(1);
    expect(broken.stories[0].phase.kind).toBe('unmatched');
    const phasesOnly = parseStoryIndex('## Phase 1 — X\n', ['1']);
    expect(phasesOnly.state).toBe('no_stories');
  });

  it('13. CRLF input gives the same result as LF', () => {
    expect(parseStoryIndex(FIVE.replace(/\n/g, '\r\n'), ['1', '2'])).toEqual(parseStoryIndex(FIVE, ['1', '2']));
  });

  it('14. headings inside code blocks and comments are not read', () => {
    const doc = '## Phase 1\n```\n## Phase 2\n### UI-999 — fake\n**Status:** COMPLETED\n```\n<!--\n### UI-998 — hidden\n-->\n### UI-001 — real\n**Status:** COMPLETED\n';
    const v = parseStoryIndex(doc, ['1', '2']);
    expect(v.stories.map((s) => s.id)).toEqual(['UI-001']);
    expect(v.stories[0].phase).toEqual({ kind: 'matched', phaseId: '1', token: '1' });
  });

  it('does not read a status from a code block inside a story body', () => {
    const v = parseStoryIndex('## Phase 1\n### UI-001 — a\n```\n**Status:** COMPLETED\n```\n', ['1']);
    expect(v.stories[0].status.value).toBeNull();
  });

  it('is deterministic and never infers Story → Story links', () => {
    const a = parseStoryIndex(FIVE, ['1', '2']);
    expect(parseStoryIndex(FIVE, ['1', '2'])).toEqual(a);
    expect(Object.keys(a.stories[0]).sort()).toEqual(['date', 'id', 'idStatus', 'phase', 'status', 'title']);
  });
});

describe('readDashboardModel — storyIndex', () => {
  let dir: string;
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'si-proj-'))); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const write = (rel: string, content: string): void => {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  const ROADMAP = '# R\n\n## Phases\n\n### Phase 1 — A\n**Status:** COMPLETE\n\n### Phase 2 — B\n**Status:** PLANNED\n\n## Current Focus\n\nActive Phase: 2 — B\n';

  it('15. an absent story-index.md is NOT AVAILABLE, never an empty list', () => {
    write('monolith.config.json', '{}');
    write(`.monolith/${ROADMAP_REL}`, ROADMAP);
    const m = readDashboardModel(dir);
    expect(m.storyIndex?.data).toBeNull();
    expect(m.storyIndex?.sources).toEqual([{ id: 'storyIndex', path: `.monolith/${STORY_INDEX_REL}`, status: 'absent', code: 'SOURCE_ABSENT' }]);
  });

  it('exposes the structured index, matched against the Roadmap phases', () => {
    write('monolith.config.json', '{}');
    write(`.monolith/${ROADMAP_REL}`, ROADMAP);
    write(`.monolith/${STORY_INDEX_REL}`, FIVE);
    const m = readDashboardModel(dir);
    expect(m.storyIndex?.sources[0].status).toBe('available');
    expect(m.storyIndex?.data?.state).toBe('ok');
    expect(m.storyIndex?.data?.stories.map((s) => s.phase.kind)).toEqual(['matched', 'matched', 'matched', 'matched', 'matched']);
  });

  it('a partial Roadmap (malformed phase heading) makes an absent phase unverified, not unmatched', () => {
    write('monolith.config.json', '{}');
    write(`.monolith/${ROADMAP_REL}`, '## Phases\n\n### Phase 1 — A\n**Status:** COMPLETE\n\n### Phase\n**Status:** PLANNED\n');
    write(`.monolith/${STORY_INDEX_REL}`, '## Phase 1 — A\n### UI-001 — a\n**Status:** COMPLETED\n## Phase 2 — B\n### UI-002 — b\n**Status:** COMPLETED\n');
    const m = readDashboardModel(dir);
    expect(m.roadmap?.data?.structured?.state).toBe('partial');
    expect(m.storyIndex?.data?.stories.map((s) => s.phase.kind)).toEqual(['matched', 'unverified']);
  });

  it('reports containment as unverified when the Roadmap is unavailable', () => {
    write('monolith.config.json', '{}');
    write(`.monolith/${STORY_INDEX_REL}`, FIVE);
    const m = readDashboardModel(dir);
    expect(m.storyIndex?.data?.stories.every((s) => s.phase.kind === 'unverified')).toBe(true);
  });

  it('a corrupt (too large) index is reported by the source, not as data', () => {
    write('monolith.config.json', '{}');
    write(`.monolith/${STORY_INDEX_REL}`, 'x'.repeat(1024 * 1024 + 1));
    const m = readDashboardModel(dir);
    expect(m.storyIndex?.data).toBeNull();
    expect(m.storyIndex?.sources[0].code).toBe('SOURCE_TOO_LARGE');
  });

  it('16. existing DTO sections and diagnostics sources are unchanged', () => {
    write('monolith.config.json', '{}');
    write(`.monolith/${ROADMAP_REL}`, ROADMAP);
    write(`.monolith/${STORY_INDEX_REL}`, FIVE);
    const m = readDashboardModel(dir);
    expect(m.diagnostics.sources.map((s) => s.id)).toEqual(['config', 'state', 'activeStory', 'roadmap']);
    expect(m.roadmap.data?.structured?.activePhase).toEqual({ kind: 'phase', id: '2' });
    const { storyIndex: _s, ...rest } = m;
    expect(Object.keys(rest).sort()).toEqual(['checkpoints', 'currentMissions', 'decisions', 'diagnostics', 'hypotheses', 'projectOverview', 'roadmap']);
  });
});
