/**
 * Story authority context for Mission → Story links (ACCOUNTABILITY-001, Phase 1).
 *
 * Reads the same three documents the Mission Control read model reads (`active.md`, `roadmap-index.md`,
 * `story-index.md`) through the same bounded reader, and hands them to the existing Story State Resolver.
 * No second parser. A document that cannot be read leaves its fact UNKNOWN; absence is never inferred.
 */

import { ACTIVE_MD_REL } from '../brief/constants.js';
import { readProjectFile } from '../root/index.js';
import { MAX_ROADMAP_BYTES, MAX_STORY_INDEX_BYTES, ROADMAP_REL, STORY_INDEX_REL } from './dashboard.js';
import { buildStoryAuthorityContext, type StoryAuthorityContext } from './story-state.js';

const MAX_ACTIVE_BYTES = 256 * 1024;

function readText(projectRoot: string, rel: string, maxBytes: number): string | null {
  try {
    const r = readProjectFile(projectRoot, rel, { maxBytes, allowEmpty: true });
    return r.ok ? r.content : null;
  } catch {
    return null;
  }
}

/** `null` only if the resolver itself failed; unreadable documents are carried as UNKNOWN facts inside the context. */
export function loadStoryAuthority(projectRoot: string, monolithRoot: string): StoryAuthorityContext | null {
  try {
    return buildStoryAuthorityContext({
      active: readText(projectRoot, `${monolithRoot}/${ACTIVE_MD_REL}`, MAX_ACTIVE_BYTES),
      roadmap: readText(projectRoot, `${monolithRoot}/${ROADMAP_REL}`, MAX_ROADMAP_BYTES),
      storyIndex: readText(projectRoot, `${monolithRoot}/${STORY_INDEX_REL}`, MAX_STORY_INDEX_BYTES),
    });
  } catch {
    return null;
  }
}
