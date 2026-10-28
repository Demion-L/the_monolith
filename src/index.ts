/**
 * @monolith/core — Public API surface
 *
 * This file is the package entrypoint. Exports grow here as Kernel modules
 * are extracted from project instances into this package.
 *
 * Current state: Phase 6 — validate implemented; Scriptorium (Story 1.2) and
 * Explicit Relationship Graph (Story 1.3) integrated.
 * See Phase 7+ roadmap for Kernel extraction.
 *
 * Webway (the frequency-based "meaning linker" prototype from Story 1.1) was
 * extracted into its own repository: https://github.com/Demion-L/webway —
 * it was an independent research track with zero runtime coupling to
 * Scriptorium/Graph, see docs/webway-v0.md for the historical record.
 */

export type { ProjectDefinition } from './types/project-definition.js';
export type { GateCheckResult } from './types/enforcement.js';
export type { VerificationContext, VerificationReport } from './types/integrity.js';
export type { ProjectConfig, InitOptions } from './init/types.js';

export { MONOLITH_VERSION } from './version.js';
export { runInit } from './init/index.js';

// Scriptorium — deterministic structural extraction (Story 1.2)
export type {
  ScriptoriumInput,
  ScriptoriumResult,
  ConceptCandidate,
  RelationshipCandidate,
  Evidence,
  SourceReference,
  ScriptoriumDiagnostic,
  ConceptSource,
  EvidenceSource,
  HeadingLevel,
  ObjectDeclaration,
  DeclaredObjectKind,
} from './scriptorium/index.js';
export { compileMarkdownArtifact, isStructuralHeadingNoise } from './scriptorium/index.js';

// Graph — explicit relationship graph builder (Story 1.3)
export type {
  GraphNode,
  GraphEdge,
  GraphDiagnostic,
  ExplicitRelationshipGraph,
  UnresolvedReference,
  IdentityConflict,
  KnowledgeObject,
  KnowledgeObjectKind,
  Resolution,
  UnresolvedResolution,
  ObjectIndex,
} from './graph/index.js';
export { buildGraph, buildObjectIndex, resolveRef, makeRef, parseRef, isValidIdentifier } from './graph/index.js';

// Coordinatorium — deterministic project state + mission lifecycle (Tactical v0.1, ADR-008)
export type {
  CoordinatoriumState,
  Mission,
  MissionStatus,
  MissionResult,
  CoordinatoriumErrorCode,
  StartMissionInput,
  FinishMissionInput,
  StateWriteTarget,
  StateReadTarget,
} from './coordinatorium/index.js';
export {
  createInitialState,
  CoordinatoriumError,
  StateCorruptedError,
  StateSchemaError,
  LockTimeoutError,
  MissionNotFoundError,
  InvalidTransitionError,
  ValidationError,
  readState,
  mutateState,
  projectTarget,
  trustedDirectoryTarget,
  startMission,
  listMissions,
  getMission,
  finishMission,
} from './coordinatorium/index.js';

// Safe writes — explicit write scope and publication states (SEC-001B.2, ADR-012)
export { SafeWriteError } from './root/index.js';
export type { WriteErrorCode, WriteWarning, WriteWarningCode, PublicationState } from './root/index.js';

// Durable State — domain-neutral, crash-safe execution record for long-running agentic tasks (ADR-017).
// Namespaced: its error taxonomy deliberately shares names (e.g. ValidationError) with Coordinatorium's.
export * as durable from './durable/index.js';
