import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.vue';
import CheckpointsPanel from '../components/CheckpointsPanel.vue';
import CurrentMission from '../components/CurrentMission.vue';
import RoadmapPanel from '../components/RoadmapPanel.vue';
import { normalScenario } from '../fixtures/dashboard';

// DEMO is only entered explicitly; these tests exercise the synthetic fixtures.
beforeEach(() => {
  window.history.replaceState({}, '', '/?mode=demo');
});

async function appWith(scenario: string) {
  const w = mount(App);
  await w.get('[data-testid="scenario-select"]').setValue(scenario);
  return w;
}

describe('dashboard', () => {
  it('DEMO never calls the HTTP API', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    try {
      const w = mount(App);
      await w.get('[data-testid="scenario-select"]').setValue('empty');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders all five sections', () => {
    const w = mount(App);
    for (const id of ['overview', 'mission', 'checkpoints', 'roadmap', 'diagnostics']) {
      expect(w.find(`section#${id}`).exists(), id).toBe(true);
    }
  });

  it('shows the DEMO DATA badge in every scenario', async () => {
    for (const s of ['normal', 'partial', 'empty']) {
      const w = await appWith(s);
      expect(w.get('[data-testid="demo-badge"]').text()).toBe('DEMO DATA');
    }
  });

  it('renders every in_progress mission and hides finished ones', () => {
    const w = mount(CurrentMission, { props: { missions: normalScenario.missions } });
    const cards = w.findAll('[data-testid="mission"]');
    expect(cards).toHaveLength(2);
    expect(w.text()).toContain('MIS-0003');
    expect(w.text()).toContain('MIS-0004');
    expect(w.text()).not.toContain('MIS-0002');
  });

  it('shows empty states in the empty scenario', async () => {
    const w = await appWith('empty');
    expect(w.text()).toContain('No active missions.');
    expect(w.text()).toContain('No checkpoints recorded.');
    expect(w.findAll('[data-testid="mission"]')).toHaveLength(0);
  });

  it('shows UNKNOWN for missing data in the partial scenario', async () => {
    const w = await appWith('partial');
    expect(w.findAll('.unknown').length).toBeGreaterThan(3);
    expect(w.get('#mission').text()).toContain('UNKNOWN');
    expect(w.get('#roadmap').text()).toContain('NOT AVAILABLE');
    expect(w.get('[data-testid="missing"]').text()).toContain('overview.description');
  });

  it('renders roadmap HTML-like text as plain text', () => {
    const text = '<script>window.__pwn = 1</script>\n<b>bold</b>\nline 3';
    const w = mount(RoadmapPanel, { props: { text } });
    const pre = w.get('[data-testid="roadmap-text"]');
    expect(pre.element.textContent).toBe(text);
    expect(pre.find('script').exists()).toBe(false);
    expect(pre.find('b').exists()).toBe(false);
  });

  it('labels remainingSteps as a historical record', () => {
    const w = mount(CheckpointsPanel, { props: { checkpoints: normalScenario.checkpoints } });
    expect(w.text()).toContain('historical record as of this checkpoint, not the current plan');
    expect(w.text()).toContain('Validate offset ranges');
  });

  it('shows "Roadmap is empty." for an empty roadmap', () => {
    const w = mount(RoadmapPanel, { props: { text: '' } });
    expect(w.text()).toContain('Roadmap is empty.');
    expect(w.find('[data-testid="roadmap-text"]').exists()).toBe(false);
  });

  it('DEMO checkpoints without a count do not claim one', () => {
    const w = mount(CheckpointsPanel, { props: { checkpoints: normalScenario.checkpoints } });
    expect(w.text()).toContain('Latest checkpoint per active mission');
    expect(w.find('[data-testid="checkpoint-count"]').exists()).toBe(false);
    expect(w.text()).not.toMatch(/recorded checkpoint/);
  });

  it('shows "None recorded." for empty remainingSteps', () => {
    const checkpoints = [{ ...normalScenario.checkpoints![0], remainingSteps: [] }];
    const w = mount(CheckpointsPanel, { props: { checkpoints } });
    expect(w.text()).toContain('None recorded.');
    expect(w.text()).not.toContain('UNKNOWN');
  });

  it('leaves no stale data when switching normal -> partial -> empty -> normal', async () => {
    const w = mount(App);
    const select = w.get('[data-testid="scenario-select"]');
    const diagnostics = () => w.findAll('[data-testid="diagnostic"]').map((d) => d.text());

    expect(w.text()).toContain('MIS-0003');
    expect(diagnostics().join('|')).toContain('Fixture "normal" loaded.');

    await select.setValue('partial');
    expect(w.text()).toContain('MIS-0007');
    expect(w.text()).not.toContain('MIS-0003');
    expect(w.text()).not.toContain('Validate offset ranges');
    expect(w.text()).not.toContain('Tidewatch roadmap');
    expect(diagnostics().join('|')).toContain('Fixture "partial" loaded.');
    expect(diagnostics().join('|')).not.toContain('Fixture "normal" loaded.');
    expect(w.get('[data-testid="missing"]').text()).toContain('overview.description');

    await select.setValue('empty');
    expect(w.text()).not.toContain('MIS-0007');
    expect(w.findAll('[data-testid="mission"]')).toHaveLength(0);
    expect(w.findAll('[data-testid="checkpoint"]')).toHaveLength(0);
    expect(w.text()).toContain('Roadmap is empty.');
    expect(diagnostics()).toEqual(['info Fixture "empty" loaded.']);
    expect(w.find('[data-testid="missing"]').exists()).toBe(false);
    expect(w.find('.unknown').exists()).toBe(false);

    await select.setValue('normal');
    expect(w.findAll('[data-testid="mission"]')).toHaveLength(2);
    expect(w.text()).toContain('MIS-0003');
    expect(w.text()).not.toContain('MIS-0007');
    expect(w.text()).not.toContain('Roadmap is empty.');
    expect(diagnostics().join('|')).toContain('Fixture "normal" loaded.');
    expect(diagnostics().join('|')).not.toContain('Fixture "empty" loaded.');
  });
});
