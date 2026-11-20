/**
 * GOV-EVOLUTION Phases 1-2: the shipped templates and the documented formats must be
 * readable by Core's own parsers, and the diagnostics must tell EMPTY / UNRECOGNIZED /
 * INCOMPLETE apart. No second parser: everything below runs the existing ones.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRoadmapPhases } from './roadmap.js';
import { parseStoryIndex } from './story-index.js';
import { parseAdr, readDecisions } from './knowledge.js';
import { buildStoryAuthorityContext, resolveStoryStateIn } from './story-state.js';

const here = dirname(fileURLToPath(import.meta.url));
const TPL = resolve(here, '..', '..', 'templates', 'default-instance', 'monolith');
const read = (rel: string): string => readFileSync(join(TPL, rel), 'utf8');
const fences = (md: string): string[] => [...md.matchAll(/```markdown\n([\s\S]*?)```/g)].map((m) => m[1]);

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'gov-fmt-'));
  dirs.push(d);
  return d;
}

describe('templates are readable by Core (Phase 1)', () => {
  it('the roadmap template has only recognised statuses and no active phase', () => {
    const r = parseRoadmapPhases(read('context/maps/roadmap-index.md').replace(/\{\{PROJECT_NAME\}\}/g, 'X'));
    expect(r.state).toBe('ok');
    expect(r.phases[0].id).toBe('1');
    expect(r.phases[0].status.recognized).toBe(true);
    expect(r.activePhase).toEqual({ kind: 'none' });
    expect(r.diagnostics.filter((d) => d.severity === 'warn')).toEqual([]);
  });

  it('the documented roadmap example is parsed as documented; the wrong pointer is not', () => {
    const doc = read('protocols/governance/document-formats.md');
    const example = fences(doc)[0];
    const ok = parseRoadmapPhases(example.replace(/ {2,}<-.*$/gm, ''));
    expect(ok.phases.map((p) => p.id)).toEqual(['6']);
    expect(ok.phases[0].status).toMatchObject({ value: 'IN PROGRESS', recognized: true });
    expect(ok.activePhase).toEqual({ kind: 'phase', id: '6' });

    const wrong = parseRoadmapPhases(example.replace(/ {2,}<-.*$/gm, '').replace('Active Phase: 6', 'Active Phase: Phase 6'));
    expect(wrong.activePhase).toEqual({ kind: 'unmatched' });
    expect(wrong.diagnostics.map((d) => d.code)).toContain('ACTIVE_PHASE_UNMATCHED');
  });

  it('READY FOR REVIEW is not a Phase status (reported, never accepted)', () => {
    const r = parseRoadmapPhases('## Phases\n\n### Phase 1 — A\n\n**Status:** READY FOR REVIEW\n\n## Current Focus\n\nActive Phase: 1 — A\n');
    expect(r.phases[0].status.recognized).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain('PHASE_STATUS_UNRECOGNIZED');
  });

  it('the ADR template block is a valid ADR for Core', () => {
    const block = fences(read('context/templates/adr-template.md'))[0].replace('ADR-NNN', 'ADR-001').replace('ADR-NNN', 'ADR-001');
    const { item, issues } = parseAdr(block, 'ADR-001-example.md', 'docs/adr/ADR-001-example.md');
    expect(item).toMatchObject({ id: 'ADR-001', status: 'proposed' });
    expect(issues.list.filter((i) => i.severity === 'warn')).toEqual([]);
  });

  it('the template itself is not listed as an ADR', () => {
    const root = tmp();
    mkdirSync(join(root, 'docs/adr'), { recursive: true });
    writeFileSync(join(root, 'docs/adr/ADR-001-a.md'), '---\ntype: adr\nid: ADR-001\nstatus: accepted\n---\n# A\n');
    const s = readDecisions(root);
    expect(s.data?.items.map((i) => i.id)).toEqual(['ADR-001']);
    expect(s.data?.complete).toBe(true);
  });
});

describe('honest diagnostics (Phase 2)', () => {
  it('Story Index: a valid but empty index is none_finalized, not unrecognized', () => {
    const v = parseStoryIndex(read('memory/working/story-index.md'), null);
    expect(v.state).toBe('none_finalized');
    expect(v.stories).toEqual([]);
    expect(v.diagnostics).toEqual([{ code: 'NO_FINALIZED_STORIES', severity: 'info', storyIndex: null }]);
  });

  it('Story Index: the other situations stay distinct', () => {
    expect(parseStoryIndex('   \n', null).state).toBe('empty');
    expect(parseStoryIndex('Some notes without structure.\n', null).state).toBe('unrecognized');
    expect(parseStoryIndex('# Stories\n\nfree text, nothing finalized\n\n## Notes\n', null).state).toBe('none_finalized');
    expect(parseStoryIndex('# Stories\n\n## Phase 1 — A\n', ['1']).state).toBe('no_stories');
    expect(parseStoryIndex('# Stories\n\n### broken heading\n', null).state).toBe('partial');
    const ok = parseStoryIndex('# Stories\n\n## Phase 1 — A\n\n### STORY 1.1 — T\n\n**Status:** COMPLETED\n**Date:** 2026-01-01\n', ['1']);
    expect(ok.state).toBe('ok');
    expect(ok.stories).toHaveLength(1);
  });

  it('Story Index: nothing is synthesized from the Roadmap', () => {
    const roadmap = '## Phases\n\n### Phase 1 — A\n\n**Status:** COMPLETE\n\nStories:\n\n- STORY 1.1 — X\n';
    const ctx = buildStoryAuthorityContext({ active: null, roadmap, storyIndex: read('memory/working/story-index.md') });
    expect(ctx.storyIndex?.stories).toEqual([]);
    expect(ctx.sources.storyIndex).toBe('available');
    expect(resolveStoryStateIn(ctx, '1.1').finalization.state).toBe('NOT_FINALIZED');
  });

  it('ADR without frontmatter makes the list incomplete and names the file', () => {
    const root = tmp();
    mkdirSync(join(root, 'docs/adr'), { recursive: true });
    writeFileSync(join(root, 'docs/adr/ADR-001-ok.md'), '---\ntype: adr\nid: ADR-001\nstatus: accepted\n---\n# A\n');
    writeFileSync(join(root, 'docs/adr/ADR-002-nofm.md'), '# ADR-002\n\n**Status:** accepted\n');
    const s = readDecisions(root);
    expect(s.data?.items.map((i) => i.id)).toEqual(['ADR-001']);
    expect(s.data?.complete).toBe(false);
    expect(s.data?.issues).toContainEqual({ code: 'ADR_FRONTMATTER_MISSING', severity: 'warn', path: 'docs/adr/ADR-002-nofm.md', id: null, reason: null });
  });
});
