/**
 * Consistency assessment of the state documents around a finalization (FIN-002).
 *
 * `finalize` writes a fixed, small set of documents (story-index.md, active.md,
 * and whatever the owner listed in `docUpdates` / HANDOFF). It deliberately does
 * NOT write roadmap-index.md, so a roadmap row that still says IN PROGRESS for
 * the story that was just finalized used to survive a successful `apply`
 * unnoticed. This module reports such disagreements; it never edits anything
 * and never changes the outcome of the operation.
 *
 * It reuses `findContradictions()` of `monolith brief` — the single definition
 * of "state documents disagree" — and feeds it the text the documents have (or
 * will have, for a plan) after finalization. Four things are kept apart:
 *   - operation success            → plan/apply `status` (unchanged)
 *   - managed documents            → written by this finalization
 *   - external documents           → not written by it; remediation is advice only
 *   - completeness of the evidence → NOT_VERIFIED when a document cannot be read
 */
import { findContradictions, parseActiveStoryClaim, parseRoadmapActiveStory, parseRoadmapStatuses, parseStoryIndexStatuses } from '../brief/freshness.js';
import { extractCurrentStory } from '../brief/story.js';
const SCOPE = 'Checks only structural agreement between active.md, roadmap-index.md and story-index.md (the same rules as `monolith brief`). It does not read prose, HANDOFF.md, or any other project document.';
const DOC_DIR = { 'active.md': 'memory/working/', 'story-index.md': 'memory/working/', 'roadmap-index.md': 'context/maps/' };
export function assessConsistency(input) {
    const notVerified = [];
    if (input.active === null)
        notVerified.push('active.md is missing or unreadable');
    if (input.roadmap === null)
        notVerified.push('roadmap-index.md is missing or unreadable');
    if (input.storyIndex === null)
        notVerified.push('story-index.md is missing or unreadable');
    const story = input.active === null ? null : extractCurrentStory(input.active);
    const activeStory = story !== null && story.hasCurrentStorySection ? parseActiveStoryClaim(story.excerpt) : { kind: 'unknown' };
    if (input.active !== null && activeStory.kind === 'unknown')
        notVerified.push('the active story could not be determined from active.md');
    const found = findContradictions({
        activeStory,
        roadmapActiveStory: input.roadmap === null ? null : parseRoadmapActiveStory(input.roadmap),
        roadmapStatuses: input.roadmap === null ? new Map() : parseRoadmapStatuses(input.roadmap),
        storyIndexStatuses: input.storyIndex === null ? new Map() : parseStoryIndexStatuses(input.storyIndex),
    });
    const written = new Set(input.writtenPaths);
    const findings = found.map((c) => {
        const externalDocuments = c.documents.filter((d) => !(input.managedRoot !== undefined && written.has(`${input.managedRoot}/${DOC_DIR[d] ?? ''}${d}`)));
        return {
            message: c.message,
            documents: c.documents,
            externalDocuments,
            remediation: externalDocuments.length === 0
                ? `Both documents are written by this finalization; review the proposal.`
                : `${externalDocuments.join(', ')} ${externalDocuments.length === 1 ? 'is' : 'are'} not written by finalization. Update ${externalDocuments.length === 1 ? 'it' : 'them'} yourself, or list ${externalDocuments.length === 1 ? 'it' : 'them'} in monolith.config.json finalization.allowedDocs and pass a docUpdates entry in a new proposal.`,
        };
    });
    // A concrete contradiction is reported as such even when other evidence is missing;
    // CONSISTENT requires that nothing was left unchecked.
    const status = findings.length > 0 ? 'INCONSISTENT' : notVerified.length > 0 ? 'NOT_VERIFIED' : 'CONSISTENT';
    return { status, projected: input.projected, findings, notVerified, scope: SCOPE };
}
