/**
 * MONOLITH Project Definition — Instance Configuration
 *
 * This file is the single source of truth for all project-specific knowledge.
 * The Kernel reads this file instead of hardcoding project facts.
 *
 * Kernel knows HOW. Instance knows WHAT.
 */

export const PROJECT_DEFINITION = {
  monolithRoot: '.monolith',

  finalizationProtocolId: 'finalize-story',

  protocols: [
    "finalize-story",
    "failure-memory-logging",
    "governance-evaluation",
    "integrity-verification"
  ],

  mistakeRoots: [
    ".monolith/learning/mistakes",
    ".monolith/memory/errors"
  ],

  driftLogPath: '.monolith/enforcement/drift-log.json',

  forcedInjectionTerms: {
    'finalize-story': ['protocol_drift', 'workflow', 'finalize-story'],
  },

  requiredRootArtifacts: [
    'agents-root',
    'project-map',
    'semantic-map',
    'dependency-map',
    'roadmap-index',
    'memory-working-active',
    'memory-working-story-index',
  ],

  projectRootFiles: ['AGENTS.md'],

  requiredFinalizationDocs: [
    { path: 'ROADMAP.md', label: 'Project roadmap' },
    { path: 'docs/current-state.md', label: 'Current state document' },
  ],
};
