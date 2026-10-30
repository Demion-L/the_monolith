import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runInit, InitConflictError } from './index.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-init-safety-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function listAllFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listAllFiles(full));
    } else {
      results.push(full);
    }
  }
  return results.sort();
}

describe('monolith init — overwrite safety (LESSON-2026-0006 / TD-007)', () => {
  it('succeeds in a clean directory', async () => {
    const dir = makeTempDir();

    await runInit({ targetDir: dir, yes: true });

    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(dir, '.monolith', 'state.json'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
  });

  it('refuses to run against an existing AGENTS.md and leaves it untouched', async () => {
    const dir = makeTempDir();
    const agentsPath = join(dir, 'AGENTS.md');
    writeFileSync(agentsPath, '# My real project notes\n', 'utf8');

    await expect(runInit({ targetDir: dir, yes: true })).rejects.toThrow(InitConflictError);

    expect(readFileSync(agentsPath, 'utf8')).toBe('# My real project notes\n');
    // No other side effects — init must not have written anything at all.
    expect(existsSync(join(dir, '.monolith'))).toBe(false);
    expect(existsSync(join(dir, 'monolith.config.json'))).toBe(false);
  });

  it('refuses to run against an existing .monolith/ with real user data', async () => {
    const dir = makeTempDir();
    const activePath = join(dir, '.monolith', 'memory', 'working', 'active.md');
    mkdirSync(join(dir, '.monolith', 'memory', 'working'), { recursive: true });
    writeFileSync(activePath, '# Active Working Memory\n\nreal in-progress story notes\n', 'utf8');

    await expect(runInit({ targetDir: dir, yes: true })).rejects.toThrow(InitConflictError);

    expect(readFileSync(activePath, 'utf8')).toBe(
      '# Active Working Memory\n\nreal in-progress story notes\n',
    );
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
  });

  it('--yes does not authorize overwriting existing data (conflict still rejected)', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'monolith.config.json'), '{"custom":true}', 'utf8');

    const err = await runInit({ targetDir: dir, yes: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InitConflictError);
    expect((err as InitConflictError).conflicts).toContain('monolith.config.json');
    expect(readFileSync(join(dir, 'monolith.config.json'), 'utf8')).toBe('{"custom":true}');
  });

  it('a partially initialized project (one pre-existing tracked file) blocks the entire init — no half-scaffolded instance', async () => {
    const dir = makeTempDir();
    // Only one deep template-target file pre-exists; everything else is
    // missing. The preflight check must still catch it and refuse to write
    // *anything*, rather than writing everything else and only skipping
    // (or failing on) this one file.
    const partialPath = join(dir, '.monolith', 'protocols', 'governance', 'command-policy.md');
    mkdirSync(join(dir, '.monolith', 'protocols', 'governance'), { recursive: true });
    writeFileSync(partialPath, 'pre-existing custom command policy\n', 'utf8');

    const filesBefore = listAllFiles(dir);

    await expect(runInit({ targetDir: dir, yes: true })).rejects.toThrow(InitConflictError);

    expect(listAllFiles(dir)).toEqual(filesBefore);
    expect(readFileSync(partialPath, 'utf8')).toBe('pre-existing custom command policy\n');
  });

  it('a repeated (re-run) init on an already-initialized project is refused, not silently re-scaffolded', async () => {
    const dir = makeTempDir();
    await runInit({ targetDir: dir, yes: true });
    const filesAfterFirstInit = listAllFiles(dir);

    await expect(runInit({ targetDir: dir, yes: true })).rejects.toThrow(InitConflictError);

    // Nothing changed as a result of the rejected second run.
    expect(listAllFiles(dir)).toEqual(filesAfterFirstInit);
  });

  it('leaves no side effects in the target directory after a rejected init', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'AGENTS.md'), 'untouched\n', 'utf8');
    const filesBefore = listAllFiles(dir);

    await expect(runInit({ targetDir: dir, yes: true })).rejects.toThrow(InitConflictError);

    expect(listAllFiles(dir)).toEqual(filesBefore);
  });
});

describe('monolith init — .gitkeep overwrite safety', () => {
  // scaffoldInstance's createEmptyDirs() used to call
  // writeFileSync(gitkeepPath, '') unconditionally, truncating any
  // pre-existing (possibly non-empty, user-authored) .gitkeep. These
  // paths were also absent from planScaffoldConflicts(), so the conflict
  // was never caught before the write.
  const GITKEEP_REL = '.monolith/learning/mistakes/architecture/.gitkeep';

  it('refuses init when a tracked .gitkeep already has non-empty content, and leaves it byte-for-byte unchanged', async () => {
    const dir = makeTempDir();
    const gitkeepPath = join(dir, GITKEEP_REL);
    mkdirSync(join(dir, '.monolith', 'learning', 'mistakes', 'architecture'), { recursive: true });
    const customContent = '# keep this directory tracked — custom note\n';
    writeFileSync(gitkeepPath, customContent, 'utf8');

    await expect(runInit({ targetDir: dir, yes: true })).rejects.toThrow(InitConflictError);

    expect(readFileSync(gitkeepPath, 'utf8')).toBe(customContent);
  });

  it('does not partially scaffold other files when only a .gitkeep conflicts', async () => {
    const dir = makeTempDir();
    const gitkeepPath = join(dir, GITKEEP_REL);
    mkdirSync(join(dir, '.monolith', 'learning', 'mistakes', 'architecture'), { recursive: true });
    writeFileSync(gitkeepPath, 'custom\n', 'utf8');

    await expect(runInit({ targetDir: dir, yes: true })).rejects.toThrow(InitConflictError);

    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(dir, '.monolith', 'state.json'))).toBe(false);
  });

  it('--yes does not bypass .gitkeep protection', async () => {
    const dir = makeTempDir();
    const gitkeepPath = join(dir, GITKEEP_REL);
    mkdirSync(join(dir, '.monolith', 'learning', 'mistakes', 'architecture'), { recursive: true });
    writeFileSync(gitkeepPath, 'custom\n', 'utf8');

    const err = await runInit({ targetDir: dir, yes: true }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InitConflictError);
    expect((err as InitConflictError).conflicts).toContain(GITKEEP_REL);
    expect(readFileSync(gitkeepPath, 'utf8')).toBe('custom\n');
  });

  it('creates the expected .gitkeep placeholders on a clean init', async () => {
    const dir = makeTempDir();

    await runInit({ targetDir: dir, yes: true });

    const gitkeepPath = join(dir, GITKEEP_REL);
    expect(existsSync(gitkeepPath)).toBe(true);
    expect(readFileSync(gitkeepPath, 'utf8')).toBe('');
  });

  it('a repeated init is refused without touching .gitkeep files created by the first run', async () => {
    const dir = makeTempDir();
    await runInit({ targetDir: dir, yes: true });
    const gitkeepPath = join(dir, GITKEEP_REL);
    const contentAfterFirstInit = readFileSync(gitkeepPath, 'utf8');

    await expect(runInit({ targetDir: dir, yes: true })).rejects.toThrow(InitConflictError);

    expect(readFileSync(gitkeepPath, 'utf8')).toBe(contentAfterFirstInit);
  });
});

describe('monolith init — idea storage (IDEA-001A)', () => {
  it('creates the ideas directory with a .gitkeep', async () => {
    const dir = makeTempDir();
    await runInit({ targetDir: dir, yes: true });
    expect(readFileSync(join(dir, '.monolith', 'memory', 'long-term', 'ideas', '.gitkeep'), 'utf8')).toBe('');
  });

  it('a repeated init is refused and leaves an existing idea byte-for-byte unchanged', async () => {
    const dir = makeTempDir();
    await runInit({ targetDir: dir, yes: true });
    const idea = join(dir, '.monolith', 'memory', 'long-term', 'ideas', 'IDEA-001.md');
    writeFileSync(idea, 'my idea, not to be touched\n', 'utf8');
    const filesBefore = listAllFiles(dir);

    await expect(runInit({ targetDir: dir, yes: true })).rejects.toThrow(InitConflictError);

    expect(readFileSync(idea, 'utf8')).toBe('my idea, not to be touched\n');
    expect(listAllFiles(dir)).toEqual(filesBefore);
  });

  it('a fresh instance accepts and returns an idea', async () => {
    const dir = makeTempDir();
    await runInit({ targetDir: dir, yes: true });
    const { ideaStore, addIdea, getIdea } = await import('../ideas/index.js');
    const { idea } = addIdea(ideaStore(dir), { title: 'after init', description: 'works' });
    expect(idea.id).toBe('IDEA-001');
    expect(getIdea(ideaStore(dir), 'IDEA-001').description).toBe('works');
  });
});

describe('monolith init — CAPTURE_IDEA routing contract (IDEA-001A-F)', () => {
  it('ships the intent in routing-map, semantic-map, AGENTS.md and CLAUDE.md, with the path substituted', async () => {
    const dir = makeTempDir();
    await runInit({ targetDir: dir, yes: true });
    const read = (...p: string[]) => readFileSync(join(dir, ...p), 'utf8');
    const routing = read('.monolith', 'context', 'maps', 'routing-map.md');
    expect(routing).toContain('Table 8');
    expect(routing).toContain('`CAPTURE_IDEA`');
    expect(routing).toContain('.monolith/memory/long-term/ideas/IDEA-NNN.md');
    expect(routing).toContain('never writes or edits an idea file by hand');
    expect(read('.monolith', 'context', 'maps', 'semantic-map.md')).toContain('memory/long-term/ideas/IDEA-*.md');
    expect(read('AGENTS.md')).toContain('.monolith/memory/long-term/ideas/');
    const claude = read('CLAUDE.md');
    expect(claude).toContain('CAPTURE_IDEA');
    for (const f of ['AGENTS.md', 'CLAUDE.md', '.monolith/context/maps/routing-map.md']) expect(read(f)).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(existsSync(join(dir, '.monolith', 'memory', 'ideas'))).toBe(false);
  });
});
