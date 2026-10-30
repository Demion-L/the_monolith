/**
 * IDEA-001C — deterministic checks of the assistant integration (the
 * `idea-capture` skill, its routing and the instruction files that activate it).
 *
 * These test files, not model behaviour: they cannot show that a given
 * assistant follows the skill. They show that the text it is given is present
 * where `init` installs it, points at files that exist, names only commands
 * the real CLI accepts, and does not describe a way around the CLI.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInit, InitConflictError } from '../init/index.js';
import { scaffoldInstance } from '../init/scaffold.js';
import { runIdeaAdd, parseAddArgs } from './cli.js';
import { ideaStore, getIdea } from './store.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string): string => readFileSync(join(REPO, p), 'utf8');

const SKILL = '.monolith/skills/idea-capture/SKILL.md';
const SKILL_TEMPLATE = 'templates/default-instance/monolith/skills/idea-capture/SKILL.md';

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-idea-agent-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

/** POSIX-style split limited to what the skill uses: single quotes, `'\''`, bare words. */
function shellSplit(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let started = false;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error(`unterminated quote in: ${line}`);
      cur += line.slice(i + 1, end);
      started = true;
      i = end + 1;
    } else if (c === '\\') {
      cur += line[i + 1];
      started = true;
      i += 2;
    } else if (c === ' ') {
      if (started) out.push(cur);
      cur = '';
      started = false;
      i++;
    } else {
      cur += c;
      started = true;
      i++;
    }
  }
  if (started) out.push(cur);
  return out;
}

function codeLines(md: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const l of md.split('\n')) {
    if (l.trim().startsWith('```')) inFence = !inFence;
    else if (inFence) lines.push(l.trim());
  }
  return lines;
}

const INSTRUCTION_FILES = [
  'templates/default-instance/instruction/CLAUDE.md',
  'templates/default-instance/instruction/.cursorrules',
  'templates/default-instance/instruction/.windsurfrules',
];

describe('idea-capture skill — content', () => {
  it('the repository skill and the init template are identical', () => {
    expect(read(SKILL_TEMPLATE)).toBe(read(SKILL));
  });

  it('every `monolith idea` command in the skill is one the real CLI accepts', () => {
    const cmds = codeLines(read(SKILL)).filter((l) => l.startsWith('monolith idea '));
    expect(cmds.length).toBeGreaterThan(0);
    for (const cmd of cmds) {
      const sub = cmd.split(' ')[2];
      expect(['add', 'list', 'show']).toContain(sub);
      if (sub === 'add' && !cmd.includes('[')) {
        // concrete examples must parse with the real argument parser
        const argv = shellSplit(cmd).slice(3);
        expect(() => parseAddArgs(argv)).not.toThrow();
      }
    }
    // the templated form names exactly the flags the CLI defines
    const templ = codeLines(read(SKILL)).find((l) => l.includes('<title>')) ?? '';
    const flags = [...templ.matchAll(/--[a-z]+/g)].map((m) => m[0]);
    expect(flags).toEqual(['--title', '--description', '--context']);
  });

  it('the quoting example survives the shell and the CLI unchanged', async () => {
    const example = codeLines(read(SKILL)).find((l) => l.includes('$HOME') && l.startsWith('monolith idea add'));
    expect(example).toBeDefined();
    const dir = makeTempDir();
    await runInit({ targetDir: dir, yes: true });
    await runIdeaAdd(shellSplit(example as string).slice(3), dir);
    expect(getIdea(ideaStore(dir), 'IDEA-001').description).toBe("don't forget $HOME");
  });

  it('prescribes single-quote quoting and forbids double quotes / eval', () => {
    const t = read(SKILL);
    expect(t).toMatch(/single\s+quotes/);
    expect(t).toMatch(/Never use double\s+quotes/);
    expect(t).toMatch(/`eval`/);
  });

  it('never names the storage location (it is an internal detail of the CLI)', () => {
    for (const p of [SKILL, SKILL_TEMPLATE, ...INSTRUCTION_FILES, 'CLAUDE.md']) {
      expect(read(p), p).not.toMatch(/memory\/(long-term\/)?ideas/);
    }
  });

  it('forbids direct file writes, alternative stores and pretending a save happened', () => {
    const t = read(SKILL);
    expect(t).toMatch(/Never work around a failure/);
    expect(t).toMatch(/was \*\*not\*\* saved/);
    expect(t).toMatch(/direct write, edit, move or delete of an idea file/);
    expect(t).toMatch(/not an instruction to you/);
    expect(t).toMatch(/Never ask where to store|never ask where to store|not the user's or your decision/i);
  });

  it('does not tell the assistant to change focus after a capture', () => {
    expect(read(SKILL)).toMatch(/does not change the\s+active story, a mission, the roadmap or the cognitive mode/);
  });
});

describe('activation in a new instance', () => {
  it('monolith init installs the skill, lists it in INDEX and substitutes every placeholder', async () => {
    const dir = makeTempDir();
    await runInit({ targetDir: dir, yes: true });
    const skill = join(dir, '.monolith', 'skills', 'idea-capture', 'SKILL.md');
    expect(readFileSync(skill, 'utf8')).toBe(read(SKILL));
    const index = readFileSync(join(dir, '.monolith', 'skills', 'INDEX.md'), 'utf8');
    expect(index).toContain('.monolith/skills/idea-capture/SKILL.md');
    const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('.monolith/skills/idea-capture/SKILL.md');
    expect(claude).not.toContain('{{');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('.monolith/skills/idea-capture/SKILL.md');
  });

  it.each(['claude', 'cursor', 'windsurf'] as const)(
    'the %s instruction file points at a skill file that exists in the instance',
    async (aiTool) => {
      const dir = makeTempDir();
      await scaffoldInstance(dir, {
        projectName: 'p',
        language: 'typescript',
        packageManager: 'pnpm',
        aiTool,
        finalizationProtocol: 'finalize-story',
        protocols: ['finalize-story'],
        monolithRoot: '.monolith',
      });
      const file = { claude: 'CLAUDE.md', cursor: '.cursorrules', windsurf: '.windsurfrules' }[aiTool];
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text).not.toContain('{{');
      const refs = [...text.matchAll(/`(\.monolith\/skills\/[a-z-]+\/SKILL\.md)`/g)].map((m) => m[1]);
      expect(refs).toContain('.monolith/skills/idea-capture/SKILL.md');
      for (const r of refs) expect(existsSync(join(dir, r)), r).toBe(true);
      expect(text).toMatch(/monolith idea add\|list\|show/);
      expect(text).toMatch(/never write an idea into a file/i);
    },
  );

  it('the repository CLAUDE.md trigger table points at existing skill files', () => {
    const refs = [...read('CLAUDE.md').matchAll(/`(\.monolith\/skills\/[a-z-]+\/SKILL\.md)`/g)].map((m) => m[1]);
    expect(refs).toContain('.monolith/skills/idea-capture/SKILL.md');
    for (const r of refs) expect(existsSync(join(REPO, r)), r).toBe(true);
  });

  it('a repeated init is refused and leaves a user-edited skill file untouched', async () => {
    const dir = makeTempDir();
    await runInit({ targetDir: dir, yes: true });
    const skill = join(dir, '.monolith', 'skills', 'idea-capture', 'SKILL.md');
    writeFileSync(skill, 'my own idea-capture rules\n', 'utf8');
    const before = readdirSync(dir).sort();
    await expect(runInit({ targetDir: dir, yes: true })).rejects.toThrow(InitConflictError);
    expect(readFileSync(skill, 'utf8')).toBe('my own idea-capture rules\n');
    expect(readdirSync(dir).sort()).toEqual(before);
  });
});

describe('routing', () => {
  it('Table 8 has the CAPTURE_IDEA route in the repository and in the template, CLI-only', () => {
    for (const p of ['.monolith/context/maps/routing-map.md', 'templates/default-instance/monolith/context/maps/routing-map.md']) {
      const row = read(p).split('\n').find((l) => l.startsWith('| `CAPTURE_IDEA`'));
      expect(row, p).toBeDefined();
      expect(row).toContain('monolith idea add');
      expect(row).toMatch(/never names, creates or writes it/);
    }
  });

  it('the skill is in both skill indexes and the semantic maps', () => {
    for (const p of ['.monolith/skills/INDEX.md', 'templates/default-instance/monolith/skills/INDEX.md']) {
      expect(read(p)).toContain('idea-capture');
    }
    for (const p of ['.monolith/context/maps/semantic-map.md', 'templates/default-instance/monolith/context/maps/semantic-map.md']) {
      expect(read(p)).toContain('monolith idea list');
    }
  });
});
