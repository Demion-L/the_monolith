import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { DiscoveryError, computeFactId, validateDiscoveryResult, type DiscoveryResult } from './contracts.js';
import { DEFAULT_DISCOVERY_LIMITS, extractProjectFacts, type ManifestReader } from './facts.js';
import { traverseProject, type TraversalEntry, type TraversalResult } from './traverse.js';

// DISCOVERY-001B-2 — deterministic fact extraction. Fixtures are throwaway mkdtemp trees outside the
// repository. Nothing here claims protection against a concurrent swap (SEC-001B.3, TM-C).

const sandboxes: string[] = [];
afterEach(() => {
  while (sandboxes.length > 0) rmSync(sandboxes.pop() as string, { recursive: true, force: true });
});

function project(files: Record<string, string> = {}): { root: string; base: string } {
  const base = mkdtempSync(join(tmpdir(), 'monolith-facts-'));
  sandboxes.push(base);
  const root = join(base, 'project');
  mkdirSync(root);
  for (const [rel, data] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), data);
  }
  return { root, base };
}

function scan(files: Record<string, string>, limits: Parameters<typeof extractProjectFacts>[2] = {}): { root: string; result: DiscoveryResult; trav: TraversalResult } {
  const { root } = project(files);
  const trav = traverseProject(root);
  return { root, trav, result: extractProjectFacts(root, trav, limits) };
}

/** A hand-made traversal result (no file system needed for pure-metadata cases). */
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
const f = (path: string): TraversalEntry => ({ path, kind: 'file' });
const d = (path: string): TraversalEntry => ({ path, kind: 'directory' });

const ROOT = '/nonexistent-root-for-metadata-only-tests';
const noRead: ManifestReader = () => {
  throw new Error('metadata-only test must not read');
};

const kinds = (r: DiscoveryResult, kind: string) => r.facts.filter((x) => x.kind === kind);
const pkg = (o: unknown): string => JSON.stringify(o);

describe('determinism', () => {
  it('returns the same result for the same project', () => {
    const files = { 'src/index.ts': 'x', 'package.json': pkg({ scripts: { build: 'tsc' }, dependencies: { a: '1' } }) };
    const a = scan(files).result;
    const b = scan(files).result;
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('is independent of the order of traversal entries', () => {
    const entries = [d('src'), f('src/index.ts'), f('src/a.py'), d('docs'), f('package.json'), f('b.go'), f('main.py')];
    const reader: ManifestReader = () => ({ ok: true, path: '', size: 2, content: pkg({ dependencies: { z: '1', a: '1' }, scripts: { t: 'x', a: 'y' } }) });
    const base = extractProjectFacts(ROOT, fakeTraversal(entries), { readManifest: reader });
    for (const shuffled of [[...entries].reverse(), [...entries.slice(3), ...entries.slice(0, 3)], [entries[4], entries[0], entries[6], entries[1], entries[3], entries[2], entries[5]]]) {
      expect(extractProjectFacts(ROOT, fakeTraversal(shuffled), { readManifest: reader })).toEqual(base);
    }
  });

  it('has stable ids that do not depend on the absolute path', () => {
    const files = { 'src/index.ts': 'x', 'package.json': pkg({ dependencies: { a: '1' } }) };
    const a = scan(files).result;
    const b = scan(files).result;
    expect(a.root).toBeUndefined();
    expect(a.facts.map((x) => x.id)).toEqual(b.facts.map((x) => x.id));
    const dep = kinds(a, 'DEPENDENCY_DECLARED')[0];
    expect(dep.id).toBe(computeFactId('DEPENDENCY_DECLARED', 'package.json', 'a', 'dependencies'));
    expect(dep.id).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set(a.facts.map((x) => x.id)).size).toBe(a.facts.length);
  });

  it('orders facts and sources by UTF-16 code units', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([f('b.ts'), f('B.ts'), f('a.ts'), f('é.ts'), f('z.ts')]), { limits: { maxSourcesPerFact: 5 } });
    const lang = kinds(r, 'LANGUAGE_BY_EXTENSION')[0];
    expect(lang.sources.map((s) => s.path)).toEqual(['B.ts', 'a.ts', 'b.ts', 'z.ts', 'é.ts']);
    expect(validateDiscoveryResult(r)).toEqual([]);
  });
});

describe('provenance', () => {
  it('gives every fact at least one source and no absolute path', () => {
    const { result, root } = scan({
      'src/index.ts': 'x',
      'src/api/server.ts': 'x',
      'package.json': pkg({ scripts: { dev: 'x' }, dependencies: { a: '1' }, devDependencies: { b: '1' } }),
    });
    expect(result.facts.length).toBeGreaterThan(0);
    for (const fact of result.facts) {
      expect(fact.sources.length).toBeGreaterThan(0);
      for (const s of fact.sources) {
        expect(s.path.startsWith('/')).toBe(false);
        expect(s.path.split('/')).not.toContain('..');
      }
    }
    const text = JSON.stringify(result);
    expect(text).not.toContain(root);
    expect(text).not.toContain(tmpdir());
  });

  it('points manifest-derived facts at the manifest field (RFC 6901)', () => {
    const { result } = scan({ 'package.json': pkg({ dependencies: { '@scope/pkg': '1', 'a/b': '1', 'x~y': '1' }, scripts: { 'test:unit': 'x' } }) });
    const dep = kinds(result, 'DEPENDENCY_DECLARED').find((x) => x.object === '@scope/pkg');
    expect(dep?.sources).toEqual([{ path: 'package.json', observation: 'manifest-field', field: '/dependencies/@scope~1pkg' }]);
    expect(kinds(result, 'DEPENDENCY_DECLARED').map((x) => x.sources[0].field)).toContain('/dependencies/x~0y');
    expect(kinds(result, 'SCRIPT_DECLARED')[0].sources[0]).toEqual({ path: 'package.json', observation: 'manifest-field', field: '/scripts/test:unit' });
  });

  it('records a language by extension evidence only, with no primary-language claim', () => {
    const { result } = scan({ 'a.ts': 'x' });
    const lang = kinds(result, 'LANGUAGE_BY_EXTENSION');
    expect(lang).toHaveLength(1);
    expect(lang[0]).toMatchObject({ subject: 'TypeScript', object: '.ts', value: '1', level: 'DETECTED', rule: 'extension-map' });
    expect(lang[0].sources).toEqual([{ path: 'a.ts', observation: 'extension' }]);
    expect(JSON.stringify(result)).not.toMatch(/primary|main language/i);
  });
});

describe('structure', () => {
  it('records shallow directories only and keeps the representation compact', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([d('src'), d('src/api'), d('src/api/v1'), f('src/api/server.ts')]));
    expect(kinds(r, 'DIRECTORY').map((x) => x.subject)).toEqual(['src', 'src/api']);
    expect(r.facts.some((x) => x.subject === 'src/api/server.ts')).toBe(false);
  });
});

describe('languages', () => {
  it('maps known extensions and counts them per (language, extension)', () => {
    const r = extractProjectFacts(
      ROOT,
      fakeTraversal([f('a.ts'), f('b.tsx'), f('c.TSX'), f('d.js'), f('e.jsx'), f('f.py'), f('g.rs'), f('h.go')]),
    );
    const got = kinds(r, 'LANGUAGE_BY_EXTENSION').map((x) => `${x.subject}${x.object}=${x.value}`);
    expect(got).toEqual(['Go.go=1', 'JavaScript.js=1', 'JavaScript.jsx=1', 'Python.py=1', 'Rust.rs=1', 'TypeScript.ts=1', 'TypeScript.tsx=2']);
  });

  it('reports unknown extensions as a count, not as a language', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([f('a.xyz'), f('LICENSE'), f('.gitignore'), f('README.md'), f('end.')]));
    expect(kinds(r, 'LANGUAGE_BY_EXTENSION')).toHaveLength(0);
    expect(r.stats.filesWithoutKnownLanguage).toBe(5);
  });

  it('handles a mixed project and an empty one', () => {
    const mixed = extractProjectFacts(ROOT, fakeTraversal([f('a.ts'), f('b.py'), f('c.unknown')]));
    expect(kinds(mixed, 'LANGUAGE_BY_EXTENSION').map((x) => x.subject)).toEqual(['Python', 'TypeScript']);
    const empty = extractProjectFacts(ROOT, fakeTraversal([]));
    expect(empty.facts).toEqual([]);
    expect(empty.completeness).toBe('COMPLETE');
  });

  it('does not treat a directory or a symlink named like a source file as a file of that language', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([d('x.ts'), { path: 'y.ts', kind: 'symlink' }, { path: 'z.ts', kind: 'other' }]));
    expect(kinds(r, 'LANGUAGE_BY_EXTENSION')).toHaveLength(0);
  });
});

describe('manifests', () => {
  it('recognises every known manifest by name without reading the ones it cannot parse', () => {
    const names = ['package.json', 'pnpm-workspace.yaml', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod'];
    const reads: string[] = [];
    const r = extractProjectFacts(ROOT, fakeTraversal(names.map(f)), {
      readManifest: (_r, rel) => {
        reads.push(rel);
        return { ok: true, path: '', size: 2, content: '{}' };
      },
    });
    expect(kinds(r, 'MANIFEST_PRESENT').map((x) => `${x.subject}:${x.object}`)).toEqual([
      'Cargo.toml:cargo',
      'go.mod:go',
      'package.json:npm',
      'pnpm-workspace.yaml:pnpm',
      'pyproject.toml:python',
      'requirements.txt:pip',
    ]);
    expect(reads).toEqual(['package.json']);
    expect(r.diagnostics.filter((x) => x.code === 'MANIFEST_CONTENT_NOT_ANALYZED')).toHaveLength(5);
    expect(r.completeness).toBe('COMPLETE');
  });

  it('extracts nothing but names from a correct package.json', () => {
    const { result } = scan({
      'package.json': pkg({
        name: 'secret-project-name',
        version: '9.9.9',
        scripts: { dev: 'node secret.js --token=abc', build: 'tsc', test: 'vitest' },
        dependencies: { a: '^1.0.0' },
      }),
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('^1.0.0');
    expect(text).not.toContain('9.9.9');
    expect(kinds(result, 'MANIFEST_PRESENT')).toHaveLength(1);
  });

  it('reports malformed JSON without echoing the content and marks the result PARTIAL', () => {
    const { result } = scan({ 'package.json': '{"dependencies": {"a": SECRETTOKEN' });
    expect(result.diagnostics.map((x) => x.code)).toContain('MANIFEST_PARSE_ERROR');
    expect(JSON.stringify(result)).not.toContain('SECRETTOKEN');
    expect(kinds(result, 'MANIFEST_PRESENT')).toHaveLength(1);
    expect(kinds(result, 'DEPENDENCY_DECLARED')).toHaveLength(0);
    expect(result.completeness).toBe('PARTIAL');
    expect(result.reproducible).toBe(true);
  });

  it('refuses a manifest above the byte cap', () => {
    const big = pkg({ dependencies: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`dep-${i}`, '1'])) });
    const { result } = scan({ 'package.json': big }, { limits: { maxManifestBytes: 1000 } });
    expect(Buffer.byteLength(big)).toBeGreaterThan(1000);
    expect(result.diagnostics.map((x) => x.code)).toContain('MANIFEST_TOO_LARGE');
    expect(kinds(result, 'DEPENDENCY_DECLARED')).toHaveLength(0);
    expect(result.completeness).toBe('PARTIAL');
  });

  it('accepts a manifest exactly at the byte cap and refuses one byte over', () => {
    const body = pkg({ scripts: { a: 'x' } });
    const exact = scan({ 'package.json': body }, { limits: { maxManifestBytes: Buffer.byteLength(body) } }).result;
    expect(kinds(exact, 'SCRIPT_DECLARED')).toHaveLength(1);
    const over = scan({ 'package.json': body }, { limits: { maxManifestBytes: Buffer.byteLength(body) - 1 } }).result;
    expect(kinds(over, 'SCRIPT_DECLARED')).toHaveLength(0);
    expect(over.diagnostics.map((x) => x.code)).toContain('MANIFEST_TOO_LARGE');
  });

  it('treats an empty manifest as present and empty, not as a failure', () => {
    const { result } = scan({ 'package.json': '' });
    expect(kinds(result, 'MANIFEST_PRESENT')).toHaveLength(1);
    expect(result.diagnostics.map((x) => x.code)).toContain('MANIFEST_EMPTY');
    expect(result.completeness).toBe('COMPLETE');
  });

  it('ignores fields of unexpected type and says so', () => {
    const { result } = scan({ 'package.json': pkg({ dependencies: ['a'], devDependencies: 'x', peerDependencies: null, scripts: 5, optionalDependencies: { ok: 1 } }) });
    expect(kinds(result, 'DEPENDENCY_DECLARED').map((x) => x.object)).toEqual(['ok']);
    expect(result.diagnostics.filter((x) => x.code === 'MANIFEST_FIELD_INVALID')).toHaveLength(4);
    expect(result.completeness).toBe('PARTIAL');
    for (const top of ['[]', '"x"', 'null', '3']) {
      const r = scan({ 'package.json': top }).result;
      expect(r.diagnostics.map((x) => x.code)).toContain('MANIFEST_FIELD_INVALID');
    }
  });

  it('strips a UTF-8 BOM', () => {
    const { result } = scan({ 'package.json': '﻿' + pkg({ scripts: { a: 'x' } }) });
    expect(kinds(result, 'SCRIPT_DECLARED')).toHaveLength(1);
  });

  it('finds nested manifests, shallowest first, and reads them with their own paths', () => {
    const { result } = scan({
      'package.json': pkg({ scripts: { root: 'x' } }),
      'packages/a/package.json': pkg({ scripts: { inner: 'x' } }),
    });
    expect(kinds(result, 'MANIFEST_PRESENT').map((x) => x.subject)).toEqual(['package.json', 'packages/a/package.json']);
    expect(kinds(result, 'SCRIPT_DECLARED').map((x) => `${x.subject}:${x.object}`)).toEqual(['package.json:root', 'packages/a/package.json:inner']);
  });

  it('does not treat a symlink named package.json as a manifest', () => {
    const { root } = project({ 'real.json': pkg({ scripts: { a: 'x' } }) });
    symlinkSync(join(root, 'real.json'), join(root, 'package.json'));
    const result = extractProjectFacts(root, traverseProject(root));
    expect(kinds(result, 'MANIFEST_PRESENT')).toHaveLength(0);
    expect(result.diagnostics.map((x) => x.code)).toContain('MANIFEST_NOT_REGULAR_FILE');
    expect(kinds(result, 'SCRIPT_DECLARED')).toHaveLength(0);
  });
});

describe('dependency signals', () => {
  it('keeps the four declared categories apart and a name in two categories as two facts', () => {
    const { result } = scan({
      'package.json': pkg({
        dependencies: { a: '1', both: '1' },
        devDependencies: { b: '1', both: '1' },
        peerDependencies: { c: '1' },
        optionalDependencies: { d: '1' },
        bundledDependencies: ['ignored'],
      }),
    });
    expect(kinds(result, 'DEPENDENCY_DECLARED').map((x) => `${x.value}:${x.object}`)).toEqual([
      'dependencies:a',
      'devDependencies:b',
      'dependencies:both',
      'devDependencies:both',
      'peerDependencies:c',
      'optionalDependencies:d',
    ]);
    expect(validateDiscoveryResult(result)).toEqual([]);
  });

  it('merges a repeated key, as JSON.parse keeps the last', () => {
    const { result } = scan({ 'package.json': '{"dependencies":{"a":"1","a":"2"}}' });
    expect(kinds(result, 'DEPENDENCY_DECLARED')).toHaveLength(1);
  });

  it('does not let __proto__ keys reach the prototype', () => {
    const { result } = scan({ 'package.json': '{"dependencies":{"__proto__":"x","constructor":"y"}}' });
    expect(kinds(result, 'DEPENDENCY_DECLARED').map((x) => x.object)).toEqual(['__proto__', 'constructor']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects names with control, bidirectional or oversized content and counts them', () => {
    const { result } = scan({
      'package.json': pkg({ dependencies: { ok: '1', 'bad\nname': '1', 'rtl‮name': '1', ['x'.repeat(215)]: '1', '': '1' } }),
    });
    expect(kinds(result, 'DEPENDENCY_DECLARED').map((x) => x.object)).toEqual(['ok']);
    expect(result.diagnostics.find((x) => x.code === 'MANIFEST_VALUE_REJECTED')?.count).toBe(4);
    expect(result.completeness).toBe('PARTIAL');
  });

  it('caps dependencies per manifest: at the limit, one above, deterministically', () => {
    const mk = (n: number) => pkg({ dependencies: Object.fromEntries(Array.from({ length: n }, (_, i) => [`d${String(i).padStart(3, '0')}`, '1'])) });
    const at = scan({ 'package.json': mk(5) }, { limits: { maxDependenciesPerManifest: 5 } }).result;
    expect(kinds(at, 'DEPENDENCY_DECLARED')).toHaveLength(5);
    expect(at.completeness).toBe('COMPLETE');
    const over = scan({ 'package.json': mk(6) }, { limits: { maxDependenciesPerManifest: 5 } }).result;
    expect(kinds(over, 'DEPENDENCY_DECLARED').map((x) => x.object)).toEqual(['d000', 'd001', 'd002', 'd003', 'd004']);
    expect(over.diagnostics.find((x) => x.code === 'LIMIT_DEPENDENCIES')?.count).toBe(1);
    expect(over.completeness).toBe('PARTIAL');
  });

  it('uses no network: no fetch or socket is touched', () => {
    const g = globalThis as { fetch?: unknown };
    const saved = g.fetch;
    g.fetch = () => {
      throw new Error('network access');
    };
    try {
      expect(() => scan({ 'package.json': pkg({ dependencies: { a: '1' } }) })).not.toThrow();
    } finally {
      g.fetch = saved;
    }
  });
});

describe('scripts', () => {
  it('extracts names only and never a command', () => {
    const { result } = scan({ 'package.json': pkg({ scripts: { dev: 'rm -rf / # CMD_DEV', build: 'CMD_BUILD', test: 'CMD_TEST' } }) });
    expect(kinds(result, 'SCRIPT_DECLARED').map((x) => x.object)).toEqual(['build', 'dev', 'test']);
    expect(JSON.stringify(result)).not.toMatch(/CMD_|rm -rf/);
  });

  it('never executes a script (a marker file is not created)', () => {
    const { root } = project({ 'package.json': pkg({ scripts: { install: 'touch EXECUTED', postinstall: 'touch EXECUTED', build: 'touch EXECUTED' } }) });
    extractProjectFacts(root, traverseProject(root));
    const after = traverseProject(root);
    expect(after.entries.map((e) => e.path)).toEqual(['package.json']);
  });

  it('caps script names at the limit and one above', () => {
    const mk = (n: number) => pkg({ scripts: Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i}`, 'x'])) });
    expect(kinds(scan({ 'package.json': mk(3) }, { limits: { maxScriptsPerManifest: 3 } }).result, 'SCRIPT_DECLARED')).toHaveLength(3);
    const over = scan({ 'package.json': mk(4) }, { limits: { maxScriptsPerManifest: 3 } }).result;
    expect(over.diagnostics.find((x) => x.code === 'LIMIT_SCRIPTS')?.count).toBe(1);
    expect(over.completeness).toBe('PARTIAL');
  });
});

describe('entrypoint candidates', () => {
  it('marks a convention match as a candidate based on a detected file fact', () => {
    const { result } = scan({ 'src/index.ts': 'x', 'main.py': 'x' });
    const cands = kinds(result, 'ENTRYPOINT_CANDIDATE');
    expect(cands.map((x) => x.subject)).toEqual(['main.py', 'src/index.ts']);
    for (const c of cands) {
      expect(c.level).toBe('INTERPRETED');
      expect(c.value).toBe('candidate');
      expect(c.rule).toBe('entrypoint-convention');
      const basis = result.facts.find((x) => x.id === c.basis?.[0]);
      expect(basis).toMatchObject({ kind: 'FILE_PRESENT', level: 'DETECTED', subject: c.subject });
    }
    expect(JSON.stringify(result)).not.toMatch(/verified|entrypoint":/i);
  });

  it('keeps every ambiguous candidate and picks none', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([f('index.ts'), f('main.ts'), f('server.ts'), f('app.py'), f('src/main.ts')]));
    expect(kinds(r, 'ENTRYPOINT_CANDIDATE')).toHaveLength(5);
  });

  it('does not make a candidate of a directory, a symlink or a nested path', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([d('src/index.ts'), { path: 'main.ts', kind: 'symlink' }, f('packages/a/src/index.ts'), f('lib/main.py')]));
    expect(kinds(r, 'ENTRYPOINT_CANDIDATE')).toHaveLength(0);
  });

  it('caps candidates with a diagnostic', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([f('index.ts'), f('main.ts'), f('server.ts')]), { limits: { maxEntrypointFacts: 2 } });
    expect(kinds(r, 'ENTRYPOINT_CANDIDATE').map((x) => x.subject)).toEqual(['index.ts', 'main.ts']);
    expect(r.diagnostics.find((x) => x.code === 'LIMIT_ENTRYPOINT_FACTS')?.count).toBe(1);
    expect(r.completeness).toBe('PARTIAL');
  });
});

describe('completeness, reproducibility', () => {
  it('never reports a PARTIAL traversal as COMPLETE, and keeps the traversal verdict visible', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([f('a.ts')], { completeness: 'PARTIAL', diagnostics: [{ code: 'LIMIT_ENTRIES', message: 'cut' }] }));
    expect(r.completeness).toBe('PARTIAL');
    expect(r.traversal).toEqual({ completeness: 'PARTIAL', reproducible: true });
    expect(r.diagnostics.map((x) => x.code)).toContain('TRAVERSAL_LIMIT_ENTRIES');
  });

  it('keeps completeness and reproducibility apart', () => {
    const cut = extractProjectFacts(ROOT, fakeTraversal([f('a.ts')], { completeness: 'PARTIAL' }));
    expect(cut).toMatchObject({ completeness: 'PARTIAL', reproducible: true });
    const clock = extractProjectFacts(ROOT, fakeTraversal([f('a.ts')], { completeness: 'PARTIAL', reproducible: false }));
    expect(clock).toMatchObject({ completeness: 'PARTIAL', reproducible: false });
    const clean = extractProjectFacts(ROOT, fakeTraversal([f('a.ts')]));
    expect(clean).toMatchObject({ completeness: 'COMPLETE', reproducible: true });
  });

  it('does not turn missing data into a claim of absence', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([], { completeness: 'PARTIAL' }));
    expect(r.facts).toEqual([]);
    expect(r.completeness).toBe('PARTIAL');
  });

  it('marks an unstable environment (read failure) as not reproducible, and a vanished file as PARTIAL', () => {
    const vanished: ManifestReader = () => ({ ok: false, code: 'FILE_MISSING', detail: '/abs/secret/path vanished' });
    const r = extractProjectFacts(ROOT, fakeTraversal([f('package.json')]), { readManifest: vanished });
    expect(r).toMatchObject({ completeness: 'PARTIAL', reproducible: false });
    expect(JSON.stringify(r)).not.toContain('/abs/secret');
    const changed: ManifestReader = () => ({ ok: false, code: 'FILE_CHANGED', detail: 'x' });
    expect(extractProjectFacts(ROOT, fakeTraversal([f('package.json')]), { readManifest: changed }).reproducible).toBe(false);
  });

  it('survives a reader that throws', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([f('package.json')]), {
      readManifest: () => {
        throw new Error('EIO at /home/victim/secret');
      },
    });
    expect(r.completeness).toBe('PARTIAL');
    expect(JSON.stringify(r)).not.toContain('victim');
  });
});

describe('security', () => {
  it('never follows a symlinked directory to read a manifest outside the project', () => {
    const { root, base } = project({ 'src/a.ts': 'x' });
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside', 'package.json'), pkg({ scripts: { leaked: 'x' } }));
    symlinkSync(join(base, 'outside'), join(root, 'linked'));
    const result = extractProjectFacts(root, traverseProject(root));
    expect(JSON.stringify(result)).not.toContain('leaked');
    expect(kinds(result, 'MANIFEST_PRESENT')).toHaveLength(0);
  });

  it('refuses a read through a symlinked directory even when a handcrafted traversal lists it', () => {
    const { root, base } = project();
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside', 'package.json'), pkg({ scripts: { leaked: 'x' } }));
    symlinkSync(join(base, 'outside'), join(root, 'linked'));
    const forged = fakeTraversal([d('linked'), f('linked/package.json')]);
    const result = extractProjectFacts(root, forged);
    expect(JSON.stringify(result)).not.toContain('leaked');
    expect(result.diagnostics.map((x) => x.code)).toContain('MANIFEST_READ_FAILED');
    expect(result.completeness).toBe('PARTIAL');
  });

  it('refuses a manifest swapped for a symlink after the traversal', () => {
    const { root, base } = project({ 'package.json': pkg({ scripts: { a: 'x' } }) });
    const trav = traverseProject(root);
    writeFileSync(join(base, 'elsewhere.json'), pkg({ scripts: { swapped: 'x' } }));
    rmSync(join(root, 'package.json'));
    symlinkSync(join(base, 'elsewhere.json'), join(root, 'package.json'));
    const result = extractProjectFacts(root, trav);
    expect(JSON.stringify(result)).not.toContain('swapped');
    expect(result.diagnostics.map((x) => x.code)).toContain('MANIFEST_READ_FAILED');
  });

  it('ignores traversal entries with a traversal path, an absolute path or a forged kind', () => {
    let reads = 0;
    const r = extractProjectFacts(
      ROOT,
      fakeTraversal([f('../package.json'), f('/etc/package.json'), f('a/../package.json'), f('a\\package.json'), f('a//b.ts'), f('a\0.ts'), { path: 'x.ts', kind: 'weird' as never }, f('ok.ts')]),
      { readManifest: () => (reads++, { ok: false, code: 'FILE_MISSING', detail: '' }) },
    );
    expect(reads).toBe(0);
    expect(r.diagnostics.find((x) => x.code === 'INPUT_PATH_REJECTED')?.count).toBe(7);
    expect(kinds(r, 'LANGUAGE_BY_EXTENSION')[0].value).toBe('1');
    expect(r.completeness).toBe('PARTIAL');
    expect(validateDiscoveryResult(r)).toEqual([]);
  });

  it('sanitizes read errors: only the closed code reaches the result', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([f('package.json')]), {
      readManifest: () => ({ ok: false, code: 'FILE_UNREADABLE', detail: 'EACCES: permission denied, open /home/victim/project/package.json' }),
    });
    const text = JSON.stringify(r);
    expect(text).not.toContain('victim');
    expect(text).not.toContain('EACCES');
    expect(text).toContain('FILE_UNREADABLE');
  });

  it('requires an absolute root and a well-formed traversal', () => {
    expect(() => extractProjectFacts('relative/dir', fakeTraversal([]))).toThrow(DiscoveryError);
    expect(() => extractProjectFacts(ROOT, { ...fakeTraversal([]), completeness: 'MAYBE' as never })).toThrow(DiscoveryError);
    expect(() => extractProjectFacts(ROOT, null as never)).toThrow(DiscoveryError);
  });

  it('rejects a hostile result at the validator rather than returning it', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([f('a.ts')]));
    const forged: DiscoveryResult = { ...r, facts: [{ ...r.facts[0], sources: [{ path: '/etc/passwd', observation: 'extension' }] }] };
    expect(validateDiscoveryResult(forged).join()).toContain('unsafe source path');
    const noSource: DiscoveryResult = { ...r, facts: [{ ...r.facts[0], sources: [] }] };
    expect(validateDiscoveryResult(noSource).join()).toContain('no source');
    const wrongLevel: DiscoveryResult = { ...r, facts: [{ ...r.facts[0], level: 'INTERPRETED' }] };
    expect(validateDiscoveryResult(wrongLevel).join()).toContain('level');
  });
});

describe('nested MONOLITH instances', () => {
  const nested = (prefix: string): TraversalEntry[] => [
    d(prefix),
    d(`${prefix}/.monolith`),
    f(`${prefix}/.monolith/state.json`),
    d(`${prefix}/.monolith/memory`),
    f(`${prefix}/.monolith/memory/notes.ts`),
    f(`${prefix}/package.json`),
    f(`${prefix}/src.ts`),
  ];

  it('keeps the sub-project source and drops its confirmed internal state', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal(nested('sub')), {
      readManifest: () => ({ ok: true, path: '', size: 2, content: '{}' }),
    });
    expect(kinds(r, 'MANIFEST_PRESENT').map((x) => x.subject)).toEqual(['sub/package.json']);
    expect(kinds(r, 'LANGUAGE_BY_EXTENSION')[0].value).toBe('1');
    expect(kinds(r, 'DIRECTORY').map((x) => x.subject)).toEqual(['sub']);
    expect(r.diagnostics.find((x) => x.code === 'NESTED_MONOLITH_STATE_EXCLUDED')?.path).toBe('sub/.monolith');
    expect(r.stats.excludedEntries).toBe(4);
    expect(r.completeness).toBe('COMPLETE');
  });

  it('does not conclude from the name alone', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([d('sub'), d('sub/.monolith'), f('sub/.monolith/tool.ts')]));
    expect(kinds(r, 'LANGUAGE_BY_EXTENSION')[0].value).toBe('1');
    expect(r.diagnostics.map((x) => x.code)).toContain('NESTED_MONOLITH_UNCONFIRMED');
    expect(r.diagnostics.map((x) => x.code)).not.toContain('NESTED_MONOLITH_STATE_EXCLUDED');
    expect(r.stats.excludedEntries).toBe(0);
  });

  it('does not exclude a sibling whose name only starts like the state directory', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([d('.monolith-notes'), f('.monolith-notes/a.ts')]));
    expect(kinds(r, 'LANGUAGE_BY_EXTENSION')).toHaveLength(1);
  });
});

describe('limits', () => {
  it('truncates directories deterministically, shallowest first, at the boundary and one above', () => {
    const dirs = [d('a'), d('b'), d('c'), d('a/x'), d('b/y')];
    const at = extractProjectFacts(ROOT, fakeTraversal(dirs), { limits: { maxDirectoryFacts: 5 } });
    expect(kinds(at, 'DIRECTORY')).toHaveLength(5);
    expect(at.completeness).toBe('COMPLETE');
    const over = extractProjectFacts(ROOT, fakeTraversal(dirs), { limits: { maxDirectoryFacts: 4 } });
    expect(kinds(over, 'DIRECTORY').map((x) => x.subject)).toEqual(['a', 'a/x', 'b', 'c']);
    expect(over.diagnostics.find((x) => x.code === 'LIMIT_DIRECTORY_FACTS')?.count).toBe(1);
    expect(over.completeness).toBe('PARTIAL');
    expect(extractProjectFacts(ROOT, fakeTraversal([...dirs].reverse()), { limits: { maxDirectoryFacts: 4 } })).toEqual(over);
  });

  it('caps manifest presence facts and package.json reads separately', () => {
    const entries = ['a', 'b', 'c'].map((n) => f(`${n}/package.json`));
    const reads: string[] = [];
    const reader: ManifestReader = (_r, rel) => (reads.push(rel), { ok: true, path: '', size: 2, content: '{}' });
    const r = extractProjectFacts(ROOT, fakeTraversal(entries), { limits: { maxManifestReads: 2 }, readManifest: reader });
    expect(reads).toEqual(['a/package.json', 'b/package.json']);
    expect(kinds(r, 'MANIFEST_PRESENT')).toHaveLength(3);
    expect(r.diagnostics.find((x) => x.code === 'LIMIT_MANIFEST_READS')?.count).toBe(1);
    expect(r.stats).toMatchObject({ manifestsFound: 3, manifestsRead: 2 });
    const cut = extractProjectFacts(ROOT, fakeTraversal(entries), { limits: { maxManifestFacts: 2 }, readManifest: reader });
    expect(kinds(cut, 'MANIFEST_PRESENT')).toHaveLength(2);
    expect(cut.diagnostics.find((x) => x.code === 'LIMIT_MANIFEST_FACTS')?.count).toBe(1);
  });

  it('caps language facts', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([f('a.ts'), f('b.py'), f('c.go')]), { limits: { maxLanguageFacts: 2 } });
    expect(kinds(r, 'LANGUAGE_BY_EXTENSION').map((x) => x.subject)).toEqual(['Go', 'Python']);
    expect(r.diagnostics.find((x) => x.code === 'LIMIT_LANGUAGE_FACTS')?.count).toBe(1);
  });

  it('enforces the global fact budget by cutting dependency names first, and reports it', () => {
    const entries = [f('a.ts'), f('package.json')];
    const reader: ManifestReader = () => ({ ok: true, path: '', size: 2, content: pkg({ scripts: { s: 'x' }, dependencies: { d1: '1', d2: '1', d3: '1' } }) });
    const exact = extractProjectFacts(ROOT, fakeTraversal(entries), { readManifest: reader });
    const n = exact.facts.length;
    const at = extractProjectFacts(ROOT, fakeTraversal(entries), { readManifest: reader, limits: { maxFacts: n } });
    expect(at.facts).toHaveLength(n);
    expect(at.completeness).toBe('COMPLETE');
    const over = extractProjectFacts(ROOT, fakeTraversal(entries), { readManifest: reader, limits: { maxFacts: n - 1 } });
    expect(over.facts).toHaveLength(n - 1);
    expect(kinds(over, 'MANIFEST_PRESENT')).toHaveLength(1);
    expect(kinds(over, 'SCRIPT_DECLARED')).toHaveLength(1);
    expect(kinds(over, 'DEPENDENCY_DECLARED').map((x) => x.object)).toEqual(['d1', 'd2']);
    expect(over.diagnostics.find((x) => x.code === 'LIMIT_FACTS')?.count).toBe(1);
    expect(over.completeness).toBe('PARTIAL');
  });

  it('never splits an interpretation from its basis under the fact budget', () => {
    const r = extractProjectFacts(ROOT, fakeTraversal([f('index.ts'), f('main.ts')]), { limits: { maxFacts: 3 } });
    expect(kinds(r, 'ENTRYPOINT_CANDIDATE')).toHaveLength(1);
    expect(kinds(r, 'FILE_PRESENT')).toHaveLength(1);
    expect(validateDiscoveryResult(r)).toEqual([]);
  });

  it('bounds diagnostics, keeps the completeness-affecting ones and reports the loss', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ code: 'SYMLINK_SKIPPED' as const, path: `l${i}`, message: 'skipped' }));
    const entries = [f('package.json'), ...Array.from({ length: 5 }, (_, i) => ({ path: `p${i}/package.json`, kind: 'symlink' as const }))];
    const r = extractProjectFacts(ROOT, fakeTraversal(entries, { diagnostics: many }), {
      readManifest: () => ({ ok: false, code: 'FILE_MISSING', detail: '' }),
      limits: { maxDiagnostics: 4 },
    });
    expect(r.diagnostics).toHaveLength(4);
    expect(r.diagnostics[0].code).toBe('LIMIT_DIAGNOSTICS');
    expect(r.diagnostics.map((x) => x.code)).toContain('MANIFEST_READ_FAILED');
    expect(r.completeness).toBe('PARTIAL');
    expect(r.reproducible).toBe(false);
  });

  it('rejects invalid limits', () => {
    for (const bad of [{ maxFacts: 0 }, { maxFacts: 1.5 }, { maxFacts: -1 }, { maxFacts: Number.NaN }, { nope: 1 }]) {
      expect(() => extractProjectFacts(ROOT, fakeTraversal([]), { limits: bad as never })).toThrow(DiscoveryError);
    }
    expect(DEFAULT_DISCOVERY_LIMITS.maxManifestBytes).toBeLessThanOrEqual(1024 * 1024);
  });
});

describe('end to end on a real traversal', () => {
  it('describes a small project and validates', () => {
    const { result } = scan({
      'package.json': pkg({ scripts: { build: 'tsc' }, dependencies: { vue: '1' }, devDependencies: { vitest: '1' } }),
      'src/index.ts': 'x',
      'src/api/server.ts': 'x',
      'app.py': 'x',
      'pyproject.toml': '[project]',
    });
    expect(result).toMatchObject({ completeness: 'COMPLETE', reproducible: true, schemaVersion: 1 });
    expect(validateDiscoveryResult(result)).toEqual([]);
    expect(kinds(result, 'DIRECTORY').map((x) => x.subject)).toEqual(['src', 'src/api']);
    expect(kinds(result, 'ENTRYPOINT_CANDIDATE').map((x) => x.subject)).toEqual(['app.py', 'src/index.ts']);
    expect(result.diagnostics.map((x) => x.code)).toEqual(['MANIFEST_CONTENT_NOT_ANALYZED']);
  });
});
