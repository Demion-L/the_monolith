/**
 * Ideas for Mission Control's Knowledge Lab (GOV-EVOLUTION Phase 4).
 *
 * Read-only view over the EXISTING idea store (`src/ideas/`, one Markdown file per idea in
 * `<monolithRoot>/memory/long-term/ideas/`). It reuses the store's safe reader and parser: no
 * second parser, no second storage, nothing written, `.ids/` reservation markers never touched.
 * Idea text is user data: it is carried as plain text and never interpreted or executed.
 *
 * A file that cannot be read as an idea is reported as an issue (fixed code + id), never
 * silently dropped, so the list can say it is not exhaustive. No free-form reader message and
 * no absolute path crosses this boundary.
 */

import { lstatSync } from 'fs';
import { IdeaError, ideaStore, listIdeas } from '../ideas/index.js';
import type { IdeaStatus } from '../ideas/index.js';
import type { IdeasData, IdeaView, Section, SourceReport } from './types.js';

export const IDEAS_REL = 'memory/long-term/ideas';
export const MAX_IDEAS = 200;
export const MAX_IDEA_DESCRIPTION_CHARS = 8000;
const MAX_CONTEXT_CHARS = 2000;
const MAX_TAGS = 20;
const MAX_TAG_CHARS = 60;

function report(path: string | null, status: SourceReport['status'], code: SourceReport['code']): SourceReport {
  return { id: 'ideas', path, status, code };
}

function cap(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function readIdeas(projectRoot: string, monolithRoot: string): Section<IdeasData> {
  const rel = `${monolithRoot}/${IDEAS_REL}`;
  try {
    const store = ideaStore(projectRoot);
    try {
      lstatSync(store.dirAbs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { data: null, sources: [report(rel, 'absent', 'SOURCE_ABSENT')] };
      return { data: null, sources: [report(rel, 'unreadable', 'SOURCE_UNREADABLE')] };
    }
    const entries = listIdeas(store);
    const items: IdeaView[] = [];
    const issues: IdeasData['issues'] = [];
    let truncated = false;
    for (const e of entries) {
      if (!e.ok) {
        issues.push({ id: e.id, code: e.code });
        continue;
      }
      if (items.length >= MAX_IDEAS) {
        truncated = true;
        continue;
      }
      const i = e.idea;
      items.push({
        id: i.id,
        title: i.title,
        status: i.status as IdeaStatus,
        createdAt: i.createdAt,
        description: cap(i.description, MAX_IDEA_DESCRIPTION_CHARS),
        descriptionTruncated: i.description.length > MAX_IDEA_DESCRIPTION_CHARS,
        context: i.context === undefined ? null : cap(i.context, MAX_CONTEXT_CHARS),
        tags: (i.tags ?? []).slice(0, MAX_TAGS).map((t) => cap(t, MAX_TAG_CHARS)),
        paths: [...(i.paths ?? [])],
        path: `${rel}/${i.id}.md`,
      });
    }
    return {
      data: { items, issues, truncated, complete: issues.length === 0 && !truncated },
      sources: [report(rel, 'available', null)],
    };
  } catch (err) {
    if (err instanceof IdeaError && err.code === 'IDEA_UNSAFE_PATH') return { data: null, sources: [report(rel, 'forbidden', 'SOURCE_SYMLINK')] };
    return { data: null, sources: [report(rel, 'unreadable', 'INTERNAL')] };
  }
}
