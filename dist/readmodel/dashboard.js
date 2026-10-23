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
import { CONFIG_FILE_NAME, MAX_PROJECT_FILE_BYTES, isReadSecurityViolation, RootContainmentError, readProjectFile, resolveMonolithRoot, } from '../root/index.js';
import { MAX_ACTIVE_CONTEXT_BYTES } from '../brief/collect.js';
import { ACTIVE_MD_REL } from '../brief/constants.js';
import { extractCurrentStory } from '../brief/story.js';
import { hasCheckpointOrderMismatch, selectActiveMissions, selectLatestCheckpoint, } from '../brief/selectors.js';
export const ROADMAP_REL = 'context/maps/roadmap-index.md';
/** Protective ceiling, like the other SEC-001B.1 limits — not a content policy. */
export const MAX_ROADMAP_BYTES = 256 * 1024;
const CHANGED_RETRIES = 3;
/**
 * Exhaustive over Core's `ProjectFileErrorCode`: a new Core code is a compile
 * error here until it is mapped. The status of a security violation is NOT
 * decided here — `sourceFailure` takes it from Core's `isReadSecurityViolation`,
 * so the UI keeps no second classification of filesystem security. The
 * 'forbidden' entries only document that and are checked against Core in tests.
 */
export const FILE_CODE_MAP = {
    FILE_MISSING: ['absent', 'SOURCE_ABSENT'],
    FILE_OUTSIDE_PROJECT: ['forbidden', 'SOURCE_OUTSIDE_PROJECT'],
    FILE_UNRESOLVABLE: ['unreadable', 'SOURCE_UNRESOLVABLE'],
    FILE_NOT_REGULAR: ['forbidden', 'SOURCE_NOT_REGULAR'],
    FILE_EMPTY: ['corrupt', 'SOURCE_EMPTY'],
    FILE_TOO_LARGE: ['unreadable', 'SOURCE_TOO_LARGE'],
    FILE_CHANGED: ['unreadable', 'SOURCE_CHANGED'],
    FILE_UNREADABLE: ['unreadable', 'SOURCE_UNREADABLE'],
    FILE_SYMLINK: ['forbidden', 'SOURCE_SYMLINK'],
    FILE_HARDLINKED: ['forbidden', 'SOURCE_HARDLINKED'],
    READ_BOUNDARY_INVALID: ['forbidden', 'SOURCE_BOUNDARY_INVALID'],
    READ_UNSUPPORTED_PLATFORM: ['forbidden', 'SOURCE_UNSUPPORTED_PLATFORM'],
};
/** Never maps a security violation to anything but 'forbidden'; no default for unknown codes. */
function sourceFailure(code) {
    const [status, sourceCode] = FILE_CODE_MAP[code];
    return [isReadSecurityViolation(code) ? 'forbidden' : status, sourceCode];
}
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
function loadState(projectRoot, root) {
    const loaded = load(projectRoot, 'state', `${root.monolithRoot}/state.json`, MAX_STATE_BYTES);
    if (loaded.content === null)
        return { report: loaded.report, state: null, schemaVersionOnDisk: null };
    const corrupt = (code) => ({
        report: withStatus(loaded.report, 'corrupt', code),
        state: null,
        schemaVersionOnDisk: null,
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
        return { report: loaded.report, state, schemaVersionOnDisk: onDisk };
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
        diagnostics: { validation: 'NOT_PERFORMED', sources: [config, state, story, roadmap], notes: [] },
    };
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
    const stateResult = loadState(projectRoot, root);
    const storyLoaded = load(projectRoot, 'activeStory', `${root.monolithRoot}/${ACTIVE_MD_REL}`, MAX_ACTIVE_CONTEXT_BYTES);
    const roadmapLoaded = load(projectRoot, 'roadmap', `${root.monolithRoot}/${ROADMAP_REL}`, MAX_ROADMAP_BYTES);
    // An absent state.json means "no missions ever recorded", exactly like `brief`.
    const stateUsable = stateResult.report.status === 'available' || stateResult.report.status === 'absent';
    const state = stateResult.state;
    const missions = state ? Object.values(state.tactical.missions) : [];
    const active = state ? selectActiveMissions(state) : [];
    if (stateResult.schemaVersionOnDisk === 1)
        notes.push({ code: 'STATE_LEGACY_SCHEMA_MIGRATED', severity: 'info' });
    if (active.length > 1)
        notes.push({ code: 'MULTIPLE_ACTIVE_MISSIONS', severity: 'info' });
    let currentStory = null;
    if (storyLoaded.content !== null) {
        const extraction = extractCurrentStory(storyLoaded.content);
        if (extraction.hasCurrentStorySection && extraction.excerpt !== null && extraction.lineRange !== null) {
            currentStory = { excerpt: extraction.excerpt, lineRange: extraction.lineRange };
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
    const roadmap = roadmapLoaded.content === null ? null : { text: roadmapLoaded.content };
    return {
        projectOverview: section(overview, [config.report, stateResult.report, storyLoaded.report]),
        currentMissions: section(currentMissions, [stateResult.report]),
        checkpoints: section(checkpoints, [stateResult.report]),
        roadmap: section(roadmap, [roadmapLoaded.report]),
        diagnostics: {
            validation: 'NOT_PERFORMED',
            sources: [config.report, stateResult.report, storyLoaded.report, roadmapLoaded.report],
            notes,
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
