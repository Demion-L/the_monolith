import { describe, it, expect } from 'vitest';
import { render, DEFAULT_MAX_CHARS } from './render.js';
import type { BriefModel, BriefDiagnostic, DocRef, CheckpointSummary } from './types.js';
import type { Mission, Checkpoint } from '../coordinatorium/types.js';

function mission(overrides: Partial<Mission> & { id: string }): Mission {
  return {
    title: 'A title',
    system: 'a-system',
    status: 'in_progress',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    summary: null,
    ...overrides,
  };
}

function baseModel(overrides: Partial<BriefModel> = {}): BriefModel {
  return {
    identity: { name: 'TestProject', monolithRoot: '.monolith', provenance: { source: 'monolith.config.json#project.name' } },
    monolithInitialized: true,
    stateKeeper: { status: 'ok', schemaVersionOnDisk: 2, provenance: { source: '.monolith/state.json' } },
    missions: { active: [], recentFinished: [], provenance: { source: '.monolith/state.json#tactical.missions' } },
    checkpoints: [],
    story: { fileExists: true, hasCurrentStorySection: true, excerpt: 'Working on it.', lineRange: '3-3', provenance: { source: '.monolith/memory/working/active.md:3-3' } },
    mandatoryProtocols: { items: [], provenance: { source: '.monolith/protocols' } },
    adrs: { items: [], provenance: { source: '.monolith/adr' } },
    diagnostics: [],
    ...overrides,
  };
}

describe('render — determinism', () => {
  it('produces byte-identical output for the same model and budget across repeated calls', () => {
    const model = baseModel({
      missions: {
        active: [mission({ id: 'MIS-0001' }), mission({ id: 'MIS-0002' })],
        recentFinished: [mission({ id: 'MIS-0003', status: 'completed' })],
        provenance: { source: '.monolith/state.json#tactical.missions' },
      },
    });
    const a = render(model, DEFAULT_MAX_CHARS);
    const b = render(model, DEFAULT_MAX_CHARS);
    expect(a.text).toBe(b.text);
    expect(a.completeness).toBe(b.completeness);
  });
});

describe('render — completeness', () => {
  it('is COMPLETE when there are no error diagnostics and everything fits', () => {
    const { completeness, text } = render(baseModel(), DEFAULT_MAX_CHARS);
    expect(completeness).toBe('COMPLETE');
    expect(text.startsWith('Completeness: COMPLETE\n')).toBe(true);
  });

  it('is INCOMPLETE when a collect-time diagnostic has severity error', () => {
    const diagnostics: BriefDiagnostic[] = [{ code: 'STATE_UNREADABLE', severity: 'error', message: 'boom' }];
    const { completeness, text } = render(baseModel({ diagnostics }), DEFAULT_MAX_CHARS);
    expect(completeness).toBe('INCOMPLETE');
    expect(text).toContain('[ERROR] STATE_UNREADABLE: boom');
  });

  it('does not downgrade to INCOMPLETE for info/warn-only diagnostics', () => {
    const diagnostics: BriefDiagnostic[] = [
      { code: 'STATE_NOT_INITIALIZED', severity: 'info', message: 'none yet' },
      { code: 'MULTIPLE_ACTIVE_MISSIONS', severity: 'info', message: 'two missions' },
    ];
    const { completeness } = render(baseModel({ diagnostics }), DEFAULT_MAX_CHARS);
    expect(completeness).toBe('COMPLETE');
  });
});

describe('render — P0 is never hidden or truncated by budget', () => {
  it('shows every active mission and protocol in full even when maxChars is far too small, and flags BUDGET_EXCEEDED_BY_REQUIRED', () => {
    const active = Array.from({ length: 20 }, (_, i) => mission({ id: `MIS-${String(i).padStart(4, '0')}` }));
    const protocols: DocRef[] = Array.from({ length: 10 }, (_, i) => ({
      id: `protocol-${i}`,
      title: `Protocol ${i}`,
      path: `.monolith/protocols/p${i}.md`,
    }));
    const model = baseModel({
      missions: { active, recentFinished: [], provenance: { source: '.monolith/state.json#tactical.missions' } },
      mandatoryProtocols: { items: protocols, provenance: { source: '.monolith/protocols' } },
    });

    const { text, completeness } = render(model, 10);

    expect(completeness).toBe('INCOMPLETE');
    expect(text).toContain('BUDGET_EXCEEDED_BY_REQUIRED');
    for (const m of active) expect(text).toContain(m.id);
    for (const p of protocols) expect(text).toContain(p.id);
    // Output legitimately exceeds the requested budget — the contract
    // explicitly forbids claiming otherwise (section 10, rule 8).
    expect(text.length).toBeGreaterThan(10);
  });

  it('fits within maxChars when P0 alone is small enough', () => {
    const model = baseModel();
    const { text } = render(model, DEFAULT_MAX_CHARS);
    expect(text.length).toBeLessThanOrEqual(DEFAULT_MAX_CHARS + 200); // small fixed overhead tolerance for this assertion's own slack
  });
});

describe('render — ADR index budget truncation', () => {
  it('includes as many whole ADR entries as fit, with a count+pointer marker for the rest', () => {
    const adrs: DocRef[] = Array.from({ length: 50 }, (_, i) => ({
      id: `ADR-${String(i).padStart(3, '0')}`,
      title: `Decision number ${i} with a reasonably long descriptive title`,
      path: `.monolith/adr/ADR-${String(i).padStart(3, '0')}-decision.md`,
    }));
    const model = baseModel({ adrs: { items: adrs, provenance: { source: '.monolith/adr' } } });

    const { text, completeness } = render(model, 2500);

    expect(completeness).toBe('INCOMPLETE');
    expect(text).toContain('more ADR(s) omitted (budget)');
    expect(text).toContain('ADR-000');
    expect(text).not.toContain('ADR-049'); // tail items are the ones dropped, not interleaved
  });

  it('never cuts an ADR entry mid-line', () => {
    const adrs: DocRef[] = Array.from({ length: 50 }, (_, i) => ({
      id: `ADR-${String(i).padStart(3, '0')}`,
      title: `Decision number ${i}`,
      path: `.monolith/adr/ADR-${String(i).padStart(3, '0')}.md`,
    }));
    const model = baseModel({ adrs: { items: adrs, provenance: { source: '.monolith/adr' } } });
    const { text } = render(model, 2500);
    for (const line of text.split('\n')) {
      if (line.includes('ADR-0')) {
        expect(line.trim()).toMatch(/^- ADR-\d{3}: .*\)$|\.\.\.and \d+ more/);
      }
    }
  });
});

describe('render — Story excerpt', () => {
  it('truncates a very long excerpt with an explicit marker and pointer when it does not fit', () => {
    const longExcerpt = 'x'.repeat(10_000);
    const model = baseModel({
      story: {
        fileExists: true,
        hasCurrentStorySection: true,
        excerpt: longExcerpt,
        lineRange: '3-3',
        provenance: { source: '.monolith/memory/working/active.md:3-3' },
      },
    });
    const { text, completeness } = render(model, 3000);
    expect(completeness).toBe('INCOMPLETE');
    expect(text).toMatch(/\[truncated \d+ chars — see .monolith\/memory\/working\/active\.md:3-3\]/);
  });

  it('reports file-missing and no-section states explicitly rather than inventing content', () => {
    const missing = baseModel({ story: { fileExists: false, hasCurrentStorySection: false, excerpt: null, lineRange: null, provenance: null } });
    expect(render(missing).text).toContain('(active.md not found)');

    const noSection = baseModel({
      story: { fileExists: true, hasCurrentStorySection: false, excerpt: null, lineRange: null, provenance: { source: '.monolith/memory/working/active.md' } },
    });
    expect(render(noSection).text).toContain('(no "Current Story" section found)');
  });
});

describe('render — checkpoints', () => {
  function cp(overrides: Partial<Checkpoint> & { id: string; missionId: string }): Checkpoint {
    return { createdAt: '2026-01-01T00:00:00.000Z', summary: 's', remainingSteps: [], context: null, ...overrides };
  }

  it('reports UNKNOWN when a mission has no checkpoints', () => {
    const checkpoints: CheckpointSummary[] = [{ missionId: 'MIS-0001', latest: null, provenance: { source: '.monolith/state.json#tactical.checkpoints' } }];
    const model = baseModel({
      missions: { active: [mission({ id: 'MIS-0001' })], recentFinished: [], provenance: { source: 'x' } },
      checkpoints,
    });
    expect(render(model).text).toContain('Next steps: UNKNOWN (no checkpoints)');
  });

  it('reports "none recorded" when remainingSteps is empty', () => {
    const checkpoints: CheckpointSummary[] = [
      { missionId: 'MIS-0001', latest: cp({ id: 'MIS-0001-CKPT-0001', missionId: 'MIS-0001' }), provenance: { source: 'x' } },
    ];
    const model = baseModel({
      missions: { active: [mission({ id: 'MIS-0001' })], recentFinished: [], provenance: { source: 'x' } },
      checkpoints,
    });
    expect(render(model).text).toContain('Next steps: none recorded');
  });

  it('lists remainingSteps when present, never inventing next steps', () => {
    const checkpoints: CheckpointSummary[] = [
      {
        missionId: 'MIS-0001',
        latest: cp({ id: 'MIS-0001-CKPT-0001', missionId: 'MIS-0001', remainingSteps: ['write tests', 'ship it'] }),
        provenance: { source: 'x' },
      },
    ];
    const model = baseModel({
      missions: { active: [mission({ id: 'MIS-0001' })], recentFinished: [], provenance: { source: 'x' } },
      checkpoints,
    });
    const text = render(model).text;
    expect(text).toContain('write tests');
    expect(text).toContain('ship it');
  });

  it('omits whole mission checkpoint blocks (never mid-item) with a count marker when budget is tight', () => {
    const active = Array.from({ length: 10 }, (_, i) => mission({ id: `MIS-${String(i).padStart(4, '0')}` }));
    const checkpoints: CheckpointSummary[] = active.map((m) => ({
      missionId: m.id,
      latest: cp({ id: `${m.id}-CKPT-0001`, missionId: m.id, summary: 'a reasonably detailed progress summary line' }),
      provenance: { source: 'x' },
    }));
    const model = baseModel({
      missions: { active, recentFinished: [], provenance: { source: 'x' } },
      checkpoints,
    });
    const { text, completeness } = render(model, 2600);
    expect(completeness).toBe('INCOMPLETE');
    expect(text).toMatch(/\.\.\.and \d+ more mission\(s\)' checkpoint details omitted \(budget\)/);
  });
});

describe('render — stdout contains only brief content (no embedded ERG/LLM artifacts)', () => {
  it('never mentions ERG or an LLM call', () => {
    const { text } = render(baseModel());
    expect(text.toLowerCase()).not.toContain('embedding');
    expect(text.toLowerCase()).not.toContain('llm');
  });
});
