import { readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import { DiscoveryError, type DiscoveryResult } from './contracts.js';
import { composeProjectMap } from './compose.js';
import { analyzeDocumentation, observationId, validateDocumentationResult, type DocumentationResult, type DocumentReader } from './docs.js';
import { extractProjectFacts } from './facts.js';
import { renderProjectMapProposal } from './render.js';
import type { TraversalEntry, TraversalResult } from './traverse.js';

// DISCOVERY-001C — composer. No file system: both results come from the real analyzers over a
// hand-made traversal with injected readers.

const ROOT = '/nonexistent-root-for-composer-tests';
const f = (path: string): TraversalEntry => ({ path, kind: 'file' });
const d = (path: string): TraversalEntry => ({ path, kind: 'directory' });

function traversal(entries: TraversalEntry[], over: Partial<TraversalResult> = {}): TraversalResult {
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

const ENTRIES = [d('src'), d('docs'), f('src/index.ts'), f('src/a.py'), f('package.json'), f('README.md'), f('docs/guide.md')];
const discovery = (over: Partial<TraversalResult> = {}, limits: Parameters<typeof extractProjectFacts>[2] = {}): DiscoveryResult =>
  extractProjectFacts(ROOT, traversal(ENTRIES, over), { readManifest: () => ({ ok: true, path: '', size: 2, content: JSON.stringify({ scripts: { build: 'tsc' } }) }), ...limits });

const reader = (files: Record<string, string>): DocumentReader => (_root, rel) => ({ ok: true, path: rel, size: Buffer.byteLength(files[rel] ?? ''), content: files[rel] ?? '' });
const DOCS = { 'README.md': '# Title\n\nSee [guide](docs/guide.md) and [more](more.md).\n\n## Usage\n\ntext\n', 'docs/guide.md': '# Guide\n\n[ext](https://example.com/x)\n' };
const documentation = (files: Record<string, string> = DOCS, entries: TraversalEntry[] = ENTRIES, over: Partial<TraversalResult> = {}, limits: Parameters<typeof analyzeDocumentation>[2] = {}): DocumentationResult =>
  analyzeDocumentation(ROOT, traversal(entries, over), { readDocument: reader(files), ...limits });

const headingLines = (md: string): string[] => md.split('\n').filter((l) => /^#{1,6}\s/.test(l));

describe('composition', () => {
  it('composes two valid results with the three required sections and the unchanged renderer output', () => {
    const dr = discovery();
    const md = composeProjectMap(dr, documentation());
    expect(headingLines(md).filter((h) => /^#{1,2}\s/.test(h))).toEqual(['# PROJECT MAP', '## Observed Project Structure', '## Documentation Overview', '## Trust & Coverage Notes']);
    expect(md.endsWith('\n')).toBe(true);
    // compatibility: the renderer output is embedded with headings lowered, nothing else changed
    const rendered = renderProjectMapProposal(dr).replace(/^(#+) /gm, '##$1 ').replace(/\n+$/, '');
    expect(md).toContain(rendered);
  });

  it('rejects an invalid DiscoveryResult and an invalid DocumentationResult, naming which', () => {
    const bad = { ...discovery(), schemaVersion: 99 } as unknown as DiscoveryResult;
    expect(() => composeProjectMap(bad, documentation())).toThrow(DiscoveryError);
    expect(() => composeProjectMap(bad, documentation())).toThrow(/DiscoveryResult failed validation/);
    const badDoc = { ...documentation(), assertion: 'VERIFIED' } as unknown as DocumentationResult;
    expect(() => composeProjectMap(discovery(), badDoc)).toThrow(/DocumentationResult failed validation/);
    expect(() => composeProjectMap(null as never, null as never)).toThrow(DiscoveryError);
  });

  it('handles empty documentation', () => {
    const doc = documentation({}, [d('src')]);
    expect(validateDocumentationResult(doc)).toEqual([]);
    const md = composeProjectMap(discovery(), doc);
    expect(md).toContain('No documents were recorded.');
    expect(md).toContain('No diagnostics were reported.');
  });

  it('lists several documents with headings, links, sections and line numbers', () => {
    const md = composeProjectMap(discovery(), documentation());
    expect(md).toContain('- `README.md`');
    expect(md).toContain('- `docs/guide.md`');
    expect(md).toContain('line 1, level 1: `Title`');
    expect(md).toContain('line 5, level 2: `Usage`');
    expect(md).toMatch(/line 3, relative: target `docs\/guide\.md`, text `guide`/);
    expect(md).toMatch(/line 3, external: target `https:\/\/example\.com\/x`, text `ext`/);
    expect(md).toMatch(/lines 1-\d+, opened by heading 1/);
    expect(md).toContain('evidence OBSERVED_FILE');
    expect(md).toContain('evidence DOCUMENT_TEXT');
  });

  it('shows SAMPLE and FULL source coverage from the structural result', () => {
    const many = Array.from({ length: 5 }, (_, i) => f(`src/m${i}.ts`));
    const dr = extractProjectFacts(ROOT, traversal([...ENTRIES, ...many]), { limits: { maxSourcesPerFact: 2 } });
    const md = composeProjectMap(dr, documentation());
    expect(md).toContain('source coverage SAMPLE');
    expect(md).toContain('not a complete list');
    expect(composeProjectMap(discovery(), documentation())).toContain('source coverage FULL');
  });

  it('keeps COMPLETE/PARTIAL of each analyzer separate and never merges them', () => {
    const partialDoc = documentation(DOCS, ENTRIES, {}, { limits: { maxLinksPerDocument: 1 } });
    expect(partialDoc.completeness).toBe('PARTIAL');
    const md = composeProjectMap(discovery(), partialDoc);
    expect(md).toContain('- Structural Discovery: completeness COMPLETE');
    expect(md).toContain('- Documentation Analysis: completeness PARTIAL');
    expect(md).toContain('- Analysis completeness: PARTIAL');
    expect(md).toContain('lower bounds');
    const both = composeProjectMap(discovery({ completeness: 'PARTIAL' }), documentation());
    expect(both).toContain('- Structural Discovery: completeness PARTIAL');
    expect(both).toContain('- Documentation Analysis: completeness COMPLETE');
    expect(md).not.toContain('COMPLETE does not mean');
    expect(composeProjectMap(discovery(), documentation())).toContain('COMPLETE does not mean that every Markdown construct was recognised');
    expect(md).toContain('not the number of links or headings in a document');
  });

  it('shows diagnostics from both sources with their origin', () => {
    const dr = discovery({}, { limits: { maxScriptsPerManifest: 1 } });
    const dr2 = discovery({ diagnostics: [{ code: 'LIMIT_ENTRIES', message: 'x' }], completeness: 'PARTIAL' });
    const doc = documentation({ ...DOCS, 'docs/guide.md': '' });
    expect(doc.diagnostics.length).toBeGreaterThan(0);
    const md = composeProjectMap(dr2, doc);
    expect(md).toContain('(reported by the traversal)');
    expect(md).toContain('`DOC_EMPTY` (documentation analysis; does not by itself make the result PARTIAL)');
    expect(composeProjectMap(dr, doc)).toContain('### Documentation Diagnostics');
  });

  it('states that a common origin is not confirmed and makes no unverified architectural claim', () => {
    const md = composeProjectMap(discovery(), documentation());
    expect(md).toContain('Common origin of the two results is NOT confirmed');
    expect(md).toContain('No documentary statement has been confirmed by the code');
    expect(md).not.toMatch(/\b(the project uses|is built with|the architecture is)\b/i);
    expect(md).not.toMatch(/same project (is|was)/i);
  });
});

describe('safety', () => {
  const hostile = documentation({
    'README.md': '# <script>alert(1)</script> [x](http://evil) `` ` **b**\n\n[**bold**](javascript:alert(1) "t")\n\n[<img src=x onerror=1>](a.md)\n',
    'docs/guide.md': '# ok\n',
  });

  it('puts document text only inside code spans (Markdown and HTML injection)', () => {
    const md = composeProjectMap(discovery(), hostile);
    expect(validateDocumentationResult(hostile)).toEqual([]);
    expect(md).toContain('<script>alert(1)</script> [x](http://evil)');
    expect(md).toContain('<img src=x onerror=1>');
    // no line other than ours can start a heading, quote, HTML block or fence
    const unexpected = md.split('\n').filter((l) => l.length > 0 && !/^( *- |#{1,6} |This document )/.test(l));
    expect(unexpected).toEqual([]);
    expect(headingLines(md).every((h) => /^#{1,5} [A-Za-z&# ]+$/.test(h))).toBe(true);
    // every document-supplied value sits in a code span
    for (const l of md.split('\n').filter((l) => /level \d:|, (relative|external|other|anchor):/.test(l))) expect(l).toMatch(/`.+`/);
    expect(md).not.toMatch(/^ *- .*[^`]<script>/m);
  });

  it('withholds unsafe text (analyzer) and shows control characters as [U+XXXX] (composer, second line of defence)', () => {
    const u = documentation({ 'README.md': '# a‮b\u0007\n\n[t](x.md)\n' });
    const um = composeProjectMap(discovery(), u);
    expect(um).toContain('withheld');
    expect(um).not.toMatch(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/);
    // a hand-edited (still valid) result that carries a control character in a target is neutralised by the composer
    const doc = documentation({ 'README.md': '# a\n\n[t](x.md)\n' });
    const link = doc.observations.find((o) => o.kind === 'LINK');
    if (link?.kind === 'LINK') link.target = 'x‮.md';
    if (validateDocumentationResult(doc).length === 0) {
      const md = composeProjectMap(discovery(), doc);
      expect(md).toContain('x[U+202E].md');
      expect(md).not.toContain('‮');
    }
  });

  it('cannot be broken out of by backticks in link targets', () => {
    const doc = documentation({ 'README.md': '[a](x.md)\n' });
    const link = doc.observations.find((o) => o.kind === 'LINK');
    if (link?.kind === 'LINK') {
      link.target = 'x``y```z';
      link.id = observationId(link);
    }
    expect(validateDocumentationResult(doc)).toEqual([]);
    const md = composeProjectMap(discovery(), doc);
    const l = md.split('\n').find((x) => x.includes(': target '));
    expect(l).toContain('target ````x``y```z````');
  });
});

describe('purity', () => {
  it('is deterministic and does not modify its inputs', () => {
    const dr = discovery();
    const doc = documentation();
    const before = JSON.stringify([dr, doc]);
    const a = composeProjectMap(dr, doc);
    const b = composeProjectMap(structuredClone(dr), structuredClone(doc));
    expect(a).toBe(b);
    expect(JSON.stringify([dr, doc])).toBe(before);
    const frozen = JSON.parse(before) as [DiscoveryResult, DocumentationResult];
    const deepFreeze = (o: unknown): void => {
      if (o && typeof o === 'object') {
        Object.freeze(o);
        Object.values(o).forEach(deepFreeze);
      }
    };
    deepFreeze(frozen);
    expect(composeProjectMap(frozen[0], frozen[1])).toBe(a);
  });

  it('does not depend on the clock', () => {
    const dr = discovery();
    const doc = documentation();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2001, 0, 1));
    const a = composeProjectMap(dr, doc);
    vi.setSystemTime(new Date(2040, 5, 5));
    expect(composeProjectMap(dr, doc)).toBe(a);
    vi.useRealTimers();
  });

  it('source imports no file system, network, process or model module', () => {
    const src = readFileSync(new URL('./compose.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./contracts.js', './contracts.js', './docs.js', './render.js']);
    expect(src).not.toMatch(/\b(fetch|child_process|readFileSync|process\.env|Date\.now|new Date|Math\.random)\b/);
  });
});
