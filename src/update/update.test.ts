import { afterEach, describe, expect, it, vi } from 'vitest';
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, lstatSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { scaffoldInstance } from '../init/scaffold.js';
import type { ProjectConfig } from '../init/types.js';
import { applyPlan, integrationComplete, planUpdate } from './index.js';
import { inspectBlock, blockBody, renderBlock } from '../managed/index.js';
import { runUpdate, UPDATE_USAGE } from './cli.js';
import { FINALIZE_STORY_CURRENT, FINALIZE_STORY_LEGACY } from './legacy-skills.js';
import { createHash } from 'crypto';
import { TEMPLATES_ROOT } from '../init/scaffold.js';

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
    edit(d, ROUTING, (t) => t + '\n## Table 8 — x\n| `CAPTURE_IDEA` | The MONOLITH CLI only: `monolith idea add --title "..."` | - | - |\n');
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

// DX-UPDATE-005 -------------------------------------------------------------

const bytes = (d: string, rel: string): Buffer => readFileSync(join(d, rel));

describe('monolith update — F-1 strict UTF-8 (files stay byte-identical)', () => {
  const utf16le = (s: string): Buffer => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
  const utf16be = (s: string): Buffer => {
    const le = Buffer.from(s, 'utf16le');
    for (let i = 0; i < le.length; i += 2) [le[i], le[i + 1]] = [le[i + 1], le[i]];
    return Buffer.concat([Buffer.from([0xfe, 0xff]), le]);
  };
  const unsupported: Record<string, Buffer> = {
    cp1251: Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x0a]),
    'utf-16 le': utf16le('# Привіт\n'),
    'utf-16 be': utf16be('# Привіт\n'),
    'utf-16 without BOM': Buffer.from('# Hi\n', 'utf16le'),
    'invalid sequence': Buffer.concat([Buffer.from('# ok\n'), Buffer.from([0xc3, 0x28, 0xff, 0xfe]), Buffer.from('\n')]),
    truncated: Buffer.concat([Buffer.from('# ok\n'), Buffer.from([0xd0])]),
  };

  for (const [name, content] of Object.entries(unsupported)) {
    it(`${name}: CONFLICT in preview and apply, file byte-identical, nothing else touched`, async () => {
      const d = await oldInstance();
      writeFileSync(join(d, 'CLAUDE.md'), content);
      const before = snapshot(d);
      expect(planUpdate(d).items.find((i) => i.path === 'CLAUDE.md')?.action).toBe('CONFLICT');
      expect(Buffer.compare(bytes(d, 'CLAUDE.md'), content)).toBe(0);
      quiet();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await runUpdate(['--apply'], d)).toBe(2);
      expect(Buffer.compare(bytes(d, 'CLAUDE.md'), content)).toBe(0);
      const after = snapshot(d);
      delete after['CLAUDE.md'];
      delete before['CLAUDE.md'];
      // Only MONOLITH-owned / other files may differ; CLAUDE.md is the one under test.
      expect(after['.monolith/memory/working/active.md']).toBe(before['.monolith/memory/working/active.md']);
    });
  }

  it('a non-UTF-8 AGENTS.md is refused while a valid CLAUDE.md is still updated', async () => {
    const d = await oldInstance();
    const cp = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    writeFileSync(join(d, 'AGENTS.md'), cp);
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(2);
    expect(Buffer.compare(bytes(d, 'AGENTS.md'), cp)).toBe(0);
    expect(read(d, 'CLAUDE.md')).toContain('monolith:begin bootstrap');
  });

  const supported: Record<string, Buffer> = {
    'Russian and Ukrainian': Buffer.from('# Правила\nЄдиний стандарт: їжак, ґанок, ёлка.\n', 'utf8'),
    'UTF-8 BOM': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Rules\n')]),
    'mixed Unicode': Buffer.from('# 日本語 ✓ 😀 é\n', 'utf8'),
    'no final newline': Buffer.from('# Rules\nlast line', 'utf8'),
    CRLF: Buffer.from('# Rules\r\nbe nice\r\n', 'utf8'),
  };
  for (const [name, content] of Object.entries(supported)) {
    it(`${name}: updated by appending only; original bytes stay a prefix; re-apply changes nothing`, async () => {
      const d = await oldInstance();
      writeFileSync(join(d, 'CLAUDE.md'), content);
      expect(planUpdate(d).items.find((i) => i.path === 'CLAUDE.md')?.action).toBe('UPDATE');
      quiet();
      expect(await runUpdate(['--apply'], d)).toBe(0);
      const once = bytes(d, 'CLAUDE.md');
      expect(once.subarray(0, content.length).equals(content)).toBe(true);
      expect(once.length).toBeGreaterThan(content.length);
      if (name === 'CRLF') expect(once.toString('utf8')).not.toMatch(/[^\r]\n/);
      expect(await runUpdate(['--apply'], d)).toBe(0);
      expect(bytes(d, 'CLAUDE.md').equals(once)).toBe(true);
    });
  }

  it('an edited managed block in a non-UTF-8 file is not refreshed either', async () => {
    const d = await newInstance();
    const orig = bytes(d, 'CLAUDE.md');
    const bad = Buffer.concat([orig, Buffer.from([0xcf, 0xf0])]);
    writeFileSync(join(d, 'CLAUDE.md'), bad);
    expect(planUpdate(d).items.find((i) => i.path === 'CLAUDE.md')?.action).toBe('CONFLICT');
  });
});

describe('monolith update — F-2 managed block idempotency with fences', () => {
  const OPEN = ['```\nunclosed code\n', '~~~\nunclosed tilde\n', '````md\nfour ticks, closed by only three:\n```\n', '~~~~\nfour tildes\n~~~\n', '```js\nopen with info\n'];
  for (const tail of OPEN) {
    it(`unclosed fence at the end (${JSON.stringify(tail.slice(0, 12))}): CONFLICT, bytes unchanged, no block accumulates`, async () => {
      const d = await oldInstance();
      edit(d, 'CLAUDE.md', (t) => t + '\n' + tail);
      const before = bytes(d, 'CLAUDE.md');
      quiet();
      for (let i = 0; i < 4; i++) {
        expect(planUpdate(d).items.find((x) => x.path === 'CLAUDE.md')?.action).toBe('CONFLICT');
        expect(await runUpdate(['--apply'], d)).toBe(2);
        expect(bytes(d, 'CLAUDE.md').equals(before)).toBe(true);
      }
      expect(read(d, 'CLAUDE.md')).not.toContain('monolith:begin bootstrap');
    });
  }

  it('an unclosed fence before an existing managed block hides it: CONFLICT, nothing appended', async () => {
    const d = await newInstance();
    edit(d, 'CLAUDE.md', (t) => '```\nopen\n' + t);
    const before = bytes(d, 'CLAUDE.md');
    expect(planUpdate(d).items.find((x) => x.path === 'CLAUDE.md')?.action).toBe('CONFLICT');
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(2);
    expect(bytes(d, 'CLAUDE.md').equals(before)).toBe(true);
  });

  it('properly closed fences (any length, either character) allow insertion, idempotently, 5 runs', async () => {
    const d = await oldInstance();
    edit(d, 'CLAUDE.md', (t) => t + '\n```ts\ncode\n```\n\n~~~\nx\n~~~~~\n\n`````\nlong\n``````\n');
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(0);
    const once = bytes(d, 'CLAUDE.md');
    for (let i = 0; i < 4; i++) {
      expect(await runUpdate(['--apply'], d)).toBe(0);
      expect(bytes(d, 'CLAUDE.md').equals(once)).toBe(true);
    }
    expect((once.toString('utf8').match(/monolith:begin bootstrap/g) ?? []).length).toBe(1);
  });

  it('managed markers shown inside fenced code are examples; the real block is still appended once', async () => {
    const d = await oldInstance();
    const ex = '```md\n<!-- monolith:begin bootstrap sha256=0123456789abcdef -->\nx\n<!-- monolith:end bootstrap -->\n```\n';
    edit(d, 'CLAUDE.md', (t) => t + '\n' + ex);
    quiet();
    for (let i = 0; i < 3; i++) expect(await runUpdate(['--apply'], d)).toBe(0);
    const text = read(d, 'CLAUDE.md');
    expect(text.startsWith(read(d, 'CLAUDE.md').slice(0, 10))).toBe(true);
    expect(inspectBlock(text, 'bootstrap', blockBody('bootstrap', '.monolith')).state).toBe('pristine');
    expect((text.match(/monolith:end bootstrap/g) ?? []).length).toBe(2);
  });

  it('an existing pristine block followed by an unclosed fence is still recognised', async () => {
    const d = await newInstance();
    edit(d, 'CLAUDE.md', (t) => t + '\n```\ntrailing open fence\n');
    const text = read(d, 'CLAUDE.md');
    const body = blockBody('bootstrap', '.monolith');
    const st = inspectBlock(text, 'bootstrap', body);
    expect(st.state).toBe('pristine');
  });

  it('a fence line with trailing text does not close a fence, and an inline ``` run does not open one', async () => {
    const d = await oldInstance();
    // "``` x" cannot close; so the fence stays open to the end of file -> CONFLICT.
    edit(d, 'CLAUDE.md', (t) => t + '\n```\ncode\n``` not a closer\n');
    expect(planUpdate(d).items.find((x) => x.path === 'CLAUDE.md')?.action).toBe('CONFLICT');
    const e = await oldInstance();
    edit(e, 'CLAUDE.md', (t) => t + '\nuse ```inline``` here\n');
    expect(planUpdate(e).items.find((x) => x.path === 'CLAUDE.md')?.action).toBe('UPDATE');
  });
});

describe('monolith update — F-3 legacy detection is not a mere mention', () => {
  it('a routing-map that only mentions CAPTURE_IDEA does not count as routed', async () => {
    const d = await oldInstance();
    edit(d, ROUTING, (t) => t.replace(/\s*$/, '\n') + '\nNote: CAPTURE_IDEA means write to TODO.md\n');
    expect(actions(d)[ROUTING]).not.toBe('UNCHANGED');
  });

  it('the historic Table 8 row (unescaped pipe) and skills-index row are still recognised', async () => {
    const d = await oldInstance();
    edit(d, ROUTING, (t) => t.replace(/\s*$/, '\n') + '\n| `CAPTURE_IDEA`   | The MONOLITH CLI only: `monolith idea add --title "..." (--description "..." | --description-stdin)`, stores x | s | i |\n');
    edit(d, INDEX, (t) => t.replace('<!-- Add project-specific', '| idea-capture     | "save an idea" | `.monolith/skills/idea-capture/SKILL.md` |\n<!-- Add project-specific'));
    expect(actions(d)[ROUTING]).toBe('UNCHANGED');
    expect(actions(d)[INDEX]).toBe('UNCHANGED');
  });

  it('a mention of the skill path in prose is not an index entry', async () => {
    const d = await oldInstance();
    edit(d, INDEX, (t) => t + '\nDo not use idea-capture/SKILL.md.\n');
    expect(actions(d)[INDEX]).not.toBe('UNCHANGED');
  });

  it('COMPLETE is worded as a structural statement', async () => {
    const d = await newInstance();
    const logs = quiet();
    await runUpdate([], d);
    expect(logs.join('\n')).toContain('structural check');
  });
});

describe('monolith update — F-4 help and F-6 template', () => {
  it('update --help states preview, managed sections, preserved text and conflicts', () => {
    expect(UPDATE_USAGE).toMatch(/Preview: shows the plan, writes nothing/);
    expect(UPDATE_USAGE).toContain('refreshes');
    expect(UPDATE_USAGE).toContain('valid UTF-8');
    expect(UPDATE_USAGE).toContain('fence');
  });

  it('the Table 8 CAPTURE_IDEA row written by the current template escapes the pipe', () => {
    const body = blockBody('routing-idea', '.monolith');
    const row = body.split('\n').find((l) => l.startsWith('| `CAPTURE_IDEA`')) as string;
    expect(row).toContain('\\|');
    // 4 columns = 5 unescaped pipes
    expect(row.replace(/\\\|/g, '').match(/\|/g)?.length).toBe(5);
  });
});

// ---- DOGFOOD-002: finalize-story skill/CLI contract drift ----------------------------------

const FIN = '.monolith/skills/finalize-story/SKILL.md';
const fixture = (n: string): string => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const shaOf = (s: string): string => createHash('sha256').update(s).digest('hex');
const TEMPLATE_FIN = readFileSync(join(TEMPLATES_ROOT, 'monolith/skills/finalize-story/SKILL.md'), 'utf8');

describe('monolith update — DOGFOOD-002 finalize-story skill', () => {
  it('a new instance carries the current skill, which forbids manual finalization and states the flow', async () => {
    const d = await newInstance();
    expect(read(d, FIN)).toBe(TEMPLATE_FIN);
    expect(actions(d)[FIN]).toBe('UNCHANGED');
    expect(TEMPLATE_FIN).toContain('Do not finalize by hand');
    expect(TEMPLATE_FIN).toContain('monolith finalize plan');
    expect(TEMPLATE_FIN).toContain('monolith finalize apply');
    expect(TEMPLATE_FIN).toContain('Owner Approval');
    expect(TEMPLATE_FIN).toMatch(/not a technical\s+barrier/);
    expect(planUpdate(d).chain.find((c) => c.link === 'finalize skill → CLI')?.ok).toBe(true);
  });

  it('the hash list knows the released alpha.0/alpha.1 and alpha.2 templates, and not the current one', () => {
    expect(FINALIZE_STORY_LEGACY[shaOf(fixture('finalize-story.alpha1.md'))]).toBeDefined();
    expect(FINALIZE_STORY_LEGACY[shaOf(fixture('finalize-story.alpha2.md'))]).toBeDefined();
    expect(FINALIZE_STORY_LEGACY[shaOf(TEMPLATE_FIN)]).toBeUndefined();
  });

  it.each(['finalize-story.alpha1.md', 'finalize-story.alpha2.md'])('detects the unedited legacy skill %s, previews without writing, then updates only that file', async (name) => {
    const d = await newInstance();
    writeFileSync(join(d, FIN), fixture(name));
    mkdirSync(join(d, '.monolith/memory/long-term/ideas'), { recursive: true });
    writeFileSync(join(d, '.monolith/memory/working/active.md'), 'my story\n');
    const before = snapshot(d);
    const plan = planUpdate(d);
    const item = plan.items.find((i) => i.path === FIN);
    expect(item?.action).toBe('UPDATE');
    expect(integrationComplete(plan)).toBe(false);
    expect(plan.chain.find((c) => c.link === 'finalize skill → CLI')?.ok).toBe(false);
    expect(snapshot(d)).toEqual(before); // preview wrote nothing

    const logs = quiet();
    expect(await runUpdate(['--apply'], d)).toBe(0);
    const after = snapshot(d);
    expect(after[FIN]).toBe(TEMPLATE_FIN);
    for (const k of Object.keys(before)) if (k !== FIN) expect(after[k]).toBe(before[k]); // nothing else changed
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(logs.join('\n')).toContain('COMPLETE');

    // idempotent
    const once = snapshot(d);
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(snapshot(d)).toEqual(once);
    expect(actions(d)[FIN]).toBe('UNCHANGED');
  });

  it('a legacy skill with one byte of user change is a CONFLICT and is kept', async () => {
    const d = await newInstance();
    const mine = fixture('finalize-story.alpha1.md') + '\nMy rule: always finalize by editing active.md directly.\n';
    writeFileSync(join(d, FIN), mine);
    const plan = planUpdate(d);
    const item = plan.items.find((i) => i.path === FIN);
    expect(item?.action).toBe('CONFLICT');
    expect(item?.reason).toMatch(/finalize by hand/);
    expect(item?.proposal).toContain('Deterministic Execution');
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(2);
    expect(read(d, FIN)).toBe(mine);
  });

  it('mentions of the contract only inside a code fence or comment do not count', async () => {
    const d = await newInstance();
    writeFileSync(join(d, FIN), '# mine\nedit active.md by hand\n```\nmonolith finalize plan\nmonolith finalize apply\n```\n<!-- monolith finalize plan monolith finalize apply -->\n');
    expect(actions(d)[FIN]).toBe('CONFLICT');
  });

  it('a missing skill is added from the template', async () => {
    const d = await newInstance();
    rmSync(join(d, '.monolith/skills/finalize-story'), { recursive: true });
    expect(actions(d)[FIN]).toBe('ADD');
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(read(d, FIN)).toBe(TEMPLATE_FIN);
  });

  it('a symlinked skill file is a CONFLICT, never read or replaced through the link', async () => {
    const d = await newInstance();
    const outside = tmp();
    writeFileSync(join(outside, 'x.md'), fixture('finalize-story.alpha1.md'));
    rmSync(join(d, FIN));
    symlinkSync(join(outside, 'x.md'), join(d, FIN));
    expect(actions(d)[FIN]).toBe('CONFLICT');
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(2);
    expect(readFileSync(join(outside, 'x.md'), 'utf8')).toBe(fixture('finalize-story.alpha1.md'));
    expect(lstatSync(join(d, FIN)).isSymbolicLink()).toBe(true);
  });

  it('a hardlinked legacy skill is a CONFLICT: the other name is never rewritten', async () => {
    const d = await newInstance();
    const outside = tmp();
    writeFileSync(join(outside, 'x.md'), fixture('finalize-story.alpha1.md'));
    rmSync(join(d, FIN));
    linkSync(join(outside, 'x.md'), join(d, FIN));
    expect(actions(d)[FIN]).toBe('CONFLICT');
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(2);
    expect(readFileSync(join(outside, 'x.md'), 'utf8')).toBe(fixture('finalize-story.alpha1.md'));
    expect(read(d, FIN)).toBe(fixture('finalize-story.alpha1.md'));
  });

  it('a non-UTF-8 skill is a CONFLICT and untouched', async () => {
    const d = await newInstance();
    const bytes = Buffer.from([0xff, 0xfe, 0x41, 0x00]);
    writeFileSync(join(d, FIN), bytes);
    expect(actions(d)[FIN]).toBe('CONFLICT');
    quiet();
    await runUpdate(['--apply'], d);
    expect(readFileSync(join(d, FIN)).equals(bytes)).toBe(true);
  });

  it('a skill edited between preview and apply is reported stale and kept', async () => {
    const d = await newInstance();
    writeFileSync(join(d, FIN), fixture('finalize-story.alpha1.md'));
    const plan = planUpdate(d);
    const edited = fixture('finalize-story.alpha1.md') + '\nedited meanwhile\n';
    writeFileSync(join(d, FIN), edited);
    const r = applyPlan(d, plan);
    expect(r.stale).toContain(FIN);
    expect(read(d, FIN)).toBe(edited);
  });

  it('an old (alpha.0) instance gets the current finalize skill together with Idea Capture', async () => {
    const d = await oldInstance();
    writeFileSync(join(d, FIN), fixture('finalize-story.alpha1.md'));
    quiet();
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(read(d, FIN)).toBe(TEMPLATE_FIN);
    expect(integrationComplete(planUpdate(d))).toBe(true);
  });
});

describe('monolith update — DOGFOOD-005 unverified finalize-story compatibility is never COMPLETE', () => {
  const MENTIONS = '# my finalize\nRun `monolith finalize plan`, ask me, then `monolith finalize apply`.\n';
  const UNSAFE = MENTIONS + 'If the CLI fails, finalize documents manually.\n';
  const COMPLETE_LINE = /Agent integration: COMPLETE/;
  const INCOMPLETE_LINE = /Agent integration: INCOMPLETE/;

  /** Runs the CLI, returns exit code and everything it printed. */
  async function run(d: string, args: string[]): Promise<{ code: number; out: string }> {
    const logs = quiet();
    const code = await runUpdate(args, d);
    return { code, out: logs.join('\n') };
  }

  it.each([
    ['both commands mentioned', MENTIONS],
    ['both commands plus a manual-finalization fallback (F-1)', UNSAFE],
    ['both commands, correct-looking, long', MENTIONS + '\nOwner approval is required before apply. Never edit active.md by hand.\n'],
  ])('custom skill (%s): CONFLICT, kept byte-identical, never COMPLETE, apply exits 2', async (_n, mine) => {
    const d = await newInstance();
    writeFileSync(join(d, FIN), mine);
    const plan = planUpdate(d);
    const item = plan.items.find((i) => i.path === FIN);
    expect(item?.action).toBe('CONFLICT');
    expect(plan.chain.find((c) => c.link === 'finalize skill → CLI')?.ok).toBe(false);
    expect(integrationComplete(plan)).toBe(false);

    const preview = await run(d, []);
    expect(preview.code).toBe(0); // preview never fails (unchanged policy)
    expect(preview.out).toMatch(INCOMPLETE_LINE);
    expect(preview.out).not.toMatch(COMPLETE_LINE);

    const before = snapshot(d);
    const applied = await run(d, ['--apply']);
    expect(applied.code).toBe(2);
    expect(applied.out).toMatch(INCOMPLETE_LINE);
    expect(applied.out).not.toMatch(COMPLETE_LINE);
    expect(read(d, FIN)).toBe(mine);
    expect(snapshot(d)).toEqual(before); // nothing at all was written
  });

  it('the diagnostic names the skill, says why it is unknown, that the file is unchanged, and what the owner must do', async () => {
    const d = await newInstance();
    writeFileSync(join(d, FIN), UNSAFE);
    const item = planUpdate(d).items.find((i) => i.path === FIN);
    expect(item?.reason).toMatch(/not verified/i);
    expect(item?.reason).toMatch(/not changed/i);
    expect(item?.proposal).toContain('Deterministic Execution');
    const { out } = await run(d, ['--apply']);
    expect(out).toContain(FIN);
    expect(out).toMatch(/not verified/i);
    expect(out).toContain('Deterministic Execution');
  });

  it('a custom skill without the commands stays a CONFLICT', async () => {
    const d = await newInstance();
    writeFileSync(join(d, FIN), '# mine\nedit active.md by hand\n');
    expect(actions(d)[FIN]).toBe('CONFLICT');
  });

  it.each([
    ['CRLF', (t: string) => t.replace(/\n/g, '\r\n')],
    ['UTF-8 BOM', (t: string) => '﻿' + t],
    ['no trailing newline', (t: string) => t.replace(/\n+$/, '')],
    ['user addition', (t: string) => t + '\nMy extra rule.\n'],
  ])('byte variant of the CURRENT template (%s) is not UNCHANGED: CONFLICT, bytes kept, never COMPLETE', async (_n, mutate) => {
    const d = await newInstance();
    const mine = mutate(TEMPLATE_FIN);
    expect(mine).not.toBe(TEMPLATE_FIN);
    writeFileSync(join(d, FIN), mine, 'utf8');
    const plan = planUpdate(d);
    expect(plan.items.find((i) => i.path === FIN)?.action).toBe('CONFLICT');
    expect(integrationComplete(plan)).toBe(false);
    const applied = await run(d, ['--apply']);
    expect(applied.code).toBe(2);
    expect(applied.out).not.toMatch(COMPLETE_LINE);
    expect(readFileSync(join(d, FIN), 'utf8')).toBe(mine);
  });

  it('idea-capture UNCHANGED + finalize-story unverified is INCOMPLETE', async () => {
    const d = await newInstance();
    writeFileSync(join(d, FIN), MENTIONS);
    expect(actions(d)[SKILL]).toBe('UNCHANGED');
    expect(integrationComplete(planUpdate(d))).toBe(false);
    expect((await run(d, ['--apply'])).code).toBe(2);
  });

  it('idea-capture UPDATE/ADD + finalize-story unverified: the idea part is written, the result is honestly INCOMPLETE', async () => {
    const d = await oldInstance();
    writeFileSync(join(d, FIN), MENTIONS);
    const before = snapshot(d);
    const applied = await run(d, ['--apply']);
    expect(applied.code).toBe(2);
    expect(applied.out).toMatch(INCOMPLETE_LINE);
    expect(applied.out).not.toMatch(COMPLETE_LINE);
    expect(applied.out).toContain('Created ');
    const after = snapshot(d);
    expect(after[SKILL]).toBeDefined(); // idea-capture installed (partial write is reported, not hidden)
    expect(after[FIN]).toBe(MENTIONS);
    // every file that existed before and is not an expected UPDATE target is unchanged
    for (const k of Object.keys(before)) if (!/AGENTS\.md$|CLAUDE\.md$|INDEX\.md$|routing-map\.md$/.test(k)) expect(after[k]).toBe(before[k]);
  });

  it('repeated apply on an unverified skill is stable: same bytes, still exit 2', async () => {
    const d = await newInstance();
    writeFileSync(join(d, FIN), UNSAFE);
    expect((await run(d, ['--apply'])).code).toBe(2);
    const once = snapshot(d);
    expect((await run(d, ['--apply'])).code).toBe(2);
    expect(snapshot(d)).toEqual(once);
  });

  it('a stale preview over an unverified skill never writes it', async () => {
    const d = await newInstance();
    writeFileSync(join(d, FIN), MENTIONS);
    const plan = planUpdate(d);
    writeFileSync(join(d, FIN), UNSAFE);
    const r = applyPlan(d, plan);
    expect([...r.created, ...r.updated]).not.toContain(FIN);
    expect(read(d, FIN)).toBe(UNSAFE);
  });

  it('unrelated skills and user files survive an apply next to an unverified finalize-story skill', async () => {
    const d = await newInstance();
    writeFileSync(join(d, FIN), UNSAFE);
    mkdirSync(join(d, '.monolith/skills/mine'), { recursive: true });
    writeFileSync(join(d, '.monolith/skills/mine/SKILL.md'), 'my own skill\n');
    writeFileSync(join(d, 'notes.txt'), 'user notes\n');
    const before = snapshot(d);
    await run(d, ['--apply']);
    expect(snapshot(d)).toEqual(before);
  });

  it('Idea Capture regression: a customized idea-capture skill that calls the CLI is still kept and the instance is COMPLETE', async () => {
    const d = await newInstance();
    const mine = '# my idea skill\nRun `monolith idea add --title ...`.\n';
    writeFileSync(join(d, SKILL), mine);
    expect(actions(d)[SKILL]).toBe('SKIP');
    const applied = await run(d, ['--apply']);
    expect(applied.code).toBe(0);
    expect(applied.out).toMatch(COMPLETE_LINE);
    expect(read(d, SKILL)).toBe(mine);
  });

  it('a known legacy skill is still replaced and the instance is COMPLETE (no regression)', async () => {
    const d = await newInstance();
    writeFileSync(join(d, FIN), fixture('finalize-story.alpha2.md'));
    const applied = await run(d, ['--apply']);
    expect(applied.code).toBe(0);
    expect(applied.out).toMatch(COMPLETE_LINE);
    expect(read(d, FIN)).toBe(TEMPLATE_FIN);
  });

  it('after the owner restores the current template by hand, a re-run is COMPLETE', async () => {
    const d = await newInstance();
    writeFileSync(join(d, FIN), UNSAFE);
    expect((await run(d, ['--apply'])).code).toBe(2);
    writeFileSync(join(d, FIN), TEMPLATE_FIN);
    const again = await run(d, ['--apply']);
    expect(again.code).toBe(0);
    expect(again.out).toMatch(COMPLETE_LINE);
  });

  it('the help text states that a customized finalize-story skill is never reported as verified', () => {
    expect(UPDATE_USAGE).toMatch(/finalize-story/);
    expect(UPDATE_USAGE).toMatch(/not verified|unverified/i);
  });
});

describe('legacy skill registry stays in sync with the templates', () => {
  it('every registered hash is a well-formed sha256 with a label', () => {
    for (const [h, label] of Object.entries(FINALIZE_STORY_LEGACY)) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('the pinned current hash equals the shipped template and is not also registered as legacy', () => {
    // Fails after any edit of the template: move the old hash into FINALIZE_STORY_LEGACY, then update FINALIZE_STORY_CURRENT.
    expect(shaOf(TEMPLATE_FIN)).toBe(FINALIZE_STORY_CURRENT);
    expect(FINALIZE_STORY_LEGACY[FINALIZE_STORY_CURRENT]).toBeUndefined();
  });

  it('released templates (alpha.1, alpha.2 fixtures) are registered with their exact hashes', () => {
    expect(shaOf(fixture('finalize-story.alpha1.md'))).toBe('8d7011640de68df5e4aad3f1ff5ecf421d1f7a3b454f3c51f12079cfea743b8a');
    expect(shaOf(fixture('finalize-story.alpha2.md'))).toBe('31cc69d09ba4996f71b497f1f4454912ab497c1bcd766f4b7b337c34384efd2d');
    for (const n of ['finalize-story.alpha1.md', 'finalize-story.alpha2.md']) expect(FINALIZE_STORY_LEGACY[shaOf(fixture(n))]).toBeDefined();
  });
});
