/**
 * `readDashboardModel(projectRoot)` — builds the DashboardReadModel.
 *
 * Contract:
 *  - `projectRoot` is supplied by the embedding process (fixed at startup),
 *    never by a request. The set of files read is closed (see SourceId).
 *  - Strictly read-only and synchronous: no write, no lock, no `mutateState`,
 *    no `validate`, no `import()` of project code, no network. Nothing is
 *    cached; every call re-reads.
 *  - Never throws. Failures become SourceReport / ReadNote data.
 *  - Deterministic: same files ⇒ deep-equal result; no timestamps.
 *
 * Containment (G1): the instance root is resolved with `resolveMonolithRoot`
 * (ADR-009) and every file is read with `readProjectFile`, which realpath-checks
 * each path component against the real project root and then performs the
 * bounded, non-blocking read of SEC-001B.1. `readState` is deliberately NOT
 * used: it does not check containment. Check-then-use races are NOT closed by
 * Core (SEC-001B) and are therefore not closed here.
 *
 * Every source goes through `readProjectFile` (ADR-014): no symlink in any
 * component, one hard link, regular file, absolute boundary, never the cwd.
 * This module adds no filesystem checks of its own; it only interprets Core's
 * typed result (`FILE_CODE_MAP`). Threat model (ADR-013): TM-A supported with
 * limitations, TM-B partially supported, TM-C (concurrent mutation) NOT supported.
 */
import type { DashboardReadModel } from './types.js';
export declare const ROADMAP_REL = "context/maps/roadmap-index.md";
/** Protective ceiling, like the other SEC-001B.1 limits — not a content policy. */
export declare const MAX_ROADMAP_BYTES: number;
export declare const STORY_INDEX_REL = "memory/working/story-index.md";
/** Protective ceiling, like the other SEC-001B.1 limits — not a content policy. */
export declare const MAX_STORY_INDEX_BYTES: number;
export { FILE_CODE_MAP } from './source-failure.js';
export declare function readDashboardModel(projectRoot: string): DashboardReadModel;
//# sourceMappingURL=dashboard.d.ts.map