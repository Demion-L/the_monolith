/**
 * Typed Read Model for Mission Control (UI-001B.1, ADR-010).
 *
 * A pure, read-only projection of data MONOLITH Core already owns. It adds no
 * persistent schema and no source of truth: every field is copied from, or
 * counted over, an existing artifact (`monolith.config.json`, `state.json`,
 * `active.md`, `roadmap-index.md`).
 *
 * Errors are DATA, not text: only fixed enum codes and project-relative paths
 * cross this boundary. No absolute path, no exception message and no file
 * excerpt other than the explicit content fields below ever appears in a
 * diagnostic, so the DTO is safe to serialize over HTTP later (G2 still gates
 * that).
 */
export {};
