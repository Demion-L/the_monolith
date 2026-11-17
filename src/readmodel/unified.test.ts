import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readDashboardModel, HYPOTHESES_REL } from './index.js';

// UI-006: the merged read model must carry the BETA-020 and UI-004B fields side by side.
let dir: string;
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'uni-'))); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function write(rel: string, content: string): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

describe('unified DashboardReadModel', () => {
  it('has roadmap, hypotheses, decisions, diagnostics and state provenance together', () => {
    write('monolith.config.json', JSON.stringify({ project: { name: 'X' } }));
    write('.monolith/state.json', JSON.stringify({ schemaVersion: 3, revision: 1, monolithVersion: '0.2.0-beta.1', missions: [], checkpoints: [] }));
    write('.monolith/context/maps/roadmap-index.md', '# R\n\n## Phases\n\n### Phase 1 — One\n\n**Status:** complete\n');
    write(`.monolith/${HYPOTHESES_REL}`, '# H\n\n## One {#HYP-001}\n\n**Status:** active\n');
    write('docs/adr/ADR-001-x.md', '---\ntype: adr\nid: ADR-001\ntitle: X\nstatus: accepted\n---\n\n# ADR-001\n');
    const m = readDashboardModel(dir);
    expect(m.roadmap.data?.structured?.phases.length).toBeGreaterThan(0);
    expect(m.hypotheses?.data?.items.map((i) => i.id)).toEqual(['HYP-001']);
    expect(m.decisions?.data?.items.map((i) => i.id)).toEqual(['ADR-001']);
    expect(m.diagnostics.sources.map((s) => s.id)).toEqual(['config', 'state', 'activeStory', 'roadmap']);
    expect(m.diagnostics.state).toBeDefined();
    expect(m.diagnostics.validation).toBe('NOT_PERFORMED');
    // JSON round trip keeps every field (no undefined/null mix-up between branches).
    const json = JSON.parse(JSON.stringify(m)) as typeof m;
    expect(json.hypotheses?.data?.complete).toBe(true);
    expect(json.diagnostics.state?.mode).toBe(m.diagnostics.state?.mode);
  });

  it('a missing source is NOT an empty collection; a missing project keeps both knowledge sections null', () => {
    write('monolith.config.json', JSON.stringify({ project: { name: 'X' } }));
    const m = readDashboardModel(dir);
    expect(m.hypotheses?.data).toBeNull();
    expect(m.hypotheses?.sources[0].status).toBe('absent');
    expect(m.decisions?.data).toBeNull();
  });
});
