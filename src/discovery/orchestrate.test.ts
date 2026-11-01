import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscoveryError } from './contracts.js';

// DISCOVERY-001C-G — orchestration. The four steps are wrapped in spies that call the real
// implementations, so call counts, order, arguments and identity of objects can be observed.

const calls: string[] = [];

vi.mock('./traverse.js', async (orig) => {
  const m = await orig<typeof import('./traverse.js')>();
  return { ...m, traverseProject: vi.fn((...a: Parameters<typeof m.traverseProject>) => (calls.push('traverse'), m.traverseProject(...a))) };
});
vi.mock('./facts.js', async (orig) => {
  const m = await orig<typeof import('./facts.js')>();
  return { ...m, extractProjectFacts: vi.fn((...a: Parameters<typeof m.extractProjectFacts>) => (calls.push('facts'), m.extractProjectFacts(...a))) };
});
vi.mock('./docs.js', async (orig) => {
  const m = await orig<typeof import('./docs.js')>();
  return { ...m, analyzeDocumentation: vi.fn((...a: Parameters<typeof m.analyzeDocumentation>) => (calls.push('docs'), m.analyzeDocumentation(...a))) };
});
vi.mock('./compose.js', async (orig) => {
  const m = await orig<typeof import('./compose.js')>();
  return { ...m, composeProjectMap: vi.fn((...a: Parameters<typeof m.composeProjectMap>) => (calls.push('compose'), m.composeProjectMap(...a))) };
});

import { composeProjectMap } from './compose.js';
import { analyzeDocumentation } from './docs.js';
import { extractProjectFacts } from './facts.js';
import { discoverProjectMap } from './orchestrate.js';
import { traverseProject } from './traverse.js';

const dirs: string[] = [];
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'orch-'));
  dirs.push(root);
  mkdirSync(join(root, 'docs'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'tsc' } }));
  writeFileSync(join(root, 'README.md'), '# Title\n\nSee [guide](docs/guide.md).\n');
  writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n');
  writeFileSync(join(root, 'src', 'index.ts'), 'export {};\n');
  return root;
}

afterEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('discoverProjectMap', () => {
  it('runs one traversal, then facts, documentation, composer, in that order', () => {
    discoverProjectMap(project());
    expect(calls).toEqual(['traverse', 'facts', 'docs', 'compose']);
    expect(vi.mocked(traverseProject)).toHaveBeenCalledTimes(1);
  });

  it('gives both analyzers the very same traversal object and the same root', () => {
    const root = project();
    discoverProjectMap(root);
    const t = vi.mocked(traverseProject).mock.results[0].value;
    const [fRoot, fTrav] = vi.mocked(extractProjectFacts).mock.calls[0];
    const [dRoot, dTrav] = vi.mocked(analyzeDocumentation).mock.calls[0];
    expect(fTrav).toBe(t);
    expect(dTrav).toBe(t);
    expect(vi.mocked(traverseProject).mock.calls[0][0]).toBe(root);
    expect(fRoot).toBe(root);
    expect(dRoot).toBe(root);
  });

  it('gives the composer exactly the two analyzer results and returns its output', () => {
    const out = discoverProjectMap(project());
    const [c1, c2] = vi.mocked(composeProjectMap).mock.calls[0];
    expect(c1).toBe(vi.mocked(extractProjectFacts).mock.results[0].value);
    expect(c2).toBe(vi.mocked(analyzeDocumentation).mock.results[0].value);
    expect(out).toBe(vi.mocked(composeProjectMap).mock.results[0].value);
    expect(out).toContain('# PROJECT MAP');
    expect(out).toContain('README.md');
  });

  it('passes each options group only to its own step', () => {
    const traversal = { limits: { maxDepth: 4 } };
    const facts = { limits: { maxManifestBytes: 1000 } };
    const documentation = { limits: { maxDocuments: 3 } };
    discoverProjectMap(project(), { traversal, facts, documentation });
    expect(vi.mocked(traverseProject).mock.calls[0][1]).toBe(traversal);
    expect(vi.mocked(extractProjectFacts).mock.calls[0][2]).toBe(facts);
    expect(vi.mocked(analyzeDocumentation).mock.calls[0][2]).toBe(documentation);
  });

  it('does not write to the project', () => {
    const root = project();
    const listing = (): string[] => traverseProject(root).entries.map((e) => e.path);
    const before = listing();
    discoverProjectMap(root);
    expect(listing()).toEqual(before);
    expect(before).toEqual(['README.md', 'docs', 'docs/guide.md', 'package.json', 'src', 'src/index.ts']);
  });

  it('does not hide a traversal error (relative root: unsafe) and stops there', () => {
    expect(() => discoverProjectMap('relative/root')).toThrow();
    expect(calls).toEqual(['traverse']);
  });

  it('does not hide a traversal error (missing root)', () => {
    expect(() => discoverProjectMap(join(tmpdir(), 'orch-does-not-exist-xyz'))).toThrow();
    expect(calls).toEqual(['traverse']);
  });

  it('does not hide a fact extraction error and does not go on', () => {
    expect(() => discoverProjectMap(project(), { facts: { limits: { maxFacts: -1 } as never } })).toThrow(DiscoveryError);
    expect(calls).toEqual(['traverse', 'facts']);
  });

  it('does not hide a documentation analyzer error and does not compose', () => {
    expect(() => discoverProjectMap(project(), { documentation: { limits: { maxDocuments: -1 } as never } })).toThrow(DiscoveryError);
    expect(calls).toEqual(['traverse', 'facts', 'docs']);
  });

  it('does not hide a composer error', () => {
    vi.mocked(composeProjectMap).mockImplementationOnce(() => {
      calls.push('compose');
      throw new DiscoveryError('RESULT_INVALID', 'boom');
    });
    expect(() => discoverProjectMap(project())).toThrow('boom');
    expect(calls).toEqual(['traverse', 'facts', 'docs', 'compose']);
  });

  it('keeps the existing read boundary: a symlinked README is listed but not read', () => {
    const root = project();
    rmSync(join(root, 'README.md'));
    writeFileSync(join(root, 'outside.txt'), '# SECRET-HEADING\n');
    symlinkSync(join(root, 'outside.txt'), join(root, 'README.md'));
    const out = discoverProjectMap(root);
    expect(out).not.toContain('SECRET-HEADING');
  });
});
