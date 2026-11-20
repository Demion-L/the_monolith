/**
 * GOV-EVOLUTION Phase 5: `monolith governance check`. GOV-001 problems are reproduced in a
 * disposable instance (never the real KAIROS) and must be reported; a clean instance must not be.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldInstance } from '../init/scaffold.js';
import type { ProjectConfig } from '../init/types.js';
import { renderCapsule } from '../finalize/core.js';
import { buildGovernanceReport } from './check.js';
import { checkCapsuleText } from './capsules.js';
import { parseGovernanceArgs, renderGovernanceReport, runGovernanceCommand } from './cli.js';
import type { GovernanceReport } from './types.js';

const CONFIG: ProjectConfig = {
  projectName: 'Fixture', language: 'typescript', packageManager: 'pnpm', aiTool: 'claude',
  finalizationProtocol: 'finalize-story', protocols: ['finalize-story'], monolithRoot: '.monolith',
};
let dir: string;
beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'gov-')));
  const log = console.log;
  console.log = () => undefined; // scaffold prints progress
  try {
    await scaffoldInstance(dir, CONFIG);
  } finally {
    console.log = log;
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const w = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const codes = (r: GovernanceReport, area?: string) => r.findings.filter((f) => area === undefined || f.area === area).map((f) => `${f.severity}:${f.code}`);
const status = (r: GovernanceReport, id: string) => r.areas.find((a) => a.id === id)!.status;

function snapshot(root: string): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(`${p}:${st.size}:${st.mtimeMs}`);
    }
  };
  walk(root);
  return out.join('\n');
}

const CAPSULE = renderCapsule({
  story: { id: 'S-1', phase: 'phase-1', title: 'T', slug: 's-1-t', date: '2026-01-01' },
  work: { objective: 'o', implementationSummary: 'i', filesChanged: ['a.ts'], tests: 't', keyDecisions: 'k', adrs: [], lessons: 'l' },
} as never);

describe('a fresh instance', () => {
  it('has no issues: empty is not an error', () => {
    const r = buildGovernanceReport(dir);
    expect(r.result).toBe('NO_ISSUES');
    expect(r.counts.error + r.counts.warning).toBe(0);
    expect(status(r, 'instance')).toBe('PASS');
    expect(status(r, 'storyIndex')).toBe('EMPTY');
    expect(status(r, 'capsules')).toBe('EMPTY');
    expect(status(r, 'ideas')).toBe('EMPTY');
    expect(codes(r, 'storyIndex')).toEqual(['INFO:NO_FINALIZED_STORIES']);
  });
});

describe('GOV-001 regressions are detected', () => {
  it('Active Phase written as "Phase 6 — ..." is flagged with the correct form', () => {
    w('.monolith/context/maps/roadmap-index.md', '## Phases\n\n### Phase 6 — Handover\n\n**Status:** IN PROGRESS\n\n## Current Focus\n\nActive Phase: Phase 6 — Handover\n');
    const r = buildGovernanceReport(dir);
    expect(status(r, 'roadmap')).toBe('ISSUES');
    const f = r.findings.find((x) => x.code === 'ACTIVE_PHASE_UNMATCHED')!;
    expect(f).toMatchObject({ area: 'roadmap', severity: 'WARNING', path: '.monolith/context/maps/roadmap-index.md' });
    expect(f.message).toContain('Active Phase: 6 — Title');
    expect(r.result).toBe('ISSUES_FOUND');
  });

  it('READY FOR REVIEW as a Phase status is reported (and never accepted)', () => {
    w('.monolith/context/maps/roadmap-index.md', '## Phases\n\n### Phase 1 — A\n\n**Status:** READY FOR REVIEW\n\n## Current Focus\n\nActive Phase: 1 — A\n');
    const r = buildGovernanceReport(dir);
    expect(codes(r, 'roadmap')).toContain('WARNING:PHASE_STATUS_UNRECOGNIZED');
  });

  it('a corrected roadmap is read correctly', () => {
    w('.monolith/context/maps/roadmap-index.md', '## Phases\n\n### Phase 6 — Handover\n\n**Status:** IN PROGRESS\n\n## Current Focus\n\nActive Phase: 6 — Handover\n');
    const r = buildGovernanceReport(dir);
    expect(status(r, 'roadmap')).toBe('PASS');
    expect(codes(r, 'roadmap')).toEqual([]);
  });

  it('an ADR without frontmatter is named, with the expected structure, and is not hidden', () => {
    w('docs/adr/ADR-001-x.md', '# ADR-001\n\n**Status:** accepted\n');
    const r = buildGovernanceReport(dir);
    const f = r.findings.find((x) => x.code === 'ADR_FRONTMATTER_MISSING')!;
    expect(f).toMatchObject({ area: 'adr', severity: 'WARNING', path: 'docs/adr/ADR-001-x.md' });
    expect(f.message).toContain('frontmatter');
    expect(status(r, 'adr')).toBe('ISSUES');
  });

  it('an empty story index is not masked, an unrecognised one is an error', () => {
    expect(status(buildGovernanceReport(dir), 'storyIndex')).toBe('EMPTY');
    w('.monolith/memory/working/story-index.md', 'Some free text about stories.\n');
    const r = buildGovernanceReport(dir);
    expect(codes(r, 'storyIndex')).toContain('ERROR:STORY_INDEX_UNRECOGNIZED');
    expect(status(r, 'storyIndex')).toBe('ISSUES');
  });

  it('no Story → Phase link is invented from the Roadmap', () => {
    w('.monolith/context/maps/roadmap-index.md', '## Phases\n\n### Phase 1 — A\n\n**Status:** COMPLETE\n\nStories:\n\n- STORY 1.1 — X\n\n## Current Focus\n\nActive Phase: —\n');
    const r = buildGovernanceReport(dir);
    expect(status(r, 'storyIndex')).toBe('EMPTY');
    expect(r.findings.some((f) => f.area === 'storyIndex' && f.severity !== 'INFO')).toBe(false);
  });

  it('damaged capsules are reported with their path', () => {
    w('.monolith/memory/working/phases/phase-1/stories/s-1.md', '---\ntype: story-capsule\nid: story-s-1\n---\n\n# STORY S-1\n\n**Status:** COMPLETED\n\n## Objective\n\nTODO\\nsecond line\n');
    const r = buildGovernanceReport(dir);
    const c = codes(r, 'capsules');
    expect(c).toEqual(expect.arrayContaining(['ERROR:CAPSULE_FIELD_MISSING', 'ERROR:CAPSULE_SECTION_MISSING', 'WARNING:CAPSULE_PLACEHOLDER', 'WARNING:CAPSULE_LITERAL_ESCAPE', 'WARNING:CAPSULE_FIELD_OUTSIDE_FRONTMATTER']));
    expect(r.findings.filter((f) => f.area === 'capsules').every((f) => f.path === '.monolith/memory/working/phases/phase-1/stories/s-1.md')).toBe(true);
    expect(status(r, 'capsules')).toBe('ISSUES');
  });

  it('a valid unusual root (no config) is an error, not a crash', () => {
    rmSync(join(dir, 'monolith.config.json'));
    const r = buildGovernanceReport(dir);
    expect(status(r, 'instance')).toBe('ISSUES');
    expect(r.result).toBe('ISSUES_FOUND');
  });
});

describe('capsule validator', () => {
  it('accepts a capsule produced by finalize (renderCapsule)', () => {
    expect(checkCapsuleText(CAPSULE, 'x.md')).toEqual([]);
  });
  it('flags a capsule without frontmatter and empty sections', () => {
    const c = checkCapsuleText('# STORY X\n\n## Objective\n\n## Tests\n\nok\n', 'x.md').map((f) => f.code);
    expect(c).toContain('CAPSULE_FRONTMATTER_MISSING');
    expect(c).toContain('CAPSULE_SECTION_EMPTY');
    expect(c).toContain('CAPSULE_SECTION_MISSING');
  });
  it('ignores placeholders and escapes inside code and comments', () => {
    const text = CAPSULE.replace('\nt\n', '\nTests ran: `a\\nb` and `TODO` in code\n').replace('## Objective\n', '## Objective\n\n<!-- TODO fill -->\n\n```\nTODO \\n\n```\n');
    expect(checkCapsuleText(text, 'x.md').map((f) => f.code)).toEqual([]);
  });
});

describe('contract', () => {
  it('is read-only and deterministic', () => {
    w('docs/adr/ADR-001-x.md', '# no frontmatter\n');
    const before = snapshot(dir);
    const a = buildGovernanceReport(dir);
    expect(buildGovernanceReport(dir)).toEqual(a);
    expect(JSON.stringify(a)).toBe(JSON.stringify(buildGovernanceReport(dir)));
    expect(snapshot(dir)).toBe(before);
    expect(JSON.stringify(a)).not.toContain(dir);
  });

  it('findings are ordered ERROR, WARNING, INFO', () => {
    w('docs/adr/ADR-001-x.md', '# no frontmatter\n');
    w('.monolith/memory/working/story-index.md', 'free text\n');
    const sev = buildGovernanceReport(dir).findings.map((f) => f.severity);
    expect(sev).toEqual([...sev].sort((a, b) => ['ERROR', 'WARNING', 'INFO'].indexOf(a) - ['ERROR', 'WARNING', 'INFO'].indexOf(b)));
  });

  it('argument parsing', () => {
    expect(parseGovernanceArgs(['check'])).toEqual({ ok: true, json: false, strict: false });
    expect(parseGovernanceArgs(['check', '--json', '--strict'])).toEqual({ ok: true, json: true, strict: true });
    expect(parseGovernanceArgs([]).ok).toBe(false);
    expect(parseGovernanceArgs(['check', '--fix']).ok).toBe(false);
    expect(parseGovernanceArgs(['fix']).ok).toBe(false);
  });

  it('exit codes: 0 by default, 2 only with --strict and issues, 1 on usage error; INFO never fails', async () => {
    const log = console.log;
    const err = console.error;
    console.log = () => undefined;
    console.error = () => undefined;
    try {
      expect(await runGovernanceCommand(['check', '--strict'], dir)).toBe(0); // clean instance with only INFO
      w('docs/adr/ADR-001-x.md', '# no frontmatter\n');
      expect(await runGovernanceCommand(['check'], dir)).toBe(0);
      expect(await runGovernanceCommand(['check', '--strict'], dir)).toBe(2);
      expect(await runGovernanceCommand(['nope'], dir)).toBe(1);
    } finally {
      console.log = log;
      console.error = err;
    }
  });

  it('text output lists areas, findings and the result', () => {
    w('docs/adr/ADR-001-x.md', '# no frontmatter\n');
    const text = renderGovernanceReport(buildGovernanceReport(dir));
    expect(text).toContain('GOVERNANCE CHECK');
    expect(text).toContain('- ADR: ISSUES');
    expect(text).toContain('Result: ISSUES FOUND');
  });

  it('does not touch a copy of the repository governance state', () => {
    // the repository itself is a real instance: the check must run on it and write nothing
    const copy = join(dir, 'copy');
    mkdirSync(copy);
    cpSync(join(dir, '.monolith'), join(copy, '.monolith'), { recursive: true });
    writeFileSync(join(copy, 'monolith.config.json'), readFileSync(join(dir, 'monolith.config.json')));
    const before = snapshot(copy);
    buildGovernanceReport(copy);
    expect(snapshot(copy)).toBe(before);
  });
});
