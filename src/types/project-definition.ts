/**
 * Shape of the project.definition.js file that every MONOLITH instance must provide.
 * The Kernel reads this at runtime — it never hardcodes these values itself.
 */
export interface ProjectDefinition {
  /** Directory name of the MONOLITH instance (e.g. '.devin'). */
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
  requiredFinalizationDocs: Array<{ path: string; label: string }>;
}
