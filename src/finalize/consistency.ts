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

export type ConsistencyStatus = 'CONSISTENT' | 'INCONSISTENT' | 'NOT_VERIFIED';

export interface ConsistencyFinding {
  message: string;
  /** State documents (file names) that disagree. */
  documents: string[];
  /** The subset of `documents` that this finalization does not write. */
  externalDocuments: string[];
  /** What a person can do; MONOLITH does not do it. */
  remediation: string;
}

export interface ConsistencyAssessment {
  status: ConsistencyStatus;
  /** true: computed from the texts a pending plan would write; false: read from disk. */
  projected: boolean;
  findings: ConsistencyFinding[];
  /** Why the check could not be completed (NOT_VERIFIED). */
  notVerified: string[];
  /** What this check does not cover. */
  scope: string;
}

export interface ConsistencyInput {
  /** Text of each state document as it is / will be; null = missing or unreadable. */
  active: string | null;
  roadmap: string | null;
  storyIndex: string | null;
  /** Project-relative paths this finalization writes (or has written). */
  writtenPaths: string[];
  projected: boolean;
}

const SCOPE = 'Checks only structural agreement between active.md, roadmap-index.md and story-index.md (the same rules as `monolith brief`). It does not read prose, HANDOFF.md, or any other project document.';

const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

export function assessConsistency(input: ConsistencyInput): ConsistencyAssessment {
  const notVerified: string[] = [];
  if (input.active === null) notVerified.push('active.md is missing or unreadable');
  if (input.roadmap === null) notVerified.push('roadmap-index.md is missing or unreadable');
  if (input.storyIndex === null) notVerified.push('story-index.md is missing or unreadable');

  const story = input.active === null ? null : extractCurrentStory(input.active);
  const activeStory = story !== null && story.hasCurrentStorySection ? parseActiveStoryClaim(story.excerpt) : ({ kind: 'unknown' } as const);
  if (input.active !== null && activeStory.kind === 'unknown') notVerified.push('the active story could not be determined from active.md');

  const found = findContradictions({
    activeStory,
    roadmapActiveStory: input.roadmap === null ? null : parseRoadmapActiveStory(input.roadmap),
    roadmapStatuses: input.roadmap === null ? new Map() : parseRoadmapStatuses(input.roadmap),
    storyIndexStatuses: input.storyIndex === null ? new Map() : parseStoryIndexStatuses(input.storyIndex),
  });

  const written = new Set(input.writtenPaths.map(baseName));
  const findings: ConsistencyFinding[] = found.map((c) => {
    const externalDocuments = c.documents.filter((d) => !written.has(d));
    return {
      message: c.message,
      documents: c.documents,
      externalDocuments,
      remediation:
        externalDocuments.length === 0
          ? `Both documents are written by this finalization; review the proposal.`
          : `${externalDocuments.join(', ')} ${externalDocuments.length === 1 ? 'is' : 'are'} not written by finalization. Update ${externalDocuments.length === 1 ? 'it' : 'them'} yourself, or list ${externalDocuments.length === 1 ? 'it' : 'them'} in monolith.config.json finalization.allowedDocs and pass a docUpdates entry in a new proposal.`,
    };
  });

  // A concrete contradiction is reported as such even when other evidence is missing;
  // CONSISTENT requires that nothing was left unchecked.
  const status: ConsistencyStatus = findings.length > 0 ? 'INCONSISTENT' : notVerified.length > 0 ? 'NOT_VERIFIED' : 'CONSISTENT';
  return { status, projected: input.projected, findings, notVerified, scope: SCOPE };
}
