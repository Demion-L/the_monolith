/**
 * Extracts the "## Current Story" section from
 * `.monolith/memory/working/active.md` — confirmed structure only, no
 * heuristic Markdown interpretation (section 5 of the brief contract).
 *
 * Only two things are recognized: a line that is exactly a level-1..6
 * heading, and a line that is exactly `---` (used in active.md as a visual
 * section separator). The "Current Story" section's content is everything
 * between its own heading line and the next such boundary.
 */
export interface StoryExtraction {
    hasCurrentStorySection: boolean;
    excerpt: string | null;
    /** 1-indexed inclusive line range, e.g. "24-29". */
    lineRange: string | null;
}
export declare function extractCurrentStory(content: string): StoryExtraction;
//# sourceMappingURL=story.d.ts.map