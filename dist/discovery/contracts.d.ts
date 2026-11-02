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
export declare const DISCOVERY_SCHEMA_VERSION = 1;
export type DiscoveryLevel = 'DETECTED' | 'INTERPRETED';
/** The level is a function of the kind (ADR-021 §2): never chosen per fact, checked by the validator. */
export declare const FACT_LEVEL_BY_KIND: {
    /** A directory exists in the inventory. */
    readonly DIRECTORY: "DETECTED";
    /** A file with a conventional name exists (the basis of an entrypoint candidate). */
    readonly FILE_PRESENT: "DETECTED";
    /**
     * `value` files with extension `object` exist; `subject` is the language that extension maps to.
     * An aggregate: `value` counts every file the traversal listed, `sources` is only a sample of them
     * (see `sourceCoverage`).
     */
    readonly LANGUAGE_BY_EXTENSION: "DETECTED";
    /** A file with the name of a known manifest exists. Says nothing about its content or about runtime use. */
    readonly MANIFEST_PRESENT: "DETECTED";
    /** A manifest declares dependency `object` in section `value`. Not resolved, not installed, not verified. */
    readonly DEPENDENCY_DECLARED: "DETECTED";
    /** A manifest declares a script named `object`. The command is never stored and never run. */
    readonly SCRIPT_DECLARED: "DETECTED";
    /** A file name convention suggests `subject` may start the program. A candidate, never a verified entrypoint. */
    readonly ENTRYPOINT_CANDIDATE: "INTERPRETED";
};
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
export declare function sourceCoverage(fact: Pick<DiscoveryFact, 'kind' | 'value' | 'sources'>): SourceCoverage;
/**
 * Closed list. The value says whether the code makes the result `PARTIAL` (something inside the
 * declared scope was not extracted) or only reports a scope policy or an unanalysed area.
 */
export declare const EXTRACTION_DIAGNOSTIC_AFFECTS_COMPLETENESS: {
    readonly INPUT_PATH_REJECTED: true;
    readonly LIMIT_DIRECTORY_FACTS: true;
    readonly LIMIT_LANGUAGE_FACTS: true;
    readonly LIMIT_MANIFEST_FACTS: true;
    readonly LIMIT_MANIFEST_READS: true;
    readonly LIMIT_DEPENDENCIES: true;
    readonly LIMIT_SCRIPTS: true;
    readonly LIMIT_ENTRYPOINT_FACTS: true;
    readonly LIMIT_FACTS: true;
    readonly LIMIT_DIAGNOSTICS: true;
    readonly MANIFEST_READ_FAILED: true;
    readonly MANIFEST_TOO_LARGE: true;
    readonly MANIFEST_PARSE_ERROR: true;
    readonly MANIFEST_FIELD_INVALID: true;
    readonly MANIFEST_VALUE_REJECTED: true;
    readonly MANIFEST_EMPTY: false;
    readonly MANIFEST_NOT_REGULAR_FILE: false;
    readonly MANIFEST_CONTENT_NOT_ANALYZED: false;
    readonly NESTED_MONOLITH_STATE_EXCLUDED: false;
    readonly NESTED_MONOLITH_UNCONFIRMED: false;
};
export type ExtractionDiagnosticCode = keyof typeof EXTRACTION_DIAGNOSTIC_AFFECTS_COMPLETENESS;
/** Whether a second scan of the same unchanged tree must return the same diagnostic. */
export declare const EXTRACTION_DIAGNOSTIC_IS_STABLE: Record<ExtractionDiagnosticCode, boolean>;
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
    traversal: {
        completeness: 'COMPLETE' | 'PARTIAL';
        reproducible: boolean;
    };
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
export declare class DiscoveryError extends Error {
    readonly code: DiscoveryErrorCode;
    constructor(code: DiscoveryErrorCode, message: string);
}
/** UTF-16 code-unit order; never `localeCompare` (ADR-021 §4). */
export declare function compareUtf16(a: string, b: string): number;
/** 16 hex of sha256 over the canonical tuple. Provenance, level, rule and positions are excluded. */
export declare function computeFactId(kind: string, subject: string, object?: string, value?: string): string;
/** A project-relative POSIX path with no empty, `.` or `..` segment, no NUL/control/backslash and no drive prefix. */
export declare function isSafeRelativePath(p: unknown): p is string;
export declare const DEPENDENCY_SECTIONS: readonly ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
/** RFC 6901 token escaping. */
export declare const pointerToken: (s: string) => string;
export declare function isKeepableName(name: string, max: number): boolean;
/**
 * Diagnostic order: completeness-affecting extraction codes (0), traversal codes (1), the other
 * extraction codes (2); then code, path, message, count. `count` closes the tie so that no two
 * different diagnostics compare equal.
 */
export declare function compareDiagnostics(a: DiscoveryDiagnostic, b: DiscoveryDiagnostic): number;
export declare function compareFacts(a: DiscoveryFact, b: DiscoveryFact): number;
export declare function compareSources(a: DiscoverySource, b: DiscoverySource): number;
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
export declare function validateDiscoveryResult(result: unknown): string[];
//# sourceMappingURL=contracts.d.ts.map