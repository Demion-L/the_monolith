import { readFileSync } from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DISCOVERY_SCHEMA_VERSION,
  DiscoveryError,
  FACT_LEVEL_BY_KIND,
  compareFacts,
  computeFactId,
  validateDiscoveryResult,
  type DiscoveryDiagnostic,
  type DiscoveryFact,
  type DiscoveryResult,
  type DiscoverySource,
} from './contracts.js';
import { DEFAULT_DISCOVERY_LIMITS, extractProjectFacts, type ManifestReader } from './facts.js';
import { renderProjectMapProposal } from './render.js';
import type { TraversalEntry, TraversalResult } from './traverse.js';

// DISCOVERY-001B-3 — Markdown renderer. No file system is used: results come from the real extractor
// over hand-made traversals with an injected manifest reader, or are assembled by hand and checked
// against the real validator.

const ROOT = '/nonexistent-root-for-renderer-tests';
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

const manifestReader =
  (pkg: unknown): ManifestReader =>
  () => ({ ok: true, path: '', size: 2, content: JSON.stringify(pkg) });

function extract(entries: TraversalEntry[], pkg?: unknown, limits: Parameters<typeof extractProjectFacts>[2] = {}, over: Partial<TraversalResult> = {}): DiscoveryResult {
  return extractProjectFacts(ROOT, traversal(entries, over), { ...(pkg === undefined ? {} : { readManifest: manifestReader(pkg) }), ...limits });
}

const RICH_ENTRIES = [d('src'), d('docs'), f('src/index.ts'), f('src/util.ts'), f('src/a.py'), f('package.json'), f('main.py'), f('Cargo.toml'), f('notes.xyz')];
const RICH_PKG = { dependencies: { zeta: '1', alpha: '2' }, devDependencies: { vitest: '3' }, scripts: { build: 'tsc', test: 'vitest' } };
const rich = (): DiscoveryResult => extract(RICH_ENTRIES, RICH_PKG);

// ---- hand-made results ------------------------------------------------------------------------

function fact(kind: DiscoveryFact['kind'], subject: string, parts: { object?: string; value?: string; sources: DiscoverySource[]; basis?: string[]; rule?: string }): DiscoveryFact {
  return {
    id: computeFactId(kind, subject, parts.object, parts.value),
    kind,
    level: FACT_LEVEL_BY_KIND[kind],
    subject,
    ...(parts.object === undefined ? {} : { object: parts.object }),
    ...(parts.value === undefined ? {} : { value: parts.value }),
    rule: parts.rule ?? 'test-rule',
    ...(parts.basis === undefined ? {} : { basis: parts.basis }),
    sources: parts.sources,
  };
}

function handMade(facts: DiscoveryFact[], diagnostics: DiscoveryDiagnostic[] = [], over: Partial<DiscoveryResult> = {}): DiscoveryResult {
  const sorted = [...facts].sort(compareFacts);
  return {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    limits: { ...DEFAULT_DISCOVERY_LIMITS },
    completeness: 'COMPLETE',
    reproducible: true,
    traversal: { completeness: 'COMPLETE', reproducible: true },
    stats: { inputEntries: 10, excludedEntries: 0, filesWithoutKnownLanguage: 0, manifestsFound: 0, manifestsRead: 0, facts: sorted.length },
    facts: sorted,
    diagnostics,
    ...over,
  };
}

const depFact = (manifest: string, name: string, section = 'dependencies'): DiscoveryFact =>
  fact('DEPENDENCY_DECLARED', manifest, { object: name, value: section, sources: [{ path: manifest, observation: 'manifest-field', field: `/${section}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}` }] });

const langFact = (language: string, ext: string, count: number, paths: string[]): DiscoveryFact =>
  fact('LANGUAGE_BY_EXTENSION', language, { object: ext, value: String(count), sources: paths.map((path) => ({ path, observation: 'extension' as const })) });

function validOrFail(r: DiscoveryResult): DiscoveryResult {
  expect(validateDiscoveryResult(r)).toEqual([]);
  return r;
}

/** Every line that begins like Markdown structure must be one of ours. */
const headings = (md: string): string[] => md.split('\n').filter((l) => /^#{1,6}\s/.test(l));
const EXPECTED_HEADINGS = ['# Project Map Proposal', '## Discovery Status', '## Project Structure', '## Observed Languages', '## Detected Manifests', '## Declared Dependencies', '## Declared Scripts', '## Entrypoint Candidates', '## Evidence & Provenance', '## Limitations', '### Diagnostics'];

afterEach(() => {
  vi.useRealTimers();
});

// =================================================================================================
describe('functional', () => {
  it('renders the fixed document skeleton in order', () => {
    const md = renderProjectMapProposal(rich());
    expect(headings(md)).toEqual(EXPECTED_HEADINGS);
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('shows COMPLETE without claiming the whole project was examined', () => {
    const r = rich();
    expect(r.completeness).toBe('COMPLETE');
    const md = renderProjectMapProposal(r);
    expect(md).toContain('- Completeness: COMPLETE');
    expect(md).toContain('does not mean that every aspect of the project was examined');
    expect(md).not.toContain('- Completeness: PARTIAL');
  });

  it('shows PARTIAL, the diagnostics and keeps the extracted facts', () => {
    const r = extract(RICH_ENTRIES, RICH_PKG, { limits: { maxDependenciesPerManifest: 1 } });
    expect(r.completeness).toBe('PARTIAL');
    const md = renderProjectMapProposal(r);
    expect(md).toContain('- Completeness: PARTIAL');
    expect(md).toContain('Some information may have been skipped');
    expect(md).toContain('`LIMIT_DEPENDENCIES` (extraction; makes the result PARTIAL)');
    expect(md).toContain('`alpha`'); // facts already extracted are not hidden
    expect(md).toContain('`build`');
  });

  it('renders an empty result with explicit "not observed" wording, never "the project has none"', () => {
    const r = validOrFail(extract([]));
    const md = renderProjectMapProposal(r);
    for (const s of [
      'No directory entries were observed.',
      'No language-by-extension observations were recorded.',
      'No known manifest file names were observed.',
      'No dependency declarations were observed.',
      'No script declarations were observed.',
      'No entrypoint candidates were observed.',
      'No diagnostics were reported.',
    ]) {
      expect(md).toContain(s);
    }
    expect(md).toContain('Not observing something is not evidence that it does not exist');
    expect(md).not.toMatch(/has no (dependencies|scripts|entrypoint)|project has no/i);
    expect(headings(md)).toEqual(EXPECTED_HEADINGS);
  });

  it('lists several languages, each with its extension and file count', () => {
    const md = renderProjectMapProposal(rich());
    expect(md).toContain('- `Python` (extension `.py`): 2 observed files; source coverage FULL');
    expect(md).toContain('- `TypeScript` (extension `.ts`): 2 observed files; source coverage FULL');
    expect(md.indexOf('`Python`')).toBeLessThan(md.indexOf('`TypeScript`'));
    expect(md).toContain('3 files have an extension with no known language mapping (reported, not guessed).');
  });

  it('lists several manifests and says which formats are analysed', () => {
    const md = renderProjectMapProposal(rich());
    expect(md).toContain('- `Cargo.toml` (ecosystem hint `cargo`): file name observed; content not analysed in this version');
    expect(md).toContain('- `package.json` (ecosystem hint `npm`): file name observed; content analysis is supported for this format; whether it was read is shown by the diagnostics');
    expect(md).toContain('- Analysed manifest format: package.json only.');
  });

  it('does not claim that every package.json was read', () => {
    const md = renderProjectMapProposal(rich());
    expect(md).not.toMatch(/was read successfully|were read successfully|all manifests were read/i);
    expect(md).toContain('package.json reads attempted: 1 (an attempt may have failed; see Limitations)');
  });

  it('lists declared dependencies by manifest and section with their JSON Pointer', () => {
    const md = renderProjectMapProposal(rich());
    expect(md).toContain('- Declared in `package.json`:');
    expect(md).toContain('  - `dependencies` (2):');
    expect(md).toContain('    - `alpha` — `package.json` at `/dependencies/alpha`');
    expect(md.indexOf('`alpha`')).toBeLessThan(md.indexOf('`zeta`'));
    expect(md).toContain('  - `devDependencies` (1):');
    expect(md).toContain('not resolved, not installed and not checked against use');
  });

  it('lists declared script names without commands', () => {
    const md = renderProjectMapProposal(rich());
    expect(md).toContain('  - `build` — `package.json` at `/scripts/build`');
    expect(md).toContain('Commands are neither stored nor run.');
    expect(md).not.toContain('tsc');
    expect(md).not.toContain('vitest run');
  });

  it('presents entrypoints as candidates only', () => {
    const md = renderProjectMapProposal(rich());
    expect(md).toContain('Candidate: `src/index.ts` (interpreted by rule `entrypoint-convention`');
    expect(md).toContain('It is not confirmed to start the program.');
  });

  it('renders diagnostics with origin, path and count', () => {
    const r = validOrFail(
      handMade([], [
        { code: 'MANIFEST_PARSE_ERROR', path: 'a/package.json', message: 'could not be parsed.' },
        { code: 'TRAVERSAL_LIMIT_ENTRIES', count: 7, message: 'entries beyond the limit were not listed.' },
        { code: 'MANIFEST_CONTENT_NOT_ANALYZED', count: 2, message: 'content is not analyzed.' },
      ], { completeness: 'PARTIAL', traversal: { completeness: 'PARTIAL', reproducible: true } }),
    );
    const md = renderProjectMapProposal(r);
    expect(md).toContain('- `MANIFEST_PARSE_ERROR` (extraction; makes the result PARTIAL), path `a/package.json`: `could not be parsed.`');
    expect(md).toContain('- `TRAVERSAL_LIMIT_ENTRIES` (reported by the traversal), count 7:');
    expect(md).toContain('- `MANIFEST_CONTENT_NOT_ANALYZED` (extraction; does not by itself make the result PARTIAL), count 2:');
  });

  it('shows the reproducible flag from the contract, unchanged', () => {
    const yes = renderProjectMapProposal(rich());
    expect(yes).toContain('- Reproducible: Yes');
    const unstable = validOrFail(extract(RICH_ENTRIES, RICH_PKG, {}, { reproducible: false }));
    expect(unstable.reproducible).toBe(false);
    const md = renderProjectMapProposal(unstable);
    expect(md).toContain('- Reproducible: No');
    expect(md).toContain('might not return this result');
  });

  it('shows every limit of the result in a fixed order', () => {
    const md = renderProjectMapProposal(rich());
    const keys = Object.keys(DEFAULT_DISCOVERY_LIMITS) as (keyof typeof DEFAULT_DISCOVERY_LIMITS)[];
    const m = md.match(/- Configured limits: (.*)\.\n/);
    expect(m).not.toBeNull();
    expect((m as RegExpMatchArray)[1].split('; ')).toHaveLength(keys.length);
    expect(md).toContain('directory depth 2');
    expect(md).toContain('sources listed for a language aggregate 3');
  });

  it('avoids wording that turns observations into knowledge', () => {
    const md = renderProjectMapProposal(rich());
    expect(md).not.toMatch(/Verified architecture|Actual entrypoint|Used dependency|Complete dependency graph/i);
    expect(md).toMatch(/Candidate|Declared|Observed/);
  });
});

// =================================================================================================
describe('provenance', () => {
  const many = Array.from({ length: 10 }, (_, i) => f(`src/m${i}.ts`));

  it('FULL coverage: lists all sources as such', () => {
    const md = renderProjectMapProposal(extract([f('a.ts'), f('b.ts')]));
    expect(md).toContain('source coverage FULL');
    expect(md).toContain('  - Sources (all 2 files):');
    expect(md).toContain('    - `a.ts`');
    expect(md).toContain('    - `b.ts`');
    expect(md).not.toContain('Source examples');
  });

  it('SAMPLE coverage: says examples, the number listed and that the list is not complete', () => {
    const r = extract(many);
    const md = renderProjectMapProposal(r);
    expect(md).toContain('10 observed files; source coverage SAMPLE');
    expect(md).toContain('  - Source examples (3 listed of 10 observed files; not a complete list):');
    expect(md).not.toContain('Sources (all');
    expect(md).not.toContain('`src/m5.ts`'); // only the sample is shown, nothing is invented
  });

  it('SAMPLE and FULL are counted in the evidence section', () => {
    const md = renderProjectMapProposal(extract([...many, f('x.py')]));
    expect(md).toContain('Source coverage: 1 aggregate is FULL and 1 aggregate is SAMPLE.');
  });

  it('keeps every source of a fact, in the result order', () => {
    const r = validOrFail(handMade([langFact('Go', '.go', 3, ['a/x.go', 'b/y.go', 'c/z.go'])]));
    const md = renderProjectMapProposal(r);
    expect(md.indexOf('`a/x.go`')).toBeLessThan(md.indexOf('`b/y.go`'));
    expect(md.indexOf('`b/y.go`')).toBeLessThan(md.indexOf('`c/z.go`'));
  });

  it('works for facts that rest on one source and for a result with no facts at all', () => {
    expect(() => renderProjectMapProposal(validOrFail(handMade([])))).not.toThrow();
    const md = renderProjectMapProposal(rich());
    expect(md).toContain('Every other fact rests on exactly the source listed with it.');
  });

  it('invents no source and prints no absolute path', () => {
    const md = renderProjectMapProposal(rich());
    expect(md).not.toContain(ROOT);
    const paths = new Set(md.match(/`[^`\n]+`/g)?.map((s) => s.slice(1, -1)) ?? []);
    for (const p of ['src/index.ts', 'src/a.py', 'package.json']) expect(paths.has(p)).toBe(true);
    expect(md).not.toMatch(/(^|[\s`])\/(home|tmp|usr|etc)\//);
  });

  it('counts facts by kind and labels their level', () => {
    const md = renderProjectMapProposal(rich());
    expect(md).toContain('  - ENTRYPOINT_CANDIDATE (INTERPRETED): 2');
    expect(md).toContain('  - DEPENDENCY_DECLARED (DETECTED): 3');
    expect(md).toContain('  - SCRIPT_DECLARED (DETECTED): 2');
  });
});

// =================================================================================================
describe('determinism', () => {
  it('renders the same text every time', () => {
    const r = rich();
    const first = renderProjectMapProposal(r);
    for (let i = 0; i < 5; i++) expect(renderProjectMapProposal(r)).toBe(first);
  });

  it('is the same for results extracted from shuffled traversal entries', () => {
    const base = renderProjectMapProposal(rich());
    const shuffles = [[...RICH_ENTRIES].reverse(), [...RICH_ENTRIES.slice(4), ...RICH_ENTRIES.slice(0, 4)], [RICH_ENTRIES[5], RICH_ENTRIES[0], RICH_ENTRIES[8], RICH_ENTRIES[2], RICH_ENTRIES[7], RICH_ENTRIES[1], RICH_ENTRIES[4], RICH_ENTRIES[3], RICH_ENTRIES[6]]];
    for (const s of shuffles) expect(renderProjectMapProposal(extract(s, RICH_PKG))).toBe(base);
  });

  it('is the same for the same data with object keys in another order (JSON round trip, reversed keys)', () => {
    const r = rich();
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;
    const other = reverseKeys(JSON.parse(JSON.stringify(r))) as DiscoveryResult;
    expect(renderProjectMapProposal(other)).toBe(renderProjectMapProposal(r));
  });

  it('refuses facts, sources or diagnostics that are not in the canonical order (it does not guess)', () => {
    const r = rich();
    const shuffledFacts: DiscoveryResult = { ...r, facts: [...r.facts].reverse() };
    expect(() => renderProjectMapProposal(shuffledFacts)).toThrow(DiscoveryError);

    const lang = langFact('Go', '.go', 3, ['a.go', 'b.go', 'c.go']);
    const shuffledSources = handMade([{ ...lang, sources: [...lang.sources].reverse() }]);
    expect(() => renderProjectMapProposal(shuffledSources)).toThrow(DiscoveryError);

    const diags: DiscoveryDiagnostic[] = [
      { code: 'MANIFEST_EMPTY', path: 'a/package.json', message: 'is empty.' },
      { code: 'MANIFEST_EMPTY', path: 'b/package.json', message: 'is empty.' },
    ];
    expect(() => renderProjectMapProposal(handMade([], diags))).not.toThrow();
    expect(() => renderProjectMapProposal(handMade([], [...diags].reverse()))).toThrow(DiscoveryError);
  });

  it('puts the output in canonical order for facts, sources and diagnostics', () => {
    const r = validOrFail(
      handMade(
        [langFact('Zig', '.zig', 1, ['z.zig']), langFact('Ada', '.adb', 1, ['a.adb']), depFact('p/package.json', 'b'), depFact('p/package.json', 'a')],
        [{ code: 'MANIFEST_EMPTY', path: 'a/package.json', message: 'is empty.' }, { code: 'MANIFEST_EMPTY', path: 'b/package.json', message: 'is empty.' }],
      ),
    );
    const md = renderProjectMapProposal(r);
    expect(md.indexOf('`Ada`')).toBeLessThan(md.indexOf('`Zig`'));
    expect(md.indexOf('    - `a` —')).toBeLessThan(md.indexOf('    - `b` —'));
    expect(md.indexOf('path `a/package.json`')).toBeLessThan(md.indexOf('path `b/package.json`'));
  });

  it('adds no time, random, host or environment-dependent value', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2001-02-03T04:05:06Z'));
    const a = renderProjectMapProposal(rich());
    vi.setSystemTime(new Date('2030-12-31T23:59:59Z'));
    const b = renderProjectMapProposal(rich());
    expect(b).toBe(a);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}/);
    expect(a).not.toMatch(/[0-9a-f]{16}/); // not even fact ids
    expect(a).not.toContain(process.cwd());
  });

  it('is independent of repeated values in an unrelated order of dependency names', () => {
    const a = renderProjectMapProposal(extract([f('package.json')], { dependencies: { b: '1', a: '1', c: '1' } }));
    const b = renderProjectMapProposal(extract([f('package.json')], { dependencies: { c: '1', a: '1', b: '1' } }));
    expect(b).toBe(a);
  });

  it('lists the same name declared in two sections once per section', () => {
    const md = renderProjectMapProposal(extract([f('package.json')], { dependencies: { x: '1' }, devDependencies: { x: '1' } }));
    expect(md).toContain('  - `dependencies` (1):');
    expect(md).toContain('  - `devDependencies` (1):');
    expect(md.match(/    - `x` —/g)).toHaveLength(2);
  });
});

// =================================================================================================
describe('security: untrusted strings', () => {
  const HOSTILE_NAMES = [
    '# Injected heading',
    '## Limitations',
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    '![img](data:text/html;base64,AAAA)',
    '<https://evil.example/>',
    '```\n'.replace('\n', ''),
    '`` ` ``',
    '- fake item',
    '1. fake numbered',
    '| a | b |',
    '> quote',
    '*bold* _em_ ~~x~~',
    '&lt;&amp;#x41;',
    '--- ',
  ];

  const resultWithNames = (names: string[]): DiscoveryResult => {
    const pkg = { dependencies: Object.fromEntries(names.map((n) => [n, '1'])), scripts: Object.fromEntries(names.map((n) => [n, 'x'])) };
    return validOrFail(extract([f('package.json')], pkg));
  };

  it('does not let a name create a heading, a section, a list item or a link', () => {
    const r = resultWithNames(HOSTILE_NAMES);
    // The extractor keeps these names; if it ever starts dropping some the test would be vacuous.
    expect(r.facts.filter((x) => x.kind === 'DEPENDENCY_DECLARED').length).toBeGreaterThanOrEqual(HOSTILE_NAMES.length - 2);
    const md = renderProjectMapProposal(r);
    expect(headings(md)).toEqual(EXPECTED_HEADINGS);
    // Every line is either fixed text, or a list item that starts with our own marker.
    for (const l of md.split('\n')) expect(l === '' || /^( *- |#{1,3} |This document reports)/.test(l)).toBe(true);
    // No list item begins with project data: after the bullet comes our own wording or a code span.
    for (const l of md.split('\n').filter((x) => /^ *- /.test(x))) expect(l).toMatch(/^ *- (?:[A-Z`0-9])/);
  });

  it('shows hostile text only inside code spans, so HTML and links are inert', () => {
    const md = renderProjectMapProposal(resultWithNames(['<img src=x onerror=alert(1)>', '[click](javascript:alert(1))', '<script>x</script>']));
    for (const frag of ['<img src=x onerror=alert(1)>', '[click](javascript:alert(1))', '<script>x</script>']) {
      const idx = md.indexOf(frag);
      expect(idx).toBeGreaterThan(0);
      expect(md[idx - 1]).toBe('`');
      expect(md[idx + frag.length]).toBe('`');
    }
    // Outside code spans no angle bracket, bracket pair or scheme appears.
    const outside = md.replace(/(`+)[^\n]*?\1/g, '');
    expect(outside).not.toMatch(/<[a-z!/]|\]\(|javascript:|data:/i);
  });

  it('cannot close its own code span with backticks or a code fence', () => {
    const names = ['a`b', 'x``y```z', '`lead', 'trail`', '```', '````js', ' spaced ', '`'];
    const md = renderProjectMapProposal(resultWithNames(names));
    expect(md).toContain('``a`b``');
    expect(md).toContain('````x``y```z````');
    expect(md).toContain('`` `lead ``');
    expect(md).toContain('`` trail` ``');
    expect(md).toContain('```` ``` ````');
    expect(md).toContain('`  spaced  `');
    expect(headings(md)).toEqual(EXPECTED_HEADINGS);
    // No line consists of, or starts with, a fence marker.
    for (const l of md.split('\n')) expect(l).not.toMatch(/^\s*(`{3,}|~{3,})/);
  });

  it('ties a code span to its fence: the text of every span is recoverable', () => {
    const md = renderProjectMapProposal(resultWithNames(['a`b', 'x``y']));
    const spans = [...md.matchAll(/(`+) ?([^\n]*?) ?\1(?!`)/g)].map((m) => m[2]);
    expect(spans).toContain('a`b');
    expect(spans).toContain('x``y');
  });

  it('refuses names, subjects and messages with newlines or control characters (the validator rejects them)', () => {
    const base = rich();
    for (const bad of ['evil\n# Heading', 'evil\r\n- item', 'a\u0000b', 'a\u001bb', 'a\u007fb', 'a\u0085b']) {
      const dep = depFact('package.json', 'x');
      const tampered = handMade([{ ...dep, object: bad, id: computeFactId(dep.kind, dep.subject, bad, dep.value), sources: [{ ...dep.sources[0], field: `/dependencies/${bad}` }] }]);
      expect(() => renderProjectMapProposal(tampered)).toThrow(DiscoveryError);
      const message: DiscoveryResult = { ...base, diagnostics: [{ code: 'MANIFEST_EMPTY', message: `x${bad}` }] };
      expect(() => renderProjectMapProposal(message)).toThrow(DiscoveryError);
    }
  });

  it('shows characters that the validator allows but that can hide or reorder text as [U+XXXX]', () => {
    const lang = fact('LANGUAGE_BY_EXTENSION', 'Evil\u202Elanguage\u2028\u200B\uFEFF\u2066x', { object: '.ev', value: '1', sources: [{ path: 'a.ev', observation: 'extension' }] });
    const r = validOrFail(handMade([lang], [{ code: 'MANIFEST_EMPTY', message: 'line\u2029break and lone \uD800 surrogate' }]));
    const md = renderProjectMapProposal(r);
    expect(md).toContain('Evil[U+202E]language[U+2028][U+200B][U+FEFF][U+2066]x');
    expect(md).toContain('line[U+2029]break and lone [U+D800] surrogate');
    expect(md).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u2028\u2029\u200B\uFEFF]/);
    expect(md.split('\n').every((l) => !/[\u2028\u2029]/.test(l))).toBe(true);
    expect(headings(md)).toEqual(EXPECTED_HEADINGS);
  });

  it('keeps non-ASCII text that is harmless', () => {
    const r = resultWithNames(['@scope/пакет', '日本語', 'émoji-😀']);
    const md = renderProjectMapProposal(r);
    expect(md).toContain('`@scope/пакет`');
    expect(md).toContain('`日本語`');
    expect(md).toContain('`émoji-😀`');
  });

  describe('C1 controls (U+0080–U+009F) and whitespace-only values', () => {
    const RAW_CONTROLS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/; // everything but the line feed that ends our own lines
    const withPaths = (paths: string[], diagPath?: string): DiscoveryResult =>
      validOrFail(handMade([langFact('TypeScript', '.ts', paths.length, paths)], diagPath === undefined ? [] : [{ code: 'MANIFEST_EMPTY', path: diagPath, message: 'is empty.' }]));

    it.each([
      ['\u0080', '[U+0080]'],
      ['\u0085', '[U+0085]'],
      ['\u009B', '[U+009B]'],
      ['\u009F', '[U+009F]'],
    ])('shows %j in source.path as %s, with four hex digits', (c, shown) => {
      const md = renderProjectMapProposal(withPaths([`d/a${c}b.ts`]));
      expect(md).toContain(`d/a${shown}b.ts`);
      expect(md).not.toMatch(RAW_CONTROLS);
    });

    it('shows C1 in source.path of a language aggregate and in diagnostic.path', () => {
      const md = renderProjectMapProposal(withPaths(['d/a\u0085b\u009Bc.ts'], 'e/x\u0080y.json'));
      expect(md).toContain('`d/a[U+0085]b[U+009B]c.ts`');
      expect(md).toContain('`e/x[U+0080]y.json`');
      expect(md).not.toMatch(RAW_CONTROLS);
    });

    it('shows a mix of C0-range-adjacent, C1, format and ordinary characters, and keeps the ordinary ones', () => {
      const md = renderProjectMapProposal(withPaths(['d/\u0080a\u009F​б日😀é.ts']));
      expect(md).toContain('d/[U+0080]a[U+009F][U+200B]б日😀é.ts');
      expect(md).not.toMatch(RAW_CONTROLS);
    });

    it('never lets a C1 or C0 control in through free text: the validator rejects them, so only paths can carry C1', () => {
      for (const bad of ['\u0001', '\u001F', '\u007F', '\u0080', '\u0085', '\u009B', '\u009F']) {
        expect(() => renderProjectMapProposal(handMade([], [{ code: 'MANIFEST_EMPTY', message: `x${bad}y` }]))).toThrow(DiscoveryError);
      }
    });

    it('is deterministic and does not change its input', () => {
      const r = withPaths(['d/a\u0085b.ts'], 'e/\u009F.json');
      const before = JSON.stringify(r);
      const a = renderProjectMapProposal(r);
      expect(renderProjectMapProposal(r)).toBe(a);
      expect(JSON.stringify(r)).toBe(before);
    });

    it('shows a spaces-only value with exactly its spaces (no extra padding), distinct from an empty one', () => {
      for (const [spaces, expected] of [[' ', '` `'], ['   ', '`   `']] as const) {
        const md = renderProjectMapProposal(validOrFail(handMade([], [{ code: 'MANIFEST_EMPTY', message: spaces }])));
        expect(md).toContain(`${expected}`);
        expect(md).not.toContain(`\`${' '.repeat(spaces.length + 2)}\``);
      }
      const edge = renderProjectMapProposal(validOrFail(handMade([], [{ code: 'MANIFEST_EMPTY', message: ' a ' }])));
      expect(edge).toContain('`  a  `');
    });
  });

  it('labels FILE_PRESENT as evidence for entrypoint candidates, not as a count of project files', () => {
    const md = renderProjectMapProposal(rich());
    expect(md).toMatch(/- FILE_PRESENT \(DETECTED\): \d+ \(file evidence for entrypoint candidates only; not a count of project files\)/);
  });

  it('shows hostile path characters inside code spans (a path may hold Markdown syntax)', () => {
    const paths = ['# not a heading/package.json', '[x](y)/package.json', 'a b|c/<b>/package.json', '- item/package.json'];
    const md = renderProjectMapProposal(validOrFail(extract(paths.map(f))));
    for (const p of paths) expect(md).toContain(`\`${p}\``);
    expect(headings(md)).toEqual(EXPECTED_HEADINGS);
    for (const l of md.split('\n').filter((x) => x.startsWith('- '))) expect(l).toMatch(/^- [A-Z`0-9]/);
  });

  it('cuts very long strings and says so', () => {
    const long = 'x'.repeat(100_000);
    const r = validOrFail(handMade([], [{ code: 'MANIFEST_EMPTY', message: long }]));
    const md = renderProjectMapProposal(r);
    expect(md.length).toBeLessThan(20_000);
    expect(md).toContain('…[truncated; 100000 UTF-16 units in total]');
    expect(md).not.toContain('x'.repeat(4097));
  });

  it('does not split a surrogate pair when it cuts, and stays fast on a huge string', () => {
    const long = '😀'.repeat(3_000_000);
    const r = validOrFail(handMade([], [{ code: 'MANIFEST_EMPTY', message: long }]));
    const started = Date.now();
    const md = renderProjectMapProposal(r);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(md).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(md).toContain('😀'.repeat(4096) + '…[truncated');
  });

  it('keeps a bounded result bounded: size grows with the number of facts, not with repetition of text', () => {
    const names = Array.from({ length: 500 }, (_, i) => `n${i}`);
    const r = resultWithNames(names);
    const md = renderProjectMapProposal(r);
    expect(md.length).toBeLessThan(200_000);
    expect(r.facts.length).toBeLessThanOrEqual(r.limits.maxFacts);
  });
});

// =================================================================================================
describe('security: invalid input', () => {
  const secret = 'SECRET-TOKEN-do-not-leak';

  it('throws DiscoveryError(RESULT_INVALID) and renders nothing for a malformed result', () => {
    for (const bad of [null, undefined, 42, 'text', [], {}, { ...rich(), schemaVersion: 2 }, { ...rich(), completeness: 'DONE' }, { ...rich(), extra: 1 }]) {
      let caught: unknown;
      try {
        renderProjectMapProposal(bad as unknown as DiscoveryResult);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(DiscoveryError);
      expect((caught as DiscoveryError).code).toBe('RESULT_INVALID');
    }
  });

  it('does not put input values in the error message', () => {
    const dep = depFact('package.json', 'ok');
    const tampered = handMade([dep], [{ code: 'MANIFEST_EMPTY', message: `bad ${secret}\nline` }]);
    let message = '';
    try {
      renderProjectMapProposal(tampered);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('failed validation');
    expect(message).not.toContain(secret);
    const unknownKey = { ...rich(), [secret]: 1 } as unknown as DiscoveryResult;
    try {
      renderProjectMapProposal(unknownKey);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain(secret);
  });

  it('rejects a result whose stated coverage cannot be true', () => {
    const lie = handMade([langFact('Go', '.go', 10, ['a.go'])]); // 10 files but 1 source (maxSourcesPerFact is 3)
    expect(() => renderProjectMapProposal(lie)).toThrow(DiscoveryError);
  });

  it('rejects a COMPLETE verdict that contradicts its diagnostics, and an absolute path in a message', () => {
    expect(() => renderProjectMapProposal(handMade([], [{ code: 'MANIFEST_PARSE_ERROR', message: 'could not be parsed.' }]))).toThrow(DiscoveryError);
    expect(() => renderProjectMapProposal(handMade([], [{ code: 'MANIFEST_EMPTY', message: 'see /etc/passwd' }]))).toThrow(DiscoveryError);
  });
});

// =================================================================================================
describe('contract', () => {
  const source = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');

  it('imports nothing but the Discovery contract (no fs, network, process or model access)', () => {
    const imports = [...source.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]);
    expect(imports).toEqual(['./contracts.js']);
    expect(source).not.toMatch(/\brequire\(|\bimport\(|\bfetch\(|XMLHttpRequest|WebSocket|child_process|\bfs\b|node:|process\.(env|cwd|argv)|\bos\./);
  });

  it('keeps no clock, randomness or global state', () => {
    expect(source).not.toMatch(/Date\.now|new Date|Math\.random|performance\.now|crypto|Intl\.|toLocale|localeCompare/);
    expect(source).not.toMatch(/^(let|var) /m);
  });

  it('does not write, and has no file or CLI entry point', () => {
    expect(source).not.toMatch(/writeFile|appendFile|mkdir|unlink|console\./);
    expect(renderProjectMapProposal.length).toBe(1);
  });

  it('does not modify its input (deeply frozen input renders and is unchanged)', () => {
    const r = rich();
    const before = JSON.stringify(r);
    const freeze = (v: unknown): void => {
      if (v && typeof v === 'object') {
        Object.freeze(v);
        Object.values(v).forEach(freeze);
      }
    };
    freeze(r);
    expect(() => renderProjectMapProposal(r)).not.toThrow();
    expect(JSON.stringify(r)).toBe(before);
  });

  it('works on data alone: the paths in the result do not have to exist and are never opened', () => {
    const md = renderProjectMapProposal(extract([f('does/not/exist/package.json'), f('ghost.ts')]));
    expect(md).toContain('`does/not/exist/package.json`');
  });

  it('adds no analysis of its own: documentation and other manifests stay unanalysed', () => {
    const md = renderProjectMapProposal(extract([f('README.md'), f('docs/guide.md'), f('pyproject.toml'), f('pnpm-workspace.yaml')], undefined));
    expect(md).toContain('content not analysed in this version');
    expect(md).toContain('Documentation files were not analysed.');
    expect(md).not.toMatch(/README|guide\.md/); // not even mentioned: no fact exists for them
    expect(md).toContain('No dependency declarations were observed.');
  });

  it('is exported from the discovery index, not from the package root', async () => {
    const index = await import('./index.js');
    expect(index.renderProjectMapProposal).toBe(renderProjectMapProposal);
    const root = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(root).not.toMatch(/renderProjectMapProposal|discovery\/render/);
  });
});
