/**
 * `parseRoadmapPhases(text)` — structured extraction of the phases declared in
 * `roadmap-index.md` (UI-003C).
 *
 * Contract:
 *  - Pure, deterministic, synchronous. No I/O, no Git, no network, no LLM, no
 *    side effects. The input is the already bounded text read by the read model.
 *  - DOES NOT reuse `parseRoadmapStatuses()`: that parser reads STORY table rows
 *    (`| id | title | STATUS | date |`). Phase semantics come only from the
 *    `## Phases` section; tables anywhere (Completion Summary included) are never
 *    phases and never statuses.
 *  - Everything a phase reports is REPORTED: the document's own claim, never
 *    confirmed. Nothing is derived from position, story counts or absence.
 *  - The active phase is taken only from an explicit `Active Phase:` line. A
 *    missing, contradictory or unmatched pointer is reported as such, never
 *    resolved by guessing.
 *  - Diagnostics are fixed codes (no document text, no paths), safe to serialize.
 *
 * Recognised shape (both the MONOLITH roadmap and the project template):
 *
 *   ## Phases
 *   ### Phase <id> — <title>          (the title may be absent: `### Phase 2+`)
 *   **Status:** <value>
 *   **Goal:** <one line>              (optional)
 *   ...free body (tables, lists, #### sub-headings) → `details`
 *   ## Current Focus
 *   Active Phase: <id> — <title> | —     (read ONLY inside `## Current Focus`)
 */
import { maskNonContent } from '../brief/markdown-context.js';
/** Statuses the documents themselves declare (template comment + the MONOLITH roadmap). */
const RECOGNIZED_STATUSES = new Set(['PLANNED', 'IN PROGRESS', 'COMPLETE', 'COMPLETED', 'NOT DEFINED']);
export const MAX_ROADMAP_PHASES = 200;
export const MAX_PHASE_DETAILS_CHARS = 8000;
export const MAX_PHASE_GOAL_CHARS = 600;
const MAX_STATUS_CHARS = 80;
const MAX_TITLE_CHARS = 200;
const PHASE_HEADING_RE = /^###\s+Phase\s+(\S+?)(?:\s+[—–-]\s+(.*?))?\s*$/;
const LOOSE_PHASE_HEADING_RE = /^#{1,6}\s+Phase\b/i;
const STATUS_RE = /^\*\*Status:\*\*[ \t]*(.*?)\s*$/;
const GOAL_RE = /^\*\*Goal:\*\*[ \t]*(.*?)\s*$/;
const ACTIVE_RE = /^Active Phase:[ \t]*(.*?)\s*$/;
const NO_ACTIVE_RE = /^(?:[—–-]|none|no active phase)$/i;
const PHASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;
function normalizeStatus(raw) {
    return raw.replace(/\s+/g, ' ').toUpperCase();
}
function cap(s, max) {
    return s.length <= max ? s : s.slice(0, max);
}
export function parseRoadmapPhases(text) {
    const diagnostics = [];
    const diag = (code, severity, phaseIndex = null) => {
        diagnostics.push({ code, severity, phaseIndex });
    };
    if (text.trim() === '') {
        return { state: 'empty', phases: [], activePhase: { kind: 'not_declared' }, diagnostics: [{ code: 'DOCUMENT_EMPTY', severity: 'warn', phaseIndex: null }] };
    }
    const original = text.replace(/\r\n?/g, '\n').split('\n');
    const masked = maskNonContent(original.join('\n')).split('\n');
    // --- locate the `## Phases` section (first one wins; extra ones are reported) ---
    let phasesStart = -1;
    let phasesEnd = original.length;
    let phasesSections = 0;
    for (let i = 0; i < masked.length; i++) {
        if (/^##\s+Phases\s*$/.test(masked[i])) {
            phasesSections++;
            if (phasesSections === 1) {
                phasesStart = i + 1;
                // The section runs to the next level-2 heading (a second `## Phases` included).
                const next = masked.findIndex((l, j) => j > i && /^##\s/.test(l));
                phasesEnd = next === -1 ? original.length : next;
            }
        }
    }
    if (phasesSections > 1)
        diag('PHASES_SECTION_DUPLICATED', 'warn');
    const drafts = [];
    let malformedHeadings = 0;
    if (phasesStart !== -1) {
        let current = null;
        for (let i = phasesStart; i < phasesEnd; i++) {
            const line = masked[i];
            if (/^#{1,3}\s/.test(line)) {
                if (current !== null) {
                    current.end = i;
                    current = null;
                }
                const m = PHASE_HEADING_RE.exec(line);
                if (m !== null && PHASE_ID_RE.test(m[1])) {
                    current = { id: m[1], title: m[2] !== undefined && m[2] !== '' ? cap(m[2], MAX_TITLE_CHARS) : null, start: i + 1, end: phasesEnd };
                    drafts.push(current);
                }
                else if (LOOSE_PHASE_HEADING_RE.test(line)) {
                    malformedHeadings++;
                }
            }
        }
    }
    // A phase-looking heading outside the `## Phases` section is not a phase (it is not read).
    if (phasesStart === -1) {
        for (const line of masked)
            if (LOOSE_PHASE_HEADING_RE.test(line))
                malformedHeadings++;
    }
    if (malformedHeadings > 0)
        diag('PHASE_HEADING_MALFORMED', 'warn');
    const truncatedPhases = drafts.length > MAX_ROADMAP_PHASES;
    if (truncatedPhases) {
        drafts.length = MAX_ROADMAP_PHASES;
        diag('PHASES_TRUNCATED', 'warn');
    }
    // --- phases ---
    const phases = drafts.map((d, index) => {
        let statusRaw = null;
        let statusConflict = false;
        let statusEmpty = false;
        let goal = null;
        let goalTruncated = false;
        const detailLines = [];
        for (let i = d.start; i < d.end; i++) {
            const m = STATUS_RE.exec(masked[i]);
            if (m !== null) {
                if (m[1] === '')
                    statusEmpty = true;
                else if (statusRaw === null)
                    statusRaw = m[1];
                else if (normalizeStatus(statusRaw) !== normalizeStatus(m[1]))
                    statusConflict = true;
                continue;
            }
            const g = GOAL_RE.exec(masked[i]);
            if (g !== null && goal === null && g[1] !== '') {
                goal = cap(g[1], MAX_PHASE_GOAL_CHARS);
                goalTruncated = g[1].length > MAX_PHASE_GOAL_CHARS;
                continue;
            }
            detailLines.push(original[i]);
        }
        let value = null;
        let recognized = false;
        if (statusConflict) {
            diag('PHASE_STATUS_CONFLICT', 'warn', index);
        }
        else if (statusRaw !== null) {
            value = cap(statusRaw.replace(/\s+/g, ' '), MAX_STATUS_CHARS);
            recognized = RECOGNIZED_STATUSES.has(normalizeStatus(statusRaw));
            if (!recognized)
                diag('PHASE_STATUS_UNRECOGNIZED', 'warn', index);
        }
        else if (statusEmpty) {
            diag('PHASE_STATUS_EMPTY', 'warn', index);
        }
        else {
            diag('PHASE_STATUS_MISSING', 'info', index);
        }
        // Trailing horizontal rules are section separators, not phase content.
        while (detailLines.length > 0 && /^\s*(?:-{3,})?\s*$/.test(detailLines[detailLines.length - 1]))
            detailLines.pop();
        let details = detailLines.join('\n').replace(/^\n+/, '');
        if (details.length > MAX_PHASE_DETAILS_CHARS) {
            details = details.slice(0, MAX_PHASE_DETAILS_CHARS);
            diag('PHASE_DETAILS_TRUNCATED', 'info', index);
        }
        return {
            id: d.id,
            title: d.title,
            status: { value, recognized, provenance: 'REPORTED' },
            goal,
            goalTruncated,
            details: details === '' ? null : details,
        };
    });
    // --- duplicate ids ---
    const seen = new Map();
    const duplicated = new Set();
    phases.forEach((p, index) => {
        if (p.id === null)
            return;
        if (seen.has(p.id)) {
            duplicated.add(p.id);
            diag('PHASE_ID_DUPLICATE', 'warn', index);
        }
        else
            seen.set(p.id, index);
    });
    // --- active phase: explicit `Active Phase:` pointers only ---
    // Only the `## Current Focus` section(s) are authoritative: a pointer in a phase body,
    // a note, a table or any other section is history/prose, never the global pointer.
    const pointers = [];
    let inFocus = false;
    for (const line of masked) {
        if (/^#{1,2}\s/.test(line))
            inFocus = /^##\s+Current Focus\s*$/.test(line);
        else if (inFocus) {
            const m = ACTIVE_RE.exec(line);
            if (m !== null)
                pointers.push(m[1]);
        }
    }
    let activePhase;
    if (pointers.length === 0) {
        activePhase = { kind: 'not_declared' };
    }
    else {
        const resolved = pointers.map((p) => {
            if (p === '' || NO_ACTIVE_RE.test(p))
                return { kind: 'none' };
            const id = /^(\S+?)(?:\s+[—–-](?:\s.*)?)?$/.exec(p)?.[1];
            if (id === undefined || !PHASE_ID_RE.test(id))
                return { kind: 'unmatched' };
            if (duplicated.has(id))
                return { kind: 'ambiguous' };
            return seen.has(id) ? { kind: 'phase', id } : { kind: 'unmatched' };
        });
        const first = resolved[0];
        const allSame = resolved.every((r) => r.kind === first.kind && (r.kind !== 'phase' || (first.kind === 'phase' && r.id === first.id)));
        if (!allSame) {
            activePhase = { kind: 'ambiguous' };
            diag('ACTIVE_PHASE_CONFLICT', 'warn');
        }
        else {
            activePhase = first;
            if (first.kind === 'unmatched')
                diag('ACTIVE_PHASE_UNMATCHED', 'warn');
            else if (first.kind === 'ambiguous')
                diag('ACTIVE_PHASE_AMBIGUOUS_ID', 'warn');
        }
        if (activePhase.kind === 'phase') {
            const phase = phases[seen.get(activePhase.id)];
            const v = phase.status.value === null ? null : normalizeStatus(phase.status.value);
            if (v === 'COMPLETE' || v === 'COMPLETED')
                diag('ACTIVE_PHASE_REPORTED_COMPLETE', 'warn', seen.get(activePhase.id));
        }
    }
    // --- overall state: parse failure is never an empty success ---
    let state;
    if (phases.length === 0) {
        if (phasesStart === -1) {
            state = 'unrecognized';
            diag('PHASES_SECTION_MISSING', 'warn');
        }
        else {
            state = 'no_phases';
            diag('NO_PHASES_FOUND', 'warn');
        }
    }
    else if (malformedHeadings > 0 || truncatedPhases || phasesSections > 1) {
        state = 'partial';
    }
    else {
        state = 'ok';
    }
    return { state, phases, activePhase, diagnostics };
}
