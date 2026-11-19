import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findContradictions, parseActiveStoryClaim, parseRoadmapActiveStory, parseRoadmapStatuses, parseStoryIndexStatuses } from '../brief/freshness.js';
import { extractCurrentStory } from '../brief/story.js';
import { readDashboardModel, resolveActiveStory, resolveStoryState } from './index.js';
import type { StorySources } from './index.js';

const active = (body: string): string => `# Active\n\n## Current Story\n\n${body}\n\n---\n\n## Next\n`;
const ACTIVE_X = active('**Story:** UI-009\n**Title:** Thing\n**Status:** IN PROGRESS');
const ACTIVE_NONE = active('No active story.');

const roadmap = (opts: { rows?: string; legacyActive?: string; phases?: string[]; focus?: string } = {}): string => {
  const phases = opts.phases ?? ['1'];
  const body = phases
    .map((p, i) => `### Phase ${p} — Name ${p}\n\n**Status:** IN PROGRESS\n\n${i === 0 ? `| Story | Title | Status | Date |\n| --- | --- | --- | --- |\n${opts.rows ?? ''}\n` : ''}`)
    .join('\n');
  return `# Roadmap\n\n## Phases\n\n${body}\n## Current Focus\n\nActive Phase: ${opts.focus ?? phases[0]} — Name\n${opts.legacyActive !== undefined ? `Active Story: ${opts.legacyActive}\n` : ''}\n---\n\n## Completion Summary\n`;
};

const index = (body: string): string => `# Story Index\n\n# Stories\n\n${body}`;
const entry = (id: string, status = 'COMPLETED'): string => `### ${id} — Title\n\n**Date:** 2026-10-01\n**Status:** ${status}\n\n`;
const P1 = '## Phase 1 — Name 1\n\n';

const full = (over: Partial<StorySources> = {}): StorySources => ({
  active: ACTIVE_NONE,
  roadmap: roadmap({ rows: '| UI-009 | Thing | PLANNED | — |' }),
  storyIndex: index(P1 + entry('UI-001')),
  ...over,
});
const codesOf = (r: ReturnType<typeof resolveStoryState>): string[] => r.diagnostics.map((d) => d.code);

describe('resolveStoryState — independent facts', () => {
  it('1 planned story: planned, not active, not finalized, consistent', () => {
    const r = resolveStoryState(full(), 'UI-009');
    expect(r.planning.state).toBe('PLANNED');
    expect(r.active.state).toBe('NOT_ACTIVE');
    expect(r.finalization.state).toBe('NOT_FINALIZED');
    expect(r.phase).toMatchObject({ state: 'RESOLVED', phaseId: '1' });
    expect(r.consistency).toBe('CONSISTENT');
  });

  it('2 active story: active.md is the sole authority for Active', () => {
    const r = resolveStoryState(full({ active: ACTIVE_X }), 'UI-009');
    expect(r.active.state).toBe('ACTIVE');
    expect(r.planning.state).toBe('PLANNED');
    expect(r.consistency).toBe('CONSISTENT');
  });

  it('3 finalized story: story-index.md is the sole authority for Finalized', () => {
    const r = resolveStoryState(full({ roadmap: roadmap({ rows: '| UI-001 | T | COMPLETED | — |' }) }), 'UI-001');
    expect(r.finalization.state).toBe('FINALIZED');
    expect(r.planning.state).toBe('PLANNED');
    expect(r.consistency).toBe('CONSISTENT');
  });

  it('3b `STORY 1.1` heading and bare `1.1` roadmap id name the same story (and nothing else is equated)', () => {
    const r = resolveStoryState(full({ roadmap: roadmap({ rows: '| 1.1 | T | COMPLETED | — |' }), storyIndex: index(P1 + entry('STORY 1.1')) }), '1.1');
    expect(r.finalization.state).toBe('FINALIZED');
    expect(r.planning.state).toBe('PLANNED');
    expect(resolveStoryState(full(), 'UI-00').finalization.state).toBe('NOT_FINALIZED');
  });

  it('4 unknown story with complete documents is NOT_LISTED / NOT_FINALIZED, not a conflict', () => {
    const r = resolveStoryState(full(), 'NOPE-1');
    expect(r.planning.state).toBe('NOT_LISTED');
    expect(r.finalization.state).toBe('NOT_FINALIZED');
    expect(r.active.state).toBe('NOT_ACTIVE');
    expect(r.phase.state).toBe('UNKNOWN');
    expect(r.consistency).toBe('CONSISTENT');
  });
});

describe('resolveStoryState — missing data is UNKNOWN, never "no story"', () => {
  it('5 missing roadmap → planning UNKNOWN, INCOMPLETE', () => {
    const r = resolveStoryState(full({ roadmap: null }), 'UI-009');
    expect(r.planning.state).toBe('UNKNOWN');
    expect(r.sources.roadmap).toBe('missing');
    expect(codesOf(r)).toContain('ROADMAP_SOURCE_UNAVAILABLE');
    expect(r.consistency).toBe('INCOMPLETE');
  });

  it('6 missing active.md → active UNKNOWN, INCOMPLETE', () => {
    const r = resolveStoryState(full({ active: null }), 'UI-009');
    expect(r.active).toEqual({ state: 'UNKNOWN', reason: 'DOCUMENT_UNAVAILABLE' });
    expect(r.consistency).toBe('INCOMPLETE');
    expect(resolveActiveStory(full({ active: null }))).toBeNull();
  });

  it('6b active.md without a Current Story section is UNKNOWN', () => {
    const r = resolveStoryState(full({ active: '# Active\n\nNothing here.\n' }), 'UI-009');
    expect(r.active.state).toBe('UNKNOWN');
  });

  it('7 missing story-index.md → finalization UNKNOWN, never NOT_FINALIZED', () => {
    const r = resolveStoryState(full({ storyIndex: null }), 'UI-001');
    expect(r.finalization.state).toBe('UNKNOWN');
    expect(codesOf(r)).toContain('STORY_INDEX_SOURCE_UNAVAILABLE');
    expect(r.consistency).toBe('INCOMPLETE');
  });

  it('13 partial governance data: an unrecognised story index does not become "not finalized"', () => {
    const r = resolveStoryState(full({ storyIndex: 'just prose, no stories\n' }), 'UI-001');
    expect(r.sources.storyIndex).toBe('unrecognized');
    expect(r.finalization.state).toBe('UNKNOWN');
    expect(r.consistency).toBe('INCOMPLETE');
  });

  it('13b unparseable active claim → INCOMPLETE, not "not active"', () => {
    const r = resolveStoryState(full({ active: active('Some prose without a Story field.') }), 'UI-009');
    expect(r.active).toEqual({ state: 'UNKNOWN', reason: 'CLAIM_UNPARSEABLE' });
    expect(r.consistency).toBe('INCOMPLETE');
  });
});

describe('resolveStoryState — conflicts', () => {
  it('8 active + finalized is a CONFLICT with provenance of both, no source silently wins', () => {
    const r = resolveStoryState(full({ active: ACTIVE_X, storyIndex: index(P1 + entry('UI-009')) }), 'UI-009');
    expect(r.active.state).toBe('ACTIVE');
    expect(r.finalization.state).toBe('FINALIZED');
    expect(r.consistency).toBe('CONFLICT');
    const d = r.diagnostics.find((x) => x.code === 'ACTIVE_AND_FINALIZED');
    expect(d?.level).toBe('conflict');
    expect(d?.sources.map((s) => s.document).sort()).toEqual(['active.md', 'story-index.md']);
  });

  it('8b agrees with the existing contradiction rule used by brief/finalize', () => {
    const a = ACTIVE_X;
    const s = index(P1 + entry('UI-009'));
    const claim = parseActiveStoryClaim(extractCurrentStory(a).excerpt);
    const legacy = findContradictions({ activeStory: claim, roadmapActiveStory: null, roadmapStatuses: new Map(), storyIndexStatuses: parseStoryIndexStatuses(s) });
    expect(legacy.some((c) => c.documents.includes('story-index.md'))).toBe(true);
    expect(resolveStoryState(full({ active: a, storyIndex: s }), 'UI-009').consistency).toBe('CONFLICT');
  });

  it('9 duplicate finalized records: compatible → warn; incompatible → CONFLICT with both provenances', () => {
    const same = resolveStoryState(full({ storyIndex: index(P1 + entry('UI-001') + entry('UI-001')) }), 'UI-001');
    expect(codesOf(same)).toContain('FINALIZATION_RECORD_DUPLICATED');
    expect(same.consistency).toBe('CONSISTENT');

    const diff = resolveStoryState(full({ storyIndex: index(P1 + entry('UI-001') + entry('UI-001', 'IN PROGRESS')) }), 'UI-001');
    expect(diff.consistency).toBe('CONFLICT');
    const d = diff.diagnostics.find((x) => x.code === 'FINALIZATION_RECORDS_CONFLICT');
    expect(d?.sources.map((s) => s.locator)).toEqual(['entry #1', 'entry #2']);
    expect(diff.finalization.state).toBe('FINALIZED');
  });

  it('9b duplicate records under different phases are incompatible', () => {
    const si = index(P1 + entry('UI-001') + '## Phase 2 — Other\n\n' + entry('UI-001'));
    const r = resolveStoryState(full({ roadmap: roadmap({ phases: ['1', '2'] }), storyIndex: si }), 'UI-001');
    expect(r.consistency).toBe('CONFLICT');
  });

  it('10 ambiguous phase association is reported, never invented', () => {
    // story-index nests it under a phase the roadmap does not declare
    const r = resolveStoryState(full({ storyIndex: index('## Phase 9 — Ghost\n\n' + entry('UI-001')) }), 'UI-001');
    expect(r.phase.state).toBe('AMBIGUOUS');
    expect(codesOf(r)).toContain('PHASE_ASSOCIATION_AMBIGUOUS');
    expect(r.consistency).toBe('INCOMPLETE');
  });

  it('10b roadmap and story-index point at different phases → CONFLICT', () => {
    const r = resolveStoryState(
      full({ roadmap: roadmap({ phases: ['1', '2'], rows: '| UI-001 | T | COMPLETED | — |' }), storyIndex: index('## Phase 2 — Name 2\n\n' + entry('UI-001')) }),
      'UI-001',
    );
    expect(r.consistency).toBe('CONFLICT');
    expect(r.phase).toMatchObject({ state: 'AMBIGUOUS' });
  });

  it('10c a story outside any phase has no phase association (UNKNOWN), not a guessed one', () => {
    const r = resolveStoryState(full({ roadmap: roadmap(), storyIndex: index(entry('UI-001')) }), 'UI-001');
    expect(r.phase.state).toBe('UNKNOWN');
  });

  it('self-contradictory active.md is a CONFLICT', () => {
    const r = resolveStoryState(full({ active: active('No active story.\n\n**Story:** UI-009') }), 'UI-009');
    expect(r.active).toEqual({ state: 'UNKNOWN', reason: 'CLAIM_SELF_CONTRADICTORY' });
    expect(r.consistency).toBe('CONFLICT');
  });
});

describe('resolveStoryState — legacy roadmap', () => {
  it('11 legacy `Active Story:` contradicting active.md → drift diagnostic, never the Active authority', () => {
    const r = resolveStoryState(full({ roadmap: roadmap({ legacyActive: 'UI-009 — Thing' }) }), 'UI-009');
    expect(r.active.state).toBe('NOT_ACTIVE');
    expect(codesOf(r)).toContain('LEGACY_ROADMAP_ACTIVE_STORY_DRIFT');
    expect(r.diagnostics.find((d) => d.code === 'LEGACY_ROADMAP_ACTIVE_STORY_DRIFT')?.level).toBe('warn');
    expect(r.consistency).toBe('CONSISTENT'); // drift is advice, the authoritative facts agree
  });

  it('11b legacy status table says IN PROGRESS while story-index finalized → drift', () => {
    const r = resolveStoryState(full({ roadmap: roadmap({ rows: '| UI-001 | T | IN PROGRESS | — |' }) }), 'UI-001');
    expect(codesOf(r)).toContain('LEGACY_ROADMAP_STATUS_DRIFT');
    expect(r.finalization.state).toBe('FINALIZED');
  });

  it('11c legacy table says COMPLETED but nothing finalized it → drift (not a finalization)', () => {
    const r = resolveStoryState(full({ roadmap: roadmap({ rows: '| UI-009 | T | COMPLETED | — |' }) }), 'UI-009');
    expect(codesOf(r)).toContain('LEGACY_ROADMAP_STATUS_DRIFT');
    expect(r.finalization.state).toBe('NOT_FINALIZED');
  });

  it('11d legacy `Active Story:` is not used when active.md is unknown', () => {
    const r = resolveStoryState(full({ active: null, roadmap: roadmap({ legacyActive: 'UI-009' }) }), 'UI-009');
    expect(r.active.state).toBe('UNKNOWN');
    expect(codesOf(r)).toContain('LEGACY_ROADMAP_ACTIVE_STORY_IGNORED');
  });

  it('12 legacy fields consistent with the authoritative state → no drift', () => {
    const r = resolveStoryState(full({ active: ACTIVE_X, roadmap: roadmap({ legacyActive: 'UI-009 — Thing', rows: '| UI-009 | T | IN PROGRESS | — |' }) }), 'UI-009');
    expect(r.diagnostics.filter((d) => d.code.startsWith('LEGACY_'))).toEqual([]);
    expect(r.consistency).toBe('CONSISTENT');
  });

  it('12b legacy `Active Story: none recorded` is not drift', () => {
    const r = resolveStoryState(full({ roadmap: roadmap({ legacyActive: 'none recorded — nothing in progress' }) }), 'UI-009');
    expect(r.diagnostics.filter((d) => d.code.startsWith('LEGACY_'))).toEqual([]);
  });
});

describe('resolveStoryState — provenance and determinism', () => {
  it('14 provenance names document and locator for every fact', () => {
    const r = resolveStoryState(full({ active: ACTIVE_X, roadmap: roadmap({ rows: '| UI-009 | T | PLANNED | — |' }) }), 'UI-009');
    expect(r.planning).toMatchObject({ entries: [{ provenance: { document: 'roadmap-index.md' } }] });
    expect(r.active).toMatchObject({ provenance: { document: 'active.md', locator: '## Current Story' } });
    const f = resolveStoryState(full(), 'UI-001');
    expect(f.finalization).toMatchObject({ entries: [{ provenance: { document: 'story-index.md', locator: 'entry #1' } }] });
  });

  it('is deterministic and does not mutate its input', () => {
    const src = full({ active: ACTIVE_X });
    const copy = JSON.stringify(src);
    expect(JSON.stringify(resolveStoryState(src, 'UI-009'))).toBe(JSON.stringify(resolveStoryState(src, 'UI-009')));
    expect(JSON.stringify(src)).toBe(copy);
  });

  it('text in fenced code or comments is never read as a fact', () => {
    const r = resolveStoryState(full({ storyIndex: index(P1 + entry('UI-002') + '```\n' + entry('UI-001') + '```\n<!--\n' + entry('UI-001') + '-->\n') }), 'UI-001');
    expect(r.finalization.state).toBe('NOT_FINALIZED');
  });
});

describe('real MONOLITH document structures', () => {
  const read = (rel: string): string | null => {
    try {
      return readFileSync(join(process.cwd(), '.monolith', rel), 'utf8');
    } catch {
      return null;
    }
  };
  const src: StorySources = { active: read('memory/working/active.md'), roadmap: read('context/maps/roadmap-index.md'), storyIndex: read('memory/working/story-index.md') };

  it('resolves the repository’s own documents without throwing; legacy roadmap rows map to story-index entries', () => {
    expect(src.active).not.toBeNull();
    const r = resolveStoryState(src, '1.1');
    expect(r.sources.roadmap).not.toBe('missing');
    expect(r.planning.state).toBe('PLANNED');
    expect(r.finalization.state).toBe('FINALIZED');
    expect(r.consistency === 'CONFLICT' || r.consistency === 'CONSISTENT' || r.consistency === 'INCOMPLETE').toBe(true);
  });

  it('the repository’s legacy roadmap `Active Story:` line is only drift, never the active claim', () => {
    const line = parseRoadmapActiveStory(src.roadmap ?? '');
    expect(line).not.toBeNull();
    expect(parseRoadmapStatuses(src.roadmap ?? '').size).toBeGreaterThan(0);
    const r = resolveActiveStory(src);
    if (r !== null) expect(r.active.state).toBe('ACTIVE');
  });
});

describe('dashboard read model — additive storyState', () => {
  const mk = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'story-state-'));
    writeFileSync(join(root, 'monolith.config.json'), JSON.stringify({ name: 't', monolithRoot: '.monolith' }));
    for (const [rel, text] of Object.entries(files)) {
      const p = join(root, '.monolith', rel);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, text);
    }
    return root;
  };

  it('16 exposes the resolver result for the declared active story and keeps existing sections', () => {
    const root = mk({
      'memory/working/active.md': ACTIVE_X,
      'context/maps/roadmap-index.md': roadmap({ rows: '| UI-009 | T | PLANNED | — |' }),
      'memory/working/story-index.md': index(P1 + entry('UI-009')),
    });
    try {
      const m = readDashboardModel(root);
      expect(m.projectOverview.data?.storyClaim).toEqual({ kind: 'ids', ids: ['UI-009'] });
      expect(m.roadmap.data?.structured?.phases.length).toBeGreaterThan(0);
      expect(m.storyIndex?.data?.stories.length).toBe(1);
      expect(m.storyState?.data?.activeStory?.consistency).toBe('CONFLICT');
      expect(m.storyState?.data?.activeStory?.storyId).toBe('UI-009');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('16b no declared active story → activeStory null with source availability, no invented story', () => {
    const root = mk({ 'memory/working/active.md': ACTIVE_NONE });
    try {
      const m = readDashboardModel(root);
      expect(m.storyState?.data?.activeStory).toBeNull();
      expect(m.storyState?.data?.sources).toMatchObject({ active: 'available', roadmap: 'missing', storyIndex: 'missing' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
