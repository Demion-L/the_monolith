/**
 * Project State Freshness (SELF-AWARENESS-001).
 *
 * `Completeness` says whether the brief lost data while being rendered.
 * `Freshness` says whether the recorded project state can still be trusted.
 * They are independent: `Completeness: COMPLETE` + `Freshness: STALE` is a
 * valid combination, and nothing here ever changes `Completeness`.
 *
 * `evaluateFreshness()` is pure: it takes already-gathered evidence and
 * returns a verdict. Git is a signal, never the only source of truth:
 *
 *   STALE    only on a concrete, named discrepancy — either the state
 *            documents contradict each other, or git history references
 *            work items that no state document mentions.
 *   FRESH    only on positive evidence — git is readable, the last state
 *            update is located, and every commit after it either touches
 *            only the state documents or belongs to a recorded work item.
 *   UNKNOWN  everything else. Git activity alone, an old date alone, or the
 *            absence of an active story alone never produce STALE, and the
 *            absence of an active story never means "project complete".
 */
import { isIdeaId } from '../ideas/format.js';
import { maskNonContent } from './markdown-context.js';
// ---------------------------------------------------------------------------
// Work-item ids
// ---------------------------------------------------------------------------
/**
 * Work-item id: an upper-case, dash-separated prefix, a number, then optional
 * sub-story qualifiers — UI-002D, SEC-001B.1-R, LOCK-RELEASE-001, CONTEXT-001A.
 * Deliberately narrow: an id that is not matched is simply not evidence.
 */
const WORK_ITEM_SOURCE = String.raw `(?:[A-Z]{2,}-)+\d{3}[A-Z]?(?:\.\d+)*(?:-[A-Z])?`;
/** Decision / lesson records are not work items. */
const NON_WORK_PREFIXES = ['ADR-', 'DEC-', 'LESSON-'];
/**
 * Ideas live in their own namespace (`IDEA-NNN`, src/ideas/format.ts) and are
 * stored in the idea store, not in the state documents. Only the exact idea
 * grammar is excluded: `IDEA-001A`, `IDEA-001B.1` or `IDEA-003-R` are story
 * ids that merely share the prefix and stay work items.
 */
function isWorkItem(id) {
    return !NON_WORK_PREFIXES.some((p) => id.startsWith(p)) && !isIdeaId(id);
}
export function extractWorkItemIds(text) {
    const re = new RegExp(`(?<![A-Za-z0-9-])${WORK_ITEM_SOURCE}(?![A-Za-z0-9]|\\.\\d|-[A-Z0-9])`, 'g');
    const seen = new Set();
    for (const m of text.matchAll(re)) {
        if (isWorkItem(m[0]))
            seen.add(m[0]);
    }
    return [...seen];
}
export function mentionsId(text, id) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9]|\\.\\d|-[A-Z0-9])`).test(text);
}
// `maskNonContent` lives in ./markdown-context.ts (shared with story extraction
// and DOCSYNC) and is re-exported here for existing importers.
export { maskNonContent };
// ---------------------------------------------------------------------------
// Parsers for the state documents (confirmed structure only)
// ---------------------------------------------------------------------------
const NONE_RE = /^\W*(?:no active story|none|unknown)\b|^\s*[—-]\s*$/i;
/** Same id grammar as DOCSYNC's `activeStoryIdentity()`. */
const STORY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/**
 * Interprets the `## Current Story` excerpt of active.md.
 *
 * Identity comes from the structural `**Story:** <id> …` field only (first
 * token = id), exactly as DOCSYNC reads it. Ids in titles, prose, code fences
 * or comments are never identity. Zero usable, several or malformed fields →
 * `unknown` (never a guess, never STALE on its own).
 *
 * Compatibility: a historical section with no `**Story:**` field at all is
 * still read when its first line is a *bold declaration* of exactly one
 * work-item id — `**WIDGET-001 — title**`, `**WIDGET-001**` or
 * `**WIDGET-001** — status` (the form old active.md files used). An unbolded
 * line (`STORY-001 was completed yesterday.`, `STORY-001 — done`) is
 * indistinguishable from a sentence that merely mentions a story, so it is
 * `unknown`, never a confirmed identity.
 */
export function parseActiveStoryClaim(excerpt) {
    if (excerpt === null)
        return { kind: 'unknown' };
    const masked = maskNonContent(excerpt);
    const firstLine = masked.split('\n').find((l) => l.trim() !== '') ?? '';
    if (/^\W*no active story\b/i.test(firstLine))
        return { kind: 'none' };
    const fields = masked
        .split('\n')
        .map((l) => /^\*\*Story:\*\*[ \t]*(.*)$/.exec(l.replace(/\r$/, '')))
        .filter((m) => m !== null)
        .map((m) => m[1].trim());
    if (fields.length > 0) {
        if (fields.length > 1)
            return { kind: 'unknown' };
        const id = /^(\S+)(?:\s|$)/.exec(fields[0])?.[1];
        return id !== undefined && STORY_ID_RE.test(id) ? { kind: 'ids', ids: [id] } : { kind: 'unknown' };
    }
    const line = firstLine.trim();
    const idEnd = String.raw `(?![A-Za-z0-9]|\.\d|-[A-Z0-9])`;
    const declaration = new RegExp(`^\\*\\*(${WORK_ITEM_SOURCE})${idEnd}\\*\\*(?:\\s+[—–-](?:\\s.*)?)?$`).exec(line) ??
        new RegExp(`^\\*\\*(${WORK_ITEM_SOURCE})${idEnd}\\s+[—–-]\\s.*\\*\\*$`).exec(line);
    return declaration !== null && extractWorkItemIds(line).length === 1 ? { kind: 'ids', ids: [declaration[1]] } : { kind: 'unknown' };
}
/** `Active Story: <text>` line of roadmap-index.md (outside code fences and comments). */
export function parseRoadmapActiveStory(content) {
    const m = /^Active Story:\s*(.+?)\s*$/m.exec(maskNonContent(content));
    return m ? m[1] : null;
}
/** Table rows `| id | title | STATUS | date |` of roadmap-index.md (outside code fences and comments). */
export function parseRoadmapStatuses(content) {
    const out = new Map();
    for (const line of maskNonContent(content).split('\n')) {
        const cells = line.split('|').map((c) => c.trim());
        // leading and trailing '|' produce empty first/last cells
        if (cells.length < 5 || cells[0] !== '' || cells[cells.length - 1] !== '')
            continue;
        const id = cells[1];
        const status = cells[3];
        if (!/^[A-Za-z0-9][A-Za-z0-9.\-]*$/.test(id) || !/^[A-Z][A-Z _]+$/.test(status))
            continue;
        if (!out.has(id))
            out.set(id, status);
    }
    return out;
}
/** `### [STORY ]<id> — title` followed by `**Status:** X` in story-index.md (outside code fences and comments). */
export function parseStoryIndexStatuses(content) {
    const out = new Map();
    const lines = maskNonContent(content).split('\n');
    for (let i = 0; i < lines.length; i++) {
        const h = /^###\s+(?:STORY\s+)?([A-Za-z0-9][A-Za-z0-9.\-]*)\s+—/.exec(lines[i]);
        if (!h)
            continue;
        for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
            if (/^#{1,3}\s/.test(lines[j]))
                break;
            const s = /^\*\*Status:\*\*\s*([A-Z][A-Z _]*)/.exec(lines[j]);
            if (s) {
                if (!out.has(h[1]))
                    out.set(h[1], s[1].trim());
                break;
            }
        }
    }
    return out;
}
// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------
const MAX_LISTED = 5;
function listIds(ids) {
    if (ids.length <= MAX_LISTED)
        return ids.join(', ');
    return `${ids.slice(0, MAX_LISTED).join(', ')} and ${ids.length - MAX_LISTED} more`;
}
function isDone(status) {
    return status === 'COMPLETED' || status === 'DONE';
}
function findContradictions(ev) {
    const out = [];
    if (ev.activeStory.kind === 'none' && ev.roadmapActiveStory !== null && !NONE_RE.test(ev.roadmapActiveStory)) {
        out.push({
            message: `active.md records no active story, but roadmap-index.md names "${ev.roadmapActiveStory}".`,
            documents: ['active.md', 'roadmap-index.md'],
        });
    }
    if (ev.activeStory.kind === 'ids') {
        for (const id of ev.activeStory.ids) {
            if (isDone(ev.roadmapStatuses.get(id))) {
                out.push({
                    message: `active.md treats ${id} as current, but roadmap-index.md marks it ${ev.roadmapStatuses.get(id)}.`,
                    documents: ['active.md', 'roadmap-index.md'],
                });
            }
            else if (isDone(ev.storyIndexStatuses.get(id))) {
                out.push({
                    message: `active.md treats ${id} as current, but story-index.md marks it ${ev.storyIndexStatuses.get(id)}.`,
                    documents: ['active.md', 'story-index.md'],
                });
            }
        }
    }
    for (const [id, roadmapStatus] of ev.roadmapStatuses) {
        const indexStatus = ev.storyIndexStatuses.get(id);
        if (indexStatus !== undefined && indexStatus !== roadmapStatus) {
            out.push({
                message: `${id} is ${roadmapStatus} in roadmap-index.md but ${indexStatus} in story-index.md.`,
                documents: ['roadmap-index.md', 'story-index.md'],
            });
        }
    }
    return out;
}
const REVIEW_RECOMMENDATION = 'Review project state before relying on this brief.';
export function evaluateFreshness(ev) {
    const reasons = [];
    const warnings = [];
    const base = {
        activeStory: ev.activeStory.kind === 'none' ? 'none-recorded' : ev.activeStory.kind === 'ids' ? 'recorded' : 'unknown',
        lastStateUpdate: ev.git.status === 'ok' ? ev.git.lastStateUpdate : null,
        activityCount: null,
        unrecordedWork: [],
    };
    // 1. Internal contradictions need no git at all.
    const contradictions = findContradictions(ev);
    for (const c of contradictions)
        reasons.push({ code: 'STATE_CONTRADICTION', message: c.message, documents: c.documents });
    // 2. Git-derived signals.
    let gitVerdict = null;
    if (ev.git.status === 'unavailable') {
        const why = {
            GIT_NOT_INSTALLED: 'git is not installed or not runnable',
            NOT_A_GIT_REPOSITORY: 'the project is not inside a git repository',
            GIT_FAILED: 'git could not be queried',
        };
        reasons.push({ code: 'GIT_UNAVAILABLE', message: `Cannot compare state with history: ${why[ev.git.reason]}.` });
        gitVerdict = 'unknown';
    }
    else if (ev.git.lastStateUpdate === null) {
        reasons.push({
            code: 'STATE_NOT_IN_GIT',
            message: 'No commit touches the state documents, so the last state update cannot be located.',
        });
        gitVerdict = 'unknown';
    }
    else {
        const activity = ev.git.commitsSince.filter((c) => c.files.some((f) => !ev.stateFiles.has(f)));
        base.activityCount = activity.length;
        const referenced = new Set();
        let unattributed = 0;
        for (const c of activity) {
            const ids = extractWorkItemIds(c.subject);
            if (ids.length === 0)
                unattributed++;
            for (const id of ids)
                referenced.add(id);
        }
        const unrecorded = [...referenced].filter((id) => !mentionsId(ev.recordedText, id)).sort();
        base.unrecordedWork = unrecorded;
        if (unrecorded.length > 0) {
            reasons.push({
                code: 'UNRECORDED_WORK',
                message: `${activity.length} commit(s) after the last state update (${ev.git.lastStateUpdate.sha.slice(0, 7)}, ${ev.git.lastStateUpdate.date.slice(0, 10)}) ` +
                    `reference ${unrecorded.length} work item(s) that no state document mentions: ${listIds(unrecorded)}.`,
            });
            gitVerdict = 'stale';
        }
        else if (ev.git.truncated) {
            reasons.push({
                code: 'GIT_HISTORY_TRUNCATED',
                message: 'Git history after the last state update was cut at the read limit; the check is partial.',
            });
            gitVerdict = 'unknown';
        }
        else if (unattributed > 0) {
            reasons.push({
                code: 'UNATTRIBUTED_ACTIVITY',
                message: `${unattributed} commit(s) after the last state update touch project files without naming a work item; ` +
                    `whether the recorded state still describes them cannot be determined.`,
            });
            gitVerdict = 'unknown';
        }
        else if (activity.length === 0) {
            reasons.push({
                code: 'NO_ACTIVITY_SINCE_STATE_UPDATE',
                message: 'No commit after the last state update changed anything beyond the state documents.',
            });
            gitVerdict = 'fresh';
        }
        else {
            reasons.push({
                code: 'ACTIVITY_RECORDED',
                message: `All ${activity.length} commit(s) after the last state update reference work items that the state documents mention.`,
            });
            gitVerdict = 'fresh';
        }
        if (activity.length > 0 && ev.activeStory.kind === 'none') {
            warnings.push('Git activity exists after the last recorded state update, but no active story is recorded.');
        }
    }
    // 3. Combine. A contradiction or unrecorded work is concrete evidence of staleness;
    //    FRESH needs positive evidence and no contradiction.
    let status;
    if (contradictions.length > 0 || gitVerdict === 'stale')
        status = 'STALE';
    else if (gitVerdict === 'fresh')
        status = 'FRESH';
    else
        status = 'UNKNOWN';
    if (status !== 'FRESH') {
        if (status === 'STALE')
            warnings.unshift('Project state may be outdated.');
        else
            warnings.unshift('Freshness could not be established from the available evidence.');
        if (ev.activeStory.kind === 'none') {
            warnings.push('No active story is recorded; this does not mean the project is complete.');
        }
        else if (ev.activeStory.kind === 'unknown') {
            warnings.push('The active story could not be determined from active.md.');
        }
    }
    const recommendation = status === 'FRESH' ? 'No action needed.' : status === 'STALE' ? REVIEW_RECOMMENDATION : `${REVIEW_RECOMMENDATION} Freshness is unverified, not confirmed outdated.`;
    return { status, reasons, warnings, recommendation, ...base };
}
