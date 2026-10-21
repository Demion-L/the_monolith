/**
 * `render(model, maxChars)` — the Rendering stage of the brief pipeline.
 *
 * Pure and synchronous: same BriefModel + same maxChars always produces the
 * byte-identical string (section 11 — determinism). No Date.now(), no
 * random IDs, no locale-dependent sorting; every list collect() hands in is
 * already in a fixed, stably-sorted order.
 *
 * Budget accounting (section 10) in two phases to avoid a circular
 * dependency between "does P0 fit" and "what does the Completeness line
 * say" (rule: no diagnostic/marker line may be added without being counted
 * in the budget that decided what else fits):
 *
 *   Phase 1 — build all P0 content (identity, State Keeper status,
 *   collect-time diagnostics, every active mission identifier, every
 *   mandatory protocol pointer) with NO budget limit — P0 is never
 *   truncated or hidden (rule 5/7). If P0 alone (plus the reserved,
 *   fixed-size Completeness line) exceeds maxChars, that is reported via
 *   BUDGET_EXCEEDED_BY_REQUIRED and nothing else is attempted.
 *
 *   Phase 2 — whatever chars remain after P0 + the reserved Completeness
 *   line are handed to P1, then P2, then P3, in that fixed order. Each
 *   section either fits whole, or (list sections) includes as many whole
 *   items as fit plus an explicit "N more omitted" marker, or (the Story
 *   excerpt) is field-truncated with an explicit `[truncated N chars]`
 *   marker, or is omitted outright with a one-line marker. Every one of
 *   these outcomes is itself measured and subtracted from the remaining
 *   budget before the next section is attempted — nothing is added "for
 *   free" after the fact.
 */
import type { BriefModel } from './types.js';
export declare const DEFAULT_MAX_CHARS = 6000;
export type Completeness = 'COMPLETE' | 'INCOMPLETE';
export interface RenderResult {
    text: string;
    completeness: Completeness;
}
export declare function render(model: BriefModel, maxChars?: number): RenderResult;
//# sourceMappingURL=render.d.ts.map