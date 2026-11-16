/**
 * State Reconciliation Report (SELF-AWARENESS-002).
 *
 * SELF-AWARENESS-001 says *whether* the recorded state looks outdated. This
 * module says *what* the evidence is and *what a human should check*. It is
 * pure: it takes the same `FreshnessEvidence` / `FreshnessResult` that
 * `brief` already computed, reads nothing and writes nothing.
 *
 * Two rules shape every line of the report:
 *   - A git commit is not evidence that a work item is complete, and a work-item
 *     id in a commit subject is not evidence that its recorded status is right.
 *     The report therefore only ever says "referenced" and "not mentioned",
 *     never "done" or "missing from the roadmap because it was finished".
 *   - Recommendations are things for a person to verify or decide. Nothing here
 *     edits a document or concludes anything on the person's behalf.
 *
 * Findings are graded:
 *   confirmed  a concrete, checkable discrepancy (documents contradict each other,
 *              or git names a work item that no state document mentions)
 *   suspected  something that may be a discrepancy but cannot be shown from the data
 *   unknown    the evidence needed to decide is missing (no git, truncated history, ...)
 */
import { extractWorkItemIds, mentionsId, } from './freshness.js';
import { sanitizeSingleLine as san } from './sanitize.js';
import { wrapLine } from '../cli/style.js';
export const MAX_COMMITS_PER_ITEM = 3;
const MAX_LISTED_ITEMS = 10;
const MAX_SUBJECT_CHARS = 72;
const DOC_ORDER = ['active.md', 'roadmap-index.md', 'story-index.md', 'HANDOFF.md'];
function short(sha) {
    return sha.slice(0, 7);
}
function clip(s) {
    return s.length <= MAX_SUBJECT_CHARS ? s : `${s.slice(0, MAX_SUBJECT_CHARS - 1)}…`;
}
function commitLine(c) {
    return `${short(c.sha)} ${clip(c.subject)}`;
}
export function reconcile(ev, result) {
    const findings = [];
    const reviewReasons = new Map();
    const actions = [];
    const limitations = [
        'A commit is not evidence that a work item is complete; an id in a commit subject does not show its recorded status is correct.',
    ];
    const pathOf = (name) => [...ev.stateFiles].find((f) => f === name || f.endsWith(`/${name}`)) ?? name;
    const review = (name, reason) => {
        const path = pathOf(name);
        const list = reviewReasons.get(path) ?? [];
        if (!list.includes(reason))
            list.push(reason);
        reviewReasons.set(path, list);
    };
    // 1. Contradictions between the state documents — need no git.
    for (const r of result.reasons) {
        if (r.code !== 'STATE_CONTRADICTION')
            continue;
        const docs = r.documents ?? [];
        findings.push({ kind: 'confirmed', code: 'STATE_CONTRADICTION', summary: r.message, evidence: docs });
        for (const d of docs)
            review(d, 'contradicts another state document');
        actions.push(`Decide which of ${docs.length > 0 ? docs.join(' and ') : 'the state documents'} is correct (see the confirmed mismatch above).`);
    }
    // 2. Git-derived evidence.
    const untrackedWork = [];
    const independentKnowledge = [];
    let mentionedWork = [];
    if (ev.git.status === 'unavailable') {
        findings.push({ kind: 'unknown', code: 'GIT_UNAVAILABLE', summary: reasonMessage(result, 'GIT_UNAVAILABLE'), evidence: [] });
        actions.push('Run this command from a git checkout (git must be installed) to compare the state documents with history.');
        limitations.push('Git is unavailable: only contradictions between the state documents can be detected.');
    }
    else if (ev.git.lastStateUpdate === null) {
        findings.push({ kind: 'unknown', code: 'STATE_NOT_IN_GIT', summary: reasonMessage(result, 'STATE_NOT_IN_GIT'), evidence: [] });
        actions.push('Commit the state documents to establish a baseline, then re-run.');
        limitations.push('No commit touches the state documents, so there is no baseline to compare history with.');
    }
    else {
        const activity = ev.git.commitsSince.filter((c) => c.files.some((f) => !ev.stateFiles.has(f)));
        const byId = new Map();
        const unattributed = [];
        const knowledgeBy = new Map();
        for (const c of activity) {
            const ids = extractWorkItemIds(c.subject);
            const k = ids.length === 0 ? ev.knowledge?.attributed.get(c.sha) : undefined;
            if (k !== undefined) {
                const key = k.ideaIds.join(', ');
                const entry = knowledgeBy.get(key) ?? { paths: [], lines: [] };
                entry.lines.push(commitLine(c));
                for (const p of k.paths)
                    if (!entry.paths.includes(p))
                        entry.paths.push(p);
                knowledgeBy.set(key, entry);
                continue;
            }
            if (ids.length === 0)
                unattributed.push(c);
            for (const id of ids)
                byId.set(id, [...(byId.get(id) ?? []), c]);
        }
        const ids = [...byId.keys()].sort();
        mentionedWork = ids.filter((id) => mentionsId(ev.recordedText, id));
        for (const id of ids.filter((i) => !mentionsId(ev.recordedText, i))) {
            const commits = byId.get(id) ?? [];
            untrackedWork.push({
                id,
                commits: commits.slice(0, MAX_COMMITS_PER_ITEM).map((c) => ({ sha: c.sha, subject: c.subject })),
                totalCommits: commits.length,
            });
            findings.push({
                kind: 'confirmed',
                code: 'UNRECORDED_WORK',
                summary: `${id} is referenced by ${commits.length} commit(s) after the last state update; no state document mentions it.`,
                evidence: commits.slice(0, MAX_COMMITS_PER_ITEM).map(commitLine),
            });
        }
        if (untrackedWork.length > 0) {
            review('roadmap-index.md', 'no entry for work items that git references');
            review('HANDOFF.md', 'may not describe work items that git references');
            if (ev.activeStory.kind !== 'ids')
                review('active.md', 'confirm whether any of this work is current');
            for (const u of untrackedWork.slice(0, MAX_LISTED_ITEMS)) {
                actions.push(`Verify the status of ${u.id} and record it if appropriate (git references it; that does not show it is complete).`);
            }
            if (untrackedWork.length > MAX_LISTED_ITEMS) {
                actions.push(`Verify the remaining ${untrackedWork.length - MAX_LISTED_ITEMS} untracked work item(s) listed above.`);
            }
        }
        if (unattributed.length > 0) {
            findings.push({
                kind: 'suspected',
                code: 'UNATTRIBUTED_ACTIVITY',
                summary: `${unattributed.length} commit(s) after the last state update change project files without naming a work item; whether the state documents cover them cannot be determined.`,
                evidence: unattributed.slice(0, MAX_COMMITS_PER_ITEM).map((c) => {
                    const why = ev.knowledge?.rejected.get(c.sha);
                    return why === undefined ? commitLine(c) : `${commitLine(c)} — names an idea but is not attributed: ${why.reason}`;
                }),
            });
            actions.push(`Review the ${unattributed.length} commit(s) that name no work item and decide whether the recorded state covers them.`);
        }
        for (const [ids, entry] of knowledgeBy) {
            independentKnowledge.push({ ideaIds: ids.split(', '), paths: entry.paths, commits: entry.lines });
        }
        if (knowledgeBy.size > 0) {
            limitations.push('Commits attributed to independent knowledge are explained by a registered idea and its declared document paths; this is attribution, not approval or review, and says nothing about any work item or the active story.');
        }
        const explainedByKnowledge = [...knowledgeBy.values()].reduce((n, e) => n + e.lines.length, 0);
        if (activity.length - explainedByKnowledge > 0 && ev.activeStory.kind === 'none') {
            findings.push({
                kind: 'suspected',
                code: 'ACTIVITY_WITHOUT_ACTIVE_STORY',
                summary: 'Git shows project activity after the last state update, but no active story is recorded.',
                evidence: [],
            });
            review('active.md', 'no active story recorded while git shows later activity');
            actions.push('Review the active story: confirm whether any work is current. No active story does not mean the project is complete.');
        }
        if (ev.git.shallow === true) {
            findings.push({ kind: 'unknown', code: 'GIT_HISTORY_SHALLOW', summary: reasonMessage(result, 'GIT_HISTORY_SHALLOW'), evidence: [] });
            limitations.push('The repository is a shallow clone; history before its boundary is absent, so the report cannot show what happened earlier.');
            actions.push('Deepen the clone (git fetch --unshallow) or run this from a full checkout, then re-run.');
        }
        if (ev.git.truncated) {
            findings.push({ kind: 'unknown', code: 'GIT_HISTORY_TRUNCATED', summary: reasonMessage(result, 'GIT_HISTORY_TRUNCATED'), evidence: [] });
            limitations.push('Git history after the last state update was cut at the read limit; older commits are not examined.');
            actions.push('Review the history since the last state update manually; this report covers only the newest commits.');
        }
        limitations.push('The last state update is the last commit touching a state document; uncommitted edits count for "mentioned" but not for that baseline.');
    }
    if (ev.activeStory.kind === 'unknown') {
        findings.push({
            kind: 'unknown',
            code: 'ACTIVE_STORY_UNKNOWN',
            summary: 'The active story could not be determined from active.md.',
            evidence: [],
        });
        review('active.md', 'its current story could not be parsed');
    }
    const documents = [...reviewReasons.entries()]
        .map(([path, reasons]) => ({ path, reasons }))
        .sort((a, b) => docRank(a.path) - docRank(b.path));
    return {
        freshness: result.status,
        lastStateUpdate: result.lastStateUpdate,
        findings,
        untrackedWork,
        mentionedWork,
        independentKnowledge,
        documents,
        limitations,
        actions,
    };
}
function docRank(path) {
    const i = DOC_ORDER.findIndex((n) => path === n || path.endsWith(`/${n}`));
    return i === -1 ? DOC_ORDER.length : i;
}
function reasonMessage(result, code) {
    return result.reasons.find((r) => r.code === code)?.message ?? code;
}
// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const TRUNCATION_MARKER_RESERVE = 100;
/**
 * Deterministic, bounded text. The header (freshness) and the closing
 * "No files were modified." are mandatory and never dropped; the sections in
 * between are added in priority order while they fit, and an omission is
 * always announced.
 */
export function renderReconciliation(report, maxChars, width) {
    const head = ['MONOLITH STATE RECONCILIATION', '', `Freshness: ${report.freshness}`];
    if (report.lastStateUpdate) {
        head.push(wrapLine(`Last state update: ${san(short(report.lastStateUpdate.sha))} (${san(report.lastStateUpdate.date.slice(0, 10))}, git)`, width, '', '  '));
    }
    const foot = '\nNo files were modified.\n';
    // `item` is one logical line; with a width it wraps under a hanging indent.
    const item = (text, first = '- ', rest = '  ') => wrapLine(text, width, first, rest);
    const sections = [];
    const block = (title, lines) => `\n${wrapLine(title, width, '', '  ')}\n${lines.join('\n')}\n`;
    const contradictions = report.findings.filter((f) => f.code === 'STATE_CONTRADICTION');
    if (contradictions.length > 0) {
        const lines = [];
        for (const f of contradictions) {
            lines.push(item(san(f.summary)));
            if (f.evidence.length > 0)
                lines.push(item(`conflicting sources: ${f.evidence.map(san).join('  vs  ')}`, '    ', '      '));
        }
        sections.push(block(`Confirmed mismatches between state documents (${contradictions.length}):`, lines));
    }
    if (report.untrackedWork.length > 0) {
        const lines = [];
        for (const u of report.untrackedWork.slice(0, MAX_LISTED_ITEMS)) {
            lines.push(item(`${u.id} (${u.totalCommits} commit(s) in git)`));
            for (const c of u.commits)
                lines.push(item(san(commitLine(c)), '    ', '       '));
            if (u.totalCommits > u.commits.length)
                lines.push(`    … and ${u.totalCommits - u.commits.length} more`);
        }
        if (report.untrackedWork.length > MAX_LISTED_ITEMS) {
            lines.push(`- … and ${report.untrackedWork.length - MAX_LISTED_ITEMS} more work item(s)`);
        }
        sections.push(block(`Untracked work items (referenced in git, mentioned in no state document) (${report.untrackedWork.length}):`, lines));
    }
    for (const [kind, title] of [
        ['suspected', 'Suspected mismatches (not confirmable from the data)'],
        ['unknown', 'Unknown (evidence missing)'],
    ]) {
        const list = report.findings.filter((f) => f.kind === kind);
        if (list.length === 0)
            continue;
        const lines = [];
        for (const f of list) {
            lines.push(item(san(f.summary)));
            for (const e of f.evidence)
                lines.push(item(san(e), '    ', '       '));
        }
        sections.push(block(`${title}:`, lines));
    }
    if (report.independentKnowledge.length > 0) {
        const lines = [];
        for (const k of report.independentKnowledge.slice(0, MAX_LISTED_ITEMS)) {
            lines.push(item(`${san(k.ideaIds.join(', '))} (${k.commits.length} commit(s))`));
            const shownPaths = k.paths.slice(0, MAX_LISTED_ITEMS).map(san).join(', ');
            lines.push(item(`declared paths: ${shownPaths}${k.paths.length > MAX_LISTED_ITEMS ? ` and ${k.paths.length - MAX_LISTED_ITEMS} more` : ''}`, '    ', '      '));
            for (const c of k.commits.slice(0, MAX_COMMITS_PER_ITEM))
                lines.push(item(san(c), '    ', '       '));
        }
        sections.push(block('Attributed to registered independent knowledge (no work item, active story unaffected):', lines));
    }
    if (report.documents.length > 0) {
        const lines = [];
        for (const d of report.documents)
            lines.push(item(`${san(d.path)} — ${d.reasons.map(san).join('; ')}`));
        sections.push(block('Documents requiring review:', lines));
    }
    if (report.findings.length === 0) {
        sections.push('\n' + item('No discrepancy was found in the available evidence. This is not a guarantee the state is correct.', '', '') + '\n');
    }
    if (report.mentionedWork.length > 0) {
        const shown = report.mentionedWork.slice(0, MAX_LISTED_ITEMS).join(', ');
        const more = report.mentionedWork.length > MAX_LISTED_ITEMS ? ` and ${report.mentionedWork.length - MAX_LISTED_ITEMS} more` : '';
        sections.push('\n' + item(`Work items in git that state documents mention: ${shown}${more}. Mentioned does not mean the recorded status is correct.`, '', '') + '\n');
    }
    // Recommendations (what a person may do) come before limitations (what this report cannot show).
    if (report.actions.length > 0) {
        sections.push(block('Suggested actions (for a person to decide; none is applied automatically):', report.actions.map((a, i) => item(san(a), `${i + 1}. `, '   '))));
    }
    sections.push(block('Limitations of this report:', report.limitations.map((l) => item(san(l)))));
    const mandatory = head.join('\n') + '\n' + foot;
    let used = mandatory.length;
    const kept = [];
    let omitted = 0;
    for (const s of sections) {
        // Priority order: once a section is dropped, every later one is too. Room for the marker is always reserved.
        if (omitted === 0 && used + s.length <= maxChars - TRUNCATION_MARKER_RESERVE) {
            kept.push(s);
            used += s.length;
        }
        else {
            omitted++;
        }
    }
    let body = kept.join('');
    if (omitted > 0) {
        body += `\n[truncated: ${omitted} section(s) omitted to fit --max-chars ${maxChars}]\n`;
    }
    return { text: head.join('\n') + '\n' + body + foot, truncated: omitted > 0 };
}
