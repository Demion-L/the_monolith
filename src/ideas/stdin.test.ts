import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { parseAddArgs, readStdinText, runIdeaAdd } from './cli.js';
import { getIdea, ideaStore } from './store.js';
import { IDEA_LIMITS, IdeaError } from './types.js';

let base: string;
let project: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'monolith-idea-stdin-'));
  project = join(base, 'project');
  mkdirSync(join(project, '.monolith'), { recursive: true });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});

const feed = (...chunks: Array<string | Buffer>): Readable => Readable.from(chunks, { objectMode: false });
const ideaCount = (): number => {
  try {
    return readdirSync(join(project, '.monolith', 'memory', 'long-term', 'ideas')).filter((n) => n.endsWith('.md')).length;
  } catch {
    return 0;
  }
};
async function rejects(p: Promise<unknown>): Promise<IdeaError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(IdeaError);
    return err as IdeaError;
  }
  throw new Error('expected rejection');
}

describe('parseAddArgs --description-stdin', () => {
  it('accepts it as a value-less flag in any position', () => {
    expect(parseAddArgs(['--description-stdin', '--title', 't'])).toMatchObject({ title: 't', descriptionStdin: true });
    expect(parseAddArgs(['--title', 't', '--description-stdin', '--context', 'c'])).toMatchObject({ context: 'c', descriptionStdin: true });
  });
  it('cannot be combined with --description (either order)', () => {
    expect(() => parseAddArgs(['--title', 't', '--description', 'd', '--description-stdin'])).toThrow(/cannot be combined/);
    expect(() => parseAddArgs(['--description-stdin', '--title', 't', '--description', 'd'])).toThrow(/cannot be combined/);
  });
  it('is not a value for another flag, may not repeat, and still needs a title', () => {
    expect(() => parseAddArgs(['--title', '--description-stdin'])).toThrow(/needs a value/);
    expect(() => parseAddArgs(['--title', 't', '--description-stdin', '--description-stdin'])).toThrow(/more than once/);
    expect(() => parseAddArgs(['--description-stdin'])).toThrow(/required/);
  });
  it('keeps the --description contract unchanged', () => {
    expect(parseAddArgs(['--title', 't', '--description', 'd'])).toEqual({ title: 't', description: 'd' });
    expect(() => parseAddArgs(['--title', 't'])).toThrow(/required/);
  });
});

describe('monolith idea add --description-stdin', () => {
  it.each([
    ['unicode', 'Идея ✓ 日本語 🚀 é'],
    ['quotes', `it's "quoted" and \`ticked\``],
    ['newlines and CRLF', 'line1\nline2\r\nline3\n\n'],
    ['shell metacharacters', '$(touch /tmp/pwned) `id` ${HOME} ; rm -rf / | cat > x && echo $0 \\ \' " <<EOF\nEOF\n'],
    ['markdown and frontmatter lookalikes', '---\ntype: idea\n---\n## Description\n# heading\n'],
    ['leading and trailing whitespace', '  \n  indented\t \n'],
    ['BOM', '﻿with bom'],
  ])('stores the exact bytes: %s', async (_name, text) => {
    await runIdeaAdd(['--title', 'T', '--description-stdin'], project, feed(Buffer.from(text, 'utf8')) as never);
    expect(getIdea(ideaStore(project), 'IDEA-001').description).toBe(text);
  });

  it('reassembles a multi-byte character split across chunks', async () => {
    const bytes = Buffer.from('é✓🚀', 'utf8');
    await runIdeaAdd(['--title', 'T', '--description-stdin'], project, feed(bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)) as never);
    expect(getIdea(ideaStore(project), 'IDEA-001').description).toBe('é✓🚀');
  });

  it('never executes content: no side effect file appears', async () => {
    const marker = join(base, 'pwned');
    await runIdeaAdd(['--title', 'T', '--description-stdin'], project, feed(`$(touch ${marker}) \`touch ${marker}\``) as never);
    expect(readdirSync(base)).not.toContain('pwned');
  });

  it('accepts exactly the description limit and rejects one more, writing nothing', async () => {
    await runIdeaAdd(['--title', 'T', '--description-stdin'], project, feed('x'.repeat(IDEA_LIMITS.description)) as never);
    const err = await rejects(runIdeaAdd(['--title', 'T', '--description-stdin'], project, feed('x'.repeat(IDEA_LIMITS.description + 1)) as never));
    expect(err.code).toBe('IDEA_INVALID_INPUT');
    expect(err.message).toMatch(/too long/);
    expect(ideaCount()).toBe(1);
  });

  it('stops reading beyond the byte cap and writes nothing', async () => {
    const stream = feed(Buffer.alloc(IDEA_LIMITS.description * 4 + 1, 0x61));
    const err = await rejects(runIdeaAdd(['--title', 'T', '--description-stdin'], project, stream as never));
    expect(err.message).toMatch(/too large/);
    expect(stream.destroyed).toBe(true);
    expect(ideaCount()).toBe(0);
  });

  it('rejects invalid UTF-8, empty and whitespace-only input without writing', async () => {
    expect((await rejects(runIdeaAdd(['--title', 'T', '--description-stdin'], project, feed(Buffer.from([0xff, 0xfe, 0x41])) as never))).message).toMatch(/UTF-8/);
    expect((await rejects(runIdeaAdd(['--title', 'T', '--description-stdin'], project, feed('') as never))).code).toBe('IDEA_INVALID_INPUT');
    expect((await rejects(runIdeaAdd(['--title', 'T', '--description-stdin'], project, feed(' \n\t\n') as never))).code).toBe('IDEA_INVALID_INPUT');
    expect(ideaCount()).toBe(0);
  });

  it('reports a read error and writes nothing', async () => {
    const broken = new Readable({ read() { this.destroy(new Error('EIO simulated')); } });
    const err = await rejects(runIdeaAdd(['--title', 'T', '--description-stdin'], project, broken as never));
    expect(err.message).toMatch(/could not read stdin: EIO simulated/);
    expect(ideaCount()).toBe(0);
  });

  it('refuses a terminal instead of waiting for input', async () => {
    const tty = Object.assign(feed('typed'), { isTTY: true });
    await expect(readStdinText(tty)).rejects.toThrow(/terminal/);
  });

  it('does not read stdin for --description, and a flag conflict reads nothing', async () => {
    const stream = feed('from stdin');
    await runIdeaAdd(['--title', 'T', '--description', 'from flag'], project, stream as never);
    expect(getIdea(ideaStore(project), 'IDEA-001').description).toBe('from flag');
    expect(stream.readableFlowing).toBeNull();
    const other = feed('x');
    await rejects(runIdeaAdd(['--title', 'T', '--description', 'd', '--description-stdin'], project, other as never));
    expect(other.readableFlowing).toBeNull();
    expect(ideaCount()).toBe(1);
  });

  it('still validates the title and context after reading', async () => {
    expect((await rejects(runIdeaAdd(['--title', 'a\nb', '--description-stdin'], project, feed('d') as never))).code).toBe('IDEA_INVALID_INPUT');
    expect(ideaCount()).toBe(0);
  });
});
