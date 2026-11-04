/**
 * Extracts the "## Current Story" section from
 * `.monolith/memory/working/active.md` — confirmed structure only, no
 * heuristic Markdown interpretation (section 5 of the brief contract).
 *
 * Only two things are recognized: a line that is exactly a level-1..6
 * heading, and a line that is exactly `---` (used in active.md as a visual
 * section separator). The "Current Story" section's content is everything
 * between its own heading line and the next such boundary.
 *
 * Headings and separators are structural only outside fenced code blocks and
 * HTML comments (PSC-004): a `## Current Story` shown inside a Markdown
 * example is not the section. If more than one real heading exists the
 * section is ambiguous and is NOT read (`ambiguous: true`, no section): no
 * consumer may guess which one is the project's current story.
 */
import { maskNonContent } from './markdown-context.js';
const CURRENT_STORY_HEADING_RE = /^##\s+Current Story\s*$/i;
const HEADING_RE = /^#{1,6}\s+/;
const RULE_RE = /^-{3,}\s*$/;
export function extractCurrentStory(content) {
    const lines = content.split('\n');
    // Same line count as `lines`; fenced / commented text is blank.
    const structural = maskNonContent(content).split('\n');
    const headings = [];
    for (let i = 0; i < lines.length; i++) {
        // The heading line must be untouched by masking: a line carrying (or
        // opening) an HTML comment is not a heading, so no comment state can leak
        // from it into the section body.
        if (CURRENT_STORY_HEADING_RE.test(structural[i].trim()) && structural[i].trim() === lines[i].trim())
            headings.push(i);
    }
    if (headings.length === 0) {
        return { hasCurrentStorySection: false, excerpt: null, lineRange: null };
    }
    if (headings.length > 1) {
        return { hasCurrentStorySection: false, excerpt: null, lineRange: null, ambiguous: true };
    }
    const headingLineIdx = headings[0];
    let endIdx = lines.length;
    for (let i = headingLineIdx + 1; i < lines.length; i++) {
        const trimmed = structural[i].trim();
        if (HEADING_RE.test(trimmed) || RULE_RE.test(trimmed)) {
            endIdx = i;
            break;
        }
    }
    const bodyLines = lines.slice(headingLineIdx + 1, endIdx);
    // Trim leading/trailing blank lines, keep interior ones.
    let start = 0;
    let end = bodyLines.length;
    while (start < end && bodyLines[start].trim() === '')
        start++;
    while (end > start && bodyLines[end - 1].trim() === '')
        end--;
    const trimmedLines = bodyLines.slice(start, end);
    const excerpt = trimmedLines.join('\n');
    if (trimmedLines.length === 0) {
        // Heading exists but has no body — still a confirmed (empty) section.
        return {
            hasCurrentStorySection: true,
            excerpt: '',
            lineRange: `${headingLineIdx + 1}-${headingLineIdx + 1}`,
        };
    }
    const firstLine1Indexed = headingLineIdx + 1 + 1 + start;
    const lastLine1Indexed = firstLine1Indexed + trimmedLines.length - 1;
    return {
        hasCurrentStorySection: true,
        excerpt,
        lineRange: `${firstLine1Indexed}-${lastLine1Indexed}`,
    };
}
