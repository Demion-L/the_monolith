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
import { type ProjectFileRead } from '../root/index.js';
import type { TraversalResult } from './traverse.js';
import { type DiscoveryLimits, type DiscoveryResult } from './contracts.js';
export declare const DEFAULT_DISCOVERY_LIMITS: Readonly<DiscoveryLimits>;
/** Extension (lower case, with the dot) to language. Evidence is the extension and nothing else. */
export declare const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>>;
/** Known manifest file name to the ecosystem its presence points at (a presence, not a runtime use). */
export declare const KNOWN_MANIFESTS: Readonly<Record<string, string>>;
/** Project-relative file names that may start a program. Only candidates, ever. */
export declare const ENTRYPOINT_CANDIDATE_PATHS: readonly string[];
export type ManifestReader = (projectRoot: string, relPath: string, opts: {
    maxBytes: number;
}) => ProjectFileRead;
export interface ExtractOptions {
    limits?: Partial<DiscoveryLimits>;
    /** @internal Test seam; production uses `readProjectFile`. */
    readManifest?: ManifestReader;
}
export declare function extractProjectFacts(projectRoot: string, traversal: TraversalResult, options?: ExtractOptions): DiscoveryResult;
//# sourceMappingURL=facts.d.ts.map