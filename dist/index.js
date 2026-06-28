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
export { MONOLITH_VERSION } from './version.js';
export { runInit } from './init/index.js';
export { analyzeArtifact } from './webway/index.js';
export { compileMarkdownArtifact, isStructuralHeadingNoise } from './scriptorium/index.js';
export { buildGraph, normalizeLabel, selectCanonicalLabel } from './graph/index.js';
