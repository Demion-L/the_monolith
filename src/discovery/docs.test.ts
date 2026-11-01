import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { validateDiscoveryResult } from './contracts.js';
import { extractProjectFacts } from './facts.js';
import { renderProjectMapProposal } from './render.js';
import { traverseProject, type TraversalEntry, type TraversalResult } from './traverse.js';
import {
  DEFAULT_DOCUMENTATION_LIMITS,
  analyzeDocumentation,
  classifyLinkTarget,
  parseMarkdownStructure,
  validateDocumentationResult,
  type DocumentReader,
  type DocumentationResult,
  type HeadingObservation,
  type LinkObservation,
  type SectionObservation,
} from './docs.js';

// DISCOVERY-001B-2D — deterministic Markdown documentation analyzer. Fixtures are throwaway mkdtemp
// trees outside the repository. Nothing here claims protection against a concurrent swap
// (SEC-001B.3, TM-C): the TOCTOU tests cover the gap between traversal and read, which IS defended.

const sandboxes: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (sandboxes.length > 0) rmSync(sandboxes.pop() as string, { recursive: true, force: true });
});

function project(files: Record<string, string | Buffer> = {}): { root: string; base: string } {
  const base = mkdtempSync(join(tmpdir(), 'monolith-docs-'));
  sandboxes.push(base);
  const root = join(base, 'project');
  mkdirSync(root);
  for (const [rel, data] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), data);
  }
  return { root, base };
}

function run(files: Record<string, string | Buffer>, limits: Parameters<typeof analyzeDocumentation>[2] = {}): { root: string; result: DocumentationResult; trav: TraversalResult } {
  const { root } = project(files);
  const trav = traverseProject(root);
  return { root, trav, result: analyzeDocumentation(root, trav, limits) };
}

const SMALL = { maxHeadings: 500, maxLinks: 1000, maxTextLength: 200, maxTargetLength: 2048, maxLineLength: 8192 };
const parse = (md: string, over: Partial<typeof SMALL> = {}) => parseMarkdownStructure(md, { ...SMALL, ...over });
const headings = (r: DocumentationResult, path?: string) => r.observations.filter((o): o is HeadingObservation => o.kind === 'HEADING' && (path === undefined || o.source.path === path));
const linksOf = (r: DocumentationResult, path?: string) => r.observations.filter((o): o is LinkObservation => o.kind === 'LINK' && (path === undefined || o.source.path === path));
const sectionsOf = (r: DocumentationResult, path?: string) => r.observations.filter((o): o is SectionObservation => o.kind === 'SECTION' && (path === undefined || o.source.path === path));
const codes = (r: DocumentationResult) => r.diagnostics.map((d) => d.code);

function fakeTraversal(entries: TraversalEntry[], over: Partial<TraversalResult> = {}): TraversalResult {
  return {
    completeness: 'COMPLETE',
    reproducible: true,
    limits: { maxEntries: 1, maxEntriesPerDir: 1, maxDepth: 1, deadlineMs: 1, maxPathBytes: 1 },
    stats: { entries: entries.length, files: 0, directories: 0, symlinks: 0, other: 0, examined: 0, pathBytes: 0, listedDirectories: 0 },
    entries,
    diagnostics: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
describe('functional', () => {
  it('records README.md: presence, headings, links, sections', () => {
    const { result } = run({ 'README.md': '# Title\n\nSome text.\n\nSee [guide](docs/guide.md).\n' });
    expect(validateDocumentationResult(result)).toEqual([]);
    expect(result.assertion).toBe('DOCUMENT_CONTENT_NOT_VERIFIED');
    const doc = result.observations[0];
    expect(doc).toMatchObject({ kind: 'DOCUMENT_PRESENT', analysis: 'ANALYZED', lines: 5, evidence: 'OBSERVED_FILE', source: { path: 'README.md', observation: 'markdown-file' } });
    expect(headings(result)).toMatchObject([{ level: 1, text: 'Title', ordinal: 1, source: { startLine: 1, endLine: 1 } }]);
    expect(linksOf(result)).toMatchObject([{ text: 'guide', target: 'docs/guide.md', linkType: 'relative', source: { startLine: 5 } }]);
    expect(sectionsOf(result)).toMatchObject([{ headingOrdinal: 1, source: { startLine: 1, endLine: 5 }, ownTextLineGroups: 2 }]);
    expect(result.completeness).toBe('COMPLETE');
  });

  it('records Markdown files below docs/, nested too, and only those', () => {
    const { result } = run({
      'docs/a.md': '# A\n',
      'docs/sub/b.MD': '# B\n',
      'docs/notes.txt': '# not markdown\n',
      'src/README.md': '# elsewhere\n',
      'CHANGELOG.md': '# outside the minimal set\n',
      'readme.md': '# wrong case\n',
    });
    const paths = result.observations.filter((o) => o.kind === 'DOCUMENT_PRESENT').map((o) => o.source.path);
    expect(paths).toEqual(['docs/a.md', 'docs/sub/b.MD']);
    expect(headings(result).map((h) => h.text)).toEqual(['A', 'B']);
  });

  it('handles several documents; README first in the budget, the rest by depth and path', () => {
    const { result } = run({ 'README.md': '# R\n', 'docs/z.md': '# Z\n', 'docs/a.md': '# A\n', 'docs/deep/c.md': '# C\n' }, { limits: { maxDocuments: 3 } });
    const paths = result.observations.filter((o) => o.kind === 'DOCUMENT_PRESENT').map((o) => o.source.path);
    expect(paths).toEqual(['README.md', 'docs/a.md', 'docs/z.md']);
    expect(codes(result)).toContain('DOC_LIMIT_DOCUMENTS');
    expect(result.completeness).toBe('PARTIAL');
  });

  it('an empty document is present, analysed, has no content observations, and is not a failure', () => {
    const { result } = run({ 'README.md': '' });
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({ kind: 'DOCUMENT_PRESENT', analysis: 'ANALYZED', bytes: 0, lines: 0 });
    expect(codes(result)).toEqual(['DOC_EMPTY']);
    expect(result.completeness).toBe('COMPLETE');
    expect(validateDocumentationResult(result)).toEqual([]);
  });

  it('a document without headings has no headings and no sections', () => {
    const { result } = run({ 'README.md': 'Just text.\n\n- a list\n' });
    expect(headings(result)).toEqual([]);
    expect(sectionsOf(result)).toEqual([]);
    expect(result.observations).toHaveLength(1);
  });

  it('nested headings: hierarchical sections, parents, own text groups', () => {
    const md = ['# A', 'a1', '', '## B', 'b1', '', 'b2', '### C', 'c1', '## D', '# E', 'e1'].join('\n');
    const { result } = run({ 'README.md': md });
    const s = sectionsOf(result).map((x) => ({ n: x.headingOrdinal, from: x.source.startLine, to: x.source.endLine, parent: x.parentHeadingOrdinal, own: x.ownTextLineGroups }));
    expect(s).toEqual([
      { n: 1, from: 1, to: 10, parent: undefined, own: 1 },
      { n: 2, from: 4, to: 9, parent: 1, own: 2 },
      { n: 3, from: 8, to: 9, parent: 2, own: 1 },
      { n: 4, from: 10, to: 10, parent: 1, own: 0 },
      { n: 5, from: 11, to: 12, parent: undefined, own: 1 },
    ]);
    expect(headings(result).map((h) => h.level)).toEqual([1, 2, 3, 2, 1]); // order of appearance
  });

  it('classifies relative, anchor, external and other targets without resolving them', () => {
    const md = '[r](./a/b.md) [r2](../x) [a](#top) [e](https://example.com/x) [e2](HTTP://EXAMPLE.COM) [p](//cdn.example.com/x) [m](mailto:a@b.c) [j](javascript:alert) [root](/abs/path)';
    const { result } = run({ 'README.md': md });
    expect(linksOf(result).map((l) => [l.target, l.linkType])).toEqual([
      ['./a/b.md', 'relative'],
      ['../x', 'relative'],
      ['#top', 'anchor'],
      ['https://example.com/x', 'external'],
      ['HTTP://EXAMPLE.COM', 'external'],
      ['//cdn.example.com/x', 'external'],
      ['mailto:a@b.c', 'other'],
      ['javascript:alert', 'other'],
      ['/abs/path', 'other'],
    ]);
    expect(classifyLinkTarget('C:\\x')).toBe('other');
  });

  it('a claim in prose yields structure only: nothing about PostgreSQL is extracted', () => {
    const { result } = run({ 'README.md': '# Architecture\n\nThe application uses PostgreSQL.\n' });
    expect(JSON.stringify(result.observations)).not.toMatch(/PostgreSQL|uses/);
    expect(headings(result).map((h) => h.text)).toEqual(['Architecture']);
    expect(sectionsOf(result)[0]?.ownTextLineGroups).toBe(1);
    for (const o of result.observations) expect(o.evidence).toBe(o.kind === 'DOCUMENT_PRESENT' ? 'OBSERVED_FILE' : 'DOCUMENT_TEXT');
  });
});

// ---------------------------------------------------------------------------
describe('markdown correctness', () => {
  it('ignores headings and links inside fenced code blocks (backtick and tilde, longer closers)', () => {
    const md = ['# Real', '```', '# not a heading', '[no](link)', '```', '~~~~sh', '# nope', '~~~', '# still code', '~~~~', '## After', '[yes](y.md)'].join('\n');
    const p = parse(md);
    expect(p.headings.map((h) => h.text)).toEqual(['Real', 'After']);
    expect(p.links.map((l) => l.target)).toEqual(['y.md']);
  });

  it('an unclosed fence swallows the rest and says so', () => {
    const { result } = run({ 'README.md': '# A\n```\n# B\n[x](y)\n' });
    expect(headings(result).map((h) => h.text)).toEqual(['A']);
    expect(linksOf(result)).toEqual([]);
    expect(result.diagnostics.find((d) => d.code === 'DOC_UNCLOSED_FENCE')?.message).toMatch(/line 2/);
    expect(result.completeness).toBe('COMPLETE'); // as CommonMark: the rest IS code
  });

  it('a backtick fence whose info string contains a backtick is not a fence', () => {
    const p = parse('``` a`b\n# H\n');
    expect(p.headings.map((h) => h.text)).toEqual(['H']);
  });

  it('escaped headings are not headings; non-headings stay non-headings', () => {
    const p = parse(['\\# escaped', '#hashtag', '####### seven', '    # indented', '  # two spaces', '#\tTab', '#'].join('\n'));
    expect(p.headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'two spaces'],
      [1, 'Tab'],
      [1, ''],
    ]);
    expect(p.notes.indentedLines).toBe(1);
  });

  it('strips the closing sequence of an ATX heading, keeps escaped hashes', () => {
    const p = parse(['## Title ##', '### C# language', '# foo \\#', '# ###', '## a ## b'].join('\n'));
    expect(p.headings.map((h) => h.text)).toEqual(['Title', 'C# language', 'foo \\#', '', 'a ## b']);
  });

  it('escaped links, code spans, images and HTML tags do not yield links', () => {
    const md = ['\\[a](b)', '[a\\](b)', '`[c](d)`', '``[e](f)``', '![img](i.png)', '<a href="x">t</a> <img alt="[g](h)">', '<https://auto.link>', '\\![kept](k.md)', '[ok](o.md)'].join('\n');
    const p = parse(md);
    expect(p.links.map((l) => l.target)).toEqual(['k.md', 'o.md']);
  });

  it('a code span that opens on one line hides text until it closes in the same paragraph', () => {
    const p = parse('a `code\n[hidden](h) more` [seen](s)\n\n[next](n)');
    expect(p.links.map((l) => l.target)).toEqual(['s', 'n']);
    const q = parse('a ` never closed [x](y)\n\n[after](a)');
    expect(q.links.map((l) => l.target)).toEqual(['a']); // omitted, never invented
  });

  it('supports titles, angle-bracket targets and balanced parentheses; refuses multiline and nested constructs', () => {
    const md = ['[t](a.md "Title")', "[t](b.md 'T')", '[t](c.md (T))', '[t](<d e.md>)', '[t](f(g).md)', '[t](h.md', '[t]\n(i.md)', '[[n]](j.md)', '[t] (k.md)', '[](empty-text.md)', '[t]()'].join('\n');
    const p = parse(md);
    expect(p.links.map((l) => l.target)).toEqual(['a.md', 'b.md', 'c.md', 'd e.md', 'f(g).md', 'empty-text.md']);
    expect(p.links[5]?.text).toBe('');
  });

  it('CRLF, lone CR and a BOM give the same structure as LF', () => {
    const lf = '# A\n\ntext\n\n## B\n[l](x.md)\n';
    const base = parse(lf);
    for (const variant of [lf.replace(/\n/g, '\r\n'), lf.replace(/\n/g, '\r'), '\ufeff' + lf]) {
      const p = parse(variant);
      expect(p).toEqual(base);
    }
    expect(base.lines).toBe(6);
    expect(base.headings[1]?.line).toBe(5);
  });

  it('Unicode text is kept as written; astral characters are not split on truncation', () => {
    const p = parse('# Архитектура 🏗️ 日本語\n[ссылка](文档.md)\n');
    expect(p.headings[0]?.text).toBe('Архитектура 🏗️ 日本語');
    expect(p.links[0]).toMatchObject({ text: 'ссылка', target: '文档.md' });
    const cut = parse('# ' + '😀'.repeat(150), { maxTextLength: 201 });
    expect(cut.headings[0]?.textStatus).toBe('TRUNCATED');
    expect(cut.headings[0]?.text.length).toBe(200); // 201 would split the last pair
    expect(Array.from(cut.headings[0]?.text ?? '').every((c) => c === '😀')).toBe(true);
  });

  it('unsafe characters withhold the text instead of leaking or altering it', () => {
    const p = parse('# bidi \u202e text\n[evil\u0000](ok.md)\n[t](bad\u0007target)');
    expect(p.headings[0]).toMatchObject({ text: '', textStatus: 'WITHHELD' });
    expect(p.links).toHaveLength(1);
    expect(p.links[0]).toMatchObject({ text: '', textStatus: 'WITHHELD', target: 'ok.md' });
  });

  it('malformed Markdown never throws and never invents structure', () => {
    const junk = ['[', ']', '](', '[a](', '[a](b', '[[[[[', '))))', '`', '```', '~~~', '<!--', '<', '<a', '#', '![', '\\', '[a]( "', '[a](b "c'];
    for (const piece of junk) {
      for (const text of [piece, `${piece}\n${piece}`, `x ${piece} y\n\n${piece}`]) {
        const p = parse(text);
        expect(p.links).toEqual([]);
      }
    }
  });

  it('skips front matter, HTML comments, setext headings, with diagnostics and without sections', () => {
    const fm = parse('---\ntitle: x\n# yaml comment\n---\n# Real\n');
    expect(fm.headings.map((h) => h.text)).toEqual(['Real']);
    expect(fm.headings[0]?.line).toBe(5);
    expect(fm.notes.frontMatterLines).toBe(4);
    const noClose = parse('---\n# Real\n');
    expect(noClose.headings.map((h) => h.text)).toEqual(['Real']);

    const html = parse('<!-- start\n# hidden\n[h](h)\n-->\n# Seen\n<!-- one line [x](y) -->\n[ok](o)');
    expect(html.headings.map((h) => h.text)).toEqual(['Seen']);
    expect(html.links.map((l) => l.target)).toEqual(['o']);

    const { result } = run({ 'README.md': 'Title\n=====\n\n# Atx\n' });
    expect(headings(result).map((h) => h.text)).toEqual(['Atx']);
    expect(sectionsOf(result)).toEqual([]);
    expect(codes(result)).toEqual(expect.arrayContaining(['DOC_SETEXT_HEADING_UNSUPPORTED', 'DOC_SECTIONS_NOT_RECORDED']));
  });

  it('a list item followed by --- is not reported as a setext heading', () => {
    const p = parse('- item\n---\n# H\n');
    expect(p.notes.setextLines).toBe(0);
  });

  it('inline scanning stays fast on hostile lines', () => {
    const lines = [
      '['.repeat(8000),
      '[a]('.repeat(2000),
      '`'.repeat(4000) + '[a](b)',
      Array.from({ length: 90 }, (_, i) => '`'.repeat(i + 1)).join(' ') + ' [x](y)',
      '<a '.repeat(2500),
      '[a](b "'.repeat(1000),
    ];
    const start = Date.now();
    for (let i = 0; i < 20; i++) for (const l of lines) parse(`${l}\n${l}\n`);
    expect(Date.now() - start).toBeLessThan(8000);
  });
});

// ---------------------------------------------------------------------------
describe('security', () => {
  const SECRET = 'TOP-SECRET-OUTSIDE-CONTENT';

  it('does not follow a symlinked README.md or docs file out of the root', () => {
    const { root, base } = project({ 'docs/ok.md': '# Ok\n' });
    writeFileSync(join(base, 'outside.md'), `# ${SECRET}\n[x](${SECRET})\n`);
    symlinkSync(join(base, 'outside.md'), join(root, 'README.md'));
    symlinkSync(join(base, 'outside.md'), join(root, 'docs', 'link.md'));
    const result = analyzeDocumentation(root, traverseProject(root));
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result.observations.filter((o) => o.kind === 'DOCUMENT_PRESENT').map((o) => o.source.path)).toEqual(['docs/ok.md']);
    expect(result.diagnostics.filter((d) => d.code === 'DOC_NOT_REGULAR_FILE').map((d) => d.path)).toEqual(['README.md', 'docs/link.md']);
  });

  it('does not enter a symlinked docs directory', () => {
    const { root, base } = project({});
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside', 'a.md'), `# ${SECRET}\n`);
    symlinkSync(join(base, 'outside'), join(root, 'docs'));
    const result = analyzeDocumentation(root, traverseProject(root));
    expect(result.observations).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('TOCTOU between traversal and read: a file swapped for a symlink is refused, not read', () => {
    const { root, base } = project({ 'README.md': '# Original\n' });
    writeFileSync(join(base, 'outside.md'), `# ${SECRET}\n`);
    const trav = traverseProject(root);
    rmSync(join(root, 'README.md'));
    symlinkSync(join(base, 'outside.md'), join(root, 'README.md'));
    const result = analyzeDocumentation(root, trav);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result.diagnostics.find((d) => d.code === 'DOC_READ_FAILED')).toMatchObject({ path: 'README.md', message: expect.stringContaining('FILE_SYMLINK') });
    expect(result.observations).toMatchObject([{ kind: 'DOCUMENT_PRESENT', analysis: 'NOT_ANALYZED' }]);
    expect(result.completeness).toBe('PARTIAL');
    expect(result.reproducible).toBe(false);
  });

  it('TOCTOU: a swapped intermediate directory (docs -> outside) is refused', () => {
    const { root, base } = project({ 'docs/a.md': '# A\n' });
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside', 'a.md'), `# ${SECRET}\n`);
    const trav = traverseProject(root);
    renameSync(join(root, 'docs'), join(base, 'moved'));
    symlinkSync(join(base, 'outside'), join(root, 'docs'));
    const result = analyzeDocumentation(root, trav);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(codes(result)).toContain('DOC_READ_FAILED');
  });

  it('TOCTOU: a file replaced by a FIFO is not opened (no hang) and a listed FIFO is never read', () => {
    const { root } = project({ 'README.md': '# R\n', 'docs/a.md': '# A\n' });
    const trav = traverseProject(root);
    rmSync(join(root, 'README.md'));
    execFileSync('mkfifo', [join(root, 'README.md')]);
    const result = analyzeDocumentation(root, trav);
    expect(result.diagnostics.find((d) => d.code === 'DOC_READ_FAILED')).toMatchObject({ path: 'README.md', message: expect.stringContaining('FILE_NOT_REGULAR') });
    expect(headings(result).map((h) => h.text)).toEqual(['A']);

    const fresh = analyzeDocumentation(root, traverseProject(root));
    expect(fresh.diagnostics.find((d) => d.code === 'DOC_NOT_REGULAR_FILE')).toMatchObject({ path: 'README.md' });
  });

  it('a hard-linked document is refused', () => {
    const { root, base } = project({ 'README.md': '# R\n' });
    writeFileSync(join(base, 'other.md'), '# O\n');
    rmSync(join(root, 'README.md'));
    execFileSync('ln', [join(base, 'other.md'), join(root, 'README.md')]);
    const result = analyzeDocumentation(root, traverseProject(root));
    expect(result.diagnostics.find((d) => d.code === 'DOC_READ_FAILED')?.message).toContain('FILE_HARDLINKED');
  });

  it('never reads a file the traversal did not list', () => {
    const { root } = project({ 'README.md': '# R\n', 'docs/a.md': '# A\n' });
    const reader = vi.fn<DocumentReader>(() => ({ ok: false, code: 'FILE_MISSING', detail: '' }));
    analyzeDocumentation(root, fakeTraversal([{ path: 'docs', kind: 'directory' }]), { readDocument: reader });
    expect(reader).not.toHaveBeenCalled();
  });

  it('a document larger than the cap is not read; the per-document cap is enforced by the reader on actual bytes', () => {
    const { result, trav } = run({ 'README.md': '# R\n' + 'x'.repeat(2000), 'docs/a.md': '# A\n' }, { limits: { maxDocumentBytes: 1000 } });
    expect(trav.entries.length).toBeGreaterThan(0);
    expect(codes(result)).toContain('DOC_TOO_LARGE');
    expect(headings(result).map((h) => h.text)).toEqual(['A']);
    expect(result.completeness).toBe('PARTIAL');
    const exact = run({ 'README.md': '# R\n' + 'x'.repeat(996) }, { limits: { maxDocumentBytes: 1000 } });
    expect(exact.result.completeness).toBe('COMPLETE');
  });

  it('a reader that lies about the size or returns garbage cannot get past the cap or crash the analysis', () => {
    const { root } = project({ 'README.md': '# R\n' });
    const trav = traverseProject(root);
    const big: DocumentReader = () => ({ ok: true, path: '', size: 1, content: 'x'.repeat(5000) });
    expect(codes(analyzeDocumentation(root, trav, { limits: { maxDocumentBytes: 1000 }, readDocument: big }))).toContain('DOC_READ_FAILED');
    const garbage = (() => ({ ok: true, content: 42 })) as unknown as DocumentReader;
    expect(codes(analyzeDocumentation(root, trav, { readDocument: garbage }))).toContain('DOC_READ_FAILED');
    const throwing: DocumentReader = () => {
      throw new Error(`/etc/passwd secret ${SECRET}`);
    };
    const r = analyzeDocumentation(root, trav, { readDocument: throwing });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    const evil = (() => ({ ok: false, code: `X ${SECRET}`, detail: SECRET })) as unknown as DocumentReader;
    const e = analyzeDocumentation(root, trav, { readDocument: evil });
    expect(JSON.stringify(e)).not.toContain(SECRET);
    expect(e.diagnostics[0]?.message).toContain('UNKNOWN');
  });

  it('the total byte budget stops reading and says which documents were left out', () => {
    const doc = (n: string) => `# ${n}\n` + 'x'.repeat(400);
    const { result } = run({ 'README.md': doc('R'), 'docs/a.md': doc('A'), 'docs/b.md': doc('B'), 'docs/c.md': doc('C') }, { limits: { maxTotalBytes: 1300, maxDocumentBytes: 1000 } });
    expect(result.stats.bytesRead).toBeLessThanOrEqual(1300);
    const notAnalyzed = result.observations.filter((o) => o.kind === 'DOCUMENT_PRESENT' && o.analysis === 'NOT_ANALYZED').map((o) => o.source.path);
    expect(notAnalyzed.length).toBeGreaterThan(0);
    expect(result.diagnostics.find((d) => d.code === 'DOC_LIMIT_TOTAL_BYTES')?.count).toBe(notAnalyzed.length);
    expect(result.completeness).toBe('PARTIAL');
    expect(validateDocumentationResult(result)).toEqual([]);
  });

  it('excessive links and headings are cut deterministically, with sections consistent', () => {
    const md = Array.from({ length: 30 }, (_, i) => `## H${i}\n[l${i}](t${i}.md)\n`).join('\n');
    const { result } = run({ 'README.md': md }, { limits: { maxHeadingsPerDocument: 10, maxLinksPerDocument: 7 } });
    expect(headings(result)).toHaveLength(10);
    expect(linksOf(result).map((l) => l.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sectionsOf(result)).toHaveLength(10);
    const last = sectionsOf(result)[9];
    expect(last?.source.endLine).toBe(3 * 10); // ends where the 11th heading begins (line 31), which is not recorded
    expect(result.diagnostics.find((d) => d.code === 'DOC_LIMIT_HEADINGS')?.count).toBe(20);
    expect(result.diagnostics.find((d) => d.code === 'DOC_LIMIT_LINKS')?.count).toBe(23);
    expect(result.completeness).toBe('PARTIAL');
    expect(validateDocumentationResult(result)).toEqual([]);
  });

  it('the global observation budget cuts links first and keeps sections tied to their headings', () => {
    const md = Array.from({ length: 5 }, (_, i) => `# H${i}\n[l](t${i})\n`).join('\n');
    const { result } = run({ 'README.md': md }, { limits: { maxObservations: 9 } }); // 1 doc + 5 headings + 3 sections
    expect(result.observations).toHaveLength(9);
    expect(linksOf(result)).toHaveLength(0);
    expect(sectionsOf(result)).toHaveLength(3);
    const heads = new Set(headings(result).map((h) => h.ordinal));
    for (const s of sectionsOf(result)) expect(heads.has(s.headingOrdinal)).toBe(true);
    expect(validateDocumentationResult(result)).toEqual([]);
  });

  it('too-long targets are rejected, not cut; too-long text is truncated and flagged', () => {
    const md = `# ${'T'.repeat(300)}\n[${'a'.repeat(300)}](ok.md)\n[x](${'u'.repeat(3000)}) [y](a\u202eb) [z](<${'v'.repeat(3000)}>)\n`;
    const { result } = run({ 'README.md': md });
    expect(headings(result)[0]).toMatchObject({ textStatus: 'TRUNCATED' });
    expect(headings(result)[0]?.text).toHaveLength(200);
    expect(linksOf(result)).toHaveLength(1);
    expect(linksOf(result)[0]).toMatchObject({ textStatus: 'TRUNCATED', target: 'ok.md' });
    expect(codes(result)).toEqual(expect.arrayContaining(['DOC_TEXT_ADJUSTED', 'DOC_LINK_REJECTED']));
    expect(result.diagnostics.find((d) => d.code === 'DOC_LINK_REJECTED')?.count).toBe(3);
    expect(validateDocumentationResult(result)).toEqual([]);
  });

  it('lines over the length cap are not analysed and reported', () => {
    const { result } = run({ 'README.md': `# ${'x'.repeat(9000)}\n# Short\n` });
    expect(headings(result).map((h) => h.text)).toEqual(['Short']);
    expect(result.diagnostics.find((d) => d.code === 'DOC_LINE_TOO_LONG')?.count).toBe(1);
    expect(result.completeness).toBe('PARTIAL');
  });

  it('invalid UTF-8 and NUL: the document is listed, not analysed, and the result is PARTIAL', () => {
    const { result } = run({ 'README.md': Buffer.concat([Buffer.from('# Title\n[a](b)\n'), Buffer.from([0xff, 0xfe, 0xc3, 0x28])]), 'docs/bin.md': Buffer.from('# A\0B\n'), 'docs/ok.md': '# Ok\n' });
    expect(result.observations.filter((o) => o.kind === 'DOCUMENT_PRESENT').map((o) => [o.source.path, (o as { analysis: string }).analysis])).toEqual([
      ['README.md', 'NOT_ANALYZED'],
      ['docs/bin.md', 'NOT_ANALYZED'],
      ['docs/ok.md', 'ANALYZED'],
    ]);
    expect(headings(result).map((h) => h.text)).toEqual(['Ok']);
    expect(result.diagnostics.filter((d) => d.code === 'DOC_INVALID_ENCODING').map((d) => d.path)).toEqual(['README.md', 'docs/bin.md']);
    expect(result.completeness).toBe('PARTIAL');
    expect(validateDocumentationResult(result)).toEqual([]);
  });

  it('no network: links are never fetched or resolved', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network used'));
    const md = '[a](http://127.0.0.1:9/x) [b](https://example.invalid/y) [c](file:///etc/passwd) [d](../../../etc/passwd) ![i](http://127.0.0.1:9/i.png)\n';
    const { result } = run({ 'README.md': md });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(linksOf(result).map((l) => l.target)).toEqual(['http://127.0.0.1:9/x', 'https://example.invalid/y', 'file:///etc/passwd', '../../../etc/passwd']);
    const source = readFileSync(new URL('./docs.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]);
    expect(imports).toEqual(['path', '../root/index.js', './traverse.js', './contracts.js']);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // `RegExp#exec` is fine; process, network and dynamic-code APIs are not.
    expect(code).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|child_process|spawn|execSync|execFile|eval|Function\(|require\(|import\()/);
  });

  it('no code execution: shell in code fences, command substitution and scripts are inert text', () => {
    const { root } = project({});
    const marker = join(root, 'EXECUTED');
    const md = ['# Setup', '```sh', `touch ${marker}`, '```', `$(touch ${marker}) \`touch ${marker}\``, `[run](javascript:void(require('fs').writeFileSync('${marker}','x')))`, `<script>require('fs').writeFileSync('${marker}','x')</script>`].join('\n');
    writeFileSync(join(root, 'README.md'), md);
    const result = analyzeDocumentation(root, traverseProject(root));
    expect(existsSync(marker)).toBe(false);
    expect(JSON.stringify(result)).not.toContain('touch');
    expect(headings(result).map((h) => h.text)).toEqual(['Setup']);
  });
});

// ---------------------------------------------------------------------------
describe('evidence', () => {
  const FILES = {
    'README.md': '# Top\n\ntext [a](a.md)\n\n## Sub\n[b](#top) and [c](https://x.test)\n',
    'docs/guide.md': '# Guide\n\n```\n# code\n```\n[d](../README.md)\n',
  };

  it('every observation has provenance: a listed document, a line range inside it, and the text really is on that line', () => {
    const { result, root } = run(FILES);
    const lines = new Map<string, string[]>(Object.keys(FILES).map((p) => [p, readFileSync(join(root, p), 'utf8').split('\n')]));
    for (const o of result.observations) {
      const doc = result.observations.find((d) => d.kind === 'DOCUMENT_PRESENT' && d.source.path === o.source.path);
      expect(doc).toBeDefined();
      if (o.kind === 'DOCUMENT_PRESENT') continue;
      const { startLine, endLine } = o.source;
      expect(startLine).toBeGreaterThanOrEqual(1);
      expect(endLine).toBeLessThanOrEqual((doc as { lines: number }).lines);
      const text = (lines.get(o.source.path) as string[])[(startLine as number) - 1] as string;
      if (o.kind === 'HEADING') expect(text).toContain(o.text);
      if (o.kind === 'LINK') expect(text).toContain(`[${o.text}](${o.target})`);
    }
  });

  it('source order and canonical order: input order of the traversal does not matter', () => {
    const { root, trav } = run(FILES);
    const a = analyzeDocumentation(root, trav);
    const b = analyzeDocumentation(root, { ...trav, entries: [...trav.entries].reverse() });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(analyzeDocumentation(root, trav))).toBe(JSON.stringify(a));
    const keys = a.observations.map((o) => `${o.source.path}|${o.source.startLine ?? 0}|${o.kind}|${o.ordinal}`);
    expect(keys[0]).toBe('README.md|0|DOCUMENT_PRESENT|0');
    expect(a.observations.filter((o) => o.source.path === 'README.md').map((o) => o.source.startLine ?? 0)).toEqual([0, 1, 1, 3, 5, 5, 6, 6]);
    expect(a.observations.map((o) => o.source.path)).toEqual([...a.observations.map((o) => o.source.path)].sort());
  });

  it('ids are stable across runs and differ between observations', () => {
    const { result } = run(FILES);
    expect(new Set(result.observations.map((o) => o.id)).size).toBe(result.observations.length);
    expect(run(FILES).result.observations.map((o) => o.id)).toEqual(result.observations.map((o) => o.id));
  });

  it('COMPLETE for a clean tree; PARTIAL when the traversal is partial or the read fails, with reproducible tracked separately', () => {
    const { result, root, trav } = run(FILES);
    expect(result).toMatchObject({ completeness: 'COMPLETE', reproducible: true });
    const partialTrav = analyzeDocumentation(root, { ...trav, completeness: 'PARTIAL' });
    expect(partialTrav).toMatchObject({ completeness: 'PARTIAL', reproducible: true, traversal: { completeness: 'PARTIAL' } });
    const failing = analyzeDocumentation(root, trav, { readDocument: () => ({ ok: false, code: 'FILE_UNREADABLE', detail: '' }) });
    expect(failing).toMatchObject({ completeness: 'PARTIAL', reproducible: false });
    expect(failing.stats).toMatchObject({ documentsAnalyzed: 0, documentsNotAnalyzed: 2 });
    const unstableTrav = analyzeDocumentation(root, { ...trav, reproducible: false });
    expect(unstableTrav.reproducible).toBe(false);
  });

  it('informational diagnostics do not make the result PARTIAL', () => {
    const { result } = run({ 'README.md': '---\na: b\n---\n<!-- c -->\n    indented\n# H\n' });
    expect(codes(result)).toEqual(['DOC_FRONT_MATTER_SKIPPED', 'DOC_HTML_COMMENT_SKIPPED', 'DOC_INDENTED_LINES_SKIPPED']);
    expect(result.completeness).toBe('COMPLETE');
  });

  it('diagnostics: fixed text only (no document content, no absolute path), sorted, traversal ones carried over', () => {
    const { root, base } = project({ 'README.md': `# ${'z'.repeat(300)}\n`, 'docs/a.md': Buffer.from([0xff]) });
    symlinkSync(join(base, 'nowhere'), join(root, 'docs', 'l.md'));
    const trav = traverseProject(root);
    const result = analyzeDocumentation(root, trav);
    for (const d of result.diagnostics) {
      expect(d.message).not.toContain(root);
      expect(d.message).not.toContain('zzzz');
    }
    expect(result.diagnostics.some((d) => d.code === 'TRAVERSAL_SYMLINK_SKIPPED')).toBe(true);
    const order = result.diagnostics.map((d) => d.code);
    expect(order).toEqual([...result.diagnostics].sort((x, y) => (order.indexOf(x.code) - order.indexOf(y.code))).map((d) => d.code));
    expect(validateDocumentationResult(result)).toEqual([]);
  });

  it('the diagnostics cap keeps a summary first and PARTIAL', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) files[`docs/d${i}.md`] = '\n    x\n<!-- c -->\n';
    const { result } = run(files, { limits: { maxDiagnostics: 5 } });
    expect(result.diagnostics).toHaveLength(5);
    expect(result.diagnostics[0]?.code).toBe('DOC_LIMIT_DIAGNOSTICS');
    expect(result.completeness).toBe('PARTIAL');
    expect(validateDocumentationResult(result)).toEqual([]);
  });

  it('input hygiene: unsafe traversal entries are ignored and counted; bad input throws', () => {
    const { root } = project({ 'README.md': '# R\n' });
    const trav = fakeTraversal([{ path: 'README.md', kind: 'file' }, { path: '../README.md', kind: 'file' }, { path: '/etc/x.md', kind: 'file' }, { path: 'docs/a.md', kind: 'weird' as never }]);
    const r = analyzeDocumentation(root, trav);
    expect(r.diagnostics.find((d) => d.code === 'DOC_INPUT_PATH_REJECTED')?.count).toBe(3);
    expect(() => analyzeDocumentation('relative/root', trav)).toThrow(/absolute/);
    expect(() => analyzeDocumentation(root, {} as never)).toThrow(/malformed/);
    expect(() => analyzeDocumentation(root, trav, { limits: { maxLinksPerDocument: 0 } })).toThrow(/positive integer/);
    expect(() => analyzeDocumentation(root, trav, { limits: { nope: 1 } as never })).toThrow(/unknown limit/);
  });

  it('the validator rejects tampered results', () => {
    const { result } = run(FILES);
    const clone = (): DocumentationResult => JSON.parse(JSON.stringify(result));
    const mutate = (f: (r: DocumentationResult) => void): string[] => {
      const r = clone();
      f(r);
      return validateDocumentationResult(r);
    };
    expect(validateDocumentationResult(result)).toEqual([]);
    expect(mutate((r) => ((r as { assertion: string }).assertion = 'VERIFIED')).length).toBeGreaterThan(0);
    expect(mutate((r) => ((r.observations.find((o) => o.kind === 'HEADING') as { evidence: string }).evidence = 'OBSERVED_FILE')).join()).toMatch(/evidence/);
    expect(mutate((r) => ((r.observations.find((o) => o.kind === 'LINK') as { linkType: string }).linkType = 'external')).join()).toMatch(/linkType|id/);
    expect(mutate((r) => ((r.observations.find((o) => o.kind === 'HEADING') as { text: string }).text = 'PostgreSQL')).join()).toMatch(/id does not match/);
    expect(mutate((r) => r.observations.reverse()).join()).toMatch(/order/);
    expect(mutate((r) => ((r.observations.find((o) => o.kind === 'LINK') as LinkObservation).source.path = '../x')).join()).toMatch(/unsafe path/);
    expect(mutate((r) => (r.stats.observations = 1)).join()).toMatch(/stats\.observations/);
    expect(mutate((r) => (r.diagnostics = [{ code: 'DOC_READ_FAILED', message: 'x' }])).join()).toMatch(/COMPLETE although/);
    expect(mutate((r) => ((r.diagnostics as unknown[]) = [{ code: 'NOPE', message: 'x' }])).join()).toMatch(/unknown code/);
    expect(mutate((r) => r.observations.splice(0, 1)).join()).toMatch(/no DOCUMENT_PRESENT/);
    expect(validateDocumentationResult(null)).toEqual(['result: not an object']);
    expect(validateDocumentationResult({})).not.toEqual([]);
    expect(validateDocumentationResult(JSON.parse('{"observations":{"length":9e9}}'))).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('regression: existing Discovery is unaffected', () => {
  const FILES = { 'README.md': '# Architecture\nThe application uses PostgreSQL.\n', 'docs/a.md': '# A\n', 'package.json': JSON.stringify({ name: 'x', scripts: { build: 'tsc' }, dependencies: { pg: '1' } }), 'src/index.ts': 'export {};\n' };

  it('fact extraction ignores documents and stays valid; its contract has no documentation keys', () => {
    const { root } = project(FILES);
    const trav = traverseProject(root);
    const before = extractProjectFacts(root, trav);
    analyzeDocumentation(root, trav);
    const after = extractProjectFacts(root, trav);
    expect(after).toEqual(before);
    expect(validateDiscoveryResult(after)).toEqual([]);
    expect(Object.keys(after).sort()).toEqual(['completeness', 'diagnostics', 'facts', 'limits', 'reproducible', 'schemaVersion', 'stats', 'traversal']);
    expect(JSON.stringify(after.facts)).not.toMatch(/Architecture|PostgreSQL/);
  });

  it('the renderer output does not change and shows no documented claim as an observed fact', () => {
    const { root } = project(FILES);
    const trav = traverseProject(root);
    const facts = extractProjectFacts(root, trav);
    const text = renderProjectMapProposal(facts);
    analyzeDocumentation(root, trav);
    expect(renderProjectMapProposal(extractProjectFacts(root, trav))).toBe(text);
    expect(text).not.toMatch(/PostgreSQL/);
  });

  it('the documentation limits are explicit and positive; defaults are frozen', () => {
    for (const v of Object.values(DEFAULT_DOCUMENTATION_LIMITS)) expect(Number.isSafeInteger(v) && v > 0).toBe(true);
    expect(Object.isFrozen(DEFAULT_DOCUMENTATION_LIMITS)).toBe(true);
  });
});
