export interface StoryExtraction {
    hasCurrentStorySection: boolean;
    excerpt: string | null;
    /** 1-indexed inclusive line range, e.g. "24-29". */
    lineRange: string | null;
    /** More than one real "## Current Story" heading; no section is returned. */
    ambiguous?: boolean;
}
export declare function extractCurrentStory(content: string): StoryExtraction;
//# sourceMappingURL=story.d.ts.map