/**
 * `readDashboardModel(projectRoot)` — builds the DashboardReadModel.
 *
 * Contract:
 *  - `projectRoot` is supplied by the embedding process (fixed at startup),
 *    never by a request. The set of files read is closed (see SourceId).
 *  - Strictly read-only and synchronous: no write, no lock, no `mutateState`,
 *    no `validate`, no `import()` of project code, no network. Nothing is
 *    cached; every call re-reads.
 *  - Never throws. Failures become SourceReport / ReadNote data.
 *  - Deterministic: same files ⇒ deep-equal result; no timestamps.
 *
 * Containment (G1): the instance root is resolved with `resolveMonolithRoot`
 * (ADR-009) and every file is read with `readProjectFile`, which realpath-checks
 * each path component against the real project root and then performs the
 * bounded, non-blocking read of SEC-001B.1. `readState` is deliberately NOT
 * used: it does not check containment. Check-then-use races are NOT closed by
 * Core (SEC-001B) and are therefore not closed here.
 *
 * Every source goes through `readProjectFile` (ADR-014): no symlink in any
 * component, one hard link, regular file, absolute boundary, never the cwd.
 * This module adds no filesystem checks of its own; it only interprets Core's
 * typed result (`FILE_CODE_MAP`). Threat model (ADR-013): TM-A supported with
 * limitations, TM-B partially supported, TM-C (concurrent mutation) NOT supported.
 */
import { MAX_STATE_BYTES, validateState } from '../coordinatorium/index.js';
import { resolveStateLocation, collectStateProvenance, openStateFileBounded } from '../coordinatorium/state-location.js';
import { relative } from 'path';
import { CONFIG_FILE_NAME, MAX_PROJECT_FILE_BYTES, RootContainmentError, readProjectFile, resolveMonolithRoot, } from '../root/index.js';
import { MAX_ACTIVE_CONTEXT_BYTES } from '../brief/collect.js';
import { ACTIVE_MD_REL } from '../brief/constants.js';
import { extractCurrentStory } from '../brief/story.js';
import { parseActiveStoryClaim } from '../brief/freshness.js';
import { parseRoadmapPhases } from './roadmap.js';
import { parseStoryIndex } from './story-index.js';
import { buildStoryAuthorityContext, resolveStoryStateIn } from './story-state.js';
import { readKnowledge } from './knowledge.js';
import { sourceFailure } from './source-failure.js';
import { hasCheckpointOrderMismatch, selectActiveMissions, selectLatestCheckpoint, } from '../brief/selectors.js';
export const ROADMAP_REL = 'context/maps/roadmap-index.md';
/** Protective ceiling, like the other SEC-001B.1 limits — not a content policy. */
export const MAX_ROADMAP_BYTES = 1024 * 1024;
export const STORY_INDEX_REL = 'memory/working/story-index.md';
/** Protective ceiling, like the other SEC-001B.1 limits — not a content policy. */
export const MAX_STORY_INDEX_BYTES = 1024 * 1024;
const CHANGED_RETRIES = 3;
export { FILE_CODE_MAP } from './source-failure.js';
function report(id, path, status, code) {
    return { id, path, status, code };
}
function withStatus(r, status, code) {
    return { ...r, status, code };
}
/** One contained, bounded read of a fixed project-relative path. */
function load(projectRoot, id, relPath, maxBytes) {
    try {
        let read = readProjectFile(projectRoot, relPath, { maxBytes, allowEmpty: true });
        // A rename-based writer replacing the file under us is normal, not a fault.
        for (let i = 1; i < CHANGED_RETRIES && !read.ok && read.code === 'FILE_CHANGED'; i++) {
            read = readProjectFile(projectRoot, relPath, { maxBytes, allowEmpty: true });
        }
        if (read.ok)
            return { report: report(id, relPath, 'available', null), content: read.content };
        const [status, code] = sourceFailure(read.code);
        return { report: report(id, relPath, status, code), content: null };
    }
    catch {
        return { report: report(id, relPath, 'unreadable', 'INTERNAL'), content: null };
    }
}
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function loadConfig(projectRoot) {
    const loaded = load(projectRoot, 'config', CONFIG_FILE_NAME, MAX_PROJECT_FILE_BYTES);
    if (loaded.report.status === 'absent')
        return { report: loaded.report, read: { status: 'absent' }, name: null };
    if (loaded.content === null) {
        return { report: loaded.report, read: null, name: null };
    }
    let parsed;
    try {
        parsed = JSON.parse(loaded.content);
    }
    catch {
        return { report: withStatus(loaded.report, 'corrupt', 'CONFIG_INVALID'), read: null, name: null };
    }
    if (!isPlainObject(parsed)) {
        return { report: withStatus(loaded.report, 'corrupt', 'CONFIG_INVALID'), read: null, name: null };
    }
    const project = parsed.project;
    const rawName = isPlainObject(project) ? project.name : undefined;
    const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : null;
    return { report: loaded.report, read: { status: 'ok', cfg: parsed }, name };
}
function provenanceView(loc, p) {
    return {
        mode: loc.kind === 'git-common-dir' ? 'shared' : loc.mode === 'isolated' ? 'isolated' : 'local',
        location: loc.kind,
        localReason: loc.localReason,
        statePath: loc.displayPath,
        revision: p.canonical.revision,
        schemaVersion: p.canonical.schemaVersion,
        monolithVersion: p.monolithVersion,
        repositoryIdentity: p.repositoryIdentity,
        worktreeCount: p.worktreeCount,
        splitBrain: {
            detected: p.splitBrain.detected,
            canonicalMissingWithLocalData: p.splitBrain.canonicalMissingWithLocalData,
            localStates: p.splitBrain.candidates.map((c) => ({
                path: relative(loc.projectRoot, c.path),
                status: c.status === 'absent' ? 'unreadable' : c.status,
                schemaVersion: c.schemaVersion,
                revision: c.revision,
                missionCount: c.missionCount,
                checkpointCount: c.checkpointCount,
                currentWorktree: c.current,
            })),
        },
    };
}
function loadState(projectRoot, root, config) {
    let loc;
    try {
        loc = resolveStateLocation(projectRoot, config);
    }
    catch {
        return {
            report: report('state', null, 'unreadable', 'SOURCE_BOUNDARY_INVALID'),
            state: null,
            schemaVersionOnDisk: null,
            provenance: null,
        };
    }
    let provenance = null;
    try {
        provenance = provenanceView(loc, collectStateProvenance(loc));
    }
    catch {
        /* provenance is additive diagnostics: its failure never hides the state itself */
    }
    let loaded;
    if (loc.kind === 'git-common-dir') {
        // The shared directory lies outside the project root, so it is its own boundary.
        try {
            const read = openStateFileBounded(loc, loc.displayPath, projectRoot);
            if (read.ok && 'content' in read) {
                loaded = { report: report('state', loc.displayPath, 'available', null), content: read.content };
            }
            else if (!read.ok) {
                const [status, code] = sourceFailure(read.code);
                loaded = { report: report('state', loc.displayPath, status, code), content: null };
            }
            else {
                loaded = { report: report('state', loc.displayPath, 'unreadable', 'INTERNAL'), content: null };
            }
        }
        catch {
            loaded = { report: report('state', loc.displayPath, 'unreadable', 'INTERNAL'), content: null };
        }
    }
    else {
        loaded = load(projectRoot, 'state', `${root.monolithRoot}/state.json`, MAX_STATE_BYTES);
    }
    if (loaded.content === null)
        return { report: loaded.report, state: null, schemaVersionOnDisk: null, provenance };
    const corrupt = (code) => ({
        report: withStatus(loaded.report, 'corrupt', code),
        state: null,
        schemaVersionOnDisk: null,
        provenance,
    });
    if (loaded.content.trim() === '')
        return corrupt('SOURCE_EMPTY');
    let parsed;
    try {
        parsed = JSON.parse(loaded.content);
    }
    catch {
        return corrupt('PARSE_ERROR');
    }
    try {
        const state = validateState(parsed);
        const onDisk = isPlainObject(parsed) && typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : null;
        return { report: loaded.report, state, schemaVersionOnDisk: onDisk, provenance };
    }
    catch {
        return corrupt('SCHEMA_INVALID');
    }
}
function section(data, sources) {
    return { data, sources };
}
/** Root could not be trusted: nothing below it is read (fail closed, never a default fallback). */
function unreadableModel(config, rootCode = 'ROOT_INVALID') {
    const refused = (id) => report(id, null, 'forbidden', rootCode);
    const state = refused('state');
    const story = refused('activeStory');
    const roadmap = refused('roadmap');
    return {
        projectOverview: section(null, [config, state, story]),
        currentMissions: section(null, [state]),
        checkpoints: section(null, [state]),
        roadmap: section(null, [roadmap]),
        // The root is untrusted, so nothing below it is read: not available (never an empty list).
        hypotheses: section(null, [report('hypotheses', null, 'forbidden', rootCode)]),
        decisions: section(null, [report('decisions', null, 'forbidden', rootCode)]),
        storyIndex: section(null, [report('storyIndex', null, 'forbidden', rootCode)]),
        diagnostics: { validation: 'NOT_PERFORMED', sources: [config, state, story, roadmap], notes: [] },
    };
}
/** ARCH-002B: one resolver, three already-bounded texts. A resolver fault is reported as absent data, never as a state. */
function storyStateOf(active, roadmap, storyIndex) {
    try {
        const ctx = buildStoryAuthorityContext({ active, roadmap, storyIndex });
        const claim = ctx.activeClaim;
        return { activeStory: claim.kind === 'ids' && claim.ids.length === 1 ? resolveStoryStateIn(ctx, claim.ids[0]) : null, sources: ctx.sources };
    }
    catch {
        return null;
    }
}
function buildModel(projectRoot) {
    const config = loadConfig(projectRoot);
    if (config.read === null)
        return unreadableModel(config.report);
    let root;
    try {
        root = resolveMonolithRoot(projectRoot, config.read);
    }
    catch (err) {
        if (err instanceof RootContainmentError)
            return unreadableModel(config.report);
        throw err;
    }
    const notes = [];
    const stateResult = loadState(projectRoot, root, config.read);
    const storyLoaded = load(projectRoot, 'activeStory', `${root.monolithRoot}/${ACTIVE_MD_REL}`, MAX_ACTIVE_CONTEXT_BYTES);
    const roadmapLoaded = load(projectRoot, 'roadmap', `${root.monolithRoot}/${ROADMAP_REL}`, MAX_ROADMAP_BYTES);
    // An absent state.json means "no missions ever recorded", exactly like `brief`.
    const stateUsable = stateResult.report.status === 'available' || stateResult.report.status === 'absent';
    const state = stateResult.state;
    const missions = state ? Object.values(state.tactical.missions) : [];
    const active = state ? selectActiveMissions(state) : [];
    if (stateResult.provenance?.splitBrain.detected)
        notes.push({ code: 'STATE_SPLIT_BRAIN', severity: 'warn' });
    if (active.length > 1)
        notes.push({ code: 'MULTIPLE_ACTIVE_MISSIONS', severity: 'info' });
    let currentStory = null;
    let storyClaim = null;
    if (storyLoaded.content !== null) {
        const extraction = extractCurrentStory(storyLoaded.content);
        if (extraction.hasCurrentStorySection && extraction.excerpt !== null && extraction.lineRange !== null) {
            currentStory = { excerpt: extraction.excerpt, lineRange: extraction.lineRange };
            // Core's existing parser; no second Story parser in the read model.
            const claim = parseActiveStoryClaim(extraction.excerpt);
            storyClaim = claim.kind === 'ids' ? { kind: 'ids', ids: [...claim.ids] } : { kind: claim.kind };
        }
        else {
            notes.push({ code: 'ACTIVE_MD_NO_CURRENT_STORY', severity: 'info' });
        }
    }
    const overview = {
        name: config.name,
        monolithRoot: root.monolithRoot,
        monolithRootSource: root.source,
        stateSchemaVersionOnDisk: stateResult.schemaVersionOnDisk,
        stateRevision: state && stateResult.report.status === 'available' ? state.revision : null,
        activeMissionCount: stateUsable ? active.length : null,
        finishedMissionCount: stateUsable ? missions.length - active.length : null,
        currentStory,
        storyClaim,
    };
    const currentMissions = stateUsable ? { active } : null;
    let checkpoints = null;
    if (state !== null || stateResult.report.status === 'absent') {
        const all = state ? Object.values(state.tactical.checkpoints) : [];
        checkpoints = {
            byActiveMission: active.map((m) => {
                const latest = state ? selectLatestCheckpoint(state, m.id) : null;
                if (state && latest && hasCheckpointOrderMismatch(state, m.id, latest)) {
                    notes.push({ code: 'CHECKPOINT_ORDER_MISMATCH', severity: 'info' });
                }
                return { missionId: m.id, count: all.filter((c) => c.missionId === m.id).length, latest };
            }),
        };
    }
    let roadmap = null;
    if (roadmapLoaded.content !== null) {
        let structured;
        try {
            structured = parseRoadmapPhases(roadmapLoaded.content);
        }
        catch {
            // A parser fault is reported as such, never as an empty roadmap.
            structured = { state: 'error', phases: [], activePhase: { kind: 'not_declared' }, diagnostics: [{ code: 'INTERNAL', severity: 'warn', phaseIndex: null }] };
        }
        roadmap = { text: roadmapLoaded.content, structured };
    }
    // Phase ids come only from the already parsed Roadmap (no second Roadmap parser, D3).
    // null = the Roadmap could not supply them, so containment is reported as unverified.
    const roadmapPhaseIds = roadmap?.structured !== undefined && roadmap.structured.state !== 'error'
        ? roadmap.structured.phases.flatMap((p) => (p.id === null ? [] : [p.id]))
        : null;
    const storyIndexLoaded = load(projectRoot, 'storyIndex', `${root.monolithRoot}/${STORY_INDEX_REL}`, MAX_STORY_INDEX_BYTES);
    let storyIndex = null;
    if (storyIndexLoaded.content !== null) {
        try {
            storyIndex = parseStoryIndex(storyIndexLoaded.content, roadmapPhaseIds, roadmap?.structured?.state !== 'partial');
        }
        catch {
            // A parser fault is reported as such, never as an empty index.
            storyIndex = { state: 'error', stories: [], diagnostics: [{ code: 'INTERNAL', severity: 'warn', storyIndex: null }] };
        }
    }
    return {
        projectOverview: section(overview, [config.report, stateResult.report, storyLoaded.report]),
        currentMissions: section(currentMissions, [stateResult.report]),
        checkpoints: section(checkpoints, [stateResult.report]),
        roadmap: section(roadmap, [roadmapLoaded.report]),
        ...readKnowledge(projectRoot, root.monolithRoot),
        storyIndex: section(storyIndex, [storyIndexLoaded.report]),
        storyState: section(storyStateOf(storyLoaded.content, roadmapLoaded.content, storyIndexLoaded.content), [storyLoaded.report, roadmapLoaded.report, storyIndexLoaded.report]),
        diagnostics: {
            validation: 'NOT_PERFORMED',
            sources: [config.report, stateResult.report, storyLoaded.report, roadmapLoaded.report],
            notes,
            ...(stateResult.provenance ? { state: stateResult.provenance } : {}),
        },
    };
}
export function readDashboardModel(projectRoot) {
    try {
        return buildModel(projectRoot);
    }
    catch {
        // Unexpected fault: report it as data, without any message or path.
        const internal = report('config', null, 'unreadable', 'INTERNAL');
        return unreadableModel(internal, 'INTERNAL');
    }
}
