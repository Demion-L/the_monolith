/**
 * PSC-004 — DOCSYNC must never finalize a story named only inside a Markdown
 * example, and reading / writing must agree on which "## Current Story" is real.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldInstance } from '../init/scaffold.js';
import { activeStoryIdentity, applyFinalization, planFinalization } from './core.js';
import { parseProposal, type FinalizationProposal } from './proposal.js';
import type { ProjectConfig } from '../init/types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const F = '```';
const CONFIG: ProjectConfig = { projectName: 'fin-psc4', language: 'typescript', packageManager: 'pnpm', aiTool: 'claude', finalizationProtocol: 'finalize-story', protocols: ['finalize-story'], monolithRoot: '.monolith' };
const W = '.monolith/memory/working/';
const EV = (story: string): string => `---\ntype: working\n---\n\n**Status:** PASS\n**Date:** 2026-11-02\n**Story:** ${story}\n`;

async function instance(id: string, active: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-psc4-'));
  dirs.push(dir);
  await scaffoldInstance(dir, CONFIG);
  writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify(CONFIG, null, 2));
  writeFileSync(join(dir, W + 'integrity-result.md'), EV(id));
  writeFileSync(join(dir, W + 'governance-result.md'), EV(id));
  writeFileSync(join(dir, W + 'active.md'), active);
  return dir;
}
const doc = (current: string, pre = ''): string => `# Active\n\n${pre}## Current Story\n\n${current}\n\n---\n\n## Last Finalization\n\nNo finalization recorded yet.\n\n---\n`;

function proposal(id: string): FinalizationProposal {
  const r = parseProposal({
    schemaVersion: 1,
    story: { id, title: 'T', phase: 'phase-1', phaseHeading: 'Phase 1 — T', slug: `story-${id.toLowerCase()}`, date: '2026-11-02' },
    expectedCurrentStory: { contains: id },
    work: { objective: 'o', implementationSummary: 'i', filesChanged: ['a'], tests: 't', keyDecisions: 'k', adrs: [], lessons: 'l' },
    summary: 's',
    keyOutputs: ['x'],
    history: { phaseName: 'P', decision: 'd', build: 'b' },
  });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.proposal;
}
const check = (dir: string, p: FinalizationProposal) => planFinalization(dir, p).checks.find((c) => c.id === 'expected-state')!;

describe('PSC-004 DOCSYNC section integrity', () => {
  it('a Story named only in a fenced fake "## Current Story" cannot be finalized', async () => {
    // The only structural heading is the real one, which names S-2.
    const dir = await instance('S-1', doc('**Story:** S-2 — real', `${F}markdown\n## Current Story\n\n**Story:** S-1\n${F}\n\n`));
    const p = proposal('S-1');
    const before = readFileSync(join(dir, W + 'active.md'), 'utf8');
    expect(check(dir, p).status).toBe('FAIL');
    const pl = planFinalization(dir, p);
    expect(pl.status).toBe('NOT_READY');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('REFUSED');
    expect(readFileSync(join(dir, W + 'active.md'), 'utf8')).toBe(before);
  });

  it('the real Story finalizes even with a fenced fake heading before it, and the fake block is untouched', async () => {
    const dir = await instance('S-2', doc('**Story:** S-2 — real', `${F}markdown\n## Current Story\n\n**Story:** S-1\n${F}\n\n`));
    const p = proposal('S-2');
    const pl = planFinalization(dir, p);
    expect(pl.status).toBe('READY');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('FINALIZED');
    const after = readFileSync(join(dir, W + 'active.md'), 'utf8');
    expect(after).toContain(`${F}markdown\n## Current Story\n\n**Story:** S-1\n${F}`);
    expect(after).toContain('No active story recorded.');
  });

  it('a fenced/commented fake "## Last Finalization" is not the write target', async () => {
    const dir = await instance('S-2', `# A\n\n<!--\n## Last Finalization\nx\n-->\n\n## Current Story\n\n**Story:** S-2\n\n---\n\n## Last Finalization\n\nNone.\n\n---\n`);
    const p = proposal('S-2');
    const pl = planFinalization(dir, p);
    expect(pl.status).toBe('READY');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('FINALIZED');
    expect(readFileSync(join(dir, W + 'active.md'), 'utf8')).toContain('<!--\n## Last Finalization\nx\n-->');
  });

  it('two real "## Current Story" sections fail closed with an explicit reason; nothing is written', async () => {
    const dir = await instance('S-1', `# A\n\n## Current Story\n\n**Story:** S-1\n\n---\n\n## Current Story\n\n**Story:** S-1\n\n---\n\n## Last Finalization\n\nNone.\n\n---\n`);
    const p = proposal('S-1');
    const before = readFileSync(join(dir, W + 'active.md'), 'utf8');
    const c = check(dir, p);
    expect(c.status).toBe('FAIL');
    expect(c.detail).toContain('ambiguous');
    const pl = planFinalization(dir, p);
    expect(pl.status).toBe('NOT_READY');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('REFUSED');
    expect(readFileSync(join(dir, W + 'active.md'), 'utf8')).toBe(before);
  });

  it('a comment opened on the "## Current Story" line cannot supply the identity', async () => {
    const dir = await instance('FAKE-1', `# A\n\n## Current Story <!--\n**Story:** FAKE-1 — x\n-->\n\n---\n\n## Last Finalization\n\nNone.\n\n---\n`);
    const p = proposal('FAKE-1');
    const before = readFileSync(join(dir, W + 'active.md'), 'utf8');
    expect(check(dir, p).status).toBe('FAIL');
    const pl = planFinalization(dir, p);
    expect(pl.status).toBe('NOT_READY');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('REFUSED');
    expect(readFileSync(join(dir, W + 'active.md'), 'utf8')).toBe(before);
  });

  it('expected "none" is not satisfied by "no active story" inside a comment or fence over a live story', async () => {
    for (const hide of ['<!-- no active story -->', `${F}\nno active story\n${F}`]) {
      const dir = await instance('REAL-1', doc(`**Story:** REAL-1\n${hide}`));
      const p = { ...proposal('REAL-1'), expectedCurrentStory: 'none' as const };
      expect(check(dir, p).status).toBe('FAIL');
    }
  });

  it('expected text that appears only inside a comment or fence is not found', async () => {
    const dir = await instance('S-1', doc('**Story:** S-1\n<!-- marker-xyz -->'));
    const p = { ...proposal('S-1'), expectedCurrentStory: { contains: 'marker-xyz' } };
    expect(check(dir, p).status).toBe('FAIL');
  });

  it('identity: a comment opened mid-line hides a **Story:** field (as in the brief)', () => {
    expect(activeStoryIdentity('note <!--\n**Story:** FAKE-1\n-->').ok).toBe(false);
    expect(activeStoryIdentity('note <!--\n**Story:** FAKE-1\n-->\n**Story:** REAL-1')).toEqual({ ok: true, id: 'REAL-1' });
  });

  it('identity: duplicate fields and fenced fields keep failing closed', () => {
    expect(activeStoryIdentity('**Story:** A-1\n**Story:** A-2').ok).toBe(false);
    expect(activeStoryIdentity(`${F}\n**Story:** A-1\n${F}`).ok).toBe(false);
    expect(activeStoryIdentity('A-1 was completed yesterday.').ok).toBe(false);
  });
});
