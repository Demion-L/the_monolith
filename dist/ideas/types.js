/**
 * Manual Idea Capture (IDEA-001A) — types.
 *
 * An idea is a deferred thought saved without leaving the current task. It is
 * NOT a task, a hypothesis or a Durable State record: it does not touch
 * `active.md`, `state.json` or any mission.
 */
export const IDEA_STATUSES = ['inbox', 'planned', 'archived'];
/** Limits are protective ceilings (a CLI argument, not a document store). */
export const IDEA_LIMITS = {
    title: 300,
    description: 100_000,
    context: 20_000,
    /** Upper bound of one idea file, in bytes (frontmatter + body). */
    fileBytes: 256 * 1024,
};
export class IdeaError extends Error {
    code;
    constructor(code, message, options) {
        super(message);
        this.name = 'IdeaError';
        this.code = code;
        if (options?.cause !== undefined)
            this.cause = options.cause;
    }
}
