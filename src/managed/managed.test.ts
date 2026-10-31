import { describe, expect, it } from 'vitest';
import { appendBlock, planAppend, planRefresh, blockBody, bodyHash, inspectBlock, prose, refreshBlock, renderBlock } from './index.js';

const body = blockBody('bootstrap', '.monolith');
const pristine = (text: string) => {
  const st = inspectBlock(text, 'bootstrap', body);
  if (st.state !== 'pristine') throw new Error(`expected pristine, got ${st.state}`);
  return st;
};

const block0 = () => renderBlock('bootstrap', body);

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

  describe('HTML comments (N-1)', () => {
    const block = renderBlock('bootstrap', body);

    it('refuses to append after an unclosed <!--, and says why', () => {
      const r = planAppend('# T\n<!-- todo\n', 'bootstrap', body);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.detail).toMatch(/unclosed HTML comment/);
    });

    it('appends after closed comments (several, Unicode, CRLF) and stays outside them', () => {
      for (const eol of ['\n', '\r\n']) {
        const text = `# Заметки ✓${eol}<!-- один -->${eol}текст <!-- два${eol}ещё -->${eol}`;
        const r = planAppend(text, 'bootstrap', body);
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.content.startsWith(text)).toBe(true);
          expect(inspectBlock(r.content, 'bootstrap', body).state).toBe('pristine');
        }
      }
    });

    it('a block wholly inside a comment is malformed, not installed', () => {
      const text = '<!--\n' + block + '-->\n';
      expect(inspectBlock(text, 'bootstrap', body).state).toBe('malformed');
    });

    it('a block inside a comment is not re-appended around: CONFLICT, never COMPLETE', () => {
      expect(planAppend('<!--\n' + block + '-->\n', 'bootstrap', body).ok).toBe(false);
    });

    it('an unclosed comment before an existing block makes it malformed', () => {
      expect(inspectBlock('<!-- x\n' + block, 'bootstrap', body).state).toBe('malformed');
    });

    it('an unclosed comment opened inside a fence is just fence text', () => {
      const text = '```\n<!-- not a comment\n```\n';
      expect(planAppend(text, 'bootstrap', body).ok).toBe(true);
    });

    it('re-planning over a correct block stays current (idempotent)', () => {
      const r = planAppend('# T\n<!-- c -->\n', 'bootstrap', body);
      if (!r.ok) throw new Error(r.detail);
      const st = pristine(r.content);
      const again = planRefresh(r.content, st, 'bootstrap', body);
      expect(again.ok && again.content).toBe(r.content);
    });
  });

  describe('BOM and fences (N-2)', () => {
    const BOM = '﻿';

    it('BOM + unclosed fence is refused', () => {
      for (const eol of ['\n', '\r\n']) expect(planAppend(`${BOM}\`\`\`md${eol}x${eol}`, 'bootstrap', body).ok).toBe(false);
    });

    it('BOM + closed fence appends, keeping the BOM bytes and being idempotent', () => {
      for (const eol of ['\n', '\r\n']) {
        const text = `${BOM}\`\`\`${eol}code${eol}\`\`\`${eol}`;
        const r = planAppend(text, 'bootstrap', body);
        if (!r.ok) throw new Error(r.detail);
        expect(Buffer.from(r.content).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
        expect(r.content.startsWith(text)).toBe(true);
        const again = planRefresh(r.content, pristine(r.content), 'bootstrap', body);
        expect(again.ok && again.content).toBe(r.content);
      }
    });

    it('BOM + plain text, and a BOM-only file, append', () => {
      expect(planAppend(`${BOM}# Title\n`, 'bootstrap', body).ok).toBe(true);
      expect(planAppend(BOM, 'bootstrap', body).ok).toBe(true);
    });

    it('a BOM-prefixed fence hides the markers inside it', () => {
      expect(inspectBlock(`${BOM}\`\`\`\n${block0()}\`\`\`\n`, 'bootstrap', body).state).toBe('absent');
    });

    it('a BOM before an existing begin marker on line 0 still counts as a block', () => {
      expect(inspectBlock(BOM + block0(), 'bootstrap', body).state).toBe('pristine');
    });
  });
});
