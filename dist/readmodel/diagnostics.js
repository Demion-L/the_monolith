/**
 * On-demand diagnostics for Mission Control (BETA-020 Phase 3, "Observe. Inspect. Act.").
 *
 * `runValidation` and `runReconciliation` call the existing Core functions —
 * `validateProject` (static, ADR-011: project code is never executed) and
 * `collect` + `reconcile` (read-only Git evidence) — and project their result
 * into a DTO. No rule is re-implemented here, no subprocess or shell is
 * started, and nothing is written. The project root is fixed by the embedding
 * process and never taken from a request.
 *
 * Messages are scrubbed: the absolute project root becomes `<project>`, control
 * characters are escaped, and every free-text field is clipped.
 */
import { realpathSync } from 'fs';
import { collect } from '../brief/collect.js';
import { reconcile } from '../brief/reconcile.js';
import { sanitizeSingleLine } from '../brief/sanitize.js';
import { validateProject } from '../validate/index.js';
const MAX_TEXT_CHARS = 300;
const MAX_CONFLICTS = 20;
const MAX_WORK_ITEMS = 10;
const MAX_NOTES = 20;
const MAX_LIST = 20;
function scrubber(projectRoot) {
    const roots = new Set([projectRoot]);
    try {
        roots.add(realpathSync(projectRoot));
    }
    catch {
        // an unresolvable root is simply not scrubbed twice
    }
    const ordered = [...roots].sort((a, b) => b.length - a.length);
    return (s) => {
        let out = s;
        for (const r of ordered)
            if (r.length > 1)
                out = out.split(r).join('<project>');
        out = sanitizeSingleLine(out);
        return out.length <= MAX_TEXT_CHARS ? out : `${out.slice(0, MAX_TEXT_CHARS - 1)}…`;
    };
}
export function runValidation(projectRoot) {
    const clean = scrubber(projectRoot);
    const report = validateProject(projectRoot);
    return {
        result: report.passed ? 'PASS' : 'FAIL',
        checks: report.checks.map((c) => ({
            id: c.id,
            label: c.label,
            passed: c.passed,
            message: c.passed || c.error === undefined ? null : clean(c.error),
            note: c.passed && c.note !== undefined ? clean(c.note) : null,
        })),
        warning: report.warning === null ? null : clean(report.warning),
    };
}
function toNote(clean, f) {
    return { code: f.code, summary: clean(f.summary), evidence: f.evidence.slice(0, MAX_LIST).map(clean) };
}
export async function runReconciliation(projectRoot) {
    const clean = scrubber(projectRoot);
    const model = await collect(projectRoot);
    if (!model.freshness || !model.freshnessEvidence) {
        throw new Error('no freshness evidence could be collected');
    }
    const report = reconcile(model.freshnessEvidence, model.freshness);
    let truncated = false;
    const cap = (list, max) => {
        if (list.length > max)
            truncated = true;
        return list.slice(0, max);
    };
    const unknown = report.findings.filter((f) => f.kind === 'unknown');
    const codes = new Set(unknown.map((f) => f.code));
    const evidence = codes.has('GIT_UNAVAILABLE') || codes.has('STATE_NOT_IN_GIT')
        ? 'UNKNOWN'
        : unknown.length > 0
            ? 'INCOMPLETE'
            : 'COMPLETE';
    return {
        evidence,
        freshness: report.freshness,
        lastStateUpdate: report.lastStateUpdate === null
            ? null
            : { sha: report.lastStateUpdate.sha.slice(0, 7), date: report.lastStateUpdate.date.slice(0, 10) },
        conflicts: cap(report.findings.filter((f) => f.code === 'STATE_CONTRADICTION'), MAX_CONFLICTS).map((f) => ({
            summary: clean(f.summary),
            sources: (f.sources ?? []).slice(0, 4).map((s) => ({ document: clean(s.document), claim: clean(s.claim) })),
        })),
        unrecordedWork: cap(report.untrackedWork, MAX_WORK_ITEMS).map((u) => ({
            id: clean(u.id),
            totalCommits: u.totalCommits,
            commits: u.commits.map((c) => ({ sha: c.sha.slice(0, 7), subject: clean(c.subject) })),
        })),
        unattributed: cap(report.findings.filter((f) => f.kind === 'suspected'), MAX_NOTES).map((f) => toNote(clean, f)),
        evidenceIssues: cap(unknown, MAX_NOTES).map((f) => toNote(clean, f)),
        documents: cap(report.documents, MAX_LIST).map((d) => ({ path: clean(d.path), reasons: d.reasons.slice(0, 5).map(clean) })),
        actions: cap(report.actions, MAX_LIST).map(clean),
        limitations: cap(report.limitations, MAX_LIST).map(clean),
        truncated,
    };
}
