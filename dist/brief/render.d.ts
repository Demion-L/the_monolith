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
 *   BUDGET_EXCEEDED_BY_REQUIRED (which also states explicitly that P1–P3
 *   are skipped entirely as a result — review finding F-5) and nothing
 *   else is attempted.
 *
 *   Phase 2 — whatever chars remain after P0 + the reserved Completeness
 *   line are handed to P1 (Checkpoints, then Story — Checkpoints first so
 *   a long Story can never silently starve "Next steps" out of the budget;
 *   review finding F-5), then P2, then P3, in that fixed order. Each
 *   section either fits whole, or (list sections) includes as many whole
 *   items as fit plus an explicit "N more omitted" marker, or (the Story
 *   excerpt) is field-truncated with an explicit `[truncated N chars]`
 *   marker, or — if not even that fits — falls back to a short, fixed-size
 *   local omission marker so a section can never disappear from the output
 *   without some local trace of its omission (review finding F-5; the only
 *   residual case where a section can still vanish with zero local marker
 *   is when `remaining` is too small even for that minimal marker, which
 *   is itself already covered by the global Completeness: INCOMPLETE
 *   signal). Every one of these outcomes is itself measured and subtracted
 *   from the remaining budget before the next section is attempted —
 *   nothing is added "for free" after the fact.
 *
 * Completeness contract (N-3): `Completeness: COMPLETE` means no
 * *substantive data* was lost, not that every section heading is present.
 * An optional section that has nothing to show (an empty list, rendered
 * only as "(none)") and the static P3 pointer block may be dropped under a
 * tight budget without flipping the result to INCOMPLETE — dropping them
 * loses no information. A section that holds data is never dropped
 * silently: it is shown whole, shown partially with an explicit marker, or
 * replaced by a pointer-bearing omission marker, and either of the latter
 * two forces INCOMPLETE. P0 is never dropped. All project-controlled
 * strings, provenance pointers included, pass through
 * `sanitizeSingleLine` (N-1).
 *
 * Advisory section (IDEA-002B): Parked Ideas is the one data-holding section whose
 * budget degradation does NOT force INCOMPLETE. It is user-saved side context, not
 * project state; its degradation stays visible (fewer items, count, or a marker
 * whenever they fit) but `Completeness` and `--strict` keep describing only the
 * project context that existed before ideas did. Unreadable idea files are
 * reported by the `IDEAS_UNREADABLE` warning, which is not an error.
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