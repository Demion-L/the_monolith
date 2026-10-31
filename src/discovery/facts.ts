/**
 * Deterministic structural fact extraction (DISCOVERY-001B-2, ADR-021).
 *
 * Input: a `TraversalResult` (what exists). Output: a `DiscoveryResult` (facts with sources).
 * It states what the files show and nothing about what the project is: no component roles,
 * no verified entrypoints, no "main language", no installed or resolved dependencies.
 *
 * Reading: the only content read is `package.json` (at most `maxManifestReads` of them, at most
 * `maxManifestBytes` each), through `readProjectFile` (ADR-011/014: every component below the project
 * root is `lstat`-checked and none may be a symlink, `O_NOFOLLOW|O_NONBLOCK`, regular single-link
 * file, bounded read). The traversal having listed a path proves nothing about the next read, so
 * every read is made on its own terms. It only extracts JSON via `JSON.parse`; it never evaluates,
 * runs or imports project code, never uses a subprocess or the network.
 * `scripts` values and dependency version specifiers are never read into a fact.
 * TOML/YAML manifests are recognised by name and not parsed (no home-made parsers).
 *
 * NOT defended (ADR-013, SEC-001B.3 open; TM-C unsupported): a process that swaps a directory or
 * file between the check and the open. Do not run it on a tree an untrusted process is modifying.
 *
 * Nested MONOLITH: a sub-project's source is part of this project. A directory named `.monolith`
 * (other than the real root, which the traversal already excluded) is treated as that sub-project's
 * internal state only when its content proves it (`state.json` plus `memory/` or `context/` in the
 * inventory); then its entries are left out of the facts. A bare name proves nothing: the directory
 * stays in and a diagnostic says it is unconfirmed. A nested instance whose root is renamed through
 * its own config is not recognised (that needs reading foreign config: a separate decision).
 *
 * Determinism: every input is sorted by UTF-16 code units before use, so the order of
 * `traversal.entries` cannot change the result; no clock, absolute path or host value is read.
 */

import { isAbsolute } from 'path';
import { readProjectFile, type ProjectFileErrorCode, type ProjectFileRead } from '../root/index.js';
import type { TraversalEntry, TraversalResult } from './traverse.js';
import {
  DEPENDENCY_SECTIONS,
  DISCOVERY_SCHEMA_VERSION,
  DiscoveryError,
  EXTRACTION_DIAGNOSTIC_AFFECTS_COMPLETENESS,
  EXTRACTION_DIAGNOSTIC_IS_STABLE,
  FACT_LEVEL_BY_KIND,
  compareDiagnostics,
  compareFacts,
  compareSources,
  compareUtf16,
  computeFactId,
  isKeepableName,
  isSafeRelativePath,
  pointerToken,
  validateDiscoveryResult,
  type DiscoveryDiagnostic,
  type DiscoveryFact,
  type DiscoveryFactKind,
  type DiscoveryLimits,
  type DiscoveryResult,
  type DiscoverySource,
  type ExtractionDiagnosticCode,
} from './contracts.js';

export const DEFAULT_DISCOVERY_LIMITS: Readonly<DiscoveryLimits> = Object.freeze({
  maxDirectoryFacts: 200,
  maxDirectoryDepth: 2,
  maxLanguageFacts: 64,
  maxManifestFacts: 50,
  maxManifestReads: 20,
  maxManifestBytes: 256 * 1024,
  maxDependenciesPerManifest: 500,
  maxScriptsPerManifest: 100,
  maxEntrypointFacts: 20,
  maxFacts: 5000,
  maxDiagnostics: 200,
  maxNameLength: 214,
  maxSourcesPerFact: 3,
});

/** Extension (lower case, with the dot) to language. Evidence is the extension and nothing else. */
export const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.c': 'C',
  '.h': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.swift': 'Swift',
  '.vue': 'Vue',
});

/** Known manifest file name to the ecosystem its presence points at (a presence, not a runtime use). */
export const KNOWN_MANIFESTS: Readonly<Record<string, string>> = Object.freeze({
  'package.json': 'npm',
  'pnpm-workspace.yaml': 'pnpm',
  'pyproject.toml': 'python',
  'requirements.txt': 'pip',
  'Cargo.toml': 'cargo',
  'go.mod': 'go',
});

/** Project-relative file names that may start a program. Only candidates, ever. */
export const ENTRYPOINT_CANDIDATE_PATHS: readonly string[] = [
  'index.js',
  'index.ts',
  'main.js',
  'main.ts',
  'server.js',
  'server.ts',
  'app.js',
  'app.ts',
  'src/index.js',
  'src/index.ts',
  'src/main.js',
  'src/main.ts',
  'src/server.js',
  'src/server.ts',
  'src/app.js',
  'src/app.ts',
  'app.py',
  'main.py',
  'manage.py',
  'src/app.py',
  'src/main.py',
  'main.go',
  'src/main.rs',
];

const LIMIT_KEYS = Object.keys(DEFAULT_DISCOVERY_LIMITS) as (keyof DiscoveryLimits)[];

export type ManifestReader = (projectRoot: string, relPath: string, opts: { maxBytes: number }) => ProjectFileRead;

export interface ExtractOptions {
  limits?: Partial<DiscoveryLimits>;
  /** @internal Test seam; production uses `readProjectFile`. */
  readManifest?: ManifestReader;
}

function resolveLimits(partial: Partial<DiscoveryLimits> | undefined): DiscoveryLimits {
  const limits: DiscoveryLimits = { ...DEFAULT_DISCOVERY_LIMITS };
  for (const [key, value] of Object.entries(partial ?? {})) {
    if (!(LIMIT_KEYS as string[]).includes(key)) throw new DiscoveryError('INVALID_LIMITS', `unknown limit "${key}".`);
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw new DiscoveryError('INVALID_LIMITS', `limit "${key}" must be a positive integer.`);
    }
    limits[key as keyof DiscoveryLimits] = value;
  }
  return limits;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

class Diagnostics {
  private readonly list: (DiscoveryDiagnostic & { code: ExtractionDiagnosticCode })[] = [];
  add(code: ExtractionDiagnosticCode, message: string, path?: string, count?: number): void {
    const d: DiscoveryDiagnostic & { code: ExtractionDiagnosticCode } = { code, message };
    if (path !== undefined) d.path = path;
    if (count !== undefined) d.count = count;
    this.list.push(d);
  }
  all(): readonly (DiscoveryDiagnostic & { code: ExtractionDiagnosticCode })[] {
    return this.list;
  }
}

// ---------------------------------------------------------------------------
// Fact sink: one place that builds ids, merges equal facts, enforces the global budget
// ---------------------------------------------------------------------------

class FactSink {
  private readonly byId = new Map<string, DiscoveryFact>();
  dropped = 0;
  constructor(private readonly max: number) {}

  get size(): number {
    return this.byId.size;
  }

  /** Adds facts as one unit (an interpretation and its basis stay together); false when the budget refuses. */
  addAll(specs: FactSpec[]): boolean {
    const ids = specs.map((s) => computeFactId(s.kind, s.subject, s.object, s.value));
    const added = new Set(ids.filter((id) => !this.byId.has(id)));
    if (this.byId.size + added.size > this.max) {
      this.dropped += specs.length;
      return false;
    }
    for (const s of specs) this.put(s);
    return true;
  }

  private put(s: FactSpec): void {
    const id = computeFactId(s.kind, s.subject, s.object, s.value);
    const existing = this.byId.get(id);
    if (existing) {
      if (existing.kind !== s.kind || existing.subject !== s.subject || existing.object !== s.object || existing.value !== s.value) {
        throw new DiscoveryError('ID_COLLISION', `fact id ${id} is shared by two different facts.`);
      }
      const merged = new Map(existing.sources.map((x) => [JSON.stringify(x), x]));
      for (const x of s.sources) merged.set(JSON.stringify(x), x);
      existing.sources = [...merged.values()].sort(compareSources);
      return;
    }
    const fact: DiscoveryFact = { id, kind: s.kind, level: FACT_LEVEL_BY_KIND[s.kind], subject: s.subject, rule: s.rule, sources: [...s.sources].sort(compareSources) };
    if (s.object !== undefined) fact.object = s.object;
    if (s.value !== undefined) fact.value = s.value;
    if (s.basis) fact.basis = [...s.basis].sort(compareUtf16);
    this.byId.set(id, fact);
  }

  facts(): DiscoveryFact[] {
    return [...this.byId.values()].sort(compareFacts);
  }
}

interface FactSpec {
  kind: DiscoveryFactKind;
  subject: string;
  object?: string;
  value?: string;
  rule: string;
  basis?: string[];
  sources: DiscoverySource[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const depthOf = (p: string): number => p.split('/').length;
const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

function extensionOf(path: string): string | undefined {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  // `.gitignore`-style names and names ending in a dot have no extension.
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return name.slice(dot).toLowerCase();
}

function compareDepthThenPath(a: string, b: string): number {
  return depthOf(a) - depthOf(b) || compareUtf16(a, b);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// package.json
// ---------------------------------------------------------------------------

interface ParsedManifest {
  path: string;
  /** In section order, then name order; truncated to the per-manifest cap. */
  dependencies: { name: string; section: (typeof DEPENDENCY_SECTIONS)[number] }[];
  scripts: string[];
}

/** Every code `readProjectFile` can return; anything else is reported as `UNKNOWN`. Exhaustive by type. */
const READ_ERROR_CODES: ReadonlySet<unknown> = new Set(
  Object.keys({
    FILE_MISSING: 0,
    FILE_OUTSIDE_PROJECT: 0,
    FILE_UNRESOLVABLE: 0,
    FILE_NOT_REGULAR: 0,
    FILE_EMPTY: 0,
    FILE_TOO_LARGE: 0,
    FILE_CHANGED: 0,
    FILE_UNREADABLE: 0,
    FILE_SYMLINK: 0,
    FILE_HARDLINKED: 0,
    READ_BOUNDARY_INVALID: 0,
    READ_UNSUPPORTED_PLATFORM: 0,
  } satisfies Record<ProjectFileErrorCode, 0>),
);

function parsePackageJson(
  projectRoot: string,
  path: string,
  limits: DiscoveryLimits,
  read: ManifestReader,
  diag: Diagnostics,
): ParsedManifest | undefined {
  // The reader is a seam: whatever it returns or throws is untrusted. Only a code from the closed
  // list below, a size-checked string and a fixed message can come out of this block.
  let content: string;
  try {
    const r = read(projectRoot, path, { maxBytes: limits.maxManifestBytes });
    if (r.ok) {
      if (typeof r.content !== 'string') throw new TypeError('content');
      content = r.content;
    } else {
      // `detail` may carry an absolute path or a system message: never read.
      const code = READ_ERROR_CODES.has(r.code) ? r.code : 'UNKNOWN';
      if (code === 'FILE_EMPTY') diag.add('MANIFEST_EMPTY', 'the manifest is empty; nothing was extracted.', path);
      else if (code === 'FILE_TOO_LARGE') diag.add('MANIFEST_TOO_LARGE', `the manifest exceeds ${limits.maxManifestBytes} bytes and was not read.`, path);
      else diag.add('MANIFEST_READ_FAILED', `the manifest was refused or could not be read (${code}).`, path);
      return undefined;
    }
  } catch {
    diag.add('MANIFEST_READ_FAILED', 'the manifest could not be read (unexpected failure).', path);
    return undefined;
  }

  let doc: unknown;
  try {
    // JSON.parse only: no reviver, no evaluation. Its error text can quote the input, so it is dropped.
    doc = JSON.parse(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content);
  } catch {
    diag.add('MANIFEST_PARSE_ERROR', 'the manifest is not valid JSON; nothing was extracted.', path);
    return undefined;
  }
  if (!isPlainObject(doc)) {
    diag.add('MANIFEST_FIELD_INVALID', 'the top-level JSON value is not an object; nothing was extracted.', path);
    return undefined;
  }

  const section = (name: string): string[] | undefined => {
    if (!Object.prototype.hasOwnProperty.call(doc, name)) return undefined;
    const v = (doc as Record<string, unknown>)[name];
    if (!isPlainObject(v)) {
      diag.add('MANIFEST_FIELD_INVALID', `field "${name}" is not an object and was ignored.`, path);
      return undefined;
    }
    // Keys only. The values (version specifiers, commands) are never touched.
    return Object.keys(v).sort(compareUtf16);
  };

  let rejected = 0;
  const dependencies: ParsedManifest['dependencies'] = [];
  let droppedDeps = 0;
  const seen = new Set<string>();
  for (const sec of DEPENDENCY_SECTIONS) {
    for (const name of section(sec) ?? []) {
      if (!isKeepableName(name, limits.maxNameLength)) {
        rejected++;
        continue;
      }
      const key = `${sec}\u0000${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (dependencies.length >= limits.maxDependenciesPerManifest) droppedDeps++;
      else dependencies.push({ name, section: sec });
    }
  }
  const scripts: string[] = [];
  let droppedScripts = 0;
  for (const name of section('scripts') ?? []) {
    if (!isKeepableName(name, limits.maxNameLength)) {
      rejected++;
      continue;
    }
    if (scripts.length >= limits.maxScriptsPerManifest) droppedScripts++;
    else scripts.push(name);
  }
  if (rejected > 0) diag.add('MANIFEST_VALUE_REJECTED', 'names that are empty, too long or contain control, bidirectional or invalid characters were not kept.', path, rejected);
  if (droppedDeps > 0) diag.add('LIMIT_DEPENDENCIES', `dependency names beyond ${limits.maxDependenciesPerManifest} were not kept.`, path, droppedDeps);
  if (droppedScripts > 0) diag.add('LIMIT_SCRIPTS', `script names beyond ${limits.maxScriptsPerManifest} were not kept.`, path, droppedScripts);
  return { path, dependencies, scripts };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const ENTRY_KINDS = new Set(['file', 'directory', 'symlink', 'other']);

export function extractProjectFacts(projectRoot: string, traversal: TraversalResult, options: ExtractOptions = {}): DiscoveryResult {
  if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot)) {
    throw new DiscoveryError('INVALID_INPUT', 'the project root must be an explicit absolute path.');
  }
  if (
    !traversal ||
    !Array.isArray(traversal.entries) ||
    !Array.isArray(traversal.diagnostics) ||
    (traversal.completeness !== 'COMPLETE' && traversal.completeness !== 'PARTIAL') ||
    typeof traversal.reproducible !== 'boolean'
  ) {
    throw new DiscoveryError('INVALID_INPUT', 'the traversal result is malformed.');
  }
  const limits = resolveLimits(options.limits);
  const read = options.readManifest ?? ((root, rel, o) => readProjectFile(root, rel, { maxBytes: o.maxBytes }));
  const diag = new Diagnostics();

  // 1. Input hygiene: a handcrafted or corrupted entry must not reach a path join or a fact.
  let rejectedPaths = 0;
  const kindByPath = new Map<string, TraversalEntry['kind']>();
  for (const e of traversal.entries) {
    if (!e || !ENTRY_KINDS.has(e.kind) || !isSafeRelativePath(e.path)) {
      rejectedPaths++;
      continue;
    }
    // Duplicate path with another kind: the lexically smaller kind wins, independent of input order.
    const prior = kindByPath.get(e.path);
    if (prior === undefined || compareUtf16(e.kind, prior) < 0) kindByPath.set(e.path, e.kind);
  }
  if (rejectedPaths > 0) diag.add('INPUT_PATH_REJECTED', 'traversal entries with an unsafe path or an unknown kind were ignored.', undefined, rejectedPaths);

  // 2. Nested MONOLITH state (confirmed by content only; a name alone proves nothing).
  const nestedState: string[] = [];
  for (const [path, kind] of [...kindByPath].sort((a, b) => compareUtf16(a[0], b[0]))) {
    if (kind !== 'directory' || baseName(path) !== '.monolith') continue;
    const has = (rel: string, k: string): boolean => kindByPath.get(`${path}/${rel}`) === k;
    if (has('state.json', 'file') && (has('memory', 'directory') || has('context', 'directory'))) {
      nestedState.push(path);
      diag.add('NESTED_MONOLITH_STATE_EXCLUDED', 'a nested MONOLITH instance state directory (confirmed by its content) is not part of the facts.', path);
    } else {
      diag.add('NESTED_MONOLITH_UNCONFIRMED', 'a directory named .monolith was found but its content does not confirm a MONOLITH instance; it is kept as ordinary content.', path);
    }
  }
  const nestedSet = new Set(nestedState);
  const insideNested = (path: string): boolean => {
    for (let i = path.indexOf('/'); ; i = path.indexOf('/', i + 1)) {
      if (nestedSet.has(i === -1 ? path : path.slice(0, i))) return true;
      if (i === -1) return false;
    }
  };
  const kept = [...kindByPath].filter(([p]) => !insideNested(p)).sort((a, b) => compareUtf16(a[0], b[0]));
  const excludedEntries = traversal.entries.length - kept.length;
  const files = kept.filter(([, k]) => k === 'file').map(([p]) => p);
  const sink = new FactSink(limits.maxFacts);

  // 3. Manifests: presence (by name) is separated from content (read below).
  const manifestCandidates: string[] = [];
  for (const [path, kind] of kept) {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_MANIFESTS, baseName(path))) continue;
    if (kind === 'file') manifestCandidates.push(path);
    else if (kind === 'symlink' || kind === 'other') diag.add('MANIFEST_NOT_REGULAR_FILE', `an entry with the name of a known manifest is not a regular file (${kind}); it was not treated as a manifest.`, path);
  }
  manifestCandidates.sort(compareDepthThenPath);
  const manifests = manifestCandidates.slice(0, limits.maxManifestFacts);
  if (manifestCandidates.length > manifests.length) {
    diag.add('LIMIT_MANIFEST_FACTS', `manifests beyond ${limits.maxManifestFacts} (deepest last) were not recorded.`, undefined, manifestCandidates.length - manifests.length);
  }

  // 4. Entrypoint candidates (INTERPRETED) rest on a DETECTED file fact.
  const present = new Set(files);
  const candidates = ENTRYPOINT_CANDIDATE_PATHS.filter((p) => present.has(p)).sort(compareUtf16);
  const candidateSpecs = candidates.slice(0, limits.maxEntrypointFacts);
  if (candidates.length > candidateSpecs.length) {
    diag.add('LIMIT_ENTRYPOINT_FACTS', `entrypoint candidates beyond ${limits.maxEntrypointFacts} were not recorded.`, undefined, candidates.length - candidateSpecs.length);
  }

  // 5. Languages by extension.
  const groups = new Map<string, { language: string; ext: string; paths: string[] }>();
  let withoutLanguage = 0;
  for (const path of files) {
    const ext = extensionOf(path);
    const language = ext !== undefined && Object.prototype.hasOwnProperty.call(LANGUAGE_BY_EXTENSION, ext) ? LANGUAGE_BY_EXTENSION[ext] : undefined;
    if (ext === undefined || language === undefined) {
      withoutLanguage++;
      continue;
    }
    const g = groups.get(ext) ?? { language, ext, paths: [] };
    g.paths.push(path);
    groups.set(ext, g);
  }
  const languageGroups = [...groups.values()].sort((a, b) => compareUtf16(a.language, b.language) || compareUtf16(a.ext, b.ext));

  // 6. Directories (shallow, bounded).
  const dirs = kept
    .filter(([p, k]) => k === 'directory' && depthOf(p) <= limits.maxDirectoryDepth)
    .map(([p]) => p)
    .sort(compareDepthThenPath);

  // 7. Manifest content: package.json only, bounded in count and size.
  const packageJsons = manifests.filter((p) => baseName(p) === 'package.json');
  const toRead = packageJsons.slice(0, limits.maxManifestReads);
  if (packageJsons.length > toRead.length) {
    diag.add('LIMIT_MANIFEST_READS', `package.json files beyond ${limits.maxManifestReads} were recorded as present but not read.`, undefined, packageJsons.length - toRead.length);
  }
  const parsed: ParsedManifest[] = [];
  for (const p of toRead) {
    const m = parsePackageJson(projectRoot, p, limits, read, diag);
    if (m) parsed.push(m);
  }
  const unparsedNames = new Map<string, number>();
  for (const p of manifests) {
    const name = baseName(p);
    if (name !== 'package.json') unparsedNames.set(name, (unparsedNames.get(name) ?? 0) + 1);
  }
  for (const [name, count] of [...unparsedNames].sort((a, b) => compareUtf16(a[0], b[0]))) {
    diag.add('MANIFEST_CONTENT_NOT_ANALYZED', `${name}: recorded as present; its content is not analyzed in this version.`, undefined, count);
  }

  // 8. Emit in priority order, so the global budget (`maxFacts`) cuts the bulkiest, least structural
  //    facts (dependency names) first and deterministically.
  const emit = (kind: DiscoveryFactKind, subject: string, rule: string, source: DiscoverySource, extra: Partial<FactSpec> = {}): FactSpec => ({
    kind,
    subject,
    rule,
    sources: [source],
    ...extra,
  });
  for (const p of manifests) {
    sink.addAll([emit('MANIFEST_PRESENT', p, 'known-manifest-file-name', { path: p, observation: 'file-name' }, { object: KNOWN_MANIFESTS[baseName(p)] })]);
  }
  for (const p of candidateSpecs) {
    const fileId = computeFactId('FILE_PRESENT', p);
    sink.addAll([
      emit('FILE_PRESENT', p, 'conventional-file-name', { path: p, observation: 'file-entry' }),
      emit('ENTRYPOINT_CANDIDATE', p, 'entrypoint-convention', { path: p, observation: 'file-name' }, { value: 'candidate', basis: [fileId] }),
    ]);
  }
  let languageDropped = 0;
  languageGroups.forEach((g, i) => {
    if (i >= limits.maxLanguageFacts) {
      languageDropped++;
      return;
    }
    // `value` counts every file of the group; the sources are the first few in UTF-16 order (a sample).
    const example = g.paths.slice(0, limits.maxSourcesPerFact);
    sink.addAll([
      {
        kind: 'LANGUAGE_BY_EXTENSION',
        subject: g.language,
        object: g.ext,
        value: String(g.paths.length),
        rule: 'extension-map',
        sources: example.map((path) => ({ path, observation: 'extension' as const })),
      },
    ]);
  });
  if (languageDropped > 0) diag.add('LIMIT_LANGUAGE_FACTS', `language facts beyond ${limits.maxLanguageFacts} were not recorded.`, undefined, languageDropped);
  const dirsKept = dirs.slice(0, limits.maxDirectoryFacts);
  for (const p of dirsKept) sink.addAll([emit('DIRECTORY', p, 'walk-directory', { path: p, observation: 'directory-entry' })]);
  if (dirs.length > dirsKept.length) diag.add('LIMIT_DIRECTORY_FACTS', `directories beyond ${limits.maxDirectoryFacts} (deepest last) were not recorded.`, undefined, dirs.length - dirsKept.length);
  for (const m of parsed) {
    for (const name of m.scripts) {
      sink.addAll([emit('SCRIPT_DECLARED', m.path, 'package-json-scripts', { path: m.path, observation: 'manifest-field', field: `/scripts/${pointerToken(name)}` }, { object: name })]);
    }
  }
  for (const m of parsed) {
    for (const d of m.dependencies) {
      sink.addAll([
        emit('DEPENDENCY_DECLARED', m.path, `package-json-${d.section}`, { path: m.path, observation: 'manifest-field', field: `/${d.section}/${pointerToken(d.name)}` }, { object: d.name, value: d.section }),
      ]);
    }
  }
  if (sink.dropped > 0) diag.add('LIMIT_FACTS', `facts beyond ${limits.maxFacts} were not recorded (dependency and script names are cut first).`, undefined, sink.dropped);

  // 9. Diagnostics: extraction first (completeness-affecting before the rest), then the traversal's.
  const fromTraversal: DiscoveryDiagnostic[] = traversal.diagnostics.map((d) => {
    const out: DiscoveryDiagnostic = { code: `TRAVERSAL_${String(d.code)}`, message: String(d.message) };
    if (d.path !== undefined && isSafeRelativePath(d.path)) out.path = d.path;
    if (d.count !== undefined) out.count = d.count;
    return out;
  });
  let diagnostics: DiscoveryDiagnostic[] = [...diag.all(), ...fromTraversal].sort(compareDiagnostics);
  let diagnosticsDropped = 0;
  if (diagnostics.length > limits.maxDiagnostics) {
    diagnosticsDropped = diagnostics.length - (limits.maxDiagnostics - 1);
    diagnostics = diagnostics.slice(0, limits.maxDiagnostics - 1);
    diagnostics.unshift({ code: 'LIMIT_DIAGNOSTICS', count: diagnosticsDropped, message: `${diagnosticsDropped} diagnostics beyond the limit of ${limits.maxDiagnostics} were not kept.` });
  }

  // 10. Completeness, reproducibility: separate properties.
  const extractionCodes = [...diag.all()].map((d) => d.code);
  if (diagnosticsDropped > 0) extractionCodes.push('LIMIT_DIAGNOSTICS');
  const partial = traversal.completeness === 'PARTIAL' || extractionCodes.some((c) => EXTRACTION_DIAGNOSTIC_AFFECTS_COMPLETENESS[c]);
  const reproducible = traversal.reproducible && extractionCodes.every((c) => EXTRACTION_DIAGNOSTIC_IS_STABLE[c]);

  const facts = sink.facts();
  const result: DiscoveryResult = {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    limits,
    completeness: partial ? 'PARTIAL' : 'COMPLETE',
    reproducible,
    traversal: { completeness: traversal.completeness, reproducible: traversal.reproducible },
    stats: {
      inputEntries: traversal.entries.length,
      excludedEntries,
      filesWithoutKnownLanguage: withoutLanguage,
      manifestsFound: manifestCandidates.length,
      manifestsRead: toRead.length,
      facts: facts.length,
    },
    facts,
    diagnostics,
  };
  const violations = validateDiscoveryResult(result);
  if (violations.length > 0) throw new DiscoveryError('RESULT_INVALID', `the result failed validation: ${violations.slice(0, 3).join('; ')}`);
  return result;
}
