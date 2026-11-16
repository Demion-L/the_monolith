/**
 * `parseRoadmapPhases(text)` — structured extraction of the phases declared in
 * `roadmap-index.md` (UI-003C).
 *
 * Contract:
 *  - Pure, deterministic, synchronous. No I/O, no Git, no network, no LLM, no
 *    side effects. The input is the already bounded text read by the read model.
 *  - DOES NOT reuse `parseRoadmapStatuses()`: that parser reads STORY table rows
 *    (`| id | title | STATUS | date |`). Phase semantics come only from the
 *    `## Phases` section; tables anywhere (Completion Summary included) are never
 *    phases and never statuses.
 *  - Everything a phase reports is REPORTED: the document's own claim, never
 *    confirmed. Nothing is derived from position, story counts or absence.
 *  - The active phase is taken only from an explicit `Active Phase:` line. A
 *    missing, contradictory or unmatched pointer is reported as such, never
 *    resolved by guessing.
 *  - Diagnostics are fixed codes (no document text, no paths), safe to serialize.
 *
 * Recognised shape (both the MONOLITH roadmap and the project template):
 *
 *   ## Phases
 *   ### Phase <id> — <title>          (the title may be absent: `### Phase 2+`)
 *   **Status:** <value>
 *   **Goal:** <one line>              (optional)
 *   ...free body (tables, lists, #### sub-headings) → `details`
 *   ## Current Focus
 *   Active Phase: <id> — <title> | —     (read ONLY inside `## Current Focus`)
 */
import type { StructuredRoadmapView } from './types.js';
/**
 * Parser capacity: a resource guard, not a product limit and not a display limit
 * (the UI shows a small window of the phases and keeps all of them reachable).
 * It is far above any realistic roadmap; if it is ever hit, the result is
 * `partial` with `PHASES_TRUNCATED`, so a cut roadmap is never presented as whole.
 */
export declare const MAX_ROADMAP_PHASES = 10000;
export declare const MAX_PHASE_DETAILS_CHARS = 8000;
export declare const MAX_PHASE_GOAL_CHARS = 600;
export declare function parseRoadmapPhases(text: string): StructuredRoadmapView;
//# sourceMappingURL=roadmap.d.ts.map