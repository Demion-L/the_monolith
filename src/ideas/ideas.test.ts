import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { addIdea, getIdea, ideaStore, listIdeas } from './store.js';
import { parseIdea, serializeIdea } from './format.js';
import { runIdeaCommand, parseAddArgs } from './cli.js';
import { IDEA_LIMITS, IdeaError, type Idea } from './types.js';

let base: string;
let project: string;
let mon: string;
let ideasDir: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'monolith-idea-'));
  project = join(base, 'project');
  mon = join(project, '.monolith');
  ideasDir = join(mon, 'memory', 'long-term', 'ideas');
  outside = join(base, 'outside');
  mkdirSync(mon, { recursive: true });
  mkdirSync(outside);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const store = () => ideaStore(project);
const fixedNow = () => new Date('2026-10-30T12:00:00.000Z');

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof IdeaError) return err.code;
    throw err;
  }
  throw new Error('expected an IdeaError');
}

/** Snapshot of every file below `dir` (path -> content), for "nothing changed" assertions. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name);
      if (name.isDirectory()) walk(p);
      else out[p] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

async function cli(args: string[]): Promise<{ out: string; err: string; exitCode: number | undefined }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  const error = vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
  const prev = process.exitCode;
  process.exitCode = undefined;
  try {
    await runIdeaCommand(args, project);
    return { out: out.join('\n'), err: err.join('\n'), exitCode: process.exitCode as number | undefined };
  } finally {
    process.exitCode = prev;
    log.mockRestore();
    error.mockRestore();
  }
}

describe('addIdea', () => {
  it('creates IDEA-001 in inbox with a creation date, and a file a human can read', () => {
    const { idea, path } = addIdea(store(), { title: 'Cache the graph', description: 'Maybe cache ERG output.' }, { now: fixedNow });
    expect(idea).toMatchObject({ id: 'IDEA-001', status: 'inbox', createdAt: '2026-10-30T12:00:00.000Z' });
    expect(path).toBe(join(ideasDir, 'IDEA-001.md'));
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('title: "Cache the graph"');
    expect(text).toContain('status: inbox');
    expect(text).toContain('## Description\n\nMaybe cache ERG output.\n');
  });

  it('allocates ascending ids and never reuses one', () => {
    const ids = [1, 2, 3].map((n) => addIdea(store(), { title: `t${n}`, description: 'd' }).idea.id);
    expect(ids).toEqual(['IDEA-001', 'IDEA-002', 'IDEA-003']);
  });

  it('keeps the id of an archived idea reserved', () => {
    addIdea(store(), { title: 'a', description: 'd' });
    const p = join(ideasDir, 'IDEA-001.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace('status: inbox', 'status: archived'));
    expect(addIdea(store(), { title: 'b', description: 'd' }).idea.id).toBe('IDEA-002');
    expect(getIdea(store(), 'IDEA-001').status).toBe('archived');
  });

  it('grows past three digits', () => {
    mkdirSync(ideasDir, { recursive: true });
    writeFileSync(join(ideasDir, 'IDEA-999.md'), serializeIdea({ id: 'IDEA-999', title: 't', description: 'd', createdAt: fixedNow().toISOString(), status: 'inbox' }));
    expect(addIdea(store(), { title: 'x', description: 'd' }).idea.id).toBe('IDEA-1000');
    expect(listIdeas(store()).map((e) => (e.ok ? e.idea.id : e.id))).toEqual(['IDEA-999', 'IDEA-1000']);
  });

  it('stores context and returns it', () => {
    addIdea(store(), { title: 't', description: 'd', context: 'while fixing LOCK-001' });
    expect(getIdea(store(), 'IDEA-001').context).toBe('while fixing LOCK-001');
  });

  it('round-trips special characters, quotes, frontmatter lookalikes, unicode and newlines', () => {
    const description = [
      'line one',
      '---',
      '## Description',
      'key: "value" \\ back\\slash',
      '\tTabbed\r\nCRLF line',
      '日本語 🚀 ünïcödé <script>alert(1)</script> $(rm -rf /) `x`',
      '',
      '',
      'trailing blank lines kept above; ends with spaces   ',
    ].join('\n');
    const title = 'He said "hi" — it\'s: a #title ---';
    const context = 'multi\nline "context"\n---\n';
    addIdea(store(), { title, description, context });
    const back = getIdea(store(), 'IDEA-001');
    expect(back.title).toBe(title);
    expect(back.description).toBe(description);
    expect(back.context).toBe(context);
  });

  it('stores a long description without loss', () => {
    const description = 'x'.repeat(IDEA_LIMITS.description - 1) + '\n';
    addIdea(store(), { title: 't', description });
    expect(getIdea(store(), 'IDEA-001').description).toBe(description);
  });

  it('survives a new process-like reload (fresh store object, same disk)', () => {
    addIdea(store(), { title: 'persist', description: 'me' });
    expect(getIdea(ideaStore(project), 'IDEA-001').title).toBe('persist');
  });

  it.each([
    ['empty title', { title: '', description: 'd' }],
    ['blank title', { title: '   ', description: 'd' }],
    ['empty description', { title: 't', description: '' }],
    ['blank description', { title: 't', description: ' \n\t' }],
    ['multi-line title', { title: 'a\nb', description: 'd' }],
    ['control character in title', { title: 'a\u001b[31mb', description: 'd' }],
    ['over-long title', { title: 'x'.repeat(IDEA_LIMITS.title + 1), description: 'd' }],
    ['over-long description', { title: 't', description: 'x'.repeat(IDEA_LIMITS.description + 1) }],
    ['over-long context', { title: 't', description: 'd', context: 'x'.repeat(IDEA_LIMITS.context + 1) }],
    ['empty context', { title: 't', description: 'd', context: '' }],
    ['lone surrogate', { title: 't', description: 'bad \ud800 here' }],
  ])('rejects %s and writes nothing', (_name, input) => {
    expect(codeOf(() => addIdea(store(), input))).toBe('IDEA_INVALID_INPUT');
    expect(existsSync(ideasDir)).toBe(false);
  });

  it('refuses to invent an instance', () => {
    rmSync(mon, { recursive: true });
    expect(codeOf(() => addIdea(store(), { title: 't', description: 'd' }))).toBe('IDEA_NOT_INITIALIZED');
    expect(existsSync(mon)).toBe(false);
  });

  it('does not touch active.md, state.json or any other file', () => {
    mkdirSync(join(mon, 'memory', 'working'), { recursive: true });
    writeFileSync(join(mon, 'memory', 'working', 'active.md'), '# active\n');
    writeFileSync(join(mon, 'state.json'), '{"x":1}');
    const before = snapshot(mon);
    addIdea(store(), { title: 't', description: 'd' });
    const after = snapshot(mon);
    for (const [p, content] of Object.entries(before)) expect(after[p]).toBe(content);
    expect(Object.keys(after).filter((p) => !(p in before))).toEqual([join(ideasDir, 'IDEA-001.md')]);
  });
});

describe('id collisions and overwrite protection', () => {
  it('never overwrites an idea created between the scan and the write (lost race -> next id)', () => {
    mkdirSync(ideasDir, { recursive: true });
    const intruder = join(ideasDir, 'IDEA-001.md');
    let first = true;
    // Plant IDEA-001 the moment the first link() is attempted: the scan said 001 was free.
    const realLink = linkSync;
    const { idea } = addIdea(store(), { title: 'mine', description: 'mine' }, {
      ops: {
        linkSync: ((from: string, to: string) => {
          if (first) {
            first = false;
            writeFileSync(intruder, 'SOMEONE ELSE');
          }
          return realLink(from, to);
        }) as typeof linkSync,
      },
    });
    expect(idea.id).toBe('IDEA-002');
    expect(readFileSync(intruder, 'utf8')).toBe('SOMEONE ELSE');
    expect(getIdea(store(), 'IDEA-002').title).toBe('mine');
    expect(readdirSync(ideasDir).sort()).toEqual(['IDEA-001.md', 'IDEA-002.md']);
  });

  it('skips a number held by a dangling symlink and leaves the link alone', () => {
    mkdirSync(ideasDir, { recursive: true });
    symlinkSync(join(outside, 'nowhere'), join(ideasDir, 'IDEA-001.md'));
    expect(addIdea(store(), { title: 't', description: 'd' }).idea.id).toBe('IDEA-002');
    expect(existsSync(join(outside, 'nowhere'))).toBe(false);
  });

  it('ignores temp-looking names when numbering', () => {
    mkdirSync(ideasDir, { recursive: true });
    writeFileSync(join(ideasDir, 'IDEA-005.md.tmp.1.abc'), 'x');
    writeFileSync(join(ideasDir, 'notes.md'), 'x');
    expect(addIdea(store(), { title: 't', description: 'd' }).idea.id).toBe('IDEA-001');
  });
});

describe('getIdea / listIdeas', () => {
  it('shows an idea by id', () => {
    addIdea(store(), { title: 'T', description: 'D' }, { now: fixedNow });
    expect(getIdea(store(), 'IDEA-001')).toEqual<Idea>({
      id: 'IDEA-001',
      title: 'T',
      description: 'D',
      createdAt: '2026-10-30T12:00:00.000Z',
      status: 'inbox',
    });
  });

  it('reports a missing id and a malformed id differently', () => {
    expect(codeOf(() => getIdea(store(), 'IDEA-042'))).toBe('IDEA_NOT_FOUND');
    for (const bad of ['', 'idea-001', 'IDEA-1', '../etc/passwd', 'IDEA-001.md', 'IDEA-001/..', 'IDEA-0001\n', 'IDEA-9999999999']) {
      expect(codeOf(() => getIdea(store(), bad))).toBe('IDEA_INVALID_ID');
    }
  });

  it('lists in numeric order regardless of directory order and creation order', () => {
    mkdirSync(ideasDir, { recursive: true });
    for (const n of ['IDEA-010', 'IDEA-002', 'IDEA-1000', 'IDEA-001']) {
      writeFileSync(join(ideasDir, `${n}.md`), serializeIdea({ id: n, title: n, description: 'd', createdAt: fixedNow().toISOString(), status: 'inbox' }));
    }
    const ids = listIdeas(store()).map((e) => (e.ok ? e.idea.id : e.id));
    expect(ids).toEqual(['IDEA-001', 'IDEA-002', 'IDEA-010', 'IDEA-1000']);
    expect(listIdeas(store())).toEqual(listIdeas(store()));
  });

  it('returns an empty list when nothing was ever captured', () => {
    expect(listIdeas(store())).toEqual([]);
    expect(existsSync(ideasDir)).toBe(false);
  });

  it('list and show write nothing', () => {
    addIdea(store(), { title: 't', description: 'd' });
    const before = snapshot(project);
    listIdeas(store());
    getIdea(store(), 'IDEA-001');
    expect(snapshot(project)).toEqual(before);
    expect(readdirSync(ideasDir)).toEqual(['IDEA-001.md']);
  });

  it('list on a fresh instance does not create the ideas directory', () => {
    listIdeas(store());
    expect(existsSync(join(mon, 'memory'))).toBe(false);
  });
});

describe('corrupt idea files', () => {
  const good = (id: string) => serializeIdea({ id, title: 'ok', description: 'd', createdAt: fixedNow().toISOString(), status: 'inbox' });
  const put = (name: string, text: string) => {
    mkdirSync(ideasDir, { recursive: true });
    writeFileSync(join(ideasDir, name), text);
  };

  it.each([
    ['empty file', ''],
    ['no frontmatter', 'just text\n'],
    ['unterminated frontmatter', '---\nid: "IDEA-001"\n'],
    ['missing title', '---\nid: "IDEA-001"\nstatus: inbox\ncreatedAt: "2026-10-30T00:00:00Z"\n---\n\n## Description\n\nd\n'],
    ['unknown status', good('IDEA-001').replace('status: inbox', 'status: done')],
    ['bad date', good('IDEA-001').replace(/createdAt: .*/, 'createdAt: "yesterday"')],
    ['id mismatch', good('IDEA-009')],
    ['broken JSON string', good('IDEA-001').replace('title: "ok"', 'title: "ok')],
    ['duplicate key', good('IDEA-001').replace('status: inbox', 'status: inbox\nstatus: planned')],
    ['no description section', good('IDEA-001').replace('## Description', '## Notes')],
    ['empty description', good('IDEA-001').replace('d\n', '')],
    ['binary garbage', '\u0000\u0001\u0002'],
  ])('%s: show fails with IDEA_CORRUPT, list keeps going, file untouched', (_n, text) => {
    put('IDEA-001.md', text);
    put('IDEA-002.md', good('IDEA-002'));
    expect(codeOf(() => getIdea(store(), 'IDEA-001'))).toBe('IDEA_CORRUPT');
    const entries = listIdeas(store());
    expect(entries.map((e) => e.ok)).toEqual([false, true]);
    expect(readFileSync(join(ideasDir, 'IDEA-001.md'), 'utf8')).toBe(text);
  });

  it('an oversized file is unreadable, not truncated', () => {
    put('IDEA-001.md', 'x'.repeat(IDEA_LIMITS.fileBytes + 1));
    expect(codeOf(() => getIdea(store(), 'IDEA-001'))).toBe('IDEA_CORRUPT');
  });

  it('accepts a hand-edited file: bare strings and status changed to planned', () => {
    put('IDEA-001.md', '---\ntype: idea\nid: IDEA-001\ntitle: Plain title\nstatus: planned\ncreatedAt: 2026-10-30T10:00:00Z\n---\n\n## Description\n\nHand written.\n');
    expect(getIdea(store(), 'IDEA-001')).toMatchObject({ title: 'Plain title', status: 'planned', description: 'Hand written.' });
  });

  it('parseIdea round-trips tags', () => {
    const idea: Idea = { id: 'IDEA-001', title: 't', description: 'd', createdAt: fixedNow().toISOString(), status: 'inbox', tags: ['a', 'b"c'] };
    expect(parseIdea('IDEA-001', serializeIdea(idea))).toEqual(idea);
  });
});

describe('path and symlink safety', () => {
  it('refuses to add when the ideas directory is a symlink (outside) and writes nothing outside', () => {
    mkdirSync(join(mon, 'memory', 'long-term'), { recursive: true });
    symlinkSync(outside, ideasDir);
    expect(codeOf(() => addIdea(store(), { title: 't', description: 'd' }))).toBe('IDEA_UNSAFE_PATH');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses a symlink that stays inside the project, too', () => {
    mkdirSync(join(mon, 'memory', 'long-term'), { recursive: true });
    mkdirSync(join(project, 'elsewhere'));
    symlinkSync(join(project, 'elsewhere'), ideasDir);
    expect(codeOf(() => addIdea(store(), { title: 't', description: 'd' }))).toBe('IDEA_UNSAFE_PATH');
    expect(readdirSync(join(project, 'elsewhere'))).toEqual([]);
  });

  it('refuses to list a symlinked ideas directory', () => {
    mkdirSync(join(mon, 'memory', 'long-term'), { recursive: true });
    symlinkSync(outside, ideasDir);
    expect(codeOf(() => listIdeas(store()))).toBe('IDEA_UNSAFE_PATH');
  });

  it('refuses a symlinked memory directory on add and list', () => {
    symlinkSync(outside, join(mon, 'memory'));
    expect(codeOf(() => addIdea(store(), { title: 't', description: 'd' }))).toBe('IDEA_UNSAFE_PATH');
    expect(codeOf(() => listIdeas(store()))).toBe('IDEA_UNSAFE_PATH');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('does not follow a symlinked idea file; show reports it unsafe and never reads the target', () => {
    mkdirSync(ideasDir, { recursive: true });
    writeFileSync(join(outside, 'secret.md'), serializeIdea({ id: 'IDEA-001', title: 'SECRET', description: 'x', createdAt: fixedNow().toISOString(), status: 'inbox' }));
    symlinkSync(join(outside, 'secret.md'), join(ideasDir, 'IDEA-001.md'));
    expect(codeOf(() => getIdea(store(), 'IDEA-001'))).toBe('IDEA_UNSAFE_PATH');
    const [entry] = listIdeas(store());
    expect(entry.ok).toBe(false);
    expect(JSON.stringify(entry)).not.toContain('SECRET');
  });

  it('does not read a hard-linked idea file', () => {
    mkdirSync(ideasDir, { recursive: true });
    const p = join(ideasDir, 'IDEA-001.md');
    writeFileSync(p, serializeIdea({ id: 'IDEA-001', title: 't', description: 'd', createdAt: fixedNow().toISOString(), status: 'inbox' }));
    linkSync(p, join(outside, 'twin.md'));
    expect(codeOf(() => getIdea(store(), 'IDEA-001'))).toBe('IDEA_UNSAFE_PATH');
  });

  it('rejects a monolithRoot that escapes the project', () => {
    writeFileSync(join(project, 'monolith.config.json'), JSON.stringify({ monolithRoot: '../outside' }));
    expect(() => ideaStore(project)).toThrow();
    expect(readdirSync(outside)).toEqual([]);
  });

  it('honours a configured monolithRoot', () => {
    mkdirSync(join(project, 'custom'));
    writeFileSync(join(project, 'monolith.config.json'), JSON.stringify({ monolithRoot: 'custom' }));
    addIdea(ideaStore(project), { title: 't', description: 'd' });
    expect(existsSync(join(project, 'custom', 'memory', 'long-term', 'ideas', 'IDEA-001.md'))).toBe(true);
    expect(existsSync(ideasDir)).toBe(false);
  });
});

describe('write failures', () => {
  it('a failing write is an error, leaves no idea file and no staging residue', () => {
    const enospc = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    expect(() =>
      addIdea(store(), { title: 't', description: 'd' }, {
        ops: {
          writeSync: (() => {
            throw enospc;
          }) as never,
        },
      }),
    ).toThrow(/space|write/i);
    expect(readdirSync(ideasDir)).toEqual([]);
    expect(listIdeas(store())).toEqual([]);
  });

  it('a failing publication is an error, not a silent success', () => {
    const eio = Object.assign(new Error('I/O error'), { code: 'EIO' });
    expect(() =>
      addIdea(store(), { title: 't', description: 'd' }, {
        ops: {
          linkSync: (() => {
            throw eio;
          }) as never,
        },
      }),
    ).toThrow();
    expect(readdirSync(ideasDir).filter((n) => n.startsWith('IDEA-') && n.endsWith('.md'))).toEqual([]);
  });

  it('a read-only ideas directory is reported, and nothing is written', () => {
    if (process.getuid?.() === 0) return; // root ignores mode bits
    mkdirSync(ideasDir, { recursive: true });
    chmodSync(ideasDir, 0o500);
    try {
      expect(() => addIdea(store(), { title: 't', description: 'd' })).toThrow();
      expect(readdirSync(ideasDir)).toEqual([]);
    } finally {
      chmodSync(ideasDir, 0o700);
    }
  });
});

describe('CLI handlers', () => {
  it('add prints the id, status and title, and mentions that the task is unchanged', async () => {
    const r = await cli(['add', '--title', 'Try X', '--description', 'Because Y', '--context', 'during Z']);
    expect(r.out).toContain('Saved IDEA-001 [inbox]: Try X');
    expect(r.out).toContain('unchanged');
    expect(getIdea(store(), 'IDEA-001').context).toBe('during Z');
  });

  it('add leaves active.md byte-identical', async () => {
    mkdirSync(join(mon, 'memory', 'working'), { recursive: true });
    const active = join(mon, 'memory', 'working', 'active.md');
    writeFileSync(active, '## Current Story\n\nCONTEXT-001A\n');
    await cli(['add', '--title', 't', '--description', 'd']);
    expect(readFileSync(active, 'utf8')).toBe('## Current Story\n\nCONTEXT-001A\n');
  });

  it('list says so when empty and lists id, status, title otherwise', async () => {
    expect((await cli(['list'])).out).toMatch(/No ideas/);
    await cli(['add', '--title', 'First', '--description', 'd']);
    await cli(['add', '--title', 'Second', '--description', 'd']);
    const r = await cli(['list']);
    expect(r.out).toBe('Ideas (2):\n  IDEA-001  [inbox]  First\n  IDEA-002  [inbox]  Second');
    expect(r.exitCode).toBeUndefined();
  });

  it('list marks unreadable files, keeps the rest and sets a non-zero exit code', async () => {
    await cli(['add', '--title', 'ok', '--description', 'd']);
    writeFileSync(join(ideasDir, 'IDEA-002.md'), 'garbage');
    const r = await cli(['list']);
    expect(r.out).toContain('IDEA-001  [inbox]  ok');
    expect(r.out).toMatch(/IDEA-002 {2}\[unreadable\]/);
    expect(r.exitCode).toBe(2);
  });

  it('list escapes control characters found in a hand-edited title', async () => {
    mkdirSync(ideasDir, { recursive: true });
    writeFileSync(join(ideasDir, 'IDEA-001.md'), '---\nid: IDEA-001\ntitle: "evil\\u001b[2J"\nstatus: inbox\ncreatedAt: 2026-10-30T10:00:00Z\n---\n\n## Description\n\nd\n');
    const r = await cli(['list']);
    expect(r.out).not.toContain('\u001b');
    expect(r.out).toContain('\\u001b');
  });

  it('show prints the full content, multi-line description included', async () => {
    await cli(['add', '--title', 'T', '--description', 'line1\nline2', '--context', 'ctx']);
    const r = await cli(['show', 'IDEA-001']);
    expect(r.out).toContain('id:         IDEA-001');
    expect(r.out).toContain('status:     inbox');
    expect(r.out).toContain('    line1\n    line2');
    expect(r.out).toContain('ctx');
  });

  it('show of a missing id fails with a clear message', async () => {
    await expect(cli(['show', 'IDEA-009'])).rejects.toThrow('No idea IDEA-009.');
  });

  it.each([
    [['add']],
    [['add', '--title', 'only title']],
    [['add', '--description', 'only description']],
    [['add', '--title']],
    [['add', '--title', '--description', 'd']],
    [['add', '--title', 't', '--description', 'd', '--bogus', 'x']],
    [['add', '--title', 't', '--title', 'u', '--description', 'd']],
    [['add', 'stray', '--title', 't', '--description', 'd']],
    [['add', '--title', '', '--description', 'd']],
    [['add', '--title', 't', '--description', '   ']],
    [['show']],
    [['show', 'IDEA-001', 'IDEA-002']],
    [['show', '../../etc/passwd']],
    [['list', 'extra']],
    [['frobnicate']],
    [[]],
  ])('rejects bad arguments %j without writing', async (args) => {
    await expect(cli(args)).rejects.toBeInstanceOf(IdeaError);
    expect(existsSync(ideasDir)).toBe(false);
  });

  it('parseAddArgs accepts a value that merely looks like text starting with dashes', () => {
    expect(parseAddArgs(['--title', '-x', '--description', '--- hr'])).toEqual({ title: '-x', description: '--- hr' });
  });
});

describe('canonical location memory/long-term/ideas (IDEA-001A-F)', () => {
  it('lives under memory/long-term and leaves the sibling long-term documents alone', () => {
    const lt = join(mon, 'memory', 'long-term');
    mkdirSync(lt, { recursive: true });
    for (const n of ['decisions.md', 'tech-debt.md', 'IDEA-007.md']) writeFileSync(join(lt, n), `# ${n}\n`);
    const before = snapshot(lt);
    const { path } = addIdea(store(), { title: 't', description: 'd' });
    expect(path).toBe(join(lt, 'ideas', 'IDEA-001.md'));
    // a stray IDEA-007.md next to the registry is not part of it
    expect(listIdeas(store()).map((e) => (e.ok ? e.idea.id : e.id))).toEqual(['IDEA-001']);
    for (const [p, c] of Object.entries(before)) expect(readFileSync(p, 'utf8')).toBe(c);
  });

  it('works in an instance that predates the directory (no ideas dir, long-term present)', () => {
    mkdirSync(join(mon, 'memory', 'long-term'), { recursive: true });
    expect(listIdeas(store())).toEqual([]);
    expect(addIdea(store(), { title: 't', description: 'd' }).idea.id).toBe('IDEA-001');
  });

  it('refuses a symlinked long-term directory', () => {
    mkdirSync(join(mon, 'memory'), { recursive: true });
    symlinkSync(outside, join(mon, 'memory', 'long-term'));
    expect(codeOf(() => addIdea(store(), { title: 't', description: 'd' }))).toBe('IDEA_UNSAFE_PATH');
    expect(codeOf(() => listIdeas(store()))).toBe('IDEA_UNSAFE_PATH');
    expect(readdirSync(outside)).toEqual([]);
  });

  it('does not use the previous location memory/ideas', () => {
    addIdea(store(), { title: 't', description: 'd' });
    expect(existsSync(join(mon, 'memory', 'ideas'))).toBe(false);
  });

  it('IDEA-ID-001 (open): an id is reissued once its highest-numbered file is deleted', () => {
    addIdea(store(), { title: 'a', description: 'd' });
    addIdea(store(), { title: 'b', description: 'd' });
    rmSync(join(ideasDir, 'IDEA-002.md'));
    expect(addIdea(store(), { title: 'c', description: 'd' }).idea.id).toBe('IDEA-002');
  });
});
