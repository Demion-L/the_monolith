import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, existsSync, readdirSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldInstance } from '../init/scaffold.js';
import { collect } from '../brief/collect.js';
import { render } from '../brief/render.js';
import { applyFinalization, planFinalization } from './core.js';
import { parseProposal, type FinalizationProposal } from './proposal.js';
import { runFinalizeCommand } from './cli.js';
import type { ProjectConfig } from '../init/types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const CONFIG: ProjectConfig = {
  projectName: 'fin-test',
  language: 'typescript',
  packageManager: 'pnpm',
  aiTool: 'claude',
  finalizationProtocol: 'finalize-story',
  protocols: ['finalize-story'],
  monolithRoot: '.monolith',
};

const EVIDENCE = (kind: string, status: string, story: string): string =>
  `---\ntype: working\nid: ${kind}\n---\n\n## Last Check\n\n**Status:** ${status}\n**Date:** 2026-11-02\n**Story:** ${story}\n`;

async function instance(opts: { config?: Record<string, unknown>; evidence?: boolean } = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-finalize-'));
  dirs.push(dir);
  await scaffoldInstance(dir, CONFIG);
  const cfg = { ...CONFIG, monolithRoot: '.monolith', ...(opts.config ?? {}) };
  writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify(cfg, null, 2));
  if (opts.evidence !== false) {
    writeFileSync(join(dir, '.monolith/memory/working/integrity-result.md'), EVIDENCE('integrity-result', 'PASS', 'DOCSYNC-001 — test'));
    writeFileSync(join(dir, '.monolith/memory/working/governance-result.md'), EVIDENCE('governance-result', 'PASS', 'DOCSYNC-001 — test'));
  }
  return dir;
}

function proposal(over: Partial<FinalizationProposal> = {}): FinalizationProposal {
  const raw = {
    schemaVersion: 1,
    story: { id: 'DOCSYNC-001', title: 'Deterministic finalization', phase: 'phase-1', phaseHeading: 'Phase 1 — Test', slug: 'story-docsync-001-test', date: '2026-11-02' },
    expectedCurrentStory: 'none',
    work: { objective: 'obj', implementationSummary: 'impl', filesChanged: ['a.ts'], tests: '10 pass', keyDecisions: 'kd', adrs: [], lessons: 'none' },
    summary: 'Built the thing.',
    keyOutputs: ['src/finalize'],
    history: { phaseName: '1 — Test', decision: 'Roll-forward finalization.', build: 'PASS — 10 tests.' },
    ...over,
  };
  const parsed = parseProposal(raw);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.proposal;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), 'utf8');
const snapshot = (dir: string): Record<string, string> => {
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
const approve = (dir: string, p: FinalizationProposal): string => planFinalization(dir, p).digest;

describe('DOCSYNC-001 finalize', () => {
  it('1. finalizes: every target written, re-read, brief shows the new state', async () => {
    const dir = await instance();
    await writeFile(dir, 'unrelated.txt', 'keep me');
    const p = proposal({ handoff: { content: '# Handoff\n\nDOCSYNC-001 done.\n' } });
    const plan = planFinalization(dir, p);
    expect(plan.status).toBe('READY');
    expect(plan.checks.map((c) => `${c.id}:${c.status}`)).toEqual(['targets:PASS', 'expected-state:PASS', 'integrity:PASS', 'governance:PASS']);
    const r = await applyFinalization(dir, p, plan.digest);
    expect(r.status).toBe('FINALIZED');
    expect(r.applied).toEqual(['capsule', 'execution-history', 'story-index', 'handoff', 'active']);
    expect(read(dir, '.monolith/memory/working/phases/phase-1/stories/story-docsync-001-test.md')).toContain('status: COMPLETED');
    expect(read(dir, '.monolith/memory/long-term/execution-history.md')).toContain('## DOCSYNC-001 — Deterministic finalization (2026-11-02)');
    const idx = read(dir, '.monolith/memory/working/story-index.md');
    expect(idx).toContain('## Phase 1 — Test');
    expect(idx).toContain('### DOCSYNC-001 — Deterministic finalization');
    const active = read(dir, '.monolith/memory/working/active.md');
    expect(active).toContain('Previous recorded story: **DOCSYNC-001 — Deterministic finalization**');
    expect(active).toContain('## Current Operational Focus'); // untouched section
    expect(read(dir, '.monolith/context/boot/HANDOFF.md')).toContain('DOCSYNC-001 done.');
    expect(read(dir, 'unrelated.txt')).toBe('keep me');
    // 12. brief reads the new state
    const text = render(await collect(dir)).text;
    expect(text).toContain('No active story recorded.');
    expect(text).toContain('DOCSYNC-001');
    expect(existsSync(join(dir, '.monolith/memory/working/finalize.lock'))).toBe(false);
  });

  it('2. missing required document → FAIL, nothing written; unreadable is distinguished', async () => {
    const dir = await instance({ config: { finalization: { requiredDocs: [{ path: 'docs/state.md', label: 'State' }, { path: 'docs/link.md', label: 'Link' }] } } });
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'outside.md'), 'x');
    symlinkSync(join(dir, 'outside.md'), join(dir, 'docs/link.md'));
    const p = proposal();
    const before = snapshot(dir);
    const plan = planFinalization(dir, p);
    const req = plan.checks.find((c) => c.id === 'required-docs')!;
    expect(req.status).toBe('FAIL');
    expect(req.detail).toContain('docs/state.md (State): MISSING');
    expect(req.detail).toContain('docs/link.md (Link): UNREADABLE FILE_SYMLINK');
    const r = await applyFinalization(dir, p, plan.digest);
    expect(r.status).toBe('REFUSED');
    expect(snapshot(dir)).toEqual(before);
  });

  it('2b. configured required docs that exist pass and bind into the digest', async () => {
    const dir = await instance({ config: { finalization: { requiredDocs: [{ path: 'docs/state.md', label: 'State' }] } } });
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs/state.md'), 'v1');
    const p = proposal();
    const a = planFinalization(dir, p);
    expect(a.checks.find((c) => c.id === 'required-docs')!.status).toBe('PASS');
    writeFileSync(join(dir, 'docs/state.md'), 'v2');
    expect(planFinalization(dir, p).digest).not.toBe(a.digest);
    expect((await applyFinalization(dir, p, a.digest)).status).toBe('REFUSED');
  });

  it('3/4. stale approval or a document changed after planning → REFUSED, nothing written', async () => {
    const dir = await instance();
    const p = proposal();
    const digest = approve(dir, p);
    const f = join(dir, '.monolith/memory/working/story-index.md');
    writeFileSync(f, readFileSync(f, 'utf8') + '\nedited by owner\n');
    const before = snapshot(dir);
    const r = await applyFinalization(dir, p, digest);
    expect(r.status).toBe('REFUSED');
    expect(r.diagnostics[0]).toContain('STALE');
    expect(snapshot(dir)).toEqual(before);
    // a wrong or forged token is also refused
    expect((await applyFinalization(dir, p, 'deadbeef')).status).toBe('REFUSED');
  });

  it('3b. wrong expected current story → FAIL', async () => {
    const dir = await instance();
    const plan = planFinalization(dir, proposal({ expectedCurrentStory: { contains: 'DOCSYNC-001 is the active story' } }));
    expect(plan.checks.find((c) => c.id === 'expected-state')!.status).toBe('FAIL');
    expect(plan.status).toBe('NOT_READY');
  });

  it('5. invalid paths are rejected (docUpdates traversal / absolute / not allowed)', async () => {
    for (const path of ['../x.md', '/etc/passwd', 'a/../../x.md', 'a\\b.md', '.git/config', 'a//b']) {
      const parsed = parseProposal({ ...proposal(), docUpdates: [{ path, newContent: 'x', reason: 'r' }] });
      expect(parsed.ok, path).toBe(false);
    }
    const dir = await instance();
    writeFileSync(join(dir, 'README.md'), 'old');
    const p = proposal({ docUpdates: [{ path: 'README.md', newContent: 'new', reason: 'sync' }] });
    const plan = planFinalization(dir, p);
    expect(plan.status).toBe('NOT_READY');
    expect(plan.targets.find((t) => t.id === 'doc:0')!.reason).toContain('not an allowed write target');
    expect((await applyFinalization(dir, p, plan.digest)).status).toBe('REFUSED');
    expect(read(dir, 'README.md')).toBe('old');
  });

  it('5b. an allowed doc is updated only when listed in config; a canonical file cannot be aliased', async () => {
    const dir = await instance({ config: { finalization: { allowedDocs: ['README.md', '.monolith/memory/working/active.md'] } } });
    writeFileSync(join(dir, 'README.md'), 'old');
    const p = proposal({ docUpdates: [{ path: 'README.md', newContent: 'new\n', reason: 'sync' }] });
    const r = await applyFinalization(dir, p, approve(dir, p));
    expect(r.status).toBe('FINALIZED');
    expect(read(dir, 'README.md')).toBe('new\n');
    const alias = proposal({ story: { ...p.story, id: 'X-1', slug: 'x-1' }, docUpdates: [{ path: '.monolith/memory/working/active.md', newContent: 'pwn', reason: 'r' }] });
    expect(planFinalization(dir, alias).targets.some((t) => t.state === 'conflict' && t.reason.includes('also the target'))).toBe(true);
  });

  it('6. symlink escape: a symlinked target or directory is refused and nothing outside is written', async () => {
    const dir = await instance();
    const outside = mkdtempSync(join(tmpdir(), 'monolith-outside-'));
    dirs.push(outside);
    writeFileSync(join(outside, 'history.md'), 'outside history');
    const hist = join(dir, '.monolith/memory/long-term/execution-history.md');
    rmSync(hist);
    symlinkSync(join(outside, 'history.md'), hist);
    const p = proposal();
    const plan = planFinalization(dir, p);
    expect(plan.status).toBe('NOT_READY');
    expect(plan.targets.find((t) => t.id === 'execution-history')!.state).toBe('unreadable');
    expect((await applyFinalization(dir, p, plan.digest)).status).toBe('REFUSED');
    expect(readFileSync(join(outside, 'history.md'), 'utf8')).toBe('outside history');

    // symlinked phases directory: the capsule is not created through it
    const dir2 = await instance();
    mkdirSync(join(outside, 'phases'));
    rmSync(join(dir2, '.monolith/memory/working/phases'), { recursive: true });
    symlinkSync(join(outside, 'phases'), join(dir2, '.monolith/memory/working/phases'));
    const p2 = proposal();
    const plan2 = planFinalization(dir2, p2);
    expect(plan2.status).toBe('NOT_READY');
    expect((await applyFinalization(dir2, p2, plan2.digest)).status).toBe('REFUSED');
    expect(readdirSync(join(outside, 'phases'))).toEqual([]);
  });

  it('7/8. a write failure mid-way → INCOMPLETE (never FINALIZED), partial state detected, roll-forward completes', async () => {
    const dir = await instance();
    const p = proposal();
    const digest = approve(dir, p);
    const realRename = (await import('fs')).renameSync;
    const r1 = await applyFinalization(dir, p, digest, {
      ops: {
        renameSync: ((from: string, to: string) => {
          if (String(to).endsWith('story-index.md')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
          return realRename(from, to);
        }) as typeof renameSync,
      },
    });
    expect(r1.status).toBe('INCOMPLETE');
    expect(r1.failed!.target).toBe('story-index');
    expect(r1.applied).toEqual(['capsule', 'execution-history']);
    expect(r1.pending).toEqual(['story-index', 'active']);
    // active.md is last: it still shows the old state, so brief never claims completion
    expect(read(dir, '.monolith/memory/working/active.md')).not.toContain('Previous recorded story');
    expect(read(dir, '.monolith/memory/working/story-index.md')).not.toContain('DOCSYNC-001');
    // no leaked temp files
    expect(readdirSync(join(dir, '.monolith/memory/working')).filter((n) => n.includes('.tmp.'))).toEqual([]);

    const plan = planFinalization(dir, p);
    expect(plan.partial).toBe(true);
    expect(plan.status).toBe('READY');
    expect(plan.targets.map((t) => `${t.id}:${t.state}`)).toEqual(['capsule:done', 'execution-history:done', 'story-index:pending', 'active:pending']);
    // the old digest is invalid for the new state
    expect((await applyFinalization(dir, p, digest)).status).toBe('REFUSED');
    const r2 = await applyFinalization(dir, p, plan.digest);
    expect(r2.status).toBe('FINALIZED');
    expect(r2.applied).toEqual(['story-index', 'active']);
    expect(read(dir, '.monolith/memory/long-term/execution-history.md').match(/## DOCSYNC-001/g)).toHaveLength(1);
  });

  it('9. repeated finalization is idempotent: no duplicates, no writes', async () => {
    const dir = await instance();
    const p = proposal();
    expect((await applyFinalization(dir, p, approve(dir, p))).status).toBe('FINALIZED');
    const after = snapshot(dir);
    expect(planFinalization(dir, p).status).toBe('ALREADY_FINALIZED');
    const again = await applyFinalization(dir, p, 'anything');
    expect(again.status).toBe('ALREADY_FINALIZED');
    expect(again.applied).toEqual([]);
    expect(snapshot(dir)).toEqual(after);
    // same id with different content is a conflict, not a second record
    const other = proposal({ history: { phaseName: '1 — Test', decision: 'different', build: 'PASS' } });
    const plan = planFinalization(dir, other);
    expect(plan.status).toBe('NOT_READY');
    expect(plan.targets.find((t) => t.id === 'execution-history')!.state).toBe('conflict');
  });

  it('10. concurrent finalization: exactly one writes, the other reports ALREADY_FINALIZED', async () => {
    const dir = await instance();
    const p = proposal();
    const d = approve(dir, p);
    const [a, b] = await Promise.all([applyFinalization(dir, p, d), applyFinalization(dir, p, d)]);
    expect([a.status, b.status].sort()).toEqual(['ALREADY_FINALIZED', 'FINALIZED']);
    expect(read(dir, '.monolith/memory/long-term/execution-history.md').match(/## DOCSYNC-001/g)).toHaveLength(1);
    expect(read(dir, '.monolith/memory/working/story-index.md').match(/### DOCSYNC-001/g)).toHaveLength(1);
  });

  it('11. unrelated files and untouched sections are byte-identical', async () => {
    const dir = await instance();
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/a.ts'), 'export {}');
    const before = snapshot(dir);
    const p = proposal();
    await applyFinalization(dir, p, approve(dir, p));
    const after = snapshot(dir);
    const changed = Object.keys(after).filter((k) => before[k] !== after[k]).sort();
    expect(changed).toEqual([
      '.monolith/memory/long-term/execution-history.md',
      '.monolith/memory/working/active.md',
      '.monolith/memory/working/phases/phase-1/stories/story-docsync-001-test.md',
      '.monolith/memory/working/story-index.md',
    ]);
    // the part of active.md outside the two sections is unchanged
    expect(after['.monolith/memory/working/active.md']).toContain('## Active Phase\n\nNo active phase.');
    expect(after['.monolith/memory/working/active.md']).toContain('## Current Operational Focus');
  });

  it('13. a freshly scaffolded instance works and CRLF files keep their line endings', async () => {
    const dir = await instance();
    const f = join(dir, '.monolith/memory/working/active.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace(/\n/g, '\r\n'));
    const p = proposal();
    expect((await applyFinalization(dir, p, approve(dir, p))).status).toBe('FINALIZED');
    const out = read(dir, '.monolith/memory/working/active.md');
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    expect(planFinalization(dir, p).status).toBe('ALREADY_FINALIZED');
  });

  it('14. unverified preconditions are never PASS (missing / other story / FAIL evidence)', async () => {
    const missing = await instance({ evidence: false });
    const m = planFinalization(missing, proposal());
    expect(m.checks.filter((c) => c.id === 'integrity' || c.id === 'governance').map((c) => c.status)).toEqual(['NOT_VERIFIED', 'NOT_VERIFIED']);
    expect(m.status).toBe('NOT_READY');
    expect((await applyFinalization(missing, proposal(), m.digest)).status).toBe('REFUSED');

    const dir = await instance();
    writeFileSync(join(dir, '.monolith/memory/working/integrity-result.md'), EVIDENCE('integrity-result', 'PASS', 'OTHER-9 — old'));
    writeFileSync(join(dir, '.monolith/memory/working/governance-result.md'), EVIDENCE('governance-result', 'FAIL', 'DOCSYNC-001'));
    const p = planFinalization(dir, proposal());
    expect(p.checks.find((c) => c.id === 'integrity')!.status).toBe('NOT_VERIFIED');
    expect(p.checks.find((c) => c.id === 'governance')!.status).toBe('FAIL');
    // an id that merely contains the story id is not a match
    writeFileSync(join(dir, '.monolith/memory/working/integrity-result.md'), EVIDENCE('integrity-result', 'PASS', 'DOCSYNC-0012 — other'));
    expect(planFinalization(dir, proposal()).checks.find((c) => c.id === 'integrity')!.status).toBe('NOT_VERIFIED');
  });

  it('refuses a missing canonical document instead of creating it', async () => {
    const dir = await instance();
    rmSync(join(dir, '.monolith/memory/long-term/execution-history.md'));
    const p = proposal();
    const plan = planFinalization(dir, p);
    expect(plan.targets.find((t) => t.id === 'execution-history')!.state).toBe('missing');
    expect((await applyFinalization(dir, p, plan.digest)).status).toBe('REFUSED');
    expect(existsSync(join(dir, '.monolith/memory/long-term/execution-history.md'))).toBe(false);
  });

  it('an existing, different capsule is never overwritten', async () => {
    const dir = await instance();
    const f = join(dir, '.monolith/memory/working/phases/phase-1/stories');
    mkdirSync(f, { recursive: true });
    writeFileSync(join(f, 'story-docsync-001-test.md'), 'owner wrote this');
    const plan = planFinalization(dir, proposal());
    expect(plan.targets.find((t) => t.id === 'capsule')!.state).toBe('conflict');
    expect(read(dir, '.monolith/memory/working/phases/phase-1/stories/story-docsync-001-test.md')).toBe('owner wrote this');
  });

  it('rejects unknown proposal fields and malformed values', () => {
    expect(parseProposal({ ...proposal(), extra: 1 }).ok).toBe(false);
    expect(parseProposal({ ...proposal(), summary: 'a\nb' }).ok).toBe(false);
    expect(parseProposal({ ...proposal(), story: { ...proposal().story, date: '2026-13-40' } }).ok).toBe(false);
    expect(parseProposal({ ...proposal(), story: { ...proposal().story, slug: '../x' } }).ok).toBe(false);
    expect(parseProposal({ ...proposal(), story: { ...proposal().story, phase: '../..' } }).ok).toBe(false);
  });

  it('a broken finalization config fails closed', async () => {
    const dir = await instance({ config: { finalization: { requiredDocs: 'ROADMAP.md' } } });
    const plan = planFinalization(dir, proposal());
    expect(plan.status).toBe('NOT_READY');
    expect(plan.checks.find((c) => c.id === 'config')!.status).toBe('FAIL');
  });

  it('CLI: plan → apply with the digest; exit codes', async () => {
    const dir = await instance();
    const pf = join(dir, 'proposal.json');
    writeFileSync(pf, JSON.stringify(proposal()));
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(' '));
    try {
      expect(await runFinalizeCommand(['plan', '--proposal', pf, '--json'], dir)).toBe(0);
      const digest = (JSON.parse(logs.join('\n')) as { digest: string }).digest;
      expect(await runFinalizeCommand(['apply', '--proposal', pf], dir)).toBe(1); // no --approve
      expect(await runFinalizeCommand(['apply', '--proposal', pf, '--approve', 'bad'], dir)).toBe(2);
      expect(await runFinalizeCommand(['apply', '--proposal', pf, '--approve', digest], dir)).toBe(0);
      expect(await runFinalizeCommand(['apply', '--proposal', pf, '--approve', digest], dir)).toBe(0);
      expect(await runFinalizeCommand(['nope'], dir)).toBe(1);
    } finally {
      console.log = orig;
    }
  });
});

async function writeFile(dir: string, name: string, content: string): Promise<void> {
  writeFileSync(join(dir, name), content);
}
void beforeEach;
