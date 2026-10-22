import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from '../App.vue';
import CheckpointsPanel from '../components/CheckpointsPanel.vue';
import CurrentMission from '../components/CurrentMission.vue';
import RoadmapPanel from '../components/RoadmapPanel.vue';
import { normalScenario } from '../fixtures/dashboard';

async function appWith(scenario: string) {
  const w = mount(App);
  await w.get('[data-testid="scenario-select"]').setValue(scenario);
  return w;
}

describe('dashboard', () => {
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
});
