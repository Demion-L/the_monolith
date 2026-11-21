import { describe, it, expect } from 'vitest';
import { parseRoadmapStatuses } from './freshness.js';
import { parseRoadmapPhases } from '../readmodel/roadmap.js';

/** Shape taken from the Second Brain real-world audit: a phase TABLE under "## Phases", plus a "Completion Summary" table. */
const SECOND_BRAIN_ROADMAP = `# Roadmap Index

## Phases

Status: PLANNED | IN PROGRESS | COMPLETE

| Phase | Name                      | Status                   |
| ----- | ------------------------- | ------------------------ |
| 0A    | Repository Reconstruction | COMPLETE (audit)         |
| 1     | Security                  | IN PROGRESS (Charter)    |
| 2     | Reliable Ingestion        | PLANNED                  |
| 3     | Search Foundation         | PLANNED                  |

## Current Focus

Active Phase: PHASE 1 — Security

## Completion Summary

| Phase | Stories      | Status      |
| ----- | ------------ | ----------- |
| 0A    | audit only   | COMPLETE    |
| 1     | —            | IN PROGRESS |
| 2–7   | —            | PLANNED     |
`;

describe('phase tables are not story tables (Real-World Audit, Second Brain)', () => {
  it('does not read phase rows as stories', () => {
    expect([...parseRoadmapStatuses(SECOND_BRAIN_ROADMAP).keys()]).toEqual([]);
  });

  it('reports the unrecognised phase format honestly (no_phases), never as stories', () => {
    const v = parseRoadmapPhases(SECOND_BRAIN_ROADMAP);
    expect(v.state).toBe('no_phases');
    expect(v.diagnostics.map((d) => d.code)).toContain('NO_PHASES_FOUND');
  });

  it('still reads a genuine legacy story table', () => {
    const legacy = `# Roadmap\n\n| ID | Title | Status | Date |\n| -- | ----- | ------ | ---- |\n| 1.1 | First | COMPLETED | 2026-01-01 |\n| 1.2 | Second | PLANNED | — |\n`;
    expect([...parseRoadmapStatuses(legacy)]).toEqual([['1.1', 'COMPLETED'], ['1.2', 'PLANNED']]);
  });
});
