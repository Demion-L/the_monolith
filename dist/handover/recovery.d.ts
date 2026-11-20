/**
 * Session context recovery packet (ACCOUNTABILITY-001, Phase 2/3).
 *
 * Host-independent: it only reads what Core already owns (read model, governance check, evidence
 * store) and returns a small structured packet. Hooks of any coding agent are adapters that print it.
 * Every field carries its source; a field whose source is missing is the literal `UNKNOWN`, never a guess.
 * Bounded: fixed caps on entries and text, plus a total character budget. Read-only; no new state file.
 */
import type { GovernanceReport } from '../governance/types.js';
import type { DashboardReadModel } from '../readmodel/index.js';
import { type GitView } from './git.js';
export declare const RECOVERY_MAX_MISSIONS = 3;
export declare const RECOVERY_MAX_STEPS = 5;
export declare const RECOVERY_MAX_FINDINGS = 6;
export declare const RECOVERY_MAX_TEXT = 160;
export declare const RECOVERY_MAX_CHARS = 3500;
export type Known<T> = {
    known: true;
    value: T;
    source: string;
} | {
    known: false;
    source: string;
};
export interface RecoveryPacket {
    project: Known<string>;
    activeStory: Known<{
        kind: 'none' | 'ids' | 'unresolved';
        ids: string[];
    }>;
    activeMissions: Known<{
        id: string;
        title: string;
        storyId: string | null;
        checkpointCount: number;
    }[]>;
    /** Latest checkpoint of an active mission; else the newest checkpoint of any mission (flagged as such). */
    lastCheckpoint: Known<{
        id: string;
        missionId: string;
        createdAt: string;
        summary: string;
        ofActiveMission: boolean;
    }>;
    /** `remainingSteps` of that checkpoint — a historical record at that moment, not the current plan. */
    pendingWork: Known<string[]>;
    governance: Known<{
        errors: number;
        warnings: number;
        top: {
            severity: string;
            area: string;
            code: string;
            path: string | null;
        }[];
        more: number;
    }>;
    evidence: Known<{
        verified: number;
        reported: number;
        stale: number;
        unknown: number;
        failed: number;
    }>;
    git: Known<{
        head: string | null;
        dirty: boolean | null;
    }>;
    ownerDecisions: Known<string[]>;
}
export interface RecoveryDeps {
    model?: DashboardReadModel;
    report?: GovernanceReport;
    git?: GitView;
}
export declare function buildRecoveryPacket(projectRoot: string, deps?: RecoveryDeps): RecoveryPacket;
/** Plain text lines for any host. The first lines keep the wording the original SessionStart hook used. */
export declare function renderRecoveryPacket(p: RecoveryPacket, maxChars?: number): string;
//# sourceMappingURL=recovery.d.ts.map