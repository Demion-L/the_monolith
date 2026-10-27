/**
 * MONOLITH Context Gateway — `monolith brief` (CONTEXT-001A).
 *
 * BriefModel is the thin, read-only data layer produced by `collect()`.
 * It is deliberately NOT a new source of truth: every field is either a
 * direct, narrow projection of an existing artifact (state.json, active.md,
 * a protocol's/ADR's frontmatter) or a diagnostic about that artifact's
 * readability. `render()` turns a BriefModel into bounded, deterministic
 * text — it never re-derives data collect() didn't already produce.
 */
import type { Mission, Checkpoint } from '../coordinatorium/types.js';
import type { ProjectFileErrorCode } from '../root/index.js';
import type { FreshnessResult } from './freshness.js';
export type DiagnosticSeverity = 'info' | 'warn' | 'error';
/**
 * Collect-time diagnostic codes. These are known before any rendering /
 * budget decision is made, which is what lets render() reserve space for
 * them deterministically (see render.ts's two-phase budget accounting).
 */
export type BriefDiagnosticCode = 'MONOLITH_NOT_INITIALIZED' | 'STATE_NOT_INITIALIZED' | 'STATE_EMPTY' | 'STATE_UNREADABLE' | 'STATE_LEGACY_SCHEMA_MIGRATED' | 'MULTIPLE_ACTIVE_MISSIONS' | 'CHECKPOINT_ORDER_MISMATCH' | 'ACTIVE_MD_MISSING' | 'ACTIVE_MD_REJECTED' | 'ACTIVE_MD_UNREADABLE' | 'ACTIVE_MD_NO_CURRENT_STORY' | 'CONFIG_UNREADABLE' | 'CONFIG_ADR_DIRS_INVALID' | 'DOC_DIR_UNREADABLE' | 'DOC_FILE_UNREADABLE' | 'DOC_DIR_OUTSIDE_PROJECT' | 'PATH_OUTSIDE_PROJECT' | 'WRITE_ARTIFACTS_PRESENT';
export interface BriefDiagnostic {
    code: BriefDiagnosticCode;
    severity: DiagnosticSeverity;
    message: string;
    /**
     * SEC-001B.1-R: the typed reason of the safe reader, when the diagnostic is about
     * reading a managed file. Callers must branch on this, never on `message`.
     */
    readCode?: ProjectFileErrorCode;
}
/** A pointer to the on-disk artifact a section's content was read from. */
export interface Provenance {
    /** Relative to the project's targetDir. Never absolute. */
    source: string;
}
export type StateKeeperStatus = 'absent' | 'empty' | 'unreadable' | 'ok';
export interface StateKeeperSummary {
    status: StateKeeperStatus;
    /** Only set when status === 'ok' or 'unreadable' was resolved after a parse. */
    schemaVersionOnDisk?: number;
    provenance: Provenance;
}
export interface MissionsSummary {
    /** All in_progress missions, sorted by (startedAt, id). */
    active: Mission[];
    /** Finished missions (completed/failed/cancelled), most recently updated first. */
    recentFinished: Mission[];
    provenance: Provenance;
}
export interface CheckpointSummary {
    missionId: string;
    /** The checkpoint with the highest numeric ordinal for this mission, or null if none exist. */
    latest: Checkpoint | null;
    provenance: Provenance;
}
export interface StorySummary {
    /** Whether active.md exists at all. */
    fileExists: boolean;
    /** Whether a "## Current Story" section was found inside an existing file. */
    hasCurrentStorySection: boolean;
    /** Raw section text (trimmed), only set when hasCurrentStorySection is true. */
    excerpt: string | null;
    /** 1-indexed inclusive line range of the excerpt within active.md, e.g. "24-29". */
    lineRange: string | null;
    provenance: Provenance | null;
}
export interface DocRef {
    id: string;
    title: string;
    /** Relative to targetDir. */
    path: string;
}
export interface AdrIndex {
    items: AdrRef[];
    provenance: Provenance;
}
export type AdrRef = DocRef;
export interface ProtocolIndex {
    items: DocRef[];
    provenance: Provenance;
}
export interface ProjectIdentity {
    name: string;
    monolithRoot: string;
    provenance: Provenance;
}
export interface BriefModel {
    identity: ProjectIdentity;
    monolithInitialized: boolean;
    stateKeeper: StateKeeperSummary;
    missions: MissionsSummary;
    checkpoints: CheckpointSummary[];
    story: StorySummary;
    mandatoryProtocols: ProtocolIndex;
    adrs: AdrIndex;
    /** Collect-time diagnostics, in deterministic (collection-order) sequence. */
    diagnostics: BriefDiagnostic[];
    /**
     * SELF-AWARENESS-001: whether the recorded state can be trusted. Independent of
     * Completeness. Optional so a hand-built model without it renders as before.
     */
    freshness?: FreshnessResult;
}
//# sourceMappingURL=types.d.ts.map