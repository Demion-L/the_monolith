/**
 * `buildDevelopmentHistory(state)` — read-only history of Missions and Checkpoints (GOV-EVOLUTION Phase 3).
 *
 * Pure and deterministic. It reads the already-loaded `CoordinatoriumState` and adds nothing: no new
 * journal, no inferred checkpoints, no inferred Story links. It does not rely on `activeMissions`, so
 * finished missions and their checkpoints are visible. Output is bounded; a cut list says so.
 */
import { compareStrings } from '../brief/selectors.js';
export const MAX_HISTORY_MISSIONS = 200;
export const MAX_HISTORY_CHECKPOINTS_PER_MISSION = 50;
export const MAX_HISTORY_RECENT = 10;
const CKPT_RE = /-CKPT-(\d+)$/;
function ordinal(c) {
    const m = CKPT_RE.exec(c.id);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}
function checkpointView(c) {
    return { id: c.id, createdAt: c.createdAt, summary: c.summary, remainingSteps: [...c.remainingSteps], context: c.context };
}
export function buildDevelopmentHistory(state) {
    const missions = state ? Object.values(state.tactical.missions) : [];
    const checkpoints = state ? Object.values(state.tactical.checkpoints) : [];
    const byMission = new Map();
    for (const c of checkpoints)
        byMission.set(c.missionId, [...(byMission.get(c.missionId) ?? []), c]);
    const known = new Set(missions.map((m) => m.id));
    const orphanCheckpoints = checkpoints.filter((c) => !known.has(c.missionId)).length;
    const counts = { in_progress: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const m of missions)
        counts[m.status]++;
    const ordered = [...missions].sort((a, b) => compareStrings(b.startedAt, a.startedAt) || compareStrings(b.id, a.id));
    const shown = ordered.slice(0, MAX_HISTORY_MISSIONS);
    const views = shown.map((m) => {
        const own = (byMission.get(m.id) ?? []).sort((a, b) => ordinal(a) - ordinal(b) || compareStrings(a.id, b.id));
        return {
            id: m.id,
            title: m.title,
            system: m.system,
            status: m.status,
            startedAt: m.startedAt,
            updatedAt: m.updatedAt,
            summary: m.summary,
            storyId: m.storyId ?? null,
            checkpointCount: own.length,
            checkpoints: own.slice(0, MAX_HISTORY_CHECKPOINTS_PER_MISSION).map(checkpointView),
            checkpointsTruncated: own.length > MAX_HISTORY_CHECKPOINTS_PER_MISSION,
        };
    });
    // Events come only from recorded timestamps. Computed over ALL missions so a cut list cannot hide a newer event.
    const events = [];
    for (const m of missions) {
        events.push({ kind: 'mission_started', at: m.startedAt, missionId: m.id, missionTitle: m.title, checkpointId: null, summary: null, result: null });
        if (m.status !== 'in_progress') {
            events.push({ kind: 'mission_finished', at: m.updatedAt, missionId: m.id, missionTitle: m.title, checkpointId: null, summary: m.summary, result: m.status });
        }
    }
    const titleOf = new Map(missions.map((m) => [m.id, m.title]));
    for (const c of checkpoints) {
        const title = titleOf.get(c.missionId);
        if (title === undefined)
            continue;
        events.push({ kind: 'checkpoint', at: c.createdAt, missionId: c.missionId, missionTitle: title, checkpointId: c.id, summary: c.summary, result: null });
    }
    const KIND_RANK = { mission_finished: 0, checkpoint: 1, mission_started: 2 };
    events.sort((a, b) => compareStrings(b.at, a.at) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || compareStrings(b.missionId, a.missionId) || compareStrings(b.checkpointId ?? '', a.checkpointId ?? ''));
    return {
        missions: views,
        totalMissions: missions.length,
        truncated: ordered.length > shown.length,
        counts,
        totalCheckpoints: checkpoints.length,
        orphanCheckpoints,
        recent: events.slice(0, MAX_HISTORY_RECENT),
    };
}
