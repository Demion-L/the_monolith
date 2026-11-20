/**
 * Structural check of story capsules (GOV-EVOLUTION Phase 5).
 *
 * A capsule is created by `monolith finalize apply` from `renderCapsule` (src/finalize/core.ts):
 * frontmatter `type, id, phase, title, date, status`, an H1, then seven H2 sections. This module
 * checks an existing capsule against exactly that shape — nothing more. It is NOT a Markdown
 * validation framework and does not judge the quality of the content.
 *
 * Read-only. Files are read through the unified safe reader (ADR-014); directories are listed
 * without following symlinks. Bounded: at most MAX_CAPSULES files, each at most MAX_CAPSULE_BYTES.
 */
import type { GovernanceFinding } from './types.js';
export declare const CAPSULE_DIR_REL = "memory/working/phases";
export declare const MAX_CAPSULES = 500;
export declare const MAX_CAPSULE_BYTES: number;
/** The sections `renderCapsule` writes, in order. */
export declare const CAPSULE_SECTIONS: readonly ["Objective", "Implementation Summary", "Files Changed", "Tests", "Key Decisions", "ADRs Written", "Lessons Learned"];
export interface CapsuleScan {
    /** Number of capsule files examined. */
    examined: number;
    /** True when the directory does not exist (no story was ever finalized with a capsule). */
    absent: boolean;
    /** True when more than MAX_CAPSULES files exist and the rest were not examined. */
    truncated: boolean;
    findings: GovernanceFinding[];
}
export declare function checkCapsuleText(text: string, path: string): GovernanceFinding[];
export declare function scanCapsules(projectRoot: string, monolithRoot: string): CapsuleScan;
//# sourceMappingURL=capsules.d.ts.map