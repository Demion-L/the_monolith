// ARCH-002A: ONE SKILL — ONE CANONICAL SOURCE.
// `.monolith/skills/finalize-story/SKILL.md` is the only editable source; the template is generated.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
// @ts-expect-error plain .mjs build script, no declarations
import { generate, paths, sync, SYNCED_SKILLS } from '../../scripts/sync-skill-templates.mjs';
import { scaffoldInstance, TEMPLATES_ROOT } from '../init/scaffold.js';
import type { ProjectConfig } from '../init/types.js';
import { integrationComplete, planUpdate } from './index.js';
import { runUpdate } from './cli.js';
import { FINALIZE_STORY_CURRENT, FINALIZE_STORY_LEGACY } from './legacy-skills.js';
import { applyFinalization, planFinalization } from '../finalize/core.js';
import { parseProposal } from '../finalize/proposal.js';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const CONFIG: ProjectConfig = {
  projectName: 'skill-src',
  language: 'typescript',
  packageManager: 'pnpm',
  aiTool: 'claude',
  finalizationProtocol: 'finalize-story',
  protocols: ['finalize-story'],
  monolithRoot: '.monolith',
};
const FIN = '.monolith/skills/finalize-story/SKILL.md';
const CANONICAL = readFileSync(join(REPO, '.monolith/skills/finalize-story/SKILL.md'), 'utf8');
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const beta1 = readFileSync(new URL('./fixtures/finalize-story.beta1.md', import.meta.url), 'utf8');

async function instance(cfg: ProjectConfig = CONFIG): Promise<string> {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const d = mkdtempSync(join(tmpdir(), 'monolith-skillsrc-'));
  dirs.push(d);
  await scaffoldInstance(d, cfg);
  return d;
}
const read = (d: string, rel: string): string => readFileSync(join(d, rel), 'utf8');

describe('single canonical source', () => {
  it('the generated template equals what the generator produces from the canonical source', () => {
    for (const name of SYNCED_SKILLS) {
      const { source, target } = paths(REPO, name);
      expect(readFileSync(target, 'utf8')).toBe(generate(readFileSync(source, 'utf8')));
    }
    expect(sync(REPO, { write: false }).every((r: { ok: boolean }) => r.ok)).toBe(true);
  });

  it('the pinned current hash is the hash of the canonical text installed under the default root', () => {
    expect(sha(CANONICAL)).toBe(FINALIZE_STORY_CURRENT);
    expect(FINALIZE_STORY_LEGACY[FINALIZE_STORY_CURRENT]).toBeUndefined();
  });

  it('the canonical skill is project-neutral and carries the Operational Focus check', () => {
    expect(CANONICAL).not.toMatch(/pnpm (typecheck|test)/);
    expect(CANONICAL).toContain('## Current Operational Focus');
    expect(CANONICAL).toContain('Do not use `docUpdates` for `active.md`');
    expect(CANONICAL).toContain('Do not finalize by hand');
  });

  it('the template ships in the package (templates/ is in `files`; .monolith/ is not)', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    expect(pkg.files).toContain('templates');
    expect(pkg.files).not.toContain('.monolith');
    expect(existsSync(join(TEMPLATES_ROOT, 'monolith/skills/finalize-story/SKILL.md'))).toBe(true);
    expect(pkg.scripts.build).toContain('sync-skill-templates.mjs'); // regenerated on every build
    expect(pkg.scripts['check:skills']).toContain('--check');
  });
});

describe('init and update', () => {
  it('init installs a skill byte-identical to the canonical one (default root)', async () => {
    const d = await instance();
    expect(read(d, FIN)).toBe(CANONICAL);
  });

  it('init under a custom root substitutes the root, leaves no placeholder, and update is a no-op', async () => {
    const d = await instance({ ...CONFIG, monolithRoot: 'ai/mono' });
    const text = read(d, 'ai/mono/skills/finalize-story/SKILL.md');
    expect(text).not.toContain('{{');
    expect(text).toContain('ai/mono/memory/working/phases');
    expect(text).not.toContain('.monolith/');
    expect(planUpdate(d).items.find((i) => i.path === 'ai/mono/skills/finalize-story/SKILL.md')?.action).toBe('UNCHANGED');
  });

  it('the unedited previous (beta.1) skill is recognised, updated without conflict, then idempotent', async () => {
    const d = await instance();
    writeFileSync(join(d, FIN), beta1);
    const plan = planUpdate(d);
    expect(plan.items.find((i) => i.path === FIN)?.action).toBe('UPDATE');
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(read(d, FIN)).toBe(CANONICAL);
    expect(integrationComplete(planUpdate(d))).toBe(true);
    expect(await runUpdate(['--apply'], d)).toBe(0); // repeat
    expect(read(d, FIN)).toBe(CANONICAL);
    expect(planUpdate(d).items.find((i) => i.path === FIN)?.action).toBe('UNCHANGED');
  });

  it('a user-edited skill is never overwritten and is not reported as updated', async () => {
    const d = await instance();
    const mine = beta1 + '\nMy rule.\n';
    writeFileSync(join(d, FIN), mine);
    expect(planUpdate(d).items.find((i) => i.path === FIN)?.action).toBe('CONFLICT');
    await runUpdate(['--apply'], d);
    expect(read(d, FIN)).toBe(mine);
    expect(integrationComplete(planUpdate(d))).toBe(false);
  });

  it('a missing skill is added from the current template', async () => {
    const d = await instance();
    rmSync(join(d, '.monolith/skills/finalize-story'), { recursive: true });
    expect(planUpdate(d).items.find((i) => i.path === FIN)?.action).toBe('ADD');
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(read(d, FIN)).toBe(CANONICAL);
  });

  it('other skills are installed unchanged and untouched by the finalize-story update', async () => {
    const d = await instance();
    const others = ['self-improvement', 'idea-capture', 'current-status', 'global-status'].map((n) => `.monolith/skills/${n}/SKILL.md`);
    const before = others.map((p) => read(d, p));
    writeFileSync(join(d, FIN), beta1);
    await runUpdate(['--apply'], d);
    expect(others.map((p) => read(d, p))).toEqual(before);
  });
});

describe('finalize after update', () => {
  it('plan and apply on a disposable updated instance keep their contract; Operational Focus is preserved', async () => {
    const d = await instance();
    writeFileSync(join(d, FIN), beta1);
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(read(d, FIN)).toContain('## Current Operational Focus');

    const ev = (k: string): string => `---\ntype: working\nid: ${k}\n---\n\n## Last Check\n\n**Status:** PASS\n**Date:** 2026-11-02\n**Story:** ARCH-T1 — test\n`;
    writeFileSync(join(d, '.monolith/memory/working/integrity-result.md'), ev('integrity-result'));
    writeFileSync(join(d, '.monolith/memory/working/governance-result.md'), ev('governance-result'));
    const parsed = parseProposal({
      schemaVersion: 1,
      story: { id: 'ARCH-T1', title: 'Updated skill', phase: 'phase-1', phaseHeading: 'Phase 1 — Test', slug: 'story-arch-t1-test', date: '2026-11-02' },
      expectedCurrentStory: 'none',
      work: { objective: 'o', implementationSummary: 'i', filesChanged: ['a.ts'], tests: '1 pass', keyDecisions: 'k', adrs: [], lessons: 'none' },
      summary: 'Done.',
      keyOutputs: ['x'],
      history: { phaseName: '1 — Test', decision: 'd', build: 'PASS — 1 test.' },
    });
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    const plan = planFinalization(d, parsed.proposal);
    expect(plan.digest).toMatch(/^[0-9a-f]{16,}$/);
    const r = await applyFinalization(d, parsed.proposal, plan.digest);
    expect(['FINALIZED']).toContain(r.status);
    expect(read(d, '.monolith/memory/working/active.md')).toContain('## Current Operational Focus');
  });
});
