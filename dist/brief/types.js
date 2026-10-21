/**
 * MONOLITH Context Gateway — `monolith brief` (CONTEXT-001A).
 *
 * BriefModel is the thin, read-only data layer produced by `collect()`.
 * It is deliberately NOT a new source of truth: every field is either a
 * direct, narrow projection of an existing artifact (state.json, active.md,
 * a protocol's/ADR's frontmatter) or a diagnostic about that artifact's
 * readability. `render()` turns a BriefModel into bounded, deterministic
 * text — it never re-derives data collect() didn't already produce.
 */
export {};
