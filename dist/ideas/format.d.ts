/**
 * Idea file format: Markdown with a small frontmatter block.
 *
 *   ---
 *   type: idea
 *   id: "IDEA-001"
 *   title: "..."            (JSON string: any character survives a round trip)
 *   status: inbox
 *   createdAt: "2026-..."
 *   context: "..."          (optional)
 *   tags: ["a", "b"]        (optional)
 *   paths: ["docs/x.md"]  (optional, KA-001: exact document files of the registered artifact; see attributionPathProblem)
 *   ---
 *
 *   ## Description
 *
 *   <description, verbatim>
 *
 * Strings are written as JSON strings, which are also valid YAML double-quoted
 * scalars, so ERG/Scriptorium read the file too. The reader additionally accepts
 * a plain unquoted value, because a person edits these files by hand.
 * The description is the body: no escaping, no trimming.
 */
import { type Idea, type NewIdea } from './types.js';
/**
 * KA-001: a registered artifact path. Project-relative, `/`-separated, no
 * traversal, no globs; a trailing `/` makes it a directory prefix. Returns the
 * reason it is invalid, or null.
 */
export declare function invalidArtifactPath(p: unknown): string | null;
/** True when `file` is covered by one of the registered `paths` (exact file, or `dir/` prefix). */
export declare function artifactPathsCover(paths: readonly string[], file: string): boolean;
/**
 * Extensions of documents that can be registered as independent knowledge.
 * Deliberately an allow-list of *document* formats, not of directories: a
 * strategy paper may live anywhere, but source code, configuration and
 * scripts never qualify, whatever directory they are in.
 */
export declare const KNOWLEDGE_DOCUMENT_EXTENSIONS: readonly string[];
/**
 * A4-SEC-03: the policy for a path that is to ATTRIBUTE commits to independent
 * knowledge (stricter than `invalidArtifactPath`, which only says the path is
 * well-formed). A registered path must be
 *  - one exact file: a `dir/` prefix would turn every later change under it into
 *    "knowledge" (`src/`, the project root, ...);
 *  - a document (`KNOWLEDGE_DOCUMENT_EXTENSIONS`): registering `src/pay.ts` would
 *    let an idea id launder ordinary code;
 *  - outside the MONOLITH root (case-insensitive; `.monolith` is always refused
 *    too): governance state is never independent knowledge.
 * Returns the reason a path is refused, or null. Registration says WHICH file a
 * commit may be explained by; it does not say the change was reviewed or allowed.
 */
export declare function attributionPathProblem(p: string, monolithRoot?: string): string | null;
export declare function isIdeaId(value: string): boolean;
export declare function ideaNumber(id: string): number;
export declare function formatIdeaId(n: number): string;
/** `IDEA-007.md` -> `IDEA-007`; anything else (temp files, other documents) -> null. */
export declare function ideaIdFromFileName(name: string): string | null;
export declare function ideaFileName(id: string): string;
/** Validates user input; returns it unchanged (content is never trimmed or rewritten). */
export declare function validateNewIdea(input: NewIdea, monolithRoot?: string): NewIdea;
export declare function serializeIdea(idea: Idea): string;
/**
 * Parse an idea file. `expectedId` is the id implied by the file name; a
 * mismatch with the `id:` field is corruption, never silently "fixed".
 */
export declare function parseIdea(expectedId: string, text: string): Idea;
//# sourceMappingURL=format.d.ts.map