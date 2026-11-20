// @vitest-environment jsdom
/** GOV-EVOLUTION Phase 4: Knowledge Lab — Ideas and Hypotheses from independent sources. */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import KnowledgeLabPanel from '../components/KnowledgeLabPanel.vue';
import { isDashboardReadModel } from '../live/validate';
import { sectionFromHash } from '../sections';
import type { IdeasData, IdeaView, Section } from '../types/dashboard';

const src = (status: 'available' | 'absent' | 'forbidden' | 'unreadable' = 'available', code: string | null = null) => [
  { id: 'ideas' as const, path: '.monolith/memory/long-term/ideas', status, code: code as never },
];
function idea(n: number, over: Partial<IdeaView> = {}): IdeaView {
  const id = `IDEA-00${n}`;
  return { id, title: `Idea ${n}`, status: 'inbox', createdAt: `2026-01-0${n}T00:00:00.000Z`, description: `Description ${n}`, descriptionTruncated: false, context: null, tags: [], paths: [], path: `.monolith/memory/long-term/ideas/${id}.md`, ...over };
}
function ideas(items: IdeaView[], extra: Partial<IdeasData> = {}): Section<IdeasData> {
  return { sources: src(), data: { items, issues: [], truncated: false, complete: true, ...extra } };
}
const hyps = [{ id: 'HYP-001', title: 'A hypothesis', status: 'active', summary: 's', path: '.monolith/memory/long-term/hypotheses.md' }];

describe('Knowledge Lab', () => {
  it('lists ideas (IDEA-001..004) by default and keeps hypotheses on their own tab', async () => {
    const w = mount(KnowledgeLabPanel, { props: { ideas: ideas([1, 2, 3, 4].map((n) => idea(n))), hypotheses: hyps, demo: false } });
    expect(w.findAll('[data-testid="idea"]').map((x) => x.find('code').text())).toEqual(['IDEA-001', 'IDEA-002', 'IDEA-003', 'IDEA-004']);
    expect(w.find('[data-testid="knowledge-item"]').exists()).toBe(false);
    await w.get('[data-testid="tab-hypotheses"]').trigger('click');
    expect(w.findAll('[data-testid="knowledge-item"]')).toHaveLength(1);
    expect(w.find('[data-testid="idea"]').exists()).toBe(false);
  });

  it('searches, filters by status and shows details on demand', async () => {
    const items = [idea(1, { title: 'Map view' }), idea(2, { status: 'planned', description: 'needle in text' }), idea(3, { status: 'archived', tags: ['ui'] })];
    const w = mount(KnowledgeLabPanel, { props: { ideas: ideas(items), demo: false } });
    await w.get('[data-testid="ideas-status"]').setValue('planned');
    expect(w.findAll('[data-testid="idea"]')).toHaveLength(1);
    await w.get('[data-testid="ideas-status"]').setValue('all');
    await w.get('[data-testid="ideas-search"]').setValue('needle');
    expect(w.findAll('[data-testid="idea"]').map((x) => x.find('code').text())).toEqual(['IDEA-002']);
    await w.get('[data-testid="ideas-search"]').setValue('ui');
    expect(w.findAll('[data-testid="idea"]').map((x) => x.find('code').text())).toEqual(['IDEA-003']);
    await w.get('[data-testid="ideas-search"]').setValue('nothing-matches');
    expect(w.find('[data-testid="ideas-no-results"]').exists()).toBe(true);
    await w.get('[data-testid="ideas-search"]').setValue('');
    expect(w.find('[data-testid="idea-detail"]').exists()).toBe(false);
    await w.findAll('[data-testid="idea-toggle"]')[1].trigger('click');
    expect(w.get('[data-testid="idea-description"]').text()).toBe('needle in text');
  });

  it('never executes or renders idea content as markup; has no edit controls', async () => {
    const evil = idea(1, { title: '<img src=x onerror=alert(1)>', description: '<script>alert(1)</script>' });
    const w = mount(KnowledgeLabPanel, { props: { ideas: ideas([evil]), demo: false } });
    await w.get('[data-testid="idea-toggle"]').trigger('click');
    expect(w.find('img').exists()).toBe(false);
    expect(w.find('script').exists()).toBe(false);
    expect(w.text()).toContain('<script>alert(1)</script>');
    expect(w.findAll('textarea, form').length).toBe(0);
  });

  it('keeps the four situations apart: not provided, absent, error, empty', () => {
    expect(mount(KnowledgeLabPanel, { props: { demo: false } }).find('[data-testid="ideas-unprovided"]').exists()).toBe(true);
    const absent = mount(KnowledgeLabPanel, { props: { ideas: { data: null, sources: src('absent', 'SOURCE_ABSENT') }, demo: false } });
    expect(absent.get('[data-testid="ideas-absent"]').text()).toContain('No idea has been captured yet');
    const err = mount(KnowledgeLabPanel, { props: { ideas: { data: null, sources: src('forbidden', 'SOURCE_SYMLINK') }, demo: false } });
    expect(err.get('[data-testid="ideas-error"]').text()).toContain('SOURCE_SYMLINK');
    expect(err.find('[data-testid="ideas-empty"]').exists()).toBe(false);
    expect(mount(KnowledgeLabPanel, { props: { ideas: ideas([]), demo: false } }).get('[data-testid="ideas-empty"]').text()).toBe('No ideas recorded.');
  });

  it('says when idea files could not be read', () => {
    const w = mount(KnowledgeLabPanel, { props: { ideas: ideas([idea(1)], { issues: [{ id: 'IDEA-002', code: 'IDEA_CORRUPT' }], complete: false }), demo: false } });
    expect(w.get('[data-testid="ideas-incomplete"]').text()).toContain('INCOMPLETE');
    expect(w.get('[data-testid="ideas-issue"]').text()).toContain('IDEA-002');
    expect(w.findAll('[data-testid="idea"]')).toHaveLength(1);
  });

  it('works with no ideas and no hypotheses sources at all', async () => {
    const w = mount(KnowledgeLabPanel, { props: { demo: false } });
    await w.get('[data-testid="tab-hypotheses"]').trigger('click');
    expect(w.find('[data-testid="knowledge-unprovided"]').exists()).toBe(true);
  });

  it('the earlier #hypotheses link opens the Knowledge Lab', () => {
    expect(sectionFromHash('#hypotheses')).toBe('knowledge');
  });

  it('validates the ideas section of the DTO', () => {
    const base = {
      projectOverview: { data: null, sources: [] }, currentMissions: { data: null, sources: [] }, checkpoints: { data: null, sources: [] },
      roadmap: { data: null, sources: [] }, diagnostics: { validation: 'NOT_PERFORMED', sources: [], notes: [] },
    };
    expect(isDashboardReadModel({ ...base, ideas: ideas([idea(1)]) })).toBe(true);
    const bad = ideas([idea(1)]);
    (bad.data!.items[0] as unknown as { status: string }).status = 'bogus';
    expect(isDashboardReadModel({ ...base, ideas: bad })).toBe(false);
  });
});
