/**
 * Story authority context for Mission → Story links (ACCOUNTABILITY-001, Phase 1).
 *
 * Reads the same three documents the Mission Control read model reads (`active.md`, `roadmap-index.md`,
 * `story-index.md`) through the same bounded reader, and hands them to the existing Story State Resolver.
 * No second parser. A document that cannot be read leaves its fact UNKNOWN; absence is never inferred.
 */
import { type StoryAuthorityContext } from './story-state.js';
/** `null` only if the resolver itself failed; unreadable documents are carried as UNKNOWN facts inside the context. */
export declare function loadStoryAuthority(projectRoot: string, monolithRoot: string): StoryAuthorityContext | null;
//# sourceMappingURL=story-links.d.ts.map