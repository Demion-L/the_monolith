/**
 * Deterministic story finalization (DOCSYNC-001, ADR-022).
 *
 * `planFinalization` is read-only: it validates a proposal against the
 * instance, evaluates explicit preconditions (PASS / FAIL / NOT_VERIFIED),
 * classifies every write target and returns a digest that binds an owner's
 * approval to exactly what was inspected. `applyFinalization` re-plans under a
 * cross-process lock and writes only if the digest still matches.
 *
 * Consistency model (narrower than a transaction, deliberately): there is no
 * rollback. Targets are written one at a time in a fixed order with `active.md`
 * LAST, every write is an atomic single-file publish (src/root safe-write), and
 * each target has a deterministic "already done" predicate. An interruption
 * leaves a state that `planFinalization` reports as partial and that re-running
 * plan + apply rolls forward; success is only reported after a post-write
 * re-read of every target. See ADR-022.
 *
 * Reused, not reimplemented: safe reads/writes and containment (src/root),
 * the cross-process lock (src/coordinatorium/lock), the Current Story section
 * extractor of `monolith brief` (src/brief/story).
 */
import { type ConfigRead, type FsOps, type WriteWarning } from '../root/index.js';
import { type LockOptions } from '../coordinatorium/lock.js';
import { type ConsistencyAssessment } from './consistency.js';
import { type FinalizationProposal } from './proposal.js';
export type CheckStatus = 'PASS' | 'FAIL' | 'NOT_VERIFIED';
export type TargetKind = 'capsule' | 'execution-history' | 'story-index' | 'doc' | 'handoff' | 'active';
export type TargetState = 'pending' | 'done' | 'conflict' | 'missing' | 'unreadable';
export type PlanStatus = 'READY' | 'NOT_READY' | 'ALREADY_FINALIZED';
export type ApplyStatus = 'FINALIZED' | 'ALREADY_FINALIZED' | 'REFUSED' | 'INCOMPLETE';
export interface Check {
    id: string;
    status: CheckStatus;
    detail: string;
    /** Where the verdict comes from (a MONOLITH computation vs. attested evidence). */
    source: string;
}
export interface PlannedTarget {
    id: string;
    kind: TargetKind;
    /** Project-relative, `/`-separated. */
    path: string;
    state: TargetState;
    reason: string;
    /** sha256 of the file as inspected, `ABSENT`, or `DONE`. Part of the digest. */
    base: string;
    /** What will be written/appended; omitted for done/blocked targets and for opaque documents. */
    preview?: string;
}
export interface FinalizationPlan {
    status: PlanStatus;
    storyId: string;
    /** Approval token: sha256 over the proposal, every target's state/base and the evidence inspected. */
    digest: string;
    /** True when some, but not all, targets are already in their final state (an earlier run was interrupted). */
    partial: boolean;
    checks: Check[];
    targets: PlannedTarget[];
    diagnostics: string[];
    /**
     * FIN-002: whether the state documents agree with each other in the state
     * this plan leads to (projected before apply, actual once every target is
     * done). Informational: it never changes `status`, the digest or exit codes.
     */
    consistency?: ConsistencyAssessment;
}
export interface ApplyResult {
    status: ApplyStatus;
    storyId: string;
    plan: FinalizationPlan;
    applied: string[];
    pending: string[];
    failed?: {
        target: string;
        message: string;
        publication?: string;
    };
    diagnostics: string[];
}
export interface FinalizeOptions {
    /** Test-only fault injection for the safe-write primitives. */
    ops?: Partial<FsOps>;
    lock?: LockOptions;
    onWarning?: (w: WriteWarning) => void;
}
export interface FinalizeConfig {
    requiredDocs: Array<{
        path: string;
        label: string;
    }>;
    allowedDocs: string[];
    errors: string[];
}
export declare function readFinalizeConfig(config: ConfigRead): FinalizeConfig;
export declare function renderCapsule(p: FinalizationProposal): string;
/**
 * Format-equivalence of a capsule (FIN-001, made context-aware by A4-FIN-01).
 * The capsule is created once and never overwritten, so "already present" used
 * to mean byte-identical; a formatter pass (Prettier adds a blank line after
 * every heading) then turned an unchanged capsule into a CONFLICT. Equivalence
 * is deliberately narrow and NOT a general whitespace-insensitive comparison.
 * Ignored: line endings (CRLF/LF), trailing whitespace on a line that is plain
 * prose, a single blank line directly after an ATX heading, and trailing blank
 * lines at end of file. NOT ignored, because whitespace carries meaning there:
 *  - anything inside a fenced code block (``` or ~~~), an indented code block /
 *    4-space-or-tab-indented line, an HTML comment, or YAML frontmatter
 *    (`---` ... `---` at the very top; an unterminated one protects the whole
 *    file) — those lines are compared verbatim;
 *  - a Markdown hard line break (two or more trailing spaces before a line that
 *    continues the paragraph): kept as a break (any run of 2+ spaces is the
 *    same break); a backslash break is not whitespace and is always compared;
 *  - blank lines anywhere else (paragraph breaks).
 */
export declare function capsuleCanonical(s: string): string;
/** Evidence older than this many days before the finalization date is not accepted. */
export declare const EVIDENCE_MAX_AGE_DAYS = 7;
export type ActiveIdentity = {
    ok: true;
    id: string;
} | {
    ok: false;
    reason: string;
};
/**
 * Structural identity of the active story (DOCSYNC-007). The ONLY source is the
 * `**Story:** <id> …` field line inside `## Current Story` (same grammar as the
 * evidence files and `## Last Finalization`); its FIRST token is the id. Ids
 * mentioned in titles, descriptions, comments, code fences or other fields carry
 * no authority. Zero, several, or malformed field lines → no identity (fail closed).
 * A section whose first visible line says "no active story" AND that has a
 * structural field is contradictory → no identity (PSC-004A).
 */
export declare function activeStoryIdentity(currentStoryBody: string): ActiveIdentity;
export declare function planFinalization(targetDir: string, proposal: FinalizationProposal): FinalizationPlan;
export declare function applyFinalization(targetDir: string, proposal: FinalizationProposal, approvedDigest: string, opts?: FinalizeOptions): Promise<ApplyResult>;
//# sourceMappingURL=core.d.ts.map