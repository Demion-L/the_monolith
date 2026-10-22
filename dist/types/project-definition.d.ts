/**
 * Shape of the project.definition.mjs file that every MONOLITH instance must provide.
 * This describes the intended contract only. `monolith validate` does NOT import or
 * execute the file and does not check that it exports `PROJECT_DEFINITION` (SEC-002,
 * ADR-011); no kernel code currently reads these values at runtime.
 */
export interface ProjectDefinition {
    /** Directory name of the MONOLITH instance (e.g. '.monolith'). */
    monolithRoot: string;
    /** Protocol ID used as the finalization gate. */
    finalizationProtocolId: string;
    /** All protocol IDs active in this project. */
    protocols: string[];
    /** Filesystem paths where mistake / error records are stored. */
    mistakeRoots: string[];
    /** Path to the drift log JSON file. */
    driftLogPath: string;
    /** Per-protocol lists of terms that force lesson injection. */
    forcedInjectionTerms: Record<string, string[]>;
    /** IDs of graph nodes that must exist at the project root. */
    requiredRootArtifacts: string[];
    /** Markdown files that must exist at the workspace root. */
    projectRootFiles: string[];
    /** Documents that must be present before finalization is allowed. */
    requiredFinalizationDocs: Array<{
        path: string;
        label: string;
    }>;
}
//# sourceMappingURL=project-definition.d.ts.map