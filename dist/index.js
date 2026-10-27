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
export { MONOLITH_VERSION } from './version.js';
export { runInit } from './init/index.js';
export { compileMarkdownArtifact, isStructuralHeadingNoise } from './scriptorium/index.js';
export { buildGraph, normalizeLabel, selectCanonicalLabel } from './graph/index.js';
export { createInitialState, CoordinatoriumError, StateCorruptedError, StateSchemaError, LockTimeoutError, MissionNotFoundError, InvalidTransitionError, ValidationError, readState, mutateState, projectTarget, trustedDirectoryTarget, startMission, listMissions, getMission, finishMission, } from './coordinatorium/index.js';
// Safe writes — explicit write scope and publication states (SEC-001B.2, ADR-012)
export { SafeWriteError } from './root/index.js';
// Durable State — domain-neutral, crash-safe execution record for long-running agentic tasks (ADR-017).
// Namespaced: its error taxonomy deliberately shares names (e.g. ValidationError) with Coordinatorium's.
export * as durable from './durable/index.js';
