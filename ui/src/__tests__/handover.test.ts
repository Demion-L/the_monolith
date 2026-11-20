// @vitest-environment jsdom
/** ACCOUNTABILITY-001: Handover section — states, visual semantics, read-only fetch. */
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import HandoverPanel from '../components/HandoverPanel.vue';
import { demoHandover } from '../fixtures/handover';
import { fetchHandover, isHandoverReport } from '../live/handover';
import { isKnownHash, sectionFromHash } from '../sections';
import type { HandoverReport } from '../../../src/handover/types';

const pills = (w: ReturnType<typeof mount>): string[] => w.findAll('[data-testid="pill"]').map((p) => p.text());
const clone = (o: Partial<HandoverReport>): HandoverReport => ({ ...structuredClone(demoHandover), ...o });

describe('Handover panel', () => {
  it('is a navigable section', () => {
    expect(isKnownHash('handover')).toBe(true);
    expect(sectionFromHash('#handover')).toBe('handover');
  });

  it('keeps VERIFIED, REPORTED, STALE, UNKNOWN and FAILED apart, and never shows the status as green', () => {
    const w = mount(HandoverPanel, { props: { demoReport: demoHandover } });
    const items = w.findAll('[data-testid="handover-evidence"]');
    const tone = (i: number): string => items[i].find('[data-testid="pill"]').classes().join(' ');
    expect(items).toHaveLength(5);
    expect(tone(0)).toContain('pill-ok'); // VERIFIED
    expect(tone(1)).toContain('pill-info'); // REPORTED: not green
    expect(tone(2)).toContain('pill-warn'); // STALE
    expect(tone(3)).toContain('pill-neutral'); // UNKNOWN (dirty)
    expect(tone(4)).toContain('pill-err'); // FAILED
    // exactly one green pill among the evidence cards
    expect(items.filter((_, i) => tone(i).includes('pill-ok'))).toHaveLength(1);
    const status = w.get('[data-testid="handover-status"] [data-testid="pill"]');
    expect(status.classes().join(' ')).not.toContain('pill-ok');
    expect(w.text()).toContain('does not say the project is correct');
  });

  it.each(['READY_FOR_REVIEW', 'REVIEW_WITH_ISSUES', 'INCOMPLETE', 'UNKNOWN'] as const)('status %s is never green', (status) => {
    const w = mount(HandoverPanel, { props: { demoReport: clone({ status }) } });
    const p = w.get('[data-testid="handover-status"] [data-testid="pill"]');
    expect(p.classes().join(' ')).not.toContain('pill-ok');
    expect(p.text()).toBe(status.replace(/_/g, ' '));
  });

  it('shows missing data as missing, with no invented COMPLETE', () => {
    const empty = clone({
      status: 'INCOMPLETE',
      statusReasons: ['STATE_UNAVAILABLE'],
      progress: { planned: 0, active: 0, finalized: 0, listedNotFinal: 0, awaitingReview: [], unknown: 0, stories: [], storiesTruncated: false },
      architecture: { available: false, total: 0, accepted: 0, proposed: 0, other: [], unrecognized: 0, missingMetadata: 0, complete: false },
      verification: { git: { available: false, head: null, dirty: null }, counts: { verified: 0, reported: 0, stale: 0, unknown: 0, failed: 0 }, items: [], unreadableRecords: 0, recordsTruncated: false, storiesWithoutVerifiedEvidence: [] },
      outstanding: { issues: [], ownerDecisions: [] },
    });
    const w = mount(HandoverPanel, { props: { demoReport: empty } });
    expect(w.find('[data-testid="handover-no-stories"]').exists()).toBe(true);
    expect(w.get('[data-testid="handover-adr"]').text()).toContain('UNKNOWN');
    expect(w.get('[data-testid="handover-git"]').text()).toContain('unavailable');
    expect(w.find('[data-testid="handover-no-evidence"]').exists()).toBe(true);
    expect(w.get('[data-testid="handover-no-issues"]').text()).toContain('does not mean the project is correct');
    expect(w.text()).not.toMatch(/\bCOMPLETE\b/);
  });

  it('lists unverified completions, owner decisions and the story awaiting review', () => {
    const w = mount(HandoverPanel, { props: { demoReport: demoHandover } });
    expect(w.get('[data-testid="handover-unverified"]').text()).toContain('S-3');
    expect(w.get('[data-testid="handover-decision"]').text()).toContain('FINALIZE_STORY');
    expect(w.get('[data-testid="handover-awaiting"]').text()).toContain('S-3');
    expect(w.findAll('[data-testid="handover-issue"]').map((i) => i.find('[data-testid="pill"]').text())).toEqual(['CONFLICT', 'UNVERIFIED', 'ATTENTION']);
  });

  it('renders untrusted text as text, not markup', () => {
    const r = clone({});
    r.outstanding.issues[0].message = '<img src=x onerror=alert(1)>';
    const w = mount(HandoverPanel, { props: { demoReport: r } });
    expect(w.find('img').exists()).toBe(false);
    expect(w.text()).toContain('<img src=x');
  });

  it('live mode loads once on open and again only on Refresh; failures leave no stale data', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(demoHandover), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const w = mount(HandoverPanel);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method, init.credentials]).toEqual(['/api/handover', 'GET', 'omit']);
    expect(w.find('[data-testid="handover-status"]').exists()).toBe(true);
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 500 }));
    await w.get('[data-testid="handover-refresh"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(w.find('[data-testid="handover-status"]').exists()).toBe(false);
    expect(w.get('[data-testid="handover-error"]').text()).toContain('HTTP 500');
    vi.unstubAllGlobals();
  });
});

describe('handover client', () => {
  it('accepts only a structurally valid report', async () => {
    expect(isHandoverReport(demoHandover)).toBe(true);
    expect(isHandoverReport({ ...demoHandover, status: 'PRODUCTION_READY' })).toBe(false);
    expect(isHandoverReport({ ...demoHandover, schema: 2 })).toBe(false);
    expect(isHandoverReport(null)).toBe(false);
    const bad = vi.fn(async () => new Response('{"schema":1}', { status: 200 }));
    await expect(fetchHandover(bad as unknown as typeof fetch)).rejects.toThrow('unexpected data shape');
    const unreachable = vi.fn(async () => {
      throw new Error('x');
    });
    await expect(fetchHandover(unreachable as unknown as typeof fetch)).rejects.toThrow('unreachable');
  });
});
