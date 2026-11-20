/**
 * `parseStoryIndex(text, roadmapPhaseIds)` — structured extraction of the stories
 * declared in `story-index.md` and of their Phase → Story containment (CORE-GRAPH-002).
 *
 * Contract:
 *  - Pure, deterministic, synchronous. No I/O, no Git, no network, no LLM, no writes.
 *  - Same conventions as `parseRoadmapPhases`: fenced code and HTML comments are
 *    never read (`maskNonContent`), CRLF is normalized, statuses are REPORTED,
 *    diagnostics are fixed codes (no document text, no paths).
 *  - Phase → Story is structural nesting under `## Phase <id>` (D1), confirmed only by
 *    strict equality of the id token with a Roadmap phase id (D2). No fuzzy matching,
 *    no title matching, no inference from order, no correction of ids.
 *  - Story → Story relationships do not exist here (D5). Duplicate story ids are never
 *    resolved by first-wins: every entry stays and is flagged (`STORY_ID_DUPLICATE`).
 *
 * Recognised shape:
 *
 *   ## Phase <id> — <title>
 *   ### <STORY ID> — <title>        (`STORY 1.1`, `CONTEXT-001A`, `UI-006`, ...)
 *   **Date:** <value>
 *   **Status:** <value>
 *   ...free body (ignored)
 *
 * `roadmapPhaseIds === null` means the Roadmap could not supply phase ids: nesting is
 * then reported as `unverified`, never as matched or unmatched.
 * `roadmapIdsComplete === false` (Roadmap state `partial`) means the id list may be
 * missing phases: an exact match is still `matched`, but an absent id is `unverified`,
 * never `unmatched` (absence cannot be established from incomplete data).
 */

import { maskNonContent } from '../brief/markdown-context.js';
import { RECOGNIZED_STATUSES } from './roadmap.js';
import type {
  StoryIndexDiagnosticCode,
  StoryIndexDiagnosticView,
  StoryIndexItemView,
  StoryPhaseRef,
  StructuredStoryIndexView,
} from './types.js';

/** Parser capacity: a resource guard, not a product limit. Hitting it yields `partial` + `STORIES_TRUNCATED`. */
export const MAX_INDEX_STORIES = 10000;
const MAX_TITLE_CHARS = 200;
const MAX_STATUS_CHARS = 80;
const MAX_DATE_CHARS = 40;
const MAX_TOKEN_CHARS = 64;

const STORY_ID = String.raw`(?:STORY\s+\d+(?:\.\d+)*[A-Za-z]?|[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)+)`;
const STORY_HEADING_RE = new RegExp(String.raw`^###\s+(${STORY_ID})(?:\s+[—–-]\s+(.*?))?\s*$`);
const PHASE_HEADING_RE = /^##\s+Phase\s+(\S+?)(?:\s+[—–-]\s+(.*?))?\s*$/;
const LOOSE_PHASE_HEADING_RE = /^##\s+Phase\b/i;
const STATUS_RE = /^\*\*Status:\*\*[ \t]*(.*?)\s*$/;
const DATE_RE = /^\*\*Date:\*\*[ \t]*(.*?)\s*$/;
const PHASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;

function normalize(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}
function cap(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** The canonical top-level section of the index (`# Stories`, as in the project template). */
const STORIES_SECTION_RE = /^#{1,2}[ \t]+Stories[ \t]*$/i;

type Scope = { kind: 'outside' } | { kind: 'phase'; token: string } | { kind: 'malformed'; token: string };

interface Draft {
  id: string;
  title: string | null;
  scope: Scope;
  start: number;
  end: number;
}

export function parseStoryIndex(
  text: string,
  roadmapPhaseIds: readonly string[] | null,
  roadmapIdsComplete = true,
): StructuredStoryIndexView {
  const diagnostics: StoryIndexDiagnosticView[] = [];
  const diag = (code: StoryIndexDiagnosticCode, severity: 'info' | 'warn', storyIndex: number | null = null): void => {
    diagnostics.push({ code, severity, storyIndex });
  };

  if (text.trim() === '') {
    return { state: 'empty', stories: [], diagnostics: [{ code: 'DOCUMENT_EMPTY', severity: 'warn', storyIndex: null }] };
  }

  const original = text.replace(/\r\n?/g, '\n').split('\n');
  const masked = maskNonContent(original.join('\n')).split('\n');

  const drafts: Draft[] = [];
  let scope: Scope = { kind: 'outside' };
  let current: Draft | null = null;
  let malformedStories = 0;
  let malformedPhases = 0;
  let phaseSections = 0;

  for (let i = 0; i < masked.length; i++) {
    const line = masked[i];
    if (!/^#{1,3}\s/.test(line)) continue;
    if (current !== null) {
      current.end = i;
      current = null;
    }
    if (/^#{1,2}\s/.test(line)) {
      // Any level-1/2 heading closes the previous phase section.
      scope = { kind: 'outside' };
      if (LOOSE_PHASE_HEADING_RE.test(line)) {
        phaseSections++;
        const m = PHASE_HEADING_RE.exec(line);
        if (m !== null && PHASE_ID_RE.test(m[1])) {
          scope = { kind: 'phase', token: m[1] };
        } else {
          malformedPhases++;
          scope = { kind: 'malformed', token: cap(normalize(line.replace(/^##\s+Phase\b/i, '')), MAX_TOKEN_CHARS) };
        }
      }
      continue;
    }
    // level 3
    const m = STORY_HEADING_RE.exec(line);
    if (m === null) {
      malformedStories++;
      continue;
    }
    if (drafts.length >= MAX_INDEX_STORIES) {
      if (!diagnostics.some((d) => d.code === 'STORIES_TRUNCATED')) diag('STORIES_TRUNCATED', 'warn');
      continue;
    }
    current = {
      id: normalize(m[1]),
      title: m[2] !== undefined && m[2] !== '' ? cap(m[2], MAX_TITLE_CHARS) : null,
      scope,
      start: i + 1,
      end: masked.length,
    };
    drafts.push(current);
  }
  if (malformedStories > 0) diag('STORY_HEADING_MALFORMED', 'warn');
  if (malformedPhases > 0) diag('PHASE_HEADING_MALFORMED', 'warn');

  // --- duplicate ids: every entry stays, none is unique ---
  const idCount = new Map<string, number>();
  for (const d of drafts) idCount.set(d.id, (idCount.get(d.id) ?? 0) + 1);

  const phaseCount = new Map<string, number>();
  for (const id of roadmapPhaseIds ?? []) phaseCount.set(id, (phaseCount.get(id) ?? 0) + 1);

  const stories: StoryIndexItemView[] = drafts.map((d, index) => {
    let statusRaw: string | null = null;
    let statusConflict = false;
    let statusEmpty = false;
    let date: string | null = null;
    for (let i = d.start; i < d.end; i++) {
      const s = STATUS_RE.exec(masked[i]);
      if (s !== null) {
        if (s[1] === '') statusEmpty = true;
        else if (statusRaw === null) statusRaw = s[1];
        else if (normalize(statusRaw).toUpperCase() !== normalize(s[1]).toUpperCase()) statusConflict = true;
        continue;
      }
      const dt = DATE_RE.exec(masked[i]);
      if (dt !== null && date === null && dt[1] !== '') date = cap(normalize(dt[1]), MAX_DATE_CHARS);
    }

    let value: string | null = null;
    let recognized = false;
    if (statusConflict) {
      diag('STORY_STATUS_CONFLICT', 'warn', index);
    } else if (statusRaw !== null) {
      value = cap(normalize(statusRaw), MAX_STATUS_CHARS);
      recognized = RECOGNIZED_STATUSES.has(value.toUpperCase());
      if (!recognized) diag('STORY_STATUS_UNRECOGNIZED', 'warn', index);
    } else if (statusEmpty) {
      diag('STORY_STATUS_EMPTY', 'warn', index);
    } else {
      diag('STORY_STATUS_MISSING', 'warn', index);
    }

    let phase: StoryPhaseRef;
    if (d.scope.kind === 'outside') {
      phase = { kind: 'outside' };
      diag('STORY_OUTSIDE_PHASE', 'warn', index);
    } else if (d.scope.kind === 'malformed') {
      phase = { kind: 'unmatched', token: d.scope.token };
      diag('STORY_PHASE_UNMATCHED', 'warn', index);
    } else if (roadmapPhaseIds === null) {
      phase = { kind: 'unverified', token: d.scope.token };
      diag('STORY_PHASE_UNVERIFIED', 'warn', index);
    } else {
      const n = phaseCount.get(d.scope.token) ?? 0;
      if (n === 1) phase = { kind: 'matched', phaseId: d.scope.token, token: d.scope.token };
      else if (n === 0 && !roadmapIdsComplete) {
        // The Roadmap is partial: absence of the phase cannot be established.
        phase = { kind: 'unverified', token: d.scope.token };
        diag('STORY_PHASE_UNVERIFIED', 'warn', index);
      } else if (n === 0) {
        phase = { kind: 'unmatched', token: d.scope.token };
        diag('STORY_PHASE_UNMATCHED', 'warn', index);
      } else {
        phase = { kind: 'ambiguous', token: d.scope.token };
        diag('STORY_PHASE_AMBIGUOUS', 'warn', index);
      }
    }

    const duplicate = (idCount.get(d.id) ?? 0) > 1;
    if (duplicate) diag('STORY_ID_DUPLICATE', 'warn', index);
    return {
      id: d.id,
      idStatus: duplicate ? 'duplicate' : 'unique',
      title: d.title,
      status: { value, recognized, provenance: 'REPORTED' },
      date,
      phase,
    };
  });

  let state: StructuredStoryIndexView['state'];
  if (stories.length === 0) {
    const canonicalEmpty =
      phaseSections === 0 && malformedStories === 0 && malformedPhases === 0 && masked.some((l) => STORIES_SECTION_RE.test(l));
    if (canonicalEmpty) {
      // The canonical shape with nothing finalized yet. Valid; no entry is invented.
      diag('NO_FINALIZED_STORIES', 'info');
      return { state: 'none_finalized', stories, diagnostics };
    }
    if (phaseSections > 0) {
      state = 'no_stories';
    } else {
      state = malformedStories > 0 ? 'partial' : 'unrecognized';
    }
    diag('STORIES_NOT_FOUND', 'warn');
  } else if (malformedStories > 0 || malformedPhases > 0 || diagnostics.some((d) => d.code === 'STORIES_TRUNCATED')) {
    state = 'partial';
  } else {
    state = 'ok';
  }
  return { state, stories, diagnostics };
}
