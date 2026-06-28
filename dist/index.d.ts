/**
 * @monolith/core — Public API surface
 *
 * This file is the package entrypoint. Exports grow here as Kernel modules
 * are extracted from the instance (.devin/) into this package.
 *
 * Current state: Phase 6 — validate implemented; Scriptorium (Story 1.2) and
 * Explicit Relationship Graph (Story 1.3) integrated.
 * See Phase 7+ roadmap for Kernel extraction.
 */
export type { ProjectDefinition } from './types/project-definition.js';
export type { GateCheckResult } from './types/enforcement.js';
export type { VerificationContext, VerificationReport } from './types/integrity.js';
export type { ProjectConfig, InitOptions } from './init/types.js';
export { MONOLITH_VERSION } from './version.js';
export { runInit } from './init/index.js';
export type { Artifact, Concept, SemanticLink, SemanticRelationshipType, KnowledgeRegion, MentalModel, WebwayAnalysisResult, } from './webway/index.js';
export { analyzeArtifact } from './webway/index.js';
export type { ScriptoriumInput, ScriptoriumResult, ConceptCandidate, RelationshipCandidate, Evidence, SourceReference, ScriptoriumDiagnostic, ConceptSource, EvidenceSource, HeadingLevel, } from './scriptorium/index.js';
export { compileMarkdownArtifact, isStructuralHeadingNoise } from './scriptorium/index.js';
export type { GraphNode, GraphEdge, GraphDiagnostic, ExplicitRelationshipGraph, } from './graph/index.js';
export { buildGraph, normalizeLabel, selectCanonicalLabel } from './graph/index.js';
//# sourceMappingURL=index.d.ts.map