import { afterEach, describe, expect, it, vi } from 'vitest';
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, lstatSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { scaffoldInstance } from '../init/scaffold.js';
import type { ProjectConfig } from '../init/types.js';
import { applyPlan, integrationComplete, planUpdate } from './index.js';
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

/** An instance as `init` produced it before Idea Capture existed. */
async function oldInstance(cfg: ProjectConfig = CONFIG): Promise<string> {
  const d = await newInstance(cfg);
  const r = cfg.monolithRoot;
  rmSync(join(d, r, 'skills', 'idea-capture'), { recursive: true });
  rmSync(join(d, r, 'memory', 'long-term', 'ideas'), { recursive: true, force: true });
  edit(d, `${r}/skills/INDEX.md`, (s) => s.split('\n').filter((l) => !l.includes('idea-capture')).join('\n'));
  edit(d, `${r}/context/maps/routing-map.md`, (s) => s.slice(0, s.indexOf('## Table 8')).replace(/\s+$/, '\n'));
  edit(d, `${r}/context/maps/semantic-map.md`, (s) => s.split('\n').filter((l) => !/idea/i.test(l)).join('\n'));
  edit(d, 'CLAUDE.md', (s) =>
    s
      .replace(/## Capturing Ideas[\s\S]*?\n---\n\n/, '')
      .split('\n')
      .filter((l) => !l.includes('idea-capture'))
      .join('\n')
      .replace(/\*\*Idea Capture\.\*\*[\s\S]*?\n\n/, ''),
  );
  edit(d, 'AGENTS.md', (s) => s.replace(/## Idea Capture[\s\S]*?\n---\n/, ''));
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

describe('monolith update — new instance', () => {
  it('reports everything in place and writes nothing', async () => {
    const d = await newInstance();
    const before = snapshot(d);
    const plan = planUpdate(d);
    expect(plan.items.filter((i) => i.action === 'ADD' || i.action === 'CONFLICT')).toEqual([]);
    expect(integrationComplete(plan)).toBe(true);
    expect(applyPlan(d, plan).created).toEqual([]);
    expect(snapshot(d)).toEqual(before);
  });
});

describe('monolith update — old instance', () => {
  it('previews ADD for the skill and CONFLICT (with the text to add) for each user-owned file, changing nothing', async () => {
    const d = await oldInstance();
    const before = snapshot(d);
    const plan = planUpdate(d);
    expect(actions(d)).toMatchObject({
      [SKILL]: 'ADD',
      '.monolith/skills/INDEX.md': 'CONFLICT',
      '.monolith/context/maps/routing-map.md': 'CONFLICT',
      'CLAUDE.md': 'CONFLICT',
      'AGENTS.md': 'CONFLICT',
      '.monolith/context/maps/semantic-map.md': 'SKIP',
    });
    expect(integrationComplete(plan)).toBe(false);
    const proposal = (p: string): string => plan.items.find((i) => i.path === p)?.proposal ?? '';
    expect(proposal('.monolith/context/maps/routing-map.md')).toContain('CAPTURE_IDEA');
    expect(proposal('.monolith/skills/INDEX.md')).toContain('idea-capture');
    expect(proposal('CLAUDE.md')).toContain('monolith idea add');
    expect(proposal('CLAUDE.md')).toContain('idea-capture/SKILL.md');
    expect(proposal('AGENTS.md')).toContain('monolith idea add');
    expect(proposal('AGENTS.md')).not.toContain('{{MONOLITH_ROOT}}');
    expect(snapshot(d)).toEqual(before); // preview is read-only
  });

  it('apply creates only the skill and does NOT claim a complete integration', async () => {
    const d = await oldInstance();
    const before = snapshot(d);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => void logs.push(String(m)));
    expect(await runUpdate(['--apply'], d)).toBe(2);
    const after = snapshot(d);
    const changed = Object.keys(after).filter((k) => before[k] !== after[k]);
    expect(changed.filter((k) => !k.endsWith('/'))).toEqual([SKILL]);
    expect(logs.join('\n')).toContain('INCOMPLETE');
    expect(logs.join('\n')).not.toContain('COMPLETE (skill');
  });

  it('is complete once the user pastes the proposals, and a further apply changes nothing', async () => {
    const d = await oldInstance();
    const plan = planUpdate(d);
    applyPlan(d, plan);
    for (const i of plan.items.filter((x) => x.action === 'CONFLICT')) {
      writeFileSync(join(d, i.path), readFileSync(join(d, i.path), 'utf8') + '\n' + i.proposal + '\n');
    }
    expect(integrationComplete(planUpdate(d))).toBe(true);
    const before = snapshot(d);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await runUpdate(['--apply'], d)).toBe(0);
    expect(snapshot(d)).toEqual(before);
  });

  it('works for .cursorrules instances (aiTool from config)', async () => {
    const d = await newInstance({ ...CONFIG, aiTool: 'cursor' });
    edit(d, '.cursorrules', (s) => s.split('\n').filter((l) => !l.includes('idea-capture')).join('\n').replace(/\*\*Idea Capture\.\*\*[\s\S]*?\n\n/, ''));
    expect(actions(d)['.cursorrules']).toBe('CONFLICT');
    expect(actions(d)).not.toHaveProperty('CLAUDE.md');
  });

  it.each([['cursor', '.cursorrules'], ['windsurf', '.windsurfrules']] as const)('proposes complete wiring text for %s', async (aiTool, file) => {
    const d = await newInstance({ ...CONFIG, aiTool });
    edit(d, file, (s) => s.split('\n').filter((l) => !l.includes('idea-capture')).join('\n').replace(/\*\*Idea Capture\.\*\*[\s\S]*?\n\n/, ''));
    const item = planUpdate(d).items.find((i) => i.path === file);
    expect(item?.proposal).toContain('idea-capture/SKILL.md');
    expect(item?.proposal).toContain('monolith idea add');
  });

  it('honours a non-default monolithRoot', async () => {
    const cfg = { ...CONFIG, monolithRoot: 'ai/mono' };
    const d = await oldInstance(cfg);
    expect(planUpdate(d).items.find((i) => i.action === 'ADD')?.path).toBe('ai/mono/skills/idea-capture/SKILL.md');
    expect(await runUpdate(['--apply'], d)).toBe(2);
    expect(existsSync(join(d, 'ai/mono/skills/idea-capture/SKILL.md'))).toBe(true);
    expect(existsSync(join(d, '.monolith'))).toBe(false);
  });
});

describe('monolith update — idempotency and recovery', () => {
  it('a second apply creates nothing and changes nothing', async () => {
    const d = await oldInstance();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runUpdate(['--apply'], d);
    const before = snapshot(d);
    await runUpdate(['--apply'], d);
    expect(snapshot(d)).toEqual(before);
    expect(actions(d)[SKILL]).toBe('UNCHANGED');
  });

  it('recovers after a partial failure: a stale plan whose target appeared meanwhile is skipped, never overwritten', async () => {
    const d = await oldInstance();
    const stale = planUpdate(d);
    mkdirSync(join(d, '.monolith/skills/idea-capture'), { recursive: true });
    writeFileSync(join(d, SKILL), 'written by someone else\n');
    expect(applyPlan(d, stale).created).toEqual([]);
    expect(readFileSync(join(d, SKILL), 'utf8')).toBe('written by someone else\n');
  });

  it('re-running after an interrupted run (leftover empty skills dir) completes the add', async () => {
    const d = await oldInstance();
    mkdirSync(join(d, '.monolith/skills/idea-capture'), { recursive: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runUpdate(['--apply'], d);
    expect(existsSync(join(d, SKILL))).toBe(true);
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
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runUpdate(['--apply'], d);
    expect(snapshot(d)).toEqual(before);
    expect(actions(d)[SKILL]).toBe('SKIP');
  });

  it('does not edit a user-modified CLAUDE.md and does not append to it', async () => {
    const d = await oldInstance();
    edit(d, 'CLAUDE.md', (s) => s + '\n## My own rules\nbe nice\n');
    const claude = readFileSync(join(d, 'CLAUDE.md'), 'utf8');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runUpdate(['--apply'], d);
    expect(readFileSync(join(d, 'CLAUDE.md'), 'utf8')).toBe(claude);
  });

  it('a user file that only mentions ideas is still a CONFLICT (both skill trigger and command are required)', async () => {
    const d = await oldInstance();
    edit(d, 'AGENTS.md', (s) => s + '\nWe like ideas. monolith idea add is handy.\n');
    expect(actions(d)['AGENTS.md']).toBe('CONFLICT');
  });

  it('a missing user-owned file is a CONFLICT, not recreated', async () => {
    const d = await oldInstance();
    rmSync(join(d, 'AGENTS.md'));
    expect(actions(d)['AGENTS.md']).toBe('CONFLICT');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runUpdate(['--apply'], d);
    expect(existsSync(join(d, 'AGENTS.md'))).toBe(false);
  });
});

describe('monolith update — security', () => {
  it('refuses a symlinked skills directory (writes nothing through it)', async () => {
    const d = await oldInstance();
    const outside = tmp();
    rmSync(join(d, '.monolith/skills'), { recursive: true });
    symlinkSync(outside, join(d, '.monolith/skills'));
    expect(actions(d)[SKILL]).toBe('CONFLICT');
    expect(actions(d)['.monolith/skills/INDEX.md']).toBe('CONFLICT');
    vi.spyOn(console, 'log').mockImplementation(() => {});
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
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runUpdate(['--apply'], d);
    expect(readFileSync(join(outside, 'x.md'), 'utf8')).toBe('secret\n');
    expect(lstatSync(join(d, SKILL)).isSymbolicLink()).toBe(true);
  });

  it('refuses a hardlinked skill file', async () => {
    const d = await oldInstance();
    const outside = tmp();
    writeFileSync(join(outside, 'x.md'), 'secret\n');
    mkdirSync(join(d, '.monolith/skills/idea-capture'), { recursive: true });
    linkSync(join(outside, 'x.md'), join(d, SKILL));
    expect(actions(d)[SKILL]).toBe('CONFLICT');
  });

  it('refuses a symlinked CLAUDE.md without reading through it', async () => {
    const d = await oldInstance();
    const outside = tmp();
    writeFileSync(join(outside, 'c.md'), 'idea-capture/SKILL.md monolith idea add\n');
    rmSync(join(d, 'CLAUDE.md'));
    symlinkSync(join(outside, 'c.md'), join(d, 'CLAUDE.md'));
    expect(actions(d)['CLAUDE.md']).toBe('CONFLICT');
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

  it('surfaces a write failure (e.g. ENOSPC/EIO) as an error and leaves nothing half-written', async () => {
    const d = await oldInstance();
    const plan = planUpdate(d);
    // A read-only skills directory stands in for a failing disk: the write must fail loudly.
    const { chmodSync } = await import('fs');
    chmodSync(join(d, '.monolith/skills'), 0o500);
    try {
      if (process.getuid?.() === 0) return; // root ignores modes
      expect(() => applyPlan(d, plan)).toThrow();
      expect(existsSync(join(d, SKILL))).toBe(false);
    } finally {
      chmodSync(join(d, '.monolith/skills'), 0o700);
    }
  });
});

describe('monolith update — CLI surface', () => {
  it('accepts a relative project directory', async () => {
    const d = await oldInstance();
    const rel = relative(process.cwd(), d);
    expect(planUpdate(rel).items.find((i) => i.action === 'ADD')?.path).toBe(SKILL);
    expect(applyPlan(rel, planUpdate(rel)).created).toEqual([SKILL]);
  });

  it('rejects unknown arguments', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runUpdate(['--force'], tmp())).toBe(1);
    expect(await runUpdate(['--apply', 'x'], tmp())).toBe(1);
  });

  it('preview exits 0 even with conflicts and says how to proceed', async () => {
    const d = await oldInstance();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => void logs.push(String(m)));
    expect(await runUpdate([], d)).toBe(0);
    expect(logs.join('\n')).toContain('preview (nothing is written)');
    expect(logs.join('\n')).toContain('INCOMPLETE');
  });

  it('help text states the limits', () => {
    expect(UPDATE_USAGE).toContain('Never');
    expect(UPDATE_USAGE).toContain('--apply');
  });
});
