/**
 * DOCSYNC-003 regression tests (remediation of the DOCSYNC-002 review):
 * MAJOR-1 idempotency by story id, MAJOR-2 recovery after a real SIGKILL,
 * nested .git paths, "any" removal, ambiguous evidence.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync, linkSync, statSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import ts from 'typescript';
import { scaffoldInstance } from '../init/scaffold.js';
import { applyFinalization, planFinalization, renderCapsule } from './core.js';
import { parseProposal, validateRelPath, type FinalizationProposal } from './proposal.js';
import type { ProjectConfig } from '../init/types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const CONFIG: ProjectConfig = {
  projectName: 'fin-rem',
  language: 'typescript',
  packageManager: 'pnpm',
  aiTool: 'claude',
  finalizationProtocol: 'finalize-story',
  protocols: ['finalize-story'],
  monolithRoot: '.monolith',
};
const W = '.monolith/memory/working/';
const LT = '.monolith/memory/long-term/';
const STORIES = `${W}phases/phase-1/stories`;

const EV = (status: string, story: string, date = '2026-11-02'): string => `---\ntype: working\n---\n\n## Last Check\n\n**Status:** ${status}\n**Date:** ${date}\n**Story:** ${story}\n`;

async function instance(extra: Record<string, unknown> = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-finrem-'));
  dirs.push(dir);
  await scaffoldInstance(dir, CONFIG);
  writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify({ ...CONFIG, ...extra }, null, 2));
  writeFileSync(join(dir, W + 'integrity-result.md'), EV('PASS', 'DOCSYNC-001 — t'));
  writeFileSync(join(dir, W + 'governance-result.md'), EV('PASS', 'DOCSYNC-001 — t'));
  return dir;
}

function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    story: { id: 'DOCSYNC-001', title: 'Det', phase: 'phase-1', phaseHeading: 'Phase 1 — T', slug: 'story-docsync-001', date: '2026-11-02' },
    expectedCurrentStory: 'none',
    work: { objective: 'o', implementationSummary: 'i', filesChanged: ['a'], tests: 't', keyDecisions: 'k', adrs: [], lessons: 'l' },
    summary: 's',
    keyOutputs: ['x'],
    history: { phaseName: 'P', decision: 'd', build: 'b' },
    ...over,
  };
}
function proposal(over: Record<string, unknown> = {}): FinalizationProposal {
  const r = parseProposal(raw(over));
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.proposal;
}
const story = (over: Record<string, unknown>): Record<string, unknown> => ({ ...(raw().story as object), ...over });
const read = (d: string, r: string): string => readFileSync(join(d, r), 'utf8');
const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;
const files = (d: string, r: string): string[] => readdirSync(join(d, r)).sort();

// ---------------------------------------------------------------------------
describe('MAJOR-1: one story id, one finalization', () => {
  it('same id with other title/slug/date after FINALIZED: conflict, nothing appended, no second capsule', async () => {
    const dir = await instance();
    const p = proposal();
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
    const hist = read(dir, LT + 'execution-history.md');
    const idx = read(dir, W + 'story-index.md');
    const stories = files(dir, STORIES);

    const p2 = proposal({ story: story({ title: 'Det v2', slug: 'story-docsync-001-v2', date: '2026-11-03' }) });
    const pl = planFinalization(dir, p2);
    expect(pl.status).toBe('NOT_READY');
    expect(pl.targets.find((t) => t.id === 'execution-history')!.state).toBe('conflict');
    expect(pl.targets.find((t) => t.id === 'story-index')!.state).toBe('conflict');
    expect(pl.targets.find((t) => t.id === 'capsule')!.state).toBe('conflict');
    const r = await applyFinalization(dir, p2, pl.digest);
    expect(r.status).toBe('REFUSED');
    expect(read(dir, LT + 'execution-history.md')).toBe(hist);
    expect(read(dir, W + 'story-index.md')).toBe(idx);
    expect(files(dir, STORIES)).toEqual(stories);
    expect(count(hist, /^## DOCSYNC-001 /gm)).toBe(1);
  });

  it('identical repeat is ALREADY_FINALIZED and writes nothing', async () => {
    const dir = await instance();
    const p = proposal();
    await applyFinalization(dir, p, planFinalization(dir, p).digest);
    const again = await applyFinalization(dir, p, planFinalization(dir, p).digest);
    expect(again.status).toBe('ALREADY_FINALIZED');
    expect(again.applied).toEqual([]);
  });

  it('a different spelling of the id (case) is the same story', async () => {
    const dir = await instance();
    const p = proposal();
    await applyFinalization(dir, p, planFinalization(dir, p).digest);
    const lower = proposal({ story: story({ id: 'docsync-001' }) });
    expect(planFinalization(dir, lower).targets.find((t) => t.id === 'execution-history')!.state).toBe('conflict');
  });

  it('a longer id with the same prefix is NOT the same story', async () => {
    const dir = await instance();
    const p = proposal({ story: story({ id: 'DOCSYNC-0010', slug: 'story-0010' }) });
    writeFileSync(join(dir, W + 'integrity-result.md'), EV('PASS', 'DOCSYNC-0010'));
    writeFileSync(join(dir, W + 'governance-result.md'), EV('PASS', 'DOCSYNC-0010'));
    await applyFinalization(dir, p, planFinalization(dir, p).digest);
    const other = planFinalization(dir, proposal());
    expect(other.targets.find((t) => t.id === 'execution-history')!.state).toBe('pending');
  });

  it('orphan capsule (crash before history) under another slug blocks a second capsule', async () => {
    const dir = await instance();
    mkdirSync(join(dir, STORIES), { recursive: true });
    writeFileSync(join(dir, `${STORIES}/story-old-slug.md`), renderCapsule(proposal({ story: story({ slug: 'story-old-slug' }) })));
    const pl = planFinalization(dir, proposal());
    expect(pl.status).toBe('NOT_READY');
    expect(pl.targets.find((t) => t.id === 'capsule')!.reason).toContain('story-old-slug.md');
    expect(files(dir, STORIES)).toEqual(['story-old-slug.md']);
  });

  it('roll-forward after INCOMPLETE still works with the same proposal and writes no duplicates', async () => {
    const dir = await instance();
    const p = proposal();
    const fs = await import('fs');
    let n = 0;
    const r1 = await applyFinalization(dir, p, planFinalization(dir, p).digest, {
      ops: { renameSync: (a: string, b: string) => { if (++n === 3) throw Object.assign(new Error('boom'), { code: 'EIO' }); return fs.renameSync(a, b); } },
    });
    expect(r1.status).toBe('INCOMPLETE');
    const pl = planFinalization(dir, p);
    expect(pl.partial).toBe(true);
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('FINALIZED');
    expect(count(read(dir, LT + 'execution-history.md'), /^## DOCSYNC-001 /gm)).toBe(1);
    expect(count(read(dir, W + 'story-index.md'), /^### DOCSYNC-001 /gm)).toBe(1);
    expect(files(dir, STORIES)).toEqual(['story-docsync-001.md']);
  });
});

// ---------------------------------------------------------------------------
// Real process death. The child runs the compiled (transpiled) finalizer and
// SIGKILLs itself around one filesystem call.
// ---------------------------------------------------------------------------

function buildRuntime(): string {
  const out = mkdtempSync(join(tmpdir(), 'monolith-finrt-'));
  dirs.push(out);
  const src = join(__dirname, '..');
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(src, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (r === 'ui' || r === 'scripts') continue;
        walk(r);
      } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) {
        const js = ts.transpileModule(readFileSync(join(src, r), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: e.name }).outputText;
        mkdirSync(join(out, rel), { recursive: true });
        writeFileSync(join(out, r.replace(/\.ts$/, '.js')), js);
      }
    }
  };
  walk('');
  writeFileSync(join(out, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(out, 'child.mjs'),
    `import fs from 'fs';
import { applyFinalization, planFinalization } from './finalize/core.js';
import { parseProposal } from './finalize/proposal.js';
const [dir, propFile, point] = process.argv.slice(2);
const parsed = parseProposal(JSON.parse(fs.readFileSync(propFile, 'utf8')));
if (!parsed.ok) throw new Error(parsed.errors.join(';'));
const p = parsed.proposal;
const dg = process.env.APPROVE || planFinalization(dir, p).digest;
const die = () => process.kill(process.pid, 'SIGKILL');
let links = 0, unlinks = 0;
const ops = {};
if (point === 'before-link') ops.linkSync = (a, b) => { die(); };
if (point === 'after-link') ops.linkSync = (a, b) => { fs.linkSync(a, b); die(); };
if (point === 'after-unlink') ops.unlinkSync = (a) => { fs.unlinkSync(a); if (++unlinks === 1) die(); };
const r = await applyFinalization(dir, p, dg, { ops });
process.stdout.write('RESULT ' + r.status + ' ' + r.applied.join(','));
`,
  );
  return out;
}

function runChild(rt: string, dir: string, propFile: string, point: string, env: Record<string, string> = {}): Promise<{ signal: NodeJS.Signals | null; code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [join(rt, 'child.mjs'), dir, propFile, point], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let stdout = '';
    c.stdout.on('data', (d) => (stdout += d));
    const t = setTimeout(() => c.kill('SIGKILL'), 30_000);
    c.on('close', (code, signal) => {
      clearTimeout(t);
      resolve({ signal, code, stdout });
    });
  });
}

describe('MAJOR-2: real SIGKILL around capsule publication', () => {
  const setup = async (): Promise<{ dir: string; rt: string; propFile: string; p: FinalizationProposal }> => {
    const dir = await instance();
    const rt = buildRuntime();
    const propFile = join(rt, 'proposal.json');
    writeFileSync(propFile, JSON.stringify(raw()));
    return { dir, rt, propFile, p: proposal() };
  };
  const capsule = `${STORIES}/story-docsync-001.md`;

  it('SIGKILL before link(): nothing published, plan READY, apply finalizes', async () => {
    const { dir, rt, propFile, p } = await setup();
    const r = await runChild(rt, dir, propFile, 'before-link');
    expect(r.signal).toBe('SIGKILL');
    expect(existsSync(join(dir, capsule))).toBe(false);
    const pl = planFinalization(dir, p);
    expect(pl.status).toBe('READY');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('FINALIZED');
    expect(count(read(dir, LT + 'execution-history.md'), /^## DOCSYNC-001 /gm)).toBe(1);
  }, 60_000);

  it('SIGKILL right after link(): residue is diagnosed, nothing auto-deleted, owner removal rolls forward', async () => {
    const { dir, rt, propFile, p } = await setup();
    const r = await runChild(rt, dir, propFile, 'after-link');
    expect(r.signal).toBe('SIGKILL');
    const before = files(dir, STORIES);
    expect(before.length).toBe(2);
    const residue = before.find((n) => n.includes('.tmp.'))!;
    expect(statSync(join(dir, capsule)).nlink).toBe(2);

    const pl = planFinalization(dir, p);
    expect(pl.status).toBe('NOT_READY');
    const cap = pl.targets.find((t) => t.id === 'capsule')!;
    expect(cap.state).toBe('unreadable');
    expect(cap.reason).toContain('FILE_HARDLINKED');
    expect(cap.reason).toContain('interrupted create');
    expect(cap.reason).toContain(`rm -- '${STORIES}/${residue}'`);
    // apply refuses and still deletes nothing
    const refused = await applyFinalization(dir, p, 'whatever');
    expect(refused.status).toBe('REFUSED');
    expect(files(dir, STORIES)).toEqual(before);
    expect(existsSync(join(dir, LT + 'execution-history.md'))).toBe(true);
    expect(count(read(dir, LT + 'execution-history.md'), /^## DOCSYNC-001 /gm)).toBe(0);

    // owner action: remove exactly the named staging name
    unlinkSync(join(dir, STORIES, residue));
    const pl2 = planFinalization(dir, p);
    expect(pl2.status).toBe('READY');
    expect(pl2.targets.find((t) => t.id === 'capsule')!.state).toBe('done');
    expect((await applyFinalization(dir, p, pl2.digest)).status).toBe('FINALIZED');
    expect(files(dir, STORIES)).toEqual(['story-docsync-001.md']);
    expect(count(read(dir, LT + 'execution-history.md'), /^## DOCSYNC-001 /gm)).toBe(1);
  }, 60_000);

  it('SIGKILL after the staging name is removed: capsule done, apply rolls forward', async () => {
    const { dir, rt, propFile, p } = await setup();
    const r = await runChild(rt, dir, propFile, 'after-unlink');
    expect(r.signal).toBe('SIGKILL');
    expect(statSync(join(dir, capsule)).nlink).toBe(1);
    const pl = planFinalization(dir, p);
    expect(pl.targets.find((t) => t.id === 'capsule')!.state).toBe('done');
    expect(pl.status).toBe('READY');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('FINALIZED');
    expect(count(read(dir, LT + 'execution-history.md'), /^## DOCSYNC-001 /gm)).toBe(1);
  }, 60_000);

  it('a foreign hard link to the capsule is NOT called residue and is never touched', async () => {
    const { dir, p } = await setup();
    mkdirSync(join(dir, STORIES), { recursive: true });
    writeFileSync(join(dir, capsule), renderCapsule(p));
    writeFileSync(join(dir, 'other.txt'), 'x');
    unlinkSync(join(dir, 'other.txt'));
    linkSync(join(dir, capsule), join(dir, 'user-backup.md'));
    const pl = planFinalization(dir, p);
    const cap = pl.targets.find((t) => t.id === 'capsule')!;
    expect(cap.state).toBe('unreadable');
    expect(cap.reason).not.toContain('interrupted create');
    expect(cap.reason).toContain('Do not delete anything');
    expect(files(dir, STORIES)).toEqual(['story-docsync-001.md']);
    expect(existsSync(join(dir, 'user-backup.md'))).toBe(true);
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('REFUSED');
  });

  it('a look-alike staging name with DIFFERENT content is not residue', async () => {
    const { dir, p } = await setup();
    mkdirSync(join(dir, STORIES), { recursive: true });
    writeFileSync(join(dir, capsule), 'user wrote this\n');
    linkSync(join(dir, capsule), join(dir, `${capsule}.tmp.123.0123456789abcdef`));
    const cap = planFinalization(dir, p).targets.find((t) => t.id === 'capsule')!;
    expect(cap.reason).not.toContain('interrupted create');
    expect(cap.reason).toContain('differs');
    expect(read(dir, capsule)).toBe('user wrote this\n');
  });

  it('two processes applying the same approved plan: exactly one writes, no duplicates', async () => {
    const { dir, rt, propFile, p } = await setup();
    const digest = planFinalization(dir, p).digest;
    const [a, b] = await Promise.all([runChild(rt, dir, propFile, 'none', { APPROVE: digest }), runChild(rt, dir, propFile, 'none', { APPROVE: digest })]);
    const results = [a.stdout, b.stdout].map((s) => /RESULT (\w+)/.exec(s)?.[1]).sort();
    expect(results).toEqual(['ALREADY_FINALIZED', 'FINALIZED']);
    expect(count(read(dir, LT + 'execution-history.md'), /^## DOCSYNC-001 /gm)).toBe(1);
    expect(count(read(dir, W + 'story-index.md'), /^### DOCSYNC-001 /gm)).toBe(1);
    expect(files(dir, STORIES)).toEqual(['story-docsync-001.md']);
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe('SECURITY-3: .git at any depth', () => {
  it('rejects .git components anywhere, any case', () => {
    for (const p of ['.git/config', 'sub/.git/hooks/pre-commit', 'a/b/.git', '.GIT/config', 'sub/.Git/x', 'x/.git./y', 'x/.git /y', 'a/node_modules/x']) {
      expect(validateRelPath(p), p).not.toBeNull();
      expect(parseProposal(raw({ docUpdates: [{ path: p, newContent: 'x', reason: 'r' }] })).ok, p).toBe(false);
    }
  });
  it('keeps ordinary paths', () => {
    for (const p of ['docs/state.md', '.github/workflows/ci.yml', 'docs/.gitignore-notes.md', '.gitignore', '.gitmodules', 'a/git/b', 'docs/my.git.md']) expect(validateRelPath(p), p).toBeNull();
  });
  it('nested .git path in allowedDocs is refused by the config check (fail closed)', async () => {
    const dir = await instance({ finalization: { allowedDocs: ['sub/.git/hooks/pre-commit'] } });
    mkdirSync(join(dir, 'sub/.git/hooks'), { recursive: true });
    writeFileSync(join(dir, 'sub/.git/hooks/pre-commit'), 'orig');
    const pl = planFinalization(dir, proposal());
    expect(pl.status).toBe('NOT_READY');
    expect(pl.checks.find((c) => c.id === 'config')!.status).toBe('FAIL');
    expect(read(dir, 'sub/.git/hooks/pre-commit')).toBe('orig');
  });
  it('a normal allowed document is still written', async () => {
    const dir = await instance({ finalization: { allowedDocs: ['docs/state.md'] } });
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs/state.md'), 'old');
    const p = proposal({ docUpdates: [{ path: 'docs/state.md', newContent: 'new', reason: 'sync' }] });
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('FINALIZED');
    expect(read(dir, 'docs/state.md')).toBe('new');
  });
});

// ---------------------------------------------------------------------------
describe('SECURITY-4: current story identity', () => {
  it('"any" is rejected by the proposal schema', () => {
    const r = parseProposal(raw({ expectedCurrentStory: 'any' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('"any" is not accepted');
  });
  it('contains must name the story being finalized', () => {
    expect(parseProposal(raw({ expectedCurrentStory: { contains: 'OTHER-5' } })).ok).toBe(false);
    expect(parseProposal(raw({ expectedCurrentStory: { contains: 'docsync-001' } })).ok).toBe(true);
  });
  it('OTHER-5 active, DOCSYNC-001 proposed: refused under both remaining modes, OTHER-5 survives', async () => {
    const dir = await instance();
    const active = read(dir, W + 'active.md').replace(/(## Current Story)[\s\S]*?(\n---|\n## )/, (_m, h: string, tail: string) => `${h}\n\nOTHER-5 in progress\n${tail}`);
    writeFileSync(join(dir, W + 'active.md'), active);
    for (const exp of ['none', { contains: 'DOCSYNC-001' }]) {
      const p = proposal({ expectedCurrentStory: exp });
      const pl = planFinalization(dir, p);
      expect(pl.checks.find((c) => c.id === 'expected-state')!.status).toBe('FAIL');
      const r = await applyFinalization(dir, p, pl.digest);
      expect(r.status).toBe('REFUSED');
    }
    expect(read(dir, W + 'active.md')).toBe(active);
    expect(read(dir, W + 'active.md')).toContain('OTHER-5 in progress');
  });
  it('the story being finalized may be the active one, and roll-forward after a partial run still passes', async () => {
    const dir = await instance();
    const active = read(dir, W + 'active.md').replace(/(## Current Story)[\s\S]*?(\n---|\n## )/, (_m, h: string, tail: string) => `${h}\n\nDOCSYNC-001 in progress\n${tail}`);
    writeFileSync(join(dir, W + 'active.md'), active);
    const p = proposal({ expectedCurrentStory: { contains: 'DOCSYNC-001' } });
    const fs = await import('fs');
    let n = 0;
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest, { ops: { renameSync: (a: string, b: string) => { if (++n === 3) throw Object.assign(new Error('boom'), { code: 'EIO' }); return fs.renameSync(a, b); } } })).status).toBe('INCOMPLETE');
    const pl = planFinalization(dir, p);
    expect(pl.partial).toBe(true);
    expect(pl.checks.find((c) => c.id === 'expected-state')!.status).toBe('PASS');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('FINALIZED');
  });
});

// ---------------------------------------------------------------------------
describe('SECURITY-5: ambiguous evidence is never PASS', () => {
  const status = async (content: string, id = 'integrity'): Promise<{ s: string; d: string }> => {
    const dir = await instance();
    writeFileSync(join(dir, W + 'integrity-result.md'), content);
    const c = planFinalization(dir, proposal()).checks.find((x) => x.id === id)!;
    return { s: c.status, d: c.detail };
  };
  it('one clean PASS → PASS; one clean FAIL → FAIL', async () => {
    expect((await status(EV('PASS', 'DOCSYNC-001 — t'))).s).toBe('PASS');
    expect((await status(EV('FAIL', 'DOCSYNC-001 — t'))).s).toBe('FAIL');
  });
  it('PASS then FAIL (either order) → NOT_VERIFIED', async () => {
    expect((await status('**Status:** PASS\n\n' + EV('FAIL', 'DOCSYNC-001'))).s).toBe('NOT_VERIFIED');
    expect((await status(EV('FAIL', 'DOCSYNC-001') + '\n**Status:** PASS\n')).s).toBe('NOT_VERIFIED');
  });
  it('identical duplicated fields → NOT_VERIFIED', async () => {
    expect((await status(EV('PASS', 'DOCSYNC-001') + '**Status:** PASS\n')).s).toBe('NOT_VERIFIED');
    expect((await status(EV('PASS', 'DOCSYNC-001') + '**Date:** 2026-11-02\n')).s).toBe('NOT_VERIFIED');
  });
  it('several / different / lookalike story ids → NOT_VERIFIED', async () => {
    expect((await status(EV('PASS', 'DOCSYNC-001') + '**Story:** OTHER-9\n')).s).toBe('NOT_VERIFIED');
    expect((await status(EV('PASS', 'OTHER-9, DOCSYNC-001')) ).s).toBe('NOT_VERIFIED');
    expect((await status(EV('PASS', 'DOCSYNC-001,OTHER-9'))).s).toBe('NOT_VERIFIED');
    expect((await status(EV('PASS', 'DOCSYNC-0010 — x'))).s).toBe('NOT_VERIFIED');
    expect((await status(EV('PASS', 'see DOCSYNC-001'))).s).toBe('NOT_VERIFIED');
    expect((await status(EV('PASS', 'docsync-001'))).s).toBe('NOT_VERIFIED');
  });
  it('malformed status values → NOT_VERIFIED', async () => {
    expect((await status(EV('PASS (mostly)', 'DOCSYNC-001'))).s).toBe('NOT_VERIFIED');
    expect((await status(EV('PASSED', 'DOCSYNC-001'))).s).toBe('NOT_VERIFIED');
    expect((await status('**Story:** DOCSYNC-001\n**Date:** 2026-11-02\n')).s).toBe('NOT_VERIFIED');
  });
  it('missing/invalid/future/stale date → NOT_VERIFIED', async () => {
    expect((await status('**Status:** PASS\n**Story:** DOCSYNC-001\n')).s).toBe('NOT_VERIFIED');
    expect((await status(EV('PASS', 'DOCSYNC-001', '2026-13-45'))).s).toBe('NOT_VERIFIED');
    expect((await status(EV('PASS', 'DOCSYNC-001', '2026-11-05'))).s).toBe('NOT_VERIFIED');
    expect((await status(EV('PASS', 'DOCSYNC-001', '2019-01-01'))).d).toContain('stale');
    expect((await status(EV('PASS', 'DOCSYNC-001', '2026-10-26'))).s).toBe('PASS'); // 7 days
    expect((await status(EV('PASS', 'DOCSYNC-001', '2026-10-25'))).s).toBe('NOT_VERIFIED'); // 8 days
  });
  it('governance evidence follows the same rules and a bad one blocks READY', async () => {
    const dir = await instance();
    writeFileSync(join(dir, W + 'governance-result.md'), EV('PASS', 'DOCSYNC-001') + '**Status:** FAIL\n');
    const pl = planFinalization(dir, proposal());
    expect(pl.checks.find((c) => c.id === 'governance')!.status).toBe('NOT_VERIFIED');
    expect(pl.status).toBe('NOT_READY');
  });
});

// ---------------------------------------------------------------------------
describe('DOCSYNC-005: active story identity is a whole-id match', () => {
  const setActive = (dir: string, text: string): string => {
    const a = read(dir, W + 'active.md').replace(/(## Current Story)[\s\S]*?(\n---|\n## )/, (_m, h: string, tail: string) => `${h}\n\n${text}\n${tail}`);
    writeFileSync(join(dir, W + 'active.md'), a);
    return a;
  };
  const withId = (id: string): Record<string, unknown> => ({ story: story({ id, slug: `story-${id.toLowerCase()}` }), expectedCurrentStory: { contains: id } });
  const evidenceFor = (dir: string, id: string): void => {
    writeFileSync(join(dir, W + 'integrity-result.md'), EV('PASS', id));
    writeFileSync(join(dir, W + 'governance-result.md'), EV('PASS', id));
  };
  const expected = (dir: string, over: Record<string, unknown>): string => planFinalization(dir, proposal(over)).checks.find((c) => c.id === 'expected-state')!.status;

  it('own story active → PASS (also with trailing punctuation)', async () => {
    for (const text of ['S-1 in progress', 'Working on S-1.', '**S-1** — title', '(S-1)']) {
      const dir = await instance();
      evidenceFor(dir, 'S-1');
      setActive(dir, text);
      expect(expected(dir, withId('S-1')), text).toBe('PASS');
    }
  });

  it.each([
    ['S-1', 'S-10'],
    ['S-1', 'XS-1'],
    ['1.1', '11.1'],
    ['1.1', '1.10'],
    ['DOCSYNC-001', 'DOCSYNC-0010'],
  ])('finalizing %s while %s is active → refused, active.md byte-identical', async (id, other) => {
    const dir = await instance();
    evidenceFor(dir, id);
    const active = setActive(dir, `${other} — somebody else's story`);
    const over = withId(id);
    const pl = planFinalization(dir, proposal(over));
    expect(pl.checks.find((c) => c.id === 'expected-state')!.status).toBe('FAIL');
    expect(pl.status).toBe('NOT_READY');
    expect((await applyFinalization(dir, proposal(over), pl.digest)).status).toBe('REFUSED');
    expect(read(dir, W + 'active.md')).toBe(active);
    expect(existsSync(join(dir, STORIES))).toBe(false);
  });

  it('active text naming both the own id and a lookalike is ambiguous → FAIL', async () => {
    const dir = await instance();
    evidenceFor(dir, 'S-1');
    setActive(dir, 'S-10 in progress (not S-1)');
    expect(expected(dir, withId('S-1'))).toBe('FAIL');
  });

  it('contains text must hold the id as a whole token', () => {
    const r = parseProposal(raw({ story: story({ id: 'S-1', slug: 'story-s-1' }), expectedCurrentStory: { contains: 'S-10' } }));
    expect(r.ok).toBe(false);
    expect(parseProposal(raw({ story: story({ id: 'S-1', slug: 'story-s-1' }), expectedCurrentStory: { contains: 'story S-1, active' } })).ok).toBe(true);
  });

  it('roll-forward after INCOMPLETE and identical repeat still work', async () => {
    const dir = await instance();
    setActive(dir, 'DOCSYNC-001 in progress');
    const over = { expectedCurrentStory: { contains: 'DOCSYNC-001' } };
    const p = proposal(over);
    const fs = await import('fs');
    let n = 0;
    const r1 = await applyFinalization(dir, p, planFinalization(dir, p).digest, { ops: { renameSync: (a: string, b: string) => { if (++n === 3) throw Object.assign(new Error('boom'), { code: 'EIO' }); return fs.renameSync(a, b); } } });
    expect(r1.status).toBe('INCOMPLETE');
    const pl = planFinalization(dir, p);
    expect(pl.checks.find((c) => c.id === 'expected-state')!.status).toBe('PASS');
    expect((await applyFinalization(dir, p, pl.digest)).status).toBe('FINALIZED');
    expect((await applyFinalization(dir, p, planFinalization(dir, p).digest)).status).toBe('ALREADY_FINALIZED');
  });
});
