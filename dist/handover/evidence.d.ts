/**
 * Verification evidence (ACCOUNTABILITY-001, Phase 4).
 *
 * One small JSON file per recorded check in `<monolithRoot>/memory/long-term/verification/EVD-NNNN.json`
 * (git-tracked project knowledge, like ideas). It is the minimal structure the existing sources cannot
 * represent: no mission, checkpoint or capsule field records *which command ran, with what result, at
 * which revision*. It is NOT a telemetry framework and NOT part of the Durable State schema or finalize.
 *
 * Provenance vocabulary (this module's own, deliberately narrow):
 *  - REPORTED — somebody (an agent) stated the result. MONOLITH did not observe it.
 *  - OBSERVED — `monolith evidence run` executed the command itself and captured its exit status.
 *  - VERIFIED is never stored. It is a verdict computed at read time (see `classifyEvidence`):
 *    an OBSERVED pass whose recorded revision still equals HEAD on a clean working tree. It means the
 *    stated command passed at this revision — not that the command is adequate, nor that the project is correct.
 *
 * What is NOT stored: command output (only the exit status), environment, or anything not listed in
 * `EvidenceRecord`. Command lines and notes are redacted for obvious secrets; redaction is best effort.
 */
import { type GitView } from './git.js';
import type { EvidenceLevel, EvidenceProvenance, EvidenceResult, Freshness, FreshnessReason } from './types.js';
export type { EvidenceLevel, EvidenceProvenance, EvidenceResult, Freshness, FreshnessReason };
export declare const EVIDENCE_REL = "memory/long-term/verification";
export declare const EVIDENCE_SCHEMA = 1;
export declare const MAX_EVIDENCE_FILE_BYTES: number;
export declare const MAX_EVIDENCE_RECORDS = 500;
export declare const MAX_COMMAND_CHARS = 500;
export declare const MAX_NOTE_CHARS = 500;
export interface EvidenceRecord {
    schema: typeof EVIDENCE_SCHEMA;
    id: string;
    storyId: string | null;
    /** Redacted, single line, bounded. */
    command: string;
    result: EvidenceResult;
    /** OBSERVED runs only. */
    exitCode: number | null;
    provenance: EvidenceProvenance;
    /** Which command produced the record. */
    source: 'monolith evidence run' | 'monolith evidence report';
    recordedAt: string;
    /** HEAD the check ran against (OBSERVED) or was claimed against (REPORTED); null when git was unavailable. */
    gitHead: string | null;
    /** Working tree had changes outside the evidence directory; null when unknown. */
    dirty: boolean | null;
    /** Redacted free text; REPORTED records only. */
    note: string | null;
    durationMs: number | null;
}
export interface NewEvidence {
    storyId: string | null;
    command: string;
    result: EvidenceResult;
    exitCode: number | null;
    provenance: EvidenceProvenance;
    gitHead: string | null;
    dirty: boolean | null;
    note: string | null;
    durationMs: number | null;
}
export declare class EvidenceError extends Error {
    readonly code: 'EVIDENCE_INVALID_INPUT' | 'EVIDENCE_UNSAFE_PATH' | 'EVIDENCE_NOT_INITIALIZED' | 'EVIDENCE_ID_EXHAUSTED';
    constructor(code: 'EVIDENCE_INVALID_INPUT' | 'EVIDENCE_UNSAFE_PATH' | 'EVIDENCE_NOT_INITIALIZED' | 'EVIDENCE_ID_EXHAUSTED', message: string);
}
export declare function redact(s: string): string;
/** Strict parse: anything that is not exactly an `EvidenceRecord` is rejected (`null`), never repaired. */
export declare function parseEvidence(text: string, expectedId: string): EvidenceRecord | null;
export interface EvidenceStore {
    projectRoot: string;
    monolithRoot: string;
    /** Project-relative directory, `/`-separated. */
    dirRel: string;
    dirAbs: string;
}
export declare function evidenceStore(projectRoot: string): EvidenceStore;
export declare function validateNewEvidence(input: NewEvidence): void;
/** Creates exactly one new file; never overwrites. Ids come from exclusive creation, so concurrent writers cannot collide. */
export declare function addEvidence(store: EvidenceStore, input: NewEvidence, opts?: {
    now?: () => Date;
}): EvidenceRecord;
export interface EvidenceListing {
    /** Readable records, ordered by id. */
    records: EvidenceRecord[];
    /** Files that exist but are not valid records (fixed code + id; never content). */
    unreadable: {
        id: string;
        code: 'EVIDENCE_CORRUPT' | 'EVIDENCE_UNSAFE_PATH';
    }[];
    /** The directory does not exist (nothing recorded yet) — distinct from "exists and is empty". */
    absent: boolean;
    /** Older records were not read because the limit was reached. */
    truncated: boolean;
}
/** Read-only. Never throws on bad data: a bad file is listed as unreadable, not guessed at. */
export declare function listEvidence(projectRoot: string): EvidenceListing;
export interface FreshnessAssessment {
    freshness: Freshness;
    reason: FreshnessReason;
}
export type ChangedFn = (from: string, to: string) => string[] | null;
export declare function assessFreshness(rec: EvidenceRecord, view: GitView, changed: ChangedFn): FreshnessAssessment;
export declare function classifyEvidence(rec: EvidenceRecord, a: FreshnessAssessment): EvidenceLevel;
export interface AssessedEvidence {
    record: EvidenceRecord;
    freshness: Freshness;
    reason: FreshnessReason;
    level: EvidenceLevel;
}
export declare function assessAll(projectRoot: string, records: EvidenceRecord[], view: GitView, excludeRels: string[]): AssessedEvidence[];
//# sourceMappingURL=evidence.d.ts.map