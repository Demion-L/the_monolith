/**
 * `monolith state adopt <source>` — explicitly make one chosen state file the
 * canonical state (BETA-020 Phase 2).
 *
 * What this is NOT: a merge, a "latest wins" heuristic, a migration framework or
 * a runtime adapter for old schemas. The user names the source; nothing else is
 * ever picked, combined or deleted.
 *
 * Without `apply` it is a preview and writes nothing. With `apply` it:
 *  1. re-validates source and destination under the state lock,
 *  2. keeps a byte-exact backup of an existing destination (a failed backup
 *     aborts before the destination is touched),
 *  3. publishes through the State Keeper's safe-write path,
 *  4. reads the result back and compares it,
 * and always leaves the source file where it was.
 *
 * Old data: a `schemaVersion: 2` source is accepted only with the explicit
 * `upgradeV2` option. That is the single, one-off path across the schema change
 * (v3 only adds the optional `Mission.storyId`, so the file is relabelled and
 * then validated by the ordinary current-schema validator). Anything else —
 * schema 1, unknown, corrupt — is refused.
 */
import { lstatSync, realpathSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { readBoundedFileStable } from '../root/index.js';
import { StateAdoptError, StateSchemaError } from './errors.js';
import { MAX_STATE_BYTES, STATE_FILE_NAME, replaceStateUnderLock, validateState } from './state-keeper.js';
import { inspectStateFile, stateWriteTargetOf, } from './state-location.js';
import { STATE_SCHEMA_VERSION, UPGRADABLE_SCHEMA_VERSION_V2 } from './types.js';
function resolveSourceFile(sourceArg, cwd) {
    const abs = resolve(cwd, sourceArg);
    let st;
    try {
        st = lstatSync(abs);
    }
    catch (err) {
        throw new StateAdoptError(`Source "${abs}" cannot be read: ${err.code ?? err.message}.`);
    }
    if (st.isDirectory())
        return join(abs, STATE_FILE_NAME);
    return abs;
}
function loadSource(sourceFile, upgradeV2) {
    const info = inspectStateFile(sourceFile, dirname(sourceFile));
    const out = { path: sourceFile, info, state: null, upgrade: 'none', problems: [] };
    if (info.status === 'absent')
        return { ...out, problems: [`Source "${sourceFile}" does not exist.`] };
    if (info.status === 'unreadable')
        return { ...out, problems: [`Source "${sourceFile}" cannot be read safely (${info.readCode ?? 'unreadable'}).`] };
    if (info.status === 'corrupt')
        return { ...out, problems: [`Source "${sourceFile}" is not a valid state file (not a JSON object).`] };
    const read = readBoundedFileStable(sourceFile, `"${sourceFile}"`, { boundary: dirname(sourceFile), maxBytes: MAX_STATE_BYTES, allowEmpty: true }, true);
    if (!read.ok || !('content' in read))
        return { ...out, problems: [`Source "${sourceFile}" cannot be read safely.`] };
    let parsed;
    try {
        parsed = JSON.parse(read.content);
    }
    catch {
        return { ...out, problems: [`Source "${sourceFile}" is not valid JSON.`] };
    }
    const version = info.schemaVersion;
    try {
        if (version === STATE_SCHEMA_VERSION) {
            return { ...out, state: validateState(parsed) };
        }
        if (version === UPGRADABLE_SCHEMA_VERSION_V2) {
            if (!upgradeV2) {
                return {
                    ...out,
                    problems: [`Source is schemaVersion ${version}; current is ${STATE_SCHEMA_VERSION}. Re-run with --upgrade-v2 to carry it across explicitly (a backup of any existing destination is kept).`],
                };
            }
            // v3 only adds the optional Mission.storyId: relabel, then let the ordinary validator judge the result.
            const relabelled = { ...parsed, schemaVersion: STATE_SCHEMA_VERSION };
            return { ...out, state: validateState(relabelled), upgrade: 'v2-to-v3' };
        }
    }
    catch (err) {
        if (err instanceof StateSchemaError)
            return { ...out, problems: [`Source failed validation: ${err.message}`] };
        throw err;
    }
    return { ...out, problems: [`Source schemaVersion ${String(version)} is not supported (current ${STATE_SCHEMA_VERSION}; only 2 can be upgraded explicitly).`] };
}
function samePath(a, b) {
    try {
        return realpathSync(a) === realpathSync(b);
    }
    catch {
        return resolve(a) === resolve(b);
    }
}
function destinationRevision(info) {
    return info.status === 'ok' ? info.revision : null;
}
function build(loc, source, dest) {
    const conflicts = [...source.problems];
    const warnings = [];
    const actions = [];
    if (source.state !== null && samePath(source.path, loc.statePath) && source.upgrade === 'none') {
        conflicts.push('Source is already the canonical state file; there is nothing to adopt.');
    }
    if (dest.status === 'unreadable') {
        conflicts.push(`Destination "${loc.statePath}" cannot be read safely (${dest.readCode ?? 'unreadable'}); it will not be replaced.`);
    }
    if (dest.status === 'corrupt' || dest.status === 'incompatible-schema') {
        warnings.push(`Destination exists but is ${dest.status === 'corrupt' ? 'not valid state' : `schemaVersion ${String(dest.schemaVersion)}`}; its bytes are kept in the backup.`);
    }
    if (dest.status === 'ok' && source.state !== null) {
        if (dest.revision !== null && source.state.revision < dest.revision) {
            warnings.push(`Source revision (${source.state.revision}) is LOWER than the destination's (${dest.revision}). Nothing is chosen by revision; make sure this is the state you want.`);
        }
        if ((dest.missionCount ?? 0) > 0 || (dest.checkpointCount ?? 0) > 0) {
            warnings.push(`Destination holds ${dest.missionCount ?? 0} mission(s) and ${dest.checkpointCount ?? 0} checkpoint(s); adopting REPLACES them (not merged). They stay available in the backup.`);
        }
    }
    const resultingRevision = source.state === null ? null : Math.max(destinationRevision(dest) ?? 0, source.state.revision) + 1;
    if (conflicts.length === 0) {
        if (dest.status !== 'absent')
            actions.push(`Back up the existing destination next to it (${STATE_FILE_NAME}.bak-<timestamp>-r<revision>-<id>).`);
        if (source.upgrade === 'v2-to-v3')
            actions.push('Relabel schemaVersion 2 -> 3 (adds only the optional Mission.storyId) and validate the result.');
        actions.push(`Write ${loc.statePath} atomically under the state lock, at revision ${String(resultingRevision)}.`);
        actions.push('Read the written file back and compare it.');
        actions.push(`Leave the source file untouched: ${source.path}`);
    }
    return {
        sourcePath: source.path,
        source: source.info,
        destinationPath: loc.statePath,
        destination: dest,
        upgrade: source.upgrade,
        resultingRevision,
        conflicts,
        warnings,
        actions,
        canApply: conflicts.length === 0,
    };
}
/** Build the preview. Reads only. */
export function planAdoption(loc, sourceArg, options, cwd = process.cwd()) {
    const sourceFile = resolveSourceFile(sourceArg, cwd);
    const source = loadSource(sourceFile, options.upgradeV2);
    const dest = inspectStateFile(loc.statePath, loc.kind === 'git-common-dir' ? loc.stateDir : loc.projectRoot);
    return build(loc, source, dest);
}
function backupName(rev) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    return `${STATE_FILE_NAME}.bak-${stamp}-r${rev === null ? 'na' : String(rev)}-${randomBytes(3).toString('hex')}`;
}
/** Preview, and (with `apply`) adopt. A refused plan throws `StateAdoptError` only when `apply` was requested. */
export async function adoptState(loc, sourceArg, options, cwd = process.cwd()) {
    const plan = planAdoption(loc, sourceArg, options, cwd);
    if (!options.apply)
        return { plan, applied: false, backupPath: null };
    if (!plan.canApply) {
        throw new StateAdoptError(`Adoption refused; nothing was written:\n${plan.conflicts.map((c) => `  - ${c}`).join('\n')}`);
    }
    // Re-read the source for the write itself; the destination is re-judged under the lock.
    const source = loadSource(plan.sourcePath, options.upgradeV2);
    if (source.state === null)
        throw new StateAdoptError(`Adoption refused; nothing was written:\n${source.problems.map((c) => `  - ${c}`).join('\n')}`);
    const adopted = source.state;
    const { backupPath } = await replaceStateUnderLock(stateWriteTargetOf(loc, options.onWarning), ({ raw }) => {
        let destRevision = null;
        if (raw !== null) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed.schemaVersion === STATE_SCHEMA_VERSION && typeof parsed.revision === 'number')
                    destRevision = parsed.revision;
            }
            catch {
                /* an unreadable destination is replaced, with its bytes kept in the backup */
            }
        }
        const state = { ...structuredClone(adopted), revision: Math.max(destRevision ?? 0, adopted.revision) + 1 };
        return { state, backupName: raw === null ? null : backupName(destRevision) };
    });
    return { plan, applied: true, backupPath };
}
/** Lines for the CLI. */
export function formatPlan(plan, applied, backupPath) {
    const f = (i) => i.status === 'absent'
        ? 'absent'
        : `status=${i.status}${i.schemaVersion !== null ? ` schema=${i.schemaVersion}` : ''}${i.revision !== null ? ` revision=${i.revision}` : ''}` +
            `${i.missionCount !== null ? ` missions=${i.missionCount}` : ''}${i.checkpointCount !== null ? ` checkpoints=${i.checkpointCount}` : ''}`;
    const lines = [
        applied ? 'State adopted.' : 'Adoption preview (nothing was written).',
        `  source:       ${plan.sourcePath}`,
        `                ${f(plan.source)}`,
        `  destination:  ${plan.destinationPath}`,
        `                ${f(plan.destination)}`,
        `  resulting revision: ${plan.resultingRevision === null ? '(n/a)' : plan.resultingRevision}`,
    ];
    if (plan.upgrade === 'v2-to-v3')
        lines.push('  upgrade:      schemaVersion 2 -> 3');
    for (const c of plan.conflicts)
        lines.push(`  CONFLICT: ${c}`);
    for (const w of plan.warnings)
        lines.push(`  WARNING:  ${w}`);
    if (!applied && plan.actions.length > 0) {
        lines.push('  planned actions:');
        for (const a of plan.actions)
            lines.push(`    - ${a}`);
    }
    if (applied) {
        lines.push(backupPath ? `  backup:       ${backupPath}` : '  backup:       (none needed: no destination existed)');
        lines.push(`  source kept:  ${plan.sourcePath}`);
        lines.push('  Verified: the written file was read back and matches.');
        lines.push('  Other worktree-local state files were not touched; MONOLITH never deletes them. See `monolith state status`.');
    }
    else if (plan.canApply) {
        lines.push('Add --apply to perform it.');
    }
    return lines;
}
