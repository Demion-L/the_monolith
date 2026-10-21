/**
 * Generic, deterministic markdown-frontmatter discovery used for both
 * Mandatory Protocols (section 7) and ADR Discovery (section 8). Reuses
 * Scriptorium's existing frontmatter parser (per the brief contract) — does
 * NOT use `compileMarkdownArtifact()` or the ERG graph builder, both of
 * which are explicitly out of scope here.
 */
import type { DocRef } from './types.js';
export interface ParsedDoc {
    /** Relative to targetDir. */
    relPath: string;
    id: string | undefined;
    /** frontmatter `title:` value, if present. */
    frontmatterTitle: string | undefined;
    /** All frontmatter fields (first value per key), for filter predicates. */
    fields: Map<string, string>;
}
/**
 * Discover documents under `dirs` (relative to targetDir, deduplicated,
 * each walked recursively) whose frontmatter matches `predicate`. Only
 * documents with a usable frontmatter `id:` are included — a markdown file
 * without one isn't a candidate ADR/protocol record, it's silently excluded
 * from this listing (not an error).
 */
export declare function discoverDocs(targetDir: string, dirs: string[], predicate: (fields: Map<string, string>) => boolean): DocRef[];
//# sourceMappingURL=docs.d.ts.map