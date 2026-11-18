/**
 * `parseStoryIndex(text, roadmapPhaseIds)` — structured extraction of the stories
 * declared in `story-index.md` and of their Phase → Story containment (CORE-GRAPH-002).
 *
 * Contract:
 *  - Pure, deterministic, synchronous. No I/O, no Git, no network, no LLM, no writes.
 *  - Same conventions as `parseRoadmapPhases`: fenced code and HTML comments are
 *    never read (`maskNonContent`), CRLF is normalized, statuses are REPORTED,
 *    diagnostics are fixed codes (no document text, no paths).
 *  - Phase → Story is structural nesting under `## Phase <id>` (D1), confirmed only by
 *    strict equality of the id token with a Roadmap phase id (D2). No fuzzy matching,
 *    no title matching, no inference from order, no correction of ids.
 *  - Story → Story relationships do not exist here (D5). Duplicate story ids are never
 *    resolved by first-wins: every entry stays and is flagged (`STORY_ID_DUPLICATE`).
 *
 * Recognised shape:
 *
 *   ## Phase <id> — <title>
 *   ### <STORY ID> — <title>        (`STORY 1.1`, `CONTEXT-001A`, `UI-006`, ...)
 *   **Date:** <value>
 *   **Status:** <value>
 *   ...free body (ignored)
 *
 * `roadmapPhaseIds === null` means the Roadmap could not supply phase ids: nesting is
 * then reported as `unverified`, never as matched or unmatched.
 * `roadmapIdsComplete === false` (Roadmap state `partial`) means the id list may be
 * missing phases: an exact match is still `matched`, but an absent id is `unverified`,
 * never `unmatched` (absence cannot be established from incomplete data).
 */
import type { StructuredStoryIndexView } from './types.js';
/** Parser capacity: a resource guard, not a product limit. Hitting it yields `partial` + `STORIES_TRUNCATED`. */
export declare const MAX_INDEX_STORIES = 10000;
export declare function parseStoryIndex(text: string, roadmapPhaseIds: readonly string[] | null, roadmapIdsComplete?: boolean): StructuredStoryIndexView;
//# sourceMappingURL=story-index.d.ts.map