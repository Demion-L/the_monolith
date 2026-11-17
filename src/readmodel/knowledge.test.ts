import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, lstatSync, realpathSync, rmSync, symlinkSync, linkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { readDashboardModel, parseHypotheses, parseAdr, HYPOTHESES_REL, ADR_DIR_REL } from './index.js';
import { MAX_ADR_BYTES, MAX_HYPOTHESES_BYTES, MAX_KNOWLEDGE_ITEMS, MAX_SUMMARY_CHARS } from './knowledge.js';

let dir: string;
let outside: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'kn-proj-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'kn-out-')));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function write(rel: string, content: string | Buffer, base = dir): void {
  const abs = join(base, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}
const HYP = `.monolith/${HYPOTHESES_REL}`;
const adr = (id: string, extra = '', status = 'accepted', title = 'Some decision') =>
  `---\ntype: adr\nid: ${id}\ntitle: ${title}\nstatus: ${status}\n${extra}---\n\n# ${id}\n`;
const codes = (d: { issues: { code: string }[] } | null | undefined) => (d?.issues ?? []).map((i) => i.code);

describe('parseHypotheses', () => {
  const doc = [
    '# Hypotheses', '', '## Status Legend', '', '| a | b |', '',
    '## First one {#HYP-005}', '', '**Status:** `active`', '', '**Statement:**', 'Body text', 'continues.', '',
    '## Second {#HYP-010}', '', '**Status:** validated', '',
  ].join('\n');

  it('reads headings with markers, statuses and a plain summary; ignores unmarked sections', () => {
    const d = parseHypotheses(doc, 'p.md');
    expect(d.items).toEqual([
      { id: 'HYP-005', title: 'First one', status: 'active', summary: 'Body text continues.', path: 'p.md' },
      { id: 'HYP-010', title: 'Second', status: 'validated', summary: null, path: 'p.md' },
    ]);
    expect(d.complete).toBe(true);
  });

  it('ignores fake headings, statuses and text inside code fences and HTML comments', () => {
    const text = [
      '## Real {#HYP-001}', '', '**Status:** active', '', 'Real text.', '',
      '```md', '## Fake {#HYP-002}', '**Status:** validated', '```', '',
      '<!--', '## Hidden {#HYP-003}', '-->', '',
      '~~~', '## Tilde {#HYP-004}', '~~~', '',
    ].join('\n');
    const d = parseHypotheses(text, 'p.md');
    expect(d.items.map((i) => [i.id, i.status])).toEqual([['HYP-001', 'active']]);
  });

  it('an unterminated fence hides the rest instead of inventing entries', () => {
    const d = parseHypotheses('## A {#HYP-001}\n**Status:** active\n```\n## B {#HYP-002}\n', 'p.md');
    expect(d.items.map((i) => i.id)).toEqual(['HYP-001']);
  });

  it('duplicate ids are ambiguous: none is shown, a warn issue is reported', () => {
    const d = parseHypotheses('## A {#HYP-001}\n**Status:** active\n\n## B {#HYP-001}\n**Status:** rejected\n\n## C {#HYP-002}\n**Status:** active\n', 'p.md');
    expect(d.items.map((i) => i.id)).toEqual(['HYP-002']);
    expect(d.issues).toContainEqual({ code: 'HYP_ID_DUPLICATE', severity: 'warn', path: 'p.md', id: 'HYP-001', reason: null });
    expect(d.complete).toBe(false);
  });

  it('keeps an unknown status verbatim and never defaults a missing one', () => {
    const d = parseHypotheses('## A {#HYP-001}\n**Status:** maybe-later\n\n## B {#HYP-002}\n\ntext\n\n## C {#HYP-003}\n**Status:**\n', 'p.md');
    expect(d.items.map((i) => i.status)).toEqual(['maybe-later', null, null]);
    expect(codes(d)).toEqual(['HYP_STATUS_MISSING', 'HYP_STATUS_EMPTY']);
    expect(d.complete).toBe(true);
  });

  it('conflicting status lines give no status and a warning', () => {
    const d = parseHypotheses('## A {#HYP-001}\n**Status:** active\n**Status:** rejected\n', 'p.md');
    expect(d.items[0].status).toBeNull();
    expect(codes(d)).toEqual(['HYP_STATUS_CONFLICT']);
    expect(d.complete).toBe(false);
  });

  it('reports a malformed marker instead of dropping it silently', () => {
    const d = parseHypotheses('## A {#HYP-1x}\n**Status:** active\n', 'p.md');
    expect(d.items).toEqual([]);
    expect(codes(d)).toEqual(['HYP_HEADING_MALFORMED']);
  });

  it('empty document: confirmed no records, with an info issue', () => {
    const d = parseHypotheses('  \n', 'p.md');
    expect(d.items).toEqual([]);
    expect(codes(d)).toEqual(['DOCUMENT_EMPTY']);
    expect(d.complete).toBe(true);
  });

  it('handles CRLF, a missing description and bounds long text', () => {
    const d = parseHypotheses(`## A {#HYP-001}\r\n**Status:** active\r\n\r\n${'x'.repeat(5000)}\r\n`, 'p.md');
    expect(d.items[0].status).toBe('active');
    expect(d.items[0].summary!.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    expect(parseHypotheses('## A {#HYP-001}\n**Status:** active\n', 'p.md').items[0].summary).toBeNull();
  });

  it('keeps markup as plain text (no HTML interpretation in Core)', () => {
    const d = parseHypotheses('## <b>T</b> {#HYP-001}\n**Status:** active\n\n<script>alert(1)</script>\n', 'p.md');
    expect(d.items[0].title).toBe('<b>T</b>');
    expect(d.items[0].summary).toBe('<script>alert(1)</script>');
  });

  it('caps the number of items and says so', () => {
    const text = Array.from({ length: MAX_KNOWLEDGE_ITEMS + 5 }, (_, i) => `## H${i} {#HYP-${String(i + 1).padStart(3, '0')}}\n**Status:** active\n`).join('\n');
    const d = parseHypotheses(text, 'p.md');
    expect(d.items).toHaveLength(MAX_KNOWLEDGE_ITEMS);
    expect(codes(d)).toContain('ITEMS_TRUNCATED');
    expect(d.complete).toBe(false);
  });
});

describe('parseAdr', () => {
  const one = (text: string, name = 'ADR-020-x.md') => parseAdr(text, name, `docs/adr/${name}`);

  it('reads id, title, status and declared supersession (scalar and list forms)', () => {
    const r = one(adr('ADR-020', 'supersedes: ADR-007\nsuperseded_by:\n  - ADR-030\n  - ADR-031\n'));
    expect(r.item).toEqual({
      id: 'ADR-020', title: 'Some decision', status: 'accepted', summary: null, path: 'docs/adr/ADR-020-x.md',
      supersedes: ['ADR-007'], supersededBy: ['ADR-030', 'ADR-031'],
    });
    expect(r.issues.list).toEqual([]);
  });

  it('never infers supersession', () => {
    const r = one(adr('ADR-020', '', 'superseded'));
    expect(r.item!.supersedes).toBeUndefined();
    expect(r.item!.supersededBy).toBeUndefined();
  });

  it('rejects a malformed link value, keeping valid ones', () => {
    const r = one(adr('ADR-020', 'supersedes: [ADR-007, nonsense]\n'));
    expect(r.item!.supersedes).toEqual(['ADR-007']);
    expect(r.issues.list.map((i) => i.code)).toEqual(['ADR_LINK_INVALID']);
  });

  it('handles CRLF frontmatter', () => {
    expect(one(adr('ADR-020').replace(/\n/g, '\r\n')).item).toMatchObject({ id: 'ADR-020', status: 'accepted' });
  });

  it('id/filename mismatch: item kept as declared, with an explicit warn', () => {
    const r = one(adr('adr-020'));
    expect(r.item!.id).toBe('adr-020');
    expect(r.issues.list).toMatchObject([{ code: 'ADR_ID_MISMATCH', severity: 'warn', id: 'adr-020' }]);
  });

  it('malformed or missing frontmatter yields no item and a typed issue', () => {
    expect(one('---\nid: ADR-020\nno close\n').issues.list[0]).toMatchObject({ code: 'ADR_FRONTMATTER_MALFORMED', severity: 'warn' });
    expect(one('# Just a doc\n').issues.list[0]).toMatchObject({ code: 'ADR_FRONTMATTER_MISSING', severity: 'info' });
    expect(one('---\ntitle: x\n---\n').issues.list[0]).toMatchObject({ code: 'ADR_ID_MISSING' });
    expect(one('---\nid: "bad id <b>"\n---\n').issues.list[0]).toMatchObject({ code: 'ADR_ID_INVALID' });
    expect(one('---\nid: ADR-020\nid: ADR-021\n---\n').item).toBeNull();
  });

  it('keeps an unknown status verbatim and a missing one null', () => {
    expect(one(adr('ADR-020', '', 'draft')).item!.status).toBe('draft');
    const r = one('---\nid: ADR-020\ntitle: T\n---\n');
    expect(r.item!.status).toBeNull();
    expect(r.issues.list[0]).toMatchObject({ code: 'ADR_STATUS_MISSING', severity: 'info' });
  });

  it('title falls back to the first H1 outside fences only when frontmatter has none', () => {
    const r = one('---\nid: ADR-020\nstatus: accepted\n---\n```\n# Fake\n```\n# Real title\n');
    expect(r.item!.title).toBe('Real title');
  });
});

describe('readDashboardModel — knowledge sections', () => {
  it('reads real hypotheses and ADRs through the model, additively', () => {
    write('monolith.config.json', JSON.stringify({ project: { name: 'X' } }));
    write(HYP, '## A {#HYP-001}\n**Status:** active\n\nText\n');
    write(`${ADR_DIR_REL}/ADR-001-a.md`, adr('ADR-001', 'superseded_by: ADR-002\n', 'superseded'));
    write(`${ADR_DIR_REL}/ADR-002-b.md`, adr('ADR-002', 'supersedes: ADR-001\n'));
    write(`${ADR_DIR_REL}/README.md`, '# Index\n');
    const m = readDashboardModel(dir);
    expect(m.hypotheses!.sources).toEqual([{ id: 'hypotheses', path: HYP, status: 'available', code: null }]);
    expect(m.hypotheses!.data!.items.map((i) => i.id)).toEqual(['HYP-001']);
    expect(m.decisions!.sources).toEqual([{ id: 'decisions', path: ADR_DIR_REL, status: 'available', code: null }]);
    expect(m.decisions!.data!.items.map((i) => [i.id, i.status])).toEqual([['ADR-001', 'superseded'], ['ADR-002', 'accepted']]);
    // Existing contract untouched: same four sources, same order.
    expect(m.diagnostics.sources.map((s) => s.id)).toEqual(['config', 'state', 'activeStory', 'roadmap']);
  });

  it('missing sources are NOT_AVAILABLE (data null, status absent), never an empty list', () => {
    const m = readDashboardModel(dir);
    expect(m.hypotheses).toEqual({ data: null, sources: [{ id: 'hypotheses', path: HYP, status: 'absent', code: 'SOURCE_ABSENT' }] });
    expect(m.decisions).toEqual({ data: null, sources: [{ id: 'decisions', path: ADR_DIR_REL, status: 'absent', code: 'SOURCE_ABSENT' }] });
  });

  it('an existing but empty ADR directory is AVAILABLE and empty', () => {
    mkdirSync(join(dir, ADR_DIR_REL), { recursive: true });
    const m = readDashboardModel(dir);
    expect(m.decisions!.data).toEqual({ items: [], issues: [], complete: true });
  });

  it('an empty hypotheses file is AVAILABLE and empty', () => {
    write(HYP, '');
    const d = readDashboardModel(dir).hypotheses!;
    expect(d.sources[0].status).toBe('available');
    expect(d.data!.items).toEqual([]);
  });

  it('invalid UTF-8 is an ERROR (data null), not decoded with replacement characters', () => {
    write(HYP, Buffer.concat([Buffer.from('## A {#HYP-001}\n**Status:** active\n'), Buffer.from([0xff, 0xfe, 0x41])]));
    const h = readDashboardModel(dir).hypotheses!;
    expect(h.data).toBeNull();
    expect(h.sources[0]).toMatchObject({ status: 'unreadable', code: 'SOURCE_UNREADABLE' });
  });

  it('an invalid-UTF-8 ADR is reported per file; the others stay, and the list is flagged incomplete', () => {
    write(`${ADR_DIR_REL}/ADR-001-a.md`, adr('ADR-001'));
    write(`${ADR_DIR_REL}/ADR-002-b.md`, Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xc3, 0x28]));
    const d = readDashboardModel(dir).decisions!.data!;
    expect(d.items.map((i) => i.id)).toEqual(['ADR-001']);
    expect(d.issues).toEqual([{ code: 'ADR_FILE_UNREADABLE', severity: 'warn', path: `${ADR_DIR_REL}/ADR-002-b.md`, id: null, reason: 'SOURCE_UNREADABLE' }]);
    expect(d.complete).toBe(false);
  });

  it('duplicate ADR ids hide both documents and report the id', () => {
    write(`${ADR_DIR_REL}/ADR-001-a.md`, adr('ADR-001'));
    write(`${ADR_DIR_REL}/ADR-001-b.md`, adr('ADR-001'));
    write(`${ADR_DIR_REL}/ADR-003-c.md`, adr('ADR-003'));
    const d = readDashboardModel(dir).decisions!.data!;
    expect(d.items.map((i) => i.id)).toEqual(['ADR-003']);
    expect(d.issues).toMatchObject([{ code: 'ADR_ID_DUPLICATE', id: 'ADR-001', severity: 'warn' }]);
  });

  it('a non-ADR file named ADR-* without a number is reported, not read as an ADR', () => {
    write(`${ADR_DIR_REL}/ADR-notes.md`, adr('ADR-009'));
    const d = readDashboardModel(dir).decisions!.data!;
    expect(d.items).toEqual([]);
    expect(codes(d)).toEqual(['ADR_FILENAME_UNRECOGNIZED']);
  });

  it('oversized sources are refused whole, never truncated', () => {
    write(HYP, 'a'.repeat(MAX_HYPOTHESES_BYTES + 1));
    write(`${ADR_DIR_REL}/ADR-001-a.md`, `---\nid: ADR-001\n---\n${'a'.repeat(MAX_ADR_BYTES + 1)}`);
    const m = readDashboardModel(dir);
    expect(m.hypotheses!.data).toBeNull();
    expect(m.hypotheses!.sources[0]).toMatchObject({ status: 'unreadable', code: 'SOURCE_TOO_LARGE' });
    expect(m.decisions!.data!.issues).toMatchObject([{ code: 'ADR_FILE_UNREADABLE', reason: 'SOURCE_TOO_LARGE' }]);
  });

  describe('symlinks and hardlinks', () => {
    it('a symlinked hypotheses file is forbidden and its target is not served', () => {
      write('secret.md', '## Leak {#HYP-666}\n**Status:** active\n', outside);
      mkdirSync(join(dir, '.monolith/memory/long-term'), { recursive: true });
      symlinkSync(join(outside, 'secret.md'), join(dir, HYP));
      const h = readDashboardModel(dir).hypotheses!;
      expect(h.data).toBeNull();
      expect(h.sources[0]).toMatchObject({ status: 'forbidden', code: 'SOURCE_SYMLINK' });
      expect(JSON.stringify(h)).not.toContain('HYP-666');
    });

    it('a symlinked ADR directory is forbidden', () => {
      write('ADR-001-x.md', adr('ADR-001'), outside);
      mkdirSync(join(dir, 'docs'), { recursive: true });
      symlinkSync(outside, join(dir, ADR_DIR_REL));
      const d = readDashboardModel(dir).decisions!;
      expect(d.data).toBeNull();
      expect(d.sources[0]).toMatchObject({ status: 'forbidden', code: 'SOURCE_SYMLINK' });
    });

    it('a symlinked ADR file is rejected per file, its target is not read', () => {
      write('ADR-002-x.md', adr('ADR-002', '', 'accepted', 'LEAKED'), outside);
      write(`${ADR_DIR_REL}/ADR-001-a.md`, adr('ADR-001'));
      symlinkSync(join(outside, 'ADR-002-x.md'), join(dir, ADR_DIR_REL, 'ADR-002-x.md'));
      const d = readDashboardModel(dir).decisions!.data!;
      expect(d.items.map((i) => i.id)).toEqual(['ADR-001']);
      expect(d.issues).toMatchObject([{ code: 'ADR_FILE_UNREADABLE', reason: 'SOURCE_SYMLINK' }]);
      expect(JSON.stringify(d)).not.toContain('LEAKED');
    });

    it('a dangling symlink and a hardlinked file are rejected', () => {
      write(`${ADR_DIR_REL}/ADR-001-a.md`, adr('ADR-001'));
      symlinkSync(join(outside, 'nope.md'), join(dir, ADR_DIR_REL, 'ADR-002-b.md'));
      write('h.md', adr('ADR-003'), outside);
      linkSync(join(outside, 'h.md'), join(dir, ADR_DIR_REL, 'ADR-003-c.md'));
      const d = readDashboardModel(dir).decisions!.data!;
      expect(d.items.map((i) => i.id)).toEqual(['ADR-001']);
      expect(d.issues.map((i) => i.reason).sort()).toEqual(['SOURCE_HARDLINKED', 'SOURCE_SYMLINK']);
    });

    it('a symlinked monolithRoot component cannot be used to escape the project', () => {
      write('monolith.config.json', JSON.stringify({ monolithRoot: '../x' }));
      write('long-term-secret', '', outside);
      const m = readDashboardModel(dir);
      expect(m.hypotheses!.data).toBeNull();
      expect(m.hypotheses!.sources[0]).toMatchObject({ status: 'forbidden' });
      expect(m.decisions!.data).toBeNull();
    });
  });

  it('path traversal in a file name cannot occur: only listed names of the fixed directory are read', () => {
    write(`${ADR_DIR_REL}/ADR-001-a.md`, adr('ADR-001'));
    const d = readDashboardModel(dir).decisions!.data!;
    expect(d.items.every((i) => i.path!.startsWith(`${ADR_DIR_REL}/ADR-`) && !i.path!.includes('..'))).toBe(true);
  });

  it('writes nothing and is deterministic', () => {
    write(HYP, '## A {#HYP-001}\n**Status:** active\n');
    write(`${ADR_DIR_REL}/ADR-001-a.md`, adr('ADR-001'));
    const snap = (): string => {
      const out: string[] = [];
      const walk = (d: string): void => {
        for (const e of readdirSync(d).sort()) {
          const p = join(d, e);
          const st = lstatSync(p);
          out.push(`${p}:${st.mtimeMs}:${st.size}`);
          if (st.isDirectory()) walk(p);
          else out.push(readFileSync(p, 'utf8'));
        }
      };
      walk(dir);
      return out.join('\n');
    };
    const before = snap();
    const a = readDashboardModel(dir);
    expect(readDashboardModel(dir)).toEqual(a);
    expect(snap()).toBe(before);
  });
});

describe('real docs/adr (regression: NOTE-1 false INCOMPLETE)', () => {
  it('every ADR declares an id equal to its file name id, so the repository ADR list is complete', async () => {
    const { readDecisions } = await import('./knowledge.js');
    const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
    const { data } = readDecisions(root);
    expect(data).not.toBeNull();
    expect((data?.issues ?? []).filter((i) => i.severity === 'warn')).toEqual([]);
    expect(data?.complete).toBe(true);
  });
});
