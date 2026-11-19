/**
 * Narrow presentation adapter for the `## Current Story` excerpt of `active.md` (UI-009B).
 *
 * NOT a Markdown parser. It recognises exactly one shape, a whole line of the form `**<Label>:** <value>`, and only
 * for a fixed list of labels. Everything else is ignored and stays available in the verbatim source text.
 * Values are plain strings for text interpolation (never HTML). They are what the document says, not facts Core
 * confirmed: Core confirms only the story id. In particular `status` is shown as written and is never interpreted as
 * a lifecycle state.
 */
import { stripDecorativeMarkers } from './knowledge';

export interface StoryFields {
  title: string | null;
  objective: string | null;
  status: string | null;
  milestone: string | null;
  branch: string | null;
}

const LABELS: Record<string, keyof StoryFields> = {
  title: 'title',
  goal: 'objective',
  status: 'status',
  'current milestone': 'milestone',
  branch: 'branch',
};

const LINE = /^\*\*([A-Za-z][A-Za-z ]{0,30}):\*\*[ \t]+(\S.*)$/;
const MAX_VALUE = 300;

function clean(raw: string): string | null {
  // One level of decorative backticks around the whole value (`feat/x`); inner text is left untouched.
  const v = stripDecorativeMarkers(raw.trim()).trim();
  if (v === '') return null;
  return v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE).trimEnd()}…` : v;
}

/** Returns the known fields found in `excerpt`, or `null` when none is found (unknown format → caller shows a fallback). */
export function extractStoryFields(excerpt: string | null): StoryFields | null {
  if (excerpt === null) return null;
  const out: StoryFields = { title: null, objective: null, status: null, milestone: null, branch: null };
  let found = false;
  for (const line of excerpt.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m === null) continue;
    const key = LABELS[m[1].trim().toLowerCase()];
    if (key === undefined || out[key] !== null) continue; // unknown label, or a repeated one: the first wins
    const v = clean(m[2]);
    if (v === null) continue;
    out[key] = v;
    found = true;
  }
  return found ? out : null;
}
