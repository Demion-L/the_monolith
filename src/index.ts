/**
 * @monolith/core — Public API surface
 *
 * This file is the package entrypoint. Exports grow here as Kernel modules
 * are extracted from the instance (.devin/) into this package.
 *
 * Current state: Phase 5 — init command implemented, types defined.
 * See Phase 6+ roadmap for validate/status/dry-run extraction.
 */

export type { ProjectDefinition } from './types/project-definition.js';
export type { GateCheckResult } from './types/enforcement.js';
export type { VerificationContext, VerificationReport } from './types/integrity.js';
export type { ProjectConfig, InitOptions } from './init/types.js';

export { MONOLITH_VERSION } from './version.js';
export { runInit } from './init/index.js';

// Webway — semantic connection layer
export type {
  Artifact,
  Concept,
  SemanticLink,
  SemanticRelationshipType,
  KnowledgeRegion,
  MentalModel,
  WebwayAnalysisResult,
} from './webway/index.js';
export { analyzeArtifact } from './webway/index.js';
