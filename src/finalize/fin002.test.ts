/**
 * FIN-002 — post-finalization state drift (alpha.4).
 *
 * Observed (STC / Second Brain): after a successful `finalize apply` the story
 * is COMPLETED in story-index.md, but roadmap-index.md still says IN PROGRESS.
 * Root cause: finalize does not own roadmap-index.md (only story-index.md,
 * active.md, execution history, the capsule and owner-listed docs) and never
 * assessed agreement between the documents, so success looked like "all
 * consistent". The brief already knew how to detect this disagreement
 * (`findContradictions`); finalize now reuses that function, reports the
 * result separately from the operation status and never edits the document.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldInstance } from '../init/scaffold.js';
import { collect } from '../brief/collect.js';
import { applyFinalization, planFinalization } from './core.js';
import { parseProposal, type FinalizationProposal } from './proposal.js';
import type { ProjectConfig } from '../init/types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const CONFIG: ProjectConfig = {
  projectName: 'fin002',
  language: 'typescript',
  packageManager: 'pnpm',
  aiTool: 'claude',
  finalizationProtocol: 'finalize-story',
  protocols: ['finalize-story'],
  monolithRoot: '.monolith',
};
const ROADMAP = '.monolith/context/maps/roadmap-index.md';
const ACTIVE = '.monolith/memory/working/active.md';
const EVIDENCE = (kind: string, id: string): string =>
  `---\ntype: working\nid: ${kind}\n---\n\n## Last Check\n\n**Status:** PASS\n**Date:** 2026-11-02\n**Story:** ${id} — t\n`;

const roadmapWith = (rows: string[], activeLine = 'Active Story: —'): string =>
  `# Roadmap\n\n${activeLine}\n\n| Story | Title | Status | Date |\n| ----- | ----- | ------ | ---- |\n${rows.join('\n')}\n`;

async function instance(id: string, roadmap: string | null, config: Record<string, unknown> = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-fin002-'));
  dirs.push(dir);
  await scaffoldInstance(dir, CONFIG);
  writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify({ ...CONFIG, ...config }, null, 2));
  writeFileSync(join(dir, '.monolith/memory/working/integrity-result.md'), EVIDENCE('integrity-result', id));
  writeFileSync(join(dir, '.monolith/memory/working/governance-result.md'), EVIDENCE('governance-result', id));
  if (roadmap === null) unlinkSync(join(dir, ROADMAP));
  else writeFileSync(join(dir, ROADMAP), roadmap);
  return dir;
}

function proposal(id: string, docUpdates?: unknown): FinalizationProposal {
  const parsed = parseProposal({
    schemaVersion: 1,
    story: { id, title: 'Story', phase: 'phase-1', phaseHeading: 'Phase 1 — Test', slug: `story-${id.toLowerCase()}`, date: '2026-11-02' },
    expectedCurrentStory: 'none',
    work: { objective: 'o', implementationSummary: 'i', filesChanged: ['a.ts'], tests: 't', keyDecisions: 'k', adrs: [], lessons: 'l' },
    summary: 's',
    keyOutputs: ['x'],
    history: { phaseName: '1', decision: 'd', build: 'PASS' },
    ...(docUpdates === undefined ? {} : { docUpdates }),
  });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.proposal;
}

describe('FIN-002 post-finalization consistency', () => {
  it('STC-006: roadmap still IN PROGRESS after finalize → INCONSISTENT, external, never rewritten, apply still succeeds', async () => {
    const roadmap = roadmapWith(['| STC-006 | Six | IN PROGRESS | d |']);
    const dir = await instance('STC-006', roadmap);
    const p = proposal('STC-006');
    const plan = planFinalization(dir, p);
    expect(plan.status).toBe('READY');
    expect(plan.consistency?.status).toBe('INCONSISTENT');
    expect(plan.consistency?.projected).toBe(true);
    const f = plan.consistency!.findings[0];
    expect(f.message).toContain('STC-006');
    expect(f.externalDocuments).toEqual(['roadmap-index.md']);
    expect(f.remediation).toContain('allowedDocs');

    const r = await applyFinalization(dir, p, plan.digest);
    expect(r.status).toBe('FINALIZED'); // operation success is not conflated with external drift
    expect(r.plan.consistency?.status).toBe('INCONSISTENT');
    expect(r.plan.consistency?.projected).toBe(false);
    expect(readFileSync(join(dir, ROADMAP), 'utf8')).toBe(roadmap); // external doc untouched

    // the brief independently reports the same contradiction (one shared definition)
    const m = await collect(dir);
    expect(m.freshness?.reasons.some((x) => x.code === 'STATE_CONTRADICTION' && x.message.includes('STC-006'))).toBe(true);
  });

  it('owner remediation through docUpdates makes the result CONSISTENT (plan and apply)', async () => {
    const dir = await instance('STC-006', roadmapWith(['| STC-006 | Six | IN PROGRESS | d |']), { finalization: { allowedDocs: [ROADMAP] } });
    const fixed = roadmapWith(['| STC-006 | Six | COMPLETED | d |']);
    const p = proposal('STC-006', [{ path: ROADMAP, newContent: fixed, reason: 'mark STC-006 completed' }]);
    const plan = planFinalization(dir, p);
    expect(plan.status).toBe('READY');
    expect(plan.consistency?.status).toBe('CONSISTENT');
    const r = await applyFinalization(dir, p, plan.digest);
    expect(r.status).toBe('FINALIZED');
    expect(r.plan.consistency?.status).toBe('CONSISTENT');
    expect(readFileSync(join(dir, ROADMAP), 'utf8')).toBe(fixed);
  });

  it('STC-007: another row IN PROGRESS while no story is active is NOT a confirmed contradiction (IN PROGRESS has no defined tie to active.md)', async () => {
    const dir = await instance('STC-006', roadmapWith(['| STC-006 | Six | COMPLETED | d |', '| STC-007 | Seven | IN PROGRESS | d |']));
    const plan = planFinalization(dir, proposal('STC-006'));
    expect(plan.consistency?.status).toBe('CONSISTENT');
    expect(plan.consistency?.findings).toEqual([]);
    expect(plan.consistency?.scope).toContain('structural');
  });

  it('roadmap names the finalized story as the active story while active.md will say none → INCONSISTENT', async () => {
    const dir = await instance('STC-006', roadmapWith(['| STC-006 | Six | COMPLETED | d |'], 'Active Story: STC-006'));
    const plan = planFinalization(dir, proposal('STC-006'));
    expect(plan.consistency?.status).toBe('INCONSISTENT');
    expect(plan.consistency?.findings[0].documents).toEqual(['active.md', 'roadmap-index.md']);
  });

  it('missing roadmap-index.md is NOT_VERIFIED, never a false CONSISTENT', async () => {
    const dir = await instance('STC-006', null);
    const plan = planFinalization(dir, proposal('STC-006'));
    expect(plan.consistency?.status).toBe('NOT_VERIFIED');
    expect(plan.consistency?.notVerified.join(' ')).toContain('roadmap-index.md');
  });

  it('assessment does not change status, digest inputs or exit-relevant behaviour', async () => {
    const dir = await instance('STC-006', roadmapWith(['| STC-006 | Six | IN PROGRESS | d |']));
    const p = proposal('STC-006');
    const a = planFinalization(dir, p);
    const b = planFinalization(dir, p);
    expect(a.digest).toBe(b.digest);
    expect(a.status).toBe('READY');
    expect(readFileSync(join(dir, ACTIVE), 'utf8')).toContain('## Current Story'); // plan is read-only
  });
});
