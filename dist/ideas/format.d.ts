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
export declare function isIdeaId(value: string): boolean;
export declare function ideaNumber(id: string): number;
export declare function formatIdeaId(n: number): string;
/** `IDEA-007.md` -> `IDEA-007`; anything else (temp files, other documents) -> null. */
export declare function ideaIdFromFileName(name: string): string | null;
export declare function ideaFileName(id: string): string;
/** Validates user input; returns it unchanged (content is never trimmed or rewritten). */
export declare function validateNewIdea(input: NewIdea): NewIdea;
export declare function serializeIdea(idea: Idea): string;
/**
 * Parse an idea file. `expectedId` is the id implied by the file name; a
 * mismatch with the `id:` field is corruption, never silently "fixed".
 */
export declare function parseIdea(expectedId: string, text: string): Idea;
//# sourceMappingURL=format.d.ts.map