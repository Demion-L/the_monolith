/**
 * Read-only diagnostics for files an interrupted write can leave behind
 * (SEC-001B.2, DEC-B2-02, FS-CLEAN-001).
 *
 * This only LISTS names. It never opens, reads, follows, repairs or deletes
 * anything, and a name that matches does NOT mean the file is an orphan:
 * every running `mission` command has exactly such a file for a moment. Safe
 * cleanup needs an owner/liveness criterion that does not exist yet.
 */
export type WriteArtifactKind = 'state-temp' | 'lock-staging' | 'recovery-mutex';
export interface WriteArtifact {
    /** Directory entry name (project-controlled text: escape before printing). */
    name: string;
    kind: WriteArtifactKind;
}
/** Entries of the instance directory `rootAbs` that look like write leftovers. Never throws. */
export declare function findWriteArtifacts(rootAbs: string): WriteArtifact[];
/** One-line, bounded, human-readable summary; names are JSON-escaped so control characters cannot forge output. */
export declare function describeWriteArtifacts(artifacts: readonly WriteArtifact[], where: string, maxNames?: number): string;
//# sourceMappingURL=write-artifacts.d.ts.map