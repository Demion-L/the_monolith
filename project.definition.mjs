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

  // NOT YET ENFORCED: src/validate/index.ts never reads driftLogPath. The
  // directory below does not exist in this repository. This field documents
  // where a future drift-detection engine (README.md "Not Yet Implemented")
  // would write its log, not where one writes today.
  driftLogPath: '.monolith/enforcement/drift-log.json',

  forcedInjectionTerms: {
    'finalize-story': ['protocol_drift', 'workflow', 'finalize-story'],
  },

  // Enforced conceptually (by the AI-assistant boot sequence in AGENTS.md /
  // CLAUDE.md), but NOT checked by `monolith validate` today. Every id below
  // does correspond to a real file's frontmatter `id:` in this repository
  // (verified 2026-10-20) — this list is accurate, just not yet validated by code.
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

  // NOT YET ENFORCED: src/validate/index.ts never reads
  // requiredFinalizationDocs. Neither ROADMAP.md nor docs/current-state.md
  // exists in this repository today. Unlike requiredRootArtifacts above,
  // this list does not describe a currently-true state — whether these two
  // documents should be created, renamed to existing equivalents (e.g.
  // `.monolith/context/maps/roadmap-index.md`), or dropped is an open
  // decision, not resolved here. See the Knowledge Consistency Cleanup
  // report (2026-10-20) for this ambiguity.
  requiredFinalizationDocs: [
    { path: 'ROADMAP.md', label: 'Project roadmap' },
    { path: 'docs/current-state.md', label: 'Current state document' },
  ],
};
