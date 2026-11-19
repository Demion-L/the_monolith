/**
 * ARCH-002B.1 — differential tests: the legacy interpretation used by `brief` and
 * `finalize` (`findContradictions` via `assessConsistency`) against the Story State
 * Resolver, over the same document texts.
 *
 * What this pins:
 *  - where both answer the same question they agree (verdict, documents);
 *  - where they deliberately differ (scope, status-string handling, duplicates) the
 *    difference is explicit, so it cannot drift silently;
 *  - finalize's READY / digest / consistency are untouched by the resolver.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assessConsistency } from '../finalize/consistency.js';
import { applyFinalization, planFinalization } from '../finalize/core.js';
import { parseProposal, type FinalizationProposal } from '../finalize/proposal.js';
import { scaffoldInstance } from '../init/scaffold.js';
import type { ProjectConfig } from '../init/types.js';
import { resolveStoryState } from './index.js';
import type { StorySources } from './index.js';

const active = (body: string): string => `# Active\n\n## Current Story\n\n${body}\n\n---\n\n## Next\n`;
const NONE = active('No active story.');
const CUR = (id: string): string => active(`**Story:** ${id}\n**Status:** IN PROGRESS`);
const flatRoadmap = (rows: string[], activeLine = 'Active Story: —'): string =>
  `# Roadmap\n\n${activeLine}\n\n| Story | Title | Status | Date |\n| ----- | ----- | ------ | ---- |\n${rows.join('\n')}\n`;
const idx = (body: string): string => `# Story Index\n\n# Stories\n\n## Phase 1 — P\n\n${body}`;
const ent = (id: string, status: string): string => `### ${id} — T\n\n**Date:** 2026-10-01\n**Status:** ${status}\n\n`;

const legacy = (s: StorySources) => assessConsistency({ active: s.active, roadmap: s.roadmap, storyIndex: s.storyIndex, writtenPaths: [], projected: false });
const legacyActiveVsFinal = (s: StorySources, id: string): boolean =>
  legacy(s).findings.some((f) => f.message.startsWith(`active.md treats ${id} as current`));

describe('legacy vs resolver — same question, same answer', () => {
  const cases: { name: string; src: StorySources; id: string; conflict: boolean }[] = [
    { name: 'active story, not finalized', id: 'UI-1', conflict: false, src: { active: CUR('UI-1'), roadmap: flatRoadmap(['| UI-1 | T | IN PROGRESS | — |']), storyIndex: idx(ent('UI-2', 'COMPLETED')) } },
    { name: 'finalized story, not active', id: 'UI-1', conflict: false, src: { active: NONE, roadmap: flatRoadmap(['| UI-1 | T | COMPLETED | — |']), storyIndex: idx(ent('UI-1', 'COMPLETED')) } },
    { name: 'active + finalized in story-index', id: 'UI-1', conflict: true, src: { active: CUR('UI-1'), roadmap: flatRoadmap([]), storyIndex: idx(ent('UI-1', 'COMPLETED')) } },
    { name: 'active + COMPLETED in legacy roadmap only', id: 'UI-1', conflict: false, src: { active: CUR('UI-1'), roadmap: flatRoadmap(['| UI-1 | T | COMPLETED | — |']), storyIndex: idx(ent('UI-2', 'COMPLETED')) } },
    { name: 'DONE counts as final', id: 'UI-1', conflict: true, src: { active: CUR('UI-1'), roadmap: flatRoadmap([]), storyIndex: idx(ent('UI-1', 'DONE')) } },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = resolveStoryState(c.src, c.id);
      expect(legacyActiveVsFinal(c.src, c.id)).toBe(c.conflict || c.name.includes('legacy roadmap only'));
      expect(r.diagnostics.some((d) => d.code === 'ACTIVE_AND_FINALIZED')).toBe(c.conflict);
    });
  }

  it('legacy roadmap row says COMPLETED while active: legacy → contradiction; resolver → LEGACY_ROADMAP_STATUS_DRIFT (not a conflict: the legacy table is not an authority)', () => {
    const s: StorySources = { active: CUR('UI-1'), roadmap: flatRoadmap(['| UI-1 | T | COMPLETED | — |']), storyIndex: idx(ent('UI-2', 'COMPLETED')) };
    expect(legacy(s).status).toBe('INCONSISTENT');
    const r = resolveStoryState(s, 'UI-1');
    expect(r.diagnostics.map((d) => d.code)).toContain('LEGACY_ROADMAP_STATUS_DRIFT');
    expect(r.consistency).not.toBe('CONFLICT');
  });

  it('flat legacy roadmap: finalized in story-index but IN PROGRESS in the table → both report it (FIN-002 case)', () => {
    const s: StorySources = { active: NONE, roadmap: flatRoadmap(['| STC-6 | T | IN PROGRESS | — |']), storyIndex: idx(ent('STC-6', 'COMPLETED')) };
    expect(legacy(s).findings.map((f) => f.message)).toEqual(['STC-6 is IN PROGRESS in roadmap-index.md but COMPLETED in story-index.md.']);
    const r = resolveStoryState(s, 'STC-6');
    expect(r.planning.state).toBe('PLANNED');
    expect(r.diagnostics.map((d) => d.code)).toContain('LEGACY_ROADMAP_STATUS_DRIFT');
  });

  it('missing active.md: legacy → NOT_VERIFIED; resolver → INCOMPLETE (both: UNKNOWN is not "no story")', () => {
    const s: StorySources = { active: null, roadmap: flatRoadmap([]), storyIndex: idx(ent('UI-1', 'COMPLETED')) };
    expect(legacy(s).status).toBe('NOT_VERIFIED');
    expect(resolveStoryState(s, 'UI-1').consistency).toBe('INCOMPLETE');
  });

  it('missing story-index.md: legacy → NOT_VERIFIED; resolver → INCOMPLETE', () => {
    const s: StorySources = { active: CUR('UI-1'), roadmap: flatRoadmap([]), storyIndex: null };
    expect(legacy(s).status).toBe('NOT_VERIFIED');
    expect(resolveStoryState(s, 'UI-1').consistency).toBe('INCOMPLETE');
  });

  it('legacy `Active Story:` naming a story while active.md says none: legacy → contradiction; resolver → LEGACY_ROADMAP_ACTIVE_STORY_DRIFT', () => {
    const s: StorySources = { active: NONE, roadmap: flatRoadmap([], 'Active Story: UI-1 — T'), storyIndex: idx(ent('UI-2', 'COMPLETED')) };
    expect(legacy(s).findings[0].message).toBe('active.md records no active story, but roadmap-index.md names "UI-1 — T".');
    expect(resolveStoryState(s, 'UI-1').diagnostics.map((d) => d.code)).toContain('LEGACY_ROADMAP_ACTIVE_STORY_DRIFT');
  });

  it('incomplete governance (nothing readable): both refuse to conclude', () => {
    const s: StorySources = { active: null, roadmap: null, storyIndex: null };
    expect(legacy(s).status).toBe('NOT_VERIFIED');
    const r = resolveStoryState(s, 'UI-1');
    expect([r.planning.state, r.active.state, r.finalization.state]).toEqual(['UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
    expect(r.consistency).toBe('INCOMPLETE');
  });
});

describe('legacy vs resolver — pinned, intentional differences (why the legacy path is kept)', () => {
  it('D1 duplicate entries: legacy is first-wins (silent); resolver reports a conflict', () => {
    const s: StorySources = { active: CUR('UI-1'), roadmap: flatRoadmap([]), storyIndex: idx(ent('UI-1', 'IN PROGRESS') + ent('UI-1', 'COMPLETED')) };
    expect(legacyActiveVsFinal(s, 'UI-1')).toBe(false); // first entry is not done → legacy says nothing
    const r = resolveStoryState(s, 'UI-1');
    expect(r.consistency).toBe('CONFLICT');
    expect(r.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['FINALIZATION_RECORDS_CONFLICT', 'ACTIVE_AND_FINALIZED']));
  });

  it('D2 lowercase status: legacy ignores it (status must be upper case); resolver normalises it', () => {
    const s: StorySources = { active: CUR('UI-1'), roadmap: flatRoadmap([]), storyIndex: idx(ent('UI-1', 'completed')) };
    expect(legacyActiveVsFinal(s, 'UI-1')).toBe(false);
    expect(resolveStoryState(s, 'UI-1').finalization.state).toBe('FINALIZED');
  });

  it('D3 scope: legacy compares status strings of EVERY id across roadmap and story-index; the resolver is per story and only judges lifecycle facts', () => {
    const s: StorySources = { active: NONE, roadmap: flatRoadmap(['| UI-1 | T | PLANNED | — |']), storyIndex: idx(ent('UI-1', 'IN PROGRESS')) };
    expect(legacy(s).findings.map((f) => f.message)).toEqual(['UI-1 is PLANNED in roadmap-index.md but IN PROGRESS in story-index.md.']);
    const r = resolveStoryState(s, 'UI-1');
    expect(r.consistency).not.toBe('CONFLICT'); // INCOMPLETE only because a flat roadmap declares no phase the story-index could match
    expect(r.diagnostics.map((d) => [d.code, d.level])).toEqual([['LISTED_NOT_FINAL', 'warn'], ['PHASE_ASSOCIATION_AMBIGUOUS', 'incomplete']]);
    expect(r.diagnostics.map((d) => d.code)).not.toContain('ACTIVE_AND_FINALIZED');
  });

  it('D4 conflicting phase references: only the resolver reports them (legacy has no phase notion)', () => {
    const roadmap = `# R\n\n## Phases\n\n### Phase 1 — A\n\n**Status:** IN PROGRESS\n\n| Story | T | Status | D |\n| - | - | - | - |\n| UI-1 | T | COMPLETED | — |\n\n### Phase 2 — B\n\n**Status:** PLANNED\n\n## Current Focus\n\nActive Phase: 1 — A\n`;
    const s: StorySources = { active: NONE, roadmap, storyIndex: `# S\n\n# Stories\n\n## Phase 2 — B\n\n${ent('UI-1', 'COMPLETED')}` };
    expect(legacy(s).status).toBe('CONSISTENT');
    expect(resolveStoryState(s, 'UI-1').consistency).toBe('CONFLICT');
  });

  it('D5 legacy messages stay legacy: the resolver never produces the public brief/finalize strings', () => {
    const s: StorySources = { active: CUR('UI-1'), roadmap: flatRoadmap([]), storyIndex: idx(ent('UI-1', 'COMPLETED')) };
    expect(legacy(s).findings[0].message).toBe('active.md treats UI-1 as current, but story-index.md marks it COMPLETED.');
    expect(resolveStoryState(s, 'UI-1').diagnostics.every((d) => !d.message.includes('treats UI-1 as current'))).toBe(true);
  });
});

describe('finalize: READY / digest / consistency are independent of the resolver', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  const CONFIG: ProjectConfig = { projectName: 'arch002b1', language: 'typescript', packageManager: 'pnpm', aiTool: 'claude', finalizationProtocol: 'finalize-story', protocols: ['finalize-story'], monolithRoot: '.monolith' };
  const EV = (k: string, id: string): string => `---\ntype: working\nid: ${k}\n---\n\n## Last Check\n\n**Status:** PASS\n**Date:** 2026-11-02\n**Story:** ${id} — t\n`;
  async function inst(roadmap: string | null): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'monolith-arch002b1-'));
    dirs.push(dir);
    await scaffoldInstance(dir, CONFIG);
    writeFileSync(join(dir, '.monolith/memory/working/integrity-result.md'), EV('integrity-result', 'X-1'));
    writeFileSync(join(dir, '.monolith/memory/working/governance-result.md'), EV('governance-result', 'X-1'));
    const rp = join(dir, '.monolith/context/maps/roadmap-index.md');
    if (roadmap === null) unlinkSync(rp);
    else writeFileSync(rp, roadmap);
    return dir;
  }
  const proposal = (): FinalizationProposal => {
    const r = parseProposal({
      schemaVersion: 1,
      story: { id: 'X-1', title: 'Story', phase: 'phase-1', phaseHeading: 'Phase 1 — Test', slug: 'story-x-1', date: '2026-11-02' },
      expectedCurrentStory: 'none',
      work: { objective: 'o', implementationSummary: 'i', filesChanged: ['a.ts'], tests: 't', keyDecisions: 'k', adrs: [], lessons: 'l' },
      summary: 's',
      keyOutputs: ['x'],
      history: { phaseName: '1', decision: 'd', build: 'PASS' },
    });
    if (!r.ok) throw new Error(r.errors.join('; '));
    return r.proposal;
  };

  it('plan status and digest do not depend on roadmap consistency; only the advisory block does', async () => {
    const bad = await inst(flatRoadmap(['| X-1 | T | IN PROGRESS | — |']));
    const good = await inst(flatRoadmap(['| X-1 | T | COMPLETED | — |']));
    const a = planFinalization(bad, proposal());
    const b = planFinalization(good, proposal());
    expect(a.status).toBe('READY');
    expect(b.status).toBe('READY');
    expect(a.consistency?.status).toBe('INCONSISTENT');
    expect(b.consistency?.status).toBe('CONSISTENT');
    // roadmap-index.md is not a required/allowed/target doc → it is outside the digest
    // (the digest also embeds the temp root path, so compare structure, not value)
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(a.checks.map((c) => [c.id, c.status])).toEqual(b.checks.map((c) => [c.id, c.status]));
    expect(a.targets.map((t) => [t.kind, t.state])).toEqual(b.targets.map((t) => [t.kind, t.state]));
  });

  it('same instance: planning twice yields the same digest, and apply with it succeeds (apply behaviour unchanged)', async () => {
    const dir = await inst(flatRoadmap(['| X-1 | T | IN PROGRESS | — |']));
    const p1 = planFinalization(dir, proposal());
    const p2 = planFinalization(dir, proposal());
    expect(p2.digest).toBe(p1.digest);
    const r = await applyFinalization(dir, proposal(), p1.digest);
    expect(r.status).toBe('FINALIZED');
    expect(r.plan.consistency?.status).toBe('INCONSISTENT');
  });

  it('missing roadmap: READY, consistency NOT_VERIFIED (no new blocking gate)', async () => {
    const dir = await inst(null);
    const p = planFinalization(dir, proposal());
    expect(p.status).toBe('READY');
    expect(p.consistency?.status).toBe('NOT_VERIFIED');
  });
});
