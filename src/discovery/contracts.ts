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
  /** `value` files with extension `object` exist; `subject` is the language that extension maps to. */
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
  /** At least one; sorted. */
  sources: DiscoverySource[];
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
  /** Language-fact example sources. */
  maxSourcesPerFact: number;
}

export interface DiscoveryStats {
  /** Traversal entries received. */
  inputEntries: number;
  /** Entries dropped before extraction (rejected path or inside confirmed nested MONOLITH state). */
  excludedEntries: number;
  /** Files whose extension maps to no known language. Reported, not guessed. */
  filesWithoutKnownLanguage: number;
  manifestsFound: number;
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
  /** Sorted: extraction before traversal, then by code, path, message. */
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

const HEX16 = /^[0-9a-f]{16}$/;

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

/**
 * Structural check of a result. Returns the violations (empty = valid). `extractProjectFacts` throws
 * `DiscoveryError('RESULT_INVALID')` rather than return a result that fails it (FAILED, ADR-021 §5).
 */
export function validateDiscoveryResult(result: DiscoveryResult): string[] {
  const bad: string[] = [];
  if (result.schemaVersion !== DISCOVERY_SCHEMA_VERSION) bad.push('schemaVersion');
  const seen = new Set<string>();
  const byId = new Map<string, DiscoveryFact>();
  for (const f of result.facts) byId.set(f.id, f);
  let prev: DiscoveryFact | undefined;
  for (const f of result.facts) {
    const at = `fact ${f.id}`;
    if (!HEX16.test(f.id) || f.id !== computeFactId(f.kind, f.subject, f.object, f.value)) bad.push(`${at}: id`);
    if (seen.has(f.id)) bad.push(`${at}: duplicate id`);
    seen.add(f.id);
    if (!(f.kind in FACT_LEVEL_BY_KIND) || FACT_LEVEL_BY_KIND[f.kind] !== f.level) bad.push(`${at}: level`);
    if (typeof f.rule !== 'string' || f.rule.length === 0) bad.push(`${at}: rule`);
    if (f.sources.length === 0) bad.push(`${at}: no source`);
    for (const s of f.sources) if (!isSafeRelativePath(s.path)) bad.push(`${at}: unsafe source path`);
    for (let i = 1; i < f.sources.length; i++) if (compareSources(f.sources[i - 1], f.sources[i]) > 0) bad.push(`${at}: sources order`);
    if (f.level === 'INTERPRETED') {
      if (!f.basis || f.basis.length === 0) bad.push(`${at}: interpreted without basis`);
      for (const b of f.basis ?? []) if (byId.get(b)?.level !== 'DETECTED') bad.push(`${at}: basis ${b} is not a DETECTED fact`);
    } else if (f.basis !== undefined) {
      bad.push(`${at}: basis on a DETECTED fact`);
    }
    if ((f.kind === 'DIRECTORY' || f.kind === 'FILE_PRESENT' || f.kind === 'MANIFEST_PRESENT' || f.kind === 'ENTRYPOINT_CANDIDATE') && !isSafeRelativePath(f.subject)) bad.push(`${at}: unsafe subject path`);
    if (prev && compareFacts(prev, f) > 0) bad.push(`${at}: facts order`);
    prev = f;
  }
  for (const d of result.diagnostics) if (d.path !== undefined && !isSafeRelativePath(d.path)) bad.push(`diagnostic ${d.code}: unsafe path`);
  return bad;
}
