/**
 * Discovery contract, schema version 1 (ADR-021 §2-§4). Internal: not exported from `src/index.ts`.
 *
 * A fact says what the project's bytes show (`DETECTED`) or what a named rule derived from
 * DETECTED facts (`INTERPRETED`). Three properties are kept apart on purpose and never
 * folded into one another:
 *  - `completeness`: did the scan cover what it declared (`COMPLETE` | `PARTIAL`);
 *  - `reproducible`: would a second scan of the same unchanged tree return this result;
 *  - `level` of a fact: how it was obtained. There is no numeric confidence.
 */

import { createHash } from 'crypto';

export const DISCOVERY_SCHEMA_VERSION = 1;

export type DiscoveryLevel = 'DETECTED' | 'INTERPRETED';

/** The level is a function of the kind (ADR-021 §2): never chosen per fact, checked by the validator. */
export const FACT_LEVEL_BY_KIND = {
  /** A directory exists in the inventory. */
  DIRECTORY: 'DETECTED',
  /** A file with a conventional name exists (the basis of an entrypoint candidate). */
  FILE_PRESENT: 'DETECTED',
  /**
   * `value` files with extension `object` exist; `subject` is the language that extension maps to.
   * An aggregate: `value` counts every file the traversal listed, `sources` is only a sample of them
   * (see `sourceCoverage`).
   */
  LANGUAGE_BY_EXTENSION: 'DETECTED',
  /** A file with the name of a known manifest exists. Says nothing about its content or about runtime use. */
  MANIFEST_PRESENT: 'DETECTED',
  /** A manifest declares dependency `object` in section `value`. Not resolved, not installed, not verified. */
  DEPENDENCY_DECLARED: 'DETECTED',
  /** A manifest declares a script named `object`. The command is never stored and never run. */
  SCRIPT_DECLARED: 'DETECTED',
  /** A file name convention suggests `subject` may start the program. A candidate, never a verified entrypoint. */
  ENTRYPOINT_CANDIDATE: 'INTERPRETED',
} as const satisfies Record<string, DiscoveryLevel>;

export type DiscoveryFactKind = keyof typeof FACT_LEVEL_BY_KIND;

export type DiscoveryObservation = 'directory-entry' | 'file-entry' | 'extension' | 'file-name' | 'manifest-field';

export interface DiscoverySource {
  /** Project-relative, `/`-separated; never absolute, never contains `..`. */
  path: string;
  /** What kind of observation backs the fact. */
  observation: DiscoveryObservation;
  /** For `manifest-field`: an RFC 6901 JSON Pointer into the manifest (e.g. `/dependencies/@scope~1pkg`). */
  field?: string;
}

export interface DiscoveryFact {
  /** 16 hex of sha256 over (schemaVersion, kind, subject, object, value); see `computeFactId`. */
  id: string;
  kind: DiscoveryFactKind;
  level: DiscoveryLevel;
  subject: string;
  object?: string;
  value?: string;
  /** Name of the detection (DETECTED) or derivation (INTERPRETED) rule. */
  rule: string;
  /** INTERPRETED only: ids of the DETECTED facts the interpretation rests on. */
  basis?: string[];
  /**
   * At least one; sorted. For a `LANGUAGE_BY_EXTENSION` aggregate these are a deterministic SAMPLE
   * (the first `min(value, limits.maxSourcesPerFact)` paths in UTF-16 order), not the whole evidence:
   * `value` is computed over all files and is checked against the sample size by the validator.
   * Every other kind rests on exactly the sources it lists. See `sourceCoverage`.
   */
  sources: DiscoverySource[];
}

/**
 * Whether a fact's `sources` are all of its evidence (`FULL`) or a sample of it (`SAMPLE`).
 * Derived, not stored: only a `LANGUAGE_BY_EXTENSION` aggregate with more files than listed sources
 * is a `SAMPLE`. Coverage says nothing about the scan: a count over a `PARTIAL` traversal is a lower
 * bound, and that is stated by `DiscoveryResult.completeness` and `traversal.completeness`.
 */
export type SourceCoverage = 'FULL' | 'SAMPLE';

export function sourceCoverage(fact: Pick<DiscoveryFact, 'kind' | 'value' | 'sources'>): SourceCoverage {
  if (fact.kind !== 'LANGUAGE_BY_EXTENSION') return 'FULL';
  return fact.sources.length >= Number(fact.value) ? 'FULL' : 'SAMPLE';
}

/**
 * Closed list. The value says whether the code makes the result `PARTIAL` (something inside the
 * declared scope was not extracted) or only reports a scope policy or an unanalysed area.
 */
export const EXTRACTION_DIAGNOSTIC_AFFECTS_COMPLETENESS = {
  INPUT_PATH_REJECTED: true,
  LIMIT_DIRECTORY_FACTS: true,
  LIMIT_LANGUAGE_FACTS: true,
  LIMIT_MANIFEST_FACTS: true,
  LIMIT_MANIFEST_READS: true,
  LIMIT_DEPENDENCIES: true,
  LIMIT_SCRIPTS: true,
  LIMIT_ENTRYPOINT_FACTS: true,
  LIMIT_FACTS: true,
  LIMIT_DIAGNOSTICS: true,
  MANIFEST_READ_FAILED: true,
  MANIFEST_TOO_LARGE: true,
  MANIFEST_PARSE_ERROR: true,
  MANIFEST_FIELD_INVALID: true,
  MANIFEST_VALUE_REJECTED: true,
  MANIFEST_EMPTY: false,
  MANIFEST_NOT_REGULAR_FILE: false,
  MANIFEST_CONTENT_NOT_ANALYZED: false,
  NESTED_MONOLITH_STATE_EXCLUDED: false,
  NESTED_MONOLITH_UNCONFIRMED: false,
} as const;

export type ExtractionDiagnosticCode = keyof typeof EXTRACTION_DIAGNOSTIC_AFFECTS_COMPLETENESS;

/** Whether a second scan of the same unchanged tree must return the same diagnostic. */
export const EXTRACTION_DIAGNOSTIC_IS_STABLE: Record<ExtractionDiagnosticCode, boolean> = {
  INPUT_PATH_REJECTED: true,
  LIMIT_DIRECTORY_FACTS: true,
  LIMIT_LANGUAGE_FACTS: true,
  LIMIT_MANIFEST_FACTS: true,
  LIMIT_MANIFEST_READS: true,
  LIMIT_DEPENDENCIES: true,
  LIMIT_SCRIPTS: true,
  LIMIT_ENTRYPOINT_FACTS: true,
  LIMIT_FACTS: true,
  LIMIT_DIAGNOSTICS: true,
  // A read can fail because the file changed or the disk misbehaved: not a function of the tree alone.
  MANIFEST_READ_FAILED: false,
  MANIFEST_TOO_LARGE: true,
  MANIFEST_PARSE_ERROR: true,
  MANIFEST_FIELD_INVALID: true,
  MANIFEST_VALUE_REJECTED: true,
  MANIFEST_EMPTY: true,
  MANIFEST_NOT_REGULAR_FILE: true,
  MANIFEST_CONTENT_NOT_ANALYZED: true,
  NESTED_MONOLITH_STATE_EXCLUDED: true,
  NESTED_MONOLITH_UNCONFIRMED: true,
};

export interface DiscoveryDiagnostic {
  /** An extraction code, or `TRAVERSAL_<code>` for a diagnostic carried over from the traversal. */
  code: string;
  /** Project-relative path, when the diagnostic concerns one. */
  path?: string;
  /** Total occurrences, present on a summary line. */
  count?: number;
  /** Fixed text; never a raw error message, a file content excerpt or an absolute path. */
  message: string;
}

export interface DiscoveryLimits {
  /** Directory facts (paths of at most `maxDirectoryDepth` segments), shallowest first. */
  maxDirectoryFacts: number;
  maxDirectoryDepth: number;
  /** Distinct (language, extension) facts. */
  maxLanguageFacts: number;
  /** Manifest presence facts, shallowest first. */
  maxManifestFacts: number;
  /** Manifests whose content is read (only `package.json` is parsed in this version). */
  maxManifestReads: number;
  /** Size cap of one manifest, bytes. */
  maxManifestBytes: number;
  /** Dependency facts per manifest. */
  maxDependenciesPerManifest: number;
  /** Script facts per manifest. */
  maxScriptsPerManifest: number;
  maxEntrypointFacts: number;
  /** Cap on the whole `facts` array; a final guard, normally never reached. */
  maxFacts: number;
  maxDiagnostics: number;
  /** Longest dependency or script name that is kept. */
  maxNameLength: number;
  /** Sources listed for a language aggregate: a sample of at most this many files. */
  maxSourcesPerFact: number;
}

export interface DiscoveryStats {
  /** Traversal entries received. */
  inputEntries: number;
  /**
   * Entries that did not reach extraction: a rejected path or kind, a path repeated in the input
   * (collapsed to one entry) or an entry inside confirmed nested MONOLITH state.
   */
  excludedEntries: number;
  /** Files whose extension maps to no known language. Reported, not guessed. */
  filesWithoutKnownLanguage: number;
  manifestsFound: number;
  /** `package.json` files a read was attempted on (a failed read counts; see the diagnostics). */
  manifestsRead: number;
  facts: number;
}

export interface DiscoveryResult {
  schemaVersion: typeof DISCOVERY_SCHEMA_VERSION;
  limits: DiscoveryLimits;
  /** `PARTIAL` when the traversal was `PARTIAL` or any completeness-affecting diagnostic exists. */
  completeness: 'COMPLETE' | 'PARTIAL';
  /** A second scan of the unchanged tree would return this result (traversal and extraction). */
  reproducible: boolean;
  /** What the traversal reported, kept visible next to the combined verdict. */
  traversal: { completeness: 'COMPLETE' | 'PARTIAL'; reproducible: boolean };
  stats: DiscoveryStats;
  /** Sorted by (kind, subject, object, value) in UTF-16 code-unit order. */
  facts: DiscoveryFact[];
  /**
   * Sorted by `compareDiagnostics`: completeness-affecting extraction codes, then traversal codes,
   * then the other extraction codes; each by code, path, message, count. The one exception is a
   * `LIMIT_DIAGNOSTICS` summary, which is always first when the list was cut.
   */
  diagnostics: DiscoveryDiagnostic[];
}

export type DiscoveryErrorCode = 'INVALID_LIMITS' | 'INVALID_INPUT' | 'ID_COLLISION' | 'RESULT_INVALID';

/** Extraction cannot proceed safely or produced a result the validator rejects: no result exists (FAILED). */
export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;
  constructor(code: DiscoveryErrorCode, message: string) {
    super(message);
    this.name = 'DiscoveryError';
    this.code = code;
  }
}

/** UTF-16 code-unit order; never `localeCompare` (ADR-021 §4). */
export function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 16 hex of sha256 over the canonical tuple. Provenance, level, rule and positions are excluded. */
export function computeFactId(kind: string, subject: string, object?: string, value?: string): string {
  const canonical = JSON.stringify([DISCOVERY_SCHEMA_VERSION, kind, subject, object ?? null, value ?? null]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

/** A project-relative POSIX path with no empty, `.` or `..` segment, no NUL/control/backslash and no drive prefix. */
export function isSafeRelativePath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096) return false;
  if (p.startsWith('/') || p.endsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\�]/.test(p)) return false;
  return p.split('/').every((s) => s.length > 0 && s !== '.' && s !== '..');
}

export const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/** RFC 6901 token escaping. */
export const pointerToken = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');

// Control, bidirectional and replacement characters and lone surrogates: not kept in a fact.
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩�]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function isKeepableName(name: string, max: number): boolean {
  return name.length > 0 && name.length <= max && !UNSAFE_NAME.test(name);
}

/**
 * Diagnostic order: completeness-affecting extraction codes (0), traversal codes (1), the other
 * extraction codes (2); then code, path, message, count. `count` closes the tie so that no two
 * different diagnostics compare equal.
 */
export function compareDiagnostics(a: DiscoveryDiagnostic, b: DiscoveryDiagnostic): number {
  const rank = (d: DiscoveryDiagnostic): number =>
    d.code.startsWith('TRAVERSAL_') ? 1 : EXTRACTION_DIAGNOSTIC_AFFECTS_COMPLETENESS[d.code as ExtractionDiagnosticCode] ? 0 : 2;
  return rank(a) - rank(b) || compareUtf16(a.code, b.code) || compareUtf16(a.path ?? '', b.path ?? '') || compareUtf16(a.message, b.message) || (a.count ?? 0) - (b.count ?? 0);
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/** Output hygiene of the validator itself, not a limit of the contract. */
const MAX_VIOLATIONS = 100;

const LIMIT_NAMES: readonly (keyof DiscoveryLimits)[] = [
  'maxDirectoryFacts',
  'maxDirectoryDepth',
  'maxLanguageFacts',
  'maxManifestFacts',
  'maxManifestReads',
  'maxManifestBytes',
  'maxDependenciesPerManifest',
  'maxScriptsPerManifest',
  'maxEntrypointFacts',
  'maxFacts',
  'maxDiagnostics',
  'maxNameLength',
  'maxSourcesPerFact',
];
const STAT_NAMES: readonly (keyof DiscoveryStats)[] = ['inputEntries', 'excludedEntries', 'filesWithoutKnownLanguage', 'manifestsFound', 'manifestsRead', 'facts'];
const OBSERVATIONS: readonly DiscoveryObservation[] = ['directory-entry', 'file-entry', 'extension', 'file-name', 'manifest-field'];
const FACT_KEYS = ['id', 'kind', 'level', 'subject', 'object', 'value', 'rule', 'basis', 'sources'];
const SOURCE_KEYS = ['path', 'observation', 'field'];
const DIAGNOSTIC_KEYS = ['code', 'path', 'count', 'message'];
const RESULT_KEYS = ['schemaVersion', 'limits', 'completeness', 'reproducible', 'traversal', 'stats', 'facts', 'diagnostics'];

/** The observation that backs a fact of each kind. */
const OBSERVATION_BY_KIND: Record<DiscoveryFactKind, DiscoveryObservation> = {
  DIRECTORY: 'directory-entry',
  FILE_PRESENT: 'file-entry',
  LANGUAGE_BY_EXTENSION: 'extension',
  MANIFEST_PRESENT: 'file-name',
  DEPENDENCY_DECLARED: 'manifest-field',
  SCRIPT_DECLARED: 'manifest-field',
  ENTRYPOINT_CANDIDATE: 'file-name',
};

const HEX16 = /^[0-9a-f]{16}$/;
const CANONICAL_COUNT = /^[1-9][0-9]*$/;
const TRAVERSAL_CODE = /^TRAVERSAL_[A-Z][A-Z0-9_]{0,63}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// An absolute POSIX path (at the start or after a space, quote, bracket, `=` or `:`), a drive path or a UNC path.
const ABSOLUTE_PATH_IN_TEXT = /(^|[\s"'`(=:])\/[^\s/]|[A-Za-z]:[\\/]|\\\\[^\s\\]/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

function factKey(f: DiscoveryFact): string[] {
  return [f.kind, f.subject, f.object ?? '', f.value ?? ''];
}

export function compareFacts(a: DiscoveryFact, b: DiscoveryFact): number {
  const ka = factKey(a);
  const kb = factKey(b);
  for (let i = 0; i < ka.length; i++) {
    const c = compareUtf16(ka[i], kb[i]);
    if (c !== 0) return c;
  }
  return 0;
}

export function compareSources(a: DiscoverySource, b: DiscoverySource): number {
  return compareUtf16(a.path, b.path) || compareUtf16(a.observation, b.observation) || compareUtf16(a.field ?? '', b.field ?? '');
}

function extensionOfPath(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? undefined : name.slice(dot).toLowerCase();
}

/**
 * Check of a `DiscoveryResult` against the schema-1 contract. Returns the violations (empty = valid);
 * `extractProjectFacts` throws `DiscoveryError('RESULT_INVALID')` rather than return a result that
 * fails it (FAILED, ADR-021 §5).
 *
 * Input is `unknown` on purpose: a malformed value yields violations, never a `TypeError`. A violation
 * names a location (`facts[3]`) and a rule, and never repeats a value from the input, so an untrusted
 * result cannot reach a log through it. At most 100 violations are returned.
 *
 * Scope: plain JSON-like data (a producer's output or `JSON.parse` output). An object with accessors
 * that throw, or a `Proxy`, is not defended against (ADR-021 does not require it). The validator is
 * not a general schema library: it checks this contract and nothing else.
 */
export function validateDiscoveryResult(result: unknown): string[] {
  const bad: string[] = [];
  const fail = (m: string): void => {
    if (bad.length < MAX_VIOLATIONS) bad.push(m);
  };
  if (!isObject(result)) return ['result: not an object'];
  const keysOk = (o: Record<string, unknown>, allowed: readonly string[], at: string): void => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${at}: unknown property`);
  };
  keysOk(result, RESULT_KEYS, 'result');
  if (result.schemaVersion !== DISCOVERY_SCHEMA_VERSION) fail('schemaVersion');

  // limits
  const limits = {} as Record<keyof DiscoveryLimits, number>;
  let limitsOk = false;
  const rawLimits = own(result, 'limits');
  if (!isObject(rawLimits)) fail('limits: not an object');
  else {
    limitsOk = true;
    keysOk(rawLimits, LIMIT_NAMES, 'limits');
    for (const k of LIMIT_NAMES) {
      const v = own(rawLimits, k);
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
        fail(`limits.${k}: not a positive integer`);
        limitsOk = false;
      } else limits[k] = v;
    }
  }

  // completeness, reproducibility
  const verdict = (v: unknown): v is 'COMPLETE' | 'PARTIAL' => v === 'COMPLETE' || v === 'PARTIAL';
  const completeness = own(result, 'completeness');
  const reproducible = own(result, 'reproducible');
  if (!verdict(completeness)) fail('completeness: not COMPLETE or PARTIAL');
  if (typeof reproducible !== 'boolean') fail('reproducible: not a boolean');
  const traversal = own(result, 'traversal');
  let traversalPartial = false;
  let traversalUnstable = false;
  if (!isObject(traversal)) fail('traversal: not an object');
  else {
    keysOk(traversal, ['completeness', 'reproducible'], 'traversal');
    if (!verdict(own(traversal, 'completeness'))) fail('traversal.completeness: not COMPLETE or PARTIAL');
    if (typeof own(traversal, 'reproducible') !== 'boolean') fail('traversal.reproducible: not a boolean');
    traversalPartial = own(traversal, 'completeness') === 'PARTIAL';
    traversalUnstable = own(traversal, 'reproducible') === false;
  }

  // stats
  const stats = own(result, 'stats');
  let statsOk = false;
  if (!isObject(stats)) fail('stats: not an object');
  else {
    statsOk = true;
    keysOk(stats, STAT_NAMES, 'stats');
    for (const k of STAT_NAMES) {
      if (!isCount(own(stats, k))) {
        fail(`stats.${k}: not a non-negative integer`);
        statsOk = false;
      }
    }
  }

  // facts: size first, so an oversized array is refused without walking it
  const facts = own(result, 'facts');
  const validFacts: DiscoveryFact[] = [];
  const perKind = new Map<string, number>();
  const perManifest = new Map<string, number>();
  if (!Array.isArray(facts)) fail('facts: not an array');
  else if (limitsOk && facts.length > limits.maxFacts) fail('facts: more than limits.maxFacts');
  else {
    const byId = new Map<string, DiscoveryFact>();
    for (const f of facts) if (isObject(f) && typeof f.id === 'string') byId.set(f.id, f as unknown as DiscoveryFact);
    const seen = new Set<string>();
    let prev: DiscoveryFact | undefined;
    facts.forEach((raw, i) => {
      const at = `facts[${i}]`;
      if (!isObject(raw)) return fail(`${at}: not an object`);
      keysOk(raw, FACT_KEYS, at);
      const { id, kind, level, subject, object, value, rule, basis, sources } = raw as Record<string, unknown>;
      const strOrUndef = (v: unknown): v is string | undefined => v === undefined || (typeof v === 'string' && v.length > 0 && !CONTROL.test(v));
      const kindOk = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(FACT_LEVEL_BY_KIND, kind);
      let shapeOk = true;
      const need = (ok: boolean, what: string): void => {
        if (!ok) {
          fail(`${at}: ${what}`);
          shapeOk = false;
        }
      };
      need(typeof id === 'string' && HEX16.test(id), 'id');
      need(kindOk, 'kind');
      need(kindOk && FACT_LEVEL_BY_KIND[kind as DiscoveryFactKind] === level, 'level');
      need(typeof subject === 'string' && subject.length > 0 && !CONTROL.test(subject), 'subject');
      need(strOrUndef(object), 'object');
      need(strOrUndef(value), 'value');
      need(typeof rule === 'string' && rule.length > 0 && !CONTROL.test(rule), 'rule');
      need(Array.isArray(sources), 'sources: not an array');
      need(basis === undefined || (Array.isArray(basis) && basis.every((b) => typeof b === 'string')), 'basis: not an array of strings');
      if (!shapeOk) return;
      const fact = raw as unknown as DiscoveryFact;
      if (fact.id !== computeFactId(fact.kind, fact.subject, fact.object, fact.value)) fail(`${at}: id does not match its content`);
      if (seen.has(fact.id)) fail(`${at}: duplicate id`);
      seen.add(fact.id);
      perKind.set(fact.kind, (perKind.get(fact.kind) ?? 0) + 1);

      // kind-specific shape
      const pathSubject = fact.kind === 'DIRECTORY' || fact.kind === 'FILE_PRESENT' || fact.kind === 'MANIFEST_PRESENT' || fact.kind === 'ENTRYPOINT_CANDIDATE';
      if (pathSubject && !isSafeRelativePath(fact.subject)) fail(`${at}: unsafe subject path`);
      if (pathSubject && fact.kind === 'DIRECTORY' && limitsOk && fact.subject.split('/').length > limits.maxDirectoryDepth) fail(`${at}: directory deeper than limits.maxDirectoryDepth`);
      const noObject = fact.kind === 'DIRECTORY' || fact.kind === 'FILE_PRESENT' || fact.kind === 'ENTRYPOINT_CANDIDATE';
      const noValue = fact.kind === 'DIRECTORY' || fact.kind === 'FILE_PRESENT' || fact.kind === 'MANIFEST_PRESENT' || fact.kind === 'SCRIPT_DECLARED';
      if (noObject && fact.object !== undefined) fail(`${at}: object not allowed for this kind`);
      if (noValue && fact.value !== undefined) fail(`${at}: value not allowed for this kind`);
      if (!noObject && fact.object === undefined) fail(`${at}: object required for this kind`);
      if (fact.kind === 'ENTRYPOINT_CANDIDATE' && fact.value !== 'candidate') fail(`${at}: value must be "candidate"`);
      if (fact.kind === 'LANGUAGE_BY_EXTENSION') {
        if (!/^\.[^./\s]+$/.test(fact.object ?? '') || fact.object !== (fact.object ?? '').toLowerCase()) fail(`${at}: object is not a lower-case extension`);
        if (!CANONICAL_COUNT.test(fact.value ?? '') || !Number.isSafeInteger(Number(fact.value))) fail(`${at}: value is not a positive count`);
      }
      if (fact.kind === 'DEPENDENCY_DECLARED' && !(DEPENDENCY_SECTIONS as readonly string[]).includes(fact.value ?? '')) fail(`${at}: value is not a dependency section`);
      if (fact.kind === 'DEPENDENCY_DECLARED' || fact.kind === 'SCRIPT_DECLARED') {
        if (!isSafeRelativePath(fact.subject)) fail(`${at}: unsafe subject path`);
        if (limitsOk && !isKeepableName(fact.object ?? '', limits.maxNameLength)) fail(`${at}: object is not a keepable name`);
        perManifest.set(`${fact.kind}\u0000${fact.subject}`, (perManifest.get(`${fact.kind}\u0000${fact.subject}`) ?? 0) + 1);
      }

      // level and references
      if (fact.level === 'INTERPRETED') {
        if (!fact.basis || fact.basis.length === 0) fail(`${at}: interpreted without basis`);
        const refs = new Set<string>();
        for (const b of fact.basis ?? []) {
          if (refs.has(b)) fail(`${at}: duplicate basis reference`);
          refs.add(b);
          const target = byId.get(b);
          if (target === undefined) fail(`${at}: basis refers to no fact`);
          else if (target.level !== 'DETECTED') fail(`${at}: basis is not a DETECTED fact`);
          else if (fact.kind === 'ENTRYPOINT_CANDIDATE' && (target.kind !== 'FILE_PRESENT' || target.subject !== fact.subject)) fail(`${at}: basis is not the FILE_PRESENT fact of the same path`);
        }
        for (let j = 1; j < (fact.basis?.length ?? 0); j++) if (compareUtf16((fact.basis as string[])[j - 1], (fact.basis as string[])[j]) > 0) fail(`${at}: basis order`);
      } else if (fact.basis !== undefined) fail(`${at}: basis on a DETECTED fact`);

      // sources
      const srcs = fact.sources as unknown[];
      if (srcs.length === 0) fail(`${at}: no source`);
      else if (limitsOk && srcs.length > limits.maxSourcesPerFact && fact.kind === 'LANGUAGE_BY_EXTENSION') fail(`${at}: more sources than limits.maxSourcesPerFact`);
      else if (srcs.length > 1 && !(fact.kind === 'LANGUAGE_BY_EXTENSION')) fail(`${at}: more than one source for this kind`);
      let sourcesOk = true;
      srcs.forEach((sr, j) => {
        const sat = `${at}.sources[${j}]`;
        if (!isObject(sr)) {
          sourcesOk = false;
          return fail(`${sat}: not an object`);
        }
        keysOk(sr, SOURCE_KEYS, sat);
        const { path, observation, field } = sr;
        if (!isSafeRelativePath(path)) {
          sourcesOk = false;
          fail(`${sat}: unsafe source path`);
        }
        if (!OBSERVATIONS.includes(observation as DiscoveryObservation)) {
          sourcesOk = false;
          return fail(`${sat}: unknown observation`);
        }
        if (observation !== OBSERVATION_BY_KIND[fact.kind]) fail(`${sat}: observation does not match the kind`);
        if (observation === 'manifest-field') {
          if (typeof field !== 'string' || !field.startsWith('/') || CONTROL.test(field)) fail(`${sat}: manifest-field source without a JSON Pointer`);
          else if (fact.kind === 'DEPENDENCY_DECLARED' && field !== `/${fact.value}/${pointerToken(fact.object as string)}`) fail(`${sat}: field does not point at the declared dependency`);
          else if (fact.kind === 'SCRIPT_DECLARED' && field !== `/scripts/${pointerToken(fact.object as string)}`) fail(`${sat}: field does not point at the declared script`);
        } else if (field !== undefined) fail(`${sat}: field only belongs to a manifest-field source`);
        if (typeof path === 'string' && fact.kind !== 'LANGUAGE_BY_EXTENSION' && path !== fact.subject) fail(`${sat}: source path differs from the subject`);
        if (typeof path === 'string' && fact.kind === 'LANGUAGE_BY_EXTENSION' && extensionOfPath(path) !== fact.object) fail(`${sat}: source extension differs from the fact`);
      });
      if (sourcesOk) {
        const list = srcs as DiscoverySource[];
        for (let j = 1; j < list.length; j++) {
          const c = compareSources(list[j - 1], list[j]);
          if (c > 0) fail(`${at}: sources order`);
          if (c === 0) fail(`${at}: duplicate source`);
        }
        // Provenance semantics: a language aggregate lists min(count, maxSourcesPerFact) files, so its
        // coverage (FULL or SAMPLE) follows from the two numbers and cannot be declared falsely.
        if (fact.kind === 'LANGUAGE_BY_EXTENSION' && limitsOk && CANONICAL_COUNT.test(fact.value ?? '') && list.length !== Math.min(Number(fact.value), limits.maxSourcesPerFact)) {
          fail(`${at}: source count is not min(count, limits.maxSourcesPerFact)`);
        }
      }
      if (prev && compareFacts(prev, fact) > 0) fail(`${at}: facts order`);
      prev = fact;
      validFacts.push(fact);
    });

    if (limitsOk) {
      const cap: [DiscoveryFactKind, keyof DiscoveryLimits][] = [
        ['DIRECTORY', 'maxDirectoryFacts'],
        ['LANGUAGE_BY_EXTENSION', 'maxLanguageFacts'],
        ['MANIFEST_PRESENT', 'maxManifestFacts'],
        ['ENTRYPOINT_CANDIDATE', 'maxEntrypointFacts'],
      ];
      for (const [kind, limit] of cap) if ((perKind.get(kind) ?? 0) > limits[limit]) fail(`facts: more ${kind} facts than limits.${limit}`);
      for (const [key, n] of perManifest) {
        const dependency = key.startsWith('DEPENDENCY_DECLARED');
        if (n > limits[dependency ? 'maxDependenciesPerManifest' : 'maxScriptsPerManifest']) fail(`facts: more ${dependency ? 'dependency' : 'script'} facts for one manifest than the limit`);
      }
    }
    if (statsOk && Array.isArray(facts)) {
      const st = stats as unknown as DiscoveryStats;
      if (st.facts !== facts.length) fail('stats.facts: differs from the number of facts');
      if (st.manifestsRead > st.manifestsFound) fail('stats.manifestsRead: more than manifestsFound');
      if ((perKind.get('MANIFEST_PRESENT') ?? 0) > st.manifestsFound) fail('stats.manifestsFound: fewer than the manifest facts');
      if (limitsOk && st.manifestsRead > limits.maxManifestReads) fail('stats.manifestsRead: more than limits.maxManifestReads');
      if (st.excludedEntries > st.inputEntries) fail('stats.excludedEntries: more than inputEntries');
    }
  }

  // diagnostics
  const diagnostics = own(result, 'diagnostics');
  let affecting = false;
  let unstable = false;
  if (!Array.isArray(diagnostics)) fail('diagnostics: not an array');
  else if (limitsOk && diagnostics.length > limits.maxDiagnostics) fail('diagnostics: more than limits.maxDiagnostics');
  else {
    const parsed: DiscoveryDiagnostic[] = [];
    let allOk = true;
    diagnostics.forEach((raw, i) => {
      const at = `diagnostics[${i}]`;
      if (!isObject(raw)) {
        allOk = false;
        return fail(`${at}: not an object`);
      }
      keysOk(raw, DIAGNOSTIC_KEYS, at);
      const { code, path, count, message } = raw;
      const known = typeof code === 'string' && Object.prototype.hasOwnProperty.call(EXTRACTION_DIAGNOSTIC_AFFECTS_COMPLETENESS, code);
      const traversalCode = typeof code === 'string' && TRAVERSAL_CODE.test(code);
      let ok = true;
      if (!known && !traversalCode) {
        fail(`${at}: unknown code`);
        ok = false;
      }
      if (path !== undefined && !isSafeRelativePath(path)) {
        fail(`${at}: unsafe path`);
        ok = false;
      }
      if (count !== undefined && !(isCount(count) && count >= 1)) {
        fail(`${at}: count is not a positive integer`);
        ok = false;
      }
      if (typeof message !== 'string' || message.length === 0 || CONTROL.test(message)) {
        fail(`${at}: message is not plain text`);
        ok = false;
      } else if (ABSOLUTE_PATH_IN_TEXT.test(message)) {
        fail(`${at}: message contains an absolute path`);
        ok = false;
      }
      if (!ok) {
        allOk = false;
        return;
      }
      if (known) {
        if (EXTRACTION_DIAGNOSTIC_AFFECTS_COMPLETENESS[code as ExtractionDiagnosticCode]) affecting = true;
        if (!EXTRACTION_DIAGNOSTIC_IS_STABLE[code as ExtractionDiagnosticCode]) unstable = true;
      }
      parsed.push(raw as unknown as DiscoveryDiagnostic);
    });
    if (allOk) {
      // A LIMIT_DIAGNOSTICS summary heads the list whatever its rank; the rest is sorted.
      parsed.forEach((d, i) => {
        if (d.code === 'LIMIT_DIAGNOSTICS' && i !== 0) fail(`diagnostics[${i}]: the LIMIT_DIAGNOSTICS summary must come first`);
        if (i === 0 || (i === 1 && parsed[0].code === 'LIMIT_DIAGNOSTICS')) return;
        if (compareDiagnostics(parsed[i - 1], d) > 0) fail(`diagnostics[${i}]: order`);
      });
    }
  }

  // Internal consistency of the verdicts
  if (completeness === 'COMPLETE' && (traversalPartial || affecting)) fail('completeness: COMPLETE although the traversal or a diagnostic says PARTIAL');
  if (reproducible === true && (traversalUnstable || unstable)) fail('reproducible: true although the traversal or a diagnostic says it is not');
  return bad;
}
