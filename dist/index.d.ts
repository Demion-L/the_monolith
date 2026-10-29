/**
 * @latysh-development/monolith — Public API surface
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
export type { ScriptoriumInput, ScriptoriumResult, ConceptCandidate, RelationshipCandidate, Evidence, SourceReference, ScriptoriumDiagnostic, ConceptSource, EvidenceSource, HeadingLevel, ObjectDeclaration, DeclaredObjectKind, } from './scriptorium/index.js';
export { compileMarkdownArtifact, isStructuralHeadingNoise } from './scriptorium/index.js';
export type { GraphNode, GraphEdge, GraphDiagnostic, ExplicitRelationshipGraph, UnresolvedReference, IdentityConflict, KnowledgeObject, KnowledgeObjectKind, Resolution, UnresolvedResolution, ObjectIndex, } from './graph/index.js';
export { buildGraph, buildObjectIndex, resolveRef, makeRef, parseRef, isValidIdentifier } from './graph/index.js';
export type { CoordinatoriumState, Mission, MissionStatus, MissionResult, CoordinatoriumErrorCode, StartMissionInput, FinishMissionInput, StateWriteTarget, StateReadTarget, } from './coordinatorium/index.js';
export { createInitialState, CoordinatoriumError, StateCorruptedError, StateSchemaError, LockTimeoutError, MissionNotFoundError, InvalidTransitionError, ValidationError, readState, mutateState, projectTarget, trustedDirectoryTarget, startMission, listMissions, getMission, finishMission, } from './coordinatorium/index.js';
export { SafeWriteError } from './root/index.js';
export type { WriteErrorCode, WriteWarning, WriteWarningCode, PublicationState } from './root/index.js';
export * as durable from './durable/index.js';
//# sourceMappingURL=index.d.ts.map