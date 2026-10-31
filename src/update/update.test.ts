import { afterEach, describe, expect, it, vi } from 'vitest';
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, lstatSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { scaffoldInstance } from '../init/scaffold.js';
import type { ProjectConfig } from '../init/types.js';
import { applyPlan, integrationComplete, planUpdate } from './index.js';
import { inspectBlock, blockBody, renderBlock } from '../managed/index.js';
import { runUpdate, UPDATE_USAGE } from './cli.js';

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const CONFIG: ProjectConfig = {
  projectName: 'p',
  language: 'typescript',
  packageManager: 'pnpm',
  aiTool: 'claude',
  finalizationProtocol: 'finalize-story',
  protocols: ['finalize-story'],
  monolithRoot: '.monolith',
};

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'monolith-update-'));
  dirs.push(d);
  return d;
}

async function newInstance(cfg: ProjectConfig = CONFIG): Promise<string> {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const d = tmp();
  await scaffoldInstance(d, cfg);
  return d;
}

function edit(dir: string, rel: string, fn: (s: string) => string): void {
  const p = join(dir, rel);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
}

const BLOCK = /<!-- monolith:begin [^\n]*-->\n[\s\S]*?<!-- monolith:end [a-z-]+ -->\n?/g;

/** An instance as `init` produced it at 0.1.0-alpha.0: no AGENT.md, no managed blocks, no Idea Capture. */
async function oldInstance(cfg: ProjectConfig = CONFIG): Promise<string> {
  const d = await newInstance(cfg);
  const r = cfg.monolithRoot;
  rmSync(join(d, r, 'skills', 'idea-capture'), { recursive: true });
  rmSync(join(d, r, 'AGENT.md'));
  rmSync(join(d, r, 'memory', 'long-term', 'ideas'), { recursive: true, force: true });
  for (const f of [`${r}/skills/INDEX.md`, `${r}/context/maps/routing-map.md`, 'AGENTS.md', 'CLAUDE.md', '.cursorrules', '.windsurfrules']) {
    if (existsSync(join(d, f))) edit(d, f, (t) => t.replace(BLOCK, '').replace(/\n---\n\n---\n/g, '\n---\n').replace(/\s+$/, '\n'));
  }
  edit(d, `${r}/context/maps/semantic-map.md`, (t) => t.split('\n').filter((l) => !/idea/i.test(l)).join('\n'));
  return d;
}

/** path -> content (files) / symlink marker, for before/after comparison. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const full = join(d, e);
      const st = lstatSync(full);
      const rel = relative(dir, full);
      if (st.isDirectory()) {
        out[rel + '/'] = 'dir';
        walk(full);
      } else out[rel] = st.isSymbolicLink() ? 'symlink' : readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}

const actions = (dir: string): Record<string, string> => Object.fromEntries(planUpdate(dir).items.map((i) => [i.path, i.action]));
const SKILL = '.monolith/skills/idea-capture/SKILL.md';
const AGENT = '.monolith/AGENT.md';
const INDEX = '.monolith/skills/INDEX.md';
const ROUTING = '.monolith/context/maps/routing-map.md';
const quiet = (): string[] => {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((m?: unknown) => void logs.push(String(m)));
  return logs;
};
const read = (d: string, rel: string): string => readFileSync(join(d, rel), 'utf8');

describe('monolith update — new instance', () => {
  it('is COMPLETE out of the box (init and update share the managed blocks) and writes nothing', async () => {
    const d = await newInstance();
    const before = snapshot(d);
    const plan = planUpdate(d);
    expect(plan.items.filter((i) => ['ADD', 'UPDATE', 'CONFLICT'].includes(i.action))).toEqual([]);
    expect(plan.chain.every((c) => c.ok)).toBe(true);
    expect(integrationComplete(plan)).toBe(true);
    const r = applyPlan(d, plan);
    expect([r.created, r.updated, r.stale]).toEqual([[], [], []]);
    expect(snapshot(d)).toEqual(before);
  });

  it('init wires CLAUDE.md and AGENTS.md to AGENT.md and keeps the skill list out of them', async () => {
    const d = await newInstance();
    expect(read(d, 'CLAUDE.md')).toContain('`.monolith/AGENT.md`');
    expect(read(d, 'AGENTS.md')).toContain('`.monolith/AGENT.md`');
    expect(read(d, AGENT)).toContain('monolith idea add');
    expect(read(d, 'CLAUDE.md')).not.toContain('idea-capture');
  });
});

describe('monolith update — old instance (0.1.0-alpha.0)', () => {
  it('previews ADD/UPDATE for every missing piece, with no CONFLICT, changing nothing', async () => {
    const d = await oldInstance();
    const before = snapshot(d);
    expect(actions(d)).toMatchObject({
      [SKILL]: 'ADD',
      [AGENT]: 'ADD',
      [INDEX]: 'UPDATE',
      [ROUTING]: 'UPDATE',
      'CLAUDE.md': 'UPDATE',
      'AGENTS.md': 'UPDATE',
      '.monolith/context/maps/semantic-map.md': 'SKIP',
    });
    const plan = planUpdate(d);
    expect(integrationComplete(plan)).toBe(false);
    expect(plan.items.every((i) => i.action !== 'CONFLICT')).toBe(true);
    expect(snapshot(d)).toEqual(before);
  });

  it('apply completes the integration automatically, appends only, and exits 0', async () => {
    const d = await oldInstance();
    const before = snapshot(d);
    const logs = quiet();
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(logs.join('\n')).toContain('COMPLETE');
    const after = snapshot(d);
    for (const f of ['CLAUDE.md', 'AGENTS.md', INDEX, ROUTING]) {
      expect(after[f].startsWith(before[f])).toBe(true); // every old byte kept in place
      expect(inspectBlock(after[f], f === INDEX ? 'index-idea' : f === ROUTING ? 'routing-idea' : 'bootstrap', blockBody(f === INDEX ? 'index-idea' : f === ROUTING ? 'routing-idea' : 'bootstrap', '.monolith')).state).toBe('pristine');
    }
    const changed = Object.keys(after).filter((k) => !k.endsWith('/') && before[k] !== after[k]).sort();
    expect(changed).toEqual([AGENT, 'AGENTS.md', 'CLAUDE.md', INDEX, ROUTING, SKILL].sort());
    expect(integrationComplete(planUpdate(d))).toBe(true);
  });

  it('a second apply changes nothing (idempotent, no duplicate blocks)', async () => {
    const d = await oldInstance();
    quiet();
    await runUpdate(['--apply'], d);
    const before = snapshot(d);
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(snapshot(d)).toEqual(before);
    expect((read(d, 'CLAUDE.md').match(/monolith:begin bootstrap/g) ?? []).length).toBe(1);
  });

  it('keeps the user text of customized files (own rules, own skills in the index, CRLF)', async () => {
    const d = await oldInstance();
    edit(d, 'CLAUDE.md', (t) => t.replace(/\n/g, '\r\n') + '\r\n## My rules\r\nbe nice\r\n');
    edit(d, INDEX, (t) => t.replace('<!-- Add project-specific', '| mine | "do mine" | `x` |\n<!-- Add project-specific'));
    const before = snapshot(d);
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(0);
    for (const f of ['CLAUDE.md', INDEX]) expect(read(d, f).startsWith(before[f])).toBe(true);
    expect(read(d, 'CLAUDE.md')).not.toMatch(/[^\r]\n/);
  });

  it('wires .cursorrules instances (aiTool from config) and AGENTS.md', async () => {
    const d = await oldInstance({ ...CONFIG, aiTool: 'cursor' });
    writeFileSync(join(d, '.cursorrules'), 'my cursor rules\n');
    expect(actions(d)).toMatchObject({ '.cursorrules': 'UPDATE', 'AGENTS.md': 'UPDATE' });
    expect(actions(d)).not.toHaveProperty('CLAUDE.md');
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(read(d, '.cursorrules').startsWith('my cursor rules\n')).toBe(true);
  });

  it('honours a non-default monolithRoot', async () => {
    const d = await oldInstance({ ...CONFIG, monolithRoot: 'ai/mono' });
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(read(d, 'CLAUDE.md')).toContain('`ai/mono/AGENT.md`');
    expect(existsSync(join(d, 'ai/mono/AGENT.md'))).toBe(true);
    expect(existsSync(join(d, '.monolith'))).toBe(false);
  });
});

describe('monolith update — instance from the Idea Capture release (inline text, no AGENT.md)', () => {
  async function inlineInstance(): Promise<string> {
    const d = await oldInstance();
    edit(d, 'CLAUDE.md', (t) => t + '\n## Capturing Ideas\nrun `monolith idea add` per `.monolith/skills/idea-capture/SKILL.md`\n');
    edit(d, INDEX, (t) => t + '\n| idea-capture | "save an idea" | `.monolith/skills/idea-capture/SKILL.md` |\n');
    edit(d, ROUTING, (t) => t + '\n## Table 8 — x\n| `CAPTURE_IDEA` | cli | - | - |\n');
    return d;
  }

  it('leaves already-wired index and routing alone and adds only the entry point', async () => {
    const d = await inlineInstance();
    expect(actions(d)).toMatchObject({ [INDEX]: 'UNCHANGED', [ROUTING]: 'UNCHANGED', 'CLAUDE.md': 'UPDATE', [AGENT]: 'ADD', [SKILL]: 'ADD' });
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(0);
  });

  it('a routing-map with its own Table 8 but no CAPTURE_IDEA is a CONFLICT, not a duplicate heading', async () => {
    const d = await oldInstance();
    edit(d, ROUTING, (t) => t + '\n## Table 8 — my own\n| other | x |\n');
    const item = planUpdate(d).items.find((i) => i.path === ROUTING);
    expect(item?.action).toBe('CONFLICT');
    expect(item?.reason).toContain('Table 8');
  });
});

describe('monolith update — detection robustness', () => {
  it('marker words only in a code fence or a comment do not count as wired', async () => {
    const d = await oldInstance();
    edit(d, ROUTING, (t) => t + '\n```\n| `CAPTURE_IDEA` | example |\n```\n<!-- CAPTURE_IDEA -->\n');
    expect(actions(d)[ROUTING]).toBe('UPDATE');
    edit(d, INDEX, (t) => t + '\n<!-- idea-capture/SKILL.md -->\n');
    expect(actions(d)[INDEX]).toBe('UPDATE');
  });

  it('a managed block quoted inside a fenced example is not mistaken for the real one', async () => {
    const d = await oldInstance();
    const fenced = '```md\n<!-- monolith:begin bootstrap sha256=0123456789abcdef -->\nx\n<!-- monolith:end bootstrap -->\n```\n';
    edit(d, 'CLAUDE.md', (t) => t + '\n' + fenced);
    expect(actions(d)['CLAUDE.md']).toBe('UPDATE');
  });
});

describe('monolith update — conflicts and refresh of managed blocks', () => {
  it('refreshes an unedited block whose text is outdated, in place', async () => {
    const d = await newInstance();
    const oldBlock = renderBlock('bootstrap', 'OLD ENTRY POINT TEXT');
    writeFileSync(join(d, 'CLAUDE.md'), read(d, 'CLAUDE.md').replace(/<!-- monolith:begin bootstrap[\s\S]*?<!-- monolith:end bootstrap -->\n/, oldBlock));
    expect(actions(d)['CLAUDE.md']).toBe('UPDATE');
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(read(d, 'CLAUDE.md')).not.toContain('OLD ENTRY POINT TEXT');
    expect(read(d, 'CLAUDE.md')).toContain('`.monolith/AGENT.md`');
  });

  it('a user edit inside a managed block is a CONFLICT: kept, never overwritten, exit 2', async () => {
    const d = await newInstance();
    edit(d, 'CLAUDE.md', (t) => t.replace('This project uses MONOLITH.', 'This project uses MONOLITH (my tweak).'));
    const mine = read(d, 'CLAUDE.md');
    expect(mine).toContain('my tweak');
    expect(actions(d)['CLAUDE.md']).toBe('CONFLICT');
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(2);
    expect(read(d, 'CLAUDE.md')).toBe(mine);
  });

  it('an edited AGENT.md block is a CONFLICT and an own AGENT.md without markers is not taken over', async () => {
    const d = await newInstance();
    edit(d, AGENT, (t) => t.replace('Do not guess', 'Please guess'));
    expect(actions(d)[AGENT]).toBe('CONFLICT');
    rmSync(join(d, AGENT));
    writeFileSync(join(d, AGENT), 'my own agent notes\n');
    expect(actions(d)[AGENT]).toBe('CONFLICT');
    quiet();
    await runUpdate(['--apply'], d);
    expect(read(d, AGENT)).toBe('my own agent notes\n');
  });

  it('text the user added outside an AGENT.md block survives a refresh', async () => {
    const d = await newInstance();
    writeFileSync(join(d, AGENT), 'my notes above\n\n' + read(d, AGENT) + '\nmy notes below\n');
    expect(actions(d)[AGENT]).toBe('UNCHANGED');
  });

  it('malformed or duplicated markers are a CONFLICT with nothing written', async () => {
    const d = await oldInstance();
    edit(d, 'CLAUDE.md', (t) => t + '\n<!-- monolith:begin bootstrap sha256=0123456789abcdef -->\nhalf a block\n');
    expect(actions(d)['CLAUDE.md']).toBe('CONFLICT');
    quiet();
    const before = read(d, 'CLAUDE.md');
    expect(await runUpdate(['--apply'], d)).toBe(2);
    expect(read(d, 'CLAUDE.md')).toBe(before);
  });
});

describe('monolith update — partial apply and recovery', () => {
  it('an apply that stops half-way is not COMPLETE, and a re-run finishes it', async () => {
    const d = await oldInstance();
    quiet();
    const first = planUpdate(d);
    // Simulate an interruption after the MONOLITH-owned files: only the skill and AGENT.md exist.
    applyPlan(d, { ...first, items: first.items.filter((i) => i.path === SKILL || i.path === AGENT) });
    const mid = planUpdate(d);
    expect(integrationComplete(mid)).toBe(false);
    expect(mid.chain.find((c) => c.link === 'instructions → AGENT.md')?.ok).toBe(false);
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(integrationComplete(planUpdate(d))).toBe(true);
  });

  it('a conflict leaves the integration INCOMPLETE; resolving it by hand and re-running completes it', async () => {
    const d = await oldInstance();
    edit(d, ROUTING, (t) => t + '\n## Table 8 — mine\n');
    const logs = quiet();
    expect(await runUpdate(['--apply'], d)).toBe(2);
    expect(logs.join('\n')).toContain('INCOMPLETE');
    expect(logs.join('\n')).toContain('Manual fallback for .monolith/context/maps/routing-map.md');
    edit(d, ROUTING, (t) => t.replace('## Table 8 — mine', '## Table 8 — mine\n| `CAPTURE_IDEA` | monolith idea add |'));
    expect(await runUpdate(['--apply'], d)).toBe(0);
  });

  it('a stale plan is never applied over a file that changed meanwhile', async () => {
    const d = await oldInstance();
    const stale = planUpdate(d);
    edit(d, 'CLAUDE.md', (t) => t + '\nadded after the preview\n');
    const mine = read(d, 'CLAUDE.md');
    const r = applyPlan(d, stale);
    expect(r.stale).toContain('CLAUDE.md');
    expect(read(d, 'CLAUDE.md')).toBe(mine);
  });

  it('a stale ADD whose target appeared meanwhile is skipped, never overwritten', async () => {
    const d = await oldInstance();
    const stale = planUpdate(d);
    mkdirSync(join(d, '.monolith/skills/idea-capture'), { recursive: true });
    writeFileSync(join(d, SKILL), 'written by someone else\n');
    expect(applyPlan(d, stale).created).not.toContain(SKILL);
    expect(read(d, SKILL)).toBe('written by someone else\n');
  });

  it('two runs from the same preview end in the same state, with no duplicate block', async () => {
    const d = await oldInstance();
    const plan = planUpdate(d);
    applyPlan(d, plan);
    const once = snapshot(d);
    const second = applyPlan(d, plan); // the same (now stale) plan again
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(snapshot(d)).toEqual(once);
  });
});

describe('monolith update — consistency chain', () => {
  it('is not COMPLETE when a customized skill no longer calls the CLI', async () => {
    const d = await newInstance();
    writeFileSync(join(d, SKILL), '# my idea skill\nwrite ideas into TODO.md\n');
    const plan = planUpdate(d);
    expect(plan.items.find((i) => i.path === SKILL)?.action).toBe('SKIP');
    expect(plan.chain.find((c) => c.link === 'skill → CLI')?.ok).toBe(false);
    expect(integrationComplete(plan)).toBe(false);
  });

  it('is not COMPLETE when the ideas store is a symlink', async () => {
    const d = await newInstance();
    const outside = tmp();
    mkdirSync(join(d, '.monolith/memory/long-term'), { recursive: true });
    rmSync(join(d, '.monolith/memory/long-term/ideas'), { recursive: true, force: true });
    symlinkSync(outside, join(d, '.monolith/memory/long-term/ideas'));
    expect(planUpdate(d).chain.find((c) => c.link === 'CLI → storage')?.ok).toBe(false);
  });

  it('Idea Capture works end to end after an update (CLI add, then list)', async () => {
    const d = await oldInstance();
    quiet();
    await runUpdate(['--apply'], d);
    const { runIdeaAdd, runIdeaList } = await import('../ideas/cli.js');
    const { Readable } = await import('stream');
    await runIdeaAdd(['--title', 'T', '--description', 'D'], d, Readable.from([]) as never);
    expect(readdirSync(join(d, '.monolith/memory/long-term/ideas')).some((f) => /^IDEA-001/.test(f))).toBe(true);
    await expect(runIdeaList([], d)).resolves.toBeUndefined();
  });
});

describe('monolith update — user data protection', () => {
  it('never touches memory, state, ideas, id reservations or a customized skill', async () => {
    const d = await oldInstance();
    mkdirSync(join(d, '.monolith/memory/long-term/ideas/.ids'), { recursive: true });
    writeFileSync(join(d, '.monolith/memory/long-term/ideas/IDEA-001.md'), 'mine\n');
    writeFileSync(join(d, '.monolith/memory/long-term/ideas/.ids/IDEA-001'), 'x');
    writeFileSync(join(d, '.monolith/memory/working/active.md'), 'my story\n');
    writeFileSync(join(d, '.monolith/memory/long-term/decisions.md'), 'my decisions\n');
    mkdirSync(join(d, '.monolith/skills/idea-capture'), { recursive: true });
    writeFileSync(join(d, SKILL), 'my own idea skill\n');
    const before = snapshot(d);
    quiet();
    await runUpdate(['--apply'], d);
    const after = snapshot(d);
    for (const k of Object.keys(before)) {
      if (['CLAUDE.md', 'AGENTS.md', INDEX, ROUTING].includes(k)) continue;
      expect(after[k]).toBe(before[k]);
    }
    expect(actions(d)[SKILL]).toBe('SKIP');
  });

  it('a missing user-owned file is a CONFLICT, not recreated', async () => {
    const d = await oldInstance();
    rmSync(join(d, 'AGENTS.md'));
    expect(actions(d)['AGENTS.md']).toBe('CONFLICT');
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(2);
    expect(existsSync(join(d, 'AGENTS.md'))).toBe(false);
  });

  it('keeps file permissions of an updated file', async () => {
    const d = await oldInstance();
    const { chmodSync, statSync } = await import('fs');
    chmodSync(join(d, 'CLAUDE.md'), 0o640);
    quiet();
    await runUpdate(['--apply'], d);
    expect(statSync(join(d, 'CLAUDE.md')).mode & 0o777).toBe(0o640);
  });
});

describe('monolith update — security', () => {
  it('refuses a symlinked skills directory (writes nothing through it)', async () => {
    const d = await oldInstance();
    const outside = tmp();
    rmSync(join(d, '.monolith/skills'), { recursive: true });
    symlinkSync(outside, join(d, '.monolith/skills'));
    expect(actions(d)[SKILL]).toBe('CONFLICT');
    expect(actions(d)[INDEX]).toBe('CONFLICT');
    quiet();
    await runUpdate(['--apply'], d);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses a symlinked skill file and does not read or replace it', async () => {
    const d = await oldInstance();
    const outside = tmp();
    writeFileSync(join(outside, 'x.md'), 'secret\n');
    mkdirSync(join(d, '.monolith/skills/idea-capture'), { recursive: true });
    symlinkSync(join(outside, 'x.md'), join(d, SKILL));
    expect(actions(d)[SKILL]).toBe('CONFLICT');
    quiet();
    await runUpdate(['--apply'], d);
    expect(readFileSync(join(outside, 'x.md'), 'utf8')).toBe('secret\n');
    expect(lstatSync(join(d, SKILL)).isSymbolicLink()).toBe(true);
  });

  it('refuses a hardlinked skill file and a hardlinked CLAUDE.md (never rewrites the other name)', async () => {
    const d = await oldInstance();
    const outside = tmp();
    writeFileSync(join(outside, 'x.md'), 'secret\n');
    mkdirSync(join(d, '.monolith/skills/idea-capture'), { recursive: true });
    linkSync(join(outside, 'x.md'), join(d, SKILL));
    writeFileSync(join(outside, 'c.md'), '# claude\n');
    rmSync(join(d, 'CLAUDE.md'));
    linkSync(join(outside, 'c.md'), join(d, 'CLAUDE.md'));
    expect(actions(d)[SKILL]).toBe('CONFLICT');
    expect(actions(d)['CLAUDE.md']).toBe('CONFLICT');
    quiet();
    await runUpdate(['--apply'], d);
    expect(readFileSync(join(outside, 'c.md'), 'utf8')).toBe('# claude\n');
  });

  it('refuses symlinked CLAUDE.md / AGENTS.md without reading or replacing through them', async () => {
    const d = await oldInstance();
    const outside = tmp();
    writeFileSync(join(outside, 'c.md'), 'idea-capture/SKILL.md monolith idea add\n');
    for (const f of ['CLAUDE.md', 'AGENTS.md']) {
      rmSync(join(d, f));
      symlinkSync(join(outside, 'c.md'), join(d, f));
      expect(actions(d)[f]).toBe('CONFLICT');
    }
    quiet();
    await runUpdate(['--apply'], d);
    expect(readFileSync(join(outside, 'c.md'), 'utf8')).toBe('idea-capture/SKILL.md monolith idea add\n');
  });

  it('rejects a monolithRoot that escapes the project, and an unusable config', async () => {
    const d = await oldInstance();
    writeFileSync(join(d, 'monolith.config.json'), JSON.stringify({ monolithRoot: '../evil' }));
    expect(() => planUpdate(d)).toThrow(/ROOT_/);
    writeFileSync(join(d, 'monolith.config.json'), '{ not json');
    expect(() => planUpdate(d)).toThrow(/ROOT_CONFIG_INVALID/);
  });

  it('refuses a directory that is not an instance (no init-by-update)', () => {
    const d = tmp();
    expect(() => planUpdate(d)).toThrow(/Not a MONOLITH instance/);
    expect(readdirSync(d)).toEqual([]);
  });

  it('surfaces a write failure as an error and leaves the user file untouched', async () => {
    if (process.getuid?.() === 0) return; // root ignores modes
    const d = await oldInstance();
    const plan = planUpdate(d);
    const { chmodSync } = await import('fs');
    chmodSync(join(d, '.monolith/skills'), 0o500);
    const claude = read(d, 'CLAUDE.md');
    try {
      expect(() => applyPlan(d, plan)).toThrow();
      expect(existsSync(join(d, SKILL))).toBe(false);
      expect(read(d, 'CLAUDE.md')).toBe(claude); // the pointer is written last, never before the target exists
    } finally {
      chmodSync(join(d, '.monolith/skills'), 0o700);
    }
  });

  it('leaves no temp files behind after a successful apply', async () => {
    const d = await oldInstance();
    quiet();
    await runUpdate(['--apply'], d);
    const leftovers = Object.keys(snapshot(d)).filter((k) => /\.tmp\./.test(k));
    expect(leftovers).toEqual([]);
  });
});

describe('monolith update — CLI surface', () => {
  it('accepts a relative project directory', async () => {
    const d = await oldInstance();
    const rel = relative(process.cwd(), d);
    expect(planUpdate(rel).items.find((i) => i.path === SKILL)?.action).toBe('ADD');
    expect(applyPlan(rel, planUpdate(rel)).created).toContain(SKILL);
  });

  it('rejects unknown arguments', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runUpdate(['--force'], tmp())).toBe(1);
    expect(await runUpdate(['--apply', 'x'], tmp())).toBe(1);
  });

  it('preview exits 0, writes nothing, explains safety and effects, and says how to proceed', async () => {
    const d = await oldInstance();
    const before = snapshot(d);
    const logs = quiet();
    expect(await runUpdate([], d)).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('preview (nothing is written)');
    expect(out).toContain('Why this is safe');
    expect(out).toContain('After --apply');
    expect(out).toContain('INCOMPLETE');
    expect(out).toContain('monolith update --apply');
    expect(snapshot(d)).toEqual(before);
  });

  it('help text states the limits', () => {
    expect(UPDATE_USAGE).toContain('--apply');
    expect(UPDATE_USAGE).toContain('managed blocks');
    expect(UPDATE_USAGE).toContain('never overwritten');
  });
});
