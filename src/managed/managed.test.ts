import { describe, expect, it } from 'vitest';
import { appendBlock, blockBody, bodyHash, inspectBlock, prose, refreshBlock, renderBlock } from './index.js';

const body = blockBody('bootstrap', '.monolith');
const pristine = (text: string) => {
  const st = inspectBlock(text, 'bootstrap', body);
  if (st.state !== 'pristine') throw new Error(`expected pristine, got ${st.state}`);
  return st;
};

describe('managed blocks', () => {
  it('renders a block whose checksum matches its body, with the root substituted', () => {
    const r = renderBlock('bootstrap', body);
    expect(r).toContain(`sha256=${bodyHash(body)}`);
    expect(body).toContain('`.monolith/AGENT.md`');
    expect(body).not.toContain('{{');
  });

  it('append keeps every existing byte, with or without a trailing newline', () => {
    for (const user of ['# mine\ntext\n', '# mine\ntext', '', '# mine\r\ntext\r\n']) {
      const out = appendBlock(user, 'bootstrap', body);
      expect(out.startsWith(user)).toBe(true);
      expect(pristine(out).current).toBe(true);
    }
    expect(appendBlock('a\r\n', 'bootstrap', body)).not.toMatch(/[^\r]\n/);
  });

  it('is idempotent: a second append is not needed because the block is current', () => {
    const once = appendBlock('# mine\n', 'bootstrap', body);
    expect(inspectBlock(once, 'bootstrap', body)).toMatchObject({ state: 'pristine', current: true });
  });

  it('refresh replaces only the block and keeps text before and after', () => {
    const old = renderBlock('bootstrap', 'OLD TEXT');
    const text = `before\n\n${old}\nafter\n`;
    const st = inspectBlock(text, 'bootstrap', body);
    expect(st).toMatchObject({ state: 'pristine', current: false });
    if (st.state !== 'pristine') return;
    const out = refreshBlock(text, st, 'bootstrap', body);
    expect(out.startsWith('before\n\n')).toBe(true);
    expect(out.endsWith('\nafter\n')).toBe(true);
    expect(out).not.toContain('OLD TEXT');
    expect(pristine(out).current).toBe(true);
  });

  it('refresh keeps a file that ends right after the end marker unterminated', () => {
    const text = 'x\n' + renderBlock('bootstrap', 'OLD').replace(/\n$/, '');
    const st = pristine(text);
    expect(refreshBlock(text, st, 'bootstrap', body).endsWith('-->')).toBe(true);
  });

  it('a user edit inside the block is "edited"', () => {
    const text = appendBlock('', 'bootstrap', body).replace('read `', 'ignore `');
    expect(inspectBlock(text, 'bootstrap', body).state).toBe('edited');
  });

  it.each([
    ['begin without end', (s: string) => s.replace(/<!-- monolith:end bootstrap -->\n?/, '')],
    ['end without begin', (s: string) => s.replace(/<!-- monolith:begin [^\n]*\n/, '')],
    ['duplicated block', (s: string) => s + '\n' + s],
    ['end before begin', (s: string) => s.split('\n').reverse().join('\n')],
    ['missing checksum', (s: string) => s.replace(/ sha256=[0-9a-f]+/, '')],
  ])('%s is malformed', (_n, mangle) => {
    expect(inspectBlock(mangle(appendBlock('', 'bootstrap', body)), 'bootstrap', body).state).toBe('malformed');
  });

  it('a foreign block nested inside is malformed', () => {
    const inner = renderBlock('agent', 'x');
    const r = renderBlock('bootstrap', body).split('\n');
    r.splice(2, 0, ...inner.trimEnd().split('\n'));
    expect(inspectBlock(r.join('\n'), 'bootstrap', body).state).toBe('malformed');
  });

  it('markers inside a fenced code block are examples, not blocks', () => {
    const text = '# Docs\n\n```md\n' + renderBlock('bootstrap', 'x') + '```\n';
    expect(inspectBlock(text, 'bootstrap', body).state).toBe('absent');
  });

  it('prose() drops fenced code and HTML comments', () => {
    const t = 'keep CAPTURE_IDEA\n```\nhidden-fence\n```\n<!-- hidden-comment -->\n';
    expect(prose(t)).toContain('keep');
    expect(prose(t)).not.toContain('hidden-fence');
    expect(prose(t)).not.toContain('hidden-comment');
  });
});
