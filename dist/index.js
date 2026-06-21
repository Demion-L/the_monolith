/**
 * @monolith/core — Public API surface
 *
 * This file is the package entrypoint. Exports grow here as Kernel modules
 * are extracted from the instance (.devin/) into this package.
 *
 * Current state: Phase 5 — init command implemented, types defined.
 * See Phase 6+ roadmap for validate/status/dry-run extraction.
 */
export { MONOLITH_VERSION } from './version.js';
export { runInit } from './init/index.js';
