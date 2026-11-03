/**
 * DOCSYNC-007: the active story is identified ONLY by the structural
 * `**Story:** <id>` field of `## Current Story` — never by an id that merely
 * appears in free text. Regression tests T1–T13.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldInstance } from '../init/scaffold.js';
import { collect } from '../brief/collect.js';
import { render } from '../brief/render.js';
import { activeStoryIdentity, applyFinalization, planFinalization } from './core.js';
import { parseProposal, type FinalizationProposal } from './proposal.js';
import type { ProjectConfig } from '../init/types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const CONFIG: ProjectConfig = { projectName: 'fin-id', language: 'typescript', packageManager: 'pnpm', aiTool: 'claude', finalizationProtocol: 'finalize-story', protocols: ['finalize-story'], monolithRoot: '.monolith' };
const W = '.monolith/memory/working/';
const EV = (story: string): string => `---\ntype: working\n---\n\n**Status:** PASS\n**Date:** 2026-11-02\n**Story:** ${story}\n`;

async function instance(id: string, currentStory: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-finid-'));
  dirs.push(dir);
  await scaffoldInstance(dir, CONFIG);
  writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify(CONFIG, null, 2));
  writeFileSync(join(dir, W + 'integrity-result.md'), EV(id));
  writeFileSync(join(dir, W + 'governance-result.md'), EV(id));
  setActive(dir, currentStory);
  return dir;
}
function setActive(dir: string, text: string): void {
  const a = readFileSync(join(dir, W + 'active.md'), 'utf8').replace(/(## Current Story)[\s\S]*?(\n---|\n## )/, (_m, h: string, tail: string) => `${h}\n\n${text}\n${tail}`);
  writeFileSync(join(dir, W + 'active.md'), a);
}
function proposal(id: string, over: Record<string, unknown> = {}): FinalizationProposal {
  const r = parseProposal({
    schemaVersion: 1,
    story: { id, title: 'T', phase: 'phase-1', phaseHeading: 'Phase 1 — T', slug: `story-${id.toLowerCase()}`, date: '2026-11-02' },
    expectedCurrentStory: { contains: id },
    work: { objective: 'o', implementationSummary: 'i', filesChanged: ['a'], tests: 't', keyDecisions: 'k', adrs: [], lessons: 'l' },
    summary: 's',
    keyOutputs: ['x'],
    history: { phaseName: 'P', decision: 'd', build: 'b' },
    ...over,
  });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.proposal;
}
const snap = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out[r] = readFileSync(join(dir, r), 'utf8');
    }
  };
  walk('');
  return out;
};
const exp = (dir: string, p: FinalizationProposal) => planFinalization(dir, p).checks.find((c) => c.id === 'expected-state')!;

/** Plan NOT_READY, apply REFUSED, and every byte of the instance unchanged. */
async function expectRefused(dir: string, p: FinalizationProposal, detail?: string): Promise<void> {
  const before = snap(dir);
  const pl = planFinalization(dir, p);
  expect(exp(dir, p).status).toBe('FAIL');
  if (detail) expect(exp(dir, p).detail).toContain(detail);
  expect(pl.status).toBe('NOT_READY');
  expect((await applyFinalization(dir, p, pl.digest)).status).toBe('REFUSED');
  expect(snap(dir)).toEqual(before);
}

describe('DOCSYNC-007: structural active story identity', () => {
  it('T1. "S-2 follow-up of S-1" (no structural id) cannot be used to finalize S-1', async () => {
    const dir = await instance('S-1', 'S-2 follow-up of S-1');
    await expectRefused(dir, proposal('S-1'), 'no "**Story:** <id>" line');
    expect(existsSync(join(dir, W + 'phases/phase-1'))).toBe(false);
  });

  it('T1b. the structural id is S-2, the description names S-1: finalizing S-1 is refused', async () => {
    const dir = await instance('S-1', '**Story:** S-2 follow-up of S-1');
    await expectRefused(dir, proposal('S-1'), 'The active story is "S-2", not S-1');
  });

  it('T2. S-1 active, S-1 finalized → FINALIZED, brief shows the completed state', async () => {
    const dir = await instance('S-1', '**Story:** S-1 — the work');
    const p = proposal('S-1');
    const pl = planFinalization(dir, p);
    expect(pl.status).toBe('READY');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('FINALIZED');
    const text = render(await collect(dir)).text;
    expect(text).toContain('No active story recorded.');
    expect(text).toContain('S-1');
  });

  it('T3. S-2 active with "Follow-up of S-1" in the description: S-2 finalizes fine', async () => {
    const dir = await instance('S-2', '**Story:** S-2 — Follow-up of S-1\n\nContinues S-1.');
    const p = proposal('S-2');
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
  });

  it('T4. several ids in the section: only the canonical field decides', async () => {
    const text = 'S-1 and S-3 are related.\n\n**Story:** S-2 — main\n\nSee also S-1, S-9.';
    for (const id of ['S-1', 'S-3', 'S-9']) await expectRefused(await instance(id, text), proposal(id, { expectedCurrentStory: { contains: id } }));
    const dir = await instance('S-2', text);
    expect(exp(dir, proposal('S-2', { expectedCurrentStory: { contains: 'S-2 — main' } })).status).toBe('PASS');
  });

  it('T5. missing identity → explicit diagnostic with the minimal fix', async () => {
    const dir = await instance('S-1', '**S-1 — Title**\n\nStory: S-1\n**Story ID:** S-1');
    await expectRefused(dir, proposal('S-1'), 'put exactly one line "**Story:** <id>');
  });

  it('T6. duplicate identity (same id twice) → refused', async () => {
    await expectRefused(await instance('S-1', '**Story:** S-1\n**Story:** S-1 again'), proposal('S-1'), 'duplicate identity');
  });

  it('T7. conflicting identity → refused (also for the id that appears first or last)', async () => {
    const text = '**Story:** S-1\n**Story:** S-2';
    await expectRefused(await instance('S-1', text), proposal('S-1'), 'conflicting identity');
    await expectRefused(await instance('S-2', text), proposal('S-2'), 'conflicting identity');
  });

  it('T8. id only inside a code fence (or an HTML comment) → refused', async () => {
    await expectRefused(await instance('S-1', '```\n**Story:** S-1\n```'), proposal('S-1'), 'no "**Story:**');
    await expectRefused(await instance('S-1', '~~~md\n**Story:** S-1\n~~~'), proposal('S-1'));
    await expectRefused(await instance('S-1', '<!--\n**Story:** S-1\n-->'), proposal('S-1'));
    await expectRefused(await instance('S-1', '<!-- **Story:** S-1 -->'), proposal('S-1'));
  });

  it('T8b. a fenced decoy does not conflict with / replace the real field', async () => {
    const dir = await instance('S-1', '**Story:** S-1\n\n```\n**Story:** S-2\n```');
    expect(exp(dir, proposal('S-1')).status).toBe('PASS');
  });

  it('T8c. malformed field values (list, lowercase mismatch, indented, no id) → refused', async () => {
    await expectRefused(await instance('S-1', '**Story:** S-1, S-2'), proposal('S-1'));
    await expectRefused(await instance('S-1', '**Story:** s-1'), proposal('S-1'));
    await expectRefused(await instance('S-1', '  - **Story:** S-1'), proposal('S-1'));
    await expectRefused(await instance('S-1', '**Story:**'), proposal('S-1'));
  });

  it.each([
    ['S-1', 'S-10'],
    ['S-1', 'XS-1'],
    ['1.1', '11.1'],
    ['1.1', '1.10'],
    ['DOCSYNC-001', 'DOCSYNC-0010'],
    ['S-10', 'S-1'],
  ])('T9. finalizing %s while %s is active → refused, nothing changed', async (id, other) => {
    await expectRefused(await instance(id, `**Story:** ${other} — somebody else's`), proposal(id));
  });

  it('T10/T11/T12. roll-forward after INCOMPLETE, identical repeat, same id with other content', async () => {
    const dir = await instance('S-1', '**Story:** S-1 — work');
    const p = proposal('S-1');
    let n = 0;
    const r1 = await applyFinalization(dir, p, planFinalization(dir, p).digest, { ops: { renameSync: (a: string, b: string) => { if (++n === 3) throw Object.assign(new Error('boom'), { code: 'EIO' }); return renameSync(a, b); } } });
    expect(r1.status).toBe('INCOMPLETE');
    // active.md is written last: still the original story, identity still S-1.
    expect(readFileSync(join(dir, W + 'active.md'), 'utf8')).toContain('**Story:** S-1 — work');
    const pl = planFinalization(dir, p);
    expect(pl.partial).toBe(true);
    expect(exp(dir, p).status).toBe('PASS');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('FINALIZED');
    const hist = readFileSync(join(dir, '.monolith/memory/long-term/execution-history.md'), 'utf8');
    expect(hist.match(/^## S-1 — /gm)).toHaveLength(1);
    expect(planFinalization(dir, p).status).toBe('ALREADY_FINALIZED');
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('ALREADY_FINALIZED');
    const other = proposal('S-1', { summary: 'different' });
    const before = snap(dir);
    expect((await applyFinalization(dir, other, planFinalization(dir, other).digest)).status).not.toBe('FINALIZED');
    expect(snap(dir)).toEqual(before);
  });

  it('T13. an instance with the pre-DOCSYNC-007 active.md (legacy bold heading) is refused and not rewritten', async () => {
    const dir = await instance('1.3', '**STORY 1.3 — Scriptorium**\nStatus: implemented, awaiting review\n\nPrevious: **STORY 1.1 — Core**');
    await expectRefused(dir, proposal('1.3'), 'put exactly one line "**Story:** <id>');
  });

  it('"none" is unaffected by the identity rule', async () => {
    const dir = await instance('S-1', 'No active story.\n\nPrevious: **S-1 — x**');
    expect(exp(dir, proposal('S-1', { expectedCurrentStory: 'none' })).status).toBe('PASS');
  });

  it('activeStoryIdentity: CRLF and exact first-token grammar', () => {
    expect(activeStoryIdentity('**Story:** S-1 — t\r\n')).toEqual({ ok: true, id: 'S-1' });
    expect(activeStoryIdentity('**Story:** S-1')).toEqual({ ok: true, id: 'S-1' });
    expect(activeStoryIdentity('').ok).toBe(false);
  });
});
