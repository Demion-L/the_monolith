/**
 * FIN-001 — Capsule formatting instability (alpha.4).
 *
 * Incident (Second Brain): finalize created the capsule, a formatter (Prettier)
 * rewrote it (blank line after every heading), and the next `finalize plan`
 * reported the capsule as a conflicting file because "already present" was a
 * byte-exact comparison. Root cause: `d.content === content` in buildInternals
 * together with a renderer that is not formatter-stable.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldInstance } from '../init/scaffold.js';
import { applyFinalization, capsuleCanonical, planFinalization, renderCapsule } from './core.js';
import { parseProposal, type FinalizationProposal } from './proposal.js';
import type { ProjectConfig } from '../init/types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const CONFIG: ProjectConfig = {
  projectName: 'fin001',
  language: 'typescript',
  packageManager: 'pnpm',
  aiTool: 'claude',
  finalizationProtocol: 'finalize-story',
  protocols: ['finalize-story'],
  monolithRoot: '.monolith',
};
const EVIDENCE = (kind: string): string =>
  `---\ntype: working\nid: ${kind}\n---\n\n## Last Check\n\n**Status:** PASS\n**Date:** 2026-11-02\n**Story:** FIN-001 — test\n`;

async function instance(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-fin001-'));
  dirs.push(dir);
  await scaffoldInstance(dir, CONFIG);
  writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify({ ...CONFIG }, null, 2));
  writeFileSync(join(dir, '.monolith/memory/working/integrity-result.md'), EVIDENCE('integrity-result'));
  writeFileSync(join(dir, '.monolith/memory/working/governance-result.md'), EVIDENCE('governance-result'));
  return dir;
}

function proposal(objective = 'obj\n\nsecond paragraph'): FinalizationProposal {
  const parsed = parseProposal({
    schemaVersion: 1,
    story: { id: 'FIN-001', title: 'Capsule stability', phase: 'phase-1', phaseHeading: 'Phase 1 — Test', slug: 'story-fin-001', date: '2026-11-02' },
    expectedCurrentStory: 'none',
    work: { objective, implementationSummary: 'impl', filesChanged: ['a.ts'], tests: '10 pass', keyDecisions: 'kd', adrs: [], lessons: 'none' },
    summary: 'Built.',
    keyOutputs: ['src'],
    history: { phaseName: '1 — Test', decision: 'ok', build: 'PASS' },
  });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.proposal;
}

const CAPSULE = '.monolith/memory/working/phases/phase-1/stories/story-fin-001.md';

/** What Prettier does to this document: one blank line after each heading. */
const prettierLike = (s: string): string => s.replace(/^(#{1,6} .*)\n(?!\n)/gm, '$1\n\n');

describe('FIN-001 capsule formatting', () => {
  it('renders a formatter-stable layout: a blank line after every heading', () => {
    const out = renderCapsule(proposal());
    expect(prettierLike(out)).toBe(out);
  });

  it('capsule reformatted after finalize (blank lines, CRLF, trailing spaces) is still ALREADY_FINALIZED and untouched', async () => {
    const dir = await instance();
    const p = proposal();
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
    // simulate the formatter pass of an alpha.3-style (unspaced) capsule
    const legacy = renderCapsule(p).replace(/^(#{2} .*)\n\n/gm, '$1\n');
    const reformatted = prettierLike(legacy).replace(/\n/g, '\r\n').replace('obj', 'obj  ');
    writeFileSync(join(dir, CAPSULE), reformatted);
    const plan = planFinalization(dir, p);
    expect(plan.status).toBe('ALREADY_FINALIZED');
    expect(plan.targets.find((t) => t.id === 'capsule')!.state).toBe('done');
    const again = await applyFinalization(dir, p, 'whatever');
    expect(again.status).toBe('ALREADY_FINALIZED');
    expect(readFileSync(join(dir, CAPSULE), 'utf8')).toBe(reformatted); // never rewritten
  });

  it('a capsule written by alpha.3 (no blank lines) is recognised, not a conflict', async () => {
    const dir = await instance();
    const p = proposal();
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
    writeFileSync(join(dir, CAPSULE), renderCapsule(p).replace(/^(#{2} .*)\n\n/gm, '$1\n'));
    expect(planFinalization(dir, p).status).toBe('ALREADY_FINALIZED');
  });

  it.each([
    ['changed word', (s: string) => s.replace('impl', 'IMPL')],
    ['removed section line', (s: string) => s.replace('- a.ts', '- b.ts')],
    ['merged paragraph break (blank line outside a heading)', (s: string) => s.replace('obj\n\nsecond', 'obj\nsecond')],
    ['changed status', (s: string) => s.replace('status: COMPLETED', 'status: DRAFT')],
    ['appended text', (s: string) => `${s}\nextra claim\n`],
    ['non-breaking space instead of space', (s: string) => s.replace('10 pass', '10 pass')],
  ])('semantic change (%s) still conflicts and is never overwritten', async (_n, mutate) => {
    const dir = await instance();
    const p = proposal();
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
    const changed = prettierLike(mutate(renderCapsule(p)));
    writeFileSync(join(dir, CAPSULE), changed);
    const plan = planFinalization(dir, p);
    expect(plan.status).toBe('NOT_READY');
    expect(plan.targets.find((t) => t.id === 'capsule')!.state).toBe('conflict');
    const r = await applyFinalization(dir, p, plan.digest);
    expect(r.status).toBe('REFUSED');
    expect(readFileSync(join(dir, CAPSULE), 'utf8')).toBe(changed);
  });

  it('capsuleCanonical ignores only the documented classes', () => {
    expect(capsuleCanonical('# A\r\n\r\nx  \r\n\r\n')).toBe(capsuleCanonical('# A\nx'));
    expect(capsuleCanonical('x\n\ny')).not.toBe(capsuleCanonical('x\ny'));
    expect(capsuleCanonical('x\n\n\ny')).not.toBe(capsuleCanonical('x\n\ny'));
  });
});
