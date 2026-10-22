/**
 * `collect()` — the read-only Collection stage of the brief pipeline.
 *
 * readMonolithRoot → collect() → BriefModel → render(model, budget) → stdout
 *
 * Strictly read-only: no directories, lock files, or state.json are ever
 * created; `mutateState()` is never imported here. state.json is read at
 * most once (one `readFile` call) per invocation — every section that needs
 * Coordinatorium data derives it from that single snapshot via the pure
 * selectors in selectors.ts, never by calling `listMissions()`/
 * `listCheckpoints()` (which each independently re-read the file).
 */
import { existsSync } from 'fs';
import { join, relative } from 'path';
import { readBriefConfig } from './config.js';
import { resolveMonolithRootValue, checkContainedFile, readBoundedFileStable } from '../root/index.js';
import { discoverDocs } from './docs.js';
import { extractCurrentStory } from './story.js';
import { selectActiveMissions, selectRecentFinishedMissions, selectLatestCheckpoint, hasCheckpointOrderMismatch, } from './selectors.js';
import { stateFilePath, validateState, createInitialState, MAX_STATE_BYTES } from '../coordinatorium/index.js';
import { ACTIVE_MD_REL, STANDARD_ADR_DIR, PROTOCOLS_DIR } from './constants.js';
const RECENT_FINISHED_MISSIONS_LIMIT = 5;
/** SEC-001B.1: `active.md` is a short hand-written context file (~3 KB today). */
export const MAX_ACTIVE_CONTEXT_BYTES = 256 * 1024;
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
async function readStateForBrief(targetDir, monolithRoot, root, diagnostics) {
    const stateDir = join(targetDir, monolithRoot);
    const filePath = stateFilePath(stateDir);
    const provenance = { source: relative(targetDir, filePath) };
    // SEC-001A: never read a state.json that resolves outside the project.
    const escape = checkContainedFile(root, 'state.json');
    if (escape) {
        diagnostics.push({
            code: 'PATH_OUTSIDE_PROJECT',
            severity: 'error',
            message: `${provenance.source} was not read: ${escape.message}`,
        });
        return { summary: { status: 'unreadable', provenance }, state: createInitialState() };
    }
    // Rule (section 4, #1): existence is established by the same bounded,
    // non-blocking open that reads the file (SEC-001B.1) — a FIFO or an
    // over-limit file is rejected before any content is read.
    const read = readBoundedFileStable(filePath, provenance.source, { maxBytes: MAX_STATE_BYTES, allowEmpty: true }, true);
    if (!read.ok && read.code === 'FILE_MISSING') {
        diagnostics.push({
            code: 'STATE_NOT_INITIALIZED',
            severity: 'info',
            message: `${provenance.source} does not exist — no missions have ever been recorded.`,
        });
        return { summary: { status: 'absent', provenance }, state: createInitialState() };
    }
    if (!read.ok) {
        diagnostics.push({
            code: 'STATE_UNREADABLE',
            severity: 'error',
            message: `${provenance.source} exists but could not be read: ${read.code}: ${read.detail}`,
        });
        return { summary: { status: 'unreadable', provenance }, state: createInitialState() };
    }
    const raw = 'content' in read ? read.content : '';
    // A literally empty file is distinguished from corrupted content
    // (DEC-CONTEXT-002: "corrupted state.json must not be treated as empty
    // state") precisely so the STATE_UNREADABLE path below is never reached
    // for this case by accident — it gets its own diagnostic instead.
    //
    // Review finding F-1: an empty state.json means no actual state could be
    // read — that is a loss of information, not a benign "zero missions"
    // result (which only a successfully parsed, valid file can report).
    // severity 'error' here is what makes render() treat this as INCOMPLETE
    // (and --strict exit 2), the same way STATE_UNREADABLE already does.
    if (raw.trim() === '') {
        diagnostics.push({
            code: 'STATE_EMPTY',
            severity: 'error',
            message: `${provenance.source} exists but is empty — no state could be read.`,
        });
        return { summary: { status: 'empty', provenance }, state: createInitialState() };
    }
    let parsedJson;
    try {
        parsedJson = JSON.parse(raw);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        diagnostics.push({
            code: 'STATE_UNREADABLE',
            severity: 'error',
            message: `${provenance.source} is not valid JSON: ${msg}`,
        });
        return { summary: { status: 'unreadable', provenance }, state: createInitialState() };
    }
    const onDiskSchemaVersion = isPlainObject(parsedJson) && typeof parsedJson.schemaVersion === 'number' ? parsedJson.schemaVersion : undefined;
    let state;
    try {
        // Supports schemaVersion 2 and an in-memory v1→v2 migration of legacy
        // files — nothing is ever written back (section 4, #6/#7).
        state = validateState(parsedJson);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        diagnostics.push({
            code: 'STATE_UNREADABLE',
            severity: 'error',
            message: `${provenance.source} failed schema validation: ${msg}`,
        });
        return { summary: { status: 'unreadable', schemaVersionOnDisk: onDiskSchemaVersion, provenance }, state: createInitialState() };
    }
    if (onDiskSchemaVersion === 1) {
        diagnostics.push({
            code: 'STATE_LEGACY_SCHEMA_MIGRATED',
            severity: 'info',
            message: `${provenance.source} is schemaVersion 1 — read via the existing in-memory v1→v2 migration; nothing was written to disk.`,
        });
    }
    return { summary: { status: 'ok', schemaVersionOnDisk: onDiskSchemaVersion, provenance }, state };
}
function collectMissions(targetDir, monolithRoot, state, diagnostics) {
    const active = selectActiveMissions(state);
    const recentFinished = selectRecentFinishedMissions(state, RECENT_FINISHED_MISSIONS_LIMIT);
    if (active.length > 1) {
        diagnostics.push({
            code: 'MULTIPLE_ACTIVE_MISSIONS',
            severity: 'info',
            message: `${active.length} missions are in_progress simultaneously: ${active.map((m) => m.id).join(', ')}.`,
        });
    }
    const filePath = stateFilePath(join(targetDir, monolithRoot));
    return { active, recentFinished, provenance: { source: `${relative(targetDir, filePath)}#tactical.missions` } };
}
function collectCheckpoints(targetDir, monolithRoot, state, active, diagnostics) {
    const filePath = stateFilePath(join(targetDir, monolithRoot));
    const provenance = { source: `${relative(targetDir, filePath)}#tactical.checkpoints` };
    return active.map((m) => {
        const latest = selectLatestCheckpoint(state, m.id);
        if (latest && hasCheckpointOrderMismatch(state, m.id, latest)) {
            diagnostics.push({
                code: 'CHECKPOINT_ORDER_MISMATCH',
                severity: 'info',
                message: `Mission "${m.id}": another checkpoint has a later createdAt than "${latest.id}" (the highest-ordinal one) — timestamp order and ID order disagree.`,
            });
        }
        return { missionId: m.id, latest, provenance };
    });
}
function collectStory(targetDir, monolithRoot, root, diagnostics) {
    const activeMdAbs = join(targetDir, monolithRoot, ACTIVE_MD_REL);
    const relPath = relative(targetDir, activeMdAbs);
    // SEC-001A: never present a file outside the project as project context.
    const escape = checkContainedFile(root, ACTIVE_MD_REL);
    if (escape) {
        diagnostics.push({
            code: 'PATH_OUTSIDE_PROJECT',
            severity: 'error',
            message: `${relPath} was not read: ${escape.message}`,
        });
        return { fileExists: false, hasCurrentStorySection: false, excerpt: null, lineRange: null, provenance: null };
    }
    const read = readBoundedFileStable(activeMdAbs, relPath, { maxBytes: MAX_ACTIVE_CONTEXT_BYTES, allowEmpty: true }, true);
    if (!read.ok) {
        diagnostics.push({
            code: 'ACTIVE_MD_MISSING',
            severity: 'warn',
            message: read.code === 'FILE_MISSING'
                ? `${relPath} does not exist.`
                : `${relPath} exists but could not be read: ${read.code}: ${read.detail}`,
        });
        return { fileExists: false, hasCurrentStorySection: false, excerpt: null, lineRange: null, provenance: null };
    }
    const content = 'content' in read ? read.content : '';
    const extraction = extractCurrentStory(content);
    if (!extraction.hasCurrentStorySection) {
        diagnostics.push({
            code: 'ACTIVE_MD_NO_CURRENT_STORY',
            severity: 'info',
            message: `${relPath} exists but has no "## Current Story" section.`,
        });
    }
    return {
        fileExists: true,
        hasCurrentStorySection: extraction.hasCurrentStorySection,
        excerpt: extraction.excerpt,
        lineRange: extraction.lineRange,
        provenance: { source: extraction.lineRange ? `${relPath}:${extraction.lineRange}` : relPath },
    };
}
export async function collect(targetDir) {
    const diagnostics = [];
    const config = readBriefConfig(targetDir, diagnostics);
    // Re-validates (and realpath-checks) the root readBriefConfig just accepted.
    const root = resolveMonolithRootValue(targetDir, config.monolithRoot);
    const monolithRootAbs = root.rootAbs;
    const monolithInitialized = existsSync(monolithRootAbs);
    if (!monolithInitialized) {
        diagnostics.push({
            code: 'MONOLITH_NOT_INITIALIZED',
            severity: 'warn',
            message: `No MONOLITH instance found at "${config.monolithRoot}" — nothing to summarize.`,
        });
    }
    const identity = {
        name: config.projectName,
        monolithRoot: config.monolithRoot,
        provenance: { source: 'monolith.config.json#project.name' },
    };
    const { summary: stateKeeper, state } = await readStateForBrief(targetDir, config.monolithRoot, root, diagnostics);
    const missions = collectMissions(targetDir, config.monolithRoot, state, diagnostics);
    const checkpoints = collectCheckpoints(targetDir, config.monolithRoot, state, missions.active, diagnostics);
    const story = collectStory(targetDir, config.monolithRoot, root, diagnostics);
    const protocolsRelDir = `${config.monolithRoot}/${PROTOCOLS_DIR}`;
    const mandatoryProtocols = {
        items: discoverDocs(targetDir, [protocolsRelDir], (fields) => fields.get('enforcement') === 'mandatory', diagnostics),
        provenance: { source: protocolsRelDir },
    };
    const adrDirs = [`${config.monolithRoot}/${STANDARD_ADR_DIR}`, ...config.extraAdrDirs];
    const adrs = {
        items: discoverDocs(targetDir, adrDirs, (fields) => fields.get('status') === 'accepted', diagnostics),
        provenance: { source: adrDirs.join(', ') },
    };
    return {
        identity,
        monolithInitialized,
        stateKeeper,
        missions,
        checkpoints,
        story,
        mandatoryProtocols,
        adrs,
        diagnostics,
    };
}
