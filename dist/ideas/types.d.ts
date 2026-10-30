/**
 * Manual Idea Capture (IDEA-001A) — types.
 *
 * An idea is a deferred thought saved without leaving the current task. It is
 * NOT a task, a hypothesis or a Durable State record: it does not touch
 * `active.md`, `state.json` or any mission.
 */
export declare const IDEA_STATUSES: readonly ["inbox", "planned", "archived"];
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export interface Idea {
    /** `IDEA-NNN` (at least three digits; grows past 999). Never reused while its file exists. */
    id: string;
    /** Single line. */
    title: string;
    /** Free text, stored verbatim (newlines, markdown, CRLF preserved). */
    description: string;
    /** ISO-8601 UTC timestamp, set once at creation. */
    createdAt: string;
    status: IdeaStatus;
    context?: string;
    tags?: string[];
}
/** What a caller supplies; `id`, `createdAt` and `status` are assigned by the store. */
export interface NewIdea {
    title: string;
    description: string;
    context?: string;
}
/** Limits are protective ceilings (a CLI argument, not a document store). */
export declare const IDEA_LIMITS: {
    readonly title: 300;
    readonly description: 100000;
    readonly context: 20000;
    /** Upper bound of one idea file, in bytes (frontmatter + body). */
    readonly fileBytes: number;
};
export type IdeaErrorCode = 'IDEA_INVALID_INPUT' | 'IDEA_INVALID_ID' | 'IDEA_NOT_FOUND' | 'IDEA_CORRUPT' | 'IDEA_UNSAFE_PATH' | 'IDEA_NOT_INITIALIZED' | 'IDEA_ID_EXHAUSTED';
export declare class IdeaError extends Error {
    readonly code: IdeaErrorCode;
    constructor(code: IdeaErrorCode, message: string, options?: {
        cause?: unknown;
    });
}
/** One directory entry of `list`: a readable idea, or a file that could not be read as one. */
export type IdeaEntry = {
    ok: true;
    idea: Idea;
} | {
    ok: false;
    id: string;
    code: 'IDEA_CORRUPT' | 'IDEA_UNSAFE_PATH';
    reason: string;
};
//# sourceMappingURL=types.d.ts.map