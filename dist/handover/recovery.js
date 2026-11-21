/**
 * Session context recovery packet (ACCOUNTABILITY-001, Phase 2/3).
 *
 * Host-independent: it only reads what Core already owns (read model, governance check, evidence
 * store) and returns a small structured packet. Hooks of any coding agent are adapters that print it.
 * Every field carries its source; a field whose source is missing is the literal `UNKNOWN`, never a guess.
 * Bounded: fixed caps on entries and text, plus a total character budget. Read-only; no new state file.
 */
import { sanitizeSingleLine } from '../brief/sanitize.js';
import { buildGovernanceReport } from '../governance/check.js';
import { readDashboardModel } from '../readmodel/index.js';
import { assessAll, evidenceStore, listEvidence } from './evidence.js';
import { readGitView } from './git.js';
export const RECOVERY_MAX_MISSIONS = 3;
export const RECOVERY_MAX_STEPS = 5;
export const RECOVERY_MAX_FINDINGS = 6;
export const RECOVERY_MAX_TEXT = 160;
export const RECOVERY_MAX_CHARS = 3500;
const one = (s) => {
    const t = sanitizeSingleLine(s);
    return t.length <= RECOVERY_MAX_TEXT ? t : `${t.slice(0, RECOVERY_MAX_TEXT - 1)}…`;
};
const known = (value, source) => ({ known: true, value, source });
const unknown = (source) => ({ known: false, source });
export function buildRecoveryPacket(projectRoot, deps = {}) {
    const model = deps.model ?? readDashboardModel(projectRoot);
    const ov = model.projectOverview.data;
    if (ov === null) {
        const u = unknown('monolith.config.json');
        return { project: u, activeStory: u, activeMissions: u, lastCheckpoint: u, pendingWork: u, governance: u, evidence: u, git: u, ownerDecisions: u };
    }
    const report = deps.report ?? buildGovernanceReport(projectRoot, model);
    const claim = ov.storyClaim;
    const stateOk = model.history?.data != null;
    const active = model.currentMissions.data?.active ?? [];
    const hist = model.history?.data ?? null;
    const counts = new Map(hist?.missions.map((m) => [m.id, m.checkpointCount]) ?? []);
    // Last checkpoint: prefer one belonging to an active mission.
    let last = stateOk ? unknown('operational state (monolith mission checkpoints)') : unknown('operational state');
    let pending = unknown('operational state (monolith mission checkpoints)');
    if (hist !== null) {
        const activeIds = new Set(active.map((m) => m.id));
        const all = hist.missions.flatMap((m) => m.checkpoints.map((c) => ({ c, missionId: m.id, isActive: activeIds.has(m.id) })));
        const pick = (list) => [...list].sort((a, b) => (a.c.createdAt < b.c.createdAt ? 1 : a.c.createdAt > b.c.createdAt ? -1 : a.c.id < b.c.id ? 1 : -1))[0];
        const chosen = pick(all.filter((x) => x.isActive)) ?? pick(all);
        if (chosen !== undefined) {
            last = known({ id: chosen.c.id, missionId: chosen.missionId, createdAt: chosen.c.createdAt, summary: one(chosen.c.summary), ofActiveMission: chosen.isActive }, 'operational state');
            pending = known(chosen.c.remainingSteps.slice(0, RECOVERY_MAX_STEPS).map(one), `operational state, checkpoint ${chosen.c.id} (historical)`);
        }
        else {
            last = unknown('no checkpoint recorded');
        }
    }
    const bad = report.findings.filter((f) => f.severity !== 'INFO');
    const store = (() => {
        try {
            return evidenceStore(projectRoot);
        }
        catch {
            return null;
        }
    })();
    let evidence = unknown('verification evidence');
    const view = deps.git ?? readGitView(projectRoot, store === null ? [] : [store.dirRel]);
    if (store !== null) {
        const listing = listEvidence(projectRoot);
        const assessed = assessAll(projectRoot, listing.records, view, [store.dirRel]);
        const c = { verified: 0, reported: 0, stale: 0, unknown: 0, failed: 0 };
        for (const a of assessed)
            c[a.level.toLowerCase()]++;
        evidence = known(c, store.dirRel);
    }
    const proposed = (model.decisions?.data?.items ?? []).filter((i) => (i.status ?? '').trim().toLowerCase() === 'proposed' && i.id !== null).map((i) => one(i.id));
    return {
        project: ov.name === null ? unknown('monolith.config.json') : known(one(ov.name), 'monolith.config.json'),
        activeStory: claim === null ? unknown('active.md') : known({ kind: claim.kind === 'ids' ? 'ids' : claim.kind === 'none' ? 'none' : 'unresolved', ids: claim.kind === 'ids' ? claim.ids.map(one) : [] }, 'active.md'),
        activeMissions: stateOk ? known(active.slice(0, RECOVERY_MAX_MISSIONS).map((m) => ({ id: one(m.id), title: one(m.title), storyId: m.storyId ?? null, checkpointCount: counts.get(m.id) ?? 0 })), 'operational state') : unknown('operational state'),
        lastCheckpoint: last,
        pendingWork: pending,
        governance: known({
            errors: report.counts.error,
            warnings: report.counts.warning,
            top: bad.slice(0, RECOVERY_MAX_FINDINGS).map((f) => ({ severity: f.severity, area: f.area, code: f.code, path: f.path })),
            more: Math.max(0, bad.length - RECOVERY_MAX_FINDINGS),
        }, 'monolith governance check'),
        evidence,
        git: view.available ? known({ head: view.head === null ? null : view.head.slice(0, 12), dirty: view.dirty }, 'git (read-only)') : unknown('git'),
        ownerDecisions: model.decisions?.data != null ? known(proposed.slice(0, 5), 'docs/adr (status: proposed)') : unknown('docs/adr'),
    };
}
/** Plain text lines for any host. The first lines keep the wording the original SessionStart hook used. */
export function renderRecoveryPacket(p, maxChars = RECOVERY_MAX_CHARS) {
    const L = ['MONOLITH project context (from `monolith`; read-only; each line names its source; refresh with `monolith brief`).'];
    if (!p.project.known && !p.activeStory.known) {
        L.push('Instance: not established (no valid monolith.config.json). Run `monolith validate`.');
    }
    else {
        L.push(`Project: ${p.project.known ? p.project.value : 'UNKNOWN'}.`);
        const s = p.activeStory;
        L.push(`Active story: ${s.known ? (s.value.kind === 'ids' ? s.value.ids.join(', ') : s.value.kind === 'none' ? 'none recorded' : 'unresolved') : 'UNKNOWN'} (source: ${s.source}).`);
        const m = p.activeMissions;
        if (!m.known)
            L.push(`Active mission: UNKNOWN (source: ${m.source}).`);
        else if (m.value.length === 0)
            L.push('Active mission: none. Record work with `monolith mission start` / `checkpoint` / `finish`.');
        else
            L.push(`Active mission(s): ${m.value.map((x) => `${x.id} (${x.title}; ${x.checkpointCount} checkpoint(s)${x.storyId === null ? '' : `; story ${x.storyId}`})`).join('; ')}. Record progress with \`monolith mission checkpoint\`.`);
        const c = p.lastCheckpoint;
        L.push(c.known ? `Last checkpoint: ${c.value.id} at ${c.value.createdAt}${c.value.ofActiveMission ? '' : ' (of a finished mission)'}: ${c.value.summary}` : `Last checkpoint: UNKNOWN (${c.source}).`);
        if (p.pendingWork.known && p.pendingWork.value.length > 0) {
            L.push('Pending at that checkpoint (historical, not the current plan):');
            for (const step of p.pendingWork.value)
                L.push(`- ${step}`);
        }
        const g = p.git;
        if (g.known)
            L.push(`Git: HEAD ${g.value.head ?? '(none)'}, working tree ${g.value.dirty === null ? 'UNKNOWN' : g.value.dirty ? 'has uncommitted changes' : 'clean'}.`);
        const e = p.evidence;
        if (e.known)
            L.push(`Verification evidence: ${e.value.verified} verified, ${e.value.reported} reported (not verification), ${e.value.stale} stale, ${e.value.unknown} unknown, ${e.value.failed} failed. Record with \`monolith evidence run\`.`);
    }
    const gov = p.governance;
    if (!gov.known)
        L.push('Governance check: UNKNOWN.');
    else if (gov.value.errors + gov.value.warnings === 0)
        L.push('Governance check: no issues.');
    else {
        L.push(`Governance check: ${gov.value.errors} error(s), ${gov.value.warnings} warning(s). Run \`monolith governance check\`. Format contract: .monolith/protocols/governance/document-formats.md (if absent, run \`monolith update\`).`);
        for (const f of gov.value.top)
            L.push(`- [${f.severity}] ${f.area} ${f.code}${f.path ? ` (${f.path})` : ''}`);
        if (gov.value.more > 0)
            L.push(`- … ${gov.value.more} more`);
    }
    if (p.ownerDecisions.known && p.ownerDecisions.value.length > 0)
        L.push(`Open owner decisions (ADRs declared proposed): ${p.ownerDecisions.value.join(', ')}.`);
    L.push('Reminder: update project context (active.md, checkpoints) when work changes; finalize only via `monolith finalize` with owner approval. Before a final report on autonomous work run `monolith governance check` and `monolith handover check` and reconcile your claims with them.');
    let out = L.join('\n');
    if (out.length > maxChars)
        out = `${out.slice(0, maxChars - 40).trimEnd()}\n[truncated to fit the context budget]`;
    return out;
}
