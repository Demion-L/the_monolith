/**
 * Generic, deterministic markdown-frontmatter discovery used for both
 * Mandatory Protocols (section 7) and ADR Discovery (section 8). Reuses
 * Scriptorium's existing frontmatter parser (per the brief contract) — does
 * NOT use `compileMarkdownArtifact()` or the ERG graph builder, both of
 * which are explicitly out of scope here.
 *
 * Resilience (review findings F-2/F-3): a single unreadable directory,
 * unreadable file, dangling symlink, symlink cycle, or a configured
 * directory that escapes the project root must never crash the whole brief
 * or silently disappear. Each failure is caught, reported as a diagnostic
 * (forcing Completeness: INCOMPLETE), and discovery continues with
 * whatever else is readable.
 *
 * Symlinks (file or directory entries) are never followed while walking —
 * this is what makes a symlink cycle (ELOOP) impossible by construction,
 * and is also the first line of defense against using a nested symlink to
 * tunnel outside a configured directory. The *top-level* directories named
 * in `dirs` (i.e. `contextGateway.adrDirs` and the standard protocols/ADR
 * dirs) get an explicit containment check in addition: both a string-level
 * check (rejects `..` segments in the configured path itself) and a
 * real-path check after resolving symlinks (rejects a configured directory
 * that is itself a symlink escaping the project root). Neither check alone
 * is treated as sufficient — path.join()/path.relative() string comparison
 * alone does not account for symlinks on disk.
 *
 * This containment check applies only to document discovery (protocols/ADR
 * directories). It intentionally does not change how `monolithRoot` itself,
 * or paths derived from it elsewhere (state.json, active.md), are resolved
 * — that is a separate, pre-existing trust boundary and changing it is out
 * of scope here (see the final report's "Remaining limitations" section).
 */
import type { BriefDiagnostic, DocRef } from './types.js';
export interface ParsedDoc {
    /** Relative to targetDir. */
    relPath: string;
    id: string | undefined;
    /** frontmatter `title:`, or (only when no frontmatter title exists) the first H1 — resolved once, at parse time. */
    resolvedTitle: string | undefined;
    /** All frontmatter fields (first value per key), for filter predicates. */
    fields: Map<string, string>;
}
/**
 * Discover documents under `dirs` (relative to targetDir, deduplicated,
 * each walked recursively) whose frontmatter matches `predicate`. Only
 * documents with a usable frontmatter `id:` are included — a markdown file
 * without one isn't a candidate ADR/protocol record, it's silently excluded
 * from this listing (not an error). `diagnostics` collects every resilience
 * finding described in the module doc comment; callers that don't care can
 * omit it.
 */
export declare function discoverDocs(targetDir: string, dirs: string[], predicate: (fields: Map<string, string>) => boolean, diagnostics?: BriefDiagnostic[]): DocRef[];
//# sourceMappingURL=docs.d.ts.map