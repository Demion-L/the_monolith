/** Shared path constants for the brief subsystem (relative to monolithRoot). */
export const ACTIVE_MD_REL = 'memory/working/active.md';
/** Canonical ADR directory, relative to the project root (not monolithRoot). Used when `contextGateway.adrDirs` is not configured. */
export const DEFAULT_ADR_DIR = 'docs/adr';
export const PROTOCOLS_DIR = 'protocols';
/** State documents whose last commit marks the "last recorded state update" (SELF-AWARENESS-001). */
export const ROADMAP_INDEX_REL = 'context/maps/roadmap-index.md';
export const STORY_INDEX_REL = 'memory/working/story-index.md';
export const HANDOFF_REL = 'context/boot/HANDOFF.md';
/** IDEA-002A: most parked ideas the brief ever lists; the rest is a "+N more" count. */
export const PARKED_IDEAS_LIMIT = 3;
